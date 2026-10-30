// node test/remote-mock.mjs [port]   A stand-in for the Fire TV Stick's remote server (Hubs' ":watch" process, port 8790), built
// from the contract research/fire-stick-remote-spec-20261029.md: the same routes, the same answers, the same key check. It serves
// remote.html and the fonts from this folder (the stick proxies them from GitHub Pages), records every call, and has hooks for
// the tests: the app in front (pushed over the event stream), the adb state (ok / asking / off), going offline (refused or
// silent) and slow answers. Nothing here touches a real device. Alone, it prints a link with its test key; drive it with curl:
//   curl -X POST localhost:8790/__mock/front -d '{"pkg":"com.amazon.avod","name":"Prime Video"}'   ("hub":true = the HUB)
//   curl -X POST localhost:8790/__mock/adb -d '{"adb":"asking"}'
//   curl -X POST localhost:8790/__mock/offline -d '{"mode":"refuse"}'        ("hang", or false to come back)
//   curl localhost:8790/__mock/calls
// In a test: import { startMock } from './remote-mock.mjs'; const m = await startMock(); ... m.setFront({...}); m.close();
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
export const TOKEN = '6f1c2a9e8d7b4c3a5e0f9d8c7b6a5e4d';     // a fixed test key (32 hex), never a real one
export const KEYS = ['up', 'down', 'left', 'right', 'select', 'back', 'home', 'menu', 'playpause', 'rewind', 'forward', 'volup', 'voldown', 'mute', 'sleep', 'wake', 'enter', 'del', 'search'];
const TYPES = { '.html': 'text/html; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.json': 'application/json', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
const HUB = { pkg: 'com.hectorfsv.hubs', name: 'Hubs', hub: true };

// ---- small app icons, drawn here (48 px PNG, 4x4 samples a pixel): no files, no libraries ----
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, paint) {   // paint(x, y) with x, y in 0..1 -> [r, g, b, a]
  const row = size * 4 + 1, raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const c = paint((x + (sx + .5) / 4) / size, (y + (sy + .5) / 4) / size);
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    const o = y * row + 1 + x * 4;
    raw[o] = a ? Math.round(r / a) : 0; raw[o + 1] = a ? Math.round(g / a) : 0; raw[o + 2] = a ? Math.round(b / a) : 0; raw[o + 3] = Math.round(a / 16);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), 255];
const circ = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (x, y, cx, cy, r, w) => { const d = Math.hypot(x - cx, y - cy); return d <= r + w / 2 && d >= r - w / 2; };
const rect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const seg = (x, y, ax, ay, bx, by, w) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - ax - t * dx, y - ay - t * dy) <= w / 2; };
const tri = (x, y, a, b, c) => {
  const s = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]), P = [x, y], d1 = s(P, a, b), d2 = s(P, b, c), d3 = s(P, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};
const rrect = (x, y, x0, y0, x1, y1, r) => rect(x, y, x0, y0, x1, y1) && (x - Math.min(Math.max(x, x0 + r), x1 - r)) ** 2 + (y - Math.min(Math.max(y, y0 + r), y1 - r)) ** 2 <= r * r;
const icon = (bg, fg, inside) => png(48, (x, y) => inside(x, y) ? hex(fg) : hex(bg));
// a few fake apps, in the order a ring would list them
export const APPS = [
  { pkg: 'com.netflix.ninja', name: 'Netflix', icon: icon('#000000', '#E50914', (x, y) => rect(x, y, .3, .18, .42, .82) || rect(x, y, .58, .18, .7, .82) || seg(x, y, .36, .2, .64, .8, .13)) },
  { pkg: 'com.amazon.avod', name: 'Prime Video', icon: icon('#0F171E', '#1A98FF', (x, y) => tri(x, y, [.38, .26], [.38, .6], [.67, .43]) || (ring(x, y, .5, .36, .32, .05) && y > .58)) },
  { pkg: 'com.amazon.firetv.youtube', name: 'YouTube', icon: png(48, (x, y) => tri(x, y, [.43, .38], [.43, .62], [.63, .5]) ? hex('#FFFFFF') : rrect(x, y, .15, .27, .85, .73, .12) ? hex('#FF0000') : hex('#212121')) },
  { pkg: 'com.disney.disneyplus', name: 'Disney+', icon: icon('#0B2A6B', '#FFFFFF', (x, y) => (ring(x, y, .48, .64, .3, .045) && y < .64) || rect(x, y, .72, .28, .84, .31) || rect(x, y, .765, .235, .795, .355)) },
  { pkg: 'com.plexapp.android', name: 'Plex', icon: icon('#282A2D', '#E5A00D', (x, y) => seg(x, y, .4, .24, .62, .5, .13) || seg(x, y, .62, .5, .4, .76, .13)) },
  { pkg: 'com.wbd.stream', name: 'Max', icon: icon('#002BE7', '#FFFFFF', (x, y) => ring(x, y, .5, .5, .2, .08)) },
  { pkg: 'com.hulu.plus', name: 'Hulu', icon: icon('#1CE783', '#0B0C0F', (x, y) => rect(x, y, .3, .24, .38, .76) || rect(x, y, .38, .44, .62, .52) || rect(x, y, .54, .44, .62, .76)) },
  { pkg: 'com.tubitv', name: 'Tubi', icon: icon('#7408FF', '#FFFF13', (x, y) => circ(x, y, .5, .5, .19)) },
  { pkg: 'tv.pluto.android', name: 'Pluto TV', icon: icon('#000000', '#FFF200', (x, y) => (rrect(x, y, .24, .24, .76, .76, .1) && !rrect(x, y, .33, .33, .67, .67, .05)) || circ(x, y, .5, .5, .07)) },
];

export async function startMock({ port = 0, host = '127.0.0.1', token = TOKEN, pingMs = 20000, quiet = true } = {}) {
  const FRONT0 = { pkg: 'com.netflix.ninja', name: 'Netflix', hub: false };
  const VOL0 = { l: 15, max: 15, mute: false, ok: true };
  const st = { v: '2.10', front: { ...FRONT0 }, adb: 'ok', awake: true, vol: { ...VOL0 } };
  const calls = [], streams = new Set(), sockets = new Set(), held = [];
  let offline = false, delay = 0;              // offline: false | 'refuse' (connections cut) | 'hang' (never answers)
  const log = (...a) => { if (!quiet) console.log(...a); };
  const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
  const empty = (res, code) => { res.writeHead(code, { 'Cache-Control': 'no-store', 'Content-Length': 0 }); res.end(); };
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  function push() { const m = `event: state\ndata: ${JSON.stringify(st)}\n\n`; for (const s of streams) if (!s.silent) s.res.write(m); }
  function file(res, f) {
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f)) return empty(res, 404);
    const b = fs.readFileSync(f);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Content-Length': b.length, 'Cache-Control': f.endsWith('.html') ? 'no-store' : 'max-age=60' });
    res.end(b);
  }
  function readBody(req) {
    return new Promise(ok => {
      const parts = []; let n = 0, over = false;
      req.on('data', c => { n += c.length; if (n > 4096) over = true; else parts.push(c); });
      req.on('end', () => ok(over ? null : Buffer.concat(parts).toString('utf8')));
      req.on('error', () => ok(null));
    });
  }
  function events(req, res, rec) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.socket.setNoDelay(true);
    const s = { res, silent: false, ping: 0 };
    streams.add(s);
    if (streams.size > 4) { const old = streams.values().next().value; streams.delete(old); clearInterval(old.ping); old.res.end(); }   // a fifth closes the oldest
    res.write(`event: state\ndata: ${JSON.stringify(st)}\n\n`);
    s.ping = setInterval(() => { if (!s.silent) res.write(': ping\n\n'); }, pingMs);
    const done = () => { clearInterval(s.ping); streams.delete(s); };
    req.on('close', done); res.on('close', done);
    rec.status = 200; rec.delivered = true;
  }
  async function api(req, res, u, rec) {
    const who = req.headers['x-hubs-key'] != null ? 'header' : u.searchParams.has('k') ? 'query' : 'none';
    const key = who === 'header' ? req.headers['x-hubs-key'] : who === 'query' ? u.searchParams.get('k') : '';
    rec.auth = who;
    let raw = '';
    if (req.method === 'POST') {
      if (+req.headers['content-length'] > 4096) { rec.status = 413; return json(res, 413, { error: 'size' }); }
      raw = await readBody(req);
      if (raw === null) { rec.status = 413; return json(res, 413, { error: 'size' }); }
      try { rec.body = raw ? JSON.parse(raw) : null; } catch (e) { rec.body = raw; }
    }
    if (!same(key, token)) { rec.status = 401; return json(res, 401, { error: 'key' }); }
    if (delay && req.method === 'POST') { await new Promise(ok => setTimeout(ok, delay)); if (res.destroyed || req.socket.destroyed) return; }
    const b = rec.body && typeof rec.body === 'object' ? rec.body : {};
    const bad = () => { rec.status = 400; json(res, 400, { error: 'bad' }); };
    const done = () => { rec.status = 204; rec.delivered = true; empty(res, 204); };
    if (req.method === 'POST' && !st.awake && !(u.pathname === '/api/key' && b.k === 'wake')) { rec.status = 409; return json(res, 409, { error: 'asleep' }); }   // the TV is off: only ON
    switch (`${req.method} ${u.pathname}`) {
      case 'GET /api/state': rec.status = 200; rec.delivered = true; return json(res, 200, st);
      case 'GET /api/events': return events(req, res, rec);
      case 'GET /api/apps': rec.status = 200; rec.delivered = true; return json(res, 200, APPS);
      case 'POST /api/key': {
        const n = b.n == null ? 1 : b.n;
        if (!KEYS.includes(b.k) || !Number.isInteger(n) || n < 1 || n > 10) return bad();
        if (st.adb !== 'ok') { rec.status = 503; return json(res, 503, { error: 'adb', adb: st.adb }); }
        done();
        if (b.k === 'home') { st.front = { ...HUB }; push(); }   // home brings the HUB to the front
        if (b.k === 'sleep') M.setAwake(false);
        if (b.k === 'wake') M.setAwake(true);
        return;
      }
      case 'POST /api/text':
        if (typeof b.text !== 'string' || b.text.length < 1 || b.text.length > 200) return bad();
        if (st.adb !== 'ok') { rec.status = 503; return json(res, 503, { error: 'adb', adb: st.adb }); }
        return done();
      case 'POST /api/launch': {
        const a = APPS.find(x => x.pkg === b.pkg);
        if (!a) { rec.status = 404; return json(res, 404, { error: 'app' }); }
        done(); st.front = { pkg: a.pkg, name: a.name, hub: false }; push();
        return;
      }
      case 'POST /api/hub': {
        const ok = (b.do === 'yt' && typeof b.k === 'string' && /^[a-z0-9-]+$/.test(b.k)) || b.do === 'yt-stop' || (b.do === 'yt-full' && typeof b.on === 'boolean')
          || (b.do === 'open' && Number.isInteger(b.i) && b.i >= 0 && b.i <= 2);
        if (!ok) return bad();
        done();
        if (b.do === 'open') { st.front = { pkg: 'com.hectorfsv.hubs', name: 'Hubs', hub: false }; push(); return; }   // a pod: its hub fills the TV
        if (!st.front.hub) { st.front = { ...HUB }; push(); }   // the HUB comes to the front first
        return;
      }
    }
    rec.status = 404; json(res, 404, { error: 'none' });
  }
  async function hook(req, res, u) {
    let b = {};
    if (req.method === 'POST') { try { b = JSON.parse(await readBody(req) || '{}'); } catch (e) { b = {}; } }
    switch (u.pathname) {
      case '/__mock/calls': return json(res, 200, calls);
      case '/__mock/state': return json(res, 200, { ...st, streams: streams.size, offline, delay });
      case '/__mock/front': M.setFront(b); return empty(res, 204);
      case '/__mock/adb': M.setAdb(b.adb); return empty(res, 204);
      case '/__mock/offline': M.setOffline(b.mode); return empty(res, 204);
      case '/__mock/delay': M.setDelay(b.ms); return empty(res, 204);
      case '/__mock/reset': M.reset(); return empty(res, 204);
    }
    empty(res, 404);
  }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://stick');
    if (u.pathname.startsWith('/__mock/')) return hook(req, res, u);
    const rec = { t: Date.now(), method: req.method, path: u.pathname, auth: 'none', body: null, status: 0, delivered: false, referer: req.headers.referer || null, offline: offline || false };
    calls.push(rec);
    log(req.method, u.pathname);
    if (offline === 'refuse') { req.socket.destroy(); return; }
    if (offline === 'hang') { held.push(res); return; }
    if (u.pathname.startsWith('/api/')) return api(req, res, u, rec);
    if (req.method !== 'GET') { rec.status = 404; return empty(res, 404); }
    let m;
    rec.status = 200;
    if (u.pathname === '/' || u.pathname === '/remote.html') return file(res, path.join(ROOT, 'remote.html'));
    if (u.pathname === '/hub') return file(res, path.join(ROOT, 'index.html'));   // the HUB, for the tablet as the controller (Hubs 2.11)
    if ((m = u.pathname.match(/^\/fonts\/([a-z0-9-]+)\.woff2$/))) return file(res, path.join(ROOT, 'fonts', m[1] + '.woff2'));
    if ((m = u.pathname.match(/^\/remote\/([a-z0-9-]+)\.(png|svg|webp|json|ogg|mp3|woff2)$/))) return file(res, path.join(ROOT, 'remote', `${m[1]}.${m[2]}`));
    rec.status = 404; empty(res, 404);
  });
  server.keepAliveTimeout = 30000;            // the stick closes idle keep-alive connections after 30 s
  server.maxConnections = 16;
  server.on('connection', so => { sockets.add(so); so.on('close', () => sockets.delete(so)); });
  await new Promise(ok => server.listen(port, host, ok));
  const M = {
    url: `http://${host}:${server.address().port}`, token, calls, state: st, apps: APPS,
    setFront(f) { st.front = f && f.hub ? { ...HUB } : { pkg: String(f.pkg || ''), name: String(f.name || f.pkg || ''), hub: false }; push(); },
    setAdb(a) { st.adb = ['ok', 'asking', 'off'].includes(a) ? a : 'ok'; push(); },
    setAwake(a) { st.awake = !!a; st.front = a ? { ...HUB } : null; push(); },   // asleep: nothing on the TV; awake: the HUB
    setVol(v) { st.vol = { ...st.vol, ...v }; push(); },
    setDelay(ms) { delay = Math.max(0, +ms || 0); },
    setOffline(mode) {
      const was = offline;
      offline = mode === 'refuse' || mode === 'hang' ? mode : false;
      if (offline === 'refuse') { for (const s of streams) { clearInterval(s.ping); s.res.destroy(); } streams.clear(); for (const so of sockets) so.destroy(); }
      if (offline === 'hang') for (const s of streams) s.silent = true;      // the streams stay open and go quiet: a stick that vanished
      if (!offline && was === 'hang') {                                     // back: what hung is dead (never processed), so are the quiet streams
        for (const r of held.splice(0)) r.socket && r.socket.destroy();
        for (const s of [...streams]) if (s.silent) { clearInterval(s.ping); s.res.destroy(); streams.delete(s); }
      }
    },
    streams: () => streams.size,
    delivered: p => calls.filter(c => c.delivered && (!p || c.path === p)),
    keys: k => calls.filter(c => c.delivered && c.path === '/api/key' && (!k || c.body.k === k)).reduce((s, c) => s + c.body.n, 0),
    reset() { M.setOffline(false); delay = 0; st.front = { ...FRONT0 }; st.adb = 'ok'; st.awake = true; st.vol = { ...VOL0 }; calls.length = 0; push(); },
    waitFor(pred, ms = 2000) {
      return new Promise(ok => {
        const t0 = Date.now();
        (function poll() { let v = false; try { v = pred(); } catch (e) { v = false; } if (v) return ok(true); if (Date.now() - t0 > ms) return ok(false); setTimeout(poll, 20); })();
      });
    },
    close() {
      for (const s of streams) { clearInterval(s.ping); s.res.destroy(); }
      streams.clear(); for (const r of held.splice(0)) r.socket && r.socket.destroy(); for (const so of sockets) so.destroy();
      return new Promise(ok => server.close(() => ok()));
    },
  };
  return M;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const m = await startMock({ port: +process.argv[2] || 8790, quiet: false });
  console.log(`the stick's remote server, mocked: ${m.url}/?k=${m.token}`);
}
