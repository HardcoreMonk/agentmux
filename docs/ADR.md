# 아키텍처 결정 기록

이 문서는 agentmux의 오래가는 설계 결정을 모읍니다. 세부 실행 흐름은 `ARCHITECTURE-LOGIC.md`, 상태 감지는 `STATUS.md`, terminal/runtime 경계는 `TMUX.md`와 Linux 운영 문서에 둡니다. Windows 전환 문서는 역사적 제품·release 근거로 보존합니다.

## 작성 기준

다음 변경은 ADR을 함께 갱신합니다.

- framework, router, custom server boundary 변경
- terminal runtime, process inspector, Codex session detection 변경
- provider model 또는 `agent*` metadata 의미 변경
- data directory(`~/.agentmux`, legacy 실제 경로 `~/.codexmux`) 저장 구조, auth, security 동작 변경
- Electron/Android 같은 platform shell 동작 변경
- 알림, locale, 모바일 UX, 터미널 입력, 재연결, 중복 제거 같은 cross-surface 정책 변경
- 제품 실행 토폴로지, packaging, installer, updater, host operation 변경

작은 copy, 단일 컴포넌트 styling, 기존 결정과 충돌하지 않는 버그 수정은 새 ADR이 필요하지 않습니다.

## ADR-001: Next.js Pages Router와 custom server 유지

- 상태: 승인
- 결정: App Router를 도입하지 않고 Pages Router와 `server.ts` custom Node server를 유지합니다.
- 이유: terminal WebSocket, runtime worker, CLI bridge, status manager가 한 process 안에서 낮은 지연으로 협력해야 합니다.
- 영향: `"use client"`를 추가하지 않습니다. 인증 middleware 경로는 현재 Next.js 버전에 맞춰 `src/proxy.ts`를 사용합니다.

## ADR-002: 터미널 런타임은 adapter 경계 뒤에 둔다

- 상태: 승인
- 결정: 기존 tmux 경로는 legacy infrastructure adapter로 취급하고, runtime v2는 `ITerminalRuntimeAdapter` 경계 뒤에서 terminal create, attach, write, resize, detach, kill을 처리합니다.
- 이유: Windows-only 제품 전환에서 tmux 자체를 domain API로 보면 ConPTY/node-pty runtime, process inspection, packaged smoke를 안전하게 도입할 수 없습니다.
- 영향: `src/lib/tmux.ts`를 새 코드의 domain API처럼 직접 확장하지 않습니다. Windows adapter와 tmux adapter는 같은 worker service 계약을 만족해야 합니다.

## ADR-003: Codex provider 중심 모델

- 상태: 승인
- 결정: 현재 provider는 Codex이며, client/store field는 migration 범위를 줄이기 위해 `agent*` 이름을 유지합니다.
- 이유: UI와 저장 데이터가 provider-neutral 모양을 갖고 있어야 이후 변경 비용을 줄일 수 있습니다.
- 영향: `TCliState`, `ITabState`, `StatusManager`, provider detection, `agentSessionId`, `agentSummary`를 바꾸면 `STATUS.md`도 갱신합니다. 새 provider는 registry contract를 통과해야 하며 provider id와 panel type은 중복될 수 없습니다. JSONL watch 유지와 stop hook 지연 같은 provider별 status 동작은 `statusBehavior` contract로 명시합니다.

## ADR-004: 공유 상태는 `globalThis` singleton에 둔다

- 상태: 승인
- 결정: custom server와 Next.js API route가 공유해야 하는 singleton state는 `globalThis`에 저장하고 재초기화를 guard합니다.
- 이유: 하나의 Node process 안에서도 server bundle과 API route module graph가 분리될 수 있습니다.
- 영향: 새 key는 일반적으로 `__pt` plus PascalCase를 사용합니다. 기존 `__codexmux*`, `__cmux*` key는 주변 코드와 맞춰 유지합니다.

## ADR-005: 앱 상태와 Codex 원본 상태를 분리한다

- 상태: 승인
- 결정: codexmux 영속 상태는 `~/.codexmux/`에 저장하고, Codex CLI JSONL은 `~/.codex/sessions/`에서 읽기 전용으로 참조합니다.
- 이유: codexmux 설정과 Codex CLI 소유 데이터를 분리해야 안전한 초기화와 migration이 가능합니다.
- 영향: 비밀번호만 초기화하려면 `authPassword`, `authSecret`만 제거합니다. `config.json` 전체 삭제는 locale/theme/network/Codex option까지 초기화합니다.

## ADR-006: 한국어 기본, 영어 UI 병행

- 상태: 승인
- 결정: 지원 locale은 `ko`, `en`이며 기본 locale은 `ko`입니다. 기준 문서는 한국어를 canonical 언어로 사용합니다.
- 이유: 현재 운영 언어는 한국어이고, 제품 UI는 영어 사용자도 배제하지 않아야 합니다.
- 영향: SSR page는 저장된 locale로 message bundle과 `html lang`을 맞춥니다. 사용자-facing copy는 Korean/English message file을 함께 갱신합니다.

## ADR-007: Electron과 Android는 클라이언트 shell이다

- 상태: 승인
- 결정: Electron과 Android는 Codex runtime을 재구현하지 않고 codexmux server에 연결하는 shell로 유지합니다.
- 이유: Codex와 terminal execution은 server/runtime 계층에 두고, platform shell은 packaging, reconnect, notification, native bridge에 집중해야 합니다.
- 영향: Windows 전환에서는 Electron이 primary desktop shell입니다. Android는 legacy/mobile reference surface로 취급합니다.

## ADR-008: 알림 사운드는 공통 설정으로 제어한다

- 상태: 승인
- 결정: 작업 완료 사운드는 `soundOnCompleteEnabled` 하나로 toast, native notification, Web Push를 함께 제어합니다.
- 이유: 사용자는 foreground/background나 shell 종류와 관계없이 동일한 알림 정책을 기대합니다.
- 영향: `soundOnCompleteEnabled=false`이면 completion sound를 재생하지 않고 system notification도 silent로 요청합니다.

## ADR-009: terminal 제어 입력은 앱 단축키보다 우선한다

- 상태: 승인
- 결정: xterm, Codex web input, mobile surface에 focus가 있으면 `Ctrl+D`는 앱 단축키가 아니라 EOF/EOT(`0x04`)로 pty에 전달합니다.
- 이유: codexmux는 Codex CLI를 감싸는 제품이므로 shell/Codex CLI의 기본 제어 키가 유지되어야 합니다.
- 영향: Linux/Windows의 오른쪽 pane split 기본 단축키는 `Ctrl+Alt+D`입니다. macOS legacy path는 `Cmd+D`를 유지합니다.

## ADR-010: 상태와 타임라인 정책은 순수 모듈로 분리한다

- 상태: 승인
- 결정: 완료 판정, 알림 판정, session id mapping, timeline merge/dedupe, stable id 생성은 순수 helper 모듈에서 처리합니다.
- 이유: polling, JSONL watcher, hook, live pane capture가 같은 turn을 여러 경로로 관측하므로 부수효과 클래스에 정책을 숨기면 중복 알림과 중복 timeline이 생깁니다.
- 영향: `StatusManager`, `timeline-server`, React hook은 신호 수집과 송신을 담당하고, 정책은 단위 테스트를 동반합니다.

## ADR-011: DIFF 패널은 제한된 Git snapshot으로 렌더링한다

- 상태: 승인
- 결정: DIFF 패널은 현재 workspace cwd의 Git snapshot을 보여주되 tracked diff, untracked 수, 파일 크기, 전체 diff 크기, client fetch 시간을 제한합니다.
- 이유: 빌드 산출물이나 screenshot 같은 untracked 파일이 대량으로 생기면 API와 browser render가 함께 멈출 수 있습니다.
- 영향: 제한 초과 파일은 생략 안내를 표시하고, 큰 hunk는 기본 접힘으로 렌더링합니다.

## ADR-012: 성능 계측은 인증된 snapshot API로 노출한다

- 상태: 승인
- 결정: 성능 최적화는 `globalThis.__ptPerfStore`와 인증된 `/api/debug/perf` snapshot으로 관측한 뒤 좁게 진행합니다.
- 이유: 병목 후보가 Node server, WebSocket, terminal, JSONL parsing, React render에 분산되어 있습니다.
- 영향: perf snapshot은 숫자와 duration/counter만 반환합니다. session id, cwd, JSONL path, prompt, terminal output 본문은 노출하지 않습니다.

## ADR-013: Windows companion integration은 제거 상태를 유지한다

- 상태: 승인
- 결정: 이전 원격 Windows JSONL sync, remote terminal sidecar, remote session filter, 관련 page/API/helper script는 제품 surface에서 제거된 상태를 유지합니다.
- 이유: 별도 remote source model은 lifecycle, auth, token 배포, test surface를 넓히지만 핵심 session 안정성에 직접 기여하지 않았습니다.
- 영향: 이전 빌드의 `~/.codexmux/remote/codex/` 데이터는 읽지 않습니다. 새 Windows 기능은 companion 복구가 아니라 Windows-only runtime/host 전환으로 다룹니다.

## ADR-014: 세션 목록은 백그라운드 인덱스를 사용한다

- 상태: 승인
- 결정: `/api/timeline/sessions`는 요청마다 JSONL을 재귀 scan하지 않고 `SessionIndexService` snapshot을 읽습니다. Cold index refresh가 진행 중이면 현재 snapshot과 `refreshing` 상태를 즉시 반환하고, client가 짧게 재조회합니다.
- 이유: session 수가 늘어나면 request path에서 전체 JSONL parsing과 정렬이 반복되어 비용이 커집니다.
- 영향: 인덱스는 `~/.codexmux/session-index.json`에 persist하고 mtime/size가 바뀐 파일만 다시 파싱합니다. 저장 인덱스가 비어 있어도 session list request가 전체 refresh 완료를 기다리지 않습니다.

## ADR-015: approval queue metadata는 sanitized projection으로 유지한다

- 상태: 승인
- 결정: Codex permission/input prompt metadata는 live pane capture에서 계산한 non-durable projection으로 유지합니다.
- 이유: 실제 prompt source는 Codex CLI이며, codexmux가 별도 approval database를 만들면 CLI 상태와 drift가 생깁니다.
- 영향: raw command, cwd, session name, JSONL path, prompt body, assistant text, terminal output, token-like 값은 metadata/status/push payload에 넣지 않습니다.

## ADR-016: external trace forwarding은 환경 변수로 제한한 local feed만 사용한다

- 상태: 승인
- 결정: `CODEXMUX_BRIDGE_TRACE_URL`과 `CODEXMUX_BRIDGE_TRACE_TOKEN`이 설정된 경우에만 status summary를 codex-ai-bridge loopback ingress로 best-effort POST합니다.
- 이유: Discord token, channel routing, trace preference는 bridge가 소유합니다.
- 영향: 실패는 status broadcast를 막지 않습니다. payload는 summary-only shape로 제한합니다.

## ADR-017: approval audit은 sanitized action log로 제한한다

- 상태: 승인
- 결정: approval queue의 durable history는 `~/.codexmux/approval-audit.jsonl` append-only action log로 제한합니다.
- 이유: 운영자는 표시/선택/fallback 여부를 알아야 하지만 prompt 원문이나 terminal output을 장기 저장하면 안 됩니다.
- 영향: 저장 필드는 event type, workspace id, tab id, prompt/risk/approval enum, option count, selected option index, fallback reason으로 제한합니다. Web Push outcome도 `push-sent`, `push-failed`, `push-skipped-empty`, `push-skipped-visible` 같은 enum event로만 기록하며 raw push payload나 subscription endpoint는 저장하지 않습니다.

## ADR-018: lifecycle action은 allowlist와 sanitized audit으로 제한한다

- 상태: 승인
- 결정: `/experimental/runtime`에서 실행 가능한 action은 서버 allowlist id로 제한합니다. 현재 action은 `phase6-gate`, `restart-service`, `deploy-local`입니다.
- 이유: 운영 UI가 일반 원격 shell이 되면 command injection과 정보 유출 위험이 큽니다.
- 영향: 실행 기록은 sanitized failure label과 duration 중심으로 남기며 stdout/stderr, env, cwd, token, prompt, terminal output은 저장하지 않습니다.

## ADR-019: 런타임 v2 Supervisor와 worker runtime을 도입한다

- 상태: 제안, 단계적 적용 중
- 결정: public routing과 worker lifecycle, typed IPC command routing을 소유하는 Supervisor를 도입합니다.
- 이유: terminal IO, storage mutation, JSONL parsing, process polling은 명시적인 failure boundary와 ownership boundary를 가져야 합니다.
- 영향: runtime v2 API route는 direct store/helper가 아니라 Supervisor service를 호출합니다. Storage, terminal, timeline, status worker는 surface별 mode와 rollback flag를 갖습니다.

## ADR-020: 런타임 v2 app state는 SQLite를 사용한다

- 상태: 제안, 단계적 적용 중
- 결정: runtime v2 source of truth는 Storage Worker가 소유하는 `~/.codexmux/runtime-v2/state.db`입니다.
- 이유: normalized entity, transaction, invariant enforcement, indexed query, durable event log는 JSON 파일만으로 안전하게 유지하기 어렵습니다.
- 영향: legacy JSON store는 rollback과 migration fallback으로 남습니다. `better-sqlite3`는 optional dependency이며 runtime v2가 켜졌을 때만 필요합니다.

## ADR-021: worker IPC는 typed envelope를 사용한다

- 상태: 제안, 단계적 적용 중
- 결정: worker transport는 `child_process.fork` 기반 typed envelope IPC를 사용합니다.
- 이유: 별도 internal port 없이 TypeScript type/schema 재사용과 process boundary 검증을 시작하기 가장 단순합니다.
- 영향: command payload, reply payload, event payload, correlation id, timeout, structured error가 worker contract의 일부입니다.

## ADR-022: terminal byte stream은 ephemeral data다

- 상태: 제안, 단계적 적용 중
- 결정: terminal stdin/stdout/resize stream은 durable state로 저장하지 않습니다.
- 이유: terminal byte를 별도 저장하면 큰 저장 비용과 replay 복잡도가 생기지만 핵심 안정성 문제를 해결하지 못합니다.
- 영향: client는 reconnect 때 runtime adapter에 다시 attach합니다. terminal lifecycle과 status fact만 durable하게 남깁니다.

## ADR-023: Windows-only 제품 타깃

- 상태: Archived
- 결정: codexmux의 다음 제품 전환 타깃은 Windows-only service/product입니다.
- 이유: 사용자 목표는 기존 codexmux 기반을 Windows 전용 제품으로 구축하고 제공하는 것입니다.
- 영향: Windows terminal runtime, Windows process inspector, Windows service/tray host, Windows installer/update smoke가 release 기준이 됩니다. macOS/Linux/Android 문서는 legacy/reference로 유지하고, 새 기능 기준으로 확장하지 않습니다.
- 보존 이유: 2026년 Windows installer/updater와 `codexwinmux` product-line 결정의 맥락과 검증 근거를 설명합니다. 현재 제품/runtime target은 ADR-031이 대체합니다.

## ADR-024: codexwinmux는 별도 Windows 제품 line으로 분리한다

- 상태: 승인
- 결정: `codexmux` release line은 기존 package name, updater channel, app id, data dir을 보존하고, Windows 설치형 제품 마감은 별도 저장소 `codexwinmux`의 제품 line에서 진행합니다.
- 이유: `codexmux`에는 이미 `productName=codexmux`, `appId=com.hardcoremonk.codexmux`, `~/.codexmux`, GitHub updater release history가 연결되어 있습니다. 이 line을 in-place rename하면 update channel, uninstall registry, updater cache, 기존 내부 사용자의 data dir ownership이 동시에 바뀌어 rollback과 증거 추적이 어려워집니다.
- 영향: 이 저장소는 원본 기반, architecture 기준, smoke 증거를 유지합니다. `codexwinmux`는 `productName`, `appId`, data dir, release repo, updater cache를 독립적으로 소유해야 하며, `codexmux -> codexwinmux` 데이터 이동은 자동 rename이 아니라 명시적 migration/import로만 처리합니다.
- 운영 기준: 반복 release/update smoke는 `docs/operations/windows-release-update-repeat-checklist.md`를 따르고, 제품 line migration 기준은 `docs/operations/codexwinmux-product-line-migration.md`를 따릅니다.

## ADR-025: Codex CLI integration contract는 inline hook과 web-input 제출 frame으로 고정한다

- 상태: Verified
- 결정: Browser는 raw Codex command를 만들지 않고 tab-scoped launch/resume intent만 보냅니다. Server provider가 소유권과 안전한 shell, Codex `0.144.1+` compatibility를 확인한 뒤 `hooks.SessionStart`, `hooks.UserPromptSubmit`, `hooks.Stop` session override를 각각 `-c`로 조립합니다. 각 handler는 POSIX `command`와 Windows `commandWindows`로 `~/.codexmux/status-hook.cjs`를 호출하며 HMAC capability로 tab/session/expiry를 묶습니다. Codex web input은 prompt 본문을 bracketed paste로 감싸고 Enter를 같은 frame에 포함한 뒤 후속 Enter를 한 번 더 보냅니다.
- 이유: Native Codex hook layer discovery를 유지하면 user/project/managed/plugin hook을 수동 TOML merge하거나 trust bypass하지 않고 codexmux session observer를 공존시킬 수 있습니다. Server command ownership은 CLI token과 hook command가 browser bundle로 새는 경계를 없앱니다. Web input을 raw text와 별도 Enter frame으로 나누면 재접속/copy mode/긴 입력 확인 상태에서 입력이 프롬프트에 남고 제출되지 않을 수 있습니다.
- trade-off: Hook bridge는 최대 64KiB stdin, 1초 loopback 요청, 1.5초 process timeout의 non-blocking best-effort observer입니다. Electron executable도 standalone script를 실행할 수 있도록 handler는 `ELECTRON_RUN_AS_NODE=1`을 명시합니다. 실패해도 Codex action을 막지 않으며 JSONL/process polling으로 reconciliation합니다. Native hook의 사용자별 실행 순서는 codexmux가 보장하지 않습니다.
- 영향: `~/.codexmux/hooks.json`의 `hooks`는 비워 두고 statusline 호환 설정만 생성합니다. 현재 session hook transport는 standalone Node bridge이며 남아 있는 `status-hook.sh`는 legacy 잔존 파일입니다. Command builder, provider option, agent launch API, `MSG_WEB_STDIN`, hook capability를 바꾸면 `TMUX.md`, `STATUS.md`, `DATA-DIR.md`, `TESTING.md`와 landing docs를 함께 갱신합니다.
- 승인 근거: `docs/superpowers/specs/2026-08-14-purplemux-selected-adoption-design.md`, `docs/superpowers/grill-me/2026-08-14-purplemux-selected-adoption.md`, `docs/superpowers/plans/2026-08-14-purplemux-selected-adoption.md`에서 native coexistence, bounded preview, stale rate-limit, best-effort bridge, Git invalidation 정책을 승인했습니다.
- 구현 근거: `src/lib/agent-launch-service.ts`, `src/lib/providers/codex/session-hooks.ts`, `src/lib/hook-settings.ts`와 대응 unit/strict-config smoke로 server ownership과 capability 경계를 고정했습니다.
- 검증 근거: Codex 0.147.0 strict-config smoke, session hook serialization/capability test, full unit/type/build/Electron gate, Runtime v2 status/timeline smoke, browser reconnect와 실제 Linux user service 재시작이 통과했습니다. Windows package 실기 검증은 2026-08-15 사용자 결정으로 이 ADR의 완료 조건에서 제외했습니다.

## ADR-026: Pre-auth bootstrap은 loopback exposure와 explicit install admission을 사용한다

- 상태: Verified
- 결정: setup으로 시작한 process는 `HOST`와 저장된 network access보다 우선해 `127.0.0.1`에 bind합니다. Setup first claim은 startup exposure/claim latch, loopback Host, same-authority Origin, JSON request를 모두 만족할 때만 허용합니다. `/api/install`은 generic WebSocket route에서 분리하고 setup-local 또는 authenticated admission과 반복 검증되는 setup lease를 사용합니다.
- 이유: network source filter나 session 예외 하나만으로는 LAN RCE, browser CSRF/DNS rebinding, config 손상에 따른 auth downgrade, setup 완료 뒤 남은 PTY를 함께 막을 수 없습니다.
- trade-off: remote onboarding과 Origin 없는 custom install client는 지원하지 않습니다. Setup에서 선택한 direct external bind는 restart 뒤 적용됩니다. 현재 loopback trust는 user-scoped, non-elevated process와 loopback Host를 보존하는 local browser로 제한하며 Host-rewriting proxy, intentional forwarding, elevated service에는 one-time capability 또는 host-owned action이 필요합니다.
- 영향: config missing/setup/configured/invalid state를 분리하고 malformed/I/O/hash-only config는 fail closed합니다. `INIT_PASSWORD` mode의 install은 session을 요구합니다. Install PTY는 runtime terminal이 아닌 legacy infrastructure adapter로 남고 arbitrary stdin residual risk를 가집니다. Setup/config/auth/Origin 정책과 관련 test, architecture, data-dir, systemd, Windows gap 문서를 함께 갱신합니다.
- 승인 조건: implementation plan이 strict config semantics, HTTP setup CSRF defense, typed install route, atomic execution slot, setup lease, dev/prod bind smoke, rollback을 모두 포함하고 engineering review를 통과해야 합니다.
- 승인 근거: `docs/superpowers/plans/2026-07-11-pre-auth-bootstrap-security.md`의 engineering review가 config/preflight/proxy call-site, concurrent claim, typed upgrade guard, install slot/lease, dev/prod/root/Windows execution constraints를 검토하고 blocker 없이 통과했습니다.
- 검증 근거: `docs/operations/2026-07-11-pre-auth-bootstrap-security-handoff.md`에 unit/static gate, Linux development/production attack smoke, fresh artifact gate, Electron build/browser/Electron runtime smoke와 Windows fresh-runner 제한을 기록했습니다.

## ADR-027: 인증된 upload ingress는 outer custom server가 소유한다

- 상태: Verified
- 결정: `/api/upload-image`와 `/api/upload-file`의 external ingress는 Next proxy와 Pages API route보다 앞선 outer custom server가 소유합니다. Request는 upload-scoped session/CLI 인증, credential별 Origin, strict framing과 bounded admission을 통과한 뒤 same-directory staged file로 streaming합니다. Writer close 뒤 `fs.link(stage, final)`로 destination을 원자적으로 no-replace publish하고 staged link를 제거합니다.
- 이유: Next proxy의 10MiB body clone limit은 제한을 넘긴 crossing chunk 전체를 버리고 clone stream을 정상 EOF로 닫을 수 있습니다. 재현에서 11,534,336B generic body와 10,485,761B image body가 모두 10,444,800B artifact로 `200` 저장됐습니다. Global proxy cap 상향은 unauthenticated clone과 route-level full buffering의 memory amplification을 키웁니다.
- trade-off: Custom server의 HTTP 책임이 두 route만큼 커지고 direct `next dev` 또는 internal standalone port는 upload surface가 아닙니다. Session rolling refresh, same-authority Origin과 CLI-token parity를 outer handler가 명시적으로 보존해야 합니다. Content-Length 없는 chunked custom client는 지원하지 않습니다.
- 영향: Mutable admission/transaction state는 outer server instance 하나가 소유합니다. Stateless storage cleanup은 기존 authenticated cleanup API에서도 사용할 수 있지만 active staged file은 삭제하지 않습니다. `CODEXMUX_UPLOADS_DISABLED=1`은 old Pages route로 fallback하지 않고 exact upload route만 503으로 닫는 recovery mode입니다.
- 검증 조건: production audit 0건, raw HTTP framing/Expect 공격 test, exact limit과 SHA-256 parity, active cleanup/abort/shutdown race, dev/prod Chromium smoke, Electron gate와 Windows hard-link/delete/package/updater evidence가 필요합니다. Windows evidence 전에는 Implemented 상태가 될 수 있어도 Verified로 이동하지 않습니다.
- 설계 근거: `docs/superpowers/specs/2026-07-11-production-security-upload-integrity-design.md`.
- 검토 근거: `docs/superpowers/grill-me/2026-07-11-production-security-upload-integrity.md`에서 proxy cap, auth/Origin, HTTP framing, admission, cleanup, rollback과 Windows gate를 검토했습니다.
- 승인 근거: `docs/superpowers/plans/2026-07-11-production-security-upload-integrity.md`의 독립 engineering review가 shutdown/Expect/quarantine/upgrade, Node timeout, maintenance, auth failure, memory oracle, Windows native storage gate와 TDD 실행 순서를 blocker 없이 통과했습니다.
- 구현 근거: `docs/operations/2026-07-11-production-security-upload-integrity-handoff.md`에 dependency audit, Linux dev/prod upload, memory, browser, Electron 증거와 당시 pending Windows boundary를 기록했습니다.
- 검증 근거: `v0.4.20` fresh Windows workflow에서 exact size/SHA, same-directory publish, reserved stage 관찰·삭제, aged stage cleanup, committed `.part` 보존과 kill switch 격리를 포함한 upload/package/release gate가 최초 통과했습니다. `v0.4.21`에서 같은 package gate와 artifact privacy gate를 재검증했고, `v0.4.22` [workflow run 29219010240 attempt 3](https://github.com/HardcoreMonk/codexmux/actions/runs/29219010240)에서 package gate `394584ms`, packaged upload integrity `11724ms`와 독립 privacy scan 16개 JSON을 다시 통과했습니다. 상세 결과는 `docs/operations/2026-07-12-v0.4.20-windows-release-handoff.md`, `docs/operations/2026-07-12-v0.4.21-windows-release-handoff.md`, `docs/operations/2026-07-13-v0.4.22-windows-release-handoff.md`와 [GitHub issue #16](https://github.com/HardcoreMonk/codexmux/issues/16)에 보존합니다.

## ADR-028: Windows stable release는 published updater 검증 뒤 승격한다

- 상태: Verified
- 결정: Tag workflow는 고정된 직전 stable installer와 SHA-256을 사용해 fresh Windows package/release gate를 실행합니다. 통과한 정확한 네 자산만 prerelease로 게시하고, 같은 target tag의 published channel과 실제 baseline install `quitAndInstall` 검증, evidence artifact privacy scan이 통과한 뒤 stable/latest로 승격합니다.
- 이유: Windows package를 만들지 않는 Linux/macOS 중심 workflow와 존재하지 않는 npm package publish를 stable release 선행 조건으로 두면 Windows-only 제품 목표를 검증하지 못하면서 릴리스는 반복 실패합니다. 반대로 asset 게시 직후 stable로 노출하면 published updater apply 실패를 rollback 전에 사용자가 받을 수 있습니다.
- trade-off: Prerelease 게시 뒤 실패한 candidate는 prerelease로 남습니다. 게시 전 실패는 Release와 asset을 만들지 않습니다. 다음 release마다 baseline tag/version/SHA-256 pin을 갱신해야 하며 tag workflow는 저장소 전체에서 직렬 실행됩니다. npm 최초 publish와 legacy macOS package는 별도 작업으로 관리합니다.
- 영향: Release runner는 pinned action/toolchain과 Codex CLI를 사용합니다. GitHub token은 asset 조회 단계에만 노출하고 packaged/updater child environment에서는 제거합니다. Non-Windows skip과 synthetic local feed는 acceptance가 아니며, exact target tag가 없거나 asset set이 다르면 fail closed합니다. Browser/package/published-updater artifact에 금지 key, URL, session/temp path 또는 terminal escape가 남아도 upload와 promotion을 중단합니다. Stable promotion 전후에 release 상태와 installer/blockmap/zip/`latest.yml` 네 자산을 확인합니다.
- 검증 조건: GitHub Actions fresh Windows candidate에서 package/release gate가 통과하고, prerelease asset을 사용한 published channel/install smoke가 baseline version에서 target version으로 실제 적용되며, evidence artifact privacy scan과 stable promotion/asset 재검증이 통과해야 `Verified`로 전이합니다.
- 검증 근거: [workflow run 29161183240](https://github.com/HardcoreMonk/codexmux/actions/runs/29161183240)에서 `v0.4.20` 기능 경로를 최초 검증했습니다. 후속 artifact 재감사에서 published-updater JSON 2개를 privacy-safe evidence에서 제외한 뒤 sanitizer와 fail-closed scanner를 추가했고, [workflow run 29162818458](https://github.com/HardcoreMonk/codexmux/actions/runs/29162818458)에서 `v0.4.20` baseline을 사용한 `v0.4.21` gate와 stable 승격을 재검증했습니다. 현재 stable `v0.4.22`는 [workflow run 29219010240 attempt 3](https://github.com/HardcoreMonk/codexmux/actions/runs/29219010240)에서 실제 `v0.4.21` baseline installer와 SHA-256 `0e54fafe6465474e0092228a128755fdb04eba3698d8f2daf00327ad7bb24aaa`를 사용해 package `394584ms`, local updater `240046ms`, release gate `17878ms`, published updater `254840ms`, 독립 privacy scan 16개 JSON, stable/latest 승격과 네 자산 재검증을 순서대로 통과했습니다. Tag commit은 `4af022090aa74ef3b2d7a01c9a8fd5bfe504f89a`입니다. 상세 증거는 각 Windows release handoff에 기록합니다.
- 운영 기준: 반복 release는 `docs/operations/windows-release-update-repeat-checklist.md`를 따릅니다. [Issue #16](https://github.com/HardcoreMonk/codexmux/issues/16)은 최초 기능 검증과 privacy-safe 반복 검증의 완료 조건과 증거를 보존합니다. 현재 기준 handoff는 `docs/operations/2026-07-13-v0.4.22-windows-release-handoff.md`입니다.

## ADR-029: 브라우저 세션 쿠키는 제품별 namespace를 사용한다

- 상태: Implemented
- 결정: Codexmux의 브라우저 세션 쿠키 이름은 `codexmux-session-token`으로 고정합니다. Login, rolling refresh, logout, SSR/API, generic/runtime v2 WebSocket, install과 upload 인증은 공통 `SESSION_COOKIE`만 읽고 생성하거나 삭제합니다. Legacy `session-token`은 인증 fallback이나 migration 대상으로 읽거나 지우지 않으며 credential query denylist에는 계속 남깁니다.
- 이유: Browser cookie scope는 port를 구분하지 않습니다. Codexmux와 Purplemux가 같은 hostname의 서로 다른 port에서 공통 `session-token; Path=/`을 사용하면 마지막 로그인 또는 refresh가 다른 제품의 JWT를 덮어쓰고, 서로 다른 secret 때문에 HTTP `401`과 WebSocket reconnect 실패가 발생합니다.
- trade-off: 이 변경이 포함된 build로 처음 전환할 때 기존 Codexmux browser/Electron session은 한 번 다시 로그인해야 합니다. 전환 직전 legacy cookie가 Codexmux JWT였다면 Purplemux도 한 번 다시 로그인해 자기 cookie를 복구해야 합니다. Legacy cookie fallback, dual-write, logout clear는 Purplemux session을 다시 덮어쓰거나 삭제하므로 제공하지 않습니다. 구버전으로 downgrade하면 재로그인이 필요하고 동일 충돌이 다시 발생할 수 있습니다.
- 영향: `~/.codexmux/`, tmux/runtime session, 비밀번호와 `authSecret`, CLI `x-cmux-token` 계약은 바뀌지 않습니다. 같은 hostname의 browser request에는 두 제품 cookie가 함께 실릴 수 있지만 각 제품은 자기 namespace만 검증합니다. Cookie 기밀성까지 port별로 격리하는 결정은 아니며, 그 수준이 필요하면 별도 hostname을 사용해야 합니다.
- 검증 조건: unit test에서 새 이름과 legacy-only 거부, 두 cookie 공존 시 Codexmux cookie 선택, HTTP/Runtime v2 WebSocket/install/upload fixture, 새·legacy query credential 거부를 확인합니다. Chromium reconnect smoke는 Codexmux cookie를 설정한 뒤 같은 hostname에 legacy `session-token`을 추가하고 page auth와 WebSocket 복구가 유지되는지 검증합니다.
- 검증 근거: Linux에서 full unit suite, lint, typecheck, production/landing build, dev/prod pre-auth bootstrap과 upload integrity smoke, Chromium same-host cookie coexistence/reconnect smoke가 통과했습니다. `v0.4.22` Windows release는 fresh HOME/profile에서 `v0.4.21 -> v0.4.22` local/published updater apply와 post-update packaged launch를 통과했습니다. 다만 fresh profile은 기존 Electron storage의 legacy cookie가 새 namespace 전환 뒤 login으로 이동하고, 1회 재로그인 후 Runtime v2 WebSocket/upload에 다시 연결되는 실제 old-profile 경로를 증명하지 않습니다. 따라서 상태는 `Implemented`로 유지하며 old Electron profile 수동/자동 증거를 확보한 뒤 `Verified`로 전이합니다. 상세 결과는 `docs/operations/2026-07-12-purplemux-cookie-isolation-handoff.md`와 `docs/operations/2026-07-13-v0.4.22-windows-release-handoff.md`에 기록합니다.
- 2026-11-09 갱신: 발급 cookie 이름을 `agentmux-session-token`으로 바꾸고 `codexmux-session-token`은 읽기만 유지(logout 시에만 삭제). `session-token`은 계속 읽지 않는다(ADR-033).

## ADR-030: Windows installer와 npm 실행 package를 독립 배포면으로 운영한다

- 상태: Verified
- 결정: Windows Electron installer는 primary distribution으로 유지하고, npm의 unscoped `codexmux` package는 legacy tmux 기반 custom Node web server의 secondary execution surface로 공개합니다. npm package는 `codexmux`/`cmux` bin만 지원하며 library `main`, Electron/Capacitor shell, NSIS/service install, updater를 제공하지 않습니다.
- 이유: `npx`는 package를 npm cache에 설치해 bin을 실행하는 도구이므로 Windows 설치 프로그램과 같은 lifecycle을 제공할 수 없습니다. 두 surface를 한 release gate로 묶으면 npm registry나 OIDC 장애가 검증된 Windows stable promotion을 막거나, 반대로 Windows package 실패 전에 npm version이 공개되는 ownership 혼선을 만듭니다.
- trade-off: 같은 source version이 GitHub Windows release와 npm registry에서 서로 다른 시점에 공개될 수 있습니다. npm 사용자는 Node `>=20.9.0`과 legacy tmux runtime을 직접 준비해야 하며 desktop updater/제거 기능을 받지 않습니다. Landing은 registry package의 install, bin, health smoke가 통과한 뒤에만 npm 명령을 활성화합니다.
- 영향: npm tarball은 `bin/`, `dist/`, `.next/standalone/`, tmux config와 postinstall helper만 명시적으로 게시합니다. Capacitor/Electron build package는 dev dependency로 유지합니다. 후속 tag publish는 별도 `npm-publish.yml`의 GitHub Actions Trusted Publishing을 사용하며 장기 `NPM_TOKEN`을 두지 않습니다. npm publish 실패는 `.github/workflows/release.yml`의 Windows stable workflow와 독립입니다.
- 승인 근거: `docs/superpowers/specs/2026-08-20-npm-npx-distribution-design.md`, `docs/superpowers/grill-me/2026-08-20-npm-npx-distribution.md`, `docs/superpowers/plans/2026-08-20-npm-npx-distribution.md`에서 사용자 1~7 전체 승인, package/runtime ownership, 공급망, landing activation 조건을 검토했습니다.
- 구현 근거: CLI-only manifest, postinstall allowlist, build-only dependency 분리, local tarball install/run smoke와 `.github/workflows/npm-publish.yml`의 OIDC/idempotency contract를 구현했습니다. Next `16.3.1`, sharp `0.35.3`, PostCSS `8.5.23`, nanoid `5.1.16`으로 public package dependency audit를 0건으로 복구했습니다.
- 검증 조건: local tarball의 lifecycle-enabled install, CLI help, isolated production health가 통과하고, 최초 public publish 뒤 exact registry version을 같은 방식으로 실행해야 `Verified`로 전이합니다.
- 검증 근거: `codexmux@0.4.23`을 release commit `ef27e2971f04d828cf0f1281581ae7e7eb1d1072`에서 최초 public publish했습니다. Registry `gitHead`와 integrity를 확인하고, 저장소 밖 격리 환경에서 registry package의 CLI help와 production `/api/health` `200`, `version=0.4.23`, `commit=ef27e297`을 검증했습니다. 상세 결과는 `docs/operations/2026-08-20-npm-npx-distribution-handoff.md`에 기록합니다.
- 현재 해석: ADR-031이 active runtime을 Linux 단일 엔진으로 변경했으므로 npm server는 더
  이상 legacy secondary runtime이 아닙니다. Windows installer와 npm package가 독립
  배포면이라는 핵심 결정은 유지하되 Linux engine acceptance는 npm/source/systemd 경로를
  기준으로 합니다.
- 2026-08-22 release cadence 결정: 연속 개발 중에는 npm version, remote tag, GitHub Release와
  Trusted Publisher를 변경하지 않습니다. 최종 개발 완료가 명시적으로 확정된 뒤 현재 main을
  기준으로 version과 release note를 함께 고정하고, 전체 release gate를 통과한 한 번의 npm
  갱신으로 처리합니다. 이미 게시된 `0.4.23`과 local tag는 이동하거나 덮어쓰지 않습니다.
- 2026-08-22 release gate 실행: 사용자가 `0.4.24` package version, registry publish, commit/push와
  Linux live deploy/restart를 명시적으로 승인했습니다. Remote tag와 GitHub Windows Release는
  독립 배포면이므로 이번 실행에서 만들지 않습니다.
- 2026-11-09 갱신: 공개 npm package 이름을 `@hardcoremonk/agentmux`로 변경하고 `bin`에 `agentmux`/`amux`와 호환 alias `codexmux`/`cmux`를 함께 등록한다(ADR-033).

## ADR-031: Linux 단일 엔진 호스트를 active product/runtime target으로 사용한다

- 상태: Verified
- 결정: codexmux의 active product/runtime target을 Linux 단일 엔진 호스트로 고정합니다. 한 Linux host가 custom server, Runtime v2 worker, tmux, Codex CLI와 JSONL, app-owned DB, 등록된 project filesystem을 소유합니다. Browser와 선택 Electron client는 이 host에 접속하지만 session source, worker 또는 project writer가 되지 않습니다.
- 이유: Session Operations와 Project Governance를 기존 Timeline, Status, Storage worker 경계에 통합하려면 JSONL watch, SQLite single-writer, canonical Linux path, mount와 symlink containment를 한 engine authority에서 보장해야 합니다. Windows-only target은 이 통합의 실제 운영 환경과 맞지 않습니다.
- trade-off: 기존 Windows package와 updater parity는 새 기능 release gate가 아니며 remote node, collector, multi-engine federation은 지원하지 않습니다. Linux host가 단일 장애 지점이므로 worker별 degraded mode, projection rebuild, state backup과 systemd user service 절차가 필요합니다.
- 영향: Timeline Worker는 Session Catalog raw JSONL read/watch와 index DB를, Storage Worker는
  durable app state를, Governance Worker는 registered project read, Knowledge Index와 ADR-032의
  governed scaffold write를 단독 소유합니다. Next API는 DB나 project filesystem을 직접 열지
  않습니다. Windows release 증거와 ADR-030의 독립 배포면 결정은 삭제하거나 Linux
  acceptance로 재해석하지 않습니다.
- 승인 근거: `docs/superpowers/specs/2026-08-21-session-operations-governance-integration-design.md`, `docs/superpowers/grill-me/2026-08-21-session-operations-governance-integration.md`, `docs/superpowers/plans/2026-08-21-session-operations-governance-integration.md`.
- 구현 근거: Runtime v2에 Governance Worker와 Session Catalog ownership을 추가하고 Storage
  Worker에 session annotation/filter와 Approved Project Root/Managed Project durable state를
  배치했습니다. 초기 read-only API/UI와 metadata-only Knowledge Index 위에 ADR-032의 gated
  scaffold transaction을 확장했습니다.
- 검증 조건: 전체 unit/type/lint/build, Runtime v2 core/backup/Phase 6 gate, 5,000-session performance, isolated Linux rollback, 한국어/영어 browser와 npm tarball smoke를 통과하고 운영 handoff를 남깁니다. 실제 user service restart와 장시간 관찰 근거를 확보하기 전에는 `Verified`로 전이하지 않습니다.
- 운영 근거: 구현 commit `d405f683`을 port `8122`의 Linux `systemd --user` service로
  배포했습니다. Browser 인증 설정 뒤 unit을 `HOST=0.0.0.0`으로 재시작해 실제
  `0.0.0.0:8122` listener를 확인했습니다. 최초 기동과 실제 restart 전후에 live terminal
  smoke, Runtime v2 Phase 6 12-check gate, worker/private DB health를 통과했고
  [Issue #18](https://github.com/HardcoreMonk/codexmux/issues/18)을 완료했습니다. 2026-08-22에는
  같은 live workspace/session에 301초 동안 11회 새 WebSocket으로 재연결하고 매 회
  Storage, Terminal, Timeline, Status, Governance와 Session Catalog health를 확인했습니다.
  관찰 전후 Runtime v2 10-check와 종료 직후 Phase 6 12-check도 통과해 장시간 관찰 조건을
  충족했으므로 `Verified`로 전이합니다. 상세 증거는
  `docs/operations/2026-08-21-session-operations-governance-integration-handoff.md`와
  `docs/operations/2026-08-22-live-verification-maintenance-handoff.md`에 있습니다.

## ADR-032: Project file 변경은 Governance Action Run으로만 수행한다

- 상태: Verified
- 결정: Project Governance의 project filesystem 변경은 Governance Worker가 소유하는
  `GovernanceActionRun`의 preview, exact confirmation, staged publish, backup, compensation과
  startup recovery 경로로만 수행합니다. Versioned template catalog의 신규 file 생성,
  `MarkerOwnedBlock` 갱신과 artifact별 명시적 append-only adoption만 허용하며 arbitrary
  overwrite, delete, move와 full sync를 허용하지 않습니다. Next API route와 browser는 project
  path나 rendered file content를 조립하지 않습니다.
- 이유: Managed Project 문서 변경은 승인 root containment, symlink/mount 방어, stale write
  차단과 crash recovery를 하나의 authority에서 보장해야 합니다. 독립 API route, shell
  script 또는 browser가 write를 나눠 소유하면 preview와 실제 publish 사이의 정책이
  달라지고 partial write를 일관되게 복구할 수 없습니다.
- trade-off: 여러 file을 포함한 action은 filesystem 수준의 단일 atomic transaction이
  아니므로 durable journal과 compensating rollback이 필요합니다. Project별 writer lock은
  codexmux action을 직렬화하지만 외부 editor를 잠그지 않으므로 confirm 직전 fingerprint
  재검증, current output fingerprint가 일치하는 rollback 조건과 명시적 stale conflict가
  필요합니다. Backup은 자동 삭제하지 않아 local disk와 민감 문서 preimage가 누적될 수
  있습니다.
- 영향: Governance Worker는 기존 read-only Knowledge Index reader에서 유일한 governed
  project writer로 확장됩니다. Recovery data는
  `~/.codexmux/backups/governance-actions/<project-id>/<action-id>/`에 `0700/0600` mode로
  저장합니다. Write command는 `CODEXMUX_GOVERNANCE_WRITES=1` feature gate가 있을 때만
  활성화하며 gate off에서도 pending recovery는 먼저 수행합니다. Knowledge Index는 write
  성공 뒤 refresh되는 projection이며 refresh 실패를 project write 실패로 재해석하지
  않습니다.
- 승인 근거: 사용자가
  `docs/superpowers/specs/2026-08-21-governed-project-scaffold-design.md`의 action 단위,
  template authority, artifact catalog, backup/restore, architecture, UI/security와
  verification/release 설계를 순차 승인했습니다. Domain language와 별도 ADR 생성도
  승인했습니다.
- 구현 조건: Plan Grilling, design review, Spec Freeze Snapshot, implementation plan과
  engineering review를 통과한 뒤 TDD로 구현합니다. Preview token TTL은 10분이며 action은
  한 Managed Project의 선택된 artifact 묶음으로 제한합니다.
- 승인 근거 추가: `docs/superpowers/grill-me/2026-08-21-governed-project-scaffold.md`,
  `docs/superpowers/reviews/2026-08-21-governed-project-scaffold-design-review.md`,
  `docs/superpowers/plans/2026-08-21-governed-project-scaffold.md`,
  `docs/superpowers/reviews/2026-08-21-governed-project-scaffold-eng-review.md`에서 외부 writer,
  crash rollback, marker migration, 기존 unmarked file, UI state, startup recovery와 private
  manifest/public audit 경계를 검토했습니다.
- 검증 조건: marker/no-clobber, stale preview, 중간 publish failure, startup recovery,
  rollback stale, symlink/nested mount/root escape, API auth/audit, 한국어·영어 browser와 실제
  임시 Linux project create/update/rollback smoke를 통과해야 합니다. Live gate 활성화와 실제
  Managed Project confirm은 각각 별도 운영 승인을 받습니다.
- 운영 근거: 구현 commit `a8b2a299`과 private Runtime v2 backup hardening commit `9d32d049`를
  Linux user service에 배포하고 `CODEXMUX_GOVERNANCE_WRITES=1` drop-in을 활성화했습니다.
  Governance `writeState=ready`, scaffold 7-check, Linux 10-check, 한국어/영어 browser와
  post-restart Phase 6 12-check gate를 통과했습니다. 당시 등록 Managed Project가 0개라 실제
  project confirm은 수행하지 않았으며 Issue #19와 governed scaffold 운영 handoff에 근거를 남겼습니다.
- 구현 근거: versioned template/marker, preview token, contained path policy, private journal/backup,
  compensating transaction/startup recovery, Runtime v2 IPC/Supervisor, authenticated Pages API와
  한국어·영어 UI를 구현했습니다. `corepack pnpm smoke:governance:scaffold`의 격리 Linux
  create/update/rollback 및 private mode 검증을 통과했습니다. 최초 source release 시점에는 live
  write gate를 활성화하지 않았고, 이후 위 운영 근거의 승인된 배포에서 gate를 활성화했습니다.
  실제 운영 project 확인 뒤에만 `Verified` 전이를 검토합니다.
- 2026-08-21 확장 근거: 기존 unmarked UTF-8 regular file은 첫 preview에서 confirm 불가
  `adoption-available`로만 발견하고, artifact별 `Adoption Selection`을 반영한 새 preview에서만
  `adopt` operation과 diff를 만듭니다. 신규 문서와 별도 marker ID/version을 가진 compact
  `Adoption Template Variant`를 EOF에 append하며 기존 bytes를 exact prefix로 보존합니다.
  NUL, invalid UTF-8와 marker-like CODEXMUX comment는 fail closed입니다. Public operation의
  `adopt`는 기존 manifest v1 호환성을 위해 durable journal에서 `marker-update`로 정규화하고
  exact preimage, output fingerprint, latest-first rollback 규칙을 그대로 재사용합니다. Backup은
  recovery/rollback dependency 때문에 자동 prune하지 않습니다.
- 확장 승인 근거: `docs/superpowers/specs/2026-08-21-governed-unmarked-adoption-design.md`,
  `docs/superpowers/grill-me/2026-08-21-governed-unmarked-adoption.md`, design/engineering review와
  implementation plan에서 append-only, 2-pass UI, semantic warning, durable compatibility와
  latest-first rollback 경계를 확정했습니다. 이 확장은 기존 ADR-032 경계 안의 operation이므로
  새 ADR을 만들지 않습니다.
- 확장 운영 근거: 구현 commit `f46410b4`를 Linux user service에 배포했습니다. 재시작 전
  `runtime-v2-storage-20260821T123122Z`에 DB/WAL/SHM과 workspace state 5개를 `0700/0600`으로
  backup했고, PID `1104868`에서 `1149564`로 재기동했습니다. `0.0.0.0:8122`, Governance
  `writeState=ready`, live Phase 6 12-check와 production scaffold 13-check, 한국어/영어 browser
  4-check를 통과했습니다. 등록 Managed Project가 없어 실제 project confirm은 수행하지 않았고
  [Issue #20](https://github.com/HardcoreMonk/codexmux/issues/20)에 근거를 남깁니다.
- 실제 project 검증 근거: 2026-08-22 live service에 Approved Project Root
  `/data/projects/codex-zone`와 Managed Project `codexmux`를 등록했습니다. 기존 unmarked
  `AGENTS.md`를 첫 preview에서 `adoption-available`로 확인하고 artifact를 명시 선택한 두 번째
  preview에서 `adopt` operation을 생성했습니다. Action
  `action-c4fbd533-292d-4c9e-9823-9201e3606a0d`을 exact confirmation으로 commit한 뒤
  latest-first rollback했습니다. Rollback 뒤 SHA-256은 원본과 같고 Git status는 clean이며
  private manifest/preimage mode는 모두 `0600`입니다. 격리 smoke와 live gate 외에 실제 등록
  project의 preview/confirm/rollback 조건까지 충족했으므로 `Verified`로 전이합니다. 상세
  증거는 `docs/operations/2026-08-22-live-verification-maintenance-handoff.md`에 있습니다.
- 2026-08-23 운영 확장 근거: 등록 project의 lifecycle evidence 235개가 기존 typed IPC maximum
  200개를 넘어 read API가 fail closed하는 것을 release preflight에서 발견했습니다. Project
  document response와 같은 maximum 2,000개로 bounded contract를 정렬하고 2,001개 거부 test를
  추가했습니다. Build `a6a49588` 배포 뒤 새 operations handoff를 포함한 236 evidence가 HTTP 200으로
  응답하고 Governance `writeState=ready`, Phase 6 12-check를 통과했습니다. Durable schema와
  Governance Action Run write semantics는 바꾸지 않으므로 ADR-032의 결정 경계는 유지합니다.

## ADR-033: 제품 이름을 agentmux로 바꾸고 legacy 식별자는 호환 alias로 유지한다

- 상태: Draft
- 결정: 제품 표시 이름을 `agentmux`로, 제품 정의를 "코딩 에이전트 웹 세션 매니저 (현재 Codex 지원, Claude Code 지원 예정)"으로 바꾸고 공개 npm package는 `@hardcoremonk/agentmux`로 전환합니다. CLI bin은 `agentmux`/`amux`를 기본으로 두고 legacy `codexmux`/`cmux`도 같은 진입점으로 유지합니다. 환경변수는 `AGENTMUX_*`/`AMUX_*`를 우선 읽고 `CODEXMUX_*`/`CMUX_*`를 시작 시 양방향 이중화하며, 브라우저 세션 쿠키는 `agentmux-session-token`을 발급하되 `codexmux-session-token`을 읽기 후보로 유지하고 logout 시 두 쿠키를 함께 삭제합니다(`session-token`은 계속 거부). CLI 토큰 헤더는 `x-agentmux-token`을 발신하고 `x-cmux-token`도 수용합니다. Data directory는 이번 release에서 실제 데이터를 이동하지 않고 `legacy-only` 환경에서 `~/.agentmux` → `.codexmux` 상대 symlink 별칭만 생성하며, 모든 모듈은 별칭 한 단계만 해석한 실제 경로를 받습니다(두 실제 디렉터리 공존·비정상 symlink는 fail closed). Linux systemd user service unit은 `agentmux.service`를 사용하고 `/api/health`는 구버전 `lock.ts` 호환을 위해 `app: 'codexmux'`를 유지하면서 `product: 'agentmux'`를 함께 반환합니다. tmux socket(`codexmux`, `codexmux-runtime-v2`), `globalThis` key(`__pt*`, `__codexmux*`, `__cmux*`), session prefix(`pt-ws-`), Android `appId`(`com.hardcoremonk.codexmux`), Electron `appId`/`productName`/userData, governance scaffold marker(`<!-- BEGIN/END CODEXMUX:<id>:v<n> -->`), governance template 본문(`## Codexmux Managed …`), `.codexmux-stage-` 접두사, 내부 env(`__CMUX_PRISTINE_ENV`, `__CMUX_APP_DIR`)는 보존합니다.
- 이유: 향후 Claude Code provider 지원을 앞두고 Codex 전용 제품명이 제품 정체성과 맞지 않으며, 전환과 rollback 과정에서 실행 중인 세션·로그인·기존 스크립트·governance journal/upload 무결성이 끊기지 않아야 합니다.
- trade-off: 새·옛 환경변수, 쿠키, 헤더, CLI bin, data directory 별칭을 병행 유지하는 호환 비용이 발생합니다. 실제 data directory를 `~/.agentmux`로 물리 이전하고 legacy 호환을 제거하는 시점은 rollback 창 종료 뒤 별도 설계와 ADR로 결정해야 합니다.
- 영향: `src/lib/app-identity.ts`, `src/lib/legacy-env.ts`, `src/lib/auth.ts`, `src/lib/cli-token.ts`, `bin/agentmux.js`가 제품 정체성과 호환 경계를 소유합니다. 현재 문서·UI·i18n·landing site는 `scripts/check-product-name.mjs` gate로 검사하고 과거 운영·설계 기록은 수정하지 않습니다.
- 검증 조건: `app-identity`, `legacy-env`, cookie/CLI header 호환, lock/health, `check:product-name`, `smoke:npm-package`가 모두 통과하고, 격리 환경 전환·rollback 리허설과 live service 전환 후 재로그인 없는 접속·upload·Governance `writeState=ready`를 확인한 뒤 상태를 갱신합니다.
- 검증 근거: `feat/agentmux-rename` 브랜치에서 `app-identity`·`legacy-env`·auth/header·CLI·lock 단위 테스트와 전체 unit suite(279 files), `smoke:npm-package`(`@hardcoremonk/agentmux` tarball 설치 및 `/api/health` 검증)를 통과했습니다(2026-11-09, release 확인 후 갱신 예정).

## ADR-034: tmux 서버는 systemd 아래에서 web service와 별도 scope로 실행한다

- 상태: Draft
- 결정: Production systemd user service(`INVOCATION_ID` 존재 및 `NODE_ENV=production`, `AGENTMUX_TMUX_SCOPE=off`로 비활성화 가능)에서 tmux 서버(`codexmux`, `codexmux-runtime-v2` 두 socket)를 `busctl --user call ... StartTransientUnit`을 통해 socket별 `agentmux-tmux-<socket>.scope`로 편입하고 `/proc/<pid>/cgroup` polling으로 이동을 확인합니다. `busctl` 부재·실패 시에는 경고만 남기고 세션 생성과 서버 기동을 막지 않습니다. 첫 live 전환 시에는 `scripts/adopt-tmux-server-scope.ts`로 기존 `codexmux.service` cgroup 안의 tmux 서버를 먼저 scope로 편입합니다.
- 이유: systemd 기본 `KillMode=control-group`에서는 web service를 중지하거나 재시작할 때 같은 cgroup에 속한 tmux 서버 프로세스가 함께 종료되어 실행 중인 터미널과 Codex 세션이 끊깁니다.
- trade-off: Web service를 중지해도 tmux 서버와 세션은 `agentmux-tmux-<socket>.scope`에 계속 살아남으므로, 의도적으로 모든 터미널을 종료하려면 `tmux -L <socket> kill-server` 또는 `systemctl --user stop agentmux-tmux-<socket>.scope`를 별도로 실행해야 합니다.
- 영향: `agentmux.service` stop/restart가 터미널과 Codex 프로세스를 끊지 않으며, `server.ts` startup과 legacy/Runtime v2 세션 생성 경로가 scope 편입을 보장합니다. 또한 web service 재시작 때 이미 살아 있던 세션의 shell 프롬프트에 `codex resume`이 중복 입력되지 않도록, 자동 재개(`autoResumeOnStartup`)는 startup 시점에 존재하지 않아 새로 생성한 tmux 세션에만 전송합니다.
- 검증 조건: 단위 테스트(deps 주입)와 `smoke:tmux-scope` 격리 리허설(transient service 안에서 시작된 tmux 서버를 scope로 편입한 뒤 원래 service를 stop해도 tmux 서버 PID·세션이 생존하고 scope가 `active` 상태를 유지)이 통과해야 하며, 실제 live 전환과 재시작 후 PID 불변 확인 뒤 상태를 갱신합니다.
- 검증 근거: `tests/unit/lib/tmux-server-scope.test.ts`, `tests/unit/lib/auto-resume.test.ts` 및 `corepack pnpm smoke:tmux-scope` 실측 리허설에서 service stop 전후 tmux 서버·pane PID 생존과 `agentmux-tmux-<socket>.scope` `active` 상태를 확인했습니다(2026-11-09, release 확인 후 갱신 예정).

## ADR-035: 사용자 agent 설정은 고치지 않고 실행 시점 flag와 탭 환경 변수로만 붙인다

- 상태: Accepted (2026-11-11)
- 결정: agentmux는 `~/.claude/`, `~/.claude.json`, `$CODEX_HOME`(기본 `~/.codex/`) 아래 사용자 설정 파일과 project `.codex/config.toml`을 읽기만 하고 쓰거나 지우지 않습니다. Hook, 위임 안내, 허용 규칙은 agentmux가 띄운 agent의 실행 명령에만 붙입니다. Claude Code는 `--settings <dataDir>/claude-tabs/<tab-id>.json`과 `--append-system-prompt-file <dataDir>/delegation/claude.md`, Codex는 `-c` override(`hooks`, `developer_instructions`)를 사용하고, 두 agent 모두 탭 환경 변수(`AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, `<dataDir>/bin`을 앞에 붙인 `PATH`)를 받습니다. Workspace id와 탭 id는 안내 문장에 넣지 않고 환경 변수로만 전달합니다(Claude 재개 시 system prompt snapshot이 옛 id를 고정하기 때문). Codex 사용자 `developer_instructions`가 있으면 그 값을 안내 앞에 보존하고, 값이 여럿이거나 TOML을 읽지 못하거나 project `.codex/config.toml`이 값을 정의하거나 cwd를 모르거나 명령이 12,288 byte를 넘으면 안내를 넣지 않고 log warn만 남깁니다. Project 값은 복사하지 않습니다. Codex는 신뢰한 project의 config만 읽으므로 복사하면 사용자의 trust 거절을 우회하게 됩니다. 설정 `agentDelegationGuideEnabled`(기본 켬)를 끄면 실행 명령은 이전과 byte 단위로 같습니다.
- 이유: 사용자 설정 파일을 고치면 agentmux 밖에서 돈 agent(터미널 직접 실행, 다른 multiplexer)까지 영향을 받고, 제거와 rollback이 어렵고, 사용자가 직접 쓴 값과 충돌합니다. 실행 시점 flag는 agentmux 탭에서만 유효하고 탭을 닫으면 사라집니다.
- trade-off: 명령이 길어지고 Codex 안내는 조건이 맞을 때만 들어갑니다. Codex `shell_environment_policy`가 `inherit = "core"`/`"none"`이면 환경 변수가 Codex shell에 닿지 않아 CLI가 호출 탭을 모릅니다(사용자가 직접 실행한 CLI처럼 동작).
- 영향: `src/lib/delegation-guide.ts`, `src/lib/codex-command.ts`, Claude/Codex provider 실행 명령 조립, `docs/CLI.md`.
- 검증 조건: 설정을 끄면 실행 명령이 이전과 byte 단위로 같고, 사용자 설정 파일 hash가 실행 전후 같으며, 환경 변수와 flag가 agentmux 실행 명령에만 붙어야 합니다.

## ADR-036: 위임은 확인 없이 진행하고 신뢰 경계는 Unix 사용자로 둔다

- 상태: Accepted (2026-11-11)
- 결정: agentmux가 띄운 Claude Code는 `claude-tabs/<tab-id>.json`의 `permissions.allow`로 `agentmux tab`의 하위 명령 6개(`list`, `create`, `send`, `status`, `result`, `close`)를 확인 없이 실행합니다. 규칙은 `Bash(agentmux tab list:*)` 형태이며 `tab browser`(특히 `eval`)와 `agentmux` 전체는 허용하지 않습니다. 신뢰 경계는 CLI token을 읽을 수 있는 Unix 사용자입니다. CLI의 위임 제한(호출 탭 header `x-agentmux-caller-tab`이 있을 때 적용)은 agent의 실수를 막는 장치이고 보안 경계가 아닙니다. 제한은 다음과 같습니다: workspace당 agent가 만든 탭 6개(409 `delegation-limit`), 입력이 필요한 agent 탭에는 `tab send` 거절(409 `target-needs-input`), 준비되지 않은 탭에는 거절(409 `target-not-ready`), agent 탭에만 보내기(403 `delegation-send-forbidden`), 호출 탭이 만든 탭만 닫기(403 `delegation-close-forbidden`). CLI는 권한 요청 화면이나 시작 화면에 글자를 보내지 않으며 사용자 대신 승인하거나 거절하지 않습니다. CLI token 범위는 바꾸지 않습니다.
- 이유: 위임할 때마다 사용자 확인을 요구하면 agent가 agent에게 일을 맡기는 흐름이 끊깁니다. 한편 같은 Unix 사용자는 token 파일과 tmux 입력을 이미 직접 다룰 수 있으므로 CLI 제한을 우회 불가능한 경계로 설명하면 오해를 만듭니다.
- trade-off: 위임 제한은 의도적 우회를 막지 못합니다. 사용자 승인 없이 위임 탭이 최대 6개까지 만들어질 수 있습니다. 위임 입력(`tab send`)은 agent 탭(`claude`, `codex`)에만 닿고, 각 agent 탭은 그 agent의 자체 권한 설정을 따릅니다. Agent 호출은 terminal 탭에 입력할 수 없습니다(403 `delegation-send-forbidden`). 미리 허용된 `tab send`가 shell에 닿으면 agent 자신의 명령 승인(Claude Code의 Bash 권한 확인)을 건너뛰고 shell 명령을 실행하게 되기 때문입니다(사용자 결정 2026-11-11). `tab create -t terminal`은 보내기 없이 무해하므로 그대로 둡니다. 호출 탭이 없는 요청(사람이 실행한 CLI)은 terminal 탭에 그대로 입력합니다.
- 영향: `src/lib/delegation-guide.ts`, tab API(`workspace-tab-service`), `agentmux tab` CLI, `claude-tabs/<tab-id>.json`.
- 검증 조건: `permissions.allow`에 위 6개 외 규칙이 없고, 제한별 오류 code(agent 호출의 terminal 탭 `tab send` 403 포함)가 단위 test로 고정되며, 격리 live 확인에서 권한 확인 화면 없이 위임이 진행되고 needs-input 탭에는 입력이 들어가지 않아야 합니다.

## ADR-037: Runtime v2가 agent를 지원하기 전까지 agent 탭은 legacy tmux adapter(Runtime v1)로 만든다

- 상태: Accepted (2026-11-11)
- 결정: Claude Code와 Codex 탭은 Runtime v2 agent 지원 전까지 legacy tmux adapter(Runtime v1)로 만듭니다. Plain terminal 탭은 terminal v2 mode 규칙(`shouldCreateTerminalTabInRuntimeV2`)을 따르며 CLI가 만드는 탭도 같습니다. 단계 1에서 구현했고 이 ADR은 그 결정을 기록합니다. Runtime v2 terminal 탭에는 browser 없이도 입력할 수 있도록 tmux `send-keys -l --`를 쓰는 `terminal.send-text` IPC를 둡니다.
- 이유: Runtime v2 worker와 storage는 agent 상태 감지, hook, resume을 아직 다루지 않습니다. Agent 탭을 v2로 만들면 단계 1~3의 provider 경로를 다시 쓰게 됩니다.
- trade-off: Agent 탭과 plain terminal 탭이 다른 runtime에 있어 위임 코드가 두 경로를 구분해야 합니다. Runtime v2가 꺼지면 v2 탭은 살아 있지 않은 것으로 다루고 supervisor를 부르지 않습니다. 그래서 v2 탭의 `tab send`·`tab result`는 409 `Tab session is not running`, `tab status`는 `alive: false`입니다.
- 영향: `agent-launch-service`, `workspace-tab-service`, Runtime v2 supervisor IPC.
- 검증 조건: Runtime v2 agent 지원을 설계할 때 이 ADR을 새 ADR로 대체합니다.
