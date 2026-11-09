#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLandingSite } from './landing-site-check-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = await checkLandingSite({
  siteDir: path.join(rootDir, '_site'),
  canonicalBase: 'https://hardcoremonk.github.io/agentmux',
  requiredPaths: [
    'index.html',
    'ko/index.html',
    'docs/index.html',
    'ko/docs/index.html',
    'docs/agent-quickstart/index.html',
    'ko/docs/agent-quickstart/index.html',
    'docs/linux-service/index.html',
    'ko/docs/linux-service/index.html',
    'docs/session-operations/index.html',
    'ko/docs/session-operations/index.html',
    'docs/project-governance/index.html',
    'ko/docs/project-governance/index.html',
    '404.html',
    'robots.txt',
    'sitemap.xml',
    'search-index.json',
    'style.css',
    'style-docs.css',
    'site-shell.js',
    'images/hero-engine.png',
    'images/hero-engine.webp',
  ],
  contentContracts: [
    {
      path: 'index.html',
      includes: [
        'data-site-header',
        'data-theme-cycle',
        'data-site-menu',
        'hero-engine.webp',
        'Session Operations',
        'Project Governance',
        'Runtime Operations',
      ],
      excludes: ['purplemux', 'all from your phone', 'swiper-bundle'],
    },
    {
      path: 'ko/index.html',
      includes: [
        'data-site-header',
        'data-theme-cycle',
        'data-site-menu',
        'hero-engine.webp',
        '세션 운영',
        'Project Governance',
        'Runtime Operations',
      ],
      excludes: ['purplemux', '전부 내 폰에서', 'swiper-bundle'],
    },
    {
      path: 'docs/index.html',
      includes: ['data-site-header', 'data-theme-cycle', 'data-site-menu', 'data-doc-search'],
    },
    {
      path: 'ko/docs/index.html',
      includes: ['data-site-header', 'data-theme-cycle', 'data-site-menu', 'data-doc-search'],
    },
    {
      path: 'de/docs/index.html',
      includes: [
        'data-site-header',
        'aria-label="Primary navigation"',
        'data-open-label="Open menu"',
        'Getting Started',
        'Operations',
        'Reference',
      ],
    },
    {
      path: 'docs/session-operations/index.html',
      includes: ['Session Catalog', 'Session replay'],
    },
    {
      path: 'ko/docs/session-operations/index.html',
      includes: ['Session Catalog', '세션 복기'],
    },
  ],
});

console.log(JSON.stringify({ ok: true, ...result }, null, 2));
