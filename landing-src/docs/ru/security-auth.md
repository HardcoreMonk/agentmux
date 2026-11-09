---
title: 보안과 인증
description: agentmux가 대시보드를 보호하는 방식 — scrypt 해시 비밀번호, 로컬 전용 데이터, 외부 접속 시 HTTPS.
eyebrow: 모바일 & 원격
permalink: /ru/docs/security-auth/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 셀프 호스팅 방식이며 모든 데이터가 사용자의 머신에 머무릅니다. 외부 서버도, 텔레메트리도, 클라우드 계정도 없습니다. 아래는 대시보드를 실제로 지키는 몇 안 되는 장치들입니다.

## 비밀번호 설정

처음 agentmux를 열면 온보딩 화면이 비밀번호를 입력받습니다. 제출 후:

- 비밀번호는 **scrypt**로 해싱됩니다 (랜덤 16바이트 salt, 64바이트 derived key).
- 해시는 `~/.agentmux/config.json`에 `scrypt:{salt}:{hash}` 형태로 저장됩니다 — 평문은 어디에도 저장되지 않습니다.
- 별도의 `authSecret`(랜덤 hex)이 함께 생성되며, 로그인 후 발급되는 세션 쿠키 서명에 사용됩니다.

이후 접속에는 로그인 화면이 나타나고, `crypto.timingSafeEqual`로 저장된 해시와 비교합니다.

{% call callout('note', '비밀번호 길이') %}
최소 길이는 짧게(4자) 잡혀 있어 localhost 전용 환경에서는 부담이 없습니다. 테일넷이든 어디든 외부에 노출한다면 더 강한 비밀번호를 사용하세요. 로그인 실패는 프로세스당 15분에 16회로 rate-limit이 걸려 있습니다.
{% endcall %}

## 비밀번호 재설정

잊어버렸다면 호스트에 셸 접근만 있으면 됩니다.

```bash
rm ~/.agentmux/config.json
```

agentmux를 재시작하면 (`pnpm start`, `npx --yes @hardcoremonk/agentmux@latest` 등 평소 실행 방법) 온보딩 화면이 다시 나타나 새 비밀번호를 설정할 수 있습니다.

이 작업은 같은 파일에 저장된 다른 설정(테마, 언어, 폰트 크기, 알림 토글 등)도 함께 초기화합니다. 워크스페이스와 탭은 `workspaces.json`과 `workspaces/` 디렉토리에 들어 있으니 레이아웃은 영향받지 않습니다.

## 외부 접속에는 HTTPS

기본 바인드는 `localhost`이고 평문 HTTP로 서빙됩니다. 같은 머신에서 쓸 때는 문제가 없지만, 다른 기기에서 접근하는 순간부터는 HTTPS가 기본입니다.

- **Tailscale Serve** 권장 — WireGuard 암호화에 Let's Encrypt 인증서 자동 발급. [Tailscale 접속](/agentmux/ru/docs/tailscale/) 참고.
- **리버스 프록시** (Nginx, Caddy 등)도 가능 — WebSocket의 `Upgrade`, `Connection` 헤더를 반드시 포워딩해야 합니다.

iOS Safari는 PWA 설치와 Web Push 등록에 HTTPS를 추가로 요구합니다. [PWA 설정](/agentmux/ru/docs/pwa-setup/), [웹 푸시](/agentmux/ru/docs/web-push/) 참고.

## `~/.agentmux/`에 있는 것

모두 로컬에 있습니다. 민감 파일의 권한은 `0600`입니다.

| 파일 | 내용 |
|---|---|
| `config.json` | scrypt 비밀번호 해시, 세션 secret, 앱 환경 설정 |
| `workspaces.json` + `workspaces/` | 워크스페이스 목록과 워크스페이스별 pane/탭 레이아웃 |
| `vapid-keys.json` | Web Push VAPID 키페어 (자동 생성) |
| `push-subscriptions.json` | 기기별 푸시 구독 정보 |
| `cli-token` | 훅과 CLI가 로컬 서버와 통신할 때 쓰는 공유 토큰 |
| `cmux.lock` | 단일 인스턴스 락 (`pid`, `port`, `startedAt`) |
| `logs/` | pino-roll 로그 파일 |

전체 목록과 리셋 표는 source-of-truth인 [docs/DATA-DIR.md](https://github.com/HardcoreMonk/agentmux/blob/main/docs/DATA-DIR.md)에 정리되어 있습니다.

## 텔레메트리 없음

agentmux 자체가 외부로 보내는 요청은 없습니다. 발생하는 네트워크 호출은 다음뿐입니다.

- 사용자가 구독한 Web Push 알림 — OS 푸시 서비스로 전달됩니다.
- Codex CLI 자체가 하는 통신 — OpenAI과 사용자 사이의 일이며 agentmux와 무관합니다.

코드와 세션 데이터는 머신을 벗어나지 않습니다.

## 다음으로

- **[Tailscale 접속](/agentmux/ru/docs/tailscale/)** — 외부 HTTPS의 안전한 경로
- **[PWA 설정](/agentmux/ru/docs/pwa-setup/)** — 인증 정리 후 홈 화면에 설치
- **[웹 푸시 알림](/agentmux/ru/docs/web-push/)** — 백그라운드 알림
