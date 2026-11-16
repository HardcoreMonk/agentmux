---
title: 사용량 & rate limit
description: 5시간/7일 quota와 token, cost, project 통계.
eyebrow: Codex
permalink: /docs/usage-rate-limits/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 Codex와 Claude Code의 quota와 사용량 통계를 sidebar와 dashboard에 표시합니다. live quota는 Codex는 JSONL의 rate limit 기록에서, Claude Code는 statusline payload에서 받고, 과거 통계는 Codex와 Claude Code JSONL에서 계산합니다.

## sidebar widget

sidebar 하단의 **5h**, **7d** bar는 다음 정보를 보여줍니다.

- 현재 window 사용 비율.
- reset까지 남은 시간.
- 현재 속도를 유지할 때의 예상 사용량.

색상은 50% 미만 teal, 50-79% amber, 80% 이상 red입니다.


Codex와 Claude Code 값이 모두 있으면 provider별로 묶어 각각 표시하고, 값이 없는 provider는 숨깁니다.

## stats dashboard

Dashboard는 다음 정보를 제공합니다.

- 전체 session, 전체 cost, 오늘 cost, 이번 달 cost.
- model별 input/output/cache token 사용량.

- 가격을 알 수 없는 model은 cost 칸에 `—`로 표시하고 합계에 넣지 않습니다.
- project별 session, message, token, cost.
- 30일 활동 chart와 streak.
- 최근 1주일의 day x hour usage grid.

## 데이터 출처

모든 dashboard 값은 `~/.codex/sessions/` 아래 Codex JSONL과 `~/.claude/projects/` 아래 Claude Code JSONL에서 로컬로 계산됩니다. cache는 `~/.agentmux/stats/`에 저장되며 외부로 전송되지 않습니다. cold start에서 여러 stats endpoint가 동시에 들어와도 cache build는 하나의 in-flight 작업을 공유합니다. cache file이 이미 있으면 초기 상태 확인에서는 전체 JSONL 파일 수 scan을 생략합니다.

## reset 동작

5시간과 7일 window는 계정의 rolling window입니다. reset 시점이 지난 뒤 새 관찰이 오기 전에는 0%나 다음 reset을 추정하지 않고 **갱신 대기**로 표시하며, 새 관찰이 오면 bar와 남은 시간이 보정됩니다.

## 다음 단계

- **[세션 상태](/agentmux/docs/session-status/)**
- **[데일리 리포트](/agentmux/docs/notes-daily-report/)**
- **[데이터 디렉터리](/agentmux/docs/data-directory/)**
