# agentmux 이름 변경과 tmux 서버 분리 인계

- 날짜: 2026-11-09
- Spec: `../superpowers/specs/2026-11-09-agentmux-rename-design.md`
- Plan / reviews: `../superpowers/plans/2026-11-09-agentmux-rename.md`,
  `../superpowers/reviews/2026-11-09-agentmux-rename-eng-review.md`
- 사용자 설계 승인: "승인합니다, 계획 작성 진행해 줘". Live 전환 승인: "지금 진행".
- PR: HardcoreMonk/agentmux#42 (branch `feat/agentmux-rename`)

## Release Scope

제품 이름을 codexmux에서 agentmux로 바꿨다. 기존 세션이 끊기지 않도록 legacy 식별자는 호환 alias로
유지한다(ADR-033). tmux 서버를 web service cgroup 밖의 transient scope로 옮겨 service stop·restart가
terminal과 Codex process를 끊지 않게 했다(ADR-034). Version `0.5.0`.

- 이름: 제품·CLI(`agentmux`/`amux`, legacy `codexmux`/`cmux`)·npm(`@hardcoremonk/agentmux`)·unit
  (`agentmux.service`)·GitHub 저장소(`HardcoreMonk/agentmux`).
- Data: 실제 경로 `~/.codexmux` 유지, `~/.agentmux`는 별칭. Windows는 `~\.codexmux` 그대로.
- 호환: env `CODEXMUX_*`/`CMUX_*` 이중화, cookie `codexmux-session-token` 읽기 유지(logout만 삭제),
  header `x-cmux-token` 수신 유지, `/api/health`의 `app: 'codexmux'` 유지 + `product: 'agentmux'`.
- 자동 재개는 startup 시점에 없던 tmux session에만 resume을 보낸다.

## Release

1. 새 checkout `/data/projects/agentcode-zone/agentmux`에서 `corepack pnpm build` (`5b0cf14f`).
2. `scripts/adopt-tmux-server-scope.ts`로 두 socket 확인 뒤 편입: `codexmux` → `adopted`
   (`agentmux-tmux-codexmux.scope` active), `codexmux-runtime-v2` → `skipped`(서버 없음).
3. `codexmux.service` stop + disable (unit 파일과 drop-in은 rollback용으로 보존).
4. `~/.config/systemd/user/agentmux.service` 설치: `WorkingDirectory`, `ExecStart`(`bin/agentmux.js`),
   `Description`, `Documentation`만 변경. Drop-in `bridge-trace.conf`, `runtime-v2-shadow.conf`는 값 그대로
   env 이름만 `AGENTMUX_*`.
5. `daemon-reload`, `enable --now agentmux.service`, 한 번 더 `restart`.
6. GitHub 저장소 이름 변경, branch push, PR #42 생성. CI `check` 통과.

## Verification

- Branch: `pnpm test` 1771 passed(integration 포함, 격리 `TMUX_TMPDIR`), `tsc`, `lint`(기존 경고 6),
  `build`, `build:electron:main`, `check:product-name`(734 files), `check:project-design`,
  `build:landing`, `check:landing`, `git diff --check`.
- Smoke: `smoke:npm-package`, `smoke:tmux-scope`(live service 구조 재현, service stop 뒤 서버·pane 생존).
- 격리 리허설: 같은 HOME에서 옛 0.4.24 build → 새 build → 옛 build rollback. 별칭 생성, legacy cookie 인증과
  새 cookie 발급, upload, governance `writeState=ready`가 세 단계 모두 통과.
- Live: 전환 전후 tmux 서버 pid·session 4개·pane pid 4개 불변(옛 service stop, 새 service restart 모두).
  `~/.agentmux -> .codexmux` 생성. Governance(`ready`/`disabled`)와 Session Catalog(`ready`, 3 sessions)가
  전환 전 값과 같음. Legacy header 200. Hook bridge·statusline이 `x-agentmux-token`으로 재생성.
  재시작 log `tmux scope isolation already-isolated`. 사용자 확인: 재로그인 없음, 기존 terminal 재접속,
  전환 전 시작한 Codex tab의 status 갱신.

## Audit

- Code review(high): 10건 중 7건 반영(`b21c052f`), 2건은 spec·설계 결정으로 유지, 1건은 문서화(`5b0cf14f`).
- Branch commit에 live token 없음(값 대조 검사), 미수정 취약점 상세 없음.

## Blockers

없음.

## Warnings

- 문서 일괄 치환 중 builder가 보존 식별자와 과거 사실을 바꾼 오류를 감시자가 바로잡았다(tmux socket,
  `cmux.lock`, Windows 경로, legacy 이름, live build version, 미사용 env 이름).
- `docs/FOLLOW-UP.md`의 `governance-writes.conf` active 기술은 live host 실제 drop-in과 다르다(기존 drift).

## Post-Release

- PR #42 merge: main `cbcc4b06`, main CI 통과.
- Landing `https://hardcoremonk.github.io/agentmux/` 200 확인, 옛 `/codexmux/`는 404.
- Zone 인벤토리 commit 완료.
- 2026-11-09 18:19 host 재부팅 뒤 `agentmux.service`가 자동 시작했고 새 tmux 서버가
  `agentmux-tmux-codexmux.scope`에 편입된 것을 확인.
- 재부팅 뒤 시작 시점 자동 재개 대상은 0개였다. 결함이 아니다. 자동 재개는 `codex` panel 탭만 대상으로 하는데
  live의 탭 7개는 모두 `terminal` panel(Codex CLI를 terminal 안에서 실행)이다. Terminal 탭은 브라우저가
  접속할 때 session을 다시 만든다. `readLayoutFile`은 v2 storage `default`에서 v2 DB layout을 먼저 읽는다
  (`src/lib/layout-store.ts:115-118`). 앞선 PR #43의 "legacy `layout.json`을 읽는 결함" 기술은 오진이라 정정했다.

## Residual Risk

- Rollback 시 옛 build는 살아남은 shell prompt 탭에 `codex resume <id>`를 입력하고, 옛 build의 terminal
  attach는 `TMUX_TMPDIR`를 무시한다.
- `~/.codexmux`가 다른 디스크를 가리키는 symlink인 host는 시작이 막힌다. `AGENTMUX_DATA_DIR`로 해결한다.
- 페이지 응답에는 proxy가 새 cookie를 붙이지 않는다(기존 동작). 첫 API 응답에서 이전된다.
- `@hardcoremonk/agentmux`는 아직 npm에 배포되지 않았다. 배포 전까지 문서의 npm 설치 경로는 동작하지 않는다.

## Current Lifecycle Stage

operate (npm 배포 보류).

## Next Action

npm 첫 배포는 `v0.5.0` tag push가 Windows release workflow도
실행하므로 tag 정책을 먼저 결정한 뒤 진행. 각 단계 실행 직전에 사용자 확인.

## Follow-Up Tasks

- npm `@hardcoremonk/agentmux@0.5.0` 수동 첫 배포, `codexmux` deprecate, trusted publisher 연결
- `v0.5.0` tag push 결정(Windows release workflow 동시 실행 여부)
- Rollback 창 종료 뒤 data 실제 이전(`~/.agentmux`)과 `codexmux.service`·옛 checkout 정리 별도 spec
- 다음 프로젝트: Claude Code provider, 위임 자동화와 agent split. 2026-11-10부터 multi-agent 범위로
  brainstorming 중(`docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`)
