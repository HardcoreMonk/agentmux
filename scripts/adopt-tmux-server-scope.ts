#!/usr/bin/env node
import {
  adoptTmuxServerIntoScope,
  defaultTmuxScopeDeps,
  tmuxScopeUnitName,
} from '@/lib/tmux-server-scope';

const parseArgs = (argv: string[]): { socketName: string | null; dryRun: boolean } => {
  let socketName: string | null = null;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--socket') {
      socketName = argv[i + 1] ?? null;
      i += 1;
    } else if (arg?.startsWith('--socket=')) {
      socketName = arg.slice('--socket='.length) || null;
    }
  }

  return { socketName, dryRun };
};

const main = async (): Promise<void> => {
  const { socketName, dryRun } = parseArgs(process.argv.slice(2));
  if (!socketName) {
    process.stderr.write('Usage: adopt-tmux-server-scope.ts --socket <name> [--dry-run]\n');
    process.exit(1);
  }

  const unit = tmuxScopeUnitName(socketName);
  if (dryRun) {
    const pid = await defaultTmuxScopeDeps.getServerPid(socketName);
    const cgroup = pid ? await defaultTmuxScopeDeps.readCgroup(pid) : null;
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, socket: socketName, unit, pid, cgroup })}\n`,
    );
    return;
  }

  const result = await adoptTmuxServerIntoScope(socketName);
  process.stdout.write(`${JSON.stringify({ socket: socketName, unit, ...result })}\n`);
  if (result.status === 'failed') {
    process.exit(1);
  }
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
