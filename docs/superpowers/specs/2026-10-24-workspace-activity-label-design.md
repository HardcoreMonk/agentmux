# 워크스페이스별 작업 유무 표시

- 작성일: 2026-10-24
- 상태: Approved — 2026-10-24 사용자: “권고 내용을 승인합니다”
- 요청: 워크스페이스에 등록된 각각의 작업 목록에서 작업 유무를 표시한다.
- 현재 단계: code-review 완료, 로컬 검증 완료; live release/operate 미진입

## 문제와 제안 범위

Desktop sidebar의 `WorkspaceItem`과 mobile navigation sheet는
`WorkspaceStatusIndicator`로 탭별 작은 아이콘을 표시한다. 현재는 이 아이콘을
해석해야 작업 중인지 알 수 있고, 동기화된 빈 workspace에는 표시가 없다.

각 workspace 목록 항목에 Codex 작업 상태를 읽을 수 있는 짧은 문구를 추가한다.
사용자가 이 표시 대상과 아래 표시 계약을 승인했다.

## 표시 계약

기존 탭 아이콘과 함께 아래 문구 하나를 표시한다. 여러 탭이 서로 다른 상태이면
입력 대기, 작업 중, 확인 필요, 상태 미확인, 작업 없음 순으로 대표 상태를 고른다.
입력 대기가 있어도 작업 중인 다른 탭의 기존 아이콘은 유지한다.

| 조건 | 한국어 | 영어 |
| --- | --- | --- |
| 상태 연결이 끊김 또는 초기 동기화 전 | 상태 확인 중 | Checking status |
| Codex 탭 중 `needs-input` 있음 | 입력 대기 | Input needed |
| Codex 탭 중 `busy` 있음 | 작업 중 | Working |
| Codex 탭 중 `ready-for-review` 있음 | 확인 필요 | Review needed |
| Codex 탭 중 `unknown` 또는 상태 정보 누락 있음 | 상태 미확인 | Status unknown |
| 나머지 Codex 탭이 모두 `idle`/`inactive`, 또는 동기화된 Codex 탭 없음 | 작업 없음 | No active tasks |

- Workspace의 작업 유무는 Codex 작업을 기준으로 한다. Terminal의 상시 server,
  browser와 diff panel은 Codex 작업으로 세지 않는다.
- Desktop과 mobile navigation sheet에서 같은 판정과 번역을 사용한다.
- Mobile workspace를 펼친 뒤에도 대표 상태 문구를 확인할 수 있게 한다.
- 상태 문구는 좁은 sidebar와 mobile에서 잘리지 않게 배치하며, 색상 없이도 읽을 수 있다.
- WebSocket open만으로 초기 동기화가 끝났다고 판단하지 않는다. 알려진 layout의
  Codex 탭에 status entry가 없으면 작업 없음으로 단정하지 않는다.

## Domain Architecture

- 기존 `Workspace`, `Tab`, `Status`, `Workspace Activity` 용어를 사용한다.
- Workspace와 Managed Project, Session Catalog를 결합하지 않는다.
- UI는 `use-tab-store`의 서버 상태 projection과 기존 `selectTabDisplayStatus`를
  재사용한다. 작업 상태 감지, JSONL, process inspection과 notification 정책은 유지한다.
- 대표 상태 계산은 client의 순수 selector/helper로 두고 UI가 번역과 표현을 담당한다.
- 새 aggregate, durable state, API, worker, polling과 storage schema는 필요하지 않다.
- 기존 `TTabDisplayStatus` 의미는 유지한다. 연결/미확인 표시는 UI projection이다.
- 변경 후보는 workspace indicator, 필요한 store selector, mobile navigation sheet,
  한국어/영어 message, 회귀 테스트와 `docs/STATUS.md`이다.
- ADR 후보 없음: 기존 client 표시의 확장이며 runtime, persistence와 public API를 바꾸지 않는다.

## 인수 기준과 검증 계획

1. Workspace를 전환하지 않아도 목록에서 작업 중과 작업 없음을 구분한다.
2. 한 workspace의 상태가 다른 workspace의 문구에 영향을 주지 않는다.
3. 복수 탭, 입력 대기, 결과 확인, 상태 미확인과 연결 끊김을 구분한다.
4. 초기/재연결 동기화 전후에 작업 없음이 잘못 표시되지 않는다.
5. 기존 탭 아이콘, 선택 표시, rename, terminal과 입력 동작을 보존한다.
6. 한국어/영어, desktop 좁은 sidebar, mobile 펼침/접힘을 검증한다.
7. 판정 회귀 테스트와 component rendering 테스트를 추가하고 기본 gate
   (`check:project-design`, lint, TypeScript, unit suite)를 실행한다.
8. UI browser smoke로 상태 전환, overflow와 page error를 확인한다.

## 검토와 승인 경계

- Plan Grilling: `../grill-me/2026-10-24-workspace-activity-label.md`
- 사전 design 검토: 기존 semantic token과 텍스트를 함께 사용하고 selection과
  runtime 상태를 구분한다. 새 조작 요소나 terminal overlay는 추가하지 않는다.
- 설계 승인: 2026-10-24 사용자 메시지 “권고 내용을 승인합니다”.
- Design review: Pass. 짧은 텍스트와 기존 아이콘을 함께 사용하며 상태 색상을
  selection에 재사용하지 않는다. 좁은 폭은 wrap으로 처리하고 mobile 펼침에서도 노출한다.
- 실행 계획과 engineering review: `../plans/2026-10-24-workspace-activity-label.md`.
- 기존 미추적 `.ua/`, `src/lib/codex-client-command.ts`는 이번 변경 대상이 아니다.

## Spec Freeze Snapshot

- 대상: desktop workspace 목록과 mobile navigation sheet의 모든 workspace 항목.
- 대표 문구: 입력 대기 → 작업 중 → 확인 필요 → 상태 미확인 → 작업 없음.
- 초기 동기화/연결 끊김은 대표 문구보다 우선하는 상태 확인 중이다.
- 기준: 기존 Codex 탭 상태만 사용하며 terminal/server/browser/diff는 제외한다.
- 경계: 기존 client store와 공유 indicator에 한정하고 새 조회/영속화/API는 추가하지 않는다.
- 연결 상태와 첫 전체 sync 완료 여부를 분리하는 client boolean을 추가한다.
  연결 교체/종료 때 초기화하고 전체 sync 처리와 함께 완료한다.
- 회귀: workspace 격리, 상태 우선순위, 알려진 layout의 누락 entry, 최초 연결,
  재연결, 한국어/영어와 mobile 펼침 상태를 포함한다.
- 실행 환경: Linux, Node/TypeScript/Vitest와 Chromium. Live service 재시작이나
  외부 배포는 이 구현 요청에 포함하지 않는다.
- 열린 설계 질문 없음. 기존 미추적 사용자 파일은 유지한다.
