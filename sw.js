// ─── SERVICE WORKER ──────────────────────────────────────────────────
// Для обновления PWA на iOS: поменяй дату в V перед каждым деплоем.
// iOS сравнивает байты sw.js — любое изменение = новая установка = сброс кеша.

const V = '2026-04-16 21:50';
const CACHE = 'app-' + V;

// Файлы для предзагрузки
const PRECACHE = [
  './',
  './css/app.css',
  './apps-script/Code.gs'
];

// INSTALL: кешируем ресурсы и сразу переходим в активный режим (без ожидания)
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()) // ← не ждём закрытия старых вкладок
  );
});

// ACTIVATE: удаляем все старые кеши и захватываем управление
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // ← контролируем уже открытые вкладки
  );
});

// FETCH: для HTML — network-first (всегда тянем свежий), для остального — cache-first
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  // Внешние запросы (Apps Script, CDN) — только сеть, без кеша
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (e.request.mode === 'navigate') {
    // HTML — сеть, при ошибке — кеш
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const clone = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Остальные ресурсы — кеш, если нет — сеть
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
  }
});
