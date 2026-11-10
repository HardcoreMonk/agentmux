# Claude Code provider 설계 1 Design Review

- 날짜: 2026-11-10
- 대상: `../specs/2026-11-10-claude-code-provider-design.md`의 화면 항목(B, C의 표시 부분)
- 기준: `DESIGN.md`, `docs/STYLE.md`, `AGENTS.md` UI와 Locale 규칙
- 결과: Approved (조건부)

## Review

- 새 화면 요소는 모두 기존 운영 surface 안의 control이다(새 탭 메뉴 항목, 보기 전환 버튼, 세션 목록의
  provider 표시, rate limit 줄, trust 확인 카드, 시작 진행 표시, 전환 잠금 toast). 새 page나 dashboard형
  화면을 만들지 않는다.
- Claude 탭은 Codex 탭과 같은 배치(timeline, 입력창, 접히는 terminal)를 쓴다. 같은 종류의 운영 상태를 같은
  시각 언어로 표현한다는 원칙과 맞는다.
- 상태 badge(busy, needs-input, review)는 provider와 관계없이 기존 semantic token을 그대로 쓴다. Provider
  구분은 icon과 label이 맡고, 상태 색을 provider 구분에 쓰지 않는다.
- 권한 요청과 trust 확인은 기존 approval 카드 문법을 따르고 응답 action을 내용 가까이에 둔다.
- 위임으로 만든 탭은 active 탭을 바꾸지 않는다. 사용자의 terminal/input 흐름을 끊지 않는다는 우선순위와
  맞는다.

## Conditions

- Provider는 색 하나로 구분하지 않는다. 탭, 새 탭 메뉴, 세션 목록, rate limit 줄에서 icon과 함께 text label
  (`Codex`, `Claude Code` 또는 짧은 label)이나 tooltip을 둔다.
- Provider icon은 기존 `OpenAIIcon`과 같은 단색(`currentColor`)·같은 크기로 맞춘다. Brand 색 fill을 쓰지 않는다.
- 보기 전환 버튼이 3개에서 4개(TERMINAL / CODEX / CLAUDE / DIFF)로 늘어난다. Desktop content header에서 넘침
  없이 고정 폭을 유지하고, 모바일 `PANEL_MODES`는 360px 폭에서 44px 이상 touch target을 유지한다. 넘치면
  label을 줄이고 icon + tooltip으로 바꾼다.
- Sidebar와 모바일 sheet의 rate limit은 data가 있는 provider만 보여 준다. 두 provider가 모두 있을 때도 기존
  높이에서 크게 늘지 않게 provider당 한 줄로 쓴다.
- 세션 목록의 provider filter는 기본값 "전체"이고, 각 item에 provider label을 둔다.
- 위임으로 만든 탭에는 만든 쪽을 알 수 있는 표시(icon 또는 짧은 label + tooltip)를 붙인다. 표시는 탭 폭을
  바꾸지 않는다.
- Trust 확인 카드와 시작 진행 표시는 loading 중 기존 dimension을 유지하고, 실패하면 원인과 회복 action(재시도,
  terminal 보기)을 둔다.
- 새 문구는 ko/en을 함께 추가하고 Codex 고유 문구는 `{agent}` 인자로 바꾼다. 한국어 문구는 `word-break:
  keep-all`을 따른다.
- `DESIGN.md`의 "Codex session 운영 surface", "Codex session state" 표현은 단계 3 release에서 "코딩 에이전트
  session"으로 넓힌다.

Blocker는 없다.
