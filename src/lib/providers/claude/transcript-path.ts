import path from 'path';
import { isValidClaudeSessionId } from '@/lib/claude-command';

// Claude layout: <root>/<project-dir>/<uuid>.jsonl. Subagent transcripts live deeper and are excluded.
export const isClaudeTranscriptPath = (root: string, candidate: string): boolean => {
  const segments = path.relative(root, candidate).split(path.sep);
  return segments.length === 2 && isValidClaudeSessionId(path.basename(segments[1], '.jsonl'));
};
