# Claude Code Provider 단계 2: Claude provider core Implementation Plan

> **For agentic workers:** 구현은 Herdr pane의 agy(`builder`)가 task 단위로 맡고, Claude가 task마다 diff·test로 검증한다(사용자 결정 2026-11-10). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agentmux에서 Claude Code 탭을 새로 열고, hook으로 상태(작업 중·입력 대기·리뷰 대기)를 받고, 대화 기록을 timeline으로 보고, 권한 요청·folder trust에 웹에서 응답하고, Claude rate limit을 Codex와 따로 본다.

**Architecture:** 단계 1이 만든 provider 계약 위에 `src/lib/providers/claude/`를 등록한다. Claude는 `claude --settings <탭 설정 파일> --session-id <uuid>`로 실행되고, 탭 설정 파일이 hook과 statusLine을 붙인다(사용자 `~/.claude/` 파일은 읽기만 한다). Hook 중계 script가 Claude hook stdin에서 정해진 필드만 server로 보내고, server는 그 session id로 탭을 다시 묶는다. 대화 기록 해석은 기존 `session-parser.ts`, 상태 보조 판정은 `status/jsonl-check.ts`를 쓴다.

**Tech Stack:** TypeScript, Next.js Pages Router custom server, Runtime v2 workers(zod IPC), zustand, next-intl, vitest, tmux, Claude Code `2.1.322`.

**Spec:** `docs/superpowers/specs/2026-11-10-claude-code-provider-design.md` (2절 "Claude Code provider (A)", "Hook 계약 확인", "단계와 배포" 2번)

**Plan review:** `docs/superpowers/reviews/2026-11-10-claude-code-provider-phase2-eng-review.md`

**Base:** main `19a44ca8` (단계 1 merge). 작업 branch `feat/claude-provider-phase2`, worktree `/data/projects/agentcode-zone/agentmux/.worktrees/claude-provider-phase2`.

## 단계 2 범위

| 항목 | 단계 |
| --- | --- |
| 단계 1 이월: panelType 읽기 정규화(이후 build의 rollback 안전, Task 1 먼저 main merge·배포), IPC `statusBehavior` schema 함정 | 2 (Task 1) |
| Hook stdin 필드 전달, session 다시 묶기 | 2 (Task 2) |
| 실행 명령, project directory 계산, process·session 감지 | 2 (Task 3) |
| 탭 설정 파일(hook, statusLine), 사용자 statusLine 대신 실행 | 2 (Task 4) |
| Claude provider 등록, 실행 시 session id 지정, 탭 정리, Claude 설정 key | 2 (Task 5) |
| Provider별 rate limit | 2 (Task 6) |
| Provider별 preflight, 하나만 있어도 앱 열림, Claude 설치 명령 | 2 (Task 7) |
| 권한 요청 Claude 문구, folder trust 감지·응답 | 2 (Task 8) |
| 최소 화면: 새 탭 메뉴, 보기 전환, 단축키, 모바일, icon, 문구 | 2 (Task 9) |
| 문서, gate, 격리 live smoke | 2 (Task 10) |
| 통합 세션 목록, Session Explorer, 통계, 설정 화면, onboarding, 전환 잠금, 보기 제안, 시작 진행 표시 | 3 |
| 위임 안내, `permissions.allow`, CLI 변경, 탭 환경 변수 | 4 |

## Global Constraints

- 사용자 `~/.claude/settings.json`, `~/.claude/` 아래 파일, `~/.claude.json`, `~/.codex/config.toml`을 agentmux 코드가 쓰거나 지우지 않는다. 읽기만 허용한다(`~/.claude/sessions/*.json`, `~/.claude/projects/**.jsonl`, settings의 `statusLine`).
- agentmux 밖에서 돈 Claude Code 세션에는 hook·statusLine이 붙지 않는다. 붙이는 경로는 agentmux가 띄우는 명령의 `--settings` 하나뿐이다.
- 사용자가 원래 쓰던 hook은 그대로 돌고, 원래 statusLine 출력은 agentmux가 띄운 Claude에서도 보인다.
- Codex 탭의 상태 판정, timeline, resume, rate limit 표시는 바뀌지 않는다(rate limit은 Codex 줄과 Claude 줄로 나뉠 뿐이다).
- Agent 탭은 Runtime v1(legacy tmux adapter) 탭이다. 단계 1 규칙을 Claude에도 그대로 적용한다.
- Hook capability 형식(`v: 1`, HMAC-SHA256 base64url, CLI token 서명)은 바꾸지 않는다.
- 공개 repo다. Test fixture는 합성 데이터만 쓴다(실제 대화, token, 사용자 경로 금지).
- `AGENTS.md`: Pages Router, `"use client"` 금지, `@/` import, 소문자-dash 파일명, arrow function, `I`/`T` 접두사, `pgrep`/`ps`/`lsof` 직접 호출 금지(`@/lib/session-detection`·`process-inspector` 사용), 공유 singleton은 `globalThis` guard.
- DOM-safe frontend(`innerHTML`, `dangerouslySetInnerHTML`, `document.write` 금지). 새 문구는 `messages/ko`와 `messages/en`에 함께.
- 명령은 `corepack pnpm ...`. Commit은 Conventional Commits, 본문 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`(agy commit도 같은 trailer), `--no-verify` 금지.
- **작업 위치**: 모든 작업은 worktree `/data/projects/agentcode-zone/agentmux/.worktrees/claude-provider-phase2`에서 한다. Live service가 도는 `/data/projects/agentcode-zone/agentmux`에서는 build·test·편집을 하지 않는다. tmux를 쓰는 검증은 새 임시 `TMUX_TMPDIR`로만 한다.

## Review Focus

1. Claude가 `/clear` 뒤 새 session으로 바뀌면 sidebar 상태와 timeline이 새 session을 따라간다 → Task 2 `status-hook-session-binding.test.ts`.
2. 사용자 `~/.claude/settings.json`에 statusLine이 있으면 agentmux가 띄운 Claude에서도 그 출력이 보이고, 없으면 빈 출력이다. agentmux 자기 script를 가리키는 명령은 실행하지 않는다(무한 호출 방지) → Task 4 `claude-statusline-script.test.ts`.
3. Claude만 설치되고 Codex가 없는 호스트에서 앱이 열리고 Claude 탭을 시작할 수 있다 → Task 7 `preflight-agents.test.ts`, `agent-launch-service.test.ts`.
4. 단계 2 build에서 Claude 탭을 만든 뒤 이전 build로 되돌려도, 이후 build에서 모르는 panelType이 layout 전체를 깨지 않는다 → Task 1 `ipc.test.ts`, `layout-store-runtime-normalize.test.ts`.
5. 권한 요청 화면의 "No, and tell Claude what to do differently"가 Codex 문구로 바뀌지 않는다 → Task 8 `permission-prompt.test.ts`.

---

### Task 1: panelType 읽기 정규화와 IPC 함정 제거 (단계 1 이월)

**Files:**
- Modify: `src/lib/runtime/ipc.ts:163` (`panelTypeSchema`), `src/lib/runtime/ipc.ts:474-477` (`agentProviderStatusBehaviorSchema`)
- Modify: `src/lib/layout-store.ts:115-118` (runtime storage 읽기 분기), `src/lib/runtime/storage/repository.ts:656`
- Test: `tests/unit/lib/runtime/ipc.test.ts`, `tests/unit/lib/layout-store-runtime-normalize.test.ts` (create)

**Interfaces:**
- Produces: `panelTypeSchema`는 모르는 문자열을 `undefined`로 바꾼다(`z.enum(PANEL_TYPES).optional().catch(undefined)` 또는 같은 효과). `agentProviderStatusBehaviorSchema`는 `.strict()` 대신 모르는 key를 버린다(`.strip()`). Runtime storage에서 읽은 layout도 JSON 분기처럼 `normalizeStoredLayout`을 거쳐 모르는 panelType이 `undefined`가 된다.

- [ ] **Step 1: Write the failing tests**
  - `ipc.test.ts`: `storage.get-layout` reply에 `panelType: 'future-agent'`인 탭이 있어도 parse가 성공하고 그 탭의 `panelType`이 `undefined`다. `status.sync` payload도 같다. `status.evaluate-side-effects` payload의 `statusBehavior`에 4개 key(`reconcileStateFromJsonl`, `recoverPaneInput` 포함)가 있어도 parse가 성공하고 결과에는 2개 key만 남는다.
  - `layout-store-runtime-normalize.test.ts`: `readRuntimeStorageLayout`(mock)이 `panelType: 'future-agent'` 탭을 돌려주면 `getLayout` 결과의 그 탭 `panelType`이 `undefined`다.
- [ ] **Step 2: Run** `corepack pnpm vitest run tests/unit/lib/runtime/ipc.test.ts tests/unit/lib/layout-store-runtime-normalize.test.ts` → FAIL
- [ ] **Step 3: Implement** 위 Produces대로.
- [ ] **Step 4: Run** 같은 명령 + `tests/unit/lib/runtime/` 전체 + `corepack pnpm exec tsc --noEmit` → PASS
- [ ] **Step 5: Commit** — `fix(runtime): tolerate unknown panel types and extra status behavior keys`
- [ ] **Step 6: Task 1을 먼저 main에 넣는다** (Claude가 진행)
  - 단계 1 build(`19a44ca8`)는 모르는 panelType을 정규화하지 않는다. 그래서 Claude 탭이 생긴 뒤 단계 1 build로 되돌리면 status broadcast가 깨진다.
  - Task 5가 merge되기 전에 Task 1 commit만 main에 merge하고, 사용자에게 push와 `deploy:local` 실행을 요청한다.
  - `docs/RUNTIME-V2-CUTOVER.md` rollback 절에 "Task 1 이전 build로 되돌리기 전에 Claude 탭을 닫는다"를 적는다.

---

### Task 2: Hook stdin 필드 전달과 session 다시 묶기

**Files:**
- Modify: `src/lib/hook-settings.ts:16-63` (`getStatusHookBridgeSource`)
- Modify: `src/pages/api/status/hook.ts`, `src/lib/runtime/ipc.ts:666` (`statusLiveHookEventPayloadSchema`), `src/lib/runtime/contracts.ts:473`, `src/lib/runtime/supervisor.ts:1318`, `src/lib/runtime/status/worker-service.ts:36,183-185`
- Modify: `src/lib/status-manager.ts:956-1030` (`updateTabFromHook`), `:1184-1190` (`resolveAndWatchJsonl` 조기 return)
- Modify: `src/lib/providers/types.ts` (`IAgentProviderStatusBehavior`), `src/lib/providers/codex/index.ts`
- Create: `src/lib/status/hook-session-binding.ts` (다시 묶기와 needs-input 해제 판단을 담는 순수 함수)
- Modify: `src/pages/api/layout/pane/[paneId]/tabs/index.ts:105-112` (status entry 등록에 `panelType` 포함)
- Test: `tests/unit/lib/status-hook-bridge.test.ts`, `tests/unit/pages/status-hook-api.test.ts`(있으면 확장, 없으면 생성), `tests/unit/lib/status-hook-session-binding.test.ts` (create), `tests/unit/lib/runtime/ipc.test.ts`, `tests/unit/lib/providers.test.ts:68-73`(statusBehavior `toEqual` 갱신), `tests/unit/pages/layout-tabs-api.test.ts`

**Interfaces:**
- Produces:
  - Bridge가 stdin(최대 64 KB)을 JSON으로 parse해 아래 필드만 body에 더한다. 문자열이고 512자 이하일 때만 보내고, parse 실패나 다른 필드는 버린다. Prompt 본문, tool 입력은 보내지 않는다.
    - `session_id` → `agentSessionId`
    - `transcript_path` → `transcriptPath`
    - `source` → `source`
    - `notification_type` → `notificationType`(지금 bridge는 이 값을 보내지 않는다)
  - `hook.ts` 검증(capability 검증 뒤, 탭의 provider 기준):
    - `agentSessionId`: `provider.isValidSessionId`
    - `transcriptPath`: `isAllowedAgentJsonlPath`
    - `source`: `startup|resume|clear|compact|fork`
    - `notificationType`: `/^[a-z_]{1,64}$/`
    - 통과하지 못한 필드는 버리고 이벤트는 처리한다.
  - Live IPC payload와 `IRuntimeStatusLiveHookEventInput`에 optional `agentSessionId`, `transcriptPath`, `source`를 더한다.
  - `updateTabFromHook(tmuxSession: string, event: string, options?: { notificationType?: string; agentSessionId?: string; transcriptPath?: string; source?: string }): void`로 바꾼다.
    - `event`는 `string`으로 둔다. `pre-compact`/`post-compact`는 `TEventName`에 없지만 처리해야 한다.
    - 기존 세 번째 인자 호출처는 `{ notificationType }`으로 옮긴다.
  - `IAgentProviderStatusBehavior`에 두 key를 더한다. Codex는 둘 다 `false`라 동작이 바뀌지 않는다. 이 key들은 IPC로 보내지 않는다.
    - `readonly bindSessionFromHook: boolean`
    - `readonly leaveNeedsInputOnJsonlGrowth: boolean`
  - needs-input 해제(spec 2절: terminal에서 직접 응답한 경우):
    - `leaveNeedsInputOnJsonlGrowth`가 true인 provider만 적용한다.
    - `onJsonlFileChange`에서 entry가 `needs-input`이고 JSONL의 `lastEntryTs`가 needs-input으로 바뀐 시각(`lastEvent.at`)보다 뒤면 바꾼다. 이 판단은 synthetic interrupt 검사보다 **먼저** 한다.
      - JSONL 검사 결과가 `interrupted`이면(terminal에서 거절하거나 Esc를 누름) `idle`
      - 아니면 `busy`
    - 웹에서 응답하는 기존 `ack-notification` 경로는 그대로 둔다.
  - `src/lib/status/hook-session-binding.ts`:
    - `export const decideHookSessionRebind = (input: { behavior: IAgentProviderStatusBehavior | null; currentSessionId: string | null; hookSessionId?: string; transcriptPath?: string }): { rebind: false } | { rebind: true; sessionId: string; jsonlPath: string | null }`
    - `export const decideNeedsInputJsonlExit = (input: { behavior: IAgentProviderStatusBehavior | null; cliState: TCliState; needsInputSince: number | null; lastEntryTs: number | null; interrupted: boolean }): 'none' | 'busy' | 'idle'`
    - `status-manager.ts`는 이 두 함수의 결과만 적용한다. Test는 이 함수들에 한다(`StatusManager`를 만드는 test harness는 없다).
  - 탭 생성 API가 status entry를 등록할 때 `panelType`을 넣는다. 넣지 않으면 첫 poll(최대 30초)까지 provider를 몰라 다시 묶기와 needs-input 해제가 꺼져 있다.
  - 다시 묶기 규칙(`bindSessionFromHook`이 true인 provider만):
    - `agentSessionId`가 있고 entry의 `agentSessionId`와 다르면 실행한다.
    - entry `agentSessionId`를 새 값으로, `jsonlPath`를 `transcriptPath`(없으면 `provider.resolveJsonlPath(id, cwd)`)로 바꾼다.
    - `updateTabAgentSessionId`/`updateTabAgentJsonlPath`로 저장한다.
    - 옛 JSONL watch를 멈추고 새 경로로 시작한 뒤 broadcast한다.
    - 그다음 이벤트의 상태 전환을 평소대로 적용한다.

- [ ] **Step 1: Write the failing tests**
  - Bridge test: stdin `{"session_id":"<uuid>","transcript_path":"/home/test/.claude/projects/x/<uuid>.jsonl","source":"clear","notification_type":"permission_prompt","prompt":"secret"}`이면 POST body에 앞의 네 필드가 이름을 바꿔 들어가고 `prompt`는 없다. stdin이 JSON이 아니면 기존 세 필드만 보낸다.
  - API test: 허용 밖 `transcriptPath`(`/etc/passwd.jsonl`)와 잘못된 `source`는 버려지고 `updateTabFromHook`은 나머지로 불린다.
  - Binding test(`hook-session-binding.ts`의 순수 함수):
    - `bindSessionFromHook: true`이고 hook id가 현재 id와 다르면 `rebind: true`와 새 id·경로를 돌려준다.
    - 같은 id면 `rebind: false`다.
    - Codex flag(`false`)면 새 id가 와도 `rebind: false`다.
    - `decideNeedsInputJsonlExit`의 결과:
      - `needs-input`이고 `lastEntryTs > needsInputSince`이면 `busy`, 같은 조건에 `interrupted`면 `idle`이다.
      - `lastEntryTs <= needsInputSince`이면 `none`, Codex flag면 `none`이다.
  - Tab API test: 새 Claude/Codex 탭의 status 등록 entry에 `panelType`이 있다.
  - IPC test: 새 optional 필드가 있는 payload가 parse된다.
- [ ] **Step 2: Run** 위 test 파일들 → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/status-*.test.ts` + `tests/unit/lib/runtime/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(status): forward agent hook session fields and rebind tabs on new sessions`

---

### Task 3: Claude 실행 명령, project directory, process·session 감지

**Files:**
- Create: `src/lib/claude-command.ts`, `src/lib/providers/claude/session-detection.ts`
- Modify: `src/lib/path-validation.ts` (`getClaudeProjectsDir`)
- Test: `tests/unit/lib/claude-command.test.ts`, `tests/unit/lib/claude-session-detection.test.ts` (create)

**Interfaces:**
- Produces:
  - `src/lib/path-validation.ts`: `export const getClaudeProjectsDir = (homeDir = os.homedir()): string` → `<home>/.claude/projects`.
  - `src/lib/claude-command.ts`:
    - `export const isValidClaudeSessionId = (id: unknown): id is string` — UUID(8-4-4-4-12 hex).
    - `export interface IClaudeCommandOptions { settingsPath: string; model?: string; permissionMode?: TClaudePermissionMode }`
    - `export type TClaudePermissionMode = 'acceptEdits' | 'auto' | 'bypassPermissions' | 'manual' | 'dontAsk' | 'plan'` (설치 버전 `claude --help` 값)
    - `export const buildClaudeLaunchCommand = (sessionId: string, options: IClaudeCommandOptions): string` → `claude --settings '<path>' --session-id <uuid>[ --model '<m>'][ --permission-mode <mode>]`
    - `export const buildClaudeResumeCommand = (sessionId: string, options: IClaudeCommandOptions): string` → `--session-id` 대신 `--resume <uuid>`
    - 경로와 model은 `statusline-script.ts`의 `shQuote` 방식으로 따옴표 처리한다. 잘못된 session id면 throw.
  - `src/lib/providers/claude/session-detection.ts`(purplemux `providers/claude/session-detection.ts`를 출발점으로 옮기되 아래를 지킨다):
    - `export const toClaudeProjectName = (dirPath: string): string`
      - `dirPath.replace(/[^a-zA-Z0-9]/g, '-')`
      - 200자 초과면 앞 200자 + `-` + `simpleHash(dirPath)`(`((h << 5) - h + charCode) | 0`, `Math.abs(h).toString(36)`)
    - `export const resolveClaudeJsonlPath = (sessionId: string, cwd: string, homeDir?: string): Promise<string | null>`
      - `<projects>/<toClaudeProjectName(cwd)>/<id>.jsonl`가 있으면 그 경로다.
      - 200자 초과 경로는 `<projects>` 아래에서 앞 200자 prefix로 시작하는 directory의 `<id>.jsonl`도 찾는다.
    - `export const isClaudeRunning = (panePid: number, childPids?: number[]): Promise<boolean>`
      - pane process tree에서 `getProcessCommandLine(pid)`의 command가 `claude`인 process를 찾는다.
      - 단어 경계 regex `/(^|\/)claude(\s|$)/`를 쓴다(`codex-session-detection.ts:70-95` 방식).
    - `export const detectActiveClaudeSession = (panePid: number, childPids?: number[]): Promise<ISessionInfo>` — session id를 아래 순서로 찾는다.
      1. `~/.claude/sessions/<pid>.json`의 `sessionId`. 그 `pid`가 pane process tree 안에 있고 id가 UUID일 때만 쓴다. 읽기 전용이며, 형식을 모르면 건너뛴다. **파일을 지우지 않는다.**
         - 2026-11-10 확인: Claude Code `2.1.322`는 `/clear` 때 이 파일의 `sessionId`를 새 값으로 바꾼다. process args는 바뀌지 않는다. 그래서 args보다 먼저 봐야 status poll과 timeline이 `/clear` 뒤 새 session을 따라간다.
      2. Claude process args의 `--session-id <uuid>` 또는 `--resume <uuid>`
      3. cwd project directory에서 process 시작 뒤 바뀐 가장 새 `*.jsonl`
      - `jsonlPath`는 `resolveClaudeJsonlPath`로 구한다.
    - `export const watchClaudeSessions = (panePid: number, onChange: (info: ISessionInfo) => void, options?: IAgentSessionWatchOptions): ISessionWatcher`
      - `~/.claude/sessions` `fs.watch`(200 ms debounce) + 10초 liveness poll
      - directory가 없으면 60초 뒤 재시도
      - 읽기 전용
  - process helper는 `@/lib/session-detection`의 것(`getChildPids`, `getDescendantPids`, `getProcessCommandLine`, `getProcessCwd`, `getProcessStartTime`, `isProcessRunning`)만 쓴다.

- [ ] **Step 1: Write the failing tests** (`HOME`을 임시 directory로 둔 fixture, process helper는 mock)
  - `toClaudeProjectName('/data/projects/a.b')` → `-data-projects-a-b`. 250자 경로는 길이 200 + `-` + hash이고, 같은 입력은 같은 결과다.
  - `buildClaudeLaunchCommand(<uuid>, { settingsPath: "/tmp/a b/s.json" })` → `claude --settings '/tmp/a b/s.json' --session-id <uuid>`. model·permissionMode가 있으면 순서대로 붙는다. 잘못된 id는 throw.
  - `detectActiveClaudeSession`:
    - args가 `claude --session-id <A>`이고 pidfile `sessionId`가 `<B>`이면 `<B>`를 쓴다(`/clear` 뒤 상황).
    - pidfile이 없으면 args의 `--resume <uuid>`를 쓴다.
    - pidfile은 test 뒤에도 남아 있다.
    - pane에 `claude`가 없으면 `status: 'not-running'`이다.
  - `isClaudeRunning`은 `vim /home/x/.claude/a`를 실행 중으로 보지 않는다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc → PASS
- [ ] **Step 5: Commit** — `feat(claude): add launch command builder and session detection`

---

### Task 4: 탭 설정 파일과 statusLine 대신 실행

**Files:**
- Create: `src/lib/providers/claude/tab-settings.ts`
- Modify: `src/lib/statusline-script.ts`(node `.cjs` script로 교체), `src/lib/hook-settings.ts`(`ensureHookSettings`가 새 script를 씀, `hooks.json`의 `statusLine` 경로 갱신)
- Test: `tests/unit/lib/claude-tab-settings.test.ts`, `tests/unit/lib/claude-statusline-script.test.ts` (create), `tests/unit/lib/status-hook-bridge.test.ts:9,119-123`(`buildStatuslineScriptContent` import와 curl 모양 단언 갱신), `tests/unit/lib/hook-settings.test.ts:10`(`statusline.sh` → `statusline.cjs`)

**Interfaces:**
- Consumes: Task 2의 bridge 이벤트 이름, `createAgentHookCapability`, `STATUS_HOOK_BRIDGE_PATH`
- Produces:
  - `export const getClaudeTabSettingsPath = (tabId: string): string` → `<dataDir>/claude-tabs/<tabId>.json`
  - `export const writeClaudeTabSettings = (input: { tabId: string; sessionName: string; nodePath?: string }): Promise<string>`
    - directory 0700, 파일 0600
    - 내용(JSON):
      - `hooks`:
        - 이벤트별 `[{ matcher: '', hooks: [{ type: 'command', command: <bridge 명령>, async: true, timeout: 3 }] }]`. 단 `SessionStart`의 matcher는 `startup|resume|clear|fork`다(auto compact 때 `SessionStart(compact)`가 작업 중에 와서 idle로 바꾸지 않게 한다. Codex도 matcher로 거른다).
        - 이벤트 대응: `SessionStart`→`session-start`, `UserPromptSubmit`→`prompt-submit`, `Notification`→`notification`, `Stop`→`stop`, `StopFailure`→`stop`, `PreCompact`→`pre-compact`, `PostCompact`→`post-compact`
        - bridge 명령은 Codex와 같은 `ELECTRON_RUN_AS_NODE=1 '<node>' '<STATUS_HOOK_BRIDGE_PATH>' '<event>' '<sessionName>' '<capability>'`
      - `statusLine`: `{ type: 'command', command: "ELECTRON_RUN_AS_NODE=1 '<node>' '<STATUSLINE_SCRIPT_PATH>'" }`(Electron 안에서는 `process.execPath`가 Electron binary다)
      - 이 단계에서 `permissions`는 넣지 않는다(단계 4).
    - 반환값은 파일 경로다.
  - `export const removeClaudeTabSettings = (tabId: string): Promise<void>` — 없으면 조용히 넘어간다.
  - `STATUSLINE_SCRIPT_PATH` = `<dataDir>/statusline.cjs`. 기존 `buildStatuslineScriptContent`(shell)는 `buildStatuslineScriptSource(baseDir)`(node)로 바꾼다. 이 script의 동작:
    1. stdin(최대 64 KB)을 읽는다.
    2. `/api/status/statusline`에 `x-agentmux-token`으로 POST한다. 1초 timeout이고 실패는 무시한다.
    3. 사용자 원래 statusLine 명령을 찾는다. 순서는 `<workspace.project_dir 또는 cwd>/.claude/settings.local.json` → `<…>/.claude/settings.json` → `~/.claude/settings.json`이고, 첫 `statusLine.command` 문자열을 쓴다.
    4. 그 명령에 agentmux 자기 script의 **절대 경로**(`<dataDir>/statusline.cjs`, `<dataDir>/statusline.sh`)가 들어 있으면 실행하지 않는다. 파일 이름만으로 막지 않는다(사용자 `~/.claude/statusline.sh`는 실행돼야 한다).
    5. 찾은 명령은 같은 stdin으로 `sh -c`에서 실행한다.
       - cwd는 project dir이다.
       - 1500 ms가 지나면 kill한다.
       - stdout은 16 KB까지만 자기 stdout으로 낸다.
       - 명령이 없거나 실패하면 아무것도 출력하지 않는다.
    - 사용자 명령은 Claude process 쪽(script 안)에서만 실행한다. Server(`/api/status/statusline`)는 사용자 명령을 실행하지 않는다.
  - `ensureHookSettings`는 시작 시 `statusline.cjs`를 0700으로 쓰고, 옛 `statusline.sh`는 그대로 둔다.

- [ ] **Step 1: Write the failing tests**
  - Settings test(임시 data dir):
    - 파일 mode가 0600이다.
    - 7개 hook 이벤트가 위 대응대로 있고 모두 `async: true`다. `SessionStart` matcher는 `startup|resume|clear|fork`다.
    - statusLine 명령이 `ELECTRON_RUN_AS_NODE=1 `로 시작한다.
    - capability가 `verifyAgentHookCapability(cap, sessionName)`를 통과한다.
    - `permissions` key가 없다.
    - `removeClaudeTabSettings`를 두 번 불러도 throw하지 않는다.
  - Script test(생성한 script를 `node`로 실행, 임시 `HOME`, server는 로컬 임시 HTTP server):
    - 사용자 settings에 `statusLine.command: "printf hello"`가 있으면 stdout이 `hello`다.
    - 명령이 `<임시 data dir>/statusline.cjs`를 가리키면 출력이 없다.
    - 명령이 `sh <임시 HOME>/.claude/statusline.sh`(사용자 script, `printf mine`)이면 stdout이 `mine`이다.
    - settings가 없으면 출력이 없다.
    - 3초 동안 sleep하는 명령은 약 1.5초 뒤 끝나고 출력이 없다.
    - POST body가 stdin과 같다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + `tests/unit/lib/statusline*.test.ts` `tests/unit/lib/hook-settings*.test.ts` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(claude): write per-tab hook settings and pass through the user statusLine`

---

### Task 5: Claude provider 등록, 실행 session id, 탭 정리

**Files:**
- Create: `src/lib/providers/claude/index.ts`
- Modify: `src/types/terminal.ts:12` (`TAgentPanelType = 'codex' | 'claude'`), `src/lib/panel-type.ts` (`AGENT_PANEL_TYPES = ['codex', 'claude']`), `src/lib/providers/index.ts` (등록), `src/lib/providers/types.ts`
- Modify: `src/lib/agent-launch-service.ts`, `src/lib/tab-session-cleanup.ts`, `src/lib/session-list.ts`, `src/lib/config-store.ts` + `src/pages/api/config.ts`
- Modify: `src/lib/agent-provider-meta.ts`, `src/components/icons/agent-provider-icon.tsx`, `src/components/icons/claude-icon.tsx`(create; `git show 31f7bfdc^:src/components/icons/claude-logo.tsx`에서 `currentColor` 단색으로)
- Test: `tests/unit/lib/providers.test.ts`, `tests/unit/lib/agent-launch-service.test.ts`, `tests/unit/lib/tab-session-cleanup.test.ts`, `tests/unit/lib/agent-provider-meta.test.ts`, `tests/unit/lib/panel-type.test.ts`

**Interfaces:**
- Consumes: Task 2 `bindSessionFromHook`, Task 3 전부, Task 4 `writeClaudeTabSettings`/`removeClaudeTabSettings`
- Produces:
  - `IAgentLaunchCommandOptions`와 `IAgentResumeCommandOptions`에 `sessionId?: string`.
  - `IAgentProvider`에 optional 두 개를 더한다.
    - `createLaunchSessionId?(): string`
    - `cleanupTab?(tab: Pick<ITab, 'id' | 'sessionName'>): Promise<void>`
  - `claudeProvider`:
    - 기본 정보: `id: 'claude'`, `displayName: 'Claude Code'`, `panelType: 'claude'`
    - `statusBehavior`: `{ watchJsonlWhenBound: false, deferStopHookUntilJsonlIdle: false, reconcileStateFromJsonl: false, recoverPaneInput: false, bindSessionFromHook: true, leaveNeedsInputOnJsonlGrowth: true }`
    - process 판정: `matchesProcess: (name) => name === 'claude'`, `isValidSessionId: isValidClaudeSessionId`
    - session 감지: `detectActiveSession`, `isAgentRunning`, `watchSessions`는 Task 3 함수를 쓴다.
    - 실행 명령:
      - `buildLaunchCommand(opts)`는 `opts.sessionId`와 `opts.tabId`·`opts.sessionName`이 모두 있어야 한다. 없으면 throw한다.
      - `writeClaudeTabSettings` 결과 경로와 config(`claudeModel`, `claudePermissionMode`)로 `buildClaudeLaunchCommand`를 만든다.
      - `buildResumeCommand(id, opts)`는 같은 방식으로 `buildClaudeResumeCommand`를 만든다.
    - JSONL:
      - `resolveJsonlPath`는 `resolveClaudeJsonlPath`, `resolveLatestJsonlPath(cwd)`는 project directory에서 가장 새 `*.jsonl`이다.
      - `jsonlRoots: (home) => [getClaudeProjectsDir(home)]`
      - 해석은 `session-parser.ts`의 `parseJsonlContent`, `readTailEntries`, `readEntriesBefore`, `parseIncremental`을 쓴다.
      - `readJsonlStatus: async (p) => ({ ...(await checkJsonlIdle(p)), rateLimits: null })`
    - 탭 field 함수는 `agent-tab-fields.ts`의 것을 쓴다.
    - `createLaunchSessionId: () => randomUUID()`, `cleanupTab: (tab) => removeClaudeTabSettings(tab.id)`
  - `launchAgentInTab`:
    - `action: 'launch'`이고 provider에 `createLaunchSessionId`가 있으면 id를 만든다.
    - launch 명령을 만들기 전에 `updateTabAgentSessionId(tab.sessionName, provider, id)`로 저장하고 `sessionId`로 넘긴다.
    - Codex 경로는 그대로다.
  - `cleanupTabSession`: `getProviderByPanelType(tab.panelType)?.cleanupTab?.(tab)`를 부른다. 실패는 log만 남긴다.
  - `buildResumeCommand` 호출처 세 곳이 `tabId`와 `sessionName`을 넘기는지 확인한다. 넘기지 않으면 넘기게 한다(Claude resume은 탭 설정 파일이 필요하다).
    - `auto-resume.ts:76`
    - `api/workspace/index.ts:66-75`
    - `timeline/resume-session-service.ts:193`
  - `session-list.ts`: provider가 Codex가 아니면 빈 목록을 돌려준다. 통합 목록은 단계 3이다. Claude 탭에 Codex 세션이 보이면 안 된다.
  - Config key와 `api/config` 검증:
    - `claudeModel?: string | null`: 1~128자, `[A-Za-z0-9._:-]`
    - `claudePermissionMode?: TClaudePermissionMode | null`
    - 설정 화면은 단계 3이다.
  - `AGENT_PROVIDER_META.claude`: `{ panelType: 'claude', label: 'Claude Code', newTabCommand: 'claude-new', restartCommands: ['/clear'], exitCommand: '/exit', interruptSequence: '\x1b', keepTimelineOnSessionEnd: true }`
  - `AGENT_PROVIDER_ICONS.claude = ClaudeIcon`

- [ ] **Step 1: Write the failing tests**
  - `providers.test.ts`:
    - `getProviderByPanelType('claude')?.id === 'claude'`
    - `claudeProvider.statusBehavior`가 위 값이다.
    - `buildLaunchCommand({ tabId, sessionName, sessionId: <uuid> })`가 `--settings`(임시 data dir 아래 경로)와 `--session-id <uuid>`를 포함하고, 그 settings 파일이 생긴다.
    - `sessionId`가 없으면 reject한다.
  - `agent-launch-service.test.ts`: claude 탭 launch 때 `updateTabAgentSessionId`가 launch 명령 전송보다 먼저, 명령에 들어간 것과 같은 id로 불린다. Codex 탭은 `updateTabAgentSessionId`를 부르지 않는다.
  - `tab-session-cleanup.test.ts`: claude 탭 정리 때 `removeClaudeTabSettings(tab.id)`가 불린다.
  - `panel-type.test.ts`: `isAgentPanelType('claude')`가 true다. 단계 1의 "claude는 false" 단언은 이 단계에서 뒤집는다.
  - `agent-provider-meta.test.ts`: claude metadata가 위 값이다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + 전체 suite 한 번 + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(claude): register the Claude Code provider`

---

### Task 6: Provider별 rate limit

**Files:**
- Modify: `src/types/status.ts:88-96`, `src/lib/runtime/ipc.ts:627-660`, `src/lib/runtime/contracts.ts:401,421`, `src/lib/status-manager.ts:118,218,284-289,640,1135`, `src/lib/runtime/status/worker-service.ts:106`, `src/lib/status-server.ts:51,69`
- Modify: `src/hooks/use-rate-limits-store.ts`, `src/hooks/use-agent-status.ts:125`, `src/components/features/layout/sidebar-rate-limits.tsx`(또는 실제 위치), 모바일 navigation sheet의 rate limit 표시
- Test: `tests/unit/lib/status-rate-limits.test.ts`(create 또는 기존 확장), `tests/unit/lib/runtime/ipc.test.ts`, 기존 sidebar rate limit test

**Interfaces:**
- Produces:
  - `IRateLimitsUpdateMessage = { type: 'rate-limits:update'; providerId: TAgentPanelType; data: IRateLimitsData }`. Sync payload의 rate limit은 `Partial<Record<TAgentPanelType, IRateLimitsData>>`.
  - Status manager:
    - `lastRateLimits`는 provider별로 둔다.
    - `publishRateLimits(providerId, data)`는 provider 안에서 기존 `mergeRateLimitsData`를 쓴다.
    - Codex JSONL은 `'codex'`로 보낸다.
    - `rate-limits-watcher`가 보는 `RATE_LIMITS_FILE`은 statusLine route만 쓰므로 `'claude'`로 보낸다.
  - Client store: `byProvider: Partial<Record<TAgentPanelType, IRateLimitsData>>`
  - Sidebar와 모바일 표시:
    - data가 있는 provider마다 한 줄을 보여 준다.
    - 각 줄에 `AgentProviderIcon`과 label(`getAgentProviderMeta(type).label`)을 둔다(design review 조건).
    - Data가 하나도 없으면 지금처럼 아무것도 그리지 않는다.

- [ ] **Step 1: Write the failing tests**
  - Status manager: Codex JSONL rate limit과 statusLine 파일 rate limit이 각각 `'codex'`, `'claude'` key로 저장되고 서로 덮어쓰지 않는다. 같은 값을 다시 받으면 broadcast하지 않는다.
  - IPC: providerId가 있는 update event와 record sync payload가 parse된다.
  - Client: store에 두 provider가 있으면 sidebar가 두 줄을 label과 함께 그리고, 하나면 한 줄을 그린다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + 관련 status·runtime·component test + tsc → PASS
- [ ] **Step 5: Commit** — `feat(status): keep rate limits per agent provider`

---

### Task 7: Provider별 preflight와 Claude 설치 명령

**Files:**
- Modify: `src/types/preflight.ts:15-60`, `src/lib/preflight.ts:60-290`, `src/lib/agent-launch-service.ts:21,37-39`, `src/lib/install-server.ts:24-50`, `src/pages/api/preflight/runtime.ts`(응답 shape)
- Test: `tests/unit/lib/preflight-agents.test.ts`(create), `tests/unit/lib/agent-launch-service.test.ts`, 기존 preflight·tools-required test

**Interfaces:**
- Produces:
  - `IRuntimePreflightResult.agents: Partial<Record<TAgentPanelType, IToolStatus>>`
    - 기존 `agent` field는 Codex 상태로 남겨 지금 화면(tools-required, onboarding)이 그대로 동작하게 한다. 화면 개편은 단계 3이다.
  - `export const MIN_CLAUDE_VERSION = '2.0.0'`
  - `checkClaudeTool(): Promise<IToolStatus>`
    - 기존 `checkTool`/`execTool`로 `claude --version`을 실행하고 shell PATH를 쓴다.
    - 못 찾으면 `~/.local/bin/claude`가 있는지 보고 PATH 문제로 표시한다.
    - `parseToolSemanticVersion`·`isSemanticVersionAtLeast`로 호환 여부를 정한다.
  - `isRuntimeOk`: terminal과 git이 정상이고, `agents` 중 하나라도 `installed && compatible !== false`이면 true다.
  - `launchAgentInTab`:
    - `preflight.agents[provider.id]`를 본다. 없거나 사용할 수 없으면 `{ ok: false, code: 'agent-unavailable' }`를 돌려준다.
    - 기존 `'codex-update-required'` code를 받는 client 처리도 `'agent-unavailable'`을 같은 방식으로 다룬다(client grep).
  - `install-server.ts`에 `claude`, `claude-path`, `claude-login`을 더한다.
    - `claude`: Linux `curl -fsSL https://claude.ai/install.sh | bash`(공식 설치 명령)
    - `claude-path`: `~/.local/bin`을 PATH에 넣으라는 안내 + `claude --version`
    - `claude-login`: `claude` 실행 안내 문구
    - mac 쪽도 같은 명령을 쓴다.

- [ ] **Step 1: Write the failing tests**
  - `preflight-agents.test.ts`(tool 실행은 mock):
    - Codex 없음 + Claude 2.1.322 → `isRuntimeOk` true, `agents.claude.compatible` true, `agents.codex.installed` false
    - 둘 다 없음 → false
    - Claude 1.9.0 → `compatible` false
  - Launch test: `agents.claude`가 없을 때 claude 탭 launch는 `agent-unavailable`이다. `agents.codex`가 있으면 Codex launch는 성공한다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc → PASS
- [ ] **Step 5: Commit** — `feat(preflight): check each agent provider and open with any one available`

---

### Task 8: 권한 요청 Claude 문구와 folder trust

**Files:**
- Modify: `src/lib/permission-prompt.ts:1-11,63-70,187-200,234`
- Create: `src/lib/trust-prompt-detector.ts`, `src/hooks/use-trust-prompt-detector.ts`, `src/components/features/workspace/trust-prompt-card.tsx`
- Modify: `src/components/features/workspace/pane-container.tsx`(카드 연결), 모바일 agent 화면 해당 위치, `messages/{ko,en}/terminal.json`
- Test: `tests/unit/lib/permission-prompt.test.ts`, `tests/unit/lib/trust-prompt-detector.test.ts`(create)

**Interfaces:**
- Produces:
  - Permission prompt:
    - `DAMAGED_CODEX_NO_TELL_RE` 복구는 실제 문구의 agent 이름(`Claude`나 `Codex`)을 유지한다. "No, and tell Claude what to do differently"는 그대로 남는다.
    - `classifyPromptType`은 "Do you want to proceed?"를 `command`로, "Do you want to make this edit"·"Do you want to create"를 `file`로 분류한다.
    - 번호 줄 parser는 앞의 `❯`, `↓`, `↑` 표시를 견딘다.
  - `src/lib/trust-prompt-detector.ts`:
    - `export interface ITrustPromptInfo { agent: 'claude' | 'codex'; folderPath: string | null }`
    - `export const matchTrustPrompt = (screenText: string): ITrustPromptInfo | null`
      - Claude `2.1.322` 실제 화면(2026-11-10 격리 tmux에서 캡처, 응답하지 않고 종료):
        ```
         Accessing workspace:
         /tmp/x
         Quick safety check: Is this a project you created or one you trust? ...
         Claude Code'll be able to read, edit, and execute files here.
         Security guide
         ❯ No, exit
           Yes, I trust this folder
         Enter to confirm · Esc to cancel
        ```
      - 선택지에 **번호가 없고**, 기본 선택(`❯`)은 "No, exit"다. purplemux의 숫자 key 방식은 이 버전에 맞지 않는다.
      - "Quick safety check" + "Yes, I trust this folder" + "No, exit"가 모두 있으면 감지한다. 문구가 바뀐 경우에 대비해 "trust this folder"와 "exit" 선택지 두 개만 있어도 감지한다.
      - folder 경로는 "Accessing workspace:" 다음 줄이다. 없으면 anchor 위 6줄 안의 첫 `/…` 경로다.
      - 결과에 선택지 순서와 현재 `❯` 위치(`options: string[]`, `selectedIndex: number`)를 담는다.
      - Codex 규칙은 purplemux 것(번호 선택지)을 함께 옮긴다.
    - `export const trustAnswerKeys = (info: ITrustPromptInfo, answer: 'yes' | 'no'): string`
      - Claude:
        - `yes`: 목표 선택지("Yes, I trust this folder")까지 `selectedIndex`와의 차이만큼 화살표(`\x1b[B` 아래, `\x1b[A` 위)를 보낸 뒤 `\r`
        - `no`: `\x1b`(Esc)
      - Codex: 기존 숫자 `'1'`/`'2'`
  - `useTrustPromptDetector({ enabled, getBufferText, sendStdin })`(purplemux hook을 옮김, 200 ms debounce)와 `TrustPromptCard`:
    - 경로를 보여 주고 "이 folder 신뢰"·"종료" 두 버튼을 둔다(44px 이상, focus-visible).
    - agent 탭이고, `cliState`가 `inactive`나 `unknown`이거나 탭 `sessionView`가 `check`일 때만 켠다(`check`는 cliState가 아니라 `TSessionView` 값이다).
  - 문구 key: `trustPromptTitle`, `trustPromptTrust`, `trustPromptExit`(ko/en).

- [ ] **Step 1: Write the failing tests**
  - `permission-prompt.test.ts`: 합성 Claude 화면
    ```
     Bash command
       rm -rf build
     Do you want to proceed?
     ❯ 1. Yes
       2. Yes, and don't ask again for rm commands in /tmp/x
       3. No, and tell Claude what to do differently (esc)
    ```
    - 선택지 3개, `promptType` `command`, 3번 문구에 `Claude`가 남아 있다.
    - 기존 Codex fixture 결과는 그대로다.
  - `trust-prompt-detector.test.ts`(위 실제 화면 모양의 합성 fixture):
    - `{ agent: 'claude', folderPath: '/tmp/x', options: ['No, exit', 'Yes, I trust this folder'], selectedIndex: 0 }`로 감지된다.
    - 일반 출력은 null이다.
    - `trustAnswerKeys(info, 'yes') === '\x1b[B\r'`, `trustAnswerKeys(info, 'no') === '\x1b'`
    - `selectedIndex`가 1이면 `yes`는 `'\r'`이다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + 관련 component test + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(claude): read Claude permission prompts and answer folder trust from the web`

---

### Task 9: 최소 화면 (새 탭, 보기 전환, 단축키, 모바일)

**Files:**
- Modify: `src/components/features/workspace/pane-new-tab-menu.tsx`, `src/components/features/mobile/mobile-new-tab-dialog.tsx`, `src/components/features/mobile/mobile-terminal-page.tsx:166`, `src/components/features/workspace/content-header.tsx:104-108`, `src/components/features/mobile/mobile-tab-header.tsx`, `src/lib/keyboard-shortcuts.ts:223-229`, `src/hooks/use-keyboard-shortcuts.ts:141-153`, cheat sheet, `src/lib/process-icon.ts:21`, `src/components/icons/process-icon.tsx`, `messages/{ko,en}/terminal.json`·`shortcuts.json`
- Test: 관련 component·shortcut test(있으면 확장, 없으면 `tests/unit/components/agent-new-tab-items.test.ts` 생성)

**Interfaces:**
- Consumes: Task 5 `AGENT_PROVIDER_META.claude`, `ClaudeIcon`
- Produces:
  - 새 탭 메뉴(데스크톱·모바일)에 Claude Code 항목을 넣는다. key는 `claude-new`이고 `startAgent: true`로 만든다. Agent 항목 목록은 `AGENT_PANEL_TYPES` × metadata로 만든다. `mobile-terminal-page`의 `command === 'codex-new'`는 `newTabCommand` lookup으로 바꾼다.
  - 보기 전환은 TERMINAL / CODEX / CLAUDE / DIFF다.
    - 데스크톱은 고정 폭이다.
    - 모바일 `PANEL_MODES`는 360px 폭에서 각 버튼이 44px 이상이다. 넘치면 icon + `aria-label`(tooltip)로 바꾼다.
  - 단축키 `view.mode_claude`: 기본 `${mod}+shift+l`, 표시 `⌘⇧L`/`Ctrl+Shift+L`. 기존 단축키와 겹치지 않음을 test한다.
  - Process icon: process 이름 `claude` → `ClaudeIcon`
  - 단계 1 guard 그대로: Runtime v2 탭에서 CLAUDE 전환은 막히고 "새 Claude Code 탭 열기" toast가 뜬다(문구 `{agent}` 치환 확인).

- [ ] **Step 1: Write the failing tests**
  - 새 탭 항목에 `codex-new`와 `claude-new`가 둘 다 있다.
  - `view.mode_claude` 기본 key가 다른 모든 `defaultKey`와 다르다.
  - Runtime v2 탭에서 `updateTabPanelType(…, 'claude')`이 toast를 띄우고 문구에 `Claude Code`가 들어간다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(ui): open and switch to Claude Code tabs`

---

### Task 10: 문서, gate, 격리 live smoke

**Files:**
- Modify: `docs/STATUS.md`(Claude hook 상태 경로, session 다시 묶기), `docs/TMUX.md` 또는 `docs/ARCHITECTURE-LOGIC.md`(Claude 실행 흐름), `CONTEXT.md`("로컬 Claude Code 세션" 용어, Session Catalog·Timeline·Status 정의 넓히기 — grill 기록의 용어 점검대로), `docs/FOLLOW-UP.md`, `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`(진행 상태 줄 갱신 포함)

- [ ] **Step 1: Update docs**
- [ ] **Step 2: Full gates**
  - `corepack pnpm check:project-design && corepack pnpm check:product-name && corepack pnpm lint && corepack pnpm exec tsc --noEmit && corepack pnpm test && corepack pnpm build`
  - test 실패 0, lint error 0
- [ ] **Step 3: 격리 live smoke** (Claude가 감시하에 진행)
  - 서버 실행 조건:
    - 이 worktree의 production build
    - `HOME`은 그대로 둔다(Claude 로그인 필요).
    - 새 임시 `AGENTMUX_DATA_DIR`, 새 임시 `TMUX_TMPDIR`, port 18122
    - `AGENTMUX_RUNTIME_V2=1`과 live와 같은 4개 mode 값
    - `AGENTMUX_TMUX_SCOPE=off`, `INVOCATION_ID` 해제
  - Workspace directory는 이 worktree다. Claude가 이미 신뢰하는 상위 directory 아래라 trust 확인이 뜨지 않아야 한다.
  - 확인 항목:
    1. 시작 전 `~/.claude/settings.json`, `~/.codex/config.toml`의 sha256을 기록한다. `~/.claude.json`은 Claude Code가 시작할 때마다 직접 쓰므로 비교하지 않는다.
    2. 새 탭 API(`{ panelType: 'claude', startAgent: true }`)로 Claude 탭을 만든다.
       - session 이름이 `pt-…`(v1)이다.
       - 실행 명령에 `--settings <임시 data dir>/claude-tabs/<tabId>.json --session-id <uuid>`가 있다.
    3. 짧은 prompt 하나 → 상태가 `busy` → `ready-for-review`로 바뀌고 hook 경로로 들어온다(server log의 hook 이벤트).
    4. timeline API가 그 JSONL의 항목을 돌려준다.
    5. 파일 쓰기를 요구하는 prompt → 권한 요청 화면 → `permission-options`가 Claude 선택지를 돌려주고, "No" 선택이 들어간다.
    6. `/clear` 입력 → hook `session-start`(`source: clear`)로 탭의 session id가 새 값으로 바뀐다. 35초 이상(poll 한 번 이상) 기다린 뒤에도 tab id가 새 값이고, timeline API가 새 session의 항목을 돌려준다.
    7. worktree에 임시 `.claude/settings.local.json`(`statusLine.command: "printf phase2-statusline"`)을 두고 탭을 다시 시작하면 Claude 화면 하단에 `phase2-statusline`이 보인다. 확인 뒤 그 파일을 지운다.
    8. Folder trust 화면 확인:
       - 신뢰되지 않은 임시 directory에서 별도 tmux session으로 `claude`만 실행해 화면을 캡처한다.
       - `matchTrustPrompt`가 감지하는지 본다. 감지되지 않으면 Task 8 규칙을 고친다.
       - 웹 카드의 "종료"(Esc)로 답하고 신뢰를 수락하지 않는다. 그 뒤 `~/.claude.json`의 `projects[<임시 directory>].hasTrustDialogAccepted`가 true가 아님을 확인한다.
    9. 1번 sha256이 그대로다. 임시 서버와 tmux를 끄고 임시 directory를 지운다. Live tmux session 목록과 service PID가 시작 전과 같다.
  - Claude prompt는 합계 4개 이하로 쓴다.
- [ ] **Step 4: Record** 결과를 handoff 문서에 기록한다.
- [ ] **Step 5: Commit** — `docs: record the Claude Code provider core and its live smoke`
