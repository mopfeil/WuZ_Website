/* Service Worker – macht die App nach dem ersten Laden offline-fähig.
   WICHTIG: Bei jeder Änderung an den App-Dateien CACHE_VERSION erhöhen (deploy.sh erledigt das).
   Anfragen an api/ gehen immer ins Netz. */

const CACHE_VERSION = 'kerntransformation-21a92bad';

const ASSETS = [
  './',
  './index.html',
  './style.css',
  './process.js',
  './app.js',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
