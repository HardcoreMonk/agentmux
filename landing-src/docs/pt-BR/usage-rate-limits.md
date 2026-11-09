---
title: 사용량 & rate limit
description: 5시간/7일 quota와 token, cost, project 통계.
eyebrow: Codex
permalink: /pt-BR/docs/usage-rate-limits/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 Codex quota와 사용량 통계를 sidebar와 dashboard에 표시합니다. live quota는 statusline payload가 있을 때 사용하고, 과거 통계는 Codex JSONL에서 계산합니다.

## sidebar widget

sidebar 하단의 **5h**, **7d** bar는 다음 정보를 보여줍니다.

- 현재 window 사용 비율.
- reset까지 남은 시간.
- 현재 속도를 유지할 때의 예상 사용량.

색상은 50% 미만 teal, 50-79% amber, 80% 이상 red입니다.

## stats dashboard

Dashboard는 다음 정보를 제공합니다.

- 전체 session, 전체 cost, 오늘 cost, 이번 달 cost.
- model별 input/output/cache token 사용량.
- project별 session, message, token, cost.
- 30일 활동 chart와 streak.
- 최근 1주일의 day x hour usage grid.

## 데이터 출처

모든 dashboard 값은 `~/.codex/sessions/` 아래 JSONL에서 로컬로 계산됩니다. cache는 `~/.agentmux/stats/`에 저장되며 외부로 전송되지 않습니다. cold start에서 여러 stats endpoint가 동시에 들어와도 cache build는 하나의 in-flight 작업을 공유합니다. cache file이 이미 있으면 초기 상태 확인에서는 전체 JSONL 파일 수 scan을 생략합니다.

## reset 동작

5시간과 7일 window는 Codex 계정의 rolling window입니다. reset 시점이 지나면 다음 statusline tick에서 bar와 남은 시간이 자동 보정됩니다.

## 다음 단계

- **[세션 상태](/agentmux/pt-BR/docs/session-status/)**
- **[데일리 리포트](/agentmux/pt-BR/docs/notes-daily-report/)**
- **[데이터 디렉터리](/agentmux/pt-BR/docs/data-directory/)**
