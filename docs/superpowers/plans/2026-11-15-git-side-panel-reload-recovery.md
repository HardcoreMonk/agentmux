# Git side panel과 모바일 재연결 새로고침 (설계 2-2) Implementation Plan

> **For agentic workers:** Task 1~3과 Task 4의 문서는 Herdr pane의 agy가 task 단위로 구현한다. Claude는 task마다 diff·test로 검증하고 독립 검토를 돌린다(사용자 결정 2026-11-10: "agy 구현, Claude 감시·검증"). agy가 사용량 한도에 걸리면 Claude subagent가 한다. Task 4의 gate와 live 확인은 controller가 한다. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** desktop에서 agent 화면 옆에 Git 패널을 열고, 모바일에서 재연결이 계속 실패하면 새로고침을 권한다.

**Architecture:** 결정은 순수 module에 둔다.
- Git 패널: 설정 저장, 따라갈 탭 고르기, turn 종료 판정, agent에게 넘기기 event.
- 재연결: 새로고침을 권할지 판정, 실패 수 store.

React 쪽(`terminal-page`, `content-header`, `diff-panel`, `pane-container`, `mobile-surface-view`)은 이 module을 연결만 한다. 그래서 이 repo의 vitest(`node` 환경)로 결정을 test할 수 있다.

**Tech Stack:** TypeScript, Next.js Pages Router, React, zustand, `react-resizable-panels`, next-intl(ko/en), vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-git-side-panel-reload-recovery-design.md` (Approved 2026-11-15)

**Base:** main `0e887fd4`, branch `feat/git-side-panel`, worktree `/data/projects/agentcode-zone/agentmux/.worktrees/git-side-panel`.

**Plan review:** 독립 reviewer(2026-11-15) approve with changes. Critical 3, Important 4, Minor 2를 반영했다(F1~F7, F9). F8(commit trailer)은 이 session의 attribution 지시를 따른다.

## Global Constraints

- 기존 Diff mode(`panelType: 'diff'`)와 모바일 Diff mode는 바꾸지 않는다.
- "agent에게 묻기"는 agent의 웹 입력창에 채우기만 한다. 보내지 않는다(spec Anti-goal).
- 재연결 실패를 이유로 page를 자동으로 새로고침하지 않는다. 재연결 시도는 멈추지 않는다.
- 화면 규칙
  - icon과 text label(또는 tooltip이 있는 icon 버튼, `aria-label` 필수)
  - DOM-safe(`innerHTML`, `dangerouslySetInnerHTML` 금지)
  - 새 문구는 `messages/ko`·`messages/en`에 같은 key로 넣고, 한국어는 `[word-break:keep-all]`
  - 버튼 touch target은 44px 이상(모바일 banner)
- `AGENTS.md` 규칙: Pages Router, `"use client"` 금지, `@/` import, 소문자-dash 파일명, arrow function, `I`/`T` 접두사.
- Test 환경
  - vitest `node` 환경이다. jsdom이 없다.
  - Component는 `renderToStaticMarkup`으로 버튼과 문구만 본다. 결정은 순수 함수에서 test한다.
  - Test 파일은 `.test.ts`만 돈다(vitest `include`). JSX를 쓰지 말고 `React.createElement`를 쓴다. Tooltip·popover 내용은 server render에 나오지 않으므로 `aria-label`·`aria-pressed`로 확인한다.
  - 명령: `H=$(mktemp -d /tmp/ca-h.XXXX); T=$(mktemp -d /tmp/ca-t.XXXX); env -u CODEX_HOME HOME=$H TMUX_TMPDIR=$T corepack pnpm vitest run <paths>; rm -rf "$H" "$T"`
- Commit은 Conventional Commits, 본문 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `--no-verify`, `git stash`, push 금지.
- live checkout `/data/projects/agentcode-zone/agentmux`, port 8122, `~/.codexmux`, 기본 tmux socket, 사용자 `~/.codex`·`~/.claude*`는 건드리지 않는다.

## Review Focus

1. **agent가 일하는 중에 Git 패널을 열고 닫을 때:** pane(terminal·timeline 연결, scrollback, 입력 중인 내용)이 다시 만들어지지 않는다. → Task 2 구조 규칙("항상 같은 `Group` 모양"), Task 4 live 확인
2. **이미 agent 보기인 탭에서 "…에게 묻기":** 그 탭의 웹 입력창에 바로 채워진다. 입력창이 없는 보기(session 목록, 시작 확인 중)면 안내만 보이고 내용이 엉뚱한 때 튀어나오지 않는다. → Task 2 `pane-container` 분기, Task 4 live 확인
3. **좁은 side panel의 diff:** split 보기로 깨지지 않고 unified로 보인다. → Task 2 `DiffPanel` `compact`
4. **패널이 따라가던 탭을 닫았을 때:** 다음 focus 탭으로 옮기거나, 없으면 안내를 보인다. 죽은 session으로 diff를 부르지 않는다. → Task 1 `git-side-panel-target.test.ts` "closed target"
5. **같은 pane에서 web browser 탭으로 바꿨을 때:** 패널은 직전 탭을 보이지만, "agent에게 묻기"는 web browser 탭을 agent로 바꾸지 않는다. → Task 1 "ask only when the target is its pane's active tab"

## Rulings (계획 작성 중 controller 결정)

- **Stop 뒤에는 `fetchDiff`로 새로고침한다:** spec은 "`pollForChanges` 경로"라고 적었다. 그런데 그 경로는 "업데이트 있음" 표시만 켠다. 인수 기준 4("10초를 기다리지 않고 side panel에 변경이 보인다")를 지키려면 전체 새로고침(`fetchDiff`)이 맞다.
- **"agent에게 묻기" 범위:** 패널이 보이는 탭이 그 pane의 active 탭일 때만 toast에 버튼을 둔다. 직전 대상을 보이는 중(같은 pane에서 web browser로 바뀐 경우 등)이면 버튼을 두지 않는다. 다른 탭을 agent로 바꾸는 사고를 막으려는 것이다(Review Focus 2).
- **Diff mode에는 Stop 신호를 넣지 않는다:** Diff mode는 agent 화면을 대신하므로, 그 탭의 agent turn을 보며 쓰는 경우가 드물다. 범위를 작게 둔다(spec builder 재량).
- **keyboard shortcut은 넣지 않는다:** YAGNI(spec builder 재량).
- **timeline hook 반환값에 `retryCount`를 더하지 않는다(spec과 다름):** timeline 실패 수는 store로 보고한다. timeline hook은 agent panel 깊은 곳에 있어 surface view가 반환값을 읽을 수 없다. store가 있으면 반환 field는 중복이다(plan review F5).
- **입력창이 없는 agent 보기에서 "묻기":** 안내 toast(`diff.askAgentNoInput`)만 띄운다. 숨은 pending 입력으로 남기지 않는다(plan review F3).

---

### Task 1: Git side panel의 순수 module

**Files:**
- Create: `src/lib/git-side-panel-prefs.ts`, `src/lib/git-side-panel-target.ts`, `src/lib/send-to-agent-event.ts`
- Test: `tests/unit/lib/git-side-panel-prefs.test.ts`, `tests/unit/lib/git-side-panel-target.test.ts`, `tests/unit/lib/send-to-agent-event.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // git-side-panel-prefs.ts
  export const GIT_SIDE_PANEL_DEFAULT_SIZE = 35;   // percent. react-resizable-panels에는 `${n}%` 문자열로 넘긴다(숫자는 pixel이다)
  export const GIT_SIDE_PANEL_MIN_SIZE = 20;
  export const GIT_SIDE_PANEL_MAX_SIZE = 60;
  export interface IGitSidePanelPrefs { open: boolean; size: number }
  export const clampGitSidePanelSize = (value: unknown): number   // 숫자가 아니면 기본값, 범위 밖이면 경계값
  export const readGitSidePanelPrefs = (workspaceId: string, storage?: Pick<Storage, 'getItem'> | null): IGitSidePanelPrefs
  export const writeGitSidePanelPrefs = (workspaceId: string, prefs: IGitSidePanelPrefs, storage?: Pick<Storage, 'setItem'> | null): void
  // key: `agentmux:git-side-panel:${workspaceId}`, JSON { open, size }.
  // storage 기본값은 window.localStorage. 없거나 throw하면 기본값과 no-op이다.

  // git-side-panel-target.ts
  export interface IGitSidePanelTarget { paneId: string; tabId: string; sessionName: string; panelType: TPanelType }
  export const resolveGitSidePanelTarget = (input: { root: TLayoutNode; activePaneId: string | null; previous: IGitSidePanelTarget | null }): IGitSidePanelTarget | null
  export const canAskAgentFromSidePanel = (input: { root: TLayoutNode; target: IGitSidePanelTarget | null }): boolean
  export const sidePanelAskAgentType = (target: IGitSidePanelTarget): TAgentPanelType   // agent 보기면 그 agent, 아니면 DEFAULT_AGENT_PANEL_TYPE
  export const isAgentTurnEnd = (previous: TCliState | undefined, next: TCliState | undefined): boolean   // previous === 'busy' && (next === 'ready-for-review' || next === 'idle')

  // send-to-agent-event.ts
  export const SEND_TO_AGENT_EVENT = 'agentmux:send-to-agent';
  export interface ISendToAgentDetail { paneId: string; tabId: string; text: string }
  export const dispatchSendToAgent = (target: EventTarget, detail: ISendToAgentDetail): void
  export const listenSendToAgent = (target: EventTarget, handler: (detail: ISendToAgentDetail) => void): () => void
  ```
- `resolveGitSidePanelTarget` 규칙
  - `panelType`은 `tab.panelType ?? 'terminal'`로 정규화한다(옛 terminal 탭은 값이 없다).
  - focus된 pane(`activePaneId`)의 active 탭이 session을 가지면(정규화한 `panelType`이 `terminal`·`codex`·`claude`·`diff`이고 `sessionName`이 있음) 그 탭이 대상이다.
  - layout 탐색은 `@/lib/layout-tree`의 `collectPanes`·`findPane`을 쓴다. `@/hooks/use-layout`은 store 전체를 끌어오므로 쓰지 않는다.
  - 아니면 `previous`의 `tabId`가 아직 layout 어딘가에 있으면 `previous`를 쓴다. 탭이 다른 pane으로 옮겨졌으면 `paneId`와 `panelType`을 지금 값으로 고친다.
  - 둘 다 아니면 null이다.
- `canAskAgentFromSidePanel`: target 탭이 자기 pane의 active 탭이고 `panelType`이 `diff`·`web-browser`가 아닐 때만 true다.

- [ ] **Step 1: Write the failing tests**
  - prefs
    - storage가 비면 `{ open: false, size: 35 }`다.
    - JSON이 깨졌으면 기본값이다.
    - `size: 90` → 60, `size: 5` → 20, `size: 'x'` → 35다.
    - write 뒤 read하면 같은 값이다(가짜 storage 객체).
    - storage가 throw해도 기본값이고, write는 throw하지 않는다.
  - target
    - focus된 codex 탭 → 그 탭이 대상(`panelType: 'codex'`)이다.
    - `panelType`이 없는 옛 탭 → `panelType: 'terminal'` 대상이다.
    - focus가 web-browser 탭으로 가면 `previous` 그대로다.
    - "closed target": `previous` 탭이 layout에 없으면 null이다.
    - 탭이 다른 pane으로 옮겨졌으면 `paneId`가 바뀐다.
    - `activePaneId`가 null이고 `previous`가 없으면 null이다.
  - ask
    - "ask only when the target is its pane's active tab": target이 pane의 active 탭이면 true다. 같은 pane의 active 탭이 web-browser로 바뀌었으면 false다.
    - `sidePanelAskAgentType`: `codex` → `codex`, `claude` → `claude`, `terminal` → `DEFAULT_AGENT_PANEL_TYPE`.
  - `isAgentTurnEnd`
    - `busy`→`ready-for-review` true, `busy`→`idle` true
    - `idle`→`busy` false, `undefined`→`idle` false, `needs-input`→`idle` false
  - event: `new EventTarget()`에 dispatch하면 listener가 같은 detail을 받는다. 해제 함수 뒤에는 받지 않는다.
- [ ] **Step 2: Run** → FAIL(module 없음)
- [ ] **Step 3: Implement** 위 Interfaces대로.
- [ ] **Step 4: Run** → PASS, `tsc --noEmit`
- [ ] **Step 5: Commit** — `feat(git): decide the Git side panel target, prefs, and turn end in pure modules`

---

### Task 2: desktop Git side panel 연결

**Files:**
- Create: `src/components/features/workspace/git-side-panel.tsx`, `src/components/features/workspace/git-panel-toggle-button.tsx`
- Modify
  - `src/components/features/workspace/terminal-page.tsx`: `PaneLayout`을 감싸는 horizontal `Group`, target·prefs·refreshKey state
  - `src/components/features/workspace/content-header.tsx`: Git 패널 열기·닫기 버튼(새 component `git-panel-toggle-button.tsx`를 배치)
  - `src/components/features/workspace/diff-panel.tsx`, `diff-file-list.tsx`: 선택 prop `refreshKey?: number`, `askAgentPanelType?: TAgentPanelType`, `compact?: boolean`
  - `src/components/features/workspace/pane-container.tsx`: `listenSendToAgent(window, …)`
  - `messages/ko/diff.json`, `messages/en/diff.json`, `messages/ko/terminal.json`, `messages/en/terminal.json`
- Test
  - `tests/unit/components/git-side-panel.test.ts`(create)
  - `tests/unit/components/git-panel-toggle-button.test.ts`(create)
  - `tests/unit/messages/git-side-panel-copy.test.ts`(create, ko·en json을 import해 새 key 존재 확인. 기존 `mobile-tab-header.test.ts`의 import 방식)

**Interfaces:**
- Consumes: Task 1 전부
- Produces
  - `GitSidePanel({ target, canAsk, askAgentPanelType, refreshKey, onClose, onSendToAgent })`
    - target이 없으면 안내 문구 `diff.sidePanelEmpty`("terminal이나 agent 탭을 먼저 여세요")를 보인다.
    - 있으면 `<DiffPanel key={target.sessionName} sessionName=… refreshKey=… askAgentPanelType=… onSendToAgent={canAsk ? … : undefined} />`다.
    - 닫기 버튼(`X` icon, `aria-label` `diff.sidePanelClose`)이 있다.
  - `GitPanelToggleButton({ open, onToggle })`: `GitCompareArrows` icon 버튼, `aria-pressed={open}`, `aria-label`은 `terminal.gitPanelOpen` / `terminal.gitPanelClose`, 같은 문구의 tooltip.
  - `ContentHeader` 새 props: `gitPanelOpen: boolean`, `onToggleGitPanel: () => void`. `GitPanelToggleButton`을 분할 버튼 근처에 둔다.
  - `DiffPanel`
    - `refreshKey`가 mount 뒤 바뀌면 `fetchDiff()`를 한 번 부른다(첫 값에는 부르지 않음).
    - sync 실패 toast의 대상 이름은 `getAgentLabel(askAgentPanelType ?? DEFAULT_AGENT_PANEL_TYPE)`이다.
    - `compact`면 diff를 늘 unified로 보이고 split/unified 전환 버튼을 숨긴다. `DiffFileList`의 `effectiveMode`에 연결한다. 저장된 `diff-output-format`은 바꾸지 않는다. side panel은 `compact`를 넘긴다.
    - prop이 없으면 지금과 같다.
  - `terminal-page.tsx`
    - prefs는 `activeWorkspaceId`가 바뀔 때 `readGitSidePanelPrefs(activeWorkspaceId)`로 읽는다(`TerminalPage`는 client 전용이라 초기 state에서 읽어도 된다). 열고 닫을 때와, `Group`의 `onLayoutChanged`로 받은 side Panel percent가 바뀔 때 `writeGitSidePanelPrefs`로 쓴다. `onLayoutChanged`는 끌기가 끝난 뒤 한 번 불리므로 debounce가 필요 없다(기존 `pane-layout.tsx:99` 방식).
    - **구조는 늘 같은 모양이다**: `Group orientation="horizontal"` > `Panel id="main" minSize={400}`(pixel). 그 안에 기존 `<div key={activeWorkspaceId} className="h-full"><PaneLayout …/></div>`를 둔다.
      - 열려 있을 때만 그 뒤에 `Separator`와 `Panel id="git"`(`minSize="20%"`, `maxSize="60%"`, `defaultSize={`${prefs.size}%`}`)을 조건부로 그린다.
      - 열림 여부로 `PaneLayout`의 부모를 바꾸면 모든 pane이 다시 만들어지므로(xterm, WebSocket, 입력 내용 소실) 금지한다.
    - target은 `resolveGitSidePanelTarget({ root, activePaneId, previous })`로 layout·activePaneId가 바뀔 때 다시 계산한다.
    - `useTabStore`에서 target 탭의 `cliState`를 구독한다. `isAgentTurnEnd(prev, next)`면 `refreshKey`를 올린다. 이전 값 ref는 target 탭이 바뀔 때 비운다(다른 탭의 `busy`로 헛 새로고침하지 않게).
    - "agent에게 묻기"는 `dispatchSendToAgent(window, { paneId: target.paneId, tabId: target.tabId, text })`다.
  - `pane-container.tsx`: `listenSendToAgent(window, handler)`, cleanup 포함. handler는 `d.paneId === paneId && d.tabId === activeTabId`일 때만 동작한다.
    - 지금 보기가 agent이고 웹 입력창이 보이면(`agentInputVisible`, `sessionView === 'timeline'`): `setInputValueRef.current?.(d.text); focusInputRef.current?.()`로 바로 채운다. `handleSendToAgent`는 부르지 않는다. 같은 보기로의 전환은 채우는 effect(`[activePanelType]`)를 돌리지 않고 `isPanelTransitioning`만 켜 둔다.
    - 지금 보기가 agent지만 입력창이 없으면(session 목록, `check`): toast `diff.askAgentNoInput`("{agent} 입력창이 아직 없습니다. 대화를 연 뒤 다시 누르세요")만 띄운다.
    - 그 밖(terminal 보기): 기존 `handleSendToAgent(d.text)`로 기본 agent 보기로 바꾸며 채운다.
- [ ] **Step 1: Write the failing tests**
  - `git-side-panel.test.ts`(`renderToStaticMarkup`, next-intl provider는 기존 component test 방식)
    - target null → 안내 문구와 닫기 버튼만 있다.
    - target 있음 → DiffPanel 자리가 그려진다. DiffPanel은 mock한다. sessionName과 askAgentPanelType이 넘어간다.
    - `canAsk: false` → DiffPanel mock이 받은 `onSendToAgent`가 undefined다.
  - `git-panel-toggle-button.test.ts`: `open` true/false에 따라 `aria-pressed`와 `aria-label`이 바뀐다.
  - `git-side-panel.test.ts`: DiffPanel mock이 `compact: true`를 받는다.
  - `git-side-panel-copy.test.ts`: 새 key(`diff.sidePanelEmpty`, `diff.sidePanelClose`, `diff.askAgentNoInput`, `terminal.gitPanelOpen`, `terminal.gitPanelClose`)가 ko·en 양쪽에 있다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `tests/unit/components`, `tests/unit/messages`, `tests/unit/lib`, tsc 2종, lint → PASS
- [ ] **Step 5: Commit** — `feat(ui): open a Git side panel next to the panes on desktop`

---

### Task 3: 모바일 재연결 새로고침

**Files:**
- Create
  - `src/lib/reload-recovery.ts`
  - `src/hooks/use-reconnect-failures-store.ts`
  - `src/components/features/mobile/mobile-reload-recovery-banner.tsx`
- Modify
  - `src/hooks/use-timeline-websocket.ts`: 실패 보고(terminal hook은 바꾸지 않는다. 이미 `retryCount`를 반환하고 surface view가 쓴다)
  - `src/components/features/mobile/mobile-surface-view.tsx`: banner 배치
  - `messages/ko/connection.json`, `messages/en/connection.json`
- Test: `tests/unit/lib/reload-recovery.test.ts`, `tests/unit/hooks/use-reconnect-failures-store.test.ts`, `tests/unit/components/mobile-reload-recovery-banner.test.ts`

**Interfaces:**
- Produces
  ```ts
  // reload-recovery.ts
  export const RELOAD_RECOVERY_FAILURES = 5;
  export const shouldOfferReloadRecovery = (input: { isMobile: boolean; visible: boolean; failures: number }): boolean
  // isMobile && visible && failures >= 5. native background pause 중에는 visibilityState가 hidden이고 실패 수도 오르지 않으므로 따로 받지 않는다

  // use-reconnect-failures-store.ts (zustand)
  // state: failures: Record<string, number>
  // actions: report(key: string, count: number): void; clear(key: string): void
  export const selectMaxReconnectFailures = (s: { failures: Record<string, number> }): number
  ```
- timeline hook의 보고
  - key는 hook instance마다 고유하다(`useId()` 등, 예: `timeline:${id}`). hook은 session 이름 옵션을 받지 않는다.
  - 재연결을 예약할 때마다 `report(key, retryCountRef.current)`를 부른다.
  - `onopen`(connected), foreground 복귀로 시도 수를 0으로 되돌리는 경로, 그리고 연결 effect의 cleanup(`enabled=false`, unmount, 의존값 변경 모두 지나는 곳, 지금 229-238행 근처)에서 `clear(key)`를 부른다. 그래야 꺼진 timeline의 실패 수가 banner를 띄우지 않는다.
- terminal 쪽은 `mobile-surface-view.tsx`가 이미 가진 `status`·`retryCount`를 쓴다. `status === 'reconnecting'`일 때만 `retryCount`, 아니면 0이다.
- `MobileReloadRecoveryBanner({ failures })`
  - `useIsMobileDevice()`와 page visibility(`useSyncExternalStore`로 `visibilitychange` 구독)를 읽는다.
  - `shouldOfferReloadRecovery`가 참일 때만 그린다.
  - 문구 `connection.reloadRecoveryMessage`("연결이 계속 실패합니다. 새로고침하면 복구될 수 있습니다."), 버튼 `connection.reloadRecoveryAction`("새로고침", `RotateCw` icon, `min-h-11`) → `window.location.reload()`.
- `mobile-surface-view.tsx`: `failures = Math.max(terminalFailures, useReconnectFailuresStore(selectMaxReconnectFailures))`를 banner에 넘긴다. 위치는 화면 위쪽 고정이고, 기존 connection status와 겹치지 않게 한다. 기존 `ConnectionStatus`는 `check` 보기에서 숨으므로 별도 banner로 둔다.
- [ ] **Step 1: Write the failing tests**
  - `shouldOfferReloadRecovery`
    - `failures: 4` false, `5` true
    - `isMobile: false` false, `visible: false` false
  - store
    - report 두 key(3, 6) → max 6
    - clear 뒤 → 3
    - "clear on connect": report(k, 4) → clear(k) → report(k, 1) → max 1
  - banner(`renderToStaticMarkup`, `useIsMobileDevice`와 visibility는 mock)
    - 조건 참 → 문구와 `aria-label` 있는 버튼
    - 거짓 → 빈 출력
  - messages: `tests/unit/messages/reload-recovery-copy.test.ts`(create)로 새 key ko·en 확인
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test, `tests/unit/hooks`, `tests/unit/lib`, `tests/unit/components`, 기존 `foreground-reconnect.test.ts`·`reconnect-policy.test.ts`, tsc 2종, lint → PASS
- [ ] **Step 5: Commit** — `feat(mobile): offer a reload after repeated reconnect failures`

---

### Task 4: 문서, gate, 격리 live 확인, 배포

**Files(문서는 agy):**
- `README.md`: 기능 목록에 Git side panel과 모바일 재연결 새로고침(있는 절에 한 줄씩)
- `docs/ANDROID.md`: 재연결이 계속 실패할 때의 새로고침 버튼
- `docs/PURPLEMUX-ADOPTION-AUDIT.md`: "agentmux에 없는 것" E 행에 반영 상태를 적는다. 모바일 Git 전체 화면은 사용자 결정으로 Diff mode 유지.
- `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`: "## 설계 2-2" 절(spec·plan 경로, commit 목록, live 결과 자리)

- [ ] **Step 1: 문서(agy)** — commit `docs: describe the Git side panel and the mobile reconnect reload`
- [ ] **Step 2: 전체 gate(controller)**: `check:project-design`, `check:product-name`, lint(error 0), tsc 2종, 임시 HOME·`CODEX_HOME` 없음으로 전체 test, `pnpm build`
- [ ] **Step 3: 격리 live 확인(controller)**
  - 이 worktree build로 격리 server를 띄운다(설계 2-1과 같은 `start.sh` 방식, 격리 `CODEX_HOME`).
  - 먼저 격리를 증명한다: tab process environ, 사용자 파일 sha256.
  - desktop(playwright)
    - Git 버튼으로 열고 닫는다. 너비를 바꾸고 다시 연다. page 새로고침 뒤 유지되는지 본다.
    - terminal 탭에 글자를 쳐 둔 채 패널을 열고 닫는다. 쳐 둔 내용과 scrollback이 그대로다(pane remount 없음).
    - 두 pane에 다른 폴더의 탭을 두고 focus를 옮긴다. 패널 폴더가 따라간다.
    - Codex 탭에서 파일 하나를 만들게 한다(Codex prompt 1). turn이 끝나면 패널에 바로 보인다.
    - sync 실패는 upstream 없는 branch에서 pull을 눌러 만든다. **이미 Codex 보기(timeline)인 탭**에서 "Codex에게 묻기"를 누르면 그 탭 웹 입력창에 채워지고 보내지지 않는다.
  - 모바일(playwright mobile viewport, Android user agent)
    - 연결된 상태에서 격리 server를 멈춘다. 약 31초 뒤 "새로고침" 버튼이 보인다.
    - server를 다시 켠다. 연결되면 버튼이 사라진다.
  - 안전 확인: 사용자 파일 sha256, live tmux session 목록, `agentmux.service` MainPID가 같다. 격리 자원을 정리한다.
- [ ] **Step 4: 기록과 commit(controller)** — handoff 절에 결과를 적는다. commit `docs: record the Git side panel checks`
- [ ] **Step 5: 배포(사용자 실행)** — PR → CI → merge 확인 → 사용자가 `git push agentmux main`과 `corepack pnpm deploy:local`을 실행한다. 배포 뒤 health와 log를 본다.
