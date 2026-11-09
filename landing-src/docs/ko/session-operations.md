---
title: 세션 운영
description: Codex Session Catalog를 검색하고, 필터링하고, 복기하고, annotation과 rebuild를 관리합니다.
eyebrow: 운영 가이드
permalink: /ko/docs/session-operations/index.html
---
{% from "docs/callouts.njk" import callout %}

세션 운영은 local Codex JSONL을 검색 가능한 Session Catalog로 투영합니다. 완료된 작업의 결정과
맥락을 다시 찾기 위한 기능이며 live terminal을 대체하거나 Codex 소유 원본 로그를 변경하지
않습니다.

## 세션 탐색기 열기

로그인한 뒤 고정 1차 탐색에서 **세션**을 선택합니다. Route는 `/sessions`입니다. 화면에는
Timeline Worker health, catalog freshness, 저장 필터, 검색 조건, 결과와 세션 복기 drawer가
표시됩니다. Workspace 아래 **활동**은 live 상태 context이며 이 catalog와 다릅니다.

다음 조건을 조합할 수 있습니다.

- 메시지 내용
- 프로젝트와 모델
- 시작일과 종료일
- 태그
- 고정된 세션만 보기

검색어는 index에 저장된 메시지 내용과 일치시킵니다. 결과 metadata와 replay 항목은 인증된 API로
가져오며 filesystem path를 public catalog field로 노출하지 않습니다.

## 검색과 세션 복기

1. 메시지 검색어를 입력하거나 project, model, 날짜, tag, pin filter를 조합합니다.
2. **검색**을 선택합니다.
3. 결과를 열어 **세션 복기**를 불러옵니다.
4. 사용자·assistant 메시지, tool call과 agent event를 기록 순서로 검토합니다.
5. 반복 검토에 필요하면 세션을 고정하고 tag를 적용하거나 현재 filter를 저장합니다.

Pin, tag와 저장 filter는 agentmux durable storage가 소유합니다. 원본 Codex JSONL은 read-only로
유지됩니다.

## Catalog health와 rebuild

Timeline Worker는 local Codex session directory의 파일을 증분 index합니다. 화면은 다음 상태를
구분합니다.

| 상태 | 의미 | 대응 |
| --- | --- | --- |
| `ready` | 검색 projection 사용 가능 | 정상 검색 |
| `rebuilding` | 제한된 rebuild 실행 중 | 완료까지 기다리고 기존 status 확인 |
| `degraded` | Timeline Worker 또는 index 사용 불가 | Runtime health와 service log 확인 |
| 빈 결과 | 검색 조건과 일치하는 세션 없음 | Filter 제거 또는 catalog population 확인 |

빈 결과와 worker 장애는 다릅니다. 새 host는 `indexedSessions`가 0이어도 정상일 수 있습니다.

인증된 CLI API로 rebuild를 요청할 수 있습니다.

```bash
IFS= read -r agentmux_cli_token < ~/.agentmux/cli-token
curl -fsS -X POST \
  -H "x-agentmux-token: $agentmux_cli_token" \
  http://127.0.0.1:8122/api/sessions/rebuild
```

{% call callout('warning', '현재 범위') %}
Session 삭제, retention 자동화, remote collector, multi-engine federation과 full command output
검색은 현재 세션 운영 범위가 아닙니다.
{% endcall %}

## 다음 단계

- [라이브 세션 뷰](/agentmux/ko/docs/live-session-view/) — 아직 실행 중인 작업 확인
- [세션 상태](/agentmux/ko/docs/session-status/) — activity와 approval 상태 이해
- [Project Governance](/agentmux/ko/docs/project-governance/) — session context를 Managed Project와 연결
- [Linux 서비스 운영](/agentmux/ko/docs/linux-service/) — health, backup, restart와 recovery 확인
