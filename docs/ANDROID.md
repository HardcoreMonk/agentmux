# Android 참고 문서

Android 앱은 실행 중인 Linux agentmux engine에 연결하는 Capacitor 기반 WebView
shell입니다. Android는 session/runtime authority가 아닌 선택 mobile client이므로 Linux
engine gate를 Android smoke로 대체하지 않습니다.

## 명령

```bash
corepack pnpm android:sync
corepack pnpm android:open
corepack pnpm android:run
corepack pnpm android:build
corepack pnpm android:build:debug
corepack pnpm android:install
corepack pnpm android:keystore
corepack pnpm android:build:release
corepack pnpm android:bundle:release
```

Android smoke:

```bash
corepack pnpm smoke:android:release-aab
corepack pnpm smoke:android:install
corepack pnpm smoke:android:foreground
corepack pnpm smoke:android:recovery
corepack pnpm smoke:android:runtime-v2
corepack pnpm smoke:android:timeline-foreground
```

## 버전 관리

Android 앱 버전은 root `package.json` semver를 기준으로 합니다.

| Source | Android |
| --- | --- |
| `package.json` `version` | `versionName` |
| `major * 10000 + minor * 100 + patch` | `versionCode` |

예: `0.4.2`는 `versionName=0.4.2`, `versionCode=402`입니다. 끝의 `.0`은 떼므로 `0.5.0`은
`versionName=0.5`, `versionCode=500`입니다.

현재 앱 ID는 `com.hardcoremonk.codexmux`입니다. 이름 변경 때 기존 설치본을 지우지 않고 업데이트할 수
있도록 유지했습니다. 표시 이름(`appName`, `app_name`)만 `agentmux`입니다.

2026-11-10에 JDK 21(`JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`), SDK platform 36, Gradle
wrapper 8.14.3으로 `android:build:debug`와 `android:test:unit` 통과를 확인했습니다.

## 구조

| 경로 | 역할 |
| --- | --- |
| `capacitor.config.ts` | app id, WebView navigation, cookie 설정 |
| `android-web/index.html` | 서버 URL 저장, 자동 재접속, 앱 정보/재시작 launcher |
| `android/` | Capacitor Android native project |
| `android/app/src/main/AndroidManifest.xml` | Android 권한과 cleartext 개발 설정 |
| `CodexmuxAppInfo.java` | 앱 버전/기기 정보와 앱 재시작 bridge (legacy 클래스 이름 유지) |
| `CodexmuxWebViewClient.java` | 원격 서버 로딩 실패 시 launcher 복귀 (legacy 클래스 이름 유지) |

## 모바일 UX 기준

- 한국어 우선 font stack과 safe area를 사용합니다.
- URL/path 영역은 줄바꿈 예외를 둡니다.
- 런처와 버튼은 active/focus-visible 상태를 제공합니다.
- Terminal input과 reconnect flow 안정성을 시각 개선보다 우선합니다.
- `Ctrl+D`는 Codex CLI/shell 제어 입력으로 전달합니다.

## 연결 흐름

1. 저장된 서버 URL이 있으면 자동 재접속합니다.
2. 저장된 URL이 없으면 기본 서버 URL을 저장합니다.
3. 이동 전 `/api/health`를 확인합니다.
4. HTTPS/Tailscale Serve 주소를 우선 사용합니다.
5. timeout, network, HTTP, SSL 실패는 launcher로 복귀해 재시도 또는 서버 변경을 제공합니다.
6. 앱 정보 화면에서 Android 앱 버전, package, device, Android version, 서버 version을 확인할 수 있습니다.

## 포그라운드 재연결

Android WebView가 background에 들어가면 WebSocket 객체가 `OPEN`으로 남아도 실제 TCP 연결은 끊길 수 있습니다. 앱은 foreground 복귀 시 workspace/layout을 다시 동기화하고 terminal/status/timeline/sync WebSocket을 필요하면 강제로 새로 엽니다.

Native shell은 `pause`/`resume` event와 legacy 호환 `codexmux:native-app-state` event를 전달합니다. 원격 페이지에 Capacitor bridge가 없어도 최소 fallback을 설치해 lifecycle event 예외를 막습니다.

## 런타임 v2 smoke

Android runtime v2 smoke는 temp runtime v2 서버를 Tailscale IP로 노출하고 WebView에서 `/api/v2/terminal` attach와 foreground reconnect marker output을 확인합니다.

```bash
corepack pnpm smoke:runtime-v2:phase2
corepack pnpm smoke:runtime-v2
corepack pnpm smoke:android:runtime-v2
```

Android device smoke는 단독 실행을 기준으로 합니다.

## 빌드 산출물

Debug APK:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Signed release APK:

```text
android/app/build/outputs/apk/release/app-release.apk
```

Signed release AAB:

```text
android/app/build/outputs/bundle/release/app-release.aab
```

Release AAB 검증:

```bash
corepack pnpm android:keystore
corepack pnpm android:bundle:release
corepack pnpm smoke:android:release-aab
```

`android/release.keystore`와 `android/keystore.properties`는 로컬 비밀 파일이며 git에 커밋하지 않습니다.
