(function () {
  'use strict';

  function slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  function buildToc() {
    var content = document.querySelector('[data-doc-content]');
    var list = document.querySelector('[data-doc-toc]');
    if (!content || !list) return [];

    var headings = content.querySelectorAll('h2, h3');
    var items = [];
    headings.forEach(function (h) {
      if (!h.id) h.id = slugify(h.textContent);
      var a = document.createElement('a');
      a.href = '#' + h.id;
      a.textContent = h.textContent;
      if (h.tagName === 'H3') a.classList.add('is-h3');
      list.appendChild(a);
      items.push({ id: h.id, el: h, link: a });
    });
    return items;
  }

  function wireActiveTocTracking(items) {
    if (!items.length || !('IntersectionObserver' in window)) return;
    var active = null;
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          var item = items.find(function (i) { return i.el === e.target; });
          if (!item) return;
          item._visible = e.isIntersecting;
        });
        var first = items.find(function (i) { return i._visible; });
        if (first && first !== active) {
          if (active) active.link.classList.remove('is-active');
          first.link.classList.add('is-active');
          active = first;
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 },
    );
    items.forEach(function (i) { obs.observe(i.el); });
  }

  function addCopyButtons() {
    document.querySelectorAll('.doc-content pre').forEach(function (pre) {
      var parent = pre.parentElement;
      if (parent && parent.classList.contains('code-block-wrap')) return;

      var wrap = document.createElement('div');
      wrap.className = 'code-block-wrap';
      parent.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copy-btn';
      btn.setAttribute('aria-label', 'Copy');
      btn.textContent = '⧉';
      btn.addEventListener('click', function () {
        var code = pre.querySelector('code');
        var text = code ? code.innerText : pre.innerText;
        navigator.clipboard.writeText(text).then(function () {
          btn.textContent = '✓';
          btn.classList.add('is-copied');
          setTimeout(function () {
            btn.textContent = '⧉';
            btn.classList.remove('is-copied');
          }, 1400);
        });
      });
      wrap.appendChild(btn);
    });
  }

  /* ── Search ──────────────────────────────────────── */

  var searchState = {
    overlay: null,
    input: null,
    results: null,
    fuse: null,
    index: null,
    focused: -1,
    currentResults: [],
    trigger: null,
    previousFocus: null,
  };

  function openSearch() {
    if (!searchState.overlay) return;
    document.dispatchEvent(new CustomEvent('agentmux:close-site-menu'));
    searchState.previousFocus = searchState.trigger;
    searchState.overlay.hidden = false;
    searchState.trigger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { searchState.input.focus(); }, 0);
    renderResults(searchState.input.value);
  }

  function closeSearch() {
    if (!searchState.overlay) return;
    searchState.overlay.hidden = true;
    searchState.trigger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    searchState.focused = -1;
    if (searchState.previousFocus && searchState.previousFocus.focus) {
      searchState.previousFocus.focus();
    }
    searchState.previousFocus = null;
  }

  function renderResults(query) {
    var results = searchState.results;
    if (!results) return;
    results.innerHTML = '';
    searchState.focused = -1;

    if (!searchState.index) {
      results.innerHTML = '<div class="doc-search-empty">Loading index…</div>';
      return;
    }

    var matches;
    if (!query.trim()) {
      matches = searchState.index.slice(0, 8).map(function (d) { return { item: d }; });
    } else if (searchState.fuse) {
      matches = searchState.fuse.search(query).slice(0, 20);
    } else {
      var q = query.toLowerCase();
      matches = searchState.index
        .filter(function (d) {
          return (
            d.title.toLowerCase().includes(q) ||
            (d.description || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 20)
        .map(function (d) { return { item: d }; });
    }

    if (!matches.length) {
      results.innerHTML = '<div class="doc-search-empty">No results for "' + escapeHtml(query) + '"</div>';
      searchState.currentResults = [];
      return;
    }

    var frag = document.createDocumentFragment();
    matches.forEach(function (m, i) {
      var item = m.item;
      var a = document.createElement('a');
      a.className = 'doc-search-result';
      a.href = item.url;
      a.setAttribute('role', 'option');
      a.innerHTML =
        '<span class="doc-search-result-group">' + escapeHtml(item.group) + '</span>' +
        '<span class="doc-search-result-title">' + escapeHtml(item.title) + '</span>' +
        (item.description ? '<span class="doc-search-result-desc">' + escapeHtml(item.description) + '</span>' : '');
      a.addEventListener('mouseenter', function () { setFocus(i); });
      frag.appendChild(a);
    });
    results.appendChild(frag);
    searchState.currentResults = Array.from(results.querySelectorAll('.doc-search-result'));
    setFocus(0);
  }

  function setFocus(i) {
    var list = searchState.currentResults;
    if (!list.length) return;
    if (searchState.focused >= 0 && list[searchState.focused]) {
      list[searchState.focused].classList.remove('is-focused');
    }
    searchState.focused = Math.max(0, Math.min(i, list.length - 1));
    var el = list[searchState.focused];
    el.classList.add('is-focused');
    el.scrollIntoView({ block: 'nearest' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initSearch() {
    var overlay = document.querySelector('[data-search-overlay]');
    var trigger = document.querySelector('[data-doc-search]');
    if (!overlay || !trigger) return;

    searchState.overlay = overlay;
    searchState.trigger = trigger;
    searchState.input = overlay.querySelector('[data-search-input]');
    searchState.results = overlay.querySelector('[data-search-results]');

    trigger.addEventListener('click', openSearch);

    overlay.querySelectorAll('[data-search-close]').forEach(function (el) {
      el.addEventListener('click', closeSearch);
    });

    searchState.input.addEventListener('input', function (e) {
      renderResults(e.target.value);
    });

    searchState.input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocus(searchState.focused + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocus(searchState.focused - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var el = searchState.currentResults[searchState.focused];
        if (el) window.location.href = el.getAttribute('href');
      } else if (e.key === 'Escape') {
        closeSearch();
      }
    });

    document.addEventListener('keydown', function (e) {
      var isCmdK = (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (isCmdK) {
        e.preventDefault();
        if (overlay.hidden) openSearch();
        else closeSearch();
      }
    });

    var currentLocale = searchState.input.dataset.locale || 'en';

    fetch('/agentmux/search-index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var scoped = data.filter(function (d) { return (d.locale || 'en') === currentLocale; });
        searchState.index = scoped;
        if (typeof Fuse !== 'undefined') {
          searchState.fuse = new Fuse(scoped, {
            keys: [
              { name: 'title', weight: 0.6 },
              { name: 'description', weight: 0.3 },
              { name: 'group', weight: 0.1 },
            ],
            threshold: 0.4,
            ignoreLocation: true,
          });
        }
        if (!overlay.hidden) renderResults(searchState.input.value);
      })
      .catch(function () {
        searchState.index = [];
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function initSidebarDrawer() {
    var sidebar = document.getElementById('doc-sidebar');
    var backdrop = document.querySelector('[data-sidebar-backdrop]');
    var openBtn = document.querySelector('[data-sidebar-open]');
    if (!sidebar || !backdrop || !openBtn) return;

    function open() {
      sidebar.classList.add('is-open');
      backdrop.hidden = false;
      openBtn.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
    }

    function close() {
      sidebar.classList.remove('is-open');
      backdrop.hidden = true;
      openBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    openBtn.addEventListener('click', open);
    document.querySelectorAll('[data-sidebar-close]').forEach(function (el) {
      el.addEventListener('click', close);
    });
    backdrop.addEventListener('click', close);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) close();
    });
  }

  function init() {
    var items = buildToc();
    wireActiveTocTracking(items);
    addCopyButtons();
    initSearch();
    initSidebarDrawer();
  }
})();
