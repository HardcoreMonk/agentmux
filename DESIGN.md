# agentmux 시각 계약

agentmux UI는 코딩 에이전트 CLI 작업(현재 Codex 지원, Claude Code 지원 예정)을 오래 켜 두고 반복적으로 확인하는 운영 도구입니다.
첫인상은 조용하고 밀도 있는 운영실이어야 하며, terminal/input/reconnect
안정성이 시각 장식보다 항상 우선합니다.

## 역할

- 이 파일은 root UI 시각 계약입니다.
- 제품/아키텍처 설계 요약은 `docs/PROJECT-DESIGN.md`를 따릅니다.
- 세부 theme, color, terminal/mobile UI 규칙은 `docs/STYLE.md`를 따릅니다.
- 작업 방식, 보안, 수명주기 규칙은 `AGENTS.md`를 따릅니다.

## 시각 방향

- 제품 UI는 dashboard가 아니라 Codex session 운영 surface입니다.
- 화면은 훑어보기 쉽고 정보 밀도가 높아야 합니다.
- Marketing hero, 장식용 illustration, floating section card, nested card를
  제품 화면에 넣지 않습니다.
- Terminal, timeline, status, approval, stats는 사용자가 빠르게 상태를 판단할 수
  있게 가까운 곳에 배치합니다.

### 공개 사이트 예외

`landing-src/`의 공개 홈페이지와 문서는 제품 runtime UI가 아니라 제품을 설명하는 projection
surface입니다. 홈페이지는 첫 방문자가 설치와 운영 영역을 빠르게 찾을 수 있도록 다음 시각
문법을 사용할 수 있습니다.

- Home/docs 공통 floating header와 grouped navigation
- 제품 경계를 설명하는 단일 image-led hero와 code-native product preview
- quickstart terminal, capability bento, docs map
- Auto, Light, Dark theme와 한국어·영어 제품 home

이 예외는 앱 화면의 marketing hero 금지를 완화하지 않습니다. 공개 사이트의 장식 자산도 제품
의미를 전달해야 하며, 제3자 문구·코드·로고·screenshot을 복제하거나 실제 사용자 데이터처럼
보이는 값을 사용하지 않습니다.

## 토큰과 색상

색상은 상태 의미를 구분하는 데만 강하게 사용합니다.

| 용도 | 기준 |
| --- | --- |
| 기본 surface | neutral, muted token |
| 진행 중 | accent 또는 primary token |
| 주의 | warning tone |
| 위험/파괴 | destructive token |
| 비활성 | muted foreground |

새 색상 literal을 즉흥적으로 추가하지 않습니다. Tailwind CSS v4와 shadcn/ui token을
우선하고, 새 token이 필요하면 `docs/STYLE.md`에 의미를 먼저 기록합니다.

## 타이포그래피와 문구

- 기본 locale은 `ko`이며 영어 UI message를 병행 유지합니다.
- 한국어 화면은 project font stack과 `word-break: keep-all`을 기본으로 사용합니다.
- Terminal, code, diff, path, input, textarea, xterm 영역은 줄바꿈 예외입니다.
- compact panel, sidebar, table, toolbar 안에서는 hero-scale heading을 쓰지 않습니다.
- button text와 badge text는 container 밖으로 넘치지 않아야 합니다.

## 레이아웃

- 제품 화면은 첫 viewport에서 실제 작업 상태를 보여줍니다.
- section을 floating card처럼 꾸미지 않습니다.
- card는 반복 item, modal, 명확히 framed tool에만 사용합니다.
- board, toolbar, counter, tab, tile처럼 fixed-format 요소는 안정적인 dimension을 둡니다.
- 긴 terminal/timeline content는 주변 control을 밀거나 덮지 않아야 합니다.

## 컴포넌트 상태

상호작용 component는 다음 상태를 구분합니다.

| 상태 | 기준 |
| --- | --- |
| normal | 훑어보기 쉬운 neutral surface |
| hover | pointer target이 명확하지만 layout shift 없음 |
| active | touch/click feedback 제공 |
| focus-visible | keyboard focus ring 제공 |
| disabled | muted foreground와 동작 불가 상태 명확화 |
| loading | 기존 dimension을 유지하며 progress 표시 |
| empty/error | 원인과 회복 action을 간단히 노출 |

icon button은 가능한 lucide-react icon을 사용하고, 낯선 icon에는 tooltip을 둡니다.

### 탐색과 선택

Workspace, Sessions, Governance는 desktop과 mobile에서 같은 순서의 1차 앱 영역으로
표시합니다. 현재 route와 domain entity 선택은 서로 다른 상태입니다.

| 의미 | 필수 표현 |
| --- | --- |
| Current app area | leading indicator, selected surface, icon/label, `aria-current="page"` |
| Selected entity | border, selected surface, persistent marker, `aria-selected="true"` |
| Expanded disclosure | chevron과 child visibility, `aria-expanded` |
| Keyboard focus | selection과 독립된 `focus-visible` ring |
| Runtime status | busy, needs-input, review, degraded의 기존 semantic color와 badge |

Navigation selection에는 runtime status token을 사용하지 않습니다. `focus-indicator`,
`accent`, `foreground`, `border`를 사용하며 color 하나만으로 상태를 구분하지 않습니다.
Notes, Stats, custom webview 같은 utility surface에서는 세 app area 중 어느 것도 current로
표시하지 않습니다.

## 반응형과 접근성

- Windows Electron과 desktop browser에서 keyboard focus, IME, input draft, reconnect flow를
  primary 기준으로 검증합니다.
- Android WebView와 iPad Safari는 legacy/mobile regression 범위입니다. 가능한 44px 이상의
  touch target, safe area, input draft, reconnect 동작을 보존합니다.
- Mobile은 48px 이상의 label 포함 app area navigation을 유지하고 Workspace 전용 tab bar는
  Workspace route에서만 표시합니다.
- UI text가 다른 control, terminal preview, status recovery UI를 가리지 않아야 합니다.
- SSR page는 저장된 locale로 message bundle과 `html lang`을 맞춥니다.

## 권장과 금지

권장:

- Codex session state, timeline, pending approval, runtime health를 우선 노출합니다.
- 같은 종류의 운영 상태는 같은 시각 언어로 표현합니다.
- error와 recovery action을 가까이 둡니다.

금지:

- dashboard를 landing page처럼 구성하지 않습니다.
- decorative orb, gradient blob, bokeh background, 의미 없는 SVG hero를 넣지 않습니다.
- 단일 hue variation만으로 전체 화면을 만들지 않습니다.
- Linux engine 운영 화면에 역사적 Windows package나 선택 client 안내를 primary
  action처럼 노출하지 않습니다.

## 에이전트 작업 가이드

UI 작업을 시작할 때는 다음 순서로 확인합니다.

1. `AGENTS.md`의 framework, locale, 수명주기 규칙.
2. `CONTEXT.md`의 도메인 용어와 거부 용어.
3. 이 파일의 시각 계약.
4. `docs/STYLE.md`의 세부 style rule.
5. 관련 component와 message file.

검증은 변경 범위에 맞게 `corepack pnpm lint`, `corepack pnpm tsc --noEmit`,
focused test, 필요한 browser/mobile smoke 순서로 수행합니다.
