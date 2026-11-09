# agentmux 이름 변경과 tmux 서버 분리 설계

- 작성일: 2026-11-09
- 상태: Approved — 2026-11-09 사용자: "승인합니다, 계획 작성 진행해 줘"
- 요청: "기존에는 codex 전용이었으나 지금부터는 claude도 지원 처리 하고 프로젝트의 명칭도
  agentmux로 변경 한다."
- 관련 감사: `../../HERDR-ADOPTION-AUDIT.md`
- 작업 체계: 개발은 Herdr pane의 Antigravity(agy)에게 위임하고 Claude는 감시·검증을 맡는다
  (사용자: "서비스 개발처리는 agy에게 위임, claude는 감시자 역할").

## 상위 순서

사용자가 확정한 세 프로젝트 순서("맞아요, 그 순서로 진행해 줘")의 1번이다.

1. **이 문서**: agentmux 이름 변경, 정체성 전환, tmux 서버 분리
2. Claude Code provider 추가
3. 위임 자동화와 에이전트 주도 화면 분할 (Herdr의 split → agent start → prompt → wait → read)

2번과 3번은 이 문서의 범위가 아니다.

## 의도와 이유

제품은 Codex 전용 세션 매니저에서 여러 코딩 에이전트(Codex, 이후 Claude Code)를 다루는 세션
매니저로 넓어진다. 이름이 정체성과 맞아야 다음 두 프로젝트의 코드와 문서를 처음부터 새 이름으로
쓸 수 있다.

사용자는 이름을 바꾸는 동안 지금 쓰는 세션이 끊기지 않기를 원한다. 현재 구조에서는 web service를
재시작하면 tmux 서버가 함께 종료되어 진행 중인 Codex 작업과 terminal 프로그램이 끊긴다
(`docs/SYSTEMD.md` KillMode 주의). 그래서 tmux 서버를 web service와 분리하는 작업을 같은 범위에
포함한다(사용자: "tmux 분리까지 이름 변경에 포함").

## 사용자 결정

| 결정 | 사용자 원문 |
| --- | --- |
| 옛 이름을 지우는 단절이 아니라 호환 유지 | "세션은 끊기지 않게 호환 유지하는 쪽으로 해 줘" |
| GitHub `HardcoreMonk/codexmux` → `HardcoreMonk/agentmux` | "네, 저장소 이름도 agentmux로 바꿔 줘" |
| npm package `@hardcoremonk/agentmux` (`agentmux`는 무관한 타인 package가 사용 중) | "네, @hardcoremonk/agentmux로 가 줘" |
| tmux 서버 분리를 이번 범위에 포함 | "tmux 분리까지 이름 변경에 포함" |
| 개발 위임과 감시 체계 | "서비스 개발처리는 agy에게 위임, claude는 감시자 역할" |

## 목표

1. 사용자가 보는 모든 현재 surface(UI, 현재 문서, CLI help, package, PWA/Android 표시 이름, public
   site)의 제품 이름이 agentmux다.
2. 전환 전후로 재로그인 없이 로그인, workspace/layout, 설정, CLI token, Session Catalog, governance DB,
   upload, approval audit이 그대로 이어진다.
3. 전환 뒤 web service를 재시작하거나 멈춰도 tmux 서버와 그 안의 terminal·Codex process가 살아남고,
   새 service가 같은 session에 다시 attach한다.
4. 첫 전환(현재 `codexmux.service` → 새 `agentmux.service`)에서도 지금 실행 중인 tmux 서버를 살린다.
   불가능하다고 증명되면 전환 전에 사용자 결정을 다시 받는다.
5. 옛 이름(`codexmux`, `cmux`, `CODEXMUX_*`, `~/.codexmux`, `codexmux-session-token`,
   `x-cmux-token`)으로 쓰던 script·설정·실행 중 session이 계속 동작한다.

## 비목표

- Claude Code provider와 위임 자동화 (프로젝트 2, 3)
- Windows installer/updater 재패키징과 Windows release (ADR-028/030 gate가 필요한 별도 배포면)
- 과거 handoff, spec, plan, grill-me, review, ADR 본문, `docs/lifecycle/runs/` 재작성
- Runtime v2 cutover 범위나 worker 구조 변경
- Host 재부팅 뒤 process 보존 (재부팅은 기존 auto-resume이 담당)

## Anti-goal

다음 중 하나라도 일어나면 기능이 동작해도 실패다.

- 전환 직후나 rollback 직후 재로그인 요구
- `~/.codexmux` 아래 어떤 파일이든 유실, 또는 두 data directory가 갈라져 서로 다른 상태를 갖는 것
- 실행 중인 Codex session의 inline hook이 가리키는 `~/.codexmux/status-hook.cjs` 경로가 깨져 status
  update가 끊기는 것
- Android 또는 Electron 앱 재설치 요구
- 화면 일부만 새 이름이고 일부는 옛 이름인 혼재 UI
- Claude Code 지원을 아직 구현 전인데 지원한다고 표시하는 문서·UI
- 개발 중 실험이 live tmux 서버(`-L codexmux`)나 live service를 건드리는 것

## 이름 매핑

| Surface | 현재 | 새 이름 | 호환 규칙 |
| --- | --- | --- | --- |
| 제품 표시 이름 | codexmux | agentmux | 현재 문서·UI·i18n message 전부 교체 |
| 제품 정의 | Codex CLI 전용 웹 세션 매니저 | 코딩 에이전트 웹 세션 매니저 | 프로젝트 2 완료 전까지 "현재 Codex 지원, Claude Code 지원 예정"으로 표기 |
| npm package | `codexmux` | `@hardcoremonk/agentmux` | 기존 `codexmux`는 삭제하지 않고 이동 안내 deprecate |
| CLI bin | `codexmux`, `cmux` | `agentmux`, `amux` | `codexmux`, `cmux`도 같은 entry로 계속 등록 |
| Data directory | `~/.codexmux` | `~/.agentmux` | 이번 release는 `~/.agentmux` → 실제 `~/.codexmux` 별칭만 만든다. 실제 이전은 후속 단계. 아래 규칙 |
| Browser cookie | `codexmux-session-token` | `agentmux-session-token` | 아래 인증 호환 |
| CLI token header | `x-cmux-token` | `x-agentmux-token` | 둘 다 수용, redaction은 둘 다 처리 |
| CLI env | `CMUX_PORT`, `CMUX_TOKEN` | `AMUX_PORT`, `AMUX_TOKEN` | 새 이름 우선, 옛 이름 fallback |
| Runtime env | `CODEXMUX_*` | `AGENTMUX_*` | 새 이름 우선, 옛 이름 fallback. 둘 다 있고 값이 다르면 새 이름을 쓰고 경고 log |
| systemd unit | `codexmux.service` | `agentmux.service` | 전환 절차로 교체, 옛 unit은 rollback용으로 disable만 |
| GitHub repo | `HardcoreMonk/codexmux` | `HardcoreMonk/agentmux` | GitHub repo redirect에 의존. Pages 옛 주소는 redirect되지 않음을 수용 |
| Public site | `hardcoremonk.github.io/codexmux` | `hardcoremonk.github.io/agentmux` | canonical, sitemap, 내부 link 갱신 |
| Android `appName` | codexmux | agentmux | 표시 이름만 변경 |
| Android `appId` | `com.hardcoremonk.codexmux` | 유지 | 바꾸면 재설치 필요 |
| Electron `appId`, `productName`, installer artifact, userData 경로 | codexmux | 유지 | Windows 배포면 범위 밖. 앱 내부 표시 문자열만 변경 |
| tmux socket | `codexmux`, `codexmux-runtime-v2` | 유지 | 바꾸면 live session을 잃음 |
| `globalThis` key | `__pt*`, `__codexmux*`, `__cmux*` | 유지 | AGENTS.md 규칙 |
| Session 이름 prefix | `pt-ws-…` | 유지 | Layout이 참조 |
| Governance scaffold marker | `<!-- BEGIN/END CODEXMUX:<id>:v<n> -->` | 유지 | Managed Project 문서에 이미 기록된 영속 식별자. 바꾸면 기존 문서가 unmarked conflict가 되고 rollback build가 인식하지 못한다 |
| Governance template 본문 (`## Codexmux Managed …`) | 유지 | 유지 | Template 문구 변경은 version 승격이 필요한 별도 governance 변경 |
| Governance stage file prefix | `.codexmux-stage-` | 유지 | Action journal 검증과 crash recovery가 이 이름을 기대한다 |

## Data directory 규칙

모든 data path는 하나의 identity/path module을 거친다. 현재 `path.join(os.homedir(), '.codexmux')`가
`src/lib/config-store.ts`, `cli-token.ts`, `hook-settings.ts`, `approval-audit-store.ts`,
`electron/main.ts`, `bin/cli.js` 등에 흩어져 있다. `bin/`과 `electron/`도 같은 규칙을 따라야 한다.

### 왜 이번 release에서 data를 옮기지 않는가

옛 build는 data directory 자체가 symlink이면 거부한다. Upload store는 `~/.codexmux`를 `lstat`해
symlink면 `storage-failure`로 실패하고(`src/lib/uploads-store.ts:115-159`), governance action journal은
`preimagePath`를 backup root 기준 절대 경로와 엄격 비교한다(`src/lib/governance/scaffold-action-journal.ts:142-150`).
`~/.codexmux`를 `~/.agentmux`로 옮기고 옛 경로를 symlink로 남기면 rollback한 옛 build의 upload가 깨진다.
새 build도 경로 문자열이 바뀌어 기존 journal 검증에 실패하고 Governance가 `degraded`가 된다.

그래서 이번 release는 실제 directory를 그대로 두고 별칭만 만든다.

### 이번 release의 규칙

| 상태 | 동작 |
| --- | --- |
| `~/.codexmux` 실제 directory, `~/.agentmux` 없음 | `~/.agentmux` → `~/.codexmux` symlink를 만든다. Data는 옮기지 않는다 |
| `~/.agentmux`가 실제 `~/.codexmux`를 가리키는 symlink | 정상. 아무것도 하지 않는다 |
| `~/.agentmux` 실제 directory, `~/.codexmux` 없음 또는 `~/.agentmux`를 가리키는 symlink | 정상 (fresh install 또는 후속 이전 완료 상태) |
| 둘 다 실제 directory | 병합하지 않고 fail closed. 어느 쪽을 쓸지 운영자 판단을 요구하는 오류를 낸다 |
| 둘 다 없음 (fresh install) | 실제 `~/.agentmux`만 만든다. Legacy 별칭은 만들지 않는다 |
| 어느 쪽이든 예상 밖 대상을 가리키는 symlink | fail closed |

- 새 build는 시작할 때 data directory를 **실제 경로(realpath)로 한 번 해석**하고, 모든 module은 그 실제
  경로만 받는다. 그래서 기존 `lstat` 기반 안전 검사, journal 경로 비교, 0600/0700 권한 규칙이 바뀌지 않고
  그대로 통과한다. 화면·log·문서에 보이는 이름은 `~/.agentmux`를 쓴다.
- 판정과 별칭 생성은 DB와 worker를 열기 전에 끝난다. 실패하면 아무것도 바꾸지 않고 시작을 중단한다.
- 실행 중인 Codex session의 inline hook(`~/.codexmux/status-hook.cjs`)과 rollback한 옛 build는 실제
  경로를 그대로 쓰므로 아무 조치 없이 동작한다.
- `CODEXMUX_RUNTIME_DB`처럼 명시 경로 env는 그 경로를 그대로 존중한다.

### 후속 단계 (이번 범위 밖)

실제 data를 `~/.agentmux`로 옮기고 `~/.codexmux`를 별칭으로 뒤집는 작업은 rollback 창을 닫은 뒤 별도
spec으로 한다. 그 spec은 journal 경로 호환과 옛 build rollback 포기 시점을 정해야 한다.

## 인증 호환

- Cookie: `agentmux-session-token`을 먼저 읽고 없으면 `codexmux-session-token`을 읽는다. 둘 다
  같은 `authSecret`으로 검증한다. Login과 rolling refresh는 새 이름으로 발급하고, legacy cookie는
  지우지 않는다. 그래야 rollback한 옛 build가 legacy cookie가 만료되기 전까지 재로그인 없이 동작한다.
  Logout은 두 cookie를 모두 지운다.
- Purplemux의 `session-token`은 ADR-029대로 계속 읽지 않는다.
- CLI header: `x-agentmux-token`과 `x-cmux-token`을 모두 수용한다. 새로 생성하는 hook bridge와 CLI는
  새 header를 보낸다. 실행 중인 session의 옛 bridge가 보내는 옛 header도 수용해야 한다.
- 현재 `src/proxy.ts`가 CLI token을 모든 API route에 수용하는 범위는 이 문서에서 바꾸지 않는다
  (프로젝트 3에서 검토).

## tmux 서버 분리

### 현재 사실 (2026-11-09 live host)

- systemd 259, tmux 3.6.
- tmux 서버 process는 `codexmux.service` cgroup 안에 있다
  (`/user.slice/.../app.slice/codexmux.service`).
- tmux 3.6은 각 pane process(shell, Codex)를 이미 별도 `tmux-spawn-*.scope`로 옮긴다. 따라서
  service stop이 직접 죽이는 것은 tmux 서버와 attach client뿐이다. 서버가 죽으면 pty가 닫혀 pane
  process가 끝난다.
- Runtime v2 terminal worker는 `codexmux-runtime-v2` socket을 쓴다. 현재 live host에는 이 socket
  서버가 없지만 분리 규칙은 두 socket 모두에 적용한다.

### 요구

1. Systemd user manager 아래에서 실행될 때 tmux 서버는 web service cgroup 밖의 자기 unit(scope 또는
   service)에서 시작된다. App이 tmux를 cold start하는 모든 경로(`createSession`, auto-resume,
   `crossCheckLayout`, Runtime v2 terminal worker)가 이 규칙을 따른다.
2. `agentmux.service` stop/restart 뒤에도 tmux 서버 PID와 pane process가 그대로이고, 새 service가
   기존 session에 attach한다. Browser는 `session not found` 없이 같은 terminal을 다시 본다.
3. Systemd가 없는 실행(dev server, npm standalone, CI)은 현재 동작을 유지한다.
4. tmux 서버를 의도적으로 끝내는 운영 경로를 문서화한다. `docs/SYSTEMD.md`의 KillMode 주의를 새
   구조 설명으로 바꾼다. `KillMode=process`는 여전히 쓰지 않는다.
5. 첫 전환: 현재 실행 중인 tmux 서버(옛 service cgroup 안)를 옛 service를 멈추기 전에 별도 unit으로
   옮긴다. 기법은 builder가 고른다(D-Bus `AttachProcessesToUnit`, `StartTransientUnit`의 `PIDs` scope,
   cgroupfs 이동 등). 조건은 셋이다. **격리된 test socket과 test transient unit**에서 인수 기준 8을 통과해야
   하고, live unit의 property를 바꾸지 않아야 하며, live 적용은 전환 창에서 감시자가 지켜볼 때만 한다.
   어느 기법도 증명하지 못하면 전환 전에 감시자(Claude)에게 보고하고 사용자 결정을 다시 받는다.
6. 자동 재개는 **이번 시작에서 tmux session을 새로 만들어야 했던 tab**에만 `codex resume`을 보낸다.
   Web service 재시작 뒤 살아남은 session에는 shell prompt 상태여도 입력을 주입하지 않는다. 현재
   `executeAutoResume`은 이미 있던 session에도 전송하는데(`src/lib/auto-resume.ts:84-102`), tmux가
   살아남게 되면 사용자가 Codex를 끝내고 shell에서 일하는 중에 resume 명령이 입력되는 부작용이 생긴다.
   Host 재부팅처럼 tmux가 사라진 경우의 재개 동작은 그대로다.
7. 실제 tmux를 쓰는 test는 `codexmux`, `codexmux-runtime-v2` socket을 쓰지 않고 test 전용 socket 이름만
   쓴다. 개발 중 어떤 명령도 live tmux 서버나 `codexmux.service`에 신호를 보내지 않는다.

## 배포 전환

- 현재 live service는 `/data/projects/codex-zone/codexmux` checkout에서 실행 중이다. 새 거점은 이
  저장소 `/data/projects/agentcode-zone/agentmux`다. 두 저장소는 git directory가 따로이며 2026-11-09 기준
  같은 commit `fdf8752b`와 같은 미커밋 변경을 가진다.
- 전환은 실행 중인 Codex turn이 없는 시점에 한다.
- 순서는 plan이 정하되 다음 불변식을 지킨다.
  1. 새 checkout에서 build와 gate를 마친다.
  2. 실행 중인 tmux 서버를 별도 unit으로 옮긴다(위 요구 5).
  3. `codexmux.service`를 stop/disable한다. 옛 unit 파일과 drop-in은 rollback용으로 지우지 않는다.
  4. `agentmux.service`(WorkingDirectory=새 checkout)와 drop-in을 설치한다. Drop-in은 `AGENTMUX_*` 이름을
     쓴다. Live drop-in 값(`RUNTIME_V2=1`, storage/timeline/status `default`, terminal `new-tabs`,
     bridge trace URL)을 그대로 옮긴다.
  5. 첫 시작에서 `~/.agentmux` 별칭이 생긴다. Data는 옮기지 않는다.
  6. 같은 browser session의 재로그인 없는 접속, workspace/layout, 기존 terminal attach, 전환 전에
     시작된 Codex session의 status update, Session Catalog, governance `writeState`를 확인한다.
- Rollback: `agentmux.service`를 멈추고 `codexmux.service`를 다시 enable/start한다. 옛 build는 실제
  `~/.codexmux`를 그대로 읽고 legacy cookie로 인증한다. Data를 옮기지 않으므로 되돌릴 file 작업이 없다.
  새 build는 rollback을 깨는 schema 변경을 하지 않는다. Rollback 뒤에도 tmux 서버는 분리된 unit에 남아
  있으므로 옛 build가 그 서버에 attach한다.
- `~/.codexmux` 안 `workspaces.json`, `layout.json`, `runtime-v2/state.db`에 기록된 workspace cwd와
  Managed Project 경로(옛 checkout `/data/projects/codex-zone/codexmux` 포함)는 다시 쓰지 않는다. 옛
  checkout은 rollback source로 디스크에 남는다. 새 checkout을 Managed Project로 등록할지는 운영자가
  따로 정한다.
- Zone 인벤토리는 이 저장소가 속한 `/data/projects/agentcode-zone/`의 `ops/projects.yaml`,
  `ops/units.yaml`, `wiki/entities/`에 agentmux 항목으로 기록한다. `codex-zone` 쪽 옛 checkout과 인벤토리는
  rollback source로 두고 수정하지 않는다.
- GitHub repo rename, Pages 재배포, npm 첫 publish와 `codexmux` deprecate, commit/push는 외부에 바로
  반영되는 작업이다. 각각 실행 직전에 사용자에게 다시 확인받는다.
- Release 단계는 zone 인벤토리(`ops/projects.yaml`, `ops/units.yaml`, `wiki/entities/`)를 함께 동기화한다.

## 선행 조건

- 미커밋 "워크스페이스 작업 유무 표시" 변경(`docs/operations/2026-10-24-workspace-activity-label-handoff.md`)을
  먼저 commit해 이름 변경 branch의 기준으로 삼는다. 이 baseline commit에는 그 기능의 source, test, message,
  `docs/STATUS.md`와 해당 spec/plan/grill-me/handoff만 넣는다. Commit은 사용자 승인 후에 한다.
- `docs/HERDR-ADOPTION-AUDIT.md`, `docs/README.md`의 그 항목, 이 spec은 이름 변경 branch의 첫 문서 commit에
  넣는다.
- 이름 변경은 별도 branch(또는 git worktree)에서 진행한다. 기존 미추적 `.ua/`,
  `src/lib/codex-client-command.ts`, `.claude/`, `docs/operations/2026-10-31-connectivity-diagnosis-handoff.md`는
  건드리지도 commit하지도 않는다.

## Domain Architecture

- 기준 용어: 제품 `agentmux`, 제품 정의 "코딩 에이전트 웹 세션 매니저". `codexmux`는 호환 alias와
  과거 기록을 가리킬 때만 쓰는 legacy 이름이다.
- 거부 용어: 현재 제품을 `codexmux`로 부르는 것, 새 문서에서 `cmux`를 기본 명령으로 안내하는 것,
  Claude 지원 전에 "multi-agent 지원"을 현재 기능처럼 쓰는 것.
- `CONTEXT.md`의 "Codex 중심 세션 매니저" 용어를 갱신한다. Workspace, Tab, Session Catalog 등 기존
  용어와 "로컬 Codex 세션"처럼 Codex 고유 개념은 유지한다(Codex provider 의미로 정확함).
- Module 후보: 제품 이름, data directory 해석과 별칭, env 이중 읽기를 소유하는 단일 identity module.
  TypeScript server/worker와 CommonJS `bin/`, Electron main이 같은 규칙을 공유해야 한다.
- Adapter 경계: tmux 서버 시작은 legacy tmux adapter(`src/lib/tmux.ts`)와 Runtime v2 terminal
  runtime 안에서 처리하고, systemd 의존은 그 경계 밖으로 새지 않는다.
- 공개 계약 영향: npm package 이름, CLI 이름, cookie, CLI header, env 이름, data directory, systemd
  unit 이름.
- ADR 후보:
  - ADR-033: 제품 이름을 agentmux로 바꾸고 legacy 식별자는 호환 alias로 유지한다 (Draft)
  - ADR-034: tmux 서버는 systemd 아래에서 web service와 별도 unit으로 실행한다 (Draft)
  - ADR-029 갱신: cookie 이름과 legacy 읽기 규칙
  - ADR-030 갱신: npm package 이름

## 인수 기준

1. Fresh HOME에서 실제 `~/.agentmux`만 생기고 legacy 별칭은 생기지 않는다.
2. Legacy HOME에서 첫 시작 뒤 `~/.agentmux` → `~/.codexmux` 별칭만 생기고 `~/.codexmux` 안 모든 파일의
   내용·권한이 그대로다(checksum 비교). 두 번째 시작은 아무것도 바꾸지 않는다. 표의 fail closed 경우는
   시작을 거부하고 원래 상태를 유지한다.
2a. Legacy HOME에서 새 build로 upload가 성공하고, 전환 전에 기록된 governance action journal이 있는 상태로
   시작해도 Governance `writeState`가 `ready`다. 같은 HOME으로 rollback한 옛 build도 upload와
   `writeState=ready`를 유지한다.
2b. Service만 재시작했을 때 살아남은 session에는 `codex resume`이 입력되지 않고, tmux session이 사라진
   tab만 재개된다.
3. Legacy cookie만 가진 browser는 재로그인 없이 접속하고 새 cookie를 받는다. Rollback build는 legacy
   cookie로 접속한다.
4. 새·옛 header, 새·옛 env가 각각 동작하고 새 이름이 우선한다.
5. `agentmux`, `amux`, `codexmux`, `cmux`가 모두 같은 CLI로 동작하고 help는 agentmux를 보여준다.
6. 이름 검사 gate: 현재 surface에 남은 `codexmux` 문자열은 허용 목록(호환 alias, 보존 식별자, 과거
   기록 directory)에만 있다. 검사 script를 기존 check 체계에 추가한다.
7. Systemd 아래 service restart 전후로 tmux 서버 PID와 pane PID가 같고 browser가 같은 terminal에
   attach한다. Systemd가 없는 dev/standalone 실행은 기존 test가 그대로 통과한다.
8. 격리 환경에서 첫 전환 리허설: test unit cgroup 안의 tmux 서버를 옮긴 뒤 test unit stop에도 서버가
   남는다.
9. 기본 gate: `check:project-design`, lint, `tsc --noEmit`, unit test, production build, landing site
   checker. Electron은 Linux에서 가능한 build까지만 확인한다.
10. Live 전환 후 위 배포 전환 6번 항목과 rollback 절차의 격리 리허설 결과를 handoff에 기록한다.

## Builder 재량

- Identity module의 이름과 위치, 내부 identifier(변수명, log prefix) 중 어떤 것을 함께 바꿀지
- tmux 서버를 scope로 띄울지 전용 service unit으로 띄울지, 그리고 tmux `exit-empty` 처리
- 이름 검사 script의 형태와 허용 목록 표현
- 문서 문구

## Builder check 결과 (agy, 2026-11-09)

| 질문 | 처리 |
| --- | --- |
| Rollback 시 옛 build가 symlink된 data directory를 거부 | 코드로 확인. Data를 옮기지 않고 `~/.agentmux` 별칭 + realpath 해석으로 변경 (Claude 판단) |
| Governance journal 절대 경로 비교로 `degraded` | 코드로 확인. 위 변경으로 실제 경로가 바뀌지 않아 해소. 실제 이전 단계에서 다시 다룬다 |
| Scaffold marker와 template 문구 변경 여부 | 영속 식별자로 유지 (Claude 판단) |
| Claude 판단 목록 확정 | 사용자 승인 대상 |
| 첫 전환 tmux 이전 기법 범위 | 격리 리허설 통과, live property 불변, 감시 하 적용이면 builder 재량 (Claude 판단) |
| tmux 생존 시 자동 재개 범위 | 새로 만든 session만 재개 (Claude 판단) |
| Baseline commit 범위, DB 안 경로, zone 인벤토리 위치 | 선행 조건과 배포 전환에 명시 (Claude 판단) |

## Claude 판단 (사용자 확인 필요)

- 짧은 CLI 이름 `amux`, 옛 `codexmux`/`cmux` alias 영구 유지
- 이번 release는 data를 옮기지 않고 `~/.agentmux` → `~/.codexmux` 별칭 + realpath 해석, 실제 이전은 후속
  단계. 두 directory가 모두 실제일 때 fail closed
- Governance marker `CODEXMUX:`, template 문구, `.codexmux-stage-` prefix 유지
- Service 재시작 뒤 살아남은 session에는 자동 재개를 보내지 않음
- Cookie: legacy 읽기, 새 이름 발급, legacy는 지우지 않음(rollback용), logout은 둘 다 삭제
- 새 CLI header `x-agentmux-token`, env `AMUX_*`/`AGENTMUX_*` 이중 읽기
- tmux socket, `globalThis` key, Android `appId`, Electron `appId`/`productName`/userData 유지
- Windows 배포면 재패키징 제외
- 옛 Pages 주소 redirect 포기
- Version은 `0.5.0`
