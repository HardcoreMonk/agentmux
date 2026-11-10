# Claude Code provider 단계 2 Plan Review

- 작성일: 2026-11-10
- Spec: `../specs/2026-11-10-claude-code-provider-design.md`
- Plan: `../plans/2026-11-10-claude-code-provider-phase2.md`
- 방식: plan을 쓰지 않은 독립 reviewer(read-only)가 plan과 코드를 대조했다. Claude가 결정에 필요한 사실 두 가지를 격리 tmux에서
  직접 확인했다(prompt를 보내지 않음, 응답하지 않고 종료, 신뢰 기록 없음 확인).
- 결과: approve with changes → 반영 완료

## Claude가 직접 확인한 사실 (Claude Code `2.1.322`)

- `/clear`를 입력하면 `~/.claude/sessions/<pid>.json`의 `sessionId`가 새 값으로 바뀐다. Process 인자(`--session-id`)는 바뀌지 않는다.
- 신뢰되지 않은 directory의 folder trust 화면은 "Accessing workspace:" 다음 줄에 경로를 보여 준다. 선택지는 번호 없이
  "No, exit"(기본 선택), "Yes, I trust this folder" 순서다. 응답하지 않고 종료하면 `~/.claude.json`에 신뢰 기록이 남지 않는다.

## 결과와 처리

| # | 심각도 | 지적 | 처리 |
| --- | --- | --- | --- |
| 1 | HIGH | Process 인자를 먼저 보는 session 감지가 `/clear` 뒤 hook이 묶은 새 session을 30초 안에 옛 session으로 되돌리고, timeline도 새 session을 따라가지 못한다 | 위 사실에 따라 감지 순서를 pidfile → args → 최신 JSONL로 바꿨다(Task 3). Smoke 6번에 35초 대기 뒤 tab id와 timeline 확인 추가 |
| 2 | MEDIUM | needs-input 해제 규칙이 terminal에서 거절·Esc한 경우 탭을 busy에 묶어 둘 수 있다 | Synthetic interrupt 검사보다 먼저 판단하고, `interrupted`면 `idle`로 간다(Task 2) |
| 3 | MEDIUM | `SessionStart(compact)`가 작업 중에 와서 idle로 바꿀 수 있다 | `SessionStart` matcher를 `startup\|resume\|clear\|fork`로 한정(Task 4) |
| 4 | MEDIUM | statusLine 명령에 `ELECTRON_RUN_AS_NODE=1`이 없다 | 추가하고 test로 고정(Task 4) |
| 5 | MEDIUM | 무한 호출 방지가 파일 이름 기준이면 사용자 `~/.claude/statusline.sh`도 막힌다 | agentmux script의 절대 경로로만 막고, 사용자 script 실행 test 추가(Task 4) |
| 6 | MEDIUM | `~/.claude.json`은 Claude가 시작마다 쓰므로 checksum이 같을 수 없다 | Checksum에서 빼고 임시 directory의 `hasTrustDialogAccepted`가 true가 아님을 확인(Task 10) |
| 7 | MEDIUM | Task 1은 이후 build만 보호하고 단계 1 build로 되돌리는 경우는 막지 못한다 | Task 1만 먼저 main에 merge·배포하고, rollback 절차에 Claude 탭 닫기를 적는다(Task 1 Step 6) |
| 8 | LOW | 새 `updateTabFromHook` 시그니처가 compact 이벤트를 type에서 뺀다 | `event: string` 유지(Task 2) |
| 9 | LOW | Trust 카드 조건의 `check`는 cliState가 아니다 | cliState `inactive`/`unknown` 또는 sessionView `check`(Task 8) |
| 10 | LOW | 각 task가 깨뜨리는 기존 test가 목록에 없다 | Task 2, 4의 Files와 실행 목록에 추가, builder 이름 변경 명시 |
| 11 | LOW | 다시 묶기 test harness가 없고, 새 탭 status 등록에 `panelType`이 없다 | 판단을 `src/lib/status/hook-session-binding.ts` 순수 함수로 빼서 test, 등록 entry에 `panelType` 추가(Task 2) |

## Reviewer가 문제없다고 확인한 것

- Codex 동작: 새 flag가 Codex에서 false라 hook 필드 전달을 무시하고, Codex는 Notification hook을 등록하지 않는다.
  `statusBehavior`를 IPC로 보내는 곳이 없어 `.strip()` 변경은 방어용이다.
- Task 5가 `Record<TAgentPanelType, …>` 두 곳(metadata, icon)을 모두 다룬다.
- `buildResumeCommand` 호출처 세 곳이 이미 `tabId`와 `sessionName`을 넘긴다.
- `session-parser.ts`의 parser 함수 이름과 signature가 provider 계약과 맞다.
- 미리 저장한 session id와 첫 hook 사이에 race가 없다.
- `curl | bash` 설치 명령은 기존 brew 허용 방식과 같다. 단계 3 UI가 쓰기 전에 `RUNTIME_INSTALL_COMMANDS`에 claude 명령을
  넣어야 한다(Task 7에 포함).
