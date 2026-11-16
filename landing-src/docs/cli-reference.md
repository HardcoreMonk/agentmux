---
title: CLI 레퍼런스
description: agentmux와 amux 명령, tab 제어, token 인증.
eyebrow: 레퍼런스
permalink: /docs/cli-reference/index.html
---
{% from "docs/callouts.njk" import callout %}

`agentmux`는 서버 시작 명령이면서 실행 중인 서버를 제어하는 CLI입니다. `amux`는 같은 기능을 제공하는 짧은 별칭입니다.

## 서버 시작

```bash
agentmux
agentmux start
```

PowerShell에서 port와 access filter를 지정하려면:

```powershell
$env:PORT = "9000"
$env:HOST = "localhost,tailscale"
agentmux
```

`8122`가 이미 사용 중이면 agentmux는 비어 있는 port를 찾아 바인딩하고 실제 port를 `~/.agentmux/port`에 기록합니다.

## workspace와 tab

```bash
agentmux workspaces
agentmux tab list
agentmux tab list -w WS_ID
agentmux tab create -w WS_ID --type codex --name review
agentmux tab create -w WS_ID --type claude --cwd ../other
amux tab create -w WS_ID --type terminal
agentmux tab send -w WS_ID TAB_ID "review this change"
agentmux tab status -w WS_ID TAB_ID
agentmux tab result -w WS_ID TAB_ID
agentmux tab close -w WS_ID TAB_ID
```

`tab create`의 cwd는 `--cwd DIR`로 지정합니다. 상대 경로는 현재 directory 기준 절대 경로로 바꿔 보내고, 존재하는 directory가 아니면 `invalid-cwd`(400)입니다. 지정하지 않으면 agent 탭이 자기 workspace에 만들 때는 호출 탭의 현재 cwd, 그 밖에는 workspace의 첫 directory를 씁니다.

| type | 의미 |
|---|---|
| `codex` | Codex session tab |
| `claude` | Claude Code session tab |
| `terminal` | 일반 shell tab |
| `diff` | Git diff panel |
| `web-browser` | Electron web browser panel |

## browser tab 제어

```bash
agentmux tab browser url -w WS_ID TAB_ID
agentmux tab browser screenshot -w WS_ID TAB_ID -o screenshot.png --full
agentmux tab browser console -w WS_ID TAB_ID --level error
agentmux tab browser network -w WS_ID TAB_ID --method GET
agentmux tab browser eval -w WS_ID TAB_ID "document.title"
```

Screenshot은 `-o`가 있으면 PNG 파일로 저장하고 없으면 base64로 반환합니다. `--full`은 전체 페이지를 캡처합니다. 현재 browser subcommand는 `url`, `screenshot`, `console`, `network`, `eval`이며 별도 `navigate` command는 없습니다.

전체 HTTP API reference는 실행 중인 server에 대해 다음 명령으로 확인합니다.

```bash
agentmux api-guide
agentmux help
```

## agent 탭에서 위임

agentmux가 띄운 Claude Code와 Codex 탭에는 위임 안내 설정(**설정 → 일반**의 **Agent에 위임 안내 넣기**, 기본 켬)이 켜져 있으면 `AMUX_WORKSPACE_ID`와 `AMUX_TAB_ID`가 설정되어 `-w`를 생략할 수 있고, 서버는 호출 탭을 알아 다음 제한을 적용합니다. 이 제한은 실수 방지 장치이며 보안 경계가 아닙니다.

- `tab send`는 agent 탭(`claude`, `codex`)에만 보낼 수 있습니다. 그 밖의 대상은 `delegation-send-forbidden`(403)입니다.
- 대상이 권한 질문이나 시작 화면(trust, Codex update, Codex hook 검토)에 있으면 입력하지 않고 `target-needs-input` 또는 `target-not-ready`(409)를 돌려줍니다. CLI는 사용자 대신 승인하지 않습니다.
- `tab close`는 호출 탭이 만든 탭만 닫습니다(`delegation-close-forbidden`). workspace당 agent가 만든 탭은 6개까지이고(`delegation-limit`), 맡은 탭은 다시 `tab create`를 할 수 없습니다(`delegation-depth`).
- 자동 보고가 켜져 있으면 맡은 탭이 자기를 만든 탭에 `tab send`를 할 수 없습니다(`send-to-parent`). 결과는 turn이 끝날 때 `[agentmux report`로 시작하는 자동 보고로 전달되며, 호출 탭이 있는 `tab send`는 이 접두어로 시작할 수 없습니다(`reserved-report-prefix`).
- 오류는 `error: <code>: <message>` 형식입니다. 전체 목록은 repository의 [docs/CLI.md](https://github.com/HardcoreMonk/agentmux/blob/main/docs/CLI.md)에 있습니다.

## 인증

Server 제어 subcommand는 `x-agentmux-token`을 보냅니다. CLI는 현재 port와 token을 `~/.agentmux/port`, `~/.agentmux/cli-token`에서 읽고 다음 env var가 있으면 파일보다 우선합니다.

| 변수 | 의미 |
|---|---|
| `AMUX_PORT` | CLI가 접속할 outer server port |
| `AMUX_TOKEN` | `x-agentmux-token`으로 보낼 token |
| `AGENTMUX_DATA_DIR` | `port`, `cli-token`을 읽을 data directory |
| `AMUX_WORKSPACE_ID` | 모든 `tab` 하위 명령의 기본 workspace. agentmux가 띄운 agent 탭에 설정됨. `-w`가 우선 |
| `AMUX_TAB_ID` | 호출 탭. 있으면 모든 요청에 `x-agentmux-caller-tab` header를 붙여 위임 제한이 적용됨 |

{% call callout('warning', 'CLI token 관리') %}
CLI token은 서버 전체 접근 권한을 줍니다. chat, repository, build log에 노출하지 마세요. 회전하려면 `~/.agentmux/cli-token`을 삭제하고 서버를 재시작합니다.
{% endcall %}

## 다음 단계

- **[포트 & 환경 변수](/agentmux/docs/ports-env-vars/)**
- **[탭 & 창](/agentmux/docs/tabs-panes/)**
- **[웹 브라우저 패널](/agentmux/docs/web-browser-panel/)**
