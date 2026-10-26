// Service worker: abre o app sem sinal e guarda os mapas já vistos.
const VERSAO = 'fp-v3';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/app.css', './data/cnae.json',
  './js/main.js', './js/store.js', './js/seed.js', './js/ui.js', './js/geo.js', './js/score.js', './js/map.js',
  './js/admin.js', './js/field.js', './js/fotos.js', './js/dominio.js', './js/marca.js', './js/moci.js', './js/link.js',
  './icons/icon-192.png', './icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];
const TILES = `${VERSAO}-mapas`;
const MAX_TILES = 1500;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => !k.startsWith(VERSAO)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function limitar(nome, max) {
  const c = await caches.open(nome);
  const ks = await c.keys();
  for (let i = 0; i < ks.length - max; i++) await c.delete(ks[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Mapas do OpenStreetMap: só os que você já viu ficam guardados.
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    e.respondWith(caches.open(TILES).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      try {
        const r = await fetch(req);
        if (r.ok) { c.put(req, r.clone()); limitar(TILES, MAX_TILES); }
        return r;
      } catch { return new Response('', { status: 504 }); }
    }));
    return;
  }

  // Busca de endereço e consulta do MOCI: sempre na rede, nunca do cache.
  if (url.hostname.includes('nominatim') || url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  // Fontes e bibliotecas: cache primeiro.
  if (url.origin !== self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok || r.type === 'opaque') caches.open(VERSAO).then((c) => c.put(req, r.clone()));
      return r;
    }).catch(() => Response.error())));
    return;
  }

  // Arquivos do app: rede primeiro (pega atualizações), cache se estiver sem sinal.
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(VERSAO).then((c) => c.put(req, cp)); }
    return r;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
