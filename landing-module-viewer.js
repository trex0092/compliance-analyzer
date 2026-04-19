(function () {
  var view = document.getElementById('moduleView');
  var frame = document.getElementById('moduleViewFrame');
  var titleEl = document.getElementById('moduleViewTitle');
  var closeBtn = document.getElementById('moduleViewClose');
  if (!view || !frame || !titleEl || !closeBtn) return;

  // Opt-in URL sub-routing. When a landing page marks an element with
  // data-landing-base (e.g. "/workbench"), the viewer pushes the active
  // module slug into the address bar (/workbench/<slug>) so the MLRO
  // can bookmark, share, and use the browser back button. Pages that
  // don't opt in keep the original iframe-only behaviour.
  var baseEl = document.querySelector('[data-landing-base]');
  var landingBase = baseEl ? baseEl.getAttribute('data-landing-base') || '' : '';
  if (landingBase.slice(-1) === '/') {
    landingBase = landingBase.slice(0, -1);
  }

  function cardsBySlug() {
    var idx = {};
    var nodes = document.querySelectorAll('.card[data-route]');
    for (var i = 0; i < nodes.length; i++) {
      var card = nodes[i];
      var slug = card.getAttribute('data-slug') || card.getAttribute('data-route');
      if (slug) idx[slug] = card;
    }
    return idx;
  }

  function routeFor(card) {
    return card.getAttribute('data-route') || card.getAttribute('data-slug') || '';
  }

  function slugFor(card) {
    return card.getAttribute('data-slug') || card.getAttribute('data-route') || '';
  }

  function titleFor(card) {
    var t = card.querySelector('.card-title');
    return t ? t.textContent : 'Module';
  }

  function openFromCard(card, opts) {
    var route = routeFor(card);
    if (!route) return;
    // ?embedded=1 is a belt-and-braces signal for the chrome-strip CSS in
    // index.html. The primary detector is `window.self !== window.top`,
    // but same-origin iframe detection has failed in the wild (cached
    // HTML, SW shims, cross-frame Permission-Policy). The query param is
    // a deterministic second channel the head-script also checks.
    frame.src = 'index.html?embedded=1#' + route;
    titleEl.textContent = titleFor(card);
    view.classList.add('is-open');
    view.setAttribute('aria-hidden', 'false');
    if (!opts || opts.scroll !== false) {
      requestAnimationFrame(function () {
        view.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  function closeModule() {
    view.classList.remove('is-open');
    view.setAttribute('aria-hidden', 'true');
    frame.src = 'about:blank';
  }

  function pushUrl(url) {
    try {
      window.history.pushState({ module: true }, '', url);
    } catch (_e) {
      // History API can throw in sandboxed / cross-origin frames. Silent
      // fail — the iframe still opens, only the address bar stays put.
    }
  }

  function urlForSlug(slug) {
    return (landingBase || '') + '/' + slug;
  }

  function landingUrl() {
    return landingBase || window.location.pathname;
  }

  // If the user deep-linked to /<base>/<slug> (or hit back/forward),
  // open the module whose slug matches.
  function syncFromUrl(opts) {
    if (!landingBase) return;
    var path = window.location.pathname || '';
    if (path.slice(-1) === '/' && path.length > 1) path = path.slice(0, -1);
    if (path === landingBase) {
      closeModule();
      return;
    }
    var prefix = landingBase + '/';
    if (path.indexOf(prefix) !== 0) return;
    var slug = path.slice(prefix.length);
    // Ignore deeper paths so /workbench/approvals/foo doesn't try to
    // open "approvals/foo".
    if (slug.indexOf('/') !== -1) return;
    var card = cardsBySlug()[slug];
    if (card) {
      openFromCard(card, opts);
    } else {
      closeModule();
    }
  }

  document.addEventListener(
    'click',
    function (event) {
      var card = event.target.closest && event.target.closest('.card[data-route]');
      if (!card) return;
      // Allow modifier-click (new tab / window / download) to follow the
      // card's real href so the OS-level affordance keeps working.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openFromCard(card, { scroll: true });
      if (landingBase) {
        var slug = slugFor(card);
        if (slug) pushUrl(urlForSlug(slug));
      }
    },
    true
  );

  closeBtn.addEventListener('click', function () {
    closeModule();
    if (landingBase) pushUrl(landingUrl());
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && view.classList.contains('is-open')) {
      closeModule();
      if (landingBase) pushUrl(landingUrl());
    }
  });

  window.addEventListener('popstate', function () {
    syncFromUrl({ scroll: false });
  });

  // Auto-open the module that matches the current URL on first paint.
  syncFromUrl({ scroll: false });
})();
