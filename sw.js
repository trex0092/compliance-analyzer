// Service Worker for Compliance Analyzer — offline caching
const CACHE_NAME = 'compliance-v2.6';
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/compliance-suite.js',
  '/database.js',
  '/report-generator.js',
  '/regulatory-monitor.js',
  '/integrations-enhanced.js',
  '/webhook-receiver.js',
  '/mobile-responsive.js',
  '/goaml-export.js',
  '/threshold-monitor.js',
  '/supply-chain.js',
  '/tfs-refresh.js',
  '/analytics-dashboard.js',
  '/workflow-engine.js',
  '/management-approvals.js',
  '/vault-encryption.js'
];

const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js'
];

// Install: cache all core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CORE_ASSETS).catch(err => {
        console.warn('[SW] Some core assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for HTML/JS, cache-first for CDN
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and API calls
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api') || url.hostname === 'api.anthropic.com') return;

  // CDN assets: cache-first (they're versioned)
  if (CDN_ASSETS.some(cdn => event.request.url.startsWith(cdn.split('?')[0]))) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          if (resp.ok) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          }
          return resp;
        }).catch(() => new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Core assets: network-first with cache fallback
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request).then(resp => {
        if (resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return resp;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
});
