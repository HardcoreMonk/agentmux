import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_PREFIX = '/agentmux';
const LINK_PATTERN = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
const CANONICAL_PATTERN = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>|<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']canonical["'][^>]*>/i;

const listFiles = async (rootDir, relativeDir = '') => {
  const entries = await fs.readdir(path.join(rootDir, relativeDir), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    return entry.isDirectory() ? listFiles(rootDir, relativePath) : [relativePath];
  }));
  return files.flat();
};

const assertContained = (siteDir, targetPath, sourcePath, link) => {
  const relative = path.relative(siteDir, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`landing link escapes landing root: ${sourcePath} -> ${link}`);
  }
};

const resolveLandingLink = (siteDir, sourcePath, link) => {
  const cleanLink = link.split('#', 1)[0].split('?', 1)[0];
  if (!cleanLink.startsWith(PROJECT_PREFIX)) return null;

  const suffix = cleanLink.slice(PROJECT_PREFIX.length);
  let decoded;
  try {
    decoded = decodeURIComponent(suffix);
  } catch {
    throw new Error(`invalid encoded landing link: ${sourcePath} -> ${link}`);
  }

  if (decoded.split('/').includes('..')) {
    throw new Error(`landing link escapes landing root: ${sourcePath} -> ${link}`);
  }

  const relativeTarget = decoded.replace(/^\/+/, '');
  const artifactPath = relativeTarget === ''
    ? 'index.html'
    : decoded.endsWith('/')
      ? path.join(relativeTarget, 'index.html')
      : relativeTarget;
  const targetPath = path.resolve(siteDir, artifactPath);
  assertContained(siteDir, targetPath, sourcePath, link);
  return targetPath;
};

const fileExists = async (filePath) =>
  fs.stat(filePath).then((stat) => stat.isFile()).catch(() => false);

export const checkLandingSite = async ({
  siteDir,
  canonicalBase,
  requiredPaths = [],
  contentContracts = [],
}) => {
  const absoluteSiteDir = path.resolve(siteDir);
  const normalizedCanonicalBase = canonicalBase.replace(/\/+$/, '');

  for (const requiredPath of requiredPaths) {
    const targetPath = path.resolve(absoluteSiteDir, requiredPath);
    assertContained(absoluteSiteDir, targetPath, 'requiredPaths', requiredPath);
    if (!await fileExists(targetPath)) {
      throw new Error(`missing required landing artifact: ${requiredPath}`);
    }
  }

  const files = await listFiles(absoluteSiteDir);
  const htmlFiles = files.filter((filePath) => filePath.endsWith('.html'));
  let localLinks = 0;

  for (const relativePath of htmlFiles) {
    const sourcePath = path.join(absoluteSiteDir, relativePath);
    const html = await fs.readFile(sourcePath, 'utf8');
    const canonicalMatch = html.match(CANONICAL_PATTERN);

    if (relativePath !== '404.html') {
      const canonical = canonicalMatch?.[1] || canonicalMatch?.[2];
      if (!canonical || (canonical !== normalizedCanonicalBase && !canonical.startsWith(`${normalizedCanonicalBase}/`))) {
        throw new Error(`invalid landing canonical: ${relativePath} -> ${canonical || 'missing'}`);
      }
    }

    for (const match of html.matchAll(LINK_PATTERN)) {
      const link = match[1];
      const targetPath = resolveLandingLink(absoluteSiteDir, relativePath, link);
      if (!targetPath) continue;
      localLinks += 1;
      if (!await fileExists(targetPath)) {
        throw new Error(`broken landing link: ${relativePath} -> ${link}`);
      }
    }
  }

  for (const contract of contentContracts) {
    const targetPath = path.resolve(absoluteSiteDir, contract.path);
    assertContained(absoluteSiteDir, targetPath, 'contentContracts', contract.path);
    if (!await fileExists(targetPath)) {
      throw new Error(`missing landing content target: ${contract.path}`);
    }

    const content = await fs.readFile(targetPath, 'utf8');
    for (const requiredContent of contract.includes ?? []) {
      if (!content.includes(requiredContent)) {
        throw new Error(`missing required landing content: ${contract.path} -> ${requiredContent}`);
      }
    }
    for (const forbiddenContent of contract.excludes ?? []) {
      if (content.includes(forbiddenContent)) {
        throw new Error(`forbidden landing content: ${contract.path} -> ${forbiddenContent}`);
      }
    }
  }

  return {
    files: files.length,
    htmlFiles: htmlFiles.length,
    localLinks,
    contentContracts: contentContracts.length,
  };
};
