# 터미널 런타임과 legacy tmux 경로

이 문서는 Linux 단일 엔진의 tmux adapter와 browser-facing terminal protocol을 설명합니다. tmux는 제품 domain API가 아니라 Terminal Worker 뒤의 infrastructure adapter입니다.

## 구조

```text
Browser xterm
  | terminal WebSocket
  v
custom server / Terminal Worker
  | terminal runtime adapter
  v
  Linux tmux adapter
  v
shell / codex / claude
```

## tmux 설정과 systemd scope 분리

실행 중인 세션과 Codex CLI 프로세스를 끊지 않기 위해 기존 전용 tmux socket 이름을 그대로 보존합니다.

| 경로 | Socket 이름 | 용도 |
| --- | --- | --- |
| Legacy tmux adapter | `-L codexmux` | legacy terminal adapter 및 세션 목록/상태 보조 |
| Runtime v2 tmux adapter | `-L codexmux-runtime-v2` | Runtime v2 Terminal Worker 전용 socket |

```text
tmux -L codexmux
tmux -L codexmux-runtime-v2
session: pt-{workspaceId}-{paneId}-{tabId}
```

전용 socket을 쓰기 때문에 사용자의 일반 tmux 세션과 분리됩니다.

Linux `systemd --user` production 환경(`INVOCATION_ID`, `NODE_ENV=production`, `XDG_RUNTIME_DIR`, `DBUS_SESSION_BUS_ADDRESS`가 모두 있는 경우)에서는 web service(`agentmux.service`)를 재시작하거나 중지해도 tmux 서버와 Codex CLI 자식 프로세스가 함께 종료되지 않도록 tmux 서버를 별도 transient scope(`agentmux-tmux-<socket>.scope`)에서 실행합니다.

- 아직 해당 socket의 tmux 서버가 없으면 `systemd-run --user --scope --collect --unit=agentmux-tmux-<socket>`으로 tmux 명령을 감싸 별도 scope에서 tmux 서버를 기동합니다.
- 이미 실행 중인 tmux 서버가 `agentmux.service` 또는 legacy `codexmux.service` cgroup 안에 속해 있으면 `busctl --user call ... StartTransientUnit`으로 `agentmux-tmux-<socket>.scope`에 서버 PID를 위임해 이관합니다.
- 개발 모드, 테스트, 비-systemd 환경에서는 `systemd-run`/`busctl`을 호출하지 않고 일반 `tmux`를 직접 실행합니다.
- 의도적으로 tmux 서버까지 완전히 종료해야 할 때는 `tmux -L <socket> kill-server` 또는 `systemctl --user stop agentmux-tmux-<socket>.scope`를 실행합니다.

## 터미널 WebSocket

Terminal WebSocket은 adapter와 무관하게 다음 동작을 기대합니다.

| 동작 | 의미 |
| --- | --- |
| attach | session stdout 구독 |
| input | stdin byte 전달 |
| resize | cols/rows 변경 |
| detach | WebSocket 구독 해제 |
| kill/delete | runtime session 종료 |

Legacy URL은 `/api/terminal`, runtime v2 URL은 `/api/v2/terminal`입니다. Public protocol은 가능한 유지하고 backend 구현만 adapter로 교체합니다.

Session Catalog와 Project Governance는 terminal byte stream을 소유하지 않습니다. Timeline Worker의 catalog rebuild나 Governance Worker의 index refresh/restart 중에도 existing terminal WebSocket과 tmux session은 유지되어야 합니다. Projection rollback smoke는 worker DB를 quarantine하고 worker를 재기동한 뒤 같은 terminal session에 재attach해 이 경계를 검증합니다.

## Install WebSocket

`/api/install`은 terminal WebSocket이나 generic no-auth path가 아닙니다. Custom server가
strict request target을 파싱한 뒤 install 전용 authorizer를 호출하고, typed URL/admission
context만 `createInstallServer()`에 전달합니다.

- setup-local: startup setup claim, loopback socket/Host, same-authority Origin을 요구합니다.
- init-password setup: 위 조건에 valid session을 추가로 요구합니다.
- configured/claimed: same-authority Origin과 valid session을 요구합니다.
- one-owner execution slot은 deferred spawn 중 경쟁 connection을 `1013`으로 닫습니다.
- setup lease 완료/process exit는 `1000`, server shutdown은 `1001`, invalid context/command/mode drift는 `1008`, 64KiB 초과 frame은 `1009`, busy slot은 `1013`입니다.
- strict-state/PTY/command/input/output 오류와 backpressure는 세부 reason을 제한한 `1011`로 닫습니다.
- stdin/resize queue와 PTY output buffer에 상한을 두며 command selector는 platform allowlist own key만 허용합니다.

이 경로는 onboarding 도구 설치를 위해 사용자 권한 shell stdin을 받는 legacy
infrastructure adapter입니다. Linux engine의 일반 terminal API나 별도 Windows
host-owned privileged install/service action을 대신하지 않습니다.

## 입력 전송 계약

Terminal raw input과 Codex web input은 같은 WebSocket을 쓰지만 의미가 다릅니다.

| Frame | 용도 | 처리 |
| --- | --- | --- |
| `MSG_STDIN` | xterm raw key 입력 | byte를 그대로 pty stdin에 전달 |
| `MSG_WEB_STDIN` | Codex 입력 바, mobile toolbar 같은 UI 제출 | copy mode를 빠져나온 뒤 app-originated input으로 전달 |

Codex 입력 바는 prompt 본문을 bracketed paste로 감싸고 Enter를 같은 frame에 포함해 보냅니다. 그 뒤 Codex CLI의 긴 입력 확인 흐름을 위해 짧은 지연 후 Enter를 한 번 더 보냅니다. 이 계약은 재접속 직후 입력이 프롬프트에 남고 제출되지 않는 회귀를 막기 위한 것입니다.

## Codex hook 설정

Codex tab 실행과 resume command는 `hooks={path="~/.agentmux/hooks.json"}`(legacy `~/.codexmux/hooks.json`)를 넘기지 않습니다. 현재 Codex CLI는 `hooks`를 구조화된 TOML table로 해석하므로 path string override를 넣으면 config load 오류가 납니다.

Browser surface는 raw command, CLI token, hook capability를 만들지 않습니다. `/api/agent/launch`에 workspace/pane/tab과 launch/resume intent만 보내며 server의 `agent-launch-service`가 layout ownership, Codex panel, terminal process, Codex `0.144.1+` preflight를 검증합니다. Runtime v2는 exact terminal session을 다시 확인한 내부 write method를, legacy는 기존 `sendKeys`를 사용합니다.

Server Codex provider는 다음 session override를 각각 `-c`로 전달합니다.

- `hooks.SessionStart`
- `hooks.UserPromptSubmit`
- `hooks.Stop`

각 handler는 POSIX `command`와 Windows `commandWindows`, 3초 timeout, async 실행을 선언하고 standalone `~/.agentmux/status-hook.cjs`(legacy 실제 경로 `~/.codexmux/status-hook.cjs`)를 호출합니다. Packaged Electron executable을 Node runtime으로 재사용할 때도 script가 실행되도록 `ELECTRON_RUN_AS_NODE=1`을 명시합니다. Bridge는 tab/session/expiry HMAC capability와 CLI token을 loopback hook API에 전달하며, timeout이나 서버 부재가 Codex action을 막지 않도록 항상 성공 종료합니다.

User/project/managed/plugin hook은 Codex native layer discovery를 그대로 사용합니다. agentmux는 사용자 config를 읽거나 병합하지 않으며 `~/.agentmux/hooks.json`(legacy `~/.codexmux/hooks.json`)에는 빈 `hooks`와 statusline 호환 설정만 생성합니다.

## Claude Code 실행과 hook 설정

Claude Code 탭(panel type `claude`)도 Codex 탭과 같이 Runtime v1(legacy tmux adapter, `pt-…` session)으로 만들고,
browser는 intent만 보내며 server의 `agent-launch-service`가 layout ownership, panel type, safe shell, provider별
preflight(`agent-unavailable`)를 확인합니다.

실행 흐름:

1. 새 탭(`POST /api/layout/pane/<paneId>/tabs`, `{ panelType: 'claude', startAgent: true }`) 또는 launch 요청이 오면
   provider가 UUID를 만들고 탭의 `agentSessionId`에 먼저 기록합니다. 이전 session의 JSONL 경로는 비웁니다.
2. 탭 설정 파일 `<data dir>/claude-tabs/<tabId>.json`(`0600`)을 새 HMAC capability로 씁니다. 내용은 hook 7개와
   statusLine 하나입니다(`STATUS.md` "Claude Code hook 상태 경로").
3. `claude --settings '<탭 설정 파일>' --session-id <uuid>`를 보냅니다. 설정의 `claudeModel`,
   `claudePermissionMode`가 있으면 `--model`, `--permission-mode`를 더하고, 없으면 사용자 Claude 설정을 따릅니다.
4. 재개는 transcript가 있으면 `--resume <uuid>`, 없으면 같은 id로 `--session-id`입니다. 시작 시 자동 재개
   (`autoResumeOnStartup`)도 탭 provider의 `buildResumeCommand`를 씁니다.
5. 탭을 닫으면 provider `cleanupTab`이 탭 설정 파일을 지웁니다.

Claude Code는 `--settings`를 사용자·project 설정 위에 합칩니다. Hook은 모든 단계가 합쳐져 사용자 hook도 함께 돌고,
statusLine은 단일 값이라 agentmux script가 사용자 statusLine 명령을 대신 실행해 그 출력을 보여 줍니다.

권한 요청과 folder trust:

- 권한 요청 화면은 Codex와 같이 `GET /api/tmux/permission-options`가 pane 캡처에서 선택지를 읽고, 웹 카드가
  `POST /api/tmux/send-input`으로 번호를 보냅니다. Claude 문구("No, and tell Claude what to do differently")는 Codex
  문구로 바꾸지 않습니다. `promptType`은 기존 분류 규칙을 따릅니다. "Bash command" header가 있는 Claude 화면은
  `command`, Write의 "Create file" 화면은 `file`(live smoke 확인), 맞는 규칙이 없는 화면(header 없는 "Do you want to
  proceed?")은 `unknown`입니다.
- Folder trust 화면("Quick safety check", "Accessing workspace:" 다음 줄의 경로, 번호 없는 "No, exit"와 "Yes, I trust
  this folder")은 client가 xterm 화면에서 `matchTrustPrompt`로 감지해 탭별 카드를 띄웁니다. "신뢰"는 화살표와
  Enter, "종료"는 Esc를 보냅니다. 응답 직후 1초 동안은 같은 탭에서 카드를 다시 띄우지 않습니다.

## 런타임 v2 터미널

Runtime v2 Terminal Worker는 `ITerminalRuntimeAdapter`를 통해 구현을 선택합니다.

| Adapter | 용도 |
| --- | --- |
| `tmux` | legacy migration fallback |
| `windows` | Windows node-pty/ConPTY runtime |

`AGENTMUX_RUNTIME_TERMINAL_ADAPTER`(legacy `CODEXMUX_RUNTIME_TERMINAL_ADAPTER` 호환)로 adapter를 명시할 수 있습니다. Unknown value는 fail closed합니다.

## 입력과 단축키

Terminal 또는 Codex 입력창에 focus가 있으면 `Ctrl+D`는 앱 단축키가 아니라 EOF/EOT(`0x04`)로 pty에 전달됩니다.

IME composition 중이거나 keyCode 229인 key event는 xterm 입력으로 위임합니다. App-level Alt mapping을 처리하는 경우에는 browser 기본 동작보다 먼저 `preventDefault`합니다. Clipboard write는 secure-context API를 우선하고 불가능하면 정리되는 hidden textarea fallback을 사용합니다.

| OS | 오른쪽 pane split 기본값 |
| --- | --- |
| Windows/Linux | `Ctrl+Alt+D` |
| macOS legacy | `Cmd+D` |

`keybindings.json`은 앱 단축키 override만 저장하며 terminal 제어 입력보다 우선하지 않습니다.

## 제목 메타데이터

Terminal title은 현재 foreground command를 표시하는 데 사용합니다.

Client helper:

| 함수 | 파일 |
| --- | --- |
| `parseCurrentCommand(raw)` | `src/lib/tab-title.ts` |
| `isShellProcess(raw)` | `src/lib/tab-title.ts` |
| `formatTabTitle(raw)` | `src/lib/tab-title.ts` |
| `onTitleChange` | `src/hooks/use-terminal.ts` |

Server helper:

| 함수 | 파일 |
| --- | --- |
| `getPaneCurrentCommand(session)` | `src/lib/tmux.ts` |
| `getSessionCwd(session)` | `src/lib/tmux.ts` |
| `getSessionPanePid(session)` | `src/lib/tmux.ts` |
| `checkTerminalProcess(session)` | `src/lib/tmux.ts` |

새 process inspection 코드는 POSIX command를 직접 호출하지 말고 process inspector adapter를 사용합니다.

## Codex 감지

Codex 감지는 terminal runtime metadata, process tree, Codex JSONL을 함께 봅니다.

| 함수 | 역할 |
| --- | --- |
| `isCodexRunning(panePid)` | Codex process 실행 여부 |
| `detectActiveCodexSession(panePid)` | 실행 중인 Codex session metadata 감지 |
| `watchCodexSessions(panePid, cb)` | Codex session start/stop watch |

Claude Code 감지는 `src/lib/providers/claude/session-detection.ts`의 `isClaudeRunning`, `detectActiveClaudeSession`,
`watchClaudeSessions`가 맡습니다. Session id는 `~/.claude/sessions/<pid>.json`, process 인자, cwd transcript
directory의 최신 JSONL 순으로 찾습니다(`STATUS.md` "Session 다시 묶기").

Windows path에서는 Windows process inspector와 local `.codex/sessions` JSONL mapping smoke를 기준으로 삼습니다.

## 타임라인 WebSocket

Timeline WebSocket은 terminal output replay가 아니라 Codex JSONL과 live prompt projection을 제공합니다. Terminal stdout은 ephemeral stream이므로 durable timeline source가 아닙니다. Exec command, web search, MCP call, patch apply, error/warning, context compaction은 semantic row로 투영하되 field 4KiB, entry 16KiB 상한과 secret-like redaction을 적용합니다. Full output, download, local image serving은 제공하지 않습니다.

## Git DIFF 패널

DIFF 패널은 workspace/tab cwd를 기준으로 Git snapshot을 읽습니다. 대량 untracked 파일, binary, 큰 hunk는 제한하고 생략 안내를 표시합니다.

## 서버 시작 순서

1. Strict config/auth bootstrap과 startup loopback restriction을 확정합니다.
2. Legacy tmux fallback 또는 runtime v2 adapter를 준비하고, `scanSessions()` 직후(`initWorkspaceStore()`가 누락된 session을 재생성하기 전) `listSessions()`로 시작 시점에 이미 존재하던 tmux session 집합(`preexistingSessions`)을 기록합니다.
3. Generic terminal route와 typed install route를 분리해 등록합니다.
4. Workspace/layout state를 읽고, `autoResumeOnStartup({ preexistingSessions })`는 시작 시점에 없던 tmux session에 대해서만 탭 provider(Codex, Claude Code)의 resume 명령을 보냅니다(이미 살아 있던 session은 재개 명령을 보내지 않으며, `/api/tmux/reset` 경로는 빈 집합을 전달해 전체 재개합니다).
5. Runtime v2가 켜져 있으면 stale/ready terminal tab을 reconcile합니다.

## 관련 파일

| 파일 | 역할 |
| --- | --- |
| `src/lib/tmux.ts` | legacy tmux adapter helper |
| `src/lib/auto-resume.ts` | 시작 시점에 없던 tmux session에 대한 자동 재개 |
| `src/lib/terminal-server.ts` | legacy terminal WebSocket |
| `src/lib/install-request-auth.ts` | install request admission과 setup lease state |
| `src/lib/install-server.ts` | atomic legacy install PTY owner와 bounded I/O |
| `src/lib/runtime/terminal/*` | runtime v2 terminal contract/service |
| `src/lib/runtime/windows-terminal-runtime.ts` | Windows terminal adapter |
| `src/workers/terminal-worker.ts` | Terminal Worker entrypoint |
| `src/hooks/use-terminal.ts` | client terminal hook |
