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

## Current Lifecycle Stage

- Multi-agent 설계 1(Claude Code provider + 공통 agent 기반 + 위임 안내): 설계 승인("후속 작업 승인"),
  grill-me Passed(`docs/superpowers/grill-me/2026-11-10-claude-code-provider.md`), design review Approved
  조건부(`docs/superpowers/reviews/2026-11-10-claude-code-provider-design-review.md`), 단계 1 계획 작성
  (`docs/superpowers/plans/2026-11-10-claude-code-provider-phase1.md`). 계획 검토와 실행 방식 선택 대기.
- Android와 웹 logo: release 서명 설치, live 배포, main merge(PR #45) 완료. operate.
- 이름 변경 프로젝트: operate (npm 배포 보류).

## Next Action

사용자가 단계 1 계획을 검토하고 실행 방식(subagent-driven 또는 native)을 고르면 plan-eng-review를 거쳐
`feat/claude-provider-phase1` branch에서 구현한다. 단계 2~4 계획은 앞 단계가 merge된 뒤 그 interface를 기준으로
쓴다.

## Follow-Up Tasks

- 설계 1 builder check 반영과 사용자 승인, 이어서 grill-me, plan-design-review, `superpowers:writing-plans`.
- 설계 2(Codex 보조 + 일반 UI), 설계 3(회신·상호 리뷰, agent split 포함 여부 결정) 순서로 brainstorming.
- 이번 문서 변경 commit(사용자 요청 시).
- npm 첫 배포(보류), `v0.5.0` tag 정책, data 실제 이전은 앞선 인계의 Follow-Up 그대로.
