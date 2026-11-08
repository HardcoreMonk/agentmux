# agentmux 이름 변경 Plan Review

- 작성일: 2026-11-09
- Spec: `../specs/2026-11-09-agentmux-rename-design.md`
- Plan: `../plans/2026-11-09-agentmux-rename.md`
- 방식: plan을 쓰지 않은 독립 reviewer(read-only)가 plan과 코드를 대조했다. 감시자(Claude)가 HIGH 주장을
  코드로 재확인한 뒤 plan에 반영했다.
- 결과: approve with changes → 반영 완료

## plan-eng-review 결과와 처리

| # | 심각도 | 지적 | 확인 근거 | 처리 |
| --- | --- | --- | --- | --- |
| 1 | HIGH | 첫 전환이 `codexmux` socket만 옮겨 `new-tabs` 모드의 Runtime v2 tmux 서버가 stop 때 죽는다 | `src/lib/runtime/terminal-mode.ts:35-44` | Release 1: 두 socket 모두 adopt, cgroup·scope active 확인 뒤 stop |
| 2 | HIGH | 리허설·npm smoke가 HOME만 격리해 live tmux 서버에 붙는다 | `scripts/smoke-upload-integrity-lib.mjs:87`이 `TMUX_TMPDIR` 선례 | Global constraint, Task 1 vitest env, Task 5, Task 10. 옛 checkout build 금지 |
| 3 | HIGH | 전환 뒤 restart action과 `deploy:local`이 `codexmux.service`를 띄우고, health `app` 값이 lock 판별 key다 | `lifecycle-actions.ts:74-78`, `lock.ts:57`, `deploy-local.mjs:60` | Task 7a 추가. `app: 'codexmux'` 유지 + `product` 추가 |
| 4 | HIGH | 새 자동 재개 규칙이 legacy storage 경로에서 reboot 재개를 끈다 | `server.ts:470-472`, `layout-store.ts:212-220` | Task 7: startup 시작 시점의 session snapshot 기준으로 변경 |
| 5 | HIGH | 생성 hook bridge·statusline script가 `~/.codexmux`를 문자열로 박아 fresh install에서 status가 끊긴다 | `hook-settings.ts:24`, `statusline-script.ts:9-10` | Task 2 Step 4a |
| 6 | MEDIUM | `StartTransientUnit` 응답만으로 `adopted` 보고 | systemd job 모델(문서 기반, 미실측) | Task 6: cgroup 이동을 최대 5초 polling |
| 7 | MEDIUM | Rollback한 옛 build가 살아남은 shell tab에 resume을 입력 | `auto-resume.ts:84-101` | Release 2에 알려진 비용으로 기록 |
| 8 | MEDIUM | Memo된 `getDataDir()`가 test 격리를 깨고 import 시 real HOME에 별칭을 만든다 | `config-store.test.ts` 등 `vi.resetModules()` | Spec 보정: 해석은 부수효과·memo 없음, 생성은 `server.ts` startup만 |
| 9 | MEDIUM | Logger가 import 시 log dir을 만들어 layout 오판 시 `both-real`을 유발 | `logger.ts:5,36-44` | Task 2: 모든 layout의 `resolveDataDirPath` 단언 |
| 10 | MEDIUM | Electron `CONFIG_DIR` 유지가 spec과 충돌, fresh HOME에서 `both-real` | `electron/main.ts:52` | Task 2: posix 규칙 최소 복제 |
| 11 | LOW | 같은 process에서 env를 쓰는 smoke 2개는 이중화가 닿지 않는다 | `smoke-runtime-v2-storage-*.ts` | Task 3 Step 4 |
| 12 | LOW | Full realpath가 HOME 안 symlink를 풀어 journal 비교를 깨뜨릴 수 있다 | `scaffold-action-journal.ts:135-150` | Spec 보정: 별칭 한 단계만 해석 |
| 13 | LOW | 금지 query 집합 누락, header site는 5곳 | `runtime/api-auth.ts:21-31` | Task 4 Step 3 |

## plan-design-review

- 화면 변경은 이름 문구 교체뿐이며 새 조작 요소나 layout 변경이 없다. 한국어·영어 message를 함께 바꾼다.
- 운영자 실수 방지: data directory conflict는 시작 전 fail closed하고 두 경로와 reason을 출력한다. Restart
  action 확인 문구가 `restart agentmux.service`로 바뀐다. 첫 전환은 dry-run과 cgroup·scope 확인을 stop의
  전제 조건으로 둔다.
- 발견 가능성: README에 새 설치 명령, 옛 global package 제거 안내, 호환 이름 표를 둔다.
- Design blocker 없음.
