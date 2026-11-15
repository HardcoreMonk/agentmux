# Runtime v2 terminal 탭의 Git 설계 (설계 2-2 후속, 작은 변경)

- 작성일: 2026-11-15
- 상태: Approved — 2026-11-15 사용자: "설계 승인합니다"
- Lifecycle: `docs/FOLLOW-UP.md` "설계 2-2 후속"의 "Runtime v2 terminal 탭의 Git"이다. 사용자가 "후속 작업 순차 진행"을 지시했고, 방식 선택에서 "a"(worker 명령으로 지금 폴더 읽기)를 골랐다. Runtime v2 IPC 계약과 Git API 동작을 바꾸므로 Lightweight 경로를 쓰지 않는다. 작은 변경이라 짧은 설계와 계획을 이 문서 하나에 둔다.

## 의도와 이유

- live 설정(`AGENTMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`)에서는 웹으로 새로 연 일반 terminal 탭이 Runtime v2 탭(session `rtv2-…`)이다.
- Git API 6곳은 예전 tmux socket에서만 session을 찾는다. 그래서 이 탭에서는 404다.
  - `/api/layout/diff`, `cwd`, `git-log`, `commit-diff`, `file-content`, `/api/git/sync`
  - 영향 1: 설계 2-2의 Git 옆 패널과 기존 Diff mode가 이 탭의 저장소를 보여 주지 못한다.
  - 영향 2: 이 탭에서 pane을 분할하면 `/api/layout/cwd`가 실패해 새 pane이 home에서 열린다(설계 2-2 live 확인에서 봄).
- Runtime v2 session은 별도 tmux socket에 있고, 그 socket은 Runtime v2 terminal worker만 다룬다.
- worker runtime에는 session 정보(`getSessionInfo`: 지금 폴더, 명령, pid)를 읽는 함수가 이미 있다. 다만 IPC 명령으로 열려 있지 않다.

## 목표 / 비목표

- 목표
  - Runtime v2 terminal 탭에서도 Git 옆 패널, Diff mode, Git 동기화가 그 탭의 **지금 폴더**(`cd`를 따라감) 저장소를 쓴다.
  - Runtime v2 탭에서 분할한 새 pane이 같은 폴더에서 열린다.
- 비목표
  - Runtime v2 agent 탭 지원(hook 인증, 상태 감시 등). 이것은 별도 후속이다.
  - 예전 tmux 탭의 동작 변경
- Anti-goal: Next API 쪽 code가 Runtime v2 tmux socket을 직접 다루는 것. 경계가 깨지고 Windows runtime과도 맞지 않는다.

## Approaches

- **A. worker 명령을 새로 열어 지금 폴더 읽기 (사용자 선택):** terminal worker에 session 정보 명령을 더하고 supervisor를 거쳐 server가 부른다. `cd`를 따라가고 경계를 지킨다.
- **B. 저장된 시작 폴더(`tab.cwd`):** CLI가 쓰는 방식이다. 가장 작지만 `cd`를 따라가지 않아 Git 패널이 엉뚱한 저장소를 보일 수 있다.
- **C. API가 Runtime v2 socket을 직접 읽기:** 작지만 Runtime v2 경계를 깬다.

## 설계

1. **IPC**(`src/lib/runtime/ipc.ts`)
   - command `'terminal.session-info'`를 더한다. payload는 기존 `runtimeTerminalSessionSchema`(`{ sessionName }`)다.
   - reply는 `ITerminalRuntimeSessionInfo` 모양이다: `{ sessionName, exists, cwd: string | null, command: string | null, pid: number | null, startedAt: number | null, metadataSource: 'terminal-runtime' | 'process-inspector' | 'unavailable' }`.
2. **worker**(`terminal-worker-service.ts`)
   - `options.runtime.getSessionInfo`가 있으면 그 결과를 돌려준다.
   - 없으면 `hasSession` 결과로 `exists`를 채우고, 나머지는 null, `metadataSource: 'unavailable'`로 둔다.
3. **supervisor**(`supervisor.ts`)
   - `getTerminalSessionInfo(input: { sessionName: string }): Promise<ITerminalRuntimeSessionInfo | null>`를 더한다.
   - `ensureStarted()` 뒤 terminal worker에 바로 묻는다. `runtime-v2-terminal-session-not-found`이면 null이다.
   - storage의 ready terminal 탭은 확인하지 않는다(구현 중 controller 결정, 격리 확인에서 찾음). 그 조회는 `panel_type = 'terminal'`만 찾아서, Diff mode로 바꾼 Runtime v2 탭이 404가 된다. 폴더 읽기는 읽기 전용이고 worker가 이름 형식과 session 존재를 확인한다.
4. **server helper**(새 파일 `src/lib/session-cwd.ts`)
   - `resolveSessionCwd(sessionName: string, deps?): Promise<{ exists: boolean; cwd: string | null }>`
   - session 이름이 `RUNTIME_SESSION_PREFIX`(`rtv2-`)로 시작하는 경우
     - `AGENTMUX_RUNTIME_V2 !== '1'`이면 supervisor를 부르지 않고 `{ exists: false, cwd: null }`이다.
     - 아니면 `getRuntimeSupervisor().getTerminalSessionInfo(...)`를 부른다. 결과가 null이거나 `exists: false`이면 없는 것이다.
   - 그 밖에는 기존 `hasSession`과 `getSessionCwd`(`@/lib/tmux`)를 쓴다.
   - `deps`는 test용 주입이다. 기본값은 실제 함수다.
5. **Git API 6곳**
   - `hasSession` + `getSessionCwd` 조합을 `resolveSessionCwd`로 바꾼다.
   - 응답 code는 지금과 같다: 없으면 404 `Session not found`, 폴더가 없으면 지금의 오류 응답.
   - `/api/layout/cwd`의 `lastCommand`는 예전 탭에서만 `getLastCommand`를 쓴다. Runtime v2 탭은 null이다(분할은 `cwd`만 쓴다).
6. **문서**
   - `docs/FOLLOW-UP.md` "설계 2-2 후속"의 해당 행을 해결로 고친다.
   - `docs/ARCHITECTURE-LOGIC.md` 또는 Runtime v2 terminal 문서에 worker 명령 목록이 있으면 `terminal.session-info`를 더한다. builder가 `rg "terminal.has-session" docs`로 확인한다.

## 계획

- 작업 체계: agy(Herdr pane)가 구현하고 Claude가 검증한다. agy 사용량이 부족하면 model을 순서대로 바꾸고, 모두 쓰면 Claude subagent가 한다.
- Task 1 — IPC, worker, supervisor
  - test
    - `tests/unit/lib/runtime/terminal-worker-service.test.ts`
      - `terminal.session-info`가 runtime `getSessionInfo` 결과를 돌려준다.
      - `getSessionInfo`가 없으면 `exists`만 채운다.
    - `tests/unit/lib/runtime/supervisor.test.ts`
      - ready 탭이면 worker 결과를 돌려준다.
      - storage에 탭이 없으면 null이다.
      - session-not-found이면 null이다.
  - commit `feat(runtime): expose terminal session info to the server`
- Task 2 — helper와 Git API
  - test
    - `tests/unit/lib/session-cwd.test.ts`
      - `rtv2-` + 켜짐 → supervisor
      - `rtv2-` + 꺼짐 → 부르지 않음
      - 예전 이름 → tmux
      - supervisor null → 없음
    - route test가 이미 있는 곳은 그 test를 맞춘다.
  - commit `fix(git): read the Git folder of Runtime v2 terminal tabs`
- Task 3 — gate, 격리 확인, 배포(controller)
  - gate: lint, tsc 2종, 전체 test, 문서 gate, `pnpm build`
  - 격리 server(`new-tabs`)
    1. CLI로 Runtime v2 terminal 탭을 git 저장소 A에 만든다.
    2. Git 옆 패널에 A의 변경이 보인다.
    3. `cd`로 저장소 B에 간 뒤 새로고침하면 B가 보인다.
    4. 같은 탭의 Diff mode에도 B가 보인다.
    5. 이 탭에서 분할한 새 pane이 B에서 열린다.
    6. 예전 탭(Codex) Git 패널은 그대로다.
  - PR → CI → 로컬 merge → 사용자 배포

## 남은 위험

- 지금 폴더는 terminal의 맨 앞 process 기준(`pane_current_path`)이다. 예전 tmux 탭과 같은 기준이다.
- Runtime v2가 꺼진 server에서는 `rtv2-` session이 없으므로 지금처럼 404다.
