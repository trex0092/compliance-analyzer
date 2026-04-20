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

  var LANDING_SLUGS = ['logistics', 'workbench', 'compliance-ops', 'routines', 'screening-command'];

  function syncModuleViewActiveClass() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    var first = segs.length ? segs[0].replace(/\.html$/, '') : '';
    var isSubRoute = segs.length >= 2 && LANDING_SLUGS.indexOf(first) !== -1;
    if (isSubRoute) document.documentElement.classList.add('module-view-active');
    else document.documentElement.classList.remove('module-view-active');
    var els = document.querySelectorAll('.topbar');
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
    var els = document.querySelectorAll('.topbar');
    for (var i = 0; i < els.length; i++) {
      if (onSubRoute) els[i].setAttribute('hidden', '');
      else els[i].removeAttribute('hidden');
    }
  }

  (function injectModuleViewStyles() {
    if (document.getElementById('moduleViewActiveStyles')) return;
    var style = document.createElement('style');
    style.id = 'moduleViewActiveStyles';
    // Use a single template string so we can keep the defensive
    // display rules readable. Only the :not(.active) / .active pair
    // at the end is load-bearing for the tab-switch regression the
    // user hit — every other rule is landing-chrome housekeeping.
    style.textContent = [
      'html.module-view-active .topbar,',
      'html.module-view-active .hero,',
      'html.module-view-active .summary,',
      'html.module-view-active .hero-summary,',
      'html.module-view-active .section-head,',
      'html.module-view-active .cards,',
      'html.module-view-active .grid,',
      'html.module-view-active .reg-strip,',
      'html.module-view-active .reg-basis',
      '{display:none !important;}',
      'html.module-view-active .module-view{margin-top:0;}',
      '.module-view-content{min-height:calc(100vh - 200px);}',
      /* Single-tab-visible guarantee. The main-app CSS relies on
         .tab-content / .tab-content.active, but after CSSOM scoping
         a subtle specificity flip was leaving multiple injected tabs
         display:block at once (user reported Asana + Onboarding
         stacked on every workbench sub-route). Force-hide every
         direct-child .tab-content that lacks .active, and force the
         one with .active to render. This wins over inline styles
         set by anywhere-else via !important and is scoped to our
         host so nothing else on the page is affected. */
      '#moduleViewContent > .tab-content:not(.active){display:none !important;}',
      '#moduleViewContent > .tab-content.active{display:block !important;}'
    ].join('');
    document.head.appendChild(style);
  })();

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

    // Snapshot the landing's :root palette + body/color/font BEFORE
    // appending any main-app CSS, so the restoration block can hand
    // the landing chrome back its own look on "Back to surfaces".
    var snapshot = snapshotLandingPalette();

    var styleNodes = doc.querySelectorAll('head style, body style');
    var chunks = [];
    for (var i = 0; i < styleNodes.length; i++) {
      chunks.push(styleNodes[i].textContent || '');
    }
    var rawCss = chunks.join('\n');

    // Scope every main-app style rule to #moduleViewContent so the
    // injected tab DOM inherits all main-app chrome styling (.card,
    // .tab-content, buttons, forms, etc.) but those rules cannot
    // bleed onto the landing's own .card / .footer / .topbar. Keeps
    // @keyframes / @font-face / @import / @charset global (they don't
    // match elements by selector). Keeps html / body / :root
    // unprefixed so their globals flow and are handled by the palette
    // restore block below. Falls back to the unscoped CSS if the
    // CSSOM parser rejects the document (dev / broken browsers).
    var scoped = scopeCssToHost(rawCss, '#moduleViewContent') || rawCss;

    var injected = document.createElement('style');
    injected.id = '__mainAppInjectedStyles';
    injected.textContent = scoped;
    document.head.appendChild(injected);

    // Append the restoration block AFTER main-app so it wins source
    // order and hands the landing chrome back its original colours,
    // text colour, and font-family.
    applyLandingPaletteRestore(snapshot);

    // Pull in any <link rel="stylesheet"> tags the main app relies on
    // (Google Fonts, CDN sheets) so the injected module resolves all
    // its typography and reset references.
    injectMainAppStylesheetLinks(doc);
  }

  // Parse rawCss via the browser's CSSOM, rewriting each style-rule
  // selector so it only matches elements inside `hostSelector`. Media
  // / supports / layer / keyframes / font-face / import rules are
  // preserved. :root, html, body, * stay global — the palette-restore
  // block runs after this and reclaims them for the landing.
  function scopeCssToHost(rawCss, hostSelector) {
    try {
      var tmp = document.createElement('style');
      tmp.textContent = rawCss;
      tmp.media = 'not all'; // parse without applying styles
      document.head.appendChild(tmp);
      var sheet = tmp.sheet;
      if (!sheet) {
        document.head.removeChild(tmp);
        return null;
      }
      var out = [];
      for (var i = 0; i < sheet.cssRules.length; i++) {
        out.push(transformCssRule(sheet.cssRules[i], hostSelector));
      }
      document.head.removeChild(tmp);
      return out.filter(Boolean).join('\n');
    } catch (_) {
      return null;
    }
  }

  var GLOBAL_SELECTORS = { ':root': 1, 'html': 1, 'body': 1, '*': 1 };

  function transformCssRule(rule, host) {
    if (!rule) return '';
    // CSSStyleRule -> prefix selectors
    if (rule.selectorText != null && rule.style) {
      var parts = rule.selectorText.split(',');
      var prefixed = [];
      for (var i = 0; i < parts.length; i++) {
        var sel = parts[i].trim();
        if (!sel) continue;
        if (GLOBAL_SELECTORS[sel] || sel.indexOf(host) === 0) {
          prefixed.push(sel);
        } else {
          prefixed.push(host + ' ' + sel);
        }
      }
      return prefixed.join(', ') + '{' + rule.style.cssText + '}';
    }
    // @media / @supports / @layer with nested rules
    if (rule.cssRules && rule.conditionText != null) {
      var kind = '@media';
      if (/CSSSupportsRule/.test(Object.prototype.toString.call(rule)) || rule.constructor.name === 'CSSSupportsRule') {
        kind = '@supports';
      }
      var inner = [];
      for (var j = 0; j < rule.cssRules.length; j++) {
        inner.push(transformCssRule(rule.cssRules[j], host));
      }
      return kind + ' ' + rule.conditionText + '{' + inner.filter(Boolean).join('\n') + '}';
    }
    // @layer with a body (anonymous or named) — preserve as-is
    // @keyframes / @font-face / @import / @charset / @page — global
    return rule.cssText || '';
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
    var bodyBg = '', bodyColor = '', bodyFont = '';
    try {
      var bs = getComputedStyle(document.body);
      bodyBg = bs.backgroundColor || '';
      bodyColor = bs.color || '';
      bodyFont = bs.fontFamily || '';
    } catch (_) {}
    return { decls: decls, bodyBg: bodyBg, bodyColor: bodyColor, bodyFont: bodyFont };
  }

  function applyLandingPaletteRestore(snapshot) {
    if (document.getElementById('__landingPaletteRestore')) return;
    if (!snapshot || !snapshot.decls) return;
    var style = document.createElement('style');
    style.id = '__landingPaletteRestore';
    var bodyRule = '';
    if (snapshot.bodyBg || snapshot.bodyColor || snapshot.bodyFont) {
      bodyRule = 'body{' +
        (snapshot.bodyBg ? 'background:' + snapshot.bodyBg + ' !important;' : '') +
        (snapshot.bodyColor ? 'color:' + snapshot.bodyColor + ' !important;' : '') +
        (snapshot.bodyFont ? 'font-family:' + snapshot.bodyFont + ' !important;' : '') +
        '}';
    }
    style.textContent = ':root{' + snapshot.decls.join('') + '}' + bodyRule;
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

  // Determine which landing this viewer instance is running on so we
  // can look up its registered native module renderers.
  function getCurrentLandingKey() {
    var segs = (location.pathname || '/').split('/').filter(Boolean);
    if (!segs.length) return '';
    return segs[0].replace(/\.html$/, '');
  }

  function lookupNativeRenderer(route, slug) {
    var registry = window.__landingModules || {};
    var bucket = registry[getCurrentLandingKey()] || {};
    return bucket[slug] || bucket[route] || null;
  }

  function openModule(route, label, slug, pushHistory) {
    titleEl.textContent = label || 'Module';
    view.classList.add('is-open');
    view.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('module-view-active');
    applyImperativeHide();

    // Clear any stale error placeholder or cached injected tabs from
    // previous renders so the host starts from a clean slate per open.
    host.innerHTML = '';

    if (pushHistory !== false && slug) {
      var target = getBasePath() + '/' + slug;
      if (location.pathname !== target) {
        history.pushState({ slug: slug, route: route, label: label }, '', target);
      }
    }

    // Prefer a native renderer when one is registered for this
    // landing+route. Native renderers write straight into the host
    // using the landing's own components — no main-app chrome, no
    // iframe, no script graft. Instantaneous render.
    var nativeRenderer = lookupNativeRenderer(route, slug);
    if (typeof nativeRenderer === 'function') {
      try {
        nativeRenderer(host, { route: route, slug: slug, label: label });
      } catch (err) {
        host.innerHTML =
          '<div class="mv-empty" style="padding:40px;">' +
          'Module failed to render: ' + (err && err.message ? err.message : String(err)) +
          '</div>';
      }
      requestAnimationFrame(function () {
        view.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }

    // Fallback: legacy fetch+inject of index.html's tab DOM. Kept as a
    // safety net for any route we haven't migrated to a native module
    // yet. First click here has the usual multi-second script load.
    renderHostSkeleton(label ? 'Loading ' + label + '…' : 'Loading module…');
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
