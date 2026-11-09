import path from 'node:path';

export const PRODUCT_NAME_SCAN_GLOBS = [
  'messages/**',
  'src/components/**',
  'src/pages/**',
  'server.ts',
  'bin/cli.js',
  'public/**',
  'landing-src/**',
  'capacitor.config.ts',
  'android/app/src/main/res/values/strings.xml',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTEXT.md',
  'DESIGN.md',
  'docs/README.md',
  'docs/PROJECT-DESIGN.md',
  'docs/ARCHITECTURE-LOGIC.md',
  'docs/STATUS.md',
  'docs/TMUX.md',
  'docs/DATA-DIR.md',
  'docs/TESTING.md',
  'docs/SYSTEMD.md',
  'docs/PERFORMANCE.md',
  'docs/STYLE.md',
  'docs/ELECTRON.md',
  'docs/ANDROID.md',
  'docs/FOLLOW-UP.md',
  'docs/GITHUB-PAGES.md',
  'docs/agents/*.md',
];

const EXACT_SCAN_FILES = new Set([
  'server.ts',
  'bin/cli.js',
  'capacitor.config.ts',
  'android/app/src/main/res/values/strings.xml',
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'CONTEXT.md',
  'DESIGN.md',
  'docs/README.md',
  'docs/PROJECT-DESIGN.md',
  'docs/ARCHITECTURE-LOGIC.md',
  'docs/STATUS.md',
  'docs/TMUX.md',
  'docs/DATA-DIR.md',
  'docs/TESTING.md',
  'docs/SYSTEMD.md',
  'docs/PERFORMANCE.md',
  'docs/STYLE.md',
  'docs/ELECTRON.md',
  'docs/ANDROID.md',
  'docs/FOLLOW-UP.md',
  'docs/GITHUB-PAGES.md',
]);

const SCAN_DIR_PREFIXES = [
  'messages/',
  'src/components/',
  'src/pages/',
  'public/',
  'landing-src/',
];

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.mp4',
  '.webm',
  '.mp3',
  '.wav',
]);

const PRESERVED_IDENTIFIERS = [
  'codexmux-session-token',
  'x-cmux-token',
  'CODEXMUX_',
  'CMUX_',
  '__codexmux',
  '__cmux',
  'com.hardcoremonk.codexmux',
  'codexmux-runtime-v2',
  '-L codexmux',
  'CODEXMUX:',
  'Codexmux Managed',
  '.codexmux-stage-',
  'bin/codexmux.js',
  'codexwinmux',
  'codexmux@0.',
  'cmux.lock',
  '.codexmux\\',
  '"app":"codexmux"',
];

const COMPATIBILITY_LINE_PATTERN = /(?:legacy|formerly|호환|별칭|이전 이름)/i;
const PRODUCT_NAME_VIOLATION_PATTERN =
  /(?:codexmux|(?<![A-Za-z0-9_-])cmux(?![A-Za-z0-9_-]))/i;

const normalizeRepoPath = (filePath) =>
  String(filePath ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');

export const isProductNameScanTarget = (filePath) => {
  const normalized = normalizeRepoPath(filePath);
  if (!normalized) {
    return false;
  }

  const ext = path.posix.extname(normalized).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return false;
  }

  if (EXACT_SCAN_FILES.has(normalized)) {
    return true;
  }

  if (SCAN_DIR_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }

  if (normalized.startsWith('docs/agents/')) {
    const rest = normalized.slice('docs/agents/'.length);
    return rest.length > 0 && !rest.includes('/') && rest.endsWith('.md');
  }

  return false;
};

const isAllowedProductNameLine = (line) => {
  if (line.includes('product-name-allow')) {
    return true;
  }

  if (COMPATIBILITY_LINE_PATTERN.test(line)) {
    return true;
  }

  if (line.toLowerCase().includes('x-cmux-token')) {
    return true;
  }

  return PRESERVED_IDENTIFIERS.some((identifier) => line.includes(identifier));
};

export const findProductNameViolations = (files = []) => {
  const violations = [];

  for (const file of files) {
    const normalizedPath = normalizeRepoPath(file?.path);
    if (!isProductNameScanTarget(normalizedPath)) {
      continue;
    }

    const lines = String(file?.content ?? '').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!PRODUCT_NAME_VIOLATION_PATTERN.test(line)) {
        continue;
      }
      if (isAllowedProductNameLine(line)) {
        continue;
      }

      violations.push({
        path: normalizedPath,
        line: index + 1,
        text: line,
      });
    }
  }

  return violations;
};
