---
title: 설치
description: npm/source로 Linux 단일 엔진을 설치하고 systemd user service로 운영하는 기준.
eyebrow: 시작하기
permalink: /docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

현재 primary 설치 경로는 Linux 단일 엔진입니다. npm package 또는 source checkout이 custom
server, Runtime v2 다섯 worker와 Linux tmux adapter를 실행합니다.

{% call callout('note', '현재 package') %}
`@hardcoremonk/agentmux@0.5.0`은 아직 npm 배포 전이며 로컬 격리 tarball install, CLI와 production health
smoke를 통과했습니다. 현재 public npm `latest`는 이전 package `codexmux@0.4.23`입니다.
{% endcall %}

## Linux npm 실행

요구사항:

- Linux
- Node.js 20.9 이상
- tmux 3.0 이상
- Git과 로그인된 Codex CLI

{% call callout('warning', 'npm 미배포') %}
`@hardcoremonk/agentmux`는 아직 npm에 배포되지 않았습니다. 배포 전까지는 source checkout으로 실행하세요(`git clone https://github.com/HardcoreMonk/agentmux.git`).
{% endcall %}

```bash
npx --yes @hardcoremonk/agentmux@latest
```

Global command가 필요하면 `pnpm add -g @hardcoremonk/agentmux` 후 `agentmux`를 실행합니다.

## Linux source와 user service

```bash
git clone https://github.com/HardcoreMonk/agentmux.git
cd agentmux
corepack enable
corepack pnpm install
corepack pnpm build
```

장기 실행은 `~/.config/systemd/user/agentmux.service`에 source checkout과 `command -v node`의
절대 경로를 지정합니다. `AGENTMUX_RUNTIME_V2=1`,
`AGENTMUX_SESSION_CATALOG_MODE=default`, `HOST=localhost`, `PORT=8122`를 사용하고
`systemctl --user enable --now agentmux.service`로 시작합니다. 전체 unit과 backup/restart
절차는 [systemd 문서](https://github.com/HardcoreMonk/agentmux/blob/main/docs/SYSTEMD.md)를
따릅니다.

## 별도 Windows package

현재 `electron-builder.yml`의 Windows target은 x64 NSIS installer와 zip입니다.

| artifact | 용도 |
|---|---|
| `agentmux-Setup-<version>.exe` | per-user NSIS 설치 |
| `agentmux-<version>-win.zip` 계열 | 압축 해제형 package |
| `latest.yml`, `.blockmap` | Electron updater metadata |

조직에서 승인한 내부 배포에는 [agentmux Releases](https://github.com/HardcoreMonk/agentmux/releases/latest)의 exact 네 artifact를 사용하고 version을 함께 확인하세요. Public code signing/SmartScreen reputation은 내부 배포 기준의 blocker가 아니지만 조직의 실행 정책은 별도로 따라야 합니다.

## Windows source 실행

요구사항:

- Windows x64
- Node.js 20.9 이상
- Git과 Codex CLI
- Corepack/pnpm

PowerShell에서:

```powershell
git clone https://github.com/HardcoreMonk/agentmux.git
Set-Location agentmux
corepack enable
corepack pnpm install

$env:AGENTMUX_RUNTIME_V2 = "1"
$env:AGENTMUX_RUNTIME_TERMINAL_ADAPTER = "windows"
$env:AGENTMUX_PROCESS_INSPECTOR_ADAPTER = "windows"
$env:PORT = "8122"
corepack pnpm dev:electron
```

`dev:electron`은 `HOST`가 없으면 `localhost`를 주입하고 선택한 `PORT`만 poll합니다. 따라서 source dev의 network access는 config보다 localhost가 우선하며, `8122`가 비어 있지 않다면 실행 전에 다른 free port를 지정해야 합니다.

이미 `8122`에서 dev server가 실행 중이면 Electron만 연결할 수 있습니다.

```powershell
$env:ELECTRON_DEV_URL = "http://localhost:8122"
corepack pnpm exec electron .
```

## Windows package 생성

Windows host에서 repository wrapper를 사용합니다. `electron-builder`를 직접 호출하지 않습니다.

```powershell
corepack pnpm pack:electron:dev
corepack pnpm pack:electron
```

| 명령 | 산출물 |
|---|---|
| `pack:electron:dev` | `release/win-unpacked/` |
| `pack:electron` | NSIS installer, zip, updater metadata |

Fresh package 검증 순서:

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:preflight
corepack pnpm smoke:windows:electron-env
corepack pnpm smoke:windows:electron-packaging
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:package-gate
corepack pnpm smoke:windows:release-gate
```

`package-gate`는 updater local-feed 단계를 포함합니다. Fresh runner의 `release/`에는 이전 installer가 없으므로 현재 version보다 낮은 실제 installer를 위 환경 변수로 전달해야 합니다. `CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_ALLOW_SYNTHETIC=1`은 개발 fallback일 뿐 release acceptance evidence로 인정하지 않습니다.

`v0.4.22`는 [Issue #16](https://github.com/HardcoreMonk/agentmux/issues/16)의 조건대로 fresh Windows runner, 새 package와 실제 `v0.4.21` installer로 통과했습니다. 이후 stable release도 명령의 존재가 아니라 같은 실제 evidence를 남겨야 합니다.

## Port와 최초 설정

외부 server port 기본값은 `8122`입니다. **Packaged Electron local server**는 이 port로 시작하지 못하면 port `0`으로 다시 시작해 빈 port를 선택하고 실제 값을 `~/.agentmux/port`에 기록합니다.

반면 `dev:electron` wrapper는 처음 선택한 `PORT`의 health URL만 poll하므로 fallback port를 따라가지 않습니다. Source dev에서는 `8122`를 비우거나 시작 전에 free port를 지정합니다.

```powershell
$env:PORT = "9000"
corepack pnpm dev:electron
```

Fresh setup process는 `HOST`를 지정해도 loopback에만 bind합니다. Packaged Electron은 setup 후 restart부터 저장된 config의 network access를 사용합니다. Source `dev:electron`은 `HOST` 미지정 시 `localhost`를 주입하므로 외부 access가 필요하면 restart 전에 `$env:HOST="localhost,tailscale"`처럼 명시해야 합니다.

## Update와 제거

Packaged Electron은 GitHub release metadata를 사용하는 updater를 포함합니다. Update acceptance는 matching `latest.yml`, installer, `.blockmap`과 published install smoke가 함께 확인된 version만 대상으로 합니다.

Windows 앱 제거는 **설정 → 앱 → 설치된 앱**에서 처리합니다. App 제거는 `~/.agentmux/` data를 자동으로 지우지 않습니다. 전체 data를 삭제하려면 app/server를 종료하고 별도로 실행합니다.

```powershell
Remove-Item -Recurse -Force (Join-Path $HOME ".agentmux")
```

이 작업은 workspace, runtime DB, 인증, log, upload를 모두 삭제하지만 Codex CLI 소유의 `~/.codex/`는 삭제하지 않습니다. 세부 구조는 [데이터 디렉터리](/agentmux/docs/data-directory/)를 참고하세요.

## 선택 client와 보존된 package

Browser가 Linux engine의 primary 운영 UI입니다. Electron과 Android는 실행 중인 server에
접속하는 선택 client입니다. Windows installer/updater와 macOS package는 별도 release
surface이며 Linux engine acceptance를 대신하지 않습니다.

## 다음으로

- **[빠른 시작](/agentmux/docs/quickstart/)** — Linux npm/source 실행과 setup
- **[포트 & 환경 변수](/agentmux/docs/ports-env-vars/)** — runtime/network 변수
- **[문제 해결](/agentmux/docs/troubleshooting/)** — Linux service, Runtime v2와 port 진단
