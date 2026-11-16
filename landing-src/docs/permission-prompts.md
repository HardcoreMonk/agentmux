---
title: 권한 및 입력 프롬프트
description: Codex와 Claude Code의 실행 허가와 입력 선택 질문, 시작 화면을 대시보드, 키보드, 휴대폰에서 처리하는 방법.
eyebrow: Codex
permalink: /docs/permission-prompts/index.html
---
{% from "docs/callouts.njk" import callout %}

Codex와 Claude Code는 tool call, 파일 쓰기, 권한이 필요한 작업에서 사용자의 승인을 기다릴 수 있습니다. Resume working directory 선택처럼 작업 재개에 필요한 입력을 물을 때도 있습니다. agentmux는 terminal prompt를 감지해 notification panel과 timeline surface에 선택지를 표시합니다.

## 감지 방식

- tmux pane 내용을 캡처해 option을 파싱합니다.
- latest prompt block에서 command/file/permission/resume/conversation type과 risk metadata를 계산합니다.
- 생성된 hook bridge event가 있으면 이를 보조 신호로 사용합니다. Claude Code 탭은 `Notification` hook(`permission_prompt`)이 needs-input 신호의 주 경로이고, 선택지는 화면에서 읽습니다.
- 입력을 요구하지 않는 notification은 상태를 바꾸지 않습니다.

## 동작 흐름

1. tab이 입력 대기 상태임을 감지합니다.
2. 상태를 **needs-input**으로 바꾸고 WebSocket으로 broadcast합니다.
3. notification panel과 timeline surface에 agent가 보여준 선택지, prompt type, risk badge를 표시합니다.
4. notification permission이 있으면 Web Push 또는 desktop notification을 보냅니다.
5. 사용자가 선택하면 값을 tmux stdin으로 전달하고 tab을 다시 **busy**로 바꿉니다.

## 답하는 방법

- notification panel 또는 timeline에서 option 클릭.
- option 번호에 맞는 숫자 key 입력.
- 모바일 push를 눌러 해당 tab으로 이동한 뒤 notification panel에서 선택.

{% call callout('tip', '연속 prompt') %}
agent가 질문을 여러 번 이어서 하면 agentmux는 pane 내용을 다시 읽어 새 선택지를 표시합니다. 서버 재시작 뒤 resume directory prompt가 남아 있어도 needs-input으로 다시 노출합니다.
{% endcall %}

## 시작 화면

agent가 시작하는 동안 나타나는 화면도 웹에서 카드로 답할 수 있습니다. 카드는 사용자가 누른 버튼만 보내고 agentmux가 대신 고르지 않습니다.

- **폴더 신뢰** — Claude Code의 "Quick safety check"나 Codex의 "Folder access" 화면. **이 폴더 신뢰** 또는 **종료**를 고릅니다.
- **Codex hook 검토** — "Hooks need review" 화면. agentmux가 붙이는 hook 수와 화면의 새 hook 수가 같을 때만 **모두 trust하고 계속** 버튼이 보이고, 아니면 terminal의 Review hooks에서 목록을 확인합니다. agentmux hook 명령은 고정이라 한 번 trust하면 새 탭에서는 다시 뜨지 않습니다. Node 경로나 data directory가 바뀌면 한 번 더 뜹니다.
- **Codex 업데이트** — update 안내 화면. **Update now**, **Skip**, **Skip until next version** 중 하나를 고릅니다.

`agentmux tab`으로 일을 맡긴 agent는 이 화면들과 권한 질문에 입력하지 않으며, 사람이 해당 탭에서 답해야 합니다. 맡은 탭이 권한 질문에 막히면 맡긴 탭에 `blocked` 보고가 자동으로 들어갑니다.

## 실패 시 fallback

프롬프트가 scrollback에서 사라졌거나 형식이 예상과 다르면 option parsing 또는 metadata classification이 실패할 수 있습니다. 이 경우 **터미널** mode로 전환해 raw CLI에서 직접 답하면 됩니다. `Conversation interrupted` 입력 프롬프트처럼 JSONL marker가 빠진 경우는 pane capture로 stale busy를 idle로 보정합니다.

## 다음 단계

- **[세션 상태](/agentmux/docs/session-status/)**
- **[라이브 세션 뷰](/agentmux/docs/live-session-view/)**
- **[웹 푸시 알림](/agentmux/docs/web-push/)**
