const CACHE_NAME = 'compliance-analyzer-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
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
