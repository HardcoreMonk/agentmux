# AGENTS.md

AI가 생성한 코드도 시니어 엔지니어가 작성한 것처럼 보여야 합니다. 과한 주석,
불필요한 설명, AI 특유의 패턴을 피합니다.

항상 사용자가 쓴 언어로 응답합니다. "commit message는 영어" 같은 프로젝트 규칙은
그 규칙이 직접 가리키는 산출물에만 적용합니다.

## 프로젝트 개요

- 제품: agentmux는 코딩 에이전트 웹 세션 매니저입니다 (현재 Codex 지원, Claude Code 지원 예정).
- 제품 목표: Linux 단일 엔진 호스트에서 Codex 세션 운영과 프로젝트 거버넌스를
  통합합니다. Windows installer/updater와 Electron/Android 기록은 역사적 release 또는
  선택 client surface로 보존하며 Linux runtime acceptance를 대체하지 않습니다.
- 프레임워크: custom Node server를 사용하는 Next.js Pages Router입니다.
- 패키지 매니저: pnpm입니다. 명령 실행 시 `corepack pnpm ...`을 우선합니다.
- 스타일링: Tailwind CSS v4와 shadcn/ui를 사용합니다.
- 언어: TypeScript입니다.
- 런타임 상태: tmux 기반 세션과 `~/.agentmux/`(legacy 실제 경로 `~/.codexmux/`)에 저장되는 앱 상태를 함께 사용합니다.
- 플랫폼 shell: Electron desktop app과 Capacitor Android app은 실행 중인 agentmux
  서버에 연결합니다.
- 지원 UI 언어: 한국어와 영어입니다. 기본 locale은 한국어입니다.

## 핵심 규칙

- App Router가 아니라 Pages Router를 사용합니다.
- `"use client"`를 추가하지 않습니다.
- 이 Next.js 버전의 auth middleware 경로는 `src/proxy.ts`입니다.
- 상대 parent path 대신 `@/` import를 사용합니다.
- 파일명은 소문자와 dash를 사용합니다.
- `function` 선언보다 arrow function을 우선합니다.
- interface는 `I`, union/alias type은 `T` 접두사를 붙입니다.
- 기존 로컬 icon component가 없다면 icon은 lucide-react를 사용합니다.
- form은 react-hook-form, zod, @hookform/resolvers를 사용합니다.
- 날짜/시간 처리는 dayjs를 사용합니다.
- 알림은 sonner를 사용합니다.
- 앱 화면은 밀도 있고 운영 중심이어야 합니다. 제품 UI에 marketing hero layout을
  도입하지 않습니다.
- 시각 polish보다 terminal/input/reconnect 안정성을 우선합니다.

## 명령

```bash
corepack pnpm dev
corepack pnpm build
corepack pnpm lint
corepack pnpm tsc --noEmit
corepack pnpm test
corepack pnpm exec playwright install chromium
corepack pnpm build:electron
corepack pnpm android:build:debug
```

패키지 관리는 pnpm을 사용합니다. shadcn CLI만 예외입니다.

```bash
npx shadcn@latest add <component-name>
```

## 플랫폼 참고

- Electron 코드는 `electron/` 아래에 있으며 `docs/ELECTRON.md`에 문서화되어 있습니다.
- Android 코드는 `android/` 아래에 있고 launcher asset은 `android-web/`에 있으며
  `docs/ANDROID.md`에 문서화되어 있습니다.
- Android app ID는 `com.hardcoremonk.codexmux`입니다.
- Android debug install 검증은 SDK adb를 사용합니다. 예:
  `~/Android/Sdk/platform-tools/adb shell pm path com.hardcoremonk.codexmux`.

## Codex와 Terminal 규칙

terminal process 이름, path, Codex session state를 다룰 때는 기존 utility를
재사용합니다. `pgrep`, `ps`, `lsof`를 직접 호출하지 않습니다.

Client helper:

| 함수 | 파일 | 목적 |
| --- | --- | --- |
| `parseCurrentCommand(raw)` | `src/lib/tab-title.ts` | title에서 process 이름 추출 |
| `isShellProcess(raw)` | `src/lib/tab-title.ts` | foreground process가 shell인지 감지 |
| `formatTabTitle(raw)` | `src/lib/tab-title.ts` | tab 표시 이름으로 변환 |
| `onTitleChange` | `src/hooks/use-terminal.ts` | title 변경 event 수신 |

Server helper:

| 함수 | 파일 | 목적 |
| --- | --- | --- |
| `getPaneCurrentCommand(session)` | `src/lib/tmux.ts` | foreground process 이름 조회 |
| `getSessionCwd(session)` | `src/lib/tmux.ts` | 현재 working directory 조회 |
| `getSessionPanePid(session)` | `src/lib/tmux.ts` | pane shell PID 조회 |
| `checkTerminalProcess(session)` | `src/lib/tmux.ts` | resume 전 안전한 shell 확인 |
| `isCodexRunning(panePid)` | `src/lib/codex-session-detection.ts` | pane 아래에서 Codex가 실행 중인지 확인 |
| `detectActiveCodexSession(panePid)` | `src/lib/codex-session-detection.ts` | active Codex session metadata 감지 |
| `watchCodexSessions(panePid, cb)` | `src/lib/codex-session-detection.ts` | Codex session start/stop 감시 |

## 공유 상태

custom server(`server.ts`)와 Next.js API route는 하나의 Node process 안에서
분리된 module graph로 실행됩니다. 공유 singleton 상태는 재초기화 guard를 둔
`globalThis`에 둡니다.

```typescript
const g = globalThis as unknown as { __ptFooStore?: Map<string, IFoo> };
if (!g.__ptFooStore) g.__ptFooStore = new Map();
const store = g.__ptFooStore;
```

주변 key convention을 유지합니다. 새 공유 상태는 보통 `__pt`와 PascalCase 이름을
조합합니다. 주변 코드를 수정할 때 기존 `__codexmux*` 또는 `__cmux*` key는 그대로
유지합니다.

## UI와 Locale 규칙

- 기본 locale은 `ko`이며 영어 지원을 병행 유지합니다.
- message를 load하는 server-rendered page를 바꿀 때는 SSR locale hydration을 보존합니다.
- 한국어 우선 화면은 project font stack과 `word-break: keep-all`을 사용합니다.
  terminal, code, diff, path, input, textarea, xterm 영역은 예외입니다.
- Mobile touch target은 가능한 44px 이상으로 두고 `active`와 `focus-visible` 상태를 포함합니다.
- notification 설정은 일관되게 사용합니다. `notificationsEnabled`,
  `soundOnCompleteEnabled`, toast 설정은 모두 `config.json`에 있습니다.

## 문서

복잡한 주제는 `docs/` 아래에 둡니다.

Root `CONTEXT.md`는 도메인 언어와 기준 소스 경계를 담당합니다. Root
`DESIGN.md`는 UI 시각 계약을 담당합니다. 제품/아키텍처 요약은
`docs/PROJECT-DESIGN.md`에 둡니다.

| 문서 | 목적 |
| --- | --- |
| `docs/README.md` | 내부 문서 맵과 갱신 규칙 |
| `docs/ADR.md` | 아키텍처 결정과 결정 trigger |
| `docs/PROJECT-DESIGN.md` | 제품/아키텍처 설계 요약 |
| `docs/ARCHITECTURE-LOGIC.md` | 아키텍처 흐름과 서비스 로직 |
| `docs/STATUS.md` | Codex 작업 상태 감지와 status 흐름 |
| `docs/TMUX.md` | tmux, terminal 관리, WebSocket 흐름 |
| `docs/DATA-DIR.md` | `~/.agentmux/` (legacy 실제 경로 `~/.codexmux/`) directory 구조 |
| `docs/TESTING.md` | test tier, Playwright/Chromium, platform smoke, live deploy 확인 |
| `docs/WINDOWS-ONLY-GAP-AUDIT.md` | 보존된 Windows 전환·release 증거와 역사적 architecture 후보 |
| `docs/SYSTEMD.md` | Linux user service 운영 |
| `docs/PERFORMANCE.md` | 성능 스냅샷, render/cache 최적화, 검증 |
| `docs/STYLE.md` | theme과 color 사용 규칙 |
| `docs/ELECTRON.md` | Electron desktop 개발과 packaging |
| `docs/ANDROID.md` | Android Capacitor 개발, build, install |
| `docs/FOLLOW-UP.md` | release 확인과 post-MVP backlog |

status 관련 코드(`TCliState`, `ITabState`, `StatusManager`, `selectSessionView`,
`agentSessionId`, provider detection 등)를 수정하면 `docs/STATUS.md`를 함께
갱신합니다.

오래가는 아키텍처 결정을 바꿀 때는 `docs/ADR.md`를 갱신합니다. 여기에는
framework/router 선택, custom server 경계, shared state 배치, tmux/session 전략,
provider model, storage layout, platform shell, auth/security, notification
semantics, locale policy가 포함됩니다. 작은 component styling 변경은 문서화된
design rule을 바꾸지 않는 한 ADR이 필요하지 않습니다.

## 에이전트 작업 흐름 계약

- Issue tracker 규칙은 `docs/agents/issue-tracker.md`에 있습니다.
- Triage label/status mapping은 `docs/agents/triage-labels.md`에 있습니다.
- Domain docs와 ADR 소비 규칙은 `docs/agents/domain.md`에 있습니다.
- 사용자가 명시적으로 요청하지 않는 한 issue 생성/닫기/relabel, commit/push를 하지 않습니다.

## 주석 정책

주석은 명확하지 않은 코드가 왜 필요한지 설명할 때만 추가합니다. 코드가 이미
말하는 내용을 다시 적는 주석은 피합니다.

## 리팩터링 제외

필요한 경우가 아니면 third-party component folder를 refactor하지 않습니다.

| Directory | 설명 |
| --- | --- |
| `src/components/ui/` | shadcn/ui component |
| `src/components/ai-elements/` | AI Elements component |

<!-- BEGIN:nextjs-agent-rules -->
# 이 버전은 익숙한 Next.js와 다릅니다

이 버전에는 breaking change가 있습니다. API, convention, file structure가
학습 데이터와 다를 수 있습니다. 코드를 작성하기 전에
`node_modules/next/dist/docs/`의 관련 guide를 읽고 deprecation notice를 따릅니다.
<!-- END:nextjs-agent-rules -->

## Plan Grilling

- `grill-me`는 원본 installer를 설치하지 않고 Codex zone의 `Plan Grilling` workflow로 사용한다.
- 신규 기능/프로젝트 설계는 `superpowers:brainstorming`이 만든 `writing-spec` 산출물을 기준으로 `domain-architecture` pass를 먼저 수행한 뒤, `superpowers:writing-plans` 전에 `grill-me 방식으로 검토해줘`라고 호출한다.
- `writing-spec`은 별도 lifecycle gate가 아니라 `superpowers:brainstorming`의 design spec 산출물이다.
- 질문은 한 번에 하나만 하고, 각 질문에는 Codex의 추천 답을 함께 제시한다.
- 코드/문서로 확인 가능한 내용은 사용자에게 묻지 않고 직접 확인한다.
- `CONTEXT.md`, `CONTEXT-MAP.md`, `docs/adr/`가 있으면 용어 충돌과 ADR 후보를 함께 검토한다.
- `npx skills@latest add mattpocock/skills`, `scripts/link-skills.sh`, Claude hook installer는 실행하지 않는다.

## Lifecycle Control Plane

- 표준 lifecycle contract는 zone 상대 경로 `codex-project-mgmt/docs/codex-lifecycle-control-plane.md`를 따른다.
- 기본 순서: `intake -> office-hours optional -> superpowers:brainstorming / writing-spec -> domain-architecture -> grill-me -> plan-design-review -> superpowers:writing-plans -> plan-eng-review -> implement -> code-review -> release -> operate`.
- ADR lifecycle은 project pipeline과 별도다. ADR 상태는
  `Draft -> Review -> Approved -> Implemented -> Verified -> Archived`를 사용하며,
  pipeline stage 통과가 ADR approval을 의미하지 않는다.
- 실제 spec, grill-me 기록, plan, handoff는 해당 project root의 project-local 산출물로 둔다.
- 새 기능, 동작 변경, 작업 흐름 계약 변경, 여러 파일에 걸친 변경은 lightweight path를 사용하지 않는다.
- `release` 이후에는 `docs/operations/YYYY-MM-DD-<topic>-handoff.md` 또는 project-equivalent handoff로 운영 진입 상태를 기록한다.
