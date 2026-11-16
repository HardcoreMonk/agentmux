# 런타임 v2 동등성 매트릭스

이 문서는 runtime v2가 legacy behavior를 어디까지 대체했고 Linux Session Operations와
Project Governance가 어떤 ownership을 추가했는지 확인하는 기준입니다.

## 기준

| Surface | Legacy 기준 | Runtime v2 기준 | Rollback |
| --- | --- | --- | --- |
| Workspace/Layout | JSON store | SQLite projection + JSON fallback | storage `off` |
| Terminal | tmux WebSocket | Terminal Worker + adapter | terminal `off` |
| Timeline | JSONL parser + watcher | Timeline Worker | timeline `off` |
| Status | StatusManager | Status Worker | status `off` |
| Session Catalog | legacy session index/list | Timeline Worker + rebuildable SQLite/FTS | catalog `off` 또는 projection rebuild |
| Project Governance | 없음 | Governance Worker + approved project read | governance degraded/refresh |
| Sync | layout/status invalidation | 기존 client protocol 유지 | legacy URL 유지 |

## 워크스페이스와 레이아웃

필수 parity:

- workspace 생성, 이름 변경, 삭제
- active workspace 유지
- pane split과 tab metadata 유지
- runtime v2 terminal tab 생성
- stale layout 제거
- empty runtime DB snapshot을 정상 authoritative state로 취급

검증:

```bash
corepack pnpm test tests/unit/lib/workspace-store.test.ts
corepack pnpm test tests/unit/lib/layout-store.test.ts
corepack pnpm test tests/unit/lib/runtime/storage-read-owner.test.ts
```

## 터미널

필수 parity:

- create
- attach
- write/stdin
- resize
- detach
- reattach
- delete/kill
- session presence
- Runtime v2 tmux socket 파일이 없을 때(재부팅 직후) session 없음으로 처리
- terminal 탭 cwd/Git folder 조회(`terminal.session-info`)
- runtime metadata projection

검증:

```bash
corepack pnpm test tests/unit/lib/runtime/windows-terminal-runtime.test.ts
corepack pnpm smoke:runtime-v2:terminal-windows
```

## 타임라인

필수 parity:

- session list
- older entries
- message count
- live append
- `timeline:session-changed`
- duplicate suppression
- resume safety

검증:

```bash
corepack pnpm smoke:runtime-v2:timeline-shadow
corepack pnpm smoke:runtime-v2:timeline-live-shadow
corepack pnpm smoke:runtime-v2:timeline-session-changed
corepack pnpm smoke:runtime-v2:timeline-websocket-default
```

Session list parity에는 legacy와 runtime v2 모두 cold index refresh 중 request path가 전체
JSONL scan을 기다리지 않고 현재 page snapshot과 optional `refreshing` 상태를 반환하는 계약이 포함됩니다.

## Session Catalog와 Project Governance

필수 계약:

- Session Catalog rebuild/search/replay와 bounded FTS/snippet
- annotation, pin/tag와 saved filter의 durable Storage Worker ownership
- Approved Project Root와 Managed Project path 비노출
- Governance Worker의 bounded discovery, Knowledge Index와 lifecycle/check/audit
- Gate-controlled versioned scaffold preview/confirm, private journal recovery와 safe rollback
- source tree 무변경, SQLite private mode와 projection quarantine 복구
- Governance degraded 상태에서도 core terminal/session operation 유지

검증:

```bash
corepack pnpm perf:session-catalog
corepack pnpm smoke:linux:session-governance
corepack pnpm smoke:browser:session-governance
corepack pnpm smoke:governance:scaffold
```

## 상태와 알림

필수 parity:

- busy/idle/needs-input/review-needed 판단
- hook/client event 적용
- ack/dismiss
- session history
- Web Push와 native notification policy
- prompt metadata sanitization

검증:

```bash
corepack pnpm smoke:runtime-v2:status-shadow
corepack pnpm smoke:runtime-v2:status-default
```

## 동기화와 설정

필수 parity:

- workspace/layout 변경 후 client invalidation
- message history read/write
- config와 notification 설정 유지
- rollback 시 legacy JSON과 UI가 모순되지 않음

## 단계 게이트

Release 전 최소 gate:

```bash
corepack pnpm lint
corepack pnpm tsc --noEmit
corepack pnpm test
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm perf:session-catalog
corepack pnpm smoke:linux:session-governance
corepack pnpm smoke:browser:session-governance
```

## 확인된 증거 요약

- Windows unit baseline에서 `HOME`/`USERPROFILE`, SQLite handle cleanup, Windows path normalization 문제가 해결되었습니다.
- Runtime v2 terminal adapter factory가 직접 tmux import 대신 adapter selection을 사용합니다.
- Windows terminal runtime은 node-pty/ConPTY 기반 smoke를 통과했습니다.
- Windows process inspector는 CIM `Win32_Process` 기반으로 process existence, child PID, descendant, command line, executable path, creation time을 읽습니다.
- Windows Codex session smoke는 synthetic JSONL과 Codex-shaped child process mapping을 확인했습니다.
- Windows preflight는 tmux hard requirement에서 terminal runtime readiness로 전환되었습니다.
- Windows service host와 host diagnostics smoke는 dry-run, loopback-local, no mutation 원칙을 확인했습니다.
- Windows Electron env와 packaging contract smoke가 Windows PATH, `NODE_PATH`, NSIS/zip target을 확인했습니다.
- Windows release gate artifact는 bounded, sanitized structured result만 저장하고 pre-upload
  privacy scanner를 통과한 JSON만 업로드합니다.
- Linux integration gate는 Session Catalog/Governance ownership, source tree 무변경,
  projection rollback과 terminal 연결 유지, 한국어/영어 SSR/browser flow를 통과했습니다.
- 초기 통합 commit `d405f683`과 Phase 3 build `9d32d049`의 live user service는 실제 restart
  전후 terminal/scaffold/Linux/browser smoke와 Phase 6 12-check gate를 통과했습니다.
