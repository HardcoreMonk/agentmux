# Claude Code Provider 단계 3: 공통 agent 화면 Implementation Plan

> **For agentic workers:** 구현은 Herdr pane의 agy가 task 단위로 맡고(agy 한도가 없을 때는 Claude subagent), Claude가 task마다 diff·test로 검증하고 독립 검토를 돌린다(사용자 결정 2026-11-10). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude Code와 Codex를 같은 수준으로 다루는 공통 agent 화면을 마무리한다. 지난 세션 통합 목록, Session Explorer와 통계·일일 리포트의 Claude 포함, agent 전환 잠금과 보기 제안, 시작 진행 표시, Claude 설정 화면, provider별 onboarding, provider 중립 문구를 만든다.

**Architecture:** 단계 2가 만든 provider 계약(`claude`/`codex`, id == panel type)과 metadata 표 위에서 화면과 목록을 provider별로 넓힌다. 서버 목록·catalog·통계는 provider를 데이터에 담고(`providerId`/`provider` column), 화면은 `AGENT_PROVIDER_META`의 icon·label로 구분한다. 탭 종류 전환은 `updateTabPanelType` 한 곳에서 막고 허용한다.

**Tech Stack:** TypeScript, Next.js Pages Router custom server, Runtime v2 workers(zod IPC), better-sqlite3, zustand, next-intl(ko/en), shadcn/ui, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-claude-code-provider-design.md` (3절 "공통 agent 기반 (B)", "단계와 배포" 3번, 인수 기준 5·7·8·9)

**Base:** main `f46890ba`(단계 2 merge). 작업 branch `feat/claude-provider-phase3`, worktree `/data/projects/agentcode-zone/agentmux/.worktrees/claude-provider-phase3`.

## 단계 3 범위

| 항목 | Task |
| --- | --- |
| Agent 탭 지난 세션 목록: Claude + Codex 합치기, provider 표시·filter, 다른 provider 세션 재개 | 1, 2 |
| Session Explorer: provider column, Claude projector, provider filter | 3, 4 |
| 통계·일일 리포트: Claude token(model별), 비용 추정 없음, 리포트 생성기 fallback | 5 |
| Agent 전환 잠금, Terminal 탭의 agent 보기 제안 | 6 |
| 시작 진행 표시, bypass·trust 카드가 진행 표시를 대체 | 7 |
| Claude 설정 화면, terminal 기본 표시 설정 provider 공통화 | 8 |
| Onboarding·`/tools-required` provider별 상태 | 9 |
| Codex 고정 문구를 `{agent}` 문구로, 보기 전환 짧은 label | 10 |
| 문서, gate, browser·live 확인 | 11 |
| 위임 안내, `permissions.allow`, CLI 변경 | 단계 4 |

## Global Constraints

- 사용자 `~/.claude/`, `~/.claude.json`, `~/.codex/` 파일은 읽기만 한다(존재 확인과 transcript·pidfile 읽기). 쓰거나 지우지 않는다.
- Codex 동작은 바뀌지 않는다. 특히 Codex 지난 세션 목록은 지금처럼 cwd와 관계없이 보인다(`tests/unit/lib/session-list.test.ts:22`가 고정). Claude 세션만 그 탭의 cwd project directory 기준으로 더한다(Claude transcript는 project directory별로 저장된다).
- Agent 탭은 Runtime v1 탭이다. Runtime v2 탭에서 agent 보기 전환은 단계 1 guard가 막는다. 보기 제안은 v1 탭에서만 띄운다.
- 비용 추정은 하지 않는다(spec 판단). 가격이 없는 model은 비용 칸에 `—`를 보이고 합계에 넣지 않는다.
- 화면: provider는 icon + text label(색 하나로 구분 금지), 44px 이상 touch target, active·focus-visible, DOM-safe(`innerHTML`, `dangerouslySetInnerHTML` 금지), 새 문구는 `messages/ko`와 `messages/en`에 함께, 한국어 `word-break: keep-all`.
- `AGENTS.md`: Pages Router, `"use client"` 금지, `@/` import, 소문자-dash 파일명, arrow function, `I`/`T` 접두사, `pgrep`/`ps`/`lsof` 직접 호출 금지, 공유 singleton은 `globalThis` guard.
- Runtime v2 IPC zod schema를 바꾸면 main과 worker 양쪽 test를 갱신한다. strict schema에 필드를 더할 때 test로 고정한다.
- 공개 repo: test fixture는 합성 데이터만.
- 명령은 `corepack pnpm ...`. 전체 test는 임시 `TMUX_TMPDIR`로. Commit은 Conventional Commits, 본문 끝 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, `--no-verify` 금지, push 금지.
- **작업 위치**: worktree `/data/projects/agentcode-zone/agentmux/.worktrees/claude-provider-phase3`만 쓴다. Live checkout `/data/projects/agentcode-zone/agentmux`, port 8122, `~/.codexmux`, 기본 tmux socket directory는 건드리지 않는다.

## Review Focus

1. Codex만 쓰던 사용자의 Codex 지난 세션 목록이 단계 3 뒤에도 같은 순서·같은 개수로 보인다 → Task 1 `session-list.test.ts` 기존 case 유지.
2. 기존 Session Catalog DB(provider column 없음)에서 시작해도 서버가 열리고, rebuild 뒤 Codex 세션 수가 같고 Claude 세션이 더해진다 → Task 3 `session-catalog/schema.test.ts` migration case, `timeline-catalog-service.test.ts`.
3. Claude transcript에서 같은 assistant 응답이 여러 줄로 기록돼도 token이 한 번만 세어진다 → Task 5 `stats-claude.test.ts`.
4. 작업 중(busy·needs-input)인 Codex 탭을 CLAUDE 보기로 바꾸려 하면 막히고, 화면 전환 상태와 보낼 입력이 남지 않는다 → Task 6 `use-layout-panel-type.test.ts`.
5. Claude만 설치된 호스트에서 onboarding이 Codex 설치를 요구하지 않고 끝난다 → Task 9 `onboarding-preflight.test.ts`.

---

### Task 1: 지난 세션 목록 서버 — Claude 합치기와 provider 표시

**Files:**
- Modify: `src/types/timeline.ts:455` (`ISessionMeta`), `src/lib/session-list.ts`, `src/lib/runtime/ipc.ts:76-84,373` (`timelineSessionMetaSchema`, list payload), `src/lib/runtime/contracts.ts:142-150`, `src/lib/runtime/timeline/worker-service.ts:173`, `src/pages/api/timeline/sessions.ts`, `src/pages/api/v2/timeline/sessions.ts`
- Create: `src/lib/providers/claude/session-list.ts`
- Test: `tests/unit/lib/session-list.test.ts`, `tests/unit/lib/claude-session-list.test.ts`(create), `tests/unit/pages/timeline-sessions.test.ts`, `tests/unit/lib/runtime/timeline-worker-service.test.ts`, `tests/unit/lib/runtime/ipc.test.ts`

**Interfaces:**
- Produces:
  - `ISessionMeta`에 `providerId?: TAgentPanelType` 추가. Codex 항목은 `'codex'`, Claude 항목은 `'claude'`.
  - `timelineSessionMetaSchema`에 `providerId`와 기존 `relationship`(지금 v2 경로에서 빠지는 필드)을 더한다.
  - `src/lib/providers/claude/session-list.ts`: `export const listClaudeSessionsForCwd = (cwd: string, homeDir?: string): Promise<ISessionMeta[]>`
    - `<home>/.claude/projects/<toClaudeProjectName(cwd)>/*.jsonl`(파일 이름이 UUID인 것만, `agent-*`·하위 directory 제외)을 읽는다.
    - 항목: `sessionId`(파일 이름), `startedAt`(첫 timestamp), `lastActivityAt`(파일 mtime과 마지막 timestamp 중 늦은 것), `firstMessage`(첫 user 텍스트, `isMeta`·명령 래퍼 제외, 200자), `turnCount`(user 텍스트 줄 수), `cwd`, `jsonlPath`, `providerId: 'claude'`.
    - 큰 파일은 앞 64 KB와 뒤 64 KB만 읽는다. 결과는 파일 mtime·size 기준으로 메모한다(`globalThis` guard).
  - `listSessionPage(tmuxSession, cwdHint, panelType, { offset, limit, providers? })`:
    - `providers` 기본은 `['codex', 'claude']`.
    - Codex 목록은 지금 index 그대로(cwd 무관)이고 `providerId: 'codex'`를 붙인다.
    - Claude 목록은 `cwdHint`(없으면 tmux session cwd)로 `listClaudeSessionsForCwd`.
    - 둘을 `lastActivityAt` 내림차순으로 합친 뒤 offset/limit으로 자른다. `total`은 합친 개수다.
    - 탭 `panelType`과 관계없이 같은 목록을 돌려준다. 단계 2의 "Claude 탭은 빈 목록"은 이것으로 대체한다.
  - API(`/api/timeline/sessions`, `/api/v2/timeline/sessions`)와 IPC list payload는 optional `providers`(쉼표 구분, `AGENT_PANEL_TYPES` 값만)를 받는다.

- [ ] **Step 1: Write the failing tests**
  - `claude-session-list.test.ts`(임시 HOME):
    - cwd `/tmp/p`의 project dir에 transcript 2개 → 두 항목, 최신순, `firstMessage`와 `turnCount`가 맞다.
    - `agent-x.jsonl`과 UUID가 아닌 이름은 제외된다.
    - 다른 cwd의 transcript는 나오지 않는다.
  - `session-list.test.ts`:
    - 기존 Codex case는 그대로 통과하고 항목에 `providerId: 'codex'`가 붙는다.
    - Codex 2개 + Claude 1개를 합치면 시간순으로 섞이고 `total === 3`이다.
    - `providers: ['claude']`이면 Claude만 나온다.
    - 단계 2의 "does not show Codex sessions in Claude tabs" case는 새 규칙에 맞게 바꾼다(Claude 탭도 합친 목록을 받는다).
  - `ipc.test.ts`: list reply 항목의 `providerId`와 `relationship`이 parse 뒤에도 남는다.
  - `timeline-sessions.test.ts`: `providers=claude` query가 lib/supervisor에 전달된다. 잘못된 값은 무시한다.
- [ ] **Step 2: Run** 위 test → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** 위 test + `tests/unit/lib/runtime/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(sessions): list Claude and Codex sessions together in agent tabs`

---

### Task 2: 지난 세션 목록 화면 — provider 표시, filter, 다른 provider 세션 재개

**Files:**
- Modify: `src/hooks/use-session-list.ts`, `src/components/features/workspace/session-list-view.tsx`, `src/components/features/workspace/session-list-item.tsx`, `src/components/features/workspace/agent-panel.tsx:138,185-201`, `src/components/features/mobile/mobile-agent-panel.tsx:156,205-221`, `src/lib/agent-launch-client.ts`, `messages/{ko,en}/session.json`
- Test: `tests/unit/hooks/use-session-list.test.ts`(있으면 확장, 없으면 생성), `tests/unit/components/session-list-item.test.ts`(create), `tests/unit/lib/session-list-rendering.test.ts`

**Interfaces:**
- Consumes: Task 1 `ISessionMeta.providerId`, API `providers` query
- Produces:
  - `useSessionList({ …, providers?: TAgentPanelType[] })`: reset key에 providers를 넣는다.
  - 목록 위 filter: "전체 / Codex / Claude Code"(segmented, 44px, icon + label). 기본 "전체". 선택은 탭별 `localStorage`에 기억한다(try/catch).
  - 항목에 provider icon + 짧은 label을 둔다(`AgentProviderIcon`, `AGENT_PROVIDER_META[id].label`).
  - 항목 선택:
    - 항목 provider == 탭 panelType: 지금 동작(`openJsonlSession` 또는 `sendResume`)
    - 다르면:
      1. `updateTabPanelType(paneId, tabId, item.providerId)`가 허용될 때만(Task 6의 반환값 `true`) 진행한다.
      2. `requestAgentLaunch({ workspaceId, paneId, tabId, action: 'resume', sessionId })`(서버 실행 API)를 부른다.
      3. `setSessionView(tabId, 'check')`
    - Task 6 전에는 `updateTabPanelType`이 `void`이므로, 이 task는 PATCH 성공 여부를 직접 확인하는 작은 helper(`switchTabToProvider`)로 구현하고 Task 6에서 반환값으로 바꾼다.
  - 실행 중인 agent가 있는 탭(agentProcess true)에서는 다른 provider 세션 선택을 막고 toast를 보인다(`session.switchWhileRunning`, `{agent}`).

- [ ] **Step 1: Write the failing tests**
  - `session-list-item.test.ts`: Claude 항목에 Claude icon과 "Claude Code" label이 보인다.
  - Hook test: providers를 바꾸면 목록을 다시 읽고 query에 `providers=claude`가 들어간다.
  - 선택 helper test: 다른 provider 항목이면 panel type 변경 → 실행 API(resume, 같은 sessionId) 순서로 불린다. 실행 중 탭이면 둘 다 불리지 않고 toast가 뜬다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(ui): show provider and resume either agent from the session list`

---

### Task 3: Session Catalog 서버 — provider column과 Claude projector

**Files:**
- Modify: `src/lib/session-catalog/schema.ts:22-89`, `contracts.ts:16-54,101,137`, `index-repository.ts:45-69,150-212,272`, `query-service.ts:63-76`, `indexer.ts:73`, `src/lib/runtime/timeline/catalog-service.ts:24-188`, `src/workers/timeline-worker.ts:15`, `src/lib/runtime/timeline/worker-service.ts:295`
- Create: `src/lib/session-catalog/claude-jsonl-projector.ts`
- Test: `tests/unit/lib/session-catalog/{schema,contracts,indexer,index-repository,jsonl-projector,query-service}.test.ts`, `tests/unit/lib/session-catalog/claude-jsonl-projector.test.ts`(create), `tests/unit/lib/runtime/timeline-catalog-service.test.ts`

**Interfaces:**
- Produces:
  - `catalog_sessions.provider text not null default 'codex'`
    - 기존 DB에서 열 때 column이 없으면 `alter table … add column`으로 더한다(`pragma table_info`로 확인). 기존 행은 `'codex'`가 된다.
    - `provider`로 거르는 index를 더한다.
  - `ISessionCatalogEntry.provider: TAgentPanelType`, `ISessionSearchQuery.providers?: TAgentPanelType[]`. strict schema·saved filter schema에도 더한다.
  - `projectClaudeJsonl(content, { indexedAt, fallbackEntry?, sequenceOffset? }): ISessionCatalogProjection`
    - `projectCodexJsonl`과 같은 출력 모양이다. `entry.provider: 'claude'`.
    - `projectLabel = basename(cwd)`, `model`은 첫 assistant `message.model`이다.
    - 메시지 record는 user 텍스트와 assistant 텍스트만 담는다. tool 입력과 결과는 담지 않는다.
    - `isMeta`, sidechain, 모르는 줄 종류는 건너뛴다.
  - Catalog service는 root 여러 개를 받는다.
    - 기본 `[{ root: ~/.codex/sessions, provider: 'codex' }, { root: ~/.claude/projects, provider: 'claude' }]`
    - `observeFile`과 `rebuild`는 파일의 root로 projector를 고른다. Claude root에서는 `agent-*`·subagent 하위 directory를 제외한다.
    - `readEntries`는 저장된 `provider`로 `getProvider(provider).readEntriesBefore`를 부른다. 호출자가 넘기는 panelType은 쓰지 않는다.
- [ ] **Step 1: Write the failing tests**
  - Schema: provider column 없는 옛 DB 파일(test에서 옛 SQL로 생성)을 열면 column이 생기고 기존 행이 `'codex'`이다. 두 번 열어도 오류가 없다.
  - Projector: 합성 Claude transcript → entry(provider, projectLabel, model, turn 수)와 user·assistant 텍스트 record. tool 결과 텍스트는 record에 없다.
  - Catalog service:
    - Claude root 파일 `observeFile`이 거절되지 않고 provider `'claude'`로 들어간다.
    - 두 root 밖 경로는 지금처럼 거절된다.
    - `readEntries`가 Claude 세션에 Claude provider를 쓴다.
  - Repository/query: `providers: ['claude']` 검색이 Claude만 돌려준다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + `tests/unit/lib/runtime/` + tsc → PASS
- [ ] **Step 5: Commit** — `feat(catalog): index Claude Code sessions with a provider column`

---

### Task 4: Session Catalog API와 화면, 남은 Codex 고정

**Files:**
- Modify: `src/lib/session-catalog/api-schema.ts:14-33`, `src/pages/api/sessions/*` (특히 `[sessionId]/entries.ts:23`), `src/lib/runtime/ipc.ts:394`, `src/lib/runtime/supervisor.ts:940-946`, `src/lib/runtime/storage-import.ts:80-104,257`, `src/hooks/use-session-catalog.ts:43,184`, `src/components/features/session-explorer/session-explorer.tsx:33-34,197-198,313-317`, `messages/{ko,en}/sessionExplorer.json`
- Test: `tests/unit/pages/session-catalog-api.test.ts`, `tests/unit/lib/runtime/session-catalog-ipc.test.ts`, `tests/unit/lib/runtime/supervisor.test.ts`, `tests/unit/lib/runtime/storage-import.test.ts`, `tests/unit/components/session-explorer.test.ts`

**Interfaces:**
- Consumes: Task 3 provider column, `providers` query
- Produces:
  - API search query에 `providers`(쉼표 구분)를 더한다.
  - entries route와 annotation 검증은 panelType을 넘기지 않는다. `timeline.catalog-read-entries` payload의 `panelType`은 optional로 바꾸고 무시한다(Task 3이 저장된 provider를 쓴다).
  - `storage-import`의 `importAgentSession`은 `tab.panelType`이 agent 종류면 그 값을 쓰고, 아니면 `'codex'`를 쓴다.
  - Explorer: 결과 행에 provider icon + label. filter에 provider 선택(전체/Codex/Claude Code, 44px)을 둔다. `rebuildSafety` 문구는 provider 중립이다.

- [ ] **Step 1: Write the failing tests** — API가 `providers` query를 검색에 넘긴다. entries route가 Claude 세션 항목을 돌려준다(provider mock). storage-import가 claude 탭을 `'claude'`로 넣는다. Explorer 행이 provider label을 그린다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(sessions): filter Session Explorer by agent provider`

---

### Task 5: 통계와 일일 리포트

**Files:**
- Modify: `src/lib/stats/agent-jsonl-files.ts`, `src/lib/stats/jsonl-parser.ts:48-208,247`, `src/lib/stats/stats-cache.ts:24,121,162-283,491-565`, `src/lib/stats/history-parser.ts:37-44`, `src/lib/stats/daily-report-builder.ts:68-328`, `src/types/stats.ts`, `src/lib/model-tokens.ts:9,60,117`, `src/components/features/stats/token-section.tsx:27-147`, `src/components/features/stats/uptime-section.tsx:240`, `messages/{ko,en}/stats.json`
- Test: `tests/unit/lib/stats-claude.test.ts`(create), `tests/unit/lib/stats-codex.test.ts`, `tests/unit/lib/stats-agent-jsonl-files.test.ts`, `tests/unit/lib/daily-report-builder.test.ts`, `tests/unit/lib/model-tokens.test.ts`

**Interfaces:**
- Produces:
  - `TAgentJsonlSource = 'codex' | 'claude'`. `collectAgentJsonlFiles()`는 `~/.claude/projects/*/<uuid>.jsonl`도 모은다(`agent-*`, subagent 하위 directory 제외, `project`는 cwd basename). 날짜 filter는 Claude 파일에 mtime·첫 timestamp 기준을 쓴다.
  - Claude usage는 `message.id`(없으면 `requestId`)로 중복을 지운 뒤 model별 input·output·cache read·cache creation(5m/1h)을 센다. `jsonl-parser`와 `stats-cache` 두 곳에 같은 dedupe helper를 쓴다(`src/lib/stats/claude-usage.ts`).
  - `ISessionStats`에 `provider`를 더한다. `CACHE_VERSION`을 올려 옛 cache를 다시 계산한다.
  - 비용:
    - `MODEL_PRICING`에 없는 model은 `cost: null`이다. 합계는 값이 있는 것만 더한다.
    - 화면은 `null`이면 `—`를 보인다.
    - `formatModelDisplayName`은 `claude-*`를 "Claude Opus 4.5" 꼴로 보인다.
    - Claude model 색은 기존 palette 안의 다른 색을 쓴다(새 색 literal은 `docs/STYLE.md` 규칙대로).
  - `history-parser`에 Claude user 텍스트 추출을 더한다(`isMeta`·명령 래퍼 제외).
  - 일일 리포트:
    - 입력은 두 provider 세션을 모두 쓴다.
    - 생성기 선택: runtime preflight에서 `agents.codex`가 사용 가능하면 지금 `codex exec` 경로, 아니면 `agents.claude`가 사용 가능할 때 `claude -p --output-format text`(prompt는 stdin, cwd·timeout·maxBuffer·PATH는 Codex 경로와 같음).
    - 둘 다 없으면 지금과 같은 오류 모양으로 실패한다.
    - `SUMMARY_PROMPT`는 "coding agent session history"로 중립화한다.
  - `stats.noRecentActivity` 문구는 provider 중립이다.

- [ ] **Step 1: Write the failing tests**
  - `stats-claude.test.ts`(임시 HOME):
    - 같은 `message.id` assistant 줄 3개 → token 한 번만 센다.
    - model별 합계와 cache 5m/1h 분리가 맞다.
    - session stats에 `provider: 'claude'`가 있다.
  - `stats-agent-jsonl-files.test.ts`: Claude 파일 수집, `agent-*` 제외, 날짜 filter.
  - `model-tokens.test.ts`: Claude model 비용 `null`, 표시 이름.
  - `daily-report-builder.test.ts`:
    - Codex 없음 + Claude 있음 → `claude` 명령과 `-p` 인자로 실행된다(execFile mock).
    - Codex 있음 → 지금 인자 그대로다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + `tests/unit/lib/stats-*.test.ts` + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(stats): count Claude Code usage and fall back to Claude for daily reports`

---

### Task 6: Agent 전환 잠금과 보기 제안

**Files:**
- Modify: `src/hooks/use-layout.ts:116,599-633`, `src/components/features/workspace/pane-container.tsx:330-370,651-660`, `src/components/features/mobile/mobile-surface-view.tsx:196-230,446-450`, `src/components/features/workspace/content-header.tsx:94-101`, `src/hooks/use-keyboard-shortcuts.ts:141-155`, `src/pages/api/check-agent.ts:30-37`, `messages/{ko,en}/terminal.json`
- Create: `src/components/features/workspace/agent-view-prompt.tsx`
- Test: `tests/unit/hooks/use-layout-panel-type.test.ts`, `tests/unit/pages/check-agent-api.test.ts`(create), `tests/unit/components/agent-view-prompt.test.ts`(create)

**Interfaces:**
- Produces:
  - `updateTabPanelType(paneId, tabId, panelType): boolean` — 적용하면 `true`, 막으면 `false`.
    - 막는 경우는 둘이다. 단계 1의 v2 guard와 새 전환 잠금이다.
    - 전환 잠금: 현재 탭 panelType이 agent 종류이고, 목표가 다른 agent 종류이고, `useTabStore.getState().tabs[tabId].cliState`가 `busy` 또는 `needs-input`일 때 막는다.
    - 막을 때는 toast `terminal.agentSwitchLocked`(`{agent}` = 현재 provider label)를 띄운다.
  - `pane-container`, `mobile-surface-view`의 `handleSwitchPanelType`·`handleSendToAgent`:
    - 반환값이 `false`이면 전환 표시(`setIsPanelTransitioning`)와 보낼 입력(`pendingAgentInputRef`)을 되돌린다.
    - Task 2의 `switchTabToProvider`도 이 반환값을 쓴다.
  - `/api/check-agent` 응답에 `providerPanelType: TAgentPanelType | null`을 더한다(`detectAnyActiveSession`의 provider).
  - 보기 제안(`AgentViewPrompt`):
    - Terminal 탭(v1, `runtimeVersion !== 2`)에서 check-agent가 agent 실행을 알리면 띄운다. 탭+provider당 한 번이고, 닫으면 다시 띄우지 않는다(메모리 Set).
    - 문구 `terminal.switchToAgentView`(`{agent}`)와 "보기 전환"/"닫기" 버튼을 둔다(44px).
    - 수락하면 `updateTabPanelType(…, providerPanelType)` 후 `setSessionView(tabId, 'timeline')`. agent를 다시 시작하지 않는다(timeline 연결이 실행 중 session에 묶는다).
    - 데스크톱은 pane 아래쪽 카드, 모바일은 agent 화면 흐름 안에 둔다(입력·복구 UI를 가리지 않음).
    - 모바일도 title 변경 때 `setCurrentProcess`를 부른다.

- [ ] **Step 1: Write the failing tests**
  - `use-layout-panel-type.test.ts`:
    - busy Codex 탭 → `'claude'` 전환은 `false`이고 toast가 뜨며 PATCH가 없다.
    - idle Codex 탭 → `true`다.
    - busy Codex 탭 → `'terminal'`은 허용한다(잠금은 다른 agent로 갈 때만).
    - v2 탭 guard는 그대로다.
  - `check-agent-api.test.ts`: Claude 실행 감지 시 `providerPanelType: 'claude'`가 들어간다.
  - `agent-view-prompt.test.ts`:
    - 수락하면 전환과 timeline 보기가 일어난다.
    - 닫은 뒤 같은 탭+provider로는 다시 뜨지 않는다.
    - v2 탭에서는 그리지 않는다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(ui): lock agent switching while busy and offer the agent view for terminals`

---

### Task 7: 시작 진행 표시와 시작 화면 카드

**Files:**
- Create: `src/components/features/workspace/agent-boot-view.tsx`
- Modify: `src/components/features/workspace/agent-panel.tsx:175,217-246`, `src/components/features/mobile/mobile-agent-panel.tsx:183-256`, `src/components/features/workspace/pane-container.tsx:423-435,915-934`, `src/components/features/mobile/mobile-surface-view.tsx:266-279,553-557`, `src/lib/session-list-rendering.ts:25-27`, `messages/{ko,en}/timeline.json`
- Test: `tests/unit/components/agent-boot-view.test.ts`(create), `tests/unit/lib/session-list-rendering.test.ts`

**Interfaces:**
- Produces:
  - `AgentBootView({ panelType, phase, bypass?, trust?, onCheckTerminal })`
    - `phase`: `'starting'`(명령 보냄) → `'waiting-session'`(process 감지, session 대기)
    - 단계 표시는 2줄 이하이고 provider label을 쓴다.
    - loading 중에도 높이가 바뀌지 않는다(DESIGN.md).
  - 시작 화면 카드가 진행 표시를 **대체**한다.
    - bypass 선택지가 오면 `BypassPromptCard`, trust prompt가 감지되면 `TrustPromptCard`를 진행 표시 자리에 그린다.
    - 이를 위해 trust detector 결과를 `AgentPanel`·`MobileAgentPanel`에 props(`trustPrompt`, `onTrustResponse`)로 넘긴다. 단계 2에서 panel 아래에 따로 그리던 카드는 지운다.
  - 실패 시: 60초가 지나도 session이 없으면 "terminal 보기" 회복 action을 보인다(지금 `checkTerminal` link 유지).

- [ ] **Step 1: Write the failing tests** — `check` 보기에서 trust prompt가 있으면 trust 카드만 보이고 진행 표시는 없다. bypass 선택지가 있으면 bypass 카드다. 둘 다 없으면 진행 표시에 provider label이 있다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(ui): show agent boot progress and replace it with startup prompts`

---

### Task 8: Claude 설정 화면과 terminal 기본 표시 공통화

**Files:**
- Modify: `src/components/features/workspace/settings-dialog.tsx:57-78,551-700,1176`, `src/hooks/use-config-store.ts`, `src/lib/config-store.ts:22-28`, `src/pages/api/config.ts:13,111`, `src/components/features/workspace/pane-container.tsx:120-122`, `messages/{ko,en}/settings.json`
- Test: `tests/unit/pages/config-api.test.ts`, `tests/unit/lib/config-store.test.ts`, `tests/unit/hooks/use-config-store.test.ts`(있으면 확장, 없으면 생성)

**Interfaces:**
- Produces:
  - 설정 tab `'claude'`(icon `ClaudeIcon`):
    - model: 입력란. 비우면 "Claude 설정을 따름"이다. 저장 전 `claudeModel` 규칙으로 검사한다.
    - permission mode: "Claude 설정을 따름" + `CLAUDE_PERMISSION_MODES` 6개.
    - 실행 명령 미리보기: `buildClaudeLaunchCommand` 모양을 client용으로 다시 만들지 않는다. "`claude --settings … --session-id …`" 고정 형식과 선택한 flag만 보인다.
  - `use-config-store`에 `claudeModel`, `claudePermissionMode`와 setter를 더한다.
  - 새 config key `agentShowTerminal?: boolean`(API 검증 boolean)
    - 읽을 때 `agentShowTerminal ?? codexShowTerminal ?? true`
    - 쓸 때는 새 key만 쓴다.
    - 토글은 Codex 탭에서 Terminal 탭(또는 공통 섹션)으로 옮긴다.
    - `pane-container`는 새 값을 쓴다.

- [ ] **Step 1: Write the failing tests** — config API가 `agentShowTerminal` boolean을 받고 문자열을 거절한다. store가 `codexShowTerminal: false`만 있는 config에서 `false`를 읽는다. 새 key가 있으면 그 값이 이긴다. `claudeModel`·`claudePermissionMode` setter가 저장한다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(settings): add Claude Code settings and a shared agent terminal toggle`

---

### Task 9: Onboarding과 `/tools-required`의 provider별 상태

**Files:**
- Modify: `src/types/preflight.ts:25-68`, `src/lib/preflight.ts:162,227-284`, `src/components/features/login/onboarding-wizard.tsx:108,124-132,260-375`, `src/pages/tools-required.tsx:19-74`, `src/pages/api/auth/preflight.ts`, `messages/{ko,en}/onboarding.json`, `messages/{ko,en}/toolsRequired.json`
- Test: `tests/unit/lib/preflight.test.ts`, `tests/unit/pages/auth-preflight.test.ts`, `tests/unit/lib/onboarding-preflight.test.ts`(create; 화면 판단을 순수 함수로 빼서 test)

**Interfaces:**
- Produces:
  - `IPreflightResult.agents: Partial<Record<TAgentPanelType, IAgentPreflightStatus>>`
    - `IAgentPreflightStatus = IToolStatus & { binaryPath?: string; loggedIn: boolean }`
    - Codex `loggedIn`은 지금처럼 `~/.codex` 존재다.
    - Claude `loggedIn`은 `~/.claude/.credentials.json` 또는 `~/.claude.json` 존재다(내용은 읽지 않음).
    - 기존 `agent` field는 Codex 그대로 남긴다.
  - `src/lib/onboarding-agents.ts`(create, 순수 함수):
    - `export const pickReadyAgents = (agents) => TAgentPanelType[]`
    - `export const nextAgentAction = (agents) => { panelType; action: 'install' | 'path' | 'login' } | null`
    - "하나라도 ready면 진행"이다.
  - Onboarding:
    - 준비된 agent가 하나라도 있으면 다음 단계로 간다.
    - 없으면 provider별 행(icon + label + 상태)과 행마다 설치·PATH·로그인 action을 보인다. install-server 명령 `codex*`/`claude*`를 쓴다.
    - `'Codex CLI'` literal을 없앤다.
  - `/tools-required`: provider별 행을 보이고, 다음 설치 제안은 "하나도 없을 때 둘 중 선택"으로 바꾼다.

- [ ] **Step 1: Write the failing tests**
  - `onboarding-preflight.test.ts`:
    - Claude ready + Codex 없음 → `pickReadyAgents === ['claude']`, `nextAgentAction === null`
    - 둘 다 없음 → install action 둘 중 첫 제안
    - Claude 설치 + 로그인 안 됨 → `{ panelType: 'claude', action: 'login' }`
  - `preflight.test.ts`: `getPreflightStatus().agents.claude.loggedIn`이 임시 HOME의 `.claude.json` 존재로 정해진다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + tsc + lint → PASS
- [ ] **Step 5: Commit** — `feat(onboarding): show each agent's install and login state`

---

### Task 10: Provider 중립 문구와 보기 전환 짧은 label

**Files:**
- Modify: `src/lib/agent-provider-meta.ts`(`shortLabel` 추가: `'CODEX'`, `'CLAUDE'`), `src/components/features/workspace/content-header.tsx:103-108`, `interrupt-dialog.tsx:33`, `web-input-bar.tsx:233,458,542,588`, `use-web-input.ts:102`, `agent-panel.tsx:211-212`, `mobile-agent-panel.tsx:231-232`, `timeline-view.tsx:616`, `rich-timeline-presentation.ts:79`, `session-empty-view.tsx:30`, `diff-panel.tsx:222`, `messages/{ko,en}/{terminal,timeline,session,diff,settings,stats,sessionExplorer}.json`
- Test: `tests/unit/components/agent-panel-install-copy.test.ts`(새 key 이름으로 갱신), `tests/unit/lib/agent-provider-meta.test.ts`, 문구 key 존재 test(`tests/unit/messages/agent-copy.test.ts` create: ko·en에 같은 key가 있고 `{agent}`를 포함)

**Interfaces:**
- Produces:
  - 바꿀 문구는 `{agent}`를 받는다(`installAgent`, `installAgentHint`(provider별 경로는 hint 인자 `{path}`), `interruptDescription`, `inputDisabledPlaceholder`, `inputAriaLabel`, `agentConnecting`, `attachmentNotConfirmed`, `timelineAria`, `richNotice`, `empty.startNewSession`, `askAgent`, `notification.enableDescription`).
  - 각 사용처에 `panelType`을 넘겨 `getAgentProviderMeta(panelType)?.label`로 채운다. 값이 없으면 기본 agent label이다.
  - 쓰이지 않는 key(`switchToCodexMode`, `notRunningTitle`, `notRunningHint`, `notRunningHint2`, `skipPermissionsDescription`)는 지운다.
  - Codex 전용 설정 문구(`settings.codex.*` model·sandbox·approval·search)는 그대로 둔다.

- [ ] **Step 1: Write the failing tests** — `agent-copy.test.ts`가 새 key의 ko·en 존재와 `{agent}` 포함을 확인한다. `agent-provider-meta.test.ts`가 `shortLabel`을 확인한다. install copy test가 새 key 이름을 확인한다.
- [ ] **Step 2: Run** → FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run** + `corepack pnpm check:product-name` + tsc + lint → PASS
- [ ] **Step 5: Commit** — `refactor(copy): name the active agent instead of Codex`

---

### Task 11: 문서, gate, browser·live 확인

**Files:**
- Modify: `docs/STATUS.md`, `docs/FOLLOW-UP.md`, `CONTEXT.md`(Session Catalog 정의를 agent JSONL로), `docs/operations/2026-11-10-multi-agent-brainstorming-handoff.md`

- [ ] **Step 1: Update docs** — 위 기능, 단계 3 판단, 남은 항목을 적는다.
- [ ] **Step 2: Full gates** — `corepack pnpm check:project-design && corepack pnpm check:product-name && corepack pnpm lint && corepack pnpm exec tsc --noEmit && TMUX_TMPDIR=$(mktemp -d) corepack pnpm test && corepack pnpm build`
- [ ] **Step 3: 격리 browser·live 확인** (단계 2 Task 10과 같은 안전 규칙, Claude prompt 3개 이하)
  - 서버 조건: 이 worktree의 production build, 임시 `AGENTMUX_DATA_DIR`·`TMUX_TMPDIR`, port 18122, live와 같은 Runtime v2 mode, `AGENTMUX_TMUX_SCOPE=off`, `INVOCATION_ID` 해제, `env -i` allowlist
  - Playwright(`corepack pnpm exec playwright`, chromium)로 아래를 확인하고 screenshot을 report에 남긴다(repo에 commit하지 않음).
    1. 360px 폭 모바일 헤더(보기 전환 메뉴, 탭 이름이 보임)
    2. 데스크톱 보기 전환 짧은 label
    3. 세션 목록 provider filter와 항목 label
    4. Session Explorer provider filter
    5. 설정의 Claude tab
  - 실제 Claude(prompt 3개 이하)로 아래를 확인한다.
    1. Claude 탭에서 짧은 prompt
    2. 그 세션이 Codex 탭의 지난 세션 목록에 Claude label로 보이고, 선택하면 탭이 CLAUDE 보기로 바뀌며 재개된다.
    3. busy 중 CODEX 전환이 막힌다.
    4. Terminal(v1) 탭에서 직접 `claude`를 실행하면 보기 제안이 뜨고, 수락하면 다시 시작하지 않고 timeline이 보인다.
    5. 통계에 Claude model token이 보이고 비용 칸은 `—`다.
  - 전후로 `~/.claude/settings.json`·`~/.codex/config.toml` sha256, 기본 `TMUX_TMPDIR`의 live tmux session 목록, service PID가 같다. trust 확인은 수락하지 않는다.
- [ ] **Step 4: Record** 결과를 handoff에 기록한다.
- [ ] **Step 5: Commit** — `docs: record the shared agent UI and its browser and live checks`
