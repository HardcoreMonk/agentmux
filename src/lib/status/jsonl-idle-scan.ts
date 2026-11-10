import type { ICurrentAction } from '@/types/status';
import type { TToolName } from '@/types/timeline';
import { INTERRUPT_PREFIX, summarizeToolCall } from '@/lib/session-parser';

const MAX_SNIPPET_LENGTH = 200;
const STALE_MS_INTERRUPTED = 20_000;
const STALE_MS_AWAITING_API = 90_000;

export interface IStatusAssistantExtract {
  lastAssistantSnippet: string | null;
  currentAction: ICurrentAction | null;
  reset: boolean;
}

export interface IStatusJsonlScanResult {
  matched: boolean;
  idle: boolean;
  stale: boolean;
  needsStaleRecheck: boolean;
  staleMs: number;
  lastEntryTs: number | null;
  interrupted: boolean;
}

const toCurrentAction = (block: { name?: string; input?: Record<string, unknown> }): ICurrentAction => {
  const toolName = (block.name ?? 'Tool') as TToolName;
  const input = (block.input ?? {}) as Record<string, unknown>;
  return { toolName, summary: summarizeToolCall(toolName, input) };
};

export const extractStatusAssistantInfo = (lines: string[]): IStatusAssistantExtract => {
  let userMessageSeen = false;

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.isSidechain) continue;

      if (entry.type === 'user') {
        const c = entry.message?.content;
        const isToolResult = Array.isArray(c) && c.some((b: unknown) => (b as { type?: string }).type === 'tool_result');
        if (!isToolResult) userMessageSeen = true;
        continue;
      }

      if (entry.type !== 'assistant' || !entry.message?.content) continue;

      if (userMessageSeen) return { lastAssistantSnippet: null, currentAction: null, reset: true };

      const content = entry.message.content;
      if (!Array.isArray(content)) continue;

      let lastAssistantSnippet: string | null = null;
      let currentAction: ICurrentAction | null = null;

      for (let j = content.length - 1; j >= 0; j--) {
        const block = content[j];
        if (block.type === 'tool_use') {
          currentAction = toCurrentAction(block);
          break;
        }
        if (block.type === 'text' && block.text?.trim()) {
          const text = block.text.trim();
          currentAction = {
            toolName: null,
            summary: text.length > MAX_SNIPPET_LENGTH ? `${text.slice(0, MAX_SNIPPET_LENGTH)}…` : text,
          };
          break;
        }
      }

      for (let j = content.length - 1; j >= 0; j--) {
        if (content[j].type === 'text' && content[j].text?.trim()) {
          const text = content[j].text.trim();
          lastAssistantSnippet = text.length > MAX_SNIPPET_LENGTH
            ? `${text.slice(0, MAX_SNIPPET_LENGTH)}…`
            : text;
          break;
        }
      }

      return { lastAssistantSnippet, currentAction, reset: false };
    } catch {
      continue;
    }
  }

  return { lastAssistantSnippet: null, currentAction: null, reset: false };
};

// A user line made only of "[Request interrupted by user…]" marks a turn the user stopped.
const isInterruptMarker = (entry: { type?: unknown; message?: { content?: unknown } }): boolean => {
  if (entry.type !== 'user') return false;
  const content = entry.message?.content;
  return Array.isArray(content)
    && content.length === 1
    && typeof content[0]?.text === 'string'
    && content[0].text.startsWith(INTERRUPT_PREFIX);
};

// Claude Code ends an interrupted turn (permission "No", Esc) with the interrupt marker and then a
// turn-end system line, and sends no Stop hook. The turn was interrupted when the last conversational
// line before the turn end is that marker rather than an assistant reply.
const turnEndedByInterrupt = (lines: string[], turnEndIndex: number): boolean => {
  for (let i = turnEndIndex - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.isSidechain) continue;
      if (entry.type === 'user') {
        if (entry.isMeta === true) continue;
        return isInterruptMarker(entry);
      }
      if (entry.type === 'assistant') return false;
    } catch {
      continue;
    }
  }
  return false;
};

export const scanStatusJsonlLines = (lines: string[], elapsed: number): IStatusJsonlScanResult => {
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);

      if (entry.isSidechain) continue;
      // Meta user lines (command caveats, injected context) are not user replies.
      if (entry.type === 'user' && entry.isMeta === true) continue;

      const entryTs: number | null = entry.timestamp ? new Date(entry.timestamp).getTime() : null;

      if (entry.type === 'system' && (entry.subtype === 'stop_hook_summary' || entry.subtype === 'turn_duration')) {
        return { matched: true, idle: true, stale: false, needsStaleRecheck: false, staleMs: 0, lastEntryTs: entryTs, interrupted: turnEndedByInterrupt(lines, i) };
      }

      if (entry.type === 'assistant') {
        const stopReason = entry.message?.stop_reason;
        if (!stopReason) {
          const idle = elapsed > STALE_MS_INTERRUPTED;
          return { matched: true, idle, stale: true, needsStaleRecheck: !idle, staleMs: STALE_MS_INTERRUPTED, lastEntryTs: entryTs, interrupted: false };
        }
        return { matched: true, idle: stopReason !== 'tool_use', stale: false, needsStaleRecheck: false, staleMs: 0, lastEntryTs: entryTs, interrupted: false };
      }

      if (entry.type === 'user') {
        if (isInterruptMarker(entry)) {
          return { matched: true, idle: true, stale: false, needsStaleRecheck: false, staleMs: 0, lastEntryTs: entryTs, interrupted: true };
        }
        const idle = elapsed > STALE_MS_AWAITING_API;
        return { matched: true, idle, stale: true, needsStaleRecheck: !idle, staleMs: STALE_MS_AWAITING_API, lastEntryTs: entryTs, interrupted: false };
      }
    } catch {
      continue;
    }
  }

  return { matched: false, idle: elapsed > STALE_MS_AWAITING_API, stale: true, needsStaleRecheck: elapsed <= STALE_MS_AWAITING_API, staleMs: STALE_MS_AWAITING_API, lastEntryTs: null, interrupted: false };
};
