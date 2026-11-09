---
title: Project Governance
description: Operate Approved Project Roots, Managed Projects, the Knowledge Index, and guarded scaffold or adoption actions.
eyebrow: Operations guide
permalink: /docs/project-governance/index.html
---
{% from "docs/callouts.njk" import callout %}

Project Governance reads project guidance, knowledge, lifecycle artifacts, and audit findings under
approved Linux filesystem roots. Workspace and Managed Project are different units, and public catalog
responses do not expose project filesystem paths.

## Check readiness

Select **Governance** in the fixed primary navigation; its route is `/governance`. Before operating the
page, check Governance Worker state through authenticated Runtime health.

```bash
IFS= read -r agentmux_cli_token < ~/.agentmux/cli-token
curl -fsS -H "x-agentmux-token: $agentmux_cli_token" \
  http://127.0.0.1:8122/api/v2/runtime/health
```

When `state=ready`, the read model is available. Approved roots, project summaries, document metadata,
and audit reads remain available when `writeState=disabled`.

## Register a root and project

1. In `/governance`, preview a canonical Linux directory under **Add approved root**.
2. Review the displayed canonical path and conflicts, then confirm it.
3. Register a project title and directory under that root, or preview and selectively import the
   `projects.yaml` regular file immediately below the root.
4. Select a project to inspect guidance, knowledge, lifecycle/check state, and audit candidates.

Root escapes, symlink traversal, nested mounts, and projects outside an approved root fail closed.

## Write gate

Scaffold create/update/adoption and rollback are off by default. After separate operator approval, add
this systemd drop-in and restart the service.

```ini
[Service]
Environment=AGENTMUX_GOVERNANCE_WRITES=1
```

{% call callout('warning', 'The write gate is not an authorization bypass') %}
Even with the gate enabled, an action must pass preview token validation, exact project title
confirmation, root containment, fingerprint revalidation, private backup, and the per-project writer
lock.
{% endcall %}

## Scaffold and adopt existing documents

- Missing artifacts use versioned full-document templates.
- Marker-owned artifacts are changed only inside their marker block.
- An existing unmarked UTF-8 regular file is only marked as adoptable in the first preview.
- The operator selects artifacts individually and requests a second preview before an append-only
  adoption can be confirmed.
- Adoption preserves all existing bytes as an exact prefix and appends one compact marker block at EOF.
- NUL, invalid UTF-8, and marker-like conflicts are rejected instead of overwritten.

Review the preview diff and semantic warnings, then enter the exact project title to confirm. There is
no adopt-all, force merge, delete, move, or full-sync action.

## Action history and rollback

Each action stores a private journal and exact preimage under
`~/.agentmux/backups/governance-actions/<project-id>/<action-id>/`. Directories use mode `0700` and
manifest/preimage files use `0600`.

- Rollback stops as `rollback-stale` when current output no longer matches the receipt fingerprint.
- Roll back the newest action for an artifact first.
- Pending, recovery-required, and rollback-capable backups are not pruned automatically.
- A Knowledge Index refresh failure does not reverse an already committed project write.

For an emergency stop, remove the write drop-in and restart the service. Startup recovery for an
unfinished action still runs before the disabled gate is enforced.

## Next steps

- [Session Operations](/agentmux/docs/session-operations/) — find the sessions connected to project work
- [Linux service operations](/agentmux/docs/linux-service/) — backup, restart, and health
- [Data directory](/agentmux/docs/data-directory/) — durable state and project backup boundaries
- [Architecture](/agentmux/docs/architecture/) — worker ownership and API routing
