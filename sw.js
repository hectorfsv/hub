// The HUB's offline copy: the page and its fonts open even before the Wi-Fi is back (a power cut brings the tablet up
// first). The page comes from the network when it answers within 4 s, so a push shows on the next load; the fonts come
// from the cache. The weather, the Pit's notebook and the service checks always go to the network: the page keeps its
// own last copy of what it read.
const V = 'hub-v1';
const SHELL = ['./', 'fonts/bebas-neue-400.woff2', 'fonts/chakra-petch-500.woff2', 'fonts/chakra-petch-600.woff2', 'fonts/ibm-plex-mono-500.woff2'];

self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  if (r.mode === 'navigate' || u.pathname.endsWith('/the-pit/config.js')) { e.respondWith(fresh(r)); return; }
  if (u.pathname.includes('/hub/fonts/')) e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(V).then(c => c.put(r, copy)); }
    return res;
  })));
});

async function fresh(r) {
  const c = await caches.open(V), key = r.mode === 'navigate' ? './' : r;
  try {
    const res = await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error('slow')), 4000);
      fetch(r).then(v => { clearTimeout(t); ok(v); }, x => { clearTimeout(t); no(x); });
    });
    if (res.ok) await c.put(key, res.clone());
    return res;
  } catch (e) {
    return (await c.match(key, { ignoreSearch: true })) || Response.error();
  }
}
