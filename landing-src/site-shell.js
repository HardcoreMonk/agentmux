(function () {
  'use strict';

  var storageKey = 'agentmux-site-theme';
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  function readPreference() {
    try {
      var value = localStorage.getItem(storageKey);
      return value === 'light' || value === 'dark' ? value : 'auto';
    } catch (_) {
      return 'auto';
    }
  }

  function resolvedTheme(preference) {
    return preference === 'auto' ? (media.matches ? 'dark' : 'light') : preference;
  }

  function updateThemeControls(preference) {
    document.querySelectorAll('[data-theme-cycle]').forEach(function (button) {
      var label = button.dataset[preference + 'Label'];
      var name = button.dataset.themeName || 'Theme';
      button.querySelectorAll('[data-theme-icon]').forEach(function (icon) {
        icon.hidden = icon.dataset.themeIcon !== preference;
      });
      button.querySelectorAll('[data-theme-label]').forEach(function (target) {
        target.textContent = label;
      });
      button.setAttribute('aria-label', name + ': ' + label);
      button.title = name + ': ' + label;
    });
  }

  function applyTheme(preference) {
    document.documentElement.dataset.themePreference = preference;
    document.documentElement.dataset.theme = resolvedTheme(preference);
    updateThemeControls(preference);
  }

  function cycleTheme() {
    var current = readPreference();
    var next = current === 'auto' ? 'light' : current === 'light' ? 'dark' : 'auto';
    try { localStorage.setItem(storageKey, next); } catch (_) {}
    applyTheme(next);
  }

  function initTheme() {
    applyTheme(readPreference());
    document.querySelectorAll('[data-theme-cycle]').forEach(function (button) {
      button.addEventListener('click', cycleTheme);
    });
    media.addEventListener('change', function () {
      if (readPreference() === 'auto') applyTheme('auto');
    });
  }

  function initPopovers() {
    var popovers = Array.from(document.querySelectorAll('[data-site-popover]'));
    popovers.forEach(function (popover) {
      popover.addEventListener('toggle', function () {
        if (!popover.open) return;
        popovers.forEach(function (candidate) {
          if (candidate !== popover) candidate.removeAttribute('open');
        });
      });
    });
    document.addEventListener('click', function (event) {
      popovers.forEach(function (popover) {
        if (!popover.contains(event.target)) popover.removeAttribute('open');
      });
    });
  }

  function initMenu() {
    var button = document.querySelector('[data-site-menu]');
    var panel = document.querySelector('[data-site-menu-panel]');
    if (!button || !panel) return;

    function close() {
      panel.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', button.dataset.openLabel);
      document.body.classList.remove('site-menu-open');
    }

    button.addEventListener('click', function () {
      var willOpen = panel.hidden;
      panel.hidden = !willOpen;
      button.setAttribute('aria-expanded', String(willOpen));
      button.setAttribute('aria-label', willOpen ? button.dataset.closeLabel : button.dataset.openLabel);
      document.body.classList.toggle('site-menu-open', willOpen);
    });
    panel.addEventListener('click', function (event) {
      if (event.target.closest('a')) close();
    });
    document.addEventListener('agentmux:close-site-menu', close);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !panel.hidden) {
        close();
        button.focus();
      }
    });
  }

  function initCopyButtons() {
    document.querySelectorAll('[data-copy-text]').forEach(function (button) {
      button.addEventListener('click', function () {
        var value = button.dataset.copyText;
        navigator.clipboard.writeText(value).then(function () {
          var previous = button.textContent;
          button.textContent = '✓';
          button.classList.add('is-copied');
          setTimeout(function () {
            button.textContent = previous;
            button.classList.remove('is-copied');
          }, 1400);
        });
      });
    });
  }

  function init() {
    initTheme();
    initPopovers();
    initMenu();
    initCopyButtons();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
