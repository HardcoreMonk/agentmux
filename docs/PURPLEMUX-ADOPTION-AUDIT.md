# Purplemux 반영 가능성 감사

> 최초 감사 기준일: 2026-07-11
> 현행화: 2026-08-21
> Purplemux 기준: `main@52140216` (`v0.4.5`)
> Codexmux 감사 baseline: `main@cafc8de9` (`v0.4.16`)
> 감사 당시 Windows stable release: `v0.4.22@4af02209`
> 현재 제품/runtime target: ADR-031 Linux 단일 엔진, source/live `0.4.24`, public npm `0.4.23`
> 보충 분석: 2026-11-10, agentmux `main@1b7408b4` (`0.5.0`). 아래
> [보충 분석](#보충-분석-2026-11-10-서비스-기능과-agentmux-차이) 절이 본문보다 우선합니다.

## 보충 분석 (2026-11-10): 서비스 기능과 agentmux 차이

### 기준과 방법

- Purplemux `main`은 여전히 `52140216`(`v0.4.5`, 2026-07-04)입니다. 본문과 같은 commit이며 그 뒤 commit은
  없습니다. 나머지 branch는 dependabot과 `add-codex`(main에 이미 포함, 이후 commit 없음)뿐입니다.
- 본문은 "Codex 전용 제품에 무엇을 가져올까" 관점이었습니다. 이번에는 multi-agent 목표(Claude Code와
  Codex 동시 운영)에 맞춰 서비스 기능 전체를 다시 봤습니다.
- README, 문서 목록과 provider, hook, CLI, 통계, git, 권한 처리 코드를 직접 읽었습니다. 그다음 두 repo의
  `src`/`bin`/`electron` 파일 목록(purplemux 455개, agentmux 622개)을 대조하고, purplemux에만 있는 파일을
  agentmux의 다른 이름 구현과 기능 단위로 다시 맞춰 봤습니다.

### Purplemux 서비스 기능

| 영역 | 기능 | 근거 |
| --- | --- | --- |
| Agent 지원 | Claude Code와 Codex를 같은 provider interface로 지원. 탭 종류 `terminal`, `claude-code`, `codex-cli`, `agent-sessions`, `web-browser`, `diff` | `src/lib/providers/{claude,codex}`, `providers/types.ts` |
| Claude 상태 감지 | `claude --settings <file>`로 SessionStart, UserPromptSubmit, Notification, Stop, StopFailure, PreCompact, PostCompact hook과 statusLine script를 설치하고 JSONL 감시, process tree 판정을 함께 씀 | `hook-settings.ts`, `claude-command.ts` |
| Codex 상태 감지 | SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Stop, PermissionRequest hook | `providers/codex/hook-config.ts` |
| 상태 모델 | session-start→idle, prompt-submit→busy, notification→needs-input, stop→ready-for-review, compaction 별도 | `TAgentWorkStateEvent` |
| Agent 간 위임 | Agent 실행 시 "purplemux context"를 주입. Claude는 `--append-system-prompt-file`, Codex는 `-c developer_instructions=`. Workspace ID와 CLI를 알려 주고 "작업을 다른 탭에 맡기고 `status`를 조회한 뒤 `result`로 확인하라"고 안내 | `claude-prompt.ts`, `providers/codex/prompt.ts` |
| CLI·HTTP API | `workspaces`, `tab list/create/send/status/result/close`, `api-guide`, browser 탭의 `url/screenshot/console/network/eval` | `bin/cli.js`, `src/pages/api/cli/` |
| Live timeline | 메시지, tool call, exec stream, MCP, patch, plan, reasoning, web search, task checklist/진행, subagent group, compaction, 오류 | `components/features/timeline/` |
| 웹에서 응답 | 권한 요청, plan 승인, AskUserQuestion, trust/bypass 확인, Codex update prompt를 브라우저에서 처리(tmux 화면에서 선택지를 읽어 키 입력) | `api/tmux/permission-options.ts`, `plan-options.ts`, `*-card.tsx` |
| 사용량 | 5시간/7일 rate limit과 reset countdown(Claude는 statusLine payload, Codex는 JSONL), 토큰·비용·프로젝트·세션·uptime·활동 통계 | `api/status/statusline.ts`, `lib/stats/` |
| 일일 AI 리포트 | 하루 세션을 모아 `claude -p` 또는 `codex exec`로 요약 | `stats/daily-report-builder.ts` |
| Git | diff, history, fetch/pull/push, ahead/behind, terminal 옆 Git side panel, sync 실패 시 "Ask Claude/Codex" | `git-side-panel.tsx`, `diff-panel.tsx` |
| Web browser | Electron 내장 browser와 device emulator, agent가 CLI로 화면·console·network 확인 | `web-browser-panel.tsx` |
| 세션 관리 | tmux 유지, 서버 시작 시 자동 재개, 한 번 클릭 resume, agent 탭의 Chat/Terminal 보기 전환 | `auto-resume.ts`, `agent-mode-switcher.tsx` |
| 모바일·원격 | PWA, Web Push, `/sync` WebSocket multi-device sync, 설정 화면의 Tailscale Serve 켜기/끄기, 모바일 WebSocket hard reload 복구 | `api/tailscale/serve.ts`, `ws-reload-recovery.ts` |
| 기타 | scrypt 비밀번호, CLI token, 접근 필터, 11개 언어, 테마, custom CSS, 에디터 연동, quick prompt, 첨부, 메시지 history, macOS Electron 앱 | `auth.ts`, `access-filter.ts` 등 |

### agentmux에 이미 있는 것 (이름이나 위치가 다름)

- CLI 명령 집합(`bin/cli.js`의 case 목록이 같음), 통계와 일일 리포트, quick prompt, web browser 패널,
  statusline API, Tailscale 설정.
- Codex 탭: `agent-panel.tsx`, `session-list-view.tsx`, `mobile-agent-panel.tsx`.
- Rich timeline(exec, web search, MCP, patch, reasoning, compaction): `codex-session-parser.ts`,
  `rich-timeline-presentation.ts`, `timeline-view.tsx`. 승인은 `approval-queue-item.tsx`.
- Git fetch/pull/push와 ahead/behind: `diff-panel.tsx`, `src/pages/api/git/sync.ts`.
- Agent 실행 요청: `src/pages/api/agent/launch.ts`. Rate limit 표시: `sidebar-rate-limits.tsx`.
- 이미지 첨부 upload: `upload-image-client.ts`, outer-owned upload ingress.

### agentmux에 없는 것

| 묶음 | 기능 | Purplemux 근거 |
| --- | --- | --- |
| A. Claude Code provider | Provider(client, hook handler, runtime snapshot, session detection, preflight, history stats), `claude-code` 탭과 모바일 패널, Claude JSONL timeline, Claude statusLine 기반 rate limit/context, Claude 토큰·비용, folder trust prompt card, Claude 자동 재개, 설치 확인 API(`check-claude`) | `providers/claude/*`, `claude-code-panel.tsx`, `claude-command.ts`, `claude-tokens.ts`, `trust-prompt-detector.ts` |
| B. 공통 agent 기반 | Claude/Codex 세션 통합 목록 탭(`agent-sessions`), Chat/Terminal 보기 전환, agent 설치·가용성 확인, agent 전환 lock, boot progress | `agent-sessions-panel.tsx`, `agent-mode-switcher.tsx`, `agent-availability.ts`, `agent-switch-lock.ts` |
| C. 위임 안내 주입 | Claude와 Codex 실행 시 CLI 사용법과 위임 지침 주입 | `claude-prompt.ts`, `providers/codex/prompt.ts` |
| D. Codex 보조 | Codex update prompt 감지와 웹 응답 card, Codex TUI ready 감지 | `codex-update-prompt-detector.ts`, `codex-tui-ready-detector.ts` |
| E. 일반 UI | Terminal 옆 Git side panel과 sync 실패 시 agent에게 묻기, 모바일 Git 전체 화면, 모바일 WebSocket hard reload 복구 안내 | `git-side-panel.tsx`, `mobile-git-fullscreen.tsx`, `ws-reload-recovery.ts` |

`src/lib/providers/claude/`는 agentmux 작업 디렉터리에 빈 디렉터리로만 있고 git이 추적하지 않습니다.
등록된 provider는 `codexProvider` 하나이고 panel type은 `terminal | codex | web-browser | diff`입니다.

### 본문 결정의 변경

- 본문 "비채택 항목"의 "Claude Code provider와 combined provider session model"은 2026-11-10 사용자
  결정으로 뒤집혔습니다. 사용자는 purplemux에 있고 agentmux에 없는 기능을 agentmux에 추가하라고
  지시했습니다.
- Purplemux의 위임은 "다른 탭에 입력을 보내고 status를 조회해 화면을 읽는" 수준입니다. 부모/자식 관계,
  회신 메시지, blocked 입력 가드, 역할 template은 없습니다. 이 부분은 Herdr `hc`(`docs/HERDR-ADOPTION-AUDIT.md`
  보충 감사)가 참고 모델입니다.
- 구현은 purplemux 코드를 그대로 옮기지 않고 agentmux의 Runtime v2 worker(status, timeline, storage),
  provider registry, approval contract 위에 다시 설계합니다. 본문의 "rich timeline component 직접 복사
  금지" 원칙은 유지합니다.

Purplemux를 merge하거나 릴리스 단위로 따라가는 방식은 권장하지 않습니다. 두 저장소는
같은 계보지만 제품과 runtime 방향이 이미 갈라졌습니다. Purplemux는 Claude Code와 Codex,
macOS/Linux, tmux, JSON 파일 저장을 중심으로 발전했고, Codexmux는 Codex 전용 Runtime v2
worker, SQLite projection, 승인 감사와 bounded timeline을 중심으로 발전했습니다. 이 감사
당시 Windows 전환 판단은 보존하되 현재 Codexmux authority는 Linux 단일 엔진입니다.

반영 가치는 다음 세 범주에 있습니다.

1. Codex JSONL에서 이미 제공되는 정보를 더 많이 수집하는 기능
   - rate limit
   - exec/web search/MCP/patch/error/compaction timeline
   - `local_images` 표시
2. 분기 후 Purplemux에서 수정했지만 Codexmux에 동일 결함이 남은 작은 회귀 수정
   - pane close 후 active tab 보존
   - optimistic user message 공백 정규화
   - background 복귀 후 timeline spacer 정리
   - IME와 clipboard 안정성
3. 구현을 복사하지 않고 Windows 제품에 맞게 다시 설계할 개념
   - background host와 UI 분리
   - push device 관리
   - touch key bar와 terminal line height

반대로 provider 전체, macOS LaunchAgent, tmux runtime 전체, 11개 locale, JSON 저장소,
Electron prompt HTML은 가져오지 않습니다.

## 2026-08-14 선택 도입 상태

승인된 1~4 범위는 upstream merge 없이 codexmux architecture에 맞춰 수동 구현했습니다.

| 범위 | 상태 | codexmux 적용 |
| --- | --- | --- |
| Rate limit | 구현 | 기존 JSONL tail에서 window별 관찰을 추출하고 reset 뒤 `갱신 대기` 표시 |
| Rich timeline | 구현 | exec/web/MCP/patch/error/compaction semantic row, redaction과 4KiB/16KiB 상한 |
| Terminal/UI 회귀 | 구현 | IME, clipboard fallback, pane focus, timeline spacer, Stop 기반 Git refresh |
| Hook/launch | 구현 | server launch intent, native hook coexistence, HMAC capability, standalone Node bridge |

Local image serving, full output/download, Claude provider, 비선택 Purplemux 회귀는 범위에서
제외했습니다. Full unit/type/build/Electron gate, strict-config, Runtime v2와 browser smoke,
실제 Linux service 재시작 증거는 구현 handoff에 기록했고 ADR-025를 `Verified`로
승격했습니다. Windows package 실기 검증은 이 선택 도입 범위의 완료 조건에서 제외했습니다.

분석 중 Purplemux와 Codexmux에 공통으로 남은 Critical/High 결함도 확인했습니다.
Codexmux에서는 첫 실행 install WebSocket, production dependency, upload 무결성 P0를
2026-07-11에 먼저 처리했습니다. Production server/desktop host lifecycle과 아래 선택 이식
후보는 별도 후속 범위입니다.

## 분석 범위와 방법

- [Purplemux 저장소](https://github.com/subicura/purplemux) 전체 clone과 git history를
  사용했습니다.
- `main`, 최신 tag `v0.4.5`, 공개 issue/PR, 특히
  [PR #66](https://github.com/subicura/purplemux/pull/66)을 확인했습니다.
- 공통 조상 이후 양쪽 commit과 현재 tip의 파일을 직접 비교했습니다.
- Purplemux에서 install, lint, typecheck, unit test, production build를 실행했습니다.
- 후보 commit 일부는 disposable clone에서 Codexmux tip에 순서대로 cherry-pick한 뒤
  typecheck와 관련 unit test를 실행했습니다.
- 현재 작업 디렉터리의 기존 `AGENTS.md` 수정과 `memory/` 파일은 건드리지 않았습니다.

## 계보와 동기화 전략

공통 조상은 `0fa7c0d64b38b64f873042628bacf996e5968eda`입니다. 이후 Codexmux의
첫 전용 commit `31f7bfdc`가 제품명, CLI와 provider를 대규모로 전환했습니다.

| 항목 | Purplemux | Codexmux |
| --- | --- | --- |
| 감사 기준 tip | `52140216` | `cafc8de9` |
| 감사 기준 버전 | `0.4.5` | `0.4.16` |
| 분기 후 commit | 171 | 253 |
| 주요 플랫폼 | macOS/Linux | Windows 전용 전환 |
| agent 범위 | Claude Code + Codex | Codex |
| terminal/runtime | tmux + node-pty | Runtime v2 + Windows adapter, legacy tmux |
| 상태 저장 | JSON 파일 중심 | SQLite projection + 기존 파일 migration |
| UI locale | 11개 | 한국어/영어 |

`git cherry` 기준 patch-equivalent commit은 양쪽 모두 0개입니다. 현재 tip 사이에는
1,737개 파일 차이가 있고, 어느 tip도 다른 tip의 조상이 아닙니다. 로컬
`origin/main`은 공통 조상에서 멈춘 stale ref이므로 비교 기준으로 사용하면 안 됩니다.

따라서 정책은 다음과 같습니다.

- upstream merge, rebase, release tag 동기화 금지
- 작은 독립 회귀 수정만 commit 단위 적용 검토
- parser, status, hook, settings 기능은 최종 upstream 동작을 읽고 수동 구현
- Codexmux의 deterministic timeline ID, tab/session ownership, Runtime v2 경계,
  approval audit, 한국어/영어 locale 계약을 우선
- dependency commit은 cherry-pick하지 않고 현재 advisory 기준으로 별도 upgrade

두 저장소 모두 MIT이고 Codexmux `LICENSE`에 원 저작권이 유지되어 선택 이식의
라이선스 장애는 없습니다.

## Purplemux 현재 구조

Purplemux는 Next.js Pages Router와 custom Node server를 사용합니다. 브라우저는
terminal, timeline, status, sync WebSocket에 연결하고, server는 전용 tmux socket에
node-pty로 attach합니다. Claude/Codex JSONL watcher와 hook event, process polling을
조합해 status와 timeline을 만듭니다. 설정과 workspace 상태는 주로
`~/.purplemux/`의 JSON 파일에 저장합니다.

제품 기능은 multi-pane/tab/workspace, terminal/timeline 전환, Git diff와 sync,
web browser panel, combined provider session list, quick prompt, attachment, usage stats,
rate limit, Web Push, Tailscale, password auth, Electron macOS shell을 포함합니다.

Codexmux와 화면 계보는 비슷하므로 전체 UI를 가져올 이유는 없습니다. Codexmux가
더 강한 부분은 다음과 같습니다.

- Runtime v2 worker와 IPC contract, shadow/cutover/rollback 증거
- Windows terminal/process/service-host/package/update smoke
- Codex session ownership과 reconnect 복구
- global approval queue, metadata redaction, audit와 notification policy
- status state machine과 current action/summary metadata
- 훨씬 넓은 unit, integration, Playwright, platform smoke 범위

## 선행 차단 항목

### P0. 인증 없는 첫 실행 install shell

상태: **Codexmux 조치 완료.** ADR-026과
`docs/operations/2026-07-11-pre-auth-bootstrap-security-handoff.md`를 기준으로 fresh setup은
loopback bind, strict Host/Origin, typed install admission/lease를 사용합니다.

감사 당시 Purplemux와 Codexmux 모두 기본 network access가 `all`이고 `0.0.0.0`에 bind했습니다.
동시에 `/api/install` WebSocket은 인증 예외입니다. onboarding 중에는 이 연결이
로그인 shell을 생성하고 받은 `MSG_STDIN`을 그대로 씁니다. Origin/Host 검증도 없습니다.

관련 Codexmux 경로:

- `src/lib/network-access.ts`
- `server.ts`의 `NO_AUTH_WS_PATHS`
- `src/lib/install-server.ts`
- `src/lib/runtime/server-ws-upgrade.ts`

첫 설정이 끝나기 전 같은 LAN의 client가 연결하면 codexmux process 권한으로 임의
명령을 실행할 수 있습니다. browser 기반 cross-site WebSocket과 DNS rebinding도
차단하지 않습니다. setup 완료 뒤 이미 열린 연결을 즉시 폐기하는 guard도 없습니다.

권장 수정:

1. 기본 bind를 `localhost`로 바꿉니다.
2. install endpoint를 일반 인증 예외에서 제거합니다.
3. 원격 onboarding이 필요하면 짧은 수명의 1회용 setup capability를 사용합니다.
4. 모든 WebSocket에서 Origin/Host와 endpoint별 `maxPayload`를 검증합니다.
5. 범용 interactive login shell 대신 허용된 installer command를 argv로 실행합니다.
6. setup 상태가 바뀌면 열린 install connection을 닫습니다.

### P0. production dependency advisory

상태: **Codexmux 조치 완료.** 아래 표는 발견 시점 baseline입니다. 현재 Codexmux는 Next
`16.3.1`, next-intl `4.9.2`, ws `8.21.0`, js-yaml `4.2.0`, PostCSS `8.5.23`, nanoid
`5.1.16`, sharp `0.35.3`, Babel `7.29.6`을 사용하며 `corepack pnpm audit --prod` 결과는
0건입니다.

2026-07-11의 `corepack pnpm audit --prod` 결과입니다.

| 저장소 | 합계 | High | Moderate | Low |
| --- | ---: | ---: | ---: | ---: |
| Purplemux | 3 | 1 | 1 | 1 |
| Codexmux | 20 | 8 | 8 | 4 |

Codexmux는 Next `16.2.4`, next-intl `4.9.1`, ws `8.20.0`을 사용합니다. 특히 현재
Pages Router + i18n + `src/proxy.ts` auth 구조에 직접 관련된 Next proxy 우회
advisory가 포함됩니다. Purplemux의 Next `16.2.6`과 next-intl `4.11.0` 변경은
방향은 맞지만, 그대로 cherry-pick해도 현재 `ws < 8.21.0`, js-yaml과 Babel advisory가
남습니다.

Patched version 적용 뒤 locale-less data route의 redirect-only auth, dynamic route parameter,
unknown absolute-form WebSocket, Electron build/runtime를 회귀 gate로 검증했습니다.

### P0. 10MiB proxy upload truncation

상태: **Codexmux 조치 및 Windows 검증 완료, ADR-027 Verified.** Legacy Pages upload route를
제거하고 exact 두 route를 outer custom server의 authenticated streaming ingress로 옮겼습니다.
`v0.4.20` fresh Windows package/release gate에서 hard-link publish, abort/aged-stage cleanup,
committed `.part` 보존과 kill switch를 실제 packaged exe로 최초 확인했고 `v0.4.21`에서
같은 경로와 artifact privacy gate를 재검증했습니다.

[Purplemux PR #66](https://github.com/subicura/purplemux/pull/66)이 확인한 것처럼 Next 16
proxy의 `experimental.proxyClientMaxBodySize` 기본값은 10MiB이고, 초과 시 요청을
실패시키지 않고 복제된 body를 잘라 보낼 수 있습니다. 감사 당시 Codexmux도
`src/proxy.ts`가 API를 통과시키며 `next.config.ts`에 override가 없었습니다.

Next는 cap을 넘긴 crossing chunk 전체를 버리고 clone stream을 정상 EOF로 닫았습니다.
Production 재현에서 11,534,336B generic body는 10,444,800B, 10,485,761B image body도
10,444,800B로 `200` 저장됐고, exact 10,485,760B image는 온전히 저장됐습니다. Raw body라
HTTP header/multipart overhead가 원인이 아니며 proxy clone과 route ownership이 원인입니다.

Codexmux는 outer custom server에서 strict Host/auth/Origin/method/Expect/framing/admission 뒤
streaming하고 observed byte와 Content-Length를 일치시킵니다. Same-directory hard link가
no-replace commit point이며 `CODEXMUX_UPLOADS_DISABLED=1`은 Pages fallback 없이 두 route만
503으로 닫습니다. PR #66의 full buffering 구현은 복사하지 않았습니다.

### P1. 동일 hostname 인증 쿠키 충돌

상태: **`v0.4.22` 반영 완료, 기존 profile 전환 검증 대기.** ADR-029에 따라 browser session
cookie를 `codexmux-session-token`으로 분리했습니다. Fresh Windows package/published updater와
isolated Chromium 공존 smoke는 통과했지만 ADR-029는 `Implemented`를 유지합니다.

Purplemux `main@52140216`과 조치 전 Codexmux는 모두 `session-token; Path=/`을 사용했습니다.
Browser cookie는 port로 격리되지 않으므로 같은 `localhost`에서 Purplemux `8022`와 Codexmux
`8122`를 함께 실행하면 마지막 login/refresh가 앞선 JWT를 덮어씁니다. 두 제품의 secret이
다르므로 다른 제품은 HTTP 인증과 WebSocket session attach에 실패합니다. Data directory,
port, lock과 tmux socket은 이미 제품별로 분리되어 있어 session backend 충돌은 아니었습니다.

Codexmux는 legacy cookie를 migration fallback으로 읽거나 logout에서 지우지 않습니다. 어느
제품이 발급했는지 구분할 수 없고 Purplemux session을 다시 손상시키기 때문입니다. 변경 build로
전환한 기존 Codexmux 사용자는 한 번 재로그인하며, 이후 두 cookie가 함께 전송되어도 각 제품이
자기 namespace만 검증합니다. 전환 직전 legacy cookie가 Codexmux JWT였다면 Purplemux도 한 번
재로그인해 자기 cookie를 복구합니다. Chromium reconnect smoke가 이 공존 경로를 고정합니다.
CI smoke는 fresh HOME/profile을 사용하므로 보존된 `v0.4.21` Electron profile의 실제 1회
재로그인, 기존 Runtime v2 session과 authenticated upload 재연결은 별도 확인이 필요합니다.

### P1. Electron 내부 Next server lifecycle

production `startProd()`는 임의 internal port를 만든 뒤 standalone `server.js`를
`require`하여 Next server를 시작합니다. 반환된 shutdown은 outer proxy만 닫고 내부
server handle을 닫지 않습니다. Electron local -> remote 전환에서는 내부 server가
남고, remote -> local 전환에서는 require cache 때문에 새 internal port에 server가
시작되지 않아 timeout될 수 있습니다. lock도 outer close 완료 전에 풀립니다.

Windows 제품에서는 tray/service host가 server process를 소유하고 Electron은 client로만
연결하는 구조가 가장 명확합니다. 현재 process 내 방식을 유지한다면 internal server를
명시적으로 소유하는 child process와 readiness/shutdown handshake가 필요합니다.

### P1. config secret의 복수 writer

server의 `config-store.ts`는 lock과 mode `0600`으로 `config.json`을 씁니다. Electron
`main.ts`는 같은 파일을 별도 read-modify-write하고 `.tmp`에 mode를 지정하지 않습니다.
POSIX에서는 auth hash/secret가 포함된 파일이 `0644`로 교체될 수 있고, 모든 플랫폼에서
동시 write로 설정이 유실될 수 있습니다.

server config와 desktop preference의 writer를 분리하고, secret은 Windows user ACL 또는
DPAPI 계층으로 옮겨야 합니다. Purplemux의 JSON store 변경은 역수입하지 않습니다.

### P1. WebSocket/backpressure와 resume ownership

- Purplemux의 active terminal path와 Codexmux legacy path는 `bufferedAmount`가 높을 때
  PTY를 pause한 뒤 다음 stdout callback에서만 resume 여부를 봅니다. pause 후 callback이
  없으면 영구 정지할 수 있습니다. Codexmux Runtime v2의 fail-close 정책을 유지하고
  legacy는 drain timer를 추가하거나 cutover 뒤 제거합니다.
- WebSocketServer에 endpoint별 payload/connection 제한이 없습니다. `ws >= 8.21.0`,
  `maxPayload`, IP/connection limit, sequence 기반 resync가 필요합니다.
- timeline resume message가 connection 소유 session과 별도 `tmuxSession`을 받아 그대로
  사용합니다. payload target을 제거하고 connection/tab ownership에서만 target을
  결정해야 합니다.

## 채택 우선순위

### P1. Codex rate limit JSONL 수집

Purplemux commit:
[7b7365fd](https://github.com/subicura/purplemux/commit/7b7365fd)

Codexmux에는 type, sidebar, status WebSocket 전파가 있지만 실제 입력원은 Claude 계열
statusLine 파일을 전제로 남아 있습니다. Codex JSONL의 `event_msg/token_count.rate_limits`
를 읽는 producer가 없어 표시가 사실상 채워지지 않습니다.

반영 방법:

- Purplemux `codex-rate-limits-cache.ts`의 primary/secondary window 정규화만 가져옵니다.
- 현재 JSONL watcher 또는 Runtime v2 Status Worker에서 tail event를 처리합니다.
- 기존 단일 Codex `IRateLimitsData`와 cache read 호환성을 유지합니다.
- `window_minutes`, `resets_at`, `resets_in_seconds`, null/partial event를 fixture로 검증합니다.

가치는 높고 구현 위험은 중간입니다.

### P1. Rich Codex timeline

주요 Purplemux commit:

- [e9b74421](https://github.com/subicura/purplemux/commit/e9b74421)
- [0132b60c](https://github.com/subicura/purplemux/commit/0132b60c)
- [ab477480](https://github.com/subicura/purplemux/commit/ab477480)
- [ab6ccc5e](https://github.com/subicura/purplemux/commit/ab6ccc5e)
- [2ebd5644](https://github.com/subicura/purplemux/commit/2ebd5644)

Codexmux parser는 실제 Codex 0.128 `response_item`, deterministic ID, incremental read와
session ownership을 지원합니다. 이를 교체하면 안 됩니다. Purplemux의 유효한 차이는
다음 event를 별도 의미 타입으로 표현하는 것입니다.

- exec begin/delta/end와 exit code/duration/stdout
- `web_search_call`
- MCP begin/end와 server/tool/result
- `custom_tool_call/apply_patch`
- error/warning/stream error
- context compaction
- token의 cached input/reasoning output

현재 `src/lib/codex-session-parser.ts`에 event 의미만 추가하고 Runtime v2 delivery와 기존
ID 생성기를 유지합니다. stdout, command, MCP result는 redaction과 작은 byte cap을
적용하고 상세는 lazy expansion합니다. approval event는 별도 card를 하나 더 만들지 않고
기존 ApprovalQueue/audit pipeline에 연결합니다. Purplemux의 `nanoid()` ID, 1MiB raw
stdout, hardcoded copy는 가져오지 않습니다.

구현 가치는 높지만 여러 상태 계약을 건드리므로 별도 spec, STATUS 문서와 migration test가
필요합니다.

### P1. 안전한 local image 표시

Purplemux commit:
[f65d6d61](https://github.com/subicura/purplemux/commit/f65d6d61)

Purplemux는 Codex `local_images` path를 인증된 `/api/uploads/...` URL로 매핑합니다.
Codexmux는 upload 저장은 하지만 이 route와 parser mapping이 없습니다.

경로 lexical check만 복사하지 말고 다음을 함께 구현해야 합니다.

- stream-to-stage와 atomic no-replace publish
- Content-Length 조기 거절과 실제 byte count 일치
- per-tab/global quota와 주기 cleanup
- `realpath`/symlink/junction 차단
- `X-Content-Type-Options: nosniff`
- exact limit, over-limit, partial body, malformed filename, symlink test

### P1. 작은 회귀 수정 묶음

| 항목 | Upstream | Codexmux 상태 | 적용 |
| --- | --- | --- | --- |
| pane close active tab 보존 | [67b71197](https://github.com/subicura/purplemux/commit/67b71197) | `use-layout.ts` close 경로가 일반 `applyLayout` 사용 | commit과 test 직접 이식 가능 |
| pending message 공백 정규화 | [42f9571a](https://github.com/subicura/purplemux/commit/42f9571a) | init/append 모두 `.trim()`만 사용 | `timeline-entry-merge.ts`에 수동 이식 |
| timeline spacer 복구 | [65221e4a](https://github.com/subicura/purplemux/commit/65221e4a), [93cb6edc](https://github.com/subicura/purplemux/commit/93cb6edc), [39b1da81](https://github.com/subicura/purplemux/commit/39b1da81) | background response, orphan anchor, resume 재측정 누락 | 최종 세 동작과 browser regression test 이식 |
| 한국어 IME key handling | [58fd513e](https://github.com/subicura/purplemux/commit/58fd513e) | composition guard와 native caret prevent 누락 | 직접 이식 후 Windows IME 검증 |
| HTTP clipboard fallback | [087c883f](https://github.com/subicura/purplemux/commit/087c883f), [be0cf3cd](https://github.com/subicura/purplemux/commit/be0cf3cd) | 네 곳이 `navigator.clipboard` 직접 호출 | 공통 helper 형태로 수동 이식 |
| authoritative sidebar status | [da5ffef5](https://github.com/subicura/purplemux/commit/da5ffef5) | indicator 호출부가 layout tabs를 전달하지 않음 | Runtime v2/mobile cache와 통합 |
| stop 직후 Git refresh | [d711fc7a](https://github.com/subicura/purplemux/commit/d711fc7a) | 최대 수십 초 stale 가능 | cache bypass signal만 수동 이식 |

disposable clone에서 `65221e4a -> 93cb6edc -> 57eee752 -> 8f6928c1 ->
58fd513e -> 67b71197` 순서의 cherry-pick은 모두 충돌 없이 적용됐고, typecheck와 관련
Vitest 6개가 통과했습니다. 이 결과가 제품 적합성을 의미하지는 않습니다.
`57eee752`의 tab wrap은 UX 정책이고 `8f6928c1`은 POSIX legacy 전용입니다.

### P1. Codex hook transport와 사용자 hook 병합

Purplemux의 최종 Codex provider는 user `~/.codex/config.toml` hook을 읽고 Purplemux
hook과 event별로 병합하며, shell string 대신 Node launcher가 argv로 Codex를 실행합니다.
Codexmux는 세 event의 `-c hooks.*=` 값을 고정해 같은 event의 user hook을 덮을 수 있고,
POSIX `sh` status hook은 당시 Windows 전용 목표와 맞지 않았습니다. 현재 구현은 native
session-layer TOML override와 standalone Node hook bridge를 사용하며 Linux engine에서도
user/project/managed/plugin hook discovery를 보존합니다.

반영할 것은 구현 파일이 아니라 다음 contract입니다.

- current Codex hook schema에서 지원 event를 feature-detect
- 기존 user hook을 보존하고 codexmux hook을 앞에 추가
- raw hook payload를 schema validation 후 status/approval reducer로 전달
- Node/PowerShell transport와 argv 실행, shell interpolation 금지
- runtime-v2 tab capability로 session target을 검증
- parse failure 시 user hook을 손상시키지 않고 codexmux hook만 fail closed

### P2. Prompt와 시작 상태

관련 commit:

- [6578276c](https://github.com/subicura/purplemux/commit/6578276c)
- [44bbca90](https://github.com/subicura/purplemux/commit/44bbca90)
- [6606d7b8](https://github.com/subicura/purplemux/commit/6606d7b8)
- [775b8d9c](https://github.com/subicura/purplemux/commit/775b8d9c)
- [825dadfe](https://github.com/subicura/purplemux/commit/825dadfe)

composer-ready 판별, 지연 단계 피드백, trust/update menu 감지는 가치가 있습니다. 현재
설치된 Codex `0.144.1` binary에도 update prompt 문자열이 존재함을 확인했습니다.

다만 Purplemux의 direct `sendStdin`, generic choice를 permission으로 취급하는 fallback,
고정 terminal capture 크기는 Codexmux approval trust boundary와 충돌합니다. 실제 option
번호가 비연속일 때 입력 번호를 보존하는 parser만 재사용하고, 모든 응답은 기존
approval API와 audit를 통과시킵니다. CLI update와 Electron app update도 별도 상태로
표시합니다.

### P2. 설정과 운영 편의

| 기능 | Upstream | 판단 |
| --- | --- | --- |
| terminal line height | [1d488737](https://github.com/subicura/purplemux/commit/1d488737) | 고밀도 Windows 화면 접근성에 유효. fit/resize test 필요 |
| touch key bar | [244767dc](https://github.com/subicura/purplemux/commit/244767dc) | Surface 사용자가 target일 때 채택. 44px, aria-label, focus/armed modifier 보강 |
| push device 제거 | [17b4fd4e](https://github.com/subicura/purplemux/commit/17b4fd4e) | raw endpoint 목록 대신 deviceId/name/platform/createdAt/lastSeenAt model로 재설계 |
| 최근 remote URL | [ad414670](https://github.com/subicura/purplemux/commit/ad414670) | remote mode 유지 시에만. server lifecycle 수정 후 native IPC로 구현 |
| pane 간 tab wrap | [57eee752](https://github.com/subicura/purplemux/commit/57eee752) | 버그가 아닌 keyboard UX 정책. 명시 결정 후 적용 |
| resizable Git inspector | [0f585a67](https://github.com/subicura/purplemux/commit/0f585a67) | 기존 Diff tab을 유지한 opt-in inspector로만 검토 |
| legacy auto-resume 보강 | [98540821](https://github.com/subicura/purplemux/commit/98540821) | provider preflight cache, text/Enter 분리, launch marker만 이식. Runtime v2 ownership 우선 |
| start at login | [v0.4.5](https://github.com/subicura/purplemux/releases/tag/v0.4.5) | LaunchAgent 코드는 거부. Windows tray/SCM owner state machine만 참고 |

## 비채택 항목

- Claude Code provider와 combined provider session model
- macOS/Linux tmux를 primary runtime으로 되돌리는 변경
- macOS LaunchAgent, POSIX login PATH와 tmux copy-mode commit
- 9개 locale 추가와 Purplemux branding/landing asset
- Purplemux JSON workspace/config persistence
- pnpm 11과 dependency bump commit의 일괄 cherry-pick
- hardcoded 한국어/영어가 섞인 rich timeline component의 직접 복사
- macOS 전용 Electron packaging과 release workflow

Busy spinner, agent panel dismiss, 일부 tmux quiet unbind는 Codexmux에 동등 구현이 있어
별도 이식하지 않습니다.

기능과 별도로 `landing-src/images/screenshot-desktop-codex.png`는 현재 Purplemux 이름과
Claude 화면을 보여 줍니다. Codexmux의 Windows/Codex-only 상태를 증명하는 최신 자산으로
교체해야 합니다.

## 품질과 검증 결과

Purplemux `main@52140216`에서 다음을 실행했습니다.

| 명령 | 결과 |
| --- | --- |
| `corepack pnpm install --frozen-lockfile` | 통과 |
| `corepack pnpm test` | 22 files, 107 tests 통과 |
| `corepack pnpm lint` | 통과 |
| `corepack pnpm exec tsc --noEmit` | 통과 |
| `corepack pnpm build` | 통과 |
| `corepack pnpm audit --prod` | High 1, Moderate 1, Low 1 |

Purplemux CI는 Ubuntu/Node 24 한 조합에서 lint, typecheck, unit만 실행합니다. Electron은
별도 macOS release build가 있으나 application source가 main TypeScript project에서
제외되어 있고 E2E/Playwright, install/auth/server/backpressure integration test가 없습니다.
따라서 unit 통과만으로 terminal, Electron 전환, WebSocket과 onboarding 안전성을 보장할
수 없습니다.

Codexmux P0 구현 당시 production audit 0건, 211 test files 통과와 1개 skip,
1,444 tests 통과와 3개 skip, build, pre-auth production security smoke, 50MiB
external-memory gate, dev/prod upload 각 12 checks, browser reconnect, Electron build/runtime까지
통과했습니다. 이어 `v0.4.20`에서 fresh Windows package/release와 실제 published updater
기능 경로를 최초 통과해 ADR-027과 ADR-028을 `Verified`로 전환했습니다.
[workflow 29219010240](https://github.com/HardcoreMonk/codexmux/actions/runs/29219010240)은
실제 `v0.4.21 -> v0.4.22` updater 적용, browser/package/published-updater privacy gate와
stable/latest 승격을 반복했습니다. 상세 증거는
[v0.4.22 handoff](operations/2026-07-13-v0.4.22-windows-release-handoff.md)에 보존합니다.
Cookie 격리 release 직전 전체 suite는 212 files와 1,445 tests가 통과하고 1 file과 3 tests가
skip됐습니다.

## 권장 실행 순서

1. **Security hotfix (Codexmux 구현 및 Windows release 검증 완료)**
   - install WebSocket 폐쇄/재설계
   - dependency upgrade
   - upload truncation과 WebSocket limit
2. **Host/runtime integrity**
   - internal Next lifecycle와 config writer 단일화
   - resume ownership와 legacy backpressure
3. **작은 회귀 수정 묶음**
   - pane focus, whitespace, spacer, IME, clipboard, sidebar status
4. **Codex data parity project (선택 범위 검증 완료)**
   - rate limit producer와 stale window UI
   - bounded rich timeline event. Local image serving은 제외
   - native hook coexistence와 cross-platform Node bridge
5. **제품 선택 항목**
   - line height, touch key bar, device model, Git inspector, remote URL history

1~4는 각각 현재 lifecycle contract에 따라 spec, domain-architecture, grill-me,
design/engineering review와 검증을 거쳐야 합니다. 특히 status type, timeline entry,
provider detection을 바꾸는 작업은 `docs/STATUS.md`와 관련 ADR을 함께 갱신합니다.

## 최종 판단

Purplemux는 Codexmux가 다시 기반으로 삼을 upstream이 아니라, 같은 조상에서 별도로
진화한 비교 구현입니다. 가져올 핵심은 코드량이 아니라 Codex JSONL 해석의 폭과 몇 개의
검증된 UI/runtime 회귀 수정입니다. Codexmux의 공통 P0 보안 부채는 outer upload와 strict
bootstrap 경계로 제거했고, `v0.4.20`에서 packaged upload와 published updater 기능을 최초
검증한 뒤 `v0.4.21`에서 privacy-safe evidence를 확인했고 `v0.4.22`에서 product-specific
cookie와 같은 release path를 반복했습니다. Rate limit, bounded rich timeline, 관련 회귀,
native session hook/server launch intent는 Runtime v2와 approval contract 안에 수동 통합했고,
자동 검증과 실제 Linux service 재시작까지 완료했습니다.
