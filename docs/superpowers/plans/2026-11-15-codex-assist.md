# Codex 보조 (설계 2-1) Implementation Plan

> **For agentic workers:** Task 1과 Task 6의 확인은 controller(Claude)가 직접 한다. Task 2~5와 Task 6의 문서는 Herdr pane의 agy가 task 단위로 구현한다. Claude는 task마다 diff·test로 검증하고 독립 검토를 돌린다(사용자 결정 2026-11-10: "agy 구현, Claude 감시·검증"). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agentmux가 띄운 Codex가 사람 없이도 시작 화면에서 막히지 않게 한다.
- "Hooks need review" 화면은 처음 한 번만 뜬다.
- 그 화면과 update 안내 화면에 웹 카드로 답할 수 있다.
- TUI가 준비되기 전과 차단 화면이 떠 있는 동안에는 웹 입력이 prompt를 보내지 않는다.

**Architecture:** Codex hook 명령에서 탭·실행마다 바뀌는 값(session 이름, capability)을 빼고 실행 명령 앞의 환경 변수로 넘긴다. 그러면 명령이 고정돼 Codex의 hook trust가 유지된다. Codex 화면 판정(update 안내, hook 검토, TUI 준비)은 서버와 client가 함께 쓰는 순수 module에 둔다. 카드와 입력 잠금의 상태 기계는 순수 tracker에 두고, React hook은 그것을 감싸기만 한다. 이렇게 해야 이 repo의 vitest(`node` 환경, `renderToStaticMarkup`)로 test할 수 있다.

**Tech Stack:** TypeScript, Next.js Pages Router custom server, React(zustand), next-intl(ko/en), shadcn/ui, vitest, Codex CLI `0.167.0`.

**Spec:** `docs/superpowers/specs/2026-11-15-codex-assist-design.md` (Approved 2026-11-15, plan-eng-review 뒤 Codex 0.167 문구와 보강 반영)

**Plan review:** `docs/superpowers/reviews/2026-11-15-codex-assist-eng-review.md` (approve with changes → 19건 반영)

**Base:** main `768a4ea4`. spec·plan은 문서 branch `docs/codex-assist-design`에 둔다. 구현 branch는 `feat/codex-assist`이고, worktree는 `/data/projects/agentcode-zone/agentmux/.worktrees/codex-assist`다. 구현 branch는 Task 2를 시작할 때 main에서 만들고, 문서 branch를 merge해 spec·plan을 포함시킨다.

## Global Constraints

- **사용자 설정 읽기 전용:**
  - 사용자 `~/.codex/`(또는 `CODEX_HOME`), `~/.claude/`, `~/.claude.json`에는 쓰지 않는다.
  - Hook trust는 사용자가 고르고 Codex가 기록한다(ADR-035, spec Anti-goal).
  - agentmux 자기 data dir(`<dataDir>/codex-hook-trust.json`)에 쓰는 것은 괜찮다.
- **Hook 검토를 건너뛰지 않는다:**
  - agentmux는 `--dangerously-bypass-hook-trust`를 쓰지 않는다.
  - `-c hooks.state…trusted_hash=`는 Task 1에서 trust가 유지되지 않는다고 확인됐을 때만, agentmux 자기 session-flag hook에만 쓴다. 이 경우 계획을 고친다.
- **사용자가 고른 key만 보낸다:**
  - 카드와 위임 CLI는 사용자가 고르지 않은 key를 검토 화면·update 안내에 보내지 않는다.
  - 위임 CLI는 지금처럼 `target-not-ready`로 거절한다.
- **"Update now" 금지(확인 작업):**
  - Task 1과 Task 6의 확인 작업에서는 update 안내에 "Skip"(`2`)만 고른다.
  - "Update now"는 격리 밖에서 전역 `npm install -g`를 실행해 live Codex binary를 바꾸기 때문이다.
- **Claude 쪽은 바꾸지 않는다:**
  - Claude 탭 hook(인자 방식, `--settings` 탭 파일)은 그대로다.
  - bridge는 인자 방식을 계속 받는다.
- **Hook 환경 변수는 위임 설정과 관계없이 늘 붙는다:**
  - 설계 1의 "위임 끔 = 실행 명령 byte 동일" 보장은 Codex에 대해 "위임 관련 값(위임 환경 변수, 안내, 미리 허용)이 붙지 않는다"로 바뀐다.
  - 이 보장은 ADR-035, `docs/CLI.md:41`, `docs/DATA-DIR.md:232`와 해당 test에 있다. 함께 고친다.
- **화면 규칙:**
  - icon + text label, 44px 이상 touch target
  - DOM-safe(`innerHTML`, `dangerouslySetInnerHTML` 금지)
  - 새 문구는 `messages/ko`와 `messages/en`에 함께, 한국어는 `word-break: keep-all`
  - 모바일 360px에서도 카드가 보인다
- **`AGENTS.md` 규칙:**
  - Pages Router, `"use client"` 금지, import는 `@/`
  - 소문자-dash 파일명, arrow function, `I`/`T` 접두사
  - `pgrep`/`ps`/`lsof` 직접 호출 금지
- **Test 환경:**
  - vitest는 `tests/**/*.test.ts`, environment `node`다. testing-library와 jsdom은 없다.
  - Component test는 `renderToStaticMarkup`으로 버튼 유무와 문구만 본다.
  - 상태와 입력 판단은 순수 함수·tracker에서 test한다.
- **Fixture는 합성 데이터만 쓴다:**
  - 공개 repo이므로 실제 경로, hash, 계정, 대화를 넣지 않는다.
  - Codex 화면 fixture는 Codex source snapshot과 Task 1 화면을 바탕으로 만든다.
- **명령과 commit:**
  - 명령은 `corepack pnpm ...`다.
  - test는 임시 `HOME`과 짧은 임시 `TMUX_TMPDIR`로 돌린다(`HOME=$(mktemp -d /tmp/ca-h.XXXX) TMUX_TMPDIR=$(mktemp -d /tmp/ca-t.XXXX)`).
  - Commit은 Conventional Commits이고, 본문 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 쓴다.
  - `--no-verify`, `git stash`, push는 금지다.
- **작업 위치:**
  - 구현 worktree에서만 작업한다.
  - live checkout `/data/projects/agentcode-zone/agentmux`, port 8122, `~/.codexmux`, 기본 tmux socket directory는 건드리지 않는다.
  - `deploy:local`과 `systemctl`은 실행하지 않는다.

## Review Focus

1. **두 Codex 탭이 동시에 떠 있을 때:** 각 탭의 hook은 자기 탭 상태만 바꾼다. 환경 변수가 process마다 따로라서다. → Task 2 `providers/codex-session-hooks.test.ts` "two tabs"
2. **배포 전에 띄운 Codex 탭(옛 인자 방식 명령):** 배포 뒤에도 상태를 보고한다. → Task 2 `status-hook-bridge.test.ts` "argument form"
3. **agentmux hook을 이미 trust한 뒤 개수 3짜리 검토 화면이 뜰 때(다른 출처):** trust 버튼이 없다. → Task 4 tracker·card test
4. **30초가 지나도 update 안내나 검토 화면이 떠 있을 때:** 첨부가 있어도 웹 입력이 열리지 않는다. → Task 5 `codex-screen-tracker.test.ts`, `web-input-dispatch.test.ts`
5. **이미 실행 중인 Codex 탭을 새로고침할 때:** 입력이 잠기지 않고 timeline이 가려지지 않는다. → Task 5
6. **좁은 terminal에서 줄이 바뀔 때:** 검토 화면과 update 안내를 알아본다. → Task 3 "wrapped"

## Rulings (계획 작성과 plan-eng-review에서 결정)

- **Task 1은 controller가 한다:** 사람 앞에서 Codex 화면을 다루고, 사용자의 로그인 단계가 있어서다.
- **격리 `CODEX_HOME`:** `$HOME/.cache/agentmux-codex-check`. Task 1과 Task 6이 함께 쓰고, 끝나면 사용자가 지운다.
- **hook 목록의 출처:** client가 import할 수 있는 `src/lib/codex-session-hook-spec.ts`. `session-hooks.ts`는 `agent-hooks.ts`(server 전용)를 import하므로 client가 쓸 수 없다.
- **Key 기대값(Codex 0.167 source 기준, Task 1에서 확인만 한다):**
  - hook 검토: trust `'2\r'`(`2`는 강조만 옮김), 그대로 계속 `'3'`(바로 확정)
  - update: `'1'`/`'2'`/`'3'`(바로 확정)
- **trust fingerprint(I7, 사용자 규칙보다 보수적):**
  - server가 Codex 탭에서 온 hook 요청을 검증하면, 지금 Codex hook 설정의 fingerprint를 `<dataDir>/codex-hook-trust.json`에 기록한다. fingerprint는 `buildCodexSessionHookConfigs()` 결과를 이은 문자열의 sha256이다.
  - 카드는 기록이 지금 fingerprint와 같으면 trust 버튼을 숨긴다. agentmux hook은 이미 trust됐다는 뜻이기 때문이다.
  - 설명은 출처를 단정하지 않는다.
- **update 성공·실패 뒤 "다시 시작":** 기존 탭 재시작과 같은 `launch`다. `requestAgentLaunch`(`src/lib/agent-launch-client.ts:3`)와 `handleRestartAgentSession`(`pane-container.tsx:762-777`)을 쓴다. resume은 쓰지 않는다.
- **입력 잠금 규칙(I2, I3):**
  - 차단 화면(`isCodexBlockingScreen`)이 보이는 동안은 늘 잠근다.
  - 그 밖에는 "시작 중"인 scope에서만 준비 전까지 잠근다.
  - "시작 중"은 client가 그 탭에서 agent process가 true가 아닌 값에서 true로 바뀌는 것을 본 뒤부터다. 그 신호로 `launchKey`를 올린다.
  - 이미 실행 중이던 session(새로고침, 탭 전환)은 시작 중이 아니다.
  - 준비 latch는 차단 화면도 준비 화면도 아닌 경우에만 쓴다.
- **Task 1이 실패하면(trust 유지 안 됨 또는 env 미전달):**
  - Task 2의 trust 경로와 Task 4의 hook 검토 카드만 대체안으로 다시 쓴다.
  - Task 3, Task 4의 detector·update 카드, Task 5는 그대로 둔다.
  - env가 hook에 닿지 않으면 대체안도 성립하지 않으므로, 멈추고 사용자에게 보고한다.

---

### Task 1: 확인 실험 — session-flag hook trust 유지와 hook 환경 변수 전달 (controller)

**Files:**
- Create(commit하지 않음): scratchpad `codex-check/probe-hook.cjs`, `codex-check/result.md`
- Create(commit, 문서 branch): `tests/fixtures/codex-screens/hooks-review.txt`(개수 3), `hooks-review-one.txt`(개수 1), `hooks-trusting.txt`("Trusting hooks..."), `update-prompt.txt`(0.167 문구), `update-updating.txt`, `update-failed.txt`
  - 이번 실행에서 실제로 본 화면을 쓰되 경로·hash·계정은 지운다.
  - 실제로 보지 못한 화면은 Codex source snapshot(`startup_hooks_review` test snapshot)과 `update_prompt.rs`의 문구로 합성한다.
- Modify(문서 branch): 이 계획의 Rulings "Key 기대값"과 Task 3 Interfaces. 실험 결과가 기대값과 다르면 고친다.

**Interfaces:**
- Produces: 실험 결과(유지 여부, env 전달, key, 화면 문구)와 fixture

- [ ] **Step 1: 사용자 로그인**
  - 사용자에게 `CODEX_HOME=$HOME/.cache/agentmux-codex-check codex login`(필요하면 `--device-auth`)을 사용자 terminal에서 직접 실행해 달라고 요청한다.
  - 로그인 뒤 그 디렉터리에 `auth.json`이 있는지만 확인하고, 내용은 읽지 않는다.
- [ ] **Step 2: Probe hook 준비**
  - `probe-hook.cjs`는 `argv[2]`(event)와 `AMUX_HOOK_SESSION`, `AMUX_HOOK_CAPABILITY`를 한 줄 JSON으로 scratchpad log에 덧붙이고 exit 0한다.
- [ ] **Step 3: 첫 실행**
  - 실행 환경: 임시 `TMUX_TMPDIR`, 전용 socket(`-L cacheck`), 빈 임시 cwd.
  - 명령: `CODEX_HOME=… AMUX_HOOK_SESSION=s1 AMUX_HOOK_CAPABILITY=c1 codex -c '<SessionStart>' -c '<UserPromptSubmit>' -c '<Stop>'`.
  - 세 hook 설정은 Task 2가 만들 문자열과 같은 모양이다.
    - 명령 `ELECTRON_RUN_AS_NODE=1 '<node>' '<probe>' '<event>'`
    - `timeout=3`, `async=true`
    - SessionStart matcher `startup|resume`
  - 화면이 뜨면 다음 규칙대로 처리한다.
    - folder trust: 격리 home이므로 "Yes".
    - update 안내: 화면을 저장하고 `2`(Skip)만 누른다.
    - "Hooks need review": 화면 전체를 저장한다.
- [ ] **Step 4: Trust**
  - `2`를 누르고 Enter를 누른다. `2`만으로 확정되지 않는지 확인한다.
  - "Trusting hooks..." 화면을 저장한다.
  - Probe log에 `session-start`와 `s1`/`c1`이 찍히는지 본다(env 전달).
  - Codex를 종료한다(`/exit` 또는 Ctrl+C 두 번).
- [ ] **Step 5: 다시 실행**
  - 같은 `-c` 문자열에 다른 env(`s2`, `c2`)로 띄운다.
  - 판정은 두 가지로 나눈다.
    - 검토 화면이 뜨지 않는다.
    - update 안내가 뜨면 Skip만 누른다.
  - Probe log에 `s2`가 찍힌다.
  - `CODEX_HOME/config.toml`의 `[hooks.state."<session-flags>/config.toml:…"]` key 모양만 기록한다(hash 값은 기록하지 않는다).
- [ ] **Step 6: 명령이 바뀐 경우**
  - probe 경로만 다른 명령(복사본)으로 띄우면 검토 화면이 다시 뜨는지 확인한다.
  - 거기서 `3`(Continue without trusting)을 누르고, 바뀐 hook이 실행되지 않는 것을 확인한다.
- [ ] **Step 7: 정리와 판정**
  - tmux server, 임시 cwd, `TMUX_TMPDIR`를 지운다. 격리 `CODEX_HOME`은 남긴다.
  - `result.md`에 다음을 적는다.
    - 유지 여부
    - env 전달
    - key(기대값 `'2\r'`/`'3'`과 같은지)
    - update 안내 문구와 그 처리
  - 사용자 `~/.codex/config.toml`과 `~/.codex/hooks.json`의 sha256이 실험 전후로 같은지 확인한다.
  - 기대값과 다르면 Rulings "Key 기대값"과 Task 3 Interfaces를 고친다.
- [ ] **Step 8: Fixture commit(문서 branch)**
  - 메시지: `test(fixtures): add synthetic Codex hook review and update screens`
- [ ] **Gate:** 유지되지 않거나 env가 hook에 닿지 않으면 Rulings의 "Task 1이 실패하면"을 따른다.

---

### Task 2: Codex hook 명령 고정과 trust fingerprint (agy)

**Files:**
- Create: `src/lib/codex-session-hook-spec.ts`, `src/lib/codex-hook-trust.ts`
- Modify:
  - `src/lib/providers/codex/session-hooks.ts`(`buildHandler`, `buildCodexSessionHookConfigs`)
  - `src/lib/providers/codex/index.ts`(`readLaunchOptions`)
  - `src/lib/codex-command.ts`(`ICodexCommandOptions`, 명령 조립)
  - `src/lib/hook-settings.ts`(`getStatusHookBridgeSource`, 생성되는 bridge의 24-26행 인자 읽기)
  - Codex hook 요청을 받는 status hook 경로(`src/pages/api/status/hook.ts`와 그 service, 검증 성공 뒤 fingerprint 기록)
  - 새 GET route `src/pages/api/status/codex-hook-trust.ts`
  - `scripts/smoke-codex-session-hooks.ts`(새 signature)
  - `docs/ADR.md` ADR-035, `docs/CLI.md:41`, `docs/DATA-DIR.md:232`("위임 끔 = byte 동일" 문구)
- Test:
  - `tests/unit/lib/providers/codex-session-hooks.test.ts`(기존 파일 갱신)
  - `tests/unit/lib/status-hook-bridge.test.ts`(create)
  - `tests/unit/lib/codex-hook-trust.test.ts`(create)
  - `tests/unit/lib/codex-provider-launch.test.ts`
  - `tests/unit/lib/codex-command.test.ts`
  - status hook route test(기존 파일이 있으면 갱신)

**Interfaces:**
- Consumes: Task 1 결과(env 전달, trust 유지)
- Produces:
  - `src/lib/codex-session-hook-spec.ts`(client-safe, import 없음):
    ```ts
    export interface ICodexSessionHookSpec { event: 'SessionStart' | 'UserPromptSubmit' | 'Stop'; hookEvent: string; matcher?: string }
    export const CODEX_SESSION_HOOKS: readonly ICodexSessionHookSpec[]  // 지금 session-hooks.ts의 3개와 같은 값·순서
    export const CODEX_SESSION_HOOK_COUNT: number                       // CODEX_SESSION_HOOKS.length
    export const CODEX_HOOK_SESSION_ENV = 'AMUX_HOOK_SESSION'
    export const CODEX_HOOK_CAPABILITY_ENV = 'AMUX_HOOK_CAPABILITY'
    ```
  - `buildCodexSessionHookConfigs({ nodePath? }): string[]`
    - `tabId`와 `sessionName` 인자를 뺀다. server process 안에서 늘 같은 문자열이다.
    - handler 명령은 다음과 같다. Windows 쪽에도 인자를 넣지 않는다.
      - posix: `ELECTRON_RUN_AS_NODE=1 '<node>' '<bridge>' '<hookEvent>'`
      - windows: `set "ELECTRON_RUN_AS_NODE=1" && "<node>" "<bridge>" "<hookEvent>"`
  - `buildCodexHookEnvPrefix({ tabId, sessionName }): string`(`session-hooks.ts`)
    - 결과는 `AMUX_HOOK_SESSION=<q> AMUX_HOOK_CAPABILITY=<q> `다(끝에 공백, `shellQuote`).
    - capability는 지금처럼 `createAgentHookCapability(tabId, sessionName)`로 만든다.
  - `ICodexCommandOptions.hookEnvPrefix?: string`
    - 명령은 `<hookEnvPrefix><envPrefix>codex …` 순서로 조립한다. hook env가 위임 env 앞에 온다.
  - Codex `readLaunchOptions`: `tabId`와 `sessionName`이 있으면 위임 설정과 관계없이 `hookEnvPrefix`를 붙인다.
  - Bridge 입력 규칙:
    - event는 `argv[2]`다.
    - session과 capability는 `argv[3]`·`argv[4]`가 비어 있지 않으면 그 값을 쓴다.
    - 비어 있으면 `process.env.AMUX_HOOK_SESSION`·`AMUX_HOOK_CAPABILITY`를 쓴다.
  - `src/lib/codex-hook-trust.ts`:
    ```ts
    export const getCodexHookFingerprint = (): string                 // sha256(buildCodexSessionHookConfigs().join('\n'))
    export const recordCodexHookTrusted = (): Promise<void>            // <dataDir>/codex-hook-trust.json { fingerprint }, 같으면 쓰지 않음
    export const isCodexHookFingerprintTrusted = (): Promise<boolean>  // 기록 === 지금 fingerprint
    ```
  - Status hook route: 검증된 hook 요청의 대상 탭이 Codex 탭이면 `recordCodexHookTrusted()`를 부른다. 실패해도 응답에는 영향이 없다.
  - `GET /api/status/codex-hook-trust` → `{ trusted: boolean }`(인증은 다른 status route와 같다).
- [ ] **Step 1: Write the failing tests**
  - `providers/codex-session-hooks.test.ts`
    - "stable": `buildCodexSessionHookConfigs()`를 두 번 부르면 결과가 같다. 결과 문자열에는 다음이 없다.
      - `pt-` 또는 `tab-`로 시작하는 탭·session 값
      - `/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/`(capability 모양)
    - "two tabs": `buildCodexHookEnvPrefix`를 탭 a·b에 대해 부르면 결과가 서로 다르다. 각 capability를 `verifyAgentHookCapability`로 검증하면 자기 탭 id와 session이 나온다.
    - "count": `CODEX_SESSION_HOOK_COUNT === 3`이다. config의 event 순서가 `CODEX_SESSION_HOOKS`와 같다.
  - `status-hook-bridge.test.ts`: 임시 data dir에 bridge를 쓰고, local fake HTTP server를 port file에 둔다.
    - "argument form": `node bridge stop pt-x cap-x`면 body의 `session`과 `capability`가 `pt-x`와 `cap-x`다.
    - "env form": 인자 없이 env만 주면 같은 값이 간다.
    - "argument wins": 둘 다 있으면 인자 값이 쓰인다.
  - `codex-hook-trust.test.ts`(임시 data dir)
    - 기록 전에는 `false`다.
    - `recordCodexHookTrusted()` 뒤에는 `true`다.
    - node 경로가 달라져 fingerprint가 바뀌면 `false`다.
    - 같은 값이면 다시 쓰지 않는다(mtime 그대로).
  - `codex-provider-launch.test.ts`
    - 위임을 끄면 명령이 `AMUX_HOOK_SESSION=`으로 시작하고, `AMUX_TAB_ID=`와 `developer_instructions`가 없다.
    - 위임을 켜면 `AMUX_HOOK_SESSION=… AMUX_HOOK_CAPABILITY=… AMUX_WORKSPACE_ID=…` 순서다.
    - 기존 "byte 동일" case는 이 정의로 바꾼다.
  - `codex-command.test.ts`: `hookEnvPrefix`가 resume·launch 명령 맨 앞에 붙는다.
  - Status hook route: Codex 탭의 검증된 요청은 `recordCodexHookTrusted`를 부르고, Claude 탭 요청은 부르지 않는다.
- [ ] **Step 2: Run** 위 test → FAIL
- [ ] **Step 3: Implement**
  - ADR-035, `CLI.md:41`, `DATA-DIR.md:232` 문구를 다음 내용으로 고친다.
    - "위임을 끄면 위임 관련 값(위임 환경 변수, 안내, 미리 허용)이 붙지 않는다."
    - "Codex hook 환경 변수는 상태 표시용으로 늘 붙는다."
- [ ] **Step 4: Run** 다음을 돌려 모두 PASS인지 확인한다.
  - 위 test
  - `tests/unit/lib/providers/`, `tests/unit/lib/agent-launch-service.test.ts`, `tests/unit/pages/`
  - `tsc --noEmit`(`scripts/` 포함)
- [ ] **Step 5: Commit** — `feat(codex): keep Codex hook commands stable so a hook trust lasts`

---

### Task 3: Codex 화면 판정 module (agy)

**Files:**
- Create: `src/lib/codex-screen.ts`
- Modify: `src/lib/agent-startup-screen.ts`(Codex update·hook 검토 판정을 이 module로 옮김, 중복 정규식 금지). 이 수정으로 이미 배포된 위임 CLI가 0.167 update 안내를 놓치는 문제도 함께 고친다.
- Test: `tests/unit/lib/codex-screen.test.ts`(create), `tests/unit/lib/agent-startup-screen.test.ts`, `tests/unit/pages/cli-tabs-send-api.test.ts`(기존 그대로 통과)

**Interfaces:**
- Consumes: Task 1 fixture(`tests/fixtures/codex-screens/*`)
- Produces(`src/lib/codex-screen.ts`):
  - client-safe다. import는 `src/lib/trust-prompt-detector.ts`의 `matchTrustPrompt`만 쓴다(Codex folder trust 판정).
  ```ts
  export type TCodexUpdateStatus = 'prompt' | 'updating' | 'success' | 'failed'
  export interface ICodexUpdatePromptInfo { status: TCodexUpdateStatus; currentVersion: string | null; latestVersion: string | null; updateCommand: string | null }
  export const matchCodexUpdatePrompt = (text: string): ICodexUpdatePromptInfo | null
  export interface ICodexHooksReviewInfo { changedCount: number | null; options: string[]; selectedIndex: number; trusting: boolean }
  export const matchCodexHooksReview = (text: string): ICodexHooksReviewInfo | null
  export type TCodexHooksAnswer = 'trust' | 'skip'
  export const codexHooksReviewKeys = (info: ICodexHooksReviewInfo, answer: TCodexHooksAnswer): string | null
  export type TCodexUpdateAnswer = 'update' | 'skip' | 'skip-version'
  export const codexUpdateAnswerKeys = (answer: TCodexUpdateAnswer): string
  export const isCodexTuiReadyContent = (text: string): boolean
  export const isCodexBlockingScreen = (text: string): boolean
  ```
  - `matchCodexUpdatePrompt`: 공백을 접은 문구에서 판정한다. 두 형식을 다 알아본다.
    - 0.167 형식: `Update available · <cur> → <latest>`
    - 옛 형식: `Update available! <cur> -> <latest>`
    - 판정 순서:
      - `prompt`: `Update now (runs \`<cmd>\`)`와 "Skip until next version"이 있다.
      - `updating`: "Updating Codex via `"가 있다.
      - `success`: "Update ran successfully! Please restart Codex."가 있다.
      - `failed`: "failed with status"가 있다.
  - `matchCodexHooksReview`
    - "Hooks need review"와 "Trust all and continue"가 함께 있을 때만 값을 돌려준다. 공백과 줄바꿈에는 관대하다.
    - `changedCount`는 "N hooks are new or changed"나 "1 hook is new or changed"에서 읽는다. 없으면 null이다.
    - `options`와 `selectedIndex`는 `›` 표시 줄에서 읽는다.
    - `trusting`은 "Trusting hooks..."가 보이면 true다. 이때 카드는 버튼 없이 진행 표시만 보인다.
  - `codexHooksReviewKeys`
    - trust: "Trust all and continue" 번호 + `\r`(기본 `'2\r'`)
    - skip: "Continue without trusting" 번호(기본 `'3'`)
    - 선택지를 찾지 못하거나 `trusting`이면 null을 돌려준다.
  - `codexUpdateAnswerKeys`: update `'1'`, skip `'2'`, skip-version `'3'`
  - `isCodexTuiReadyContent`: purplemux 규칙을 그대로 따른다. 하나라도 걸리면 false다.
    - `matchCodexUpdatePrompt(text)?.status`가 `prompt`이거나 `updating`이다.
    - `matchCodexHooksReview(text)`가 값을 돌려준다.
    - `/^\s*›?\s*Input disabled\./m`이 맞는다.
    - 끝의 빈 줄을 잘라낸 뒤 마지막 8줄 안에 입력창 줄(`/^\s*›(?:\s*$|\s+(?!\d+\.)(?!\[[ x-]\])[^\n]*)$/m`)이 없다.
  - `isCodexBlockingScreen`: 다음 셋 중 하나면 true다.
    - update `prompt`·`updating`
    - hook 검토(trusting 포함)
    - Codex folder trust(`matchTrustPrompt(text)?.agent === 'codex'`)
  - `agent-startup-screen.ts`의 `matchAgentStartupScreen`(반환 type은 그대로):
    - `'codex-update'`: `matchCodexUpdatePrompt`가 `prompt`·`updating`이다.
    - `'codex-hooks-review'`: `matchCodexHooksReview`가 값을 돌려준다.
- [ ] **Step 1: Write the failing tests**(`codex-screen.test.ts`)
  - Hook 검토
    - 개수 3 fixture: `changedCount: 3`, 선택지 3개, `selectedIndex: 0`, `trusting: false`다. 개수 1 fixture: `1`이다. "Trusting hooks..." fixture: `trusting: true`다.
    - "Hooks need review"만 들어간 일반 문장은 null이다.
    - "wrapped": 40칸에서 줄이 바뀐 화면(Codex snapshot 모양)도 같은 결과다.
  - update 안내
    - 0.167 fixture: `prompt`와 version 두 개, 명령을 읽는다. 옛 형식 문구에서도 `prompt`다.
    - `updating`, `success`, `failed` fixture는 각 status를 돌려준다.
    - 일반 화면은 null이다.
  - TUI 준비 판정
    - true: 입력창 `› ` 줄.
    - false:
      - `› 1. Update now (runs …)` 번호 선택지
      - "Input disabled."
      - 검토 화면
      - 빈 화면
      - 입력창 뒤에 빈 줄만 10줄 있는 화면은 true다(끝 빈 줄 자르기 확인)
  - Key
    - `codexHooksReviewKeys`: trust → `'2\r'`, skip → `'3'`, `trusting` info → null
    - `codexUpdateAnswerKeys`: 세 값
  - `isCodexBlockingScreen`
    - true: update `prompt`·`updating`, 검토, Codex folder trust
    - false: 입력창, `success`, `failed`
  - `agent-startup-screen.test.ts`: 0.167 update fixture → `'codex-update'`
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `agent-startup-screen.test.ts`, `tests/unit/pages/cli-tabs-send-api.test.ts`, tsc → PASS
- [ ] **Step 5: Commit** — `feat(codex): read the Codex update, hook review, and ready screens in one module`

---

### Task 4: 화면 tracker, hook 검토 카드, update 카드 (agy)

**Files:**
- Create:
  - `src/lib/codex-screen-tracker.ts`(순수 상태 기계)
  - `src/hooks/use-codex-screen-detector.ts`(tracker wrapper)
  - `src/components/features/workspace/codex-hooks-review-card.tsx`
  - `src/components/features/workspace/codex-update-card.tsx`
- Modify:
  - `src/components/features/workspace/pane-container.tsx`(trust 카드 detector 근처 434-441행, 카드 배치 994행 근처, restart 762-777행)
  - `src/components/features/mobile/mobile-surface-view.tsx`(277-278행 근처)
  - `messages/ko/terminal.json`, `messages/en/terminal.json`(기존 trust 카드와 같은 `terminal` namespace)
- Test:
  - `tests/unit/lib/codex-screen-tracker.test.ts`(create)
  - `tests/unit/components/codex-hooks-review-card.test.ts`(create, `renderToStaticMarkup`)
  - `tests/unit/components/codex-update-card.test.ts`(create)
  - `tests/unit/messages/codex-assist-copy.test.ts`(create, ko·en key 일치)

**Interfaces:**
- Consumes:
  - Task 3 판정 함수
  - Task 2 `CODEX_SESSION_HOOK_COUNT`, `GET /api/status/codex-hook-trust`
  - `requestAgentLaunch`
- Produces:
  - `src/lib/codex-screen-tracker.ts`:
    ```ts
    export interface ICodexScreenSnapshot { hooksReview: ICodexHooksReviewInfo | null; updatePrompt: ICodexUpdatePromptInfo | null; blocking: boolean; tuiReady: boolean }
    export const CODEX_RESPONSE_SUPPRESS_MS = 1000
    export const createCodexScreenTracker = (opts: { now: () => number }) => ({
      startScope(scopeKey: string, starting: boolean): void,  // Task 5가 starting 의미를 채운다
      observe(scopeKey: string, text: string): ICodexScreenSnapshot,
      markResponded(scopeKey: string): void,                  // 응답 뒤 1초 동안 같은 카드를 다시 띄우지 않음
      tick(scopeKey: string, text: string): ICodexScreenSnapshot,  // timer 재평가(Task 5)
    })
    ```
    - 이 task에서 `tuiReady`는 `isCodexTuiReadyContent` 결과를 그대로 돌려준다. 시작 중, latch, 시간 제한 규칙은 Task 5가 넣는다.
  - `useCodexScreenDetector({ enabled, scopeKey, getBufferText, sendStdin })` → `{ snapshot, onTerminalData, respondHooks(a), respondUpdate(a) }`
    - `use-trust-prompt-detector.ts`처럼 200ms debounce로 `observe`를 부르고, scope가 바뀌면 비운다.
    - `enabled`는 Codex 탭이면 true다. folder trust 카드의 `cliState`·`sessionView` 조건은 쓰지 않는다. 검토·update 화면이 떠 있는 동안 Codex 탭은 `busy`·`timeline`이기 때문이다.
  - `CodexHooksReviewCard({ info, hookCount, fingerprintTrusted, onRespond })`
    - `info.trusting`이면 "hook을 trust하는 중…"만 보이고 버튼은 없다.
    - 늘 보이는 것: 제목 "Codex hook 검토", "N개 hook이 새로 생겼거나 바뀌었습니다", 버튼 "trust하지 않고 계속".
    - trust 버튼 "모두 trust하고 계속"과 설명은 다음 셋이 모두 참일 때만 보인다.
      - `info.changedCount === hookCount`
      - `!fingerprintTrusted`
      - `codexHooksReviewKeys(info, 'trust') !== null`
    - 설명 문구: "agentmux가 붙이는 hook 수와 같습니다. 목록은 terminal의 Review hooks에서 확인할 수 있습니다. trust하면 Codex가 사용자 설정에 기록합니다."
    - trust 버튼이 없을 때: "agentmux 밖의 hook이 포함돼 있을 수 있습니다. terminal 화면의 Review hooks에서 목록을 확인하세요."
    - en 문구는 같은 뜻으로 쓴다.
  - `CodexUpdateCard({ info, onRespond, onRestart })`
    - `prompt`: "Codex 업데이트: <cur> → <latest>"와 실행될 명령(화면 문구 그대로, code 글꼴)을 보인다. 버튼은 Update now / Skip / Skip until next version이다.
    - `updating`: 진행 표시만 보이고 버튼은 없다.
    - `success`: "업데이트됐습니다. Codex를 다시 시작하세요"와 "다시 시작" 버튼.
    - `failed`: "업데이트에 실패했습니다. terminal에서 오류를 확인하세요"와 "다시 시작" 버튼.
    - "다시 시작"은 `onRestart`를 부른다. pane-container가 `handleRestartAgentSession`(launch)과 연결한다.
  - 카드 배치
    - 기존 `TrustPromptCard`와 같은 자리, 그리고 모바일 surface다.
    - 한 번에 하나만 보인다. 우선순위는 folder trust > hook 검토 > update다.
    - `fingerprintTrusted`는 검토 카드를 처음 띄울 때 `GET /api/status/codex-hook-trust`로 한 번 읽는다. 실패하면 `true`로 보고 trust 버튼을 숨긴다. 안전한 쪽으로 실패하게 하려는 것이다.
- [ ] **Step 1: Write the failing tests**
  - `codex-screen-tracker.test.ts`(가짜 `now`)
    - 개수 3 fixture를 넣으면 `snapshot.hooksReview.changedCount === 3`, `blocking === true`다.
    - `markResponded` 뒤 1초 안에 같은 화면을 `observe`하면 `hooksReview === null`이다. 1초 뒤에는 다시 나온다.
    - update fixture를 넣으면 `updatePrompt.status === 'prompt'`다.
    - scope가 바뀌면 이전 상태가 남지 않는다.
  - 검토 카드
    - 개수 3이고 `fingerprintTrusted: false`면 버튼 두 개다.
    - 개수 3이고 `fingerprintTrusted: true`면 trust 버튼이 없고 안내 문구가 있다(Review Focus 3).
    - 개수 1이거나 `changedCount: null`이면 trust 버튼이 없다.
    - `trusting`이면 버튼이 없다.
  - Update 카드: 4상태 각각의 문구와 버튼 수를 본다.
  - Copy test: 새 key가 ko·en 양쪽에 있다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `tests/unit/components/`, `tests/unit/messages/`, lint, tsc → PASS
- [ ] **Step 5: Commit** — `feat(ui): answer the Codex hook review and update screens from the web`

---

### Task 5: 시작 중·차단 화면 동안 웹 입력 잠금과 시작 진행 표시 (agy)

**Files:**
- Create: `src/lib/web-input-dispatch.ts`(순수 판단 함수)
- Modify:
  - `src/lib/codex-screen-tracker.ts`(시작 중, latch, 시간 제한 규칙)
  - `src/hooks/use-codex-screen-detector.ts`(timer, `launchKey`)
  - `src/hooks/use-web-input.ts`(`IUseWebInputOptions.sendBlocked`)
  - `src/components/features/workspace/web-input-bar.tsx`(`dispatch`의 일반·첨부 두 분기)
  - `src/lib/agent-boot-display.ts`(`resolveAgentBootDisplay` 입력 `agentInputReady`)
  - `src/components/features/workspace/agent-panel.tsx:185-205`
  - `src/components/features/mobile/mobile-agent-panel.tsx:208` 근처
  - `src/components/features/workspace/pane-container.tsx`(desktop `WebInputBar`를 그리는 곳. detector 결과를 web input과 panel로 넘긴다)
  - `src/components/features/mobile/mobile-surface-view.tsx`
  - `messages/ko`, `messages/en`(잠금 문구)
- Test:
  - `tests/unit/lib/codex-screen-tracker.test.ts`
  - `tests/unit/lib/web-input-dispatch.test.ts`(create)
  - `tests/unit/hooks/use-web-input.test.ts`(기존 파일 갱신)
  - `tests/unit/lib/agent-boot-display.test.ts`

**Interfaces:**
- Consumes: Task 3 `isCodexTuiReadyContent`, `isCodexBlockingScreen`, Task 4 tracker·detector
- Produces:
  - `CODEX_TUI_READY_TIMEOUT_MS = 30_000`(`codex-screen-tracker.ts` export)
  - tracker 규칙. scope별로 `startScope(scopeKey, starting)`를 한 번 부른다.
    - `blocking`(=`isCodexBlockingScreen`)이면 `tuiReady`는 false다. latch와 시간에 관계없다.
    - `starting === false`면(이미 실행 중이던 session) 차단 화면이 아닌 한 `tuiReady`는 true다.
    - `starting === true`면 다음 셋 중 하나를 만족할 때 true다.
      - 지금 화면이 `isCodexTuiReadyContent`다. 이때 latch한다.
      - 이미 latch됐다(차단 화면이 아닐 때).
      - scope 시작 뒤 `CODEX_TUI_READY_TIMEOUT_MS`가 지났다.
  - Detector
    - `launchKey`: pane-container가 탭의 `agentProcess`가 true가 아닌 값에서 true로 바뀌는 것을 볼 때마다 올리는 client 카운터다.
    - scopeKey: `${tabId}:${sessionName}:${launchKey}`
    - `starting`: launchKey가 이 화면이 열린 뒤 올라갔으면 true다. 처음 연 화면이고 그때 `agentProcess`가 이미 true였으면 false다.
    - scope가 시작되면 `CODEX_TUI_READY_TIMEOUT_MS` timer를 건다. timer가 끝나면 buffer를 직접 읽어 `tick`을 부른다. 화면 데이터가 없어도 시간 제한이 적용되게 하려는 것이다.
  - `src/lib/web-input-dispatch.ts`
    - `decideWebInputDispatch({ mode, connected, sendBlocked, hasText, hasAttachments }): 'send' | 'blocked' | 'disconnected' | 'disabled' | 'empty'`
    - `useWebInput.send()`와 `web-input-bar.tsx` `dispatch()`의 일반·첨부 두 분기가 모두 이 결과를 따른다.
    - `blocked`면 아무것도 보내지 않는다. 입력값, 첨부, draft는 그대로 두고 toast "{agent}가 아직 준비 중입니다. 잠시 뒤 보내세요"를 띄운다.
    - interrupt는 막지 않는다.
  - `IUseWebInputOptions.sendBlocked?: boolean`. Codex 탭에서는 `!snapshot.tuiReady`, 다른 탭은 false다.
  - `resolveAgentBootDisplay`에 `agentInputReady?: boolean`(기본 true)을 더한다.
    - `agentInputReady === false`이고 `!hasEntries`일 때만 `view === 'timeline' && hasReportedState(cliState)` 분기에서 `null` 대신 `'waiting-session'`을 돌려준다.
    - entry가 있으면 지금처럼 `null`이다. timeline과 승인 카드를 가리지 않기 위해서다.
  - Agent panel은 Codex 탭에 `agentInputReady = snapshot.tuiReady`를 넘긴다.
- [ ] **Step 1: Write the failing tests**
  - Tracker(가짜 `now`)
    - `starting: true`, 빈 화면 → `tuiReady false`.
    - 입력창 화면 → true.
    - 그 뒤 검토 화면 → false. 차단 화면은 늘 잠근다(I3).
    - 다시 일반 화면 → true(latch).
    - `starting: true`, 데이터 없이 30초 뒤 `tick` → true(I4).
    - 30초 + update prompt 화면 → false. 30초 + 검토 화면 → false(Review Focus 4).
    - `starting: false`, 번호 선택지 화면(차단 화면 아님) → true(Review Focus 5).
  - `web-input-dispatch.test.ts`
    - `sendBlocked: true`면 텍스트만 있어도 `blocked`, 첨부만 있어도 `blocked`다(I1).
    - 연결이 끊겼으면 `disconnected`, `mode: 'disabled'`면 `disabled`다.
  - `use-web-input.test.ts`: `sendBlocked: true`면 `send()`가 `sendStdin`을 부르지 않고, 입력값이 그대로 남는다.
  - `agent-boot-display.test.ts`
    - `agentInputReady: false`, `cliState: 'busy'`, timeline, entry 없음 → `'waiting-session'`
    - 같은 조건에 entry가 있으면 → `null`
    - `agentInputReady: true` → `null`(기존 동작)
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `tests/unit/components/`, `tests/unit/hooks/`, `tests/unit/lib/`, lint, tsc → PASS
- [ ] **Step 5: Commit** — `feat(ui): hold web input while Codex is starting or shows a blocking screen`

---

### Task 6: 문서, gate, 격리 live 확인, 배포 (문서는 agy, 확인은 controller)

**Files:**
- Modify:
  - `docs/ADR.md`: ADR-038을 추가한다. 내용은 다음과 같다.
    - Codex hook trust는 사용자가 한 번 준다. agentmux는 hook 명령을 고정해 그 trust가 유지되게 한다.
    - agentmux는 Codex 설정에 trust를 쓰거나 검토를 건너뛰지 않는다.
    - 카드의 trust 버튼은 개수와 fingerprint로 제한한다. 개수는 같지만 일부가 다른 출처인 경우는 남은 위험으로 받아들인다.
  - `docs/CLI.md`
    - Codex 위임은 hook trust 뒤에 동작한다.
    - 처음 한 번 검토 카드가 뜬다.
    - node 경로나 data dir가 바뀌면 다시 한 번 뜬다.
    - 개발용 격리 server는 격리 `CODEX_HOME`을 쓴다.
  - `docs/DATA-DIR.md`: bridge가 환경 변수도 읽는다는 점, `codex-hook-trust.json`.
  - hook 명령의 인자 방식을 설명하는 다른 문서: `docs/STATUS.md`, `docs/TMUX.md`, `docs/ARCHITECTURE-LOGIC.md`, `docs/PROJECT-DESIGN.md`.
  - `docs/FOLLOW-UP.md`
    - "Codex 위임 대상이 hook 검토 화면에서 멈춤" 행을 지운다.
    - "Claude 첫 화면 prompt 유실" 행을 더한다.
    - 남은 위험 행(개수는 같지만 일부가 다른 출처)을 더한다.
  - `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`: 설계 2-1 절.

- [ ] **Step 1: 문서(agy)** — 위 내용.
- [ ] **Step 2: 전체 gate(controller)**
  - `check:project-design`, `check:product-name`
  - lint(error 0)
  - `tsc --noEmit`, `tsc --noEmit -p tsconfig.deploy-check.json`
  - 임시 HOME으로 전체 test
  - `pnpm build`
- [ ] **Step 3: 격리 live 확인(controller)**
  - 환경은 설계 1 단계 4와 같은 격리 server다.
    - 이 worktree build, `env -i` 허용 목록, 임시 `AGENTMUX_DATA_DIR`, 짧은 `TMUX_TMPDIR`, port 18122
    - 허용 목록에 `CODEX_HOME=$HOME/.cache/agentmux-codex-check`를 더한다.
    - 브라우저는 playwright headless다.
  - Prompt 한도는 Codex 2개, Claude 1개다. update 안내가 뜨면 Skip만 누른다.
  1. Codex 탭 첫 실행
     - Task 1의 trust 기록은 probe 명령에 대한 것이다. 그래서 검토 카드가 개수 3과 함께 보이고 trust 버튼이 있다.
     - 카드의 "모두 trust하고 계속"을 누른다.
     - 입력창이 준비되면 시작 진행 표시와 입력 잠금이 풀린다.
     - `<data dir>/codex-hook-trust.json`이 생긴다.
  2. 탭을 닫고 새 Codex 탭을 연다. 검토 카드가 뜨지 않는다.
  3. 시작 직후 web 입력으로 보내면 toast로 막힌다. 준비된 뒤 보내면 Codex가 받는다(Codex prompt 1).
  4. Claude 탭의 agent가 `agentmux tab create -t codex`로 `ready: true`를 받는다. `tab send 'Reply with the single word OK'`의 결과가 `tab result`에 "OK"로 온다(Claude prompt 1, Codex prompt 1).
  5. 이미 실행 중인 Codex 탭에서 page를 새로고침한다. 입력이 잠기지 않고 timeline이 보인다.
  6. update 안내를 실제로 띄울 수 없으면 합성 화면 unit test로 대신하고 그 사실을 기록한다.
  7. 안전 확인
     - 전후 sha256이 같다: 사용자 `~/.codex/config.toml`, `~/.codex/hooks.json`, `~/.claude/settings.json`.
     - live tmux session 목록과 `agentmux.service` MainPID가 같다.
     - 격리 자원을 정리한다.
- [ ] **Step 4: 기록과 commit(controller)** — 결과를 handoff 설계 2-1 절에 적는다. 메시지: `docs: record the Codex assist checks`.
- [ ] **Step 5: 배포(사용자 실행)**
  - PR → CI → merge 뒤 사용자가 `git push agentmux main`과 `corepack pnpm deploy:local`을 실행한다.
  - 배포 뒤 확인
    - health
    - live에서 처음 띄운 Codex 탭에 검토 카드가 한 번 뜨고, 사용자가 trust하면 그 뒤로 뜨지 않는다.
    - 배포 전에 떠 있던 Codex 탭(옛 인자 방식)의 상태 보고가 이어진다.
  - 결과를 handoff에 남긴다.
  - 격리 `CODEX_HOME` 삭제를 사용자에게 안내한다.
