---
title: 테마 & 글꼴
description: 앱 테마, 글꼴 크기, 터미널 팔레트 설정.
eyebrow: 설정
permalink: /ja/docs/themes-fonts/index.html
---
{% from "docs/callouts.njk" import callout %}

agentmux는 앱 테마, 글꼴 크기, 터미널 팔레트를 전역 설정으로 제공합니다. 이 문서는 앱 테마와 글꼴 크기를 다룹니다.

## 앱 테마

| 값 | 동작 |
|---|---|
| `System` | OS 설정을 따름 |
| `Light` | 밝은 테마 고정 |
| `Dark` | 어두운 테마 고정 |

선택 값은 `~/.agentmux/config.json`의 `appTheme`에 저장되고 연결된 browser tab에 동기화됩니다.

## 글꼴 크기

| preset | 용도 |
|---|---|
| `Small` | 좁은 화면에서 정보 밀도 우선 |
| `Default` | 일반 desktop 환경 |
| `Large` | 큰 화면 또는 높은 가독성 필요 |

UI는 `rem` 단위를 사용하므로 sidebar, dialog, table이 함께 scale됩니다.

## 터미널 색상

터미널 palette는 앱 theme와 별도로 관리됩니다. 자세한 내용은 [터미널 테마](/agentmux/ja/docs/terminal-themes/)를 참고하세요.

## 다음 단계

- **[커스텀 CSS](/agentmux/ja/docs/custom-css/)**
- **[터미널 테마](/agentmux/ja/docs/terminal-themes/)**
- **[사이드바 & Codex 옵션](/agentmux/ja/docs/sidebar-options/)**
