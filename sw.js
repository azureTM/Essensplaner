/* Offline-Start: Zuerst wird immer die neueste Version aus dem Netz geholt.
   Nur ohne Verbindung kommt die zuletzt gespeicherte Kopie zum Einsatz.
   Daten von Supabase laufen nicht über diesen Zwischenspeicher. */
const CACHE = 'essensplan-v4';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/vendor/supabase.js', 'js/config.js', 'js/cloud.js', 'js/planner.js', 'js/data.js', 'js/app.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(u => new Request(u, { cache: 'no-cache' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    // no-cache: beim Server nachfragen, ob es eine neue Version gibt, statt alte Dateien aus dem Browser-Cache zu nehmen.
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === 'navigate' ? caches.match('./') : undefined))
        .then(hit => hit || new Response('Offline', { status: 503 }))),
  );
});
