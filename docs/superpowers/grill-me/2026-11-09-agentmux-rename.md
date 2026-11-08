# agentmux 이름 변경과 tmux 서버 분리 Plan Grilling

- 작성일: 2026-11-09
- Spec: `../specs/2026-11-09-agentmux-rename-design.md`
- 상태: Passed — 2026-11-09 사용자 설계 승인 "승인합니다, 계획 작성 진행해 줘"
- 방식: 실제 builder(agy, Herdr pane)가 read-only로 spec과 코드를 대조해 질문을 냈고, 감시자(Claude)가
  각 주장을 코드로 확인한 뒤 spec에 반영했다.

## 코드와 문서에서 확인한 결정

| 점검 | 근거와 결정 |
| --- | --- |
| Data directory 이전 | 옛 build의 upload store가 symlink된 base directory를 거부한다(`src/lib/uploads-store.ts:125-146`). 이번 release는 data를 옮기지 않고 `~/.agentmux` 별칭과 realpath 해석만 쓴다. |
| Governance journal | `preimagePath`를 backup root 기준 절대 경로와 엄격 비교한다(`src/lib/governance/scaffold-action-journal.ts:142-150`). 실제 경로가 바뀌지 않으므로 `writeState`가 유지된다. |
| Scaffold marker | `CODEXMUX:` marker와 template 문구는 Managed Project 문서의 영속 식별자라 유지한다(`src/lib/governance/scaffold-marker.ts:32-56`). |
| 자동 재개 | `executeAutoResume`은 이미 있던 session에도 resume을 보낸다(`src/lib/auto-resume.ts:84-102`). tmux가 살아남는 구조에서는 새로 만든 session만 재개한다. |
| tmux cgroup | tmux 3.6은 pane process를 `tmux-spawn-*.scope`로 이미 분리한다. Service cgroup에 남는 것은 tmux 서버와 attach client다. |
| 첫 전환 기법 | 격리 리허설 통과, live unit property 불변, 감시 하 적용 조건에서 builder 재량. |
| Live checkout | Live service는 `/data/projects/codex-zone/codexmux`에서 실행 중이며 새 거점은 이 저장소다. 옛 checkout과 그 인벤토리는 rollback source로 둔다. |
| Test 격리 | 기존 integration test가 실제 `codexmux-runtime-v2` socket을 쓴다. 새 tmux test는 test 전용 socket만 쓴다. |

## ADR 후보

- ADR-033 제품 이름 변경과 legacy 호환 alias (Draft)
- ADR-034 tmux 서버의 systemd unit 분리 (Draft)
- ADR-029 cookie 이름 갱신, ADR-030 npm package 이름 갱신

## 확정 사항

열린 설계 질문과 design blocker 없음. 구현 계획 작성으로 진행한다.
