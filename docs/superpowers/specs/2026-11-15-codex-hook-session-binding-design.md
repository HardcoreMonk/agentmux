# Codex hook session 묶기 설계 (설계 2-1 후속, 작은 변경)

- 작성일: 2026-11-15
- 상태: Approved — 2026-11-15 사용자: "승인합니다."
- Lifecycle: 설계 2-1 후속(`docs/FOLLOW-UP.md` "열어 보지 않은 Codex 탭의 session 묶기"). 사용자가 "후속 작업 순차 진행"을 지시했고, 방식 선택에서 "session-start hook으로"를 골랐다. status 동작 계약을 바꾸므로 Lightweight 경로를 쓰지 않는다. 작은 변경이라 짧은 설계와 계획을 이 문서 하나에 둔다.

## 의도와 이유

- Codex 탭의 session id와 JSONL 경로는 UI timeline이 탭에 붙을 때만 layout에 기록된다.
- 그래서 위임으로 만들었거나 CLI `tab send`로만 prompt를 받은 Codex 탭에는 세 가지 문제가 있다.
  - UI에서 열면 session 목록 화면이다. timeline도 웹 입력도 없다.
  - server를 재시작하면 auto-resume할 session이 없다.
  - `tab status`·`tab result`는 status entry로 보완했지만(`5fe2318b`), layout에는 여전히 비어 있다.
- Claude 탭은 이 문제가 없다. launch 때 session id를 미리 쓰고(`createLaunchSessionId`), hook으로도 다시 묶기(`bindSessionFromHook: true`) 때문이다.
- Codex는 `bindSessionFromHook: false`다. hook이 가져온 id는 `status/hook-session-binding.ts` `decideHookSessionRebind`에서 버려진다.

## 확인된 사실 (2026-11-15 격리 실험, Codex 0.169.0)

- 세 hook의 stdin `session_id`는 rollout thread id와 같다. `transcript_path`는 그 rollout 파일 경로다.
- `/new`는 새 id로 `session-start`(source `startup`)를 보낸다.
- SessionStart는 첫 turn에 실행된다(설계 2-1 Task 1).
- Codex source(`core/src/hook_runtime.rs`)
  - thread-spawned sub-agent는 SessionStart 대신 SubagentStart를, Stop 대신 SubagentStop을 보낸다. agentmux는 이 두 event를 등록하지 않는다.
  - 내부 sub-agent는 start hook을 건너뛴다.
  - UserPromptSubmit은 sub-agent 입력에서도 그 sub-agent의 `session_id`로 올 수 있다.

## 목표 / 비목표

- 목표: hook trust가 있는 Codex 탭은 첫 turn(또는 `/new`, resume)의 SessionStart에서 layout에 session id와 JSONL 경로가 기록된다. 그 결과가 셋이다.
  - UI에서 열면 timeline이 보인다.
  - server 재시작 뒤 auto-resume이 그 session을 쓴다.
  - `tab result`가 layout 값으로 읽는다.
- 비목표: hook trust가 없는 Codex 탭. 그런 탭은 지금처럼 timeline attach와 status entry 보완으로 동작한다. process 탐지 결과를 layout에 쓰는 일과 `tab send`의 prompt claim은 하지 않는다(고르지 않은 방식).
- Anti-goal: sub-agent의 id로 탭을 다시 묶는 것. Claude 동작이 바뀌는 것.

## Approaches

| 방식 | 내용 | 득실 | 결정 |
| --- | --- | --- | --- |
| 1. session-start hook으로 묶기 | Codex는 `session-start` event에서만 hook의 id로 묶는다 | root 전용 event라 sub-agent에 잘못 묶이지 않는다. `/new`와 resume을 따라간다. hook trust가 있어야 한다 | **사용자 선택** |
| 2. process 탐지 결과 저장 | status의 `detectActiveSession`(cwd + 시작 시각 ±120초) 결과를 layout에 쓴다 | trust 없이도 동작한다. 같은 cwd에 탭이 여럿이면 잘못 짝짓고, poll마다 layout 쓰기가 생긴다 | 고르지 않음 |
| 3. `tab send`가 prompt claim 기록 | UI가 열 때 timeline이 session을 찾게 한다 | UI에서 열 때만 묶이고, 열어 보지 않은 탭의 auto-resume은 그대로 안 된다 | 고르지 않음 |

## 설계

- `IAgentProviderStatusBehavior`(`src/lib/providers/types.ts`)에 선택 field `bindSessionHookEvents?: readonly TEventName[]`를 더한다.
  - 없으면 지금처럼 모든 hook event에서 묶는다(Claude).
  - 있으면 목록에 있는 event에서만 묶는다.
  - 기존 test fixture가 쓰는 `bindSessionFromHook: boolean`은 그대로 둔다.
- Codex statusBehavior: `bindSessionFromHook: true`, `bindSessionHookEvents: ['session-start']`.
- `decideHookSessionRebind`가 `eventName`을 받는다. `bindSessionHookEvents`가 있고 `eventName`이 거기 없으면 `{ rebind: false }`다. 그 밖의 규칙(같은 id면 transcript가 다를 때만 다시 묶음)은 그대로다.
- `status-manager.ts` `updateTabFromHook`이 `rebindSessionFromHook`에 event를 넘긴다.
  - 이 경로는 legacy status와 Runtime v2 status worker(같은 `StatusManager`)에 공통이다.
  - layout 쓰기(`updateTabAgentSessionId`, `updateTabAgentJsonlPath`)는 Claude가 이미 쓰는 경로다.
- `resolveAndWatchJsonl`(`status-manager.ts` 1240행 근처)은 `bindSessionFromHook`이 켜지면 entry의 id를 먼저 쓴다. Codex에서도 hook으로 묶인 id를 쓰게 되고, 이는 의도한 동작이다.
- 문서: `docs/STATUS.md`의 flag 표(Codex `bindSessionFromHook` → `true`, `session-start`만)와 binding 설명. `docs/FOLLOW-UP.md`의 해당 행을 지운다.
  - 같은 PR에 설계 2-1 후속 live 확인 결과도 기록한다.
  - update 카드 live 확인: 격리 `version.json`으로 안내를 띄워 Skip과 Skip until next version을 확인했고, 30초가 지나도 잠금이 유지됐다.
  - 새로고침 잠금: session이 묶인 탭에서 약 2초(settle) 뒤 풀렸다.

## 계획

1. Test 먼저.
   - `tests/unit/lib/status-hook-session-binding.test.ts`
     - `bindSessionHookEvents: ['session-start']`이면 `session-start`는 다시 묶고, `prompt-submit`·`stop`은 묶지 않는다.
     - field가 없으면 모든 event에서 묶는다(기존 case).
   - `tests/unit/lib/providers.test.ts`: Codex 계약은 `bindSessionFromHook: true`, `bindSessionHookEvents: ['session-start']`. Claude는 field 없음.
   - status-manager 단위(기존 hook rebind test가 있으면 그 파일에)
     - Codex 탭에 다른 id의 `session-start` hook이 오면 `updateTabAgentSessionId`가 그 id로 불린다.
     - 같은 탭에 `prompt-submit`으로 다른 id가 오면 불리지 않는다.
2. 구현: 위 설계.
3. Gate: lint, tsc 2종, 임시 HOME·`CODEX_HOME` 없음으로 전체 test, build.
4. 격리 live 확인(격리를 먼저 증명한다)
   - CLI로 Codex 탭을 만들고 CLI `tab send`로 prompt 하나를 보낸다. 그러면 layout(`tab status`의 `agentSessionId`)에 rollout id가 있다.
   - 그 탭을 UI에서 열면 timeline과 웹 입력이 보인다.
   - Codex prompt 1개를 쓴다.
5. 검토(독립 reviewer), PR → CI → merge 확인 → 사용자 배포.

## 남은 위험

- hook trust가 없는 Codex 탭은 이 변경의 혜택이 없다. 지금 동작 그대로다.
- 첫 turn 전에는 SessionStart가 없으므로, prompt 전 server 재시작 때는 묶을 session도 없다. 이것이 맞는 동작이다.
