# Multi-agent 설계 논의와 Android 재빌드 확인 인계

> 작성일: 2026-11-10
> 기준 commit: main `854f5246` (agentmux `0.5.0`)
> 앞선 인계: `docs/operations/2026-11-09-agentmux-rename-handoff.md`

## 범위

- 원래 순서의 2번 프로젝트(Claude Code provider)를 brainstorming하던 중 사용자가 목표를 "여러 agent를 한
  화면에서 돌리고 일을 나누고 서로 리뷰하는 기능"으로 넓혔다. 이 문서는 그 논의의 중간 상태를 기록한다.
- 기존 pane split 기능의 동작 확인.
- Herdr 분석 보고의 독립 감사와 `docs/HERDR-ADOPTION-AUDIT.md` 보충.
- Android 앱 재빌드 가능성 확인.

## 프로젝트 순서

| 순서 | 프로젝트 | 상태 |
| --- | --- | --- |
| 1 | 이름 변경과 tmux 서버 분리 | 완료. PR #42/#43/#44 merge, live 전환, 재부팅 검증. npm 첫 배포만 보류 |
| 2 | Claude Code provider → multi-agent(Claude Code + Codex 동시 실행, 일 나누기, 상호 리뷰) | 설계 1 진행 중. 단계 1 main merge·live 배포(`19a44ca8`). 단계 2는 Task 1만 main merge·live 배포(`47ea57e7`), Task 2~10은 branch `feat/claude-provider-phase2`에서 구현·전체 gate·격리 live smoke 완료, merge 전 |
| 3 | 위임 자동화와 agent split | 2번 범위에 합쳐질 가능성이 높음. 2번 설계에서 결정 |

## 사용자 요구 (사용자 발언 기준)

- 현재 작업 흐름: Claude Code에서 진행 상황을 점검하고 Codex용 지시서를 작성한다. Codex에서 지시서
  내용이 적용되는지 확인한다.
- 불편: 기존 codexmux 화면에는 screen pane 기능이 없어 실시간 진행 상황 확인이 아쉬웠다.
- 목표: "에이전트 여럿을 한 화면에서. Claude Code와 Codex를 동시에 돌리고, 일을 나누고, 서로
  리뷰하는 기능." 롤모델은 `https://github.com/herdrdev`.
- 위임 방식 질문(agent가 agent에게 맡기는지, 사람이 각각 맡기는지)에 사용자는 "일 나누기·서로 리뷰"라고만
  답했다. 누가 일을 나누고 리뷰를 시작하는지는 아직 정해지지 않았다.

## 이해한 내용 (사용자 확인 전)

사용자에게 다음과 같이 되읊었고 아직 정정이나 확인을 받지 못했다.

- 한 화면에서 Claude Code와 Codex가 동시에 돈다. 화면 나누기는 현재 기능으로 충분하다.
- 한 agent가 다른 agent에게 일을 맡긴다. 예: Claude Code가 지시서를 써서 Codex에게 넘긴다.
- 일을 맡은 agent는 끝나거나 막히면 결과를 회신한다.
- Agent끼리 서로의 결과를 리뷰한다. 예: 한쪽이 구현하고 다른 쪽이 리뷰한다.
- 지금 손으로 하는 "Claude Code 지시서 작성 → Codex 적용 → 사람 확인" 흐름을 agentmux가 이어 준다.
- 참고 모델은 Herdr `hc`의 부모/자식 위임, 회신 메시지, reviewer 역할 template이다.

추측(확인 필요):

- 위임과 회신이 돌아가려면 agentmux가 Claude Code의 상태(작업 중, 입력 대기, 끝남)도 알아봐야 한다.
  지금은 Codex만 알아본다.
- 구현자, 리뷰어 같은 역할을 저장해 두고 골라 쓰는 기능이 필요할 것 같다.
- 어느 agent든 위임하는 쪽이 될 수 있어야 한다. Claude Code만 위임하는 쪽으로 정하지 않았다.

## 확인한 사실

### Pane split은 이미 있다

- Content header 버튼, `Ctrl+Alt+D`(오른쪽 split), `Ctrl+Shift+D`(아래 split). 최대 10 pane.
- API: `POST /api/layout/pane` `{sourcePaneId, orientation}`. `writeLayoutFile`이 Runtime v2 storage로
  mirror한다.
- 격리 환경(임시 `HOME`과 `TMUX_TMPDIR`, Runtime v2 storage `default`)에서 workspace 생성 → split →
  2 pane layout → 서버 재시작 뒤 2 pane 유지까지 확인했다. 사용자도 화면에서 동작을 확인했다.

### Herdr 분석 보고는 부분적이었다

- 2026-11-09 감사는 herdr TUI 하나만 다뤘다. Multi-agent 목표 기능(부모/자식 위임, agent 간 메시지와
  회신, reviewer template, 통합 agent sidebar, diff panel, layout preset)은 대부분 `herdr-core`(`hc`),
  `herdr-app`, `herdr-layout-examples`에 있다.
- `pane wait-output`은 event-driven이 아니라 polling이다.
- 상세와 근거 위치는 `docs/HERDR-ADOPTION-AUDIT.md`의 "보충 감사 (2026-11-10)" 절에 정리했다.

### Purplemux 기능 대조 (같은 날)

- `subicura/purplemux` `52140216`(`v0.4.5`)의 서비스 기능을 다시 정리하고 agentmux와 기능 단위로
  대조했다. 결과는 `docs/PURPLEMUX-ADOPTION-AUDIT.md`의 "보충 분석 (2026-11-10)" 절에 있다.
- 사용자 결정: purplemux에 있고 agentmux에 없는 기능을 agentmux에 추가한다. 기존 감사의 "Claude Code
  provider 비채택" 결정은 뒤집혔다.
- 빠진 기능 묶음: A. Claude Code provider, B. 공통 agent 기반(세션 통합 목록, Chat/Terminal 전환 등),
  C. 위임 안내 주입, D. Codex 보조(update prompt, TUI ready), E. 일반 UI(Git side panel, 모바일 Git,
  reload 복구).
- Behavior·contract 변경이므로 Full lifecycle로 진행한다. 설계 문서 승인 전에는 구현하지 않는다.
- 순서 확정(사용자: "이 순서(설계 1 → 2 → 3)로 진행"): 설계 1 = A+B+C, 설계 2 = D+E, 설계 3 = Herdr 방식
  회신·상호 리뷰 흐름.
- 위임 확인 방식 결정(사용자: "확인 없이 바로 진행"): agent가 다른 탭을 만들거나 지시를 보낼 때 사용자 확인을
  거치지 않는다. 화면에 보이면 된다.
- Claude Code 자체 권한 확인 결정(사용자: "미리 허용"): agentmux가 띄운 Claude Code에서 `agentmux tab` 명령을
  미리 허용한다. Live Codex가 `danger-full-access` + 승인 없음이라 Claude가 보낸 지시가 확인 없이 실행된다는
  점을 설명한 뒤 받은 결정이다.
- 설계 1 초안: `docs/superpowers/specs/2026-11-10-claude-code-provider-design.md`. Builder check(독립 subagent)
  9개 질문을 반영했다. 조사 결과(서버 약 40곳,
  화면 약 25개 파일의 Codex 고정 지점, purplemux 구현 방식, Claude Code hook 공식 문서 확인)를 문서의 "현재
  사실"과 "Hook 계약 확인"에 담았다.

## 설계에서 정할 것 (미결)

1. 사람이 어느 시점에 개입하는가: 위임 자체는 확인 없이 진행하기로 결정했다(2026-11-10). 리뷰 결과를
   언제 사람이 보는지는 설계 3에서 다룬다.
2. 누가 일을 나누는가: 한 agent가 lead로 위임하는지, 사람이 두 agent에게 각각 주는지.
3. 리뷰를 누가 언제 시작하는가: 구현 agent가 끝나면 자동으로 리뷰 agent에게 넘기는지.
4. Claude Code 상태 감지 방식: 화면 감지, hook, OSC 7501 같은 상태 protocol 중 무엇을 쓰는가.
5. 회신 경로: agent 간 메시지 형식, 사용자 지시와 agent 보고를 구분하는 규칙, 긴 결과 전달 방식.
6. 3번 프로젝트(위임 자동화와 agent split)를 2번에 합칠지.

## Android 앱 재빌드 확인

`docs/ANDROID.md`의 Capacitor Android 앱은 실행 중인 Linux agentmux 서버에 접속하는 WebView client다.
이 앱을 agentmux 이름으로 다시 빌드할 수 있는지 확인했다.

- 도구: Android SDK platform 35/36, build-tools 35/36, Gradle wrapper 8.14.3(cache 있음),
  JDK 21(`JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`로 실행). 기본 JDK 25에서도 `./gradlew help`는
  통과했지만 전체 build는 JDK 21로만 확인했다.
- `corepack pnpm android:build:debug` 성공(`cap sync` 포함, tracked 파일 변경 없음).
  `corepack pnpm android:test:unit` 3개 test 통과.
- 새 debug APK: label `agentmux`, `versionName=0.5`, `versionCode=500`, package
  `com.hardcoremonk.codexmux`, target SDK 36. 이전 debug APK는 `0.4.7`, label `codexmux`였다.
- `versionName`이 `0.5`인 것은 `android/app/build.gradle`이 끝의 `.0`을 떼는 기존 규칙 때문이다.
- App ID `com.hardcoremonk.codexmux`는 rename 설계에서 재설치를 피하려고 유지하기로 한 값이다.
- 남은 차이: 앱 첫 화면(`android-web/index.html`)의 title, 제목, 안내문, 오류 문구에 `codexmux`가 남아
  있다. 이 파일은 product name gate 검사 범위 밖이라 rename 때 빠졌다. `localStorage` key
  `codexmux:server-url`, `codexmux:recent-server-urls`는 저장된 서버 주소를 지키려면 유지해야 한다.
- 기기가 연결되어 있지 않아(`adb devices` 비어 있음) 설치와 기기 smoke는 하지 않았다. Release
  APK/AAB도 이번에는 만들지 않았다(local keystore는 있음).
- 판단: 기존 구조(Linux 서버 + Android client)로는 재빌드가 가능하다. Agentmux engine 자체를 폰에서
  돌리는 독립 앱은 tmux, `node-pty`, systemd, Codex CLI가 필요해 일반 Android 앱으로는 현재 구조에서
  불가능하다.
- 사용자 결정: Linux 서버에 접속하는 client 앱. 폰에는 기존 codexmux 앱이 설치되어 있다.
- 후속 조치(같은 날):
  - Launcher 표시 문구 5곳을 `agentmux`로 바꿨다. `localStorage` key와 JS bridge 이름 `CodexmuxAndroid`는
    유지했다.
  - `android-web/index.html`을 product name gate 검사 범위에 넣고 위 보존 식별자 3개를 허용 목록에 추가했다.
    Unit test를 먼저 실패시킨 뒤 통과시켰다.
  - Debug APK, signed release APK, release AAB를 다시 만들었고 `smoke:android:release-aab`가 통과했다.
    셋 다 label `agentmux`, `versionCode=500`이다.
  - Release APK의 서명 인증서는 이전 release APK와 같다. 따라서 폰의 기존 앱이 release 서명이면 지우지
    않고 덮어써서 업데이트된다. Debug 서명은 인증서가 달라 release APK로 업데이트할 수 없다.
  - 이전 release APK/AAB(`0.2.4`)는 session scratchpad에 백업했다.
- 기기 설치(같은 날): USB로 연결한 SM-S928N(Android 17)에 설치된 앱은 `0.4.7`, **debug 서명**이었다.
  Release APK로는 덮어쓸 수 없어 같은 debug 키로 서명된 새 debug APK를 `adb install -r`로 덮어써
  `0.5`(`versionCode=500`)로 올렸다. 앱 data는 유지했다. 기존 APK는 session scratchpad에 받아 두었다.
- `smoke:android:foreground` 통과(`ok: true`, foreground 2회, blocking console/logcat 0건, WebView title
  `agentmux`). `smoke:android:recovery`는 잘못된 서버 주소로 이동하는 시나리오라 저장된 서버 주소를
  건드릴 수 있어 실행하지 않았다.
- 사용자 결정으로 release 서명으로 전환했다. Debug 앱을 지우고 signed release APK를 설치했다(인증서
  SHA-256 `3a096977…`, debuggable flag 없음). 저장된 서버 주소와 로그인은 초기화되었다. 앱은 crash 없이
  기본 서버의 로그인 화면까지 열렸다. Release build는 WebView devtools가 꺼져 있어 CDP 기반
  `smoke:android:*`는 release 앱에 쓸 수 없다.
- 새로 발견한 결함: 웹 UI logo `src/components/layout/app-logo.tsx`가 `codex`와 `mux`를 별도 span으로
  그려 header, sidebar, login, onboarding, tools-required 화면에 옛 이름이 보인다. 단어가 나뉘어 있어
  product name gate가 잡지 못했다.
- 사용자 승인 뒤 logo를 `agent`+`mux`로 고치고 표시 텍스트를 unit test로 고정했다(`e369598b`). 전체
  test 1774개 통과, lint error 0(경고 6개는 기존 파일), typecheck 통과. `deploy:local`로 live에
  배포했다(07:02 KST, PID `2076015`, health commit `e369598b`). tmux 서버 `43870`과 session은
  유지되었고 service log에 오류가 없다. 폰 로그인 화면에서 `agent`+`mux` 표시를 확인했다.
- Branch `chore/android-launcher-and-handoff`는 PR #45로 CI 통과 뒤 main에 merge했다(merge commit
  `1b7408b4`, main CI 성공). Branch는 local과 GitHub에서 지웠다. Live build `e369598b`는 merge된 내용과 같다.

## Claude Code provider 단계 1 구현과 검증 (같은 날)

- Plan: `docs/superpowers/plans/2026-11-10-claude-code-provider-phase1.md`. Plan review:
  `docs/superpowers/reviews/2026-11-10-claude-code-provider-phase1-eng-review.md`(approve with changes, 반영 완료).
- Branch `feat/claude-provider-phase1`, commit `16a9a468..0b1b7382`와 이 문서 commit. Main merge와 live 배포는 하지
  않았다.
- 바뀐 것: agent 종류 집합(`AGENT_PANEL_TYPES`), provider status 동작 flag(`reconcileStateFromJsonl`,
  `recoverPaneInput` 추가)와 `readJsonlStatus`, provider별 JSONL 허용 root(`jsonlRoots`), hook capability 공용
  module(`agent-hooks.ts`), client provider metadata 표(`agent-provider-meta.ts`), agent 패널 설치 안내 문구
  namespace 수정. 새 탭 메뉴의 agent 탭은 terminal v2 mode와 관계없이 Runtime v1(`pt-`)으로 만든다. 문서:
  `docs/STATUS.md` "Provider status 동작 flag", `docs/RUNTIME-V2-CUTOVER.md` 2단계.

### 전체 gate (2026-11-10 18:45, worktree `0b1b7382` + 문서 변경)

`check:project-design`, `check:product-name`(736 files), `lint`(error 0, 기존 경고 6개
`no-location-assign-relative-destination`), `tsc --noEmit`, `test`(286 files 통과·1 skipped, 1809 tests 통과·3
skipped), `build` 모두 통과.

### 격리 Runtime v2 smoke

임시 `TMUX_TMPDIR`로 실행했고 실행 전후 기본 socket의 `tmux -L codexmux ls`(live session 1개)와
`tmux -L codexmux-runtime-v2 ls`(server 없음) 결과가 같았다.

- Plan의 명령 그대로는 `smoke:runtime-v2`가 `runtime v2 smoke cli token timed out`으로 실패했다. Script가
  `$HOME/.codexmux/cli-token`을 읽는데, 이름 변경(`18bd3bab`) 뒤 새 `HOME`의 data dir는 `.agentmux`다. 단계 1과
  무관한 기존 결함이다. 이 실패 경로에서 script가 띄운 dev server가 남아 직접 종료했다.
- 임시 `HOME`에 `.codexmux` directory를 미리 만들어(`CODEXMUX_RUNTIME_V2_SMOKE_HOME`) 다시 돌리면 `ok: true`(10개
  check)다.
- `smoke:runtime-v2:phase2`는 3번 모두 server 재시작 단계(`GET /api/layout ... fetch failed`)에서 실패했다. Port
  점유 PID를 0.1초 간격으로 기록해 보니 `stop()`은 `corepack` wrapper가 끝나면 돌아오고, 실제 server는 아직
  종료 중이라 새 server의 health check가 옛 server에 응답받았다. Script(`8977a247` 이후 변경 없음)의 기존 race다.
  `stop()` 뒤 port가 풀릴 때까지 기다리는 진단용 사본(commit하지 않음)으로는 `ok: true`(10개 check, 재시작 뒤
  legacy·v2 재연결과 terminal mode `off`의 legacy 새 탭 포함)다.

### 격리 Codex 회귀 확인 (18:52~19:00 KST)

- 환경: 이 worktree production build(`node bin/agentmux.js`, health commit `0b1b7382`), 임시
  `AGENTMUX_DATA_DIR`·`TMUX_TMPDIR`, `PORT=18122`, plan의 Runtime v2 mode 5개. 안전장치로
  `AGENTMUX_TMUX_SCOPE=off`, `INVOCATION_ID` 제거, `NO_UPDATE_NOTIFIER=1`을 더했다. 임시 `config.json`에
  `codexApprovalPolicy: "on-request"`, `codexSandbox: "read-only"`, onboarding에서 `dangerouslySkipPermissions:
  false`. Workspace directory `/data/projects/agentcode-zone`(Codex 신뢰 등록됨). Codex `0.167.0`. Prompt 3개.
- 탭 생성: 새 탭 메뉴 요청(`panelType: "codex"`, `startAgent: true`)은 `pt-ws-…-tab-oLASRf`(`runtimeVersion: 1`)로
  만들어졌고 Codex가 `--sandbox read-only --ask-for-approval on-request`와 hook override 3개로 시작했다. 같은
  server에서 plain terminal 요청(`{}`)은 `rtv2-ws-…-tab-zw7gvhxlj7`(`runtimeVersion: 2`)이다.
- Codex 시작 화면에 "Hooks need review(3 hooks are new or changed)"가 떴다. agentmux가 실행마다 새 capability를
  넣은 session hook을 붙이기 때문이다. 신뢰하지 않고 Esc(skip)로 넘겼다. 그래서 이 session에서는 hook이 돌지
  않았고 상태는 JSONL·process polling으로만 판정됐다. 이 화면에 `permission-options`는 `options: []`를 돌려줘 웹
  카드가 뜨지 않는다.
- 상태: Codex가 JSONL 없이 실행 중인 동안 `busy`였다(기존 `resolveStatusInitialCliState` 규칙). 짧은 prompt(18:54:45)에
  Codex가 2초 만에 답했고 status WebSocket에 `ready-for-review`(18:55:05)가 왔다. 같은 시각 `rate-limits:update`도
  왔다.
- Timeline·resume: `/api/timeline/sessions`(`panelType=codex`, workspace cwd)의 첫 항목이 새 session
  `01a1c4e0-…`이다. 탭을 다시 열 때와 같은 timeline WebSocket 연결에 `timeline:init`(user·assistant 2개, 같은
  session id)이 왔고, 그 뒤 탭에 session id가 묶였다.
- 권한 요청: shell 쓰기를 요구한 prompt는 승인 없이 실행됐다. Session JSONL의 `turn_context`는 `sandbox_policy:
  read-only`, `approval_policy: on-request`였는데 임시 data dir 안의 파일이 만들어졌다(agentmux 밖 Codex 동작, 파일은
  임시 dir와 함께 지움). `apply_patch`를 요구한 prompt는 "Would you like to make the following edits?"를 띄웠다.
  Status WebSocket이 `needs-input`(18:57:38)을 보냈고, `permission-options`가 선택지 3개(`Yes, proceed`,
  `Yes, and don't ask again for these files`, `No, and tell Codex what to do differently`)와 `promptType: file`을
  돌려줬다. 웹 카드와 같은 요청 `POST /api/tmux/send-input`(`input: "3"`)이 `{"ok":true}`를 받았고 Codex는
  "Conversation interrupted"로 돌아갔다. JSONL에 `turn_aborted`(`interrupted`)가 남았고 파일은 만들어지지 않았다.
- 거절 뒤 상태는 웹 카드가 보내는 `status:ack-notification`을 보낼 때까지 `needs-input`에 머물렀다. Ack 뒤
  `busy` → `idle`(4초)로 바뀌었다. `needs-input`에서 완료 문구 없이 중단된 turn을 그대로 두는 것은
  `reduceCodexState`의 기존 규칙이다.
- 정리: 임시 server(SIGINT), 두 임시 tmux server(`kill-server`), 임시 directory를 지웠다. 시작한 process가 모두
  끝났고 port 18122는 비었다. 기본 socket의 tmux session 목록과 `~/.codex/config.toml` checksum은 전후 같다.
  Codex session JSONL 1개는 사용자 `~/.codex/sessions`에 남는다(Codex 기본 동작).

## Claude Code provider 단계 2 구현과 검증 (같은 날)

- Plan: `docs/superpowers/plans/2026-11-10-claude-code-provider-phase2.md`. Plan review:
  `docs/superpowers/reviews/2026-11-10-claude-code-provider-phase2-eng-review.md`(approve with changes, `01215b73`에 반영).
- Branch `feat/claude-provider-phase2`(worktree `.worktrees/claude-provider-phase2`, base `19a44ca8`).
- 작업 체계: 사용자 결정대로 Herdr pane의 agy(`builder`)가 task를 구현하고 Claude가 task마다 diff와 test로 검증한 뒤
  독립 reviewer를 돌렸다. Task 1~3은 agy가 구현했다.
- agy 사용량 한도: Task 4 도중 agy 안의 Claude Sonnet이 사용량 한도에 걸렸다(commit 전 부분 변경). 사용자가 agy를
  Gemini 4 Argon High로 바꿨지만 이것도 한도에 걸렸다(재설정까지 약 124시간, agy의 Claude Sonnet은 약 4시간).
  사용자는 agy 한도가 돌아올 때까지 Claude subagent가 구현하고, 돌아오면 남은 task를 agy에게 돌려주는 방식을
  골랐다. Task 4는 Claude subagent가 agy의 부분 변경을 이어 마쳤고 Task 5~10도 Claude subagent가 맡았다(23:22까지
  agy 한도 미복구).

### Task 1 먼저 배포

Task 1(모르는 panelType 읽기 정규화, status behavior IPC schema가 모르는 key를 버림, `e0b03c25`)만 main에 merge했다
(`47ea57e7`). 이후 build에서 Claude 탭을 만든 뒤 되돌려도 layout 전체가 깨지지 않게 하려는 순서다. 사용자가 push(main CI
`42813980564` 성공)와 `deploy:local`을 직접 실행했다: 21:18 KST, PID `2865470`, health commit `47ea57e7`, tmux 서버
`43870`과 session 1개 유지, service log error 0.

### Task별 결과

| Task | Commit | 검토 |
| --- | --- | --- |
| 1 panelType 정규화, IPC 함정 | `e0b03c25` (main `47ea57e7`) | 3줄 변경, controller 확인으로 승인 |
| 2 Hook 필드 전달, session 다시 묶기 | `2b5f2afd` | Approved |
| 3 실행 명령, project directory, 감지 | `9fbdebc3` | Approved |
| 4 탭 설정 파일, statusLine 대신 실행 | `28ae01c4`, 수정 `4a972a17` | 수정 1회: 무한 호출 방지를 환경 변수 표시와 realpath·별칭 비교로, POST 마감 시간 |
| 5 Provider 등록, 실행 session id, 탭 정리 | `a369a91d`, 수정 `63055f0e` | 수정 1회: 다시 실행한 탭이 옛 JSONL에 묶이는 문제, 첫 prompt 전 session 재개 |
| 6 Provider별 rate limit | `9e0b95e9` | Approved |
| 7 Provider별 preflight, Claude 설치 명령 | `9aac47c4` | Approved |
| 8 권한 요청 Claude 문구, folder trust | `5b59c790`, 수정 `b76f3a1b` | 수정 1회: trust 카드를 탭별로, 모바일 입력 영역을 가리지 않게 |
| 9 새 탭 메뉴, 보기 전환, 단축키, 모바일 | `88110c80` | Approved |
| 10 문서, gate, 격리 live smoke | 이 문서 commit | 아래 |

### 전체 gate (2026-11-10 23:33~23:37 KST, worktree `88110c80` + 문서 변경)

- `check:project-design` 통과.
- `check:product-name`: 이번에 쓴 문서 줄이 `~/.codexmux`를 호환 표시 없이 적어 실패했다(`STATUS.md` 한 줄, 다시 실행에서
  `FOLLOW-UP.md` 한 줄). `legacy`를 붙여 고친 뒤 통과(738 files).
- `lint` error 0(경고 6개는 기존 `no-location-assign-relative-destination`), `tsc --noEmit` 통과.
- `test`(임시 `TMUX_TMPDIR`): 302 files 통과·1 skipped, 1942 tests 통과·3 skipped. 이번 실행에서는 Codex session
  test 불안정이 나오지 않았다.
- `build` 통과.

### 격리 Claude Code live smoke (23:39~23:47 KST)

- 환경: 이 worktree production build(`node bin/agentmux.js`, health commit `88110c80`). 이 shell의 환경을 물려받지 않도록
  `env -i`로 `HOME`(실제 값, Claude 로그인), `USER`, `LOGNAME`, `SHELL`, `LANG`, `TERM`, `PATH`만 넘기고 임시
  `AGENTMUX_DATA_DIR`·`TMUX_TMPDIR`, `PORT=18122`, `AGENTMUX_RUNTIME_V2=1`과 live와 같은 mode 4개(storage
  `default`, terminal `new-tabs`, timeline `default`, status `default`), `AGENTMUX_TMUX_SCOPE=off`를 더했다.
  `INVOCATION_ID`는 없다. 그 밖에 `NO_UPDATE_NOTIFIER=1`, hook event를 server log에 남기려고 `LOG_LEVELS=hooks=debug`를
  더했다. Claude Code `2.1.322`. Workspace directory는 이 worktree다.
- 사용자 Claude 설정의 기본 권한 mode가 `auto`라 파일 쓰기가 확인 없이 승인될 수 있어, 임시 data dir 설정에
  `claudePermissionMode: "manual"`을 넣었다(`--permission-mode manual`이 붙음).
- Claude prompt는 2개를 썼다.

| # | 확인 | 결과 |
| --- | --- | --- |
| 1 | 시작 전 sha256 | `~/.claude/settings.json` `98193cce…`, `~/.codex/config.toml` `7e823d6a…` |
| 2 | 새 탭 API로 Claude 탭 | `pt-ws-PTQTCZ-pane--AXIRy-tab-wGwo7R`(`runtimeVersion: 1`). Process 인자 `claude --settings <임시 data dir>/claude-tabs/tab-wGwo7R.json --session-id 33e9b69f-… --permission-mode manual`. 설정 파일 `0600`, directory `0700`, hook 7개 모두 `async`, `timeout: 3`. Trust 화면도 hook 검토 화면도 뜨지 않았다. `SessionStart(startup)` hook으로 `inactive`→`idle` |
| 3 | 짧은 prompt | "Reply with OK" → status WebSocket `busy`(23:40:35.090, `prompt-submit`) → `ready-for-review`(23:40:36.797, `stop`). Server log `received prompt-submit`, `processed prompt-submit idle→busy`, `received stop`, `processed stop busy→ready-for-review`. statusLine이 `rate-limits:update`(`providerId: claude`, 7일 창만 있음)를 보냈다 |
| 4 | Timeline | `/api/timeline/entries`(`panelType=claude`)가 그 JSONL에서 5개 항목(user "Reply with OK", thinking, assistant "OK", turn-end 2개)을 돌려줬다 |
| 5 | 권한 요청 | Write 요청 → `notification(permission_prompt)`(23:41:12.844) `busy`→`needs-input`. `permission-options`가 `1. Yes`, `2. Yes, and switch to accept edits …`, `3. No`와 `promptType: file`을 돌려줬다. 선택지가 화면에 있는 69초 동안 `needs-input`을 유지했다. 웹 카드와 같은 `POST /api/tmux/send-input`(`input: "3"`)이 `{"ok":true}`, Claude는 "User rejected write", 파일은 생기지 않았다. 23:42:21.672 `left needs-input after JSONL growth`로 `busy` |
| 6 | `/clear` | `session-start`(`source: clear`)로 `busy`→`idle`, 탭 session id `33e9b69f-…`→`cb59229b-…`. `~/.claude/sessions/<pid>.json`은 새 id, process 인자는 옛 id 그대로. 50초 뒤(30초 poll 지난 뒤)에도 tab status API와 layout의 `agentSessionId`·`agentJsonlPath`가 새 값이고, timeline API가 새 JSONL의 항목(`/clear`)을 돌려줬다 |
| 7 | statusLine | Worktree에 임시 `.claude/settings.local.json`(`printf phase2-statusline`)을 두고 `/exit` 뒤 `POST /api/agent/launch`(`resume`) → `claude --settings … --resume cb59229b-… --permission-mode manual`, 화면 하단에 `phase2-statusline`. `session-start`(`source: resume`). 확인 뒤 파일과 directory를 지웠다 |
| 8 | Folder trust | 임시 directory에서 별도 tmux socket(임시 `TMUX_TMPDIR`)으로 `claude`만 실행. 화면은 "Accessing workspace:" 다음 줄 경로, "Quick safety check", `❯ No, exit`, `Yes, I trust this folder`. `matchTrustPrompt`가 `agent: claude`, 해당 경로, 선택지 2개, `selectedIndex: 0`으로 감지했고 Task 8 규칙은 고치지 않았다. 웹 카드 "종료" key(`1b`, Esc)를 보내자 Claude가 끝났다. `~/.claude.json`에 그 directory 항목이 없어 `hasTrustDialogAccepted`는 true가 아니다 |
| 9 | 정리 | sha256 두 값 그대로. 임시 server(SIGINT), 임시 tmux server(`kill-server`), 임시 directory 4개를 지웠고 port 18122는 비었다. 기본 socket `tmux -L codexmux ls`(live session 1개)와 `tmux -L codexmux-runtime-v2 ls`(server 없음), service PID `2865470`이 전후 같다 |

- 23:44:35의 `notification(idle_prompt)`는 상태를 바꾸지 않았다(`non-input notification`).
- Claude session JSONL 2개는 사용자 `~/.claude/projects/` 아래에 남는다(Claude Code 기본 동작). `HOME`이 실제 값이라
  사용자 hook(SessionStart, Stop, Notification)도 이 session에서 함께 돌았다(설계상 사용자 hook 유지).
- 찾은 결함:
  - 권한 요청에 "No"로 답하면 탭이 `busy`에 남는다. 위 5번 뒤 74초 동안 `busy`였고 `/clear`의 hook에서야 `idle`이 됐다.
    Claude Code는 거절 뒤 `Stop` hook을 보내지 않고, JSONL 끝이 `[Request interrupted by user for tool use]` 다음
    `system/turn_duration`이라 `jsonl-idle-scan`이 `idle: true, interrupted: false`를 돌려준다.
    `decideNeedsInputJsonlExit`는 `idle`을 보지 않아 `busy`를 고르고, Claude는 `reconcileStateFromJsonl`이 꺼져 있어
    `busy`에서 빠져나갈 경로가 없다. 웹 카드가 함께 보내는 `ack-notification`도 `busy`로만 바꾼다.
  - `permission-options`가 줄바꿈된 Claude 선택지를 공백 없이 붙인다("file" + "commands" → "filecommands").
    `permission-prompt.ts`의 soft-wrap 이어 붙이기(기존 코드)가 단어 중간 줄바꿈만 가정한다.
  - 임시 server를 SIGINT로 끌 때 timeline worker가 부모 IPC에 `process.send`하다 처리되지 않은 `EPIPE`로 끝났다.
    단계 2가 바꾸지 않은 worker 종료 경로다.
  - Timeline이 한 turn에 `turn-end`를 2개 돌려준다. Claude Code가 `stop_hook_summary`와 `turn_duration`을 둘 다 쓰고
    `session-parser.ts`가 둘 다 `turn-end`로 바꾼다. 화면 영향은 확인하지 않았다.

## Claude Code provider 단계 2 최종 검토 수정과 live 재확인 (2026-11-11)

Branch 전체 최종 검토가 merge 전 수정 2개와 작은 수정 3개를 냈고, 한 commit(`d5f3432a`)으로 고쳤다.

- 중단된 turn: 권한 요청 "No", Esc, 웹 중지 버튼으로 끝난 turn은 `Stop` hook 없이 JSONL이
  `[Request interrupted by user …]` 다음 `system/turn_duration`으로 끝난다. `jsonl-idle-scan`이 turn 종료 줄에서 바로
  `interrupted: false`를 돌려줘 탭이 `busy`에 남았다. 이제 turn 종료 줄 앞의 마지막 대화 줄(sidechain, `isMeta` 제외)이
  interrupt 표시면 `interrupted: true`라 `needs-input` 출구와 JSONL 합성 interrupt가 모두 `idle`로 간다. 정상 turn은 그대로.
- 모바일 탭 이름: 440px 미만에서 보기 전환 버튼 4개를 현재 보기 아이콘의 44px 버튼 하나로 접고, 누르면 Terminal, Codex,
  Claude Code, Diff 행(각 44px, 아이콘과 label)이 있는 popover가 열린다. 360px terminal 탭에서 이름 폭이 약 0px에서 약
  140px로 늘어난다(계산값, browser로는 보지 않음).
- JSONL에서 읽은 rate limit을 그 provider id로 발행(전에는 항상 `codex`). Hook `transcriptPath`는 탭 provider의
  `jsonlRoots()`로만 검사하고 provider가 없으면 버린다. `providers.test.ts` test 이름 수정.
- Gate: 관련 test RED→GREEN, `tsc --noEmit` 통과, `lint` error 0(기존 경고 6개), 전체 test(임시 `TMUX_TMPDIR`) 303 files
  통과·1 skipped, 1956 tests 통과·3 skipped(Codex session test 불안정은 나오지 않음), `check:project-design`,
  `check:product-name`, `build` 통과.

### 격리 live 재확인 (00:18~00:25 KST)

- 환경은 Task 10 smoke와 같다: 이 worktree production build(health commit `d5f3432a`), `env -i` 허용 목록, 임시
  `AGENTMUX_DATA_DIR`·`TMUX_TMPDIR`, `PORT=18122`(시작 전 비어 있음), `AGENTMUX_RUNTIME_V2=1`과 live mode 4개,
  `AGENTMUX_TMUX_SCOPE=off`, `INVOCATION_ID` 없음, `NO_UPDATE_NOTIFIER=1`, `LOG_LEVELS=hooks=debug`, 임시 설정
  `claudePermissionMode: "manual"`. Workspace directory는 이 worktree(trust 화면 없음). Claude Code `2.1.322`.
- Claude prompt는 3개를 썼다. 상태는 status WebSocket 기록, hook은 임시 data dir의 server log로 확인했다.

| # | 확인 | 결과 |
| --- | --- | --- |
| 1 | Terminal에서 "No" | Write 요청 → `notification(permission_prompt)`로 `needs-input`(00:21:47.150). 화면에서 `3. No`를 확인하고 tmux `send-keys 3`(00:21:56.950). JSONL에 `tool_result(is_error)`(56.959), `[Request interrupted by user for tool use]`(56.961), `turn_duration`(56.964). Server log `left needs-input after JSONL growth` `to: idle`, `lastEntryTs`는 `turn_duration` 시각. Status WebSocket `idle` 00:21:57.206(입력 뒤 0.26초), 30초 poll 뒤에도 `idle`. 파일은 생기지 않았다. 통과 |
| 2 | 웹 경로 "No" | 두 번째 Write 요청 → `needs-input`(00:22:46.936, seq 5). 웹 카드와 같은 순서로 cookie를 붙인 `POST /api/tmux/send-input {"input":"3"}`(200, 00:22:54.994) 뒤 `status:ack-notification`(seq 5). `ack: needs-input→busy`(54.996) → `synthetic interrupt from JSONL`(`lastEntryTs` = `turn_duration` 54.995) → `processed interrupt busy→idle`(seq 6). Status WebSocket `busy` 00:22:54.997, `idle` 00:22:55.225(입력 뒤 0.23초). 파일은 생기지 않았다. 통과 |
| 3 | 정상 turn | "Reply with OK" → `busy`(00:23:37.481, `prompt-submit` seq 7) → `ready-for-review`(00:23:38.103, `stop` seq 8), 화면 `● OK`. JSONL 끝은 assistant `end_turn`, `stop_hook_summary`, `turn_duration`. 27초 뒤 tab status API도 `ready-for-review`. 통과 |
| 4 | 정리와 불변 조건 | 상태 watcher, 임시 server(SIGINT, worker 5개 함께 종료), 임시 tmux server(`kill-server`, Claude process 종료)를 멈췄고 port 18122는 비었다. 임시 data dir와 tmux dir를 지웠다. 전후 sha256(`~/.claude/settings.json` `98193cce…`, `~/.codex/config.toml` `7e823d6a…`), 기본 socket `tmux -L codexmux ls`(live session 1개), `tmux -L codexmux-runtime-v2 ls`(server 없음), service PID `2865470`이 같다 |

- Server log에 warn·error 줄이 없었고, 이번 종료에서는 timeline worker `EPIPE`가 나오지 않았다.
- Claude Code `2.1.322`가 JSONL에 `api-request-blob`, `api-request` 줄을 새로 쓴다. 상태 검사는 이 종류를 대화 줄로 보지
  않아 결과에 영향이 없었다.
- Claude session JSONL 1개가 사용자 `~/.claude/projects/` 아래에 남는다(Claude Code 기본 동작).

## Claude Code provider 단계 3 구현과 검증 (2026-11-11)

공통 agent UI(공통 session 목록과 provider 간 재개, Session Explorer provider column·filter, 통계·일일 리포트의
Claude, 전환 잠금과 Terminal 보기 제안, 시작 진행 표시, Claude 설정과 terminal 표시 공통 설정, provider별 onboarding,
provider 중립 문구)를 branch `feat/claude-provider-phase3`(HEAD `8e2dc0e2`, Task 1~10)에 구현했다. Task마다 코드
검토를 거쳤다. 설계 판단은 plan(`docs/superpowers/plans/2026-11-11-claude-code-provider-phase3.md`)과 plan review에
있다. 구현 중 확정한 것: 통계 cache v4→v5는 additive 이동(Codex 값 유지, Claude는 첫 Claude transcript 날짜부터 더하고 이미
claude-* model이 있는 날은 건너뜀, v4 한 번 백업), 비용은 추정하지 않고 가격 없는 model은 `—`.

### 운영 기록 (이번 주기, 사용자 직접 실행)

- 단계 2 배포: 2026-11-11 02:16 KST, health `f46890ba`, PID `1471777`.
- Hotfix #48(Claude JSONL의 catalog `observeFile` 거절로 timeline worker 종료, live catalog는 shadow mode): `d1accfc6`
  merge, CI 성공, 02:35 KST 배포, health `d1accfc6`, PID `1705635`, worker 재시작 02:35:38, log error 0. 원격 branch
  `feat/claude-provider-phase2`, `fix/timeline-catalog-observe-rejection`는 사용자가 삭제.
- Live 통계 cache(legacy 실제 경로 `~/.codexmux/stats/cache.json`)는 v4(2026-03-26부터 127일, claude-* model은 03-26~04-27만). 단계 3 배포 뒤 첫
  통계 요청에서 `cache.v4.json`으로 복사되고 v5로 이동한다.

### 전체 gate (worktree `8e2dc0e2`)

`check:project-design` 통과, `check:product-name` 통과, lint error 0(기존 `window.location` 경고 6개), `tsc --noEmit` 통과,
전체 test 318 files / 2120 통과 / 3 skipped, `build` 통과.

### 격리 browser·live 확인

- 환경은 단계 2 Task 10과 같은 안전 규칙이다: 이 worktree production build, `env -i` 허용 목록, 임시 `AGENTMUX_DATA_DIR`와
  짧은 경로의 임시 `TMUX_TMPDIR`, port 18122, live와 같은 Runtime v2 mode(terminal `new-tabs`, storage/timeline/status
  default), `AGENTMUX_TMUX_SCOPE=off`, `INVOCATION_ID` 없음. Claude prompt 3개(한도 4개). Folder trust는 상위 directory가
  이미 수락돼 화면이 뜨지 않았고 응답하지 않았다.

| # | 확인 | 결과 |
| --- | --- | --- |
| 1 | Claude 탭 짧은 prompt | 통과. "OK" 응답, 탭이 session·transcript에 묶임. TUI가 prompt를 처음 그린 직후 보낸 prompt는 유실될 수 있어(transcript·usage 없음) 안정 뒤 다시 보내야 했다. 한 turn 뒤 상태는 `ready-for-review` |
| 2 | 공통 목록과 provider 간 재개 | 통과(UI). Codex 탭 목록에 "Claude Code" badge 항목, provider filter 동작, `providers=claude` API는 Claude만 반환. 항목 선택 → 서버에서 탭이 CLAUDE로 바뀌고 `agentSessionId`가 그 session에 묶이며 `claude --resume`이 이전 turn을 timeline에 보임. 격리 server의 Codex index가 첫 scan 중이라 Codex 항목은 0개 |
| 3 | busy 중 CODEX 전환 | 통과(UI). 잠금 toast, 탭은 `claude` 유지 |
| 4 | Terminal(v1) 보기 제안 | 통과(UI). workspace 첫 탭은 `new-tabs` mode에서도 v1이다(이후 만든 plain 탭은 v2라 제안 없음). `claude` 실행 → 제안 card → 수락하면 재시작 없이(시작 banner 1개) CLAUDE 보기 |
| 5 | 통계 | 통과. `claude-opus-5-5`, `claude-opus-4-8`이 `cost: null`로 "—", 표시 이름 "Claude Opus 5.5/4.8". Codex 사용자에게 보이는 변화: 가격 없는 Codex model(`gpt-6.1-sol`)도 "$0.00" 대신 "—" |
| 6 | 일일 리포트 Claude fallback | 부분 통과(의도된 한계). Codex를 PATH에서 빼도 preflight가 알려진 install path에서 찾아 script가 Codex 실행 전에 멈춤. 대신 fallback 호출 `claude -p --output-format text --no-session-persistence --restricted --tools '' --strict-mcp-config --disable-slash-commands`(prompt는 stdin, 빈 임시 cwd)를 손으로 1회 실행: 출력 "OK", exit 0, `~/.claude/projects`에 새 transcript·project directory 없음. 생성기가 이 경로를 고르는지는 `daily-report-builder.test.ts`가 고정 |

- 화면 확인(browser): 모바일 360px 헤더(탭 이름 보임), 데스크톱 보기 전환 짧은 label, 세션 목록 provider filter와 label, Session
  Explorer provider filter(전체/Codex/Claude Code), 설정 Claude Code 탭(model, permission mode, 명령 미리보기).
  Screenshot 10장은 commit하지 않았다(scratchpad `p3live/shots/`).
- 관찰(실패 아님): 직접 실행한 Claude는 agentmux hook이 없어 첫 prompt 전까지 timeline이 "Claude Code 세션 대기 중"이고 web 입력이
  "연결 중"이다. 터미널에서 친 첫 prompt 뒤 timeline이 묶이는지는 확인하지 않았다.
- 안전 확인: 전후 `~/.claude/settings.json`, `~/.codex/config.toml` sha256, 기본 `TMUX_TMPDIR`의 live tmux session 목록,
  `agentmux.service` MainPID `1705635`(NRestarts 0)가 같다. Live tmux server `43870`은 건드리지 않았고 격리 server 2개와 그
  tmux server, 임시 directory는 정리했다.

## Current Lifecycle Stage

- Multi-agent 설계 1(Claude Code provider + 공통 agent 기반 + 위임 안내): 설계 승인("후속 작업 승인"),
  grill-me Passed(`docs/superpowers/grill-me/2026-11-10-claude-code-provider.md`), design review Approved
  조건부(`docs/superpowers/reviews/2026-11-10-claude-code-provider-design-review.md`), 단계 1 plan-eng-review 반영,
  단계 1 implement 완료(branch `feat/claude-provider-phase1`). 전체 gate와 격리 Codex 회귀 확인을 마쳤다. 최종
  code-review는 "수정 후 merge"였고, 수정(`de0087ee`: 기존 Runtime v2 terminal 탭의 agent 보기 전환 차단, 새 agent
  탭 cwd 기본값 복구, hook capability 고정 값 test, 등록되지 않은 종류의 resume 400)과 범위 재검토를 마쳤다. 최종
  확인: test 1819 통과(3 skip), tsc, lint error 0, 문서 gate 통과. 사용자 선택으로 main에 로컬 merge(`19a44ca8`), 사용자가
  직접 push(main CI `42805309103` 성공)와 `deploy:local`(20:27 KST, PID `2553990`, health commit `19a44ca8`, tmux 서버
  `43870` 유지, log error 0)을 실행했다. Auto mode가 main push와 production deploy를 막아 사용자가 `!` 명령으로 실행했다.
- 설계 1 단계 2: plan-eng-review 반영(`01215b73`). Task 1은 main merge(`47ea57e7`)와 live 배포(21:18 KST, PID
  `2865470`)를 마쳤다. Task 2~9 implement와 task별 code-review를 마쳤고, Task 10에서 문서, 전체 gate, 격리 Claude Code
  live smoke(9개 확인 통과, 결함 4개 기록)를 마쳤다. Branch 최종 code-review 수정(`d5f3432a`, 권한 요청 "No" 뒤 `busy`
  고정과 모바일 탭 이름 폭 포함)과 격리 live 재확인(3개 통과)을 마쳤다. PR, main merge, live 배포는 이후 hotfix #48과 함께 완료(위 단계 3 절의 운영 기록).
- 설계 1 단계 3: plan-eng-review 반영(`2a749a2e`), Task 1~10 implement와 task별 code-review, 전체 gate, 격리 browser·live 확인(5개 통과, 1개 부분)을 마쳤다. Branch `feat/claude-provider-phase3`(`8e2dc0e2`)에서 branch 최종 code-review 전. PR, main merge, live 배포 전.
- Android와 웹 logo: release 서명 설치, live 배포, main merge(PR #45) 완료. operate.
- 이름 변경 프로젝트: operate (npm 배포 보류).

## Next Action

단계 3은 `feat/claude-provider-phase3`(`8e2dc0e2`)에 구현과 검증을 마쳤다. 다음은 branch 전체 최종 code-review, 수정이 있으면
반영, PR → CI → merge다. Main push와 `deploy:local`은 사용자가 직접 실행한다(auto mode가 막는다). 배포 뒤 live 통계 cache
v4→v5 이동(`cache.v4.json` 백업, Claude token 표시)을 확인한다. 배포 때 rollback이 필요하면 Claude 탭을 먼저 닫는다.
단계 4(위임 안내, `permissions.allow`, CLI 변경)는 단계 3이 merge된 뒤 계획을 쓴다.

## Follow-Up Tasks

- 작업 체계(사용자: "단계 2부터 이전처럼 \"agy 구현, Claude 감시·검증\" 체계"): 단계 2부터 구현은 Herdr pane의
  agy(`builder`)가 맡고 Claude는 계획, 감시, 검증을 맡는다. 단계 1은 Claude subagent(subagent-driven)로 구현했다.
  agy의 cwd가 live checkout이므로 agy에게는 `.worktrees/` 아래 worktree에서만 작업하도록 지시한다.
- 단계 1 최종 검토에서 넘긴 항목: panelType 읽기 정규화와 `statusBehavior` IPC 함정은 단계 2 Task 1(`e0b03c25`)에서
  처리했다. 남은 것:
  - Diff 탭의 send-to-agent 대상: 지금은 항상 기본 agent(Codex)다. 탭의 마지막 agent 종류를 정할 출처가 필요하다.
  - 정리: `JSONL_EXTENDED_TAIL_SIZE` 중복(`status/jsonl-check.ts`, `status-manager.ts`), `exitCommand` fallback
    중복(`resolveAgentProviderMeta` helper).
- Smoke script 결함: `smoke-runtime-v2-isolated.mjs`의 `.codexmux/cli-token` 경로(이름 변경 뒤 `.agentmux`), 실패
  시 남는 dev server, `smoke-runtime-v2-phase2-gate.mjs`의 재시작 race(`stop()`이 wrapper 종료만 기다림), 두
  script 모두 `TMUX_TMPDIR`를 격리하지 않는 점.
- Codex `0.167.0` "Hooks need review" 화면: 웹 카드가 이 화면을 읽지 못한다. 설계 2(Codex 보조) 범위에서 고친다.
  - 확인한 사실(2026-11-10, 읽기만 함): Codex는 `~/.codex/config.toml`의 `[hooks.state."<출처>:<이벤트>:<i>:<j>"]` 아래
    `trusted_hash`(hook 정의의 sha256)로 검토 여부를 기억한다. agentmux는 `-c hooks.*` 명령 안에 실행마다 바뀌는 HMAC
    capability(`expiresAt` 포함)를 넣는다(`providers/codex/session-hooks.ts`).
  - 추정: hook 정의 hash가 실행마다 달라져 검토 화면이 매번 뜬다. 검토를 수락하면 사용자 `~/.codex/config.toml`에 기록되므로
    아직 직접 확인하지 않았다. 확인은 임시 `CODEX_HOME`에서 한다.
  - 고칠 방향(안): capability를 hook 명령 인자가 아니라 실행 명령 앞의 환경 변수로 넘기고, bridge가 그 값을 읽게 해 hook
    명령을 모든 탭·실행에서 같게 만든다. 그러면 한 번 검토로 끝나는지 확인한다.
  - Claude Code `2.1.322`는 `--settings`로 붙인 hook에 검토 화면을 띄우지 않았다(단계 2 Task 10 live smoke).
- 이번 격리 실행에서 `--sandbox read-only`인 Codex의 shell 쓰기가 막히지 않았다. Codex 쪽 동작 확인 필요.
- 단계 2 live smoke에서 찾은 결함(위 "격리 Claude Code live smoke") 중 남은 것: 줄바꿈된 선택지 공백 누락, server
  종료 때 timeline worker `EPIPE`, 한 turn의 `turn-end` 2개. 권한 요청 "No" 뒤 `busy`에 남던 결함은 branch 최종 검토
  수정(2026-11-11)에서 고쳤다(중단된 turn은 JSONL interrupt 표시로 `idle`).
- 단계 2 task 검토에서 넘긴 정리 항목은 `docs/FOLLOW-UP.md` "Claude Code provider 단계 2 후속"에 있다. 모바일 360px
  폭 탭 이름은 최종 검토 수정(2026-11-11)에서 고쳤다(440px 미만에서 보기 전환을 메뉴 버튼 하나로 접음). 사용자 결정이
  필요한 것:
  - 전체 suite 부하에서 Codex session test 두 개(`codex-session-detection`, `session-list`)가 가끔 실패하고 단독으로는
    통과한다. 안정화 필요.
  - `tests/unit/lib/layout-store.test.ts`가 실제 data dir 아래 `ws-layout-store-*` directory를 만든다. 이전 실행이 남긴 4개가
    legacy 실제 경로 `~/.codexmux/workspaces`에 있고 live data dir라 지우지 않았다. Test 격리와 정리는 사용자가 정한다.
  - `vitest.config.ts`가 실행마다 `/tmp/agentmux-vitest-tmux-*` directory를 만들고 지우지 않는다(2026-11-11 기준 123개).
    Subagent의 삭제는 auto mode가 막아 Claude가 대신 지우지 않았다. 정리(`rm -rf /tmp/agentmux-vitest-tmux-*`)는 사용자가
    실행하고, 설정이 test 종료 때 지우도록 고친다.
- 다음 Claude live 확인 때 볼 미검증 항목(단계 2 최종 검토): 병렬 tool 호출에서 자동 승인된 tool 결과가 권한 요청 뒤에
  기록될 때 needs-input이 잘못 풀리는지, 웹 trust 카드 경로(xterm buffer → 카드 → stdin)의 browser 확인, 모바일 보기 전환
  메뉴의 browser 확인(440px 미만), AskUserQuestion·plan 승인이 `permission_prompt` 알림을 보내는지.
- Runtime v2 agent 탭 지원(hook 인증, 상태 감시, timeline process 찾기, storage `panel_type`, 화면 캡처·key 입력).
- 설계 2(Codex 보조 + 일반 UI), 설계 3(회신·상호 리뷰, agent split 포함 여부 결정) 순서로 brainstorming.
- npm 첫 배포(보류), `v0.5.0` tag 정책, data 실제 이전은 앞선 인계의 Follow-Up 그대로.
- 단계 3 후속(2026-11-11 live 확인에서):
  - Live `new-tabs` mode에서는 새 plain Terminal 탭이 Runtime v2라 agent 보기 제안이 뜨지 않는다(v1 Terminal 탭만). Runtime v2
    agent 탭 지원과 묶는다.
  - 터미널에서 직접 실행한 Claude는 첫 prompt 전까지 timeline이 "Claude Code 세션 대기 중"이고 web 입력이 "연결 중"이다. 터미널에서 친
    첫 prompt 뒤 timeline이 묶이는지 확인한다.
  - `history-parser`가 fork/resume이 복사한 Claude prompt를 파일마다 세어 약 0.5% 과대 집계(보류).
  - Uptime disk cache는 window가 지나기 전까지 지난 날의 Codex 전용 값을 가진다.
  - Smoke 도구: 격리 `TMUX_TMPDIR`는 짧은 경로여야 하고 setup POST는 `Origin` header가 필요하다. 일일 리포트 fallback은 PATH만으로
    강제할 수 없어(preflight가 알려진 install path에서 Codex를 찾음) 생성기에 test 전용 override를 두면 smoke로 확인할 수 있다.
  - Claude 직접 실행 시 hook 없이 timeline 연결, 일일 리포트의 실제 Claude 생성 전체 경로는 live에서 확인하지 않았다.
