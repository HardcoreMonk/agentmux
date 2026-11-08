# 워크스페이스별 작업 유무 표시 인계

- 날짜: 2026-10-24
- Spec: `../superpowers/specs/2026-10-24-workspace-activity-label-design.md`
- Plan / reviews: `../superpowers/plans/2026-10-24-workspace-activity-label.md`
- 사용자 설계 승인: “권고 내용을 승인합니다”.

## Release Scope

Desktop sidebar와 mobile navigation sheet의 각 workspace에 Codex 작업의 대표 문구를
추가했다. 입력 대기 → 작업 중 → 확인 필요 → 상태 미확인 → 작업 없음 순으로 표시하고
기존 탭별 아이콘도 유지한다. 한국어와 영어를 지원한다.

현재 연결의 full status sync 전/연결 끊김은 상태 확인 중으로 표시한다. Mobile의
펼침/접힘과 layout cache 로딩 중에도 문구를 유지한다. 일반 terminal server,
browser와 diff panel은 Codex 작업에 포함하지 않는다.

## Release

로컬 source 구현과 release 후보 검증을 완료했다. Version 변경, commit/push, 외부
publish와 live service 배포/재시작은 수행하지 않았다. 승인된 spec의 배포 제외 범위를
유지하며 이 문서를 운영 반영 준비 인계로 사용한다.

## Verification

- RED: 순수 판정 module 미존재와 sync readiness 2건 실패, component rendering 11건 실패를 확인했다.
- GREEN: focused `workspace-activity`, `use-tab-store`, `workspace-status-indicator` 27 tests 통과.
- `corepack pnpm check:project-design`: 통과.
- `corepack pnpm lint`: 오류 0, 기존 경고 6. 변경 source/test 파일을 대상으로 한 ESLint는 경고 0.
- `corepack pnpm tsc --noEmit`: 통과.
- `corepack pnpm test`: 최종 272 suites passed / 1 skipped, 1,711 tests passed / 3 skipped.
- `corepack pnpm build`: 최종 source의 Next production/worker bundle build 통과.
- `git diff --check`: 통과. 새 문서/테스트/helper도 별도로 공백과 경로를 확인했다.
- Chromium production UI smoke: 한국어/영어, 160px desktop sidebar와 390px mobile,
  light/dark에서 상태 전환, workspace 격리, terminal server 제외, 초기 full sync,
  연결 끊김/재연결, mobile 펼침/접힘, accessible description 통과.
- UI smoke의 overflow, page error와 console error는 0건이다. Screenshot도 시각 확인했다.
- Browser evidence와 재현 harness: `/tmp/codexmux-workspace-activity-kqJYVQ/`의
  `smoke.mjs`, `result.json`, `{ko,en}-{desktop,mobile}-{dark,light}.png`.
  Harness는 격리 HOME/loopback production server와 합성 status WebSocket event를 사용했다.
  실제 사용자 workspace와 Codex 작업은 수정하지 않았다. 임시 evidence는 장기 보존 경로가 아니다.

## Audit

- 변경 경계: client 상태 동기화 flag, 순수 표시 판정, 공유 indicator, mobile row, 번역과 문서/회귀 테스트.
- 새 API, polling, storage migration, server 상태 판정/notification 정책 변경 없음.
- ADR 추가 없음. 기존 client projection 확장이다.
- 기존 미추적 `.ua/`, `src/lib/codex-client-command.ts`는 수정하지 않았다.
- Issue 생성/닫기/relabel 및 commit/push 없음.

## Blockers

로컬 구현과 검증의 blocker 없음.

## Warnings

- 전체 lint에 변경 범위 밖 기존 내부 경로 navigation 경고 6건이 있다.
- 기존 미추적 사용자 파일이 있으므로 향후 commit 시 이번 변경 파일을 명시적으로 선택해야 한다.

## Residual Risk

운영 서비스에는 반영되지 않았다. 합성 상태 event를 사용한 UI 검증이므로 live Codex
작업의 실제 감지부터 표시까지의 운영 확인은 배포 뒤 수행해야 한다. 기존 서버 감지
경로는 이번 구현에서 변경하지 않았다.

## Current Lifecycle Stage

`code-review` 완료, 로컬 release 후보 검증 완료. Live `release`와 `operate`는 미진입이다.

## Next Action

사용자가 운영 반영을 요청하면 기존 배포 절차로 적용하고, 실제 workspace의 작업
유무와 재연결을 확인한 뒤 운영 진입 근거를 추가한다.

## Follow-Up Tasks

- 별도 요청 시 운영 서비스에 배포하고 live workspace 상태를 확인한다.
