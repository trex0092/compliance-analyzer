// Bumped to v4 to evict the v3 cache which opportunistically cached
// HTML documents (login.html, index.html, the landing pages). On a
// flaky network, v3 served a stale login.html whose inline-script
// sha256 did NOT match the current netlify.toml CSP allowlist — the
// browser would CSP-block the inline script and the sign-in button
// would silently do nothing. This was the "sometimes I have trouble
// logging in" class of bug. v4 never caches HTML, so the sign-in
// surface is always served fresh from the network.
//
// Regulatory: FDL No.(10)/2025 Art.20-21 — the MLRO sign-in surface
// must reflect the current deployed auth flow. A stale cached HTML
// document from a previous deploy is never a valid response.
const CACHE_NAME = 'hawkeye-sterling-v4';
const STATIC_ASSETS = [
  '/manifest.json',
];

function isHtmlDocument(url) {
  // Any request whose path is "/", ends in ".html", or matches one of
  // the clean-URL or wildcard redirects declared in netlify.toml is an
  // HTML document. Never cache these — the CSP / inline-script hashes
  // drift every deploy and any stale body will break the sign-in
  // surface or the rewritten module page.
  if (url.pathname === '/' || url.pathname.endsWith('.html')) return true;
  // Exact clean-URL redirects (netlify.toml [[redirects]] from = "/foo")
  switch (url.pathname) {
    case '/login':
    case '/workbench':
    case '/logistics':
    case '/routines':
    case '/compliance-ops':
    case '/screening-command':
    case '/integrations':
    case '/trading':
      return true;
  }
  // Wildcard rewrites: /workbench/*, /logistics/*, /routines/*,
  // /compliance-ops/*, /screening-command/* all rewrite to HTML.
  // Deep links like /workbench/alerts must also bypass the cache.
  if (
    url.pathname.startsWith('/workbench/') ||
    url.pathname.startsWith('/logistics/') ||
    url.pathname.startsWith('/routines/') ||
    url.pathname.startsWith('/compliance-ops/') ||
    url.pathname.startsWith('/screening-command/')
  ) {
    return true;
  }
  return false;
}

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    // First: delete every cache whose name isn't the current version.
    caches.keys().then(function(names) {
      return Promise.all(
        names
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      // Second: inside the current cache, purge any leftover HTML
      // entries that a previous version may have stored. Belt and
      // braces — existing users who were stuck on a stale login.html
      // recover on the first navigation after sw.js v4 activates.
      return caches.open(CACHE_NAME).then(function(cache) {
        return cache.keys().then(function(reqs) {
          return Promise.all(reqs.map(function(req) {
            try {
              if (isHtmlDocument(new URL(req.url))) return cache.delete(req);
            } catch (_) { /* malformed URL — leave it */ }
            return Promise.resolve();
          }));
        });
      });
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  // Skip non-GET and API requests
  if (event.request.method !== 'GET') return;
  var url;
  try { url = new URL(event.request.url); } catch (_) { return; }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  // HTML: always network. No cache read, no cache write. If the network
  // fails, return a clean Offline response rather than a stale login
  // page that the browser's CSP will then reject.
  if (isHtmlDocument(url)) {
    event.respondWith(
      fetch(event.request).catch(function() {
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      })
    );
    return;
  }

  // Non-HTML same-origin assets: network-first with cache-on-success
  // and cache fallback when offline (existing v3 behaviour, preserved
  // for fonts, images, static JS files that don't drive auth).
  event.respondWith(
    fetch(event.request).then(function(response) {
      if (response.ok && url.origin === self.location.origin) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      return caches.match(event.request).then(function(cached) {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});
