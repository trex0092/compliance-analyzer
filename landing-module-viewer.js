(function () {
  // Native module renderer for the MLRO landing pages. Instead of loading
  // the main `index.html` into an <iframe> (which forced the user to see
  // main-app chrome leaking in), we fetch index.html once, cache the
  // parsed document, extract each requested `#tab-<route>` subtree, and
  // inject it directly into the landing page's `#moduleViewContent`
  // host. Main-app scripts are loaded into the landing page a single
  // time on first open so every module keeps its full live behaviour.
  //
  // Known trade-off: main-app inline styles are copied into the landing
  // document, which can bleed onto the landing's own chrome. The
  // `html.module-view-active` hide list keeps landing chrome hidden
  // while a module is open, so the bleed is not visible during normal
  // use. When the user clicks "Back to surfaces" the host is emptied
  // and the landing chrome reappears.

  function syncModuleViewActiveClass() {
    var LANDINGS = ['logistics', 'workbench', 'compliance-ops', 'routines', 'screening-command'];
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    var first = segs.length ? segs[0].replace(/\.html$/, '') : '';
    var isSubRoute = segs.length >= 2 && LANDINGS.indexOf(first) !== -1;
    if (isSubRoute) document.documentElement.classList.add('module-view-active');
    else document.documentElement.classList.remove('module-view-active');
    var els = document.querySelectorAll('.topbar, .page-nav, #pageNav');
    for (var i = 0; i < els.length; i++) {
      if (isSubRoute) els[i].setAttribute('hidden', '');
      else els[i].removeAttribute('hidden');
    }
  }
  window.addEventListener('pageshow', syncModuleViewActiveClass);

  var view = document.getElementById('moduleView');
  var host = document.getElementById('moduleViewContent');
  var titleEl = document.getElementById('moduleViewTitle');
  var closeBtn = document.getElementById('moduleViewClose');
  if (!view || !host || !titleEl || !closeBtn) return;

  function applyImperativeHide() {
    var onSubRoute = document.documentElement.classList.contains('module-view-active');
    var els = document.querySelectorAll('.topbar, .page-nav, #pageNav');
    for (var i = 0; i < els.length; i++) {
      if (onSubRoute) els[i].setAttribute('hidden', '');
      else els[i].removeAttribute('hidden');
    }
  }

  (function injectModuleViewStyles() {
    if (document.getElementById('moduleViewActiveStyles')) return;
    var style = document.createElement('style');
    style.id = 'moduleViewActiveStyles';
    style.textContent =
      'html.module-view-active .topbar,' +
      'html.module-view-active .page-nav,' +
      'html.module-view-active .hero,' +
      'html.module-view-active .summary,' +
      'html.module-view-active .hero-summary,' +
      'html.module-view-active .section-head,' +
      'html.module-view-active .cards,' +
      'html.module-view-active .grid,' +
      'html.module-view-active .reg-strip,' +
      'html.module-view-active .reg-basis' +
      '{display:none !important;}' +
      'html.module-view-active .module-view{margin-top:0;}' +
      '.module-view-content{min-height:calc(100vh - 200px);}' +
      '.module-view-content .tab-content{display:block !important;}';
    document.head.appendChild(style);
  })();

  var LANDING_SLUGS = ['logistics', 'workbench', 'compliance-ops', 'routines', 'screening-command'];

  function getBasePath() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    if (!segs.length) return '/';
    var first = segs[0].replace(/\.html$/, '');
    if (LANDING_SLUGS.indexOf(first) !== -1) return '/' + first;
    return '/' + segs[0];
  }

  var MODULE_TARGET_SELECTOR = '.card[data-route], [data-route][data-slug]';

  function findCardBySlug(slug) {
    if (!slug) return null;
    var targets = document.querySelectorAll(MODULE_TARGET_SELECTOR);
    for (var i = 0; i < targets.length; i++) {
      var c = targets[i];
      var s = c.getAttribute('data-slug') || c.getAttribute('data-route');
      if (s === slug) return c;
    }
    return null;
  }

  function slugForCard(card) {
    return card.getAttribute('data-slug') || card.getAttribute('data-route');
  }

  function refreshPageNav() {
    if (typeof window.__renderPageNav === 'function') window.__renderPageNav();
  }

  // Scope .tab-content queries to direct children of host. Injected
  // main-app tabs may themselves contain descendant elements marked
  // .tab-content (nested mini-panels); those must not be hidden by the
  // module-switch logic below.
  function directChildrenByClass(parent, cls) {
    var out = [];
    for (var i = 0; i < parent.children.length; i++) {
      if (parent.children[i].classList.contains(cls)) out.push(parent.children[i]);
    }
    return out;
  }

  // ---- Native module injection plumbing --------------------------------

  var mainAppDocPromise = null;
  var mainAppStylesInjected = false;
  var mainAppScriptsLoadedPromise = null;

  function loadMainAppDocument() {
    if (mainAppDocPromise) return mainAppDocPromise;
    mainAppDocPromise = fetch('/index.html', { credentials: 'same-origin', cache: 'force-cache' })
      .then(function (r) { return r.text(); })
      .then(function (html) {
        return new DOMParser().parseFromString(html, 'text/html');
      });
    return mainAppDocPromise;
  }

  function injectMainAppStyles(doc) {
    if (mainAppStylesInjected) return;
    mainAppStylesInjected = true;

    // Snapshot the landing's :root palette + body background BEFORE
    // appending the main-app <style>, so computed styles still reflect
    // the landing's original values. Without this, the main-app block
    // would redeclare --orange / --border / etc. source-order after the
    // landing and the landing's own topbar, hero, and cards would pick
    // up amber/gold on close.
    var snapshot = snapshotLandingPalette();

    var styleNodes = doc.querySelectorAll('head style, body style');
    var chunks = [];
    for (var i = 0; i < styleNodes.length; i++) {
      chunks.push(styleNodes[i].textContent || '');
    }
    var injected = document.createElement('style');
    injected.id = '__mainAppInjectedStyles';
    injected.textContent = chunks.join('\n');
    document.head.appendChild(injected);

    // Append the restoration block AFTER main-app so it wins source
    // order and hands the landing chrome back its original colours.
    applyLandingPaletteRestore(snapshot);

    // Pull in any <link rel="stylesheet"> tags the main app relies on
    // (Google Fonts, CDN sheets) so the injected module resolves all
    // its typography and reset references.
    injectMainAppStylesheetLinks(doc);
  }

  // Capture every landing-palette custom property currently visible on
  // :root plus the body background. Returns a plain object snapshot.
  function snapshotLandingPalette() {
    var rs = getComputedStyle(document.documentElement);
    var keys = [
      '--orange', '--orange-bright', '--orange-dim', '--orange-border',
      '--yellow', '--yellow-bright', '--yellow-dim', '--yellow-border',
      '--green', '--green-bright', '--green-dim', '--green-border',
      '--pink', '--pink-bright',
      '--red', '--red-bright',
      '--purple', '--violet',
      '--azure', '--azure-bright', '--sky', '--ice', '--mist', '--muted',
      '--midnight', '--navy', '--navy-2',
      '--surface', '--surface-2', '--steel', '--steel-dim',
      '--border', '--border-strong',
      '--royal', '--glow',
      '--ink'
    ];
    var decls = [];
    for (var i = 0; i < keys.length; i++) {
      var v = rs.getPropertyValue(keys[i]);
      if (v && v.trim()) decls.push(keys[i] + ': ' + v.trim() + ';');
    }
    var bodyBg = '';
    try { bodyBg = getComputedStyle(document.body).backgroundColor || ''; } catch (_) {}
    return { decls: decls, bodyBg: bodyBg };
  }

  function applyLandingPaletteRestore(snapshot) {
    if (document.getElementById('__landingPaletteRestore')) return;
    if (!snapshot || !snapshot.decls) return;
    var style = document.createElement('style');
    style.id = '__landingPaletteRestore';
    var body = snapshot.bodyBg ? 'body{background:' + snapshot.bodyBg + ' !important;}' : '';
    style.textContent = ':root{' + snapshot.decls.join('') + '}' + body;
    document.head.appendChild(style);
  }

  // Copy any <link rel="stylesheet"> from the main app (fonts, CDN
  // sheets) into the landing document so the injected module content
  // resolves all its references. Called once, after main-app styles.
  function injectMainAppStylesheetLinks(doc) {
    var linkNodes = doc.querySelectorAll('link[rel="stylesheet"]');
    for (var j = 0; j < linkNodes.length; j++) {
      var href = linkNodes[j].getAttribute('href');
      if (!href) continue;
      if (document.querySelector('link[rel="stylesheet"][href="' + href.replace(/"/g, '\\"') + '"]')) continue;
      var cloneLink = document.createElement('link');
      cloneLink.rel = 'stylesheet';
      cloneLink.href = href;
      document.head.appendChild(cloneLink);
    }
  }

  function loadMainAppScripts(doc) {
    if (mainAppScriptsLoadedPromise) return mainAppScriptsLoadedPromise;
    var scriptNodes = doc.querySelectorAll('script[src]');
    var queue = [];
    for (var i = 0; i < scriptNodes.length; i++) {
      var src = scriptNodes[i].getAttribute('src');
      if (!src) continue;
      if (document.querySelector('script[src="' + src.replace(/"/g, '\\"') + '"]')) continue;
      queue.push({ src: src, deferFlag: scriptNodes[i].hasAttribute('defer') });
    }
    mainAppScriptsLoadedPromise = queue.reduce(function (chain, item) {
      return chain.then(function () {
        return new Promise(function (resolve) {
          var tag = document.createElement('script');
          tag.src = item.src;
          if (item.deferFlag) tag.defer = true;
          tag.onload = function () { resolve(); };
          tag.onerror = function () { resolve(); }; // don't block the chain on a single failure
          document.head.appendChild(tag);
        });
      });
    }, Promise.resolve());
    return mainAppScriptsLoadedPromise;
  }

  function renderHostSkeleton(message) {
    // Append a skeleton without clobbering previously-cached tab DOM,
    // so re-opening a module is instant. The skeleton is removed in
    // openModule() once ensureTabInjected() settles.
    if (host.querySelector('.mv-skeleton')) return;
    var skel = document.createElement('div');
    skel.className = 'mv-skeleton';
    skel.setAttribute('aria-busy', 'true');
    var bar1 = document.createElement('div');
    bar1.className = 'mv-skeleton-bar';
    var bar2 = document.createElement('div');
    bar2.className = 'mv-skeleton-bar';
    bar2.style.width = '62%';
    var bar3 = document.createElement('div');
    bar3.className = 'mv-skeleton-bar';
    bar3.style.width = '78%';
    var msg = document.createElement('div');
    msg.className = 'mv-skeleton-msg';
    msg.textContent = message || 'Loading module…';
    skel.appendChild(bar1);
    skel.appendChild(bar2);
    skel.appendChild(bar3);
    skel.appendChild(msg);
    host.appendChild(skel);
  }

  function injectSkeletonStyles() {
    if (document.getElementById('moduleViewSkeletonStyles')) return;
    var style = document.createElement('style');
    style.id = 'moduleViewSkeletonStyles';
    style.textContent =
      '.mv-skeleton{padding:40px;display:flex;flex-direction:column;gap:14px;}' +
      '.mv-skeleton-bar{height:12px;border-radius:6px;background:linear-gradient(90deg,rgba(255,255,255,0.05),rgba(255,255,255,0.12),rgba(255,255,255,0.05));background-size:200% 100%;animation:mvSkelShimmer 1.4s linear infinite;width:100%;}' +
      '.mv-skeleton-msg{margin-top:10px;font-family:\'DM Mono\',monospace;font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.55;}' +
      '@keyframes mvSkelShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}';
    document.head.appendChild(style);
  }
  injectSkeletonStyles();

  function activateInjectedTab(route) {
    // Hide any other injected tab-content siblings; show the one we want.
    var tabs = directChildrenByClass(host, 'tab-content');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('active');
      tabs[i].style.display = 'none';
    }
    var active = host.querySelector('#tab-' + route);
    if (active) {
      active.classList.add('active');
      active.style.display = 'block';
    }
    // Nudge any main-app initialisers that key off switchTab / hashchange
    // so metals trading, TFS refresh, etc. rehydrate their state against
    // the newly-visible DOM.
    if (typeof window.switchTab === 'function') {
      try { window.switchTab(route); } catch (err) { /* non-fatal */ }
    }
    try {
      window.dispatchEvent(new HashChangeEvent('hashchange', {
        oldURL: location.href,
        newURL: location.href
      }));
    } catch (_) { /* HashChangeEvent may not be constructable in older browsers */ }
  }

  function ensureTabInjected(route) {
    // Re-use an existing injected #tab-<route> if we've loaded it before.
    var existing = host.querySelector('#tab-' + route);
    if (existing) return Promise.resolve(existing);

    return loadMainAppDocument().then(function (doc) {
      injectMainAppStyles(doc);
      var src = doc.getElementById('tab-' + route);
      if (!src) {
        var empty = document.createElement('div');
        empty.className = 'mv-empty';
        empty.style.cssText = 'padding:40px;opacity:0.7;font-family:\'DM Mono\',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;';
        empty.textContent = 'Module not available: ' + route;
        host.appendChild(empty);
        return null;
      }
      // Import so scripts running after load can find the element by ID
      // in the main document (some legacy modules rely on that).
      var cloned = document.importNode(src, true);
      host.appendChild(cloned);
      return loadMainAppScripts(doc).then(function () { return cloned; });
    }, function (err) {
      var errBox = document.createElement('div');
      errBox.className = 'mv-empty';
      errBox.style.cssText = 'padding:40px;opacity:0.7;font-family:\'DM Mono\',monospace;font-size:11px;letter-spacing:2px;text-transform:uppercase;';
      errBox.textContent = 'Failed to load module (' + (err && err.message ? err.message : 'network error') + ')';
      host.appendChild(errBox);
      return null;
    });
  }

  function openModule(route, label, slug, pushHistory) {
    titleEl.textContent = label || 'Module';
    view.classList.add('is-open');
    view.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('module-view-active');
    applyImperativeHide();

    // Clear any stale error placeholder from a previous run; keep
    // cached .tab-content nodes so repeat opens are instant.
    var stale = host.querySelectorAll('.mv-empty');
    for (var s = 0; s < stale.length; s++) stale[s].remove();

    var cached = host.querySelector('#tab-' + route);
    if (!cached) {
      renderHostSkeleton(label ? 'Loading ' + label + '…' : 'Loading module…');
    }

    if (pushHistory !== false && slug) {
      var target = getBasePath() + '/' + slug;
      if (location.pathname !== target) {
        history.pushState({ slug: slug, route: route, label: label }, '', target);
      }
    }
    refreshPageNav();

    ensureTabInjected(route).then(function (tabEl) {
      var skels = host.querySelectorAll('.mv-skeleton');
      for (var i = 0; i < skels.length; i++) skels[i].remove();
      if (!tabEl) return;
      activateInjectedTab(route);
    });

    requestAnimationFrame(function () {
      view.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function closeModule(pushHistory) {
    view.classList.remove('is-open');
    view.setAttribute('aria-hidden', 'true');
    document.documentElement.classList.remove('module-view-active');
    applyImperativeHide();
    // Leave the injected tabs in the DOM (display:none) so re-opening is
    // instant, but hide the host itself via the `.is-open` class flip.
    var tabs = directChildrenByClass(host, 'tab-content');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.remove('active');
      tabs[i].style.display = 'none';
    }
    if (pushHistory !== false) {
      var base = getBasePath();
      if (location.pathname !== base) {
        history.pushState({}, '', base);
      }
    }
    refreshPageNav();
  }

  function openSlug(slug, pushHistory) {
    var card = findCardBySlug(slug);
    if (!card) return false;
    var route = card.getAttribute('data-route');
    var labelEl = card.querySelector && card.querySelector('.card-title');
    var label = 'Module';
    if (labelEl && labelEl.textContent) label = labelEl.textContent.trim();
    else if (card.textContent) label = card.textContent.trim();
    openModule(route, label, slug, pushHistory);
    return true;
  }

  document.addEventListener(
    'click',
    function (event) {
      if (!event.target || !event.target.closest) return;
      var target = event.target.closest(MODULE_TARGET_SELECTOR);
      if (!target) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1) return;
      event.preventDefault();
      event.stopPropagation();
      openSlug(slugForCard(target), true);
    },
    true
  );

  closeBtn.addEventListener('click', function () { closeModule(true); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && view.classList.contains('is-open')) {
      closeModule(true);
    }
  });

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

  (function initialDeepLink() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    if (segs.length < 2) return;
    var first = segs[0].replace(/\.html$/, '');
    if (LANDING_SLUGS.indexOf(first) === -1) return;
    openSlug(segs[1], false);
  })();

  applyImperativeHide();
})();
