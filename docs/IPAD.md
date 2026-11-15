# iPad 홈 화면 웹 앱 안내

iPad에서는 Safari의 "홈 화면에 추가" 기능으로 실행 중인 Linux agentmux engine에 연결하는
standalone 웹 앱(`display: standalone`)을 사용합니다. iPad 홈 화면 웹 앱은 session/runtime
authority가 아닌 선택 모바일 client입니다.

## 설치

1. iPad의 Tailscale 앱으로 tailnet에 연결합니다.
2. Safari에서 `<agentmux 주소>`를 엽니다.
3. 공유 버튼을 누르고 **홈 화면에 추가**를 선택합니다.
4. 홈 화면 아이콘으로 웹 앱을 열고 처음 한 번 로그인합니다. 홈 화면 웹 앱은 일반 Safari 탭과 쿠키·로그인 저장소가 분리되어 있으므로 홈 화면 앱 안에서 별도로 로그인해야 합니다.

## 동작

- **손가락 기기 화면 판정**: 손가락이 주 입력인 기기에서는 화면 폭과 상관없이 모바일 화면을 표시합니다. 판정 기준은 `src/hooks/use-is-mobile.ts`의 `useIsMobile`(`buildMobileMediaQuery`)이며, `(max-width: 767px), (hover: none) and (pointer: coarse)` media query를 사용합니다. iPad Safari는 user agent를 Mac으로 알리므로 user agent 대신 입력 방식(`(hover: none) and (pointer: coarse)`)으로 판정합니다.
- **화면 회전**: 세로와 가로 방향을 회전해도 모바일 화면을 유지합니다(가로 모드로 돌린 스마트폰과 Android 앱도 동일하게 모바일 화면을 유지합니다).
- **재연결 새로고침 버튼**: 화면이 보이는 상태에서 terminal 또는 timeline WebSocket 재연결이 연속 5회 이상 실패하면 화면 위쪽에 `새로고침` 복구 버튼이 나타납니다. 주소창과 브라우저 새로고침 버튼이 없는 홈 화면 웹 앱에서는 이 버튼으로 페이지를 다시 불러옵니다.
- **외장 키보드·trackpad 연결**: trackpad가 달린 키보드를 연결하면 브라우저가 `hover` 가능 장치로 보고 desktop 화면으로 바뀔 수 있습니다. 화면이 다시 그려져도 서버 쪽 session은 그대로 유지됩니다.

## 한계

- **네이티브 iOS 앱 아님**: Capacitor iOS 등 네이티브 iOS 앱이 아닙니다(iOS 앱 빌드와 서명에는 Mac과 Xcode가 필요합니다).
- **Web Push 알림 제한**: Web Push 알림은 HTTPS 주소(보안 컨텍스트)가 필요하므로 일반 `http://` 주소로는 알림이 오지 않습니다.
- **단일 탭 모바일 구성**: 모바일 화면을 사용하므로 다중 pane 분할과 오른쪽 Git side panel은 제공하지 않습니다. Git 변경 내용은 탭의 보기를 `Diff` mode로 전환해 확인합니다.
