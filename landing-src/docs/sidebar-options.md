---
title: 탐색, 사이드바 & Codex 옵션
description: 고정 1차 영역, 사이드바 utility, 퀵 프롬프트와 Codex·Claude Code CLI option 설정.
eyebrow: 설정
permalink: /docs/sidebar-options/index.html
---
{% from "docs/callouts.njk" import callout %}

sidebar, quick prompt, Codex launch option은 Settings에서 조정합니다. 이 값은 새 session과 dashboard 사용 흐름에 영향을 줍니다.

## 주요 영역과 Workspace context

**워크스페이스**, **세션**, **거버넌스**는 desktop과 mobile에서 항상 같은 순서로 표시되는 고정
1차 영역입니다. 현재 영역은 label, surface와 indicator로 표시되며 설정에서 숨기거나 순서를 바꿀 수
없습니다. **워크스페이스 / 활동**은 Workspace 내부 목록과 운영 activity를 전환하며 Session Catalog
route와 별개입니다.

## sidebar shortcut

**Settings** -> **Sidebar**에서 sidebar 하단 shortcut을 관리합니다.

- Notes, Stats와 custom item을 drag로 순서 변경.
- Utility item을 switch로 표시/숨김.
- custom item 추가와 삭제.
- 기본값으로 reset.

Sessions와 Governance가 목록에 보여도 **항상 표시**되는 core area이므로 switch와 drag가
비활성화됩니다.

## quick prompt

**Settings** -> **Quick Prompts**에서 input 위에 표시되는 prompt button을 관리합니다. 자주 쓰는 요청을 버튼 하나로 보낼 수 있습니다.

예시:

- 테스트 실행.
- 현재 diff review.
- 마지막 commit 요약.
- release note 초안 작성.

## Codex option

**Settings** -> **Codex**의 값은 새로 여는 Codex tab에 적용됩니다. 이미 실행 중인 session은 바꾸지 않습니다.

| option | 의미 |
|---|---|
| model | `codex --model` 값 |
| sandbox | `codex --sandbox` 값 |
| approval policy | `codex --ask-for-approval` 값(`on-request` 또는 `never`) |
| web search | `--search` 추가 여부 |
| terminal 표시 | timeline과 raw terminal을 함께 보여줄지 여부. 지금은 **Settings** -> **Terminal**의 공통 switch |

## Claude Code option

**Settings** -> **Claude Code**의 값도 새로 여는 Claude Code tab에 적용되고 이미 실행 중인 session은 바꾸지 않습니다. 위 표의 "terminal 표시"는 지금 **Settings** -> **Terminal**의 "에이전트 화면에서 터미널 같이 보기" switch이며 Codex와 Claude Code 화면에 공통입니다.

| option | 의미 |
|---|---|
| model | `claude --model` 값. 비우면 Claude 설정을 따름 |
| permission mode | `claude --permission-mode` 값(`acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`) |

명령 미리보기의 `--settings` 경로와 `--session-id` 값은 실행 시 자동으로 채워집니다.

## 위임과 자동 보고

**Settings** -> **General**의 두 switch는 agentmux가 띄우는 Claude Code와 Codex에 적용됩니다. "Agent에 위임 안내 넣기"(기본 켬)는 agent가 `agentmux tab` 명령으로 다른 탭에 일을 맡기게 하며 새로 시작하거나 재개하는 agent부터 적용됩니다. "agent 자동 보고"(기본 켬)는 맡은 탭이 끝나거나 권한 질문에 막히면 맡긴 agent의 입력창에 보고를 넣습니다. 위임 안내를 끄면 자동 보고도 쓸 수 없습니다.

## 다음 단계

- **[퀵 프롬프트 & 첨부](/agentmux/docs/quick-prompts-attachments/)**
- **[테마 & 글꼴](/agentmux/docs/themes-fonts/)**
- **[권한/입력 프롬프트](/agentmux/docs/permission-prompts/)**
