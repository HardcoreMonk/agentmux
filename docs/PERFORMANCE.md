# 성능 최적화 기준

성능 작업은 먼저 측정하고, source of truth를 바꾸지 않는 좁은 변경부터 진행합니다. 현재는
Linux 단일 엔진의 terminal/reconnect, worker health, Session Catalog와 Governance refresh
안정성이 우선이며 Windows packaged/installed app 수치는 별도 배포면의 회귀 근거입니다.

## 배경

병목 후보는 여러 계층에 분산되어 있습니다.

- Node server memory와 event loop delay
- terminal stdout 처리
- WebSocket 연결 수와 backpressure
- Codex JSONL parsing과 watcher
- timeline render와 dedupe
- diff/stats cache
- runtime v2 worker command latency
- upload streaming의 process external memory와 backpressure

## 1차 목표

- UI hang처럼 보이는 긴 작업을 줄입니다.
- Timeline과 DIFF의 대량 데이터 렌더링 비용을 제한합니다.
- Cold path에서 불필요한 전체 scan을 줄입니다.
- Perf snapshot으로 회귀를 관측합니다.

## 우선순위

1. 측정 가능한 snapshot을 먼저 확보합니다.
2. request path의 반복 scan을 cache/index로 줄입니다.
3. 큰 render surface는 batching, memoization, virtualization을 적용합니다.
4. WebSocket burst는 batch/backpressure로 완화합니다.
5. Runtime v2 worker counter와 duration을 확인합니다.

## 계측 항목

`/api/debug/perf`는 인증된 사용자에게만 숫자와 counter를 반환합니다.

| 항목 | 예 |
| --- | --- |
| process | memory, uptime |
| event loop | delay, utilization |
| WebSocket | 연결 수, route별 상태 |
| timeline | watcher 수, parse duration, append count |
| status | poll count, duration, error |
| cache | hit/miss, build duration |
| terminal | stdout chunk count, attach count |
| runtime worker | lifecycle, command counter, timeout, sanitized last error |

Prompt, terminal output, cwd, JSONL path, token은 반환하지 않습니다.

## 구현 후보

| 후보 | 효과 |
| --- | --- |
| Timeline virtualization | 긴 timeline render 비용 제한 |
| JSONL incremental parser/cache | 전체 파일 반복 parsing 감소 |
| Adaptive status polling | idle 상태 poll 비용 감소 |
| WebSocket batching/backpressure | burst와 reconnect 비용 완화 |
| Diff/stats lazy load | 초기 화면 비용 감소 |
| Session index cache | session list request path 비용 감소 |

## 완료된 방향 요약

- Perf snapshot endpoint와 `globalThis.__ptPerfStore`가 도입되었습니다.
- Timeline entry id와 dedupe가 안정화되었습니다.
- Timeline JSONL perf snapshot helper가 추가되어 대형 대화 기준 byte/line/entry/parse duration을
  숫자로만 측정합니다.
- Session list는 백그라운드 인덱스를 사용합니다.
- DIFF는 대량 untracked 파일과 큰 hunk를 제한합니다.
- Stats build는 in-flight promise로 중복 계산을 피합니다.
- Runtime v2 worker diagnostics는 sanitized counter로 노출됩니다.
- Stats cold path date filtering이 추가되었습니다.
- Session list API는 cold index refresh를 기다리지 않고 현재 snapshot과 `refreshing` 상태를 반환하며,
  client가 refresh 완료까지 짧게 재조회합니다.
- Session Catalog는 5,000-session fixture로 initial index, incremental append, FTS query,
  replay projection과 RSS delta를 독립 측정합니다.
- UploadServer의 50MiB streaming path는 process-isolated external-memory gate로 검증합니다.

## Timeline JSONL snapshot

긴 대화나 대형 JSONL이 의심될 때는 먼저 snapshot을 남깁니다.

```bash
corepack pnpm perf:timeline-jsonl -- --synthetic-turns 2500
corepack pnpm perf:timeline-jsonl -- --file <codex-jsonl-file>
```

Snapshot은 `byteLength`, `lineCount`, `entryCount`, `parseMs`, `virtualization.level`,
`virtualization.reasons`만 판단 자료로 사용합니다. Prompt, assistant text, terminal output,
cwd, JSONL path는 출력하지 않습니다. File 입력도 source를 `file`로만 표시하고 실제 path는
출력하지 않습니다.

Rich timeline parser는 exec output accumulator와 client detail을 무제한 유지하지 않습니다.
Semantic detail은 field 4KiB, entry 16KiB로 제한하고 secret-like redaction을 적용합니다.
Rate-limit projection은 별도 session scan 없이 기존 256KiB JSONL tail read에서 함께
계산합니다.

Virtualization 판단은 다음 순서로 합니다.

1. `recommended`: entry count, byte size, parse duration 중 하나가 상한을 넘으면 timeline
   virtualization 구현 후보로 올립니다.
2. `measure-live`: synthetic 기준만으로 결정하지 않고 installed app의 실제 workspace에서 다시
   측정합니다.
3. `not-needed`: 현재 값으로는 virtualization을 시작하지 않습니다.

이 기준은 구현 개시 조건입니다. Render virtualization은 별도 plan에서 public behavior test와
실제 app scroll/append evidence를 확보한 뒤 진행합니다.

## Session Catalog snapshot

Session Operations 변경은 다음 gate로 검색 projection의 초기 구축과 증분 비용을 함께
측정합니다.

```bash
corepack pnpm perf:session-catalog
```

기본 5,000-session fixture의 fail threshold는 initial index 30초, incremental append 500ms,
FTS query 1초, 2,500-ID annotation-filter query 1초, replay projection 200ms, RSS delta
512MiB입니다. 2026-08-22 annotation pagination snapshot은 각각 `5156.764ms`, `0.564ms`,
`11.249ms`, `11.547ms`, `0.111ms`, `22,167,552 bytes`였고 filtered count 2,500건을 정확히
반환했습니다. 원본 JSONL, prompt, full path와 selection ID는 측정 결과에 포함하지 않습니다.

## Upload streaming memory gate

Upload memory 검증은 50MiB body를 별도 client process에서 64KiB backpressure write로 보내고,
각 scenario를 새 server process에서 실행합니다.

```bash
corepack pnpm check:upload-memory
```

- bare HTTP harness control과 production UploadServer/storage positive path를 비교합니다.
- retaining negative control은 같은 production path에서 body를 의도적으로 유지해 계측이
  실제 retention을 감지하는지 확인합니다.
- negative control은 external memory가 16MiB 이상 증가해야 하고, positive run 3회는 모두
  16MiB 미만이어야 합니다.
- size와 SHA-256 parity도 함께 확인합니다.

2026-07-11 측정에서 harness control은 `196,464B`, retaining negative는 `52,559,535B`,
production positive는 3회 모두 `130,912B` 증가했습니다. 이 Linux 증거는 fresh Windows
packaged filesystem 증거를 대신하지 않습니다. `v0.4.20` fresh Windows package gate가
packaged upload integrity와 kill switch를 최초 통과했고 `v0.4.21`에서 같은 gate와
artifact privacy 검사를 반복했습니다. 완료 근거는 이전 이름 저장소의 [Issue #16](https://github.com/HardcoreMonk/codexmux/issues/16)과
두 Windows release handoff에 있습니다.

## 피해야 할 작업

- 측정 없이 대규모 rewrite를 시작하지 않습니다.
- Terminal byte stream을 durable DB에 저장하지 않습니다.
- Prompt, stdout, full path를 perf/debug endpoint에 넣지 않습니다.
- UI polish를 이유로 terminal reconnect 안정성을 흔들지 않습니다.
- Linux engine gate와 실제 terminal/reconnect 확인 전에는 현재 제품 성능 개선을 release
  완료로 주장하지 않습니다. Windows package 변경은 별도 Windows gate를 추가로 통과합니다.

## 검증 기준

```bash
corepack pnpm lint
corepack pnpm tsc --noEmit
corepack pnpm test
corepack pnpm perf:timeline-jsonl -- --synthetic-turns 2500
corepack pnpm perf:session-catalog
corepack pnpm check:upload-memory
corepack pnpm smoke:runtime-v2:phase6-default-gate
corepack pnpm smoke:linux:session-governance
```

Windows package surface를 바꾼 경우에는 `smoke:windows:package-gate`를 추가하고 baseline
installer와 artifact directory 전제는 `TESTING.md`의 fresh Windows 절차를 따릅니다.

성능 변경 후에는 실제 app에서 다음을 확인합니다.

- workspace 전환 지연
- terminal attach/reconnect 안정성
- timeline scroll과 append 부하
- diff panel open time
- stats 첫 load와 재load
- `/api/debug/perf` counter 이상 증가 여부

## 의사결정 메모

2026-05-12 측정 기준:

- `corepack pnpm perf:timeline-jsonl`: synthetic 2,500 turns / 5,000 entries, parse
  `19.67ms`, virtualization `recommended`
- `corepack pnpm smoke:windows:packaged-runtime-v2`: runtime v2 Phase 6 health/perf
  gate 통과
- `corepack pnpm smoke:windows:installed-observation`: `0.4.16` 설치본 302,808ms
  관찰, 23회 반복 실행, 모든 round Phase 6 gate 통과
- `corepack pnpm smoke:windows:runtime-v2-rollback-drill`: runtime v2
  `on -> off -> restored` rollback path 통과

Runtime v2 P3의 rollback drill, 측정 기반 perf tuning, Phase 6 closeout은 현재
release blocker가 아닙니다. 실제 내부 사용자 trace에서 새 병목이 발견되면 이 문서의
측정 항목을 기준으로 다시 tuning합니다.

2026-05-16 측정 기준:

- 로컬 Codex session data: JSONL 874개, `~/.codex/sessions` 1.5GB.
- `refreshSessionIndex()` cold refresh: 약 9.2초.
- `corepack pnpm perf:timeline-jsonl`: synthetic 2,500 turns / 5,000 entries, parse `18.57ms`,
  virtualization `recommended`.
- Session list cold path는 API request가 전체 refresh를 기다리지 않고 현재 snapshot과
  `refreshing` 상태를 반환하도록 조정했습니다.
