---
title: 에이전트 빠른 시작
description: AI agent와 자동화 사용자를 위한 command, health check, 사용자 승인 경계.
eyebrow: 운영 가이드
permalink: /docs/agent-quickstart/index.html
---
{% from "docs/callouts.njk" import callout %}

이 문서는 terminal을 사용하는 AI agent와 자동화 사용자가 agentmux를 안전하게 확인하고
시작하는 최소 절차를 설명합니다. 비밀번호 설정, 외부 bind, service restart와 project write는
사용자 결정을 대신하지 않습니다.

## 사전 조건 확인

```bash
node --version
tmux -V
codex --version
```

- Node.js 20.9 이상
- tmux 3.0 이상
- Git과 로그인된 Codex CLI
- Linux 단일 엔진으로 사용할 사용자 계정

## 가장 짧은 실행

```bash
npx --yes @hardcoremonk/agentmux@latest
```

기본 public health endpoint는 `http://127.0.0.1:8122/api/health`입니다.

```bash
curl -fsS http://127.0.0.1:8122/api/health
```

처음 실행하면 loopback browser에서 비밀번호를 설정해야 합니다. Agent는 password를 만들거나
입력하지 말고 사용자에게 local setup 완료를 요청합니다. Fresh setup 중에는 `HOST` 값이 있어도
원격 onboarding이 열리지 않습니다.

{% call callout('note', 'Foreground process') %}
`npx` 실행은 foreground process입니다. 장기 운영, login 전 시작과 restart 정책이 필요하면
[Linux 서비스 운영](/agentmux/docs/linux-service/)을 사용하세요.
{% endcall %}

## Source checkout 확인

사용자가 source 실행을 선택했다면 다음 범위는 재현 가능한 read/build 단계입니다.

```bash
git clone https://github.com/HardcoreMonk/agentmux.git
cd agentmux
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Dependency 설치는 network와 filesystem을 변경합니다. Agent는 기존 checkout과 package cache를
확인하고 사용자의 작업 범위를 벗어난 upgrade를 함께 수행하지 않습니다.

## 인증된 health

Setup과 service start가 끝난 뒤 service 사용자만 읽을 수 있는 CLI token으로 worker 상태를
확인할 수 있습니다. Token 값을 출력하거나 log에 남기지 않습니다.

```bash
IFS= read -r agentmux_cli_token < ~/.agentmux/cli-token
curl -fsS -H "x-agentmux-token: $agentmux_cli_token" \
  http://127.0.0.1:8122/api/v2/runtime/health
```

정상 응답에서는 terminal/storage/timeline/status core worker가 ready여야 합니다. Governance와
Session Catalog는 별도 readiness를 가지며 한 projection의 저하를 전체 terminal 장애로
재해석하지 않습니다.

## 자동화와 사용자 승인 경계

| 작업 | Agent 기본 처리 |
| --- | --- |
| version, file, public health 조회 | 읽기 전용으로 수행 가능 |
| dependency install/build | 사용자가 지정한 checkout 범위에서 수행 |
| 비밀번호 설정 또는 reset | 사용자 입력/별도 승인 필요 |
| `HOST=0.0.0.0`, reverse proxy, firewall 변경 | 별도 network/security 승인 필요 |
| `systemctl --user restart` | backup과 운영 승인 필요 |
| `AGENTMUX_GOVERNANCE_WRITES=1` | 별도 write 승인 필요 |
| project scaffold/adoption confirm | preview 검토와 exact project title 확인 필요 |
| DB/data 삭제 또는 backup prune | destructive 승인과 restore plan 필요 |

## 다음 단계

- [빠른 시작](/agentmux/docs/quickstart/) — 사람 중심 첫 실행
- [Linux 서비스 운영](/agentmux/docs/linux-service/) — build, backup, restart, health
- [보안과 인증](/agentmux/docs/security-auth/) — setup과 외부 접속 경계
- [Project Governance](/agentmux/docs/project-governance/) — 등록 project와 write gate
