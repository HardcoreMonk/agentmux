# agentmux 이름 변경과 tmux 서버 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 이 plan의 executor는 Herdr pane의 agy(`builder`)다. 감시자(Claude)가 task마다 diff와 test를 직접 확인한 뒤
> commit하고 다음 task를 넘긴다. agy는 commit, push, branch 변경, `systemctl`, live tmux 조작을 하지 않는다.

**Goal:** 제품 이름을 agentmux로 바꾸되 legacy 식별자를 호환 alias로 유지하고, tmux 서버를 web service cgroup
밖으로 분리해 service 재시작에도 terminal과 Codex process가 살아남게 한다.

**Architecture:** 단일 identity module이 data directory 해석(`~/.agentmux` 별칭 → 실제 경로), legacy env 이중화,
cookie·header 이름을 소유한다. tmux 서버는 cold start 직후 `busctl StartTransientUnit`으로 자기 scope에
편입하고, 첫 전환은 같은 함수를 쓰는 operator script로 처리한다. 화면·문서 이름 변경은 이름 검사 gate로
검증한다.

**Tech Stack:** TypeScript, Next.js Pages Router + custom server, vitest, tsup, tmux 3.6, systemd 259 user
manager(`busctl`, `systemd-run`), Eleventy.

**Spec:** `docs/superpowers/specs/2026-11-09-agentmux-rename-design.md` (Approved)

## Global Constraints

- 새 이름: 제품 `agentmux`, npm `@hardcoremonk/agentmux`, CLI `agentmux`·`amux`, legacy CLI `codexmux`·`cmux` 유지.
- Cookie `agentmux-session-token` 발급, `codexmux-session-token` 읽기 유지·삭제 안 함, logout은 둘 다 삭제. Purplemux `session-token`은 읽지 않는다.
- Header `x-agentmux-token` 발신, `x-cmux-token` 수신 유지. Env `AGENTMUX_*`/`AMUX_*` 우선, `CODEXMUX_*`/`CMUX_*` fallback.
- Data는 옮기지 않는다. `~/.agentmux` → 실제 `~/.codexmux` 별칭을 두고, 모든 module은 실제 경로 문자열 `path.join(homeDir, '.codexmux')`만 받는다(아래 Spec 보정).
- 유지: tmux socket `codexmux`/`codexmux-runtime-v2`, `globalThis` key, session prefix `pt-ws-`, Android `appId`, Electron `appId`/`productName`/userData, governance marker `CODEXMUX:`, template 문구, `.codexmux-stage-`, 내부 env `__CMUX_PRISTINE_ENV`/`__CMUX_APP_DIR`, `/api/health`의 `app: 'codexmux'`(옛 build의 `lock.ts`가 이 값으로 실행 중 server를 판별하므로 바꾸면 rollback 때 두 server가 같은 data를 쓴다).
- 실제 tmux를 띄우는 모든 test·smoke·리허설 server는 `TMUX_TMPDIR=<임시 dir>`와 빈 PORT를 쓴다. tmux socket 경로는 HOME이 아니라 `TMUX_TMPDIR`로 정해지므로 HOME 격리만으로는 live 서버(`/tmp/tmux-1000/codexmux`)에 붙는다.
- 옛 checkout `/data/projects/codex-zone/codexmux`는 build하지 않는다. tsup `clean: true`가 실행 중 service의 `dist/workers`를 지운다. Rollback 리허설은 그 checkout의 기존 `dist`만 실행한다.

### Spec 보정 (plan-eng-review 반영, 감시자 판단)

- Spec의 "realpath로 해석"은 **별칭 한 단계만 푼다**로 구체화한다. 반환값은 `path.join(homeDir, '.codexmux')` 문자열 그대로다. Full realpath는 HOME 경로 안의 symlink까지 풀어 governance journal의 정확한 문자열 비교를 깨뜨릴 수 있다.
- Data directory 해석은 부수효과가 없고 memo하지 않는다. 별칭·fresh directory 생성은 `server.ts` startup의 `prepareDataDir()` 한 곳에서만 한다. 그래야 `vi.resetModules()` 기반 test 격리가 유지되고, live host에서 test를 돌려도 `~/.agentmux`가 생기지 않는다.
- Version `0.5.0`. Windows 재패키징, Claude provider, 위임 자동화는 범위 밖.
- 실제 tmux를 쓰는 test·smoke는 `codexmux`, `codexmux-runtime-v2` socket을 쓰지 않는다. 개발 중 live tmux 서버와 `codexmux.service`에 신호를 보내지 않는다.
- 과거 기록(`docs/operations/`, `docs/superpowers/{specs,plans,grill-me,reviews}/`, `docs/lifecycle/runs/`, `*-AUDIT.md`, ADR 본문)은 다시 쓰지 않는다.
- AGENTS.md 코드 규칙: `@/` import, arrow function, `I`/`T` 접두사, 소문자-dash 파일명, 공유 상태는 `globalThis` guard.

## Review Focus

1. Browser에 두 cookie가 모두 있고 새 cookie는 만료·위조, legacy cookie는 유효한 경우 → 유효한 쪽으로 인증된다. (Task 4 test)
2. `~/.agentmux`가 대상이 사라진 dangling symlink인 경우 → 빈 data를 새로 만들지 않고 fail closed. (Task 2 test)
3. `busctl`이 없거나 실패하는 host에서 session 생성 → 경고만 남기고 session 생성은 성공한다. (Task 6 test)
4. 이전 script가 `CMUX_PORT`/`CMUX_TOKEN`만 설정한 상태로 `amux` 실행 → 동작한다. (Task 5 test)
5. tmux 서버는 살아 있고 일부 session만 사라진 상태에서 service 시작 → 사라진 tab만 재개된다. (Task 7 test)

---

## File Structure

| File | 책임 |
| --- | --- |
| `scripts/check-product-name-lib.mjs`, `scripts/check-product-name.mjs` | 현재 surface의 legacy 제품명 검사 |
| `src/lib/app-identity.ts` | 제품 이름 상수, data directory layout 판정·별칭·경로 해석, service unit 이름 |
| `src/lib/legacy-env.ts`, `src/lib/legacy-env-bootstrap.ts` | legacy env 이중화와 진입점 side-effect |
| `src/lib/auth.ts`, `src/lib/cli-token.ts` | cookie·CLI header 이름과 후보 읽기 |
| `bin/agentmux.js` | 새 CLI 진입점 (`bin/codexmux.js`는 위임 wrapper) |
| `src/lib/tmux-server-scope.ts` | tmux 서버 scope 편입 |
| `scripts/adopt-tmux-server-scope.ts`, `scripts/smoke-tmux-scope-isolation.ts` | 첫 전환 operator script와 격리 리허설 |
| `src/lib/auto-resume.ts` | 새로 만든 session만 재개 |

---

### Task 0: Baseline과 branch (감시자 수행, 사용자 승인 필요)

- [ ] **Step 1:** 사용자 승인 후 activity label 변경만 commit한다. 대상: `docs/STATUS.md`, `messages/{en,ko}/workspace.json`, `src/components/features/mobile/mobile-navigation-sheet.tsx`, `src/components/features/workspace/workspace-status-indicator.tsx`, `src/hooks/use-agent-status.ts`, `src/hooks/use-tab-store.ts`, `src/lib/workspace-activity.ts`, `tests/unit/hooks/use-tab-store.test.ts`, `tests/unit/components/workspace-status-indicator.test.ts`, `tests/unit/lib/workspace-activity.test.ts`, 그 기능의 spec/plan/grill-me/handoff 4개.
- [ ] **Step 2:** `git switch -c feat/agentmux-rename`
- [ ] **Step 3:** 첫 문서 commit: `docs/HERDR-ADOPTION-AUDIT.md`, `docs/README.md`, 이 spec, grill-me, 이 plan.
- [ ] **Step 4:** `git status --short`에 `.ua/`, `.claude/`, `src/lib/codex-client-command.ts`, `docs/operations/2026-10-31-connectivity-diagnosis-handoff.md`만 미추적으로 남았는지 확인한다.

### Task 1: 제품명 검사 gate

**Files:**
- Create: `scripts/check-product-name-lib.mjs`, `scripts/check-product-name.mjs`
- Modify: `package.json` (script `check:product-name`), `vitest.config.ts` (`test.env.TMUX_TMPDIR`를 `os.tmpdir()` 아래 process별 dir로 설정해 실제 tmux를 쓰는 test가 live 서버에 붙지 않게 한다)
- Test: `tests/unit/scripts/check-product-name.test.ts`

**Interfaces:**
- Produces: `findProductNameViolations(files: Array<{ path: string; content: string }>): Array<{ path: string; line: number; text: string }>`, `PRODUCT_NAME_SCAN_GLOBS: string[]`
- `node scripts/check-product-name.mjs`: `git ls-files` 중 scan 대상만 읽고 위반을 `path:line: text`로 출력, 위반이 있으면 exit 1.

규칙: scan 대상 file에서 단어 `codexmux`(대소문자 무시)와 단독 단어 `cmux`가 위반이다. 같은 줄이 아래 중 하나와 맞으면 허용한다.
- 보존 식별자: `codexmux-session-token`, `x-cmux-token`, `CODEXMUX_`, `CMUX_`, `__codexmux`, `__cmux`, `com.hardcoremonk.codexmux`, `codexmux-runtime-v2`, `-L codexmux`, `CODEXMUX:`, `Codexmux Managed`, `.codexmux-stage-`, `bin/codexmux.js`, `codexwinmux`, `codexmux@0.`
- 호환 설명 줄: `legacy`, `호환`, `별칭`, `이전 이름`, `formerly` 중 하나를 포함
- 줄 끝 marker `product-name-allow`

Scan 대상: `messages/**`, `src/components/**`, `src/pages/**`, `server.ts`, `bin/cli.js`, `public/**`의 text file, `landing-src/**`, `capacitor.config.ts`, `android/app/src/main/res/values/strings.xml`, root `README.md`·`AGENTS.md`·`CLAUDE.md`·`CONTEXT.md`·`DESIGN.md`, `docs/{README,PROJECT-DESIGN,ARCHITECTURE-LOGIC,STATUS,TMUX,DATA-DIR,TESTING,SYSTEMD,PERFORMANCE,STYLE,ELECTRON,ANDROID,FOLLOW-UP,GITHUB-PAGES}.md`, `docs/agents/*.md`.

- [ ] **Step 1: Write the failing test**

```ts
it('flags the bare legacy product name', () => {
  expect(findProductNameViolations([{ path: 'README.md', content: 'codexmux는 세션 매니저입니다' }]))
    .toEqual([{ path: 'README.md', line: 1, text: 'codexmux는 세션 매니저입니다' }]);
});
it('allows preserved identifiers and compat lines', () => {
  const content = [
    'cookie `codexmux-session-token` 읽기',
    'tmux -L codexmux attach',
    '옛 `codexmux` 명령은 호환 alias로 유지',
    'const n = "codexmux"; // product-name-allow',
  ].join('\n');
  expect(findProductNameViolations([{ path: 'docs/TMUX.md', content }])).toEqual([]);
});
it('flags bare cmux but not CMUX_ env names', () => {
  const v = findProductNameViolations([{ path: 'bin/cli.js', content: 'Usage: cmux tab\nCMUX_PORT=1' }]);
  expect(v.map((x) => x.line)).toEqual([1]);
});
```

- [ ] **Step 2:** `corepack pnpm exec vitest run tests/unit/scripts/check-product-name.test.ts` → FAIL (module 없음)
- [ ] **Step 3:** lib과 CLI를 구현하고 `package.json`에 `"check:product-name": "node scripts/check-product-name.mjs"`를 추가한다.
- [ ] **Step 4:** 같은 test → PASS. `corepack pnpm check:product-name` → 위반 목록과 exit 1(Task 8, 9 완료 전 정상). `corepack pnpm exec vitest run tests/integration/runtime-v2-terminal-process.test.ts` 전후로 `tmux -L codexmux-runtime-v2 ls` 결과가 같은지(live에 session이 생기지 않는지) 감시자가 확인한다.
- [ ] **Step 5:** 감시자 검증 후 commit `test(identity): add product name gate`

### Task 2: Identity module과 data directory 별칭

**Files:**
- Create: `src/lib/app-identity.ts`
- Modify: `src/lib/host-paths.ts` (posix `dataDir`만), 아래 34개 data-dir site, `server.ts` (시작 시 `getDataDir()` 호출과 fail closed)
- Test: `tests/unit/lib/app-identity.test.ts`, 기존 `tests/unit/lib/*host-paths*`·upload·governance test 보강

Data-dir site: `src/lib/{approval-audit-store,cli-token,config-store,hook-settings,keybindings-store,layout-store,lock,push-subscriptions,quick-prompts-store,session-history,session-index,session-stats,sidebar-items-store,statusline-script,uploads-store,vapid-keys,workspace-store}.ts`, `src/lib/providers/codex/session-hooks.ts`, `src/lib/runtime/{lifecycle-actions,storage-backup,storage-mirror,storage-read-owner,supervisor}.ts`, `src/lib/runtime/timeline/catalog-service.ts`, `src/lib/stats/{daily-report-builder,facets-parser,stats-cache}.ts`, `src/pages/api/stats/{cache-status,uptime}.ts`, `src/workers/{governance-worker,storage-worker}.ts`, `electron/main.ts:52`(posix 복제 규칙). `bin/cli.js`는 Task 5가 담당한다.

**Interfaces:**
- Produces (`src/lib/app-identity.ts`):
  - `PRODUCT_NAME = 'agentmux'`, `LEGACY_PRODUCT_NAME = 'codexmux'`, `DATA_DIR_NAME = '.agentmux'`, `LEGACY_DATA_DIR_NAME = '.codexmux'`
  - `type TDataDirLayout = { kind: 'fresh' } | { kind: 'legacy-only' } | { kind: 'aliased' } | { kind: 'agentmux-only' } | { kind: 'conflict'; reason: 'both-real' | 'unexpected-symlink' | 'dangling-symlink' | 'not-directory' }`
  - `inspectDataDirLayout(homeDir: string): TDataDirLayout` — sync, `lstat`/`readlink`만, 부수효과 없음
  - `resolveDataDirPath(homeDir: string, env?: NodeJS.ProcessEnv): string` — 부수효과 없음, 생성하지 않음. Override(`AGENTMUX_DATA_DIR`, 없으면 `CODEXMUX_DATA_DIR`) → 그 경로. `legacy-only`·`aliased` → `path.join(homeDir, '.codexmux')`(별칭 한 단계만 풀고 realpath는 쓰지 않는다). `fresh`·`agentmux-only` → `path.join(homeDir, '.agentmux')`. `conflict` → `.codexmux`가 실제 directory면 그 경로, 아니면 `.agentmux` 경로(시작은 `prepareDataDir`가 막는다)
  - `prepareDataDir(options?: { homeDir?: string; env?: NodeJS.ProcessEnv }): string` — sync, **`server.ts` startup에서만 호출**. Override가 있으면 생성만 하고 반환. `fresh`면 실제 `~/.agentmux` 생성(0700), `legacy-only`면 `~/.agentmux` → `.codexmux` 상대 symlink 생성, `conflict`면 `code: 'data-dir-conflict'`와 `reason`을 가진 Error throw. `resolveDataDirPath`와 같은 값 반환
  - `getDataDir(): string` — 호출 시점의 `os.homedir()`와 `process.env`로 `resolveDataDirPath`를 매번 계산한다. Memo하지 않는다
  - `getDisplayDataDir(): string` — `'~/.agentmux'`, override가 있으면 그 경로
  - `getServiceUnitName(): string` — `'agentmux.service'`
- Electron(`electron/main.ts:52`)은 `@/lib`를 import하지 못하므로 같은 posix 규칙을 최소 복제한다: win32는 `.codexmux` 유지, posix는 `.codexmux`가 실제 directory면 그 경로, 아니면 `.agentmux`. Fresh HOME에서 Electron window state가 실제 `.codexmux`를 만들어 다음 실행이 `both-real`이 되는 것을 막는다.

- [ ] **Step 1: Write the failing tests** (`tests/unit/lib/app-identity.test.ts`, 각 test는 `fs.mkdtempSync` HOME 사용)
  - `legacy-only`: 실제 `.codexmux`에 file 2개(0600) → `prepareDataDir({ homeDir })`가 `path.join(homeDir, '.codexmux')`를 반환하고, `.agentmux`가 `.codexmux`를 가리키는 symlink이고, 두 file의 sha256·mode가 그대로
  - 두 번째 `prepareDataDir`는 directory entry와 mtime을 바꾸지 않는다
  - `fresh`: 실제 `.agentmux`만 생기고 `.codexmux`는 없다
  - `both-real`, `.agentmux`가 `/tmp` 다른 곳을 가리킴(`unexpected-symlink`), `.agentmux`가 dangling(`dangling-symlink`), `.codexmux`가 regular file(`not-directory`) → 각각 `code === 'data-dir-conflict'`와 해당 `reason`으로 throw하고 HOME 아래 entry가 변하지 않음 (Review Focus 2)
  - `resolveDataDirPath`를 모든 layout에 대해 단언하고, 호출 전후 HOME 아래 entry가 같다(생성 없음): `legacy-only`·`aliased` → `.codexmux`, `fresh` → `.agentmux`, 각 conflict → 위 규칙
  - HOME 자체가 symlink인 경우에도 `resolveDataDirPath`가 `path.join(homeDir, '.codexmux')` 문자열을 그대로 반환한다(realpath 미사용)
  - `AGENTMUX_DATA_DIR=/x` 또는 `CODEXMUX_DATA_DIR=/x`만 있을 때 `resolveDataDirPath`가 `/x`
  - 같은 test file 안에서 HOME을 바꾸고 `vi.resetModules()` 뒤 다시 import하면 `getDataDir()`가 새 HOME 기준이다(memo 없음)
- [ ] **Step 2:** `corepack pnpm exec vitest run tests/unit/lib/app-identity.test.ts` → FAIL
- [ ] **Step 3:** `src/lib/app-identity.ts` 구현. `server.ts` `start()`는 첫 동작으로 `prepareDataDir()`를 호출하고, `data-dir-conflict`면 reason과 두 경로를 stderr에 쓴 뒤 exit 1.
- [ ] **Step 4:** 34개 site의 `path.join(os.homedir(), '.codexmux')`(및 `HOME || cwd` 변형)를 `getDataDir()`로 바꾸고, `host-paths.ts` posix 분기는 `resolveDataDirPath(homeDir, env)`를 쓴다(logger가 import 시점에 log dir을 만들므로 이 값이 layout별로 정확해야 한다). Win32 분기는 그대로 둔다. Electron은 위 posix 복제 규칙을 적용한다.
- [ ] **Step 4a: 생성 script 안의 경로.** `src/lib/hook-settings.ts:24`의 bridge template과 `src/lib/statusline-script.ts:9-10`의 `$HOME/.codexmux/...`는 문자열 template이라 Step 4가 닿지 않는다. 생성 시점의 `getDataDir()` 값을 JSON 문자열(bridge)과 shell quote(statusline)로 박는다. Test: fresh layout HOME에서 생성한 bridge가 `.agentmux/port`를 읽어 loopback stub에 요청하고, legacy layout에서는 `.codexmux/port`를 읽는다(`tests/unit/lib/status-hook-bridge.test.ts` 보강).
- [ ] **Step 5: 호환 test 추가**
  - `uploads-store`: legacy-only layout HOME에서 upload commit이 성공하고 file이 실제 `.codexmux/uploads/` 아래에 생긴다
  - Governance worker service: `backupRoot = path.join(getDataDir(), 'backups', 'governance-actions')`에 전환 전 형식의 `action.json`(preimagePath가 실제 `.codexmux` 경로)이 있어도 `writeState`가 `ready`
- [ ] **Step 6:** `corepack pnpm exec vitest run tests/unit/lib` → PASS, `corepack pnpm tsc --noEmit` → 0 error
- [ ] **Step 7:** 감시자 검증 후 commit `feat(identity): resolve data directory through agentmux alias`

### Task 3: Legacy env 이중화

**Files:**
- Create: `src/lib/legacy-env.ts`, `src/lib/legacy-env-bootstrap.ts`
- Modify: `server.ts`(첫 import), `src/workers/*.ts` 다섯 개(첫 import), `src/`·`server.ts`의 `CODEXMUX_*` 읽기를 `AGENTMUX_*`로, 이에 기대는 test의 env 설정
- Test: `tests/unit/lib/legacy-env.test.ts`

**Interfaces:**
- Produces: `normalizeLegacyEnv(env: NodeJS.ProcessEnv, warn?: (message: string) => void): string[]` — 짝: `CODEXMUX_<X>`↔`AGENTMUX_<X>`, `CMUX_PORT`↔`AMUX_PORT`, `CMUX_TOKEN`↔`AMUX_TOKEN`. 한쪽만 있으면 다른 쪽에 복사한다. 둘 다 있고 값이 다르면 legacy를 새 값으로 덮고, 값은 빼고 key 이름만 넣어 `warn`을 한 번 호출한다. 바뀐 key 목록을 반환한다. `__CMUX_*`는 건드리지 않는다.
- `legacy-env-bootstrap.ts`: `normalizeLegacyEnv(process.env, (m) => console.warn(m))` side-effect만.

- [ ] **Step 1: Write the failing tests**
  - `{ CODEXMUX_RUNTIME_V2: '1' }` → `AGENTMUX_RUNTIME_V2 === '1'`, 반환값 `['AGENTMUX_RUNTIME_V2']`
  - `{ AGENTMUX_GOVERNANCE_WRITES: '1' }` → `CODEXMUX_GOVERNANCE_WRITES === '1'`
  - `{ AGENTMUX_RUNTIME_DB: '/a', CODEXMUX_RUNTIME_DB: '/b' }` → 둘 다 `/a`, warn 1회, warn 문자열에 `/a`·`/b`가 없음
  - `{ CMUX_TOKEN: 't' }` → `AMUX_TOKEN === 't'`
  - `{ __CMUX_APP_DIR: '/x' }` → 변화 없음
- [ ] **Step 2:** `corepack pnpm exec vitest run tests/unit/lib/legacy-env.test.ts` → FAIL
- [ ] **Step 3:** 구현 후 `server.ts`와 다섯 worker 진입점의 **첫 import**로 `legacy-env-bootstrap`을 넣는다(ESM import hoisting 때문에 일반 문장이 아니라 import여야 한다).
- [ ] **Step 4:** `git grep -n "CODEXMUX_" -- src server.ts`의 읽기를 `AGENTMUX_`로 바꾼다. 별도 process로 server를 띄우는 `scripts/`, `electron/`, `tests/integration/`은 이중화로 동작한다. 다만 bootstrap 없이 같은 process에서 src를 import하는 `scripts/smoke-runtime-v2-storage-default-read.ts:81-83,147,150`과 `scripts/smoke-runtime-v2-storage-write.ts:57-58`은 env 쓰기를 새 이름으로 바꾼다. Unit test가 env를 설정한다면 새 이름으로 맞춘다.
- [ ] **Step 5:** `corepack pnpm test` → PASS, `corepack pnpm tsc --noEmit` → 0 error
- [ ] **Step 6:** 감시자 검증 후 commit `feat(identity): mirror legacy CODEXMUX env names`

### Task 4: Cookie와 CLI header 호환

**Files:**
- Modify: `src/lib/auth.ts`, `server.ts`, `src/lib/require-auth.ts`, `src/lib/runtime/api-auth.ts`, `src/lib/upload-request-auth.ts`, `src/proxy.ts`, logout route, `src/lib/cli-token.ts`, `src/lib/hook-settings.ts`, `src/lib/permission-prompt.ts:94`, `src/lib/runtime/lifecycle-control.ts:195`
- Test: `tests/unit/lib/{auth,cli-token,upload-request-auth}.test.ts`, permission-prompt redaction test

**Interfaces:**
- Produces (`auth.ts`): `SESSION_COOKIE = 'agentmux-session-token'`, `LEGACY_SESSION_COOKIE = 'codexmux-session-token'`, `readSessionTokenCandidates(cookieHeader: string | undefined): string[]`(새 이름 먼저, 빈 값과 중복 제외), `verifySessionCookies(cookieHeader: string | undefined): Promise<JWTPayload | null>`(첫 번째로 검증되는 후보), `buildClearCookieHeaders(secure: boolean): string[]`(두 이름). `buildCookieHeader`는 새 이름만 발급한다.
- Produces (`cli-token.ts`): `CLI_TOKEN_HEADER = 'x-agentmux-token'`, `LEGACY_CLI_TOKEN_HEADER = 'x-cmux-token'`, `readCliTokenHeader(headers: IncomingHttpHeaders | Headers): string | undefined`(새 header 우선)

- [ ] **Step 1: Write the failing tests**
  - Legacy cookie만 있는 request → 인증 성공, 응답 `Set-Cookie`는 `agentmux-session-token=`이고 legacy 삭제 header가 없다
  - 새 cookie는 다른 secret으로 서명, legacy cookie는 유효 → `verifySessionCookies`가 payload 반환 (Review Focus 1)
  - `session-token=<valid>`만 있음 → 인증 실패 (ADR-029 유지)
  - Logout → `buildClearCookieHeaders`가 두 이름 모두 `Max-Age=0`
  - `x-cmux-token`만, `x-agentmux-token`만 → 둘 다 CLI 인증 성공. 둘 다 있고 다르면 새 header 값을 쓴다
  - 생성된 hook bridge 내용에 `x-agentmux-token`이 있다
  - Redaction: `x-agentmux-token: abc`와 `x-cmux-token=abc` 모두 값이 가려진다
  - Runtime v2 WebSocket·upload auth fixture가 legacy cookie로 통과
- [ ] **Step 2:** 해당 test 실행 → FAIL
- [ ] **Step 3:** 구현하고 6개 cookie site와 5개 header site(`cli-token.ts:50`, `runtime/api-auth.ts:62,101`, `upload-request-auth.ts:104`, `proxy.ts:12`)가 helper만 쓰게 바꾼다. `runtime/api-auth.ts:21-31`의 금지 query 집합에는 cookie 두 이름과 header 두 이름을 모두 넣는다.
- [ ] **Step 4:** `corepack pnpm exec vitest run tests/unit/lib` → PASS
- [ ] **Step 5:** 감시자 검증 후 commit `feat(auth): accept legacy codexmux cookie and CLI header`

### Task 5: CLI 진입점과 package metadata

**Files:**
- Create: `bin/agentmux.js` (현재 `bin/codexmux.js` 내용 이동)
- Modify: `bin/codexmux.js`(`require('./agentmux.js')` 한 줄), `bin/cli.js`, `package.json`, `scripts/smoke-npm-package.mjs`와 그 lib, `.github/workflows/npm-publish.yml`
- Test: `tests/unit/scripts/npm-package-contract.test.ts`, `tests/unit/scripts/npm-package-smoke-lib.test.ts`, 새 `tests/unit/bin/cli-env.test.ts`

결정 값:
- `package.json`: `name: "@hardcoremonk/agentmux"`, `version: "0.5.0"`, `bin: { agentmux, amux, codexmux, cmux }` 모두 `bin/agentmux.js`, `publishConfig: { access: "public" }`, `repository.url: git+https://github.com/HardcoreMonk/agentmux.git`, `homepage: https://github.com/HardcoreMonk/agentmux`, `files`에 `bin/` 유지
- `bin/agentmux.js`: `AGENTMUX_CLI`와 `CODEXMUX_CLI`를 모두 `'1'`로 설정
- `bin/cli.js`: usage 첫 줄 `agentmux CLI`, `Usage: agentmux <command>`. Port/token은 `AMUX_PORT || CMUX_PORT`, `AMUX_TOKEN || CMUX_TOKEN`, 없으면 `~/.agentmux/<file>` 다음 `~/.codexmux/<file>`를 읽는다. 요청 header는 `x-agentmux-token`. Environment 절은 `AMUX_PORT`/`AMUX_TOKEN`을 안내하고 legacy 이름을 "legacy alias"로 적는다.

- [ ] **Step 1: Write the failing tests**
  - Package contract: name·bin 4개·version·`publishConfig.access`
  - `cli-env`: env에 `CMUX_PORT`/`CMUX_TOKEN`만 있을 때 child process `node bin/agentmux.js workspaces`가 local stub HTTP server에 `x-agentmux-token: <token>`으로 요청한다 (Review Focus 4)
  - `node bin/codexmux.js help`와 `node bin/agentmux.js help`의 stdout이 같고 첫 줄이 `agentmux CLI`
- [ ] **Step 2:** test 실행 → FAIL
- [ ] **Step 3:** 구현. npm smoke lib은 tarball 이름 `hardcoremonk-agentmux-0.5.0.tgz`와 bin 4개를 기대하도록 바꾸고, smoke server env에 `TMUX_TMPDIR=<임시 HOME>/tmux`를 넣는다(`scripts/smoke-npm-package.mjs:105-130`, 선례 `scripts/smoke-upload-integrity-lib.mjs:87`).
- [ ] **Step 4:** test → PASS. `corepack pnpm smoke:npm-package`는 승인 대상이므로 감시자가 실행한다.
- [ ] **Step 5:** 감시자 검증 후 commit `feat(cli): ship agentmux and amux entry points`

### Task 6: tmux 서버 scope 편입

**Files:**
- Create: `src/lib/tmux-server-scope.ts`, `scripts/adopt-tmux-server-scope.ts`, `scripts/smoke-tmux-scope-isolation.ts`
- Modify: `src/lib/tmux.ts`(`createSession`), `src/lib/runtime/terminal/terminal-worker-runtime.ts`(new-session 경로), `server.ts`(startup), `package.json`(`smoke:tmux-scope`)
- Test: `tests/unit/lib/tmux-server-scope.test.ts`, 기존 `tests/unit/lib/runtime/terminal-worker-runtime.test.ts` 보강

**Interfaces:**
- Produces:
  - `shouldIsolateTmuxServer(env: NodeJS.ProcessEnv): boolean` — `INVOCATION_ID`가 있고, `NODE_ENV === 'production'`이고, `AGENTMUX_TMUX_SCOPE !== 'off'`. Test나 dev 실행이 host systemd에 scope를 만들지 않게 하는 조건이다.
  - `tmuxScopeUnitName(socketName: string): string` → `` `agentmux-tmux-${socketName}.scope` ``
  - `type TAdoptResult = { status: 'adopted' | 'already-isolated' | 'skipped' | 'failed'; pid?: number; reason?: string }`
  - `interface ITmuxScopeDeps { getServerPid(socket: string): Promise<number | null>; readCgroup(pid: number): Promise<string | null>; startTransientScope(unit: string, pid: number): Promise<void> }`
  - `adoptTmuxServerIntoScope(socketName: string, deps?: Partial<ITmuxScopeDeps>): Promise<TAdoptResult>` — throw하지 않는다. Server가 없으면 `skipped`. Cgroup이 `/${unit}`로 끝나면 `already-isolated`. 그 밖에는 scope를 시작한다. `StartTransientUnit`은 job을 queue한 뒤 응답하므로, 성공 응답 뒤 cgroup이 `/${unit}`로 끝날 때까지 100ms 간격으로 최대 5초 다시 읽는다. 옮겨지면 `adopted`, 시간을 넘기면 `failed`. 시작이 reject되면 cgroup을 다시 읽어 이미 편입됐으면 `already-isolated`, 아니면 `failed`.
  - `ensureTmuxServerIsolation(): Promise<TAdoptResult[]>` — `shouldIsolateTmuxServer(process.env)`일 때 두 socket에 adopt
- 기본 deps: pid는 `tmux -L <socket> display-message -p '#{pid}'`, cgroup은 `/proc/<pid>/cgroup`의 `0::` 줄, scope는 `busctl --user call org.freedesktop.systemd1 /org/freedesktop/systemd1 org.freedesktop.systemd1.Manager StartTransientUnit 'ssa(sv)a(sa(sv))' <unit> fail 2 PIDs au 1 <pid> CollectMode s inactive-or-failed 0`. Process 조회는 이 module 안에만 둔다.

- [ ] **Step 1: Write the failing tests** (deps 주입)
  - 다른 cgroup의 pid → `startTransientScope('agentmux-tmux-codexmux.scope', pid)` 호출, `adopted`
  - Cgroup이 `.../agentmux-tmux-codexmux.scope` → 호출 없이 `already-isolated`
  - Server 없음 → `skipped`
  - `startTransientScope` reject 뒤 cgroup이 그대로 → `failed`(reason 포함), reject 뒤 이미 편입 → `already-isolated`
  - `startTransientScope`는 resolve했지만 cgroup이 5초 동안 바뀌지 않음(fake timer) → `failed`. 세 번째 읽기에서 바뀜 → `adopted`
  - `shouldIsolateTmuxServer({})` false, `{ INVOCATION_ID: 'x', NODE_ENV: 'production' }` true, `{ INVOCATION_ID: 'x', NODE_ENV: 'test' }` false, `{ INVOCATION_ID: 'x', NODE_ENV: 'production', AGENTMUX_TMUX_SCOPE: 'off' }` false
  - `createSession`: isolation이 켜졌고 adopt가 `failed`여도 resolve하고 warn log만 남긴다 (Review Focus 3)
- [ ] **Step 2:** `corepack pnpm exec vitest run tests/unit/lib/tmux-server-scope.test.ts` → FAIL
- [ ] **Step 3:** module 구현. `createSession`과 runtime v2 new-session 뒤 isolation이 켜져 있으면 adopt하고, `server.ts`는 startup에서 `ensureTmuxServerIsolation()`을 부른다.
- [ ] **Step 4:** `scripts/adopt-tmux-server-scope.ts --socket <name> [--dry-run]`: `shouldIsolateTmuxServer`와 무관하게 adopt하고 `TAdoptResult` JSON을 출력한다. `failed`면 exit 1, dry-run은 pid와 현재 cgroup만 출력한다.
- [ ] **Step 5:** `scripts/smoke-tmux-scope-isolation.ts` 리허설: socket `agentmux-smoke-<random>`(이름이 `codexmux`로 시작하면 즉시 abort). `systemd-run --user --unit=agentmux-smoke-<random> -- /bin/sh -c 'tmux -L <sock> -f /dev/null new-session -d -s smoke "sleep 600"; exec sleep infinity'`로 live 구조(main process + daemon tmux)를 재현한다. 서버 pid와 pane pid를 기록하고 adopt → `systemctl --user stop <unit>` → 서버 pid 생존, `has-session -t smoke` 성공, scope active를 단언한다. 끝나면 `kill-server`와 unit 정리. `package.json` `smoke:tmux-scope`.
- [ ] **Step 6:** unit test → PASS. Smoke는 감시자가 실행한다.
- [ ] **Step 7:** 감시자 검증 후 commit `feat(tmux): run tmux server outside the web service cgroup`

### Task 7: 자동 재개 범위

`server.ts:470-472`는 `initWorkspaceStore()`를 `autoResumeOnStartup()`보다 먼저 부르고, legacy storage 경로에서는
`crossCheckLayout`(`src/lib/layout-store.ts:212-220`)이 사라진 codex tab session을 미리 다시 만든다. 그래서
"`executeAutoResume`이 이번 호출에서 만든 session"으로 판정하면 reboot 뒤 재개가 사라진다. 판정 기준은
**startup 시작 시점에 없던 session**이다.

**Files:**
- Modify: `src/lib/auto-resume.ts:84-114`, `server.ts` startup 순서
- Test: `tests/unit/lib/auto-resume.test.ts` (`vi.mock('@/lib/tmux')`)

**Interfaces:**
- Consumes: `listSessions(): Promise<string[]>` (`src/lib/tmux.ts:20`)
- Produces: `autoResumeOnStartup(options: { preexistingSessions: ReadonlySet<string> }): Promise<void>`, `executeAutoResume(targets: IAutoResumeTarget[], preexistingSessions: ReadonlySet<string>): Promise<{ created: string[]; resumed: string[] }>` — `preexistingSessions`에 있던 session에는 resume을 보내지 않는다. `server.ts`는 `scanSessions()` 직후, `initWorkspaceStore()` 전에 `new Set(await listSessions())`를 잡아 넘긴다. `/api/tmux/reset` 경로는 빈 set을 넘겨 현재 동작을 유지한다.

- [ ] **Step 1: Write the failing tests**
  - `preexistingSessions`에 target 3개 중 2개가 있음 → `sendKeys` 1회(없던 session), 반환 `resumed`가 그 이름 하나 (Review Focus 5)
  - Target session은 모두 이미 존재하지만(`crossCheckLayout`이 방금 만듦) `preexistingSessions`는 비어 있음 → 3개 모두 resume (reboot 경로)
  - `preexistingSessions`에 모두 있음 → `sendKeys` 0회
- [ ] **Step 2:** `corepack pnpm exec vitest run tests/unit/lib/auto-resume.test.ts` → FAIL
- [ ] **Step 3:** 구현. `docs/STATUS.md`나 `docs/TMUX.md`의 재개 설명을 새 규칙으로 고친다.
- [ ] **Step 4:** test → PASS
- [ ] **Step 5:** 감시자 검증 후 commit `fix(resume): only resume tabs whose tmux session was recreated`

### Task 7a: 운영 식별자 (unit 이름과 health/lock)

`codexmux.service`가 `src/lib/runtime/lifecycle-actions.ts:74-78`(restart action과 확인 문구),
`src/lib/runtime/lifecycle-control.ts:308`, `scripts/deploy-local.mjs:60`, `scripts/lifecycle-rollback-dry-run-lib.mjs:16,44-58`에
박혀 있다. 그대로 두면 전환 뒤 UI restart나 `deploy:local`이 disable된 rollback unit을 띄운다. `src/lib/lock.ts:57`은
`/api/health`의 `app === 'codexmux'`로 실행 중 server를 판별한다(`src/lib/build-info.ts:11,43`).

**Files:**
- Modify: 위 네 파일, `src/lib/lock.ts`, `src/lib/build-info.ts`, `scripts/write-build-info.mjs:23`
- Test: `tests/unit/lib/runtime-lifecycle-actions.test.ts`, `tests/unit/scripts/lifecycle-rollback-dry-run-lib.test.ts`, lock test

**Interfaces:**
- Consumes: `getServiceUnitName()` (Task 2)
- Produces: health payload `{ app: 'codexmux', product: 'agentmux', ... }` — `app`은 옛 build lock 호환을 위해 유지하고 `product`를 추가한다. `lock.ts`의 판별은 `data.app === 'codexmux' || data.product === 'agentmux'`.

- [ ] **Step 1: Write the failing tests** — restart action의 args가 `['--user', 'restart', 'agentmux.service']`이고 확인 문구가 `restart agentmux.service`. Rollback dry-run lib이 `agentmux.service`를 대상으로 한다. Lock은 `{ app: 'codexmux' }`와 `{ app: 'codexmux', product: 'agentmux' }` 응답 모두를 살아 있는 holder로 본다.
- [ ] **Step 2:** test 실행 → FAIL
- [ ] **Step 3:** 구현하고 `scripts/deploy-local.mjs`도 `agentmux.service`를 쓴다.
- [ ] **Step 4:** test → PASS
- [ ] **Step 5: `src/lib`·`src/hooks` 분류.** `git grep -n -i codexmux -- src/lib src/hooks scripts/deploy-local.mjs 'scripts/lifecycle-*'`(현재 64개 file 163건)를 agy가 `rename`/`preserve(이유)`로 분류해 보고한다. 감시자가 분류를 승인한 뒤에 `rename` 항목만 바꾼다. 사용자에게 보이는 문자열(notification title, error message, log banner)은 `rename`, 보존 식별자 표에 있는 것은 `preserve`다.
- [ ] **Step 6:** 감시자 검증 후 commit `fix(ops): target agentmux.service and keep lock compatibility`

### Task 8: 화면과 platform 표시 이름

**Files:**
- Modify: `messages/**`, `src/components/**`, `src/pages/**`(`src/pages/api/manifest.ts` 포함), `server.ts` startup banner, notification·Web Push title, `public/**` text, `capacitor.config.ts`(`appName`), `android/app/src/main/res/values/strings.xml`(`app_name`, `title_activity_main`), Electron 화면 문자열(`appId`/`productName`/`CONFIG_DIR`는 유지)
- Test: 이름이 박힌 기존 snapshot·component test

- [ ] **Step 1:** `corepack pnpm check:product-name`에서 Task 8 대상 경로의 위반 목록을 기록한다.
- [ ] **Step 2:** 목록과 `git grep -n -i "'codexmux'\|\"codexmux\"" -- src`에서 사용자에게 보이는 문자열을 `agentmux`로 바꾼다. 제품 정의 문구는 "코딩 에이전트 웹 세션 매니저 (현재 Codex 지원, Claude Code 지원 예정)" 의미를 쓰고 Claude 지원을 현재 기능처럼 쓰지 않는다. 한국어/영어 message를 같이 바꾼다.
- [ ] **Step 3:** `corepack pnpm check:product-name`에서 Task 8 경로의 위반이 0이고, `corepack pnpm test` → PASS
- [ ] **Step 4:** 감시자 검증 후 commit `feat(ui): rename visible product name to agentmux`

### Task 9: 문서, ADR, landing site

**Files:**
- Modify: root `README.md`·`AGENTS.md`·`CLAUDE.md`·`CONTEXT.md`·`DESIGN.md`, Task 1 scan 목록의 `docs/*.md`, `docs/agents/*.md`, `docs/ADR.md`, `landing-src/**`, `eleventy.config.*`(`pathPrefix: '/agentmux/'`, docs prefix), `landing-src/_data/site.js`(`baseUrl`), `scripts/check-landing-site.mjs`와 그 test
- Test: `tests/unit/scripts/landing-site-check.test.ts`, `corepack pnpm check:project-design`

- [ ] **Step 1:** `docs/ADR.md`: header 문장을 agentmux로 고치고 ADR-033(이름 변경과 legacy alias, Draft), ADR-034(tmux 서버 systemd scope 분리, Draft)를 추가한다. ADR-029와 ADR-030은 본문을 다시 쓰지 않고 "2026-11-09 갱신" 항목으로 cookie 이름·legacy 읽기, npm package 이름만 덧붙인다.
- [ ] **Step 2:** `CONTEXT.md` 제품 정체성·용어 표, `docs/agents/domain.md` 용어(거부 용어에 "현재 제품명으로서 codexmux" 추가), `docs/PROJECT-DESIGN.md`, `docs/DATA-DIR.md`(별칭과 경로 해석 규칙, 후속 이전), `docs/SYSTEMD.md`(`agentmux.service` 예시, ExecStart `bin/agentmux.js`, `AGENTMUX_*` drop-in, tmux scope 분리와 의도적 종료 방법, KillMode 주의 대체), `docs/TMUX.md`(scope와 multi-socket), `README.md`(설치 `npm i -g @hardcoremonk/agentmux`, 옛 `codexmux` global package 먼저 제거 안내, 호환 표)를 갱신한다.
- [ ] **Step 3:** Landing: canonical·sitemap·내부 link를 `https://hardcoremonk.github.io/agentmux/`로, 화면 문구를 agentmux로 바꾼다. Checker 기대값도 맞춘다.
- [ ] **Step 4:** `corepack pnpm check:product-name` → exit 0, `corepack pnpm check:project-design` → 통과, `corepack pnpm build:landing && corepack pnpm check:landing` → 통과
- [ ] **Step 5:** 감시자 검증 후 commit `docs: rename product documentation to agentmux`

### Task 10: 전체 gate

- [ ] `corepack pnpm lint` → error 0 (기존 경고 6건 외 신규 경고 0)
- [ ] `corepack pnpm tsc --noEmit` → 0 error
- [ ] `corepack pnpm test` → 전부 통과
- [ ] `corepack pnpm build` → 성공, `dist/server.js`와 다섯 worker bundle 생성
- [ ] `corepack pnpm build:electron:main` → 성공 (Electron은 Linux에서 가능한 build까지만)
- [ ] `corepack pnpm check:product-name`, `check:project-design`, `build:landing`, `check:landing` → 통과
- [ ] `git diff --check` → 출력 없음
- [ ] 감시자: `corepack pnpm smoke:tmux-scope`, `corepack pnpm smoke:npm-package` 실행. 격리 HOME + `TMUX_TMPDIR=<임시>/tmux` + 빈 PORT로 legacy layout production server를 띄워 legacy cookie 접속, upload, `writeState=ready`를 확인한다. 같은 HOME·`TMUX_TMPDIR`로 옛 checkout의 **기존 `dist`**를 실행해 rollback 경로를 확인한다(옛 checkout은 build하지 않는다). 리허설 전후 `tmux -L codexmux ls`와 `tmux -L codexmux-runtime-v2 ls` 결과가 같아야 한다.

---

## Release (감시자 수행, 각 단계 직전 사용자 확인)

1. **Live 전환** (Codex turn이 없는 시점): 새 checkout에서 `corepack pnpm build` → `codexmux`와 `codexmux-runtime-v2` **두 socket 모두** `corepack pnpm exec tsx scripts/adopt-tmux-server-scope.ts --socket <name> --dry-run` 확인 → 실제 실행 → 두 결과가 모두 `adopted`·`already-isolated`·`skipped` 중 하나이고, 살아 있는 서버마다 `/proc/<pid>/cgroup`이 `agentmux-tmux-<socket>.scope`로 끝나며 `systemctl --user is-active agentmux-tmux-<socket>.scope`가 `active`인지 확인한다. 하나라도 아니면 멈추고 사용자에게 보고한다 → `systemctl --user stop codexmux.service && systemctl --user disable codexmux.service`(unit 파일과 drop-in 유지) → `~/.config/systemd/user/agentmux.service`(`WorkingDirectory=/data/projects/agentcode-zone/agentmux`, `ExecStart=<node> /data/projects/agentcode-zone/agentmux/bin/agentmux.js`, 나머지는 현 unit과 동일)와 `agentmux.service.d/`(live drop-in 값을 `AGENTMUX_*` 이름으로) 설치 → `daemon-reload`, `enable --now agentmux.service` → tmux 서버 pid 불변, 재로그인 없는 접속, 기존 terminal attach, 전환 전 시작한 Codex session의 status update, Session Catalog, governance `writeState=ready` 확인. 한 번 더 `systemctl --user restart agentmux.service`를 해서 pid 불변을 확인한다.
2. **Rollback 기준**: 위 확인 중 하나라도 실패하면 `agentmux.service`를 stop/disable하고 `codexmux.service`를 enable/start한다. 알려진 rollback 비용: 옛 build의 자동 재개는 살아 있는 session에도 resume을 보내므로(`src/lib/auto-resume.ts:84-101`), shell prompt 상태인 Codex tab에 `codex resume <id>`가 입력된다. Rollback 실행 전에 사용자에게 이 비용을 알리고 handoff에 기록한다.
3. **GitHub**: repo rename `HardcoreMonk/codexmux` → `HardcoreMonk/agentmux`, local remote URL 갱신, branch push와 PR/merge. Landing은 rename 뒤에만 배포한다(`pathPrefix`가 `/agentmux/`라 rename 전 배포는 live site를 깨뜨린다). Pages 배포 뒤 desktop/mobile HTTPS smoke를 한다.
4. **npm**: `@hardcoremonk/agentmux@0.5.0` publish와 registry install smoke, `npm deprecate codexmux "moved to @hardcoremonk/agentmux"`. npm 인증은 사용자가 수행한다.
5. **인벤토리와 인계**: `/data/projects/agentcode-zone/ops/projects.yaml`, `ops/units.yaml`(`agentmux.service`, tmux scope), `wiki/entities/`에 agentmux 항목. `docs/operations/YYYY-MM-DD-agentmux-rename-handoff.md`에 전환·rollback 증거와 `Next Action`(data 실제 이전 후속 spec, 프로젝트 2)을 기록한다.
