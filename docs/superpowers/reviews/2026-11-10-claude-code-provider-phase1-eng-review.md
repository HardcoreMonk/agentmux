# Claude Code provider 단계 1 Plan Review

- 작성일: 2026-11-10
- Spec: `../specs/2026-11-10-claude-code-provider-design.md`
- Plan: `../plans/2026-11-10-claude-code-provider-phase1.md`
- 방식: plan을 쓰지 않은 독립 reviewer(read-only)가 plan과 코드를 대조했다. Claude가 HIGH 주장을 코드와 live
  log로 다시 확인했고, 범위를 바꾸는 1건은 사용자 결정을 받아 반영했다.
- 결과: approve with changes → 반영 완료

## 결과와 처리

| # | 심각도 | 지적 | 확인 근거 | 처리 |
| --- | --- | --- | --- | --- |
| 1 | HIGH | Runtime v2로 만든 Codex 탭은 hook, 상태 감시, timeline, storage 조회가 동작하지 않는다. 계획한 v2 화면 캡처 수정만으로는 고쳐지지 않는다 | `api/status/hook.ts:18-20` + `layout-store.ts:547`(`^pt-`만 허용), `tmux.ts:259`(옛 socket만 나열), `timeline-server.ts:383-386`, `storage/repository.ts:586`(`panel_type = 'terminal'`). Live log에 "rejected status hook target" 기록 | 사용자 결정: agent 탭은 v1으로 만들고 Runtime v2 agent 지원은 후속. Task 5·6(v2 캡처·key 입력) 삭제, Task 4에 v1 생성 규칙 추가. Spec 1절과 인수 기준 6 갱신, ADR-037 후보 추가 |
| 2 | MEDIUM | 필수 flag 추가가 strict 2-key IPC schema와 맞지 않아 `tsc`가 깨진다 | `runtime/ipc.ts:483-486`, `runtime/status/worker-service.ts:223-240` | Task 2: wire schema 유지, reducer·policy 입력을 `Pick<…>` type으로 |
| 3 | MEDIUM | `rtv2-` 이름을 Runtime v2가 꺼진 상태에서도 supervisor로 보내 worker를 띄운다 | `runtime/worker-client.ts:105`, `supervisor.ts:622-650` | #1 처리로 단계 1에서 해당 module이 없어짐. 단계 4 CLI v2 terminal 지원 spec에 "Runtime v2가 꺼져 있으면 v2 session은 없는 것으로 다룬다" 추가 |
| 4 | MEDIUM | 격리 smoke가 `TMUX_TMPDIR`를 바꾸지 않아 live tmux socket에 session을 만든다. Live drop-in의 trace URL과 Codex trust 수락이 live에 닿는다 | `scripts/smoke-runtime-v2-phase2-gate.mjs:80-89`, `bridge-trace-forwarder.ts:105` | Task 6 Step 3·4: 임시 `TMUX_TMPDIR`, 더할 환경 변수 목록 고정, trust 확인 수락 금지 |
| 5 | LOW | `resume-session-service.ts:96`의 Codex 분기와 `timeline-server.ts:376` 기본값이 빠졌다 | 해당 줄 | Task 2(resume service는 flag + `readJsonlStatus`), Task 3(기본값과 grep 범위) |
| 6 | LOW | 등록되지 않은 종류가 정규화 전에 저장되고, launch test가 registry 대신 mock을 쓴다 | `layout-store.ts:343`, `tests/unit/lib/agent-launch-service.test.ts:21-28` | Task 4: 요청 `panelType` 먼저 정규화, 기존 mock으로 test |
| 7 | LOW | `timeline-read-default.test.ts` mock 누락, poll-created bootstrap에 없는 값 단언, cache 삭제 export 누락 | `tests/unit/pages/timeline-read-default.test.ts:16-22`, `status-manager.ts:356,1147` | Task 3 test 추가, Task 2 단언 수정, `clearJsonlCheckCache` export |

## Reviewer가 문제없다고 확인한 것

- Hook capability 이동은 HMAC key, payload, `v: 1`, bridge 경로를 유지해 실행 중 Codex session의 capability가 유효하다.
- 새 module(`agent-hooks.ts`, `status/jsonl-check.ts`, providers index export)은 import cycle을 만들지 않는다.
- Status flag 대응은 두 flag가 `true`일 때 `status-manager.ts` 215, 533, 679, 1335, 1363행과 service들의 순서와 결과를 바꾸지 않는다.

## 후속 (이 설계 범위 밖)

- Runtime v2 agent 탭 지원: hook 인증(`rtv2-` 이름), 상태 감시(terminal worker 경유 pane 정보), timeline process 찾기,
  storage `panel_type` 구분, 화면 캡처와 key 입력.
