# iPad 홈 화면 웹 앱 설계 (작은 변경)

- 작성일: 2026-11-15
- 상태: 승인 대기
- Lifecycle: 사용자 요청 "아이패드 앱 어플리케이션도 준비 해 줘". 방식 선택에서 사용자가 "홈 화면 웹 앱"을 골랐다(이 server는 Linux라 iOS 앱을 build·서명할 Mac과 Xcode가 없음). 사용 방식은 "손가락과 화면 키보드"이고, 화면 방식은 "A로 진행"(손가락 기기에 모바일 화면)이다. 화면 선택 동작을 바꾸므로 Lightweight 경로를 쓰지 않는다. 작은 변경이라 짧은 설계와 계획을 이 문서 하나에 둔다.

## 의도와 이유

- 사용자는 iPad에서 agentmux를 손가락과 화면 키보드로 쓰려 한다. 홈 화면에 추가한 웹 앱(주소창 없는 전체 화면)으로 연다.
- 홈 화면 웹 앱의 기본은 이미 있다: `/api/manifest`(`display: standalone`), `apple-touch-icon`, iPad 크기 시작 화면 이미지, `viewport-fit=cover`.
- 걸리는 것은 화면 선택이다. 화면 선택은 폭만 본다(`src/hooks/use-is-mobile.ts`, 768px 미만이면 모바일). iPad 폭은 768px 이상이라 desktop 화면이 뜬다.
- desktop 화면은 손가락 조작을 고려하지 않았다.
  - 마우스를 올려야 보이는 버튼과 작은 터치 대상이 있다.
  - 화면 가장자리 여백(safe area)이 없다.
  - 재연결 새로고침 버튼(설계 2-2)이 없다.
- 홈 화면 앱에는 브라우저 새로고침 버튼이 없어서 새로고침 버튼이 꼭 필요하다.
- 모바일 화면에는 이 셋이 이미 있다.

## 목표 / 비목표

- 목표
  - 손가락이 주 입력인 기기(마우스 없음)에서는 화면 폭과 상관없이 모바일 화면을 보인다.
  - 넓은 화면(768px 이상)의 모바일 화면에서 대화 본문과 입력창이 화면 끝까지 늘어나지 않게 한다.
  - iPad 설치와 사용 안내 문서를 둔다.
- 덤: 가로로 돌린 폰(Android 앱 포함)도 모바일 화면이 된다. 설계 2-2 최종 검토 Minor("가로 모드 폰의 새로고침 banner", `FOLLOW-UP.md`)가 풀린다.
- 비목표
  - iOS 앱(Capacitor iOS)
  - iPad에서 pane 분할이나 Git 옆 패널. Git은 지금처럼 탭을 Diff mode로 바꿔서 본다.
  - iPad web push 알림(HTTPS 주소가 필요하다)
  - 새 iPad 시작 화면 이미지
- Anti-goal
  - 마우스를 쓰는 desktop browser가 모바일 화면으로 바뀌는 것
  - 마우스나 trackpad가 주 입력인 touch 노트북도 마찬가지다.

## Approaches

- **A. 손가락 기기에 모바일 화면 (사용자 선택):** 화면 선택 기준 한 곳을 바꾸고 넓은 화면을 다듬는다. 이미 있는 터치·여백·새로고침 처리를 그대로 쓴다. 대신 탭 하나씩 보이고, pane 분할과 Git 옆 패널은 없다.
- **B. desktop 화면을 터치용으로 고치기:** pane 분할과 Git 옆 패널을 유지한다. 대신 hover 버튼, 터치 크기, 화면 키보드, 여백, 새로고침을 desktop 화면에 하나씩 넣어야 해서 크고 놓치기 쉽다.
- **C. A에 전환 버튼:** A를 기본으로 두고 설정으로 desktop 화면을 고르게 한다. 필요해지면 A 위에 더한다.

## 설계

1. **화면 선택 기준**
   - `use-is-mobile.ts`의 media query를 다음으로 바꾼다: `(max-width: ${breakpoint - 1}px), (hover: none) and (pointer: coarse)`.
   - 기준식은 순수 함수 `buildMobileMediaQuery(breakpoint)`로 뺀다. `useIsMobile`이 이 함수를 쓰고, test도 이 함수로 한다.
   - `hover: none`과 `pointer: coarse`는 주 입력이 손가락인 기기에서 참이다. 마우스·trackpad가 주 입력이면 거짓이라 desktop은 그대로다.
   - iPad Safari는 user agent로 자신을 Mac이라고 알린다. 그래서 user agent가 아니라 입력 방식으로 판정한다.
   - `useIsMobile`의 모든 호출자가 같은 판정을 따른다.
     - 첫 화면: `pages/index.tsx`
     - 다른 page 틀: `page-shell.tsx`
     - toast 위치: `_app.tsx`
     - diff unified 보기: `diff-file-list.tsx`, `diff-panel.tsx`
     - tool diff 줄바꿈: `tool-call-item.tsx`
     - 새 탭 메뉴에서 web browser 숨김: `pane-new-tab-menu.tsx`
   - 그래서 iPad에서 받는 동작이 폰과 같다.
2. **넓은 화면 다듬기:** 폭이 768px 이상인 모바일 화면에서 timeline 본문과 웹 입력창에 최대 폭을 두고 가운데 정렬한다.
   - terminal 화면, 위쪽 탭 줄, 아래쪽 탐색 줄은 전체 폭을 그대로 쓴다.
   - 최대 폭 값과 적용할 container는 builder 재량이다. iPad 세로(1024×1366)와 가로(1366×1024) 화면 사진으로 확인한다.
3. **head meta:** `_document.tsx`에 `<meta name="mobile-web-app-capable" content="yes" />`를 더한다. 기존 `apple-mobile-web-app-capable`은 둔다(이전 iOS용). 지금 browser console에 deprecated 경고가 나온다.
4. **문서**
   - `docs/IPAD.md`를 새로 만든다.
     - 설치: iPad Tailscale 연결, Safari로 server 주소 열기, 공유 → "홈 화면에 추가", 처음 한 번 로그인. 홈 화면 앱은 Safari와 저장소가 따로다.
     - 동작: 모바일 화면, 회전, 새로고침 버튼
     - 한계: iOS 앱 아님, 알림 없음(HTTPS 필요), pane 분할 없음
   - `README.md` "문서" 표와 `docs/README.md` 문서 맵(`ANDROID.md` 행 옆)에 한 줄씩 더한다.
   - `docs/FOLLOW-UP.md` "설계 2-2 후속"의 "가로 모드 폰의 새로고침 banner" 행을 해결로 고친다.

## 계획

- 작업 체계: agy(Herdr pane)가 구현하고 Claude가 검증한다. agy 사용량이 부족하면 model을 순서대로 바꾸고, 모두 쓰면 Claude subagent가 한다.
- Task 1 — 기준식
  - `tests/unit/hooks/use-is-mobile.test.ts`(새 파일)
    - `buildMobileMediaQuery(768)`이 `(max-width: 767px), (hover: none) and (pointer: coarse)`다.
    - breakpoint 인자가 반영된다.
  - `use-is-mobile.ts`를 고친다.
  - commit `feat(ui): show the mobile layout on touch-first devices of any width`
- Task 2 — 넓은 화면, meta, 문서
  - 설계 2~4를 구현한다.
  - commit `feat(mobile): fit the mobile layout to wide touch screens` 그리고 `docs: add the iPad home screen app guide`
- Task 3 — gate와 격리 확인(controller)
  - gate: lint, tsc 2종, 전체 test, 문서 gate, `pnpm build`
  - 격리 server에서 Playwright Chromium으로 확인한다.
    - iPad 세로·가로(touch 흉내, `isMobile`): 모바일 화면이다. 넓은 화면에서 본문이 최대 폭이다.
    - 같은 폭 desktop(마우스): desktop 화면 그대로다.
    - 폰 가로(915×412, touch): 모바일 화면이다. 새로고침 버튼은 server를 멈춰 확인한다.
  - PR → CI → 로컬 merge → 사용자 배포
- 사용자 기기 확인(배포 뒤)
  - 실제 iPad Safari에서 홈 화면에 추가
  - 화면 키보드가 입력창을 가리는지
  - 아래쪽 홈 표시줄 여백
  - 회전
  - 이 셋(키보드, 여백, 회전)은 Linux의 Chromium으로 흉내 낼 수 없다.

## 남은 위험

- iPad에 trackpad 달린 키보드를 붙이면 browser가 `hover`를 참으로 보고 desktop 화면으로 바뀔 수 있다. 의도와 맞는 쪽이다(마우스형 입력). 바뀔 때 화면이 다시 그려지지만 server 쪽 session은 그대로다.
- iPad 화면 키보드와 safe area 동작은 실제 기기에서만 확인할 수 있다. 문제가 나오면 후속으로 고친다.
