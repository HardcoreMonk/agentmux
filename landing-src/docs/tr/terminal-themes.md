---
title: 터미널 테마
description: xterm.js 터미널 전용 팔레트 — 다크와 라이트를 각각 한 개씩 고릅니다.
eyebrow: 커스터마이즈
permalink: /tr/docs/terminal-themes/index.html
---
{% from "docs/callouts.njk" import callout %}

터미널 영역은 UI와는 독립된 xterm.js 팔레트를 씁니다. 다크 테마와 라이트 테마를 각각 하나씩 골라두면, 앱 테마가 바뀔 때 agentmux가 자동으로 전환합니다.

## 선택 화면 열기

설정(<kbd>⌘,</kbd>) → **터미널** 탭의 어두운/밝은 서브 탭 안에 카드 그리드가 있습니다. 카드를 누르면 열려 있는 모든 터미널에 즉시 반영됩니다.

## 왜 따로 둘까

터미널 앱은 16색 ANSI 팔레트(red, green, yellow, blue, magenta, cyan과 bright 버전)에 의존합니다. UI 팔레트는 의도적으로 채도를 낮춰 두었기 때문에 그대로 쓰면 터미널 출력이 읽히지 않습니다. 별도 팔레트가 있어야 `vim`, `git diff`, 신택스 하이라이트, TUI 도구가 제대로 보입니다.

각 테마는 다음을 정의합니다.

- background, foreground, cursor, selection
- 8개 기본 ANSI 컬러(black, red, green, yellow, blue, magenta, cyan, white)
- 8개 bright 변형

## 기본 제공 테마

**Dark**

- Snazzy *(기본값)*
- Dracula
- One Dark
- Tokyo Night
- Nord
- Catppuccin Mocha

**Light**

- Catppuccin Latte *(기본값)*
- GitHub Light
- One Light
- Solarized Light
- Tokyo Night Light
- Nord Light

카드 미리보기에 테마 배경 위 7개 ANSI 컬러가 표시되어, 선택 전에 대비를 가늠할 수 있습니다.

## 라이트/다크 전환 방식

다크 테마와 라이트 테마를 각각 **독립적으로** 선택합니다. 활성 테마는 앱 테마에 따라 결정됩니다.

- 앱 테마 **Dark** → 선택한 다크 테마
- 앱 테마 **Light** → 선택한 라이트 테마
- 앱 테마 **System** → OS 모드에 따라 자동 전환

앱 테마를 System으로 두고 양쪽을 설정해두면, 추가 작업 없이 OS의 낮/밤 모드를 따라가는 터미널이 됩니다.

{% call callout('tip', '맞춰도 되고 어긋나게 해도 됩니다') %}
UI와 같은 톤의 터미널을 선호하는 사람도 있고, 라이트 앱에서도 강한 대비의 Dracula·Tokyo Night을 쓰는 사람도 있습니다. 둘 다 됩니다. 선택을 강제하지 않습니다.
{% endcall %}

## 탭별이 아닌 전역 설정

선택은 전역입니다. 모든 터미널 pane과 Codex 세션이 같은 활성 테마를 씁니다. 탭별 오버라이드는 현재 없습니다. 필요하면 이슈로 알려주세요.

## 직접 추가하려면

UI에서 커스텀 테마를 등록하는 기능은 아직 없습니다. 기본 목록은 `src/lib/terminal-themes.ts`에 정의되어 있으며, 소스에서 빌드한다면 직접 추가할 수 있습니다. 그 외에는 PR로 기여하는 것이 권장 경로입니다.

## 다음으로

- **[테마 & 폰트](/agentmux/tr/docs/themes-fonts/)** — 앱 테마와 폰트 크기
- **[커스텀 CSS](/agentmux/tr/docs/custom-css/)** — 나머지 UI 오버라이드
- **[에디터 연동](/agentmux/tr/docs/editor-integration/)** — 외부 에디터로 파일 열기
