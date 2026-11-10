# Claude Code provider와 agent 위임 안내 설계 (설계 1)

- 작성일: 2026-11-10
- 상태: Approved — 2026-11-10 사용자: "후속 작업 승인" (설계 1 승인과 grill-me·plan 진행)
- 요청: "purplemax에 있고 agentmux에 없는 기능은 agentmux에 추가 처리", 순서 확정 "이 순서(설계 1 → 2 → 3)로
  진행"
- 관련 문서: `../../PURPLEMUX-ADOPTION-AUDIT.md` "보충 분석 (2026-11-10)",
  `../../operations/2026-11-10-multi-agent-brainstorming-handoff.md`, `../../HERDR-ADOPTION-AUDIT.md`
- 비교 기준: `subicura/purplemux` `52140216`(`v0.4.5`). agentmux가 갈라질 때 Claude 지원을 지운 commit은
  `31f7bfdc`다.

## 상위 순서

사용자가 확정한 purplemux 기능 추가 순서의 1번이다.

1. **이 문서**: A. Claude Code provider, B. 공통 agent 기반, C. 위임 안내 주입
2. 설계 2: D. Codex 보조(update prompt 응답, TUI ready 감지), E. 일반 UI(Git side panel, 모바일 Git 전체
   화면, reload 복구)
3. 설계 3: Herdr 방식 multi-agent 회신·상호 리뷰 흐름

설계 2와 3은 이 문서의 범위가 아니다. 다만 이 문서는 설계 3이 기댈 기반(Claude 상태 감지, 위임 CLI, 위임
관계 기록)을 만든다.

## 의도와 이유

사용자의 실제 작업 흐름은 "Claude Code에서 진행 상황을 점검하고 Codex용 지시서를 쓴 뒤, Codex가 그
지시서대로 하는지 확인한다"이다. 지금 agentmux는 Codex만 다룬다. 그래서 Claude Code는 agentmux 밖
terminal에서 따로 돌고, 두 agent 사이의 전달은 사람이 손으로 한다.

목표는 Herdr를 롤모델로 "여러 agent를 한 화면에서 돌리고, 일을 나누고, 서로 리뷰하는 것"이다. 그
첫 단계로 Claude Code를 Codex와 같은 수준의 agent로 다루고, agent가 다른 탭에 일을 맡기는 방법을
agent에게 알려 준다.

purplemux는 이 기능을 이미 갖고 있다. 하지만 코드를 그대로 옮기지 않는다. agentmux는 갈라진 뒤
Runtime v2 worker, provider registry, 승인 처리, Session Catalog를 따로 발전시켰다. 그래서 기능은
purplemux를 기준으로 맞추되 구조는 agentmux 위에 다시 설계한다.

## 사용자 결정

- purplemux에 있고 agentmux에 없는 기능을 추가한다. 이전 감사의 "Claude Code provider 비채택" 결정은
  뒤집혔다 (2026-11-10).
- 순서는 설계 1 → 2 → 3이다.
- Agent가 다른 탭을 만들거나 지시를 보낼 때 **사용자 확인 없이 바로 진행**한다 (사용자: "확인 없이 바로
  진행"). 진행 내용은 화면에 보이면 된다.
- agentmux가 띄운 Claude Code에서 `agentmux tab` 명령을 **미리 허용**한다 (사용자: "미리 허용", 2026-11-10).
  Live Codex가 `danger-full-access` + `approval_policy = "never"`로 돌기 때문에 Claude가 Codex에게 보낸 지시는
  어디서도 확인받지 않고 실행된다는 점을 설명한 뒤 받은 결정이다.
- Android 앱은 Linux 서버에 접속하는 client로 유지한다. 이 설계는 Android 쪽 코드를 바꾸지 않는다.

## 목표

1. 사용자가 새 탭 메뉴에서 Claude Code 탭을 열고, Codex 탭과 같은 화면(timeline, 입력창, 아래 terminal)으로
   Claude Code를 쓴다. 데스크톱과 모바일 모두 해당한다.
2. Claude Code 탭의 상태(작업 중, 입력 대기, 리뷰 대기, 끝남)가 sidebar, 알림, Workspace Activity에
   Codex와 같은 방식으로 나타난다.
3. Claude Code의 권한 요청과 folder trust 확인에 웹(모바일 포함)에서 응답한다.
4. Claude Code의 rate limit(5시간, 7일)과 세션별 context 사용량, 비용을 보여 준다. Codex rate limit과
   따로 표시한다.
5. 한 folder의 지난 Claude Code와 Codex 세션을 한 목록에서 보고, 골라서 이어서 시작한다.
   Session Explorer, 통계, 일일 리포트도 Claude Code 세션을 포함한다.
6. Terminal 탭에서 사용자가 직접 `claude`나 `codex`를 실행하면 해당 agent 보기로 바꾸자고 제안한다.
7. Claude Code나 Codex 중 하나만 설치된 호스트에서도 agentmux가 열린다. 없는 agent는 설치·로그인 안내를
   보여 준다.
8. agentmux가 띄운 agent는 `agentmux tab create/send/status/result/close` 사용법을 안다. Agent가 이 CLI로
   다른 탭을 만들고 일을 맡기면 브라우저가 열려 있지 않아도 대상 agent가 시작되고 지시를 받는다.
9. 기존 Codex 기능은 그대로 동작한다.

## 비목표

- Agent 사이 회신 메시지, 리뷰 역할 template, 자동 리뷰 넘기기 (설계 3)
- Agent가 화면을 나누는 기능(pane split을 agent가 요청) (설계 3)
- Codex update prompt 응답, Git side panel 등 설계 2 항목
- Claude Code의 SDK/headless(`claude -p`) 세션을 탭으로 다루는 것. 대상은 interactive TUI 세션이다.
- 모델별 가격표와 그에 따른 통계 비용 추정 (아래 "Claude 판단" 참고)
- Android, Electron 앱 코드 변경

## Anti-goal

다음 중 하나라도 생기면 기술적으로 동작해도 실패다.

- 사용자의 `~/.claude/settings.json`, `~/.claude/` 아래 파일, `~/.codex/config.toml`을 agentmux가 고친다.
- agentmux 밖에서 돌리는 사용자의 Claude Code 세션(예: Herdr pane, 이 설계를 쓰는 세션)에 agentmux hook이나
  위임 안내가 붙는다.
- 사용자가 원래 쓰던 statusLine 표시나 hook이 agentmux가 띄운 Claude Code에서 사라진다.
- 위임 CLI가 권한 요청 화면에 글자를 보내 사용자 대신 승인하거나 거절한다.
- Codex 탭의 상태 판정, timeline, resume, rate limit이 바뀐다 (회귀).
- 공개 repo에 사용자 데이터(대화 내용, token, 경로 목록)가 fixture로 들어간다.

## 현재 사실 (2026-11-10 조사)

### 설치 환경

- 호스트 `gti12`: Claude Code `2.1.322`, Codex `0.167.0`.
- Claude Code는 `--settings <file-or-json>`, `--session-id <uuid>`, `--resume`, `--append-system-prompt[-file]`,
  `--name`, `--model`, `--permission-mode`를 지원한다.
- 사용자 `~/.claude/settings.json`에는 hook(`SessionStart` 2, `Stop` 1, `Notification` 1)이 있고 statusLine은
  없다. `permissions.defaultMode`는 `auto`다.
- Claude Code는 실행 중인 process마다 `~/.claude/sessions/<pid>.json`에 `sessionId`, `cwd`, `status`
  (`busy`/`idle`/`shell`) 등을 쓴다. 공개 문서에 없는 내부 형식이다.

### agentmux 코드

- Provider 계약 `IAgentProvider`(`src/lib/providers/types.ts`)와 registry가 있다. 등록된 provider는
  `codexProvider` 하나다.
- `TPanelType`(`src/types/terminal.ts:12`)과 `PANEL_TYPE_SET`(`src/lib/panel-type.ts:3`)에 agent 종류는
  `codex`뿐이다. `registerProvider`는 panel type이 이 집합에 없으면 throw한다. `isAgentPanelType`은
  `=== 'codex'`다.
- 서버 쪽 약 40곳이 registry를 거치지 않고 Codex를 전제한다. 주요 묶음:
  - Status: `status-manager.ts`의 Codex 전용 reconcile·JSONL watch·recovery 분기, `src/lib/status/*`의
    bootstrap·recovery 분기, `status-state-machine.ts`의 `reduceCodexState`
  - Runtime v2: `runtime/ipc.ts`의 panelType `z.literal` union, `status.reduce-codex-state` 명령, timeline
    worker의 `~/.codex/sessions` 경로 허용 목록과 catalog root, `supervisor.ts:945` annotation 검증
  - Timeline: `path-validation.ts`와 timeline API들의 `~/.codex/sessions` 허용 목록과 `'codex'` 기본값
  - Session Catalog: `catalog_sessions`에 provider column이 없고 projector는 Codex JSONL만 처리한다.
    `session-index.ts`, `session-list.ts`도 Codex 전용이다.
  - Stats: `stats/agent-jsonl-files.ts`가 `~/.codex/sessions`만 모은다. 일일 리포트는 `codex exec`를 쓴다.
  - 실행: `agent-launch-service.ts:32`가 id가 `codex`가 아닌 provider를 거절한다. 탭 생성 API
    (`api/layout/pane/[paneId]/tabs/index.ts`)는 `codex`가 아닌 agent 종류를 `terminal`로 바꾼다.
  - Preflight: `preflight.agent`는 Codex 하나만 본다. Codex가 없으면 `/tools-required`로 보낸다.
  - Hook: capability(`createCodexHookCapability`)와 bridge 경로가 Codex provider module에 있다. Bridge
    (`hook-settings.ts`의 `status-hook.cjs`)는 hook stdin을 읽고 버린다.
- 화면 쪽 약 25개 파일이 Codex를 전제한다(새 탭 메뉴 `codex-new`, 보기 전환 버튼, 단축키 `mod+shift+c`,
  `OpenAIIcon`, 모바일 탭 header, 설정 Codex 탭, onboarding, 문구). Timeline 화면
  (`components/features/timeline/*`)은 provider와 무관하고 Claude 형식 항목(tool-call, agent-group, plan,
  ask-user-question, task-*)도 이미 그린다.
- 지운 뒤 남은 Claude 형식 코드: `session-parser.ts`(Claude JSONL 해석, 현재 timeline에서 쓰이지 않음),
  statusLine 수신(`api/status/statusline`, `statusline-script.ts`, `rate-limits-watcher.ts`), hook event의
  `notification`/`pre-compact`/`post-compact` 처리, stats parser의 Claude 분기.
- CLI(`bin/cli.js`)에 `tab list/create/send/status/result/close`가 있다.
  - `tab create`(`api/cli/tabs/index.ts`)는 tmux session만 만들고 agent를 띄우지 않는다. 브라우저가 그
    탭을 열어야 agent가 시작된다.
  - `tab result`는 화면 캡처를 돌려준다.
  - `tab send`는 대상 상태를 보지 않는다.
- CLI token(`~/.agentmux/cli-token`, 실제 경로 `~/.codexmux/cli-token`)은 `src/proxy.ts`를 통과하는 모든
  API에 통한다. 탭·workspace 단위 제한은 없다.
- 기존 버그: `agent-panel.tsx`와 `mobile-agent-panel.tsx`가 `installCodex` 문구를 `terminal` 묶음에서
  찾지만 문구는 `timeline.json`에 있다. Codex 미설치 안내에 문구 키 이름이 보인다.

### purplemux 방식 (참고)

- 실행: `claude --settings ~/.purplemux/hooks.json [--append-system-prompt-file <ws prompt>]`. 탭은 hook
  script가 `tmux display-message`로 session 이름을 읽어 찾는다.
- 상태: hook(SessionStart → idle, UserPromptSubmit → busy, Notification permission_prompt → needs-input,
  Stop/StopFailure → ready-for-review, Pre/PostCompact → compacting 표시). 중단은 JSONL의
  `[Request interrupted by user`로 판정한다.
- statusLine: rate limit, context window, 비용을 server로 보내고, 사용자의 원래 statusLine 명령을 대신
  실행해 그 출력을 돌려준다.
- 세션 감지: pane process tree + `~/.claude/sessions/*.json` + process args의 `--resume <uuid>`.
- 권한 요청·plan 승인·질문·folder trust: 화면 캡처로 선택지를 읽고 숫자 key를 보낸다.
- 위임 안내: workspace별 파일을 Claude에는 `--append-system-prompt-file`, Codex에는
  `-c developer_instructions=`로 넣는다. 확인 없이 진행한다. CLI token은 전체 권한이다.
- 통합 세션 목록은 별도 panel type(`agent-sessions`), Chat/Terminal 전환은 popover와 agent 전환 잠금이다.

## 설계

### 1. Provider 계약 확장 (registry 우선)

Codex 고정 분기를 provider 계약 뒤로 옮긴다. 이 단계 자체는 동작을 바꾸지 않는다.

- Agent 종류 집합: `TPanelType`에 `'claude'`를 더하고 `panel-type.ts`에 `AGENT_PANEL_TYPES`(집합)를 둔다.
  `isAgentPanelType`은 집합 소속을 본다. `AGENT_PANEL_TYPE` 단일 상수는 "기본 agent"가 필요한 곳만 남기고
  나머지는 탭의 실제 `panelType`을 쓴다.
- Provider id와 panel type은 Codex와 같은 규칙으로 둘 다 `claude`다. 표시 이름은 `Claude Code`다.
- `IAgentProvider`에 다음 책임을 더한다. 이름과 정확한 signature는 builder가 정하되, 아래 책임이 provider
  밖에서 `providerId === 'codex'`로 분기되면 안 된다.
  - JSONL 경로 허용 root (Codex `~/.codex/sessions`, Claude `~/.claude/projects`)
  - 상태 판정 전략: hook만 쓰는지, JSONL reconcile(`reduceCodexState`)을 쓰는지, stop hook을 JSONL idle까지
    미루는지(기존 `statusBehavior` 확장)
  - Pane 입력 복구 판정(`hasCodexInterruptedPrompt` 같은 것)의 provider별 구현
  - Preflight: 설치 여부, version, 로그인 흔적, PATH 문제
  - 지난 세션 목록(cwd 기준)과 Session Catalog projector
  - Stats용 JSONL 수집과 token 추출
  - Rate limit 출처
  - 위임 안내 주입 방식(아래 C)
- Client 쪽에는 server module을 import하지 않는 provider metadata 표를 둔다: 표시 이름, icon, 새 탭 key,
  보기 전환 단축키, 재시작 명령(`/clear` 또는 `/new`), 종료 명령, 중단 key(Claude는 Esc 한 번, Codex는 기존
  Esc 두 번), 세션 종료 시 timeline을 남기는지.
- Runtime v2 IPC schema(`runtime/ipc.ts`)의 panelType union, supervisor annotation 검증, storage legacy
  import는 agent 종류 집합을 따른다. `status.reduce-codex-state`는 Codex 전용 명령으로 남긴다.
- **탭 단위 terminal 작업의 runtime 구분**: 화면 캡처(`capturePaneAtWidth`, `/api/tmux/permission-options`,
  plan·질문 선택지), 원시 key 입력(`/api/tmux/send-input`), session 존재 확인은 지금 옛 tmux socket만 쓴다.
  Runtime v2 탭(live의 새 terminal 탭과 새 Codex 탭)에서는 권한 요청 카드가 "Session not found"로 동작하지
  않는다(2026-11-10 grill에서 확인한 기존 결함). Runtime v2 terminal worker에 화면 캡처 명령을 더하고, 위
  작업들과 아래 위임 CLI가 탭의 `runtimeVersion`에 맞는 경로를 쓰게 한다. 단계 1에 포함한다.

### 2. Claude Code provider (A)

#### 실행과 탭 식별

- 새 세션: agentmux가 UUID를 만들고 탭에 먼저 기록한 뒤
  `claude --settings <탭 설정 파일> --session-id <uuid> [--append-system-prompt-file <위임 안내 파일>]`
  로 띄운다. 재개는 `--session-id` 대신 `--resume <uuid>`다.
- 탭 설정 파일은 data dir 아래 탭별 파일(mode 0600)이다. 내용은 hook, statusLine, 그리고 위임 안내가
  켜져 있을 때 `agentmux tab` 하위 명령만 허용하는 `permissions.allow` 규칙이다. `agentmux` 전체(browser
  `eval` 등)는 허용하지 않는다. 규칙 문법과 배열 합치기 방식은 builder가 그때의 Claude Code 문서로 확인한다.
  사용자 설정 파일은 건드리지 않고, Claude Code가 `--settings`를 사용자 설정 위에 합친다.
- Hook 명령은 Codex와 같은 bridge(`status-hook.cjs`)를 쓰고, 탭 식별은 Codex와 같은 HMAC 탭 capability로
  한다. Capability 생성·검증은 Codex module에서 공용 module로 옮긴다(이름 예: `agent-hook-capability`).
- 설정의 model, permission mode는 기본값이 "사용자 Claude 설정을 따름"(flag를 붙이지 않음)이다. 설정
  화면에서 바꾸면 `--model`, `--permission-mode`를 붙인다. purplemux의 `dangerouslySkipPermissions`에
  해당하는 값은 permission mode 선택지 안에 둔다.
- 탭 환경 변수: 실행 명령 앞에 `AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`를 붙인다. Agent가 실행하는 CLI가 이 값을
  자동으로 읽는다(아래 C). Codex 실행에도 같은 변수를 붙인다.

#### 상태 판정

- Claude 탭의 상태는 hook이 주 경로다.
  - SessionStart → idle (hook이 준 session id가 탭에 묶인 id와 다르면 새 session id와 transcript 경로로 탭을
    다시 묶는다. `/clear`, `/resume`, fork, compact가 해당한다)
  - UserPromptSubmit → busy
  - Notification(`permission_prompt`) → needs-input. 다른 notification 종류는 상태를 바꾸지 않는다.
  - needs-input → busy: 웹에서 응답하면 기존 `ack-notification` 경로로, terminal에서 직접 응답하면
    transcript JSONL에 needs-input 뒤 새 줄(tool 결과)이 붙는 것으로 판정한다. Tool hook은 tool 호출마다 process를
    띄우므로 등록하지 않는다.
  - Stop, StopFailure → ready-for-review
  - PreCompact/PostCompact → compacting 표시
  - JSONL의 `[Request interrupted by user` → idle (기존 `jsonl-idle-scan.ts` 경로)
- 정확한 hook 이름과 필드는 설치된 Claude Code 문서로 확인한 표(아래 "Hook 계약 확인")를 따른다.
- Bridge는 hook stdin에서 정해진 필드만 뽑아 보낸다: `session_id`, `transcript_path`, `cwd`, `source`,
  `notification_type`, `hook_event_name`. 그 밖의 내용(prompt 본문, tool 입력)은 보내지 않는다. Server는
  `session_id` 형식과 `transcript_path`가 `~/.claude/projects` 아래인지 검사한 뒤에만 쓴다.
- Hook은 `async`로 등록해 Claude Code를 막지 않는다.
- Hook이 오지 않는 경우(사용자 설정이 hook을 모두 끔, 오래된 버전)를 대비한 보조 판정은 문서화된 transcript
  JSONL의 끝부분 검사(마지막 assistant 응답의 끝남 여부, 중단 표시)로 한다.
- 세션 찾기(사용자가 Terminal 탭에서 직접 `claude`를 실행한 경우 등)는 process args의 `--resume`/`--session-id`,
  그다음 cwd의 transcript directory에서 process 시작 뒤 바뀐 JSONL 순으로 찾는다. `~/.claude/sessions/<pid>.json`은
  형식이 문서화되지 않았으므로 읽을 수 있을 때만 쓰는 보조 단서이고, 읽기 실패나 필드 누락을 정상 경우로
  다룬다.
- Codex 탭의 판정 경로는 바꾸지 않는다.

#### Timeline

- `session-parser.ts`를 Claude provider의 JSONL 해석으로 다시 연결한다. 하위 agent 묶음, plan, 질문,
  task, 중단, slash command를 그대로 쓴다. purplemux 이후 Claude JSONL에 생긴 새 항목은 알 수 없는 항목으로
  건너뛴다(오류 금지).
- Timeline worker와 API의 경로 허용 목록은 provider root를 따른다.

#### statusLine

- 탭 설정의 statusLine은 agentmux script다. Script는 stdin JSON을 agentmux로 보내고(실패해도 무시), 사용자가
  원래 설정한 statusLine 명령이 있으면 같은 stdin으로 실행해 그 출력을 표시한다. 원래 명령은 project
  `.claude/settings.local.json`, project `.claude/settings.json`, `~/.claude/settings.json` 순으로 찾는다.
- Server는 rate limit(5시간, 7일)을 provider별 저장소에 쓰고, 세션별 context 사용량·비용·model을 timeline
  meta로 보낸다. 기존 단일 rate limit store는 provider별 store로 바꾼다.

#### 권한 요청과 folder trust

- 권한 요청, plan 승인, 질문은 Codex와 같은 방식(화면 캡처로 선택지를 읽고 key를 보냄)이다.
  `permission-prompt.ts`에 Claude 문구 해석을 더한다. 승인 대기열(approval queue)은 이미 provider와 무관하다.
- Folder trust 확인("Quick safety check" 화면)을 감지해 카드로 보여 주고 웹에서 응답한다.

#### 설치·로그인

- Preflight는 provider별 상태를 돌려준다. 적어도 하나의 agent가 사용 가능하면 앱이 열린다. 둘 다 없을 때만
  `/tools-required`로 보낸다.
- Claude 설치 안내는 Codex 설치 안내와 같은 install-server 경로를 쓴다. 설치 명령은 Claude Code 공식 설치
  방법을 따른다. 로그인은 탭 terminal에서 `claude` 실행 후 진행하도록 안내한다.
- Onboarding과 `/tools-required` 화면은 provider별 상태를 보여 준다.

### 3. 공통 agent 기반 (B)

- **새 탭과 보기 전환**: 새 탭 메뉴(데스크톱, 모바일)에 Claude Code 항목을 더한다. 보기 전환 버튼은
  TERMINAL / CODEX / CLAUDE / DIFF다. Claude 보기 전환 단축키를 더한다(기존 단축키와 겹치지 않게).
- **Agent 전환 잠금**: 한 탭에서 agent가 busy이거나 needs-input이면 다른 agent 보기로 전환하지 않고 toast로
  알린다.
- **Agent 보기 제안**: Terminal 탭에서 사용자가 직접 `claude`나 `codex`를 실행하면 탭당 provider별 한 번
  "Chat 보기로 전환" 제안을 띄운다. 전환하면 panel type을 바꾸고 감지된 세션에 묶는다(재시작하지 않음).
- **시작 진행 표시**: 탭이 agent 시작을 기다리는 동안(`check` 상태) 진행 표시를 보여 준다. 시작 화면에
  bypass 확인이나 trust 확인이 뜨면 해당 카드로 바꾼다.
- **통합 세션 목록**: 별도 panel type을 만들지 않는다. Agent 탭의 세션 목록(실행 중인 agent가 없을 때
  보이는 목록)이 같은 folder의 Claude와 Codex 세션을 시간순으로 합쳐 보여 주고 provider 표시와 filter를
  둔다. 다른 provider의 세션을 고르면 탭의 panel type을 바꾸고 그 세션을 재개한다.
- **Session Explorer**: `catalog_sessions`에 provider column을 더하는 migration, Claude JSONL projector,
  provider filter. 기존 DB는 rebuild로 채운다.
- **통계와 일일 리포트**: Claude JSONL의 token(input, output, cache 생성, cache 읽기)을 model별로 모은다.
  비용 추정은 하지 않는다. 일일 리포트는 Claude 세션도 입력에 포함한다. 리포트 생성기는 Codex가 있으면
  지금처럼 `codex exec`, Codex가 없고 Claude만 있으면 `claude -p`를 쓴다.
- **Rate limit 표시**: sidebar와 모바일 sheet에 provider별 rate limit을 따로 보여 준다.
- **문구**: Codex 고유 문구는 `{agent}` 인자를 받는 문구로 바꾼다. 위 기존 버그(문구 묶음 불일치)를 같이
  고친다.

### 4. 위임 안내 주입 (C)

- **안내 내용**: `agentmux tab list/create/send/status/result/close` 사용법, `tab create -t
  claude|codex|terminal`, 상태 값의 뜻(busy, needs-input, ready-for-review, idle), 언제 맡기고 어떻게 결과를
  확인하는지. 위임은 확인 없이 진행된다는 점과 아래 제한을 적는다.
- **id는 안내에 넣지 않는다**: Claude Code는 재개할 때 처음 기록한 system prompt를 다시 쓴다. 다른 탭에서
  재개하면 안내 속 탭 id가 틀리게 된다. 그래서 workspace id와 탭 id는 탭 환경 변수(`AMUX_WORKSPACE_ID`,
  `AMUX_TAB_ID`)로만 전달하고, CLI가 이를 자동으로 읽는다. 안내 내용은 provider별로 고정이다. Codex의 shell
  명령에 이 환경 변수가 전달되는지(`shell_environment_policy`) builder가 확인하고, 전달되지 않으면 Codex
  안내에만 id를 넣는다(Codex는 실행할 때마다 안내를 넘기므로 같은 문제가 없다).
- **주입 방식**: Claude는 `--append-system-prompt-file`, Codex는 `-c developer_instructions=`. `-c`는 모든
  config 단계보다 우선하므로, agentmux가 읽을 수 있는 단계(사용자 `~/.codex/config.toml`, 선택된 profile,
  cwd부터 위로 찾은 project `.codex/config.toml`) 중 실제로 적용될 `developer_instructions` 값이 있으면 그 값을
  앞에 두고 안내를 뒤에 붙여 넘긴다. 설정 파일을 해석하지 못하면 안내를 넣지 않고 log를 남긴다(사용자 값을
  덮어쓰지 않음).
- **설정**: "agent에 위임 안내 넣기" 설정을 두고 기본값은 켬이다. 끄면 안내도 탭 환경 변수도 넣지 않는다.
- **CLI 찾기**: agentmux 명령은 호스트 PATH에 없다(live는 `node <checkout>/bin/agentmux.js`로 돈다). Server가
  시작할 때 data dir 아래 `bin/agentmux` shim(현재 build의 `bin/agentmux.js`를 현재 node로 실행)을 쓰고, 탭
  환경 변수에서 이 directory를 `PATH` 앞에 붙인다. 안내는 `agentmux` 명령 이름으로 쓴다.
- **Runtime v2 탭**: live는 새 탭을 Runtime v2 terminal로 만든다(`AGENTMUX_RUNTIME_TERMINAL_V2_MODE=new-tabs`).
  지금 `/api/cli/tabs*`는 옛 tmux socket만 다루므로 화면에서 만든 탭에 `send/status/result`가 실패한다. 이
  설계에서 고친다.
  - CLI가 만드는 탭은 화면에서 만드는 탭과 같은 v1/v2 규칙을 따른다.
  - `send/status/result/close`는 탭의 `runtimeVersion`에 맞는 terminal 경로(v2는 runtime supervisor)를 쓴다.
  - `cliState`는 status live mode면 status worker에서, 아니면 status manager에서 읽는다.
- **CLI 동작 변경**:
  - `tab create -t claude|codex`는 server에서 agent를 바로 띄운다(기존 `launchAgentInTab` 재사용). 브라우저가
    없어도 된다.
  - `tab create`는 대상 agent가 준비될 때까지(SessionStart hook을 받아 idle이 될 때까지, Claude와 Codex 모두
    SessionStart hook이 있다) 최대 60초 기다리고 `ready: true|false`를 돌려준다. 시작 화면(folder trust,
    bypass 확인, Codex update 안내)에서 멈추면 준비되지 않은 상태로 남고, 사용자가 화면에서 처리한다.
  - 새 탭의 cwd는 호출한 탭의 현재 cwd다. `--cwd`로 바꿀 수 있다. 호출한 쪽이 agent 탭이 아니면 지금처럼
    workspace의 첫 directory다.
  - 호출한 쪽이 agent 탭이면(`AMUX_TAB_ID`가 있으면) 새 탭을 호출한 탭과 같은 pane에 만들고, 새 탭에
    `createdByTabId`를 기록한다. 화면 분할은 하지 않는다. 새 탭은 tab bar에 나타나기만 하고 active 탭을
    바꾸지 않는다(사용자가 보던 화면을 빼앗지 않음).
  - `-w`를 생략하면 `AMUX_WORKSPACE_ID`를 쓴다.
  - `tab send`는 대상이 agent 탭일 때 상태가 idle, busy, ready-for-review일 때만 보낸다. needs-input이면
    `target-needs-input`, 준비 전(inactive, unknown, 시작 화면)이면 `target-not-ready` 오류 code를 돌려주고
    아무 글자도 보내지 않는다. 보내기 직전에 화면 캡처로 권한 요청·시작 화면이 떠 있지 않은지 한 번 더
    확인한다. busy이면 보낸다(agent가 대기열에 넣는다).
  - `tab status`는 provider, `cliState`, session id, `createdByTabId`를 돌려준다.
  - `tab result`는 agent 탭이면 마지막 assistant 응답(timeline 기준)과 상태를 돌려주고, 화면 캡처는 보조로
    둔다. terminal 탭은 지금처럼 화면 캡처다.
  - `tab close`는 호출한 쪽이 agent 탭이면 그 탭이 만든 탭만 닫을 수 있다. 사용자가 직접 실행한 CLI는
    지금처럼 제한이 없다.
- **Codex sandbox**: Codex `workspace-write` sandbox는 기본으로 network를 막아 127.0.0.1의 agentmux API에 닿지
  못한다. agentmux는 사용자 sandbox 설정을 바꾸지 않는다. 이 경우 Codex 쪽 위임은 지원하지 않는 것으로
  문서화하고, 안내에 "CLI가 network 오류로 실패하면 사용자에게 위임을 쓸 수 없다고 알린다"를 넣는다. Live
  호스트는 `danger-full-access`라 해당하지 않는다.
- **폭주 방지**: 한 workspace에서 agent가 만든 탭 중 살아 있는 것은 최대 6개다. 넘으면 오류 code
  (`delegation-limit`)를 돌려준다.
- **보이게 하기**: agent가 만든 탭은 화면에 바로 나타나고, 탭에 만든 쪽 표시를 붙인다.
- **Token 경계**: CLI token 범위는 바꾸지 않는다. Agent는 사용자와 같은 Unix 사용자로 돌아 token 파일을
  직접 읽을 수 있으므로 탭 단위 token은 실제 경계가 되지 못한다. 위 제한(needs-input 거절, 닫기 제한, 개수
  제한)은 실수를 막는 장치이고 보안 경계가 아니다. 경계는 Unix 사용자다.

## Hook 계약 확인

2026-11-10에 Claude Code 공식 문서(`code.claude.com/docs/en/hooks.md`, `settings.md`, `statusline.md`,
`cli-reference.md`, `sessions.md`, `claude-directory.md`)로 확인했다. 구현 전에 builder가 그때의 문서로 한 번
더 확인한다.

| 항목 | 확인 내용 | 설계 반영 |
| --- | --- | --- |
| Hook 이름 | SessionStart, UserPromptSubmit, Notification, Stop, StopFailure, PreCompact, PostCompact 모두 있다. 모르는 이름은 경고 후 건너뛴다 | 위 7개만 등록 |
| 공통 stdin | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode` | bridge가 뽑는 필드 |
| SessionStart `source` | `startup`, `resume`, `clear`, `compact`, `fork` | `startup` 외에는 session id가 다르면 다시 묶음 |
| Notification 종류 | `permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input` 등. 목록은 release마다 바뀔 수 있음 | `permission_prompt`만 needs-input. 나머지는 무시 |
| `--settings` 합치기 | 우선순위 managed > `--settings` > project local > project > user. Hook은 모든 단계가 합쳐져 다 실행된다. 같은 handler는 한 번만 돈다 | 사용자 hook 유지 |
| statusLine | 단일 객체라 `--settings`의 값이 사용자 값을 대체한다(문서의 우선순위 규칙에서 추론) | agentmux script가 사용자 명령을 대신 실행 |
| statusLine stdin | `session_id`, `transcript_path`, `cwd`, `model.id/display_name`, `cost.total_cost_usd`(`/clear`에서 0으로), `context_window.*`, `exceeds_200k_tokens`, `rate_limits.five_hour/seven_day`(`used_percentage`, `resets_at` epoch 초). `rate_limits`는 구독자만, 첫 응답 뒤에만 있고 창마다 따로 빠질 수 있다 | 빠진 값은 이전 값 유지 |
| `--session-id` | 새 대화의 id를 지정한다(UUID) | agentmux가 id를 정해 띄움 |
| Transcript 위치 | `~/.claude/projects/<project>/<session-id>.jsonl`. `<project>`는 cwd의 영숫자 외 문자를 `-`로 바꾼 값, 200자 초과는 잘리고 hash가 붙는다 | 경로 계산 규칙 |
| `/clear` | 새 세션이 시작되고 SessionStart(`clear`)가 새 `session_id`와 `transcript_path`를 준다 | 탭을 새 세션에 다시 묶음 |
| `--append-system-prompt-file` | interactive에서도 쓸 수 있다. 재개하면 첫 요청 때 기록된 system prompt를 다시 쓴다(`--system-prompt-snapshot`) | 안내 내용에 탭·workspace id를 넣지 않음 |
| `~/.claude/sessions/<pid>.json` | 문서에는 "실행 중인 세션마다 하나, 동시 실행과 crash 감지용"이라는 directory 설명만 있고 형식은 없다 | 보조 단서로만 사용 |
| `async` | command hook에 `"async": true`가 있다. Async hook에는 timeout을 적용하지 않는다 | 모든 hook을 async로 등록 |

## 단계와 배포

각 단계는 별도 PR이고 main CI 통과 뒤 merge한다. Live 배포는 단계 4 뒤 한 번 하거나 단계별로 할 수 있다
(builder 재량, 배포마다 사용자 확인).

1. **Provider 계약 확장**: 위 1절. Codex 동작 변화 없음. 예외는 Runtime v2 탭의 화면 캡처·원시 key 입력
   결함 수정이다. 기존 test 전부 통과 + Codex 회귀 test.
2. **Claude provider core**: 실행, hook, 상태, timeline, statusLine, rate limit, 권한 요청·trust, preflight.
   서버 쪽과 최소 화면(새 탭 메뉴, 보기 전환)까지.
3. **공통 agent 화면**: 나머지 B 항목(전환 잠금, 보기 제안, 시작 진행, 통합 목록, Session Explorer, 통계,
   rate limit 표시, 설정, onboarding, 문구).
4. **위임 안내와 CLI 변경**: 위 4절.

## Domain Architecture

- 기준 용어: "코딩 에이전트" 아래 provider 둘(`Codex`, `Claude Code`). "로컬 Codex 세션"과 같은 층위로
  "로컬 Claude Code 세션"을 더한다. Session Catalog 정의는 "agent JSONL에서 계산한 session metadata"로
  넓힌다. "위임(delegation)": agent가 agentmux CLI로 다른 탭을 만들거나 지시를 보내는 행위.
- 거부 용어: Claude 탭을 `claude-code` panel type으로 부르는 것(id는 `claude`), 위임을 "orchestration"이나
  "sub-agent"로 부르는 것(sub-agent는 Claude Code 안의 하위 agent를 뜻한다), 이 설계 범위에서 "agent 간
  회신"을 현재 기능처럼 쓰는 것.
- Module 후보: provider별 directory(`src/lib/providers/claude/`), 공용 hook capability module, client
  provider metadata 표, provider별 rate limit store, 위임 안내 생성 module.
- Aggregate/entity: Tab에 `createdByTabId`(위임 관계) 추가. Agent session에 provider id(Session Catalog).
- 공개 계약 영향: `TPanelType`, Runtime v2 IPC schema, `/api/cli/tabs*` 응답과 오류 code, CLI 환경 변수
  (`AMUX_WORKSPACE_ID`, `AMUX_TAB_ID`), `catalog_sessions` schema, preflight 응답 shape, config key(Claude
  설정, 위임 안내 설정, 터미널 기본 표시의 provider 공통화).
- Adapter 경계: Claude Code의 내부 파일(`~/.claude/sessions/*.json`) 해석은 Claude provider 안에만 둔다.
- ADR 후보:
  - ADR-035: agentmux는 사용자 agent 설정을 고치지 않고 실행 시점 flag(`--settings`, `-c`)로만 hook과
    안내를 붙인다 (Draft)
  - ADR-036: Agent 위임은 확인 없이 진행하고(agentmux가 띄운 Claude Code에서 `agentmux tab` 명령 미리 허용)
    신뢰 경계는 Unix 사용자로 둔다. CLI 제한은 실수 방지 장치다 (Draft)

## 인수 기준

1. Codex 회귀: 기존 test 전부 통과. 격리 환경에서 Codex 탭 새로 시작 → prompt → busy → ready-for-review,
   resume, timeline, rate limit이 단계 1 전과 같다.
2. 사용자 설정 불변: Claude 탭 시작·사용·종료 전후로 `~/.claude/settings.json`과 `~/.codex/config.toml`의
   checksum이 같다.
3. Claude 상태: fixture hook payload와 fixture JSONL로 idle → busy → needs-input → busy → ready-for-review,
   중단 → idle, `/clear` 뒤 새 session id 재연결을 unit test로 확인한다. 실제 Claude Code로 한 번 live smoke를
   한다(짧은 prompt 하나).
4. 사용자 statusLine과 hook 유지: 사용자 설정에 statusLine이 있는 격리 HOME에서 Claude 탭의 statusLine이
   사용자 명령의 출력을 보여 준다. 사용자 hook도 실행된다.
5. Timeline: Claude JSONL fixture(tool 호출, 하위 agent, plan, 질문, 중단, 알 수 없는 항목)가 오류 없이 그려진다.
   Fixture는 합성 데이터만 쓴다.
6. 권한 요청과 trust 확인에 웹 응답이 동작한다(capture fixture unit test + live smoke). Runtime v1 탭과 v2 탭
   모두에서 권한 요청 선택지를 읽고 응답한다. 기존 Codex v2 탭도 해당한다.
7. 통합 세션 목록에서 Claude와 Codex 세션을 고르면 각각 맞는 agent로 재개된다.
8. Session Explorer migration: 기존 DB에서 시작해 rebuild 뒤 Codex 세션 수가 같고 Claude 세션이 더해진다.
9. 하나만 설치된 호스트(격리 PATH)에서 앱이 열리고 없는 agent는 설치 안내를 보인다.
10. 위임: 브라우저를 열지 않은 상태에서 Claude 탭 안의 agent가 `agentmux tab create -t codex`와 `tab send`를
    실행하면 Codex가 호출한 탭의 cwd에서 시작되고 지시를 받는다. `tab status`와 `tab result`가 상태와 마지막
    응답을 돌려준다. needs-input 대상과 준비 전 대상에 `tab send`는 거절되고 아무 글자도 입력되지 않는다.
    개수 제한과 닫기 제한이 동작한다. 화면에서 만든 Runtime v2 탭에도 `send/status/result`가 동작한다.
11. Runtime v2 live mode와 legacy mode 모두에서 3, 7, 10이 동작한다.
12. 기본 gate: `check:project-design`, 이름 검사, lint, `tsc --noEmit`, unit test, production build.
13. Live 배포 뒤 tmux 서버와 기존 세션이 살아 있고, handoff에 배포 기록을 남긴다.

## Builder 재량

- Provider 계약 확장의 정확한 method 이름과 signature, 파일 배치
- 탭 설정 파일의 경로와 정리 시점(탭 닫힘)
- Client provider metadata 표의 형태
- Claude 보기 전환 단축키 조합(충돌 없는 것)
- Session Catalog migration 방식(column 추가 + rebuild)
- 위임 안내 문장
- 단계별 live 배포 여부

## Builder check 결과 (독립 subagent, 2026-11-10)

| 질문 | 처리 |
| --- | --- |
| 새로 만든 agent가 준비되기 전 `tab send`가 시작 화면에 글자를 넣는다 | `tab create`가 SessionStart까지 최대 60초 기다리고, `tab send`는 준비 전·needs-input 대상을 거절하고 보내기 직전 화면을 다시 확인 (Claude 판단) |
| CLI가 Runtime v2 탭을 다루지 못한다 | 코드와 live 설정으로 확인. CLI가 탭의 `runtimeVersion`에 맞는 경로를 쓰도록 범위에 포함 (프로젝트 사실) |
| Agent가 CLI를 찾는 방법 | PATH에 없음을 확인. Data dir shim + 탭 PATH 앞붙이기 (Claude 판단) |
| Claude Code 자체 권한 확인이 CLI 호출을 막는다 | 사용자 결정: 탭 설정에서 `agentmux tab` 하위 명령만 미리 허용 |
| Codex sandbox가 local API를 막는다 | sandbox를 바꾸지 않고 미지원으로 문서화. Live는 `danger-full-access` (Claude 판단) |
| 위임 탭의 cwd | 호출한 탭의 현재 cwd, `--cwd`로 변경 (Claude 판단) |
| Panel id `claude`, 통합 목록 방식의 확정 시점 | 단계 1 전에 사용자 승인으로 확정 |
| Terminal에서 직접 응답했을 때 needs-input 해제 | JSONL에 새 줄이 붙으면 busy. Tool hook은 쓰지 않음 (Claude 판단) |
| 위임 탭이 active 탭을 바꾸는가 | 바꾸지 않음 (Claude 판단) |
| Claude만 있는 호스트의 일일 리포트 | `claude -p`로 대체 (Claude 판단) |
| Codex `developer_instructions` 단계별 값 | 읽을 수 있는 단계에서 적용될 값을 앞에 붙이고, 해석 실패 시 안내를 넣지 않음 (Claude 판단) |

## Claude 판단 (사용자 확인 필요)

- Provider id와 panel type을 `claude`로 둔다(purplemux는 `claude-code`).
- 통합 세션 목록을 별도 panel type 대신 agent 탭의 세션 목록에 합친다.
- 모델 가격표와 통계 비용 추정을 넣지 않는다. 비용은 Claude Code가 statusLine으로 알려 주는 세션별 값만
  보여 준다. 가격표는 가격이 바뀔 때마다 고쳐야 하기 때문이다.
- Claude 설정(model, permission mode)의 기본값은 "사용자 Claude 설정을 따름"이다.
- 위임 안내 설정은 기본 켬이다.
- CLI token 범위를 바꾸지 않는다. 위임 제한(needs-input 거절, agent가 만든 탭만 닫기, 살아 있는 위임 탭 최대
  6개)은 실수 방지 장치로 둔다.
- 일일 리포트 생성기는 Codex가 있으면 Codex, 없으면 Claude다.
- 적어도 하나의 agent가 있으면 앱을 연다.
- 위임 CLI: data dir shim을 탭 PATH 앞에 붙인다. 새 탭은 호출한 탭의 cwd에서 시작하고 active 탭을 바꾸지 않는다.
  `tab create`는 준비될 때까지 최대 60초 기다린다. 준비 전·needs-input 대상에는 보내지 않는다.
- Codex sandbox가 network를 막으면 Codex 쪽 위임은 지원하지 않는다(sandbox 설정을 바꾸지 않음).
