import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyCliToken } from '@/lib/cli-token';

const GUIDE = `# agentmux CLI HTTP API

All endpoints require header \`x-agentmux-token: <AMUX_TOKEN>\` (legacy \`x-cmux-token\` is also accepted).

## Caller tab

An agent running in an agentmux tab sends header \`x-agentmux-caller-tab: <its tab id>\`
(the CLI adds it when AMUX_TAB_ID is set). With this header the request is an agent call:
tab create, tab send, and tab close apply the delegation limits below. The server looks the
tab up in every workspace; an unknown id returns 404 caller-tab-not-found. Without the header
there are no delegation limits. The limits prevent mistakes; they are not a security boundary.
An agent call can send only to agent tabs (codex, claude): agents pre-allow tab send, so
input typed into a shell tab would run commands without the agent's own command approval.

## Errors

Errors added for delegation use { "error": "<code>", "message": "<readable text>" }:
  400 invalid-panel-type          panelType is not one of the values below
  400 invalid-cwd                 cwd is not an absolute path to an existing directory
  404 caller-tab-not-found        the caller tab header names no tab
  409 agent-unavailable           the agent for panelType is not installed or not compatible
  409 delegation-limit            the workspace already has 6 agent-created tabs
  403 delegation-send-forbidden   an agent tried to send to a tab that is not an agent tab
                                  (nothing is typed)
  403 delegation-close-forbidden  an agent tried to close a tab it did not create
  409 target-needs-input          the target agent waits for the user (state or permission prompt)
  409 target-not-ready            the target agent is not ready (state, no agent process,
                                  unreadable screen, or a startup screen such as folder trust
                                  or the Codex update prompt)
  409 runtime-v2-disabled         the tab is a Runtime v2 tab and Runtime v2 is off
  500 internal-error              unexpected server error
Other errors keep the { "error": "<text>" } form.

## Workspaces

GET /api/cli/workspaces
  Response: { "workspaces": [{ "id": "...", "name": "...", "directories": [...] }] }

## Tabs

GET /api/cli/tabs?workspaceId=WS
  List tabs. Without workspaceId, lists tabs across all workspaces.
  Response: { "tabs": [{ "tabId", "workspaceId", "name", "sessionName", "panelType",
                         "createdByTabId", "runtimeVersion" }] }
  createdByTabId is the tab that created this tab through the CLI, or null.

POST /api/cli/tabs
  Body: { "workspaceId": "WS", "name"?: "...",
          "panelType"?: "terminal" | "codex" | "claude" | "web-browser" | "diff", "cwd"?: "/abs/dir" }
  Without a caller tab: creates the tab in the first pane of the workspace and makes it active.
  With a caller tab: creates the tab in the caller's pane when the workspace is the caller's,
  otherwise in the first pane of the workspace. The active tab does not change, the new tab
  records createdByTabId, and the workspace may hold at most 6 agent-created tabs.
  cwd defaults to the caller tab's current directory (same workspace only), then to the
  workspace's first directory.
  codex and claude tabs start the agent right away and wait up to 60 seconds for it to be
  ready (idle after its session-start). A tab stopped at a startup screen stays not ready
  until the user handles it in the UI. If the launch fails, launchError holds the reason.
  Response (201): { "tabId", "workspaceId", "paneId", "sessionName", "name", "panelType",
                    "createdByTabId", "ready", "launchError"? }
  terminal, web-browser, and diff tabs are always ready: true.

GET /api/cli/tabs/<tabId>?workspaceId=WS
  Tab info.

DELETE /api/cli/tabs/<tabId>?workspaceId=WS
  Close the tab (kills its session and removes it from the layout).
  With a caller tab, only tabs that the caller created can be closed (403
  delegation-close-forbidden otherwise, including the caller itself).
  Response: { "ok": true }

POST /api/cli/tabs/<tabId>/send?workspaceId=WS
  Body: { "content": "..." }
  Send text (bracketed paste, then Enter) to the tab.
  With a caller tab, the target must be an agent tab (codex, claude); any other tab returns
  403 delegation-send-forbidden and nothing is typed.
  Terminal tabs without a caller tab: sent without checks. Response: { "status": "sent" }
  Agent tabs (codex, claude): sent only when the state is idle, busy, or ready-for-review,
  the agent process is running, and the screen shows no permission prompt or startup
  screen. Otherwise 409 target-needs-input or target-not-ready, and nothing is typed.
  The second Enter is held back if a permission prompt or startup screen appears after
  the paste (followUpEnterSkipped: true).
  Response: { "status": "sent", "cliState", "followUpEnterSkipped" }

GET /api/cli/tabs/<tabId>/status?workspaceId=WS
  Response: { "tabId", "workspaceId", "panelType", "providerId", "alive", "command",
              "cliState", "agentSessionId", "createdByTabId" }
  providerId is the agent provider for codex and claude tabs, otherwise null.
  command is the foreground process, null for Runtime v2 tabs and dead sessions.
  cliState: idle (waiting for a prompt), busy (working), needs-input (waiting for the user),
  ready-for-review (finished a turn), inactive or unknown (agent not running or not detected).

GET /api/cli/tabs/<tabId>/result?workspaceId=WS
  Agent tabs: the last assistant reply from the session log, the state, and the screen.
  Response: { "tabId", "panelType", "cliState",
              "lastAssistantMessage": { "text", "timestamp" } | null, "content": "..." | null }
  Terminal tabs: the current screen.
  Response: { "content": "..." }

## Web-browser tabs

These endpoints only work when the tab's panelType is "web-browser" and the webview
has attached (dom-ready has fired at least once). Electron runtime required;
503 is returned in headless/remote mode.

GET /api/cli/tabs/<tabId>/browser/url?workspaceId=WS
  Current URL + title of the webview.
  Response: { "tabId", "url", "title" }

GET /api/cli/tabs/<tabId>/browser/screenshot?workspaceId=WS[&full=1][&format=base64]
  PNG screenshot. Default returns image/png; format=base64 returns { base64 } JSON.
  full=1 captures beyond the viewport.

GET /api/cli/tabs/<tabId>/browser/console?workspaceId=WS[&since=MS][&level=LEVEL]
  Ring buffer (last 500 entries) of console messages, Log entries, and exceptions.
  Response: { "tabId", "entries": [{ "level", "text", "ts", "source"?, "url"?, "line"? }] }

GET /api/cli/tabs/<tabId>/browser/network?workspaceId=WS[&since=MS][&method=M][&url=SUBSTR][&status=CODE]
  Ring buffer (last 500 requests).
  Response: { "tabId", "entries": [{ "requestId", "method", "url", "status"?, "mimeType"?,
                                     "resourceType"?, "error"?, "ts", "endedAt"? }] }

GET /api/cli/tabs/<tabId>/browser/network?workspaceId=WS&requestId=RID
  Fetch response body for one request (cached after first call).
  Response: { "tabId", "requestId", "body" }

POST /api/cli/tabs/<tabId>/browser/eval?workspaceId=WS
  Body: { "expression": "..." }
  Evaluates the expression in the webview via CDP Runtime.evaluate
  (returnByValue, awaitPromise, 10s timeout).
  Response: { "tabId", "value" }
`;

const handler = async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCliToken(req)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  return res.status(200).send(GUIDE);
};

export default handler;
