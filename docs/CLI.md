# agentmux CLI

`agentmux`(별칭 `amux`, legacy `codexmux`/`cmux`)는 실행 중인 agentmux server의 HTTP API를 부르는 CLI입니다. 사람이 직접 쓸 수도 있고, agentmux가 띄운 Claude Code·Codex가 다른 agent 탭에 일을 맡길 때도 씁니다(위임). 위임 설계 결정은 ADR-035, ADR-036, ADR-037, ADR-039에 있습니다.

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

`-w`는 모든 `tab` 하위 명령에서 `AMUX_WORKSPACE_ID`가 있으면 생략할 수 있습니다. `-w`를 주면 환경 변수보다 우선합니다. `tab list`는 `-w`와 `AMUX_WORKSPACE_ID`가 모두 없으면 모든 workspace의 탭을 보여줍니다. 오류는 `error: <code>: <message>` 형식으로 출력합니다.

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

설정을 끄면 위임 관련 값(위임 환경 변수, 안내, `permissions.allow`)이 붙지 않습니다. Codex hook 환경 변수는 상태 표시용으로 늘 붙습니다. agentmux 밖에서 돈 Claude Code·Codex에는 아무것도 붙지 않습니다.

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

Codex 위임은 hook trust 뒤에 동작합니다. agentmux가 띄운 Codex는 처음 한 번 "Hooks need review" 화면을 띄우고, 사용자가 그 화면이나 웹 카드("모두 trust하고 계속")에서 trust하면 이후 탭에서는 뜨지 않습니다. Hook 명령이 탭과 무관하게 고정이기 때문입니다(탭 값은 환경 변수로 전달, ADR-038). Node 경로나 data dir가 바뀌면 검토 화면이 한 번 더 뜹니다. 위임 CLI는 이 화면(과 update 안내, folder trust 화면)에 입력하지 않으며 대상이 `target-not-ready`가 됩니다. 개발용 격리 server는 사용자 Codex trust 기록을 건드리지 않도록 격리 `CODEX_HOME`을 씁니다.

한계 두 가지:

- Codex `workspace-write` sandbox는 local network를 막으므로 이 sandbox에서는 위임이 동작하지 않습니다.
- `shell_environment_policy`가 `inherit = "core"` 또는 `"none"`이면 환경 변수가 Codex shell에 닿지 않아 CLI가 호출 탭을 모릅니다. 이때는 사용자가 직접 실행한 CLI처럼 동작하므로 위임 제한이 없고 `-w`가 필요합니다.

## 위임 동작

호출 탭이 있는 요청(`x-agentmux-caller-tab`)은 "agent 호출"로 봅니다. 위임 제한은 실수 방지 장치이며 보안 경계가 아닙니다(ADR-036). 신뢰 경계는 CLI token을 읽을 수 있는 Unix 사용자입니다.

### tab create

- 탭 위치: 호출 탭의 pane. `-w`로 다른 workspace를 지정하면 그 workspace의 첫 pane.
- cwd: `--cwd`(존재하는 directory, 아니면 400 `invalid-cwd`), 없으면 호출 탭의 현재 cwd. CLI는 상대 경로(`.`, `../other`)를 현재 directory 기준 절대 경로로 바꿔 보냅니다. HTTP API는 절대 경로만 받습니다.
- active 탭은 바뀌지 않고 `createdByTabId`가 기록됩니다.
- workspace당 agent가 만든 탭은 6개까지이며 넘으면 409 `delegation-limit`입니다. 확인과 생성은 workspace별 lock 안에서 합니다.
- `-t claude`/`-t codex`: preflight를 먼저 하고(agent가 없으면 409 `agent-unavailable`) 탭을 만든 뒤 agent를 띄웁니다. Claude 탭은 그 launch의 `session-start` hook으로 `idle`이 될 때까지 최대 60초 기다려 `ready`를 돌려줍니다. Codex 탭의 `ready`는 화면 기준입니다(agent process 실행 + 입력창이 보임 + 차단 화면 없음). 입력창이 2초 동안 유지되어야 준비입니다(Codex는 검토 화면 전에 입력창을 잠깐 그립니다). Codex는 SessionStart hook을 첫 turn에 실행하므로 `session-start`로는 첫 prompt 전 준비를 알 수 없습니다. 띄우기가 실패하면 201에 `ready: false`와 `launchError`(실패 이유 code, 띄우기가 예외로 끝나면 `launch-failed`)를 돌려줍니다. 탭은 남아 있으므로 돌려받은 `tabId`로 닫을 수 있습니다.
- 호출 탭이 없는 탭 id이면 404 `caller-tab-not-found`(create, send, close).
- 호출 탭 자체가 이미 다른 탭이 만든 맡은 탭(`createdByTabId`가 있음)이면 403 `delegation-depth`로 거절합니다. 위임 깊이는 1단계로 제한됩니다.
- `-t terminal`도 만들 수 있지만 agent 호출은 그 탭에 `tab send`를 할 수 없습니다(아래 tab send).

### tab send

호출 탭이 있으면 대상은 agent 탭(`claude`, `codex`)이어야 합니다. terminal 탭 등 agent 탭이 아닌 대상은 403 `delegation-send-forbidden`이고 아무것도 입력하지 않습니다. Claude Code는 `tab send`를 미리 허용하므로, shell에 입력이 닿으면 agent 자신의 명령 승인(Bash 권한 확인)을 건너뛰고 shell 명령을 실행하게 되기 때문입니다(ADR-036, 사용자 결정 2026-11-11). 위임 입력은 agent 탭에만 닿고 각 agent 탭은 자체 권한 설정을 따릅니다. 호출 탭이 없는 요청(사람이 실행한 CLI)은 terminal 탭에 확인 없이 입력합니다.

- 호출 탭이 있는 요청에서 입력 앞뒤 공백을 뺀 내용이 `[agentmux report`(`AGENT_REPORT_PREFIX`)로 시작하면 400 `reserved-report-prefix`로 거절하고 아무것도 입력하지 않습니다. 자동 보고 태그 위조를 막기 위한 규칙이며, 사람이 실행한 CLI(호출 탭 없음)는 이 접두어로도 보낼 수 있습니다.

agent 탭에는 다음 경우 입력을 거절합니다.

- 409 `target-needs-input`: 상태가 needs-input이거나 화면에 권한 요청이 있음
- 409 `target-not-ready`: 상태가 idle/busy/ready-for-review가 아님, agent process가 돌고 있지 않음, 화면을 읽지 못함, 또는 trust·Codex update·Codex hook review 시작 화면이 떠 있음

붙여 넣은 뒤 그런 화면이 나타나면 이어지는 Enter를 보내지 않습니다. CLI는 권한 요청과 시작 화면에 글자를 보내지 않으며 사용자 대신 승인하거나 거절하지 않습니다. 사람이 실행한 CLI가 Runtime v2 plain terminal 탭에 보내는 입력은 tmux `send-keys -l --`를 쓰므로 browser 없이도 동작합니다.

### tab status, result, close

- `tab status`: `panelType`, `providerId`, `alive`, `command`, `cliState`, `agentSessionId`, `createdByTabId`.
- `tab result`: agent 탭은 `lastAssistantMessage`와 `content`, terminal 탭은 `content`.
- `tab close`: 호출 탭이 있으면 `createdByTabId`가 그 호출 탭인 탭만 닫습니다. 그 외는 403 `delegation-close-forbidden`.

### 자동 보고

맡은 자식 탭(C)이 끝나거나 권한 질문에 막히면, 서버가 맡긴 부모 탭(P)의 입력창에 보고를 자동으로 넣어 보냅니다(ADR-039).

- **발생 조건:** C의 `createdByTabId`가 P를 가리키고, C와 P가 모두 legacy(Runtime v1) agent 탭(`claude`, `codex`)일 때 동작합니다. Runtime v2 탭(`runtimeVersion === 2`)과 `createdByTabId`가 없는 탭은 제외됩니다. C의 상태가 `ready-for-review`로 바뀌면 `done` 보고를, `needs-input`으로 바뀌면 `blocked` 보고를 만듭니다. C의 turn이 P의 `tab send`로 시작했든 사람이 C에 직접 친 입력으로 시작했든 C가 P의 자식이고 P가 살아 있으면 보고합니다. 같은 turn 완료는 `completionKey` dedupe로 한 번만 보내고, 서버 시작·복원 때의 조용한 전환(`silent` 전환)은 보고하지 않습니다.
- **보고 형식:** 한 덩어리 text이며 첫 줄 태그는 `[agentmux report · <C 이름 또는 id> (<provider>) · done|blocked]`(접두어 상수 `AGENT_REPORT_PREFIX = '[agentmux report'`)입니다.
  - `done`: C의 마지막 답(`readLastAssistantMessage`)을 앞에서 최대 800자 넣습니다. 800자를 넘으면 `…`를 붙이고 다음 줄에 `full result: agentmux tab result <C id>`를 둡니다. 마지막 답을 읽지 못하면 `(no final message; see agentmux tab result <C id>)`입니다. 답 안에서 `[agentmux report`로 시작하는 줄은 앞에 `> `를 붙여 보고 머리줄로 보이지 않게 합니다.
  - `blocked`: 고정 문장 `"이 탭이 권한 질문을 기다립니다. 사람이 그 탭에서 답해야 합니다. agentmux는 대신 답하지 않습니다."`를 넣습니다.
  - 마지막 줄: `reply: agentmux tab send <C id> '...'`
  - P의 timeline에서 `[agentmux report`로 시작하는 사용자 메시지는 일반 사용자 말풍선 대신 "agent 보고" 카드(출처 탭 이름과 끝남/막힘 상태 표시)로 그립니다.
- **전달 조건:** 다음을 모두 만족할 때만 P에 `writeTabInput(P, text, { guardFollowUpEnter: true })`로 씁니다. 서버는 권한 질문·trust·Codex update·hook 검토 화면에 글자를 쓰지 않고 사용자 대신 답하지 않습니다.
  - P가 살아 있는 legacy agent 탭이고 상태가 `idle` 또는 `ready-for-review`입니다(`busy`이면 현재 turn을 끊지 않기 위해 기다립니다).
  - `tab send`와 같은 대상 확인(`checkAgentInputTarget`: `target-needs-input`, `target-not-ready` 없음)을 통과합니다.
  - P의 입력창이 비어 있어 사람이 쓰던 draft와 섞이지 않습니다(`capturePaneAnsi`와 `isAgentComposerEmpty`). Codex는 마지막 굵은 `›` 줄 뒤 보이는 글자가 하나 이상이고 모두 SGR `2`(흐림)일 때만 빈 것으로 봅니다. Claude Code는 마지막 `❯`+NBSP 줄 뒤 보이는 글자가 없거나 모두 SGR `2`이고 바로 아래 줄이 상자 테두리(`─`)일 때만 빈 것으로 봅니다. 붙여 넣은 `[Pasted Content …]` 표시나 일반/확장 색 글자가 있으면 비지 않은 것(`false`)이며, 입력창 줄을 찾지 못하면 판정 불가(`null`)로 보내지 않고 기다립니다.
- **대기열, 묶음, 이전 보고 turn 대기:** 전달 조건이 맞지 않으면 보고를 P별 대기열에 넣고, P의 상태가 바뀌거나 상태 주기 확인(탭 수에 따라 30~60초) 때 다시 시도합니다. 여러 보고가 쌓여 있으면 빈 줄 하나로 이어 한 번에 하나의 메시지로 묶어 보냅니다(각 보고의 첫 줄 태그 유지). 보고를 쓰기 직전에 표시를 해 두고, 그 보고로 시작된 turn의 `prompt-submit` hook이 오거나 60초가 지날 때까지 다음 보고를 보내지 않습니다.
- **반복 제한(5회)과 만료(30분):**
  - 사람 입력 없이 자동 보고가 P에 연달아 5번 들어가면, 6번째부터는 보내지 않고 대기열에 둡니다(`paused`). 사람이 P에 입력하면 연속 횟수를 0으로 되돌리고 대기열을 다시 보냅니다. hook에는 prompt 본문이 없으므로, 보고 표시 뒤 첫 `prompt-submit` 하나(60초 안)는 보고로, 그 밖의 `prompt-submit`은 사람 입력으로 봅니다.
  - 대기열에 들어간 지 30분이 지나도 보내지 못한 보고는 버립니다(`expired`).
- **알림:** 5번 연속 정지(`paused`)와 30분 만료 폐기(`expired`)는 P 탭의 상태 필드 `agentReportNotice`(알림 목록에 한 줄로 표시), 웹 화면 toast, Web Push(`sendWebPush`)로 사람에게 알립니다. 사람 입력이 오면 표시를 지웁니다.
- **설정:** Settings → General의 "agent 자동 보고" 스위치(`agentReportsEnabled`, 기본값 `true`)로 켜고 끕니다. 위임 안내(`agentDelegationGuideEnabled`)가 꺼져 있으면 이 스위치도 비활성화되며 서버도 자동 보고를 보내지 않습니다. 스위치를 끄면 대기 중인 보고를 모두 버리고, 새로 띄우는 agent의 위임 안내는 상태 확인(`tab status`) 방식 문구로 돌아갑니다.
- **한계:** 대기열과 연속 횟수는 `StatusManager`(Runtime v2에서는 status worker) 메모리에만 두므로, 서버나 status worker가 재시작하면 대기 중이던 보고는 사라집니다. 재시작 뒤에는 맡긴 agent가 `agentmux tab status`로 자식 탭 상태를 확인할 수 있습니다. 또한 이미 실행 중인 agent 탭은 다음 시작이나 재개 때부터 바뀐 위임 안내를 받습니다.

### Runtime v2 꺼짐

`AGENTMUX_RUNTIME_V2`가 켜져 있지 않으면 v2 탭은 살아 있지 않은 것으로 보고 Runtime v2 supervisor를 부르지 않습니다. 그래서 v2 탭에 대한 `tab send`와 `tab result`는 409 `{ "error": "Tab session is not running" }`(기존 형식)이고, `tab status`는 200에 `alive: false`를 돌려줍니다. v2 탭은 plain terminal뿐이므로 호출 탭이 있는 `tab send`는 그 전에 403 `delegation-send-forbidden`입니다.

## 오류 응답

새 오류는 `{ "error": "<code>", "message": "<설명>" }` 형식입니다. 기존 오류 응답(`{ "error": "Tab not found" }` 등)은 바꾸지 않았습니다.

| code | HTTP | 의미 |
| --- | --- | --- |
| `invalid-panel-type` | 400 | `-t` 값이 `terminal`, `codex`, `claude`, `web-browser`, `diff`가 아님 |
| `invalid-cwd` | 400 | `--cwd`가 존재하는 절대 경로 directory가 아님 |
| `reserved-report-prefix` | 400 | 호출 탭이 있는 `tab send`의 내용이 `[agentmux report`로 시작함. 아무것도 입력하지 않음 |
| `caller-tab-not-found` | 404 | 호출 탭 id를 찾을 수 없음(create, send, close) |
| `delegation-depth` | 403 | 이미 다른 탭이 만든 맡은 탭(`createdByTabId`가 있음)이 `tab create`를 호출함 |
| `delegation-send-forbidden` | 403 | 호출 탭이 있는 `tab send`의 대상이 agent 탭(`claude`, `codex`)이 아님. 아무것도 입력하지 않음 |
| `delegation-close-forbidden` | 403 | 호출 탭이 만들지 않은 탭을 닫으려 함 |
| `agent-unavailable` | 409 | agent가 설치되어 있지 않음 |
| `delegation-limit` | 409 | workspace의 agent 생성 탭이 이미 6개 |
| `target-needs-input` | 409 | 대상 agent가 사용자 입력(권한 요청)을 기다림 |
| `target-not-ready` | 409 | 대상 agent가 입력을 받을 상태가 아님 |
| `runtime-v2-disabled` | 409 | 탭 서비스가 Runtime v2가 꺼진 상태에서 v2 탭 쓰기를 거절함. `send`와 `result`는 그 전에 session 확인에서 `Tab session is not running`을 돌려주므로 보통은 나오지 않음 |
