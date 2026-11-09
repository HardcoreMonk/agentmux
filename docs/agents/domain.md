# 도메인 문서 규칙

이 저장소에서 새 기능, 동작 변경, 작업 흐름 계약 변경, 여러 파일에 걸친 변경을
시작할 때는 도메인 아키텍처 점검을 거칩니다.

## 작업 전에 읽을 문서

가능하면 다음 순서로 읽습니다. 파일이 없으면 오류가 아닙니다.

1. `CONTEXT.md`
2. `CONTEXT-MAP.md`
3. `docs/adr/`
4. 맥락별 ADR directory
5. `docs/ADR.md`
6. `docs/PROJECT-DESIGN.md`
7. UI 시각 계약이 관련되면 root `DESIGN.md`와 `docs/STYLE.md`
8. 관련 기존 코드와 문서

## 도메인 아키텍처 점검

`superpowers:brainstorming / writing-spec` 뒤, `grill-me` 전에 수행합니다.

출력해야 하는 내용:

- 기준 도메인 용어
- 거부된 동의어
- bounded context 또는 module 후보
- aggregate/entity/value-object 후보
- folder structure 영향
- module boundary 영향
- 공개 API, function signature, type shape 영향
- adapter/infrastructure 경계 영향
- ADR 후보

## 용어

확인된 도메인 언어와 충돌하는 이름을 코드에 추가하지 않습니다. 현재 Linux 단일
엔진 통합에서는 다음 용어를 우선합니다.

| 표준 용어 | 의미 |
| --- | --- |
| 코딩 에이전트 웹 세션 매니저 | 코딩 에이전트 CLI 세션을 관리하는 agentmux 제품 정체성 (현재 Codex 지원, Claude Code 지원 예정) |
| Linux 단일 엔진 호스트 | server, worker, tmux, Codex JSONL, app DB와 project read를 소유하는 host |
| Session Catalog | Codex JSONL에서 계산한 session metadata와 search projection |
| Managed Project | 승인된 canonical root와 governance policy를 가진 project aggregate |
| Approved Project Root | project 등록, import, scan을 허용한 Linux filesystem capability |
| Project Governance | guidance, knowledge, check, audit를 제공하는 bounded context |
| Knowledge Index | project-local 문서 navigation을 위한 재생성 가능한 projection |
| Project Lifecycle | spec부터 operate까지 project artifact로 판단하는 workflow |
| Runtime Operations | worker health, mode, deploy/restart를 다루는 운영 영역 |
| 런타임 어댑터 | OS별 terminal/process/service 구현 경계 |
| Local Codex session | local JSONL과 running process를 연결한 투영 |
| 시각 계약 | 제품 UI의 theme, layout, component 상태, 반응형/accessibility 규칙 |

거부 용어:

- 현재 제품명으로서 `codexmux` (과거 기록·호환 별칭 설명 외 사용 금지)
- Windows companion integration
- Windows bridge
- tmux backend를 기준 runtime 용어로 쓰는 표현
- Android primary client
- terminal dashboard를 제품 정체성으로 쓰는 표현
- lifecycle을 Project Lifecycle, Runtime Operations, ADR Lifecycle 구분 없이 쓰는 표현
- Workspace와 Managed Project를 합친 workspace project

## ADR

다음 조건을 모두 만족하면 ADR 후보입니다.

- 되돌리기 어렵습니다.
- 맥락 없이 보면 놀라운 결정입니다.
- 실제 trade-off가 있습니다.

작은 styling, 단일 copy, 테스트만의 정리는 ADR이 필요하지 않습니다.

## Improve Codebase Architecture 경계

`improve-codebase-architecture`는 승인된 plan에 포함된 architecture 후보에만 적용합니다.

허용:

- shallow module
- duplicated boundary
- testability friction
- domain behavior와 data locality 문제
- 확인된 domain language와 충돌하는 naming

금지:

- unrelated module 변경
- FE/React/Vercel skill rewrite
- BE/FastAPI skill rewrite
- 승인 없는 sub-agent dispatch
- open-ended cleanup phase
