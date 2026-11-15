# plan-eng-review: Codex 보조 (설계 2-1)

- 대상: `docs/superpowers/plans/2026-11-15-codex-assist.md`(`a4deb1ca`), spec `docs/superpowers/specs/2026-11-15-codex-assist-design.md`
- 검토: 독립 subagent(Opus, 읽기 전용, 2026-11-15). Codex `rust-v0.167.0` source(`tui/src/update_prompt.rs`,
  `tui/src/startup_hooks_review.rs`와 test snapshot, `hooks/src/engine/discovery.rs`, `command_runner.rs`)를 함께 읽었다.
  이 검토가 spec의 설계 리뷰도 겸한다(spec Lifecycle 참고).
- Controller(Claude)가 C1, I6을 source에서 다시 확인했다.
- 결론: **approve with changes**. Critical 1, Important 7, Minor 11. 모두 spec·계획에 반영했다.
- 방식 1의 근거(env가 hook에 전달됨, hash가 handler 정의로 정해짐, session-flag key 고정)는 source로 확인됐다.

## 반영

| # | 등급 | 내용 | 반영 |
| --- | --- | --- | --- |
| C1 | Critical | 0.167 update 안내 문구는 `Update available · <cur> → <latest>`. 계획·spec과 이미 배포된 위임 CLI 판정은 옛 `Update available! x -> y`를 찾아 놓친다. 기본 강조가 "Update now"라 30초 뒤 Enter가 업데이트를 실행할 수 있다 | 두 형식 모두 판정. spec에 0.167 문구 절 추가. Task 3이 `matchAgentStartupScreen`도 고친다 |
| I1 | Important | `sendBlocked`가 `useWebInput.send()`만 막고, 첨부가 있는 `web-input-bar` `dispatch()`는 Enter를 바로 보낸다 | 순수 함수 `decideWebInputDispatch`로 두 분기 모두 판단(Task 5) |
| I2 | Important | 이미 실행 중인 session도 새로고침이나 탭 전환 때 잠기고, 시작 표시가 timeline을 가린다 | "시작 중" 정의(agent process false→true를 본 뒤), entry가 있으면 표시 안 함(Task 5) |
| I3 | Important | latch 범위가 정해지지 않았고, 준비 뒤 차단 화면에서도 입력이 열린다 | 차단 화면은 늘 잠금, `launchKey` 출처 명시(Task 5) |
| I4 | Important | 30초 시간 제한을 다시 평가할 timer가 없다 | scope 시작 때 timer, 만료 때 `tick`(Task 5) |
| I5 | Important | hook·click test가 이 repo의 vitest(`node`, `renderToStaticMarkup`)로는 불가능하다 | 상태 기계를 `codex-screen-tracker.ts`로 빼고, card test는 버튼 유무와 문구만 본다(Task 4) |
| I6 | Important | Task 1 결과가 계획에 반영되지 않는다. trust는 `2`만으로 확정되지 않는다 | Key 기대값 `'2\r'`/`'3'`, update `'1'~'3'`. Task 1이 계획을 고친다 |
| I7 | Important | trust 버튼 설명이 출처를 단정한다. agentmux hook trust 뒤 다른 출처의 3개도 오인시킨다 | fingerprint 기록(`<dataDir>/codex-hook-trust.json`), 기록과 같으면 trust 버튼 숨김, 단정하지 않는 문구(controller 판단, 사용자 규칙보다 보수적) |
| M1 | Minor | `scripts/smoke-codex-session-hooks.ts`, 기존 `tests/unit/lib/providers/codex-session-hooks.test.ts` 누락 | Task 2 Files에 추가 |
| M2 | Minor | "stable" test의 capability 모양 검사가 bridge 파일명에도 맞는다 | 정규식으로 바꿈 |
| M3 | Minor | byte 동일 문구 위치(ADR-035, `CLI.md:41`, `DATA-DIR.md:232`), 다른 문서 누락, 남은 위험 기록 담당 없음 | Task 2·6 문서 목록 정정 |
| M4 | Minor | `hook-settings.ts` 행 번호 | 24-26행 |
| M5 | Minor | desktop `WebInputBar`는 pane-container가 그린다 | Task 5 Files 정정 |
| M6 | Minor | "import 없음"과 folder trust 판정 충돌 | `trust-prompt-detector` import 허용 |
| M7 | Minor | 준비 판정 세부 누락 | 끝 빈 줄 자르기, "Input disabled." 정규식 명시 |
| M8 | Minor | update 실패 상태가 없다 | `failed` 상태와 재시작 버튼 |
| M9 | Minor | resume 재시작은 직전 session을 잘못 재개할 수 있다 | 기존 restart와 같은 `launch`, `requestAgentLaunch` |
| M10 | Minor | 확인 작업 중 "Update now"가 격리 밖 전역 설치를 실행한다 | Task 1·6에서 Skip만 |
| M11 | Minor | 실패 Ruling 앞뒤가 맞지 않는다 | Task 2 trust 경로와 hook 검토 카드만 대체 |
