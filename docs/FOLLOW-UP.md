# 후속 작업

이 문서는 release 전 확인, 내부 배포 단계, post-MVP backlog를 추적합니다. Active 제품/runtime
target은 Linux 단일 엔진 호스트입니다. 기존 `v0.4.22` Windows package/updater와 unsigned 내부
배포 기록은 별도 배포면의 역사적 근거로 보존하며 Linux Session Operations/Project Governance
acceptance를 대체하지 않습니다. Public npm package의 현재 version은 `0.4.23`입니다.

## 완료된 범위

- Runtime v2 terminal/storage/timeline/status 전환 기반
- Windows platform script blocker audit
- Windows terminal runtime adapter
- Windows process inspector
- Windows Codex session detection smoke
- Windows preflight
- Windows service host baseline과 host diagnostics
- Windows Electron bootstrap env
- Windows packaging contract
- Windows release gate artifact
- Windows packaged launch/installer smoke 계열
- `~/.codex/state_*.sqlite` read-only schema/count probe 기반
- Approval queue Web Push outcome의 sanitized JSONL audit 기록
- Mobile lock-screen approval copy의 locale-aware title/body
- Provider 추가 전 `IAgentProvider` registry contract test
- Electron app-server local/remote URL protocol helper
- Status Web Push payload 생성 순수 helper 분리
- 대형 JSONL 기준 timeline perf snapshot helper와 virtualization 판단 기준
- Codex CLI JSONL schema fixture 기반 parser 회귀 테스트
- Codex resume 실패 원인 code/recoverable 분류
- Status JSONL tail scan 순수 helper 분리
- Timeline init meta 계산 순수 helper 분리
- Provider adapter status behavior contract와 runtime worker IPC 반영
- Runtime v2 rollback dry-run의 명시적 `rollbackEnv` 출력과 unit test
- 내부 전용 배포 조건 확정: public code signing certificate와 SmartScreen reputation은 release blocker가 아님
- Runtime v2 live rollback drill: 설치 앱에서 `on -> off -> restored` 전환 확인
- 설치 앱 장시간 관찰 smoke: `0.4.16` 설치본 302.8초, 23회 반복 실행, Phase 6 gate 확인
- `codexwinmux` 별도 제품 line ADR과 migration runbook
- 다음 버전 release/update smoke 반복 체크리스트
- Pre-auth bootstrap loopback exposure, strict setup claim, typed install admission/lease와 dev/prod 공격 smoke
- Production dependency audit 0건과 outer-owned streaming upload ingress의 Linux dev/prod/memory/Electron gate
- `v0.4.20` fresh Windows package/release gate와 packaged upload integrity exact checks
- `v0.4.16 -> v0.4.20` exact target-tag published updater apply와 stable promotion
- `v0.4.21`에서 같은 Windows gate와 `v0.4.20 -> v0.4.21` updater apply 반복
- `v0.4.22`에서 `v0.4.21 -> v0.4.22` package/local/published updater와 privacy 16개 JSON 재검증
- Browser/package/published-updater evidence의 upload 전 privacy scanner와 stable promotion 차단
- 같은 hostname에서 Purplemux와 동시 실행할 때 browser session cookie가 충돌하지 않도록
  `codexmux-session-token`으로 분리하고 Linux unit/dev/prod/Chromium 공존 회귀 검증 완료
- Purplemux 선택 기능 수동 도입: JSONL rate-limit과 stale UI, bounded rich timeline,
  IME/clipboard/pane focus/timeline spacer/Git refresh 회귀 수정, native session hook과
  server-side agent launch intent
- 후속 자동화 보강: session별 Git generation consume, rich timeline presentation pure helper,
  standalone Node hook bridge의 loopback/64KiB/fail-open integration test
- ADR-025 `Verified`: Codex 0.147.0 strict-config, 1,480 unit tests, type/build/Electron,
  Runtime v2 status/timeline, browser reconnect와 실제 Linux user service 재시작 통과
- Linux Session Operations/Project Governance Phase 1~2: Timeline Worker 소유 Session Catalog,
  Storage Worker 소유 durable project/session state, Governance Worker 소유 read-only Knowledge
  Index, 한국어/영어 운영 UI, 성능 baseline과 격리 Linux/browser rollback smoke
- Project Governance Phase 3 첫 vertical slice: 6개 versioned scaffold, marker-owned update,
  preview/exact confirmation, private backup/journal, startup recovery, action history와 safe rollback.
  Source와 격리 smoke를 완료하고 live `CODEXMUX_GOVERNANCE_WRITES=1` gate, private Runtime v2
  backup, Governance `writeState=ready`와 post-restart 회귀 gate를 확인
- Governed unmarked adoption source release: 2-pass artifact별 opt-in, exact-prefix compact marker
  append, adopted marker update, private preimage/latest-first rollback과 한국어·영어 UI. 전체
  test와 build/API/browser/Linux/storage gate를 통과하고 commit `f46410b4` live 배포·재시작 완료
- 실제 Approved Project Root/Managed Project 등록과 `AGENTS.md` 2-pass adoption
  preview→confirm→rollback 완료. 원본 SHA-256·Git clean 복구와 private `0600` preimage 확인
- 실제 Session Catalog rebuild로 26개 JSONL에서 18개 session을 index하고 search, 11-entry
  replay, pin/tag 저장과 filter 확인
- 같은 live workspace/session을 301초 동안 유지하며 11회 새 WebSocket 재연결과 11회 worker
  health를 확인하고 직후 Runtime v2 10-check·Phase 6 12-check 통과. ADR-031/032 `Verified`
- Dependabot 10건 triage: stale/conflicting/failing 8건 근거 기록 후 종료, #1/#17은 current
  main rebase·fresh CI 통과 후 병합, open PR 0건과 Pages 재배포 성공
- `codexmux@0.4.23` public npm publish, registry tarball install/CLI/production health smoke
- 구현 commit `d405f683`의 Linux `systemd --user` live 배포, 실제 restart 전후 terminal
  smoke와 Phase 6 gate, 이전 이름 저장소의 [Issue #18](https://github.com/HardcoreMonk/codexmux/issues/18) 완료
- Workspace/Sessions/Governance 고정 탐색, Workspace Activity 명명, entity selection 접근성,
  lifecycle evidence 2,000 IPC bound와 live desktop/mobile 검증 완료

## 릴리스 전 확인

공통 및 Linux에서 확보하는 필수 검증:

```bash
corepack pnpm check:project-design
corepack pnpm build:landing
corepack pnpm check:landing
corepack pnpm lint
corepack pnpm tsc --noEmit
corepack pnpm test
corepack pnpm audit --prod
CODEXMUX_PREAUTH_SMOKE_MODE=development corepack pnpm smoke:pre-auth-bootstrap
corepack pnpm build
CODEXMUX_PREAUTH_SMOKE_MODE=production corepack pnpm smoke:pre-auth-bootstrap
corepack pnpm check:upload-memory
CODEXMUX_UPLOAD_SMOKE_MODE=development corepack pnpm smoke:upload-integrity
CODEXMUX_UPLOAD_SMOKE_MODE=production corepack pnpm smoke:upload-integrity
corepack pnpm smoke:browser-reconnect
corepack pnpm perf:session-catalog
corepack pnpm smoke:linux:session-governance
corepack pnpm smoke:browser:session-governance
corepack pnpm smoke:runtime-v2:storage-backup
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm smoke:npm-package
corepack pnpm build:electron
xvfb-run -a corepack pnpm smoke:electron:runtime-v2
```

Electron development smoke는 Linux GUI/display 경로입니다. Headless Linux에서는 위와 같이
Xvfb를 사용하고 GUI가 있는 Linux desktop에서는 직접 실행할 수 있습니다. Electron/Windows
surface를 변경하지 않은 Linux engine release에서는 Electron/Windows gate를 별도 배포면의
증거로 취급합니다. Windows runtime 증거는 `smoke:windows:packaged-runtime-v2`와
installer/package gate로 확인합니다.

## 현재 Linux live 운영 상태

| 항목 | 상태 |
| --- | --- |
| Live build | `5b0cf14f`, version `0.5.0` (2026-11-09 agentmux 전환) |
| user service | `agentmux.service` enabled, `active/running`, authenticated, port `8122`. Rollback unit `codexmux.service`(legacy)는 disable 보존 |
| Runtime v2 | terminal `new-tabs`, storage/timeline/status `default` |
| Session Catalog/Governance | Session Catalog `ready`, Governance `state=ready`, `writeState=disabled`, DB/WAL/SHM `0600` |
| governance gate | `agentmux.service.d/governance-writes.conf` 미설치 → governed write 비활성. 활성화는 별도 승인 뒤 |
| latest backup | `runtime-v2-storage-20260823T135639Z`, service 정지 중 durable/workspace state 5개, `0700/0600` |
| latest restart | 2026-11-09 18:19 KST host 재부팅 뒤 자동 시작, PID `3739`. tmux 서버는 `agentmux-tmux-codexmux.scope`(legacy socket 이름 `codexmux`) |
| issue (이전 이름 저장소 기록) | [Issue #18](https://github.com/HardcoreMonk/codexmux/issues/18), [Issue #19](https://github.com/HardcoreMonk/codexmux/issues/19), [Issue #20](https://github.com/HardcoreMonk/codexmux/issues/20) |
| 운영 handoff | `operations/2026-08-23-navigation-selection-clarity-handoff.md` |

Browser 인증 설정 뒤 `HOST=0.0.0.0` unit을 다시 시작해 실제 외부 listener를
활성화했습니다. 승인된 Phase 3 배포에서 governance write gate도 활성화했고 CLI token 기반
운영 API와 Runtime v2 worker는 정상입니다. 2026-08-22에는 `agentmux`(이전 이름 `codexmux`)를 실제 Managed Project로
등록해 adoption preview/confirm/rollback을 완료하고 Session Catalog를 실제 JSONL로 rebuild해
검색·replay·annotation을 확인했습니다. 301초 동안 동일 세션 재연결을 관찰하고 사후 gate까지
통과해 ADR-031과 ADR-032는 `Verified`입니다.
Annotation-aware pagination build `322ccfb7` 배포 뒤에는 실제 pinned/tag 조건에서
`results=1`, `total=1`, no cursor와 조건 일치를 확인하고 Phase 6 12-check를 다시 통과했습니다.
Navigation build `a6a49588` 배포 뒤에는 Workspace/Sessions/Governance current state,
Session/Managed Project selection, mobile 48px target과 console error 0건을 실제 browser에서
확인했습니다. Governance lifecycle은 236 evidence를 HTTP 200으로 반환하고 worker counter도
clean입니다.

이전 이름 저장소의 [Issue #16](https://github.com/HardcoreMonk/codexmux/issues/16) acceptance를 충족한
fresh Windows 검증:

```powershell
corepack pnpm install --frozen-lockfile
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

Baseline installer는 현재 version보다 낮은 실제 release artifact여야 합니다.
`CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_ALLOW_SYNTHETIC=1`과 Non-Windows의
`{ skipped: true }`는 ADR-027의 Windows release 증거가 아닙니다.

Tag workflow는 고정된 baseline tag/SHA-256, fresh Windows package/release gate, prerelease
게시, exact target-tag published update apply, stable 승격을 순서대로 수행합니다. Prerelease
게시 전에 실패하면 Release와 asset을 만들지 않고, 게시 후 실패하면 candidate를 prerelease로
남깁니다. Browser, Windows package, published updater artifact는 privacy scanner를 통과해야
업로드되며 scanner 실패도 stable promotion을 차단합니다.

`v0.4.20`은 legacy [workflow 29161183240](https://github.com/HardcoreMonk/codexmux/actions/runs/29161183240)에서
fresh Windows package/upload와 published updater 기능 경로를 최초 완료했습니다. 후속
재감사에서 published-updater JSON 2개를 privacy-safe evidence에서 제외했고 token이나
credential은 발견하지 않았습니다.

보존된 기준 `v0.4.22`는
legacy [workflow 29219010240 attempt 3](https://github.com/HardcoreMonk/codexmux/actions/runs/29219010240)에서
실제 `v0.4.21` installer와 SHA-256
`0e54fafe6465474e0092228a128755fdb04eba3698d8f2daf00327ad7bb24aaa`를 baseline으로
package `394584ms`, upload integrity `11724ms`, local updater `240046ms`, release gate
`17878ms`, exact target-tag published updater `254840ms`와 stable/latest 승격을 통과했습니다.
Release tag commit은 `4af022090aa74ef3b2d7a01c9a8fd5bfe504f89a`입니다. Browser,
package, published-updater artifact를 합친 16개 JSON도 독립 privacy scan을 통과했습니다.
상세 기록은 [v0.4.22 Windows release handoff](operations/2026-07-13-v0.4.22-windows-release-handoff.md)에
있습니다.

Published update 검증:

- GitHub Release에 `latest.yml`을 올립니다.
- 같은 release에 `agentmux-Setup-<version>.exe`(legacy `codexmux-Setup-<version>.exe`)를 올립니다.
- matching `.blockmap` asset을 올립니다.
- 설치된 낮은 버전 앱 기준 published channel metadata를 확인합니다.
- `quitAndInstall` 후 새 앱 launch와 `/api/health`를 확인합니다. published install
  최초 기준 `0.4.15 -> 0.4.16`, 기능 기준 `0.4.16 -> 0.4.20`과 현재 privacy-safe 기준
  `0.4.21 -> 0.4.22` updater apply가 통과했습니다. Post-update packaged launch artifact의
  health는 `version=0.4.22`, `commit=4af0220`입니다.
- 내부 전용 배포이므로 public code signing certificate와 SmartScreen reputation은 필수 검증에서 제외합니다.
- 설치 경고나 내부 신뢰 절차가 있으면 release note와 설치 안내에 기록합니다.

## 내부 배포 단계

1. 내부 release note를 작성합니다.
2. 설치/업데이트 안내를 배포합니다.
3. 3~5명이 실제 workspace로 장시간 사용합니다.
4. Terminal 생성, workspace 생성, Codex session mapping, updater, 종료/재실행을 확인합니다.
5. 문제가 없으면 내부 전체 배포로 확장합니다.

## 릴리스 검증 현황

`v0.4.22` release gate와 stable/latest 승격은 완료됐습니다. 다음 표의 장시간 관찰은 기존
`v0.4.16` 근거를 보존합니다. Cookie namespace의 release/package 근거는 확보했지만 실제 old
Electron profile의 1회 재로그인과 재연결은 별도 후속 근거가 필요합니다.

| 항목 | 상태 |
| --- | --- |
| GitHub-hosted release asset과 published metadata | 완료: stable/latest `v0.4.22`의 `latest.yml`, NSIS installer, matching `.blockmap`, Windows zip 정확한 네 asset 확인 |
| 실제 설치된 낮은 버전 앱에서 GitHub-hosted 최신 버전으로 `quitAndInstall` | 완료: 실제 `v0.4.21` installer baseline에서 exact target tag `v0.4.22`로 apply하고 post-update health `version=0.4.22`, `commit=4af0220` 확인 |
| Long-running installed app session | 완료: `CODEXMUX_WINDOWS_INSTALLED_OBSERVATION_DURATION_MS=300000`, 302,808ms 관찰, 23회 반복 실행, 모든 round `version=0.4.16`, `commit=13fe69ba`, Phase 6 gate 통과, silent uninstall 확인 |
| 제품명/app id/data dir의 codexwinmux 전환 여부 결정 | 완료: ADR-024와 `docs/operations/codexwinmux-product-line-migration.md`에 분리 기준 기록. `agentmux`(이전 이름 `codexmux`) line은 기존 Linux identity와 호환 별칭을 유지하고, `codexwinmux`는 별도 productName/appId/data dir/updater channel을 소유합니다. |
| 다음 버전 release/update smoke 반복 | 완료: `docs/operations/windows-release-update-repeat-checklist.md`에 `v0.4.21 -> v0.4.22` package/local/published update와 독립 privacy 16개 JSON 재검사 기록. 이전 반복 근거도 보존 |
| Runtime v2 live rollback drill evidence | 완료: 설치 앱에서 runtime v2 `on -> CODEXMUX_RUNTIME_V2=0 -> restored` 전환, disabled health `404 runtime-v2-disabled`, 복구 후 Phase 6 gate 통과 |
| 측정 기반 perf tuning | 완료/비차단: `corepack pnpm perf:timeline-jsonl` synthetic 5,000 entries parse `18.57ms`, virtualization 권고 유지. session list cold index refresh는 비차단 응답으로 조정했고 package/installed runtime v2 worker counter는 Phase 6 gate에서 clean 확인 |
| Phase 6 closeout | 완료: packaged runtime v2 smoke, 설치 관찰 smoke, rollback drill에 Phase 6 health/perf gate 반영 |
| 이전 이름 저장소 [Issue #16: Production upload fresh Windows evidence](https://github.com/HardcoreMonk/codexmux/issues/16) | 완료: `v0.4.20` 기능 검증, `v0.4.21` privacy-safe 재검증과 `v0.4.22` 반복 검증, ADR-027/028 `Verified` |
| Purplemux/이전 이름 Codexmux same-host cookie isolation | `v0.4.22` release와 fresh-profile updater 검증 완료. 기존 Electron profile에서 이전 이름 Codexmux 재로그인, 필요 시 Purplemux 재로그인, Runtime v2 WebSocket/upload 재연결을 직접 확인해야 하므로 ADR-029는 `Implemented` 유지 |
| Purplemux 선택 기능 도입 | 완료: ADR-025 `Verified`, `docs/operations/2026-08-14-purplemux-selected-adoption-handoff.md`. Windows package 실기 검증은 이 범위의 완료 조건에서 제외 |
| Linux Session Operations/Project Governance | 완료: 구현·live 배포·restart·Issue #18 종료와 301초·11회 동일 세션 재연결 관찰. ADR-031 `Verified` |
| Governed Project Scaffold Phase 3 | 완료: `9d32d049` live 배포, write gate 활성화, private backup, scaffold/Linux/browser/Phase 6 smoke와 Issue #19 근거 확보 |
| Governed unmarked adoption | 완료: `f46410b4` live 배포와 실제 `agentmux`(이전 이름 `codexmux`) Managed Project의 `AGENTS.md` adoption preview/confirm/rollback. ADR-032 `Verified` |
| Navigation Selection Clarity | 완료: `a6a49588` live 배포, desktop/mobile App Area current state, entity selection, terminal/reconnect 10-check와 Phase 6 12-check 통과 |

## 비차단 항목

| 항목 | 결정 |
| --- | --- |
| Public code signing certificate trust | 내부 전용 앱이라 release blocker가 아님 |
| SmartScreen reputation | 내부 전용 앱이라 release blocker가 아님 |
| Artifact scanner enumeration hardening | 현재 writer는 lowercase regular `.json`만 생성합니다. 대소문자 확장자와 symlink를 명시적으로 거부하는 방어 강화는 후속 비차단 작업입니다. |
| Browser setup과 외부 bind | fresh config는 local setup 상태입니다. 사용자 비밀번호 설정과 loopback 밖의 bind는 별도 운영 선택이며 현재 engine health blocker가 아닙니다. |
| Session Catalog filter total | 완료: `0.4.24` live 배포 뒤 annotation selection이 적용된 실제 pinned/tag filter에서 `results=1`, `total=1`, no cursor와 조건 일치를 확인했습니다. |
| npm `0.4.24` release gate | Source/package version과 Linux live service는 `0.4.24`입니다. Registry publish는 수행하지 않아 public `latest`는 확인 기준 `0.4.23`이며 remote tag/GitHub Windows Release와 Trusted Publisher도 별도 gate입니다. |
| Local `v0.4.23` tag | Registry `gitHead`와 같은 `ef27e297`을 유지하되 remote에 게시하거나 이동하지 않습니다. 다음 release는 새 version/tag를 사용합니다. |

## 별도 lifecycle이 필요한 후속 범위

다음 항목은 이번 read-only release의 연장이 아니며 각각 새 writing-spec, domain-architecture,
Plan Grilling, plan review와 별도 release gate를 거쳐야 합니다.

| 범위 | 현재 결정 | 다음 acceptance의 핵심 |
| --- | --- | --- |
| Phase 3 추가 write | lifecycle draft, delete/move/sync와 automatic/full-file adoption은 미구현 | 각각 별도 spec에서 ownership, conflict UX, retention과 rollback dependency 정의 |
| Remote topology | collector, remote node, multi-engine federation 미지원 | engine authority, credential, ordering, partition/reconnect와 data residency |
| GSD orchestration | GSD CLI/UI, FastAPI/Python collector, 원본 Bash 실행 미도입 | provenance, allowlist, cancellation, audit와 lifecycle ownership |
| Full-output search | bounded message search/snippet만 제공 | secret/terminal output policy, quota, encryption/retention과 explicit opt-in |
| npm 첫 배포(보류) | `@hardcoremonk/agentmux@0.5.0` 수동 첫 배포, `codexmux`(legacy package) deprecate, trusted publisher 연결 미실행. `v0.5.0` tag push는 Windows release workflow도 실행하므로 별도 결정 | 첫 배포 절차, tag 정책과 Windows release 분리 여부, deprecate 문구 |
| Data 실제 이전 | `~/.codexmux`가 실제 경로이고 `~/.agentmux`는 별칭 | rollback 창 종료 뒤 `~/.agentmux` 실제 이전, `codexmux.service`와 옛 checkout 정리 |
| Multi-agent (Claude Code + Codex) | brainstorming 중. 한 화면 동시 실행, 일 나누기, 상호 리뷰가 목표이고 Herdr `hc`/desktop app이 참고 모델. 위임 자동화(옛 3번 프로젝트) 통합 여부 미정. `operations/2026-11-10-multi-agent-brainstorming-handoff.md` | 사람 개입 시점, 위임 주체, Claude Code 상태 감지 방식, agent 간 회신 계약을 정한 설계 문서 승인 |
| Android 앱 `0.5.0` | Linux 서버 client 유지로 결정. Launcher 표시 문구 정리, product name gate 범위 확장, debug/release APK와 release AAB 빌드(label agentmux, `versionCode=500`, app ID와 release 서명 인증서 유지) 완료. 실제 폰(debug 서명 `0.4.7`)에 debug APK를 덮어써 `0.5`로 올리고 `smoke:android:foreground` 통과 | 폰 앱을 debug 서명으로 유지할지, 재설치(저장 주소·로그인 초기화)로 release 서명에 옮길지 결정. `smoke:android:recovery`는 저장 주소를 건드릴 수 있어 미실행 |

## Codex lifecycle 기준

- `domain-architecture` pass를 `superpowers:brainstorming / writing-spec` 뒤, `grill-me` 앞에 둡니다.
- `writing-spec`은 brainstorming의 설계 산출물로 취급하고 별도 gate로 보지 않습니다.
- `plan-design-review`는 non-UI workflow에서도 information architecture, gate clarity, operator error prevention, discoverability를 봅니다.
- `plan-eng-review`는 domain architecture pass가 module boundary, data flow, test strategy, rollback path에 미치는 영향을 검토합니다.

## Approval workflow 기준

- Approval queue metadata는 sanitized projection입니다.
- Durable audit은 `approval-audit.jsonl`의 enum/action/push outcome 중심 log로 제한합니다.
- Raw command, prompt body, full path, terminal output은 장기 저장하지 않습니다.

## App-server adapter 기준

- Windows app close와 backend lifecycle을 분리해야 합니다.
- 권장 방향은 tray-first engine host입니다.
- App shell의 local/remote server URL 해석은 `electron/app-server-protocol.ts` contract를 따릅니다.
- 창 닫기는 window hide, 명시적 종료는 engine shutdown으로 구분합니다.
- Windows Service는 내부 배포 안정화 후 elevation/installer ownership과 함께 검토합니다.

## 모바일 앱

Android는 Linux engine에 접속하는 선택 client입니다. Session/runtime authority로 확장하거나
Linux engine acceptance를 Android smoke로 대체하지 않습니다.

## 아키텍처 모듈화

- Terminal runtime adapter 경계를 유지합니다.
- Process inspector와 Codex session detection policy를 분리합니다.
- Host operation은 service/tray/installer boundary로 격리합니다.
- Open-ended cleanup이 아니라 accepted plan에 포함된 후보만 refactor합니다.

## 성능

- Runtime v2 worker counter와 `/api/debug/perf` snapshot으로 측정합니다.
- 긴 대화/대형 JSONL은 `corepack pnpm perf:timeline-jsonl` snapshot으로 먼저 분류합니다.
- Package smoke와 실제 installed app 장시간 사용 evidence를 우선합니다.

## 문서와 운영

- Canonical 문서는 한국어로 유지합니다.
- GitHub Pages source와 artifact gate는 PR #22, 제품 재설계는 PR #24, 배포 handoff는 PR #25로
  main에 병합했습니다. 공개 landing, 양 언어 guide, robots/sitemap/404 smoke가 통과했습니다.
- 2026-08-24 public site shell 리뉴얼은 feature `e6c17edd`, main merge `b73637bf`와 live focus
  hotfix `b0bfed43`으로 배포했습니다. Pages run `32655553787`, `32656043852`와 final desktop/mobile
  HTTPS smoke를 통과해 `operate`에 진입했습니다.
- 실제 release/smoke 결과는 `docs/operations/` handoff에 추가합니다.
- 과거 logs/specs는 기록 보존을 위해 재작성하지 않습니다.
- 2026-05-07 이후 100% closeout 배치는 CODEX panel timeline hotfix 회귀도 자동 row로 포함합니다. 권장 closeout 명령은 `CODEXMUX_BACKLOG_COMPLETION_ALLOW_DEFER=1 CODEXMUX_SMOKE_ARTIFACT_DIR=/tmp/agentmux-backlog-complete corepack pnpm ops:backlog:complete`입니다.
