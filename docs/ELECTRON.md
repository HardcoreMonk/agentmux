# Electron과 Windows 패키징

agentmux Electron 앱은 Next.js UI를 데스크톱 shell 안에서 실행하는 선택 client입니다.
현재 active runtime은 Linux 단일 엔진이며, 이 문서의 Windows desktop shell, NSIS installer와
updater smoke는 별도 배포면의 보존된 release 계약입니다.

## 명령

Windows source development:

```powershell
$env:PORT = "8122"
$env:AGENTMUX_RUNTIME_V2 = "1"
$env:AGENTMUX_RUNTIME_TERMINAL_ADAPTER = "windows"
$env:AGENTMUX_PROCESS_INSPECTOR_ADAPTER = "windows"
corepack pnpm dev:electron
```

이미 `8122`에서 server가 실행 중일 때 Windows Electron만 연결:

```powershell
$env:ELECTRON_DEV_URL = "http://localhost:8122"
corepack pnpm exec electron .
```

Build/package:

```powershell
corepack pnpm build:electron
corepack pnpm pack:electron:dev
corepack pnpm pack:electron
```

Windows smoke는 현재 version보다 낮은 실제 baseline installer를 준비한 뒤 실행합니다.

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm pack:electron
corepack pnpm smoke:windows:electron-env
corepack pnpm smoke:windows:electron-packaging
corepack pnpm smoke:windows:zip-artifact
corepack pnpm smoke:windows:update-metadata
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:packaged-runtime-v2
corepack pnpm smoke:windows:installer-install
corepack pnpm smoke:windows:installer-runtime-v2
corepack pnpm smoke:windows:updater-local-feed
corepack pnpm smoke:windows:package-gate
corepack pnpm smoke:windows:release-gate
```

Legacy macOS packaging:

```bash
corepack pnpm pack:electron:mac:dev
corepack pnpm pack:electron:mac
```

## 주요 파일

| 파일 | 역할 |
| --- | --- |
| `electron/main.ts` | BrowserWindow, menu, local/remote server mode, updater |
| `electron/app-server-protocol.ts` | local/remote app-server URL 정규화와 active server label contract |
| `electron/preload.ts` | renderer IPC bridge |
| `electron/browser-bridge.ts` | Electron browser panel bridge |
| `electron/runtime-env.ts` | platform별 PATH와 `NODE_PATH` 처리 |
| `scripts/dev-electron.mjs` | dev server 자동 실행과 Electron attach |
| `scripts/pack-electron-windows.mjs` | Windows electron-builder wrapper |
| `electron-builder.yml` | Windows NSIS/zip packaging, publish metadata |

Electron 설정은 `~/.agentmux/config.json`(legacy 실제 경로 `~/.codexmux/config.json`)을 공유합니다. Server mode는 `server.mode`, `server.remoteUrl`로 관리합니다.

## Codex session hook bridge

Electron renderer는 Codex command, CLI token, hook capability를 만들지 않습니다. Local server가
검증된 tab launch intent로 session hook을 조립하고 `~/.agentmux/status-hook.cjs`(legacy 실제 경로 `~/.codexmux/status-hook.cjs`)를
호출합니다. Electron executable을 standalone Node bridge runtime으로 사용할 때는
`ELECTRON_RUN_AS_NODE=1`을 명시합니다. Bridge timeout이나 server 부재는 Codex action을
중단시키지 않으며 JSONL/process polling이 상태를 재조정합니다.

이 hook 변경의 완료 근거는 `docs/operations/2026-08-14-purplemux-selected-adoption-handoff.md`에
있습니다. Windows package 실기 검증은 해당 선택 도입의 완료 조건이 아닙니다.

## 서버 모드

로컬 서버:

- 앱 실행 시 내부 agentmux server를 시작합니다.
- 기본 포트는 현재 저장소 기준 `8122`이고, 사용 중이면 fallback port를 사용합니다.
- 앱 종료 시 server shutdown과 Electron storage flush를 수행합니다.
- Windows에서는 POSIX PATH 보정을 적용하지 않고 현재 Windows `PATH`를 유지합니다.
- Packaged local server의 `NODE_PATH`는 Windows에서 `;` 구분자를 사용합니다.

원격 서버:

- 설정한 URL을 `~/.agentmux/config.json`(legacy 실제 경로 `~/.codexmux/config.json`)에 저장합니다.
- URL scheme이 없으면 `http://`를 붙입니다.
- 허용 scheme은 `http://`, `https://`입니다.
- 잘못 저장된 remote URL이나 지원하지 않는 scheme은 local mode로 fallback합니다.

## Windows 패키징 계약

`pack:electron`은 Windows release package를 생성합니다.

| 명령 | 산출물 |
| --- | --- |
| `build:electron` | `dist/`, `dist-electron/`, `.next/standalone/` |
| `pack:electron:dev` | `release/win-unpacked/` |
| `pack:electron` | Windows NSIS installer, zip, updater metadata |

Windows wrapper는 electron-builder를 직접 호출하지 않고 `scripts/pack-electron-windows.mjs`를 사용합니다.

- electron-builder node-module collector를 위해 임시 `pnpm` shim을 만듭니다.
- `--config.npmRebuild=false`를 전달합니다.
- packaged runtime native binding은 standalone bundle에서 공급합니다.
- `dist/workers/**`는 worker fork를 위해 unpacked 상태를 유지합니다.
- NSIS `runAfterFinish`는 silent install smoke를 위해 disabled 상태를 유지합니다.
- NSIS `artifactName`은 `${productName}-Setup-${version}.${ext}` 형태를 유지합니다.
- NSIS assisted installer는 `build-resources/installer.nsh`를 include합니다. silent
  `--updated` update apply에서는 install section 이후 명시적으로 `quitSuccess`를
  호출해 updater installer process가 settle되도록 합니다.
- 내부 updater가 앱 종료를 제어하므로 NSIS process-name scan은 우회합니다. 이는
  장시간 자동화 세션에서 stale `agentmux.exe`(또는 legacy `codexmux.exe`) tasklist 항목이 silent install/update를
  막는 문제를 피하기 위한 Windows 내부 배포 계약입니다.

`latest.yml`, installer exe, matching `.blockmap`은 같은 updater-visible artifact name을 가져야 합니다.

## Packaged upload integrity

Packaged local server도 `/api/upload-image`와 `/api/upload-file`을 embedded Next server보다
앞선 outer custom server에서 처리합니다. Internal standalone port와 제거된 Pages API route는
upload fallback surface가 아닙니다. `AGENTMUX_UPLOADS_DISABLED=1`(legacy `CODEXMUX_UPLOADS_DISABLED=1` 호환)로 같은 executable을 다시
시작하면 두 upload route만 `503`으로 닫고 health, config, 기존 artifact tree는 유지해야 합니다.

```powershell
corepack pnpm pack:electron
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:package-gate
corepack pnpm check:smoke-artifacts -- $env:CODEXMUX_SMOKE_ARTIFACT_DIR
```

2026-07-12 `v0.4.20` workflow에서 실제 packaged exe의 size/SHA-256,
same-directory publish, abort stage unlink, aged stage cleanup, committed `.part` 보존과
동일 exe kill-switch restart를 최초 확인했습니다. 보존된 `v0.4.22`
legacy [workflow 29219010240 attempt 3](https://github.com/HardcoreMonk/codexmux/actions/runs/29219010240)는
같은 검사를 package gate `394584ms`, upload integrity `11724ms`로 반복하고 browser,
package, published-updater 세 artifact의 총 16개 JSON을 독립 privacy scan으로 확인했습니다.
ADR-027과 ADR-028은 `Verified`이며
이전 이름 저장소의 [Issue #16](https://github.com/HardcoreMonk/codexmux/issues/16) acceptance를 충족했습니다.

## 업데이트 smoke

Local feed smoke:

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:updater-local-feed
```

이 smoke는 생성된 `latest.yml`과 직전 Windows installer를 사용해 isolated 짧은
설치 경로에서 실제 updater apply를 수행합니다. localhost feed에서 download,
`update-downloaded`, `quitAndInstall`, app exit, updater installer settle,
post-install launch, registry/directory cleanup을 확인합니다.

Fresh runner의 `release/`에는 이전 installer가 없으므로 현재 version보다 낮은 실제 artifact를
위 환경 변수로 지정해야 합니다. `CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_ALLOW_SYNTHETIC=1`은
개발용 fallback이며 release acceptance에는 사용하지 않습니다. 같은 환경 변수는 local-feed
단계를 다시 실행하는 `smoke:windows:package-gate`에도 전달됩니다.

Published channel smoke:

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION = "<installed-lower-version>"
corepack pnpm smoke:windows:updater-published-channel
```

이 smoke는 설치나 update를 수행하지 않습니다. `electron-builder.yml`의 GitHub publish owner/repo에서 published release channel을 read-only로 확인합니다. 최신 published release에 `latest.yml`, installer, matching `.blockmap`, newer semver, download URL이 없으면 blocker로 실패합니다.

Prerelease도 published release 후보에 포함하려면 다음 환경 값을 함께 사용합니다. 이 값은
prerelease 허용 범위만 넓힙니다. 릴리스 검증에서는 `CODEXMUX_WINDOWS_UPDATER_PUBLISHED_TAG`를
함께 지정해 publish 시각이 더 최신인 다른 release를 잘못 검사하지 않도록 합니다.

```powershell
$env:CODEXMUX_WINDOWS_UPDATER_PUBLISHED_INCLUDE_PRERELEASE = "1"
$env:CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION = "0.4.2"
$env:CODEXMUX_WINDOWS_UPDATER_PUBLISHED_TAG = "v0.4.3"
corepack pnpm smoke:windows:updater-published-channel
```

지정한 tag가 없거나 draft/prerelease 허용 조건에 맞지 않으면 fail closed합니다.
선택한 release tag의 semver와 `latest.yml.version`이 다를 때도 fail closed합니다.

Published install smoke:

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_PUBLISHED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:updater-published-install
```

이 smoke는 설치된 낮은 버전 앱에서 GitHub-hosted release로 update apply를
시도합니다. published release가 prerelease이면
`CODEXMUX_WINDOWS_UPDATER_PUBLISHED_INCLUDE_PRERELEASE=1`과 검증할
`CODEXMUX_WINDOWS_UPDATER_PUBLISHED_TAG`를 함께 지정합니다.
현재 Windows updater는 Electron 프로세스 내부 HTTPS timeout을 피하기 위해
PowerShell `Invoke-WebRequest` 기반 HTTP executor를 사용합니다. 최초 published
install evidence는 다음 경로로 확보했습니다.

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_PUBLISHED_BASE_INSTALLER_PATH = "release\codexmux-Setup-0.4.15.exe" # legacy
$env:CODEXMUX_WINDOWS_UPDATER_PUBLISHED_GENERIC_FEED = "1"
corepack pnpm smoke:windows:updater-published-install
```

이 검증은 GitHub Release `v0.4.16`의 `latest.yml`과
legacy `codexmux-Setup-0.4.16.exe`를 실제로 다운로드하고, `quitAndInstall`, installer
settle, post-update `/api/health.version=0.4.16`까지 확인합니다.

현재 release evidence는 실제 `v0.4.21` installer를 baseline으로 사용한 exact target-tag
`v0.4.22` published channel/install smoke입니다. Baseline installer SHA-256
`0e54fafe6465474e0092228a128755fdb04eba3698d8f2daf00327ad7bb24aaa`을 먼저 확인하고,
local updater `240046ms`, release gate `17878ms`, GitHub-hosted asset download와 published
updater `254840ms`, `quitAndInstall`, installer settle, post-update packaged launch의
`/api/health.version=0.4.22`, `commit=4af0220` 일치를 통과했습니다. Tag commit은
`4af022090aa74ef3b2d7a01c9a8fd5bfe504f89a`이고
privacy-safe 증거 artifact는 `smoke-windows-published-update-v0.4.22`입니다. `v0.4.20` updater 기능 결과는 유효하지만
해당 published-updater artifact의 JSON 2개는 후속 privacy 재감사에서 제외했습니다.
`v0.4.15 -> v0.4.16` 검증도 초기 published updater 근거로 유지합니다.

Release updater smoke는 fresh HOME/profile을 사용합니다. 따라서 `v0.4.22` 통과만으로 기존
Electron storage의 legacy `session-token`이 login으로 전환되고, 1회 재로그인 뒤 Runtime v2
WebSocket/upload가 복구되는 old-profile 경로를 증명하지 않습니다. 이 근거가 확보될 때까지
ADR-029는 `Implemented`로 유지합니다.

## Electron 런타임 v2 smoke

Electron은 웹/PWA와 같은 React runtime v2 terminal hook을 사용합니다.

Linux development/Electron smoke:

```bash
xvfb-run -a corepack pnpm smoke:electron:runtime-v2
```

Windows packaged/installed smoke:

```powershell
corepack pnpm smoke:windows:packaged-runtime-v2
corepack pnpm smoke:windows:installer-runtime-v2
corepack pnpm smoke:windows:runtime-v2-rollback-drill
```

검증 항목:

- existing session cookie로 `/api/v2/terminal` attach
- marker command output
- page reload/reconnect
- packaged local server health
- runtime startup diagnostics
- runtime v2 Phase 6 health/perf gate
- blocking console 0건

설치 관찰 smoke:

```powershell
$env:CODEXMUX_WINDOWS_INSTALLED_OBSERVATION_DURATION_MS = "300000"
$env:CODEXMUX_WINDOWS_INSTALLED_OBSERVATION_MAX_ROUNDS = "24"
corepack pnpm smoke:windows:installed-observation
```

이 smoke는 최신 NSIS installer를 임시 위치에 silent install하고, 같은 isolated
Windows user dir에서 packaged launch/runtime v2 terminal/Phase 6 gate를 반복 실행한
뒤 silent uninstall까지 확인합니다. 2026-05-12 기준 `0.4.16` 설치본으로 302,808ms
관찰, 23회 반복 실행, 모든 round `version=0.4.16`, `commit=13fe69ba`가 통과했습니다.

Runtime v2 rollback drill은 설치 앱에서 `on -> CODEXMUX_RUNTIME_V2=0 -> restored`
순서를 확인합니다. off 상태는 인증 후 `/api/v2/runtime/health`가
`404 runtime-v2-disabled`를 반환해야 하며, restored 상태는 다시 Phase 6 gate를
통과해야 합니다.

## 알림

- 작업 완료 상태는 foreground toast와 Electron native notification으로 표시할 수 있습니다.
- `soundOnCompleteEnabled=false`이면 completion sound를 재생하지 않고 native notification도 silent로 요청합니다.
- notification 설정은 웹/PWA와 같은 `config.json` 값을 공유합니다.

## 릴리스 전 확인

- Windows package가 실제로 빌드되었는지 확인합니다.
- `release/latest.yml`, installer exe, `.blockmap` asset이 일치하는지 확인합니다.
- 현재 source로 packaged upload integrity, package gate, release gate를 fresh Windows에서
  실행하고 sanitized smoke artifact를 남깁니다. Artifact는 pre-upload privacy scanner를
  통과해야 증거로 업로드할 수 있습니다.
- 설치된 앱에서 published update apply evidence를 남깁니다. 현재 기준 증거는
  `v0.4.21 -> v0.4.22` exact target-tag published installer smoke입니다.
- 내부 전용 배포에서는 public code signing certificate trust와 SmartScreen reputation을 release blocker로 보지 않습니다.
- 현재 Windows release는 unsigned 내부 배포물입니다. Public signing과 외부 배포 준비가
  완료됐다는 의미로 해석하지 않습니다.
- 설치 경고나 내부 신뢰 절차는 release note와 설치 안내에 기록합니다.
- 장시간 실제 workspace 사용을 내부 사용자 3~5명으로 검증합니다.

`.github/workflows/release.yml`은 tag별 작업을 동시에 실행하지 않습니다. 고정한 직전 Windows
installer의 SHA-256을 확인하고 fresh `windows-2025` runner에서 package/release gate를 실행한
뒤 자산을 prerelease로 게시합니다. 정확한 target tag의 published channel과 실제
`quitAndInstall`이 통과해야 stable/latest로 승격합니다. Prerelease 게시 전에 실패하면
Release와 asset을 만들지 않고, 게시 이후 실패하면 candidate를 prerelease로 남겨 stable로
노출하지 않습니다. Browser/package/published-updater artifact의 privacy scanner 실패도
upload와 stable 승격을 차단합니다. `v0.4.22`는 이 흐름으로 `latest.yml`, installer,
matching blockmap, Windows zip의 정확한 네 asset을 검증한 뒤 stable/latest로
승격했습니다. npm publish와 legacy macOS package는 이 gate와 분리합니다. 상세 근거는
[v0.4.22 Windows release handoff](operations/2026-07-13-v0.4.22-windows-release-handoff.md)에
기록합니다.
