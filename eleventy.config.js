module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy({ 'landing-src/images': 'images' });
  eleventyConfig.addPassthroughCopy({ 'landing-src/style.css': 'style.css' });
  eleventyConfig.addPassthroughCopy({ 'landing-src/style-docs.css': 'style-docs.css' });
  eleventyConfig.addPassthroughCopy({ 'landing-src/download.js': 'download.js' });
  eleventyConfig.addPassthroughCopy({ 'landing-src/docs.js': 'docs.js' });
  eleventyConfig.addPassthroughCopy({ 'landing-src/site-shell.js': 'site-shell.js' });

  eleventyConfig.setServerOptions({
    port: 8181,
  });

  const isGuideAvailable = (item, locale) =>
    !Array.isArray(item?.locales) || item.locales.includes(locale);

  eleventyConfig.addFilter('guideAvailable', isGuideAvailable);

  eleventyConfig.addFilter('docsNeighbors', (flat, slug, locale) => {
    const available = flat.filter((item) => isGuideAvailable(item, locale));
    const idx = available.findIndex((i) => i.slug === slug);
    if (idx < 0) return { prev: null, next: null };
    return {
      prev: idx > 0 ? available[idx - 1] : null,
      next: idx < available.length - 1 ? available[idx + 1] : null,
    };
  });

  const LOCALE_CODES = [
    'en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'de', 'es', 'fr', 'pt-BR', 'ru', 'tr',
  ];

  // Strip any supported locale prefix from a docs URL and return just the
  // tail (e.g. "quickstart/" or "" for index).
  const docsTail = (url) => {
    if (typeof url !== 'string') return '';
    for (const code of LOCALE_CODES) {
      if (code === 'en') continue;
      const prefix = `/${code}/docs/`;
      if (url.startsWith(prefix)) return url.slice(prefix.length);
    }
    if (url.startsWith('/docs/')) return url.slice('/docs/'.length);
    return '';
  };

  const docsUrlFor = (locale, tail) => {
    const prefix = locale === 'en' ? '/agentmux/docs/' : `/agentmux/${locale}/docs/`;
    return prefix + tail;
  };

  eleventyConfig.addFilter('localizeDocsUrl', (url, targetLocale) =>
    docsUrlFor(targetLocale, docsTail(url)),
  );

  eleventyConfig.addFilter('findDocsGroup', (nav, slug, locale) => {
    for (const group of nav) {
      if (!isGuideAvailable(group, locale)) continue;
      for (const item of group.items) {
        if (!isGuideAvailable(item, locale)) continue;
        if (item.slug === slug) return group.group[locale] || group.group.en || '';
      }
    }
    return '';
  });

  eleventyConfig.addFilter('findDocsItem', (nav, slug) => {
    for (const group of nav) {
      const item = group.items.find((candidate) => candidate.slug === slug);
      if (item) return item;
    }
    return null;
  });

  eleventyConfig.addCollection('docs', (api) =>
    api
      .getAll()
      .filter((item) => {
        if (!item.url) return false;
        const url = item.url;
        const isDocsRoot = url === '/docs/';
        const isLocaleIndex = LOCALE_CODES.some(
          (c) => c !== 'en' && url === `/${c}/docs/`,
        );
        const isDoc =
          url.startsWith('/docs/') ||
          LOCALE_CODES.some((c) => c !== 'en' && url.startsWith(`/${c}/docs/`));
        return isDoc && !isDocsRoot && !isLocaleIndex;
      })
      .sort((a, b) => (a.url > b.url ? 1 : -1)),
  );

  return {
    dir: {
      input: 'landing-src',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    pathPrefix: '/agentmux/',
    markdownTemplateEngine: 'njk',
    htmlTemplateEngine: 'njk',
    templateFormats: ['njk', 'html', 'md'],
  };
};
