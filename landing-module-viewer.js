(function () {
  var view = document.getElementById('moduleView');
  var frame = document.getElementById('moduleViewFrame');
  var titleEl = document.getElementById('moduleViewTitle');
  var closeBtn = document.getElementById('moduleViewClose');
  if (!view || !frame || !titleEl || !closeBtn) return;

  // Discover the set of valid routes + human labels from the cards in the
  // page. Each landing page (compliance-ops, workbench, logistics) declares
  // its own set of .card[data-route] elements; this viewer is generic.
  var routes = {};
  var cards = document.querySelectorAll('.card[data-route]');
  for (var i = 0; i < cards.length; i++) {
    var route = cards[i].getAttribute('data-route');
    var labelEl = cards[i].querySelector('.card-title');
    routes[route] = labelEl ? labelEl.textContent : 'Module';
  }

  function stripTrailingRoute(path) {
    for (var route in routes) {
      var suffix = '/' + route;
      if (path === suffix || path.endsWith(suffix)) {
        return path.slice(0, path.length - suffix.length);
      }
    }
    return path;
  }

  function normalisePath(path) {
    // Strip trailing slash, then strip .html, then strip a trailing route.
    var p = (path || '/').replace(/\/+$/, '');
    p = p.replace(/\.html$/, '');
    return p;
  }

  // The base path is the landing page's own URL without any /<route>
  // segment — e.g. "/compliance-ops" for this page, "/workbench" for the
  // workbench landing. Derived from the current URL at boot so the
  // viewer stays generic across landing pages.
  var basePath = stripTrailingRoute(normalisePath(window.location.pathname));
  if (!basePath) basePath = '/';

  function routeFromPath(path) {
    var normalised = normalisePath(path);
    for (var route in routes) {
      if (normalised.endsWith('/' + route)) return route;
    }
    return null;
  }

  function urlForRoute(route) {
    if (!route) return basePath || '/';
    var bp = basePath === '/' ? '' : basePath;
    return bp + '/' + route;
  }

  function openModule(route, label, historyMode) {
    if (!route || !(route in routes)) return;
    // ?embedded=1 is a belt-and-braces signal for the chrome-strip CSS in
    // index.html. The primary detector is `window.self !== window.top`,
    // but same-origin iframe detection has failed in the wild (cached
    // HTML, SW shims, cross-frame Permission-Policy). The query param is
    // a deterministic second channel the head-script also checks.
    frame.src = 'index.html?embedded=1#' + route;
    titleEl.textContent = label || routes[route] || 'Module';
    view.classList.add('is-open');
    view.setAttribute('aria-hidden', 'false');
    if (historyMode === 'push') {
      history.pushState({ route: route }, '', urlForRoute(route));
    } else if (historyMode === 'replace') {
      history.replaceState({ route: route }, '', urlForRoute(route));
    }
    requestAnimationFrame(function () {
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function closeModule(historyMode) {
    view.classList.remove('is-open');
    view.setAttribute('aria-hidden', 'true');
    frame.src = 'about:blank';
    if (historyMode === 'push') {
      history.pushState({ route: null }, '', urlForRoute(null));
    } else if (historyMode === 'replace') {
      history.replaceState({ route: null }, '', urlForRoute(null));
    }
  }

  document.addEventListener(
    'click',
    function (event) {
      var card = event.target.closest && event.target.closest('.card[data-route]');
      if (!card) return;
      // Allow modifier clicks (cmd/ctrl/shift/middle) to open in a new
      // tab using the card's actual href — don't hijack those.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      event.preventDefault();
      event.stopPropagation();
      var route = card.getAttribute('data-route');
      var label = card.querySelector('.card-title');
      openModule(route, label ? label.textContent : 'Module', 'push');
    },
    true
  );

  closeBtn.addEventListener('click', function () { closeModule('push'); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && view.classList.contains('is-open')) {
      closeModule('push');
    }
  });

  window.addEventListener('popstate', function (event) {
    var state = event.state && typeof event.state === 'object' ? event.state : null;
    var route = state && state.route ? state.route : routeFromPath(window.location.pathname);
    if (route && routes[route]) {
      openModule(route, routes[route], null);
    } else {
      closeModule(null);
    }
  });

  // Initialise from the URL on first load so deep-links like
  // /compliance-ops/training boot directly into the training module.
  var initialRoute = routeFromPath(window.location.pathname);
  if (initialRoute) {
    openModule(initialRoute, routes[initialRoute], 'replace');
  } else {
    history.replaceState({ route: null }, '', urlForRoute(null));
  }
})();
