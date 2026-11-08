# 문서 맵

이 디렉터리는 codexmux의 내부 설계, 운영, 플랫폼 전환 기준 문서를 모읍니다. 현재 기준 문서 언어는 한국어입니다.

`landing-src/docs/`는 GitHub Pages에 배포하는 사용자 가이드 surface이며 canonical 제품 계약은
아닙니다. Root landing과 신규 핵심 guide는 English, `/ko/`는 Korean을 사용합니다. 기존 root
guide의 한국어 content는 순차 이관 대상으로 남아 있으며, 그 밖의 9개 locale 복제본은 legacy
snapshot이고 완성된 번역으로 보지 않습니다. 작성,
검증, 배포 기준은 `GITHUB-PAGES.md`를 따릅니다. 제품 UI의 현재 지원 언어는 한국어와
영어입니다. 과거 실행 로그와 release handoff는 `docs/operations/`에 보존하며, 당시 증거를
소급해 재작성하지 않습니다.

## 현재 기준 문서

| 문서 | 기준 |
| --- | --- |
| `ADR.md` | 오래가는 아키텍처 결정과 변경 트리거 |
| `PROJECT-DESIGN.md` | 제품/아키텍처 설계 요약과 주요 구성 |
| `WINDOWS-ONLY-GAP-AUDIT.md` | ADR-023 기간의 Windows 전환 gap과 release 증거 보존 |
| `PURPLEMUX-ADOPTION-AUDIT.md` | Purplemux 계보, 보안/구조 차이, 선택 이식 우선순위 |
| `HERDR-ADOPTION-AUDIT.md` | Herdr 기능 인벤토리, codexmux 대비 비교, 차용 후보와 제외 범위 |
| `ARCHITECTURE-LOGIC.md` | Linux engine, runtime worker, Session Catalog, Project Governance와 API 흐름 |
| `RUNTIME-V2-CUTOVER.md` | runtime v2 production 전환 단계와 rollback 기준 |
| `RUNTIME-V2-PARITY.md` | runtime v2 surface별 parity와 증거 |
| `STATUS.md` | Codex 작업 상태 감지, notification, timeline metadata |
| `TMUX.md` | Linux tmux adapter와 terminal WebSocket 계약 |
| `DATA-DIR.md` | `~/.codexmux/` 저장 구조와 삭제 기준 |
| `TESTING.md` | unit/type/lint/build, Linux engine, Playwright와 별도 package smoke 기준 |
| `ELECTRON.md` | Electron desktop shell, Windows packaging, updater smoke |
| `PERFORMANCE.md` | 성능 스냅샷, cache, polling, render 최적화 기준 |
| `STYLE.md` | theme, color, terminal/mobile UI 규칙 |
| `GITHUB-PAGES.md` | 공개 랜딩/가이드 작성, artifact 검증, Pages 배포와 rollback |
| `FOLLOW-UP.md` | release 전 확인, 내부 배포 단계, post-MVP backlog |
| `operations/codexwinmux-product-line-migration.md` | `codexmux`와 `codexwinmux` 제품 line 분리, data migration 기준 |
| `operations/windows-release-update-repeat-checklist.md` | 다음 버전마다 반복할 Windows release/update smoke 순서 |
| `operations/2026-07-11-pre-auth-bootstrap-security-handoff.md` | setup/install 보안 구현, 검증 증거, 복구와 잔여 경계 |
| `operations/2026-07-11-production-security-upload-integrity-handoff.md` | production dependency와 outer upload ingress 구현, 검증, Windows 증거 경계 |
| `operations/2026-07-12-v0.4.20-windows-release-handoff.md` | 최초 Windows 기능 검증과 published artifact privacy 교정 |
| `operations/2026-07-12-v0.4.21-windows-release-handoff.md` | 이전 privacy-safe Windows release 증거 |
| `operations/2026-07-13-v0.4.22-windows-release-handoff.md` | 보존된 Windows stable release, cookie namespace와 update 증거 |
| `operations/2026-07-12-purplemux-cookie-isolation-handoff.md` | 동일 hostname의 Purplemux/Codexmux cookie 충돌 원인, source 수정과 release 경계 |
| `operations/2026-08-14-purplemux-selected-adoption-handoff.md` | Purplemux 선택 기능 수동 도입, 자동 검증과 Linux service 재시작 근거 |
| `operations/2026-08-20-npm-npx-distribution-handoff.md` | npm 0.4.23 publish, 0.4.24 release gate와 보류된 tag/Trusted Publisher |
| `operations/2026-08-21-session-operations-governance-integration-handoff.md` | Session Catalog/Project Governance 구현, 검증, rollback과 운영 진입 경계 |
| `operations/2026-08-21-canonical-documentation-refresh-handoff.md` | canonical/landing 문서 감사 범위, 현행 기준과 보존 정책 |
| `operations/2026-08-21-governed-project-scaffold-handoff.md` | Phase 3 scaffold 구현, 검증, gate-off 운영 인계와 활성화 조건 |
| `operations/2026-08-21-governed-unmarked-adoption-handoff.md` | Existing unmarked artifact의 2-pass selective adoption 구현, 검증과 미배포 운영 경계 |
| `operations/2026-08-21-github-pages-guide-handoff.md` | GitHub Pages 랜딩/가이드, artifact gate, 배포와 공개 smoke 증거 |
| `operations/2026-08-21-github-pages-product-redesign-handoff.md` | Session Operations/Project Governance 중심 Pages 재설계, 실배포와 service restart 증거 |
| `operations/2026-08-22-live-verification-maintenance-handoff.md` | 실제 Managed Project/Session Catalog 검증, 301초 재연결 관찰, release·Dependabot 유지보수 결과 |
| `operations/2026-08-23-navigation-selection-clarity-handoff.md` | Workspace/Sessions/Governance 탐색 명료화, lifecycle IPC hotfix, live 배포와 rollback 기준 |
| `operations/2026-08-24-public-site-opencodex-renewal-handoff.md` | Public home/docs 공통 shell 리뉴얼, Pages 배포와 live desktop/mobile smoke |

보존된 Windows stable release `v0.4.22`는 같은 hostname의 Purplemux와 동시 실행하기 위한 cookie namespace 수정을
포함하고 fresh Windows package/published updater와 privacy gate를 통과해 stable/latest로
승격했습니다. 다만 CI는 fresh profile을 사용하므로 기존 Electron cookie profile의 1회
재로그인과 이전 runtime/upload session 재연결을 증명하지 않습니다. ADR-029는 해당 전환
증거를 확보할 때까지 `Implemented` 상태를 유지합니다. 기존 upload/package와 published
updater 인수 조건은 `v0.4.20`에서 기능 검증하고 `v0.4.21`에서 privacy-safe evidence로
재검증했습니다.
[GitHub issue #16](https://github.com/HardcoreMonk/codexmux/issues/16)은 해당 완료 조건과
workflow/asset 증거를 보존하는 추적 기록입니다.

2026-08-14에는 Purplemux 비교 감사에서 선택한 rate-limit, bounded rich timeline,
terminal/UI 회귀 수정, native session hook/server launch intent를 수동 도입했습니다.
ADR-025는 자동 검증과 실제 Linux service 재시작을 근거로 `Verified`이며, Windows package
실기 검증은 2026-08-15 사용자 결정에 따라 이 선택 도입의 완료 조건이 아닙니다.

2026-08-21에는 `codexmux@0.4.23` public npm publish와 registry package smoke를 완료했고,
Session Operations/Project Governance 구현 commit `d405f683`, `9d32d049`, `f46410b4`를 Linux
user service에 순차 배포했습니다. Browser 인증, `HOST=0.0.0.0`과
`CODEXMUX_GOVERNANCE_WRITES=1` drop-in을 적용해 listener와 governed writer를 활성화했습니다.
2026-08-22에는 실제 Managed Project의 adoption/rollback, 실제 JSONL Session Catalog와 301초
동일 세션 재연결 관찰을 완료해 ADR-031과 ADR-032를 `Verified`로 전환했습니다.
같은 날 annotation-aware pagination commit `322ccfb7`, version `0.4.24`를 Linux user service에
배포해 실제 pinned/tag 검색의 `results=1`, exact `total=1`과 Phase 6 gate를 확인했습니다.
2026-08-23에는 navigation build `a6a49588`을 같은 service에 배포했습니다. Runtime v2
terminal/reconnect 10-check, Phase 6 12-check, Governance lifecycle 236-evidence 응답과 실제
desktop/mobile current/selection 상태를 확인했습니다. Public npm `latest`는 registry 기준
`0.4.23`이며 source/live version `0.4.24`와 배포면을 구분합니다.

2026-08-24에는 public home/docs shell을 `b0bfed43`으로 GitHub Pages에 배포했습니다. 두 Pages
workflow와 final HTTPS desktop/mobile smoke에서 theme, search, menu, locale/docs selection,
hero/OG asset, overflow와 page error 0건을 확인해 public surface가 `operate`에 진입했습니다.

Root `CONTEXT.md`는 도메인 언어와 기준 소스 경계를, root `DESIGN.md`는
UI 시각 계약을 담당합니다.

## 플랫폼 및 참고 문서

| 문서 | 기준 |
| --- | --- |
| `ANDROID.md` | Linux engine에 연결하는 선택 Android Capacitor client와 mobile regression 기준 |
| `SYSTEMD.md` | Linux 단일 엔진의 `systemd --user` 운영 기준 |
| `TAURI-EVALUATION.md` | Rust/Tauri 도입 검토 기록 |
| `operations/` | 실제 배포, smoke, handoff 기록 |
| `superpowers/specs/` | 구현 전 확정한 설계 산출물 |
| `superpowers/plans/` | 설계 review를 반영한 실행 계획 |

## 에이전트 작업 규칙

| 문서 | 기준 |
| --- | --- |
| `agents/domain.md` | 도메인 아키텍처 점검과 ADR 소비 규칙 |
| `agents/issue-tracker.md` | issue tracker 조작 규칙 |
| `agents/triage-labels.md` | triage label/status 매핑 |

## 갱신 규칙

- Linux 단일 엔진 토폴로지, terminal runtime, process inspector 또는 host 운영 정책을 바꾸면 `ADR.md`, `PROJECT-DESIGN.md`, `SYSTEMD.md`, 관련 `superpowers/specs/`와 `superpowers/plans/`를 함께 갱신합니다. Windows installer/updater의 역사적 판단을 바꿀 때만 `WINDOWS-ONLY-GAP-AUDIT.md`를 갱신합니다.
- 제품/아키텍처 설계 요약을 바꾸면 `PROJECT-DESIGN.md`, `CONTEXT.md`, `README.md`의 문서 맵을 함께 확인합니다.
- UI 시각 방향, token, layout, component 상태, 반응형/accessibility 규칙을 바꾸면 root `DESIGN.md`와 `STYLE.md`를 함께 확인합니다.
- 프로젝트 설계 기준 문서 경계를 바꾸면 `corepack pnpm check:project-design`를 실행합니다.
- 상태 모델, provider metadata, notification policy, Codex hook event 경로를 바꾸면 `STATUS.md`와 `ADR.md`를 함께 갱신합니다.
- tmux, Windows terminal adapter, process 감지, terminal protocol, Codex web input 제출 frame, `Ctrl+D` 정책을 바꾸면 `TMUX.md` 또는 새 Windows runtime 문서를 갱신합니다.
- server startup, WebSocket routing, shared singleton, runtime worker, sync 흐름을 바꾸면 `ARCHITECTURE-LOGIC.md`를 갱신합니다.
- Session Catalog, Managed Project, Governance Worker, Knowledge Index, lifecycle projection 또는 project read policy를 바꾸면 `CONTEXT.md`, `ADR.md`, `PROJECT-DESIGN.md`, `ARCHITECTURE-LOGIC.md`, `DATA-DIR.md`, `TESTING.md`를 함께 확인합니다.
- upload route ownership, request contract, admission, storage publish/cleanup 또는 kill switch를 바꾸면 `ADR.md`, `ARCHITECTURE-LOGIC.md`, `DATA-DIR.md`, `TESTING.md`를 함께 갱신합니다.
- runtime v2 mode, migration, rollback, parity evidence를 바꾸면 `RUNTIME-V2-CUTOVER.md`와 `RUNTIME-V2-PARITY.md`를 갱신합니다.
- 성능 계측, polling, timeline render/cache, WebSocket batching을 바꾸면 `PERFORMANCE.md`를 갱신합니다.
- 테스트 도구, smoke command, Codex command strict-config 검증, platform 검증 순서, package gate를 바꾸면 `TESTING.md`를 갱신합니다.
- 공개 랜딩, 사용자 가이드, locale navigation, canonical URL 또는 Pages workflow를 바꾸면 `GITHUB-PAGES.md`, `TESTING.md`와 `landing-src/`의 영향을 함께 확인합니다.
- Electron packaging, installer, updater, local server bootstrap을 바꾸면 `ELECTRON.md`를 갱신합니다.
- 저장 파일 구조나 삭제 기준을 바꾸면 `DATA-DIR.md`를 갱신합니다.
- release, deploy, smoke 결과가 운영 판단에 영향을 주면 `operations/` handoff를 추가하고 `FOLLOW-UP.md`의 상태를 갱신합니다.
- release blocker를 issue로 추적하면 `FOLLOW-UP.md`, 관련 ADR, gap audit, operations handoff가 같은 issue와 완료 조건을 가리키게 합니다.
- 제품명, app id, data dir, updater channel을 바꾸면 `ADR.md`와 `operations/codexwinmux-product-line-migration.md`를 함께 갱신합니다.
- durable architecture decision은 `ADR.md`에 남깁니다. 단순 copy나 작은 styling 변경은 ADR이 필요하지 않습니다.
