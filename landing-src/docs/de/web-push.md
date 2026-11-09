---
title: 웹 푸시 알림
description: 탭이 닫혀 있어도 needs-input과 작업 완료 상태에 대한 백그라운드 푸시 알림을 받습니다.
eyebrow: 모바일 & 원격
permalink: /de/docs/web-push/index.html
---
{% from "docs/callouts.njk" import callout %}

Web Push는 Codex 세션이 사람을 필요로 하는 순간 — 권한/입력 프롬프트, 작업 완료 — 탭을 닫아둔 상태에서도 알림을 띄워줍니다. 알림을 누르면 해당 세션으로 바로 이동합니다.

## 무엇이 알림을 트리거하나

사이드바의 컬러 배지에서 볼 수 있는 전환과 동일한 시점에 푸시가 발송됩니다.

- **Needs input** — Codex가 권한/입력 프롬프트나 질문 대기
- **작업 완료** — Codex가 한 턴을 마침 (**review** 상태)

idle, busy 전환은 의도적으로 푸시하지 않습니다. 노이즈입니다.

## 활성화

토글 위치는 **설정 → 알림**입니다. 순서:

1. **설정 → 알림**을 열고 **On**으로 토글합니다.
2. 브라우저가 알림 권한을 요청하면 허용합니다.
3. agentmux가 서버의 VAPID 키로 Web Push 구독을 등록합니다.

구독 정보는 `~/.agentmux/push-subscriptions.json`에 저장되며 브라우저/기기 단위로 식별됩니다. 알림을 받을 기기마다 같은 절차를 반복하세요.

{% call callout('warning', 'iOS는 Safari 16.4와 PWA 필수') %}
iPhone, iPad에서는 agentmux를 홈 화면에 추가하고 그 아이콘으로 실행한 상태에서만 Web Push가 동작합니다. 일반 Safari 탭에서 알림 권한을 요청해도 의미가 없습니다. PWA부터 설정하세요: [PWA 설정](/agentmux/de/docs/pwa-setup/).
{% endcall %}

## VAPID 키

agentmux는 첫 실행 시 application-server VAPID 키페어를 생성해 `~/.agentmux/vapid-keys.json`(권한 `0600`)에 저장합니다. 별도 작업이 필요 없습니다 — 구독 시 공개 키가 브라우저에 자동 전달됩니다.

키 회전 등의 이유로 모든 구독을 초기화하고 싶다면 `vapid-keys.json`과 `push-subscriptions.json`을 삭제하고 agentmux를 재시작하세요. 모든 기기는 다시 구독해야 합니다.

## 백그라운드 전송

구독 후에는 OS 푸시 서비스를 통해 알림이 전달됩니다.

- **iOS** — Safari의 Web Push 브리지를 거쳐 APNs로 전달. 최선 노력 방식이며 기기 상태에 따라 묶여서 올 수 있습니다.
- **Android** — Chrome을 통해 FCM. 일반적으로 즉시 도착합니다.

agentmux가 포어그라운드인지와 무관하게 알림이 옵니다. 단, 어느 기기에서든 대시보드가 현재 보이고 있다면 중복 알림을 피하기 위해 푸시 발송을 건너뜁니다.

## 알림 탭 → 세션 이동

알림을 누르면 알림을 발생시킨 세션으로 바로 열립니다. PWA가 이미 실행 중이라면 해당 탭으로 포커스가 이동하고, 아니라면 앱이 실행되며 곧장 이동합니다.

## 문제 해결

- **토글이 비활성** — Service Worker 또는 Notifications API 미지원. **설정 → 브라우저 체크** 또는 [브라우저 지원](/agentmux/de/docs/browser-support/) 확인.
- **권한 거부됨** — 브라우저 설정에서 해당 사이트의 알림 권한을 초기화한 후 agentmux에서 다시 토글합니다.
- **iOS에서 알림이 안 옴** — 홈 화면 아이콘에서 실행 중인지, iOS가 **16.4 이상**인지 확인하세요.
- **자체 서명 인증서** — Web Push 등록 자체가 거부됩니다. Tailscale Serve나 실제 인증서를 가진 리버스 프록시를 사용하세요. [Tailscale 접속](/agentmux/de/docs/tailscale/) 참고.

## 다음으로

- **[PWA 설정](/agentmux/de/docs/pwa-setup/)** — iOS 푸시의 필수 단계
- **[Tailscale 접속](/agentmux/de/docs/tailscale/)** — 외부 전송용 HTTPS 확보
- **[보안과 인증](/agentmux/de/docs/security-auth/)** — `~/.agentmux/` 안의 다른 파일들
