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

## 설계에서 정할 것 (미결)

1. 사람이 어느 시점에 개입하는가: 위임마다 승인, 최종 리뷰 결과만 확인, 또는 그 중간. 마지막으로
   사용자에게 던진 질문이며 답을 기다리는 중이다.
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
  product name gate가 잡지 못했다. 고치면 live 서버 재배포가 필요하다.
- 이 변경은 아직 commit하지 않았다.

## Current Lifecycle Stage

- Multi-agent: `superpowers:brainstorming` (설계 문서 전).
- Android: 기기 설치와 foreground smoke 완료, commit 전 (rename 설계의 "보이는 모든 surface" 범위에서 빠진 부분 보완).
- 이름 변경 프로젝트: operate (npm 배포 보류).

## Next Action

사용자에게 사람의 개입 시점을 묻는 질문의 답을 받고 brainstorming을 이어 간다. 설계가 모이면
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`를 쓰고 독립 builder check를 거쳐 사용자 승인을
받는다. 승인 전에는 구현하지 않는다.

## Follow-Up Tasks

- Multi-agent 설계 문서 작성과 승인, 이어서 `superpowers:writing-plans`.
- 3번 프로젝트(위임 자동화와 agent split)를 2번에 합칠지 결정.
- 웹 UI logo(`app-logo.tsx`)의 옛 이름 수정과 live 재배포.
- npm 첫 배포(보류), `v0.5.0` tag 정책, data 실제 이전은 앞선 인계의 Follow-Up 그대로.
