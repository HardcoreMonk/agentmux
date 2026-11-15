# 첫 입력 전 Codex 탭의 상태와 첫 화면 설계 (작은 변경)

- 작성일: 2026-11-15
- 상태: Approved — 2026-11-15 사용자: "후속 작업 승인 합니다.". 구현과 격리 확인 완료(아래)
- Lifecycle: `docs/FOLLOW-UP.md` "설계 2-2 후속"의 "CLI로 만든 Codex 탭의 첫 화면"이다. 사용자가 "후속 작업 순차 진행"을 지시했고, 방식 선택에서 "A로 진행"(기록 파일이 없을 때 화면으로 판단)을 골랐다. status 판정과 화면 전환 동작을 바꾸므로 Lightweight 경로를 쓰지 않는다. 작은 변경이라 짧은 설계와 계획을 이 문서 하나에 둔다.

## 확인된 사실 (2026-11-15 격리 재현, Codex 0.169.0, build `36be305d`)

- CLI(`agentmux tab create -t codex`)와 웹으로 만든 Codex 탭 모두, 첫 입력 전 입력창 앞에서 기다리는데 `cliState`가 `busy`다.
  - 탭에는 "처리 중", sidebar에는 "작업 중"이 뜬다.
- 원인: `src/lib/status-state-machine.ts` `reduceCodexState`
  - 규칙은 "Codex process가 돌고 기록 파일(JSONL)이 없으면 `busy`"다(`running && !hasJsonlPath`).
  - test "moves unknown tabs without a bound JSONL to busy silently"가 이 규칙을 고정한다.
  - Codex 0.169는 rollout 기록 파일을 첫 turn에 만든다. 그래서 입력 대기 Codex가 일하는 중으로 잡힌다.
- Codex 0.169 화면의 차이(이 session의 실제 화면)
  - 일하는 중에도 입력창(`› Ask Codex to do anything`)은 보인다. 그 위에 `• Working (27s • esc to interrupt)` 줄이 있다.
  - 입력 대기에는 이 줄이 없다.
- 첫 화면
  - 웹으로 만든 탭은 Codex가 뜨면 약 4초 안에 새 대화 입력창이 보인다. 웹이 탭을 "시작 확인 중(`check`)"으로 만들고, process가 감지되면 timeline으로 넘기기 때문이다.
  - CLI로 만든 탭은 이 client가 만든 탭이 아니다. 그래서 status 동기화에서 기본값(`session-list`)으로 생긴다.
  - 기존 규칙상 process가 감지돼도 session 목록은 유지된다. 그래서 첫 입력 전까지 예전 session 목록이 보인다. "새 대화"를 눌러야 한다.
  - 이 기존 규칙은 test "keeps the session list open when a Codex process is detected"로 고정돼 있다. 사용자가 일부러 연 session 목록을 지키려는 것이다.
- 앞서 본 "Codex 시작이 오래 걸리고 있습니다" 화면도 같은 원인이다. 첫 입력 전까지 신호가 없는 탭이 `check`에 60초 머물렀다.

## 목표 / 비목표

- 목표
  - 첫 입력 전 입력 대기 Codex 탭은 `idle`이다.
  - 실제로 일하는 Codex는 기록 파일 연결 전이라도 `busy`로 남는다.
  - CLI로 만든 Codex 탭도 Codex가 뜨면 새 대화 입력창을 보인다.
  - 사용자가 직접 연 session 목록은 지금처럼 유지된다.
- 비목표: 기록 파일이 있는 Codex 탭의 판정, Claude 탭, Runtime v2 agent 탭

## Approaches

- **A. 기록 파일이 없을 때 화면으로 판단 (사용자 선택):** 입력창이 보이고 working 줄이 없으면 `idle`, 아니면 지금처럼 `busy`다. 화면 판정은 설계 2-1의 `codex-screen.ts`를 쓴다.
- **B. 기록 파일이 없으면 무조건 `idle`:** 가장 작다. 대신 server 재시작 직후 등 기록 파일 연결 전에 일하는 Codex가 `idle`로 보일 수 있다.

## 설계

1. **화면 판정**(`src/lib/codex-screen.ts`)
   - `export const isCodexIdleAtComposer = (text: string): boolean`을 더한다. `isCodexTuiReadyContent(text)`가 참이고, 화면 끝부분(입력창 위)에 `esc to interrupt`가 없으면 참이다.
   - fixture `tests/fixtures/codex-screens/tui-working.txt`를 둔다. 위 실제 화면 모양이다: working 줄 + 입력창 + 상태줄.
2. **상태 판정**(`reduceCodexState`)
   - 입력에 `composerIdle?: boolean`을 더한다.
   - `running && !hasJsonlPath`일 때 순서는 다음과 같다.
     1. `needs-input`은 그대로 둔다(지금과 같음).
     2. `composerIdle === true`이면 `idle`이다. 지금 `idle`이면 unchanged다. 바뀔 때는 `silent: true, skipHistory: true`다. 첫 입력 전 상태라 알림과 기록을 남기지 않는다.
     3. 그 밖(false·undefined)은 지금처럼 `busy`다.
3. **status manager**(`src/lib/status-manager.ts`)
   - 주기 확인에서 `readTabMetadata` 결과가 다음 셋을 모두 만족할 때만 화면을 읽는다(`capturePaneContent(tab.sessionName)`).
     - Codex(`statusBehavior.reconcileStateFromJsonl`)
     - `running`
     - `jsonlPath`가 없음
   - `composerIdle = isCodexIdleAtComposer(screen)`을 `reconcileCodexState`에 넘긴다. 화면 읽기가 실패하면 `undefined`(지금 동작)다.
   - 기록 파일이 있는 탭과 다른 provider는 화면을 읽지 않는다.
4. **첫 화면**(`src/hooks/use-tab-store.ts`)
   - `ITabState`에 `sessionViewAuto?: boolean`을 더한다.
     - status 동기화가 기본값으로 탭 상태를 만들 때 true다(지금 `DEFAULT_TAB_STATE`를 쓰는 두 곳).
     - `setSessionView`나 `initTab`이 `sessionView`를 명시하면 false다.
   - 다음 조건을 모두 만족하면 `sessionView`를 `check`로 바꾼다. 그 뒤로는 기존 규칙(process 감지 → `timeline`)이 새 대화 입력창으로 넘긴다.
     - agent 탭(`codex`·`claude`)
     - `agentSessionId`가 없음
     - `sessionViewAuto`
     - `sessionView === 'session-list'`
     - 동기화된 `cliState`가 `idle`·`busy`·`needs-input`·`ready-for-review` 중 하나(agent가 떠 있음)
   - 바꿀 때 `sessionViewAuto`는 false로 둔다(한 번만).
   - 사용자가 연 session 목록(`sessionViewAuto` false)은 기존 test대로 유지된다.

## 계획

- 작업 체계: agy가 구현하고 Claude가 검증한다. agy 사용량이 부족하면 model을 순서대로 바꾸고, 모두 쓰면 Claude subagent가 한다.
- Task 1 — 화면·상태 판정과 status manager
  - test
    - `tests/unit/lib/codex-screen.test.ts`
      - `tui-ready.txt` → true
      - `tui-working.txt` → false
      - `hooks-review.txt` → false
    - `tests/unit/lib/status-state-machine.test.ts`
      - running·no JSONL·`composerIdle: true`
        - `busy` → `idle`(silent, skipHistory)
        - `unknown` → `idle`
      - `composerIdle: false`면 `busy`
      - 기존 "without a bound JSONL to busy" test는 `composerIdle` 없이 그대로 통과한다.
    - status manager 주기 확인 test가 있으면 화면 읽기 조건을 맞춘다(builder 확인).
  - commit `fix(status): treat a Codex tab waiting at its composer as idle before the first turn`
- Task 2 — 첫 화면
  - test `tests/unit/hooks/use-tab-store.test.ts`
    - status 동기화로 생긴 Codex 탭(`session-list`, auto)이 `cliState: 'idle'`이면 `check`가 된다.
    - 그다음 process 감지로 `timeline`이 된다.
    - `inactive`면 그대로다.
    - `initTab`으로 명시한 `session-list`는 그대로다(기존 test).
  - commit `fix(ui): open a new conversation on Codex tabs created outside the web`
- Task 3 — gate, 격리 확인, 배포(controller)
  - gate: lint, tsc 2종, 전체 test, 문서 gate, `pnpm build`
  - 격리 확인
    - CLI로 만든 Codex 탭
      - 입력창 앞에서 `idle`이고 "처리 중"이 아니다.
      - 웹에 새 대화 입력창이 보인다.
      - prompt 1개를 보내면 `busy`가 되고, 끝나면 `ready-for-review`다.
    - 웹으로 만든 Codex 탭도 `idle`이다.
    - 사용자가 연 session 목록이 유지된다.
  - `docs/FOLLOW-UP.md` 행 정리 → PR → CI → 로컬 merge → 사용자 배포

## 남은 위험

- 화면 문구가 Codex 판에 따라 바뀌면 판정이 `busy` 쪽(지금 동작)으로 떨어진다. 안전한 쪽이다.
- 기록 파일이 없는 Codex 탭은 주기 확인마다 화면을 한 번 읽는다. 첫 입력 전에만 해당하고 비용은 작다.

## 구현과 확인 결과 (2026-11-16)

- 구현
  - agy(Claude 검증): `e60acc28`(화면·상태 판정, status manager), `7eb5bbfa`(첫 화면 `sessionViewAuto`)
  - controller 보완 `737302e5`: agy가 설계 밖에서 바꾼 `updateFromServer` 계약 두 가지를 되돌리고, test가 실제 server 메시지 모양을 쓰게 고쳤다.
    - `agentSessionId`가 빠지면 기존 값을 유지하던 것
    - `workspaceId`를 선택 값으로 바꾼 것
  - 독립 검토(sonnet): 승인, 지적 0건.
- gate: lint error 0(기존 경고 6), `tsc --noEmit`와 deploy-check, 전체 test 2562 통과(임시 HOME, `CODEX_HOME` 없음), `pnpm build`
- 격리 확인(port 18122, build `737302e5`, Codex process의 격리 `CODEX_HOME` 먼저 확인)
  - CLI로 만든 Codex 탭(웹은 다른 탭을 보는 중, 새로고침 없음)
    - hook trust 뒤 입력창 앞에서 `idle`이었다. 웹에는 바로 새 대화 입력창이 보였다. 이전 build에서는 `busy`와 session 목록이었다.
  - 그 탭에서 prompt 1개
    - 보고 있을 때: 잠깐 "처리 중"이 뜬 뒤 `idle`이었다. 보는 탭이라 바로 읽음 처리됐다.
    - 다른 탭을 보는 동안 CLI `tab send`: `busy` → `ready-for-review`
  - 웹으로 만든 Codex 탭(home 폴더)
    - project hook 1개의 검토 화면 동안은 기존처럼 `busy`였다.
    - 입력창에 이른 뒤 약 11초 안에 `idle`이 됐다.
  - 사용자 파일 hash, live tmux session, `agentmux.service`는 그대로였다.
- 남은 점: 검토·trust 같은 막는 화면에 있는 Codex는 기존처럼 `busy`로 보인다. 입력을 기다리는 상태로 보이게 하는 것은 이번 범위 밖이다.
