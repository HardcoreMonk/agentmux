---
title: 데이터 디렉터리
description: ~/.agentmux/ 아래에 저장되는 파일과 삭제 기준.
eyebrow: 레퍼런스
permalink: /docs/data-directory/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux의 영속 상태는 `~/.agentmux/` 아래에 저장됩니다. `~`는 active Linux service
user의 Node.js `os.homedir()`입니다. Codex CLI의 원본 session JSONL은
`~/.codex/sessions/`에 있으며 agentmux는 읽기 전용으로만 접근합니다.

## 구조

```text
~/.agentmux/
├── config.json
├── workspaces.json
├── workspaces/{wsId}/layout.json
├── workspaces/{wsId}/message-history.json
├── runtime-v2/state.db
├── runtime-v2/state.db-wal
├── runtime-v2/state.db-shm
├── session-catalog/index.db
├── session-catalog/index.db-wal
├── session-catalog/index.db-shm
├── governance/index.db
├── governance/index.db-wal
├── governance/index.db-shm
├── backups/
├── hooks.json
├── status-hook.cjs
├── statusline.sh
├── rate-limits.json
├── session-history.json
├── session-index.json
├── quick-prompts.json
├── sidebar-items.json
├── keybindings.json
├── vapid-keys.json
├── push-subscriptions.json
├── approval-audit.jsonl
├── lifecycle-actions.jsonl
├── cli-token
├── port
├── cmux.lock
├── logs/
├── uploads/{wsId}/{tabId}/{timestamp}-{32-hex}-{name}.{ext}
├── uploads/{wsId}/{tabId}/.{32-hex}.upload.part
└── stats/
```

Codex tab 실행은 native session-layer hook override와 capability를 통해 standalone
`status-hook.cjs` bridge를 호출합니다. User/project/managed/plugin hook discovery는 그대로
유지합니다.

`session-index.json`은 로컬 `~/.codex/sessions`의 session list metadata cache입니다. 삭제해도 다음 refresh에서 다시 생성되며, Codex JSONL 원본을 대체하지 않습니다. 삭제 직후 첫 session list는 현재 snapshot을 먼저 보여주고 refresh 완료 뒤 갱신됩니다.

## 주요 파일

| 파일 | 내용 | 삭제 가능 여부 |
|---|---|---|
| `config.json` | login hash, session secret, theme, Codex option | 가능. onboarding 재실행 |
| `workspaces.json` | workspace 목록과 sidebar 상태 | 가능. 모든 workspace 초기화 |
| `workspaces/{wsId}/layout.json` | pane/tab tree와 tab metadata | 가능. 해당 workspace layout 초기화 |
| `workspaces/{wsId}/message-history.json` | workspace별 web input history | 가능. 해당 workspace 입력 history 초기화 |
| `runtime-v2/state.db` | workspace/layout과 annotation/filter, 승인 root/project durable state | backup 없이 삭제 금지 |
| `session-catalog/index.db` | JSONL metadata/message 검색 projection | quarantine 후 rebuild 가능 |
| `governance/index.db` | Knowledge Index와 lifecycle/check/audit projection | quarantine 후 refresh 가능 |
| `cli-token` | CLI와 hook bridge token | 가능. 재시작 시 재생성 |
| `port` | 현재 server port | 가능. 재시작 시 재생성 |
| `cmux.lock` | 단일 인스턴스 guard | process가 없을 때만 삭제 |
| `session-index.json` | 로컬 Codex session list metadata cache | 가능. 다음 refresh에서 재생성되며 첫 목록은 현재 snapshot일 수 있음 |
| `approval-audit.jsonl` | sanitized approval action/push outcome event | 가능. audit history 삭제 |
| `lifecycle-actions.jsonl` | sanitized lifecycle action event | 가능. lifecycle history 삭제 |
| `uploads/` | committed attachment와 reserved transaction stage | 가능. server를 먼저 종료 |
| `stats/` | usage cache와 daily report. runtime build는 in-flight dedupe 적용 | 가능. 다음 요청에서 재계산 |

## Upload artifact

External upload ingress는 `uploads/<workspace-id>/<tab-id>/` 아래에만 씁니다. Workspace/tab id와 원본 이름은 안전 문자와 길이 제한으로 정규화하고 final filename에는 128-bit random token을 넣습니다.

- image/file 최대 크기: 10MiB/50MiB
- stage: `.<32 lowercase hex>.upload.part`, exclusive create
- final: server-generated timestamp/random/basename/extension
- commit: writer close 후 same-directory hard link로 no-replace publish
- transaction failure: stage unlink를 시도하고, 남은 reserved stage는 최소 30분 후 cleanup
- committed artifact: 기본 24시간 TTL cleanup 대상

`AGENTMUX_UPLOADS_DISABLED=1`은 새 upload만 `503`으로 막고 기존 tree는 삭제하지 않습니다.

## 백업

```bash
tar czf agentmux-backup.tgz -C $HOME .agentmux
```

복원 전에는 agentmux를 종료하고 같은 위치에 풀어 넣습니다.

## reset 기준

- 비밀번호만 초기화: server를 멈춘 뒤 `config.json`에서 `authPassword`, `authSecret`을 함께 삭제하고 restart.
- 온보딩과 앱 설정 초기화: `config.json` 삭제.
- 모든 workspace 초기화: `workspaces.json`과 `workspaces/` 삭제.
- runtime durable state 복구: server를 멈추고 DB/WAL/SHM을 같은 backup 세트로 복원.
- Session Catalog 복구: `session-catalog/index.db*`를 quarantine하고 시작한 뒤 authenticated rebuild.
- Knowledge Index 복구: `governance/index.db*`를 quarantine하고 시작해 project refresh.
- 통계 재계산: `stats/` 삭제.
- session list index 재생성: `session-index.json` 삭제.
- 첨부 삭제: server를 멈춘 뒤 `uploads/` 삭제.
- 전체 초기화: `~/.agentmux/` 삭제.

비밀번호는 평문이 아니라 scrypt 해시로 저장되므로 잊어버렸다면 복구가 아니라 재설정해야 합니다. `config.json` 전체를 삭제하면 네트워크 접근, 테마, Codex 옵션도 초기화되므로 필요한 경우 먼저 백업하세요.

`~/.codex/`는 Codex CLI의 auth와 session history를 포함하므로 일반적인 agentmux reset에서는 삭제하지 않습니다. 이전 빌드에서 남은 원격 복사본 디렉터리는 현재 앱에서 읽지 않으며 필요하면 수동으로 삭제합니다.
