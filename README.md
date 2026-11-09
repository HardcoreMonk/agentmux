# agentmux

agentmux는 여러 코딩 에이전트 CLI 작업을 workspace, session, tab, timeline, status 단위로
실행하고 다시 연결하는 코딩 에이전트 웹 세션 매니저입니다 (현재 Codex 지원, Claude Code 지원 예정).
Next.js Pages Router UI와 custom Node server를 함께 사용하며, 현재 active runtime은 Linux 단일 엔진 호스트입니다.
한 Linux host가 Runtime v2 worker, tmux, Codex JSONL, app-owned DB와 등록 project read/governed write를
소유합니다.

Windows 설치형 제품 마감은 별도 제품 line인
[`codexwinmux`](https://github.com/HardcoreMonk/codexwinmux)에서 진행합니다. 이 저장소는
`agentmux`(이전 이름 `codexmux`) release identity와 원본 runtime, 아키텍처 결정, 회귀·패키지 증거를 계속
관리합니다.

## 핵심 기능

- 여러 workspace와 tab에서 terminal 및 Codex session 실행·재개
- Codex process와 `~/.codex/sessions/**/*.jsonl` 기반 timeline/status 연결
- reconnect, approval, notification, session list와 usage projection
- Session Catalog 검색·replay·annotation과 saved filter
- Approved Project Root, Managed Project, Project Governance/Knowledge Index와 versioned scaffold
- Workspace, Sessions, Governance 고정 1차 탐색과 route/entity/focus 상태 분리
- Runtime v2 Supervisor와 terminal/storage/timeline/status/governance worker
- Linux tmux adapter와 `systemd --user` 운영, 선택적 Electron/Android client
- 보존된 Electron Windows NSIS/zip packaging, installer, updater release smoke
- `~/.agentmux/`(legacy 실제 경로 `~/.codexmux/`) 아래의 local-first 상태와 인증된 upload artifact 관리

## 현재 상태

| 항목 | 현재 기준 |
| --- | --- |
| source/package.json 버전 | `0.5.0` (`@hardcoremonk/agentmux`) |
| active 제품/runtime | Linux 단일 엔진 호스트, ADR-031 `Verified` |
| UI 언어 | 기본 한국어, 지원 한국어·영어 |
| 현재 live service | `systemd --user` (`agentmux.service`), authenticated `0.0.0.0:8122`, governance writes active |
| 웹 구조 | Next.js Pages Router + custom Node server |
| terminal 구조 | Runtime v2 Terminal Worker + Linux tmux adapter (`agentmux-tmux-<socket>.scope` 분리) |
| 운영 데이터 | `runtime-v2/state.db`, `session-catalog/index.db`, `governance/index.db` |
| bootstrap 보안 | ADR-026 `Verified` |
| browser 인증 | `agentmux-session-token` (legacy `codexmux-session-token` 호환); 같은 hostname의 Purplemux cookie와 분리 |
| upload ingress | ADR-027 `Verified` |
| npm 배포 | `@hardcoremonk/agentmux` (legacy `codexmux@0.4.23` public `latest`, ADR-030 `Verified`) |
| 보존된 Windows release | `v0.4.22` stable/latest; ADR-028 `Verified` |

## 시작하기

active Linux engine에는 Node.js `>=20.9.0`, tmux `>=3.0`, Git, Codex CLI가 필요합니다.
공개 npm package로 전역 설치하거나 바로 실행할 수 있습니다.

> 이전 이름 전역 패키지(`codexmux`)가 설치되어 있다면 `agentmux`/`codexmux` 바이너리 충돌을 막기 위해 먼저 제거한 뒤 설치하세요.

```bash
npm rm -g codexmux # 이전 이름 전역 패키지 제거
npm i -g @hardcoremonk/agentmux
agentmux
```

또는 `npx`로 실행할 수 있습니다.

```bash
npx --yes @hardcoremonk/agentmux@latest
```

Source checkout 개발:

```bash
git clone https://github.com/HardcoreMonk/agentmux.git
cd agentmux
corepack enable
corepack pnpm install
corepack pnpm dev
```

## 이름 변경 및 호환성

`0.5.0`부터 제품 이름이 `agentmux`로 변경되었으며, 기존 설정과 자동화 스크립트가 깨지지 않도록 아래 legacy 식별자를 호환 별칭으로 유지합니다.

| 구분 | 기준 식별자 | Legacy 호환 별칭 |
| --- | --- | --- |
| npm 패키지 | `@hardcoremonk/agentmux` | `codexmux@0.4.x` (이전 이름 패키지) |
| 서버/CLI 명령 | `agentmux`, `amux` | `codexmux`, `cmux` (legacy 호환 별칭) |
| 환경 변수 | `AGENTMUX_*`, `AMUX_PORT`, `AMUX_TOKEN` | `CODEXMUX_*`, `CMUX_PORT`, `CMUX_TOKEN` |
| 브라우저 세션 쿠키 | `agentmux-session-token` | `codexmux-session-token` |
| CLI 인증 헤더 | `x-agentmux-token` | `x-cmux-token` |
| 데이터 디렉터리 | `~/.agentmux` (`~/.codexmux`가 있으면 호환 symlink 생성) | `~/.codexmux` (기존 데이터 실제 경로 유지) |
| systemd user unit | `agentmux.service` | `codexmux.service` (이전 이름 unit) |
| tmux 소켓 | `-L codexmux`, `codexmux-runtime-v2` (실행 중 세션 보존을 위해 소켓 이름 유지) | 동일 |

Production build와 Linux user service 운영은 [systemd 문서](docs/SYSTEMD.md)를 따릅니다.
현재 unit과 실제 listener는 `HOST=0.0.0.0`, `PORT=8122`이며 browser 인증이 구성된
상태로 실행됩니다. 외부 네트워크에서 접근할 때도 인증을 통과해야 합니다.

Windows Electron은 별도 배포면과 선택 client surface로 보존합니다. Windows source
검증에서는 adapter를 명시합니다.

```powershell
$env:PORT = "8122"
$env:AGENTMUX_RUNTIME_V2 = "1"
$env:AGENTMUX_RUNTIME_TERMINAL_ADAPTER = "windows"
$env:AGENTMUX_PROCESS_INSPECTOR_ADAPTER = "windows"
corepack pnpm dev:electron
```

이미 `8122`에서 server가 실행 중이면 Electron만 연결할 수 있습니다.

```powershell
$env:ELECTRON_DEV_URL = "http://localhost:8122"
corepack pnpm exec electron .
```

## 검증

일반 변경의 기본 gate:

```bash
corepack pnpm check:project-design
corepack pnpm tsc --noEmit
corepack pnpm lint
corepack pnpm test
corepack pnpm audit --prod
corepack pnpm build
corepack pnpm smoke:runtime-v2
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm perf:session-catalog
corepack pnpm smoke:linux:session-governance
corepack pnpm smoke:browser:session-governance
```

Bootstrap과 upload 경계를 바꾼 경우 dev/prod를 각각 확인합니다.

```bash
CODEXMUX_PREAUTH_SMOKE_MODE=development corepack pnpm smoke:pre-auth-bootstrap
CODEXMUX_PREAUTH_SMOKE_MODE=production corepack pnpm smoke:pre-auth-bootstrap
corepack pnpm check:upload-memory
CODEXMUX_UPLOAD_SMOKE_MODE=development corepack pnpm smoke:upload-integrity
CODEXMUX_UPLOAD_SMOKE_MODE=production corepack pnpm smoke:upload-integrity
```

Windows release 후보는 fresh Windows runner에서 현재 source로 package를 만든 뒤 검증합니다.
Updater local-feed와 package gate에는 현재 버전보다 낮은 실제 baseline installer가 필요합니다.

```powershell
corepack pnpm pack:electron
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:updater-local-feed
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:package-gate
corepack pnpm smoke:windows:release-gate
corepack pnpm check:smoke-artifacts -- $env:CODEXMUX_SMOKE_ARTIFACT_DIR
```

`CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_ALLOW_SYNTHETIC=1`은 개발용 fallback이며 release
인수 증거를 대신하지 않습니다.
Release evidence JSON은 privacy scanner를 통과해야 업로드되며, 실패하면 stable
promotion도 진행하지 않습니다.

Linux에서 Windows smoke가 `skipped`인 결과는 Windows 통과 증거가 아닙니다. `v0.4.20`에서
fresh Windows upload/package와 실제 published updater 적용을 최초 검증했고, `v0.4.21`에서
privacy-safe evidence를 재검증했습니다. 보존된 `v0.4.22`는
legacy [workflow 29219010240](https://github.com/HardcoreMonk/codexmux/actions/runs/29219010240)의
attempt 3에서 실제 `v0.4.21 -> v0.4.22` package/published updater와 세 artifact privacy
gate를 통과했습니다. 현재 근거는
[v0.4.22 release handoff](docs/operations/2026-07-13-v0.4.22-windows-release-handoff.md)에
기록합니다.

릴리스 tag workflow는 고정된 직전 installer와 SHA-256을 기준으로 fresh Windows package
gate를 실행합니다. 통과한 자산은 먼저 prerelease로 게시하며, 같은 tag를 대상으로 실제
published updater apply가 통과한 뒤에만 stable/latest로 승격합니다. macOS package와 npm
publish는 Windows stable release의 선행 조건이 아닙니다.

Linux tmux 기반 npm 실행 package는 Windows installer와 독립된 배포면입니다. Publish 후보는
다음 명령으로 실제 tarball install과 production health를 검증합니다.

```bash
corepack pnpm smoke:npm-package
```

`codexmux@0.4.23`의 최초 public publish와 registry install/production health smoke는
통과했습니다. 후속 tag publish는 GitHub Actions Trusted Publishing을 사용하며 Windows
stable workflow와 독립적으로 실행됩니다. 2026-08-22에는 `0.4.24` package release gate와
Linux live 배포를 완료했습니다. Remote tag와 GitHub Windows Release는 별도 gate로 유지하며
기존 local `v0.4.23` tag는 remote에 게시하지 않습니다.

2026-08-23에는 Workspace, Sessions, Governance 1차 탐색과 entity selection을 명료화한
build `a6a49588`을 Linux user service에 배포했습니다. Runtime v2 terminal/reconnect 10-check,
Phase 6 12-check, Governance lifecycle 236-evidence 응답과 실제 desktop/mobile browser 검증을
통과했습니다. Public npm `latest`는 registry 확인 기준 계속 `0.4.23`입니다.

## 아키텍처

```text
Browser / optional Electron or Android client
  -> Next.js Pages Router UI
  -> custom Node server
       -> HTTP, auth, exact upload ingress
       -> terminal / timeline / status / sync WebSocket
       -> Runtime v2 Supervisor / Worker
            -> Terminal Worker -> Linux tmux adapter
            -> Storage Worker -> durable SQLite
            -> Timeline Worker -> JSONL + Session Catalog
            -> Status Worker -> status/notification
            -> Governance Worker -> approved project read
       -> ~/.agentmux (legacy ~/.codexmux) state, projections and upload storage
```

`/api/upload-image`와 `/api/upload-file`은 Next proxy나 Pages API route가 아니라 outer
custom server가 인증, Origin, framing, admission, streaming, no-replace publish까지
소유합니다. 장애 시 `AGENTMUX_UPLOADS_DISABLED=1`(legacy `CODEXMUX_UPLOADS_DISABLED=1` 호환)로 두 route만 `503` 처리하며 제거된
Pages route로 fallback하지 않습니다.

## 저장소 경계

- `agentmux` (이전 이름 `codexmux`): Linux 단일 엔진 제품/runtime, `@hardcoremonk/agentmux` npm package, 기존 release identity와 검증 자산
- `codexwinmux`: 별도 productName/app id/data dir/updater channel을 소유하는 Windows 제품 line
- Linux tmux/systemd: active runtime과 운영 surface
- Electron/Windows package와 Android/macOS package: 선택 client 또는 역사적 release surface
- `landing-src/`: Eleventy 기반 공개 home/docs 공통 shell, theme/search와 사용자 문서 source;
  현재 제품 home 계약은 한국어·영어, 나머지 locale은 문서 URL 호환 snapshot

## 문서

| 문서 | 내용 |
| --- | --- |
| [CONTEXT.md](CONTEXT.md) | 제품 용어와 기준 소스 경계 |
| [DESIGN.md](DESIGN.md) | UI 시각 계약 |
| [docs/README.md](docs/README.md) | 전체 문서 맵과 갱신 규칙 |
| [docs/ADR.md](docs/ADR.md) | 아키텍처 결정과 상태 |
| [docs/PROJECT-DESIGN.md](docs/PROJECT-DESIGN.md) | 제품·아키텍처 설계 요약 |
| [docs/ARCHITECTURE-LOGIC.md](docs/ARCHITECTURE-LOGIC.md) | server, runtime, storage 흐름 |
| [docs/SYSTEMD.md](docs/SYSTEMD.md) | Linux 단일 엔진 user service 운영 |
| [docs/DATA-DIR.md](docs/DATA-DIR.md) | durable state와 projection 저장 경계 |
| [docs/PURPLEMUX-ADOPTION-AUDIT.md](docs/PURPLEMUX-ADOPTION-AUDIT.md) | Purplemux 비교와 선택 이식 우선순위 |
| [docs/TESTING.md](docs/TESTING.md) | test tier와 platform smoke |
| [docs/WINDOWS-ONLY-GAP-AUDIT.md](docs/WINDOWS-ONLY-GAP-AUDIT.md) | Windows 전환 gap과 증거 |
| [docs/FOLLOW-UP.md](docs/FOLLOW-UP.md) | release blocker와 후속 작업 |
| [pre-auth handoff](docs/operations/2026-07-11-pre-auth-bootstrap-security-handoff.md) | bootstrap 보안 구현·검증·복구 |
| [upload handoff](docs/operations/2026-07-11-production-security-upload-integrity-handoff.md) | dependency/upload 구현·검증·Windows 경계 |
| [v0.4.20 Windows release handoff](docs/operations/2026-07-12-v0.4.20-windows-release-handoff.md) | 최초 기능 검증과 published artifact privacy 교정 |
| [v0.4.21 Windows release handoff](docs/operations/2026-07-12-v0.4.21-windows-release-handoff.md) | 이전 privacy-safe Windows release 증거 |
| [v0.4.22 Windows release handoff](docs/operations/2026-07-13-v0.4.22-windows-release-handoff.md) | 보존된 Windows stable release, cookie namespace와 update 증거 |
| [Purplemux cookie isolation handoff](docs/operations/2026-07-12-purplemux-cookie-isolation-handoff.md) | 동일 hostname 동시 실행 수정과 재로그인 복구 경계 |
| [npm distribution handoff](docs/operations/2026-08-20-npm-npx-distribution-handoff.md) | npm 0.4.23 publish, registry smoke와 보류된 tag/Trusted Publisher |
| [Session Operations/Governance handoff](docs/operations/2026-08-21-session-operations-governance-integration-handoff.md) | 통합 구현, live 배포·restart와 rollback 증거 |
| [Navigation Selection Clarity handoff](docs/operations/2026-08-23-navigation-selection-clarity-handoff.md) | 고정 1차 탐색, lifecycle IPC hotfix, live 배포·restart와 browser/Runtime 검증 |
| [제품 line migration](docs/operations/codexwinmux-product-line-migration.md) | 이전 이름 `codexmux`와 `codexwinmux` 분리 기준 |

## 라이선스

[MIT](LICENSE)
