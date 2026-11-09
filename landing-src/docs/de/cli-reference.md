---
title: CLI 레퍼런스
description: agentmux와 amux 명령, tab 제어, token 인증.
eyebrow: 레퍼런스
permalink: /de/docs/cli-reference/index.html
---
{% from "docs/callouts.njk" import callout %}

`agentmux`는 서버 시작 명령이면서 실행 중인 서버를 제어하는 CLI입니다. `amux`는 같은 기능을 제공하는 짧은 별칭입니다.

## 서버 시작

```bash
agentmux
agentmux start
PORT=9000 HOST=localhost,tailscale agentmux
```

`8122`가 이미 사용 중이면 agentmux는 비어 있는 port를 찾아 바인딩하고 실제 port를 `~/.agentmux/port`에 기록합니다.

## tab 생성

```bash
agentmux tab create -w WS_ID --type codex --cwd /path/to/project
amux tab create -w WS_ID --type terminal --cwd /tmp
```

| type | 의미 |
|---|---|
| `codex` | Codex session tab |
| `terminal` | 일반 shell tab |
| `diff` | Git diff panel |
| `browser` | Electron web browser panel |

## browser tab 제어

```bash
agentmux tab browser url -w WS_ID TAB_ID
agentmux tab browser navigate -w WS_ID TAB_ID http://localhost:3000
agentmux tab browser screenshot -w WS_ID TAB_ID -o screenshot.png --full
```

Screenshot은 `-o`가 있으면 파일로 저장하고 없으면 base64로 반환합니다. `--full`은 전체 페이지를 캡처합니다.

## 인증

모든 subcommand는 `x-agentmux-token`을 보냅니다. token은 `~/.agentmux/cli-token`에 있으며 첫 서버 시작 시 생성됩니다. 다른 shell에서 실행해야 하면 다음 env var를 사용할 수 있습니다.

| 변수 | 의미 |
|---|---|
| `AMUX_PORT` | CLI가 접속할 port |
| `AMUX_TOKEN` | `x-agentmux-token`으로 보낼 token |

{% call callout('warning', 'CLI token 관리') %}
CLI token은 서버 전체 접근 권한을 줍니다. chat, repository, build log에 노출하지 마세요. 회전하려면 `~/.agentmux/cli-token`을 삭제하고 서버를 재시작합니다.
{% endcall %}

## 다음 단계

- **[포트 & 환경 변수](/agentmux/de/docs/ports-env-vars/)**
- **[탭 & 창](/agentmux/de/docs/tabs-panes/)**
- **[웹 브라우저 패널](/agentmux/de/docs/web-browser-panel/)**
