# Codex 보조 설계 (설계 2-1: hook 검토, update 안내, TUI 준비 감지)

- 작성일: 2026-11-15
- 상태: Approved — 2026-11-15 사용자: "후속 작업 승인합니다." (설계 승인과 계획 진행)
- Lifecycle: brainstorming(방식 선택 "1", 설계 요약 "승인 합니다.") → builder check(독립 subagent, 질문 3개 중 2개는
  사용자 답, 1개는 문서 수정으로 반영) → 승인. grill-me는 brainstorming 질문과 builder check로 대신한다. 설계 리뷰는
  계획을 쓴 뒤 plan-eng-review에서 코드와 함께 본다(controller 판단).
- 요청: 설계 2 = D(Codex 보조) + E(일반 UI) (사용자 순서 확정 2026-11-10). 이 문서는 D만 다룬다. E(Git side panel,
  모바일 Git 전체 화면, reload 복구)는 서로 독립이라 따로 설계한다(2026-11-15 brainstorming에서 나누기로 함).
- 관련 문서: `2026-11-10-claude-code-provider-design.md`(설계 1), `../../PURPLEMUX-ADOPTION-AUDIT.md`
  "보충 분석 (2026-11-10)", `../../operations/2026-11-10-multi-agent-brainstorming-handoff.md`, `../../CLI.md`,
  ADR-035/036/037
- 비교 기준: purplemux `src/lib/codex-update-prompt-detector.ts`, `src/lib/codex-tui-ready-detector.ts`,
  Codex source `openai/codex`(`codex-rs/hooks/src/engine/discovery.rs`, `command_runner.rs`), 설치된 Codex `0.167.0`

## 의도와 이유

설계 1로 agent가 다른 탭에 일을 맡길 수 있게 됐다. 하지만 2026-11-11 격리 live 확인에서 agentmux가 띄운 Codex
`0.167.0`이 매번 "Hooks need review" 화면에서 멈췄다. 그래서 `agentmux tab create -t codex`는 항상 `ready: false`였고,
Codex를 위임 대상으로 쓸 수 없었다. 사용자의 실제 흐름("Claude Code가 Codex 지시서를 쓰고 Codex가 적용")에는
Codex 위임이 핵심이다.

purplemux에는 있고 agentmux에는 없는 Codex 보조 기능 두 가지도 함께 채운다. 하나는 update 안내 화면에 웹에서
답하는 기능이고, 다른 하나는 TUI 준비 감지다. 모두 agentmux가 띄운 Codex가 화면 앞에 사람이 없어도 막히지 않게
하는 일이다.

## 사용자 결정

- 설계 2는 D와 E로 나누고 D(Codex 보조)부터 한다(2026-11-15, 제안 승인).
- Hook 검토 화면은 "hook 명령을 고정하고 사용자가 Codex 화면에서 한 번 trust"하는 방식으로 없앤다(2026-11-15
  사용자: "1"). 고를 때 제시한 조건은 "확인해 보니 Codex가 이 trust를 기억하지 않으면 2로 간다"였다. 그래서 trust가
  유지되지 않는 것으로 확인되면 방식 2의 좁은 형태로 바꾼다. 좁은 형태는 agentmux 자기 session-flag hook에 대해서만
  실행마다 `-c hooks.state…trusted_hash=`를 넘기는 것이다(아래 Approaches). Codex hook을 쓰지 않는 방식 3은 고르지
  않았다.
- 설계 요약(hook 명령 고정 + 검토 화면 웹 카드, update 안내 웹 카드, TUI 준비 감지로 웹 입력 잠금)을 승인했다
  (2026-11-15 사용자: "승인 합니다.").
- 검토 카드의 trust 버튼은 화면의 "N hooks are new or changed" 개수가 agentmux가 붙이는 hook 수와 같을 때만 보인다
  (2026-11-15 사용자: "개수가 맞을 때만 버튼"). "Trust all and continue"는 그 실행에서 새로 생겼거나 바뀐 hook을
  출처와 관계없이 모두 trust하기 때문이다(trust된 폴더의 project `.codex/` hook 포함).
- 확인 실험은 별도 `CODEX_HOME`에서 한다. 그 home의 Codex 로그인은 사용자가 직접 한 번 한다(2026-11-15 사용자: "별도
  home에 직접 로그인"). `~/.codex/auth.json` 복사는 쓰지 않는다. 격리 쪽 Codex가 token을 갱신하면 원래 로그인이 끊길
  수 있기 때문이다.
- 설계 1의 결정은 그대로 유지한다: 위임은 확인 없이 진행, agentmux가 띄운 Claude Code에서 `agentmux tab` 하위 명령
  미리 허용, agent 호출자는 agent 탭에만 `tab send`.

## 목표

1. agentmux가 띄운 Codex에서 "Hooks need review" 화면은 처음 한 번만 뜬다. hook 정의가 바뀌는 경우에도 다시 뜬다
   (node 경로, bridge 경로, hook 종류가 바뀔 때). 사용자가 한 번 trust한 뒤에는 새 탭, 재개, 재시작에서 뜨지 않는다.
2. 그 한 번의 검토 화면을 웹(모바일 포함)에서 카드로 보고 답할 수 있다.
3. Codex update 안내("Update available! x -> y")를 웹 카드로 보고 Update now / Skip / Skip until next version을 고를
   수 있다. 업데이트 중과 성공 화면도 카드가 구분해 보여 준다.
4. Codex TUI의 입력창이 준비되기 전에는 웹 입력이 prompt를 보내지 않는다. 시작 진행 표시는 준비될 때까지 남는다.
5. Hook trust 뒤에는 `agentmux tab create -t codex`가 `ready: true`를 돌려주고, Claude → Codex 위임이 끝까지 동작한다
   (설계 1 인수 기준 10의 Codex 부분).
6. 기존 Codex 탭 동작(상태 판정, timeline, 재개, rate limit)과 Claude 탭 동작은 바뀌지 않는다.

## 비목표

- E 항목(Git side panel, 모바일 Git 전체 화면, reload 복구): 다음 설계 문서
- Claude Code의 hook 설정 방식 변경(Claude는 `--settings` 탭 파일이고 검토 화면이 없다)
- Codex 업데이트를 agentmux가 자동으로 실행하는 것(버튼은 사용자가 누른다)
- Codex `0.167.0` 이전 version 전용 처리. 검토 화면이 없는 version에서는 이 변경이 아무 효과도 없어야 한다

## Anti-goal

- agentmux가 사용자 `~/.codex/config.toml`(또는 `CODEX_HOME`)의 `hooks.state`나 다른 값을 쓴다. Trust는 사용자가 Codex
  화면(또는 웹 카드)에서 고르고, Codex가 기록한다(ADR-035).
- agentmux가 `--dangerously-bypass-hook-trust`로 Codex의 hook 검토를 건너뛴다. 이 flag는 사용자 project hook까지 모든
  hook의 검토를 끈다. `-c hooks.state…trusted_hash=`는 확인 실험에서 trust가 유지되지 않을 때만, agentmux 자기
  session-flag hook에 대해서만 쓴다(사용자 결정의 조건).
- 웹 카드나 위임 CLI가 사용자 선택 없이 검토 화면·update 안내에 key를 보낸다. 카드는 사용자가 누른 버튼만 보낸다.
  위임 CLI는 지금처럼 이 화면들에 입력하지 않는다(`target-not-ready`).
- Hook 명령에서 빠진 탭 식별 정보 때문에 다른 탭의 hook이 이 탭 상태를 바꾼다.
- 공개 repo에 사용자 데이터(실제 trust hash, 경로 목록, 대화)가 fixture로 들어간다.

## 현재 사실 (2026-11-15 조사)

### 검토 화면이 매번 뜨는 이유

- agentmux는 Codex를 띄울 때 hook을 `-c 'hooks.<Event>=[...]'`로 붙인다(`src/lib/providers/codex/session-hooks.ts`).
  붙는 hook은 SessionStart(matcher `startup|resume`), UserPromptSubmit, Stop이다.
- Hook 명령은 `ELECTRON_RUN_AS_NODE=1 '<node>' '<dataDir>/status-hook.cjs' '<event>' '<sessionName>' '<capability>'`다.
  - `sessionName`은 탭마다 다르다.
  - `capability`(`src/lib/agent-hooks.ts:20-33`)는 `{ v, tabId, sessionName, expiresAt: now + TTL }`의 HMAC 서명값이라
    실행마다 다르다.
- Codex는 hook trust를 `hooks.state."<key_source>:<event>:<group>:<handler>".trusted_hash`로 기억한다.
  - Hash는 event, matcher, group, handler 정의(명령 문자열 포함)로 계산한다(`discovery.rs` `hook_hash`).
  - `-c`로 붙인 hook의 `key_source`는 `<session-flags>/config.toml`이다.
  - `hooks.state`는 모든 설정 단계를 합쳐 읽는다(`hook_states_from_stack`).
  - Source를 읽은 결론(추론): 명령이 같으면 key와 hash가 같다. 지금은 명령이 매번 달라 hash가 맞지 않고, 그래서
    매번 "Modified"나 "Untrusted"로 검토 화면이 뜬다. **실제 Codex로는 아직 확인하지 않았다.** Codex가 "Trust all"을
    눌렀을 때 session-flag 단계의 trust를 사용자 설정에 기록하는지, 다음 실행에서 그 기록을 맞춰 보는지는 계획의 첫
    작업(확인 실험)에서 확인한다.
  - Key는 hook 출처가 아니라 단계와 순서로 정해진다. 그래서 bridge 경로나 node 경로가 다른 두 agentmux(예: live
    server와 개발용 격리 server)가 같은 `CODEX_HOME`을 쓰면, 같은 key의 trust hash를 서로 덮어써 번갈아 검토 화면이
    뜬다. Live는 server 하나라 해당하지 않는다. 개발·확인에는 격리 `CODEX_HOME`을 쓴다.
- 사용자 `~/.codex/config.toml`에는 사용자 자신의 `~/.codex/hooks.json` hook trust 기록만 있다. agentmux 기록은 없다.
- Codex `0.167.0`에는 `--dangerously-bypass-hook-trust`가 있다("Intended only for automation that already vets hook
  sources").

### Hook process 환경

- Codex는 hook 명령을 shell(`-lc`)로 실행한다(`command_runner.rs` `build_command`).
- Unix에서는 환경을 비우지 않는다. Codex process의 환경을 물려주고, 정해진 이름 목록(`NON_INHERITABLE_ENV_VARS`,
  정확한 이름 일치)만 뺀다. 따라서 실행 명령 앞에 붙인 환경 변수는 hook에 닿는다.
- 설계 1의 위임 환경 변수(`AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`)는 위임 설정이 켜졌을 때만 붙는다. 이 설계의 hook
  환경 변수는 위임 설정과 관계없이 늘 붙어야 한다(상태 판정은 위임과 별개다).

### 화면 카드 경로

- 탭 화면 문구를 읽어 카드를 띄우는 경로가 이미 있다.
  - Claude/Codex folder trust: `src/hooks/use-trust-prompt-detector.ts` → `trust-prompt-card.tsx`. xterm buffer 문구 →
    debounce 감지 → 카드 → 사용자가 누르면 stdin key.
    - 이 카드는 `cliState`가 `inactive`/`unknown`이거나 보기가 `check`일 때만 켜진다(`pane-container.tsx:431-433`,
      `mobile-surface-view.tsx:277-278`). 그런데 hook 검토 화면이나 update 안내가 떠 있는 동안 Codex 탭은 `busy`이고
      보기는 `timeline`이다(실행 중이고 JSONL이 없으면 reconcile이 `busy`로 둔다). 새 카드는 이 조건 없이도 떠야 한다.
    - 같은 이유로 시작 진행 표시(`src/lib/agent-boot-display.ts` `resolveAgentBootDisplay`)는 `busy`가 보고되면 지금 바로
      사라진다.
  - Bypass 확인: `bypass-prompt-card.tsx`.
- 서버 쪽 판정(`src/lib/agent-startup-screen.ts` `matchAgentStartupScreen`)은 위임 CLI 거절용이다. `'trust'`,
  `'codex-update'`, `'codex-hooks-review'`를 안다.
- 시작 진행 표시: `agent-boot-view.tsx`(`agent-panel.tsx`가 띄움). 웹 입력 잠금: `web-input-bar.tsx`의
  `useWebInput` `mode`, `canSend`.

### purplemux 방식

- `matchCodexUpdatePrompt(text)`: 공백을 접은 문구에서 `Update available! <cur> -> <latest>`,
  `Update now (runs \`<cmd>\`)`, "Release notes:", "Skip until next version"을 찾는다. 상태는 `prompt | updating |
  success`("Updating Codex via `", "Update ran successfully! Please restart Codex.").
- `isCodexTuiReadyContent(content)`: update 안내가 아니고 "Input disabled."가 없고, 마지막 8줄 안에 입력창 줄이
  있으면 준비다. 입력창 줄 정규식은 `/^\s*›(?:\s*$|\s+(?!\d+\.)(?!\[[ x-]\])[^\n]*)$/m`이다. 번호 선택지(`› 1. ...`)와
  checkbox 줄은 입력창으로 보지 않는다.

## 설계

### 1. Hook 명령 고정

- 계획의 첫 작업은 확인 실험이다. 격리 `CODEX_HOME`에서 고정한 `-c` hook 문자열로 Codex를 띄운다. 검토 화면에서
  trust한 뒤 다시 띄워, 화면이 뜨지 않는지와 `CODEX_HOME/config.toml`의 `hooks.state` 기록을 확인한다.
  - 유지되면 아래대로 간다.
  - 유지되지 않으면 이 절의 명령 고정은 그대로 두고, trust를 방식 2의 좁은 형태(agentmux 자기 session-flag hook의
    `-c hooks.state…trusted_hash=`)로 바꾼다. 2절의 카드는 필요 없어진다.
  - update 카드(3절)와 TUI 준비 감지(4절)는 이 결과와 관계없이 진행한다.
- Codex hook handler의 명령에서 `sessionName`과 `capability` 인자를 뺀다. 명령은
  `ELECTRON_RUN_AS_NODE=1 '<node>' '<dataDir>/status-hook.cjs' '<event>'`다. 같은 server의 모든 Codex 탭과 실행에서
  같은 문자열이 된다. `commandWindows`(Windows용 명령)에도 같은 인자가 들어 있으니 함께 뺀다.
- 실행 명령 앞에 hook용 환경 변수를 붙인다: `AMUX_HOOK_SESSION=<sessionName>`, `AMUX_HOOK_CAPABILITY=<capability>`.
  - 이름은 builder가 정하되 `NON_INHERITABLE_ENV_VARS`와 겹치지 않아야 한다.
  - 위임 설정과 무관하게 늘 붙는다.
  - 설계 1의 위임 env prefix와 함께 쓸 때 순서와 quoting이 깨지지 않아야 한다.
  - 설계 1의 "위임을 끄면 실행 명령이 byte 단위로 같다"는 보장(ADR-035/037 문구와 test)은 Codex에 대해 "위임 관련 값
    (위임 환경 변수, 안내, 미리 허용)이 붙지 않는다"로 바뀐다. Hook 환경 변수는 상태 표시용이라 위임과 관계없이
    붙는다. ADR 문구와 해당 test를 함께 고친다.
- Bridge(`status-hook.cjs`, `src/lib/hook-settings.ts` `getStatusHookBridgeSource`)는 인자가 있으면 지금처럼 인자를
  쓰고, 없으면 환경 변수를 읽는다. Claude 탭 hook(인자 방식)은 바꾸지 않는다.
- Capability 검증, TTL, 탭 식별 규칙은 그대로다. 다른 탭의 Codex는 자기 process 환경의 값을 쓰므로 탭 섞임이 없다.
- 효과:
  - 사용자가 한 번 trust하면 `<session-flags>/config.toml:session_start:0:0` 등 hook 3개의 trust가 기록된다.
  - 그 뒤 실행부터는 hash가 맞아 화면이 뜨지 않는다.
  - Node 경로, data dir, hook 구성이 바뀌면 hash가 바뀌어 한 번 더 뜬다(목표 1). 문서(`docs/CLI.md` 또는 운영 문서)에
    적는다.
- Trust하지 않으면("Continue without trusting") Codex는 agentmux hook을 실행하지 않는다.
  - 상태 판정은 JSONL reconcile만으로 돈다(설계 1 이전과 같은 정확도).
  - 위임 준비 판정(`session-start`)은 오지 않아 `ready: false`다.
  - 다음 실행에 화면이 다시 뜬다.

### 2. Hook 검토 화면 웹 카드

- Codex 탭 화면에 "Hooks need review"와 선택지("Trust all and continue", "Continue without trusting")가 보이면 카드를
  띄운다. 기존 trust 카드와 같은 client 경로다(buffer 문구 감지 → 카드 → 사용자가 고른 선택지의 key 입력).
- 카드 내용:
  - 몇 개의 hook이 새로 생겼거나 바뀌었는지(화면의 "N hooks are new or changed", "1 hook is new or changed")
  - 버튼 "trust하지 않고 계속"은 늘 둔다.
  - 버튼 "모두 trust하고 계속"은 화면의 개수가 agentmux가 붙이는 hook 수와 같을 때만 둔다. 지금은 SessionStart,
    UserPromptSubmit, Stop의 3개이고, 값은 `session-hooks.ts`의 hook 목록에서 얻는다(하드코딩 금지).
    - 개수가 같을 때만 "이 hook은 agentmux 상태 표시용"이라고 설명한다.
    - 개수가 다르거나 읽지 못하면 trust 버튼을 빼고 "agentmux 밖의 hook이 포함돼 있을 수 있습니다. terminal 화면의
      Review hooks에서 목록을 확인하세요"라고 안내한다.
  - "Review hooks"(목록 보기)는 terminal 화면에서 직접 하도록 안내하는 문구만 둔다.
- Trust를 고르면 Codex가 사용자 설정에 기록한다는 점을 카드 설명에 한 줄로 적는다.
- 개수는 같지만 그중 일부가 agentmux hook이 아닌 경우(예: agentmux hook 2개 trust 뒤 project hook 1개와 바뀐 agentmux
  hook 2개)는 화면만으로 구분할 수 없다. 이 남은 위험은 받아들이고 문서에 적는다(사용자 결정의 범위).
- 선택지 순서와 현재 선택 표시는 화면에서 읽는다. 하드코딩한 번호에 의존하지 않는다. 기존 trust 카드의
  `trustAnswerKeys`처럼 화살표와 Enter로 움직이거나, 화면의 번호를 쓴다(builder 재량, 화면 fixture test로 고정).

### 3. Codex update 안내 웹 카드

- `matchCodexUpdatePrompt`와 같은 판정(문구와 상태 `prompt | updating | success`)을 agentmux에 둔다. 위임 CLI의
  `matchAgentStartupScreen`과 하나의 판정 함수를 함께 쓴다(중복 정규식 금지).
- `prompt` 상태:
  - 카드에 현재·최신 version, 실행될 명령(`npm install -g @openai/codex` 등 화면 문구 그대로)을 보인다.
  - 버튼은 Update now / Skip / Skip until next version이다.
- `updating`이면 진행 중 표시만 보이고 버튼은 없다. `success`면 "Codex를 다시 시작하세요" 안내와 재시작 버튼을 보인다.
  재시작 버튼은 기존 탭 재시작 기능을 쓴다(builder가 기존 restart 경로 확인).
- 위임 CLI는 지금처럼 이 화면에 입력하지 않는다(`target-not-ready`).

### 4. TUI 준비 감지

- `isCodexTuiReadyContent`와 같은 판정을 agentmux에 둔다(update 판정 재사용).
- Codex 탭이 시작 중이고(실행 뒤 아직 준비 표시 전) 화면이 준비가 아니면:
  - 시작 진행 표시(`agent-boot-view`)를 유지한다.
  - 웹 입력은 prompt를 보내지 않는다. 입력은 할 수 있고 보내기만 막는다.
- 한 번 준비가 되면 그 실행 동안은 다시 막지 않는다.
- 판정이 계속 실패해 사용자가 막히지 않도록 일정 시간(builder 재량, 예: 30초) 뒤에는 준비로 본다. 단, 알려진 차단
  화면(hook 검토, update 안내, folder trust)이 보이는 동안은 시간이 지나도 풀지 않는다. 그 상태에서 Enter가 기본
  선택지를 고를 수 있기 때문이다.
- 시작 진행 표시는 지금 `busy` 보고가 오면 사라진다(`resolveAgentBootDisplay`). Codex는 TUI가 준비되기 전에도 `busy`가
  되므로, Codex 탭의 표시 종료 조건에 TUI 준비를 더한다.
- 위임 CLI의 준비 판정은 설계 1대로 `session-start` hook이다. TUI 판정은 웹 입력과 표시용이다.
- Claude 탭에도 같은 문제(첫 화면에 보낸 prompt 유실, 설계 1 단계 3 live 확인)가 있다. 이 설계는 Codex만 다룬다.
  Claude 쪽은 후속으로 남긴다(비목표 아님, 범위 밖 후속).

## Approaches

| 방식 | 내용 | 장단점 | 결정 |
| --- | --- | --- | --- |
| 1. 명령 고정 + 사용자가 한 번 trust | 탭·실행마다 바뀌는 값을 환경 변수로 옮겨 hook 명령을 같게 만들고, 처음 한 번 사용자가 trust | Codex의 안전 검토를 살림. agentmux는 설정을 쓰지 않음. 처음 한 번, hook 정의가 바뀔 때 한 번씩 사용자가 눌러야 함 | **선택** |
| 2. agentmux가 자기 hook을 미리 trust | 실행마다 `-c hooks.state…trusted_hash=` 또는 `--dangerously-bypass-hook-trust` | 화면이 아예 안 뜸. agentmux hook에 대해 Codex 검토를 건너뜀. Bypass flag는 모든 hook(사용자 project hook 포함)의 검토를 끔 | 대체안: 확인 실험에서 1의 trust가 유지되지 않을 때만, `-c hooks.state` 형태로 agentmux 자기 session-flag hook에만 쓴다. Bypass flag는 쓰지 않는다 |
| 3. Codex hook을 쓰지 않음 | 상태를 JSONL과 화면만으로 판정 | trust 문제 없음. busy·idle 판정이 늦고 위임 준비 판정(`session-start`)을 잃음 | 고르지 않음 |

## 인수 기준

1. 명령 고정: 서로 다른 두 탭, 같은 탭의 두 번 실행에서 Codex hook `-c` 설정 문자열이 byte 단위로 같다(unit test).
   Bridge가 환경 변수만으로 hook 요청을 만들고, 기존 인자 방식(Claude)도 그대로 동작한다(unit test).
2. 탭 섞임 없음: 두 Codex 탭의 hook이 각자 자기 탭 상태만 바꾼다(unit test, capability 검증 포함).
3. 한 번 trust: 격리 `CODEX_HOME`(사용자가 `CODEX_HOME=<그 경로> codex login`으로 한 번 로그인)에서 Codex를 띄워
   검토 화면에서 trust한다. 이 확인은 계획의 첫 작업(확인 실험)이고, 나머지 hook 작업은 그 결과를 본 뒤 진행한다.
   - 다시 띄우면 화면이 뜨지 않는다.
   - 새 탭에서도 뜨지 않는다.
   - `CODEX_HOME/config.toml`에 Codex가 쓴 `hooks.state` 기록이 생기고, agentmux가 쓴 값은 없다.
   - 확인은 격리 `CODEX_HOME`에서만 한다. 사용자 `~/.codex`는 읽기만 하고, 전후 sha256이 같다.
4. 카드: hook 검토 화면(개수 3과 일치, 개수 1·다른 값, 개수 읽기 실패)과 update 안내 3상태의 합성 화면 fixture로
   카드 판정, trust 버튼 표시 여부, 보내는 key를 unit test로 고정한다.
   Browser에서 카드가 보이고, 누른 버튼만 입력된다.
5. TUI 준비: 합성 화면(시작 중, update 안내, "Input disabled.", 번호 선택지, 입력창)으로 판정을 unit test한다.
   - 준비 전 웹 입력 보내기가 막힌다.
   - 시간이 지나면 풀린다.
6. 위임: trust 뒤 격리 환경에서 Claude 탭의 agent가 `agentmux tab create -t codex`로 `ready: true`를 받고 `tab send`
   지시가 Codex에 전달된다.
7. 회귀: 기존 test 전부 통과. Codex 상태(busy → ready-for-review), 재개, timeline, rate limit이 그대로다. Claude 탭은
   바뀌지 않는다.
8. 기본 gate: `check:project-design`, 이름 검사, lint, `tsc --noEmit`, unit test, production build.
9. 배포 뒤 live에서 처음 띄운 Codex 탭에 검토 카드가 한 번 뜬다. 사용자가 trust하면 그 뒤로는 뜨지 않는다. 배포
   기록을 handoff에 남긴다.

## Builder 재량

- Hook 환경 변수 이름, bridge의 인자·환경 변수 우선순위 구현
- 카드 문구(한국어·영어), 카드 배치, key 입력 방식(화살표 또는 번호)
- 판정 함수 파일 배치(서버 판정과 client 감지가 함께 쓸 수 있는 순수 module)
- TUI 준비 시간 제한 값
- 단계 나누기(예: 1단계 hook 명령 고정 + 검토 카드, 2단계 update 카드 + TUI 준비)

## Domain Architecture

- 기준 용어: "hook 검토(hook review)"는 Codex가 새로 생겼거나 바뀐 hook을 실행 전에 사용자에게 확인받는 화면이다.
  "hook trust"는 사용자가 그 화면에서 trust를 골라 Codex가 기록한 상태다.
- Module 후보: Codex 화면 판정 module(update, hook 검토, TUI 준비). 서버의 `agent-startup-screen.ts`와 client card
  detector가 같은 함수를 쓴다.
- 공개 계약 영향: Codex hook 명령 형식(내부), bridge 입력(인자 또는 환경 변수), 화면 카드. API·CLI 응답은 바뀌지
  않는다.
- ADR 후보: ADR-038 "Codex hook trust는 사용자가 한 번 주고, agentmux는 hook 명령을 고정해 그 trust가 유지되게
  한다. agentmux는 trust를 쓰거나 검토를 건너뛰지 않는다" (Draft).

## 단계와 배포

builder 재량이다. 기본안은 한 PR이다. 배포는 사용자가 직접 실행한다(main push, `deploy:local`). 이 설계에는 새
의존성과 DB 변경이 없다.
