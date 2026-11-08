# 워크스페이스별 작업 유무 표시 Plan Grilling

- 작성일: 2026-10-24
- Spec: `../specs/2026-10-24-workspace-activity-label-design.md`
- 상태: Passed — 2026-10-24 사용자 설계 승인

## 코드와 문서에서 확인한 결정

| 점검 | 근거와 제안 |
| --- | --- |
| 기존 표시 재사용 | `WorkspaceItem`과 mobile navigation sheet가 공유하는 `WorkspaceStatusIndicator`에 대표 문구를 추가한다. |
| 기준 상태 | `use-tab-store`와 `selectTabDisplayStatus`를 사용한다. Terminal server와 browser/diff를 Codex 작업으로 세지 않는다. |
| 상태 혼재 | 입력 대기 → 작업 중 → 확인 필요 → 미확인 → 작업 없음 순으로 대표 문구를 고르고 기존 탭별 아이콘을 유지한다. |
| 상태 연결 끊김 | 기존 snapshot만으로 작업 없음을 보장할 수 없으므로 상태 확인 중으로 표시한다. |
| 초기 동기화 | `use-agent-status`는 WebSocket open에서 connected를 먼저 설정한다. Connected만 보고 작업 없음을 표시하면 오판할 수 있어 초기 sync와 누락 entry를 검증한다. |
| Mobile 펼침 | 현재 `!isExpanded` 조건으로 indicator를 숨긴다. 대표 문구는 펼침 상태에서도 표시한다. |
| 접근성과 폭 | 색상과 아이콘에만 의존하지 않고 짧은 번역 문구를 사용한다. 좁은 sidebar에서도 선택과 상태를 구분한다. |
| 아키텍처 | Client 표시 확장이다. Status Worker, runtime, storage와 public API 변경 및 새 ADR이 필요하지 않다. |
| 검증 | 판정/렌더링 회귀, 기본 test gate, desktop/mobile 한국어·영어 browser smoke를 계획한다. |

## 확정 사항

1. 왼쪽 workspace 목록의 각 항목과 mobile navigation sheet에 표시한다.
2. 사용자가 “권고 내용을 승인합니다”로 표시 대상과 spec을 승인했다.
3. 초기 sync 완료 boolean은 client에만 둔다. 새 연결을 시작하거나 종료할 때
   초기화해 이전 연결의 snapshot이 새 연결의 최신 상태로 표시되지 않게 한다.

열린 설계 질문과 design blocker 없음. 구현 계획 작성으로 진행한다.
