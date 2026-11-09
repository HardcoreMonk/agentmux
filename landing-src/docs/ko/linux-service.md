---
title: Linux 서비스 운영
description: Linux 단일 엔진을 systemd user service로 build, backup, restart, health 확인하는 절차.
eyebrow: 운영 가이드
permalink: /ko/docs/linux-service/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux의 운영 기준은 한 Linux 사용자 계정이 custom server, Runtime v2 worker, tmux,
Codex JSONL과 app DB를 소유하는 단일 엔진입니다. Browser와 선택 client는 이 engine에
접속합니다.

## Source build

```bash
git clone https://github.com/HardcoreMonk/agentmux.git
cd agentmux
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

Node.js 20.9 이상, tmux 3.0 이상과 로그인된 Codex CLI가 필요합니다. `WorkingDirectory`와
`ExecStart`는 실제 checkout과 `command -v node`의 절대 경로를 사용합니다.

## User service

```ini
[Unit]
Description=agentmux Linux single-engine session manager
After=network.target

[Service]
Type=simple
WorkingDirectory=/absolute/path/to/agentmux
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=AGENTMUX_RUNTIME_V2=1
Environment=AGENTMUX_SESSION_CATALOG_MODE=default
Environment=HOST=localhost
Environment=PORT=8122
Environment=PATH=/absolute/node/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/absolute/path/to/node /absolute/path/to/agentmux/bin/agentmux.js
Restart=on-failure
RestartSec=3
KillSignal=SIGINT
SuccessExitStatus=130
TimeoutStopSec=20

[Install]
WantedBy=default.target
```

`~/.config/systemd/user/agentmux.service`에 저장한 뒤 시작합니다. `PATH`에는 실제 Node,
Codex CLI와 tmux를 찾을 수 있는 directory를 지정합니다.

```bash
systemctl --user daemon-reload
systemctl --user enable --now agentmux.service
```

{% call callout('warning', 'Fresh setup은 loopback 전용') %}
처음 설정되지 않은 process는 `HOST`를 넓혀도 `127.0.0.1`에만 bind합니다. 로컬 browser에서
password setup을 완료한 뒤 별도 network/security 승인을 거쳐 `HOST`를 변경하고 service를
재시작해야 외부 bind가 적용됩니다.
{% endcall %}

## 배포 전 backup

운영 DB backup은 service를 중지하거나 SQLite-consistent snapshot 경로를 사용합니다.
`state.db`, WAL, SHM을 일부만 섞어 복원하지 않습니다.

```bash
systemctl --user stop agentmux.service
corepack pnpm runtime-v2:storage-backup
```

생성된 `~/.agentmux/backups/runtime-v2-storage-<timestamp>/`의 directory는 `0700`, file은
`0600`이어야 합니다. Build가 실패하면 검증된 이전 artifact로 service를 다시 시작합니다.

## Build, restart, health

```bash
corepack pnpm build
systemctl --user restart agentmux.service
curl -fsS http://127.0.0.1:8122/api/health
```

인증된 worker 상태:

```bash
IFS= read -r agentmux_cli_token < ~/.agentmux/cli-token
curl -fsS -H "x-agentmux-token: $agentmux_cli_token" \
  http://127.0.0.1:8122/api/v2/runtime/health
curl -fsS -H "x-agentmux-token: $agentmux_cli_token" \
  http://127.0.0.1:8122/api/sessions/health
```

`terminal`, `storage`, `timeline`, `status`는 core readiness입니다. Governance 또는 Session
Catalog가 degraded이면 해당 UI/API를 격리해 복구하고 terminal operation은 유지합니다.

## 외부 접속

Setup 이후에도 public Internet에 port를 직접 노출하지 않습니다. Tailscale Serve 또는 HTTPS
reverse proxy를 사용하고 WebSocket `Upgrade`/`Connection` header를 전달합니다. Firewall,
DNS와 certificate 변경은 service deploy와 분리해 검토합니다.

## Rollback

1. 신규 write가 위험하면 governance/upload feature gate부터 차단합니다.
2. service를 중지합니다.
3. 직전 검증 commit을 build합니다.
4. durable storage가 손상됐을 때만 같은 backup의 DB/WAL/SHM 전체를 복원합니다.
5. service start, public/authenticated health와 browser reconnect를 확인합니다.

전체 운영 계약은 [repository SYSTEMD 문서](https://github.com/HardcoreMonk/agentmux/blob/main/docs/SYSTEMD.md)를
따릅니다.
