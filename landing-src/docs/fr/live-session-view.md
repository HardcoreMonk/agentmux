---
title: 라이브 세션 뷰
description: 타임라인 패널이 실제로 보여주는 것 — 메시지, 툴 호출, 작업, 프롬프트가 CLI 스크롤백이 아니라 이벤트 단위로 정리되어 표시됩니다.
eyebrow: Codex
permalink: /fr/docs/live-session-view/index.html
---
{% from "docs/callouts.njk" import callout %}

탭에서 Codex가 실행 중일 때, agentmux는 raw 터미널 뷰 대신 구조화된 타임라인을 보여줍니다. 같은 세션, 같은 JSONL 트랜스크립트지만 — 스캔하고 스크롤하고 링크할 수 있는 개별 이벤트로 펼쳐서 보여줍니다.

## 왜 타임라인이 스크롤백보다 나은가

Codex CLI는 인터랙티브합니다. 15분 전에 무엇을 했는지 터미널에서 보려면 그 사이의 모든 출력을 스크롤해서 지나가고, 줄바꿈된 라인을 읽고, 어디서 한 툴 호출이 끝나고 다음이 시작되는지 짐작해야 합니다.

타임라인은 같은 데이터에 구조를 더합니다:

- 메시지·툴 호출·작업·프롬프트마다 한 행씩
- 툴 입력과 출력이 함께 그룹화됨
- 영구 앵커 — 버퍼가 차도 이벤트가 위로 사라지지 않음
- 현재 진행 중인 단계는 항상 하단에 고정되며 경과 시간 카운터 표시

데스크톱에서는 상단 모드 토글로 언제든 터미널로 들어갈 수 있습니다. 모바일 CODEX 화면은 session 확인/생성 중에도 하단 terminal preview를 보여 타임라인이 붙기 전의 실제 CLI 출력을 확인할 수 있습니다. 타임라인은 같은 세션을 보는 다른 뷰일 뿐, 별개의 세션이 아닙니다.

## 보이는 것들

타임라인의 각 행은 Codex JSONL 트랜스크립트의 항목에 대응합니다:

| 타입 | 내용 |
|---|---|
| **사용자 메시지** | 작성한 프롬프트가 채팅 버블로 |
| **어시스턴트 메시지** | Codex의 답변, Markdown으로 렌더링 |
| **툴 호출** | 툴 이름·핵심 인자·응답 — `read`, `edit`, `bash` 등 |
| **툴 그룹** | 연속된 툴 호출이 한 카드로 collapse |
| **태스크 / 플랜** | 다단계 플랜과 체크박스 진행 상황 |
| **서브 에이전트** | 에이전트 호출이 진행 상황과 함께 그룹화 |
| **권한/입력 프롬프트** | 가로챈 프롬프트가 Codex가 제시한 옵션 그대로 |
| **Compacting** | Codex가 컨텍스트 자동 압축 중일 때의 미묘한 인디케이터 |

긴 어시스턴트 메시지는 스니펫으로 collapse되고 펼침 affordance가 붙습니다. 긴 툴 출력은 잘려서 "더 보기" 토글로 표시됩니다.

## 어떻게 라이브로 유지되는가

타임라인은 `/api/timeline` WebSocket이 데이터를 공급합니다. 서버는 활성 JSONL 파일에 `fs.watch`를 걸고 추가되는 항목을 파싱해서 발생 즉시 브라우저로 푸시합니다. polling도, 전체 재요청도 없습니다 — 초기 페이로드는 기존 항목을 보내고, 그 이후는 모두 incremental입니다. 같은 JSONL의 file size/mtime이 유지되면 초기 tail snapshot을 watcher cache에서 재사용합니다.

브라우저에서는 append burst를 animation frame 단위로 합치고, 기존 timeline row는 entry reference가 유지되면 memo로 재렌더를 건너뜁니다. 긴 세션에서 DOM 구조와 scroll anchor 계약은 유지하면서 Markdown/tool row 재렌더 비용을 줄이는 방식입니다.

Codex가 `busy`인 동안에는 이런 것도 함께 보입니다:

- 현재 단계의 라이브 경과 시간이 붙은 스피너
- 진행 중인 툴 호출 (예: "Reading src/lib/auth.ts")
- 가장 최근 어시스턴트 텍스트의 짧은 스니펫

이 값들은 JSONL watcher의 메타데이터 패스에서 오며, 세션 상태를 바꾸지 않고 갱신됩니다.

## 스크롤, 앵커, 히스토리

이미 하단에 있을 때는 자동 스크롤이 따라가고, 위로 스크롤해서 무언가를 읽고 있을 때는 그 자리에 머무릅니다. 최신 항목에서 한 화면 이상 위로 올라가면 floating **하단으로 이동** 버튼이 나타납니다.

긴 세션에서는 위로 스크롤할 때 오래된 항목이 on-demand로 로드됩니다. Codex 세션 ID는 resume 사이에서도 보존되므로, 어제의 세션을 이어 받으면 멈췄던 위치에서 시작합니다.

{% call callout('tip', '입력으로 이동') %}
세션 뷰 어디서든 <kbd>⌘I</kbd>로 하단의 입력 바에 포커스를 줄 수 있습니다. <kbd>Esc</kbd>는 실행 중인 Codex 프로세스에 interrupt를 보냅니다.
{% endcall %}

## 인라인 권한/입력 프롬프트

Codex가 툴 실행, 파일 편집 권한, resume directory 선택을 요청하면 모달이 아니라 notification panel과 타임라인에 프롬프트가 나타납니다. notification panel은 prompt type과 risk badge를 함께 보여주며, 옵션을 클릭하거나, 매칭되는 숫자 키를 누르거나, Web Push를 눌러 해당 tab으로 이동한 뒤 선택할 수 있습니다. 전체 흐름은 [권한/입력 프롬프트](/agentmux/fr/docs/permission-prompts/) 참고.

## 한 탭의 여러 모드

상단 바에서 같은 세션에 대해 우측 패널이 보여줄 내용을 전환할 수 있습니다:

- **Codex** — 타임라인 (기본)
- **터미널** — 원시 xterm.js 뷰
- **Diff** — 작업 디렉토리의 Git 변경

모드 전환은 아무것도 재시작하지 않습니다. 세션은 세 뷰 모두의 뒤에서 tmux 위에서 계속 실행됩니다.
CODEX로 다시 돌아올 때는 저장된 Codex session id와 JSONL path를 유지하므로 같은 타임라인으로
복귀해야 합니다. 배포 직후 오래 열린 브라우저 탭이나 Android WebView에서 CODEX 화면이 계속
연결 중처럼 보이면 페이지를 새로고침하거나 앱을 재시작해 최신 JavaScript bundle을 받으세요.

단축키: <kbd>⌘⇧C</kbd> · <kbd>⌘⇧T</kbd> · <kbd>⌘⇧F</kbd>.

## 다음으로

- **[권한/입력 프롬프트](/agentmux/fr/docs/permission-prompts/)** — 인라인 승인 흐름
- **[세션 상태](/agentmux/fr/docs/session-status/)** — 타임라인 인디케이터를 구동하는 배지들
- **[퀵 프롬프트 & 첨부](/agentmux/fr/docs/quick-prompts-attachments/)** — 하단 입력 바가 할 수 있는 일들
