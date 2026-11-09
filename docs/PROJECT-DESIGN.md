# 프로젝트 설계 요약

agentmux는 코딩 에이전트 웹 세션 매니저입니다 (현재 Codex 지원, Claude Code 지원 예정). 범용 터미널 대시보드가 아니라
여러 코딩 에이전트 세션을 브라우저에서 실행, 재개, 모니터링, 검토하기 위한 도구입니다.
터미널 접근은 runtime adapter 경계 뒤에 두고, Codex 작업은 status badge와
timeline 중심으로 보여줍니다.

Active runtime target은 Linux 단일 엔진 호스트입니다. 한 호스트가 custom server,
Runtime v2 worker, tmux, Codex CLI/JSONL, app-owned DB와 등록된 project read/governed write를 소유합니다.
Windows installer/updater는 보존된 별도 배포면이며 이번 Session Operations와 Project
Governance acceptance를 대체하지 않습니다.

2026-08-23 현재 live app build commit `a6a49588`, version `0.4.24`가 `HOST=0.0.0.0`, port `8122`의
`systemd --user` service로 배포되어 실제 `0.0.0.0:8122` listener와 구성된 browser 인증을
제공합니다. `AGENTMUX_GOVERNANCE_WRITES=1`(legacy `CODEXMUX_GOVERNANCE_WRITES=1` 호환)이 systemd drop-in에서 활성화됐고 Governance
`writeState=ready`입니다. 실제 restart, Managed Project adoption/rollback, Session Catalog
rebuild/search/replay/annotation과 같은 live session의 301초·11회 재연결 관찰을 통과했습니다.
관찰 직후 Runtime v2 10-check와 Phase 6 12-check도 통과해 ADR-031과 ADR-032는
`Verified`입니다. Annotation-aware pagination 배포 뒤 실제 pinned/tag 검색도 결과 1건과 exact
total 1건으로 일치합니다. Navigation 배포에서는 terminal/reconnect 10-check, Phase 6 12-check,
Governance lifecycle 236-evidence와 desktop/mobile browser gate를 통과했습니다.

## 구현 상태

- 서비스 이름과 실행 파일은 `agentmux`, 짧은 별칭은 `amux`입니다 (legacy `codexmux`/`cmux` 호환 별칭 유지).
- 데이터 디렉터리는 `~/.agentmux`(legacy 실제 경로 `~/.codexmux`), tmux socket은 `-L codexmux` 및 `codexmux-runtime-v2`, CLI header는 `x-agentmux-token`(legacy `x-cmux-token` 호환)입니다.
- provider registry에는 `codex` panel type만 등록합니다.
- Browser는 Codex command를 직접 조립하지 않고 workspace/pane/tab launch intent만 보냅니다. Server는 layout ownership, 안전한 shell, Codex `0.144.1+` preflight를 확인한 뒤 실행 또는 `codex resume <sessionId>` command를 만듭니다.
- Codex hook event는 native session-layer TOML override와 HMAC tab/session capability를 사용해 standalone `~/.agentmux/status-hook.cjs`(legacy 실제 경로 `~/.codexmux/status-hook.cjs`)로 전달합니다. User/project/managed/plugin hook은 Codex native discovery가 보존합니다.
- process detection은 tmux pane 아래의 `codex` process를 찾고 session id, process start time, live process cwd fallback 순서로 JSONL path를 연결합니다.
- timeline, history, stats, daily report와 rate-limit observation은 `~/.codex/sessions/**/*.jsonl`을 읽어 구성합니다.
- Timeline은 exec, web search, MCP, patch, error/warning, context compaction을 semantic row로 표시합니다. Detail은 secret-like redaction, field 4KiB, entry 16KiB 상한을 적용하고 full output/download/local image serving은 제공하지 않습니다.
- Rate-limit은 5시간/7일 window별 최신 `observed_at`을 보존하며 reset 뒤 새 관찰이 없으면 0%를 합성하지 않고 `갱신 대기`로 표시합니다.
- session list는 `~/.agentmux/session-index.json`(legacy 실제 경로 `~/.codexmux/session-index.json`) snapshot을 먼저 읽고, cold refresh 중이면 현재 snapshot을 표시한 뒤 재조회합니다.
- `~/.codex`는 Codex CLI 소유 데이터이며 agentmux는 읽기 전용으로만 접근합니다.
- Session Catalog는 Timeline Worker가 JSONL read/watch와 app-owned 검색 index를 단독으로
  소유하는 재생성 가능한 projection입니다.
- Managed Project의 durable catalog는 Storage Worker가 소유합니다. Governance Worker는 registered
  project read, Knowledge Index와 versioned scaffold의 유일한 writer입니다. 쓰기는
  `AGENTMUX_GOVERNANCE_WRITES=1`(legacy `CODEXMUX_GOVERNANCE_WRITES=1` 호환)에서만 열리고 제품 기본값은 off입니다. 현재 live Linux
  service는 승인된 systemd drop-in으로 이 gate를 활성화했습니다.
- Workspace, Sessions, Governance는 고정된 1차 App Area입니다. Workspace 내부 Activity는
  Session Catalog route와 다른 local context이며 utility surface에서는 어느 core area도 current로
  표시하지 않습니다. Route, entity selection, disclosure와 focus는 각각 별도 상태를 사용합니다.
- terminal과 Codex 입력 포커스의 `Ctrl+D`는 앱 단축키가 아니라 EOF/EOT로 전달합니다. Codex 입력 바 제출은 bracketed paste + Enter frame과 후속 Enter로 처리합니다.
- 모바일 foreground 복귀 시 terminal/status/timeline/sync WebSocket은 stale `OPEN` 상태를 신뢰하지 않고 재연결할 수 있습니다.
- 성능 최적화는 `/api/debug/perf` snapshot으로 계측한 뒤 좁게 적용합니다. timeline append/render, diff, stats는 기준 데이터를 바꾸지 않는 batch/memo/short cache를 우선합니다.
- 최초 setup process는 저장된 network access나 `HOST`보다 먼저 loopback에만 bind합니다. Setup claim이 끝나도 listener 확대는 restart 뒤 적용합니다.
- `config.json`의 malformed JSON, I/O 오류, hash-only 인증 상태는 setup으로 downgrade하지 않고 startup/request를 fail closed합니다.
- setup POST는 startup claim latch, loopback Host, same-authority Origin, JSON media type을 요구합니다. `/api/install`은 generic WebSocket 예외가 아니라 setup-local lease 또는 session admission을 사용합니다.
- `/api/upload-image`와 `/api/upload-file`은 Next proxy/Pages route가 아니라 outer custom server가 소유합니다. Image/file limit은 10MiB/50MiB이고, successful publish는 same-directory hard link의 no-replace commit입니다.
- Linux 단일 엔진은 source checkout 또는 npm standalone server(`@hardcoremonk/agentmux`)로 실행합니다. Windows Electron installer/updater와 npm registry package는 ADR-030의 독립 배포면이며 npm tarball은 CLI bin, standalone server와 다섯 Runtime v2 worker bundle을 제공합니다.
- Public npm `latest`는 `@hardcoremonk/agentmux`로 전환 중이며, 이전 이름 `codexmux@0.4.23`에서 registry tarball install, CLI help와 production
  health smoke를 통과했습니다. Local `v0.4.23`은 registry `gitHead`와 같은 `ef27e297`을
  가리키지만 remote tag는 없습니다. 이 tag를 그대로 push하면 tag snapshot에 없는 release
  note를 요구하는 Windows release workflow가 실패하므로 원격 publish는 보류했습니다.
  Trusted Publisher는 npm CLI 인증 만료로 등록하지 못했습니다. `0.4.24` source와 Linux live
  service는 검증·배포됐지만 registry publish는 수행하지 않아 public `latest`는 계속 `0.4.23`입니다.
  Remote tag/GitHub Windows Release와 Trusted Publisher 등록도 별도 배포면으로 유지합니다.
- Public 랜딩과 사용자 가이드는 Eleventy로 `_site/`를 만들고 GitHub Pages
  `https://hardcoremonk.github.io/agentmux/`에 배포합니다. 메인 제품 정보 구조는 Session
  Operations, Live Session Control, Project Governance, Runtime Operations를 기준으로 하며,
  구현 완료·보호된 작업·현재 제외 범위를 분리합니다. Home/docs는 floating header, global search,
  Auto/Light/Dark theme와 mobile menu를 공유하고, homepage는 hero, quickstart, code-native product
  proof, capability bento와 docs map 순서입니다. Root 신규 핵심 guide는 English, `/ko/`는 Korean을
  제공하고 Pages artifact checker가 canonical, 내부 link, shared shell과 product content contract를
  검증합니다.
- Production dependency baseline은 Next `16.3.1`, next-intl `4.9.2`, ws `8.21.0`, js-yaml `4.2.0`과 제한된 PostCSS/Babel override이며 `pnpm audit --prod` 0건을 유지합니다.

## 주요 구성

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| provider | `src/lib/providers/codex/` | Codex adapter와 provider contract 구현 |
| command | `src/lib/codex-command.ts` | Codex launch/resume command 생성 |
| agent launch | `src/lib/agent-launch-service.ts`, `src/pages/api/agent/launch.ts` | Server-side ownership/preflight와 terminal write |
| session hook | `src/lib/providers/codex/session-hooks.ts`, `src/lib/hook-settings.ts` | Native hook serialization, capability, Node bridge 생성 |
| detection | `src/lib/codex-session-detection.ts` | process tree와 JSONL session 연결 |
| parser | `src/lib/codex-session-parser.ts` | Codex JSONL을 timeline entry로 변환 |
| timeline presentation | `src/lib/rich-timeline-presentation.ts` | Semantic entry의 icon/label/summary/meta/status projection |
| rate limit | `src/lib/codex-rate-limits.ts`, `src/lib/rate-limit-view.ts` | Window observation parse/merge와 freshness projection |
| Git refresh | `src/hooks/use-git-refresh-generation.ts`, `src/lib/git-refresh-generation.ts` | Stop generation 공유와 session별 consume 정책 |
| stats | `src/lib/stats/` | token, cost, session, daily report 집계 |
| session catalog | `src/lib/session-catalog/` | session metadata, bounded message search와 rebuildable index |
| project governance | `src/lib/governance/` | approved root, knowledge read model, scaffold preview/transaction/복구 |
| project lifecycle | `src/lib/project-lifecycle/` | project-local artifact discovery, stage derivation과 lint |
| app navigation | `src/lib/app-navigation.ts`, `src/components/layout/app-area-navigation.tsx` | route 기반 App Area와 desktop/mobile current-state projection |
| status | `src/lib/status-manager.ts` | tab state, polling, Web Push, WebSocket broadcast |
| bootstrap security | `src/lib/server-bootstrap.ts`, `src/lib/request-authority.ts` | strict auth state, startup exposure, Host/Origin admission |
| install admission | `src/lib/install-request-auth.ts`, `src/lib/install-server.ts` | typed install auth, atomic PTY slot, setup lease, bounded I/O |
| upload contract/auth | `src/lib/upload-request-contract.ts`, `src/lib/upload-request-auth.ts` | raw target/header, session/CLI, Host/Origin/framing 계약 |
| upload admission/server | `src/lib/upload-admission.ts`, `src/lib/upload-server.ts` | active/reserved budget, timeout, Expect, shutdown ownership |
| upload storage | `src/lib/uploads-store.ts` | staged streaming, no-replace publish, committed/staged cleanup |
| outer HTTP composition | `src/lib/server-http-dispatcher.ts`, `server.ts` | dev/prod upload 선점, Next fallback, signal drain |
| npm distribution | `package.json`, `scripts/smoke-npm-package.mjs`, `.github/workflows/npm-publish.yml` | CLI tarball 계약, 격리 install/run smoke, OIDC publish |
| public docs | `landing-src/`, `scripts/check-landing-site.mjs`, `.github/workflows/deploy-landing.yml` | GitHub Pages shared home/docs shell, theme/search, canonical·link·content gate와 배포 |
| performance | `src/lib/perf-metrics.ts` | runtime metric, duration/counter, 인증된 성능 스냅샷 |
| docs | `docs/ARCHITECTURE-LOGIC.md` | 서버와 서비스 로직의 최신 구현 기준 |

## 데이터 모델

새 layout과 status payload는 다음 neutral field를 사용합니다.

- `panelType: "codex"`
- `agentSessionId`
- `agentJsonlPath`
- `agentSummary`

Workspace 이름과 group은 `workspaces.json`이 기준 데이터이며, rename/group
변경은 sync event로 모든 client에 전파합니다.

Session Catalog의 session/message/file cursor/health는 `session-catalog/index.db`의 재생성 가능한
projection입니다. Pin/tag와 saved filter, Approved Project Root, Managed Project/import와
sanitized governance audit는 `runtime-v2/state.db`의 durable state입니다. Knowledge Index는
`governance/index.db`에 문서 metadata와 관계만 저장하고 project 문서 본문은 저장하지 않습니다.
일반 API 응답에는 root/project canonical path를 포함하지 않습니다.

2026-08-22 live rebuild는 `~/.codex/sessions`의 JSONL 26개에서 18개 session을 index했고,
검색과 11-entry replay, pin/tag 저장 및 filter를 확인했습니다. Annotation-aware pagination
배포 뒤 pin/tag filter는 `results=1`, exact `total=1`, no cursor로 조건과 일치합니다.
Project Lifecycle snapshot은 project document response와 같은 maximum 2,000 evidence로 bounded하며
현재 등록 project의 236개 evidence가 HTTP 200으로 검증됐습니다.

Governed scaffold는 `AGENTS.md`, `CONTEXT.md`, 조건부 `DESIGN.md`와 세 `docs/agents/` 문서를
버전 고정 catalog에서 render합니다. Existing unmarked file은 자동 채택하지 않습니다. 첫
preview의 `adoption-available` artifact 중 사용자가 개별 선택한 file만 별도 compact adoption
marker block을 EOF에 append하고 기존 bytes를 exact prefix로 보존합니다. Private preimage와 journal은
`~/.agentmux/backups/governance-actions/<project-id>/<action-id>/`(legacy 실제 경로 `~/.codexmux/backups/...`)에 저장합니다.

오래된 provider alias는 runtime에서 허용하지 않습니다. 새 기능도
provider-neutral boundary 또는 Codex provider 내부에 추가합니다.

## 리스크

- Codex JSONL 형식은 CLI 버전에 따라 바뀔 수 있습니다. parser는 permissive하게 두고 fixture를 계속 보강합니다.
- Hook event는 best-effort observer입니다. Bridge가 실패해도 Codex action을 막지 않고 JSONL/process polling으로 상태를 재조정합니다.
- Codex CLI가 process 시작 후 JSONL을 늦게 쓰는 경우가 있어 process start time 매칭은 여유를 두고, cwd fallback은 live Codex process가 확인된 경우에만 씁니다.
- `~/.codex`에는 auth와 local history가 들어갈 수 있으므로 원본 config/auth 파일을 브라우저에 노출하지 않습니다.
- process detection은 플랫폼 의존성이 큽니다. Linux `/proc`, `pgrep`, `ps` fallback은 helper에 격리합니다.
- foreground reconnect 중 timeline init/append가 겹칠 수 있으므로 stable id와 near-duplicate 제거가 UI 중복 방지의 핵심입니다.
- timeline virtualization과 adaptive status polling은 scroll anchoring, notification, unknown 복구 지연 리스크가 있어 성능 스냅샷 수치가 쌓인 뒤 단계적으로 검증합니다.
- Codex app-server protocol은 안정화 전까지 post-MVP 후보로 둡니다.
- setup-local install은 사용자 권한의 arbitrary PTY stdin을 허용하는 legacy adapter입니다. Elevated/multi-user service와 Windows host-owned install action은 별도 capability/host boundary가 필요합니다.
- Upload directory validation은 user-scoped data directory와 동일 사용자 local process를 신뢰합니다. Windows hard-link/delete와 packaged kill-switch는 `v0.4.20`에서 최초 검증하고 `v0.4.21`에서 privacy gate와 함께 반복했으며, 이후 stable release도 같은 package gate를 실행해야 합니다.
- npm registry publish와 GitHub Windows stable promotion은 독립적으로 실패할 수 있습니다. 같은 source version의 공개 시점 차이는 각 배포면의 post-publish smoke와 handoff에 기록합니다.
- Linux 단일 엔진은 단일 장애 지점입니다. Core worker와 Governance Worker의 readiness를 분리하고 projection quarantine/rebuild와 durable state backup/restore를 운영 gate로 유지합니다.
- 승인 root 아래라도 symlink, nested mount, nested worktree와 scan quota 경계가 바뀔 수 있으므로 Governance Worker는 refresh/read마다 canonical containment를 다시 검증합니다.

## MVP 이후 방향

- app-server adapter가 안정화되면 approval/status event만 단계적으로 도입합니다.
- 전체 세션의 pending approval을 모아 보는 approval queue를 만듭니다.
- fork/sub-agent 관계를 UI에 표시합니다.
- Codex CLI 버전별 JSONL fixture와 smoke test를 확장합니다.
- Automatic/full-file adoption, arbitrary project write/delete/move/full sync, remote/multi-engine
  topology, GSD orchestration과 full-output search는 각각 별도 lifecycle로 설계합니다.
