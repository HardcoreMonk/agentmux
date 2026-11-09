(function () {
  var API = 'https://api.github.com/repos/HardcoreMonk/agentmux/releases/latest';
  var FALLBACK = 'https://github.com/HardcoreMonk/agentmux/releases/latest';
  var releasePromise = null;

  var fetchRelease = function () {
    if (releasePromise) return releasePromise;

    releasePromise = fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('http ' + response.status);
        return response.json();
      })
      .catch(function (error) {
        releasePromise = null;
        throw error;
      });

    return releasePromise;
  };

  var pickWindowsInstaller = function (assets) {
    for (var i = 0; i < assets.length; i++) {
      var asset = assets[i];
      var name = (asset.name || '').toLowerCase();
      if (name.indexOf('-setup-') !== -1 && name.endsWith('.exe')) return asset;
    }

    return null;
  };

  document.querySelectorAll('[data-download-windows]').forEach(function (element) {
    element.addEventListener('click', function (event) {
      event.preventDefault();
      fetchRelease()
        .then(function (release) {
          var asset = pickWindowsInstaller(release.assets || []);
          if (!asset || !asset.browser_download_url) throw new Error('no-asset');
          window.location.href = asset.browser_download_url;
        })
        .catch(function () {
          window.location.href = FALLBACK;
        });
    });
  });

  if (document.querySelector('[data-download-windows]')) fetchRelease().catch(function () {});
})();
