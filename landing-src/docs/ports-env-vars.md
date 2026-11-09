---
title: 포트 & 환경 변수
description: agentmux가 사용하는 port, network access, logging, CLI token 설정.
eyebrow: 레퍼런스
permalink: /docs/ports-env-vars/index.html
---
{% from "docs/callouts.njk" import callout %}

fresh setup의 agentmux는 `127.0.0.1:8122`에서 실행됩니다. setup이 끝난 뒤에는 config 또는 환경 변수로 port, network access, logging을 조정할 수 있습니다.

## port와 host

```powershell
$env:PORT = "9000"; agentmux
$env:HOST = "localhost,tailscale"; agentmux
$env:HOST = "localhost,tailscale"; $env:PORT = "8122"; agentmux
$env:HOST = "all"; $env:PORT = "9000"; agentmux
```

| 변수 | 기본값 | 의미 |
|---|---|---|
| `PORT` | `8122` | 외부 server port |
| `HOST` | fresh setup은 `localhost` | 허용할 접근 범위. env로 지정하면 앱의 네트워크 접근 설정이 잠김 |
| `NODE_ENV` | 실행 방식에 따라 다름 | development/production pipeline 선택 |
| `NO_UPDATE_NOTIFIER` | unset | `1`이면 version check 비활성화 |
| `INIT_PASSWORD` | unset | setup 시작 시 초기 인증 session을 요구. 4자 미만이면 startup 실패 |
| `AGENTMUX_UPLOADS_DISABLED` | unset | `1`이면 두 upload route만 `503`으로 차단 |

`HOST`는 단순 bind 주소가 아니라 접근 필터입니다. 사용할 수 있는 키워드는 `localhost`, `tailscale`, `lan`, `all`이고, CIDR도 직접 지정할 수 있습니다. 예를 들어 `HOST=localhost,tailscale`은 로컬 브라우저와 Tailscale 대역만 허용합니다.

설정이 끝나지 않은 process는 저장된 network access와 `HOST`를 무시하고 loopback에만 bind합니다. 먼저 로컬 브라우저에서 setup을 완료한 뒤 server를 재시작해야 선택한 외부 접근 범위가 적용됩니다. Configured startup은 `HOST`, `config.json`의 `networkAccess`, legacy default 순서로 접근 범위를 정합니다.

`8122`가 사용 중이면 빈 port를 찾아 바인딩하고 `~/.agentmux/port`에 기록합니다.

## PowerShell 실행 예시

현재 PowerShell session에서 같은 port와 접근 범위를 계속 사용하려면 환경 변수를 먼저 설정합니다.

```powershell
$env:HOST = "localhost,tailscale"
$env:PORT = "8122"
agentmux
```

소스 checkout에서는 같은 환경 변수를 설정한 뒤 `corepack pnpm dev`를 실행합니다.

## logging

```powershell
$env:LOG_LEVEL = "debug"; agentmux
$env:LOG_LEVELS = "status=debug"; agentmux
$env:LOG_LEVELS = "status=debug,tmux=trace"; agentmux
```

| 변수 | 의미 |
|---|---|
| `LOG_LEVEL` | 기본 log level |
| `LOG_LEVELS` | module별 `name=level` override |

주요 module은 `status`, `tmux`, `hooks`, `server`, `lock`, `upload-server`입니다. log file은 `~/.agentmux/logs/`에 저장됩니다.

## 파일 기반 값

| 파일 | 내용 | 사용처 |
|---|---|---|
| `~/.agentmux/port` | 현재 outer server port | CLI, hook/bridge script |
| `~/.agentmux/cli-token` | 32-byte CLI token | `x-agentmux-token` 인증 |

CLI는 `AMUX_PORT`, `AMUX_TOKEN` 환경 변수가 있으면 파일보다 우선합니다.

## 다음 단계

- **[설치](/agentmux/docs/installation/)**
- **[데이터 디렉터리](/agentmux/docs/data-directory/)**
- **[CLI 레퍼런스](/agentmux/docs/cli-reference/)**
