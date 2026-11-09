# 아키텍처와 서비스 로직

agentmux는 Next.js Pages Router와 custom Node server를 함께 사용하는 코딩 에이전트 웹 세션
매니저입니다 (현재 Codex 지원, Claude Code 지원 예정). Active runtime은 Linux 단일 엔진 호스트이며 Runtime v2 worker와 Linux tmux
adapter가 함께 동작합니다. Windows installer/updater 기록은 별도 배포면의 역사적 근거로
보존합니다.

## 핵심 구조

```text
Browser / Electron
  | HTTP + WebSocket
  v
custom Node server
  | exact upload route ownership
  | Next.js Pages Router
  | auth proxy
  | WebSocket routing
  v
runtime v2 Supervisor
  | terminal worker
  | storage worker
  | timeline worker
  | status worker
  | governance worker
  v
Linux engine-owned sources
  | tmux terminal adapter
  | ~/.codex/sessions/**/*.jsonl (read-only)
  | ~/.agentmux/**/*.db (legacy ~/.codexmux/**/*.db, app-owned)
  | approved project roots (governed scaffold write)
```

custom server와 Next.js API route는 같은 process 안에서도 서로 다른 module graph를 사용할 수 있습니다. 공유 상태는 `globalThis` singleton에 두고 재초기화를 막습니다.

## 런타임 v2

Runtime v2는 Supervisor와 worker process로 terminal, storage, timeline, status, governance 책임을 분리합니다.

| 영역 | 책임 | Rollback |
| --- | --- | --- |
| Terminal Worker | terminal create/attach/write/resize/detach/kill | terminal mode `off` 또는 legacy adapter |
| Storage Worker | workspace/layout/tab/message-history SQLite projection | storage mode `off` |
| Timeline Worker | Codex JSONL read/live watch, timeline, Session Catalog와 검색 index | timeline mode `off`; catalog는 degraded |
| Status Worker | Codex process/status policy, notification side effect | status mode `off` |
| Governance Worker | 승인 project read, Knowledge Index, scaffold transaction/journal/recovery | core worker는 유지하고 governance만 degraded |

`AGENTMUX_RUNTIME_V2=1`(legacy `CODEXMUX_RUNTIME_V2=1` 호환)에서 surface mode가 unset이면 Phase 6 기준 fallback을 적용합니다. 잘못된 명시 값은 fail closed로 legacy/off에 가깝게 처리합니다.

## 서버 시작 흐름

1. config와 shell path 초기화를 함께 완료합니다.
2. strict stored auth state에서 `configured`, `init-password`, `setup-open`을 결정합니다.
3. runtime auth env와 bootstrap claim latch를 덮어쓰고 startup access filter를 초기화합니다.
4. setup 시작이면 `HOST`/저장 network access보다 우선해 loopback bind plan을 사용합니다.
5. runtime v2 mode를 해석하고 Supervisor singleton을 준비합니다.
6. process-scoped UploadServer를 만들고 Next.js request handler보다 앞에 연결합니다.
7. typed WebSocket route와 health/smoke endpoint를 연결합니다.

서버 시작 중 runtime v2 core worker가 준비되지 않으면 해당 surface는 명확한 diagnostic을 반환해야 합니다. Governance Worker는 비핵심 worker이므로 준비 실패가 terminal/storage/timeline/status 시작을 막지 않고 governance surface만 degraded로 둡니다. 브라우저는 stale tab을 조용히 busy/idle로 표시하지 않아야 합니다.

## HTTP와 WebSocket 라우팅

| 경로 | 용도 |
| --- | --- |
| `/api/health` | public health probe. app/version/commit/buildTime 반환 |
| `/api/terminal` | legacy terminal WebSocket |
| `/api/v2/terminal` | runtime v2 terminal WebSocket |
| `/api/timeline` | timeline WebSocket. mode에 따라 legacy 또는 worker backend |
| `/api/status` | status WebSocket. mode에 따라 legacy 또는 worker backend |
| `/api/sync` | workspace/layout invalidation |
| `/api/install` | install 전용 WebSocket. setup-local 또는 authenticated admission 뒤 legacy PTY 실행 |
| `/api/upload-image` | outer-owned raw image upload. exact 10MiB limit |
| `/api/upload-file` | outer-owned raw generic upload. exact 50MiB limit |
| `/api/uploads/cleanup` | 인증된 committed/stale upload cleanup 제어 |
| `/api/debug/perf` | 인증된 성능 snapshot |
| `/api/sessions/*` | Session Catalog health/search/replay와 Storage Worker 소유 annotation/filter |
| `/api/governance/roots/*` | Approved Project Root preview/명시적 confirm |
| `/api/governance/import/*` | `projects.yaml` preview/선택적 confirm import |
| `/api/governance/projects/*` | Managed Project read model, scaffold/action preview-confirm와 history |

WebSocket payload에는 terminal output, prompt, token, full path 같은 민감한 본문을 불필요하게 저장하지 않습니다.

Setup claim이 열려 있는 동안 custom server는 HTTP와 WebSocket 모두 source filter 뒤에
single loopback Host를 요구합니다. Setup POST와 install handshake는 raw Host/Origin이 각각
한 개인지 확인하고 canonical hostname+effective port가 같은 same-authority request만
허용합니다. Forwarded header를 신뢰하지 않으므로 이는 TLS scheme까지 증명하는 full
same-origin 또는 trusted proxy 계약이 아닙니다.

`/api/install`은 Next HTTP proxy에서 보호되며 WebSocket upgrade만 custom server가 먼저
소비합니다. Upgrade admission과 connection 직전 fresh admission은 같은 authorizer를
사용합니다. Setup-local PTY는 config/latch를 spawn 전후, delayed command, stdin/resize,
500ms watcher에서 재검증하며 setup 완료는 `1000`, 상태 판독 실패는 `1011`로 종료합니다.
실행 slot은 `idle -> starting -> active` owner token으로 직렬화하고 입력 frame 64KiB,
queue 256 frame/1MiB, 출력 buffered amount 1MiB를 제한합니다.

## 인증 쿠키 격리

Browser session cookie는 `agentmux-session-token`이며 기존 세션 유지를 위해 legacy `codexmux-session-token`도 호환 검증합니다. Cookie는 hostname과 path를 기준으로
전송되고 port로 격리되지 않으므로, 같은 `localhost`에서 서로 다른 port를 쓰는 sibling app과
generic `session-token`을 공유하면 로그인이나 refresh 때 서로의 JWT를 덮어씁니다. agentmux의
HTTP, SSR, WebSocket, install, upload 경로는 공통 `SESSION_COOKIE` 및 legacy 호환 쿠키만 검증합니다.

Legacy `session-token`은 Purplemux 같은 sibling app의 session일 수 있으므로 agentmux(이전 이름 Codexmux)가 읽거나
login/logout에서 생성·삭제하지 않습니다. `v0.4.22`에서 namespace를 분리할 때 기존 이전 이름 Codexmux browser/Electron
session은 한 번 다시 로그인해야 했으며, tmux/runtime session과 `~/.agentmux/`(legacy 실제 경로 `~/.codexmux/`) 데이터는 그대로
유지됩니다. 남은 legacy cookie가 이전 이름 Codexmux JWT라 Purplemux 인증이 실패하면 Purplemux에도
한 번 로그인해 legacy cookie를 복구합니다. Query string으로 전달된 새 cookie 이름과 legacy
이름은 모두 credential leak 방지를 위해 fail closed합니다.

## Upload ingress

`/api/upload-image`와 `/api/upload-file`의 external request는 development Next handler와
production standalone proxy보다 먼저 outer server가 소비합니다. Removed Pages API route와
internal standalone port는 upload fallback surface가 아닙니다.

Pre-body gate 순서는 raw target/source guard, strict single Host, CLI 우선 session 인증,
credential별 Origin, method, supported Expect, canonical framing/policy, session refresh,
admission입니다. Session은 same-authority Origin이 필수이고 CLI token은 Origin을 생략할 수
있지만 제공하면 same-authority여야 합니다. Transfer-Encoding, Content-Length 중복/비정규
표현, non-identity Content-Encoding은 body를 읽기 전에 거절합니다. 모든 upload response는
`Connection: close`이며 인증과 admission 전에는 `100 Continue`를 보내지 않습니다.

Admission은 process-scoped UploadServer 한 개가 소유합니다.

- 최대 active upload: 8
- 최대 declared reserved bytes: 200MiB
- queue 없음: 초과 request는 즉시 `429`
- progress idle timeout: 60초
- absolute transaction timeout: 270초
- image/file policy: 10MiB/50MiB

Storage는 `~/.agentmux/uploads/<workspace>/<tab>/`(legacy 실제 경로 `~/.codexmux/uploads/<workspace>/<tab>/`) 아래에
`.<32 lowercase hex>.upload.part`를 `wx`, `0o600`으로 생성합니다. Application-observed
byte가 Content-Length와 같고 request가 complete인 경우에만 writer를 닫습니다. Final
filename도 128-bit random token을 포함하며, `fs.link(stage, final)` 성공을 no-replace
commit point로 사용한 뒤 staged link를 제거합니다. Destination collision은 새 이름으로
재시도하므로 기존 artifact를 overwrite하지 않습니다. Commit 뒤 response가 끊겨도 final
artifact는 보존하고 TTL cleanup이 소유합니다.

Active/recent stage는 committed cleanup에서 제외합니다. Reserved staged namespace만 최소
30분 age 뒤 startup/30분 maintenance/manual stale cleanup 대상이 됩니다. 정상 committed
`.part` 파일은 stage로 오인하지 않습니다. `AGENTMUX_UPLOADS_DISABLED=1`(legacy `CODEXMUX_UPLOADS_DISABLED=1` 호환)은 두 exact route만
`503`으로 닫고 Next fallback, health, 인증된 non-upload API는 유지합니다.

Production embedded Next server에는 `NEXT_MANUAL_SIG_HANDLE=true`를 require 전에 설정합니다.
SIGINT/SIGTERM drain은 outer lifecycle이 listener, WebSocket, upload transaction과 staged
cleanup을 먼저 닫은 뒤 완료되며, 반복 signal도 같은 idempotent shutdown promise를 사용합니다.

## 상태 저장 로직

Legacy store는 JSON 파일을 사용합니다. Runtime v2 store는 SQLite를 사용합니다.

| Store | 위치 | 용도 |
| --- | --- | --- |
| Legacy JSON | `~/.agentmux/workspaces.json`(legacy `~/.codexmux/workspaces.json`), `workspaces/*/layout.json` | rollback, migration fallback |
| Runtime v2 SQLite | `~/.agentmux/runtime-v2/state.db`(legacy `~/.codexmux/runtime-v2/state.db`) | workspace/layout/tab/message-history projection |
| Session Catalog SQLite | `~/.agentmux/session-catalog/index.db`(legacy `~/.codexmux/session-catalog/index.db`) | JSONL metadata/message FTS/cursor/health projection. 삭제 후 rebuild 가능 |
| Knowledge Index SQLite | `~/.agentmux/governance/index.db`(legacy `~/.codexmux/governance/index.db`) | 문서 metadata/headings/fingerprint/link projection. 삭제 후 refresh 가능 |
| Codex JSONL | `~/.codex/sessions/**/*.jsonl` | Codex 원본 timeline/status source. read-only |

Approved Project Root, Managed Project, import 결과, session annotation/saved filter와 sanitized governance audit는 `runtime-v2/state.db`의 durable app state입니다. Runtime v2 default read가 켜져도 rollback용 JSON write는 유지합니다. 세 SQLite 디렉터리는 `0700`, DB/WAL/SHM은 `0600`으로 유지합니다.

Session Catalog의 text/project/model/date predicate는 Timeline Worker가, pin/tag predicate는 Storage
Worker가 평가합니다. Annotation filter가 있으면 Storage Worker가 최대 10,000개의 bounded
include/exclude session ID selection을 만들고 Timeline Worker가 bound JSON `json_each` membership을
search/count/cursor SQL 전에 적용합니다. Supervisor는 확정된 최대 200개 page만 annotation으로
hydrate하며 결과를 사후 제거하지 않습니다. Selection과 hydration 사이 pin/tag가 바뀌면 전체
orchestration을 한 번 재시도하고 반복 충돌은 retryable error로 fail closed합니다. Filter가 없으면
selection round trip을 생략합니다.

## 워크스페이스 로직

Workspace는 id, name, directory, layout, active pane/tab을 묶는 app-level aggregate입니다.

- workspace 생성은 directory와 기본 terminal tab을 함께 준비합니다.
- runtime v2 tab은 `runtimeVersion: 2` metadata를 가집니다.
- runtime DB snapshot이 authoritative한 상태에서는 빈 snapshot도 정상 상태로 취급합니다.
- workspace 삭제는 관련 tab/session cleanup intent를 함께 남겨야 합니다.

## 앱 영역 탐색과 선택 projection

`resolveAppArea(pathname)`은 Pages Router pathname만 해석해 `workspace`, `sessions`,
`governance` 또는 `null`을 반환합니다. `AppAreaNavigation`은 이 projection을 desktop expanded,
collapsed rail, mobile bottom과 navigation sheet에서 공유합니다. Active custom webview나 Reports,
Stats 같은 utility surface에서는 caller가 current area를 `null`로 유지합니다.

Workspace 내부 `workspace|activity` tab은 route가 아니라 local context입니다. Legacy
`sidebar-tab=sessions`는 hydration 전에 `activity`로 normalize합니다. Current route는
`aria-current`, Workspace/Session/Managed Project selection은 `aria-selected`, disclosure는
`aria-expanded`, keyboard focus는 `focus-visible`로 표현하며 runtime status color를 navigation
selection에 사용하지 않습니다.

## 터미널 로직

Terminal API가 기대하는 동작은 adapter와 무관하게 같습니다.

- create: shell 또는 Codex tab을 생성합니다.
- attach: stdout stream을 구독합니다.
- write: stdin을 전달합니다.
- resize: terminal size를 적용합니다.
- detach: 구독만 해제하고 session은 유지합니다.
- kill/delete: runtime session을 종료하고 app state를 정리합니다.

Terminal byte stream은 durable state가 아닙니다. Reconnect는 저장된 stdout replay가 아니라 adapter 재attach로 복구합니다.

Codex web input은 raw terminal key 입력과 분리해서 처리합니다. Client는 `MSG_WEB_STDIN` frame으로 app-originated input을 보내고, legacy terminal path는 tmux copy mode를 먼저 빠져나온 뒤 pty에 씁니다. Prompt 본문은 bracketed paste로 감싸고 Enter를 같은 frame에 포함하며, Codex CLI 확인 흐름을 위해 후속 Enter를 한 번 더 보냅니다.

Agent launch/resume는 browser에서 command string을 조립하지 않습니다. Client intent를 받은 server가 workspace/pane/tab ownership, Codex panel, safe shell, minimum CLI version을 검증하고 provider command를 생성합니다. Runtime v2 내부 write는 subscriber가 없는 범용 stdin 우회로가 아니라 ready 상태의 exact terminal session에만 허용됩니다.

## Codex 세션 감지

Codex session mapping은 다음 source를 조합합니다.

1. 실행 중인 process tree
2. terminal runtime metadata
3. Codex JSONL `session_meta`, `turn_context`
4. cwd와 process start time fallback
5. tab-scoped prompt claim

Process start time으로 현재 JSONL을 특정할 수 없는 long-lived Codex process는 tab의 prompt claim으로만 최신 same-cwd JSONL을 채택합니다. Prompt text, claim timestamp, JSONL user message timestamp, cwd가 맞고 같은 window 안의 중복 후보가 없을 때만 `agentSessionId`/`agentJsonlPath`를 갱신합니다. Claim 저장은 timeline refresh signal을 발행하고, 열린 legacy/runtime timeline socket은 짧은 재시도 창 안에서 같은 소유권 검증을 다시 실행합니다. 이 신호가 없으면 같은 cwd의 다른 tab session과 섞일 수 있으므로 최신 JSONL로 자동 전환하지 않습니다.

Windows에서는 `/proc`, `pgrep`, `ps`, `lsof` 같은 POSIX primitive를 직접 호출하지 않고 process inspector adapter를 사용합니다.

## 타임라인 로직

Timeline은 Codex JSONL record와 live pane prompt를 병합해 UI entry로 투영합니다.

- entry id는 JSONL byte offset과 record identity를 기준으로 안정화합니다.
- 같은 assistant text가 여러 record type으로 남는 경우 near-duplicate rule로 중복 표시를 줄입니다.
- permission/input prompt는 JSONL marker가 늦거나 없을 수 있으므로 live pane capture로 보정합니다.
- exec/web/MCP/patch/error/compaction record는 semantic entry로 투영하고 generic tool fallback을 유지합니다.
- Rich detail은 secret-like 값을 redaction하고 field 4KiB, entry 16KiB로 제한합니다. Full output, download, local image URL은 만들지 않습니다.
- older entry와 message count는 worker read command로 분리합니다.
- session list는 `SessionIndexService` snapshot을 page 단위로 읽습니다. Cold refresh가 진행 중이면
  request path가 전체 JSONL scan을 기다리지 않고 현재 snapshot과 `refreshing` 상태를 반환합니다.

## Session Catalog 로직

Session Catalog는 Timeline Worker 내부의 재생성 가능한 projection입니다. JSONL raw read와 파일 cursor, session metadata, bounded message text/FTS를 한 worker가 소유하고 Next API는 DB나 JSONL path를 직접 열지 않습니다.

- 검색 결과는 project label, model, 시간, 관계, turn 수와 bounded snippet만 반환하며 canonical path와 command를 노출하지 않습니다.
- 복기는 catalog의 session id를 canonical JSONL cursor로 해석한 뒤 bounded page를 읽습니다. 요청 cursor가 파일 크기보다 크면 파일 크기로 제한합니다.
- pin/tag와 saved filter는 검색 index가 아니라 Storage Worker의 durable state이며 optimistic version으로 갱신합니다.
- rebuild는 원본 JSONL을 삭제하거나 변경하지 않습니다. 중복 요청은 한 rebuild로 합치고 health의 `queueLag`, `cursorAgeMs`, `rebuildState`로 진행 상태를 표시합니다.
- index가 손상되면 DB/WAL/SHM을 quarantine하고 Timeline Worker를 재시작한 뒤 authenticated rebuild API로 재생성합니다.

## Project Governance 로직

Storage Worker는 Approved Project Root와 Managed Project의 canonical path를 durable하게 보관하지만 API 응답에는 path를 제거합니다. Governance Worker만 Storage가 전달한 snapshot으로 등록 project를 읽습니다.

- root 등록과 `projects.yaml` import는 preview token, digest/source fingerprint, 10분 TTL과 exact confirmation phrase를 사용합니다. mutation은 기존 session/CLI auth와 same-authority Origin 정책을 재사용합니다.
- root와 project는 `realpath` containment, Linux mount 경계, symlink/regular-file 검증을 매 scan과 문서 read에서 다시 확인합니다.
- discovery는 Markdown allowlist와 file/count/total bytes/depth/time quota를 적용하고 `.git`, `.worktrees`, build/cache, `node_modules`, nested worktree와 symlink를 제외합니다.
- Knowledge Index에는 path, kind, title, headings, fingerprint, lint, link만 저장합니다. 문서 본문은 index DB에 저장하지 않고 요청 시 최대 256KiB를 다시 읽습니다.
- audit은 후보의 상대 path, line, category만 반환하고 matching secret body는 반환하지 않습니다.
- Project Lifecycle snapshot evidence는 project document response와 같은 2,000개 maximum으로
  bounded합니다. 초과 응답은 IPC validation에서 fail closed하며 상한 접근 시 pagination 또는
  summarized evidence contract를 별도 설계합니다.
- `governance.preview-scaffold`는 browser가 지정한 artifact ID를 versioned catalog로 render하고
  root containment, mount/symlink, marker, file/action limit을 검증한 뒤 10분 opaque token과
  bounded diff를 반환합니다. Unmarked UTF-8 regular file은 첫 pass에서 confirm 불가
  `adoption-available`로 반환합니다. Browser가 artifact별 `adoptArtifacts`를 선택해 다시
  preview하면 별도 compact marker variant를 EOF에 append한 `adopt` diff를 만들며 unchecked
  discovery artifact는 다음 request에서 제외합니다. Browser는 path와 output을 지정하지 않습니다.
- `governance.confirm-scaffold`는 project title exact confirmation, token/digest와 target fingerprint를
  다시 검증합니다. 신규 file은 same-directory hard-link no-replace, marker update와 adoption은
  atomic replace로 publish하고 모든 file 완료 뒤에만 durable `committed` 상태를 기록합니다.
  Adoption은 existing bytes의 strict UTF-8 round-trip, NUL/marker-like comment 부재와 exact prefix를
  검증하고 durable manifest v1에서는 existing-file `marker-update`로 정규화합니다.
- Preimage, stage progress와 created directory는 private action manifest에 기록합니다. Commit marker
  전 worker가 중단되면 gate 상태와 무관하게 startup에서 rollback하며 외부 변경은 덮어쓰지 않고
  `recovery-required`로 남깁니다. Public action history에는 canonical/backup path, diff, rendered
  content와 preimage가 없습니다.
- Health의 `writeState`는 `disabled|ready|recovering|degraded`입니다. Summary `readOnly`는
  `writeState === ready`일 때만 false입니다. Automatic/full-file adoption, semantic merge,
  delete/move/full sync는 없습니다.

## 상태 로직

상태 로직은 프로세스 상태, 작업 상태, 알림 상태를 분리해서 판단합니다.

| 범주 | 예 |
| --- | --- |
| 프로세스 상태 | Codex running, shell idle, process missing |
| 작업 상태 | busy, idle, needs-input, review-needed, interrupted |
| notification | completion toast, Web Push, native notification |

상태 전이는 pure helper에서 계산하고, `StatusManager`와 worker는 polling, watch, broadcast 같은 부수효과를 담당합니다. Provider adapter는 `statusBehavior`로 JSONL watch 유지와 stop hook 지연 여부를 명시하며, legacy manager와 runtime v2 worker IPC는 같은 shape를 소비합니다.

Codex hook event는 server provider가 만든 `hooks.SessionStart`, `hooks.UserPromptSubmit`, `hooks.Stop` session override가 standalone `~/.agentmux/status-hook.cjs`(legacy 실제 경로 `~/.codexmux/status-hook.cjs`)를 호출해 들어옵니다. Bridge는 CLI token과 tab/session/expiry capability를 loopback API에 전달하고 실패 시에도 Codex action을 막지 않습니다. User/project/managed/plugin hook은 native Codex layer discovery가 보존하며 agentmux가 사용자 TOML을 병합하지 않습니다.

JSONL tail의 `token_count/rate_limits` observation은 작업 상태 scan과 같은 read에서 추출합니다. Window별 `observed_at`을 기준으로 newest merge/dedupe하고 reset 뒤 관찰이 없으면 `갱신 대기` 상태를 유지합니다.

## 성능과 진단

`/api/debug/perf`는 인증된 session에서만 process memory, event loop delay, WebSocket 수, watcher, polling, cache, worker counter를 반환합니다. 본문 데이터는 반환하지 않습니다.

성능 개선은 source of truth를 바꾸는 큰 rewrite보다 다음처럼 좁게 진행합니다.

- timeline append batching
- row memoization
- JSONL tail snapshot cache
- session index cache
- cold session index refresh 비차단 응답
- diff short cache
- stats in-flight dedupe

## 운영 로직

Linux `systemd --user`가 active engine 운영 경계입니다. 배포 전 build와 Runtime v2 core
gate를 통과하고, Session Catalog 성능/재생성, Linux 격리 smoke, 한국어/영어 browser
smoke를 확인합니다. 실제 service restart는 별도 운영 승인 뒤 수행하며 기존 durable DB가
있으면 먼저 `runtime-v2/state.db` backup을 만듭니다. 2026-08-21 최초 배포는 기존 DB가
없는 fresh host에서 실행됐고 restart 전후 terminal/Phase 6 gate를 통과했습니다. Windows
package와 updater 근거는 Linux engine acceptance를 대체하지 않습니다.

## 장애 대응 기준

- Runtime worker가 죽으면 worker counter와 sanitized last error를 남깁니다.
- Governance Worker가 죽으면 terminal/session operation을 유지한 채 governance UI를 degraded read model로 전환합니다.
- Governance write 장애는 먼저 `AGENTMUX_GOVERNANCE_WRITES`(legacy `CODEXMUX_GOVERNANCE_WRITES` 포함)를 제거하고 restart해 새 action만
  차단합니다. Pending journal recovery와 action history read는 gate off에서도 유지합니다.
- Terminal session이 사라지면 stale ready tab으로 숨기지 않고 failed/diagnostic 상태를 표시합니다.
- Storage migration 실패는 DB handle을 닫고 rollback 가능한 오류로 반환합니다.
- Session Catalog와 Knowledge Index는 원본이 아닌 projection이므로 quarantine 후 rebuild/refresh합니다. `runtime-v2/state.db`는 projection처럼 삭제하지 않고 backup/restore 절차를 사용합니다.
- Status/timeline worker rollback은 같은 public URL에서 legacy implementation으로 되돌릴 수 있어야 합니다.
- Linux engine gate 또는 live terminal/reconnect 실패는 active release blocker입니다.
- Windows package smoke 실패는 Windows 배포면을 변경하는 release의 blocker입니다.
- Upload 장애는 취약한 Pages route나 dependency로 되돌리지 않습니다. 먼저
  `AGENTMUX_UPLOADS_DISABLED=1`(legacy `CODEXMUX_UPLOADS_DISABLED=1` 호환)로 ingress만 중지하고, patched dependency와 outer route
  ownership을 유지한 forward fix를 배포합니다.
- malformed/hash-only config는 원본 bytes를 보존한 채 startup을 중단합니다. 비밀번호 reset은 server를 멈춘 뒤 `authPassword`와 `authSecret`을 함께 제거하고 restart해야 하며, 실행 중 config 제거로 claim을 다시 열지 않습니다.

## 문서 갱신 기준

- runtime boundary 변경: `ADR.md`, `RUNTIME-V2-CUTOVER.md`, `RUNTIME-V2-PARITY.md`
- Windows host/package 변경: `WINDOWS-ONLY-GAP-AUDIT.md`, `ELECTRON.md`, `TESTING.md`
- status 변경: `STATUS.md`
- terminal protocol 변경: `TMUX.md`
- data layout 변경: `DATA-DIR.md`
