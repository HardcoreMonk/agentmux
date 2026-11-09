---
title: 첫 세션
description: 빈 workspace에서 Codex 세션을 만들고 확인하는 흐름.
eyebrow: 시작하기
permalink: /ko/docs/first-session/index.html
---
{% from "docs/callouts.njk" import callout %}

이 문서는 agentmux가 이미 실행 중이라고 가정합니다. 아직 실행하지 않았다면 [빠른 시작](/agentmux/ko/docs/quickstart/)부터 진행하세요.

## workspace 만들기

1. sidebar의 workspace 영역에서 **+**를 누릅니다.
2. 이름과 기본 디렉터리를 입력합니다.
3. Enter를 누르면 빈 workspace가 열립니다.

기본 디렉터리는 새 shell과 Codex tab의 cwd로 사용됩니다.

## 첫 tab 열기

<kbd>⌘T</kbd> 또는 tab bar의 **+** 버튼을 누릅니다.

- **터미널**: 빈 shell.
- **Codex**: shell 안에서 `codex`를 실행.
- **Diff**: Git 변경 사항 확인.
- **Web browser**: Electron browser panel.

Codex 템플릿은 terminal을 열고 `codex`를 실행하는 shortcut입니다. 터미널 tab에서 직접 `codex`를 실행해도 agentmux가 감지합니다.

## 상태 badge

| 상태 | 의미 |
|---|---|
| **Idle** | Codex가 다음 입력을 기다림 |
| **Busy** | Codex가 작업 중 |
| **Needs input** | permission/input prompt, resume directory 선택, 기타 질문 대기 |
| **Review** | 작업 완료, 확인 필요 |

## permission/input prompt

Codex가 tool 실행, 파일 변경 허가, resume directory 선택을 요청하면 agentmux는 notification panel과 timeline에 prompt를 표시합니다. notification panel은 prompt type과 risk badge를 함께 보여주며, option을 클릭하거나 숫자 key를 누르거나 모바일 push를 눌러 해당 tab으로 이동한 뒤 선택할 수 있습니다.

## 복구

브라우저를 닫아도 tmux session은 유지됩니다. 서버가 재시작되면 layout을 읽고 가능한 경우 `codex resume <sessionId>`로 Codex session을 이어 붙입니다.

## 다음 단계

- **[세션 상태](/agentmux/ko/docs/session-status/)**
- **[권한/입력 프롬프트](/agentmux/ko/docs/permission-prompts/)**
- **[브라우저 지원](/agentmux/ko/docs/browser-support/)**
