# Herdr 차용 가능성 감사

> 감사 기준일: 2026-11-09
> Herdr 기준: `herdrdev/herdr` `v0.9.5` (stable, 2026-10-14), local client/server `0.9.5`, protocol 22
> Codexmux 감사 baseline: `main@fdf8752b` (source `0.4.24`) + 미커밋 workspace activity label 변경
> 보충 감사: 2026-11-10. 아래 [보충 감사](#보충-감사-2026-11-10) 절이 본문보다 우선합니다.

## 결론

Herdr TUI는 Rust terminal multiplexer이고 codexmux는 Codex 전용 web session manager라 코드
계보가 없습니다. 차용은 구현 복사가 아니라 개념과 계약 단위로만 검토합니다. (보충: Herdr는 TUI 하나가
아니라 TUI, `herdr-core`(`hc`), desktop app으로 이루어진 제품군입니다.)

## 보충 감사 (2026-11-10)

독립 감사 agent가 이 문서를 `herdrdev` organization의 5개 repo와 대조했습니다. 기준 commit은
herdr tag `v0.9.5`(master `ee5bfb50`는 그 뒤 fix/test/chore 39개뿐), herdr-core `3ba03e6f`,
herdr-app `b721deda`, herdr-layout-examples `0ec96764`, herdr-nix `602c8854`입니다. 아래 `*.mdx`는
`herdr/docs/versions/0.9.5/website/src/content/docs/` 기준 경로입니다.

### 판정

- 본문의 TUI 인벤토리는 대체로 정확합니다. 사실 오류는 `pane wait-output` 1건입니다.
- 범위가 5개 repo 중 1개뿐이었습니다. `herdr-core`와 `herdr-app`을 "TUI 문서에 근거가 없다"며
  제외했지만 두 repo는 README, command reference, OpenRPC schema, agent skill을 공개합니다.
- Claude Code와 Codex 동시 실행, 일 나누기, 상호 리뷰에 해당하는 Herdr 기능은 거의 전부 제외한 두
  repo에 있습니다.
- "Codex 단일 provider" 전제는 이미 바뀌었습니다. `8308916f`에서 `AGENTS.md`가 Claude Code 지원
  예정으로 바뀌었으므로 multi-agent 감지와 worktree 제외 판단은 다시 봐야 합니다.
- Herdr 개발 중심도 옮겨 갔습니다. hc skill은 `herdr`를 "the older terminal multiplexer"라고 부릅니다
  (`herdr-core/crates/herdr-core/src/SKILL.md:3-4`).

### 본문 정정

| 본문 위치 | 판정 | 정정 내용 |
| --- | --- | --- |
| Automation CLI: `pane wait-output`이 event-driven wait | 오류 | Event-driven은 `agent.wait`뿐입니다(socket-api.mdx:111). `pane wait-output`은 polling이며 이미 화면에 있던 텍스트도 즉시 매치합니다(agent-automation.mdx:84, cli-reference.mdx:415). |
| 분석 범위: herdr-core/app 제외 근거 | 오류 | `herdr-core/{README.md,docs/,schema/README.md}`, `herdr-app/defaults/AGENTS.md`가 공개 근거입니다. |
| 결론·분석 범위: "Herdr는 Rust TUI" | 낡음 | `herdr-app/README.md:3`은 "Herdr is a desktop app"입니다. |
| 제외: multi-agent 감지, 24개 kind | 수치는 맞고 전제는 낡음 | Claude Code 지원이 예정되어 단일 provider 계약이 더 이상 제외 근거가 되지 않습니다. |
| H6 근거 `auto-resume.ts:84-114` | 낡음 | `6df6ea02`가 재개 대상을 시작 시점에 없던 tmux session의 `codex` panel 탭으로 좁혔습니다. Live 탭은 모두 `terminal` panel이라 대상이 0개이므로 H6 실익이 낮습니다. |
| `pane read`의 `detection` source | 본문 유지 | 감사 agent는 CLI에 없다고 했지만 설치된 `herdr pane read --help`의 `--source` 값에 `detection`이 있습니다. 본문이 맞습니다. |

### 놓친 기능 (multi-agent 목표 관련)

**herdr-core (`hc`)**

1. 부모/자식 위임: `hc run --bg --name review reviewer "task"`. 자식은 부모가 끝나면 함께 끝나고
   (`--outlive-parent`로 예외), 자식이 blocked되거나 끝나면 부모 입력에 note가 자동으로 들어갑니다
   (`README.md:79-102`).
2. Agent 간 메시지와 회신: `hc send`(`--if idle|working`, `--wait`, blocked이면 거부하고 `--force`로만
   입력). 회신은 `<hc from="t7 review">` 태그로 오고, 위임 메시지에는
   `reach="hc send t3 when done or stuck"`가 붙습니다(`src/SKILL.md:16-125`,
   `docs/commands.md:518-537`).
3. 메시지 안전 규칙: 태그 메시지는 사용자 지시가 아니라 자식 보고로 취급합니다(`SKILL.md:112`). 사람이
   입력하던 draft를 최대 60초 보호하고(`SKILL.md:103`), `first_message.sent`로 첫 task 전달을 확인하며,
   자식이 다시 agent를 띄우는 것은 금지합니다.
4. `hc wait --children all|any`: 반환 사유는 `message`/`timeout`입니다(`docs/commands.md:626-656`).
5. Template(역할 preset): reviewer, simplifier, implementer. `command`에 agent와 model을 넣고
   `ready`/`submit`/`stop`/`paste_gap_ms`를 agent별로 지정합니다(`docs/templates.md`).
6. OSC 7501 Program Status Protocol과 `turn` counter: 화면 추측 없는 provider 중립 상태 계약입니다
   (`schema/README.md:216-219`, `src/status.rs:1-30`). Claude Code 상태 감지의 대안 후보입니다.
7. H7의 대안 모델: `missed` 알림에 fresh snapshot을 함께 보내고, attach stream은 credit 방식(256 KiB,
   4 MiB 이상 밀리면 repaint)입니다(`schema/README.md:100-106,170-176`).

**herdr-app**

8. 통합 agent sidebar: 모든 space의 agent를 한 sidebar에 모으고, 다른 agent가 띄운 worker도 부모 아래에
   보입니다. Peek, keep-as-tab, rollup(blocked>done>working>idle)을 지원합니다(`README.md:42-56`,
   `defaults/AGENTS.md:153-163`).
9. Space별 Files/Changes(diff) panel: 상호 리뷰용 화면입니다(`defaults/AGENTS.md:171-177`).
10. Agent 실행 진입점: `tab.new --argv '["claude"]' --task "..."`와 + menu(Claude, `codex --no-daemon`
    등)(`src/SKILL.md:36`, `defaults/programs.json`).
11. Worktree mod: `~/.herdr/worktrees/<repo>/<branch>`로 병렬 agent의 checkout을 격리합니다
    (`defaults/AGENTS.md:828-839`).
12. Client 간 공유 seen/pinned: `herdr.seen=<turn>` label을 desktop, phone, TUI가 공유합니다
    (`docs/labels.md`).

**herdr-layout-examples**

13. 다중 agent 화면 레퍼런스(각 `RECIPE.md`): Board(Needs you/Working/Done/Idle 칸반), Threads(inbox,
    focused agent로 보내는 composer, Diff panel, 새 thread에서 Claude/Codex/Pi/Grok와 worktree 선택),
    Mission, Chat.

**herdr TUI에서 놓친 것**

14. `layout.apply`/`layout.export`: pane별 argv를 가진 선언형 tab preset입니다. 예: Claude|Codex 좌우
    배치(socket-api.mdx:199-245).
15. `agent.view.set`: attention 순으로 agent 목록을 보여 주는 projection입니다(socket-api.mdx:370-).
16. Reviewer recipe: Codex reviewer가 diff를 리뷰하는 예시입니다(agent-automation.mdx:106-112,
    `skills/herdr/SKILL.md:128-168`). 본문 H1은 이를 "Codex 위임"으로만 좁혔습니다.
17. Claude Code alt-screen history 읽기와 긴 답을 파일 경로로 회신받는 방식(agent-automation.mdx:86-92).
    Visible 화면만 읽는 `tab result`의 한계와 직결됩니다.
18. Claude integration: SessionStart hook만 설치하고 상태는 화면 감지입니다(integrations.mdx:104-116).

### 범위 공백과 불확실성

- 비교표에 multi-agent 목표 축이 없습니다: multi-provider, agent 간 메시지와 회신, 역할 preset, 다중
  pane preset, 리뷰용 diff 화면. agentmux pane split(최대 10개)과 Herdr layout 비교도 없습니다.
- herdr-nix는 Nix packaging이라 검토하지 않아도 손실이 없습니다.
- Claude Code나 Codex가 OSC 7501을 스스로 내보내는지는 확정하지 못했습니다. `programs.json`의
  `"match":["claude-code"]`가 그렇다는 암시만 있습니다.
- 설치된 CLI의 top-level help에는 문서의 `terminal`, `plugin` group이 나오지 않습니다.

이 보충 결과는 multi-agent 설계 논의의 입력입니다. 진행 상황은
`docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`에 있습니다.

상태 모델, 미확인 완료, workspace rollup은 codexmux에 이미 동등 기능이 있습니다. 차용 가치는
다음 네 범주에 있습니다.

1. Stream·상태 파일 신뢰성 (H5, H6, H7): backpressure 때 status event를 신호 없이 버리는 문제,
   단일 `.bak` 덮어쓰기, 병렬 자동 재개. 작고 공개 계약 변화가 적으며 AGENTS.md의
   terminal/reconnect 안정성 우선 원칙과 맞습니다.
2. Codex 위임 자동화 (H1): send-and-wait, 상태 대기, 입력 가드, caller context, agent 안내.
   가장 Herdr다운 신규 기능이지만 CLI 공개 계약, shell env, token 범위를 바꾸므로 ADR이 필요합니다.
3. 주의 신호 UX (H2, H3, H4): needs-input toast·사운드, 다음 주의 탭 이동, 색 비의존 표시.
4. 진단 (H8, H9): 상태 판정 근거와 multi-client 크기 정책.

Remote machine, plugin, worktree, live handoff, multi-agent detection은 제품 범위나 기존 경계와
충돌해 가져오지 않습니다.

## 분석 범위와 방법

- 로컬에 설치된 `herdr 0.9.5` CLI의 전체 command group help, `herdr --default-config`,
  `herdr agent explain` 실제 출력을 확인했습니다.
- Herdr 세션 안에서 오른쪽 pane을 split하고 Antigravity agent를 `agent start` → `agent prompt
  --wait` → `agent read`로 구동해 automation 흐름을 실측했습니다.
- `herdr.dev/llms.txt`, `agent-guide.md`와 `v0.9.5` tag의 공식 문서(concepts, agents,
  session-state, socket-api, cli-reference, integrations, configuration, connecting-machines,
  plugins, persistence-remote, agent-automation, add-herdr-support, agent-skill)를 읽었습니다.
- Herdr TUI는 Rust로 작성되었고 라이선스는 Apache-2.0입니다. 코드 계보가 없으므로 cherry-pick이나
  구현 복사가 아니라 **개념과 계약**만 차용 대상으로 봅니다.
- Home page의 별도 제품(native Herdr app, `herdr-core`, `hc` CLI)과 marketing 수치는 TUI 문서에
  근거가 없어 범위에서 제외했습니다. (보충 감사에서 정정: 두 repo는 공개 문서가 있고 multi-agent
  기능의 중심입니다.)

## Herdr 기능 인벤토리

### 제품 모델

Herdr는 coding agent용 terminal workspace manager입니다. Background server가 PTY와 process를
소유하고 client(TUI)는 렌더링만 합니다. Detach가 작업을 죽이지 않는 것이 기본 원칙입니다.

| 계층 | 의미 | ID 예 |
| --- | --- | --- |
| Session | 독립 server, socket, state. `herdr session list/attach/stop/delete` | `default` |
| Workspace | repo/작업 단위 | `w1` |
| Tab | layout view | `w1:t1` |
| Pane | 실제 terminal, right/down split | `w1:p1` |
| Agent | pane 안에서 인식된 coding agent process. 고유 live name 부여 가능 | `reviewer` |

ID는 opaque하고 재사용하지 않습니다. Pane을 다른 workspace로 옮기면 새 ID를 받고 이전 ID는
옮겨진 process의 caller context에서만 alias로 해석됩니다.

### Agent 감지와 상태

- 감지는 foreground process 판별 → pane 하단 buffer snapshot에 대한 TOML detection manifest
  매칭입니다. Manifest는 원격 갱신됩니다(`~/.local/state/herdr/agent-detection/remote/*.toml`).
- Integration이나 agent 자체가 `pane report-agent --state ... --seq N`으로 보고하면 화면 감지보다
  우선합니다. `--seq`는 단조 증가해야 합니다.
- 상태: `working`, `blocked`(승인/질문 UI), `done`(완료했으나 아직 보지 않음), `idle`(완료 후 확인됨),
  `unknown`(분류 불가, 성공의 증거 아님).
- `blocked`는 의도적으로 엄격합니다. 알려진 승인 UI와 일치할 때만 설정하고, 규칙이 없으면 `idle`로
  fallback하며 이 사실을 `fallback_reason: default_known_agent_idle_fallback`으로 노출합니다.
- `herdr agent explain`은 어떤 manifest/rule/fallback으로 현재 상태가 정해졌는지 출력합니다.
- `done`/`idle` 구분: server는 명시적 focus(`pane focus`, `agent focus`)만 seen으로 기록하고 read는
  seen으로 치지 않습니다. TUI client는 client별로 표시한 완료를 따로 추적합니다.
- `completion_seq`가 idle 전이가 실제 완료 작업인지 구분합니다.
- Rollup: blocked pane은 tab/workspace를 blocked로, working은 workspace를 active로 보이게 하고
  done은 볼 때까지 유지됩니다.
- `status_indicators = "symbols"`로 색 대신 모양 기반 상태 표시를 선택할 수 있습니다.

### 알림

- `[ui.toast] delivery = herdr | terminal | system | off`, `delay_seconds`(기본 예시 1초).
- 현재 보고 있는 tab의 popup은 억제합니다.
- 사운드는 완료(`done_path`)와 주의 필요(`request_path`)를 분리하고 agent별 on/off가 있습니다.
- `notification show`는 결과를 `shown`, `disabled`, `rate_limited`, `no_foreground_client`, `busy`
  같은 이유 코드로 반환합니다. Title 80자, body 240자 상한입니다.
- Windows system notification 클릭은 원래 pane을 선택합니다.

### Automation CLI와 Socket API

- Transport는 newline-delimited JSON over Unix socket/named pipe입니다. 성공은
  `{"id","result":{"type"}}`, 실패는 `{"id","error":{"code","message"}}`이고 CLI 오류는 stderr JSON,
  exit 1(server error)/2(usage)입니다. `herdr api schema`가 schema를 출력합니다.
- Managed pane에는 `HERDR_ENV=1`, `HERDR_PANE_ID`, `HERDR_TAB_ID`, `HERDR_WORKSPACE_ID`,
  `HERDR_SOCKET_PATH`를 주입하고 CLI는 `--current`로 caller pane을 가리킵니다.
- `agent start <name> --kind K --pane P`는 shell prompt 상태 pane에서만 agent를 띄우고, 감지되어
  입력 가능할 때까지 기다린 뒤 반환합니다. Layout을 만들거나 옮기지 않습니다.
- `agent prompt <target> <text> --wait --timeout`은 bracketed paste + Enter를 하나의 submission으로
  보냅니다. 이미 blocked이면 입력 없이 `agent_blocked`, 5초 안에 working/blocked 관찰이 없으면
  `agent_prompt_stalled`를 반환합니다.
- `agent wait --until STATUS`는 server-owned event-driven wait이고, `pane wait-output
  --match/--regex`는 polling이며 이미 화면에 있는 텍스트도 즉시 매치합니다(보충 감사 정정).
  Timeout이나 stall이 미전달을 증명하지 않는다는 점을 문서로 명시합니다.
- `agent read`/`pane read`는 `visible`, `recent`, `recent-unwrapped`, `detection` source를 고릅니다.
- `events.subscribe`는 bounded history를 쓰고 overflow 시 `events_lost` → resubscribe +
  `session.snapshot`으로 복구합니다.
- `herdr --skill`과 `skills/herdr/SKILL.md`가 agent에게 위 계약과 안전 규칙
  (`HERDR_ENV` 확인, 남이 만든 pane 닫지 않기, `--no-focus`, ID는 응답에서 파싱)을 가르칩니다.

### 세션 영속성과 복원

| 경우 | process | layout | agent 대화 |
| --- | --- | --- | --- |
| Detach/reattach | 유지 | 유지 | 유지 |
| Server restart | 소멸 | layout/cwd/focus를 새 shell로 복원 | native session restore가 있을 때만 재개 |
| `update --handoff`(실험) | live PTY 이전 | 유지 | 유지 |

- `session.json`, 최대 48개 `session-snapshots/`(15분당 최대 1개), 파싱 불가 파일의 3개
  `session-backups/` recovery copy를 둡니다.
- `[session] resume_agents_on_restore = true`, `startup_per_agent_delay_ms = 100`으로 복원 시
  `codex resume <id>` 같은 native resume을 시차를 두고 실행합니다.
- Pane 화면 history 저장은 secret 노출 위험 때문에 기본 off입니다.
- 저장된 cwd가 사라지면 home으로 옮기지 않고 오류 상태로 둡니다.

### Integration과 plugin

- `integration install codex`는 `herdr-agent-state.sh`를 쓰고 `hooks.json`과 `config.toml`
  `[features] hooks = true`를 병합합니다. Uninstall은 Herdr 소유 entry만 되돌립니다.
- 주목적은 native session restore용 session id 보고이며, Codex 상태는 여전히 화면 감지입니다.
- Plugin은 `herdr-plugin.toml`의 `[[startup]]`, `[[actions]]`, `[[events]]`, `[[panes]]`,
  `[[link_handlers]]`로 구성되고 sandbox 없이 사용자 권한으로 실행됩니다.

### Git worktree

- Worktree는 Git provenance를 가진 일반 workspace이고 parent repo workspace 아래 group으로
  묶입니다. `worktree create/open/remove`, branch는 절대 삭제하지 않고 dirty checkout 강제 제거는
  확인을 받습니다.

### 원격과 multi-client

- 저장된 SSH machine 여러 대를 한 sidebar에 두고, 선택하지 않은 machine은 화면이 아니라
  workspace/agent state/notification만 stream합니다. `--machine`으로 원격 API를 forward합니다.
- 여러 client가 같은 tab을 보면 가장 최근에 상호작용한 client 크기를 따르고, client가 없으면
  마지막 크기 또는 headless 120x40을 유지합니다.
- `terminal session observe`(read-only 다수)와 `control`(writable 단일 owner, `--takeover`)을
  구분합니다.

### 명시된 설계 원칙

- Semantic state가 wait, notification, rollup의 권위이고 display label/metadata는 표시 전용입니다.
- 엄격한 blocked 감지. Idle은 입력 승인이 아닙니다.
- Integration 보고는 화면 감지보다 우선하며 sequence로 순서를 보장합니다.
- Prefix-first keymap으로 shell/editor 입력을 빼앗지 않습니다.
- Pane history는 secret 위험 때문에 기본 off입니다.
- Remote credential을 저장하지 않고, 승인 없이 원격 server를 설치/재시작하지 않습니다.

## Codexmux 대비 비교

판정은 현재 working tree를 직접 읽은 결과입니다. `있음`은 동등 기능, `부분`은 일부만 있음,
`없음`은 해당 기능이 없음을 뜻합니다.

| 영역 | Herdr | Codexmux 현재 | 판정 |
| --- | --- | --- | --- |
| 상태 모델 | working/blocked/done/idle/unknown | busy/needs-input/ready-for-review/idle/unknown 등 (`src/types/status.ts`) | 있음 |
| Done 미확인 | server는 명시 focus만 seen, client별 badge | `ready-for-review` → focus/tab 전환 시 server-wide dismiss (`status-client-event-policy.ts:40-49`) | 있음 |
| Workspace rollup | blocked/working/done rollup | 미커밋 activity label이 대표 문구 제공 (`src/lib/workspace-activity.ts`) | 있음 |
| 완료 sequence | `completion_seq` | `eventSeq`는 hook/recovery event 수이며 메모리 0부터 시작, 완료 counter 없음 | 없음 |
| 상태 판정 근거 | `agent explain` (manifest, rule, fallback_reason) | `lastEvent {name, at, seq}`만 있고 어떤 신호가 상태를 정했는지 없음 | 부분 |
| 자동화 CLI | `agent prompt --wait`, `agent wait --until`, `pane wait-output`, `agent read --source` | `tab send`(bracketed paste+Enter), `tab status`(layout 저장 `cliState`), `tab result`(visible 화면만) (`bin/cli.js:259-286`) | 부분 |
| 입력 가드 | blocked이면 입력 없이 `agent_blocked`, 무반응이면 `agent_prompt_stalled` | `tab send`는 상태와 무관하게 입력 | 없음 |
| Caller context | `HERDR_ENV`, `HERDR_PANE_ID` 등 주입, `--current` | `env -i` allowlist로 tab/workspace 식별 env 없음 (`src/lib/shell-env.ts:3-57`) | 없음 |
| Agent skill | `herdr --skill`, 안전 규칙 포함 | `codexmux api-guide` HTTP reference만 있고 agent에게 주입되지 않음 | 부분 |
| 알림 종류 | 완료/주의 필요 사운드 분리, active tab popup 억제 | Toast·사운드는 완료만, needs-input은 Web Push만 (`use-toast-notification.ts`, `status-notification-policy.ts:20-24`) | 부분 |
| 알림 지연·rate limit | `delay_seconds`, `rate_limited` reason | 완료 key dedupe(500개)만 있고 시간 기반 debounce 없음 | 부분 |
| 주의 탭 이동 | `focus_agent` index, sidebar Agents view | 번호 workspace/tab 전환만 있고 "다음 입력 대기 탭" 이동 없음 (`keyboard-shortcuts.ts`) | 없음 |
| 색 비의존 표시 | `status_indicators = "symbols"` | needs-input과 ready-for-review가 같은 pulsing dot의 색상 차이 (`tab-status-indicator.tsx:32-50`) | 부분 |
| Event 유실 복구 | bounded history, `events_lost` → snapshot | Backpressure 1MiB 이상 client에는 broadcast를 counter만 남기고 skip, resync 신호 없음 (`status-manager.ts:1262-1285`) | 없음 |
| 상태 파일 복구 | 48개 snapshot + 3개 recovery copy | temp+rename atomic write, parse 실패 시 단일 `.json.bak` 덮어쓰기 (`layout-store.ts:127-153`) | 부분 |
| 재부팅 후 재개 | `resume_agents_on_restore`, `startup_per_agent_delay_ms` | 자동 `codex resume`, shell 확인 후 전체 병렬 전송, 끄는 설정과 stagger 없음 (`auto-resume.ts:84-114`) | 부분 |
| Multi-client 크기 | 최근 상호작용 client 기준, headless fallback 문서화 | Legacy는 tmux 기본 규칙, Runtime v2는 마지막 resize 우선, 문서 정책 없음 | 부분 |
| Worktree | worktree = grouped workspace | Workspace group은 있으나 worktree 기능 없음 | 없음 |
| Remote machine | SSH machine federation, `--machine` | 제품 범위 밖 (`docs/FOLLOW-UP.md` Remote topology) | 해당 없음 |
| Plugin | manifest 기반 action/event/pane | 없음 | 해당 없음 |

### 부수 발견

- CLI route는 legacy tmux socket `codexmux`를 쓰고 Runtime v2 terminal worker는
  `codexmux-runtime-v2` socket을 씁니다. 2026-11-09 live host의 session은 모두 legacy socket에
  있어 현재 CLI는 동작하지만, terminal을 v2 worker로 옮기면 `tab send/result/status`가 session을
  찾지 못할 수 있습니다.
- `bin/codexmux.js`의 `CLI_COMMANDS`에 `memory`, `mem`이 있으나 `bin/cli.js`에 해당 case가 없어
  "unknown command"로 실패합니다.
- `src/proxy.ts`는 CLI token을 모든 API route에서 받아들입니다. 위임 자동화를 넓히기 전에 token
  범위를 다시 검토해야 합니다.

## 차용 후보

| ID | 후보 | Herdr 근거 | 가치 | 크기 | 경계 영향 |
| --- | --- | --- | --- | --- | --- |
| H1 | Codex 위임 자동화: `tab send --wait`, `tab wait --until`, live status 포함 `tab list`, scrollback `tab read`, needs-input 입력 가드, 완료 sequence, tab/workspace caller env, agent 안내 | agent prompt/wait/read, caller context, skill | 높음 | 큼 | CLI 공개 계약, shell env allowlist, token 범위. ADR 후보 |
| H2 | 주의 필요 알림 정밀화: needs-input toast·사운드, 완료/입력 대기 사운드 분리, 짧은 전이 debounce | `request` sound, `delay_seconds` | 중간 | 중간 | Notification semantics. ADR 갱신 후보 |
| H3 | 다음 주의 탭 이동 단축키: 입력 대기 → 확인 필요 순으로 workspace를 가로질러 이동 | `focus_agent`, attention rollup | 중간 | 작음 | Keybinding 추가 |
| H4 | 색 비의존 상태 표시: needs-input과 ready-for-review를 모양으로 구분 | `status_indicators = "symbols"` | 중간 | 작음 | `DESIGN.md`/`docs/STYLE.md` 검토 |
| H5 | 상태 파일 recovery copy 회전: timestamp `.bak` N개 보존, 손상 시 덮어쓰기 금지 | `session-backups/`, `session-snapshots/` | 중간 | 작음 | Storage layout. `docs/DATA-DIR.md` |
| H6 | 자동 재개 stagger와 끄기 설정 | `startup_per_agent_delay_ms`, `resume_agents_on_restore` | 중간 | 작음 | `config.json` field 추가 |
| H7 | Status/sync stream 유실 신호와 재동기화: backpressure skip을 dirty로 기록하고 drain 뒤 full sync | `events_lost` → `session.snapshot` | 높음 | 작음~중간 | WebSocket 계약. `docs/STATUS.md` |
| H8 | 상태 판정 근거 기록: 어떤 신호(hook, JSONL, pane capture, polling, fallback)가 상태를 정했는지 debug API와 CLI로 노출 | `agent explain`, `fallback_reason` | 중간 | 중간 | Status payload. `docs/STATUS.md` |
| H9 | Multi-client terminal 크기 정책 문서화 | multi-client 규칙 | 낮음 | 작음 | `docs/TMUX.md` |

## 제외

| Herdr 기능 | 제외 이유 |
| --- | --- |
| SSH machine federation, `--machine`, remote attach | Remote topology는 별도 lifecycle 범위이며 Linux 단일 엔진 authority와 충돌 |
| Plugin system, marketplace | Sandbox 없는 사용자 권한 실행. 제품 정체성(Codex 세션 매니저)과 맞지 않음 |
| Git worktree workspace | Project write 경계 확대. Governance arbitrary write 금지와 충돌하므로 별도 lifecycle |
| Live handoff on update | tmux가 이미 server 재시작 동안 process를 보존 |
| Detection manifest, 24개 agent kind | Provider registry는 Codex 단일 provider 계약 |
| Pane 화면 history replay | Herdr도 secret 위험으로 기본 off. Full-output 저장은 별도 lifecycle |
| Prefix keymap, mouse-first TUI | Web UI와 입력 모델이 다름 |
| Process-reported title/metadata (`report-metadata`) | tmux title이 고정 format으로 override되고 Codex 단일 provider에서 가치가 낮음 |
