# Codex 보조 (설계 2-1) Implementation Plan

> **For agentic workers:** Task 1과 Task 6의 확인은 controller(Claude)가 직접 하고, Task 2~5와 Task 6의 문서는 Herdr pane의 agy가 task 단위로 구현한다. Claude가 task마다 diff·test로 검증하고 독립 검토를 돌린다(사용자 결정 2026-11-10: "agy 구현, Claude 감시·검증"). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이 계획은 agentmux가 띄운 Codex가 사람 없이도 시작 화면에서 막히지 않게 한다.
- "Hooks need review" 화면이 처음 한 번만 뜬다.
- 그 화면과 update 안내 화면에 웹 카드로 답할 수 있다.
- TUI가 준비되기 전에는 웹 입력이 prompt를 보내지 않는다.

**Architecture:** Codex hook 명령에서 탭·실행마다 바뀌는 값(session 이름, capability)을 빼고 실행 명령 앞의 환경 변수로 넘긴다. 그러면 명령이 고정돼 Codex의 hook trust가 유지된다. Codex 화면 판정(update 안내, hook 검토, TUI 준비)은 서버와 client가 함께 쓰는 순수 module 하나에 둔다. 카드와 입력 잠금은 기존 folder trust 카드 경로(xterm buffer 문구 → 카드 → 사용자가 누른 key)를 따른다.

**Tech Stack:** TypeScript, Next.js Pages Router custom server, React(zustand), next-intl(ko/en), shadcn/ui, vitest, Codex CLI `0.167.0`.

**Spec:** `docs/superpowers/specs/2026-11-15-codex-assist-design.md` (Approved 2026-11-15)

**Base:** main `768a4ea4`. 문서 branch `docs/codex-assist-design`(spec·plan), 구현 branch `feat/codex-assist`(worktree `/data/projects/agentcode-zone/agentmux/.worktrees/codex-assist`, Task 2 시작 때 main에서 만든다).

## Global Constraints

- **사용자 설정은 읽기만 한다.** 사용자 `~/.codex/`(또는 `CODEX_HOME`), `~/.claude/`, `~/.claude.json`에는 쓰지 않는다. Hook trust는 사용자가 고르고 Codex가 기록한다(ADR-035, spec Anti-goal).
- **검토를 건너뛰지 않는다.** agentmux는 `--dangerously-bypass-hook-trust`를 쓰지 않는다. `-c hooks.state…trusted_hash=`는 Task 1에서 trust가 유지되지 않는다고 확인됐을 때만, agentmux 자기 session-flag hook에만 쓴다. 이 경우 계획을 고친다.
- **사용자가 고른 것만 입력한다.** 카드와 위임 CLI는 사용자가 고르지 않은 key를 검토 화면·update 안내에 보내지 않는다. 위임 CLI는 지금처럼 `target-not-ready`로 거절한다.
- **Claude 쪽은 바꾸지 않는다.** Claude 탭 hook(인자 방식, `--settings` 탭 파일)은 그대로다. bridge는 인자 방식을 계속 받는다.
- **Hook 환경 변수는 늘 붙는다.** 위임 설정과 관계없이 붙는다. 그래서 설계 1의 "위임 끔 = 실행 명령 byte 동일" 보장은 Codex에 대해 "위임 관련 값(위임 환경 변수, 안내, 미리 허용)이 붙지 않는다"로 바뀐다. ADR-035/037 문구와 해당 test를 함께 고친다.
- **화면 규칙:**
  - icon + text label
  - 44px 이상 touch target
  - DOM-safe(`innerHTML`, `dangerouslySetInnerHTML` 금지)
  - 새 문구는 `messages/ko`와 `messages/en`에 함께 넣는다
  - 한국어는 `word-break: keep-all`
  - 모바일(360px)에서도 카드가 보인다
- **`AGENTS.md` 규칙:**
  - Pages Router를 쓰고 `"use client"`는 쓰지 않는다
  - import는 `@/`로 한다
  - 파일명은 소문자-dash다
  - arrow function을 쓴다
  - 타입 이름에 `I`/`T` 접두사를 붙인다
  - `pgrep`/`ps`/`lsof`를 직접 호출하지 않는다
- **Fixture는 합성 데이터만 쓴다.** 공개 repo이므로 실제 경로, hash, 대화를 넣지 않는다. Codex 화면 fixture는 Task 1에서 본 화면을 바탕으로 경로와 hash를 지워 만든다.
- **명령과 commit:**
  - 명령은 `corepack pnpm ...`이다
  - test는 임시 `HOME`과 짧은 임시 `TMUX_TMPDIR`로 돌린다(`HOME=$(mktemp -d /tmp/ca-h.XXXX) TMUX_TMPDIR=$(mktemp -d /tmp/ca-t.XXXX)`). 일부 기존 test가 실제 HOME 아래에 쓴다
  - Commit은 Conventional Commits이고, 본문 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다
  - `--no-verify`와 `git stash`, push는 금지한다
- **작업 위치:**
  - 구현 worktree에서만 작업한다
  - live checkout `/data/projects/agentcode-zone/agentmux`, port 8122, `~/.codexmux`, 기본 tmux socket directory는 건드리지 않는다
  - `deploy:local`과 `systemctl`은 실행하지 않는다

## Review Focus

1. 두 Codex 탭을 동시에 띄워도 각 탭의 hook은 자기 탭 상태만 바꾼다. 환경 변수가 process마다 따로라서다 → Task 2 `codex-session-hooks.test.ts` "two tabs".
2. 배포 전에 띄운 Codex 탭(옛 인자 방식 명령)이 배포 뒤에도 상태를 보고한다 → Task 2 `status-hook-bridge.test.ts` "argument form".
3. 검토 화면 개수가 agentmux hook 수와 다르면(project hook 포함) trust 버튼이 없다 → Task 4 `codex-hooks-review-card.test.ts`.
4. 30초 시간 제한이 지나도 update 안내나 검토 화면이 떠 있는 동안에는 웹 입력이 열리지 않는다 → Task 5 `use-codex-screen-detector.test.ts`.
5. 준비 전에 입력한 글은 보내지지 않고 입력창에 남는다(draft 유지) → Task 5 `use-web-input.test.ts`.
6. 좁은 terminal에서 줄이 바뀌어도 검토 화면과 update 안내를 알아본다 → Task 3 `codex-screen.test.ts` "wrapped".

## Rulings (계획 작성 시 결정)

- **Task 1은 controller가 한다.** 사람 앞에서 Codex 화면을 다루고 사용자의 로그인 단계가 있어서다. agy에게 맡기지 않는다.
- **격리 `CODEX_HOME`은 `$HOME/.cache/agentmux-codex-check`다.** Task 1과 Task 6이 함께 쓰고, 끝나면 사용자가 지운다. 사용자 `~/.codex`가 아니다.
- **hook 개수의 출처는 client가 import할 수 있는 module(`src/lib/codex-session-hook-spec.ts`)이다.** 이 module의 event 목록을 `session-hooks.ts`와 카드가 함께 쓴다. `session-hooks.ts`는 `agent-hooks.ts`(server 전용, crypto)를 import하므로 client가 직접 쓸 수 없다.
- **update 성공 뒤 "다시 시작"은 기존 `/api/agent/launch`를 쓴다.** 탭에 `agentSessionId`가 있으면 `{ action: 'resume', sessionId }`, 없으면 `{ action: 'launch' }`다. 새 API는 만들지 않는다.
- **TUI 준비는 탭과 session마다 한 번 latch한다.** 한 번 준비되면 그 실행 동안은 다시 막지 않는다. 범위 key는 `${tabId}:${sessionName}:${launchKey}`다. `launchKey`는 agent process가 새로 뜰 때 바뀌는 값이고, 정확한 출처는 builder가 정한다.
- **Task 1이 실패하면 멈춘다.** trust가 다음 실행에 유지되지 않으면 Task 2~4를 대체안(spec 방식 2의 좁은 형태)으로 다시 쓰고 사용자에게 알린다. Task 3과 Task 5는 실험 결과와 관계없이 그대로 진행할 수 있다.

---

### Task 1: 확인 실험 — session-flag hook trust 유지와 hook 환경 변수 전달 (controller)

**Files:**
- Create(commit하지 않음): scratchpad `codex-check/probe-hook.cjs`, `codex-check/run.sh`, `codex-check/result.md`
- Create(commit): `tests/fixtures/codex-screens/hooks-review.txt`, `tests/fixtures/codex-screens/hooks-review-one.txt`. 실험 화면에서 경로·hash·계정을 지운 합성본이다. 이번에 update 안내가 뜨면 `update-prompt.txt`도 만든다.

**Interfaces:**
- Produces: 실험 결과(유지 여부, 선택 key, 화면 문구)와 fixture. Task 3·4가 fixture를 쓰고, Task 2가 key 사실을 쓴다.

- [ ] **Step 1: 사용자 로그인.** 사용자에게 `CODEX_HOME=$HOME/.cache/agentmux-codex-check codex login`을 직접 실행해 달라고 요청한다. 사용자 terminal에서 하고, 필요하면 `--device-auth`를 쓴다. 로그인 뒤 그 디렉터리에 `auth.json`이 있는지만 확인한다. 내용은 읽거나 출력하지 않는다.
- [ ] **Step 2: Probe hook.** `probe-hook.cjs`는 받은 `argv[2]`(event)와 환경 변수 `AMUX_HOOK_SESSION`, `AMUX_HOOK_CAPABILITY`를 한 줄 JSON으로 scratchpad log에 덧붙이고 exit 0한다.
- [ ] **Step 3: 첫 실행.**
  - 임시 `TMUX_TMPDIR`와 전용 socket(`-L cacheck`)을 쓰고, 빈 임시 cwd에서 실행한다.
  - 명령은 `CODEX_HOME=… AMUX_HOOK_SESSION=s1 AMUX_HOOK_CAPABILITY=c1 codex -c '<SessionStart>' -c '<UserPromptSubmit>' -c '<Stop>'`이다. 세 hook 설정은 Task 2가 만들 문자열과 같은 모양으로 쓴다. 명령은 `ELECTRON_RUN_AS_NODE=1 '<node>' '<probe>' '<event>'`, `timeout=3`, `async=true`, SessionStart matcher는 `startup|resume`이다.
  - 화면을 capture한다.
  - folder trust 화면이 뜨면 격리 home이므로 "Yes"로 답한다.
  - "Hooks need review" 화면이 뜨면 화면 전체를 저장한다. 화면에 나온 개수, 선택지 순서, 현재 선택 표시, 안내 줄("enter confirm · esc skip")을 기록한다.
- [ ] **Step 4: Trust.** "Trust all and continue"를 고른다. 번호 key 하나로 되는지, 화살표 + Enter가 필요한지 확인해 기록한다. Probe log에 `session-start`와 `s1`/`c1`이 찍히는지 본다. 찍히면 환경 변수가 hook에 전달된 것이다. Codex를 종료한다(`/exit` 또는 Ctrl+C 두 번).
- [ ] **Step 5: 다시 실행.** 같은 `-c` 문자열과 다른 환경 값(`s2`, `c2`)으로 다시 띄운다. 검토 화면이 뜨지 않아야 한다. Probe log에 `s2`가 찍혀야 한다. `CODEX_HOME/config.toml`에서 `[hooks.state."<session-flags>/config.toml:…"]` 항목의 key 모양만 기록한다(hash 값은 기록하지 않는다).
- [ ] **Step 6: 명령이 바뀐 경우.** probe 경로만 다른 명령(복사본 경로)으로 띄우면 검토 화면이 다시 뜨는지 확인한다. 이 화면에서는 "Continue without trusting"을 골라, 바뀐 hook이 실행되지 않는 것까지 확인한다.
- [ ] **Step 7: 정리와 판정.**
  - tmux server를 종료하고 임시 cwd와 `TMUX_TMPDIR`를 지운다. 격리 `CODEX_HOME`은 Task 6에서 다시 쓰므로 남긴다.
  - `result.md`에 다음을 적는다: 유지 여부(예/아니오), 환경 변수 전달 여부, 선택 key, 화면 문구.
  - 사용자 `~/.codex/config.toml`과 `~/.codex/hooks.json`의 sha256이 실험 전후로 같은지 확인한다.
- [ ] **Step 8: Fixture commit.** 저장한 화면에서 경로·hash·계정·version 외 고유값을 지워 fixture로 만든다. 개수 3과 개수 1을 만들고, 개수 1은 문구만 바꾼 합성본이다. Commit 메시지: `test(fixtures): add synthetic Codex hook review screens`.
- [ ] **Gate:** 유지되지 않거나 환경 변수가 hook에 닿지 않으면 여기서 멈춘다. 결과를 사용자에게 보고하고 계획을 고친다.

---

### Task 2: Codex hook 명령 고정 (agy)

**Files:**
- Create: `src/lib/codex-session-hook-spec.ts`
- Modify:
  - `src/lib/providers/codex/session-hooks.ts`
  - `src/lib/providers/codex/index.ts` (`readLaunchOptions`)
  - `src/lib/codex-command.ts` (`ICodexCommandOptions`, 명령 조립)
  - `src/lib/hook-settings.ts` (`getStatusHookBridgeSource`, 9-11행 인자 읽기)
  - `docs/ADR.md` (ADR-035/037 "위임 끔 = byte 동일" 문구)
- Test:
  - `tests/unit/lib/codex-session-hooks.test.ts` (create)
  - `tests/unit/lib/status-hook-bridge.test.ts` (create)
  - `tests/unit/lib/codex-provider-launch.test.ts`
  - `tests/unit/lib/codex-command.test.ts`

**Interfaces:**
- Consumes: Task 1 결과(환경 변수가 hook에 닿음, trust 유지)
- Produces:
  - `src/lib/codex-session-hook-spec.ts`(client-safe, import 없음):
    ```ts
    export interface ICodexSessionHookSpec { event: 'SessionStart' | 'UserPromptSubmit' | 'Stop'; hookEvent: string; matcher?: string }
    export const CODEX_SESSION_HOOKS: readonly ICodexSessionHookSpec[]  // 지금 session-hooks.ts의 3개와 같은 값
    export const CODEX_SESSION_HOOK_COUNT: number                       // CODEX_SESSION_HOOKS.length
    export const CODEX_HOOK_SESSION_ENV = 'AMUX_HOOK_SESSION'
    export const CODEX_HOOK_CAPABILITY_ENV = 'AMUX_HOOK_CAPABILITY'
    ```
  - `buildCodexSessionHookConfigs({ nodePath? }): string[]`
    - `tabId`와 `sessionName` 인자가 빠진다. 결과는 server process 안에서 늘 같은 문자열이다.
    - handler 명령: posix `ELECTRON_RUN_AS_NODE=1 '<node>' '<bridge>' '<hookEvent>'`, windows `set "ELECTRON_RUN_AS_NODE=1" && "<node>" "<bridge>" "<hookEvent>"`.
  - `buildCodexHookEnvPrefix({ tabId, sessionName }): string` (`session-hooks.ts`)
    - 반환값: `AMUX_HOOK_SESSION=<q> AMUX_HOOK_CAPABILITY=<q> `. capability는 지금처럼 `createAgentHookCapability(tabId, sessionName)`이고, 끝에 공백이 붙는다.
  - `ICodexCommandOptions.hookEnvPrefix?: string`
    - 명령 조립: `<hookEnvPrefix><envPrefix>codex …`. hook 환경 변수가 위임 환경 변수 앞에 온다.
  - Codex `readLaunchOptions`: `tabId`와 `sessionName`이 있으면 위임 설정과 관계없이 `hookEnvPrefix`를 붙인다.
  - Bridge: event는 `argv[2]`다. session과 capability는 `argv[3]`·`argv[4]`가 비어 있지 않으면 그 값을, 아니면 `process.env.AMUX_HOOK_SESSION`·`AMUX_HOOK_CAPABILITY`를 쓴다.
- [ ] **Step 1: Write the failing tests**
  - `codex-session-hooks.test.ts`:
    - "stable": `buildCodexSessionHookConfigs()`를 두 번 부른 결과가 같고, 어느 문자열에도 `pt-`·`tab-`·capability 모양(`.`으로 나뉜 base64url 두 덩어리)이 없다.
    - "two tabs": `buildCodexHookEnvPrefix({ tabId: 'tab-a', sessionName: 'pt-a' })`와 `({ tabId: 'tab-b', sessionName: 'pt-b' })`는 서로 다르다. 각 capability를 `verifyAgentHookCapability`로 검증하면 자기 탭 id와 session이 나온다.
    - "count": `CODEX_SESSION_HOOK_COUNT === 3`이다. config 문자열의 event 목록이 `CODEX_SESSION_HOOKS` 순서와 같다.
  - `status-hook-bridge.test.ts`: 임시 data dir에 bridge를 쓰고(`getStatusHookBridgeSource`), local fake HTTP server를 port file에 둔다.
    - "argument form": `node bridge stop pt-x cap-x` → server가 받은 body의 `session`, `capability`가 `pt-x`, `cap-x`다.
    - "env form": 인자 없이 환경 변수만 → 같은 값이 전달된다.
    - "argument wins": 둘 다 있으면 인자가 쓰인다.
  - `codex-provider-launch.test.ts`:
    - 위임 끔: 명령이 `AMUX_HOOK_SESSION=`로 시작한다. `AMUX_TAB_ID=`·`developer_instructions`는 없다.
    - 위임 켬: `AMUX_HOOK_SESSION=… AMUX_HOOK_CAPABILITY=… AMUX_WORKSPACE_ID=…` 순서다.
    - 이전 "단계 3과 byte 동일" case는 이 정의로 바꾼다.
  - `codex-command.test.ts`: `hookEnvPrefix`가 resume·launch 명령 맨 앞에 붙는다.
- [ ] **Step 2: Run** 위 test → FAIL
- [ ] **Step 3: Implement**. ADR 문구를 고친다: "위임을 끄면 위임 관련 값(위임 환경 변수, 안내, 미리 허용)이 붙지 않는다. Codex hook 환경 변수는 상태 표시용으로 늘 붙는다."
- [ ] **Step 4: Run** 위 test, `tests/unit/lib/providers/`, `tests/unit/lib/agent-launch-service.test.ts`, tsc → PASS
- [ ] **Step 5: Commit** — `feat(codex): keep Codex hook commands stable so a hook trust lasts`

---

### Task 3: Codex 화면 판정 module (agy)

**Files:**
- Create: `src/lib/codex-screen.ts`
- Modify: `src/lib/agent-startup-screen.ts` (Codex update·hook 검토 판정을 이 module로 옮긴다. 중복 정규식 금지)
- Test:
  - `tests/unit/lib/codex-screen.test.ts` (create)
  - `tests/unit/lib/agent-startup-screen.test.ts`
  - `tests/unit/pages/cli-tabs-send-api.test.ts` (기존 그대로 통과)

**Interfaces:**
- Consumes: Task 1 fixture(`tests/fixtures/codex-screens/*`)
- Produces (`src/lib/codex-screen.ts`, client-safe, import 없음):
  ```ts
  export type TCodexUpdateStatus = 'prompt' | 'updating' | 'success'
  export interface ICodexUpdatePromptInfo { status: TCodexUpdateStatus; currentVersion: string | null; latestVersion: string | null; updateCommand: string | null }
  export const matchCodexUpdatePrompt = (text: string): ICodexUpdatePromptInfo | null
  export interface ICodexHooksReviewInfo { changedCount: number | null; options: string[]; selectedIndex: number }
  export const matchCodexHooksReview = (text: string): ICodexHooksReviewInfo | null
  export type TCodexHooksAnswer = 'trust' | 'skip'
  export const codexHooksReviewKeys = (info: ICodexHooksReviewInfo, answer: TCodexHooksAnswer): string | null
  export type TCodexUpdateAnswer = 'update' | 'skip' | 'skip-version'
  export const codexUpdateAnswerKeys = (answer: TCodexUpdateAnswer): string
  export const isCodexTuiReadyContent = (text: string): boolean
  export const isCodexBlockingScreen = (text: string): boolean  // update prompt·updating, 검토 화면, Codex folder trust
  ```
  - `matchCodexUpdatePrompt`: spec "purplemux 방식"과 같은 규칙이다. 공백을 접고 `Update available! <cur> -> <latest>`, `Update now (runs \`<cmd>\`)`, "Release notes:", "Skip until next version"을 찾는다. 상태는 "Updating Codex via `"면 `updating`, "Update ran successfully! Please restart Codex."면 `success`다.
  - `matchCodexHooksReview`: "Hooks need review"와 "Trust all and continue"가 함께 있을 때만 값을 돌려준다(공백·줄바꿈에 관대하게). `changedCount`는 "N hooks are new or changed"·"1 hook is new or changed"에서 읽고, 없으면 null이다. `options`와 `selectedIndex`(`›` 표시 줄)는 화면에서 읽는다.
  - `codexHooksReviewKeys`: Task 1에서 확인한 key 방식대로다. 대상 선택지를 찾지 못하면 null이다(카드는 버튼을 막는다).
  - `codexUpdateAnswerKeys`: update `'1'`, skip `'2'`, skip-version `'3'`. Task 1에서 다른 방식이 확인되면 그 방식을 따른다.
  - `isCodexTuiReadyContent`: spec의 purplemux 규칙(update prompt 아님, "Input disabled." 없음, 마지막 8줄 안의 입력창 줄 정규식)을 따르고, `matchCodexHooksReview`가 아닐 것을 더한다.
  - `agent-startup-screen.ts`의 `matchAgentStartupScreen`: `'codex-update'`는 `matchCodexUpdatePrompt`의 `prompt`·`updating`일 때, `'codex-hooks-review'`는 `matchCodexHooksReview`일 때다. 반환 type은 그대로다.
- [ ] **Step 1: Write the failing tests** (`codex-screen.test.ts`)
  - Fixture 개수 3 → `changedCount: 3`, 선택지 3개, `selectedIndex` 0. 개수 1 fixture → `1`.
  - "Hooks need review"만 있는 일반 문장 → null.
  - "wrapped": 40칸에서 줄이 바뀐 합성 화면도 같은 결과다.
  - Update 합성 화면 3상태 → 각 status, version, 명령. 일반 화면 → null.
  - TUI 준비:
    - 입력창 `› ` 줄 → true.
    - `› 1. Update now` 번호 선택지 → false.
    - "Input disabled." → false.
    - 검토 화면 → false.
    - 빈 화면 → false.
  - `codexHooksReviewKeys`: trust·skip 결과가 Task 1의 key와 같다. 선택지가 없는 info → null.
  - `isCodexBlockingScreen`: update `prompt`·`updating` → true, 검토 → true, 입력창 → false.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `agent-startup-screen.test.ts`, `tests/unit/pages/cli-tabs-send-api.test.ts`, tsc → PASS
- [ ] **Step 5: Commit** — `feat(codex): read the Codex update, hook review, and ready screens in one module`

---

### Task 4: Hook 검토 카드와 update 카드 (agy)

**Files:**
- Create:
  - `src/hooks/use-codex-screen-detector.ts`
  - `src/components/features/workspace/codex-hooks-review-card.tsx`
  - `src/components/features/workspace/codex-update-card.tsx`
- Modify:
  - `src/components/features/workspace/pane-container.tsx` (trust 카드 옆, 434-441행 근처)
  - `src/components/features/mobile/mobile-surface-view.tsx` (277-278행 근처)
  - `messages/ko/terminal.json`, `messages/en/terminal.json` (기존 trust 카드와 같은 `terminal` namespace)
- Test:
  - `tests/unit/hooks/use-codex-screen-detector.test.ts` (create)
  - `tests/unit/components/codex-hooks-review-card.test.ts` (create, `renderToStaticMarkup`)
  - `tests/unit/components/codex-update-card.test.ts` (create)
  - `tests/unit/messages/codex-assist-copy.test.ts` (create, ko·en key 일치)

**Interfaces:**
- Consumes: Task 3 판정 함수, Task 2 `CODEX_SESSION_HOOK_COUNT`
- Produces:
  - `useCodexScreenDetector({ enabled, scopeKey, getBufferText, sendStdin, now? }): { hooksReview: ICodexHooksReviewInfo | null; updatePrompt: ICodexUpdatePromptInfo | null; tuiReady: boolean; onTerminalData: () => void; respondHooks: (a: TCodexHooksAnswer) => void; respondUpdate: (a: TCodexUpdateAnswer) => void }`
    - `use-trust-prompt-detector.ts`처럼 200ms debounce를 쓰고, scope가 바뀌면 상태를 비운다.
    - 응답한 뒤 1초 동안은 같은 화면을 다시 띄우지 않는다(`TRUST_RESPONSE_SUPPRESS_MS`처럼).
    - `tuiReady`는 Task 5가 채운다. 이 task에서는 `isCodexTuiReadyContent` 결과를 latch만 한다.
  - `enabled`는 Codex 탭이면 true다. folder trust 카드의 `cliState`·`sessionView` 조건은 쓰지 않는다. 검토와 update 화면 동안 Codex 탭은 `busy`·`timeline`이기 때문이다.
  - `CodexHooksReviewCard({ info, onRespond })`:
    - 문구: 제목 "Codex hook 검토", "N개 hook이 새로 생겼거나 바뀌었습니다".
    - 버튼 "trust하지 않고 계속"은 늘 있다.
    - `info.changedCount === CODEX_SESSION_HOOK_COUNT`이고 `codexHooksReviewKeys(info, 'trust') !== null`일 때만 다음을 보인다.
      - 버튼 "모두 trust하고 계속"
      - 설명 "agentmux 상태 표시용 hook입니다. trust하면 Codex가 사용자 설정에 기록합니다."
    - 그렇지 않으면 trust 버튼 대신 다음 안내를 보인다: "agentmux 밖의 hook이 포함돼 있을 수 있습니다. terminal 화면의 Review hooks에서 목록을 확인하세요".
    - en 문구는 같은 뜻으로 쓴다.
  - `CodexUpdateCard({ info, onRespond, onRestart })`:
    - `prompt`: "Codex 업데이트: <cur> → <latest>", 실행될 명령(화면 문구 그대로, code 글꼴), 버튼 Update now / Skip / Skip until next version.
    - `updating`: "업데이트 중…"과 진행 표시만 둔다(버튼 없음).
    - `success`: "업데이트됐습니다. Codex를 다시 시작하세요"와 버튼 "다시 시작"을 둔다. 버튼은 Rulings대로 `/api/agent/launch`를 부른다.
  - 카드 배치: 기존 `TrustPromptCard`와 같은 자리(`pane-container.tsx:994` 근처)와 모바일 surface에 둔다. 한 번에 하나만 보이고, 우선순위는 folder trust > hook 검토 > update다.
- [ ] **Step 1: Write the failing tests**
  - Detector(가짜 `getBufferText`, 가짜 timer):
    - 검토 fixture → `hooksReview.changedCount === 3`.
    - `respondHooks('trust')` → `sendStdin`이 Task 3 key로 한 번 불린다. 1초 안에 같은 화면이 다시 감지돼도 카드가 다시 뜨지 않는다.
    - scope가 바뀌면 null이 된다.
    - update fixture → `updatePrompt.status === 'prompt'`.
  - 검토 카드:
    - 개수 3 → 두 버튼이 있다.
    - 개수 1 → trust 버튼이 없고 안내 문구가 있다.
    - `changedCount: null` → trust 버튼이 없다.
  - Update 카드:
    - 3상태 각각의 문구와 버튼 수.
    - `success`의 "다시 시작"이 `onRestart`를 부른다.
  - Copy test: 새 key가 ko·en 양쪽에 있다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `tests/unit/components/`, `tests/unit/messages/`, lint, tsc → PASS
- [ ] **Step 5: Commit** — `feat(ui): answer the Codex hook review and update screens from the web`

---

### Task 5: TUI 준비 전 웹 입력 잠금과 시작 진행 표시 (agy)

**Files:**
- Modify:
  - `src/hooks/use-codex-screen-detector.ts` (시간 제한과 차단 화면 규칙)
  - `src/hooks/use-web-input.ts` (`IUseWebInputOptions.sendBlocked`)
  - `src/components/features/workspace/web-input-bar.tsx`
  - `src/lib/agent-boot-display.ts` (`resolveAgentBootDisplay` 입력 `agentInputReady`)
  - `src/components/features/workspace/agent-panel.tsx:185-205`
  - `src/components/features/mobile/mobile-agent-panel.tsx:208` 근처
  - `src/components/features/workspace/pane-container.tsx`와 `mobile-surface-view.tsx` (detector 결과를 panel로 넘김)
  - `messages/ko`, `messages/en` (입력 잠금 문구)
- Test:
  - `tests/unit/hooks/use-codex-screen-detector.test.ts`
  - `tests/unit/hooks/use-web-input.test.ts` (기존 파일 갱신)
  - `tests/unit/lib/agent-boot-display.test.ts`

**Interfaces:**
- Consumes: Task 3 `isCodexTuiReadyContent`, `isCodexBlockingScreen`, Task 4 detector
- Produces:
  - `CODEX_TUI_READY_TIMEOUT_MS = 30_000` (`use-codex-screen-detector.ts` export)
  - `tuiReady` 규칙(scope마다 latch):
    - 화면이 `isCodexTuiReadyContent`면 true다.
    - scope가 시작된 지 `CODEX_TUI_READY_TIMEOUT_MS`가 지났고 화면이 `isCodexBlockingScreen`이 아니면 true다.
    - 그 밖에는 false다.
    - Codex 탭이 아니면 늘 true다.
  - `IUseWebInputOptions.sendBlocked?: boolean`
    - true면 `send()`가 아무것도 보내지 않는다. 입력값과 draft는 그대로 두고, toast "{agent}가 아직 준비 중입니다. 잠시 뒤 보내세요"를 띄운다.
    - interrupt는 막지 않는다.
  - `resolveAgentBootDisplay`에 `agentInputReady?: boolean`(기본 true)을 더한다.
    - `false`면 `view === 'timeline' && hasReportedState(cliState)` 분기에서 `null` 대신 `'waiting-session'`을 돌려준다(시작 진행 표시 유지).
    - 다른 분기 순서는 그대로다(trust > bypass > recover…).
  - Agent panel은 Codex 탭에 `agentInputReady = tuiReady`, web input에 `sendBlocked = !tuiReady`를 넘긴다.
- [ ] **Step 1: Write the failing tests**
  - Detector:
    - 시작 화면(빈 화면) → `tuiReady false`.
    - 입력창 화면 → true. 그 뒤 검토 화면이 와도 true로 유지된다(latch).
    - 30초가 지나고 일반 화면 → true.
    - "30초 + update prompt 화면" → false 유지. 검토 화면도 false 유지(Review Focus 4).
    - Claude 탭(`enabled: false`) → true.
  - `use-web-input`: `sendBlocked: true`에서 `send()`가 `sendStdin`을 부르지 않는다. 입력값이 그대로이고 toast가 불린다(Review Focus 5).
  - `agent-boot-display`: `agentInputReady: false` + `cliState: 'busy'` + timeline → `'waiting-session'`. `true` → `null`(기존 동작).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `tests/unit/components/`, `tests/unit/hooks/`, lint, tsc → PASS
- [ ] **Step 5: Commit** — `feat(ui): hold web input until the Codex TUI is ready`

---

### Task 6: 문서, gate, 격리 live 확인, 배포 (문서는 agy, 확인은 controller)

**Files:**
- Modify:
  - `docs/ADR.md` (ADR-038 추가: "Codex hook trust는 사용자가 한 번 주고, agentmux는 hook 명령을 고정해 그 trust가 유지되게 한다. agentmux는 trust를 쓰거나 검토를 건너뛰지 않는다")
  - `docs/CLI.md` (Codex 위임은 hook trust 뒤 동작. 처음 한 번 검토 카드)
  - `docs/DATA-DIR.md` (bridge가 환경 변수도 읽음)
  - `docs/FOLLOW-UP.md` ("Codex 위임 대상이 hook 검토 화면에서 멈춤" 행 제거, Claude 첫 화면 prompt 유실 행 추가)
  - `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md` (설계 2-1 절)

- [ ] **Step 1: 문서 (agy)** — 위 내용. node 경로·data dir가 바뀌면 검토가 한 번 더 뜬다는 것, 개발용 격리 server는 격리 `CODEX_HOME`을 쓴다는 것을 CLI.md에 적는다.
- [ ] **Step 2: 전체 gate (controller)**
  - `check:project-design`, `check:product-name`
  - lint(error 0)
  - `tsc --noEmit`, `tsc --noEmit -p tsconfig.deploy-check.json`
  - 임시 HOME으로 전체 test
  - `pnpm build`
- [ ] **Step 3: 격리 live 확인 (controller)**
  - 환경:
    - 설계 1 단계 4와 같은 격리 server: 이 worktree build, `env -i` 허용 목록, 임시 `AGENTMUX_DATA_DIR`, 짧은 `TMUX_TMPDIR`, port 18122
    - 허용 목록에 `CODEX_HOME=$HOME/.cache/agentmux-codex-check`를 더한다
    - 브라우저는 playwright headless로 연다
  - Prompt 한도: Codex 2개, Claude 1개.
  1. Codex 탭 첫 실행에서 검토 카드가 보이고 trust 버튼이 있다(개수 3). 카드의 "모두 trust하고 계속"을 누른다. Codex 입력창이 준비되고 시작 진행 표시와 입력 잠금이 풀린다.
  2. 탭을 닫고 새 Codex 탭을 연다. 검토 카드가 뜨지 않는다.
  3. 시작 직후 web 입력으로 보내면 toast로 막히고, 준비 뒤 보내면 Codex가 받는다(Codex prompt 1).
  4. Claude 탭의 agent가 `agentmux tab create -t codex`로 `ready: true`를 받고, `tab send 'Reply with the single word OK'` 결과가 `tab result`에 "OK"로 온다(Claude prompt 1, Codex prompt 1).
  5. Update 안내는 실제로 띄울 수 없으면 합성 화면 unit test로 대신하고 그 사실을 기록한다.
  6. 안전 확인: 전후 사용자 `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.claude/settings.json` sha256, live tmux session 목록, `agentmux.service` MainPID가 같다. 격리 자원을 정리한다.
- [ ] **Step 4: 기록과 commit (controller)** — 결과를 handoff 설계 2-1 절에 적는다. 메시지: `docs: record the Codex assist checks`.
- [ ] **Step 5: 배포 (사용자 실행)**
  - PR → CI → merge 뒤 사용자가 `git push agentmux main`과 `corepack pnpm deploy:local`을 실행한다. 새 `deploy:local`이 install, type check, snapshot을 자동으로 한다.
  - 배포 뒤 확인:
    - health
    - live에서 처음 띄운 Codex 탭에 검토 카드가 한 번 뜬다. 사용자가 trust하면 그 뒤로는 뜨지 않는다.
    - 기존 Codex 탭의 상태 보고가 이어진다.
  - 결과를 handoff에 남긴다.
  - 격리 `CODEX_HOME`(`$HOME/.cache/agentmux-codex-check`) 삭제를 사용자에게 안내한다.
