# 워크스페이스별 작업 유무 표시 구현 계획

- Spec: `../specs/2026-10-24-workspace-activity-label-design.md`
- 설계 승인: 2026-10-24 사용자 메시지 “권고 내용을 승인합니다”.
- 구현 방식: 현재 도구로 순차 구현 및 검토. 제거된 skill은 설치하지 않는다.

## Task 1 — 회귀 테스트와 순수 판정

- [x] `tests/unit/lib/workspace-activity.test.ts`에 상태 우선순위, 비 Codex 제외,
  초기 sync/연결 끊김 테스트를 먼저 추가하고 실패를 확인한다.
- [x] `src/lib/workspace-activity.ts`에 기존 `TTabDisplayStatus`를 받는 순수 판정을 추가한다.
- [x] `tests/unit/hooks/use-tab-store.test.ts`에 초기 sync/재연결 상태 전이를 검증한다.
- [x] `src/hooks/use-tab-store.ts`에 `statusSynced`를 추가하고 전체 sync 완료 시 갱신한다.
  `src/hooks/use-agent-status.ts`에서 연결 교체/cleanup도 미동기화로 전환한다.

## Task 2 — 공통 표시와 locale

- [x] `tests/unit/components/workspace-status-indicator.test.ts`에 양쪽 locale,
  workspace 격리, 누락 status entry와 탭 아이콘 보존을 검증한다.
- [x] `workspace-status-indicator.tsx`에 짧은 대표 문구와 wrapping을 추가한다.
- [x] `mobile-navigation-sheet.tsx`에서 펼친 workspace에도 indicator를 표시한다.
- [x] `messages/{ko,en}/workspace.json`에 같은 key set으로 문구를 추가한다.

## Task 3 — 검증과 리뷰

- [x] `docs/STATUS.md`에 client 표시 판정과 동기화 경계를 기록한다.
- [x] Focused tests, `corepack pnpm check:project-design`, lint, TypeScript와 전체 test를 실행한다.
- [x] `corepack pnpm build`와 Chromium desktop/mobile smoke를 실행한다.
- [x] Diff code review와 `git diff --check` 후 operations handoff에 결과/배포 경계를 기록한다.

## Engineering Review

- 결과: Pass. 새 API/worker/polling 없이 기존 projection을 소비한다.
- 순수 helper는 component의 탭 목록을 받아 workspace membership를 다시 스캔하지 않는다.
- UI 대표 상태는 기존 `TTabDisplayStatus`와 client 전용 checking으로 구성한다.
- 전체 sync 완료 flag는 기존 WebSocket 연결 flag와 구분한다. Incremental update만으로
  완료 처리하지 않고, forced reconnect와 hook cleanup에서도 초기화한다.
- 알려진 layout 탭의 누락 entry는 unknown으로 전달한다. 서버 미응답을 idle로 합성하지 않는다.
- Workspace membership과 panel type을 확인해 다른 workspace와 일반 terminal의 상태를 제외한다.
- 상태 라벨은 읽을 수 있는 text로 표시하고 기존 icon은 유지한다. Mobile 펼침 조건만 제거한다.
- Execution Environment Constraints: Linux checkout, 설치된 pnpm dependency와 Chromium을 사용한다.
  Browser smoke는 격리 fixture/server를 사용하며 실제 사용자 세션이나 live service를 수정하지 않는다.
- Rollback: helper/indicator/locale/동기화 flag 변경을 되돌린다. Migration이나 durable data 복원은 없다.
- ADR 추가 없음. 기존 runtime/status/locale 계약의 client 표시 확장이다.
- 기존 미추적 `.ua/`, `src/lib/codex-client-command.ts`는 구현 및 검증 산출물과 분리한다.

## Code Review

- 결과: Pass. 미해결 blocking/important finding 없음.
- 상태 우선순위와 일반 terminal 제외는 순수 helper에 있고 기존 상태 모델을 변경하지 않는다.
- `statusSynced`는 full sync에서만 완료되며 disconnect, 교체와 cleanup에서 초기화된다.
  Chromium에서 socket open/incremental update만으로 idle이 표시되지 않음을 확인했다.
- 알려진 layout의 누락 entry/다른 workspace entry를 unknown으로 처리한다.
- Mobile layout cache가 아직 비어 있으면 전체 status snapshot을 사용하도록 보강했다.
  펼침/접힘 상태에서도 문구와 accessible description을 유지한다.
- 기존 아이콘과 navigation/selection, terminal/input handler를 보존했다.
- 최종 검증: focused 27 tests, 전체 1,711 passed/3 skipped, type, build,
  project-design check 통과. 전체 lint는 기존 경고 6건/오류 0건이며 변경 파일 lint는 경고도 없다.
- 한국어/영어, 160px sidebar/390px mobile, light/dark, 상태 전환과 재연결 smoke 통과.
- 운영 인계: `../../operations/2026-10-24-workspace-activity-label-handoff.md`.
