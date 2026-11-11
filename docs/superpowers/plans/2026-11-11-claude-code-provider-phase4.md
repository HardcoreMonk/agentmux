# Claude Code Provider 단계 4: 위임 안내와 CLI 변경 Implementation Plan

> **For agentic workers:** 구현은 Herdr pane의 agy가 task 단위로 맡고(agy 한도가 없을 때는 Claude subagent), Claude가 task마다 diff·test로 검증하고 독립 검토를 돌린다(사용자 결정 2026-11-10). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agentmux가 띄운 Claude Code와 Codex가 `agentmux tab` CLI 사용법을 알고, 브라우저 없이 다른 탭을 만들어 일을 맡기고 결과를 읽을 수 있게 한다. CLI는 준비 전·입력 대기 중인 대상에 글자를 보내지 않고, agent가 만든 탭의 개수와 닫기를 제한한다.

**Architecture:** 실행 명령 앞에 탭 환경 변수(`AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, data dir shim을 앞에 붙인 `PATH`)를 붙이고, provider별 고정 안내를 Claude는 `--append-system-prompt-file`, Codex는 `-c developer_instructions=`로 넣는다. CLI API는 화면 route와 같은 탭 서비스(`src/lib/workspace-tab-service.ts`)를 거쳐 탭을 만들고 닫으며, 입력·화면 캡처는 탭의 `runtimeVersion`에 맞는 terminal 경로를 쓴다. 위임 관계는 탭의 `createdByTabId`로 기록하고 Runtime v2 storage(SQLite)에도 저장한다.

**Tech Stack:** TypeScript, Next.js Pages Router custom server, Runtime v2 workers(zod IPC), better-sqlite3, `smol-toml`(새 의존성), zustand, next-intl(ko/en), shadcn/ui, vitest, Node CLI(`bin/cli.js`, CommonJS).

**Spec:** `docs/superpowers/specs/2026-11-10-claude-code-provider-design.md` (2절 "실행과 탭 식별"의 `permissions.allow`·탭 환경 변수, 4절 "위임 안내 주입 (C)", "단계와 배포" 4번, 인수 기준 10·11·12·13, ADR 후보 ADR-035·036)

**Base:** main `5b29cb67`(단계 3 merge `ad32559d` + 배포 기록). 작업 branch `feat/claude-provider-phase4`, worktree `/data/projects/agentcode-zone/agentmux/.worktrees/claude-provider-phase4`.

## 단계 4 범위

| 항목 | Task |
| --- | --- |
| 위임 설정 key, 고정 안내 문장, data dir CLI shim | 1 |
| Claude·Codex 실행에 탭 환경 변수, 안내, `permissions.allow` 붙이기 | 2 |
| Runtime v2 terminal 화면 캡처와 session 확인 | 3 |
| 탭 `createdByTabId`, Runtime v2 storage schema v6, 위임 탭은 active 탭을 바꾸지 않음 | 4 |
| 공용 탭 서비스(만들기·닫기·상태·입력·화면·마지막 응답), 화면 route가 같은 서비스를 씀 | 5 |
| CLI API 동작 변경(create 대기, send 거절, status·result 필드, close 제한, 개수 제한) | 6 |
| CLI client(`bin/cli.js`): 환경 변수 기본값, 호출 탭 header, `--cwd`, 오류 출력 | 7 |
| 설정 화면 토글, 위임 탭 표시 | 8 |
| 문서, ADR, gate, 격리 live 확인 | 9 |

## Global Constraints

- 사용자 `~/.claude/`, `~/.claude.json`, `~/.codex/`(또는 `CODEX_HOME`) 파일과 project `.codex/config.toml`은 읽기만 한다. 쓰거나 지우지 않는다(Anti-goal).
- agentmux 밖에서 돈 Claude Code·Codex(예: Herdr pane)에는 hook, 안내, 환경 변수가 붙지 않는다. 붙이는 곳은 agentmux 실행 명령뿐이다.
- 위임 설정(`agentDelegationGuideEnabled`)이 꺼져 있으면 실행 명령은 단계 3과 byte 단위로 같다(환경 변수, 안내, `permissions.allow` 모두 없음).
- 안내 문장에는 workspace id와 탭 id를 넣지 않는다. Id는 환경 변수로만 전달한다(Claude 재개 시 system prompt snapshot 문제).
- `permissions.allow`는 `agentmux tab`의 `list`, `create`, `send`, `status`, `result`, `close`만 허용한다. `tab browser`(특히 `eval`)와 `agentmux` 전체는 허용하지 않는다.
- CLI는 권한 요청 화면이나 시작 화면에 글자를 보내지 않는다(Anti-goal: 사용자 대신 승인·거절 금지).
- 위임 제한(needs-input 거절, agent가 만든 탭만 닫기, 살아 있는 위임 탭 6개)은 실수 방지 장치다. CLI token 범위는 바꾸지 않는다.
- Agent 탭은 Runtime v1 탭이다. Plain terminal 탭은 terminal v2 mode 규칙(`shouldCreateTerminalTabInRuntimeV2`)을 따른다. CLI가 만드는 탭도 같다.
- 새 오류 응답 형식: `{ "error": "<code>", "message": "<사람이 읽는 설명>" }`. 기존 오류 응답(`{ error: 'Tab not found' }` 등)은 바꾸지 않는다.
- 화면: icon + text label, 44px 이상 touch target, DOM-safe(`innerHTML`, `dangerouslySetInnerHTML` 금지), 새 문구는 `messages/ko`와 `messages/en`에 함께, 한국어 `word-break: keep-all`.
- `AGENTS.md`: Pages Router, `"use client"` 금지, `@/` import, 소문자-dash 파일명, arrow function, `I`/`T` 접두사, `pgrep`/`ps`/`lsof` 직접 호출 금지, 공유 singleton은 `globalThis` guard.
- Runtime v2 IPC zod schema를 바꾸면 main과 worker 양쪽 test를 갱신한다.
- 공개 repo: test fixture는 합성 데이터만.
- 명령은 `corepack pnpm ...`. 전체 test는 임시 `TMUX_TMPDIR`로. Commit은 Conventional Commits, 본문 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `--no-verify` 금지, push 금지.
- **작업 위치**: worktree `/data/projects/agentcode-zone/agentmux/.worktrees/claude-provider-phase4`만 쓴다. Live checkout `/data/projects/agentcode-zone/agentmux`, port 8122, `~/.codexmux`, 기본 tmux socket directory는 건드리지 않는다.

## Review Focus

1. 위임 설정을 끈 사용자의 Claude·Codex 실행 명령이 단계 3과 같다 → Task 2 `claude-command.test.ts`, `codex-command.test.ts`의 "disabled" case.
2. 사용자가 Codex config에 `developer_instructions`를 둔 경우 그 값이 사라지지 않는다. 값이 둘 이상이거나 TOML을 읽지 못하면 안내를 넣지 않는다 → Task 2 `codex-developer-instructions.test.ts`.
3. `needs-input`·준비 전 대상에 `tab send`를 하면 tmux와 Runtime v2 어느 쪽에도 한 byte도 쓰지 않는다. 상태는 `busy`여도 화면에 권한 요청이 떠 있으면 거절한다 → Task 6 `cli-tabs-send-api.test.ts`.
4. Agent가 만든 탭은 사용자가 보던 active 탭을 바꾸지 않는다 → Task 4 `layout-store-add-tab.test.ts`, Task 6 `cli-tabs-create-api.test.ts`.
5. 기존 Runtime v2 DB(schema v5)가 v6로 열리고, `createdByTabId`가 없는 기존 layout도 그대로 읽힌다 → Task 4 `storage-schema-migration.test.ts`, `storage-import.test.ts`.
6. Agent가 자기가 만들지 않은 탭(사용자 탭, 다른 agent의 탭, 자기 자신)을 닫지 못한다 → Task 6 `cli-tabs-close-api.test.ts`.
7. `tab browser eval`은 Claude 탭에서 미리 허용되지 않는다 → Task 2 `claude-tab-settings.test.ts`.

## Rulings (계획 작성 시 결정, 사용자 확인 불필요)

- **Codex 환경 변수 전달**: Codex `0.167.0` 기본 `shell_environment_policy`는 모든 변수를 넘기고 `*KEY*`, `*SECRET*`, `*TOKEN*`만 뺀다(binary 문자열 확인). `AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, `PATH`는 넘어간다. 그래서 Codex 안내에도 id를 넣지 않는다. 사용자가 `inherit = "core"`/`"none"`을 쓰면 CLI가 호출 탭을 모르므로 사용자가 직접 실행한 CLI처럼 동작한다(제한 없음, `-w` 필요). 이 한계는 문서에 적는다.
- **Codex `developer_instructions` 합치기**: 읽는 단계는 (a) `$CODEX_HOME/config.toml`(기본 `~/.codex/config.toml`)의 최상위 값, (b) 같은 파일의 최상위 `profile` 값이 가리키는 `[profiles.<name>]`의 값, (c) 탭 cwd부터 `/`까지 올라가며 찾은 `.codex/config.toml`의 최상위 값이다. 비어 있지 않은 서로 다른 값이 0개면 안내만, 1개면 `<값>\n\n<안내>`, 2개 이상이면 어느 값이 적용될지 단정하지 않고 안내를 넣지 않는다(log warn). 어느 파일이든 TOML parse에 실패해도 안내를 넣지 않는다(log warn). 우선순위를 추정하지 않으므로 사용자 값을 덮어쓸 일이 없다.
- **TOML parser**: `smol-toml`(의존성 없는 TOML 1.0 parser)을 dependency로 더한다. 설치 시점의 최신 1.x를 쓰고 version은 lockfile로 고정한다.
- **호출 탭 전달**: CLI는 `AMUX_TAB_ID`가 있으면 모든 요청에 header `x-agentmux-caller-tab: <tabId>`를 붙인다. Server는 그 탭을 모든 workspace에서 찾고, 없으면 404 `caller-tab-not-found`를 돌려준다. 호출 탭이 있으면 "agent 호출"로 본다(위임 제한 적용).
- **위임 탭 위치**: 대상 workspace가 호출 탭의 workspace와 같으면 호출 탭의 pane에 만든다. 다르면(`-w`로 다른 workspace 지정) 대상 workspace의 첫 pane에 만든다. 두 경우 모두 `createdByTabId`를 기록하고 active 탭을 바꾸지 않는다.
- **위임 탭 cwd**: `--cwd`가 있으면 그 값(존재하는 directory여야 함, 아니면 400 `invalid-cwd`). 없으면 호출 탭의 현재 cwd(v1: `getSessionCwd`, 실패 시 `tab.cwd`), 호출 탭이 없거나 다른 workspace면 대상 workspace의 첫 directory.
- **개수 제한**: 대상 workspace layout에서 `createdByTabId`가 있는 탭 수가 6 이상이면 409 `delegation-limit`. 탭은 닫히면 layout에서 빠지므로 layout에 있는 것을 "살아 있는 것"으로 센다.
- **준비 판정**: `tab create -t claude|codex`는 탭을 만들고 0.5초 뒤 `launchAgentInTab`을 부른 다음, 탭의 `cliState`가 `idle`이 될 때까지 0.5초 간격으로 최대 60초 기다린다. Agent가 설치되지 않았으면(preflight) 탭을 만들기 전에 409 `agent-unavailable`.
- **Runtime v2 storage**: 기본 mode(`AGENTMUX_RUNTIME_STORAGE_V2_MODE=default`, live 설정)에서는 layout을 SQLite에서 읽으므로 `createdByTabId`를 `tabs.created_by_tab_id` column(schema v6)에 저장한다. 이 migration 뒤에는 이전 build가 DB를 열지 못한다(새 schema version 거부). Rollback 절차는 Task 9 문서에 적는다.

---

### Task 1: 위임 설정, 고정 안내, CLI shim

**Files:**
- Create: `src/lib/delegation-guide.ts`
- Modify: `src/lib/config-store.ts:15-43` (`IConfigData`), `src/pages/api/config.ts:13` (허용 key, boolean 검증), `src/lib/hook-settings.ts:112-138` (`ensureHookSettings`가 shim과 Claude 안내 파일을 씀)
- Test: `tests/unit/lib/delegation-guide.test.ts`(create), `tests/unit/pages/config-api.test.ts`, `tests/unit/lib/hook-settings.test.ts`(있으면 갱신, 없으면 create)

**Interfaces:**
- Produces (`src/lib/delegation-guide.ts`):
  - `export type TDelegationProvider = 'claude' | 'codex'`
  - `export const isDelegationGuideEnabled = (config: Pick<IConfigData, 'agentDelegationGuideEnabled'>): boolean` — `false`일 때만 꺼짐(없으면 켬).
  - `export const buildDelegationGuide = (provider: TDelegationProvider): string` — 아래 고정 문장. Codex는 마지막에 sandbox 문단이 더해진다.
  - `export const getDelegationShimDir = (baseDir?: string): string` → `<dataDir>/bin`
  - `export const getClaudeDelegationGuidePath = (baseDir?: string): string` → `<dataDir>/delegation/claude.md`
  - `export const buildDelegationShimSource = (input: { nodePath: string; cliEntryPath: string; dataDir: string }): string` — `#!/bin/sh` 다음 줄 `AGENTMUX_DATA_DIR=<dataDir> exec <nodePath> <cliEntryPath> "$@"`(세 값 모두 `shQuote`).
  - `export const ensureDelegationAssets = (input?: { baseDir?: string; nodePath?: string; appDir?: string }): Promise<void>` — `<dataDir>/bin/agentmux`(mode 0700)와 `<dataDir>/delegation/claude.md`(mode 0600)를 내용이 바뀐 경우에만 쓴다(`hook-settings.ts`의 `writeIfChanged`를 export해 재사용). `cliEntryPath`는 `<appDir>/bin/agentmux.js`, `appDir` 기본값은 `process.env.__CMUX_APP_DIR ?? process.cwd()`.
  - `export const buildDelegationEnvPrefix = (input: { workspaceId: string; tabId: string; shimDir: string }): string` → `AMUX_WORKSPACE_ID=<q> AMUX_TAB_ID=<q> PATH=<q shimDir>:"$PATH" `(끝 공백 포함, `<q>`는 `shQuote`).
- Produces (config): `IConfigData.agentDelegationGuideEnabled?: boolean`. `/api/config` PATCH는 boolean만 받는다(아니면 400).
- 고정 안내 문장(구현은 이 문장을 그대로 쓴다):

```text
# agentmux delegation

You are running inside an agentmux tab. You can hand work to other agent tabs in this workspace with the `agentmux` CLI. Delegation runs without asking the user; new tabs appear in the user's tab bar.

The CLI reads the workspace and your tab from AMUX_WORKSPACE_ID and AMUX_TAB_ID, so you do not need -w.

- agentmux tab list
- agentmux tab create -t claude|codex|terminal [-n NAME] [--cwd DIR]   (prints tabId and ready; waits up to 60 seconds for the agent)
- agentmux tab send TAB_ID "instruction"
- agentmux tab status TAB_ID   (cliState)
- agentmux tab result TAB_ID   (lastAssistantMessage and the screen)
- agentmux tab close TAB_ID    (only tabs you created)

cliState: idle = waiting for input. busy = working. needs-input = waiting for the user to answer a permission prompt. ready-for-review = finished a turn; read the result.

How to delegate:
1. Create the tab and check that ready is true. If it is false, tell the user the new tab needs attention on screen.
2. Send one self-contained instruction: the goal, the files, and how to tell it is done.
3. Check `tab status` no more often than every 10 seconds until cliState is ready-for-review or idle, then read `tab result`.
4. Close tabs you no longer need.

Limits: at most 6 open tabs created by agents per workspace (error delegation-limit). `tab send` refuses a target that is waiting for a permission answer (target-needs-input) or has not started (target-not-ready). Never answer another tab's permission prompt. Do not create tabs in a loop.
```

Codex에만 붙는 문단:

```text
If the agentmux CLI fails with a network error, your sandbox blocks local network access. Tell the user that delegation is not available in this sandbox.
```

- [ ] **Step 1: Write the failing tests**
  - `delegation-guide.test.ts`:
    - `isDelegationGuideEnabled({})`는 true, `{ agentDelegationGuideEnabled: false }`는 false.
    - `buildDelegationGuide('claude')`에 `agentmux tab create`가 있고 `AMUX_WORKSPACE_ID` 설명이 있으며 `ws-`·`tab-` 같은 id 형식 문자열이 없다. `'codex'`는 `'claude'` 문장 + sandbox 문단이다.
    - `buildDelegationShimSource({ nodePath: '/n o/node', cliEntryPath: "/a'b/bin/agentmux.js", dataDir: '/d' })` 첫 줄이 `#!/bin/sh`이고 quote가 shell에서 안전하다(`sh -c` 대신 문자열 비교로 `'/n o/node'`, `'/a'\''b/bin/agentmux.js'` 확인).
    - `ensureDelegationAssets({ baseDir: tmp, nodePath: process.execPath, appDir: repoRoot })` 뒤 `tmp/bin/agentmux` mode가 0o700, `tmp/delegation/claude.md` mode가 0o600이고 내용이 `buildDelegationGuide('claude')`와 같다. 두 번 불러도 mtime이 바뀌지 않는다.
    - shim 실행 확인: `execFile(tmp/bin/agentmux, ['help'], { env: { ...cleanEnv, NO_UPDATE_NOTIFIER: '1' } })`가 exit 0이고 stdout에 `tab create`가 있다(`bin/cli.js` help가 서버 없이 동작한다. `cleanEnv`는 `tests/unit/bin/cli-env.test.ts`의 `buildCleanCliEnv`와 같은 규칙).
    - `buildDelegationEnvPrefix({ workspaceId: 'ws-1', tabId: 'tab-1', shimDir: '/d/bin' })` === `AMUX_WORKSPACE_ID='ws-1' AMUX_TAB_ID='tab-1' PATH='/d/bin':"$PATH" `.
  - `config-api.test.ts`: `agentDelegationGuideEnabled: false` PATCH가 저장되고, `'no'` 같은 문자열은 400이다.
- [ ] **Step 2: Run** `corepack pnpm vitest run tests/unit/lib/delegation-guide.test.ts tests/unit/pages/config-api.test.ts` → FAIL
- [ ] **Step 3: Implement** — `ensureHookSettings` 끝에서 `ensureDelegationAssets({ baseDir })`를 부른다(실패하면 log warn만, 서버 시작은 계속).
- [ ] **Step 4: Run** 위 test + `tsc --noEmit` → PASS
- [ ] **Step 5: Commit** — `feat(delegation): add the delegation guide, its setting, and the CLI shim`

---

### Task 2: 실행 명령에 환경 변수, 안내, `permissions.allow`

**Files:**
- Create: `src/lib/providers/codex/developer-instructions.ts`
- Modify: `src/lib/claude-command.ts`, `src/lib/providers/claude/tab-settings.ts`, `src/lib/providers/claude/index.ts:46-56`, `src/lib/codex-command.ts`, `src/lib/providers/codex/index.ts:34-55`, `src/lib/providers/types.ts:6-18` (`cwd` 추가), `src/lib/agent-launch-service.ts:58-62` (`cwd` 전달), `package.json`(`smol-toml`)
- Test: `tests/unit/lib/claude-command.test.ts`, `tests/unit/lib/codex-command.test.ts`, `tests/unit/lib/claude-tab-settings.test.ts`, `tests/unit/lib/codex-developer-instructions.test.ts`(create), `tests/unit/lib/agent-launch-service.test.ts`

**Interfaces:**
- Consumes: Task 1의 `isDelegationGuideEnabled`, `buildDelegationGuide`, `getClaudeDelegationGuidePath`, `getDelegationShimDir`, `buildDelegationEnvPrefix`.
- Produces:
  - `IAgentLaunchCommandOptions`·`IAgentResumeCommandOptions`에 `cwd?: string`. `launchAgentInTab`은 `await getSessionCwd(tab.sessionName) ?? tab.cwd`를 넘긴다(v1 탭만, v2는 `tab.cwd`).
  - `IClaudeCommandOptions`에 `envPrefix?: string`, `appendSystemPromptFile?: string`. 명령: `<envPrefix>claude --settings <q> --session-id|--resume <id> [--append-system-prompt-file <q>] [--model <q>] [--permission-mode <m>]`. 두 값이 없으면 지금과 같은 문자열.
  - `writeClaudeTabSettings({ tabId, sessionName, nodePath?, allowDelegation?: boolean })` — `allowDelegation`이면 settings에 `permissions: { allow: CLAUDE_DELEGATION_ALLOW_RULES }`를 더한다. `export const CLAUDE_DELEGATION_ALLOW_RULES: readonly string[]` = `list`, `create`, `send`, `status`, `result`, `close` 6개 각각의 `Bash(agentmux tab <sub>:*)`. 구현 전 Claude Code `2.1.322` 문서(`code.claude.com/docs/en/settings.md`, permission rule 문법)로 prefix 규칙 문법을 확인하고, 문법이 다르면 문서 문법으로 바꾼 뒤 그 근거를 commit 본문에 적는다. `agentmux tab browser`가 어느 규칙에도 맞지 않아야 한다.
  - `ICodexCommandOptions`에 `envPrefix?: string`, `developerInstructions?: string`. 명령: `<envPrefix>codex <hook -c들> [-c 'developer_instructions=<TOML basic string>'] ...`. TOML 문자열은 `session-hooks.ts`의 `tomlString`(JSON.stringify)과 같은 방식, 전체는 `shellQuote`.
  - `src/lib/providers/codex/developer-instructions.ts`:
    - `export type TCodexInstructionsRead = { ok: true; value: string | null } | { ok: false; reason: 'parse-error' | 'ambiguous'; detail: string }`
    - `export const readCodexDeveloperInstructions = (input: { cwd: string; codexHome?: string }): Promise<TCodexInstructionsRead>` — Rulings의 세 단계. 파일이 없으면 그 단계는 건너뛴다. `codexHome` 기본은 `process.env.CODEX_HOME ?? ~/.codex`.
    - `export const mergeCodexDeveloperInstructions = (existing: string | null, guide: string): string` → existing이 있으면 `${existing}\n\n${guide}`.
  - Provider 동작:
    - Claude `IClaudeTabIdentity`(`src/lib/providers/claude/index.ts:37`)에 `workspaceId?`, `cwd?`를 더해 `buildLaunchCommand`·`buildResumeCommand`의 options를 그대로 넘긴다.
    - Claude `readClaudeCommandOptions`: 설정이 켜져 있으면 `writeClaudeTabSettings({ ..., allowDelegation: true })`, `appendSystemPromptFile: getClaudeDelegationGuidePath()`, `envPrefix: buildDelegationEnvPrefix({ workspaceId, tabId, shimDir })`. `workspaceId`가 없으면(옛 호출) 환경 변수와 안내를 넣지 않는다.
    - Codex `readLaunchOptions`: 설정이 켜져 있고 `workspaceId`·`tabId`·`cwd`가 있으면 `envPrefix`를 붙이고, `readCodexDeveloperInstructions`가 `ok`이면 `developerInstructions = merge(value, buildDelegationGuide('codex'))`. `ok: false`이면 `developerInstructions`는 넣지 않고 `log.warn('codex developer_instructions <reason>: delegation guide skipped')`. 환경 변수는 그래도 붙인다.
- [ ] **Step 1: Write the failing tests**
  - `claude-command.test.ts`:
    - "disabled": `envPrefix`·`appendSystemPromptFile` 없이 만든 launch·resume 명령이 단계 3 기대 문자열과 같다(기존 case 유지).
    - 두 값이 있으면 명령이 `AMUX_WORKSPACE_ID='ws-1' ` 로 시작하고 `--append-system-prompt-file '/d/delegation/claude.md'`가 `--session-id <uuid>` 뒤에 온다.
  - `claude-tab-settings.test.ts`: `allowDelegation: true`이면 `permissions.allow`가 `CLAUDE_DELEGATION_ALLOW_RULES`와 같고, 각 규칙이 `tab browser`를 포함하지 않으며 `Bash(agentmux:*)`·`Bash(agentmux tab:*)` 같은 넓은 규칙이 없다. `false`이면 `permissions` key가 없다.
  - `codex-command.test.ts`: "disabled" case는 기존 문자열 그대로. `developerInstructions: "a'b\nc"`이면 `-c 'developer_instructions="a'\''b\nc"'`가 hook `-c` 뒤, `resume` 앞에 온다(resume 명령도 확인).
  - `codex-developer-instructions.test.ts`(임시 CODEX_HOME, 임시 project tree):
    - 파일 없음 → `{ ok: true, value: null }`.
    - user config에만 값 → 그 값. `profile = "p"`와 `[profiles.p] developer_instructions = "x"`만 있음 → `"x"`.
    - user와 project에 같은 값 → 그 값(서로 다른 값이 1개). 다른 값 → `{ ok: false, reason: 'ambiguous' }`.
    - 깨진 TOML → `{ ok: false, reason: 'parse-error' }`.
    - project 파일은 cwd의 상위 directory에서도 찾는다.
  - `agent-launch-service.test.ts`: v1 탭 launch에서 provider `buildLaunchCommand`가 `cwd`(mock `getSessionCwd` 값)를 받는다. 설정이 켜진 Claude 탭의 보낸 명령에 `AMUX_TAB_ID='<tabId>'`가 있고, 꺼지면 없다.
- [ ] **Step 2: Run** 위 test → FAIL
- [ ] **Step 3: Implement** — `corepack pnpm add smol-toml`.
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/providers/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(delegation): pass the tab context and guide to launched Claude Code and Codex`

---

### Task 3: Runtime v2 terminal 화면 캡처와 session 확인

**Files:**
- Modify: `src/lib/runtime/ipc.ts:818-824` (`terminal.capture-pane`), `src/lib/runtime/terminal/terminal-runtime-contract.ts:56-59`, `src/lib/runtime/terminal/terminal-worker-runtime.ts:253-262`, `src/lib/runtime/terminal/windows-terminal-runtime.ts:172`, `src/lib/runtime/terminal/terminal-worker-service.ts:202-205`, `src/lib/runtime/supervisor.ts:161,1566-1573` (interface와 구현)
- Test: `tests/unit/lib/runtime/terminal-worker-runtime.test.ts`, `tests/unit/lib/runtime/terminal-worker-service.test.ts`, `tests/unit/lib/runtime/ipc.test.ts`, supervisor test(기존 `writeTerminalSession` test가 있는 파일)

**Interfaces:**
- Produces:
  - IPC `'terminal.capture-pane'`: payload `runtimeTerminalSessionSchema`, reply `runtimeTerminalSessionSchema.extend({ content: z.string() })`.
  - Runtime contract `capturePane(sessionName: string): Promise<{ sessionName: string; content: string }>`. tmux 구현은 `tmux -L <RUNTIME_TMUX_SOCKET> capture-pane -p -t <session>`(legacy `capturePaneContent`와 같은 flag), session이 없으면 `runtime-v2-terminal-session-not-found`. Windows 구현은 `runtime-v2-terminal-capture-unsupported` 오류.
  - Supervisor:
    - `captureTerminalSession(input: { sessionName: string }): Promise<{ sessionName: string; content: string }>` — `assertReadyTerminalSession` 뒤 `terminal.capture-pane`.
    - `hasTerminalSession(input: { sessionName: string }): Promise<boolean>` — storage에 ready 탭이 없거나 `terminal.has-session`이 false/not-found면 false.
- [ ] **Step 1: Write the failing tests** — worker runtime: 임시 `TMUX_TMPDIR`의 runtime socket에 session을 만들고 `printf` 출력 뒤 `capturePane`이 그 글자를 담는다, 없는 session은 not-found code. Worker service: `terminal.capture-pane` 명령이 runtime으로 전달되고 reply가 schema를 통과한다. Supervisor: ready 탭이면 capture 요청을 보내고, ready 탭이 없으면 `hasTerminalSession`이 false다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/runtime/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(runtime): capture Runtime v2 terminal screens through the supervisor`

---

### Task 4: `createdByTabId`, storage schema v6, active 탭 유지

**Files:**
- Modify: `src/types/terminal.ts:16-36` (`ITab.createdByTabId?: string | null`), `src/lib/layout-store.ts:317-381` (`addTabToPane`, `addExistingTabToPane` options), `src/lib/runtime/storage/schema.ts:22,264-` (v6 migration), `src/lib/runtime/storage-import.ts:261-280` (tab upsert), `src/lib/runtime/storage/repository.ts:120-130,620-665` (row type, layout projection)
- Test: `tests/unit/lib/layout-store-add-tab.test.ts`(create, 임시 data dir), `tests/unit/lib/runtime/storage-schema-migration.test.ts`, `tests/unit/lib/runtime/storage-import.test.ts`, `tests/unit/lib/runtime/storage-repository.test.ts`

**Interfaces:**
- Produces:
  - `export interface IAddTabOptions { activate?: boolean; createdByTabId?: string | null }`
  - `addTabToPane(wsId, paneId, name?, cwd?, panelType?, command?, options?: IAddTabOptions)`, `addExistingTabToPane(wsId, paneId, tab, options?: IAddTabOptions)` — `activate`가 `false`이면 `pane.activeTabId`와 `layout.activePaneId`를 바꾸지 않는다. 기본 true(지금 동작). `createdByTabId`가 있으면 탭에 기록한다.
  - `CURRENT_RUNTIME_SCHEMA_VERSION = 6`, migration v6: `alter table tabs add column created_by_tab_id text null`.
  - Import는 `tab.createdByTabId ?? null`을 `created_by_tab_id`에 쓴다(insert와 `on conflict` update 모두). Repository layout projection은 값이 있을 때만 `createdByTabId`를 붙인다.
- [ ] **Step 1: Write the failing tests**
  - `layout-store-add-tab.test.ts`: 탭 1개 pane에 `{ activate: false, createdByTabId: 'tab-a' }`로 더하면 `activeTabId`가 그대로이고 새 탭에 `createdByTabId: 'tab-a'`가 있다. option 없이 더하면 지금처럼 새 탭이 active다. `layout-store`를 import하기 전에 `AGENTMUX_DATA_DIR`을 임시 directory로 두고(`vi.resetModules` 뒤 dynamic import) 끝나면 지운다. 기존 `layout-store.test.ts`처럼 실제 data dir에 directory를 남기면 안 된다. tmux는 `createSession`·`sendKeys` mock.
  - `storage-schema-migration.test.ts`: v5 DB fixture(기존 test의 v5 생성 helper 재사용)를 열면 v6가 되고 `tabs.created_by_tab_id` column이 있으며, migration 전 backup directory 이름이 `runtime-v2-migration-v5-v6-`로 시작한다.
  - `storage-import.test.ts`: `createdByTabId`가 있는 layout을 import하면 column에 저장되고, 다시 import할 때 값이 바뀌면 갱신된다. 필드가 없는 기존 layout은 `null`.
  - `storage-repository.test.ts`: `getWorkspaceLayout`이 `createdByTabId`를 돌려주고, null이면 key가 없다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/runtime/` + `tests/unit/lib/layout-store*.test.ts` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(layout): record which tab created a tab and keep the active tab for delegated tabs`

---

### Task 5: 공용 탭 서비스와 화면 route 정리

**Files:**
- Create: `src/lib/workspace-tab-service.ts`
- Modify: `src/pages/api/layout/pane/[paneId]/tabs/index.ts` (만들기 logic을 서비스로 옮김), `src/pages/api/layout/pane/[paneId]/tabs/[tabId]/index.ts:27-40` (DELETE를 서비스로 옮김), `src/lib/tmux.ts:344-360` (bracketed paste byte 생성 함수 export)
- Test: `tests/unit/lib/workspace-tab-service.test.ts`(create), `tests/unit/pages/layout-tabs-api.test.ts`(기존 case 그대로 통과), `tests/unit/pages/layout-tab-patch-api.test.ts`

**Interfaces:**
- Consumes: Task 3 supervisor `captureTerminalSession`, `hasTerminalSession`. Task 4 `IAddTabOptions`.
- Produces (`src/lib/workspace-tab-service.ts`):
  - `export interface ICreateWorkspaceTabInput { workspaceId: string; paneId: string; name?: string; cwd?: string; panelType?: TPanelType | null; command?: string; resumeSessionId?: string; startAgent?: boolean; activate?: boolean; createdByTabId?: string | null }`
  - `export const createWorkspaceTab = (input: ICreateWorkspaceTabInput): Promise<ITab | null>` — 지금 화면 route의 규칙 그대로: plain terminal은 terminal v2 mode면 v2 탭, agent 탭은 v1 + workspace cwd 기본값, status 등록(live/manager), resume·startAgent는 `SHELL_READY_DELAY_MS` 뒤 `launchAgentInTab`(fire-and-forget, 지금과 같음). 입력 검증(resume panel type, session id 형식)은 route에 남긴다.
  - `export const launchAgentAfterShellReady = (input: { workspaceId: string; paneId: string; tabId: string }): Promise<IAgentLaunchResult>` — 0.5초 기다린 뒤 `launchAgentInTab({ action: 'launch' })`를 await한다(CLI create가 결과를 받는 경로).
  - `export const closeWorkspaceTab = (workspaceId: string, paneId: string, tabId: string): Promise<boolean>` — `removeTabFromPane` + status 항목 제거(live면 `removeStatusLiveTab`, 아니면 `getStatusManager().removeTab`).
  - `export const readTabCliState = (tab: ITab): Promise<TCliState | null>` — status live면 `getRuntimeSupervisor().requestStatusLiveSync()`의 `tabs[tab.id]?.cliState`, 아니면 `getStatusManager().getAllForClient()[tab.id]?.cliState`. 둘 다 없으면 `tab.cliState ?? null`.
  - `export const isTabSessionAlive = (tab: ITab): Promise<boolean>` — v2면 `hasTerminalSession`, v1이면 `hasSession`.
  - `export const readTabScreen = (tab: ITab): Promise<string | null>` — v2면 `captureTerminalSession`(Runtime v2가 꺼져 있거나 오류면 null), v1이면 `capturePaneContent`.
  - `export const writeTabInput = (tab: ITab, content: string): Promise<void>` — v1은 `sendBracketedPaste`, v2는 `writeTerminalSession({ sessionName, data: buildBracketedPaste(content) + '\r' })`. `buildBracketedPaste(content) = '\x1b[200~' + content + '\x1b[201~'`을 `tmux.ts`에서 export해 두 경로가 같은 byte를 쓴다.
  - `export const readLastAssistantMessage = (tab: ITab): Promise<{ text: string; timestamp: number } | null>` — agent 탭만. `provider.readJsonlPath(tab)`가 없으면 `provider.readSessionId(tab)` + `provider.resolveJsonlPath(sessionId, tab.cwd)`. `provider.readTailEntries(path, 50)`에서 마지막 `assistant-message`의 `markdown`과 `timestamp`. 파일이 없으면 null.
  - `export const findTabInAnyWorkspace = (tabId: string): Promise<ITabLocation | null>` (`cli-utils.ts`의 `ITabLocation`).
  - `export const countDelegatedTabs = (workspaceId: string): Promise<number>`
  - `export const AGENT_READY_TIMEOUT_MS = 60_000`, `export const AGENT_READY_POLL_MS = 500`
  - `export const waitForAgentReady = (tab: ITab, options?: { timeoutMs?: number; pollMs?: number }): Promise<boolean>` — `readTabCliState(tab) === 'idle'`이면 true, 시간이 지나면 false.
- [ ] **Step 1: Write the failing tests** — `workspace-tab-service.test.ts`(layout-store, tmux, supervisor, status manager mock):
  - `readTabCliState`: status live mode면 supervisor sync 값, 아니면 status manager 값, 둘 다 없으면 `tab.cliState`.
  - `writeTabInput`: v1 탭은 `sendBracketedPaste`, v2 탭은 `writeTerminalSession`에 `'\x1b[200~hi\x1b[201~\r'`.
  - `readTabScreen`: v2 탭은 supervisor capture, 오류면 null.
  - `readLastAssistantMessage`: 합성 Claude JSONL(user → assistant 2개)에서 마지막 assistant `markdown`을 돌려준다. Codex 합성 rollout에서도 같다. JSONL이 없으면 null.
  - `waitForAgentReady`: 상태가 3번째 poll에서 `idle`이 되면 true, `{ timeoutMs: 50, pollMs: 10 }`에서 계속 `inactive`면 false.
  - `closeWorkspaceTab`: status live mode면 `removeStatusLiveTab`, 아니면 `removeTab`이 불린다.
  - `createWorkspaceTab({ activate: false, createdByTabId })`가 `addTabToPane`에 options를 넘긴다. plain terminal + terminal v2 mode는 v2 경로로 간다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement** — 화면 route 두 곳은 서비스 호출로 바꾸고 응답 shape는 그대로 둔다.
- [ ] **Step 4: Run** 위 test + `tests/unit/pages/layout-tab*.test.ts` + tsc → PASS
- [ ] **Step 5: Commit** — `refactor(tabs): share tab creation, closing, input, and screen reads between the UI and the CLI`

---

### Task 6: CLI API 동작 변경

**Files:**
- Create: `src/lib/cli-caller.ts`
- Modify: `src/pages/api/cli/tabs/index.ts`, `src/pages/api/cli/tabs/[tabId]/index.ts`, `src/pages/api/cli/tabs/[tabId]/send.ts`, `src/pages/api/cli/tabs/[tabId]/status.ts`, `src/pages/api/cli/tabs/[tabId]/result.ts`, `src/pages/api/cli/api-guide.ts`
- Test: `tests/unit/pages/cli-tabs-create-api.test.ts`, `cli-tabs-send-api.test.ts`, `cli-tabs-status-result-api.test.ts`, `cli-tabs-close-api.test.ts`(모두 create, 서비스·layout-store mock)

**Interfaces:**
- Consumes: Task 5 서비스 전부, Task 4 `createdByTabId`, `hasPermissionPrompt`(`src/lib/permission-prompt.ts:381`), `matchTrustPrompt`(`src/lib/trust-prompt-detector.ts:81`), `getCachedRuntimePreflight`.
- Produces:
  - `src/lib/cli-caller.ts`: `export const CALLER_TAB_HEADER = 'x-agentmux-caller-tab'`, `export const resolveCliCaller = (req: NextApiRequest): Promise<{ ok: true; caller: ITabLocation | null } | { ok: false; status: 404; code: 'caller-tab-not-found' }>` — header가 없으면 `caller: null`.
  - `export const DELEGATION_TAB_LIMIT = 6`(`cli-caller.ts`). 준비 대기는 Task 5의 `waitForAgentReady`를 쓰고, test는 서비스 mock으로 대기 결과(true/false)를 정한다.
  - `POST /api/cli/tabs` body `{ workspaceId, name?, panelType?, cwd? }`:
    - `panelType`은 `terminal | codex | claude | web-browser | diff`. 다른 값은 400 `invalid-panel-type`.
    - 호출 탭이 있으면: 개수 제한(409 `delegation-limit`), pane·cwd는 Rulings대로, `activate: false`, `createdByTabId: caller.tab.id`. 없으면 지금처럼 첫 pane, workspace 첫 directory, active로 만든다.
    - Agent 종류면 preflight 확인(409 `agent-unavailable`) → `createWorkspaceTab`(startAgent 없이) → `launchAgentAfterShellReady` → 실패 code가 있으면 응답에 `launchError`, 성공이면 `cliState === 'idle'`까지 대기.
    - 응답 201 `{ tabId, workspaceId, paneId, sessionName, name, panelType, createdByTabId, ready }`. terminal·web-browser·diff는 `ready: true`.
  - `POST /api/cli/tabs/<id>/send`:
    - Agent 탭: `readTabCliState`가 `needs-input`이면 409 `target-needs-input`, `idle | busy | ready-for-review`가 아니면 409 `target-not-ready`. 허용 상태여도 `readTabScreen`에 `hasPermissionPrompt`가 true면 409 `target-needs-input`, `matchTrustPrompt`가 있으면 409 `target-not-ready`. 화면을 못 읽으면(null) 보내지 않고 409 `target-not-ready`.
    - 살아 있지 않은 session은 지금처럼 409 `Tab session is not running`.
    - 통과하면 `writeTabInput`. 응답 `{ status: 'sent', cliState }`.
    - Terminal 탭(v1·v2)은 상태 검사 없이 `writeTabInput`.
  - `GET /api/cli/tabs/<id>/status` → `{ tabId, workspaceId, panelType, providerId, alive, command, cliState, agentSessionId, createdByTabId }`. `providerId`는 agent 탭이면 provider id, 아니면 null. v2 탭의 `command`는 null.
  - `GET /api/cli/tabs/<id>/result` → agent 탭은 `{ tabId, panelType, cliState, lastAssistantMessage, content }`(`content`는 화면, 없으면 null). Terminal 탭은 `{ content }`(v2는 supervisor capture). 살아 있지 않은 session은 지금처럼 409.
  - `DELETE /api/cli/tabs/<id>`: 호출 탭이 있고 대상의 `createdByTabId !== caller.tab.id`면 403 `delegation-close-forbidden`. 통과하면 `closeWorkspaceTab`.
  - `GET /api/cli/tabs` 항목에 `createdByTabId`(없으면 null)와 `runtimeVersion`을 더한다.
  - `api-guide.ts`: 위 동작, 새 오류 code, `x-agentmux-caller-tab` header를 적는다.
- [ ] **Step 1: Write the failing tests**
  - create: 호출 탭 header가 있으면 호출 탭 pane에 `activate: false`, `createdByTabId`로 만든다. 다른 workspace를 `workspaceId`로 주면 그 workspace 첫 pane이다. 위임 탭 6개면 409 `delegation-limit`이고 `createWorkspaceTab`이 불리지 않는다. 없는 caller는 404 `caller-tab-not-found`. agent 미설치는 409 `agent-unavailable`이고 탭을 만들지 않는다. `waitForAgentReady`가 true면 `ready: true`, false면 `ready: false`. launch 실패면 `launchError`가 있고 대기하지 않는다. `--cwd`가 없는 directory면 400 `invalid-cwd`. header가 없으면 지금처럼 첫 pane·active.
  - send: `needs-input` → 409 `target-needs-input`, `inactive`·null → 409 `target-not-ready`, `busy`인데 화면에 권한 요청 fixture(`tests/unit/lib/permission-prompt.test.ts`의 합성 화면 재사용) → 409 `target-needs-input`, trust 화면 → 409 `target-not-ready`. 이 모든 case에서 `writeTabInput`이 한 번도 불리지 않는다. `idle` + 빈 화면 → 200 `sent`. v2 terminal 탭 → 상태 검사 없이 `writeTabInput`.
  - status/result: agent 탭 응답 필드 전체, v2 terminal 탭 result가 supervisor capture를 쓴다.
  - close: 호출 탭이 만든 탭은 닫힌다. 사용자 탭·다른 탭이 만든 탭·호출 탭 자신은 403 `delegation-close-forbidden`. header 없으면 제한 없음.
  - Runtime v2 status live mode와 legacy status manager mode 두 경우로 create·send를 한 번씩 돈다(인수 기준 11).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/pages/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(cli): delegate safely through the tab API`

---

### Task 7: CLI client

**Files:**
- Modify: `bin/cli.js`
- Test: `tests/unit/bin/cli-env.test.ts`(기존 fake server 방식으로 case 추가) 또는 `tests/unit/bin/cli-tab-commands.test.ts`(create)

**Interfaces:**
- Consumes: Task 6 API와 오류 형식, `CALLER_TAB_HEADER` 값(`x-agentmux-caller-tab`, CommonJS라 문자열로 둔다).
- Produces:
  - 모든 `tab` 하위 명령: `-w`가 없으면 `AMUX_WORKSPACE_ID`, 둘 다 없으면 지금처럼 `--workspace is required`(단 `tab list`는 workspace 없이 전체).
  - `AMUX_TAB_ID`가 있으면 모든 요청(browser 포함)에 `x-agentmux-caller-tab` header.
  - `tab create`: `-t`에 `claude` 허용(help 문구), `--cwd DIR`을 body `cwd`로. 
  - 오류 출력: 응답 body에 `message`가 있으면 `error: <error>: <message>`, 없으면 지금처럼 `error: <error>`. exit code 1.
  - help: 위 변경과 환경 변수 설명(`AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`)을 더한다.
- [ ] **Step 1: Write the failing tests** — fake HTTP server가 받은 요청을 기록한다:
  - `AMUX_WORKSPACE_ID=ws-1 AMUX_TAB_ID=tab-1`로 `tab create -t claude --cwd /tmp`를 실행하면 POST body가 `{ workspaceId: 'ws-1', panelType: 'claude', cwd: '/tmp' }`이고 header `x-agentmux-caller-tab: tab-1`이 있다.
  - 환경 변수 없이 `tab send TAB hello`는 `--workspace is required`로 exit 1.
  - 서버가 409 `{ error: 'target-needs-input', message: 'x' }`를 주면 stderr가 `error: target-needs-input: x`이고 exit 1.
  - `AMUX_TAB_ID`가 없으면 caller header가 없다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** `tests/unit/bin/` → PASS
- [ ] **Step 5: Commit** — `feat(cli): read the tab context from the environment`

---

### Task 8: 설정 토글과 위임 탭 표시

**Files:**
- Modify: `src/hooks/use-config-store.ts` (`agentDelegationGuideEnabled`, 기본 true, setter), `src/components/features/workspace/settings-dialog.tsx:101-205` (`GeneralTab`에 switch), `src/components/features/workspace/pane-tab-item.tsx`, `src/components/features/mobile/mobile-workspace-tab-bar.tsx`, `messages/ko/settings.json`, `messages/en/settings.json`, `messages/ko/workspace.json`, `messages/en/workspace.json`
- Test: `tests/unit/hooks/use-config-store.test.ts`(있으면 갱신), `tests/unit/components/pane-tab-item.test.tsx`(있으면 갱신, 없으면 create), `tests/unit/messages/*` key 일치 test(기존)

**Interfaces:**
- Consumes: Task 1 config key, Task 4 `ITab.createdByTabId`.
- Produces:
  - 설정 일반 탭 switch "Agent에 위임 안내 넣기"(en "Give agents the delegation guide"). 설명: "켜면 agentmux가 띄운 Claude Code와 Codex가 `agentmux tab` 명령으로 다른 탭에 일을 맡길 수 있습니다. 새로 시작하거나 재개하는 agent부터 적용됩니다."(en: "When on, Claude Code and Codex started by agentmux can hand work to other tabs with `agentmux tab`. Applies to agents started or resumed after the change.")
  - 탭 항목: `tab.createdByTabId`가 있으면 이름 앞에 lucide `CornerDownRight` icon(aria-hidden)과 screen reader용 text "Agent가 만든 탭"(en "Created by an agent"), `title`에 만든 탭 이름(같은 workspace에서 찾으면 "<이름>이 만든 탭", 못 찾으면 "Agent가 만든 탭"). 모바일 탭 bar도 같은 icon과 label.
- [ ] **Step 1: Write the failing tests** — store 기본값 true와 저장 호출, 탭 항목이 `createdByTabId`가 있을 때만 icon과 label을 그린다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/messages/` + lint + tsc → PASS. 데스크톱과 360px에서 탭 이름이 잘리지 않는지 browser로 확인(Task 9 화면 확인에 포함 가능).
- [ ] **Step 5: Commit** — `feat(ui): add the delegation guide setting and mark tabs created by agents`

---

### Task 9: 문서, ADR, gate, 격리 live 확인

**Files:**
- Create: `docs/CLI.md`(지금 CLI 문서가 없다. `docs/README.md` 문서 목록에 연결)
- Modify: `docs/ADR.md`(ADR-035, ADR-036, ADR-037을 Accepted로 추가. 셋 다 아직 없다. 마지막은 ADR-034), `docs/README.md`, `docs/FOLLOW-UP.md`, `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`
- Scratch(commit하지 않음): 격리 확인 script는 scratchpad에 둔다.

**Interfaces:**
- Consumes: Task 1~8 전부.
- Produces: 문서와 확인 기록.

- [ ] **Step 1: 문서**
  - ADR-035: agentmux는 사용자 agent 설정을 고치지 않고 실행 시점 flag(`--settings`, `--append-system-prompt-file`, `-c`)와 탭 환경 변수로만 hook·안내를 붙인다.
  - ADR-036: 위임은 확인 없이 진행하고 agentmux가 띄운 Claude Code에서 `agentmux tab` 하위 명령 6개를 미리 허용한다. 신뢰 경계는 Unix 사용자이고 CLI 제한은 실수 방지 장치다.
  - ADR-037: Runtime v2 agent 지원 전까지 agent 탭은 legacy tmux adapter(Runtime v1)로 만든다(단계 1에서 구현, 문서 기록만).
  - `docs/CLI.md`: 명령 목록(`workspaces`, `tab list/create/send/status/result/close/browser`), 환경 변수(`AMUX_PORT`, `AMUX_TOKEN`, `AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, `AGENTMUX_DATA_DIR`), 그리고: 환경 변수, 새 오류 code, `tab create` 대기, 위임 제한, Codex sandbox(`workspace-write`는 local network를 막아 위임 불가), `shell_environment_policy`가 `core`/`none`이면 호출 탭을 모른다는 한계.
  - Handoff 배포 절: Runtime v2 schema v6 migration과 rollback 절차 — service를 멈추고, `<dataDir>/backups/runtime-v2-migration-v5-v6-<시각>/`의 `state.db`(와 있으면 `-wal`, `-shm`)를 `<dataDir>/runtime-v2/`로 되돌린 뒤 이전 build를 시작한다. 이전 build는 v6 DB를 열지 못하므로 이 순서가 필수다.
- [ ] **Step 2: 전체 gate** — `check:project-design`, `check:product-name`, lint(error 0), `tsc --noEmit`, 임시 `TMUX_TMPDIR`로 전체 test, `pnpm build`.
- [ ] **Step 3: 격리 live 확인**(단계 3과 같은 안전 규칙: 이 worktree production build, `env -i` 허용 목록, 임시 `AGENTMUX_DATA_DIR`, 짧은 임시 `TMUX_TMPDIR`, port 18122, live와 같은 Runtime v2 mode, `INIT_PASSWORD`, setup POST에 `Origin` header). Claude prompt는 4개 이하, Codex prompt는 2개 이하. 브라우저는 열지 않는다(인수 기준 10).
  1. API로 Claude 탭(`startAgent`)을 만든다. Claude에게 "Run `agentmux tab create -t codex -n helper`, then `agentmux tab send <tabId> \"Reply with the single word OK\"`, wait until `agentmux tab status <tabId>` shows ready-for-review or idle, then run `agentmux tab result <tabId>` and tell me the lastAssistantMessage." 를 보낸다. 확인: 권한 확인 화면 없이 CLI가 실행됨, Codex 탭이 Claude 탭과 같은 pane·같은 cwd에 생김, active 탭이 바뀌지 않음, `createdByTabId`가 Claude 탭 id, Codex가 "OK"를 받음, Claude가 결과를 읽음.
  2. 직접 CLI(호출 탭 header 없이, shim 경로 사용)로 확인: 위임 탭 6개 상태에서 Claude 탭 id를 `AMUX_TAB_ID`로 준 `tab create`가 `delegation-limit`, Claude 탭 id로 사용자 탭 `tab close`가 `delegation-close-forbidden`, needs-input 대상(Claude에게 파일 쓰기를 요청해 권한 요청을 띄운 탭) `tab send`가 `target-needs-input`이고 화면에 글자가 늘지 않음(전후 capture 비교).
  3. 화면에서 만든 Runtime v2 plain terminal 탭에 `tab send "echo p4-ok"`, `tab result`에 `p4-ok`, `tab status`의 `alive: true`.
  4. 설정을 끄고 새 Claude 탭을 시작하면 tmux 화면에 보낸 명령에 `AMUX_`와 `--append-system-prompt-file`이 없다.
  5. Legacy mode(`AGENTMUX_RUNTIME_V2` 없음) 격리 server에서 1의 위임 흐름을 한 번 더 확인한다(Claude prompt 1개, 인수 기준 11). Prompt 한도를 넘으면 unit test(Task 6의 두 mode)로 대신하고 기록한다.
  6. 안전 확인: 전후 `~/.claude/settings.json`, `~/.codex/config.toml` sha256, live tmux session 목록, `agentmux.service` MainPID가 같다. 격리 server와 tmux server, 임시 directory를 정리한다.
- [ ] **Step 4: 기록** — 결과를 handoff의 단계 4 절과 `docs/FOLLOW-UP.md`에 적는다(screenshot은 commit하지 않음).
- [ ] **Step 5: Commit** — `docs: record the delegation guide, CLI changes, and their checks`
