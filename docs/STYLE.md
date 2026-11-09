# 스타일 가이드

agentmux UI는 운영 도구입니다. 화면은 조용하고 밀도 있게 구성하며, terminal/input/reconnect 안정성을 시각 장식보다 우선합니다.

## 원칙

- 제품 화면은 marketing hero처럼 만들지 않습니다.
- 정보는 scan 가능해야 합니다.
- Card 안에 card를 중첩하지 않습니다.
- Terminal, code, path, input, textarea, xterm 영역은 줄바꿈 예외로 둡니다.
- 긴 한국어 문장은 `word-break: keep-all`을 기본으로 하되, 경로나 코드에는 적용하지 않습니다.
- Hover, active, focus-visible 상태를 제공합니다.

## 테마

Theme token은 Tailwind CSS v4와 shadcn/ui conventions를 따릅니다. 새 색을 즉흥적으로 늘리지 않고 기존 token을 우선합니다.

공개 사이트는 `data-theme-preference=auto|light|dark`와 resolved
`data-theme=light|dark`를 사용합니다. 저장값이 없으면 system preference를 따르고, header의 theme
control은 Auto → Light → Dark 순서로 순환합니다. 첫 paint 전에 resolved theme를 설정해 화면
깜빡임을 줄입니다.

## 로케일과 타이포그래피

- 기본 locale은 `ko`입니다.
- English UI message는 병행 유지합니다.
- SSR page는 저장된 locale로 message bundle과 `html lang`을 맞춥니다.
- 한국어 화면은 project font stack과 `word-break: keep-all`을 사용합니다.

## Linux engine 우선과 선택 client

- Linux engine에 연결된 desktop browser의 keyboard focus, IME, input draft, reconnect flow를
  primary 기준으로 검증합니다.
- Electron, Android WebView와 iPad Safari는 선택 client/regression surface입니다.
- Mobile client에서는 가능한 touch target을 44px 이상으로 두고 safe area를 고려합니다.
- Terminal preview와 status recovery UI가 서로 가리지 않아야 합니다.

## 색상 토큰

Color는 상태 의미를 구분하는 데 사용합니다.

| 용도 | 기준 |
| --- | --- |
| 정상 | muted/neutral 기반 |
| 진행 | accent 또는 primary |
| 주의 | warning tone |
| 위험 | destructive tone |
| 비활성 | muted foreground |

단일 hue variation만으로 전체 화면을 만들지 않습니다. Purple/blue gradient, beige/sand, dark slate, brown/orange 계열이 화면 전체를 지배하지 않게 합니다.

## Navigation과 selection

- Workspace, Sessions, Governance는 숨길 수 없는 core app area입니다.
- Desktop expanded navigation은 icon+label과 leading indicator를 사용합니다.
- Collapsed rail은 최소 40px이며 tooltip, accessible label과 current indicator를 유지합니다.
- Mobile app area item은 icon+label, 최소 48px이며 safe area를 침범하지 않습니다.
- Current route는 `aria-current="page"`, selected list entity는 `aria-selected`, disclosure는
  `aria-expanded`를 사용합니다.
- Navigation/selection은 `focus-indicator`, `accent`, `foreground`, `border` 조합을 사용합니다.
- `agent-active`, warning, destructive 계열은 runtime/lifecycle 상태 의미로만 사용합니다.
- Utility route와 custom webview는 core app area를 거짓 current로 표시하지 않습니다.
- Hover, selected와 focus-visible이 겹쳐도 selected marker와 focus ring이 모두 보여야 합니다.

## 공개 홈페이지와 문서 shell

- Homepage와 docs는 brand, grouped navigation, search, GitHub, theme, locale control을 공유합니다.
- Desktop header는 floating pill을 사용하고, mobile은 search와 menu를 남긴 compact header로
  전환합니다. Mobile target은 가능한 44px 이상이어야 합니다.
- Homepage section 순서는 hero, quickstart, product proof, capability bento, docs map입니다.
- Hero artwork는 한 장만 eager load하고 WebP 우선, PNG fallback을 제공합니다.
- 제품 preview는 live API나 실제 session data를 쓰지 않는 code-native 설명 surface입니다.
- Workspace, Sessions, Governance route와 entity selection, runtime status는 서로 다른 label,
  surface, indicator로 표현합니다.
- Docs는 desktop sidebar/TOC와 mobile drawer/breadcrumb를 유지하며 home과 같은 theme token을
  소비합니다.
- Search dialog는 keyboard shortcut, focus-visible, `Esc` 닫기와 trigger focus 복귀를 제공합니다.

## 차트 색상

Chart는 비교 가능한 색 대비를 사용합니다. 같은 계열 shade만 반복하지 않습니다.

## 금지 장식

아래 항목은 제품 runtime UI에 적용합니다. 공개 homepage는 위 공개 사이트 계약 안에서 단일
hero와 framed 설명 surface를 사용할 수 있습니다. 공개 homepage의 display heading만 읽을 수
있는 min/max가 있는 `clamp()`와 제한된 tight tracking을 사용할 수 있으며, control·본문·제품
preview에는 적용하지 않습니다.

- decorative orb
- gradient blob
- bokeh background
- 의미 없는 SVG hero
- floating section card
- nested card
- viewport width 기반 font scaling
- negative letter spacing

## 금지 패턴 예시

- 버튼 text가 container 밖으로 넘침
- icon 대신 text badge로 tool button을 채움
- terminal 위에 설명 text를 겹침
- dashboard를 landing page처럼 구성
- Linux engine 운영 화면에 역사적 Windows package나 선택 client 설치 안내를 primary로 노출
