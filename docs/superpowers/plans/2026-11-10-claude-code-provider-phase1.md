# Claude Code Provider 단계 1: Agent 경계 정리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Codex만 전제하던 server·runtime·client 분기를 provider 계약과 agent 종류 집합 뒤로 옮기고, agent 탭을 terminal v2 mode와 관계없이 Runtime v1(legacy tmux adapter) 탭으로 만든다. 그 밖의 Codex 동작은 바뀌지 않는다.

**Architecture:** Agent 종류는 `src/types/terminal.ts`의 `TAgentPanelType`과 `src/lib/panel-type.ts`의 `AGENT_PANEL_TYPES`가 정한다. Provider별 차이는 `IAgentProvider`의 새 status 동작 flag, `readJsonlStatus`, `jsonlRoots`가 맡고, 화면 쪽 차이는 server module을 import하지 않는 `src/lib/agent-provider-meta.ts` 표가 맡는다. 탭 생성 API는 plain terminal 탭만 Runtime v2로 만들고 agent 탭은 v1으로 만든다(v2 agent 탭은 hook·상태 감시·timeline·storage가 동작하지 않아서다. spec 1절).

**Tech Stack:** TypeScript, Next.js Pages Router custom server, zod IPC schema, vitest, tmux.

**Spec:** `docs/superpowers/specs/2026-11-10-claude-code-provider-design.md` (1절 "Provider 계약 확장"과 "Agent 탭은 옛 terminal 경로로 만든다", "단계와 배포" 1번)

**Plan review:** `docs/superpowers/reviews/2026-11-10-claude-code-provider-phase1-eng-review.md`

## 단계 1 범위

Spec 1절의 provider 책임 중 이 단계에서 경계를 만드는 것과 뒤 단계로 넘기는 것을 나눈다. 넘기는 책임은
그 동작을 실제로 쓰는 단계에서 계약을 더한다(구현이 하나뿐인 interface를 미리 만들지 않음).

| 책임 | 단계 |
| --- | --- |
| Agent 종류 집합, IPC panelType schema | 1 (Task 1) |
| 상태 판정 전략(flag), JSONL 상태 읽기 | 1 (Task 2) |
| JSONL 경로 허용 root, 기본 agent 종류 | 1 (Task 3) |
| 실행 서비스·탭 생성 API의 agent 일반화, agent 탭 v1 생성, hook capability 공용화 | 1 (Task 4) |
| Client provider metadata 표, 기존 문구 버그 | 1 (Task 5) |
| Preflight provider별 상태, rate limit provider별 store, hook bridge stdin 전달 | 2 |
| Session Catalog provider column과 projector, 세션 목록, stats 수집, catalog annotation(`supervisor.ts:945`), storage legacy import(`storage-import.ts:90`), `api/sessions/[sessionId]/entries.ts:23` | 3 |
| 위임 안내 주입, CLI의 v2 terminal 탭 지원(Runtime v2 terminal worker 화면 캡처 명령 포함) | 4 |
| Runtime v2 agent 탭 지원(hook 인증, 상태 감시, timeline process 찾기, storage `panel_type`, 화면 캡처·key 입력) | 이 설계 범위 밖 후속 |

## Global Constraints

- Codex 탭의 상태 판정, timeline, resume, rate limit은 바뀌지 않는다. 예외는 `new-tabs` mode에서 새 Codex 탭이 v2 대신 v1으로 만들어지는 것뿐이다.
- 사용자 `~/.claude/`, `~/.codex/` 파일을 읽거나 고치지 않는다(이 단계에는 해당 코드가 없다).
- Runtime v2 tmux socket `codexmux-runtime-v2`는 Terminal Worker 전용이다(`docs/TMUX.md`). 이 단계는 그 socket을 직접 다루는 코드를 더하지 않는다.
- Runtime v2 status IPC의 `statusBehavior` wire schema(`runtime/ipc.ts:483-486`, strict 2-key)는 바꾸지 않는다.
- Hook capability 형식(`v: 1`, `{ v, tabId, sessionName, expiresAt }`, HMAC-SHA256 base64url, CLI token 서명)은 바꾸지 않는다. 배포 전에 띄운 Codex session의 capability가 계속 검증되어야 한다.
- `AGENTS.md` 규칙: Pages Router, `"use client"` 금지, `@/` import, 소문자-dash 파일명, arrow function, interface `I`·type `T` 접두사, `pgrep`/`ps`/`lsof` 직접 호출 금지, 공유 singleton은 `globalThis` guard.
- DOM-safe frontend: `innerHTML`, `dangerouslySetInnerHTML`, `document.write` 금지.
- 새 문구는 `messages/ko`와 `messages/en`에 함께 추가한다.
- 명령은 `corepack pnpm ...`을 쓴다. Commit message는 Conventional Commits이고 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`를 붙인다. `--no-verify` 금지.
- 작업 branch: `feat/claude-provider-phase1` (`docs/claude-code-provider-design` 위에서 시작).

## Review Focus

1. `AGENTMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`에서 새 탭 메뉴로 Codex 탭을 만들면 v1 탭(`pt-…` session)이 만들어지고 Codex가 시작된다. Plain terminal 탭은 여전히 v2로 만들어진다 → Task 4 `layout-tabs-api.test.ts`.
2. 배포 전에 띄운 Codex session이 들고 있는 hook capability가 배포 뒤에도 검증된다(형식·서명 불변) → Task 4 `agent-hooks.test.ts`의 고정 payload case.
3. Runtime v2 status worker가 받는 2-key `statusBehavior` payload가 그대로 parse되고 hook reducer와 side-effect policy에 쓰인다 → Task 2 `status-worker-service.test.ts`, `runtime/ipc.test.ts` 기존 case 유지 확인.
4. 허용 root 밖 JSONL 경로(`~/.codex/sessions/../x.jsonl`, 다른 확장자, root 자체)는 root 계산 방식이 바뀐 뒤에도 거절된다 → Task 3 `providers-jsonl-paths.test.ts`.
5. 옛 layout이나 API 입력에 등록되지 않은 agent 종류(예: `claude`)가 오면 throw하지 않고 `terminal`로 정규화되어 저장된다 → Task 1 `panel-type.test.ts`, Task 4 `layout-tabs-api.test.ts`.

---

### Task 1: Agent 종류 집합

**Files:**
- Modify: `src/types/terminal.ts:12`
- Modify: `src/lib/panel-type.ts`
- Modify: `src/lib/runtime/ipc.ts:162-167`, `src/lib/runtime/ipc.ts:283-288`
- Test: `tests/unit/lib/panel-type.test.ts` (create), `tests/unit/lib/runtime/ipc.test.ts`

**Interfaces:**
- Produces:
  - `src/types/terminal.ts`: `export type TAgentPanelType = 'codex';` and `TPanelType = 'terminal' | TAgentPanelType | 'web-browser' | 'diff'`
  - `src/lib/panel-type.ts`:
    - `export const AGENT_PANEL_TYPES: readonly TAgentPanelType[]` (값 `['codex']`)
    - `export const PANEL_TYPES` — `['terminal', ...AGENT_PANEL_TYPES, 'web-browser', 'diff']`를 `z.enum`에 넣을 수 있는 readonly 비어 있지 않은 tuple로
    - `export const DEFAULT_AGENT_PANEL_TYPE: TAgentPanelType = 'codex'`
    - `export const isAgentPanelType = (panelType: unknown): panelType is TAgentPanelType`
    - 기존 `isPanelType`, `normalizePanelType` 유지. `AGENT_PANEL_TYPE`은 삭제하고 사용처 2곳을 `DEFAULT_AGENT_PANEL_TYPE`/`isAgentPanelType`으로 바꾼다.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/panel-type.test.ts`:
```ts
it('treats every AGENT_PANEL_TYPES entry as an agent panel and nothing else', () => {
  for (const type of AGENT_PANEL_TYPES) expect(isAgentPanelType(type)).toBe(true);
  for (const type of ['terminal', 'web-browser', 'diff', 'claude', '', null, undefined, 42]) {
    expect(isAgentPanelType(type)).toBe(false);
  }
});
it('normalizes an unregistered agent type to undefined', () => {
  expect(normalizePanelType('claude')).toBeUndefined();
  expect(normalizePanelType('codex')).toBe('codex');
});
it('lists every panel type exactly once', () => {
  expect(new Set(PANEL_TYPES).size).toBe(PANEL_TYPES.length);
  expect(PANEL_TYPES).toEqual(expect.arrayContaining(['terminal', 'web-browser', 'diff', ...AGENT_PANEL_TYPES]));
});
it('defaults to a registered agent type', () => {
  expect(AGENT_PANEL_TYPES).toContain(DEFAULT_AGENT_PANEL_TYPE);
});
```
`tests/unit/lib/runtime/ipc.test.ts`: status tab payload과 layout tab payload의 `panelType`이 `PANEL_TYPES`의 모든 값을 받아들이고 `'not-a-panel'`을 거절하는 `it.each(PANEL_TYPES)` case를 더한다. 기존 test의 payload builder를 재사용한다.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run tests/unit/lib/panel-type.test.ts tests/unit/lib/runtime/ipc.test.ts`
Expected: FAIL (`AGENT_PANEL_TYPES`, `PANEL_TYPES`, `DEFAULT_AGENT_PANEL_TYPE` 없음)

- [ ] **Step 3: Implement the exports above and replace the two `z.union([z.literal('terminal'), z.literal('codex'), …])` panelType schemas in `ipc.ts` with one `z.enum(PANEL_TYPES)` schema**

- [ ] **Step 4: Run tests to verify they pass, then typecheck**

Run: `corepack pnpm vitest run tests/unit/lib/panel-type.test.ts tests/unit/lib/runtime/ipc.test.ts && corepack pnpm exec tsc --noEmit`
Expected: PASS, tsc 0 errors

- [ ] **Step 5: Commit** — `refactor(agent): derive agent panel types from one list`

---

### Task 2: Provider status 동작 flag와 JSONL 상태 읽기

**Files:**
- Create: `src/lib/status/jsonl-check.ts` (`status-manager.ts:129-207`의 `IJsonlCheckResult`, `emptyJsonlCheckResult`, `checkJsonlIdle`와 그 cache를 옮김)
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/codex/index.ts`
- Modify: `src/lib/status-manager.ts:210-230, 528-536, 679-681, 1335-1345, 1363-1390`
- Modify: `src/lib/status/jsonl-reconciliation-service.ts:4-30`, `src/lib/status/poll-tab-reconciliation.ts:55-61`, `src/lib/status/poll-recovery-service.ts:55-63`, `src/lib/status/scan-tab-bootstrap.ts:84-86`, `src/lib/status/poll-created-tab-bootstrap.ts:82`, `src/lib/status/pane-recovery-service.ts:29, 46, 72, 105`
- Modify: `src/lib/status-state-machine.ts:20`, `src/lib/status-side-effect-policy.ts:12` (입력 type만)
- Modify: `src/lib/timeline/resume-session-service.ts:35-100`, `src/lib/timeline-server.ts:130` (`checkJsonlState: checkCodexJsonlState` 주입 제거)
- Test: 아래 각 service의 기존 test 파일, resume session service의 기존 test 파일, `tests/unit/lib/providers.test.ts`

**Interfaces:**
- Consumes: Task 1 없음(독립)
- Produces:
  - `IAgentProviderStatusBehavior`에 `readonly reconcileStateFromJsonl: boolean;`, `readonly recoverPaneInput: boolean;` 추가. Codex 값은 둘 다 `true`(기존 `watchJsonlWhenBound: true`, `deferStopHookUntilJsonlIdle: true` 유지).
  - Runtime v2 status IPC의 `statusBehavior` schema(`runtime/ipc.ts:483-486`, strict 2-key)는 그대로 둔다. Hook reducer와 side-effect policy는 그 두 key만 쓰므로 입력 type을 `export type TAgentHookStatusBehavior = Pick<IAgentProviderStatusBehavior, 'watchJsonlWhenBound' | 'deferStopHookUntilJsonlIdle'>`(`providers/types.ts`)로 바꾼다. 2-key literal을 쓰는 기존 test는 그대로 compile되어야 한다.
  - `src/lib/status/jsonl-check.ts`: `export interface IJsonlCheckResult` (기존 필드 그대로), `export interface IAgentJsonlStatus extends IJsonlCheckResult { rateLimits?: IRateLimitsData | null }`, `export const checkJsonlIdle = (jsonlPath: string): Promise<IJsonlCheckResult>`, `export const emptyJsonlCheckResult = (): IJsonlCheckResult`, `export const clearJsonlCheckCache = (jsonlPath: string): void` (`status-manager.ts:356,1147`의 `jsonlIdleCache.delete` 대체)
  - `IAgentProvider.readJsonlStatus(jsonlPath: string): Promise<IAgentJsonlStatus>`. Codex 구현은 지금 `checkProviderJsonlIdle`의 Codex 분기(`checkCodexJsonlState` → 필드 대응, `staleMs: 0`, `rateLimits`)다.
  - Service 입력 변경(`providerId` 대신 flag):
    - `shouldKeepStatusJsonlWatch({ cliState, watchJsonlWhenBound }: { cliState: TCliState; watchJsonlWhenBound: boolean })`
    - `resolveStatusInitialCliState({ persistedState, reconcileStateFromJsonl, detected })`
    - `recoverStatusPollPaneInput({ recoverPaneInput, running, recoverPending, recoverInterrupted })`
    - scan/poll-created bootstrap 입력의 `providerId`를 `statusBehavior: IAgentProviderStatusBehavior | null`로 바꾸고, `shouldStartJsonlWatch`는 `watchJsonlWhenBound`, scan bootstrap의 `shouldRecoverPaneInput`은 `recoverPaneInput`으로 판정
    - poll-created bootstrap에는 `shouldRecoverPaneInput`이 없으므로 `shouldStartJsonlWatch`만 바뀐다
    - `pane-recovery-service` dependency `getProviderId`를 `getStatusBehavior?: (entry: ITabStatusEntry) => IAgentProviderStatusBehavior | null`로 바꾸고, 지원하지 않으면 `{ recovered: false, reason: 'not-supported' }`(기존 `'not-codex'` 대체)
  - `status-manager.ts` 대응: `checkProviderJsonlIdle`은 `provider.readJsonlStatus` 호출 + `rateLimits`가 있으면 `onRateLimits`. `reconcileCodexState`의 Codex 판정은 `statusBehavior.reconcileStateFromJsonl`. 679행 watch 시작은 `watchJsonlWhenBound`. 1335행 block은 watch 시작을 `watchJsonlWhenBound`, 상태 확인·merge·reconcile·broadcast를 `reconcileStateFromJsonl`로 나눈다. 1363행 `isCodex`는 reconcile 부분을 `reconcileStateFromJsonl`, pane 복구 호출을 `recoverPaneInput`으로 나눈다.
  - `resume-session-service`의 `shouldPreferLatestCwdJsonl(provider, path)`는 `provider.statusBehavior.reconcileStateFromJsonl`이 false면 false, 아니면 `provider.readJsonlStatus(path)`의 `interrupted`를 쓴다. Service option `checkJsonlState`는 없앤다.

- [ ] **Step 1: Write the failing tests**

각 service test에 기존 Codex case(이제 flag `true`로 표현)를 그대로 두고, flag가 `false`인 provider case를 더한다:
```ts
// status-jsonl-reconciliation-service.test.ts
expect(shouldKeepStatusJsonlWatch({ cliState: 'idle', watchJsonlWhenBound: true })).toBe(true);
expect(shouldKeepStatusJsonlWatch({ cliState: 'idle', watchJsonlWhenBound: false })).toBe(false);
expect(shouldKeepStatusJsonlWatch({ cliState: 'busy', watchJsonlWhenBound: false })).toBe(true);
// status-poll-tab-reconciliation.test.ts
expect(resolveStatusInitialCliState({ persistedState: 'busy', reconcileStateFromJsonl: false, detected: { running: true, jsonlPath: null, idle: false, lastAssistantSnippet: null } })).toBe('unknown');
// status-poll-recovery-service.test.ts
const recoverPending = vi.fn();
await expect(recoverStatusPollPaneInput({ recoverPaneInput: false, running: true, recoverPending, recoverInterrupted: vi.fn() })).resolves.toEqual({ recovered: false });
expect(recoverPending).not.toHaveBeenCalled();
// status-scan-tab-bootstrap.test.ts
// statusBehavior { watchJsonlWhenBound: false, recoverPaneInput: false, … } + detected.running + jsonlPath + cliState 'idle'
//   → shouldStartJsonlWatch false, shouldRecoverPaneInput false
// status-poll-created-tab-bootstrap.test.ts
// 같은 입력 → shouldStartJsonlWatch false
// resume session service test
// statusBehavior.reconcileStateFromJsonl false인 provider → 최신 cwd JSONL을 선호하지 않고 readJsonlStatus 호출 0회
// status-pane-recovery-service.test.ts
// getStatusBehavior → { recoverPaneInput: false, … } → { recovered: false, reason: 'not-supported' }, capture 호출 0회
```
`tests/unit/lib/providers.test.ts`: `codexProvider.statusBehavior`가 `{ watchJsonlWhenBound: true, deferStopHookUntilJsonlIdle: true, reconcileStateFromJsonl: true, recoverPaneInput: true }`이고, `codexProvider.readJsonlStatus`가 fixture Codex JSONL(기존 `codex-jsonl-state` test fixture 재사용)에서 `checkCodexJsonlState`와 같은 `idle`, `lastAssistantSnippet`, `rateLimits`를 돌려준다.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run tests/unit/lib/status-*.test.ts tests/unit/lib/providers.test.ts`
Expected: FAIL (새 입력 이름과 flag 없음)

- [ ] **Step 3: Move `checkJsonlIdle` to `src/lib/status/jsonl-check.ts`, add the flags and `readJsonlStatus`, and switch every listed site from `providerId === 'codex'` / `provider?.id === 'codex'` to the flag named above**

`grep -rn "'codex'" src/lib/status-manager.ts src/lib/status/` 결과가 0이어야 한다(`reduceCodexState`, `checkCodexJsonlState` 같은 Codex 전용 함수 이름은 남아도 된다).

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run tests/unit/lib/status-*.test.ts tests/unit/lib/providers.test.ts tests/unit/lib/timeline-*.test.ts tests/unit/lib/runtime/status-worker-service.test.ts tests/unit/lib/runtime/ipc.test.ts tests/unit/lib/runtime/supervisor.test.ts && corepack pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit** — `refactor(status): gate Codex-only status paths on provider status behavior`

---

### Task 3: JSONL 허용 root와 기본 agent 종류

**Files:**
- Modify: `src/lib/path-validation.ts:23-36`
- Modify: `src/lib/providers/types.ts`, `src/lib/providers/codex/index.ts`, `src/lib/providers/index.ts`
- Modify (허용 검사 호출처): `src/lib/timeline-server.ts:22,121,495`, `src/lib/runtime/timeline/worker-service.ts:12,135`, `src/pages/api/timeline/entries.ts:22`, `src/pages/api/timeline/message-counts.ts:55`, `src/pages/api/v2/timeline/entries.ts:38`, `src/pages/api/v2/timeline/message-counts.ts:29`
- Modify (`'codex'` 기본값): `src/lib/timeline-server.ts:376`, `src/pages/api/timeline/sessions.ts:13`, `src/pages/api/timeline/entries.ts:32`, `src/pages/api/v2/timeline/sessions.ts:21`, `src/pages/api/v2/timeline/entries.ts:53`, `src/lib/runtime/timeline/worker-service.ts:175`, `src/lib/session-list.ts:23,35`
- Test: `tests/unit/lib/providers-jsonl-paths.test.ts` (create), `tests/unit/lib/path-validation.test.ts`, `tests/unit/pages/timeline-read-default.test.ts` (`@/lib/providers` mock에 `isAllowedAgentJsonlPath` 추가)

**Interfaces:**
- Consumes: Task 1 `DEFAULT_AGENT_PANEL_TYPE`
- Produces:
  - `src/lib/path-validation.ts`: `export const isJsonlPathUnderRoots = (filePath: string, roots: readonly string[]): boolean` (기존 `isPathInside` + `.jsonl` 확장자 검사를 root마다 적용). `getCodexSessionsDir` 유지. 기존 `isAllowedJsonlPath`는 `isJsonlPathUnderRoots(filePath, [getCodexSessionsDir(homeDir)])`로 남겨 Codex 전용 호출처(`session-index.ts`, catalog)가 그대로 쓰게 한다.
  - `IAgentProvider.jsonlRoots(homeDir?: string): string[]`. Codex는 `[getCodexSessionsDir(homeDir)]`.
  - `src/lib/providers/index.ts`: `export const isAllowedAgentJsonlPath = (filePath: string, homeDir?: string): boolean` — 등록된 모든 provider의 root 중 하나 아래에 있으면 true.
  - 위 허용 검사 호출처는 `isAllowedAgentJsonlPath`를 쓰고, 기본값 호출처는 `DEFAULT_AGENT_PANEL_TYPE`을 쓴다.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/providers-jsonl-paths.test.ts` (`homeDir = '/home/test'`):
```ts
expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions/2026/11/10/rollout-a.jsonl', '/home/test')).toBe(true);
expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions/../secret.jsonl', '/home/test')).toBe(false);
expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions/2026/a.json', '/home/test')).toBe(false);
expect(isAllowedAgentJsonlPath('/home/test/.codex/sessions', '/home/test')).toBe(false);
expect(isAllowedAgentJsonlPath('/home/test/.claude/projects/x/a.jsonl', '/home/test')).toBe(false); // Claude provider 등록 전
expect(codexProvider.jsonlRoots('/home/test')).toEqual(['/home/test/.codex/sessions']);
```
`tests/unit/lib/path-validation.test.ts`: `isJsonlPathUnderRoots`가 두 root 중 하나 아래면 true, 둘 다 밖이면 false, 빈 root 배열이면 false.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run tests/unit/lib/providers-jsonl-paths.test.ts tests/unit/lib/path-validation.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the exports and switch the listed call sites**

`grep -rn "?? 'codex'\|: 'codex'" src/lib/timeline-server.ts src/pages/api/timeline src/pages/api/v2/timeline src/lib/runtime/timeline/worker-service.ts src/lib/session-list.ts` 결과가 0이어야 한다.

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run tests/unit/lib/providers-jsonl-paths.test.ts tests/unit/lib/path-validation.test.ts tests/unit/lib/timeline-*.test.ts tests/unit/lib/runtime/*timeline*.test.ts tests/unit/pages/timeline-read-default.test.ts && corepack pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit** — `refactor(timeline): allow JSONL paths from every registered agent provider`

---

### Task 4: 실행 서비스, 탭 생성 API(agent 탭 v1), hook capability 공용화

**Files:**
- Create: `src/lib/agent-hooks.ts`
- Modify: `src/lib/providers/codex/session-hooks.ts` (capability 함수와 `BRIDGE_PATH`를 `agent-hooks.ts`로 옮기고 import)
- Modify: `src/lib/hook-settings.ts:6,14`, `src/pages/api/status/hook.ts:7,19`
- Modify: `src/lib/agent-launch-service.ts:32`
- Modify: `src/pages/api/layout/pane/[paneId]/tabs/index.ts:41-135`, `src/pages/api/workspace/index.ts:27`
- Test: `tests/unit/lib/agent-hooks.test.ts` (create), `tests/unit/lib/providers/codex-session-hooks.test.ts`, `tests/unit/pages/layout-tabs-api.test.ts`, agent launch service test(있으면 그 파일, 없으면 `tests/unit/lib/agent-launch-service.test.ts` 생성)

**Interfaces:**
- Consumes: Task 1 `isAgentPanelType`, `DEFAULT_AGENT_PANEL_TYPE`
- Produces:
  - `src/lib/agent-hooks.ts`:
    - `export interface IAgentHookCapabilityPayload { v: number; tabId: string; sessionName: string; expiresAt: number }`
    - `export const createAgentHookCapability = (tabId: string, sessionName: string, now?: number): string`
    - `export const verifyAgentHookCapability = (capability: string, expectedSessionName: string, now?: number): IAgentHookCapabilityPayload | null`
    - `export const STATUS_HOOK_BRIDGE_PATH: string` (`<dataDir>/status-hook.cjs`)
    - 형식·TTL(30일)·서명은 기존 `createCodexHookCapability`와 같다.
  - `codex/session-hooks.ts`의 `createCodexHookCapability`, `verifyCodexHookCapability`, `CODEXMUX_STATUS_HOOK_BRIDGE_PATH` export는 삭제하고 호출처를 새 이름으로 바꾼다.
  - `launchAgentInTab`: provider가 없으면 `invalid-panel`, 있으면 id와 관계없이 진행. Preflight 검사(`preflight.agent`, 실패 code `codex-update-required`)는 단계 2에서 provider별로 바꾸므로 그대로 둔다.
  - Tab 생성 API(`api/layout/pane/[paneId]/tabs/index.ts`):
    - 요청 body의 `panelType`을 먼저 `normalizePanelType`으로 정규화하고, 이후 분기와 `addTabToPane` 인자에 정규화한 값을 쓴다. 등록되지 않은 종류(`'claude'` 등)는 `undefined`가 되어 terminal 탭으로 저장된다.
    - Runtime v2 생성 조건은 `shouldCreateTerminalTabInRuntimeV2() && isPlainTerminalTabRequest(...)`만 남긴다. `(startAgent === true && panelType === 'codex')` 절을 지워 agent 탭은 항상 v1(`addTabToPane`)로 만든다. v2 tab 기록의 `panelType`은 항상 `'terminal'`이다.
    - Agent 시작 조건은 `startAgent === true && isAgentPanelType(normalizedPanelType) && !resumeSessionId && !command`다.
    - Resume provider 조회 기본값은 `DEFAULT_AGENT_PANEL_TYPE`이다.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/agent-hooks.test.ts`:
```ts
const capability = createAgentHookCapability('tab-1', 'pt-ws-a-pane-b-tab-c', 1_000);
expect(verifyAgentHookCapability(capability, 'pt-ws-a-pane-b-tab-c', 2_000)).toMatchObject({ v: 1, tabId: 'tab-1' });
expect(verifyAgentHookCapability(capability, 'pt-ws-other', 2_000)).toBeNull();
expect(verifyAgentHookCapability(capability, 'pt-ws-a-pane-b-tab-c', 1_000 + 30 * 24 * 60 * 60 * 1000)).toBeNull();
expect(verifyAgentHookCapability(`${capability}.extra`, 'pt-ws-a-pane-b-tab-c', 2_000)).toBeNull();
expect(JSON.parse(Buffer.from(capability.split('.')[0], 'base64url').toString())).toEqual({ v: 1, tabId: 'tab-1', sessionName: 'pt-ws-a-pane-b-tab-c', expiresAt: 1_000 + 30 * 24 * 60 * 60 * 1000 });
```
`tests/unit/pages/layout-tabs-api.test.ts` (terminal v2 mode `new-tabs`, Runtime v2 on):
- `{ panelType: 'codex', startAgent: true }` → `addTabToPane`이 `panelType: 'codex'`로 불리고 supervisor `createTerminalTab`은 불리지 않으며, `launchAgentInTab`이 `action: 'launch'`로 예약된다.
- `{}`(plain terminal) → 지금처럼 supervisor `createTerminalTab`으로 v2 탭이 만들어진다.
- `{ panelType: 'claude', startAgent: true }` → throw 없이 `addTabToPane`의 `panelType` 인자가 `undefined`이고 `launchAgentInTab`이 불리지 않는다.

Launch service test(`tests/unit/lib/agent-launch-service.test.ts`의 기존 `@/lib/providers` mock): `getProviderByPanelType`이 id `'codex-test'`, panelType `'codex'`인 provider를 돌려줄 때 `launchAgentInTab`이 `invalid-panel`을 돌려주지 않는다.

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run tests/unit/lib/agent-hooks.test.ts tests/unit/pages/layout-tabs-api.test.ts tests/unit/lib/agent-launch-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Create `agent-hooks.ts`, move the capability and bridge path, and generalize the launch service and tab APIs as listed**

- [ ] **Step 4: Run tests to verify they pass**

Run: `corepack pnpm vitest run tests/unit/lib/agent-hooks.test.ts tests/unit/lib/providers/ tests/unit/lib/status-hook-*.test.ts tests/unit/pages/layout-tabs-api.test.ts tests/unit/lib/agent-launch-service.test.ts && corepack pnpm exec tsc --noEmit`
Expected: PASS

- [ ] **Step 5: Commit** — `fix(agent): create agent tabs on the legacy runtime and share hook capabilities`

---

### Task 5: Client provider metadata, 화면의 Codex 고정 분기, 문구 버그

**Files:**
- Create: `src/lib/agent-provider-meta.ts`, `src/components/icons/agent-provider-icon.tsx`
- Modify: `src/hooks/use-web-input.ts:9,64,135`, `src/hooks/use-timeline.ts:251`, `src/hooks/use-session-list.ts:37`, `src/hooks/use-layout.ts:775,803,815`
- Modify: `src/components/features/workspace/agent-panel.tsx:39,48,210-211`, `src/components/features/mobile/mobile-agent-panel.tsx:55,230-231`
- Modify: `src/components/features/workspace/pane-container.tsx:639-643,686`, `src/components/features/mobile/mobile-surface-view.tsx:412,428`
- Modify: `src/components/features/workspace/pane-tab-item.tsx:114-115`, `src/components/features/mobile/mobile-navigation-sheet.tsx:216-217`
- Test: `tests/unit/lib/agent-provider-meta.test.ts` (create), `tests/unit/components/agent-panel-install-copy.test.ts` (create)

**Interfaces:**
- Consumes: Task 1 `TAgentPanelType`, `AGENT_PANEL_TYPES`, `DEFAULT_AGENT_PANEL_TYPE`, `isAgentPanelType`
- Produces:
  - `src/lib/agent-provider-meta.ts` (server module import 금지):
    ```ts
    export interface IAgentProviderMeta {
      panelType: TAgentPanelType;
      label: string;                      // 'Codex'
      newTabCommand: string;              // 'codex-new'
      restartCommands: readonly string[]; // ['/new', '/clear']
      exitCommand: string;                // '/exit'
      interruptSequence: string;          // '\x1b\x1b'
      keepTimelineOnSessionEnd: boolean;  // true
    }
    export const AGENT_PROVIDER_META: Readonly<Record<TAgentPanelType, IAgentProviderMeta>>;
    export const getAgentProviderMeta = (panelType: unknown): IAgentProviderMeta | null;
    ```
  - `src/components/icons/agent-provider-icon.tsx`: `AgentProviderIcon({ panelType, className }: { panelType: TAgentPanelType; className?: string })` — Codex는 기존 `OpenAIIcon`.
  - 화면 분기 교체 규칙: 탭의 실제 `panelType`으로 metadata를 찾는다.
    - `use-web-input`: 옵션에 `panelType?: TPanelType`를 받는다. 재시작 명령 집합과 중단 sequence는 metadata에서 읽고, metadata가 없으면 지금 값을 쓴다.
    - `use-timeline`: `panelType === 'codex'` 대신 `keepTimelineOnSessionEnd`를 쓴다.
    - `pane-container`, `mobile-surface-view`:
      - send-to-agent 대상은 현재 탭이 agent면 그 종류, 아니면 `DEFAULT_AGENT_PANEL_TYPE`이다.
      - pending input 적용 조건은 `isAgentPanelType(activePanelType)`이다.
      - 재시작은 `exitCommand`를 쓴다.
    - 기본값 `'codex'`(agent panel 2곳, `use-session-list`, `use-layout`의 `navigateToTabOrCreate` 3곳)는 `DEFAULT_AGENT_PANEL_TYPE`으로 바꾼다.
    - 탭 icon 2곳은 `AgentProviderIcon`으로 바꾼다.
  - 문구 버그: `agent-panel.tsx`와 `mobile-agent-panel.tsx`는 `installCodex`/`installCodexHint`를 `timeline` namespace에서 읽는다(`useTranslations('timeline')`). 문구 파일은 바꾸지 않는다.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/agent-provider-meta.test.ts`:
```ts
it('has metadata for every agent panel type', () => {
  for (const type of AGENT_PANEL_TYPES) expect(getAgentProviderMeta(type)?.panelType).toBe(type);
});
it('keeps the current Codex behavior values', () => {
  expect(getAgentProviderMeta('codex')).toEqual({ panelType: 'codex', label: 'Codex', newTabCommand: 'codex-new', restartCommands: ['/new', '/clear'], exitCommand: '/exit', interruptSequence: '\x1b\x1b', keepTimelineOnSessionEnd: true });
});
it('returns null for non-agent panels', () => {
  for (const type of ['terminal', 'diff', 'web-browser', 'claude', undefined]) expect(getAgentProviderMeta(type)).toBeNull();
});
```
`tests/unit/components/agent-panel-install-copy.test.ts`: `messages/ko/timeline.json`과 `messages/en/timeline.json`에 `installCodex`, `installCodexHint`가 있고, `next-intl`의 `createTranslator({ locale, messages, namespace: 'timeline' })`로 두 key가 key 이름이 아닌 문장으로 나온다. 이어서 `agent-panel.tsx`와 `mobile-agent-panel.tsx` source에서 `installCodex`를 읽는 translator가 `useTranslations('timeline')`로 만든 것인지 검사한다(source 문자열 검사로 충분하다. 두 파일 모두 `useTranslations('timeline')`를 포함해야 한다).

- [ ] **Step 2: Run tests to verify they fail**

Run: `corepack pnpm vitest run tests/unit/lib/agent-provider-meta.test.ts tests/unit/components/agent-panel-install-copy.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement the metadata table and icon, then replace the listed sites**

`grep -rn "'codex'" src/hooks src/components` 결과는 `src/lib/agent-provider-meta.ts`, `AgentProviderIcon`, 설정 화면의 Codex 설정 탭(`settings-dialog.tsx`의 `TSettingsTab`), 새 탭 메뉴·보기 전환·단축키(단계 2 대상)만 남아야 한다. 남은 곳을 commit message 본문에 적는다.

- [ ] **Step 4: Run tests and lint**

Run: `corepack pnpm vitest run tests/unit/lib/agent-provider-meta.test.ts tests/unit/components/ tests/unit/hooks/ && corepack pnpm exec tsc --noEmit && corepack pnpm lint`
Expected: PASS, lint error 0

- [ ] **Step 5: Commit** — `refactor(ui): drive agent panel behavior from provider metadata`

---

### Task 6: 문서, 전체 검증, Codex 회귀 확인

**Files:**
- Modify: `docs/RUNTIME-V2-CUTOVER.md` (2단계: agent 탭은 Runtime v2 agent 지원 전까지 v1으로 만든다는 규칙과 이유)
- Modify: `docs/STATUS.md` (Codex 전용 분기가 provider status 동작 flag로 바뀐 점과 flag 표)
- Modify: `docs/FOLLOW-UP.md` (Purplemux 기능 추가 행: 단계 1 완료와 다음 단계)
- Modify: `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md` (Current Lifecycle Stage, Next Action)

- [ ] **Step 1: Update the four documents as listed**

- [ ] **Step 2: Run the full gates**

Run: `corepack pnpm check:project-design && corepack pnpm check:product-name && corepack pnpm lint && corepack pnpm exec tsc --noEmit && corepack pnpm test && corepack pnpm build`
Expected: 모두 통과. lint는 error 0(기존 경고 6개 외 새 경고 없음). test는 실패 0.

- [ ] **Step 3: Run the isolated Runtime v2 smokes**

Smoke script는 `HOME`만 바꾸고 `TMUX_TMPDIR`는 바꾸지 않아, 그대로 돌리면 live tmux socket(`/tmp/tmux-1000/`)에 session을 만든다. 반드시 새 임시 `TMUX_TMPDIR`로 돌린다.

Run: `T=$(mktemp -d) && TMUX_TMPDIR="$T" corepack pnpm smoke:runtime-v2 && TMUX_TMPDIR="$T" corepack pnpm smoke:runtime-v2:phase2; TMUX_TMPDIR="$T" tmux -L codexmux kill-server 2>/dev/null; TMUX_TMPDIR="$T" tmux -L codexmux-runtime-v2 kill-server 2>/dev/null; rm -rf "$T"`
Expected: 두 smoke 모두 `ok`. 실행 전후 `tmux -L codexmux ls`, `tmux -L codexmux-runtime-v2 ls`(기본 `TMUX_TMPDIR`)의 session 목록이 같다.

- [ ] **Step 4: Codex regression check in an isolated environment**

Codex 로그인 정보가 필요하므로 `HOME`은 그대로 둔다. 이 worktree의 production build를 아래 환경 변수**만** 더해 띄운다. Live drop-in의 다른 값(`AGENTMUX_BRIDGE_TRACE_URL` 등)은 복사하지 않는다.
- `AGENTMUX_DATA_DIR=<임시 dir>`, `TMUX_TMPDIR=<임시 dir>`, `PORT=<8122가 아닌 빈 port>`
- `AGENTMUX_RUNTIME_V2=1`, `AGENTMUX_RUNTIME_STORAGE_V2_MODE=default`, `AGENTMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`, `AGENTMUX_RUNTIME_TIMELINE_V2_MODE=default`, `AGENTMUX_RUNTIME_STATUS_V2_MODE=default`

사용자 `~/.codex/config.toml`은 고치지 않는다. 임시 data dir의 `config.json`에 `codexApprovalPolicy: "on-request"`, `codexSandbox: "read-only"`를 넣어 그 서버가 띄우는 Codex에만 적용한다. Workspace directory는 Codex가 이미 신뢰하는 directory(이 worktree의 상위 repo 등)를 쓴다. Codex folder trust 확인이 뜨면 수락하지 않는다(수락하면 사용자 `~/.codex/config.toml`에 기록된다). 아래를 확인한다:
1. 새 탭 메뉴로 Codex 탭을 만들면 session 이름이 `pt-…`(v1)이고 Codex가 시작된다. 같은 서버에서 plain terminal 탭은 `rtv2-…`(v2)로 만들어진다.
2. 짧은 prompt → `busy` → `ready-for-review` 전환이 sidebar에 나타난다.
3. 같은 탭을 다시 열면 timeline이 보이고 resume 목록에 세션이 있다.
4. 파일 쓰기를 요구하는 prompt를 보내 권한 요청 화면이 뜨면, 웹 카드에 선택지가 나오고 "거절" 선택이 그 session에 들어간다.
5. 확인 뒤 임시 서버를 끄고, 임시 `TMUX_TMPDIR`의 두 tmux server를 `kill-server`로 끄고, 임시 directory를 지운다.

결과는 handoff 문서에 기록한다. Live service에는 배포하지 않는다(배포는 단계별 사용자 확인).

- [ ] **Step 5: Commit** — `docs: record agent boundary refactor and legacy agent tabs`
