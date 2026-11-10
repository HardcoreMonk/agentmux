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
| 2 | Claude Code provider → multi-agent(Claude Code + Codex 동시 실행, 일 나누기, 상호 리뷰) | brainstorming 중. 설계 문서 미작성 |
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

## Current Lifecycle Stage

- Multi-agent 설계 1(Claude Code provider + 공통 agent 기반 + 위임 안내): 설계 승인("후속 작업 승인"),
  grill-me Passed(`docs/superpowers/grill-me/2026-11-10-claude-code-provider.md`), design review Approved
  조건부(`docs/superpowers/reviews/2026-11-10-claude-code-provider-design-review.md`), 단계 1 plan-eng-review 반영,
  단계 1 implement 완료(branch `feat/claude-provider-phase1`). 전체 gate와 격리 Codex 회귀 확인을 마쳤다. 최종
  code-review는 "수정 후 merge"였고, 수정(`de0087ee`: 기존 Runtime v2 terminal 탭의 agent 보기 전환 차단, 새 agent
  탭 cwd 기본값 복구, hook capability 고정 값 test, 등록되지 않은 종류의 resume 400)과 범위 재검토를 마쳤다. 최종
  확인: test 1819 통과(3 skip), tsc, lint error 0, 문서 gate 통과. Push·PR·main merge와 live 배포 전.
- Android와 웹 logo: release 서명 설치, live 배포, main merge(PR #45) 완료. operate.
- 이름 변경 프로젝트: operate (npm 배포 보류).

## Next Action

사용자 요청 시 단계 1 branch를 push하고 PR을 만들어 main CI 통과 뒤 merge한다. Live 배포는 사용자 확인 뒤에
한다. 이어서 단계 2(Claude provider core) 계획을 단계 1 interface 기준으로 쓴다. 단계 3~4 계획도 앞 단계가 merge된
뒤 쓴다.

## Follow-Up Tasks

- 설계 1 단계 1: push, PR, main merge, 사용자 확인 뒤 live 배포.
- 작업 체계(사용자: "단계 2부터 이전처럼 \"agy 구현, Claude 감시·검증\" 체계"): 단계 2부터 구현은 Herdr pane의
  agy(`builder`)가 맡고 Claude는 계획, 감시, 검증을 맡는다. 단계 1은 Claude subagent(subagent-driven)로 구현했다.
  agy의 cwd가 live checkout이므로 agy에게는 `.worktrees/` 아래 worktree에서만 작업하도록 지시한다.
- 단계 2 계획에 넣을 것(단계 1 최종 검토에서 넘김):
  - `'claude'`를 더하기 전, storage v2 layout 읽기 경로와 IPC reply 검증(`z.enum(PANEL_TYPES)`)이 모르는 panelType
    때문에 layout 전체를 거절하지 않도록 읽는 쪽 정규화 또는 rollback 절차.
  - Status side-effect IPC로 보내는 지점에 2-key `statusBehavior`만 고르는 helper(4-key 객체가 strict schema에서
    runtime 실패하는 함정 방지).
  - Diff 탭의 send-to-agent 대상: 지금은 항상 기본 agent(Codex)다. 탭의 마지막 agent 종류를 정할 출처가 필요하다.
  - 정리: `JSONL_EXTENDED_TAIL_SIZE` 중복(`status/jsonl-check.ts`, `status-manager.ts`), `exitCommand` fallback
    중복(`resolveAgentProviderMeta` helper).
- Smoke script 결함: `smoke-runtime-v2-isolated.mjs`의 `.codexmux/cli-token` 경로(이름 변경 뒤 `.agentmux`), 실패
  시 남는 dev server, `smoke-runtime-v2-phase2-gate.mjs`의 재시작 race(`stop()`이 wrapper 종료만 기다림), 두
  script 모두 `TMUX_TMPDIR`를 격리하지 않는 점.
- Codex `0.167.0` "Hooks need review" 화면: agentmux session hook이 실행마다 바뀌어 sandbox 모드에서 매번 뜰 수 있고
  웹 카드가 이 화면을 읽지 못한다. 설계 2(Codex 보조) 범위에서 확인.
- 이번 격리 실행에서 `--sandbox read-only`인 Codex의 shell 쓰기가 막히지 않았다. Codex 쪽 동작 확인 필요.
- Runtime v2 agent 탭 지원(hook 인증, 상태 감시, timeline process 찾기, storage `panel_type`, 화면 캡처·key 입력).
- 설계 2(Codex 보조 + 일반 UI), 설계 3(회신·상호 리뷰, agent split 포함 여부 결정) 순서로 brainstorming.
- npm 첫 배포(보류), `v0.5.0` tag 정책, data 실제 이전은 앞선 인계의 Follow-Up 그대로.
