export const KNOWN_PROCESSES: ReadonlySet<string> = new Set([
  'bash', 'sh', 'dash', 'tcsh', 'nu', 'zsh', 'fish',
  'vim', 'vi', 'nvim', 'nano', 'emacs', 'hx', 'code',
  'git', 'gitui', 'tig', 'gh', 'lazygit', 'jj', 'lazyjj',
  'node', 'deno', 'bun',
  'python', 'python3', 'go', 'ruby', 'java',
  'rust', 'rustc', 'cargo',
  'swift', 'dart', 'elixir', 'perl', 'php',
  'R', 'julia', 'scala', 'zig',
  'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'brew',
  'apt', 'dnf', 'pacman', 'yay', 'paru',
  'make', 'cmake', 'gradle', 'maven', 'webpack', 'tsc',
  'docker', 'lazydocker', 'kubectl', 'k9s', 'helm', 'minikube',
  'aws', 'gcloud', 'terraform', 'ansible', 'vagrant',
  'ssh', 'scp', 'curl', 'wget', 'rsync', 'ping',
  'htop', 'btop', 'top', 'btm', 'glances', 'mactop',
  'ranger', 'yazi', 'lf', 'lfcd',
  'mysql', 'psql', 'mongo', 'redis', 'sqlite',
  'tmux', 'screen', 'sudo', 'bat', 'gpg', 'openssl',
  'zip', 'unzip', 'jest',
  'codex', 'claude',
]);

export const hasProcessIcon = (processName: string | null | undefined): boolean => {
  if (!processName) return false;
  return KNOWN_PROCESSES.has(processName);
};
