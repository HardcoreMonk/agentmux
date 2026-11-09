---
title: Session Operations
description: Search, filter, replay, annotate, and rebuild the Codex Session Catalog.
eyebrow: Operations guide
permalink: /docs/session-operations/index.html
---
{% from "docs/callouts.njk" import callout %}

Session Operations turns local Codex JSONL into a searchable Session Catalog. It is designed for
recovering decisions and reviewing completed work; it does not replace the live terminal or mutate
Codex-owned source logs.

## Open Session Explorer

After signing in, select **Sessions** in the fixed primary navigation. Its route is `/sessions`. The
page shows Timeline Worker health, catalog freshness, saved filters, search controls, results, and the
Session replay drawer. **Activity** under Workspace is a separate live-status context, not this catalog.

You can filter by:

- message text
- project and model
- start and end date
- tags
- pinned-only state

Search text is matched against indexed message content. Result metadata and replay entries are loaded
through authenticated APIs; filesystem paths are not exposed as public catalog fields.

## Search and replay

1. Enter message text or combine it with project, model, date, tag, or pin filters.
2. Select **Search**.
3. Open a result to load **Session replay**.
4. Review user and assistant messages, tool calls, and agent events in recorded order.
5. Pin the session, apply tags, or save the current filter when it is useful for recurring reviews.

Pin, tag, and saved-filter state belongs to agentmux durable storage. The original Codex JSONL remains
read-only.

## Catalog health and rebuild

The Timeline Worker incrementally indexes files under the local Codex sessions directory. The page
separates these states:

| State | Meaning | Action |
| --- | --- | --- |
| `ready` | Search projection is available | Search normally |
| `rebuilding` | A bounded rebuild is running | Wait; existing status remains visible |
| `degraded` | Timeline Worker or index is unavailable | Check Runtime health and service logs |
| empty result | The query matched nothing | Clear filters or confirm catalog population |

An empty result is not the same as a failed worker. A new host can be healthy while `indexedSessions`
is zero.

To request a rebuild through the authenticated CLI API:

```bash
IFS= read -r agentmux_cli_token < ~/.agentmux/cli-token
curl -fsS -X POST \
  -H "x-agentmux-token: $agentmux_cli_token" \
  http://127.0.0.1:8122/api/sessions/rebuild
```

{% call callout('warning', 'Current scope') %}
Session deletion, retention automation, remote collectors, multi-engine federation, and full command
output search are not part of the current Session Operations scope.
{% endcall %}

## Next steps

- [Live session view](/agentmux/docs/live-session-view/) — follow work that is still running
- [Session status](/agentmux/docs/session-status/) — understand activity and approval states
- [Project Governance](/agentmux/docs/project-governance/) — connect session context to managed projects
- [Linux service operations](/agentmux/docs/linux-service/) — inspect health, backup, restart, and recovery
