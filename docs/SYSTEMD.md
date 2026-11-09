# Linux 단일 엔진 systemd 운영

이 문서는 agentmux Linux 단일 엔진을 `systemd --user` 서비스로 운영하는 기준입니다. 한 user service가 custom server, Runtime v2 worker, tmux adapter, Codex JSONL read와 등록 project의 governed scaffold write를 소유합니다.

## 기존 워크스테이션 기준

서비스 파일:

```text
~/.config/systemd/user/agentmux.service
```

(이전 이름 `codexmux.service`에서 전환할 때는 새 unit과 drop-in을 활성화한 뒤 이전 unit을 disable/stop합니다.)

네트워크와 포트:

```text
HOST=0.0.0.0
PORT=8122
```

2026-08-23 현재 이 host의 unit은 enabled/active이며 Navigation Selection Clarity build commit
`a6a49588`, version `0.4.24`를 `0.0.0.0:8122`에서 제공합니다. Browser 인증과
`AGENTMUX_GOVERNANCE_WRITES=1`(legacy `CODEXMUX_GOVERNANCE_WRITES=1` 호환) drop-in이 구성됐고 CLI token 기반 운영 API, Runtime v2와
Governance `writeState=ready`도 정상입니다.

## 서비스 파일 예시

```ini
[Unit]
Description=agentmux Linux single-engine session manager
Documentation=https://github.com/HardcoreMonk/agentmux
After=network.target

[Service]
Type=simple
WorkingDirectory=/data/projects/agentcode-zone/agentmux
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
Environment=AGENTMUX_RUNTIME_V2=1
Environment=AGENTMUX_SESSION_CATALOG_MODE=default
# 별도 승인 뒤에만 추가: Environment=AGENTMUX_GOVERNANCE_WRITES=1
Environment=HOST=0.0.0.0
Environment=PORT=8122
Environment=PATH=/home/hardcoremonk/.nvm/versions/node/v24.19.0/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/hardcoremonk/.nvm/versions/node/v24.19.0/bin/node /data/projects/agentcode-zone/agentmux/bin/agentmux.js
Restart=on-failure
RestartSec=3
KillSignal=SIGINT
SuccessExitStatus=130
TimeoutStopSec=20

[Install]
WantedBy=default.target
```

System-wide service가 아니라 user service를 사용하는 이유는 `~/.agentmux/`(legacy 실제 경로 `~/.codexmux/`), `~/.codex/sessions/`, 사용자 tmux socket, 등록 project와 Node runtime 환경이 한 Linux 사용자 기준이어야 하기 때문입니다. `ExecStart`의 Node path는 설치 시 `command -v node`로 확인한 현재 절대 경로와 일치시킵니다.

### tmux 서버 scope 분리와 의도적 종료

예시 unit은 `KillMode=control-group`을 유지해 `agentmux.service`를 재시작하거나 중지할 때 Node server와 5개 Runtime v2 worker는 깨끗하게 정리합니다. 반면 tmux 서버(`-L codexmux`, `-L codexmux-runtime-v2`)와 그 안의 shell/Codex CLI 프로세스는 web service 재시작 때 함께 종료되지 않도록 별도 systemd user transient scope(`agentmux-tmux-<socket>.scope`)에서 실행합니다.

- 편입 조건은 `INVOCATION_ID`가 있고 `NODE_ENV=production`인 systemd service 실행입니다. `AGENTMUX_TMUX_SCOPE=off`로 끌 수 있습니다.
- 서버 시작 시, 그리고 새 tmux session을 만든 직후 아직 scope 밖에 있는 tmux 서버를 D-Bus `StartTransientUnit`(`busctl --user`)으로 `agentmux-tmux-<socket>.scope`에 편입하고, cgroup 이동을 최대 5초 확인합니다. 실패해도 session 생성은 계속되고 경고 log만 남습니다.
- tmux 3.6은 pane process를 이미 `tmux-spawn-*.scope`로 분리하므로 옮기는 대상은 tmux 서버 process 하나입니다.
- 이 기능이 없는 옛 build에서 처음 전환할 때는 옛 service를 멈추기 전에 두 socket 모두 `corepack pnpm exec tsx scripts/adopt-tmux-server-scope.ts --socket <name> --dry-run`으로 확인한 뒤 같은 명령을 `--dry-run` 없이 실행합니다. `TMUX_TMPDIR`가 설정되지 않은 shell에서 실행해야 live socket을 찾습니다.
- 시작 시점에 이미 살아 있던 tmux session은 재시작 후 자동 resume 입력을 다시 보내지 않으므로 실행 중이던 작업이 방해받지 않습니다.
- tmux 서버와 내부 세션을 의도적으로 완전히 종료해야 할 때는 다음 명령을 사용합니다.

```bash
tmux -L codexmux kill-server
tmux -L codexmux-runtime-v2 kill-server
# 또는 scope 직접 중지:
systemctl --user stop agentmux-tmux-codexmux.scope # legacy tmux socket scope
systemctl --user stop agentmux-tmux-codexmux-runtime-v2.scope
```

Fresh config에서 user service가 setup으로 시작하면 저장된 `HOST`보다 먼저
`127.0.0.1`에만 bind하고, 외부 bind는 setup 완료 후 restart부터 적용합니다. Setup
동안 remote onboarding은 지원하지 않습니다. System-wide/root service처럼 detectable
elevated runtime에서 fresh setup을 시작하려면 valid `INIT_PASSWORD`가 필요하며, 이 값도
remote setup을 허용하지 않고 login session gate만 추가합니다.

Malformed/hash-only config로 startup이 실패하면 service를 멈춘 상태에서 bytes를
백업·수정합니다. 비밀번호 reset은 `authPassword`와 `authSecret`을 함께 제거한 뒤
restart하며 config 전체 삭제는 다른 앱 설정도 초기화하므로 기본 복구 절차가 아닙니다.

이 service처럼 agentmux custom server를 실행할 때 upload ingress는 embedded Next server보다
앞선 outer server가 소유합니다. Upload 장애를 격리하려면 service drop-in에
`Environment=AGENTMUX_UPLOADS_DISABLED=1`(legacy `CODEXMUX_UPLOADS_DISABLED=1` 호환)을 추가하고 daemon reload/restart합니다. 이 모드는
두 upload route만 `503`으로 닫고 health와 기존 artifact tree는 유지합니다. Direct `next start`
또는 제거된 Pages upload route로 fallback하지 않습니다.

Governance scaffold write는 기본 off입니다. 활성화 전
`corepack pnpm smoke:governance:scaffold`와 backup 여유 공간을 확인한 뒤 drop-in에
`Environment=AGENTMUX_GOVERNANCE_WRITES=1`을 추가합니다. 비상 차단은 이 환경 변수를 제거하고
daemon reload/restart합니다. Gate off도 미완료 action의 startup rollback을 건너뛰지 않으며
`recovery-required`가 있으면 action backup을 삭제하지 않습니다.

현재 host는 승인된 다음 drop-in을 사용합니다.

```text
~/.config/systemd/user/agentmux.service.d/governance-writes.conf
```

```ini
[Service]
Environment=AGENTMUX_GOVERNANCE_WRITES=1
```

## 등록과 시작

```bash
mkdir -p ~/.config/systemd/user
systemctl --user daemon-reload
systemctl --user enable --now agentmux.service
```

로그인하지 않은 상태에서도 서비스를 시작하려면 linger를 켭니다.

```bash
loginctl enable-linger "$USER"
```

## 운영 명령

```bash
systemctl --user status agentmux.service
systemctl --user restart agentmux.service
systemctl --user stop agentmux.service
systemctl --user start agentmux.service
journalctl --user -u agentmux.service -f
```

Health check:

```bash
curl -sS http://127.0.0.1:8122/api/health
```

정상 응답:

```json
{"app":"codexmux","product":"agentmux","version":"<package-version>","commit":"<git-short-hash>","buildTime":"<iso-build-time>"}
```

Runtime와 worker health는 인증된 요청으로 별도 확인합니다.

```bash
curl -fsS -H "x-agentmux-token: $(<~/.agentmux/cli-token)" \
  http://127.0.0.1:8122/api/v2/runtime/health
curl -fsS -H "x-agentmux-token: $(<~/.agentmux/cli-token)" \
  http://127.0.0.1:8122/api/sessions/health
```

`terminal`, `storage`, `timeline`, `status`는 core readiness입니다. `governance`가 degraded여도 core session operation은 유지되어야 하며 governance UI/API만 retry 가능한 오류와 저하 상태를 표시합니다.

## 배포 전 점검

```bash
command -v node
command -v tmux
corepack pnpm build
corepack pnpm build:server
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm perf:session-catalog
corepack pnpm smoke:linux:session-governance
corepack pnpm smoke:browser:session-governance
```

- service user가 `~/.codex/sessions/`와 등록 project를 읽고 `~/.agentmux/`(legacy 실제 경로 `~/.codexmux/`)를 쓸 수 있어야 합니다.
- `runtime-v2`, `session-catalog`, `governance` 디렉터리는 `0700`, SQLite DB/WAL/SHM은 `0600`인지 확인합니다.
- `dist/workers/`에 terminal/storage/timeline/status/governance worker bundle이 모두 있어야 합니다.
- 실제 `systemctl --user restart`는 backup과 운영 승인을 받은 뒤 실행합니다. build/smoke 통과만으로 live service를 재시작하지 않습니다.

최초 2026-08-21 배포 전에는 기존 unit, listener와 runtime/catalog/governance DB가 없어서
backup 대상이 없었습니다. 이후 배포부터는 restart 전에 runtime DB/WAL/SHM을 같은 시점의
한 세트로 backup합니다. 최초 배포는 restart 전후 live terminal 전체 smoke와 Phase 6
12-check gate를 통과했으며 이전 이름 저장소의 [Issue #18](https://github.com/HardcoreMonk/codexmux/issues/18)에
완료 증거가 있습니다.

Phase 3 배포에서는 service를 멈춘 뒤 `runtime-v2-storage-20260821T090636Z`에 durable DB/WAL/SHM과
workspace state 5개를 backup하고 directory `0700`, file `0600`을 확인했습니다. Build commit
`9d32d049`로 PID `1101874`에서 `1104868`로 재기동했고 public/authenticated health, Governance
`writeState=ready`, Phase 6 12-check gate를 통과했습니다. Scaffold 7-check, Linux 10-check와
한국어/영어 browser smoke도 통과했으며 이전 이름 저장소의 [Issue #19](https://github.com/HardcoreMonk/codexmux/issues/19)에
완료 근거를 남깁니다.

Governed unmarked adoption 배포에서는 service를 멈춘 뒤
`runtime-v2-storage-20260821T123122Z`에 같은 5개 durable/workspace state를 `0700/0600`으로
backup했습니다. Build commit `f46410b4`로 PID `1104868`에서 `1149564`로 재기동했고
`0.0.0.0:8122`, public/authenticated health, Governance `writeState=ready`, live Phase 6
12-check를 확인했습니다. Production scaffold 13-check와 한국어/영어 browser 4-check도
통과했으며 이전 이름 저장소의 [Issue #20](https://github.com/HardcoreMonk/codexmux/issues/20)에 근거를 남깁니다.

GitHub Pages 제품 재설계 운영 확인에서는
`runtime-v2-storage-20260821T145427Z` backup을 `0700/0600`으로 생성한 뒤 PID `1149564`에서
`1216337`로 재기동했습니다. Start timestamp는 `2026-08-21 23:54:27 KST`, restart count는
0이며 app build는 `f46410b4`를 유지합니다. 2026-08-22 같은 service에서 301초·11회 동일
session 재연결과 worker health를 관찰하고 종료 직후 Runtime v2 10-check와 Phase 6 12-check를
통과했습니다.

Session Catalog annotation pagination 배포에서는 service를 멈춘 뒤
`runtime-v2-storage-20260821T163716Z`에 durable DB/WAL/SHM과 workspace state 5개를 백업했습니다.
Build commit `322ccfb7`, version `0.4.24`로 PID `1294595`, start
`2026-08-22 01:37:36 KST`, restart count 0으로 재기동했고 listener `0.0.0.0:8122`, governance
write gate와 Phase 6 12-check를 확인했습니다. 실제 pinned/tag 검색은 `results=1`, exact
`total=1`, no cursor를 반환했습니다.

Navigation Selection Clarity 배포에서는 service를 멈춘 뒤
`runtime-v2-storage-20260823T135639Z`에 같은 durable/workspace state 5개를 `0700/0600`으로
백업했습니다. Build commit `a6a49588`, version `0.4.24`로 PID `88057`, start
`2026-08-23 22:57:01 KST`, restart count 0으로 재기동했습니다. Live terminal/reconnect 10-check,
Phase 6 12-check, Governance lifecycle 236-evidence 응답과 desktop/mobile navigation browser gate를
통과했습니다. 상세 근거는
[Navigation Selection Clarity handoff](operations/2026-08-23-navigation-selection-clarity-handoff.md)에
있습니다.

## 런타임 v2 rollback

Runtime v2 mode는 drop-in으로 관리할 수 있습니다.

```text
~/.config/systemd/user/agentmux.service.d/runtime-v2-shadow.conf
```

전체 rollback:

```bash
rm ~/.config/systemd/user/agentmux.service.d/runtime-v2-shadow.conf
systemctl --user daemon-reload
systemctl --user restart agentmux.service
```

Surface별 rollback은 mode를 `off`로 바꾼 뒤 daemon reload/restart로 처리했습니다.

Session Catalog나 Knowledge Index만 손상된 경우 전체 Runtime v2를 끄지 않습니다. service를 멈춘 뒤 해당 `index.db`, WAL, SHM을 quarantine하고 다시 시작해 rebuild/refresh합니다. `runtime-v2/state.db`에는 durable user state가 있으므로 먼저 backup하고 검증된 세 파일 단위로 복원합니다. 자세한 데이터 경계는 `DATA-DIR.md`를 따릅니다.

## Lifecycle control 참고

`/experimental/runtime`의 lifecycle control은 임의 shell 입력을 받지 않고 allowlist action만 실행합니다.

| Action | 실행 |
| --- | --- |
| `phase6-gate` | `corepack pnpm smoke:runtime-v2:phase6-default-gate` |
| `restart-service` | `systemctl --user restart agentmux.service` |
| `deploy-local` | `corepack pnpm deploy:local` |

실행 기록은 `~/.agentmux/lifecycle-actions.jsonl`(legacy 실제 경로 `~/.codexmux/lifecycle-actions.jsonl`)에 sanitized event로 남깁니다.

## 별도 Windows 배포면

Windows tray/service/installer/updater 근거는 역사적 release evidence와 `codexwinmux` 별도 제품 line 판단에 사용합니다. Linux Session Operations/Project Governance acceptance를 Windows package 결과로 대체하거나 그 반대로 대체하지 않습니다.
