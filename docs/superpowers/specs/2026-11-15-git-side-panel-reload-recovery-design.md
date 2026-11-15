# Git side panel과 모바일 재연결 새로고침 설계 (설계 2-2)

- 작성일: 2026-11-15
- 상태: Approved — 2026-11-15 사용자: "승인합니다" (builder check 반영)
- Lifecycle: 설계 2(purplemux 대비 부족한 기능)의 두 번째 묶음.
  - 2026-11-10 사용자가 순서를 확정했고, 2026-11-15 "후속 작업 순차 진행"을 지시했다.
  - brainstorming에서 사용자가 범위와 방식을 정했다. 모바일 Git은 지금의 Diff mode로 충분하고, Git side panel은 "A로 진행"이다.
- 관련 문서: `docs/PURPLEMUX-ADOPTION-AUDIT.md` "보충 분석 (2026-11-10)" E 묶음과 P2 "resizable Git inspector"
- 비교 기준(purplemux `subicura/purplemux`)
  - `src/components/features/workspace/git-side-panel.tsx`, `terminal-page.tsx`
  - `src/lib/ws-reload-recovery.ts`, `src/hooks/use-terminal-websocket.ts`

## 의도와 이유

사용자의 목표는 여러 agent(Claude Code, Codex)를 한 화면에서 쓰는 것이다. agent가 일하는 동안 사람은 바뀐 내용을 보고 확인한다. purplemux에 있고 agentmux에 없는 기능을 순서대로 더하는 작업이기도 하다.

1. **Git side panel(desktop)**
   - 지금 agentmux의 Git 보기(`DiffPanel`: 변경 diff, history, fetch/pull/push, ahead/behind, sync 실패 시 "agent에게 묻기")는 탭의 보기 mode 중 하나(`diff`)다.
   - 그래서 열면 그 탭의 terminal이나 agent 화면을 대신한다. agent가 일하는 것과 Git 변경을 나란히 볼 수 없다.
2. **모바일 재연결 새로고침**
   - agentmux는 WebSocket 재연결을 끝없이 시도한다(최대 30초 간격, `src/lib/reconnect-policy.ts`).
   - 모바일 browser와 Android 앱의 WebView는 background에서 돌아온 뒤 재연결이 계속 실패할 때가 있다. 이때는 page를 새로 열어야 복구된다. 지금은 그 안내가 없다.

## 목표

1. desktop workspace 화면 오른쪽에 Git side panel을 연다. focus된 탭의 폴더를 따라간다.
2. side panel에서 sync가 실패하면 "agent에게 묻기"로 focus된 탭의 agent에게 실패 내용을 넘긴다.
3. 그 탭의 agent가 turn을 마치면(Stop) side panel이 곧 새로고침된다.
4. 모바일이나 Android 앱에서 화면이 보이는 상태로 재연결이 연속 5번 실패하면 "새로고침" 버튼을 보인다. 재연결 시도는 계속한다.

## 비목표

- 모바일 Git 전체 화면 overlay. 사용자 결정: 지금처럼 탭을 Diff mode로 바꾸는 것으로 충분하다.
- 기존 Diff mode를 바꾸거나 없애는 것. 그대로 둔다.
- pane마다 Git 패널을 두는 방식(방식 B)이나 옆 pane에 Diff 탭을 여는 방식(방식 C).
- desktop의 재연결 새로고침 안내. desktop은 사용자가 직접 새로고침할 수 있고, 끊긴 상태에는 이미 재연결 버튼이 있다.
- Git 동작(diff, history, sync) 자체의 변경.

## Anti-goal

- side panel이 사용자가 모르게 agent에게 prompt를 보내는 것. "agent에게 묻기"는 지금 Diff mode처럼 agent의 웹 입력창에 내용을 채우기만 한다. 보내기는 사람이 한다.
- 재연결 실패를 이유로 page를 자동으로 새로고침하는 것. 입력 중인 내용이나 화면 상태를 잃는다.

## Approaches

### Git side panel

| 방식 | 내용 | 득실 | 결정 |
| --- | --- | --- | --- |
| A. workspace 오른쪽 패널 | workspace 오른쪽에 패널 하나. focus된 탭의 폴더를 따라감. 버튼으로 열고 닫음. 열림과 너비를 기억 | 상태가 하나라 단순하다. pane을 나눠 써도 패널은 하나다 | **사용자 선택** |
| B. pane마다 나란히 | 각 pane 안에 Git 패널을 둔다 | pane별로 따로 볼 수 있다. pane이 여럿이면 화면이 좁아지고 상태도 pane 수만큼이다 | 고르지 않음 |
| C. 옆 pane에 Diff 탭 | 기존 split으로 옆 pane을 만들고 Diff 탭을 연다 | 새 component가 없다. 탭마다 shell session이 하나 더 생기고 focus를 따라가지 않는다 | 고르지 않음 |

### 모바일 재연결 새로고침

방식은 하나다. 실패가 쌓이면 버튼을 보이고 시도는 계속한다. 자동 새로고침은 Anti-goal이다. 시도를 멈추는 방식은 일시적인 끊김에서 복구를 막는다.

## 현재 사실 (2026-11-15 조사)

- Desktop 화면 구성
  - `src/components/features/workspace/terminal-page.tsx`가 `ContentHeader`와 `PaneLayout`을 그린다.
  - `ContentHeader`(`content-header.tsx`)에는 TERMINAL/CODEX/CLAUDE 보기 전환, 에디터 열기, 수직·수평 분할 버튼이 있다.
  - focus된 pane은 `layout.layout.activePaneId`다.
- Git 보기
  - `src/components/features/workspace/diff-panel.tsx` `DiffPanel({ sessionName, onSendToAgent })`. 탭의 tmux session 이름으로 cwd를 찾는다.
  - 10초마다 변경을 확인하고(`POLL_INTERVAL`), `visibilitychange`에도 확인한다.
  - sync 실패 toast의 "agent에게 묻기" 버튼은 `onSendToAgent(text)`를 부른다. 문구는 `askAgent`이고 대상 이름은 지금 `DEFAULT_AGENT_PANEL_TYPE`이다.
- Diff mode의 "agent에게 묻기"
  - `pane-container.tsx` `handleSendToAgent`가 처리한다.
  - 그 탭을 agent 보기로 바꾸고(지금 agent 탭이면 그 agent, 아니면 기본 Codex), 내용을 웹 입력창에 채운다(`pendingAgentInputRef`). 보내지는 않는다.
- Layout 저장: `ILayoutData`(`src/types/terminal.ts`)는 `root`, `activePaneId`, `updatedAt`만 있고 Git 패널 설정이 없다. Runtime v2 storage도 이 모양으로 저장한다.
- 재연결
  - `src/hooks/use-terminal-websocket.ts`, `src/hooks/use-timeline-websocket.ts`가 재연결한다. `isRetriableTerminalClose`면 계속 시도하고, 시도 수는 `retryCount`다.
  - 연결 상태 표시는 desktop `connection-status.tsx`, 모바일 `mobile-surface-view.tsx` 720행 근처다.
  - 모바일 판정은 `src/hooks/use-is-mobile-device.ts`(user agent 또는 touch)다. Android 앱도 Android user agent라 여기에 든다.
  - Capacitor 앱의 background·foreground 처리는 `use-terminal-websocket.ts`의 `nativeBackgroundPaused`와 foreground reconnect 경로가 맡는다.

## 설계

### 1. Git side panel

- **위치와 열기**
  - `terminal-page.tsx`의 `PaneLayout` 오른쪽에 resizable 영역(기존 `react-resizable-panels` 사용)으로 둔다.
  - `ContentHeader`에 Git 아이콘(`GitCompareArrows` 등)과 text tooltip이 있는 열기·닫기 버튼을 둔다.
  - 모바일 layout에는 두지 않는다.
- **상태 저장** — controller 판단: 브라우저별 `localStorage`(workspace id별 열림 여부와 너비)
  - layout에 넣으면 Runtime v2 storage schema가 바뀐다.
  - 이것은 기기별 보기 설정이다. 화면 크기가 다른 기기마다 너비가 달라야 하므로 layout보다 맞다.
  - 너비 범위는 builder 재량이다(예: 20~60%, 기본 35%).
- **따라가는 탭**
  - focus된 pane의 active 탭이 session을 가진 탭(terminal, codex, claude)이면 그 탭의 `sessionName`으로 `DiffPanel`을 그린다.
  - focus가 session 없는 탭(web browser)으로 가면 직전 대상을 유지한다. 직전 대상은 `terminal-page`의 메모리 state다. 저장하지 않는다. 대상 탭이 layout에서 사라지면 닫힌 것으로 본다(controller 판단).
  - 대상이 닫혔거나 처음부터 없으면 "terminal이나 agent 탭을 먼저 여세요" 안내를 보인다.
  - focus된 탭이 Diff mode면 같은 내용이 두 번 보인다. 막지 않는다.
- **"agent에게 묻기"**
  - side panel의 sync 실패 버튼은 **side panel이 지금 보이는 탭이 속한 pane**에 실패 내용을 넘긴다. 직전 대상을 유지하는 중이면 focus된 pane과 다를 수 있다. 화면에 보이는 Git 내용과 받는 agent가 같아야 하기 때문이다(controller 판단).
  - 그 pane의 `PaneContainer`는 지금 Diff mode와 같은 `handleSendToAgent`로 처리한다. 결과는 다음과 같다.
    - agent 탭이면 그 agent의 웹 입력창에 채운다.
    - terminal 탭이면 그 탭을 기본 agent(Codex)로 바꿔 채운다.
  - 보내지는 않는다.
  - 버튼 이름은 대상 agent 이름을 쓴다("Codex에게 묻기", "Claude Code에게 묻기"). 이름은 `handleSendToAgent`와 같은 규칙으로 정한다. 탭의 보기 mode가 agent면 그 agent, 아니면 기본 agent다(controller 판단).
  - 전달 수단은 builder 재량이다(window event, store 중 하나).
- **Stop 뒤 새로고침**
  - 따라가는 탭의 agent 상태가 `busy`에서 `ready-for-review`나 `idle`로 바뀌면 `DiffPanel`이 바로 변경 확인을 한 번 한다(`pollForChanges` 경로).
  - 상태는 `useTabStore`의 그 탭 `cliState`에서 읽는다. `terminal-page` 단계에서 구독하고, 전이 때 `DiffPanel`에 새 `refreshKey` prop 값을 넘긴다(controller 판단).
  - turn 종료가 아닌 이유로 `busy`에서 빠져나와도 확인 한 번이 더 생길 뿐이다. 확인은 hash 비교라 비용이 작으므로 허용한다.
  - 10초 polling은 그대로다.
  - 기존 Diff mode에도 같은 신호를 줄지는 builder 재량이다. 한 군데에서 처리할 수 있으면 함께 한다.
- **화면 규칙**
  - icon과 text label(또는 tooltip이 있는 icon 버튼)
  - DOM-safe
  - 새 문구는 ko·en 함께
  - 좁은 desktop 창(예: 1024px)에서도 pane이 너무 좁아지지 않게 최소 너비를 둔다

### 2. 모바일 재연결 새로고침

- **조건**
  - `useIsMobileDevice()`가 참이다.
  - `document.visibilityState === 'visible'`이다.
  - 연결이 끊긴 뒤 연속 재연결 실패가 5번 이상이다(`retryCount >= 5`). 첫 지연부터 합하면 약 31초다.
  - terminal WebSocket과 timeline WebSocket 둘 중 하나라도 조건을 넘으면 버튼 **하나**를 보인다(controller 판단).
    - `use-timeline-websocket.ts`는 반환값에 `retryCount` state를 더한다. 기존 반환 field는 그대로 두므로 추가만이다.
  - foreground 복귀 때 지금 경로가 시도 수를 0으로 되돌리는 동작은 그대로 둔다. 복귀 뒤에는 새로 5번을 센다(약 31초). 화면이 hidden이거나 `nativeBackgroundPaused`인 동안에는 버튼을 보이지 않는다(controller 판단).
- **표시**
  - 모바일 연결 상태 영역(재연결 중 안내)에 "새로고침" 버튼을 더한다.
  - 버튼은 `window.location.reload()`를 부른다.
  - 재연결 시도는 멈추지 않는다. 연결되면 버튼은 사라진다.
- 순수 판단 함수 하나로 둔다. 예: `shouldOfferReloadRecovery({ isMobile, visible, retryCount })`.
- 문구 예: "연결이 계속 실패합니다. 새로고침하면 복구될 수 있습니다." / 버튼 "새로고침". ko·en 함께.

## 인수 기준

1. desktop에서 Git 버튼으로 side panel을 열고 닫는다. 다시 열면 너비가 그대로고, page를 새로고침해도 열림 상태가 유지된다.
2. 두 pane에 서로 다른 폴더의 탭을 열고 focus를 옮기면, side panel이 focus된 탭의 폴더를 보인다.
3. agent 탭 옆 side panel에서 sync가 실패하고 "…에게 묻기"를 누르면, 그 agent의 웹 입력창에 실패 내용이 채워진다. 보내지는 않는다.
4. agent가 파일을 바꾸고 turn을 마치면, 10초를 기다리지 않고 side panel에 변경이 보인다.
5. 모바일에서 재연결이 5번 넘게 실패하면 "새로고침" 버튼이 보인다. 연결되면 사라진다. desktop에서는 보이지 않는다.
6. 회귀: 기존 Diff mode, 모바일 Diff mode, 재연결, Codex·Claude 탭 동작이 그대로다. 기존 test가 모두 통과한다.

## Builder 재량

- side panel 너비 범위와 기본값, 최소 pane 너비
- "agent에게 묻기" 전달 수단(window event나 store)
- Stop 신호를 Diff mode에도 줄지(한 군데 처리가 가능하면)
- keyboard shortcut(있으면 기존 keybinding 체계를 따른다)
- 재연결 안내의 정확한 위치와 문구

## 단계와 배포

- 하나의 계획, 하나의 PR.
- 구현은 agy가 하고 Claude가 검증한다(사용자 결정 2026-11-10). agy가 사용량 한도에 걸리면 Claude subagent가 한다.
- 격리 live 확인
  - 격리를 먼저 증명한다.
  - desktop side panel 동작과 Stop 뒤 새로고침을 확인한다(Codex prompt 1).
  - 모바일 재연결 안내는 모바일 viewport의 browser에서 server를 잠깐 멈췄다 다시 켜서 확인한다.
- 배포는 사용자가 한다.
