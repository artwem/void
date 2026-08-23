// ─── SERVICE WORKER ──────────────────────────────────────────────────
// Для обновления PWA на iOS: поменяй дату в V перед каждым деплоем.
// iOS сравнивает байты sw.js — любое изменение = новая установка = сброс кеша.

const V = '2026-08-23 v1.64.0';
const CACHE = 'app-' + V;

// Файлы для предзагрузки
const PRECACHE = [
  './',
  './css/app.css',
  './apps-script/Code.gs',
  './vendor/chart.umd.js',
  './vendor/xlsx.style.min.js',
  './vendor/golos-text.woff2',
  './vendor/jetbrains-digits.woff2'
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
          if (r.ok) { // не кешируем ошибки (404/500), иначе залипнут
            const clone = r.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return r;
        })
        // ignoreSearch: URL с query (?source=pwa и т.п.) должен находить закешированный './'
        .catch(() => caches.match(e.request, { ignoreSearch: true })
          .then(r => r || caches.match('./')))
    );
  } else {
    // Остальные ресурсы — кеш, если нет — сеть.
    // Второй match с ignoreSearch: app.css?v=X после деплоя должен находить
    // precache-копию без query (до первого онлайн-фетча runtime-копии с query)
    e.respondWith(
      caches.match(e.request).then(r =>
        r || caches.match(e.request, { ignoreSearch: true }).then(r2 =>
          r2 || fetch(e.request).then(res => {
            if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
            return res;
          })
        )
      )
    );
  }
});
