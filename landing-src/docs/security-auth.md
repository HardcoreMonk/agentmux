---
title: 보안과 인증
description: loopback 최초 설정, scrypt 비밀번호, session/CLI 인증, 외부 접속 시 HTTPS 정책.
eyebrow: 모바일 & 원격
permalink: /docs/security-auth/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 셀프 호스팅 방식이며 앱 상태와 업로드 파일을 사용자의 머신에 저장합니다. 대시보드는 비밀번호 session과 CLI token으로 보호하고, 최초 설정은 로컬 브라우저에서만 완료할 수 있습니다.

## 최초 설정 보호

설정이 끝나지 않은 상태로 시작한 process는 저장된 network access나 `HOST`보다 먼저 `127.0.0.1`에만 bind합니다. 원격 onboarding은 지원하지 않습니다.

- `/api/auth/setup` POST는 loopback Host와 같은 authority의 Origin을 요구합니다.
- request body는 `application/json`이어야 합니다.
- malformed JSON, 읽기 오류, 잘못된 scrypt hash, hash만 있고 secret이 없는 `config.json`은 setup으로 낮추지 않고 fail closed합니다.
- setup에서 선택한 network access와 `HOST`의 외부 bind는 setup 완료 직후가 아니라 **server restart 후** 적용됩니다.

## 비밀번호 설정

처음 agentmux를 열면 온보딩 화면이 비밀번호를 입력받습니다. 제출 후:

- 비밀번호는 **scrypt**로 해싱됩니다 (랜덤 16바이트 salt, 64바이트 derived key).
- 해시는 `~/.agentmux/config.json`에 `scrypt:{salt}:{hash}` 형태로 저장됩니다 — 평문은 어디에도 저장되지 않습니다.
- 별도의 `authSecret`(랜덤 hex)이 함께 생성되며, 로그인 후 발급되는 세션 쿠키 서명에 사용됩니다.
- Browser session cookie 이름은 `agentmux-session-token` (legacy `codexmux-session-token` 호환)입니다. 같은 hostname의 다른 port에서 Purplemux를 실행해도 generic `session-token`을 덮어쓰지 않습니다.

이후 접속에는 로그인 화면이 나타나고, `crypto.timingSafeEqual`로 저장된 해시와 비교합니다.

{% call callout('note', '비밀번호 길이') %}
최소 길이는 짧게(4자) 잡혀 있어 localhost 전용 환경에서는 부담이 없습니다. 테일넷이든 어디든 외부에 노출한다면 더 강한 비밀번호를 사용하세요. 로그인 실패는 프로세스당 15분에 16회로 rate-limit이 걸려 있습니다.
{% endcall %}

## Purplemux와 동시 실행

Browser cookie는 port가 아니라 hostname과 path를 기준으로 전송됩니다. agentmux는 자기
namespace만 생성·검증·삭제하며 Purplemux가 사용할 수 있는 legacy `session-token`은 건드리지
않습니다. 이 변경이 포함된 build로 처음 업데이트하면 agentmux에 한 번 다시 로그인하세요.
Purplemux가 계속 로그인 화면이나 `401`을 보이면 Purplemux에도 한 번 로그인해 legacy cookie를
복구합니다. 비밀번호, `authSecret`, workspace와 terminal/runtime session을 초기화할 필요는 없습니다.

## 비밀번호 재설정

잊어버렸다면 server가 완전히 종료됐는지 확인하고 config를 먼저 백업한 뒤
`authPassword`와 `authSecret`을 함께 제거합니다. `config.json` 전체 삭제는 locale, theme,
network, Codex option까지 초기화하므로 기본 reset 절차가 아닙니다.

```powershell
$configPath = Join-Path $HOME ".codexmux\config.json"
Copy-Item $configPath "$configPath.bak"
node -e 'const fs=require("fs"),os=require("os"),path=require("path");const p=path.join(os.homedir(),".agentmux","config.json");const c=JSON.parse(fs.readFileSync(p,"utf8"));delete c.authPassword;delete c.authSecret;fs.writeFileSync(p,JSON.stringify(c,null,2)+"\n")'
```

agentmux를 재시작하면 onboarding 화면에서 새 비밀번호를 설정할 수 있습니다. 실행 중
field를 지워도 현재 process의 setup claim은 다시 열리지 않습니다.

`config.json`이 손상됐다면 자동 overwrite를 기대하지 말고 process를 멈춘 뒤 원본을 백업하고 JSON/auth field를 복구하세요.

## 외부 접속에는 HTTPS

fresh setup은 `localhost`의 평문 HTTP로 완료할 수 있습니다. 다른 기기에서 접근하려면 먼저 로컬에서 setup을 마치고 server를 재시작한 뒤 HTTPS endpoint를 사용하세요.

- **Tailscale Serve** 권장 — WireGuard 암호화에 Let's Encrypt 인증서 자동 발급. [Tailscale 접속](/agentmux/docs/tailscale/) 참고.
- **리버스 프록시** (Nginx, Caddy 등)도 가능 — WebSocket의 `Upgrade`, `Connection` 헤더를 반드시 포워딩해야 합니다.

iOS Safari는 PWA 설치와 Web Push 등록에 HTTPS를 추가로 요구합니다. [PWA 설정](/agentmux/docs/pwa-setup/), [웹 푸시](/agentmux/docs/web-push/) 참고.

## `~/.agentmux/`에 있는 것

모두 로컬에 있습니다. POSIX filesystem에서는 secret과 upload stage를 `0600`으로 만들고, Windows에서는 user profile ACL 경계에 의존합니다.

| 파일 | 내용 |
|---|---|
| `config.json` | scrypt 비밀번호 해시, 세션 secret, 앱 환경 설정 |
| `workspaces.json` + `workspaces/` | 워크스페이스 목록과 워크스페이스별 pane/탭 레이아웃 |
| `vapid-keys.json` | Web Push VAPID 키페어 (자동 생성) |
| `push-subscriptions.json` | 기기별 푸시 구독 정보 |
| `cli-token` | 훅과 CLI가 로컬 서버와 통신할 때 쓰는 공유 토큰 |
| `cmux.lock` | 단일 인스턴스 락 (`pid`, `port`, `startedAt`) |
| `runtime-v2/state.db` | workspace/layout/tab/message-history projection |
| `uploads/<workspace>/<tab>/` | 인증된 첨부 upload의 committed artifact와 transaction stage |
| `logs/` | pino-roll 로그 파일 |

전체 목록과 리셋 표는 source-of-truth인 [docs/DATA-DIR.md](https://github.com/HardcoreMonk/agentmux/blob/main/docs/DATA-DIR.md)에 정리되어 있습니다.

## 외부 네트워크 요청

사용 행동 telemetry나 cloud account는 없습니다. 다만 기능상 다음 network request가 발생할 수 있습니다.

- 사용자가 구독한 Web Push 알림 — OS 푸시 서비스로 전달됩니다.
- CLI update notifier와 Electron updater — package/release metadata를 확인합니다.
- Codex CLI 자체가 하는 통신 — OpenAI과 사용자 사이의 일이며 agentmux와 무관합니다.

agentmux가 관리하는 workspace, terminal, Codex JSONL 원본과 upload artifact를 자체 cloud storage로 전송하지 않습니다.

## 다음으로

- **[Tailscale 접속](/agentmux/docs/tailscale/)** — 외부 HTTPS의 안전한 경로
- **[PWA 설정](/agentmux/docs/pwa-setup/)** — 인증 정리 후 홈 화면에 설치
- **[웹 푸시 알림](/agentmux/docs/web-push/)** — 백그라운드 알림
