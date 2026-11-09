# agentmux 컨텍스트

이 문서는 agentmux의 도메인 언어와 문서 경계를 정리합니다. 새 기능, 동작 변경,
작업 흐름 계약 변경, 여러 파일에 걸친 변경을 시작할 때 `docs/agents/domain.md`의
도메인 아키텍처 점검과 함께 읽습니다.

## 제품 정체성

agentmux는 코딩 에이전트 웹 세션 매니저입니다 (현재 Codex 지원, Claude Code 지원 예정). 범용 터미널 대시보드가 아니라
여러 코딩 에이전트 세션을 workspace, session, tab, timeline, status 중심으로 실행,
재개, 모니터링, 검토하는 도구입니다.

현재 제품/runtime 기준은 Linux 단일 엔진 호스트입니다. 한 호스트가 custom server,
Runtime v2 worker, tmux, Codex JSONL, app-owned DB와 등록된 project filesystem을
소유합니다. Windows 설치형 제품 마감, 설치 관리자와 업데이트 근거는 역사적 release
증거로 보존하며 별도 `codexwinmux` 저장소의 판단 기준을 유지합니다.

## 기준 소스

| 영역 | 기준 소스 |
| --- | --- |
| 작업 규칙과 수명주기 | `AGENTS.md`, `docs/agents/domain.md` |
| 도메인 언어와 경계 | `CONTEXT.md`, `docs/ADR.md`, 관련 코드/문서 |
| 제품/아키텍처 설계 요약 | `docs/PROJECT-DESIGN.md`, `docs/ARCHITECTURE-LOGIC.md` |
| UI 시각 계약 | `DESIGN.md`, `docs/STYLE.md` |
| 릴리스와 운영 근거 | `docs/operations/`, `docs/FOLLOW-UP.md` |
| 생성된 수명주기 스냅샷 | `docs/lifecycle/runs/` |

생성된 수명주기 산출물은 절차 근거입니다. `AGENTS.md`,
`CONTEXT.md`, `docs/ADR.md`, 실제 구현 사실보다 우선하지 않습니다.

## 도메인 용어

| 표준 용어 | 의미 | 주요 경계 |
| --- | --- | --- |
| 코딩 에이전트 웹 세션 매니저 | 코딩 에이전트 CLI 세션을 관리하는 제품 정체성 (현재 Codex 지원, Claude Code 지원 예정) | UI, 문서, README |
| Workspace | 여러 tab과 layout을 묶는 작업 단위 | workspace API, layout store |
| Tab | terminal, Codex, diff, browser 등 panel 실행 단위 | `ITabState`, runtime adapter |
| 로컬 Codex 세션 | local Codex process와 JSONL을 연결한 투영 | 감지, timeline, status |
| Timeline | Codex JSONL과 live event를 사용자 검토용 event stream으로 보여주는 surface | timeline server/worker |
| Status | Codex 작업 상태, approval, notification 판단 투영 | status manager/worker |
| 런타임 어댑터 | OS별 terminal/process/service 구현 경계 | runtime v2, tmux legacy, Windows runtime |
| Linux 단일 엔진 호스트 | server, worker, tmux, Codex 데이터와 project read를 한 Linux host가 소유하는 실행 토폴로지 | Runtime v2, systemd user service |
| Session Catalog | Codex JSONL에서 계산한 session metadata와 검색 projection | Timeline Worker, app-owned index DB |
| Managed Project | 승인된 root 아래에서 guidance, knowledge와 lifecycle 상태를 관리하는 project aggregate | Storage/Governance Worker |
| Project Governance | Managed Project의 guidance, knowledge, check, audit를 제공하는 bounded context | Governance Worker |
| Knowledge Index | project-local 문서의 navigation/search를 위한 재생성 가능한 projection | Governance Worker, app-owned index DB |
| Governance Action Run | 한 Managed Project의 scaffold preview, confirm, publish, recovery와 receipt를 묶는 aggregate | Governance Worker, action journal/backup |
| Scaffold Artifact | versioned template catalog가 생성하거나 marker-owned block으로 갱신할 수 있는 허용 문서 | Project Governance scaffold catalog |
| Marker-owned block | `CODEXMUX:` marker 사이에서만 Governance Action Run이 갱신할 수 있는 문서 영역 | scaffold marker parser, no-clobber policy |
| Unmarked Artifact Adoption | 기존 bytes를 비소유 prefix로 유지하고 EOF에 새 marker-owned block만 추가하는 명시적 Governance Action Run | Project Governance scaffold preview/confirm |
| Adoption Selection | 한 preview에서 사용자가 artifact별로 명시한 adoption intent | preview token/digest, API/IPC contract |
| Adoption Template Variant | 신규 문서 template과 분리된 compact marker block definition | scaffold template catalog |
| Project Lifecycle | spec, domain architecture, grill, plan, review, release, operate artifact 흐름 | project-local docs |
| App Area | Workspace, Sessions, Governance 중 현재 route가 가리키는 고정 1차 제품 영역 | Pages Router, `AppAreaNavigation` |
| Workspace Activity | busy, needs-input, review, completed 상태를 모은 Workspace 내부 context panel | sidebar local state, notification projection |
| Windows 전용 제품 | 2026년 Windows product-line 전환과 release 검증의 역사적 결정 | packaging, host, release evidence |
| Windows 서비스 호스트 | 앱/backend 수명주기를 관리하는 host 경계 | Windows host diagnostics, future service |
| 브라우저 인증 namespace | 같은 hostname의 sibling app과 충돌하지 않는 제품별 session cookie 경계 | `agentmux-session-token` (legacy `codexmux-session-token` 호환), ADR-029, ADR-033 |
| Upload ingress | 인증된 raw file request를 bounded admission하고 `~/.agentmux/uploads/`(legacy 실제 경로 `~/.codexmux/uploads/`) artifact로 no-replace commit하는 outer custom server 경계 | `server.ts`, upload server/storage adapter |
| 시각 계약 | 제품 UI의 theme, layout, component 상태, 반응형/accessibility 규칙 | `DESIGN.md`, `docs/STYLE.md` |

## 거부 또는 레거시 용어

- 현재 제품명으로서 `codexmux`: 현재 제품명은 `agentmux`이며, `codexmux`는 과거 릴리스 기록이나 호환 별칭을 설명할 때만 사용합니다.
- `Windows companion integration`: 제거된 remote/sidecar 모델을 되살리는 의미로 쓰지 않습니다.
- `Windows bridge`: 기준 runtime 용어로 쓰지 않습니다.
- `tmux backend`: 새 도메인 경계 이름으로 쓰지 않습니다. tmux는 legacy infrastructure adapter입니다.
- `Android primary client`: Android는 Linux engine에 접속하는 선택 client이며 primary runtime
  authority가 아닙니다.
- 범용 `terminal dashboard`: agentmux 제품 정체성을 설명하는 기준 용어가 아닙니다.
- 단독 `lifecycle`: Project Lifecycle, Runtime Operations, ADR Lifecycle 중 하나로 한정합니다.
- `workspace project`: Workspace와 Managed Project를 하나의 entity로 합치는 이름으로 쓰지 않습니다.
- `ProjectWrite`, `FileSync`: create-only scaffold보다 넓은 arbitrary write/sync를 암시하는 public
  domain 이름으로 쓰지 않습니다.
- `auto adoption`, `document takeover`, `full-file ownership`, `smart merge`, `section inference`:
  기존 unmarked 본문의 소유권이나 의미를 추측하는 기능 이름으로 쓰지 않습니다.

## 경계 규칙

- 런타임 동작 변경은 `docs/ADR.md`, `docs/ARCHITECTURE-LOGIC.md`, 관련 runtime 문서를 함께 갱신합니다.
- UI 시각 변경은 root `DESIGN.md`와 `docs/STYLE.md`를 기준으로 검토합니다.
- 제품/아키텍처 설명 변경은 `docs/PROJECT-DESIGN.md`와 `README.md` 문서 맵을 함께 확인합니다.
- `/api/upload-image`, `/api/upload-file`의 external ingress는 Next proxy/API route가 아니라
  outer custom server가 소유합니다. Upload transaction, policy, receipt, reservation lease는
  해당 경계의 spec-local 구현 용어입니다. Final publish는 same-directory hard link 생성이
  성공한 시점이며 기존 destination을 덮어쓰는 rename은 사용하지 않습니다.
- 생성된 `docs/lifecycle/runs/*.json`은 도구 스냅샷입니다. 사람이 쓴 기준 문서로 승격하지 않습니다.

## 현재 구현 기준

2026-08-23 기준 Session Operations와 Project Governance Phase 1~3 첫 vertical slice가 Linux
단일 엔진에 통합됐습니다. Timeline Worker는 Session Catalog, Storage Worker는 durable
project/session 상태, Governance Worker는 승인 project의 Knowledge Index와 governed scaffold
write를 소유합니다. Arbitrary project write/delete/move/full sync, remote topology, GSD
orchestration과 full-output search는 구현 범위가 아닙니다.
초기 통합 commit `d405f683`, Phase 3 build `9d32d049`와 adoption build `f46410b4`는
authenticated `0.0.0.0:8122`의 `systemd --user` service에 배포되어 실제 restart 전후
terminal/worker smoke를 통과했습니다. 실제 Managed Project adoption/rollback과 301초 동안
11회 동일 세션 재연결·worker health도 통과해 ADR-031과 ADR-032는 `Verified`입니다. 검증과
rollback 경계는 `docs/operations/2026-08-22-live-verification-maintenance-handoff.md`에
기록합니다.

Phase 3의 첫 범위인 `Governance Action Run` 소유 create scaffold와 marker-owned update는
구현 및 격리 release gate를 통과했습니다. 후속 `Unmarked Artifact Adoption`은 기존 UTF-8
regular file을 자동 takeover하지 않고, 첫 discovery 뒤 artifact별 `Adoption Selection`을 반영한
두 번째 preview에서 compact `Adoption Template Variant`만 EOF에 append하도록 구현했습니다.
기존 bytes는 exact prefix로 보존하며 invalid UTF-8, NUL과 marker-like comment는 거부합니다.
Live service는 systemd drop-in으로
`AGENTMUX_GOVERNANCE_WRITES=1`(legacy `CODEXMUX_GOVERNANCE_WRITES=1` 호환)을 활성화했고 Governance `writeState=ready`, private Runtime v2
backup과 post-restart Phase 6 gate를 확인했습니다. 실제 `agentmux`(이전 이름 `codexmux`) Managed Project에서
`AGENTS.md` adoption preview/confirm/rollback과 원본 SHA-256 복구까지 완료했습니다.
이전 이름 저장소의 [GitHub issue #19](https://github.com/HardcoreMonk/codexmux/issues/19)와 설계·운영 인계는
`docs/superpowers/specs/2026-08-21-governed-project-scaffold-design.md`, ADR-032와
`docs/operations/2026-08-21-governed-project-scaffold-handoff.md`를 따릅니다.

2026-08-15 기준 pre-auth bootstrap은 lifecycle review와 Linux dev/prod security smoke로,
upload ingress와 Windows stable release path는 fresh Windows package/update gate로
검증했습니다. Bootstrap은 ADR-026, upload ingress는 ADR-027, Windows stable release
gate는 ADR-028 `Verified`입니다.

- 현재 public npm package: `@hardcoremonk/agentmux` (legacy `codexmux@0.4.23`, registry commit `ef27e297`)
- 보존된 legacy Windows stable release: [`v0.4.22`](https://github.com/HardcoreMonk/codexmux/releases/tag/v0.4.22), commit `4af02209`
- Windows 검증 완료 추적 (이전 이름 저장소 기록): [GitHub issue #16](https://github.com/HardcoreMonk/codexmux/issues/16)
- 구현·복구 근거: `docs/operations/2026-07-11-pre-auth-bootstrap-security-handoff.md`,
  `docs/operations/2026-07-11-production-security-upload-integrity-handoff.md`,
  `docs/operations/2026-07-12-v0.4.20-windows-release-handoff.md`,
  `docs/operations/2026-07-12-v0.4.21-windows-release-handoff.md`,
  `docs/operations/2026-07-12-purplemux-cookie-isolation-handoff.md`,
  `docs/operations/2026-07-13-v0.4.22-windows-release-handoff.md`,
  `docs/operations/2026-08-14-purplemux-selected-adoption-handoff.md`
- browser session cookie는 ADR-029 및 ADR-033에 따라 `agentmux-session-token`(legacy `codexmux-session-token` 호환)이며,
  Purplemux와 같은 hostname에서 동시 실행할 수 있습니다. `v0.4.22` 운영 계약상 처음 적용할 때
  이전 이름 Codexmux 재로그인이 필요했고, Purplemux가 계속 인증에 실패하면 Purplemux에도 한 번
  로그인합니다. Fresh CI profile은 기존 Electron cookie profile의 전환을 증명하지 않으므로
  ADR-029는 `Implemented` 상태를 유지합니다. 두 제품의 terminal/runtime data는 유지됩니다.
- 새 runtime/API/storage 변경은 같은 lifecycle과 ADR 상태 전이를 따릅니다.
- Purplemux 선택 도입은 rate-limit, bounded rich timeline, terminal/UI 회귀 수정,
  native session hook/server launch intent를 포함합니다. ADR-025는 full automated gate와
  실제 Linux user service 재시작을 근거로 `Verified`입니다. Windows package 실기 검증은
  이 선택 도입의 완료 조건에서 제외했습니다.

현재 live Linux build는 `a6a49588`, source version은 `0.4.24`입니다. Workspace, Sessions,
Governance는 고정 `App Area`이며 기존 sidebar `sessions` local state는 `Workspace Activity`로
normalize합니다. Current route는 `aria-current`, Workspace/Session/Managed Project 선택은
`aria-selected`, disclosure는 `aria-expanded`, focus는 `focus-visible`로 분리합니다. 등록
project의 Project Lifecycle evidence 236개는 bounded IPC maximum 2,000 안에서 응답하며
2,001개 이상은 거부합니다. 최신 배포·rollback 근거는
`docs/operations/2026-08-23-navigation-selection-clarity-handoff.md`에 있습니다.
