# 테스트와 smoke 가이드

이 문서는 agentmux 변경을 검증하는 기준입니다. 현재 release 판단은 Linux 단일 엔진,
Runtime v2 worker, Session Operations와 Project Governance를 중심으로 합니다. Windows
package/updater는 해당 배포면을 변경할 때 별도 gate로 검증합니다.

## 기본 게이트

모든 코드 변경의 기본 검증:

```bash
corepack pnpm check:project-design
corepack pnpm lint
corepack pnpm tsc --noEmit
corepack pnpm test
```

`next.config.ts`는 `turbopack.root=process.cwd()`로 active checkout을 고정합니다. 저장소 아래
`.worktrees/`에서 build해도 parent checkout의 `.next/standalone`을 잘못 읽거나 쓰지 않아야 합니다.

Canonical 문서 경계나 `landing-src/`를 바꾸면 landing build도 실행합니다.

```bash
corepack pnpm build:landing
corepack pnpm check:landing
```

`check:landing`은 `_site/`의 필수 landing/docs/404/robots/sitemap/search/shared-shell/hero artifact,
GitHub Pages canonical URL, `/agentmux/` local link, path containment와 English/Korean product
content contract를 검사합니다. Theme/search/mobile-menu hook 또는 Session Operations/Project
Governance/Runtime Operations 핵심 용어가 없거나 Swiper, purplemux와 legacy mobile-primary
claim이 current home에 다시 들어오면 실패합니다.
Guide availability나 checker contract를 바꾸면 focused unit test를 함께 실행합니다.

```bash
corepack pnpm exec vitest run tests/unit/scripts/landing-site-check.test.ts
```

Public home/docs shell 변경은 Chromium에서 다음을 추가로 확인합니다.

- Desktop/mobile, Light/Dark에서 horizontal overflow와 blocking page error 0건
- Mobile menu와 docs drawer의 `aria-expanded`, `Esc` close
- Auto → Light → Dark 순환, resolved theme와 localStorage persistence
- Search dialog open, locale-scoped result, keyboard close와 trigger focus 복귀
- Docs sidebar active item 정확히 1개
- Hero image, quickstart, product proof, bento와 docs map의 순서와 text contrast

## npm 실행 package 게이트

Manifest, published file allowlist, build-only dependency와 Trusted Publishing workflow 계약을
먼저 검증합니다.

```bash
corepack pnpm exec vitest run tests/unit/scripts/npm-package-contract.test.ts tests/unit/scripts/npm-package-smoke-lib.test.ts tests/unit/scripts/release-workflow-contract.test.ts
```

실제 publish 후보는 repository build 뒤 tarball로 pack하고 빈 consumer project에 lifecycle
script를 허용해 설치합니다. 설치된 bin의 help와 격리 production server의 `/api/health`까지
통과해야 합니다.

```bash
corepack pnpm smoke:npm-package
npm publish --dry-run
```

최초 public publish는 인증된 maintainer가 수행합니다. 이후 tag publish는
`.github/workflows/npm-publish.yml`과 npm Trusted Publisher의 exact workflow 연결을 사용하며
`NPM_TOKEN`을 요구하지 않습니다. Local tarball 통과는 registry publish 증거가 아니므로
landing 활성화 전 `npm view`, exact registry version의 `npx help`, isolated server health를
다시 확인합니다.

브라우저 UI나 Playwright spec을 추가/수정한 환경에서 Chromium이 없으면 한 번 설치합니다.

```bash
corepack pnpm exec playwright install chromium
```

## 별도 Windows 배포 게이트

Windows package/updater 배포에서 중요한 smoke입니다. Sanitized evidence를 남길 directory를 먼저
지정합니다.

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
corepack pnpm audit:windows-platform
corepack pnpm smoke:runtime-v2:terminal-windows
corepack pnpm smoke:windows:preflight
corepack pnpm smoke:windows:codex-session
corepack pnpm smoke:windows:service-host
corepack pnpm smoke:windows:host-diagnostics
corepack pnpm smoke:windows:electron-env
corepack pnpm smoke:windows:electron-packaging
corepack pnpm smoke:windows:release-gate
```

패키지 산출물 검증:

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
corepack pnpm pack:electron
corepack pnpm smoke:windows:zip-artifact
corepack pnpm smoke:windows:update-metadata
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:packaged-runtime-v2
corepack pnpm smoke:windows:installer-install
corepack pnpm smoke:windows:installer-runtime-v2
```

`smoke:windows:updater-published-channel`은 설치나 update를 수행하지 않고 GitHub Releases channel을 read-only로 확인합니다. 실제 published update evidence는 설치된 앱보다 높은 버전의 published release가 있을 때 `smoke:windows:updater-published-install`로 확인합니다. Windows Electron updater는 외부 HTTPS 요청에 PowerShell `Invoke-WebRequest` executor를 사용하며, stale tasklist 항목이 baseline installer를 막을 때는 `CODEXMUX_WINDOWS_PUBLISHED_BASE_ZIP_PATH`와 `CODEXMUX_WINDOWS_UPDATER_PUBLISHED_GENERIC_FEED=1`로 실제 GitHub release asset apply를 검증할 수 있습니다. Local feed updater smoke는 isolated 짧은 설치 경로에서 `quitAndInstall` 이후 updater installer process settle과 post-update packaged launch까지 확인합니다.

Published channel 검증은 published latest보다 낮은 실제 installed/current version을 지정합니다.
Prerelease candidate를 검사할 때는 target tag도 고정합니다.

```powershell
$env:CODEXMUX_WINDOWS_UPDATER_CURRENT_VERSION = "<installed-version>"
$env:CODEXMUX_WINDOWS_UPDATER_PUBLISHED_INCLUDE_PRERELEASE = "1"
$env:CODEXMUX_WINDOWS_UPDATER_PUBLISHED_TAG = "v<target-version>"
corepack pnpm smoke:windows:updater-published-channel
```

Target tag를 지정하면 publish 시각상 더 최신인 다른 release가 있어도 해당 tag의 metadata와
asset만 평가합니다. Target이 없거나 prerelease 허용 조건과 맞지 않거나 tag semver와
`latest.yml.version`이 다르면 실패합니다.

Fresh Windows runner에서 local-feed와 package gate를 실행할 때는 현재 version보다 낮은 실제
installer를 지정합니다. Synthetic fallback은 release evidence로 인정하지 않습니다.

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:updater-local-feed
corepack pnpm smoke:windows:package-gate
```

Tag 기반 자동 릴리스는 `check` -> `browser reconnect` -> `fresh Windows package/release gate` ->
`prerelease` -> `target-tag published channel/install` -> `stable promotion` 순서입니다. Candidate
baseline tag와 SHA-256은 workflow에 명시하며 다음 버전을 준비할 때 직전 stable Windows
installer 값으로 갱신합니다. npm과 legacy macOS package는 Windows stable gate에 포함하지 않습니다.
Prerelease 게시 전에 실패하면 Release와 asset이 생기지 않고, 게시 뒤 실패하면 candidate가
prerelease로 남습니다.

2026-07-12 `v0.4.20`
(legacy [run 29161183240](https://github.com/HardcoreMonk/codexmux/actions/runs/29161183240))는
fresh Windows package/release gate와 실제 published updater 기능 경로를 최초
검증했습니다. 후속 재감사에서 published-updater JSON 2개가 privacy scanner에 실패해
privacy-safe evidence에서는 제외했습니다.

보존된 기준인 `v0.4.22`
(legacy [run 29219010240 attempt 3](https://github.com/HardcoreMonk/codexmux/actions/runs/29219010240))는
실제 `v0.4.21` installer를 baseline으로 package `394584ms`, packaged upload integrity
`11724ms`, local updater `240046ms`, release gate `17878ms`, exact target-tag published updater
`254840ms`를 통과했습니다. Baseline installer SHA-256은
`0e54fafe6465474e0092228a128755fdb04eba3698d8f2daf00327ad7bb24aaa`이며 tag commit은
`4af022090aa74ef3b2d7a01c9a8fd5bfe504f89a`입니다. Post-update packaged-launch artifact의
health는 `version=0.4.22`, `commit=4af0220`입니다. Stable release는 `latest.yml`, installer,
matching blockmap, Windows zip의 정확한 네 asset으로 검증했습니다. Browser/package/
published-updater artifact의 16개 JSON은 workflow scan 뒤 독립 privacy scan도 통과했습니다.
상세 근거는 [v0.4.22 Windows release handoff](operations/2026-07-13-v0.4.22-windows-release-handoff.md)를
따릅니다.

## Pre-auth bootstrap 보안

Unit/static gate:

```bash
corepack pnpm exec vitest run tests/unit/lib/config-store.test.ts tests/unit/lib/auth-credentials.test.ts tests/unit/lib/bootstrap-state.test.ts tests/unit/lib/request-authority.test.ts tests/unit/lib/bootstrap-request-guard.test.ts tests/unit/lib/access-filter.test.ts tests/unit/lib/server-bootstrap.test.ts tests/unit/lib/install-request-auth.test.ts tests/unit/lib/install-server.test.ts tests/unit/lib/runtime/server-ws-upgrade.test.ts tests/unit/pages/auth-setup.test.ts tests/unit/pages/auth-preflight.test.ts tests/unit/scripts/setup-origin-contract.test.ts tests/unit/proxy-config.test.ts
```

Live gate는 isolated HOME과 scrubbed env를 사용하며 dev/prod를 같은 공격 시나리오로
검증합니다. Production evidence는 같은 source에서 build한 직후 실행해야 합니다.

```bash
CODEXMUX_PREAUTH_SMOKE_MODE=development corepack pnpm smoke:pre-auth-bootstrap
corepack pnpm build
CODEXMUX_PREAUTH_SMOKE_MODE=production corepack pnpm smoke:pre-auth-bootstrap
```

검증 범위는 setup loopback bind, public Host, attacker/missing authority, non-JSON POST,
INIT session, install admission/65,537-byte frame/slot recovery/setup lease, configured restart,
malformed/hash-only config bytes 보존, stale auth/latch env, 실제 port-file fallback입니다.
Production은 locale-less `/_next/data`가 login redirect-only payload만 반환하는지, dynamic route
parameter가 auth를 우회하지 않는지, authenticated absolute-form unknown WebSocket이 attacker
destination을 선택하지 못하는지도 확인합니다.
Root에서는 no-INIT setup-open startup 거절을 먼저 확인하고 INIT 흐름으로 계속합니다.

## 동일 hostname 제품 공존

Browser cookie는 port를 구분하지 않습니다. agentmux(이전 이름 Codexmux)와 Purplemux 같은 sibling app을 같은
hostname의 다른 port에서 실행하는 회귀는 cookie 이름과 실제 Chromium 두 계층에서 확인합니다.

```bash
corepack pnpm exec vitest run tests/unit/lib/auth.test.ts tests/unit/lib/upload-request-auth.test.ts tests/unit/lib/install-request-auth.test.ts tests/unit/lib/runtime/api-auth.test.ts
corepack pnpm smoke:browser-reconnect
```

Unit gate는 `agentmux-session-token`과 legacy 호환 `codexmux-session-token`만 agentmux 인증에 사용하고 legacy `session-token`만 있는
request는 거부하며, 두 cookie가 함께 있으면 새 cookie를 선택하는지 확인합니다. Runtime v2
HTTP/WebSocket query에는 새 이름과 legacy 이름 모두 credential로 전달할 수 없습니다.
Chromium smoke는 agentmux login cookie를 넣은 뒤 같은 hostname에 legacy cookie를 추가하고,
두 cookie 공존 상태에서 page 인증과 terminal WebSocket recovery가 유지되는지 확인합니다.
`v0.4.22` 업데이트 전 browser session은 새 namespace가 없으므로 첫 요청에서 login으로 이동하는 것이
정상이며, 한 번 재로그인한 뒤에는 기존 tmux/runtime session에 다시 접근할 수 있어야 합니다.
Legacy cookie가 이전 이름 Codexmux JWT라 Purplemux가 계속 `401`이면 Purplemux에도 한 번 로그인한
뒤 두 앱을 다시 확인합니다. `v0.4.22` Windows updater smoke는 fresh HOME/profile을 사용하므로
실제 기존 Electron profile의 legacy cookie, 1회 재로그인과 재연결을 검증하지 않습니다. 이
old-profile 경로가 통과하기 전까지 ADR-029는 `Implemented`입니다.

게이트 분류:

- Linux-required: dev/prod pre-auth smoke와 setup-local install PTY.
- GUI-dependent: browser reconnect와 Electron runtime smoke. Chromium/display가 없으면 제한을 기록합니다.
- Windows-runner-only fresh gate: preflight, host diagnostics, freshly built packaged launch. 기존 완료 증거는 `WINDOWS-ONLY-GAP-AUDIT.md`에 유지하지만 현재 Linux run의 `skipped`를 새 Windows 증거로 대체하지 않습니다.

## Production dependency와 upload integrity

Dependency gate는 advisory ignore 없이 실행합니다.

```bash
corepack pnpm audit --prod
```

Upload unit/integration과 process-isolated memory gate:

```bash
corepack pnpm exec vitest run tests/unit/lib/upload-request-contract.test.ts tests/unit/lib/upload-request-auth.test.ts tests/unit/lib/upload-admission.test.ts tests/unit/lib/uploads-store.test.ts tests/unit/lib/upload-server.test.ts tests/unit/lib/server-http-dispatcher.test.ts tests/integration/upload-http-ingress.test.ts tests/unit/scripts/check-upload-stream-memory.test.ts tests/unit/scripts/upload-integrity-smoke-lib.test.ts
corepack pnpm check:upload-memory
```

`check:upload-memory`는 50MiB body를 별도 client process에서 64KiB backpressure write로
보냅니다. Bare HTTP control, 같은 production UploadServer/storage 경로의 retaining negative,
production positive 3회를 각각 새 process로 실행합니다. `--expose-gc`는 tsx CLI entrypoint 뒤에
두어야 합니다. Negative는 16MiB 이상 증가해야 하고 positive는 모두 16MiB 미만이어야 하며,
size와 SHA-256도 일치해야 합니다.

Live gate는 isolated `HOME`/`USERPROFILE`과 scrubbed auth env를 사용합니다.

```bash
CODEXMUX_UPLOAD_SMOKE_MODE=development corepack pnpm smoke:upload-integrity
corepack pnpm build
CODEXMUX_UPLOAD_SMOKE_MODE=production corepack pnpm smoke:upload-integrity
```

두 mode 모두 session/CLI/Origin, Expect와 raw framing, Chromium 10MiB/50MiB exact 및 +1,
11MiB/37MiB SHA parity, 8-active/200MiB admission, idle/abort/manual cleanup, removed Pages route,
Next large-body warning 부재, shutdown cleanup, kill switch를 12개 check로 검증합니다.

Fresh Windows package는 Linux 결과로 대체하지 않습니다.

```powershell
corepack pnpm pack:electron
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\agentmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\agentmux-Setup-<previous-version>.exe"
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:package-gate
```

Windows upload gate는 실제 packaged exe와 fresh user tree에서 size/SHA/same-directory commit,
abort 전에 reserved stage 실재, abort unlink, aged stage cleanup, committed `.part` 보존, 같은 exe의
kill-switch restart를 확인합니다. Non-Windows의 `{ skipped: true }`는 실행 증거가 아닙니다.
`v0.4.20` release workflow에서 이 exact check가 최초 통과했고 `v0.4.21`과 `v0.4.22`에서
privacy gate와 함께 반복 통과했습니다. `v0.4.22` packaged upload integrity는 `11724ms`,
package gate는 `394584ms`였습니다. ADR-027과 ADR-028은 `Verified`입니다.

## 런타임 v2

Runtime v2 검증:

```bash
corepack pnpm smoke:runtime-v2
corepack pnpm smoke:runtime-v2:phase2
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm smoke:governance:scaffold
corepack pnpm smoke:runtime-v2:storage-dry-run
corepack pnpm smoke:runtime-v2:storage-write
corepack pnpm smoke:runtime-v2:storage-default-read
corepack pnpm smoke:runtime-v2:timeline-shadow
corepack pnpm smoke:runtime-v2:timeline-websocket-default
corepack pnpm smoke:runtime-v2:status-shadow
corepack pnpm smoke:runtime-v2:status-default
```

Runtime v2 smoke는 같은 checkout에서 병렬 실행하면 dev lock, temp HOME, runtime DB, device/WebSocket target이 충돌할 수 있습니다. Terminal/package/Android device smoke는 단독 실행을 기준으로 합니다.

## Session Operations와 Project Governance

Release-candidate gate:

```bash
corepack pnpm build:server
corepack pnpm smoke:runtime-v2
corepack pnpm smoke:runtime-v2:storage-backup
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm perf:session-catalog
corepack pnpm smoke:linux:session-governance
corepack pnpm smoke:browser:session-governance
corepack pnpm smoke:npm-package
```

`perf:session-catalog`는 기본 5,000-session fixture에서 initial index, incremental append, FTS query,
2,500-ID annotation-filter query, replay projection과 RSS delta를 측정합니다. 현재 fail threshold는
각각 30초, 500ms, 1초, 1초, 200ms, 512MiB입니다. Annotation 측정은 exact filtered count도 함께
검증합니다. 측정 DB는 명시한 `CODEXMUX_SESSION_CATALOG_PERF_DB`가 없으면 임시 디렉터리에 만들고
종료 시 삭제합니다.

`smoke:linux:session-governance`는 격리 `HOME`과 실제 custom server/tmux를 사용해 다음을 확인합니다.

- Session Catalog rebuild/search/replay와 annotation
- Approved Project Root preview/confirm, `projects.yaml` import와 read-only governance
- project/Codex 원본 tree의 hash/metadata 무변경
- runtime/catalog/governance SQLite private mode
- Timeline/Governance Worker DB quarantine와 worker 자동 복구
- projection rollback 전후 동일 terminal session 연결

`smoke:governance:scaffold`는 gate-on 격리 server와 temporary Approved Project Root에서
invalid UTF-8/NUL/marker-like adoption conflict, first-pass discovery, selective re-preview,
LF/CRLF exact-prefix adoption, stale adoption preview, adopted marker update, latest-first rollback,
multi-file create, exact preimage rollback, `0700/0600` action backup과 선택 밖 project/Codex source
무변경을 확인합니다. 실제 등록 project나 live service를 변경하지 않습니다. Cold Next startup이
느린 환경은 `CODEXMUX_GOVERNED_SCAFFOLD_TIMEOUT_MS`로 bounded timeout을 조정합니다.

`smoke:browser:session-governance`는 한국어와 영어를 각각 격리 서버에서 실행해 SSR `lang`,
search/replay, keyboard focus, governance degraded→recovery, gate-off Scaffold panel과 hydration
error 부재를 확인합니다. Gate-on flow에서는 unmarked artifact checkbox가 기본 unchecked인지,
개별 선택 뒤 re-preview에서 exact-title confirmation과 semantic warning이 나타나는지, unchecked
file이 유지되는지도 확인합니다. `CODEXMUX_SESSION_GOVERNANCE_BROWSER_SCOPE=gate|adoption`으로
부분 재검증할 수 있습니다. Chromium이 없으면 먼저 다음 명령을 실행합니다.

Lifecycle evidence bound를 바꾸면 201개 응답 허용과 2,001개 거부를 포함한 Governance
contract/IPC/worker test를 함께 실행합니다.

```bash
corepack pnpm exec vitest run \
  tests/unit/lib/governance/contracts.test.ts \
  tests/unit/lib/runtime/ipc.test.ts \
  tests/unit/lib/runtime/governance-worker-service.test.ts
```

```bash
corepack pnpm exec playwright install chromium
```

Projection 복구와 durable state 복구를 구분합니다. `session-catalog/index.db`와 `governance/index.db`는 quarantine 뒤 rebuild/refresh하고, `runtime-v2/state.db`는 다음 backup gate와 `DATA-DIR.md`의 세 파일 단위 restore 절차를 사용합니다.

```bash
corepack pnpm smoke:runtime-v2:storage-backup
```

2026-08-21 governed scaffold release-candidate에서 full suite는 1,629 passed, 3 skipped였고
production build, scaffold/Linux/browser governance smoke, storage backup과 Runtime v2 Phase 6
gate를 통과했습니다. 이전 Session Operations/Governance의 5,000-session performance와 npm
tarball smoke 근거도 유지합니다.
Phase 3 build commit `9d32d049` 당시 live user service는 `AGENTMUX_GOVERNANCE_WRITES=1`(legacy `CODEXMUX_GOVERNANCE_WRITES=1` 호환), Governance
`writeState=ready`, private Runtime v2 backup, scaffold 7-check, Linux 10-check, 한국어/영어 browser와
post-restart Phase 6 12-check gate를 통과했습니다. 2026-08-22에는 실제 `agentmux`(이전 이름 `codexmux`) Managed
Project에서 unmarked `AGENTS.md`를 2-pass preview, exact confirm, latest-first rollback해 원본
SHA-256과 Git clean 복구 및 private `0600` preimage를 확인했습니다.

2026-08-21 governed unmarked adoption source release에서는 full suite `1,650 passed, 3 skipped`,
typecheck, project-design check와 lint 0 error를 통과했습니다. Live checkout의 `.next/dist`를 보호하기
위해 source를 `/tmp` mirror로 복사하고 `node_modules`를 hard-link copy한 뒤 production build,
adoption/scaffold 13-check와 한국어·영어 browser 4-check를 실행했습니다. Linux session/governance
10-check는 원래 process-recycle 전제인 development mode mirror에서, storage backup private-mode
smoke는 같은 mirror에서 통과했습니다. Live 8122의 Phase 6 12-check는 read-only로 통과했지만
adoption source는 이후 별도 승인 배포에서 live app build `f46410b4`로 전환됐습니다. 같은
service에서 Session Catalog 실제 rebuild/search/replay/annotation과 301초·11회 동일 세션
재연결을 확인하고 사후 Runtime v2 10-check와 Phase 6 12-check를 통과했습니다.

2026-08-23 Navigation Selection Clarity release에서는 full suite 270 files/1,689 tests가 통과했고
1 file/3 tests는 skip됐습니다. Production build `a6a49588`, service PID `88057`, live
terminal/reconnect 10-check, Phase 6 12-check, Governance lifecycle 236-evidence HTTP 200과 실제
desktop/mobile current/selection browser gate를 확인했습니다.

## 브라우저 UI와 Playwright

Playwright는 UI 회귀와 smoke 자동화에 사용합니다.

검증 기준:

- blocking console error 0건
- terminal attach/reconnect 정상
- workspace/layout stale state 없음
- text overflow와 겹침 없음
- auth 전 public route에서 status/Web Push/service worker noise 없음

프론트엔드 변경 뒤에는 실제 browser screenshot 또는 Playwright 확인을 남깁니다.

Session/Governance navigation smoke는 isolated HOME과 synthetic fixture를 사용해 한국어·영어의
desktop/mobile 탐색과 선택 상태도 검증합니다.

```bash
corepack pnpm smoke:browser:session-governance
```

검증 범위:

- `/`, `/sessions`, `/governance`의 core current area 정확히 1개
- Reports/Stats/custom webview 같은 utility surface의 core current area 0개
- Legacy `sidebar-tab=sessions`의 Activity hydration
- Desktop expanded/40px rail의 label, indicator와 focus target
- Mobile 48px bottom navigation, route header와 non-workspace tab bar 미렌더링
- Navigation sheet utility action 최소 44px
- Session result와 Managed Project의 `aria-selected` 및 persistent marker
- Console/page/hydration error 0건

`CODEXMUX_SMOKE_ARTIFACT_DIR`를 지정하면 synthetic navigation 영역만 한국어·영어,
desktop/mobile, dark/light PNG로 저장합니다. Cookie, token, 실제 terminal content와 사용자 path는
artifact에 포함하지 않습니다.

Live 배포 뒤에는 isolated smoke만으로 끝내지 않고 authenticated production origin에서 세 core
route의 current count, Governance selected project, mobile 48px target과 console error 0건을 다시
확인합니다.

## Electron

Electron 검증은 Linux development smoke와 Windows packaged smoke를 분리합니다.

```bash
corepack pnpm vitest run tests/unit/electron/app-server-protocol.test.ts
corepack pnpm build:electron:main
corepack pnpm build:electron
xvfb-run -a corepack pnpm smoke:electron:runtime-v2
```

`smoke:electron:attach`는 server를 시작하지 않습니다. 별도로 실행 중인 target을 명시한
경우에만 사용합니다.

```bash
CODEXMUX_ELECTRON_SMOKE_URL=http://127.0.0.1:8122 \
xvfb-run -a corepack pnpm smoke:electron:attach
```

Windows에서는 별도 packaged/installer 경로를 사용합니다.

```powershell
corepack pnpm smoke:windows:electron-env
corepack pnpm smoke:windows:electron-packaging
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:packaged-runtime-v2
corepack pnpm smoke:windows:installer-install
corepack pnpm smoke:windows:installer-runtime-v2
```

`pack:electron:mac` 계열 명령은 legacy/manual path입니다. Linux engine 또는 Windows
package release blocker로 사용하지 않습니다.

App-server protocol 변경 기준:

- remote URL은 `http://`와 `https://`만 허용
- scheme 없는 remote URL은 `http://`로 정규화
- invalid persisted remote config는 local mode로 fallback
- local server URL/label은 active port에서 생성

## Android 참고 검증

Android는 Linux engine에 접속하는 선택 client입니다. Linux engine release gate를 대체하지
않고 mobile regression 확인이 필요할 때 사용합니다.

```bash
corepack pnpm android:sync
corepack pnpm android:build:debug
corepack pnpm android:install
corepack pnpm smoke:android:install
corepack pnpm smoke:android:foreground
corepack pnpm smoke:android:recovery
corepack pnpm smoke:android:runtime-v2
corepack pnpm smoke:android:timeline-foreground
```

Android device smoke는 WebView DevTools, ADB, Tailscale target을 사용하므로 다른 device smoke와 병렬 실행하지 않습니다.

## 권한, 통계, 타임라인

Permission/input prompt 변경:

```bash
corepack pnpm smoke:permission
```

Approval audit 변경:

```bash
corepack pnpm vitest run tests/unit/lib/approval-audit-store.test.ts tests/unit/pages/approval-audit-api.test.ts
```

검증 기준:

- selection/options/fallback audit은 raw prompt, session name, command preview를 저장하지 않음
- `needs-input` Web Push 결과는 `push-sent`, `push-failed`, `push-skipped-empty`, `push-skipped-visible` enum으로만 기록
- raw push payload, subscription endpoint, command/file detail은 durable audit에 저장하지 않음

Mobile lock-screen approval copy 변경:

```bash
corepack pnpm vitest run tests/unit/lib/approval-queue.test.ts tests/unit/lib/notification-copy.test.ts
```

검증 기준:

- 기본/미지원 locale은 한국어 title로 fallback
- 영어 locale은 기존 `Input Required`, `Task Complete`, `Command approval` 문구 유지
- approval metadata detail은 기존 sanitized helper 결과만 사용

Provider registry contract 변경:

```bash
corepack pnpm vitest run tests/unit/lib/providers.test.ts
```

검증 기준:

- Codex provider contract 위반 없음
- invalid provider id, empty display name, invalid panel type 감지
- duplicate provider id와 duplicate panel type 감지

Codex launch/resume command 또는 hook override 변경:

```bash
corepack pnpm exec vitest run tests/unit/lib/codex-command.test.ts tests/unit/lib/providers/codex-session-hooks.test.ts tests/unit/lib/agent-launch-service.test.ts tests/unit/lib/hook-settings.test.ts tests/unit/lib/status-hook-bridge.test.ts
corepack pnpm smoke:codex-session-hooks
```

검증 기준:

- command builder가 `hooks={path=...}`를 생성하지 않음
- browser는 launch intent만 만들고 server가 layout/process/version을 검증함
- `SessionStart`, `UserPromptSubmit`, `Stop`이 POSIX/Windows command로 `status-hook.cjs`를 호출함
- HMAC capability와 현재 layout의 tab/session ownership이 일치해야 event가 적용됨
- bridge가 bounded/non-blocking이고 Codex strict config parser가 override를 정상 load함
- minimum supported `0.144.1` fixture와 current CLI strict-config smoke를 확인함

Rate-limit과 rich timeline 변경:

```bash
corepack pnpm exec vitest run tests/unit/lib/codex-rate-limits.test.ts tests/unit/lib/codex-jsonl-state.test.ts tests/unit/lib/rate-limit-view.test.ts
corepack pnpm exec vitest run tests/unit/lib/codex-session-parser.test.ts tests/unit/lib/rich-timeline-presentation.test.ts tests/unit/lib/timeline-preview.test.ts tests/unit/lib/timeline-entry-dedupe.test.ts
```

검증 기준:

- 기존 256KiB JSONL tail에서 상태와 최신 window별 rate-limit 관찰을 함께 추출함
- reset 이후 새 관찰이 없으면 0%를 합성하지 않고 stale view를 반환함
- semantic timeline entry가 deterministic ID와 generic fallback을 유지함
- semantic entry의 icon/label/summary/meta/status projection이 parser와 분리된 pure helper에서 고정됨
- secret-like redaction, field 4KiB, entry 16KiB 상한을 넘지 않음

Terminal/UI 회귀와 Git refresh 변경:

```bash
corepack pnpm exec vitest run tests/unit/lib/terminal-key-event.test.ts tests/unit/lib/clipboard.test.ts tests/unit/lib/timeline-spacer.test.ts tests/unit/hooks/use-git-refresh-generation.test.ts tests/unit/lib/git-refresh-generation.test.ts
```

검증 기준:

- IME composition은 xterm에 위임하고 clipboard fallback은 임시 DOM을 정리함
- timeline spacer는 resize/visibility/focus/pageshow 복귀 뒤 안전 범위로 축소됨
- Stop sequence는 matching session만 invalidate하고 inactive tab은 선택 시 한 번 fetch함
- Git generation consume은 session별로 추적되어 hook instance가 다른 tab으로 전환돼도 generation을 누락하지 않음

Playwright가 host distribution용 bundled Chromium을 제공하지 않지만 system Chrome이 있는
환경에서는 다음처럼 browser smoke 실행 파일을 명시할 수 있습니다.

```bash
CODEXMUX_PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/google-chrome corepack pnpm smoke:browser-reconnect
```

Codex web input 제출 변경:

```bash
corepack pnpm vitest run tests/unit/hooks/use-web-input.test.ts
```

검증 기준:

- 단일 줄과 여러 줄 prompt 모두 bracketed paste frame으로 전송
- 제출 Enter가 같은 frame에 포함됨
- Codex CLI 확인 흐름을 위한 후속 Enter가 예약됨

Status Web Push payload 변경:

```bash
corepack pnpm vitest run tests/unit/lib/status-web-push-payload.test.ts
```

검증 기준:

- approval payload는 sanitized metadata projection만 포함
- review completion payload에는 approval field 미포함
- locale title/body와 silent flag 유지

Status JSONL scan helper 변경:

```bash
corepack pnpm vitest run tests/unit/lib/status-jsonl-scan.test.ts
```

검증 기준:

- assistant text와 tool action summary 추출 유지
- 새 user message 뒤에는 assistant metadata reset
- interrupt marker와 stale threshold 판단 유지

통계와 timeline 변경은 다음을 확인합니다.

- JSONL incremental parser가 중복 계산하지 않음
- session index cache가 stale 결과를 오래 유지하지 않고, cold refresh 중 session list request가 전체 scan을 기다리지 않음
- timeline entry id와 dedupe가 reconnect 후 안정적임
- prompt, terminal output, JSONL path가 debug endpoint에 노출되지 않음

Session index/session list 변경:

```bash
corepack pnpm vitest run tests/unit/lib/session-index.test.ts tests/unit/lib/session-list.test.ts tests/unit/pages/timeline-sessions.test.ts
```

검증 기준:

- persisted index write는 내용 변경이 없으면 skip
- cold index refresh 중 session list page는 현재 snapshot과 `refreshing` 상태를 반환
- runtime/legacy timeline session API는 같은 page contract를 유지

Timeline init meta helper 변경:

```bash
corepack pnpm vitest run tests/unit/lib/timeline-init-meta.test.ts
```

검증 기준:

- user/assistant count와 latest timestamp 유지
- first timestamp override와 custom title 유지

Timeline JSONL perf snapshot 변경:

```bash
corepack pnpm vitest run tests/unit/lib/timeline-jsonl-perf-snapshot.test.ts
corepack pnpm perf:timeline-jsonl -- --synthetic-turns 3
```

검증 기준:

- 작은 synthetic timeline은 `not-needed`로 분류
- entry count, parse duration, byte size 기준 초과 시 `recommended`와 reasons 반환
- snapshot에 prompt/body text와 입력 JSONL path 미포함

Codex CLI JSONL parser fixture 변경:

```bash
corepack pnpm vitest run tests/unit/lib/codex-session-parser.test.ts
```

검증 기준:

- legacy event-message fixture가 user/assistant message로 읽힘
- `codex-cli 0.128.0` response_item/event_msg 혼합 fixture가 message, reasoning, tool call/result로 읽힘
- image wrapper가 event user message와 중복 출력되지 않음

Codex resume 실패 분류 변경:

```bash
corepack pnpm vitest run tests/unit/lib/codex-resume-failure.test.ts
```

검증 기준:

- terminal process unknown과 process-running을 다른 code로 분류
- invalid session id는 non-recoverable로 분류
- send-key 실패 message에는 raw command, cwd, JSONL path 미포함

Codex state SQLite read-only probe 변경:

```bash
corepack pnpm vitest run tests/unit/lib/codex-state-sqlite-indexer.test.ts
```

검증 기준:

- Codex dir이 없으면 SQLite opener를 호출하지 않음
- `state_*.sqlite`만 열고 WAL/SHM이나 다른 SQLite 파일은 제외
- SQLite open 옵션이 `readonly`와 `fileMustExist`로 고정됨
- 반환 summary에 row content가 포함되지 않음

## Live deploy와 운영

Linux 단일 엔진 service 운영에서는 다음 명령을 사용합니다.

```bash
corepack pnpm deploy:local
curl -fsS http://127.0.0.1:8122/api/health
```

`deploy:local`은 `pnpm install --frozen-lockfile`, `tsc --noEmit -p tsconfig.deploy-check.json` 순으로 먼저 검사하고(build 전에는 생성된 `.next/types`가 오래됐을 수 있어 제외), 통과하면 `.next`(`cache/`, `dev/` 제외)와 `dist`를 `.deploy-backup/`에 snapshot한 뒤 `pnpm build`를 실행합니다. build가 실패하면 snapshot을 복원하고 service를 restart하지 않으며, 성공했을 때만 `systemctl --user restart`와 health 확인을 진행합니다.

Session Operations/Project Governance 배포에서는 위 Linux/browser gate와 worker health를
먼저 확인합니다. 실제 service restart는 별도 운영 승인과, 기존 durable DB가 있으면 runtime
state backup 뒤 실행합니다. 2026-08-21 최초 live 배포는 기존 DB가 없는 상태에서 unit을
등록한 뒤 restart 전후 terminal smoke와 Phase 6 gate를 통과했습니다. Windows
installer/package/update smoke는 별도 배포면의 증거이며 Linux engine gate를 대체하지
않습니다.

## Smoke artifact 기준

Smoke artifact에는 원문 로그 대신 bounded, sanitized structured projection만 저장합니다.

```bash
corepack pnpm check:smoke-artifacts -- <artifact-directory>
```

Release workflow의 browser, Windows package, published updater job은 artifact upload 전에 이
검사를 실행합니다. JSON이 없거나 파싱할 수 없거나 금지 key, URL, Codex session path,
Linux/Windows smoke temp path, terminal escape가 남아 있으면 upload와 후속 stable 승격을
중단합니다. 실패 출력은 raw value 대신 artifact basename, JSON path와 위반 label만
포함합니다.

대표 허용 항목:

- smoke/check id와 package script
- pass/fail, blocker label과 check 목록
- duration, exit code, signal과 timeout 여부
- product version, commit과 build time
- non-sensitive count, mode와 artifact basename
- sanitized error label

금지:

- child stdout/stderr 전체
- terminal output tail
- temp HOME path
- Codex session id
- JSONL path
- token
- target URL
- prompt content
