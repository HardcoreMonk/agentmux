const THREAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

// tmux rejects a send-keys argument of about 16 KB.
export const CODEX_COMMAND_SAFE_BYTES = 12_288;

export const isValidCodexThreadId = (id: unknown): id is string =>
  typeof id === 'string' && THREAD_ID_RE.test(id);

export const CODEX_SANDBOX_MODES = ['read-only', 'workspace-write', 'danger-full-access'] as const;
export type TCodexSandboxMode = typeof CODEX_SANDBOX_MODES[number];

export const CODEX_APPROVAL_POLICIES = ['untrusted', 'on-failure', 'on-request', 'never'] as const;
export type TCodexApprovalPolicy = typeof CODEX_APPROVAL_POLICIES[number];

export interface ICodexCommandOptions {
  cwd?: string;
  model?: string;
  sandbox?: TCodexSandboxMode;
  approvalPolicy?: TCodexApprovalPolicy;
  search?: boolean;
  hookConfigs?: string[];
  envPrefix?: string;
  developerInstructions?: string;
}

const buildCodexOptions = (options: ICodexCommandOptions = {}): string[] => {
  const parts: string[] = [];
  if (options.cwd) parts.push('--cd', shellQuote(options.cwd));
  if (options.model) parts.push('--model', shellQuote(options.model));
  if (options.sandbox) parts.push('--sandbox', options.sandbox);
  if (options.approvalPolicy) parts.push('--ask-for-approval', options.approvalPolicy);
  if (options.search) parts.push('--search');
  return parts;
};

const buildCodexGlobalOptions = (options: ICodexCommandOptions): string[] => {
  const configs = [...(options.hookConfigs ?? [])];
  if (options.developerInstructions) {
    configs.push(`developer_instructions=${JSON.stringify(options.developerInstructions)}`);
  }
  return configs.flatMap((config) => ['-c', shellQuote(config)]);
};

export const buildCodexLaunchCommand = (options: ICodexCommandOptions = {}): string => {
  const parts = ['codex', ...buildCodexGlobalOptions(options), ...buildCodexOptions(options)];
  return `${options.envPrefix ?? ''}${parts.join(' ')}`;
};

export const buildCodexResumeCommand = (
  threadId: string,
  options: ICodexCommandOptions = {},
): string => {
  if (!isValidCodexThreadId(threadId)) {
    throw new Error(`Invalid Codex thread ID format: ${threadId}`);
  }
  const parts = ['codex', ...buildCodexGlobalOptions(options), 'resume', threadId, ...buildCodexOptions(options)];
  return `${options.envPrefix ?? ''}${parts.join(' ')}`;
};
