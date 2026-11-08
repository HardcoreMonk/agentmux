# Codex 작업 상태 감지

이 문서는 codexmux가 Codex tab의 상태를 판단하고 UI, notification, timeline에 전달하는 기준을 정리합니다.

## 흐름

```text
terminal runtime / process inspector
  + Codex JSONL
  + live pane capture
  + hook/client event
  v
status policy helpers
  v
StatusManager 또는 Status Worker
  v
WebSocket / notification / session history
```

상태 정책은 가능한 순수 helper에서 계산하고, polling, watch, broadcast, Web Push 같은 부수효과는 manager/worker가 담당합니다.

## 런타임 v2 상태

Runtime v2에서는 Status Worker가 status polling, JSONL watch, hook application, ack/dismiss, session history, Web Push update를 소유할 수 있습니다.

| Mode | 의미 |
| --- | --- |
| `off` | legacy status path |
| `shadow` | legacy와 worker policy를 비교 |
| `default` | worker status를 production source로 사용 |

`CODEXMUX_RUNTIME_V2=1`에서 status mode가 unset이면 Phase 6 기준 `default`로 해석합니다. Rollback은 mode를 `off`로 두는 것입니다.

## 프로세스 상태

프로세스 상태는 terminal 안에서 Codex가 실제로 실행 중인지 판단합니다.

| 상태 | 의미 |
| --- | --- |
| `running` | Codex process가 pane/session 아래에서 실행 중 |
| `shell` | shell은 살아 있지만 Codex process는 없음 |
| `missing` | terminal session 또는 process tree를 확인할 수 없음 |
| `unknown` | adapter가 충분한 정보를 제공하지 못함 |

Windows에서는 process inspector adapter가 PID, command line, child/descendant, start time을 제공합니다. 임의 `/proc` 또는 POSIX process command를 새 코드에 직접 추가하지 않습니다.

## 작업 상태

작업 상태는 사용자가 보는 Codex 작업 상태입니다.

| 상태 | 의미 |
| --- | --- |
| `busy` | Codex가 응답 생성, tool 실행, command 실행 중 |
| `idle` | 입력 가능한 정상 대기 상태 |
| `needs-input` | permission/input prompt가 열려 있음 |
| `review-needed` | 결과 검토 또는 승인 판단이 필요 |
| `interrupted` | Codex가 중단되었거나 prompt marker 없이 멈춤 |
| `stale` | 최근 관측이 오래되어 재확인이 필요 |

Permission/input prompt는 JSONL marker가 늦거나 없을 수 있으므로 live pane capture를 함께 봅니다.

## Workspace 목록의 작업 유무

Desktop workspace 목록과 mobile navigation sheet의 각 workspace는 기존 탭 아이콘과
대표 상태 문구를 함께 표시합니다. Mobile에서 workspace를 펼쳐도 문구를 유지합니다.

| 대표 문구 | 기준 |
| --- | --- |
| 상태 확인 중 | status WebSocket 연결 전/끊김 또는 현재 연결의 첫 전체 sync 이전 |
| 입력 대기 | Codex 탭 중 `needs-input` 존재 |
| 작업 중 | 입력 대기가 없고 Codex 탭 중 `busy` 존재 |
| 확인 필요 | 위 상태가 없고 Codex 탭 중 `ready-for-review` 존재 |
| 상태 미확인 | 위 상태가 없고 Codex 탭 중 `unknown` 또는 알려진 layout 탭의 상태 누락 존재 |
| 작업 없음 | 동기화 후 Codex 탭이 없거나 모두 `idle`/`inactive` 등 비활성 상태 |

이 문구는 현재 Codex 작업의 projection입니다. 과거 대화 유무나 일반 terminal의
server/running 상태, browser와 diff panel을 작업으로 세지 않습니다. 복수 상태가
섞이면 표의 순서로 대표 문구를 고르고 기존 탭별 아이콘도 함께 유지합니다.

`getWorkspaceActivityStatus`는 indicator가 선택한 해당 workspace의 탭만 받아 판정합니다.
`use-tab-store.statusSynced`는 client 전용 전체 snapshot 수신 여부이며, 기존
`statusWsConnected`와 구분합니다. 새 연결 시작/open, 연결 종료와 hook cleanup에서
초기화하고 `syncAllFromServer` 처리와 함께 완료합니다. Incremental update만으로는
완료하지 않으므로 재연결 중 이전 snapshot으로 작업 없음을 단정하지 않습니다.
새 polling, 서버 상태, API나 영속 필드는 추가하지 않습니다.

## Hook event 경로

Codex tab launch/resume은 `hooks={path="~/.codexmux/hooks.json"}`를 사용하지 않습니다. Browser는 workspace/pane/tab과 action만 server에 보내고, `agent-launch-service`가 현재 layout ownership, panel type, terminal process, Codex `0.144.1+` compatibility를 확인합니다. 검증된 server provider만 `hooks.SessionStart`, `hooks.UserPromptSubmit`, `hooks.Stop` session override를 만들어 `~/.codexmux/status-hook.cjs`를 호출합니다.

각 handler에는 HMAC capability로 canonical tab id, terminal session name, expiry가 묶입니다. Hook API는 CLI token, capability, 현재 layout ownership을 모두 확인한 event만 reducer에 전달합니다. Bridge는 bounded stdin을 읽고 loopback으로만 1초 요청하며 모든 장애에서 성공 종료하는 best-effort observer입니다. Hook 관찰 누락은 JSONL/process polling이 보정하고 Codex action 자체를 막지 않습니다.

User/project/managed/plugin hook은 Codex native layer discovery에 맡깁니다. codexmux는 user TOML을 읽거나 병합하지 않고 trust bypass flag도 쓰지 않습니다. `hooks.json`은 `hooks: {}`와 statusline 설정을 담는 생성 파일이며 status hook의 기준 source가 아닙니다.

`Stop` event는 terminal session name과 sequence를 포함해 client에 전달됩니다. Matching tab의 Git generation만 증가시키고 active tab은 즉시 cache를 우회해 갱신하며 inactive tab은 선택될 때 한 번 갱신합니다. 같은 sequence는 중복 invalidation하지 않습니다. 두 Git hook은 consumed generation을 session별로 보존하므로 같은 hook instance가 tab을 전환해도 다른 session의 낮은 generation을 이미 처리한 값으로 오인하지 않습니다.

## Rate-limit 관찰

StatusManager는 기존 256KiB JSONL tail을 한 번 읽어 작업 상태와 `event_msg/token_count/rate_limits`를 함께 투영합니다. 현재 top-level `rate_limits`와 legacy `payload.rate_limits`를 모두 읽으며, 별도 session directory scan이나 원본 파일 write는 하지 않습니다.

- key 이름과 무관하게 300분은 5시간, 10080분은 7일 window로 정규화합니다. `window_minutes`가 없는 legacy record만 primary/secondary 순서를 fallback으로 사용합니다.
- `used_percent`와 `used_percentage`, absolute/relative reset을 모두 받아들입니다.
- `observed_at`은 window별 최신 관찰을 보존하므로 한 window의 늦은 update가 다른 window를 되돌리지 않습니다.
- reset 이후 새 관찰이 없으면 0%나 다음 reset을 합성하지 않고 `갱신 대기`로 표시합니다.
- JSONL projection과 기존 rate-limit watcher는 같은 merge/dedupe publication gate를 사용합니다.
- Runtime v2 status sync는 마지막 관측값을 함께 replay하므로 초기 scan 뒤에 연결한 client도 사용량을 표시합니다.

## Resume 실패 분류

Codex resume은 timeline WebSocket에서 요청하지만 상태 판단과 사용자 복구 흐름에 영향을 줍니다.

`timeline:resume-blocked`와 `timeline:resume-error`는 summary code를 포함합니다.

| Code | 의미 | 복구 가능성 |
| --- | --- | --- |
| `invalid-session-id` | 잘못된 Codex session id | 낮음 |
| `terminal-process-unknown` | terminal foreground process를 확인하지 못함 | 재시도 가능 |
| `process-running` | shell이 아닌 다른 foreground process가 실행 중 | 해당 작업 종료 후 재시도 |
| `command-build-failed` | Codex resume command 생성 실패 | 설정/입력 확인 필요 |
| `command-send-failed` | terminal에 resume command를 보내지 못함 | terminal 재연결 후 재시도 |
| `unknown` | 분류되지 않은 resume 실패 | 로그와 상태 재확인 |

Resume 실패 event에는 raw command, cwd, JSONL path, terminal output을 넣지 않습니다.

## 알림

Notification 정책은 foreground toast, native notification, Web Push를 같은 기준으로 다룹니다.

- `notificationsEnabled=false`이면 사용자 notification을 보내지 않습니다.
- `soundOnCompleteEnabled=false`이면 완료 사운드를 재생하지 않고 system notification도 silent로 요청합니다.
- 같은 tab/session/action 조합의 중복 완료 알림은 dedupe합니다.
- Raw prompt, full command, terminal output, token-like 값은 notification payload에 넣지 않습니다.

## 이벤트 모델

Status update event는 summary projection입니다.

포함 가능한 정보:

- workspace id
- tab id/name
- Codex session id
- `cliState`
- `currentAction`
- sanitized last assistant/user summary
- prompt type, approval kind, risk level 같은 enum metadata

포함하지 않는 정보:

- raw transcript
- full terminal stdout
- full command
- cwd 전체 경로
- JSONL path
- auth token/cookie

## JSONL 메타데이터

Codex JSONL은 다음 record를 status와 timeline에 사용합니다.

- `session_meta`
- `turn_context`
- assistant/user message record
- tool call/result record
- event message
- `event_msg/token_count/rate_limits`
- permission/input 관련 record

Codex CLI가 process 시작 뒤 JSONL을 늦게 만들 수 있으므로 session id, process start time, live process를 먼저 봅니다. 실행 중인 Codex process가 session id를 노출하지 않는 경우에도 cwd 최신 JSONL만으로 active tab을 전환하지 않습니다. 최신 JSONL 채택은 다음 경우로 제한합니다.

- 기존 JSONL이 `interrupted`로 판정되어 현재 session이 끊긴 경우
- tab에 저장된 `lastUserMessage`/`lastUserMessageAt` claim과 JSONL 안의 user message, timestamp, cwd가 일치하고 같은 claim window 안에 중복 후보가 없는 경우

Web input은 claim 저장 뒤 timeline refresh signal을 발행합니다. 이미 열린 legacy/runtime timeline socket은 짧은 재시도 창 안에서 claim 기반 resolver를 다시 실행하므로, long-lived Codex process가 session id를 노출하지 않아도 소유권이 확인된 새 JSONL로만 전환합니다. 입력 제출 자체는 bracketed paste frame에 Enter를 포함하고 후속 Enter를 한 번 더 보내는 방식으로 처리합니다.

일반 session list lookup과 active tab mapping 모두 cwd만으로 최신 JSONL을 선택하지 않습니다.

## 클라이언트 필드

UI와 저장 데이터는 역사적 호환성 때문에 `agentSessionId`, `agentSummary` 같은 field 이름을 유지합니다. 의미는 Codex provider session metadata입니다. `lastUserMessageAt`은 Web input이 보낸 prompt claim 시각이며, timeline이 같은 cwd의 최신 JSONL을 이 tab 소유로 볼 수 있는지 검증할 때만 사용합니다.

이 field의 의미나 shape를 바꾸면 `ADR.md`와 이 문서를 함께 갱신합니다.

## Provider Registry

현재 등록 provider는 Codex 하나입니다. 새 provider를 추가하려면 registry contract를 먼저 통과해야 합니다.

- provider id는 lowercase id 형식이어야 합니다.
- display name은 비어 있으면 안 됩니다.
- panel type은 `normalizePanelType`에서 인정되어야 합니다.
- provider id와 panel type은 기존 provider와 중복될 수 없습니다.
- status behavior는 provider adapter가 명시합니다.
  - `watchJsonlWhenBound=true`이면 JSONL path가 tab에 묶인 동안 idle/ready 상태에서도 watcher를 유지합니다.
  - `deferStopHookUntilJsonlIdle=true`이면 stop hook을 바로 `ready-for-review`로 처리하지 않고 JSONL idle 확인 뒤 상태를 갱신합니다.

Generic status policy는 provider id 문자열로 Codex 동작을 추론하지 않고 `statusBehavior`를 입력으로 받습니다. Codex 전용 JSONL parsing과 pane prompt recovery는 여전히 Codex adapter/policy에 둡니다.

## 관련 파일

| 파일 | 역할 |
| --- | --- |
| `src/lib/status-manager.ts` | legacy status manager 부수효과 |
| `src/lib/providers/registry.ts` | provider 등록과 contract 검증 |
| `src/lib/providers/types.ts` | provider adapter와 status behavior contract |
| `src/lib/status-web-push-payload.ts` | status Web Push payload projection |
| `src/lib/status-state-machine.ts` | 상태 전이 helper |
| `src/lib/status-jsonl-scan.ts` | legacy JSONL tail scan과 assistant/action 추출 |
| `src/lib/codex-rate-limits.ts` | JSONL rate-limit observation parsing과 window merge |
| `src/lib/rate-limit-view.ts` | reset/freshness UI projection |
| `src/hooks/use-git-refresh-generation.ts` | Stop sequence별 session generation 공유 |
| `src/lib/git-refresh-generation.ts` | active session별 generation consume 정책 |
| `src/lib/providers/codex/session-hooks.ts` | Native session hook와 HMAC capability 직렬화 |
| `src/lib/hook-settings.ts` | Standalone Node hook bridge 생성 |
| `src/lib/status-notification-policy.ts` | notification 판단 |
| `src/lib/status-session-mapping.ts` | Codex session mapping |
| `src/lib/status-metadata.ts` | status metadata projection |
| `src/lib/permission-prompt.ts` | permission/input prompt parsing |
| `src/lib/codex-session-detection.ts` | Codex process/session detection |
| `src/lib/process-inspector*.ts` | process inspector adapter |
| `src/lib/windows-process-inspector.ts` | Windows process inspector |
| `src/workers/status-worker.ts` | 런타임 v2 status worker |
