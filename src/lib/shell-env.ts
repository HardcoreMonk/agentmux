import { PRISTINE_ENV } from '@/lib/pristine-env';

const INHERITED_KEYS = new Set([
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'PATH',
  'TERM',
  'COLORTERM',
  'LANG',
  'TMPDIR',
  'TMUX_TMPDIR',
  'SSH_AUTH_SOCK',
  'SSH_CONNECTION',
  'SSH_TTY',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'TZ',
]);

const INHERITED_PREFIXES = ['LC_'];

const isInherited = (key: string): boolean =>
  INHERITED_KEYS.has(key) || INHERITED_PREFIXES.some((p) => key.startsWith(p));

const FORCED_OVERRIDES: Record<string, string> = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
};

const collectShellEnv = (): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(PRISTINE_ENV)) {
    if (value !== undefined && isInherited(key)) {
      env[key] = value;
    }
  }
  return { ...env, ...FORCED_OVERRIDES };
};

export const buildShellEnv = (): NodeJS.ProcessEnv => collectShellEnv() as NodeJS.ProcessEnv;

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

export const defaultShell = (): string =>
  PRISTINE_ENV.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

export const buildShellLaunchCommand = (): string => {
  const env = collectShellEnv();
  const envArgs = Object.entries(env)
    .map(([k, v]) => `${k}=${shQuote(v)}`)
    .join(' ');
  // TMUX/TMUX_PANE은 tmux가 pane 생성 시 환경변수로 주입한다. env -i가 이걸 지우지
  // 않도록 sh가 "$TMUX"를 expand하게 따옴표를 그대로 둔다 (Node가 아닌 sh에서 치환).
  const tmuxVars = 'TMUX="$TMUX" TMUX_PANE="$TMUX_PANE"';
  return `env -i ${tmuxVars} ${envArgs} ${shQuote(defaultShell())} -l`;
};
