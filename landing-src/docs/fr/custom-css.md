---
title: 커스텀 CSS
description: CSS 변수를 오버라이드해서 컬러·여백·개별 영역을 재조정합니다.
eyebrow: 커스터마이즈
permalink: /fr/docs/custom-css/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 CSS 변수 시스템 위에 만들어져 있습니다. 소스를 건드리지 않고도 거의 모든 시각 요소를 바꿀 수 있습니다. **외형** 탭에 규칙을 붙여넣고 Apply를 누르면 연결된 모든 클라이언트에 즉시 반영됩니다.

## 어디에 작성하나요

설정(<kbd>⌘,</kbd>)을 열고 **외형** 탭을 선택합니다. 사용자 CSS라는 라벨이 붙은 텍스트영역이 하나 있습니다.

1. 규칙을 작성합니다.
2. **Apply**를 누르면 모든 페이지의 `<style>` 태그에 주입됩니다.
3. **초기화**로 전체 초기화.

작성한 CSS는 서버의 `~/.agentmux/config.json`(`customCSS`)에 저장되므로, 접속하는 모든 디바이스에 동일하게 적용됩니다.

{% call callout('note', '디바이스별이 아닌 서버 단위') %}
커스텀 CSS는 서버 설정에 저장되어 어떤 브라우저로 접속하든 따라옵니다. 디바이스별로 다른 외형을 원한다면 현재는 지원하지 않습니다.
{% endcall %}

## 동작 원리

agentmux의 컬러·서피스·악센트는 대부분 `:root`(라이트)와 `.dark`(다크) 아래의 CSS 변수로 노출됩니다. 변수 하나만 덮어쓰면 그 변수를 참조하는 모든 컴포넌트(사이드바·다이얼로그·차트·상태 배지)가 한 번에 따라 바뀝니다.

컴포넌트 셀렉터를 직접 오버라이드하는 것보다 변수를 바꾸는 편이 거의 항상 낫습니다. 컴포넌트 클래스는 안정적인 API가 아니지만 변수는 그렇습니다.

## 최소 예시

라이트 모드 사이드바를 살짝 따뜻하게, 다크 모드 배경은 더 어둡게.

```css
:root {
  --sidebar: oklch(0.96 0.012 80);
}

.dark {
  --background: oklch(0.05 0 0);
}
```

브랜드 컬러만 바꾸려면.

```css
:root {
  --primary: oklch(0.55 0.16 280);
}

.dark {
  --primary: oklch(0.78 0.14 280);
}
```

## 변수 그룹

외형 패널의 **사용 가능한 변수** 섹션을 펼치면 전체 목록이 보입니다. 주요 묶음은 다음과 같습니다.

- **Surface** — `--background`, `--card`, `--popover`, `--muted`, `--secondary`, `--accent`, `--sidebar`
- **Text** — `--foreground` 및 대응 `*-foreground`
- **Interactive** — `--primary`, `--primary-foreground`, `--destructive`
- **Border** — `--border`, `--input`, `--ring`
- **Palette** — `--ui-blue`, `--ui-teal`, `--ui-coral`, `--ui-amber`, `--ui-purple`, `--ui-pink`, `--ui-green`, `--ui-gray`, `--ui-red`
- **Semantic** — `--positive`, `--negative`, `--accent-color`, `--brand`, `--focus-indicator`, `--agent-active`

전체 토큰 목록과 기본 oklch 값, 디자인 의도는 저장소의 [`docs/STYLE.md`](https://github.com/HardcoreMonk/agentmux/blob/main/docs/STYLE.md)에 정리되어 있습니다. 이 문서가 단일 소스입니다.

## 모드별로만 적용하기

라이트는 `:root`, 다크는 `.dark`로 감쌉니다. `.dark` 클래스는 `next-themes`가 `<html>`에 자동으로 붙입니다.

```css
:root {
  --muted: oklch(0.95 0.01 287);
}

.dark {
  --muted: oklch(0.18 0 0);
}
```

한쪽만 바꾸고 싶으면 다른 쪽은 그대로 두세요.

## 터미널은요?

xterm.js 터미널은 위 CSS 변수가 아니라 별도의 큐레이션된 팔레트를 씁니다. **터미널** 탭에서 전환하세요. [터미널 테마](/agentmux/fr/docs/terminal-themes/) 참고.

## 다음으로

- **[테마 & 폰트](/agentmux/fr/docs/themes-fonts/)** — 라이트/다크/시스템, 폰트 크기 프리셋
- **[터미널 테마](/agentmux/fr/docs/terminal-themes/)** — 터미널 영역 전용 팔레트
- **[사이드바 & Codex 옵션](/agentmux/fr/docs/sidebar-options/)** — 항목 정렬, Codex 플래그 토글
