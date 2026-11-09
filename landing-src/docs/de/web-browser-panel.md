---
title: 웹 브라우저 패널
description: 개발 결과 확인용 내장 브라우저 탭. agentmux CLI로 제어하고, 모바일 뷰포트는 디바이스 에뮬레이터로 확인합니다.
eyebrow: 워크스페이스 & 터미널
permalink: /de/docs/web-browser-panel/index.html
---
{% from "docs/callouts.njk" import callout %}

터미널과 Codex 세션 옆에 웹 브라우저 탭을 띄워두세요. 로컬 개발 서버, 스테이징, 닿을 수 있는 어느 사이트든 띄울 수 있고, 같은 쉘에서 `agentmux` CLI로 제어할 수 있습니다.

## 브라우저 탭 열기

새 탭을 추가하면서 패널 타입을 **Web browser**로 선택합니다. 주소 입력창에 `localhost:3000`, IP, 또는 전체 https URL을 입력하세요. 입력은 정규화됩니다 — 호스트명이나 IP는 `http://`로, 그 외는 `https://`로 자동 보정됩니다.

agentmux를 macOS 네이티브 앱(Electron 빌드)으로 띄웠을 때는 실제 Chromium webview로 동작하고, 일반 브라우저에서 접근했을 때는 iframe으로 폴백합니다. iframe도 대부분의 페이지를 다루지만 `X-Frame-Options: deny`를 보내는 사이트는 막힙니다 — Electron 경로는 그런 제한이 없습니다.

{% call callout('note', '네이티브 앱에서 가장 잘 동작') %}
디바이스 에뮬레이션, CLI 스크린샷, 콘솔/네트워크 캡처는 Electron 빌드에서만 동작합니다. 브라우저 탭 폴백에서는 주소창, 뒤/앞, 새로고침 정도만 됩니다 — 깊은 통합은 webview가 필요합니다.
{% endcall %}

## CLI 기반 제어

패널은 작은 HTTP API를 노출하고, 번들된 `agentmux` CLI가 이를 감쌉니다. 어느 터미널에서든 — 브라우저 패널 옆 터미널 포함 — 다음을 실행할 수 있습니다.

```bash
# 탭 목록에서 web-browser 탭 ID 찾기
agentmux tab list -w <workspace-id>

# 현재 URL과 타이틀
agentmux tab browser url -w <ws> <tabId>

# 스크린샷을 파일로 (전체 페이지는 --full)
agentmux tab browser screenshot -w <ws> <tabId> -o shot.png --full

# 최근 콘솔 로그 (500개 ring buffer)
agentmux tab browser console -w <ws> <tabId> --since 60000 --level error

# 네트워크 활동 조회, 단일 응답 본문은 --request로
agentmux tab browser network -w <ws> <tabId> --method POST --status 500
agentmux tab browser network -w <ws> <tabId> --request <id>

# 탭 안에서 JS 평가, 직렬화된 결과 반환
agentmux tab browser eval -w <ws> <tabId> "document.title"
```

CLI는 `~/.agentmux/cli-token`의 토큰으로 인증하고 `~/.agentmux/port`에서 포트를 읽습니다. 같은 머신에서 실행할 때는 별도 플래그가 필요 없습니다. `agentmux help`로 전체 명령을 보거나 `agentmux api-guide`로 그 아래 HTTP 엔드포인트를 확인할 수 있습니다.

이 점이 Codex와의 조합에서 중요합니다 — 스크린샷을 찍어 달라거나, 콘솔에서 에러를 확인해 달라거나, probe 스크립트를 돌려 달라고 시킬 때 Codex도 똑같은 CLI를 갖고 있습니다.

## 디바이스 에뮬레이터

모바일 작업을 위해 패널을 모바일 모드로 전환할 수 있습니다. 디바이스 피커에는 iPhone SE부터 14 Pro Max, Pixel 7, Galaxy S20 Ultra, iPad Mini, iPad Pro 12.9" 프리셋이 들어있습니다. 각 프리셋이 함께 적용하는 것:

- 가로 / 세로 픽셀
- Device pixel ratio
- 해당 디바이스에 맞는 모바일 user agent

세로 / 가로 회전을 토글할 수 있고, 줌 레벨 (`fit`으로 패널에 맞춤, 또는 고정 `50% / 75% / 100% / 125% / 150%`) 도 선택할 수 있습니다. 디바이스를 바꾸면 새 UA로 webview가 다시 로드되므로 서버 사이드 모바일 감지도 실제 폰처럼 동작합니다.

## 다음으로

- **[탭 & 창](/agentmux/de/docs/tabs-panes/)** — Codex 옆에 브라우저를 분할로 띄우기
- **[Git 워크플로 패널](/agentmux/de/docs/git-workflow/)** — 또 다른 전용 패널 타입
- **[설치](/agentmux/de/docs/installation/)** — webview 통합이 동작하는 macOS 네이티브 앱
