---
title: Project Governance
description: Approved Project Root, Managed Project, Knowledge Index와 안전한 scaffold/adoption 운영.
eyebrow: 운영 가이드
permalink: /ko/docs/project-governance/index.html
---
{% from "docs/callouts.njk" import callout %}

Project Governance는 승인한 Linux filesystem root 아래의 project guidance, knowledge,
lifecycle와 audit를 한 화면에서 읽고 관리합니다. Workspace와 Managed Project는 서로 다른
단위이며 project path는 public catalog 응답에 노출하지 않습니다.

## 준비 상태

고정 1차 탐색에서 **거버넌스**를 선택합니다. Route는 `/governance`입니다. 화면을 운영하기 전에
authenticated runtime health에서 Governance Worker 상태를 확인합니다.

```bash
IFS= read -r agentmux_cli_token < ~/.agentmux/cli-token
curl -fsS -H "x-agentmux-token: $agentmux_cli_token" \
  http://127.0.0.1:8122/api/v2/runtime/health
```

`state=ready`이면 read model을 사용할 수 있습니다. `writeState=disabled`여도 approved root,
project summary, document metadata와 audit read는 유지됩니다.

## Root와 project 등록

1. `/governance`의 **승인된 루트 추가**에서 canonical Linux directory를 preview합니다.
2. 표시된 canonical path와 conflict를 검토하고 확인합니다.
3. 승인 root 아래의 project title/directory를 등록하거나 root 바로 아래 `projects.yaml`을
   preview/import합니다.
4. project를 선택해 guidance, knowledge, lifecycle/check와 audit candidate를 확인합니다.

Root escape, symlink traversal, nested mount와 승인 root 밖 project는 fail closed입니다.
`projects.yaml`은 승인 root 바로 아래 regular file만 읽습니다.

## Write gate

Scaffold create/update/adoption과 rollback은 기본 off입니다. 별도 운영 승인 후 systemd drop-in에
다음을 추가하고 restart합니다.

```ini
[Service]
Environment=AGENTMUX_GOVERNANCE_WRITES=1
```

{% call callout('warning', 'Write gate는 권한 우회가 아닙니다') %}
Gate가 켜져도 preview token, exact project title confirmation, root containment, fingerprint
revalidation, private backup과 project별 writer lock을 모두 통과해야 합니다.
{% endcall %}

## Scaffold와 기존 문서 adoption

- Missing artifact는 versioned full-document template으로 생성합니다.
- Marker-owned artifact는 marker block 안에서만 갱신합니다.
- 기존 unmarked UTF-8 regular file은 첫 preview에서 `관리 등록 가능`으로만 표시됩니다.
- Operator가 artifact를 개별 선택하고 다시 preview해야 append-only adoption이 생성됩니다.
- Adoption은 기존 bytes를 exact prefix로 보존하고 EOF에 compact marker block만 추가합니다.
- NUL, invalid UTF-8 또는 marker-like conflict는 자동 overwrite하지 않습니다.

Preview diff와 semantic warning을 읽은 뒤 exact project title을 입력해 confirm합니다. `adopt all`,
force merge, delete/move/full sync는 제공하지 않습니다.

## Action history와 rollback

각 action은 `~/.agentmux/backups/governance-actions/<project-id>/<action-id>/`에 private journal과
exact preimage를 남깁니다. Directory는 `0700`, manifest/preimage는 `0600`입니다.

- 현재 output fingerprint가 receipt와 다르면 rollback은 `rollback-stale`로 중단됩니다.
- 같은 artifact의 최신 action부터 역순으로 rollback합니다.
- Pending/recovery-required와 rollback 가능한 backup은 자동 prune하지 않습니다.
- Knowledge Index refresh 실패는 이미 commit된 project write를 취소하지 않습니다.

비상 차단은 write drop-in을 제거하고 service를 재시작합니다. Gate off 상태에서도 미완료 action의
startup recovery는 먼저 수행합니다.

## 다음 단계

- [Linux 서비스 운영](/agentmux/ko/docs/linux-service/) — backup, restart와 health
- [데이터 디렉터리](/agentmux/ko/docs/data-directory/) — durable/project backup 경계
- [아키텍처](/agentmux/ko/docs/architecture/) — worker ownership과 API routing
