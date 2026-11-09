---
title: PWA 설정
description: iOS Safari와 Android Chrome에서 agentmux를 홈 화면에 추가해 전체 화면 앱처럼 사용합니다.
eyebrow: 모바일 & 원격
permalink: /zh-TW/docs/pwa-setup/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux를 PWA로 설치하면 브라우저 탭이 홈 화면 아이콘으로 바뀌고, 전체 화면 레이아웃과 스플래시 스크린이 적용됩니다. iOS에서는 Web Push를 받기 위한 필수 단계이기도 합니다.

## 무엇이 좋아지나

- **전체 화면 레이아웃** — 브라우저 chrome이 사라져 터미널과 타임라인에 쓸 수 있는 세로 공간이 늘어납니다.
- **앱 아이콘** — 다른 네이티브 앱처럼 홈 화면에서 바로 실행됩니다.
- **스플래시 스크린** — iPhone 기종별 스플래시 이미지를 포함해서 실행 전환이 자연스럽습니다.
- **Web Push** (iOS 한정) — PWA 설치 이후에만 푸시 알림이 동작합니다.

매니페스트는 `/api/manifest`에서 제공되며 `display: standalone`과 agentmux 아이콘, 테마 컬러로 등록됩니다.

시작 화면은 `public/splash/*.png` 정적 이미지에서 내려오며 `scripts/generate-splash.js`가 `agentmux` branding으로 생성합니다. 이미 홈 화면에 추가한 앱이 이전 splash를 계속 보이면 iOS cache 때문에 홈 화면 앱을 삭제한 뒤 다시 추가하세요.

## 설치 전 확인

페이지가 **HTTPS**로 접근 가능해야 PWA가 동작합니다. `localhost`는 Chrome에서는 예외적으로 허용되지만 iOS Safari는 평문 HTTP에서 설치를 허용하지 않습니다. 가장 깔끔한 경로는 Tailscale Serve입니다 — [Tailscale 접속](/agentmux/zh-TW/docs/tailscale/) 참고.

{% call callout('warning', 'iOS는 Safari 16.4 이상 필요') %}
이전 iOS에서도 PWA 설치는 됩니다만 Web Push는 동작하지 않습니다. 푸시가 중요하다면 iOS를 먼저 업데이트하세요. 브라우저별 자세한 호환성은 [브라우저 지원](/agentmux/zh-TW/docs/browser-support/)에 정리되어 있습니다.
{% endcall %}

## iOS Safari

1. **Safari**에서 agentmux URL을 엽니다 (다른 iOS 브라우저는 PWA용 홈 화면에 추가를 노출하지 않습니다).
2. 하단 툴바의 **공유** 아이콘을 누릅니다.
3. 액션 시트를 아래로 스크롤해서 **홈 화면에 추가**를 선택합니다.
4. 이름을 원하는 대로 수정하고 우측 상단의 **추가**를 누릅니다.
5. 홈 화면에 새로 생긴 아이콘을 누르면 전체 화면으로 실행됩니다.

이 아이콘으로 처음 실행하는 순간부터 iOS가 PWA로 취급합니다. 푸시 권한 프롬프트도 일반 Safari 탭이 아니라 이 standalone 창 안에서 띄워야 합니다.

## Android Chrome

Chrome은 매니페스트를 자동 감지해서 설치 배너를 띄웁니다. 보이지 않는다면:

1. **Chrome**에서 agentmux URL을 엽니다.
2. 우측 상단 **⋮** 메뉴를 누릅니다.
3. **앱 설치** (또는 **홈 화면에 추가**)를 선택합니다.
4. 확인하면 홈 화면과 앱 서랍에 아이콘이 생깁니다.

Samsung Internet도 동일합니다 — 설치 프롬프트가 자동으로 노출됩니다.

별도 Capacitor Android 앱을 설치한 경우에는 저장 서버/최근 서버 런처를 먼저 거칩니다. 서버 접속 후 모바일 메뉴의 앱 정보에서 Android `versionName`/`versionCode`, 패키지, 기기/Android 버전, 서버 버전을 확인하고 앱 재시작으로 WebView/Activity를 다시 열 수 있습니다.

## 설치 확인

홈 화면 아이콘으로 agentmux를 실행해보세요. 브라우저 주소창이 보이지 않아야 정상입니다. 여전히 브라우저 UI가 보인다면 매니페스트가 적용되지 않은 것이고, 보통 평문 HTTP 또는 비정상적인 프록시 환경이 원인입니다.

**설정 → 알림**에서도 확인할 수 있습니다 — PWA 설치 후 Web Push 지원 환경이라면 토글이 활성화됩니다.

## 업데이트

별도로 할 일은 없습니다. PWA는 agentmux 인스턴스가 서빙하는 같은 `index.html`을 그대로 로드하므로, agentmux를 업그레이드하면 다음 실행 시 자동으로 반영됩니다.

Capacitor Android 앱도 React UI만 바뀐 경우에는 Linux user service 기준 `corepack pnpm deploy:local`만 필요합니다. `android-web/` 런처나 native bridge, Android version metadata가 바뀐 경우에는 APK를 다시 빌드하고 설치해야 합니다.

제거하려면 아이콘을 길게 눌러 OS 기본 삭제 동작을 사용하세요.

## 다음으로

- **[웹 푸시 알림](/agentmux/zh-TW/docs/web-push/)** — PWA 설치 이후 백그라운드 알림 켜기
- **[Tailscale 접속](/agentmux/zh-TW/docs/tailscale/)** — iOS가 요구하는 HTTPS URL 확보하기
- **[브라우저 지원](/agentmux/zh-TW/docs/browser-support/)** — 전체 호환성 매트릭스
