// Bumped to v3 to evict any legacy cache that served the pre-JWT
// "FIRST-TIME SETUP" wizard. The activate handler deletes every cache
// whose name does not equal CACHE_NAME, so pinning a new version here
// is the only guaranteed way to drop stale entries on next activation.
// Regulatory: FDL No.(10)/2025 Art.20-21 (the MLRO sign-in surface
// must reflect the current deployed auth flow — no stale surfaces).
const CACHE_NAME = 'hawkeye-sterling-v3';
const STATIC_ASSETS = [
  '/manifest.json',
];

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
    caches.keys().then(function(names) {
      return Promise.all(
        names
          .filter(function(name) { return name !== CACHE_NAME; })
          .map(function(name) { return caches.delete(name); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(event) {
  // Skip non-GET and API requests
  if (event.request.method !== 'GET') return;
  var url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

  event.respondWith(
    fetch(event.request).then(function(response) {
      // Cache successful responses for static assets
      if (response.ok && url.origin === self.location.origin) {
        var clone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, clone);
        });
      }
      return response;
    }).catch(function() {
      // Serve from cache when offline
      return caches.match(event.request).then(function(cached) {
        return cached || new Response('Offline', { status: 503 });
      });
    })
  );
});
