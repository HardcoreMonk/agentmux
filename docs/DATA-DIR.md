# `~/.agentmux/` (legacy 실제 경로 `~/.codexmux/`) 데이터 디렉터리

agentmux의 앱 상태는 기본 별칭 경로 `~/.agentmux/`(기존 설치의 legacy 실제 경로 `~/.codexmux/`)에 저장합니다. Codex CLI 원본 세션은 `~/.codex/sessions/`에서 읽기 전용으로 참조합니다.

## 경로 해석과 호환 별칭 규칙

이름 변경 전환기 동안 기존 SQLite WAL/SHM과 실행 중인 Codex hook bridge 경로(`~/.codexmux/status-hook.cjs`)를 안전하게 보존하기 위해 1단계에서는 실제 디렉터리를 강제 이동하지 않고 symlink 별칭과 fail-closed 검증을 사용합니다.

### 환경 변수 및 기본 경로 해석 순서

1. `AGENTMUX_DATA_DIR`이 설정되어 있으면 해당 경로를 사용합니다.
2. `AGENTMUX_DATA_DIR`이 없고 legacy `CODEXMUX_DATA_DIR`이 설정되어 있으면 해당 경로를 사용합니다.
3. 두 환경 변수가 모두 없으면 홈 디렉터리(`~/.agentmux` 별칭과 legacy `~/.codexmux`) 배치를 `lstat`/`readlink`로만 검사합니다(조회 함수는 디렉터리나 symlink를 생성하지 않고 매 호출 재평가합니다).

### 홈 디렉터리 배치별 판정 및 `prepareDataDir()` 동작

서버 시작 진입점(`server.ts`)에서만 `prepareDataDir()`를 호출하여 디렉터리 또는 호환 symlink를 준비합니다.

| `~/.agentmux` 상태 | legacy `~/.codexmux` 상태 | 판정 (`inspectDataDirLayout`) | `resolveDataDirPath` 반환값 | `prepareDataDir` 동작 |
| --- | --- | --- | --- | --- |
| 없음 | 실제 디렉터리 | `legacy-only` | `~/.codexmux` | `~/.agentmux -> .codexmux` 상대 symlink 생성 후 `~/.codexmux` 반환 |
| legacy `.codexmux`를 가리키는 유효 symlink | 실제 디렉터리 | `aliased` | `~/.codexmux` | 변경 없이 `~/.codexmux` 반환 |
| 실제 디렉터리 | 없음 | `agentmux-only` | `~/.agentmux` | 변경 없이 `~/.agentmux` 반환 |
| 실제 디렉터리 | `.agentmux`를 가리키는 유효 symlink | `agentmux-only` (후속 이전 완료 상태) | `~/.agentmux` | 변경 없이 `~/.agentmux` 반환 |
| 없음 | 없음 | `fresh` | `~/.agentmux` | `~/.agentmux`(`0700`) 생성 후 반환 |
| 실제 디렉터리 | 실제 디렉터리 | `conflict` (`both-real`) | 예외 발생 (fail closed) | 시작 중단 및 진단 메시지 출력 |
| 그 외 symlink(외부 대상, 깨진 링크) 또는 일반 파일 | 그 외 symlink 또는 일반 파일 | `conflict` (`unexpected-symlink` / `dangling-symlink` / `not-directory`) | 예외 발생 (fail closed) | 시작 중단 및 진단 메시지 출력 |

Windows(`win32`)는 이번 release에서 legacy `~\.codexmux`를 그대로 사용합니다. 별칭·`~\.agentmux`·conflict 판정을 하지 않으며 `host-paths.ts`와 Electron config 규칙과 같습니다.

`~/.codexmux` 자체를 다른 디스크로 옮겨 symlink로 연결해 둔 구성은 `unexpected-symlink`로 시작이 중단됩니다. 이 경우 service 환경에 `AGENTMUX_DATA_DIR=<실제 directory 경로>`를 지정하면 홈 배치 검사 없이 그 경로를 사용합니다. CLI도 `AGENTMUX_DATA_DIR`(legacy `CODEXMUX_DATA_DIR`)의 `port`·`cli-token`을 먼저 읽습니다.

Rollout 안정화 및 이전 버전 rollback 가능성이 해소된 후속 단계에서 실제 데이터 디렉터리를 `~/.agentmux`로 이전하고 `~/.codexmux -> .agentmux` 역방향 호환 링크로 전환할 예정입니다.

## 구조

```text
~/.agentmux/ (기존 호스트에서는 ~/.codexmux/를 가리키는 호환 별칭)
  config.json
  workspaces.json
  workspaces/
    <workspace-id>/
      layout.json
  runtime-v2/
    state.db
    state.db-wal
    state.db-shm
  session-catalog/
    index.db
    index.db-wal
    index.db-shm
  governance/
    index.db
    index.db-wal
    index.db-shm
  backups/
    governance-actions/
      <project-id>/
        <action-id>/
          action.json
          preimage/
  bin/
    agentmux
  delegation/
    claude.md
  hooks.json
  status-hook.cjs
  statusline.cjs
  rate-limits.json
  claude-tabs/
    <tab-id>.json
  session-index.json
  quick-prompts.json
  keybindings.json
  vapid-keys.json
  push-subscriptions.json
  approval-audit.jsonl
  lifecycle-actions.jsonl
  cli-token
  port
  stats/
  logs/
  uploads/
    <workspace-id>/
      <tab-id>/
        <timestamp>-<32-hex>-<name>.<ext>
        .<32-hex>.upload.part
```

## 주요 파일

| 경로 | 내용 |
| --- | --- |
| `config.json` | 인증 hash, session secret, locale, theme, network, Codex 설정 |
| `workspaces.json` | legacy workspace 목록, active workspace, sidebar 상태 |
| `workspaces/{wsId}/layout.json` | legacy pane/tab tree와 tab metadata |
| `runtime-v2/state.db` | runtime v2 workspace/layout/tab/message-history와 session annotation/filter, Approved Project Root/Managed Project/audit durable state |
| `session-catalog/index.db` | Codex JSONL metadata, bounded searchable message, FTS, file cursor와 health projection |
| `governance/index.db` | Managed Project 문서 metadata, heading, fingerprint, lint와 link projection. 본문 미저장 |
| `backups/` | runtime v2 backup과 governance action의 private journal/preimage. projection DB backup 용도가 아님 |
| `hooks.json` | 빈 `hooks`와 statusline 호환 설정을 담는 생성 파일. Codex tab 실행 config source는 아님 |
| `status-hook.cjs` | session-scoped Codex hook override가 호출하는 standalone Node bridge |
| `status-hook.sh` | 이전 설치에 남을 수 있는 legacy bridge. 현재 생성하거나 호출하지 않음 |
| `statusline.cjs` | Claude Code statusLine bridge(Node script). 탭 설정 파일의 statusLine이 호출하며 stdin을 server로 보내고 사용자 원래 statusLine 명령을 대신 실행 |
| `statusline.sh` | 이전 shell statusline bridge. 현재 생성하거나 호출하지 않지만 기존 설치에는 남을 수 있음 |
| `rate-limits.json` | Claude Code statusLine이 보낸 최신 5시간/7일 rate limit. `claude` provider rate limit의 source |
| `claude-tabs/<tab-id>.json` | Claude Code 탭별 `--settings` 파일(hook 7개와 statusLine). 파일 `0600`, directory `0700`. 위임 안내가 켜져 있으면 `permissions.allow`에 `Bash(agentmux tab list:*)`, `create`, `send`, `status`, `result`, `close` 6개만 포함(`tab browser`와 bare `agentmux`는 제외). 실행·재개마다 새 capability로 다시 쓰고 탭을 닫으면 삭제 |
| `bin/agentmux` | agent 탭 `PATH`에 들어가는 CLI shim(`0700`). `AGENTMUX_DATA_DIR`과 `ELECTRON_RUN_AS_NODE=1`을 설정해 `<appDir>/bin/agentmux.js`를 실행. Server 시작 때(auto-resume 전)와 agent를 띄울 때 내용이 바뀐 경우에만 씀. 위임 안내가 꺼져 있어도 지우지 않음 |
| `delegation/claude.md` | Claude Code 위임 안내(`--append-system-prompt-file`). 파일 `0600`. 쓰는 시점은 shim과 같고, 없으면 flag를 빼고 warning |
| `session-index.json` | Codex JSONL session list metadata cache. Cold refresh 중에도 UI는 현재 snapshot을 먼저 표시 |
| `quick-prompts.json` | 사용자 quick prompt와 내장 prompt 표시 상태 |
| `keybindings.json` | 앱 단축키 override |
| `vapid-keys.json` | Web Push VAPID key |
| `push-subscriptions.json` | Web Push 구독 정보 |
| `approval-audit.jsonl` | sanitized approval action/push outcome event |
| `lifecycle-actions.jsonl` | sanitized lifecycle action event |
| `cli-token` | CLI와 hook bridge용 `x-agentmux-token` (legacy `x-cmux-token` 호환) |
| `port` | 현재 실행 중인 server port |
| `stats/` | usage cache와 daily report |
| `logs/` | 서버 로그 |
| `uploads/` | upload artifact와 transaction 중 reserved staged file |

Workspace sidebar의 `workspace|activity` 선택은 이 directory가 아니라 browser `localStorage`의
`sidebar-tab`에 저장합니다. 이전 값 `sessions`는 load 시 `activity`로 normalize하며 Session
Catalog의 `/sessions` route 선택과는 별도 상태입니다.

## Upload artifact

External upload ingress는 `uploads/<workspace-id>/<tab-id>/`에만 씁니다. Workspace/tab id와
원본 basename/extension은 제한된 안전 문자로 정규화하고 final filename에는 128-bit random
token을 넣습니다.

- staged: `.<32 lowercase hex>.upload.part`, exclusive `wx`, POSIX `0o600`
- final: server-generated timestamp/random/basename/extension
- commit: writer close 뒤 same-directory `fs.link(stage, final)` no-replace publish
- transaction failure: final을 만들지 않고 staged file unlink를 bounded retry
- commit 뒤 response failure: final을 보존하고 정상 TTL cleanup에 위임
- stale stage: 30분보다 오래된 reserved pattern만 startup, maintenance, manual cleanup 대상
- committed `.part`: reserved dot-prefix pattern과 다르므로 정상 final artifact로 취급

Reserved stage namespace는 committed cleanup과 분리되고 30분 age floor가 진행 중인
transaction을 보호합니다. 강제 process kill로 남은 recent stage는 age floor가 지난 다음
정리합니다. `AGENTMUX_UPLOADS_DISABLED=1`(legacy `CODEXMUX_UPLOADS_DISABLED=1` 호환)은 새 upload만 차단하며 기존 tree를 삭제하지
않습니다.

## 런타임 v2 SQLite

Runtime v2는 `runtime-v2/state.db`를 사용합니다.

- SQLite schema는 migration으로 관리합니다. 현재 schema는 v6이며 v6은 `tabs.created_by_tab_id`(agent가 만든 탭을 만든 호출 탭 id)를 더합니다. v5→v6 migration backup은 `backups/runtime-v2-migration-v5-v6-<timestamp>/`입니다.
- 이전 build는 v6 DB를 열지 못합니다(새 schema version 거부). Rollback은 service를 멈추고 `runtime-v2/state.db*`를 별도 directory에 복사한 뒤 better-sqlite3로 `src/lib/runtime/storage/schema.ts`의 `RUNTIME_SCHEMA_V6_DOWNGRADE_SQL`을 DB 안에서 실행하고 이전 build를 시작하는 순서입니다. 문장은 다음과 같습니다.

  ```sql
  alter table tabs drop column created_by_tab_id; delete from schema_migrations where version = 6;
  ```

  Migration 전 backup을 되돌리는 방법은 비상용입니다. 배포 뒤 SQLite에 쓴 자료를 잃고, 이후 첫 layout 쓰기가 현재 `layout.json`을 오래된 layout으로 덮습니다.
- `AGENTMUX_RUNTIME_V2_RESET=1`(legacy `CODEXMUX_RUNTIME_V2_RESET=1` 호환)은 `state.db`, `state.db-wal`, `state.db-shm`을 timestamp `.bak` 파일로 이동한 뒤 새 DB를 만듭니다.
- Windows에서는 열린 SQLite handle 때문에 temp directory 삭제가 실패할 수 있으므로 test/smoke는 service와 DB handle을 닫은 뒤 cleanup합니다.
- Runtime v2가 꺼진 install/build는 `better-sqlite3` native binding load에 의존하지 않습니다.
- `runtime-v2/`는 `0700`, DB/WAL/SHM은 `0600`입니다. 복원 파일도 같은 권한을 적용한 뒤 service를 시작합니다.

### backup과 restore

`runtime-v2/state.db`에는 재생성할 수 없는 사용자 승인 root, Managed Project catalog, session annotation/filter가 포함되므로 projection DB처럼 삭제하지 않습니다.

```bash
corepack pnpm smoke:runtime-v2:storage-backup
```

운영 backup은 service를 멈추거나 SQLite-consistent backup 경로를 사용해 `state.db`, `state.db-wal`, `state.db-shm`을 한 세트로 보존합니다. `backups/`와 timestamp backup 내부 directory는 `0700`, 복사된 file은 `0600`을 강제합니다. Migration은 schema write 전에 `backups/runtime-v2-migration-v<from>-v<to>-<timestamp>/`를 만듭니다. 복구할 때는 service를 중지하고 현재 세 파일을 별도 quarantine한 뒤 검증된 backup 세트를 원래 위치에 복원하고 권한을 확인합니다. 부분 파일만 섞지 않습니다.

### 재생성 가능한 index

Session Catalog와 Knowledge Index는 source of truth가 아닙니다.

- Session Catalog 장애: service/Timeline Worker를 멈추고 `session-catalog/index.db*`를 quarantine한 뒤 시작하고 `/api/sessions/rebuild`를 호출합니다. 원본 `~/.codex/sessions/`는 변경하지 않습니다.
- Knowledge Index 장애: service/Governance Worker를 멈추고 `governance/index.db*`를 quarantine한 뒤 시작합니다. Managed Project snapshot refresh가 승인된 project 문서를 다시 읽어 index를 만듭니다.
- 두 index의 quarantine 파일은 새 index와 기능 검증이 끝날 때까지 보존합니다.

두 index 디렉터리는 `0700`, DB/WAL/SHM은 `0600`입니다.

## Managed Project 데이터 경계

Approved Project Root의 canonical path와 Managed Project canonical path는 `runtime-v2/state.db`에만
저장하고 일반 catalog/API 응답에서는 제거합니다. Governance Worker는 등록 root 안에서 문서를
scan하고, feature gate가 열린 경우 catalog scaffold만 생성하거나 marker-owned block을 갱신합니다.
명시적으로 선택한 unmarked UTF-8 regular file은 기존 bytes를 exact prefix로 보존한 채 EOF에
adoption marker block을 append할 수 있습니다. Adoption도 기존 file update와 동일하게 exact
preimage를 저장하고 durable manifest에는 `marker-update`로 기록합니다. Action directory는 `0700`,
manifest와 preimage는 `0600`이며 pending/recovery/rollback dependency가 있으므로 자동 prune이
없습니다. `projects.yaml`은 승인 root 바로 아래의 regular file만 import source로 읽습니다.

## Codex CLI 원본 데이터

`~/.codex/`는 Codex CLI 소유 영역입니다. agentmux는 이 디렉터리에 앱 상태를 쓰지 않습니다.

Codex launch/resume command는 `~/.agentmux/hooks.json`(legacy `~/.codexmux/hooks.json`)을 `hooks={path=...}` 형태로 넘기지 않습니다. Server provider가 만든 session-scoped inline TOML override는 `status-hook.cjs`를 직접 호출합니다. 이 bridge는 project package를 import하지 않고 `port`, `cli-token`, HMAC capability만 사용해 loopback hook API에 bounded request를 보냅니다. `hooks.json`을 삭제해도 서버 재시작 때 빈 hooks/statusline 설정으로 다시 생성됩니다.

| 경로 | agentmux 처리 |
| --- | --- |
| `~/.codex/sessions/` | JSONL session/timeline 원본을 읽기 전용으로 참조 |
| `~/.codex/state_*.sqlite` | 파일 존재, schema, row count만 읽는 read-only probe 대상 |

`state_*.sqlite` probe는 SQLite를 `readonly`, `fileMustExist`, `query_only`로 열고 table/column/count summary만 반환합니다. Row content, prompt, terminal output, cwd payload, JSONL path는 읽거나 저장하지 않습니다.

## Claude Code 원본 데이터

`~/.claude/`와 `~/.claude.json`은 Claude Code 소유 영역입니다. agentmux는 이 경로에 쓰거나 지우지 않고, hook과
statusLine은 탭별 `claude-tabs/<tab-id>.json`을 `--settings`로 넘겨서만 붙입니다.

| 경로 | agentmux 처리 |
| --- | --- |
| `~/.claude/projects/<project>/<session-id>.jsonl` | transcript 원본. timeline과 status 보조 판정이 읽기 전용으로 참조. `<project>`는 cwd의 영숫자 외 문자를 `-`로 바꾼 이름(200자 초과는 잘라 hash를 붙임) |
| `~/.claude/sessions/<pid>.json` | 실행 중인 Claude Code의 현재 `sessionId`를 읽는 보조 단서. 형식이 문서화되지 않아 읽기 실패를 정상으로 다룸 |
| `~/.claude/settings.json`, project `.claude/settings.json`, `.claude/settings.local.json` | statusLine script가 사용자 원래 `statusLine.command`만 읽음 |

## `config.json` 주요 설정

| 필드 | 의미 |
| --- | --- |
| `authPassword` | scrypt password hash |
| `authSecret` | session signing secret |
| `locale` | `ko` 또는 `en` |
| `theme` | theme 설정 |
| `networkAccess` | 허용 host/network 설정 |
| `notificationsEnabled` | notification 사용 여부 |
| `soundOnCompleteEnabled` | 완료 사운드와 silent notification 정책 |
| `server` | Electron local/remote server mode |
| `claudeModel` | Claude Code 탭 실행 시 `--model` 값. 없으면 사용자 Claude 설정을 따름 |
| `claudePermissionMode` | Claude Code 탭 실행 시 `--permission-mode` 값. 없으면 사용자 Claude 설정을 따름 |
| `agentDelegationGuideEnabled` | 위임 안내, 탭 환경 변수, `permissions.allow` 사용 여부. 기본 켬. 끄면 agent 실행 명령이 이전과 byte 단위로 같음. 자세한 내용은 `CLI.md` |

`config.json` missing은 최초 startup에서만 새 empty config를 만들고 setup을 시작합니다.
Malformed JSON, 읽기 오류, valid scrypt hash만 있고 `authSecret`이 없는 상태는 자동
복구하거나 setup으로 낮추지 않습니다. 원본 bytes를 보존한 채 startup/request가
fail closed합니다. 저장된 `authSecret`은 agentmux가 생성하는 32-byte random value의
64자리 lowercase hex shape여야 하며 weak/non-canonical secret도 invalid state입니다.

비밀번호만 초기화하려면 server를 먼저 멈춘 뒤 `authPassword`, `authSecret`을 함께
제거하고 restart합니다. 실행 중 field를 제거해도 startup claim latch는 다시 열리지
않습니다. `config.json` 전체를 삭제하면 locale, theme, network, Codex option도 함께
초기화됩니다. Setup에서 선택한 `networkAccess`와 `HOST` direct bind는 claim 즉시가 아니라
restart 뒤 적용됩니다.

## 단축키 파일

`keybindings.json`은 앱 단축키 override만 저장합니다. Terminal이나 Codex 입력창에 focus가 있으면 `Ctrl+D`는 override보다 우선해서 EOF(`0x04`)로 전달됩니다.

## 삭제 기준

| 삭제 대상 | 영향 |
| --- | --- |
| `config.json` | 인증과 앱 설정 초기화 |
| `workspaces.json`, `workspaces/` | legacy workspace/layout 초기화 |
| `runtime-v2/` | runtime v2 DB 초기화. rollback JSON은 별도 |
| `session-catalog/` | Session Catalog projection 초기화. 원본 JSONL에서 authenticated rebuild 필요 |
| `governance/` | Knowledge Index projection 초기화. Managed Project refresh 필요 |
| `backups/` | runtime durable state와 governance action 복구 근거 삭제. 검증된 대체 backup 없이 삭제하지 않음 |
| `session-index.json` | session list cache 재생성. 삭제 직후 첫 목록은 비어 있을 수 있고 refresh 완료 뒤 갱신 |
| `stats/` | usage cache와 report 재생성 |
| `logs/` | 서버 로그 삭제 |
| `uploads/` | committed attachment와 남은 staged file 삭제. 실행 중 server를 먼저 종료해야 함 |
| `remote/codex/` | 이전 Windows companion 데이터. 현재 앱은 읽지 않음 |

`~/.codex/sessions/`는 Codex CLI 원본 데이터입니다. agentmux 초기화 목적으로 삭제하지 않습니다.

2026-08-21 최초 Linux live 배포에서 `runtime-v2/state.db`,
`session-catalog/index.db`, `governance/index.db`가 새로 생성됐고 DB/WAL/SHM은 모두
`0600`으로 확인했습니다. 기존 durable DB가 없었으므로 초기 backup 대상은 없었으며 이후
배포부터는 이 문서의 세 파일 단위 backup/restore 계약을 적용합니다.
