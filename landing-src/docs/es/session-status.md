---
title: 세션 상태
description: Codex 활동을 다섯 가지 badge 상태로 바꾸는 방식.
eyebrow: Codex
permalink: /es/docs/session-status/index.html
---
{% from "docs/callouts.njk" import callout %}

sidebar의 session dot은 Codex가 무엇을 하고 있는지 보여줍니다. agentmux는 process, JSONL, terminal state를 조합해 상태를 유지합니다.

## 상태

| 상태 | 의미 |
|---|---|
| **Idle** | Codex가 다음 prompt를 기다림 |
| **Busy** | Codex가 작업 중 |
| **Needs input** | permission/input prompt, resume directory 선택, 기타 질문 대기 |
| **Review** | 작업 완료, 확인 필요 |
| **Unknown** | 서버 재시작 후 복구 중 |

## 상태 출처

| 신호 | 정보 |
|---|---|
| tmux foreground command | pane이 shell인지 Codex인지 |
| process tree detection | live `codex` process 존재 여부 |
| Codex JSONL tail | session id, model, current action, token usage |
| live pane capture | permission/input prompt, interrupted prompt 보정 |

Codex hook event는 inline hook config가 `status-hook.sh`를 호출해 전달합니다. 생성된 `hooks.json`도 남아 있지만 Codex status는 이 파일을 launch config source로 보지 않습니다. session list는 로컬 `~/.codex/sessions/**/*.jsonl`에서 인덱싱한 resume 대상만 표시합니다. 인덱스 refresh 중에는 현재 snapshot을 먼저 보여주고 완료 뒤 갱신합니다.

## JSONL watcher

Codex는 `~/.codex/sessions/` 아래에 transcript JSONL을 씁니다. agentmux는 active tab의 JSONL을 감시해 last assistant message, current action, token count를 갱신합니다. 사용자가 실행 중 <kbd>Esc</kbd>를 누른 경우 interruption marker를 감지해 tab이 `busy`에 갇히지 않게 합니다. JSONL marker 없이 `Conversation interrupted` prompt만 live pane에 남아도 stale `busy`를 `idle`로 보정합니다.

Codex CLI가 process 시작 후 JSONL을 늦게 쓰는 경우를 고려해 session id, 같은 cwd의 process start time, live process 확인 후 cwd fallback 순서로 transcript를 연결합니다. 일반 JSONL 검색은 cwd만으로 최신 파일을 고르지 않습니다.

## polling

30-60초 간격의 metadata poll은 놓친 event를 보정하는 안전망입니다. 죽은 process, stale `busy`, 새 tmux pane, title metadata, live input prompt를 확인합니다.

## 재시작 복구

재시작 전 `busy`였던 tab은 `unknown`으로 시작합니다. Codex process가 없으면 `idle`, JSONL이 정상 종료되었으면 `review`로 전환합니다. Live pane에 resume directory 같은 선택지가 보이면 persisted state가 `idle`이어도 `needs-input`으로 복구합니다. 복구 중 자동 완료 전환은 push notification을 보내지 않습니다.

## 다음 단계

- **[권한/입력 프롬프트](/agentmux/es/docs/permission-prompts/)**
- **[라이브 세션 뷰](/agentmux/es/docs/live-session-view/)**
- **[데이터 디렉터리](/agentmux/es/docs/data-directory/)**
