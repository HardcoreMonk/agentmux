---
title: 브라우저 지원
description: 데스크탑과 모바일 호환성 매트릭스, 브라우저별 주의사항.
eyebrow: 시작하기
permalink: /docs/browser-support/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 웹 앱이므로 사용 경험은 브라우저에 따라 달라집니다. 아래는 저희가 실제로 테스트하는 버전들입니다 — 더 오래된 버전은 동작할 수도 있지만 공식 지원은 하지 않습니다.

## 데스크탑

| 브라우저 | 최소 버전 | 비고 |
|---|---|---|
| Chrome | 110+ | 권장. PWA와 Web Push 완전 지원. |
| Edge | 110+ | Chrome과 같은 엔진, 같은 수준 지원. |
| Safari | 17+ | macOS Sonoma 이상에서 PWA 완전 지원. Web Push는 macOS 13+ 에서 PWA 설치 후 사용 가능. |
| Firefox | 115+ ESR | 정상 동작. PWA 설치는 수동 (설치 프롬프트 없음). |

xterm.js 터미널, 라이브 타임라인, Codex 세션 뷰, Git diff 패널 — 모든 기능이 이들 엔진에서 동일하게 동작합니다.

## 모바일

| 브라우저 | 최소 버전 | 비고 |
|---|---|---|
| iOS Safari | **16.4+** | Web Push 필수 조건. **홈 화면에 추가**로 PWA 설치한 경우에만 푸시 알림 수신. |
| Android Chrome | 110+ | 일반 탭에서도 Web Push 동작. PWA 설치 시 전체 화면 레이아웃 권장. |
| Samsung Internet | 22+ | 정상 동작. 설치 프롬프트 자동 노출. |

Capacitor Android 앱은 같은 agentmux 서버를 WebView로 열지만, 저장 서버 런처와 앱 정보/재시작 native bridge를 추가로 제공합니다. React UI만 바뀐 경우에는 서버 재빌드와 재시작으로 반영되고, native bridge나 런처 asset이 바뀐 경우에는 APK를 다시 설치해야 합니다.

{% call callout('warning', 'iOS Safari 16.4 이상이 기준') %}
Apple은 iOS에 Web Push를 Safari 16.4(2023년 3월)에서야 추가했습니다. 그 이전 iOS 버전은 대시보드는 사용할 수 있지만, PWA로 설치해도 푸시 알림이 오지 않습니다.
{% endcall %}

## 기능 요구사항

agentmux는 몇 가지 최신 브라우저 API에 의존합니다. 빠진 API가 있으면 앱은 그레이스풀하게 폴백하지만 해당 기능은 사용할 수 없습니다.

| API | 사용 목적 | 폴백 |
|---|---|---|
| WebSocket | 터미널 I/O, 상태 동기화, 타임라인 | 필수 — 폴백 없음 |
| Clipboard API | `npx --yes @hardcoremonk/agentmux@latest` 복사, 코드블록 복사 | 사용 불가 시 버튼 숨김 |
| Notifications API | 데스크탑/모바일 푸시 | 건너뜀 — 앱 내 상태는 그대로 표시 |
| Service Workers | PWA + Web Push | 일반 웹 앱으로만 서빙 |
| IntersectionObserver | 라이브 타임라인, nav reveal | 애니메이션 없이 렌더링 |
| `backdrop-filter` | 반투명 nav, 모달 | 단색 tint 배경으로 폴백 |
| CSS `color-mix()` + OKLCH | 테마 변수 | Safari < 16.4 에서 일부 tint 상태 손실 |

## 내 브라우저 괜찮나요?

agentmux 앱 안에 **설정 → 브라우저 체크** 자체 진단기가 있습니다. 위에 나열된 것과 동일한 API를 검사하고 기능별로 녹색/황색/빨간색 배지를 보여주니 스펙 시트를 읽지 않아도 됩니다.

## 알려진 quirk

- **Safari 17 + 프라이빗 창** — IndexedDB가 비활성화되므로 워크스페이스 캐시가 재시작 후 유지되지 않습니다. 일반 창을 사용하세요.
- **모바일 브라우저/WebView + 백그라운드** — iOS Safari는 WebSocket을 끊고 Android WebView는 객체가 `OPEN`이어도 TCP가 죽을 수 있습니다. tmux는 실제 세션을 계속 유지하므로 foreground 복귀 시 terminal/status/timeline/sync 연결을 강제로 재확인합니다.
- **Firefox + Tailscale Serve 인증서** — `ts.net`이 아닌 커스텀 tailnet 이름을 쓰면 Firefox가 Chrome보다 HTTPS 신뢰에 까다로울 수 있습니다. 한 번 수락하면 계속 유지됩니다.
- **자체 서명 인증서** — Web Push 등록 자체가 안 됩니다. Tailscale Serve(자동 Let's Encrypt)나 실제 도메인 + 리버스 프록시를 쓰세요.

## 미지원

- **Internet Explorer** — 지원하지 않습니다.
- **UC Browser, Opera Mini, Puffin** — 프록시 기반 브라우저는 WebSocket이 끊깁니다. 동작 안 합니다.
- **3년 이상 된 브라우저** — OKLCH 컬러와 컨테이너 쿼리를 써서 2023년 이후 엔진이 필요합니다.

특이한 환경에서 문제가 발생하면 유저 에이전트와 자체 진단 결과를 첨부해 [이슈를 열어주세요](https://github.com/HardcoreMonk/agentmux/issues).
