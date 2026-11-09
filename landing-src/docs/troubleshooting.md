---
title: 문제 해결 & FAQ
description: Linux user service, Runtime v2, 최초 설정, port와 terminal 진단 방법.
eyebrow: 레퍼런스
permalink: /docs/troubleshooting/index.html
---
{% from "docs/callouts.njk" import callout %}

문제를 보고할 때는 실행 경로(npm/source/systemd 또는 선택 Electron), Linux distribution,
`/api/health`의 version/commit과 재현 순서를 적어
[이슈를 열어주세요](https://github.com/HardcoreMonk/agentmux/issues). Runtime log 원본 전체를
업로드하지 말고 token, path, workspace, command와 사용자 내용을 지운 최소 error excerpt만
첨부합니다.

{% call callout('note', '현재 운영 기준') %}
Active runtime은 Linux 단일 엔진이고 public npm package는 `0.4.23`입니다. Windows Electron
`v0.4.22`는 별도 unsigned 내부 release 증거이며 Linux service acceptance를 대체하지 않습니다.
{% endcall %}

## 설치와 시작

### Linux service가 시작되지 않아요

```bash
systemctl --user status agentmux.service
journalctl --user -u agentmux.service -n 100 --no-pager
curl -fsS http://127.0.0.1:8122/api/health
```

Unit의 `WorkingDirectory`, `ExecStart` Node 절대 경로, `PATH`, tmux와 Codex CLI login을
확인합니다. Source를 갱신했다면 `CI=true corepack pnpm install --frozen-lockfile`과
`corepack pnpm build`를 먼저 실행합니다.

### Windows package를 일반 release로 사용해도 되나요?

`v0.4.22`는 fresh Windows packaged upload와 package/release gate를 통과한 별도 내부 stable release입니다. 실제 published update apply는 NSIS installer로 검증했고 zip은 package gate에서 검증했으며, evidence JSON은 upload 전 privacy scanner를 통과했습니다. Public code signing이 없으므로 조직의 SmartScreen과 unsigned app 실행 정책은 별도로 확인합니다.

검증 담당자는 Windows host에서 fresh package를 만든 뒤 실행합니다.

```powershell
corepack pnpm pack:electron
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:package-gate
corepack pnpm smoke:windows:release-gate
```

`pack:electron`은 full gate에 필요한 NSIS, zip, `latest.yml`을 생성합니다. `package-gate`에는 updater local-feed 검증이 포함되므로 fresh runner에서는 현재 version보다 낮은 실제 installer를 지정해야 합니다. `CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_ALLOW_SYNTHETIC=1`은 개발용 fallback이며 release acceptance evidence로 인정하지 않습니다.

### `node` 또는 `corepack`을 찾을 수 없어요

Source 실행에는 Node.js 20.9 이상이 필요합니다. Packaged Electron을 실행하는 것과 source를 build하는 것은 다른 경로입니다.

```powershell
node -v
corepack --version
corepack enable
corepack pnpm install
```

### `Cannot find module '../dist/server.js'` 또는 `.next/standalone/server.js`

Build artifact 없이 production entrypoint를 실행한 상태입니다.

```powershell
# 개발 실행
corepack pnpm dev:electron

# production artifact 생성
corepack pnpm build:electron
```

`bin/agentmux.js`와 packaged Electron local server는 build 완료 상태를 전제로 합니다.

### Windows에서 tmux preflight가 나타나거나 terminal이 열리지 않아요

Windows source path가 Runtime v2/Windows adapter로 시작했는지 확인합니다.

```powershell
$env:AGENTMUX_RUNTIME_V2 = "1"
$env:AGENTMUX_RUNTIME_TERMINAL_ADAPTER = "windows"
$env:AGENTMUX_PROCESS_INSPECTOR_ADAPTER = "windows"
corepack pnpm dev:electron
```

Windows Runtime v2에는 tmux가 필요하지 않습니다. `AGENTMUX_RUNTIME_TERMINAL_ADAPTER`가 없으면 runtime v2 adapter factory의 legacy default는 `tmux`이므로 source 검증에서는 세 변수를 명시합니다.

### "agentmux is already running"이 나와요

`~/.agentmux/cmux.lock`의 process가 살아 있고 `/api/health`에 응답하는지 확인합니다.

```powershell
$lockPath = Join-Path $HOME ".codexmux\cmux.lock"
$lock = Get-Content $lockPath | ConvertFrom-Json
Get-Process -Id $lock.pid
```

기존 instance를 종료해야 할 때만 `Stop-Process -Id $lock.pid`를 사용합니다. Process가 없다는 것을 확인한 stale lock만 삭제하세요.

```powershell
Remove-Item (Join-Path $HOME ".codexmux\cmux.lock")
```

### `Port 8122 is in use, finding an available port...`

Packaged Electron의 local server는 기본 port `8122`가 사용 중이면 빈 port로 다시 시도하고 실제 값을 `~/.agentmux/port`에 기록합니다. Direct server도 빈 port로 fallback할 수 있습니다.

반면 `dev:electron` wrapper는 시작할 때 선택한 `PORT`만 polling하며 server fallback을 따라가지 않습니다. Source 실행에서는 시작 전에 빈 port를 선택하세요.

```powershell
$env:PORT = "9000"
corepack pnpm dev:electron
```

Packaged Electron이 선택한 실제 port는 다음처럼 확인합니다.

```powershell
Get-Content (Join-Path $HOME ".codexmux\port")
```

## 최초 설정과 인증

### 다른 PC에서 첫 설정 화면이 열리지 않아요

정상입니다. Fresh/INIT setup process는 `HOST`와 저장 network access보다 먼저 `127.0.0.1`에만 bind합니다. 원격 onboarding은 지원하지 않습니다.

1. Linux engine host에서 loopback browser로 setup을 완료합니다.
2. network access를 선택합니다.
3. server/Electron을 재시작합니다.
4. 그 다음 HTTPS/Tailscale 또는 reverse proxy로 접속합니다.

### Setup 후에도 외부 접속이 안 돼요

Setup 완료만으로 현재 listener가 넓어지지 않습니다. Linux service unit의 `HOST`가
`localhost`면 외부 접속을 허용하지 않습니다. 보안 검토 후 허용 범위를 unit에 명시하고
daemon reload/restart합니다.

```bash
systemctl --user daemon-reload
systemctl --user restart agentmux.service
```

Remote onboarding은 지원하지 않습니다. Open internet에 직접 bind하지 말고 HTTPS/Tailscale
또는 승인된 reverse proxy를 사용합니다.

### 비밀번호를 잊었어요

Server/Electron을 먼저 종료하고 `authPassword`와 `authSecret`을 함께 제거합니다. `config.json` 전체 삭제는 기본 reset 절차가 아닙니다.

```powershell
$path = Join-Path $HOME ".codexmux\config.json"
Copy-Item $path "$path.bak"
node -e 'const fs=require("fs"),os=require("os"),path=require("path");const p=path.join(os.homedir(),".agentmux","config.json");const c=JSON.parse(fs.readFileSync(p,"utf8"));delete c.authPassword;delete c.authSecret;c.updatedAt=new Date().toISOString();fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")'
```

재시작한 새 process에서 onboarding을 완료합니다. Malformed JSON이나 hash-only auth state는 setup으로 downgrade되지 않고 fail closed하므로 원본을 백업한 뒤 수정해야 합니다.

### Purplemux와 함께 실행하면 로그인 또는 session 연결이 끊겨요

같은 hostname의 다른 port도 browser cookie를 공유합니다. `agentmux-session-token`이 포함된
build로 업데이트한 뒤 agentmux에 한 번 다시 로그인하세요. 이후 Purplemux의
`session-token`과 agentmux cookie는 함께 존재하며 각 제품이 자기 cookie만 읽습니다.
Purplemux가 계속 로그인 화면이나 `401`을 보이면 전환 전 legacy cookie가 codexmux JWT였던
상태이므로 Purplemux에도 한 번 로그인하세요. 로그인 순서는 그 뒤부터 서로 영향을 주지 않습니다.

`~/.agentmux/`, `~/.purplemux/`, tmux/runtime session을 삭제하지 마세요. Browser의 모든
localhost cookie를 일괄 삭제할 필요도 없습니다. 이전 build로 downgrade하면 generic cookie
충돌이 다시 발생할 수 있습니다.

## Session과 Runtime v2

### Browser를 닫았더니 tab이 사라졌어요

Linux terminal persistence는 Runtime v2 Terminal Worker와 tmux adapter가 담당하고,
layout/message history는 runtime v2 SQLite에 저장됩니다. 다음 순서로 확인합니다.

1. `/api/health`가 응답하는지 확인합니다.
2. `~/.agentmux/logs/`에서 runtime worker startup error를 확인합니다.
3. 중앙 recovery overlay가 `session-not-found`를 표시하면 단순 WebSocket reconnect 대신 tab session을 재시작합니다.

Linux engine의 tmux adapter 상태는 `tmux -L codexmux ls`로 확인합니다.

### Codex session이 resume되지 않아요

저장된 `agentSessionId`와 `~/.codex/sessions/**/*.jsonl`이 있어야 `codex resume <sessionId>`를 사용할 수 있습니다. JSONL이 삭제됐거나 project가 이동했다면 새 Codex session을 시작하세요. `~/.codex/`는 Codex CLI 소유 영역이므로 agentmux reset 과정에서 삭제하지 않습니다.

### CODEX 화면이 계속 연결 중이에요

먼저 Electron/browser를 reload하고 `/api/health`의 commit이 현재 build인지 확인합니다. Source tree에서는 다음 smoke로 timeline init과 늦게 생성되는 JSONL mapping을 확인합니다.

```powershell
corepack pnpm smoke:runtime-v2:timeline-websocket-default
corepack pnpm smoke:runtime-v2:timeline-session-changed
```

### 모든 tab이 `unknown` 또는 `busy`에 머물러요

`unknown`은 restart 전 busy tab을 복구 중인 상태입니다. Process/JSONL reconciliation이 `idle`, `ready-for-review`, `needs-input`을 다시 결정합니다. 장시간 유지되면 `LOG_LEVEL=debug`와 `LOG_LEVELS=status=debug`로 재현하고 status/runtime worker log를 확인하세요.

## 첨부 Upload

### `413 Payload Too Large`

Image는 10MiB, 일반 file은 50MiB까지입니다. Browser에서 미리 검사하지만 outer server도 `Content-Length`를 기준으로 같은 limit을 강제합니다.

### Upload가 `401` 또는 `403`으로 실패해요

Browser upload는 유효한 session cookie와 server와 같은 authority의 Origin이 필요합니다. Login을 다시 하고, reverse proxy가 `Host`/Origin authority를 바꾸지 않는지 확인하세요. Custom client는 유효한 `x-agentmux-token`을 사용할 수 있습니다.

### Upload가 `429` 또는 `503`으로 실패해요

- `429`: active upload 8개 또는 reserved 200MiB budget 초과. Queue가 없으므로 진행 중 upload가 끝난 뒤 다시 시도합니다.
- `503`: shutdown 중이거나 `AGENTMUX_UPLOADS_DISABLED=1`입니다.

### `.upload.part`가 남아 있어요

Transaction은 실패 시 stage unlink를 먼저 시도합니다. 강제 kill이나 Windows file handle 때문에 남은 reserved stage는 최소 30분 age floor 뒤 startup/maintenance/manual cleanup 대상입니다. 실행 중인 server의 `uploads/`를 직접 지우지 마세요.

## Browser와 외부 접근

### WebSocket이 연결됐다가 즉시 끊겨요

Reverse proxy가 `Upgrade`와 `Connection` header를 전달하는지 확인합니다.

```nginx
location / {
  proxy_pass http://127.0.0.1:8122;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
```

Open internet의 plain HTTP는 terminal/WebSocket payload를 암호화하지 않으므로 사용하지 않습니다.

### PWA 또는 Android 앱 문제인가요?

PWA/mobile browser와 Capacitor Android는 실행 중인 Linux engine에 접속하는 선택 client입니다.
Background 복귀 문제는 terminal/status/timeline/sync WebSocket을 다시 연결한 뒤 판단하세요.

### Web Push가 오지 않아요

HTTPS, browser notification permission, 앱의 알림 설정, `~/.agentmux/push-subscriptions.json`을 확인합니다. iOS는 Safari 16.4 이상에서 홈 화면에 추가한 PWA가 필요합니다.

## 데이터와 privacy

### 데이터는 어디에 있나요?

앱 상태는 Linux service user의 `~/.agentmux/`, Codex 원본 session은 `~/.codex/`에 있습니다. Upload artifact는 `~/.agentmux/uploads/<workspace>/<tab>/`에 저장되고 기본 24시간 TTL cleanup 대상입니다.

### 외부 network request가 있나요?

사용 행동 telemetry나 agentmux cloud storage는 없습니다. 다만 Codex CLI의 OpenAI 통신, Web Push delivery, CLI update notifier, Electron updater metadata 요청은 발생할 수 있습니다. CLI version 확인은 `NO_UPDATE_NOTIFIER=1`로 끌 수 있습니다.

## Linux tmux adapter

### `tmux: command not found`

Active Linux engine에는 tmux 3.0 이상이 필요합니다. 전용 `-L codexmux` socket과 repository
`tmux.conf`를 사용하며 사용자의 `~/.tmux.conf`는 읽지 않습니다.

## 다음으로

- **[설치](/agentmux/docs/installation/)** — Linux npm/source와 systemd service
- **[보안과 인증](/agentmux/docs/security-auth/)** — bootstrap, auth, HTTPS
- **[데이터 디렉터리](/agentmux/docs/data-directory/)** — runtime DB와 upload cleanup
- **[아키텍처](/agentmux/docs/architecture/)** — outer server와 Runtime v2 흐름
