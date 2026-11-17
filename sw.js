// Service worker: guarda o app e a IA no aparelho para funcionar sem internet.
// Ao publicar uma nova versão, aumente VERSAO para os aparelhos baixarem a atualização.
const VERSAO = '1.0.0';
const CACHE = `inspetor-solda-${VERSAO}`;

const ARQUIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/camera.js',
  './js/imaging.js',
  './js/model.js',
  './js/norma.js',
  './js/store.js',
  './js/tab-inspecionar.js',
  './js/tab-modelo.js',
  './js/tab-treinar.js',
  './js/transfer.js',
  './js/ui.js',
  './vendor/tf.min.js',
  './norma/aws-d1.1.json',
  './models/bases.json',
  './models/base-geral/model.json',
  './models/base-geral/pesos1.bin',
  './models/base-geral/pesos2.bin',
  './models/base-geral/pesos3.bin',
  './models/base-geral/pesos4.bin',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nome of await caches.keys()) {
      if (nome.startsWith('inspetor-solda-') && nome !== CACHE) await caches.delete(nome);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'pular-espera') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // HEAD (usado para saber se uma base existe): responde pelo cache quando possível.
  if (req.method === 'HEAD') {
    e.respondWith((async () => {
      const c = await caches.match(req.url, { ignoreSearch: true });
      if (c) return new Response(null, { status: 200, headers: c.headers });
      try { return await fetch(req); } catch { return new Response(null, { status: 404 }); }
    })());
    return;
  }
  if (req.method !== 'GET') return;

  // bases.json: tenta a rede primeiro (para descobrir bases novas), cai no cache se offline.
  if (url.pathname.endsWith('/models/bases.json')) {
    e.respondWith(fetch(req).then((r) => {
      const copia = r.clone();
      caches.open(CACHE).then((c) => c.put(req, copia));
      return r;
    }).catch(() => caches.match(req)));
    return;
  }

  // Demais arquivos: cache primeiro; o que vier da rede é guardado (ex.: base de solda).
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const salvo = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (salvo) return salvo;
    try {
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
      throw err;
    }
  })());
});
