# Claude Code provider와 agent 위임 안내 Plan Grilling (설계 1)

- 작성일: 2026-11-10
- Spec: `../specs/2026-11-10-claude-code-provider-design.md`
- 상태: Passed — 열린 설계 질문 없음
- 방식: 독립 builder check(subagent, read-only)가 spec과 코드를 대조해 9개 질문을 냈고, Claude가 각 주장을
  코드와 live 설정으로 확인했다. 사용자만 정할 수 있는 질문 1개(Claude Code 자체 권한 확인)는 사용자에게
  물었다. 이어서 Claude가 builder check가 다루지 않은 탭 단위 terminal 작업과 저장 구조를 따로 점검했다.

## 사용자 결정

| 질문 | 결정 |
| --- | --- |
| 기능 범위와 순서 | purplemux에 있고 agentmux에 없는 기능 추가. 설계 1 → 2 → 3 |
| 위임할 때 사용자 확인 | "확인 없이 바로 진행" |
| agentmux가 띄운 Claude Code에서 `agentmux tab` 명령 | "미리 허용". Live Codex가 `danger-full-access` + `approval_policy = "never"`라 Claude가 보낸 지시가 확인 없이 실행된다는 설명 뒤 결정 |
| 설계 승인 | "후속 작업 승인" |

## 코드와 설정에서 확인한 결정

| 점검 | 근거와 결정 |
| --- | --- |
| 두 번째 provider 등록 | `registerProvider`가 panel type 집합(`src/lib/panel-type.ts:3`)에 없는 값을 거절한다(`src/lib/providers/registry.ts:22`). 단계 1에서 agent 종류 집합으로 바꾼다. |
| 실행 서비스 | `launchAgentInTab`은 id가 `codex`가 아니면 거절하지만(`src/lib/agent-launch-service.ts:32`) Runtime v2 탭 입력(`writeTerminalSession`)은 이미 처리한다. Provider 조건만 일반화하면 재사용할 수 있다. |
| 위임 CLI와 Runtime v2 | `/api/cli/tabs*`는 옛 tmux socket(`src/lib/tmux.ts:18`)만 쓴다. Live service는 `AGENTMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`라 새 terminal 탭과 새 Codex 탭이 v2다. CLI가 탭의 `runtimeVersion`을 따르게 한다. |
| 권한 요청 화면 읽기 | `/api/tmux/permission-options`와 `/api/tmux/send-input`도 옛 socket만 쓴다(`capture-at-width.ts`, `send-input.ts:83-90`). Runtime v2 terminal IPC에는 화면 캡처 명령이 없다(`runtime/ipc.ts:808-816`). v2 탭에서 권한 요청 카드가 동작하지 않는 기존 결함이다. 단계 1에서 v2 화면 캡처 명령을 더하고 runtime별 경로를 쓴다. |
| Live 탭 분포 | Live layout에 v1 탭 68개, v2 탭 2개가 있다(2026-11-10). 두 경로가 함께 살아 있으므로 둘 다 지원한다. |
| CLI 위치 | `agentmux`, `amux`는 PATH에 없다. Service는 `node <checkout>/bin/agentmux.js`로 돈다. Data dir shim과 탭 PATH 앞붙이기로 정했다. |
| CLI의 agent 시작 | CLI `tab create`는 tmux session만 만든다(`api/cli/tabs/index.ts`, `addTabToPane`). 화면의 tab API는 `startAgent`로 server에서 띄운다. CLI도 같은 경로를 쓴다. |
| CLI `tab result` | 화면 캡처만 돌려준다(`api/cli/tabs/[tabId]/result.ts`). Agent 탭은 timeline의 마지막 assistant 응답을 돌려준다. |
| statusLine 수신 | `api/status/statusline.ts`가 `session_id`로 세션 통계를 묶고 rate limit을 단일 store에 쓴다. Provider별 store로 바꾼다. |
| Session Catalog schema | `create table if not exists`만 있고 migration 체계가 없다(`session-catalog/schema.ts`). Catalog는 다시 만들 수 있는 projection이라 provider column을 더할 때 drop + rebuild를 허용한다(builder 재량). |
| Codex 환경 변수 전달 | 사용자 `~/.codex/config.toml`에 `shell_environment_policy`가 없다(기본값). 기본 제외 규칙은 이름에 KEY/SECRET/TOKEN이 든 변수라 `AMUX_TAB_ID`, `AMUX_WORKSPACE_ID`는 해당하지 않는다. 구현 때 실제 전달을 test로 확인한다. |
| Codex `developer_instructions` | 사용자 `~/.codex/config.toml`에 없다. 단계별 값 보존 규칙은 spec대로 둔다. |
| Claude Code hook 계약 | 공식 문서로 확인한 표를 spec "Hook 계약 확인"에 담았다. `--settings`의 hook은 사용자 hook과 합쳐지고, statusLine은 대체된다(추론). |
| Claude 내부 session 파일 | `~/.claude/sessions/<pid>.json`은 형식이 문서화되지 않았다. 보조 단서로만 쓴다. |

## 용어 점검 (`CONTEXT.md`, `docs/agents/domain.md`)

- "로컬 Codex 세션", "Session Catalog(Codex JSONL에서 계산)", "Timeline(Codex JSONL)", "Status(Codex 작업
  상태)"의 정의가 Codex 전용이다. 단계 2 release에서 "로컬 Claude Code 세션"을 더하고 Session Catalog,
  Timeline, Status 정의를 agent JSONL 기준으로 넓힌다.
- 제품 정의의 "(현재 Codex 지원, Claude Code 지원 예정)"은 단계 3 release 뒤 "Codex와 Claude Code 지원"으로
  바꾼다.
- 새 용어 "위임(delegation)"은 Claude Code 안의 sub-agent와 구분한다.

## ADR 후보

- ADR-035: 사용자 agent 설정을 고치지 않고 실행 시점 flag로만 hook과 안내를 붙인다 (Draft)
- ADR-036: Agent 위임은 확인 없이 진행하고 신뢰 경계는 Unix 사용자로 둔다 (Draft)

## 확정 사항

열린 설계 질문과 design blocker 없음. Plan design review를 거쳐 구현 계획 작성으로 진행한다.
