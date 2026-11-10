# Claude Code provider 단계 3 Plan Review

- 작성일: 2026-11-11
- Spec: `../specs/2026-11-10-claude-code-provider-design.md`
- Plan: `../plans/2026-11-11-claude-code-provider-phase3.md`
- 방식: plan을 쓰지 않은 독립 reviewer(read-only)가 plan과 코드를 대조했다. Reviewer는 이 호스트의 Claude usage 배치와
  stats cache를 읽기 전용으로, 집계만 확인했다. Claude가 `claude --help`(2.1.322)로 print mode flag를 직접 확인했다.
- 결과: approve with changes → 반영 완료

## Claude가 직접 확인한 사실

- Live는 `AGENTMUX_RUNTIME_V2=1`이고 `AGENTMUX_SESSION_CATALOG_MODE`가 없다. 그래서 catalog는 `shadow` mode로
  만들어진다(reviewer는 `default`로 적었다). `shadow`에서도 `observeFile`은 돌기 때문에 결론은 같다.
- 단계 2 뒤 main에서 Claude JSONL에 줄이 붙으면 live watcher가 `observeFile`을 부르고, catalog가
  `catalog-path-forbidden`으로 거절한다. Worker에는 `unhandledRejection` handler가 없어서 timeline worker가 죽는다.
  Vitest에서 재현했다(`vi.fn`은 반환 promise에 settle handler를 붙여 거절을 가리므로 fake는 평범한 함수로 만들었다).
- Claude Code `2.1.322` print mode에 있는 flag: `--no-session-persistence`, `--tools ""`(모든 tool 끔),
  `--restricted`(user·project·local settings 파일을 무시), `--strict-mcp-config`, `--disable-slash-commands`.
  `--bare`는 OAuth를 읽지 않으므로 구독 로그인에서 쓸 수 없다.

## 결과와 처리

| # | 심각도 | 지적 | 처리 |
| --- | --- | --- | --- |
| 1 | HIGH | 거절된 `observeFile` promise를 아무도 받지 않아 timeline worker가 죽는다. Live watcher 경로는 main에서 이미 Claude transcript로 돈다 | Expedited hotfix로 먼저 고쳤다. PR #48, main `d1accfc6`, 2026-11-11 02:35 KST 배포. Task 1에 list 경로 test를 더하고, Task 3 Files에서 `worker-service.ts:295`를 뺐다 |
| 2 | HIGH | Panel type PATCH를 기다리지 않아 resume 실행이 옛 provider로 나간다 | `/api/agent/launch`에 `panelType`을 더한다. 서버가 탭 종류 변경 → session 연결 → 명령 입력을 차례로 한다(Task 2). Client는 성공한 뒤 local 상태만 맞춘다 |
| 3 | MEDIUM | 다른 provider로 재개할 때 탭의 session을 연결하지 않는다 | `launchAgentInTab`의 resume이 `updateTabAgentSession(..., { sessionId, jsonlPath: null })`을 먼저 부른다(Task 2) |
| 4 | HIGH | `claude -p` 리포트 fallback에 Codex 경로의 보호(`--ephemeral --sandbox read-only`)가 없다 | 인자를 고정했다: `-p --output-format text --no-session-persistence --restricted --tools "" --strict-mcp-config --disable-slash-commands`. cwd는 빈 임시 directory이고 끝나면 지운다. Test가 인자 전체를 확인한다(Task 5). Live 1회 확인을 Task 11에 더했다 |
| 5 | MEDIUM | Claude root가 없으면 catalog가 degraded가 된다 | 없는 root는 빈 root로 건너뛴다. Codex만 있는 호스트 test를 더했다(Task 3) |
| 6 | MEDIUM | `CACHE_VERSION`을 올리면 다시 계산할 수 없는 날짜가 사라진다 | v4 cache를 v5로 옮긴다. 원본 파일이 없는 날은 그대로 두고, 가장 이른 Claude transcript 날짜부터만 다시 계산한다(Task 5) |
| 7 | MEDIUM | Claude 메시지 수가 tool_result 줄 때문에 부풀려진다. 파일마다 따로 dedupe하면 같은 `message.id`를 두 번 센다 | Task 1에서 `isClaudeUserPrompt`를 만들고 Task 1·5가 함께 쓴다. Dedupe set은 계산 전체에 하나다(Task 5) |
| 8 | MEDIUM | `agentProcess`가 true가 되면 보기가 `check`에서 `timeline`으로 바뀌어 trust 카드가 사라진다 | 단계 2의 카드 위치는 그대로 둔다. 표시 판단을 순수 함수 `resolveAgentBootDisplay`로 빼고, 빈 timeline에도 진행 표시를 그린다(Task 7) |
| 9 | MEDIUM | jsdom·`renderHook`이 없어 일부 계획 test를 돌릴 수 없다 | 순수 helper를 test 대상으로 정했다(Task 2, 6, 7). 새 dependency는 없다 |
| 10 | LOW | Task 11 live 절차가 없다 | v1 Terminal 탭을 얻는 법과 Codex를 먼저 끝내는 절차를 적었다. Live 한계는 handoff와 `FOLLOW-UP.md`에 남긴다(Task 11) |
| 11 | LOW | Task 6 파일 목록이 모자라다 | `mobile-terminal-page.tsx`, `mobile-surface-view.tsx:76`의 prop type을 더했다(Task 6) |

## 문제 없음으로 확인한 것

- Claude 목록을 offset/limit 전에 합치면 Codex 목록의 순서와 개수는 그대로다.
- Catalog DB를 여는 곳은 timeline worker 하나이므로 `alter table`과 동시에 쓰는 곳이 없다.
- 이 호스트의 Claude transcript 412개는 모두 파일 이름과 같은 `sessionId` 하나만 가진다.
- 같은 `message.id`로 나뉜 줄은 usage가 같다(4,078 묶음 확인). 그래서 `message.id`를 dedupe key로 쓸 수 있다.
