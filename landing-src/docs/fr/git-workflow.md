---
title: Git 워크플로 패널
description: 터미널 옆에 있는 diff 뷰어, 히스토리 브라우저, 동기화 컨트롤. 막히면 한 번에 Codex로 넘기세요.
eyebrow: 워크스페이스 & 터미널
permalink: /fr/docs/git-workflow/index.html
---
{% from "docs/callouts.njk" import callout %}

Git 패널은 터미널과 동일한 형태의 탭 타입입니다. Codex 세션 옆에 띄워두면 변경 내용 보기, 히스토리 탐색, 푸시까지 대시보드 안에서 끝납니다. git이 막혔을 때는 "Ask Codex" 한 번으로 세션에 문제를 넘길 수 있습니다.

## 패널 열기

새 탭을 추가하면서 패널 타입을 **Diff**로 선택하거나, 기존 탭의 패널 타입 메뉴에서 전환합니다. 패널은 같은 워크스페이스의 쉘과 동일한 작업 디렉토리에 묶입니다 — 탭이 `~/code/api`라면 패널도 그 레포를 읽습니다.

| 동작 | macOS | Linux / Windows |
|---|---|---|
| 활성 탭을 Diff 모드로 전환 | <kbd>⌘⇧F</kbd> | <kbd>Ctrl+Shift+F</kbd> |

해당 디렉토리가 git 레포가 아니면 패널이 그 사실을 표시하고 조용히 비켜섭니다.

## Diff 뷰어

Changes 탭이 작업 트리의 파일별 변경을 보여줍니다.

- **Side-by-side / Inline** — 패널 헤더에서 토글. Side-by-side는 GitHub의 분할 뷰, Inline은 통합 뷰와 동일합니다.
- **신택스 하이라이팅** — 에디터에서 하이라이팅되는 언어는 모두 지원.
- **Inline hunk 확장** — hunk 주변 컨텍스트 라인을 클릭해서 패널을 떠나지 않고 주변 코드를 펼쳐볼 수 있습니다.
- **파일 목록** — 패널 사이드바에서 변경 파일 사이를 이동합니다.

패널이 보이는 동안에는 10초마다 변경을 리프레시하고, 외부 도구에서 저장이 일어나면 즉시 갱신합니다. 브라우저가 hidden 상태이면 polling을 건너뛰고 visible 복귀 때 즉시 다시 확인합니다. 같은 `cwd + diff hash`의 full diff는 짧은 서버 메모리 cache를 재사용해 반복 전환 비용을 줄입니다.

대량 변경이 있는 레포에서는 tracked diff, untracked 파일 수, untracked 파일 크기, 전체 untracked diff 크기를 제한합니다. 제한을 넘은 파일은 생략 수를 표시하고, binary/대용량 파일은 placeholder로 보여줍니다.

## 커밋 히스토리

**History** 탭은 현재 브랜치의 페이지네이션된 커밋 로그를 보여줍니다. 각 항목에 해시, 제목, 작성자, 시각이 나옵니다. 클릭하면 해당 커밋의 diff가 열립니다. 터미널로 빠져나가 `git log`를 칠 필요 없이 "이 파일이 왜 이렇게 됐지?"를 그 자리에서 확인할 수 있습니다.

## 동기화 패널

헤더 스트립에 현재 브랜치, 업스트림, ahead/behind 카운터가 표시됩니다. 액션은 셋:

- **Fetch** — 백그라운드에서 3분마다 `git fetch`를 돌리고, 수동 실행도 가능합니다.
- **Pull** — 가능하면 fast-forward.
- **Push** — 설정된 업스트림으로 push.

Sync는 의도적으로 좁게 만들어졌습니다. 사람의 판단이 필요한 상황 — 브랜치가 갈라졌거나, 워킹 트리가 더럽거나, 업스트림이 없거나 — 은 거부하고 그 이유를 알려줍니다.

{% call callout('warning', '동기화가 막힐 때') %}
패널이 명확하게 보고하는 실패들:

- **No upstream** — `git push -u`가 아직 실행되지 않음
- **Auth** — 자격증명이 없거나 거부됨
- **Diverged** — 로컬과 원격이 각자 고유 커밋을 가짐. rebase 또는 merge 필요
- **로컬 변경 사항** — 커밋되지 않은 작업이 pull을 막음
- **Rejected** — non-fast-forward로 push 거부됨
{% endcall %}

## Ask Codex

Sync가 실패하면 에러 토스트에 **Ask Codex** 버튼이 함께 떠오릅니다. 클릭하면 실패 컨텍스트 — 에러 종류, 관련 `git` 출력, 현재 브랜치 상태 — 가 같은 워크스페이스의 Codex 탭에 프롬프트로 전달됩니다. 이후 Codex가 rebase, 충돌 해결, 업스트림 설정 등 필요한 복구 단계를 안내합니다.

이 패널의 핵심 베팅은 이것입니다 — 일반적인 케이스는 도구로, 그 외 long tail은 LLM에게. 컨텍스트를 전환하지 않습니다. 어차피 갈 세션에 프롬프트가 도착해 있을 뿐입니다.

## 다음으로

- **[탭 & 창](/agentmux/fr/docs/tabs-panes/)** — Codex 세션 옆에 diff 패널 분할로 띄우기
- **[첫 세션](/agentmux/fr/docs/first-session/)** — 권한/입력 프롬프트가 대시보드에 어떻게 노출되는지
- **[웹 브라우저 패널](/agentmux/fr/docs/web-browser-panel/)** — 터미널 옆에 두면 좋은 또 하나의 패널 타입
