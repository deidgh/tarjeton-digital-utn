/* Solo almacena recursos públicos del mismo origen. */
const CACHE = 'tarjeton-utn-shell-v5';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './config.js', './vendor/qr.js',
  './vendor/dependencies.js', './manifest.webmanifest', './assets/logo-small.png',
  './assets/logo-utn.png', './assets/icon-192.png', './assets/icon-512.png',
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('tarjeton-utn-shell-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const {request} = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./index.html')));
    return;
  }
  if (!SHELL.some(path => new URL(path, self.registration.scope).href === url.href)) return;
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
