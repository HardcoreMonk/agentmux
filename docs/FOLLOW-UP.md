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
| Live build | `d1accfc6`, version `0.5.0` (2026-11-11 hotfix #48 배포: Claude JSONL의 catalog `observeFile` 거절이 timeline worker를 죽이던 결함. 이전 live는 단계 2 `f46890ba`, 단계 2 Task 1 `47ea57e7`, 단계 1 `19a44ca8`, logo 수정 `e369598b`, agentmux 전환 build는 `5b0cf14f`) |
| user service | `agentmux.service` enabled, `active/running`, authenticated, port `8122`. Rollback unit `codexmux.service`(legacy)는 disable 보존 |
| Runtime v2 | terminal `new-tabs`, storage/timeline/status `default` |
| Session Catalog/Governance | Session Catalog `ready`, Governance `state=ready`, `writeState=disabled`, DB/WAL/SHM `0600` |
| governance gate | `agentmux.service.d/governance-writes.conf` 미설치 → governed write 비활성. 활성화는 별도 승인 뒤 |
| latest backup | `runtime-v2-storage-20260823T135639Z`, service 정지 중 durable/workspace state 5개, `0700/0600` |
| latest restart | 2026-11-11 02:35 KST `deploy:local` 재시작(hotfix #48, 사용자가 직접 실행), PID `1705635`(NRestarts 0), health commit `d1accfc6`, worker 재시작 02:35:38, service log error 0. 같은 날 02:16 KST 단계 2 배포(health `f46890ba`, PID `1471777`). 이전 2026-11-10 21:18 KST 재시작은 PID `2865470`, health `47ea57e7`. tmux 서버 `43870`과 session 1개는 재시작 전후 유지. tmux 서버는 `agentmux-tmux-codexmux.scope`(legacy socket 이름 `codexmux`) |
| issue (이전 이름 저장소 기록) | [Issue #18](https://github.com/HardcoreMonk/codexmux/issues/18), [Issue #19](https://github.com/HardcoreMonk/codexmux/issues/19), [Issue #20](https://github.com/HardcoreMonk/codexmux/issues/20) |
| 운영 handoff | `operations/2026-08-23-navigation-selection-clarity-handoff.md` |

Claude Code provider 운영 기록(2026-11-11): 단계 2는 main merge 뒤 02:16 KST에 배포했습니다(health `f46890ba`).
Live catalog가 shadow mode인 상태에서 Claude JSONL의 `catalog.observeFile` 거절이 처리되지 않아 timeline worker가
죽는 결함을 hotfix #48(`d1accfc6`, CI 성공)로 고쳐 02:35 KST에 배포했습니다(worker 재시작 02:35:38, log error 0).
원격 branch `feat/claude-provider-phase2`, `fix/timeline-catalog-observe-rejection`는 사용자가 지웠습니다. 단계 3 배포 때는
통계 cache(legacy 실제 경로 `~/.codexmux/stats/cache.json`, 현재 v4, 2026-03-26부터 127일, claude-* model은 03-26~04-27에만 있음)가 첫 통계
요청에서 `cache.v4.json`으로 한 번 복사된 뒤 v5로 옮겨집니다(Claude 사용량은 첫 Claude transcript 날짜 2026-10-11부터 더함).
배포 뒤 이 이동을 확인합니다.

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
| Purplemux 기능 추가 | 사용자 결정(2026-11-10)으로 purplemux에 있고 agentmux에 없는 기능(Claude Code provider, 공통 agent 기반, 위임 안내 주입, Codex 보조, Git side panel 등)을 추가. 목록은 `PURPLEMUX-ADOPTION-AUDIT.md` 보충 분석. 순서 확정: 설계 1(A+B+C) → 설계 2(D+E) → 설계 3(회신·상호 리뷰). 설계 1: `superpowers/specs/2026-11-10-claude-code-provider-design.md`(승인, 위임은 확인 없이 진행). 단계 1(agent 경계 정리)은 main `19a44ca8`로 merge·live 배포. 단계 2(Claude provider core, plan `superpowers/plans/2026-11-10-claude-code-provider-phase2.md`): Task 1은 main `47ea57e7`로 먼저 merge·live 배포, Task 2~10은 branch `feat/claude-provider-phase2`(`e0b03c25..` 이후)에서 구현·검토·전체 gate·격리 live smoke 완료. Branch 최종 검토 수정(`d5f3432a`)과 격리 live 재확인 완료. 결과는 `operations/2026-11-10-multi-agent-brainstorming-handoff.md` | PR과 main CI 통과 뒤 merge. Live 배포는 사용자 확인 뒤(rollback 시 Claude 탭을 먼저 닫음). 이어서 단계 3(통합 세션 목록, Session Explorer, 통계, 설정, onboarding, 전환 잠금 등) plan. Runtime v2 agent 탭 지원(hook 인증, 상태 감시, timeline process 찾기, storage `panel_type`, 화면 캡처·key 입력)은 설계 1 범위 밖 후속 |
| Multi-agent (Claude Code + Codex) | brainstorming 중. 한 화면 동시 실행, 일 나누기, 상호 리뷰가 목표이고 Herdr `hc`/desktop app이 참고 모델. 위임 자동화(옛 3번 프로젝트) 통합 여부 미정. `operations/2026-11-10-multi-agent-brainstorming-handoff.md` | 사람 개입 시점, 위임 주체, Claude Code 상태 감지 방식, agent 간 회신 계약을 정한 설계 문서 승인 |
| Android 앱 `0.5.0` | Linux 서버 client 유지로 결정. Launcher 표시 문구 정리, product name gate 범위 확장, debug/release APK와 release AAB 빌드(label agentmux, `versionCode=500`, app ID와 release 서명 인증서 유지) 완료. 실제 폰에서 debug `0.5`로 `smoke:android:foreground` 통과 뒤 사용자 결정으로 signed release `0.5`로 재설치(저장 주소·로그인 초기화) | 웹 UI logo(`app-logo.tsx`)의 옛 이름은 `e369598b`로 고쳐 live 배포했고 폰에서 `agent`+`mux` 표시 확인. Branch push와 PR. Release 앱은 WebView devtools가 꺼져 CDP smoke 대상이 아님 |

## Claude Code provider 단계 2 후속

단계 2 task별 검토에서 merge를 막지 않는다고 판단해 넘긴 항목과 격리 live smoke에서 찾은 항목입니다.

2026-11-11 branch 최종 검토 수정으로 닫은 항목: 권한 요청 "No" 뒤 `busy` 고정(중단된 turn은 JSONL interrupt 표시로
`idle`, `STATUS.md` "Claude Code hook 상태 경로"), 모바일 탭 이름 폭(440px 미만에서 보기 전환 버튼 4개를 현재 보기
메뉴 버튼 하나로 접음), `providers.test.ts` test 이름. 같은 수정에서 JSONL rate limit을 읽은 provider id로 발행하고
hook `transcriptPath`를 탭 provider root로만 검사하게 했습니다.

| 항목 | 내용 |
| --- | --- |
| 줄바꿈된 권한 선택지 | `permission-prompt.ts`의 soft-wrap 이어 붙이기가 공백 없이 붙여 Claude 선택지가 "filecommands"처럼 보인다(기존 코드, Claude 화면에서 드러남) |
| Timeline `turn-end` 2개 | Claude Code가 한 turn에 `stop_hook_summary`와 `turn_duration`을 둘 다 쓰고 `session-parser.ts`가 둘 다 `turn-end`로 바꾼다. 화면 영향 미확인 |
| Server 종료 때 worker `EPIPE` | 격리 server를 SIGINT로 끌 때 timeline worker가 부모 IPC에 `process.send`하다 처리되지 않은 `EPIPE`로 끝났다. 단계 2가 바꾸지 않은 종료 경로 |
| Hook option type 중복 | hook option shape(`notificationType`, `agentSessionId`, `transcriptPath`, `source`)가 `status-manager.ts`, `runtime/status/worker-service.ts`, `api/status/hook.ts` 세 곳에 따로 정의됨. 한 type으로 export |
| Status 다시 묶기 test | StatusManager 수준의 rebind 배선 test가 없음(`status-hook-api.test.ts`의 provider mock은 이제 `panelType`별 root를 봄) |
| Relaunch 직후 상태 | 다시 실행한 탭의 in-memory status entry `jsonlPath`가 첫 `SessionStart` hook 전까지 이전 session을 가리킬 수 있고, `agentSummary`는 relaunch 때 지우지 않음 |
| Claude process 감지 | process 인자 regex가 `/claude`로 끝나는 인자 경로(`cat /x/claude`)도 맞춤. Command basename만 비교. Pidfile fallback이 pane tree의 모든 PID를 시도함. `~/.claude/sessions` watcher error handler가 no-op(liveness poll이 보완) |
| Client 정리 | `sidebar-rate-limits.tsx`가 `getAgentProviderMeta` 대신 `AGENT_PROVIDER_META`를 직접 읽음. `createTrustPromptTracker()`가 render마다 `useRef` 초기값으로 평가됨(lazy init). Trust hook 동작은 tracker test로만 확인했고 모바일 trust 카드 배치는 browser로 보지 않음. 모바일 보기 전환 aria-label "Terminal"/"Diff"가 영어 고정(좁은 화면 보기 메뉴의 행 label도 같음, 새 탭 dialog와 같은 방식) |
| Claude 권한 요청 분류 | 기존 분류 규칙에 맞지 않는 Claude 화면(header 없는 "Do you want to proceed?" 등)은 `promptType: unknown`으로 남아 approval queue의 위험·종류 표시가 덜 구체적. "Bash command" header는 `command`, Write "Create file"은 `file`로 분류됨 |
| 단계 3으로 넘김 | `findClaudeBinary`가 `findCodexBinary`와 중복(`lib/preflight.ts`). agent가 하나도 없는 호스트의 `/tools-required` 화면·표는 단계 3 Task 9에서 provider별 행으로 닫음 |
| Codex session test 불안정 | 전체 suite 부하에서 `codex-session-detection`("does not attach a session by cwd alone")과 `session-list`("lists Linux Codex sessions across workspace cwd values")가 가끔 실패하고 단독 실행은 통과. 단계 2 변경 전부터 있던 불안정으로 판단 |
| Test data dir 격리 | `tests/unit/lib/layout-store.test.ts`가 실제 data dir(legacy 실제 경로 `~/.codexmux/workspaces`) 아래 `ws-layout-store-*` directory를 만들고 지움. 이전 실행이 남긴 4개가 있고 live data dir라 지우지 않음. Test data dir를 임시 directory로 격리하고 남은 directory 정리는 사용자가 결정 |

## Claude Code provider 단계 3 후속

단계 3(공통 agent UI: 공통 session 목록과 provider 간 재개, Session Explorer provider column·filter, 통계·일일 리포트의
Claude, 전환 잠금과 보기 제안, 시작 진행 표시, Claude 설정, provider별 onboarding, 중립 문구)은 branch
`feat/claude-provider-phase3`에 구현과 검증을 마쳤고 main merge와 live 배포는 전입니다. 단계 2 후속 중 단계 3이 닫은
것은 `/tools-required`의 provider별 표시입니다. 단계 4(위임 안내, `permissions.allow`, CLI 변경)는 별도입니다.

| 항목 | 내용 |
| --- | --- |
| Live `new-tabs` mode 보기 제안 | 새 plain Terminal 탭은 Runtime v2라 agent 보기 제안이 뜨지 않음(v1 Terminal 탭만 제안). Runtime v2 agent 탭 지원과 묶음 |
| 직접 실행한 Claude의 timeline 연결 | Terminal 탭에서 직접 `claude`를 실행하면 hook이 없어 "Claude Code 세션 대기 중"과 web 입력 "연결 중"이 보임. 터미널에서 친 첫 prompt 뒤 timeline이 묶이는지 미확인 |
| `history-parser` prompt 중복 | fork/resume이 복사한 Claude prompt를 파일마다 세어 약 0.5% 과대 집계. 보류 |
| Uptime disk cache | 지난 날의 Codex 전용 값이 window가 지날 때까지 남음 |
| 일일 리포트 fallback smoke | Preflight가 알려진 install path에서 Codex를 찾아 PATH만으로 fallback 경로를 강제할 수 없음. 생성기 test 전용 override를 두면 smoke로 확인 가능(지금은 정확한 `claude -p` 인자 배열을 단위 test가, 실제 호출을 손 실행 1회가 확인) |
| Smoke tooling 메모 | 격리 `TMUX_TMPDIR`는 짧은 경로여야 함(긴 경로는 108바이트 Unix socket 한도로 tmux `new-session` 실패). Setup POST는 같은 origin의 `Origin` header 필요 |
| 통계 cache v5 확인 | 배포 뒤 첫 통계 요청에서 `cache.v4.json` 백업과 v5 이동, Claude token 표시를 live에서 확인. rollback 때는 service를 멈추고 `cache.v4.json`을 `cache.json`으로 복사한 뒤 이전 build를 시작한다(이전 build는 v5를 버리고 원본이 없는 날짜를 잃는다) |
| Codex 지난 세션 목록 확인 | 배포 뒤 live Codex 탭의 지난 세션 목록 개수와 순서가 배포 전과 같은지 확인(격리 확인에서는 Codex index 첫 scan 중이라 Codex 항목을 보지 못함) |
| 문서 외 미검증 | Claude 직접 실행 뒤 timeline 연결, 일일 리포트의 실제 Claude 생성 경로(생성기 전체) |

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
