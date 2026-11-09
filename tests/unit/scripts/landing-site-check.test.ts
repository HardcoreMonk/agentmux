import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const loadLib = async () =>
  import(pathToFileURL(path.join(process.cwd(), 'scripts/landing-site-check-lib.mjs')).href);

describe('landing site artifact check', () => {
  let siteDir: string;

  beforeEach(async () => {
    siteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmux-landing-check-'));
  });

  afterEach(async () => {
    await fs.rm(siteDir, { recursive: true, force: true });
  });

  const write = async (relativePath: string, content = '') => {
    const filePath = path.join(siteDir, relativePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);
  };

  const writeValidSite = async () => {
    await write('index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/">
      <a href="/agentmux/docs/">Docs</a>
      <img src="/agentmux/images/og-image.png" alt="">
      <a href="https://github.com/HardcoreMonk/agentmux">GitHub</a>
    `);
    await write('docs/index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/docs/">
      <a href="/agentmux/">Home</a>
    `);
    await write('images/og-image.png');
    await write('404.html');
    await write('robots.txt');
    await write('sitemap.xml');
  };

  it('accepts required pages, canonical URLs, internal assets and external links', async () => {
    const { checkLandingSite } = await loadLib();
    await writeValidSite();

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html', 'docs/index.html', '404.html', 'robots.txt', 'sitemap.xml'],
    })).resolves.toMatchObject({
      htmlFiles: 3,
      localLinks: 3,
    });
  });

  it('fails when a required artifact is missing', async () => {
    const { checkLandingSite } = await loadLib();
    await writeValidSite();

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['docs/agent-quickstart/index.html'],
    })).rejects.toThrow('missing required landing artifact');
  });

  it('fails when an HTML canonical points outside the Pages origin', async () => {
    const { checkLandingSite } = await loadLib();
    await write('index.html', '<link rel="canonical" href="https://subicura.com/agentmux/">');

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
    })).rejects.toThrow('invalid landing canonical');
  });

  it('fails closed on a broken /agentmux link', async () => {
    const { checkLandingSite } = await loadLib();
    await write('index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/">
      <a href="/agentmux/docs/missing/">Missing</a>
    `);

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
    })).rejects.toThrow('broken landing link');
  });

  it('fails closed when a /agentmux link escapes the artifact root', async () => {
    const { checkLandingSite } = await loadLib();
    await write('index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/">
      <a href="/agentmux/../private.txt">Escape</a>
    `);

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
    })).rejects.toThrow('escapes landing root');
  });

  it('enforces required and forbidden content in generated pages', async () => {
    const { checkLandingSite } = await loadLib();
    await writeValidSite();

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
      contentContracts: [{
        path: 'index.html',
        includes: ['Session Operations', 'Project Governance'],
        excludes: ['purplemux'],
      }],
    })).rejects.toThrow('missing required landing content');

    await write('index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/">
      <h1>Session Operations</h1>
      <p>Project Governance</p>
    `);

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
      contentContracts: [{
        path: 'index.html',
        includes: ['Session Operations', 'Project Governance'],
        excludes: ['purplemux'],
      }],
    })).resolves.toMatchObject({ contentContracts: 1 });

    await write('index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/">
      <h1>Session Operations</h1>
      <p>Project Governance · purplemux</p>
    `);

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
      contentContracts: [{
        path: 'index.html',
        includes: ['Session Operations', 'Project Governance'],
        excludes: ['purplemux'],
      }],
    })).rejects.toThrow('forbidden landing content');
  });

  it('enforces the shared site shell contract on generated pages', async () => {
    const { checkLandingSite } = await loadLib();
    await writeValidSite();

    await write('index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/">
      <header data-site-header>
        <button data-theme-cycle>Auto</button>
        <button data-site-menu>Menu</button>
      </header>
      <picture><source srcset="/agentmux/images/hero-engine.webp"></picture>
    `);

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
      contentContracts: [{
        path: 'index.html',
        includes: ['data-site-header', 'data-theme-cycle', 'data-site-menu', 'hero-engine.webp'],
        excludes: ['swiper-bundle'],
      }],
    })).resolves.toMatchObject({ contentContracts: 1 });

    await write('index.html', `
      <link rel="canonical" href="https://hardcoremonk.github.io/agentmux/">
      <header data-site-header><button data-theme-cycle>Auto</button></header>
      <script src="swiper-bundle.js"></script>
    `);

    await expect(checkLandingSite({
      siteDir,
      canonicalBase: 'https://hardcoremonk.github.io/agentmux',
      requiredPaths: ['index.html'],
      contentContracts: [{
        path: 'index.html',
        includes: ['data-site-menu'],
        excludes: ['swiper-bundle'],
      }],
    })).rejects.toThrow('missing required landing content');
  });
});
