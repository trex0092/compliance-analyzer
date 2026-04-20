// Kill-switch service worker (v4).
//
// The previous sw.js cached every GET and served cached copies on
// fetch failure — which, combined with Netlify CDN edge delays and
// aggressive browser caching, caused the "old cached JS" problem the
// MLRO kept hitting after deploys.
//
// v4 reverses the posture:
//   1. On install → skipWaiting immediately.
//   2. On activate → delete every cache keyed under any other name
//      (evicts every entry written by v1/v2/v3) then claim every
//      open client so the next fetch goes through this SW.
//   3. On fetch → NETWORK-FIRST with no cache writes. The SW becomes
//      a pure pass-through + kill-switch. The browser + Netlify edge
//      remain the authoritative cache; our `?v=N` query-string on JS
//      and CSS is now the ONLY cache-bust knob.
//   4. On message { type: 'hawkeye:unregister-sw' } → the SW
//      unregisters itself and posts the outcome back to every client
//      so a page-level version-check can force a full eviction on
//      version mismatch.
//
// Regulatory: FDL No.(10)/2025 Art.20-21 (MLRO surfaces must reflect
// the deployed auth + compliance flow — no stale surfaces).
const CACHE_NAME = 'hawkeye-sterling-v4-killswitch';

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) { return caches.delete(n); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  // Pure pass-through. No cache writes. Browser + Netlify CDN own
  // caching now — our `?v=N` query strings drive every cache bust.
  // Non-GET + API + functions skipped entirely (fetch handler
  // returns, browser uses default network stack).
  if (event.request.method !== 'GET') return;
  var url;
  try { url = new URL(event.request.url); } catch (_e) { return; }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;
  // Explicitly do nothing — let the request fall through to the
  // browser's default network path. This is the kill-switch posture.
});

self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'hawkeye:unregister-sw') return;
  // Unregister on command; reply to every open client so each can
  // force a hard reload if it was waiting on the response.
  self.registration.unregister().then(function () {
    return self.clients.matchAll({ includeUncontrolled: true });
  }).then(function (clients) {
    clients.forEach(function (c) {
      try { c.postMessage({ type: 'hawkeye:sw-unregistered', ok: true }); } catch (_e) {}
    });
  });
});
