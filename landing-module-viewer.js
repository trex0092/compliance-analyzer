(function () {
  var view = document.getElementById('moduleView');
  var frame = document.getElementById('moduleViewFrame');
  var titleEl = document.getElementById('moduleViewTitle');
  var closeBtn = document.getElementById('moduleViewClose');
  if (!view || !frame || !titleEl || !closeBtn) return;

  // Landing slugs that resolve to a root-level .html via netlify.toml
  // redirects. Any first URL segment outside this list is treated as a
  // raw .html file (defensive: local file:// / preview deploys).
  var LANDING_SLUGS = ['logistics', 'workbench', 'compliance-ops', 'routines'];

  // Base path for the current landing page — never includes a module
  // sub-slug. "/logistics", "/workbench", etc. Falls back to the raw
  // first path segment when the current URL is something we do not
  // recognise (still non-destructive — we just push "/<first>/<slug>").
  function getBasePath() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    if (!segs.length) return '/';
    var first = segs[0].replace(/\.html$/, '');
    if (LANDING_SLUGS.indexOf(first) !== -1) return '/' + first;
    return '/' + segs[0];
  }

  function findCardBySlug(slug) {
    if (!slug) return null;
    var cards = document.querySelectorAll('.card[data-route]');
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      var s = c.getAttribute('data-slug') || c.getAttribute('data-route');
      if (s === slug) return c;
    }
    return null;
  }

  function slugForCard(card) {
    return card.getAttribute('data-slug') || card.getAttribute('data-route');
  }

  function openModule(route, label, slug, pushHistory) {
    // ?embedded=1 is a belt-and-braces signal for the chrome-strip CSS in
    // index.html. Primary detector is `window.self !== window.top`, but
    // the query param is a deterministic second channel the head-script
    // also checks.
    frame.src = 'index.html?embedded=1#' + route;
    titleEl.textContent = label || 'Module';
    view.classList.add('is-open');
    view.setAttribute('aria-hidden', 'false');
    if (pushHistory !== false && slug) {
      var target = getBasePath() + '/' + slug;
      if (location.pathname !== target) {
        history.pushState({ slug: slug, route: route, label: label }, '', target);
      }
    }
    requestAnimationFrame(function () {
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function closeModule(pushHistory) {
    view.classList.remove('is-open');
    view.setAttribute('aria-hidden', 'true');
    frame.src = 'about:blank';
    if (pushHistory !== false) {
      var base = getBasePath();
      if (location.pathname !== base) {
        history.pushState({}, '', base);
      }
    }
  }

  function openSlug(slug, pushHistory) {
    var card = findCardBySlug(slug);
    if (!card) return false;
    var route = card.getAttribute('data-route');
    var labelEl = card.querySelector('.card-title');
    var label = labelEl ? labelEl.textContent : 'Module';
    openModule(route, label, slug, pushHistory);
    return true;
  }

  // Card click → open module in-page and push the deep-link URL.
  document.addEventListener(
    'click',
    function (event) {
      var card = event.target.closest && event.target.closest('.card[data-route]');
      if (!card) return;
      // Honour modifier clicks (cmd/ctrl/middle) for open-in-new-tab.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      event.preventDefault();
      event.stopPropagation();
      openSlug(slugForCard(card), true);
    },
    true
  );

  closeBtn.addEventListener('click', function () { closeModule(true); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && view.classList.contains('is-open')) {
      closeModule(true);
    }
  });

  // Browser back/forward: react to URL changes without pushing new state.
  window.addEventListener('popstate', function () {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    var first = segs.length ? segs[0].replace(/\.html$/, '') : '';
    var tail = segs.length >= 2 && LANDING_SLUGS.indexOf(first) !== -1 ? segs[1] : '';
    if (tail) {
      if (!openSlug(tail, false)) closeModule(false);
    } else {
      closeModule(false);
    }
  });

  // Deep-link entry: /logistics/inbound-advice auto-opens that module on
  // page load. The Netlify splat redirect serves logistics.html for any
  // /logistics/* path while preserving the clean URL in the address bar.
  (function initialDeepLink() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    if (segs.length < 2) return;
    var first = segs[0].replace(/\.html$/, '');
    if (LANDING_SLUGS.indexOf(first) === -1) return;
    openSlug(segs[1], false);
  })();

  // When the embedded app navigates internally (user clicks a nav-bar
  // item inside index.html), mirror the new route into the parent URL
  // so the address bar reflects the active module. replaceState (not
  // pushState) keeps the history stack flat — internal nav in the
  // iframe should not pollute browser back.
  frame.addEventListener('load', function () {
    var inner;
    try { inner = frame.contentWindow; } catch (_) { return; }
    if (!inner) return;
    try {
      inner.addEventListener('hashchange', function () {
        if (!view.classList.contains('is-open')) return;
        var raw;
        try { raw = inner.location.hash || ''; } catch (_) { return; }
        var route = raw.replace(/^#\/?/, '').split('?')[0];
        if (!route) return;
        // Prefer an existing card's slug (nicer URL) when one matches
        // the hash; otherwise kebab-case the raw hash as a fallback.
        var card = findCardBySlug(route);
        var slug = card ? slugForCard(card) : route.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!slug) return;
        var target = getBasePath() + '/' + slug;
        if (location.pathname !== target) {
          history.replaceState({ slug: slug, route: route }, '', target);
        }
      });
    } catch (_) {
      // Cross-origin iframe — can't observe. Fine; card clicks still push URL.
    }
  });
})();
