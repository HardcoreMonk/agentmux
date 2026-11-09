---
title: 탭 & 창
description: 워크스페이스 안에서 탭이 동작하는 방식, 창을 분할하는 법, 그리고 그 사이를 오가는 단축키.
eyebrow: 워크스페이스 & 터미널
permalink: /tr/docs/tabs-panes/index.html
---
{% from "docs/callouts.njk" import callout %}

워크스페이스는 **창(pane)**으로 나뉘고, 각 창은 여러 **탭**을 쌓아 가집니다. 분할은 동시에 여러 화면을 보기 위한 것이고, 탭은 한 창 안에서 여러 쉘을 화면 면적을 빼앗기지 않고 유지하기 위한 것입니다.

## 탭

모든 탭은 tmux 세션에 붙은 실제 쉘입니다. 탭 제목은 포어그라운드 프로세스에서 따옵니다 — `vim`을 실행하면 탭 이름이 바뀌고, 종료하면 디렉토리 이름으로 돌아옵니다.

| 동작 | macOS | Linux / Windows |
|---|---|---|
| 새 탭 | <kbd>⌘T</kbd> | <kbd>Ctrl+T</kbd> |
| 탭 닫기 | <kbd>⌘W</kbd> | <kbd>Ctrl+W</kbd> |
| 이전 탭 | <kbd>⌘⇧[</kbd> | <kbd>Ctrl+Shift+[</kbd> |
| 다음 탭 | <kbd>⌘⇧]</kbd> | <kbd>Ctrl+Shift+]</kbd> |
| 1–9번 탭으로 이동 | <kbd>⌃1</kbd> – <kbd>⌃9</kbd> | <kbd>Alt+1</kbd> – <kbd>Alt+9</kbd> |

탭 바에서 탭을 드래그하면 순서가 바뀝니다. 탭 바 끝의 **+** 버튼은 <kbd>⌘T</kbd>와 같은 템플릿 선택 메뉴를 엽니다.

{% call callout('tip', '터미널 외의 템플릿') %}
새 탭 메뉴에서는 **터미널**, **Codex**, **Diff**, **웹 브라우저** 중 패널 타입을 고를 수 있습니다. 모두 탭이므로 한 창 안에 섞어두고 위 단축키로 자유롭게 전환할 수 있습니다.
{% endcall %}

## 창 분할

탭은 화면을 공유합니다. 동시에 두 개를 보고 싶으면 창을 분할하세요.

| 동작 | macOS | Linux / Windows |
|---|---|---|
| 오른쪽으로 분할 | <kbd>⌘D</kbd> | <kbd>Ctrl+Alt+D</kbd> |
| 아래로 분할 | <kbd>⌘⇧D</kbd> | <kbd>Ctrl+Shift+D</kbd> |

Linux/Windows에서 <kbd>Ctrl+D</kbd>는 터미널과 Codex CLI의 EOF 입력으로 예약되어 있어 오른쪽 분할은 <kbd>Ctrl+Alt+D</kbd>를 사용합니다.

새로 만들어지는 분할은 워크스페이스의 기본 디렉토리를 상속받고 빈 터미널 탭으로 시작합니다. 각 창은 자체 탭 바를 가지므로 오른쪽 창에서는 diff 뷰어를, 왼쪽 창에서는 `codex`를 돌리는 식으로 쓸 수 있습니다.

## 창 사이 포커스 이동

방향 단축키로 이동합니다 — 분할 트리를 따라 걷기 때문에, 깊게 중첩된 창에서 <kbd>⌘⌥→</kbd>를 눌러도 화면상 인접한 창으로 정확히 이동합니다.

| 동작 | macOS | Linux / Windows |
|---|---|---|
| 왼쪽으로 포커스 | <kbd>⌘⌥←</kbd> | <kbd>Ctrl+Alt+←</kbd> |
| 오른쪽으로 포커스 | <kbd>⌘⌥→</kbd> | <kbd>Ctrl+Alt+→</kbd> |
| 위로 포커스 | <kbd>⌘⌥↑</kbd> | <kbd>Ctrl+Alt+↑</kbd> |
| 아래로 포커스 | <kbd>⌘⌥↓</kbd> | <kbd>Ctrl+Alt+↓</kbd> |

## 크기 조정과 균등화

창 사이의 분리선을 드래그하거나 키보드로 조정합니다.

| 동작 | macOS | Linux / Windows |
|---|---|---|
| 왼쪽 크기 조정 | <kbd>⌘⌃⇧←</kbd> | <kbd>Ctrl+Alt+Shift+←</kbd> |
| 오른쪽 크기 조정 | <kbd>⌘⌃⇧→</kbd> | <kbd>Ctrl+Alt+Shift+→</kbd> |
| 위쪽 크기 조정 | <kbd>⌘⌃⇧↑</kbd> | <kbd>Ctrl+Alt+Shift+↑</kbd> |
| 아래쪽 크기 조정 | <kbd>⌘⌃⇧↓</kbd> | <kbd>Ctrl+Alt+Shift+↓</kbd> |
| 분할 균등화 | <kbd>⌘⌥=</kbd> | <kbd>Ctrl+Alt+=</kbd> |

레이아웃이 한쪽으로 너무 치우쳐 못 쓸 정도가 됐을 때 균등화가 가장 빠른 리셋 방법입니다.

## 화면 비우기

<kbd>⌘K</kbd>는 현재 창의 터미널 화면을 비웁니다. 네이티브 터미널과 동일한 방식입니다. 쉘 프로세스는 계속 살아있고, 보이는 버퍼만 지워집니다.

| 동작 | macOS | Linux / Windows |
|---|---|---|
| 화면 비우기 | <kbd>⌘K</kbd> | <kbd>Ctrl+K</kbd> |

## 탭은 어떤 상황에서도 살아남습니다

탭을 닫으면 해당 tmux 세션이 종료됩니다. *브라우저*를 닫거나, 새로고침하거나, 네트워크가 끊어져도 탭은 종료되지 않고 서버에서 계속 돌아갑니다. 다시 열면 같은 창, 분할, 탭이 그대로 돌아옵니다.

서버 재부팅 이후의 복구 동작은 [레이아웃 저장 & 복원](/agentmux/tr/docs/save-restore/)에서 다룹니다.

## 다음으로

- **[레이아웃 저장 & 복원](/agentmux/tr/docs/save-restore/)** — 이 레이아웃이 어떻게 유지되는지
- **[키보드 단축키](/agentmux/tr/docs/keyboard-shortcuts/)** — 전체 바인딩
- **[Git 워크플로 패널](/agentmux/tr/docs/git-workflow/)** — 분할에 띄워두면 유용한 탭 타입
