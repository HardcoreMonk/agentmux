# Claude Code Provider 단계 4: 위임 안내와 CLI 변경 Implementation Plan

> **For agentic workers:** 구현은 Herdr pane의 agy가 task 단위로 맡고(agy 한도가 없을 때는 Claude subagent), Claude가 task마다 diff·test로 검증하고 독립 검토를 돌린다(사용자 결정 2026-11-10). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** agentmux가 띄운 Claude Code와 Codex가 `agentmux tab` CLI 사용법을 알고, 브라우저 없이 다른 탭을 만들어 일을 맡기고 결과를 읽을 수 있게 한다. CLI는 준비 전·입력 대기 중인 대상에 글자를 보내지 않고, agent가 만든 탭의 개수와 닫기를 제한한다.

**Architecture:** 실행 명령 앞에 탭 환경 변수(`AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, data dir shim을 앞에 붙인 `PATH`)를 붙이고, provider별 고정 안내를 Claude는 `--append-system-prompt-file`, Codex는 `-c developer_instructions=`로 넣는다. CLI API는 화면 route와 같은 탭 서비스(`src/lib/workspace-tab-service.ts`)를 거쳐 탭을 만들고 닫으며, 입력·화면 캡처는 탭의 `runtimeVersion`에 맞는 terminal 경로를 쓴다. 위임 관계는 탭의 `createdByTabId`로 기록하고 Runtime v2 storage(SQLite)에도 저장한다.

**Tech Stack:** TypeScript, Next.js Pages Router custom server, Runtime v2 workers(zod IPC), better-sqlite3, `smol-toml`(새 의존성), zustand, next-intl(ko/en), shadcn/ui, vitest, Node CLI(`bin/cli.js`, CommonJS).

**Spec:** `docs/superpowers/specs/2026-11-10-claude-code-provider-design.md` (2절 "실행과 탭 식별"의 `permissions.allow`·탭 환경 변수, 4절 "위임 안내 주입 (C)", "단계와 배포" 4번, 인수 기준 10·11·12·13, ADR 후보 ADR-035·036)

**Base:** main `5b29cb67`(단계 3 merge `ad32559d` + 배포 기록). 작업 branch `feat/claude-provider-phase4`, worktree `/data/projects/agentcode-zone/agentmux/.worktrees/claude-provider-phase4`.

**Plan review:** `docs/superpowers/reviews/2026-11-11-claude-code-provider-phase4-eng-review.md` (approve with changes → 15건 모두 반영). 아래 Rulings의 "보내기 직전 확인", "Runtime v2 입력", "위임 파일 생성 시점", "Codex cwd", "명령 길이", "개수 제한 동시성", "Runtime v2 꺼짐"과 rollback 방식이 그 결과다.

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
8. 브라우저가 붙지 않은 Runtime v2 terminal 탭에도 `tab send`가 닿는다 → Task 3 `terminal-worker-runtime.test.ts`(attach 없이 `sendText`).
9. `hooks.json`이 이미 있는 data dir(live 재시작)과 auto-resume에서도 Claude·Codex가 안내와 shim을 받는다 → Task 2 `claude-provider-launch.test.ts`, `codex-provider-launch.test.ts`.
10. 새 Codex 탭이 Codex를 띄우기 전에 `idle`로 바뀌어도 `tab create`가 `ready: true`를 돌려주지 않는다 → Task 5 `waitForAgentReady` test.

## Rulings (계획 작성 시 결정, 사용자 확인 불필요)

- **Codex 환경 변수 전달**: Codex `0.167.0` 기본 `shell_environment_policy`는 모든 변수를 넘기고 `*KEY*`, `*SECRET*`, `*TOKEN*`만 뺀다(binary 문자열 확인). `AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, `PATH`는 넘어간다. 그래서 Codex 안내에도 id를 넣지 않는다. 사용자가 `inherit = "core"`/`"none"`을 쓰면 CLI가 호출 탭을 모르므로 사용자가 직접 실행한 CLI처럼 동작한다(제한 없음, `-w` 필요). 이 한계는 문서에 적는다.
- **Codex `developer_instructions` 합치기**: 읽는 단계는 (a) `$CODEX_HOME/config.toml`(기본 `~/.codex/config.toml`)의 최상위 값, (b) 같은 파일의 최상위 `profile` 값이 가리키는 `[profiles.<name>]`의 값, (c) 탭 cwd부터 `/`까지 올라가며 찾은 `.codex/config.toml`의 최상위 값이다. (a)·(b)에서 비어 있지 않은 서로 다른 값이 0개면 안내만, 1개면 `<값>\n\n<안내>`, 2개 이상이면 어느 값이 적용될지 단정하지 않고 안내를 넣지 않는다(log warn). (c) project 단계는 값이 있는지만 본다. 하나라도 값이 있으면 안내를 넣지 않고(`project-defined`, log warn) project 값을 명령으로 옮기지 않는다. Codex는 trust된 project의 설정만 읽으므로, 옮기면 사용자의 trust 거절을 뒤집게 된다(Task 2 리뷰 뒤 controller ruling). Cwd를 올라가며 찾을 때 `$CODEX_HOME/config.toml` 자체는 project 단계로 보지 않는다. 어느 파일이든 TOML parse에 실패해도 안내를 넣지 않는다(log warn). 우선순위를 추정하지 않으므로 사용자 값을 덮어쓸 일이 없다.
- **TOML parser**: `smol-toml`(의존성 없는 TOML 1.0 parser)을 dependency로 더한다. 설치 시점의 최신 1.x를 쓰고 version은 lockfile로 고정한다.
- **호출 탭 전달**: CLI는 `AMUX_TAB_ID`가 있으면 모든 요청에 header `x-agentmux-caller-tab: <tabId>`를 붙인다. Server는 그 탭을 모든 workspace에서 찾고, 없으면 404 `caller-tab-not-found`를 돌려준다. 호출 탭이 있으면 "agent 호출"로 본다(위임 제한 적용).
- **위임 탭 위치**: 대상 workspace가 호출 탭의 workspace와 같으면 호출 탭의 pane에 만든다. 다르면(`-w`로 다른 workspace 지정) 대상 workspace의 첫 pane에 만든다. 두 경우 모두 `createdByTabId`를 기록하고 active 탭을 바꾸지 않는다.
- **위임 탭 cwd**: `--cwd`가 있으면 그 값(존재하는 directory여야 함, 아니면 400 `invalid-cwd`). 없으면 호출 탭의 현재 cwd(v1: `getSessionCwd`, 실패 시 `tab.cwd`), 호출 탭이 없거나 다른 workspace면 대상 workspace의 첫 directory.
- **개수 제한**: 대상 workspace layout에서 `createdByTabId`가 있는 탭 수가 6 이상이면 409 `delegation-limit`. 탭은 닫히면 layout에서 빠지므로 layout에 있는 것을 "살아 있는 것"으로 센다.
- **준비 판정**: `tab create -t claude|codex`는 탭을 만들고 0.5초 뒤 `launchAgentInTab`을 부른다(부르기 직전 시각이 `launchStartedAt`). 그 다음 탭 status 항목이 `cliState === 'idle'`이고 `lastEvent?.name === 'session-start'`이며 `lastEvent.at >= launchStartedAt`일 때까지 0.5초 간격으로 최대 60초 기다린다. `cliState`만 보면 안 된다. Codex status reconcile(`status-state-machine.ts:82-86`)은 Codex process가 뜨기 전에도 `inactive`를 `idle`로 바꾼다. Agent가 설치되지 않았으면(preflight) 탭을 만들기 전에 409 `agent-unavailable`.
- **보내기 직전 확인**(agent 탭): 상태 gate(`idle | busy | ready-for-review`) 뒤 (1) pane에서 agent process가 돌고 있어야 한다(`getSessionPanePid` + `provider.isAgentRunning`). 아니면 `target-not-ready`. (2) 화면에 권한 요청(`hasPermissionPrompt`)이 있으면 `target-needs-input`, 시작 화면(trust, Codex update 안내 "Update available!"/"Update now")이 있으면 `target-not-ready`. (3) 붙여 넣기와 첫 Enter 뒤 `sendBracketedPaste`가 0.6초 뒤 보내는 두 번째 Enter 전에 화면을 다시 읽고, 권한 요청·시작 화면이 떴으면 두 번째 Enter를 보내지 않는다(Anti-goal: 사용자 대신 승인 금지). `lastEvent`로 시작 여부를 보지 않는다. Server 재시작 뒤에는 기존 탭의 `lastEvent`가 비어 있어 멀쩡한 탭을 거절하게 되기 때문이다.
- **Runtime v2 입력**(spec과 다름): spec은 v2 terminal 탭 `send`에 supervisor `writeTerminalSession`을 쓰라고 했다. 하지만 이 경로는 browser가 붙인 PTY에만 쓴다(`terminal-worker-runtime.ts:261-265`, "session is not attached"). 브라우저 없이 동작해야 하므로(인수 기준 10) 새 IPC `terminal.send-text`(`tmux -L <runtime socket> send-keys -l`)를 쓴다. v2 탭은 plain terminal뿐이라 상태 검사 없이 붙여 넣기 + Enter 한 번이다.
- **위임 파일 생성 시점**: `ensureHookSettings`는 `hooks.json`이 같으면 일찍 return하고(`hook-settings.ts:132`), `autoResumeOnStartup`(`server.ts:501`)이 그보다 먼저 돈다. 그래서 shim과 Claude 안내 파일은 (a) `server.ts`에서 `autoResumeOnStartup` 전에 한 번, (b) 위임이 켜진 agent 실행 명령을 만들 때마다(내용이 같으면 쓰지 않음) 만든다. 그래도 안내 파일이 없으면 `--append-system-prompt-file`을 빼고 log warn.
- **Codex cwd**: auto-resume, timeline resume, workspace 생성 resume 경로는 `cwd`를 넘기지 않는다. Codex provider는 `options.cwd ?? await getSessionCwd(sessionName)`로 직접 찾는다. 환경 변수는 `workspaceId`·`tabId`만 있으면 붙인다. Cwd를 끝내 모르면 project config 단계를 읽을 수 없으므로 안내를 넣지 않는다(log warn). Provider의 `cwd`는 `ICodexCommandOptions.cwd`(`--cd`를 붙임)로 넘기지 않는다.
- **명령 길이**: tmux `send-keys` 한 인자는 약 16 KB를 넘으면 거절된다. 합친 Codex 명령이 12 KB(`CODEX_COMMAND_SAFE_BYTES = 12_288`)를 넘으면 `developerInstructions`를 빼고 log warn.
- **개수 제한 동시성**: 제한 확인과 탭 생성을 workspace별 in-process lock(`withDelegationLock(workspaceId, fn)`, `globalThis` guard) 안에서 한다. Claude Code는 Bash를 병렬로 부를 수 있다. CLI 요청은 모두 한 server process를 거치므로 이 lock으로 충분하다.
- **Runtime v2 꺼짐**: `AGENTMUX_RUNTIME_V2 !== '1'`이면 v2 탭은 살아 있지 않은 것으로 다룬다. 이때 supervisor를 부르지 않는다(worker를 띄우지 않음).
- **Agent 호출의 terminal 탭 보내기 금지**(사용자 결정 2026-11-11, branch 최종 검토 뒤): Claude Code는 `Bash(agentmux tab send:*)`와 `Bash(agentmux tab create:*)`를 미리 허용하므로, agent가 `tab create -t terminal` 뒤 `tab send`로 shell 명령을 Bash 권한 확인 없이 실행할 수 있었다(사용자의 기존 terminal 탭도 같음). 그래서 호출 탭이 있는 `tab send`는 agent 탭(`claude`, `codex`)에만 보내고, 다른 탭은 403 `delegation-send-forbidden`(아무것도 입력하지 않음)이다. 호출 탭이 없는 사람의 CLI는 그대로다. 고정 안내 문장의 `tab create` 줄에서 `|terminal`을 뺐다(위 Task 1 문장은 바뀐 문장). `tab create -t terminal`은 보내기 없이 무해하므로 호출 탭이 있어도 허용한다.
- **Runtime v2 storage**: 기본 mode(`AGENTMUX_RUNTIME_STORAGE_V2_MODE=default`, live 설정)에서는 layout을 SQLite에서 읽으므로 `createdByTabId`를 `tabs.created_by_tab_id` column(schema v6)에 저장한다. 이 migration 뒤에는 이전 build가 DB를 열지 못한다(새 schema version 거부). Rollback은 DB 안에서 schema를 내리는 방식을 기본으로 한다(Task 9). Migration 전 backup을 되돌리는 방식은 배포 뒤 쓴 SQLite 자료(탭, workspace, annotation, governance 기록)를 잃는다. 그 뒤 첫 layout 쓰기가 오래된 SQLite layout으로 현재 `layout.json`을 덮으므로 비상용으로만 둔다.

---

### Task 1: 위임 설정, 고정 안내, CLI shim

**Files:**
- Create: `src/lib/delegation-guide.ts`
- Modify: `src/lib/config-store.ts:15-43` (`IConfigData`), `src/pages/api/config.ts:13` (허용 key, boolean 검증), `src/lib/hook-settings.ts:100-110` (`writeIfChanged` export), `server.ts:501` (`autoResumeOnStartup` 전에 `ensureDelegationAssets`)
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
- agentmux tab create -t claude|codex [-n NAME] [--cwd DIR]   (prints tabId and ready; waits up to 60 seconds for the agent)
- agentmux tab send TAB_ID 'instruction'   (quote the instruction with single quotes so your shell does not expand backticks or $; use a heredoc for multi-line text)
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
- [ ] **Step 3: Implement** — `server.ts`에서 `autoResumeOnStartup` 전에 `await ensureDelegationAssets()`를 부른다(실패하면 log warn만, 서버 시작은 계속). `ensureHookSettings`에는 넣지 않는다(`hooks.json`이 같으면 일찍 return한다).
- [ ] **Step 4: Run** 위 test + `tsc --noEmit` → PASS
- [ ] **Step 5: Commit** — `feat(delegation): add the delegation guide, its setting, and the CLI shim`

---

### Task 2: 실행 명령에 환경 변수, 안내, `permissions.allow`

**Files:**
- Create: `src/lib/providers/codex/developer-instructions.ts`
- Modify: `src/lib/claude-command.ts`, `src/lib/providers/claude/tab-settings.ts`, `src/lib/providers/claude/index.ts:46-56`, `src/lib/codex-command.ts`, `src/lib/providers/codex/index.ts:34-55`, `src/lib/providers/types.ts:6-18` (`cwd` 추가), `src/lib/agent-launch-service.ts:58-62` (`cwd` 전달), `package.json`(`smol-toml`)
- Test: `tests/unit/lib/claude-command.test.ts`, `tests/unit/lib/codex-command.test.ts`, `tests/unit/lib/claude-tab-settings.test.ts`, `tests/unit/lib/codex-developer-instructions.test.ts`(create), `tests/unit/lib/claude-provider-launch.test.ts`(create), `tests/unit/lib/codex-provider-launch.test.ts`(create), `tests/unit/lib/agent-launch-service.test.ts`

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
    - 두 provider 모두 설정이 켜져 있고 `workspaceId`·`tabId`가 있으면 먼저 `await ensureDelegationAssets()`(내용이 같으면 쓰지 않음)를 부르고 `envPrefix: buildDelegationEnvPrefix({ workspaceId, tabId, shimDir: getDelegationShimDir() })`를 붙인다. `workspaceId`나 `tabId`가 없으면 환경 변수와 안내를 넣지 않는다.
    - Claude `readClaudeCommandOptions`: 위 조건이면 `writeClaudeTabSettings({ ..., allowDelegation: true })`와 `appendSystemPromptFile: getClaudeDelegationGuidePath()`. 안내 파일이 없으면(`ensureDelegationAssets` 실패) `appendSystemPromptFile`을 빼고 log warn.
    - Codex `readLaunchOptions`: 위 조건이면 `cwd = options.cwd ?? await getSessionCwd(sessionName)`. Cwd가 없으면 안내를 넣지 않는다(log warn). 있으면 `readCodexDeveloperInstructions`가 `ok`일 때 `developerInstructions = merge(value, buildDelegationGuide('codex'))`. `ok: false`이면 넣지 않고 `log.warn('codex developer_instructions <reason>: delegation guide skipped')`. 합친 명령이 `CODEX_COMMAND_SAFE_BYTES`(12_288 byte)를 넘으면 `developerInstructions`를 빼고 log warn. 환경 변수는 어느 경우에도 붙인다. Provider의 `cwd`는 `ICodexCommandOptions.cwd`로 넘기지 않는다(`--cd`가 붙으면 안 됨).
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
  - `claude-provider-launch.test.ts`(임시 data dir, config mock): 같은 내용의 `hooks.json`이 이미 있는 data dir에서 `buildResumeCommand(id, { workspaceId, tabId, sessionName })`(auto-resume과 같은 인자)를 부르면 shim과 안내 파일이 생기고 명령에 `--append-system-prompt-file`과 `AMUX_TAB_ID=`가 있다. 안내 파일 쓰기가 실패하면(directory를 읽기 전용으로) 명령에 `--append-system-prompt-file`이 없다.
  - `codex-provider-launch.test.ts`(임시 CODEX_HOME, `getSessionCwd` mock):
    - 설정 끔 + `cwd` 있음 → 명령이 단계 3 문자열과 같다(`--cd`, `AMUX_`, `developer_instructions` 없음).
    - 설정 켬 + `cwd` 없음(auto-resume 인자) → `getSessionCwd` 값으로 project config를 읽고 `AMUX_TAB_ID=`와 `developer_instructions`가 있다. `getSessionCwd`도 null → `AMUX_TAB_ID=`는 있고 `developer_instructions`는 없다.
    - 13 KB `developer_instructions`가 있는 config → `developer_instructions`가 빠지고 명령 길이가 12_288 byte 이하다.
- [ ] **Step 2: Run** 위 test → FAIL
- [ ] **Step 3: Implement** — `corepack pnpm add smol-toml`.
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/providers/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(delegation): pass the tab context and guide to launched Claude Code and Codex`

---

### Task 3: Runtime v2 terminal 화면 캡처, 입력, session 확인(browser 없이)

**Files:**
- Modify: `src/lib/runtime/ipc.ts:818-824` (`terminal.capture-pane`, `terminal.send-text`), `src/lib/runtime/terminal/terminal-runtime-contract.ts:56-59`, `src/lib/runtime/terminal/terminal-worker-runtime.ts:253-266`, `src/lib/runtime/terminal/windows-terminal-runtime.ts:172`, `src/lib/runtime/terminal/terminal-worker-service.ts:188-205`, `src/lib/runtime/supervisor.ts:171-201`(interface의 terminal method들)과 `:1566-1573`(구현)
- Test: `tests/unit/lib/runtime/terminal-worker-runtime.test.ts`, `tests/unit/lib/runtime/terminal-worker-service.test.ts`, `tests/unit/lib/runtime/ipc.test.ts`, `tests/unit/lib/runtime/supervisor.test.ts`

**Interfaces:**
- Produces:
  - IPC `'terminal.capture-pane'`: payload `runtimeTerminalSessionSchema`, reply `runtimeTerminalSessionSchema.extend({ content: z.string() })`.
  - IPC `'terminal.send-text'`: payload `runtimeTerminalSessionSchema.extend({ text: z.string(), enter: z.boolean() })`, reply `runtimeTerminalSessionSchema.extend({ sent: z.boolean() })`.
  - Runtime contract:
    - `capturePane(sessionName: string): Promise<{ sessionName: string; content: string }>` — tmux 구현은 `tmux -L <RUNTIME_TMUX_SOCKET> capture-pane -p -t <session>`(legacy `capturePaneContent`와 같은 flag). Session이 없으면 `runtime-v2-terminal-session-not-found`.
    - `sendText(sessionName: string, text: string, enter: boolean): Promise<{ sessionName: string; sent: boolean }>` — `send-keys -t <session> -l <text>`, `enter`면 이어서 `send-keys -t <session> Enter`. PTY attach가 필요 없다(browser 없는 탭에 닿는다).
    - Windows 구현은 둘 다 `runtime-v2-terminal-capture-unsupported` 오류.
  - Supervisor:
    - `captureTerminalSession(input: { sessionName: string }): Promise<{ sessionName: string; content: string }>` — `assertReadyTerminalSession` 뒤 `terminal.capture-pane`.
    - `sendTerminalSessionText(input: { sessionName: string; text: string; enter: boolean }): Promise<void>` — `assertReadyTerminalSession` 뒤 `terminal.send-text`.
    - `hasTerminalSession(input: { sessionName: string }): Promise<boolean>` — storage에 ready 탭이 없거나 `terminal.has-session`이 false/not-found면 false.
  - 기존 `writeTerminalSession`(attach된 PTY에 쓰기)은 바꾸지 않는다.
- [ ] **Step 1: Write the failing tests**
  - Worker runtime(임시 `TMUX_TMPDIR`의 runtime socket): attach하지 않은 session에 `sendText(s, 'echo p4', true)` 뒤 `capturePane`에 `p4`가 있다. 없는 session은 not-found code.
  - Worker service: 두 명령이 runtime으로 전달되고 reply가 schema를 통과한다.
  - Supervisor(`supervisor.test.ts`): ready 탭이면 capture·send-text 요청을 보낸다. ready 탭이 없으면 `hasTerminalSession`이 false이고 capture·send는 not-found로 실패한다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/runtime/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(runtime): read and type into Runtime v2 terminals without a browser`

---

### Task 4: `createdByTabId`, storage schema v6, active 탭 유지

**Files:**
- Modify: `src/types/terminal.ts:16-36` (`ITab.createdByTabId?: string | null`), `src/lib/layout-store.ts:317-381` (`addTabToPane`, `addExistingTabToPane` options), `src/lib/layout-store.ts:470-484` (v2 `restartTabSession`이 `createdByTabId` 유지), `src/lib/runtime/storage/schema.ts:22,264-` (v6 migration, downgrade SQL 상수), `src/lib/runtime/storage-import.ts:261-280` (tab upsert), `src/lib/runtime/storage/repository.ts:120-130,620-665` (row type, layout projection)
- Test: `tests/unit/lib/layout-store-add-tab.test.ts`(create, 임시 data dir), `tests/unit/lib/runtime/storage-schema-migration.test.ts`, `tests/unit/lib/runtime/storage-import.test.ts`, `tests/unit/lib/runtime/storage-repository.test.ts`(`:424-440`의 version 1-5 고정 목록을 1-6으로)

**Interfaces:**
- Produces:
  - `export interface IAddTabOptions { activate?: boolean; createdByTabId?: string | null; restoreActiveTabId?: string | null }`
  - `addTabToPane(wsId, paneId, name?, cwd?, panelType?, command?, options?: IAddTabOptions)`, `addExistingTabToPane(wsId, paneId, tab, options?: IAddTabOptions)`:
    - `activate`가 `false`이면 `pane.activeTabId`와 `layout.activePaneId`를 바꾸지 않는다. 기본 true(지금 동작).
    - `restoreActiveTabId`가 있으면(v2 탭 생성 때 SQLite가 이미 새 탭을 active로 만든 경우, `repository.ts:408-421`) 그 값을 `pane.activeTabId`로 되돌린다. 그 탭이 pane에 없으면 무시한다.
    - `createdByTabId`가 있으면 탭에 기록한다.
    - `addExistingTabToPane`은 같은 id의 탭이 pane에 이미 있으면 다시 넣지 않고 그 탭에 필드만 합친다(storage default mode에서 SQLite layout이 새 v2 탭을 이미 담고 있다).
  - `restartTabSession`(v2 경로): 재시작 전 탭의 `createdByTabId`를 읽어 두고, `supervisor.restartTerminalTab` 뒤 같은 탭에 다시 쓴다.
  - `CURRENT_RUNTIME_SCHEMA_VERSION = 6`, migration v6: `alter table tabs add column created_by_tab_id text null`.
  - `export const RUNTIME_SCHEMA_V6_DOWNGRADE_SQL = 'alter table tabs drop column created_by_tab_id; delete from schema_migrations where version = 6;'` — rollback 문서(Task 9)가 이 문장을 그대로 쓴다(migration 기록 table은 `schema.ts:31`의 `schema_migrations`, SQLite `drop column`은 3.35 이상, 동봉 better-sqlite3는 3.53).
  - Import는 `tab.createdByTabId ?? null`을 `created_by_tab_id`에 쓴다(insert와 `on conflict` update 모두). Repository layout projection은 값이 있을 때만 `createdByTabId`를 붙인다.
- [ ] **Step 1: Write the failing tests**
  - `layout-store-add-tab.test.ts`: 탭 1개 pane에 `{ activate: false, createdByTabId: 'tab-a' }`로 더하면 `activeTabId`가 그대로이고 새 탭에 `createdByTabId: 'tab-a'`가 있다. option 없이 더하면 지금처럼 새 탭이 active다. `readLayoutFile`이 새 v2 탭을 이미 active로 담은 pane을 돌려주는 경우(storage default mode 흉내) `addExistingTabToPane(..., { activate: false, restoreActiveTabId: 'old', createdByTabId: 'tab-a' })` 뒤 `activeTabId === 'old'`이고 새 탭이 한 번만 있다. `layout-store`를 import하기 전에 `AGENTMUX_DATA_DIR`을 임시 directory로 두고(`vi.resetModules` 뒤 dynamic import) 끝나면 지운다. 기존 `layout-store.test.ts`처럼 실제 data dir에 directory를 남기면 안 된다. tmux는 `createSession`·`sendKeys` mock.
  - `storage-schema-migration.test.ts`: v5 DB를 만드는 helper `createVersion5Database`를 새로 둔다(지금은 `createVersion3Database`만 있다. v1~v5 migration을 적용한 DB). 열면 v6가 되고 `tabs.created_by_tab_id` column이 있으며, migration 전 backup directory 이름이 `runtime-v2-migration-v5-v6-`로 시작한다. v6 DB에 `RUNTIME_SCHEMA_V6_DOWNGRADE_SQL`을 실행하면 column이 없어지고 최대 migration version이 5다. 다시 열면 v6로 올라간다.
  - `storage-import.test.ts`: `createdByTabId`가 있는 layout을 import하면 column에 저장되고, 다시 import할 때 값이 바뀌면 갱신된다. 필드가 없는 기존 layout은 `null`.
  - `storage-repository.test.ts`: `getWorkspaceLayout`이 `createdByTabId`를 돌려주고, null이면 key가 없다.
  - v2 restart: `restartTabSession` 뒤에도 탭에 `createdByTabId`가 남는다(supervisor mock).
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/runtime/` + `tests/unit/lib/layout-store*.test.ts` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(layout): record which tab created a tab and keep the active tab for delegated tabs`

---

### Task 5: 공용 탭 서비스와 화면 route 정리

**Files:**
- Create: `src/lib/workspace-tab-service.ts`, `src/lib/agent-startup-screen.ts`
- Modify: `src/pages/api/layout/pane/[paneId]/tabs/index.ts` (만들기 logic을 서비스로 옮김), `src/pages/api/layout/pane/[paneId]/tabs/[tabId]/index.ts:27-40` (DELETE를 서비스로 옮김), `src/lib/tmux.ts:344-363` (`buildBracketedPaste` export, `sendBracketedPaste`의 optional `beforeFollowUpEnter`)
- Test: `tests/unit/lib/workspace-tab-service.test.ts`(create), `tests/unit/lib/agent-startup-screen.test.ts`(create), `tests/unit/pages/layout-tabs-api.test.ts`(기존 case 그대로 통과), `tests/unit/pages/layout-tab-patch-api.test.ts`

**Interfaces:**
- Consumes: Task 3 supervisor `captureTerminalSession`, `sendTerminalSessionText`, `hasTerminalSession`. Task 4 `IAddTabOptions`(`restoreActiveTabId` 포함).
- Produces (`src/lib/workspace-tab-service.ts`):
  - `export interface ICreateWorkspaceTabInput { workspaceId: string; paneId: string; name?: string; cwd?: string; panelType?: TPanelType | null; command?: string; resumeSessionId?: string; startAgent?: boolean; activate?: boolean; createdByTabId?: string | null }`
  - `export const createWorkspaceTab = (input: ICreateWorkspaceTabInput): Promise<ITab | null>` — 지금 화면 route의 규칙 그대로: plain terminal은 terminal v2 mode면 v2 탭, agent 탭은 v1 + workspace cwd 기본값, status 등록(live/manager), resume·startAgent는 `SHELL_READY_DELAY_MS` 뒤 `launchAgentInTab`(fire-and-forget, 지금과 같음). 입력 검증(resume panel type, session id 형식)은 route에 남긴다. v2 경로에서 `activate === false`이면 `supervisor.createTerminalTab` 전에 pane의 `activeTabId`를 읽어 `addExistingTabToPane`의 `restoreActiveTabId`로 넘긴다.
  - `export const launchAgentAfterShellReady = (input: { workspaceId: string; paneId: string; tabId: string }): Promise<IAgentLaunchResult>` — 0.5초 기다린 뒤 `launchAgentInTab({ action: 'launch' })`를 await한다(CLI create가 결과를 받는 경로).
  - `export const closeWorkspaceTab = (workspaceId: string, paneId: string, tabId: string): Promise<boolean>` — `removeTabFromPane` + status 항목 제거(live면 `removeStatusLiveTab`, 아니면 `getStatusManager().removeTab`).
  - `export const readTabStatusEntry = (tab: ITab): Promise<IClientTabStatusEntry | null>` — status live면 `getRuntimeSupervisor().requestStatusLiveSync()`의 `tabs[tab.id]`, 아니면 `getStatusManager().getAllForClient()[tab.id]`.
  - `export const readTabCliState = (tab: ITab): Promise<TCliState | null>` — `readTabStatusEntry`의 `cliState`, 없으면 `tab.cliState ?? null`.
  - `export const isTabSessionAlive = (tab: ITab): Promise<boolean>` — v2면 `hasTerminalSession`, v1이면 `hasSession`.
  - `export const isAgentProcessRunning = (tab: ITab): Promise<boolean>` — v1 agent 탭만. `getSessionPanePid(tab.sessionName)`이 있고 `provider.isAgentRunning(panePid)`가 true. 그 밖에는 false.
  - `export const readTabScreen = (tab: ITab): Promise<string | null>` — v2면 `captureTerminalSession`(오류면 null), v1이면 `capturePaneContent`.
  - `export const writeTabInput = (tab: ITab, content: string, options?: { guardFollowUpEnter?: boolean }): Promise<{ followUpEnterSkipped: boolean }>`:
    - v2: `sendTerminalSessionText({ sessionName, text: buildBracketedPaste(content), enter: true })`. 두 번째 Enter는 없다.
    - v1: `sendBracketedPaste`. `guardFollowUpEnter`이면 `sendBracketedPaste(session, content, { beforeFollowUpEnter })`를 쓴다. `beforeFollowUpEnter`는 0.6초 기다림 뒤 화면을 다시 읽고 `hasPermissionPrompt` 또는 `matchAgentStartupScreen`이면 false를 돌려 두 번째 Enter를 막는다.
    - `buildBracketedPaste(content) = '\x1b[200~' + content + '\x1b[201~'`을 `tmux.ts`에서 export해 두 경로가 같은 byte를 쓴다. `sendBracketedPaste`의 기본 동작(option 없음)은 바꾸지 않는다.
  - Runtime v2 꺼짐(`AGENTMUX_RUNTIME_V2 !== '1'`): v2 탭에 대해 `isTabSessionAlive`는 false, `readTabScreen`은 null, `writeTabInput`은 `runtime-v2-disabled` 오류. supervisor를 부르지 않는다.
  - `src/lib/agent-startup-screen.ts`(create): `export const matchAgentStartupScreen = (screen: string): 'trust' | 'codex-update' | null` — `matchTrustPrompt(screen)`이 있으면 `'trust'`. `Update available!`와 `Update now`가 함께 있으면 `'codex-update'`(Codex `0.167.0` binary 문자열, 다른 선택지는 `Skip`, `Skip until next version`).
  - `export const readLastAssistantMessage = (tab: ITab): Promise<{ text: string; timestamp: number } | null>` — agent 탭만. `provider.readJsonlPath(tab)`가 없으면 `provider.readSessionId(tab)` + `provider.resolveJsonlPath(sessionId, tab.cwd)`. `provider.readTailEntries(path, 50)`에서 마지막 `assistant-message`의 `markdown`과 `timestamp`. 파일이 없으면 null.
  - `export const findTabInAnyWorkspace = (tabId: string): Promise<ITabLocation | null>` (`cli-utils.ts`의 `ITabLocation`).
  - `export const countDelegatedTabs = (workspaceId: string): Promise<number>`
  - `export const AGENT_READY_TIMEOUT_MS = 60_000`, `export const AGENT_READY_POLL_MS = 500`
  - `export const waitForAgentReady = (tab: ITab, options: { launchStartedAt: number; timeoutMs?: number; pollMs?: number }): Promise<boolean>` — `readTabStatusEntry(tab)`가 `cliState === 'idle'`, `lastEvent?.name === 'session-start'`, `lastEvent.at >= launchStartedAt`이면 true. 시간이 지나면 false.
- [ ] **Step 1: Write the failing tests** — `workspace-tab-service.test.ts`(layout-store, tmux, supervisor, status manager mock):
  - `readTabCliState`: status live mode면 supervisor sync 값, 아니면 status manager 값, 둘 다 없으면 `tab.cliState`.
  - `writeTabInput`: v1 탭은 `sendBracketedPaste`, v2 탭은 `sendTerminalSessionText`에 `{ text: '\x1b[200~hi\x1b[201~', enter: true }`(`writeTerminalSession`은 불리지 않음). `guardFollowUpEnter`이고 붙여 넣기 뒤 화면이 권한 요청 fixture이면 tmux `Enter`가 정확히 한 번 나가고 `followUpEnterSkipped: true`.
  - `readTabScreen`: v2 탭은 supervisor capture, 오류면 null.
  - Runtime v2 꺼짐: v2 탭에 `isTabSessionAlive` false, `readTabScreen` null, `writeTabInput` 오류이고 supervisor mock이 한 번도 불리지 않는다.
  - `matchAgentStartupScreen`: 합성 trust 화면 → `'trust'`, 합성 Codex update 화면(`Update available!`, `1. Update now`, `2. Skip`, `3. Skip until next version`) → `'codex-update'`, 일반 화면 → null.
  - `isAgentProcessRunning`: pane pid가 없으면 false, provider가 false면 false.
  - `readLastAssistantMessage`: 합성 Claude JSONL(user → assistant 2개)에서 마지막 assistant `markdown`을 돌려준다. Codex 합성 rollout에서도 같다. JSONL이 없으면 null.
  - `waitForAgentReady`: 3번째 poll에서 `{ cliState: 'idle', lastEvent: { name: 'session-start', at: launchStartedAt + 1 } }`이면 true. `cliState: 'idle'`이지만 `lastEvent`가 null이거나 `launchStartedAt`보다 이른 `session-start`이면(Codex reconcile이 먼저 `idle`로 바꾼 경우) `{ timeoutMs: 50, pollMs: 10 }`에서 false.
  - `createWorkspaceTab` v2 경로 + `activate: false`: 만들기 전 active 탭 id가 `restoreActiveTabId`로 넘어간다.
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
- Consumes: Task 5 서비스 전부(`matchAgentStartupScreen`, `isAgentProcessRunning`, `waitForAgentReady` 포함), Task 4 `createdByTabId`, `hasPermissionPrompt`(`src/lib/permission-prompt.ts:381`), `getCachedRuntimePreflight`.
- Produces:
  - `src/lib/cli-caller.ts`: `export const CALLER_TAB_HEADER = 'x-agentmux-caller-tab'`, `export const resolveCliCaller = (req: NextApiRequest): Promise<{ ok: true; caller: ITabLocation | null } | { ok: false; status: 404; code: 'caller-tab-not-found' }>` — header가 없으면 `caller: null`.
  - `export const DELEGATION_TAB_LIMIT = 6`, `export const withDelegationLock = <T>(workspaceId: string, fn: () => Promise<T>): Promise<T>`(workspace별 promise chain, `globalThis` guard)(`cli-caller.ts`). 준비 대기는 Task 5의 `waitForAgentReady`를 쓰고, test는 서비스 mock으로 대기 결과(true/false)를 정한다.
  - `POST /api/cli/tabs` body `{ workspaceId, name?, panelType?, cwd? }`:
    - `panelType`은 `terminal | codex | claude | web-browser | diff`. 다른 값은 400 `invalid-panel-type`.
    - 호출 탭이 있으면: `withDelegationLock(workspaceId, …)` 안에서 개수 확인(409 `delegation-limit`)과 `createWorkspaceTab`을 함께 한다. pane·cwd는 Rulings대로, `activate: false`, `createdByTabId: caller.tab.id`. 없으면 지금처럼 첫 pane, workspace 첫 directory, active로 만든다(lock 없음).
    - Agent 종류면 preflight 확인(409 `agent-unavailable`) → `createWorkspaceTab`(startAgent 없이) → `launchStartedAt = Date.now()` → `launchAgentAfterShellReady` → 실패 code가 있으면 응답에 `launchError`, 성공이면 `waitForAgentReady(tab, { launchStartedAt })`. 대기는 lock 밖에서 한다.
    - 응답 201 `{ tabId, workspaceId, paneId, sessionName, name, panelType, createdByTabId, ready }`. terminal·web-browser·diff는 `ready: true`.
  - `POST /api/cli/tabs/<id>/send`:
    - Agent 탭(Rulings "보내기 직전 확인" 순서): `readTabCliState`가 `needs-input`이면 409 `target-needs-input`, `idle | busy | ready-for-review`가 아니면 409 `target-not-ready`. `isAgentProcessRunning`이 false면 409 `target-not-ready`. `readTabScreen`이 null이면 409 `target-not-ready`, `hasPermissionPrompt`면 409 `target-needs-input`, `matchAgentStartupScreen`이면 409 `target-not-ready`.
    - 살아 있지 않은 session은 지금처럼 409 `Tab session is not running`.
    - 통과하면 `writeTabInput(tab, content, { guardFollowUpEnter: true })`. 응답 `{ status: 'sent', cliState, followUpEnterSkipped }`.
    - Terminal 탭(v1·v2)은 상태 검사 없이 `writeTabInput`.
  - `GET /api/cli/tabs/<id>/status` → `{ tabId, workspaceId, panelType, providerId, alive, command, cliState, agentSessionId, createdByTabId }`. `providerId`는 agent 탭이면 provider id, 아니면 null. v2 탭의 `command`는 null.
  - `GET /api/cli/tabs/<id>/result` → agent 탭은 `{ tabId, panelType, cliState, lastAssistantMessage, content }`(`content`는 화면, 없으면 null). Terminal 탭은 `{ content }`(v2는 supervisor capture). 살아 있지 않은 session은 지금처럼 409.
  - `DELETE /api/cli/tabs/<id>`: 호출 탭이 있고 대상의 `createdByTabId !== caller.tab.id`면 403 `delegation-close-forbidden`. 통과하면 `closeWorkspaceTab`.
  - `GET /api/cli/tabs` 항목에 `createdByTabId`(없으면 null)와 `runtimeVersion`을 더한다.
  - `api-guide.ts`: 위 동작, 새 오류 code, `x-agentmux-caller-tab` header를 적는다.
- [ ] **Step 1: Write the failing tests**
  - create: 호출 탭 header가 있으면 호출 탭 pane에 `activate: false`, `createdByTabId`로 만든다. 다른 workspace를 `workspaceId`로 주면 그 workspace 첫 pane이다. 위임 탭 6개면 409 `delegation-limit`이고 `createWorkspaceTab`이 불리지 않는다. 없는 caller는 404 `caller-tab-not-found`. agent 미설치는 409 `agent-unavailable`이고 탭을 만들지 않는다. `waitForAgentReady`가 true면 `ready: true`, false면 `ready: false`. launch 실패면 `launchError`가 있고 대기하지 않는다. `--cwd`가 없는 directory면 400 `invalid-cwd`. header가 없으면 지금처럼 첫 pane·active.
  - send: `needs-input` → 409 `target-needs-input`, `inactive`·null → 409 `target-not-ready`, `idle`인데 agent process 없음(셸만 있음) → 409 `target-not-ready`, `busy`인데 화면에 권한 요청 fixture(`tests/unit/lib/permission-prompt.test.ts`의 합성 화면 재사용) → 409 `target-needs-input`, trust 화면·Codex update 화면 → 409 `target-not-ready`. 이 모든 case에서 `writeTabInput`이 한 번도 불리지 않는다. `idle` + 빈 화면 → 200 `sent`이고 `writeTabInput`이 `{ guardFollowUpEnter: true }`로 불린다. v2 terminal 탭 → 상태 검사 없이 `writeTabInput`.
  - create 동시성: 위임 탭 5개 상태에서 호출 탭 header가 있는 create 3개를 동시에 보내면 하나만 201이고 둘은 409 `delegation-limit`이다(`createWorkspaceTab` mock이 layout에 탭을 더함).
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
- Test: `tests/unit/hooks/use-config-store.test.ts`(갱신), `tests/unit/components/pane-tab-item.test.ts`(create. vitest는 `tests/**/*.test.ts`만 모으고 environment가 `node`다. `tests/unit/components/mobile-tab-header.test.ts`처럼 `renderToStaticMarkup`으로 그린다), `tests/unit/messages/delegation-copy.test.ts`(create, 새 key가 ko·en 양쪽에 있는지. 기존 `agent-copy.test.ts`와 같은 방식)

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
- Modify: `docs/ADR.md`(ADR-035, ADR-036, ADR-037을 Accepted로 추가. 셋 다 아직 없다. 마지막은 ADR-034), `docs/README.md`, `docs/DATA-DIR.md`(새 `bin/agentmux` 0700, `delegation/claude.md` 0600, `claude-tabs/<tab-id>.json`의 `permissions.allow`, `tabs.created_by_tab_id`), `docs/FOLLOW-UP.md`, `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`
- Scratch(commit하지 않음): 격리 확인 script는 scratchpad에 둔다.

**Interfaces:**
- Consumes: Task 1~8 전부.
- Produces: 문서와 확인 기록.

- [ ] **Step 1: 문서**
  - ADR-035: agentmux는 사용자 agent 설정을 고치지 않고 실행 시점 flag(`--settings`, `--append-system-prompt-file`, `-c`)와 탭 환경 변수로만 hook·안내를 붙인다.
  - ADR-036: 위임은 확인 없이 진행하고 agentmux가 띄운 Claude Code에서 `agentmux tab` 하위 명령 6개를 미리 허용한다. 신뢰 경계는 Unix 사용자이고 CLI 제한은 실수 방지 장치다.
  - ADR-037: Runtime v2 agent 지원 전까지 agent 탭은 legacy tmux adapter(Runtime v1)로 만든다(단계 1에서 구현, 문서 기록만).
  - `docs/CLI.md`: 명령 목록(`workspaces`, `tab list/create/send/status/result/close/browser`), 환경 변수(`AMUX_PORT`, `AMUX_TOKEN`, `AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, `AGENTMUX_DATA_DIR`), 그리고: 환경 변수, 새 오류 code, `tab create` 대기, 위임 제한, Codex sandbox(`workspace-write`는 local network를 막아 위임 불가), `shell_environment_policy`가 `core`/`none`이면 호출 탭을 모른다는 한계.
  - CLI 문서에 `developer_instructions` 값이 둘 이상이거나 TOML을 읽지 못하면, 또는 명령이 12 KB를 넘으면 Codex 안내를 넣지 않는다는 점도 적는다.
  - Handoff 배포 절: Runtime v2 schema v6 migration과 rollback 절차. 이전 build는 v6 DB를 열지 못하므로 순서가 필수다.
    1. Service를 멈춘다.
    2. 현재 `<dataDir>/runtime-v2/state.db*`를 별도 directory에 복사해 둔다.
    3. better-sqlite3로 `RUNTIME_SCHEMA_V6_DOWNGRADE_SQL`을 실행한다(같은 문장을 문서에 적는다).
    4. 이전 build를 시작한다.
    - 비상용: `<dataDir>/backups/runtime-v2-migration-v5-v6-<시각>/`의 DB를 되돌리는 방법. 배포 뒤 SQLite에 쓴 자료를 잃고, 이후 첫 layout 쓰기가 현재 `layout.json`을 오래된 layout으로 덮는다고 적는다.
- [ ] **Step 2: 전체 gate** — `check:project-design`, `check:product-name`, lint(error 0), `tsc --noEmit`, 임시 `TMUX_TMPDIR`로 전체 test, `pnpm build`.
- [ ] **Step 3: 격리 live 확인**(단계 3과 같은 안전 규칙: 이 worktree production build, `env -i` 허용 목록, 임시 `AGENTMUX_DATA_DIR`, 짧은 임시 `TMUX_TMPDIR`, port 18122, live와 같은 Runtime v2 mode, `INIT_PASSWORD`, setup POST에 `Origin` header). Claude prompt는 4개 이하, Codex prompt는 2개 이하. 브라우저는 열지 않는다(인수 기준 10).
  1. API로 Claude 탭(`startAgent`)을 만든다. Claude에게 "Run `agentmux tab create -t codex -n helper`, then `agentmux tab send <tabId> \"Reply with the single word OK\"`, wait until `agentmux tab status <tabId>` shows ready-for-review or idle, then run `agentmux tab result <tabId>` and tell me the lastAssistantMessage." 를 보낸다. 확인: 권한 확인 화면 없이 CLI가 실행됨, Codex 탭이 Claude 탭과 같은 pane·같은 cwd에 생김, active 탭이 바뀌지 않음, `createdByTabId`가 Claude 탭 id, Codex가 "OK"를 받음, Claude가 결과를 읽음.
  2. Claude를 거치지 않고 shim(`<격리 data dir>/bin/agentmux`)을 직접 실행하며 `AMUX_TAB_ID`에 Claude 탭 id를 준다: 위임 탭 6개 상태에서 `tab create`가 `delegation-limit`, 사용자 탭 `tab close`가 `delegation-close-forbidden`. Needs-input 대상은 격리 `config.json`에 `claudePermissionMode: 'default'`를 둔 Claude 탭에서 파일 쓰기를 요청해 권한 요청을 띄운다(사용자 Claude 기본 `defaultMode`가 `auto`라 그대로는 요청이 안 뜰 수 있다). 그 탭에 `tab send`가 `target-needs-input`이고 화면에 글자가 늘지 않는다(전후 capture 비교). 권한 요청에는 응답하지 않고 Esc로 닫는다.
  3. API로 만든 Runtime v2 plain terminal 탭(browser가 붙지 않은 상태)에 `tab send 'echo p4-ok'`, `tab result`에 `p4-ok`, `tab status`의 `alive: true`.
  3a. 위임으로 만든 plain terminal 탭(`tab create -t terminal`, 호출 탭 = Claude 탭)도 active 탭을 바꾸지 않는다(layout의 `activeTabId` 전후 비교).
  4. 설정을 끄고 새 Claude 탭을 시작하면 tmux 화면에 보낸 명령에 `AMUX_`와 `--append-system-prompt-file`이 없다.
  5. Legacy mode(`AGENTMUX_RUNTIME_V2` 없음) 격리 server에서 1의 위임 흐름을 한 번 더 확인한다(Claude prompt 1개, 인수 기준 11). Prompt 한도를 넘으면 unit test(Task 6의 두 mode)로 대신하고 기록한다.
  6. Rollback SQL 확인: 격리 data dir의 v6 `state.db` 복사본에 `RUNTIME_SCHEMA_V6_DOWNGRADE_SQL`을 실행하고, main(`5b29cb67`) build로 그 복사본을 연 격리 server가 뜨는지 본다.
  7. 안전 확인: 전후 `~/.claude/settings.json`, `~/.codex/config.toml` sha256, live tmux session 목록, `agentmux.service` MainPID가 같다. 격리 server와 tmux server, 임시 directory를 정리한다.
- [ ] **Step 4: 기록** — 결과를 handoff의 단계 4 절과 `docs/FOLLOW-UP.md`에 적는다(screenshot은 commit하지 않음).
- [ ] **Step 5: Commit** — `docs: record the delegation guide, CLI changes, and their checks`
- [ ] **Step 6: 배포 뒤 확인**(인수 기준 13, PR merge 뒤. Main push와 `deploy:local`은 사용자가 직접 실행한다): health commit, worker, journal error 0, live tmux server와 기존 session 유지, `~/.codexmux/backups/runtime-v2-migration-v5-v6-*` 생성과 `state.db` schema v6, shim과 안내 파일 생성, 기존 탭 목록·active 탭 그대로. 결과를 handoff 운영 기록에 남긴다.
