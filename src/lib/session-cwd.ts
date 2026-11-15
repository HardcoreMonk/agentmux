import type { IRuntimeTerminalSessionInfo } from '@/lib/runtime/contracts';
import { RUNTIME_SESSION_PREFIX } from '@/lib/runtime/session-name';
import { getRuntimeSupervisor } from '@/lib/runtime/supervisor';
import { getSessionCwd, hasSession } from '@/lib/tmux';

export interface ISessionCwdDeps {
  hasSession: (sessionName: string) => Promise<boolean>;
  getSessionCwd: (sessionName: string) => Promise<string | null>;
  getTerminalSessionInfo: (input: { sessionName: string }) => Promise<IRuntimeTerminalSessionInfo | null>;
  isRuntimeV2Enabled: () => boolean;
}

const DEFAULT_DEPS: ISessionCwdDeps = {
  hasSession,
  getSessionCwd,
  getTerminalSessionInfo: (input) => getRuntimeSupervisor().getTerminalSessionInfo(input),
  isRuntimeV2Enabled: () => process.env.AGENTMUX_RUNTIME_V2 === '1',
};

export const resolveSessionCwd = async (
  sessionName: string,
  deps?: Partial<ISessionCwdDeps>,
): Promise<{ exists: boolean; cwd: string | null }> => {
  const resolvedDeps: ISessionCwdDeps = { ...DEFAULT_DEPS, ...deps };

  if (sessionName.startsWith(RUNTIME_SESSION_PREFIX)) {
    if (!resolvedDeps.isRuntimeV2Enabled()) {
      return { exists: false, cwd: null };
    }
    const info = await resolvedDeps.getTerminalSessionInfo({ sessionName });
    if (!info || !info.exists) {
      return { exists: false, cwd: null };
    }
    return { exists: true, cwd: info.cwd };
  }

  const exists = await resolvedDeps.hasSession(sessionName);
  if (!exists) {
    return { exists: false, cwd: null };
  }
  const cwd = await resolvedDeps.getSessionCwd(sessionName);
  return { exists: true, cwd };
};
