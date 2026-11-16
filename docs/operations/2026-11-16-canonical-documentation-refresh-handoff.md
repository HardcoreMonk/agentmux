# Canonical 문서 현행화 handoff (2026-11)

- 날짜: 2026-11-16
- 요청: 사용자 "모든 문서 현행화"
- 범위: root 문서, `docs/` 기준 문서, 진행 중 handoff의 상태 절, 공개 사이트(`landing-src/`) root·`/ko/` guide
- lifecycle: 문서 전용 변경(제품 동작·API·계약 변경 없음). 파일이 많아 Lightweight 조건(1~2개 파일)에는 맞지 않으므로
  PR, CI, 독립 검증을 거쳤습니다.

## 기준 상태

| 항목 | 현재 기준 |
| --- | --- |
| source `main` | `2b432110`(현행화 전) |
| package | `@hardcoremonk/agentmux` `0.5.0`, npm 첫 배포 보류(public `latest`는 legacy `codexmux@0.4.23`) |
| live service | `agentmux.service`, build `f61031a1`(2026-11-16 15:47 KST 배포), port `8122`, browser 인증 |
| 지원 agent | Codex, Claude Code(설계 1, 2026-11-11부터 live) |
| 마지막 전체 현행화 | 2026-08-21(`2026-08-21-canonical-documentation-refresh-handoff.md`) |

그 뒤 main에 들어온 일: 이름 변경(ADR-033/034), Multi-agent 설계 1(Claude Code provider, 공통 agent UI,
위임 안내와 `agentmux tab` CLI, ADR-035~037), 설계 2-1(Codex 보조, ADR-038), 설계 2-2(Git side panel, 모바일
재연결 새로고침), iPad 홈 화면 웹 앱, 설계 3(agent 자동 보고, ADR-039)과 후속, `deploy:local` 보강.

## 방법

1. 문서를 다섯 묶음으로 나눠 읽기 전용 감사로 drift 목록을 만들었습니다. 각 항목은 고칠 원문, 새 문장, code나
   기준 문서의 근거(file:line)를 담습니다.
2. Controller가 root·`docs/` 묶음(G1~G3)을 code와 live 설정에 대조해 고치거나 뺐고, 공개 사이트 묶음(G4a, G4b)은
   다른 model의 독립 검증을 거쳐 반영했습니다.
3. 확정 목록은 agy(Gemini 4 Hydrogen)가 그대로 옮겨 적었고, controller가 적용 결과를 기계 대조했습니다(아래 검증).

## 보존 정책

- `docs/operations/`의 지난 handoff, `docs/superpowers/`의 승인 당시 spec/plan, 날짜가 붙은 경과 서술은 고치지
  않았습니다. 예외는 진행 중인 `2026-11-10-multi-agent-brainstorming-handoff.md`의 Current Lifecycle Stage와
  Follow-Up Tasks 상태 표시입니다(해결된 항목에 `(해결: …)`를 붙임, 삭제하지 않음).
- 공개 사이트의 다른 9개 locale은 legacy snapshot이므로 고치지 않았습니다. Root guide(`landing-src/docs/*.md`)는
  기존대로 한국어이며(영어는 `session-operations.md`만) 언어를 바꾸지 않았습니다.
- live host의 bind 주소와 노출 범위는 공개 저장소에 쓰지 않습니다. 현재 상태를 말하던 `0.0.0.0:8122` 문장은
  port와 browser 인증만 남기고, 2026-08 기록은 기록으로 두었습니다.

## 주요 교정

- "Claude Code 지원 예정" 문구를 "Codex와 Claude Code 지원"으로 바꿈(README, AGENTS, CONTEXT, DESIGN,
  PROJECT-DESIGN, ARCHITECTURE-LOGIC, 공개 사이트 첫 화면과 guide).
- 위임(`agentmux tab`), agent 자동 보고, Codex 보조, Git side panel, 터치 기기 layout을 각 문서 범위에 맞게 추가.
- live build·version·재시작 기록을 `f61031a1`/`0.5.0`/2026-11-16으로 갱신(FOLLOW-UP, CONTEXT, PROJECT-DESIGN,
  SYSTEMD).
- Governed write 상태 교정: live `agentmux.service`에는 `AGENTMUX_GOVERNANCE_WRITES=1` drop-in이 없어 governed
  write가 꺼져 있습니다. README와 SYSTEMD의 "active" 기술을 고쳤습니다(이름 변경 handoff에 이미 기록된 drift).
- 공개 guide의 npm 안내: `@hardcoremonk/agentmux`가 아직 배포되지 않았다는 안내가 빠진 곳을 고쳤습니다.
- ADR-003(provider 둘), ADR-007(서버 이름), RUNTIME-V2-CUTOVER의 ADR-037 상태와 `AGENTMUX_*` 이름.

## 검증

| 묶음 | 대상 | 확정 항목 | 비고 |
| --- | --- | --- | --- |
| G1 root·설계 문서 | README, AGENTS, CONTEXT, DESIGN, `docs/README.md`, PROJECT-DESIGN, `agents/domain.md`, ADR-003/007 | 35 | live 행의 bind 주소 제거와 governed write 상태를 controller가 고침 |
| G2 runtime·운영 문서 | ARCHITECTURE-LOGIC, DATA-DIR, TMUX, STATUS, TESTING, SYSTEMD, RUNTIME-V2-CUTOVER/PARITY | 21 | SYSTEMD live 문단을 controller가 다시 씀 |
| G3 후속·플랫폼·감사 문서 | FOLLOW-UP, ANDROID, HERDR/PURPLEMUX 감사, multi-agent handoff 상태 절 | 21 | FOLLOW-UP live 행 3개를 controller가 다시 씀 |
| G4a 공개 사이트 1 | 첫 화면, `landingProduct.js`, guide 17종(root·ko) | 131 | 독립 검증: 거절 0, 수정 18, 추가 22 |
| G4b 공개 사이트 2 | guide 16종(root·ko), `docs/index.njk`(root·ko) | 103 | 독립 검증: 거절 0, 수정 6, 추가 7. controller 추가 6 |

변경 없음으로 확인한 문서: STYLE, CLI, PERFORMANCE, IPAD, ELECTRON, GITHUB-PAGES, TAURI-EVALUATION,
WINDOWS-ONLY-GAP-AUDIT, `agents/issue-tracker.md`, `agents/triage-labels.md`, CLAUDE.md, 공개 guide 중
custom-css, editor-integration, project-governance, tailscale, web-browser-panel.

적용 결과 대조: 확정 목록을 원본 사본에 순서대로 적용한 기대 결과를 따로 만들고 agy의 결과와 파일 단위로
비교했습니다. G1~G3는 controller가 고친 1곳(`docs/README.md`의 legacy 경로 표기, `check:product-name` 요구)
외에 같았습니다. 공개 사이트는 61개 파일 중 `architecture.md` 2개에서 표 두 행이 한 줄로 붙고, `pwa-setup`,
`linux-service`, `cli-reference`(root·ko)에서 문단 사이 빈 줄이 빠져 있어 기대 결과로 맞췄습니다.

| Gate | 결과 |
| --- | --- |
| `git diff --check` | 통과 |
| `corepack pnpm check:product-name` | 통과(749 files) |
| `corepack pnpm check:project-design` | 통과 |
| `corepack pnpm build:landing` | 통과(364 files) |
| `corepack pnpm check:landing` | 통과(files 400, html 361, local links 23,556, content contracts 7) |

전체 변경: 82개 파일, 612줄 추가, 248줄 삭제(이 handoff 제외).

## 배포

PR #64 CI 통과(`check` 1m26s), main에 local merge(`df826a73`)와 push. main CI 성공, GitHub Pages 배포 workflow
성공. 공개 사이트 첫 화면(root, `/ko/`), docs 첫 화면, `/ko/docs/quickstart/`가 200이며 "Claude Code"가 보이고
"지원 예정" 문구는 0건입니다. Runtime 변경이 없어 `deploy:local`은 하지 않았고, live service는 build `f61031a1`,
같은 PID와 tmux session 10개 그대로입니다. Worktree, local branch와 remote branch는 정리했습니다.

## Follow-Up

- `bin/agentmux.js`는 `memory`/`mem`을 CLI 명령으로 넘기지만 `bin/cli.js`에는 처리기가 없습니다. 문서에는
  없는 명령이므로 code에서 빼거나 구현할지 정해야 합니다.
- Governed write를 다시 켤지는 사용자 결정입니다(`agentmux.service.d/`에 drop-in 추가).
- 감사가 확인하지 못해 남긴 항목(Uncertain)은 `FOLLOW-UP.md`의 기존 행에 그대로 둡니다: Codex session test 불안정,
  `layout-store` test data dir 격리, smoke script 결함, 직접 실행한 Claude의 timeline 연결 등.
- Root 공개 guide의 영어 이관은 기존 방침대로 순차 대상입니다.
