# plan-eng-review: Claude Code provider 단계 4 (위임 안내와 CLI 변경)

- 대상: `docs/superpowers/plans/2026-11-11-claude-code-provider-phase4.md` (`a3a99d33`)
- Spec: `docs/superpowers/specs/2026-11-10-claude-code-provider-design.md` 4절, 2절 "실행과 탭 식별", Anti-goal, 인수 기준 10~13
- 검토: 독립 subagent(Opus, 읽기 전용, 2026-11-11). Controller(Claude)가 Critical·Important 근거를 코드에서 다시 확인했다.
- 결론: **approve with changes**. Critical 2, Important 5, Minor 8. 모두 계획에 반영했다.

## 확인된 결함과 반영

| # | 등급 | 내용 | 코드 근거 | 반영 |
| --- | --- | --- | --- | --- |
| C1 | Critical | Runtime v2 terminal 탭 `send`가 browser가 붙지 않은 탭에서 실패한다. `writeTerminalSession`은 attach된 PTY에만 쓴다 | `terminal-worker-runtime.ts:261-265` | Task 3에 `terminal.send-text`(`send-keys -l`)와 supervisor `sendTerminalSessionText`. spec의 `writeTerminalSession` 문장과 다르므로 Rulings "Runtime v2 입력"에 기록 |
| C2 | Critical | `hooks.json`이 같으면 `ensureHookSettings`가 일찍 return해 shim과 안내 파일이 만들어지지 않는다. Auto-resume이 그보다 먼저 돈다 | `hook-settings.ts:132`, `server.ts:501,546` | `server.ts`에서 auto-resume 전에 생성, 실행 명령을 만들 때마다 다시 확인, 안내 파일이 없으면 flag를 뺌. Task 2 test |
| I1 | Important | Storage default mode에서 위임 plain terminal 탭이 active가 된다(SQLite가 먼저 active로 기록). v2 재시작이 `createdByTabId`를 잃는다 | `repository.ts:408-421`, `layout-store.ts:358-381,470-484` | `restoreActiveTabId`, 같은 id 중복 push 방지, 재시작 뒤 `createdByTabId` 다시 쓰기. Task 4·5 test, Task 9 live 3a |
| I2 | Important | Auto-resume, timeline resume, workspace 생성 resume 경로의 Codex 탭이 환경 변수와 안내를 받지 못한다(`cwd` 없음) | `auto-resume.ts:76-80`, `resume-session-service.ts:193-197`, `api/workspace/index.ts:70-74` | Codex provider가 `getSessionCwd`로 cwd를 찾고, 환경 변수는 workspace·tab id만으로 붙임. Task 2 test |
| I3 | Important | `sendBracketedPaste`가 0.6초 뒤 보내는 두 번째 Enter가 그 사이 뜬 권한 요청을 승인할 수 있다 | `tmux.ts:355-363` | CLI 경로는 두 번째 Enter 전에 화면을 다시 읽고 권한 요청·시작 화면이면 보내지 않음. Task 5·6 test |
| I4 | Important | Codex status reconcile이 Codex 실행 전 `inactive`를 `idle`로 바꿔 준비 대기가 너무 일찍 끝난다. Codex update 안내 화면을 감지하지 못한다 | `status-state-machine.ts:82-86` | 준비 판정은 launch 이후 `session-start` hook 기준. 보내기 전 agent process 확인과 `matchAgentStartupScreen`(trust, Codex update). Task 5·6 test |
| I5 | Important | Migration 전 backup을 되돌리는 rollback은 배포 뒤 SQLite 자료를 잃고 현재 `layout.json`을 덮는다 | `layout-store.ts:115-121,143-170`, `storage-read-owner.ts:31-61` | DB 안에서 schema를 내리는 SQL(`RUNTIME_SCHEMA_V6_DOWNGRADE_SQL`)을 기본 rollback으로 하고 backup 복원은 비상용. Task 4 test, Task 9 확인 |
| M1 | Minor | Runtime v2가 꺼져 있어도 v2 탭 확인이 worker를 띄운다 | `supervisor.ts:691-706` | v2 꺼짐이면 supervisor를 부르지 않음 |
| M2 | Minor | 개수 제한 확인이 layout lock 밖이라 병렬 create가 6개를 넘길 수 있다 | `layout-store.ts:317-318` | workspace별 `withDelegationLock` |
| M3 | Minor | 안내의 `"instruction"` 예시가 backtick 확장을 부른다 | 안내 문장 | 작은따옴표 예시와 heredoc 안내 |
| M4 | Minor | 새 provider `cwd`가 `ICodexCommandOptions.cwd`(`--cd`)와 이름이 겹치고, Codex "끔 = 단계 3 명령" 확인이 builder 수준뿐이다 | `codex-command.ts:16-27` | `--cd`로 넘기지 않는다고 명시, provider 수준 test |
| M5 | Minor | 합친 `developer_instructions`가 tmux 명령 길이 한계를 넘을 수 있다 | `tmux.ts:319-329` | 12 KB 넘으면 안내 생략 |
| M6 | Minor | Test 파일 참조 오류(`.test.tsx`, 없는 helper·test) | `vitest.config.ts`, `storage-schema-migration.test.ts` | 파일 이름과 helper 생성 지시를 고침 |
| M7 | Minor | Live 확인의 needs-input 재현이 사용자 `defaultMode: auto`에서 안 될 수 있고, header 문구가 모순이다 | spec 99행 | 격리 config에 `claudePermissionMode: 'default'`, 문구 정리 |
| M8 | Minor | 인수 기준 13(배포 뒤 확인) 단계와 `docs/DATA-DIR.md` 갱신이 없다 | `AGENTS.md` | Task 9 Step 6과 DATA-DIR 항목 추가 |

## 그대로 둔 판단

- `developer_instructions` 값이 둘 이상이면 안내를 넣지 않는 규칙은 spec("실제로 적용될 값을 앞에")보다 좁다. 사용자 값을 덮어쓰지 않는 보수적 선택으로 받아들였다. CLI 문서에 이 경우를 적는다(Task 9).
- 보내기 전 확인에 `lastEvent`를 쓰지 않는다. Server 재시작 뒤 기존 탭은 `lastEvent`가 비어 있어 멀쩡한 탭을 거절하게 된다. 대신 agent process 확인과 화면 판정을 쓴다. 준비 대기(`tab create`)는 이번 실행의 `session-start`를 본다.
