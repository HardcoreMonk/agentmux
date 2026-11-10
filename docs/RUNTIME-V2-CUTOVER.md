# 런타임 v2 프로덕션 전환 기준

Runtime v2는 terminal, storage, timeline, status, governance를 worker boundary로 분리하는
Linux 단일 엔진의 실행 기반입니다. Windows terminal adapter와 package gate는 이 구조의
별도 배포면으로 보존합니다.

## 현재 상태

- Terminal Worker와 adapter factory가 존재합니다.
- Windows terminal adapter는 node-pty/ConPTY 기반 create/attach/write/resize/detach/kill smoke를 통과했습니다.
- Storage Worker는 SQLite projection을 사용합니다.
- Timeline Worker와 Status Worker는 surface별 mode와 rollback path를 가집니다.
- Timeline Worker는 Session Catalog read/watch/index를, Governance Worker는 승인 project의
  read-only Knowledge Index와 lifecycle/check/audit projection을 소유합니다.
- Linux Session Operations/Governance gate와 Phase 6 default gate가 active runtime release
  기준입니다. Windows release/package gate는 Windows 배포면을 변경할 때만 추가합니다.
- `0.4.16` 기준 packaged/installed/rollback Phase 6 증거는 완료되었습니다.
- `v0.4.20` fresh Windows package/release gate는 packaged upload integrity를 포함해 최초
  통과했고, `v0.4.21`은 privacy-safe evidence를 재검증했습니다. `v0.4.22`는 실제
  `v0.4.21 -> v0.4.22` updater, packaged Runtime v2와 세 artifact privacy gate를 반복했습니다.
- ADR-027과 ADR-028은 `Verified`이며 완료 근거는
  `docs/operations/2026-07-13-v0.4.22-windows-release-handoff.md`에 있습니다.
- 이 updater evidence는 fresh profile을 사용하므로 cookie namespace 전환 뒤 기존 Runtime v2
  session 재연결을 입증하지 않습니다. 그 조건이 남아 있어 ADR-029는 `Implemented`입니다.
- 2026-08-21 초기 통합 commit `d405f683`, Phase 3 build `9d32d049`와 adoption build
  `f46410b4`를 Linux user service에 배포해 restart 전후 terminal/scaffold/governance smoke와
  Phase 6 gate를 통과했습니다. 2026-08-22에는 같은 session의 301초·11회 재연결과 매 round
  worker health, 사후 terminal 10-check와 Phase 6 12-check를 통과해 ADR-031은 `Verified`입니다.
- 2026-08-23 navigation/hotfix build `a6a49588`을 배포했습니다. 등록 project의 lifecycle evidence
  236개가 2,000개 IPC bound 안에서 응답하고, live terminal/reconnect 10-check, Phase 6 12-check와
  desktop/mobile navigation browser gate를 통과했습니다.

아래 단계는 미착수 backlog가 아니라 구현 순서와 rollback runbook을 보존한 기록입니다.

## 전환 규칙

- Public browser-facing URL은 가능한 유지합니다.
- Surface별 mode를 분리해 작은 rollback이 가능해야 합니다.
- 잘못된 명시 env 값은 fail closed해야 합니다.
- Runtime v2가 꺼져도 legacy JSON/tmux path가 rollback으로 동작해야 합니다.
- Linux tmux adapter는 active terminal runtime이므로 별도 approved adapter migration 없이
  삭제하지 않습니다.

## 기능 플래그

| 환경 변수 | 값 | 의미 |
| --- | --- | --- |
| `CODEXMUX_RUNTIME_V2` | `1` | runtime v2 활성 |
| `CODEXMUX_RUNTIME_TERMINAL_V2_MODE` | `off`, `opt-in`, `new-tabs`, `default` | terminal surface 전환. runtime v2 활성 상태의 unset 기본값은 `new-tabs` |
| `CODEXMUX_RUNTIME_STORAGE_V2_MODE` | `off`, `shadow`, `write`, `default` | storage surface 전환. runtime v2 활성 상태의 unset 기본값은 `default` |
| `CODEXMUX_RUNTIME_TIMELINE_V2_MODE` | `off`, `shadow`, `default` | timeline surface 전환. runtime v2 활성 상태의 unset 기본값은 `default` |
| `CODEXMUX_RUNTIME_STATUS_V2_MODE` | `off`, `shadow`, `default` | status surface 전환. runtime v2 활성 상태의 unset 기본값은 `default` |
| `CODEXMUX_SESSION_CATALOG_MODE` | `off`, `shadow`, `default` | Session Catalog serving 전환. unset 기본값은 `shadow`, live service는 `default` |
| `CODEXMUX_RUNTIME_TERMINAL_ADAPTER` | `tmux`, `windows` | terminal infrastructure adapter |
| `CODEXMUX_PROCESS_INSPECTOR_ADAPTER` | `posix`, `windows` | process inspector adapter |

## 0단계: 동등성 목록화

목표는 기존 behavior surface를 표로 고정하는 것입니다.

- workspace/layout CRUD
- terminal create/attach/write/resize/detach/kill
- timeline session list, entries, live append
- status polling, prompt detection, notification
- sync invalidation
- rollback command

증거는 `RUNTIME-V2-PARITY.md`에 둡니다.

## 1단계: Shadow 런타임

Worker process와 typed IPC를 도입하되 production read/write path는 바꾸지 않습니다.

검증:

```bash
corepack pnpm test
corepack pnpm smoke:runtime-v2
```

## 2단계: 새 tab용 터미널 v2

새 plain terminal tab만 runtime v2로 생성합니다. 기존 legacy tab은 유지합니다.

### Agent 탭은 legacy tmux adapter로 생성 (2026-11-10)

Codex 같은 agent 탭은 Runtime v2 agent 지원이 생길 때까지 terminal mode(`new-tabs`, `default` 포함)와
관계없이 legacy tmux adapter(Runtime v1, `pt-…` session)로 만듭니다. Runtime v2로 만드는 탭은 plain
terminal 요청뿐입니다. `src/pages/api/layout/pane/[paneId]/tabs/index.ts`의 `isPlainTerminalTabRequest`가
판정하며, `panelType`이 없거나 `terminal`이고 `command`와 `resumeSessionId`가 없는 요청만 해당합니다.
`panelType`은 먼저 `normalizePanelType`으로 정규화하므로 등록되지 않은 종류는 `terminal`로 저장됩니다.

이유: agent 기능 대부분이 legacy tmux socket과 `pt-` 이름만 봅니다. Runtime v2(`rtv2-…`)로 만든 Codex
탭에서는 다음이 동작하지 않았습니다(plan-eng-review에서 코드와 live log로 확인).

- hook 인증: `parseSessionName`이 `pt-` 이름만 받아 v2 session의 status hook을 거절합니다. Live log에
  `rejected status hook target`이 남았습니다.
- 상태 감시: `getAllPanesInfo`가 legacy socket만 나열합니다.
- timeline: `getSessionPanePid`가 v2 pane을 찾지 못합니다.
- storage 조회: `getReadyTerminalTabBySession`이 `panel_type = 'terminal'` 행만 찾아 실행 입력과 화면
  캡처가 막힙니다.
- 권한 요청 카드: 화면 캡처와 key 입력도 legacy socket만 씁니다.

이미 만들어진 v2 agent 탭은 그대로 둡니다(2026-11-10 live layout에는 없음). Runtime v2 agent 지원(hook
인증, 상태 감시, timeline process 찾기, storage `panel_type` 구분, 화면 캡처와 key 입력)은 Claude Code
provider 설계 범위 밖의 후속 작업입니다. 결정 근거는
`superpowers/specs/2026-11-10-claude-code-provider-design.md` 1절과
`superpowers/reviews/2026-11-10-claude-code-provider-phase1-eng-review.md` #1이며, ADR-037 후보(Draft)입니다.
회귀 test는 `tests/unit/pages/layout-tabs-api.test.ts`입니다.

검증:

```bash
corepack pnpm smoke:runtime-v2:phase2
corepack pnpm smoke:runtime-v2:terminal-windows
```

Rollback:

```text
CODEXMUX_RUNTIME_TERMINAL_V2_MODE=off
```

## 3단계: Storage v2 shadow/default 전환

Legacy JSON write 뒤 SQLite projection을 mirror하고, default mode에서 SQLite read를 우선합니다.

검증:

```bash
corepack pnpm smoke:runtime-v2:storage-dry-run
corepack pnpm smoke:runtime-v2:storage-write
corepack pnpm smoke:runtime-v2:storage-default-read
```

Rollback:

```text
CODEXMUX_RUNTIME_STORAGE_V2_MODE=off
```

## 4단계: Timeline v2 WebSocket 전환

기존 `/api/timeline` URL을 유지하고 backend를 Timeline Worker로 전환합니다.

검증:

```bash
corepack pnpm smoke:runtime-v2:timeline-shadow
corepack pnpm smoke:runtime-v2:timeline-websocket-default
```

Rollback:

```text
CODEXMUX_RUNTIME_TIMELINE_V2_MODE=off
```

## 5단계: Status v2 전환

Status Worker가 polling, JSONL watch, hook application, notification side effect를 소유합니다.

검증:

```bash
corepack pnpm smoke:runtime-v2:status-shadow
corepack pnpm smoke:runtime-v2:status-default
```

Rollback:

```text
CODEXMUX_RUNTIME_STATUS_V2_MODE=off
```

## 6단계: 기본 런타임 v2

`CODEXMUX_RUNTIME_V2=1`만 있어도 unset surface mode는 accepted default로 해석합니다.

검증:

```bash
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm smoke:windows:release-gate
```

Rollback dry-run:

```bash
corepack pnpm lifecycle:rollback-dry-run
```

이 명령은 파일을 변경하지 않고 `rollbackEnv`에 runtime v2 surface를 끄는 환경 값을
구조화해서 출력합니다. 실제 service 재시작과 live rollback evidence는 별도
운영 drill에서 남깁니다.

## Linux Session Operations와 Governance 확장

Phase 6 위에 다음 ownership을 추가합니다.

- Timeline Worker: Codex JSONL read/watch와 Session Catalog projection
- Storage Worker: annotation, saved filter, Approved Project Root와 Managed Project durable state
- Governance Worker: 승인 project read, Knowledge Index와 lifecycle/check/audit projection

Project Lifecycle snapshot은 project document response와 같은 최대 2,000 evidence를 허용합니다.
2,001개 이상은 typed IPC reply에서 거부하며 durable state나 Knowledge Index schema는 바꾸지 않습니다.

검증:

```bash
corepack pnpm perf:session-catalog
corepack pnpm smoke:linux:session-governance
corepack pnpm smoke:browser:session-governance
corepack pnpm smoke:runtime-v2:phase6-default-gate
```

Governance Worker는 non-core입니다. 실패 시 terminal/storage/timeline/status를 유지하고
governance surface만 degraded로 전환합니다. Session Catalog와 Governance DB는 quarantine 후
rebuild/refresh하지만 Storage Worker의 durable DB는 backup/restore합니다.

## 별도 Windows 배포 게이트

Windows Electron package/updater를 release하려면 다음 smoke가 해당 배포면의 blocker입니다.
`CODEXMUX_SMOKE_ARTIFACT_DIR`와 현재 version보다 낮은 실제 baseline installer를 먼저
지정합니다. Package gate의 synthetic local-feed는 release evidence가 아닙니다.

```powershell
$env:CODEXMUX_SMOKE_ARTIFACT_DIR = "C:\artifacts\codexmux-smoke"
$env:CODEXMUX_WINDOWS_UPDATER_LOCAL_FEED_BASE_INSTALLER_PATH = "C:\artifacts\codexmux-Setup-<previous-version>.exe"
corepack pnpm audit:windows-platform
corepack pnpm smoke:runtime-v2:terminal-windows
corepack pnpm smoke:windows:preflight
corepack pnpm smoke:windows:codex-session
corepack pnpm smoke:windows:service-host
corepack pnpm smoke:windows:host-diagnostics
corepack pnpm smoke:windows:electron-env
corepack pnpm smoke:windows:electron-packaging
corepack pnpm pack:electron
corepack pnpm smoke:windows:packaged-launch
corepack pnpm smoke:windows:upload-integrity
corepack pnpm smoke:windows:installer-install
corepack pnpm smoke:windows:package-gate
corepack pnpm smoke:windows:release-gate
```

Fresh Windows가 아닌 platform의 skipped package 결과는 새 release 증거가 아닙니다.
`v0.4.20`은 `windows-2025`에서 hard-link/delete/cleanup/kill-switch package evidence와
published updater 기능을 최초 확보해 ADR-027과 ADR-028을 `Verified`로 전환했습니다.
`v0.4.21`은 같은 경로와 privacy-safe evidence를 재검증했고 `v0.4.22`는 실제
`v0.4.21 -> v0.4.22` updater와 package/privacy gate를 반복했습니다. 이후 stable release도
같은 gate를 반복합니다.

## 릴리스 노트 체크리스트

- runtime v2 mode와 rollback env를 기록합니다.
- Windows package artifact 이름과 버전을 기록합니다.
- installer install smoke와 updater smoke 결과를 기록합니다.
- packaged upload integrity와 kill-switch smoke 결과, ADR-027 상태를 기록합니다.
- known blocker와 internal rollout 범위를 기록합니다.
- 내부 전용 배포에서는 public code signing certificate와 SmartScreen reputation을 blocker로 기록하지 않습니다.
- 운영 handoff는 `docs/operations/YYYY-MM-DD-*-handoff.md`에 추가합니다.
