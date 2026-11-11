# agentmux CLI

`agentmux`(별칭 `amux`, legacy `codexmux`/`cmux`)는 실행 중인 agentmux server의 HTTP API를 부르는 CLI입니다. 사람이 직접 쓸 수도 있고, agentmux가 띄운 Claude Code·Codex가 다른 agent 탭에 일을 맡길 때도 씁니다(위임). 위임 설계 결정은 ADR-035, ADR-036, ADR-037에 있습니다.

## 명령

| 명령 | 동작 |
| --- | --- |
| `agentmux workspaces` | workspace 목록 |
| `agentmux tab list [-w WS]` | 탭 목록. agent 탭 안에서는 `AMUX_WORKSPACE_ID` workspace로 범위가 좁혀짐 |
| `agentmux tab create [-w WS] [-n NAME] [-t TYPE] [--cwd DIR]` | 탭 생성. `TYPE`은 `terminal`, `codex`, `claude`, `web-browser`, `diff` |
| `agentmux tab send [-w WS] TAB_ID CONTENT...` | 탭에 입력 전송 |
| `agentmux tab status [-w WS] TAB_ID` | 탭 상태 |
| `agentmux tab result [-w WS] TAB_ID` | 탭 결과(화면 내용) |
| `agentmux tab close [-w WS] TAB_ID` | 탭 닫기 |
| `agentmux tab browser ...` | web-browser 탭 제어(`url`, `screenshot`, `console`, `network`, `eval`). 위임 허용 규칙에 포함되지 않음 |
| `agentmux api-guide` | HTTP API 안내 출력 |

`-w`는 모든 `tab` 하위 명령에서 `AMUX_WORKSPACE_ID`가 있으면 생략할 수 있습니다. `-w`를 주면 환경 변수보다 우선합니다. 오류는 `error: <code>: <message>` 형식으로 출력합니다.

## 환경 변수

| 변수 | 의미 |
| --- | --- |
| `AMUX_PORT` | server port. 없으면 data directory의 `port` 파일 (legacy `CMUX_PORT`) |
| `AMUX_TOKEN` | CLI token. 없으면 data directory의 `cli-token` 파일 (legacy `CMUX_TOKEN`) |
| `AGENTMUX_DATA_DIR` | data directory. `port`, `cli-token`을 여기서 읽음 |
| `AMUX_WORKSPACE_ID` | 모든 `tab` 하위 명령의 기본 workspace. agentmux가 띄운 agent 탭에 설정됨 |
| `AMUX_TAB_ID` | 호출 탭. 설정되어 있으면 모든 요청에 header `x-agentmux-caller-tab: <tabId>`를 붙여 위임 제한이 적용됨 |

## agent 탭의 환경과 위임 안내

설정 `agentDelegationGuideEnabled`(기본 켬, Settings → General의 스위치)가 켜져 있으면 agentmux가 띄운 Claude Code와 Codex 실행 명령에 다음이 붙습니다.

- 환경 변수 `AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`, 그리고 `<dataDir>/bin`을 앞에 붙인 `PATH`.
- `<dataDir>/bin/agentmux` shim(`0700`). 내용은 `AGENTMUX_DATA_DIR=<dataDir> ELECTRON_RUN_AS_NODE=1 exec <node> <appDir>/bin/agentmux.js "$@"`입니다.
- 위임 안내. Claude Code는 `--append-system-prompt-file <dataDir>/delegation/claude.md`(`0600`), Codex는 `-c 'developer_instructions=<TOML string>'`입니다.

Shim과 안내 파일은 server 시작 때 auto-resume 전에 쓰고, 이후 agent를 띄울 때마다 내용이 바뀐 경우에만 다시 씁니다. Claude 안내 파일이 없으면 flag를 빼고 log에 warning을 남깁니다. 안내 문장에는 workspace id와 탭 id를 넣지 않고 환경 변수로만 전달합니다.

설정을 끄면 실행 명령은 이전과 byte 단위로 같습니다(환경 변수, 안내, `permissions.allow` 모두 없음). agentmux 밖에서 돈 Claude Code·Codex에는 아무것도 붙지 않습니다.

### Claude Code

탭별 설정 파일 `claude-tabs/<tab-id>.json`의 `permissions.allow`에 다음 6개만 들어갑니다. `tab browser`와 `agentmux` 전체는 허용하지 않습니다.

```text
Bash(agentmux tab list:*)
Bash(agentmux tab create:*)
Bash(agentmux tab send:*)
Bash(agentmux tab status:*)
Bash(agentmux tab result:*)
Bash(agentmux tab close:*)
```

`:*` 접미사는 Claude Code 권한 문서가 말하는 끝 wildcard의 동등한 표기입니다.

### Codex

사용자의 `developer_instructions`가 `$CODEX_HOME/config.toml` 최상위 또는 선택된 `[profiles.<profile>]`에 있으면 그 값을 안내 앞에 그대로 둡니다. 다음 경우에는 안내를 넣지 않고 log에 warning을 남깁니다(환경 변수는 그대로 붙음).

- 값이 서로 다름(`ambiguous`)
- TOML을 읽지 못함(`parse-error`)
- cwd부터 위로 찾은 project `.codex/config.toml` 중 하나가 값을 정의함(`project-defined`). Codex는 신뢰한 project의 config만 읽으므로 project 값은 복사하지 않습니다.
- cwd를 알 수 없음
- 합친 명령이 12,288 byte를 넘음(tmux 한 인자 한도 때문)

한계 두 가지:

- Codex `workspace-write` sandbox는 local network를 막으므로 이 sandbox에서는 위임이 동작하지 않습니다.
- `shell_environment_policy`가 `inherit = "core"` 또는 `"none"`이면 환경 변수가 Codex shell에 닿지 않아 CLI가 호출 탭을 모릅니다. 이때는 사용자가 직접 실행한 CLI처럼 동작하므로 위임 제한이 없고 `-w`가 필요합니다.

## 위임 동작

호출 탭이 있는 요청(`x-agentmux-caller-tab`)은 "agent 호출"로 봅니다. 위임 제한은 실수 방지 장치이며 보안 경계가 아닙니다(ADR-036). 신뢰 경계는 CLI token을 읽을 수 있는 Unix 사용자입니다.

### tab create

- 탭 위치: 호출 탭의 pane. `-w`로 다른 workspace를 지정하면 그 workspace의 첫 pane.
- cwd: `--cwd`(존재하는 절대 경로 directory, 아니면 400 `invalid-cwd`), 없으면 호출 탭의 현재 cwd.
- active 탭은 바뀌지 않고 `createdByTabId`가 기록됩니다.
- workspace당 agent가 만든 탭은 6개까지이며 넘으면 409 `delegation-limit`입니다. 확인과 생성은 workspace별 lock 안에서 합니다.
- `-t claude`/`-t codex`: preflight를 먼저 하고(agent가 없으면 409 `agent-unavailable`) 탭을 만든 뒤 agent를 띄웁니다. 그 launch의 `session-start` hook으로 `idle`이 될 때까지 최대 60초 기다려 `ready`를 돌려줍니다. 띄우기가 실패하면 `launchError`를 돌려줍니다.
- 호출 탭이 없는 탭 id이면 404 `caller-tab-not-found`(create, send, close).
- `-t terminal`도 만들 수 있지만 agent 호출은 그 탭에 `tab send`를 할 수 없습니다(아래 tab send).

### tab send

호출 탭이 있으면 대상은 agent 탭(`claude`, `codex`)이어야 합니다. terminal 탭 등 agent 탭이 아닌 대상은 403 `delegation-send-forbidden`이고 아무것도 입력하지 않습니다. Claude Code는 `tab send`를 미리 허용하므로, shell에 입력이 닿으면 agent 자신의 명령 승인(Bash 권한 확인)을 건너뛰고 shell 명령을 실행하게 되기 때문입니다(ADR-036, 사용자 결정 2026-11-11). 위임 입력은 agent 탭에만 닿고 각 agent 탭은 자체 권한 설정을 따릅니다. 호출 탭이 없는 요청(사람이 실행한 CLI)은 terminal 탭에 확인 없이 입력합니다.

agent 탭에는 다음 경우 입력을 거절합니다.

- 409 `target-needs-input`: 상태가 needs-input이거나 화면에 권한 요청이 있음
- 409 `target-not-ready`: 상태가 idle/busy/ready-for-review가 아님, agent process가 돌고 있지 않음, 화면을 읽지 못함, 또는 trust·Codex update·Codex hook review 시작 화면이 떠 있음

붙여 넣은 뒤 그런 화면이 나타나면 이어지는 Enter를 보내지 않습니다. CLI는 권한 요청과 시작 화면에 글자를 보내지 않으며 사용자 대신 승인하거나 거절하지 않습니다. 사람이 실행한 CLI가 Runtime v2 plain terminal 탭에 보내는 입력은 tmux `send-keys -l --`를 쓰므로 browser 없이도 동작합니다.

### tab status, result, close

- `tab status`: `panelType`, `providerId`, `alive`, `command`, `cliState`, `agentSessionId`, `createdByTabId`.
- `tab result`: agent 탭은 `lastAssistantMessage`와 `content`, terminal 탭은 `content`.
- `tab close`: 호출 탭이 있으면 `createdByTabId`가 그 호출 탭인 탭만 닫습니다. 그 외는 403 `delegation-close-forbidden`.

### Runtime v2 꺼짐

`AGENTMUX_RUNTIME_V2`가 켜져 있지 않으면 v2 탭은 살아 있지 않은 것으로 보고 Runtime v2 supervisor를 부르지 않습니다. 그래서 v2 탭에 대한 `tab send`와 `tab result`는 409 `{ "error": "Tab session is not running" }`(기존 형식)이고, `tab status`는 200에 `alive: false`를 돌려줍니다. v2 탭은 plain terminal뿐이므로 호출 탭이 있는 `tab send`는 그 전에 403 `delegation-send-forbidden`입니다.

## 오류 응답

새 오류는 `{ "error": "<code>", "message": "<설명>" }` 형식입니다. 기존 오류 응답(`{ "error": "Tab not found" }` 등)은 바꾸지 않았습니다.

| code | HTTP | 의미 |
| --- | --- | --- |
| `invalid-panel-type` | 400 | `-t` 값이 `terminal`, `codex`, `claude`, `web-browser`, `diff`가 아님 |
| `invalid-cwd` | 400 | `--cwd`가 존재하는 절대 경로 directory가 아님 |
| `caller-tab-not-found` | 404 | 호출 탭 id를 찾을 수 없음(create, send, close) |
| `delegation-send-forbidden` | 403 | 호출 탭이 있는 `tab send`의 대상이 agent 탭(`claude`, `codex`)이 아님. 아무것도 입력하지 않음 |
| `delegation-close-forbidden` | 403 | 호출 탭이 만들지 않은 탭을 닫으려 함 |
| `agent-unavailable` | 409 | agent가 설치되어 있지 않음 |
| `delegation-limit` | 409 | workspace의 agent 생성 탭이 이미 6개 |
| `target-needs-input` | 409 | 대상 agent가 사용자 입력(권한 요청)을 기다림 |
| `target-not-ready` | 409 | 대상 agent가 입력을 받을 상태가 아님 |
| `runtime-v2-disabled` | 409 | 탭 서비스가 Runtime v2가 꺼진 상태에서 v2 탭 쓰기를 거절함. `send`와 `result`는 그 전에 session 확인에서 `Tab session is not running`을 돌려주므로 보통은 나오지 않음 |
