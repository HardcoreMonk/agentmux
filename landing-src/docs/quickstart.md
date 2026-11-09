---
title: 빠른 시작
description: Linux 단일 엔진에서 agentmux를 실행하고 최초 설정과 Session Operations를 확인합니다.
eyebrow: 시작하기
permalink: /docs/quickstart/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 여러 Codex workspace, session, tab을 관리하는 Codex 중심 session manager입니다.
현재 active runtime은 Linux 단일 엔진이며 한 host가 Runtime v2 worker, tmux, Codex JSONL,
Session Catalog와 승인 project read를 소유합니다.

{% call callout('note', '현재 배포 기준') %}
Public npm package는 아직 이전 package `codexmux@0.4.23`이며 `@hardcoremonk/agentmux@0.5.0`은 배포 전입니다. Windows Electron package는 별도 배포면의
보존된 release surface이며 Linux engine 설치를 대체하지 않습니다.
{% endcall %}

## 준비

Linux engine에는 다음이 필요합니다.

- **Node.js 20.9 이상** — `node -v`로 확인
- **tmux 3.0 이상** — `tmux -V`로 확인
- **Git** — `git --version`으로 확인
- **Codex CLI** — `codex --version`과 login 상태 확인

## npm package 실행

{% call callout('warning', 'npm 미배포') %}
`@hardcoremonk/agentmux`는 아직 npm에 배포되지 않았습니다. 배포 전까지는 source checkout으로 실행하세요(`git clone https://github.com/HardcoreMonk/agentmux.git`).
{% endcall %}

```bash
npx --yes @hardcoremonk/agentmux@latest
```

기본 port는 `8122`입니다. Fresh setup은 저장된 network 설정보다 먼저 loopback에만
bind하므로 같은 host에서 `http://127.0.0.1:8122`를 엽니다.

## Source 개발 실행

```bash
git clone https://github.com/HardcoreMonk/agentmux.git
cd agentmux
corepack enable
corepack pnpm install
corepack pnpm dev
```

Production build와 장기 실행은 [설치](/agentmux/docs/installation/)의 `systemd --user`
절차를 사용합니다.

## 최초 설정

처음 시작한 process는 `HOST`나 저장된 network setting보다 먼저 `127.0.0.1`에만 bind합니다.

1. `http://127.0.0.1:8122`를 로컬에서 엽니다.
2. 비밀번호, locale, theme, network access를 설정합니다.
3. 외부 access가 필요하면 setup 완료 후 `HOST` 범위를 명시하고 service를 재시작합니다.
4. workspace를 만들고 **Codex** tab을 엽니다.

Codex tab은 Runtime v2 Terminal Worker와 Linux tmux adapter를 사용합니다. 화면의 고정 1차
탐색에서 **Workspace**, **Sessions**, **Governance**를 전환합니다. **Sessions**에서는 과거
session 검색·replay·annotation을, **Governance**에서는 승인한 project의 guidance, knowledge,
lifecycle과 audit read model을 확인할 수 있습니다. Workspace 내부 **Activity**는 Session Catalog와
다른 운영 context입니다.

## 선택 client와 Windows package

Browser가 primary 운영 surface입니다. Electron과 Capacitor Android는 실행 중인 engine에
연결하는 선택 client입니다. 보존된 Windows stable release는 `v0.4.22`이며 unsigned 내부
package/update 증거 범위입니다.

## 다음으로

- **[설치](/agentmux/docs/installation/)** — npm/source와 Linux user service
- **[보안과 인증](/agentmux/docs/security-auth/)** — loopback setup과 restart 규칙
- **[포트 & 환경 변수](/agentmux/docs/ports-env-vars/)** — port, bind와 Runtime 설정
- **[문제 해결](/agentmux/docs/troubleshooting/)** — Linux service와 Runtime v2 진단
