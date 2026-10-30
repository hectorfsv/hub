// node test/check.mjs [--shots]   The HUB in headless Chromium at the desk tablet's size and others. Nothing real is
// called: the weather and the air are saved Open-Meteo answers, the Pit's notebook and the services' pages are routed
// fakes, the battery is a stand-in, and window.HubsApp is a recorder standing in for the app. Every page runs on a
// fake clock set inside the saved weather's day (10-28), so the suite passes on any date. Screenshots land in
// test/shots/ (not committed).
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.homedir(), 'Documents/Jarvis/projects/webkit-check/node_modules/playwright'));
const HERE = path.dirname(new URL(import.meta.url).pathname), ROOT = path.dirname(HERE);
const SHELL = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-x64/chrome-headless-shell');
const WX = fs.readFileSync(path.join(HERE, 'fixtures/wx.json'), 'utf8');
const AIR = fs.readFileSync(path.join(HERE, 'fixtures/air.json'), 'utf8');   // US AQI 70, read live 10-28 22:00
const AT = '2026-10-28T17:30:00-07:00', T0 = Date.parse(AT);                  // inside the saved weather (sunrise 07:10, sunset 18:04)
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// /hub/* is this folder; /the-pit/config.js is a stand-in pointing at a fake notebook
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = http.createServer((q, s) => {
  const u = new URL(q.url, 'http://x');
  if (u.pathname === '/the-pit/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); s.end("window.PIT_CONFIG={supabaseUrl:'https://pit.test',supabaseKey:'sb_publishable_test'};"); return; }
  let f = u.pathname.replace(/^\/hub\//, '/'); if (f.endsWith('/')) f += 'index.html';
  const file = path.join(ROOT, f);
  if (!u.pathname.startsWith('/hub/') || !file.startsWith(ROOT) || !fs.existsSync(file)) { s.writeHead(404); s.end(); return; }
  s.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); s.end(fs.readFileSync(file));
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const BASE = `http://127.0.0.1:${server.address().port}/hub/`;

const VIEWS = {
  tablet: { viewport: { width: 533, height: 853 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  'tablet-land': { viewport: { width: 853, height: 533 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  tv: { viewport: { width: 1443, height: 812 }, deviceScaleFactor: 1 },   // the Fire TV Stick: 1080p at the app's wide viewport
};
const COOK = [{ id: 7, meat: 'Brisket', status: 'running', started_at: new Date(T0 - 372 * 60e3).toISOString(),
  state: { phase: 'cook', probes: { brisket: 'p0' }, plan: { name: 'Monclova low n slow', probes: ['brisket'], tracks: { brisket: [{ until: { at_least: 203 } }] } } } }];
const READING = [{ at: new Date(T0 - 30e3).toISOString(), pit: 251, setpoint: 250, probes: { p0: 168.4 } }];

let failures = 0;
const ok = (cond, what) => { if (cond) console.log('  ok  ', what); else { failures++; console.log('  FAIL', what); } };

const browser = await chromium.launch({ executablePath: SHELL });
async function open(view, { app = false, linked = false, cooking = false, query = '', at = AT, battery = null, tv = false, apps = [] } = {}) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Los_Angeles' }, VIEWS[view]));
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(at) });
  const errors = [], hits = { air: 0 };
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: WX }));
  await page.route('https://hectorfsv.github.io/**', r => r.fulfill({ status: 200, body: '' }));
  await page.route('https://air-quality-api.open-meteo.com/**', r => { hits.air++; r.fulfill({ status: 200, contentType: 'application/json', body: AIR }); });
  const pit = { cooks: cooking ? COOK : [], token: 0 };
  await page.route('https://pit.test/**', r => {
    const u = r.request().url();
    if (u.includes('/auth/v1/token')) { pit.token++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'a' + pit.token, refresh_token: 'r' + pit.token, expires_in: 3600, user: { email: 'pit@test' } }) }); }
    if (u.includes('/rest/v1/cooks')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pit.cooks) });
    if (u.includes('/rest/v1/readings')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(READING) });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(([app, linked, bat, tv, apps]) => {
    // the battery: a stand-in the test can plug in and out; every read is counted
    window.__batCalls = 0;
    const real = navigator.getBattery && navigator.getBattery.bind(navigator);
    if (bat) { window.__bat = Object.assign(new EventTarget(), { level: bat.level, charging: bat.charging, chargingTime: 0, dischargingTime: Infinity }); }
    if (bat || real) Object.defineProperty(navigator, 'getBattery', { configurable: true, value: () => { window.__batCalls++; return bat ? Promise.resolve(window.__bat) : real(); } });
    // sound: every tone the page makes is counted
    window.__beeps = 0; window.__tones = [];
    if (window.AudioContext) { const AC = window.AudioContext; window.AudioContext = class extends AC { createOscillator() { window.__beeps++; const o = super.createOscillator(), start = o.start.bind(o); o.start = t => { window.__tones.push({ type: o.type, hz: o.frequency.value }); start(t); }; return o; } }; }
    if (linked) localStorage.setItem('hub.pit', JSON.stringify({ access_token: 'a0', refresh_token: 'r0', expires_at: Date.now() + 3e6, email: 'pit@test' }));
    if (app) {
      window.__calls = [];
      window.HubsApp = {
        services: () => JSON.stringify({ version: '2.0', tv, services: [
          { name: 'Lounge', url: 'https://hectorfsv.github.io/lounge/', mic: true },
          { name: 'The Pit', url: 'https://hectorfsv.github.io/the-pit/', mic: false },
          { name: 'Home Assistant', url: '', mic: false }] }),
        open: i => window.__calls.push('open:' + i), talk: () => window.__calls.push('talk'), panel: () => window.__calls.push('panel'), dim: on => window.__calls.push('dim:' + on),
        apps: () => JSON.stringify(apps), launch: pkg => window.__calls.push('launch:' + pkg),
      };
    }
  }, [app, linked, battery, tv, apps]);
  if (tv) {   // a TV fetches the Lounge's feeds and plays YouTube: fakes, and a story's page answers 204 so the HUB stays put
    const rss = items => `<?xml version="1.0"?><rss><channel>${items.map(([t, h]) => `<item><title>${t}</title><link>https://news.test/${encodeURIComponent(t)}</link><pubDate>${new Date(T0 - h * 3600e3).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
    const FEED = { 'moxie.foxnews.com/google-publisher/world.xml': rss([['Israel and Hamas talks resume in Cairo', 1], ['Typhoon nears the Philippines', .5]]),
      'moxie.foxnews.com/google-publisher/us.xml': rss([['Senate passes the farm bill', 2], ['Wildfire season ends early in California', 3]]),
      'moxie.foxnews.com/google-publisher/politics.xml': rss([['White House names a new chief of staff', .2]]),
      'rss.dw.com/rdf/rss-en-all': rss([['Germany debates its budget', .3]]),
      'www.israelnationalnews.com/Rss.aspx': rss([['Knesset votes on the draft law', 4]]) };
    await page.route(/^https:\/\/(moxie\.foxnews\.com|rss\.dw\.com|www\.israelnationalnews\.com)\//, r => {
      const k = Object.keys(FEED).find(x => r.request().url().includes(x));
      return r.fulfill({ status: 200, contentType: 'application/xml', body: k ? FEED[k] : '<rss/>' });
    });
    await page.route('https://www.youtube.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title><body style="background:#300">player</body>' }));
    await page.route('https://news.test/**', r => { hits.story = r.request().url(); return r.fulfill({ status: 204, body: '' }); });
  }
  await page.goto(BASE + (query ? '?' + query : ''));
  return { ctx, page, errors, pit, hits };
}

// every box that must stay on screen and clear of the others
const geometry = () => {
  const vis = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none';
  const box = e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; };
  const text = el => { const kids = [...el.children].filter(vis); const rs = kids.map(box); return rs.length ? { x: Math.min(...rs.map(r => r.x)), y: Math.min(...rs.map(r => r.y)), r: Math.max(...rs.map(r => r.r)), b: Math.max(...rs.map(r => r.b)) } : box(el); };
  const items = [];
  items.push(['core', box(document.querySelector('.core'))]);
  document.querySelectorAll('.pod').forEach((p, i) => items.push(['pod' + i, box(p)]));
  document.querySelectorAll('.label').forEach((l, i) => items.push(['label' + i, text(l)]));
  items.push(['greet', text(document.querySelector('.greet'))]);
  items.push(['wx', box(document.getElementById('wx'))]);
  const bottom = document.body.classList.contains('forge') ? document.getElementById('cook') : document.getElementById('hours');
  items.push(['bottom', box(bottom)]); items.push(['foot', box(document.getElementById('foot'))]);
  return { W: innerWidth, H: innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, items };
};
function checkLayout(g, name) {
  ok(g.sw <= g.W && g.sh <= g.H, `${name}: nothing scrolls (${g.sw}x${g.sh} in ${g.W}x${g.H})`);
  const off = g.items.filter(([, r]) => r.x < 0 || r.y < 0 || r.r > g.W + .5 || r.b > g.H + .5).map(([n]) => n);
  ok(!off.length, `${name}: every box on screen${off.length ? ' (off: ' + off.join(', ') + ')' : ''}`);
  const hits = [];
  for (let a = 0; a < g.items.length; a++) for (let b = a + 1; b < g.items.length; b++) {
    const [na, ra] = g.items[a], [nb, rb] = g.items[b];
    if ((na === 'pod0' && nb === 'label0') || (na === 'pod1' && nb === 'label1') || (na === 'pod2' && nb === 'label2') || (na === 'bottom' && nb === 'foot')) continue;
    const ix = Math.min(ra.r, rb.r) - Math.max(ra.x, rb.x), iy = Math.min(ra.b, rb.b) - Math.max(ra.y, rb.y);
    if (ix > 1 && iy > 1) hits.push(`${na}×${nb}`);
  }
  ok(!hits.length, `${name}: no box overlaps another${hits.length ? ' (' + hits.join(', ') + ')' : ''}`);
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
const state = page => page.evaluate(() => JSON.parse(window.hub.state()));
const errs = errors => 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : '');
// the add-ons: the bead taken all the way round its ring must stay on screen and clear of the pods, labels, top and bottom
const beadSweep = page => page.evaluate(() => {
  const g = JSON.parse(window.hub.state()).geo, rad = g.R * .08, hits = [], rects = [];
  const vis = e => e && e.getClientRects().length && getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden';
  document.querySelectorAll('.label').forEach((l, i) => [...l.children].filter(vis).forEach(c => rects.push(['label' + i, c.getBoundingClientRect()])));
  for (const id of ['greet', 'sun', 'wx', 'hours', 'foot']) { const e = document.getElementById(id); if (vis(e)) rects.push([id, e.getBoundingClientRect()]); }
  for (let a = -90; a <= 270; a += 7.5) {
    window.hub.bead(a);
    const b = document.getElementById('bead').getBoundingClientRect(), cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
    if (cx - rad < 0 || cy - rad < 0 || cx + rad > innerWidth || cy + rad > innerHeight) hits.push(a + '°:off screen');
    g.pods.forEach((p, i) => { if (Math.hypot(cx - p.x, cy - p.y) < rad + g.rp) hits.push(a + '°:pod' + i); });
    for (const [n, r] of rects) { const dx = Math.max(r.left - cx, 0, cx - r.right), dy = Math.max(r.top - cy, 0, cy - r.bottom); if (Math.hypot(dx, dy) < rad) hits.push(a + '°:' + n); }
  }
  window.hub.bead(null);
  return hits;
});
// the brackets, their labels and the timer's countdown stay 2 px clear of the digits and the date, the widest times
// included. Measured against the ink (a canvas measures the same font), not the line box, which is taller than the digits;
// a cell is checked along its arc, not by its square box
const eyeClear = page => page.evaluate(() => {
  const ink = el => {
    const cs = getComputedStyle(el), rg = document.createRange(); rg.selectNodeContents(el);
    const rr = rg.getBoundingClientRect(), c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; c.letterSpacing = cs.letterSpacing;
    const m = c.measureText(el.textContent), base = rr.top + m.fontBoundingBoxAscent;
    return { left: rr.left - m.actualBoundingBoxLeft, right: rr.left + m.actualBoundingBoxRight, top: base - m.actualBoundingBoxAscent, bottom: base + m.actualBoundingBoxDescent };
  };
  const t = document.getElementById('time'), keep = t.textContent, out = [], g = document.getElementById('gauges'), m = g.getScreenCTM();
  const near = (x, y, b, pad) => Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom)) < pad;
  for (const s of [keep, '00:00', '08:48']) {
    t.textContent = s;
    const boxes = [['time ' + s, ink(t)], ['date', ink(document.getElementById('date'))]];
    for (const p of g.querySelectorAll('path')) {
      const half = (parseFloat(p.getAttribute('stroke-width')) || 0) / 2 * m.a, L = p.getTotalLength();
      for (let i = 0; i <= 12; i++) {
        const q = p.getPointAtLength(L * i / 12), x = m.a * q.x + m.c * q.y + m.e, y = m.b * q.x + m.d * q.y + m.f;
        for (const [n, b] of boxes) if (near(x, y, b, half + 2)) out.push(`${p.id || 'cell'}×${n}`);
      }
    }
    for (const e of document.querySelectorAll('#gauges text, #tmr.on text')) {
      const r = e.getBoundingClientRect();
      for (const [n, b] of boxes) if (Math.min(r.right, b.right) - Math.max(r.left, b.left) > -2 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > -2) out.push(`${e.id}×${n}`);
    }
  }
  t.textContent = keep;
  return [...new Set(out)];
});
// the composited layers Chromium keeps, by element (the tablet's GPU blends every one of them every frame)
async function layersOf(page) {
  const c = await page.context().newCDPSession(page);
  await c.send('DOM.getDocument', { depth: -1 });
  const got = new Promise(ok => c.on('LayerTree.layerTreeDidChange', e => { if (e.layers) ok(e.layers); }));
  await c.send('LayerTree.enable');
  const layers = await Promise.race([got, new Promise(ok => setTimeout(() => ok(null), 4000))]), names = [];
  for (const l of layers || []) {
    if (!l.backendNodeId) continue;
    const { node } = await c.send('DOM.describeNode', { backendNodeId: l.backendNodeId }).catch(() => ({}));
    const a = (node && node.attributes) || [], i = a.indexOf('id'), k = a.indexOf('class');
    names.push((node ? node.localName : '?') + (i >= 0 ? '#' + a[i + 1] : '') + (k >= 0 ? '.' + a[k + 1].split(' ')[0] : ''));
  }
  await c.send('LayerTree.disable'); await c.detach();
  return layers ? names : null;
}
const lit = page => page.$$eval('#gauges path[stroke-width="3.6"]', ps => ps.map(p => ({ c: p.getAttribute('stroke'), on: +p.getAttribute('opacity') > .5 })));
const hold = async (page, sel) => { const b = await page.locator(sel).boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.clock.runFor(800); await page.mouse.up(); await page.waitForTimeout(150); };

try {
  // 1. a browser, first visit: the boot check, the weather, the Pit asking to be linked
  for (const view of Object.keys(VIEWS)) {
    console.log(`\n${view}: browser, not linked`);
    const { ctx, page, errors } = await open(view);
    await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    const st = await state(page);
    ok(st.booted, 'boot ran and finished');
    ok(st.wx, 'weather read');
    ok(await page.$$eval('#hours .h', h => h.length) === 6, 'six hours ahead');
    ok(/^\d{2}:\d{2}$/.test(await page.textContent('#time')), 'the clock reads HH:MM (24-hour, his setting)');
    ok(await page.isVisible('#chip1'), "the Pit offers 'LINK LIVE COOKS'");
    ok(st.reach[0] === 'on' && st.reach[1] === 'on' && st.reach[2] === 'unset', 'each service checked (Home not set up)');
    ok(!!(await page.$('#gauges path')) && st.air === 70 && !!st.bead, 'the add-ons are on by default: the brackets, the air, the bead');
    checkLayout(await page.evaluate(geometry), view);
    await shot(page, `${view}-browser`);
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // 2. in the app, linked, a cook running: the forge
  for (const view of ['tablet', 'tablet-land', 'iphone']) {
    console.log(`\n${view}: app, linked, cooking`);
    const { ctx, page, errors } = await open(view, { app: true, linked: true, cooking: true, query: 'boot=0' });
    await page.waitForFunction(() => document.body.classList.contains('forge'), null, { timeout: 6000 });
    await page.waitForTimeout(2600);
    const st = await state(page);
    ok(st.forge && st.pit === 'cook', 'the forge is lit');
    ok(/BRISKET/.test(await page.textContent('#ck-name')), 'the cook card names the cook');
    ok(/251°/.test(await page.textContent('#st1')) && /168°/.test(await page.textContent('#st2_1')), 'the Pit pod shows pit 251° and brisket 168°');
    ok(await page.$eval('.pod.pit', p => p.classList.contains('hot')), 'the Pit pod burns');
    ok(await page.$$eval('#embers .ember', e => e.length) === 28, '28 embers');
    ok(await page.isVisible('#gear'), 'the gear shows in the app');
    checkLayout(await page.evaluate(geometry), view + ' forge');
    await shot(page, `${view}-forge`);
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // 3. in the app: a pod opens its service, the core does nothing (talk is out for now), the gear opens the panel, Home (not set up) does nothing
  {
    console.log('\ntablet: app, taps');
    const { ctx, page, errors } = await open('tablet', { app: true, query: 'boot=0' });
    await page.waitForTimeout(1200);
    const tapAt = async sel => { const b = await page.locator(sel).boundingBox(); await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); };
    await tapAt('.pod >> nth=0'); await page.waitForTimeout(500);
    ok((await page.evaluate(() => window.__calls)).includes('open:0'), 'a tap on the Lounge pod asks the app to open service 0');
    await page.evaluate(() => window.hub.returned(0)); await page.waitForTimeout(900);
    await tapAt('.pod >> nth=2'); await page.waitForTimeout(500);
    ok(!(await page.evaluate(() => window.__calls)).some(c => c === 'open:2'), 'Home (not set up) opens nothing');
    ok(/NOT SET UP/.test(await page.textContent('#toast')), '... and says so');
    const before = (await page.evaluate(() => window.__calls)).length;
    await tapAt('#clock'); await page.waitForTimeout(600);
    const added = (await page.evaluate(() => window.__calls)).slice(before);
    ok(!added.length, 'a tap on the core asks the app for nothing (talk is out for now)' + (added.length ? ': ' + added.join(', ') : ''));
    ok(!(await page.$('#talk')) && !/TAP TO TALK/.test(await page.textContent('#reactor')), 'no TAP TO TALK on the core');
    await tapAt('#gear'); await page.waitForTimeout(200);
    ok((await page.evaluate(() => window.__calls)).includes('panel'), 'the gear asks for the panel');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // 4. linking the Pit from the HUB: the sheet, a sign-in, then the HUB's own session
  {
    console.log('\ntablet: app, linking the Pit');
    const { ctx, page, errors, pit } = await open('tablet', { app: true, query: 'boot=0' });
    await page.waitForTimeout(900);
    await page.waitForTimeout(1200); await page.click("#chip1");
    ok(await page.isVisible('#sheet'), 'the chip opens the sheet');
    await shot(page, 'tablet-sheet');
    await page.fill('#sh-e', 'pit@test'); await page.fill('#sh-p', 'secret');
    await page.click('#sh-go'); await page.waitForTimeout(800);
    const ses = await page.evaluate(() => JSON.parse(localStorage.getItem('hub.pit')));
    ok(ses && ses.access_token === 'a1' && !(await page.evaluate(() => localStorage.getItem('pit.session'))), "the HUB keeps its own session ('hub.pit'), never the Pit page's");
    ok((await state(page)).pit === 'idle' && /ON · PIT 251°/.test(await page.textContent('#st1')), 'no cook, a fresh reading: the Pit pod shows the smoker on at 251°');
    pit.cooks = COOK; await page.evaluate(() => window.hub.refresh()); await page.waitForTimeout(1200);
    ok((await state(page)).forge, 'a cook starts: the forge lights');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // 5. night: untouched, the HUB dims and asks the app to dim the screen; the first touch only wakes it
  {
    console.log('\ntablet: app, night');
    const { ctx, page, errors } = await open('tablet', { app: true, query: 'boot=0&demo=night' });
    await page.waitForFunction(() => document.body.classList.contains('dim'), null, { timeout: 12000 });
    ok((await page.evaluate(() => window.__calls)).includes('dim:true'), 'dims, and asks the app to dim the screen');
    await page.waitForTimeout(2600);
    await shot(page, 'tablet-night');
    const b = await page.locator('.pod >> nth=0').boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(600);
    const calls = await page.evaluate(() => window.__calls);
    ok(calls.includes('dim:false') && !calls.includes('open:0'), 'the first touch wakes it and opens nothing');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await ctx.close();
  }

  // 6. by day: power and air beside the clock, the sun on its ring, at every size
  for (const view of Object.keys(VIEWS)) {
    console.log(`\n${view}: 10:30, battery 87% charging, AQI 70`);
    const { ctx, page, errors, hits } = await open(view, { app: view.startsWith('tablet'), query: 'boot=0', at: '2026-10-28T10:30:00-07:00', battery: { level: .87, charging: true } });
    await page.waitForTimeout(1500);
    const st = await state(page), cells = await lit(page);
    ok(hits.air === 1 && st.air === 70, 'the air read once: AQI 70');
    ok(cells.length === 16 && cells.slice(0, 8).filter(c => c.on).length === 7 && cells.slice(8).filter(c => c.on).length === 3, 'power: 7 of 8 cells lit; air: 3 of 8');
    ok((await page.textContent('#pw-lab')) === '87%' && !!(await page.$('#bolt')) && (await page.textContent('#aq-lab')) === 'AQI 70', 'the labels: a bolt and 87%, AQI 70');
    const want = -90 + 180 * 200 / 654;
    ok(st.bead === 'sun' && Math.abs(st.day.a - want) < .5, `the sun on its ring at ${st.day.a.toFixed(1)}° (sunrise 07:10 at the left, sunset 18:04 at the right)`);
    const near = await eyeClear(page); ok(!near.length, 'the brackets and labels clear the time and the date' + (near.length ? ': ' + near.join(', ') : ''));
    const sweep = await beadSweep(page); ok(!sweep.length, 'the bead, all the way round, stays on screen and clear of the pods, labels, top and bottom' + (sweep.length ? ': ' + sweep.slice(0, 8).join(', ') : ''));
    checkLayout(await page.evaluate(geometry), view + ' try');
    if (view === 'tablet') {
      const ls = await layersOf(page), own = (ls || []).filter(n => /#gauges|#tmr|#bead|#chg|\.flare/.test(n));
      ok(ls && ls.length > 10 && !own.length, `at rest the add-ons keep no layer of their own (${ls ? ls.length : 'no'} layers` + (own.length ? '; theirs: ' + own.join(', ') : '') + ')');
    }
    await shot(page, `${view}-try-day`);
    ok(!errors.length, errs(errors));
    await ctx.close();
  }

  // 7. the hour flare, then the kitchen timer from the hold to the alarm
  {
    console.log('\ntablet: the hour flare and the kitchen timer');
    const { ctx, page, errors } = await open('tablet', { app: true, query: 'boot=0', at: '2026-10-28T10:59:40-07:00', battery: { level: 1, charging: true } });
    await page.waitForTimeout(1200);
    await page.clock.pauseAt(new Date('2026-10-28T10:59:50-07:00'));
    ok((await state(page)).flares === 0, 'no flare before the hour');
    await page.clock.runFor(15000);
    ok((await state(page)).flares === 1, 'at 11:00 the reactor flares once');
    await page.clock.runFor(60000);
    ok((await state(page)).flares === 1, '... and not again at 11:01');

    await hold(page, '#clock');
    ok(await page.isVisible('#sheet') && /KITCHEN TIMER/.test(await page.textContent('#sheet h2')) && (await page.$$('#sheet [data-min]')).length === 12, 'holding the clock opens the kitchen timer: 12 times to pick');
    await shot(page, 'tablet-try-timer-sheet');
    const b0 = await page.evaluate(() => window.__beeps);
    await page.click('#sheet [data-min="5"]'); await page.waitForTimeout(100);
    let st = await state(page);
    ok(await page.isHidden('#sheet') && st.tmr && st.tmr.len === 300000, 'a 5-minute timer starts and the sheet closes');
    ok(/^(5:00|4:59)$/.test(await page.textContent('#tm-txt')), `the reactor counts it down (${await page.textContent('#tm-txt')})`);
    ok((await page.evaluate(() => window.__beeps)) === b0 + 1, 'one blip says it started');
    await page.clock.runFor(150000);
    const half = await page.$$eval('#tm-cells path', ps => ps.filter(p => p.getAttribute('opacity') === '1').length);
    ok(/^2:(31|30|29)$/.test(await page.textContent('#tm-txt')) && Math.abs(half - 30) <= 1, `halfway: ${await page.textContent('#tm-txt')} left (it turns 30 ms after each second), ${half} of the ring's 60 cells lit`);
    const near = await eyeClear(page); ok(!near.length, 'the countdown clears the time' + (near.length ? ': ' + near.join(', ') : ''));
    await shot(page, 'tablet-try-timer');
    await hold(page, '#clock');
    ok(await page.isVisible('#tm-stop') && /RUNNING · 2:(29|30) LEFT/.test(await page.textContent('#tm-left')), 'held again while it runs: the time left, +1, +5, STOP');
    await page.click('#sheet [data-add="1"]'); await page.waitForTimeout(100);
    ok(/^3:(29|30)$/.test(await page.textContent('#tm-txt')), `+1 MIN: ${await page.textContent('#tm-txt')} left`);
    const calls0 = (await page.evaluate(() => window.__calls)).length;
    await page.clock.runFor(211000);
    st = await state(page);
    ok(st.tmr && st.tmr.done && st.alarm && (await page.textContent('#tm-txt')) === 'DONE' && /TIMER DONE/.test(await page.textContent('#toast')), 'at zero: DONE on the reactor, a toast, the alarm on');
    const b1 = await page.evaluate(() => window.__beeps), f1 = st.flares;
    await page.clock.runFor(2500);
    ok((await page.evaluate(() => window.__beeps)) >= b1 + 4 && (await state(page)).flares > f1, 'it keeps chiming (four beeps every 2.4 s) and flaring');
    const alarmTones = (await page.evaluate(() => window.__tones)).slice(-4);
    ok(alarmTones.length === 4 && alarmTones.every(t => t.type === 'square' && t.hz === 2700), "the alarm's beeps are square waves at 2.7 kHz (loud on a tablet's speaker), not soft sines");
    const pod = await page.locator('.pod >> nth=0').boundingBox();
    await page.touchscreen.tap(pod.x + pod.width / 2, pod.y + pod.height / 2); await page.waitForTimeout(300);
    st = await state(page);
    ok(!st.tmr && !st.alarm && (await page.isHidden('#tmr')) && (await page.evaluate(() => window.__calls)).length === calls0, 'a touch, even on a pod, stops it and opens nothing');
    ok((await page.$$eval('#tm-cells path', ps => ps.filter(p => p.getAttribute('opacity') === '1').length)) === 0, "stopped: the ring's cells all go dark for the next timer");
    await page.clock.runFor(1000);   // the stopping touch swallows the next 650 ms of touches
    await hold(page, '#clock'); await page.click('#sheet [data-min="1"]'); await page.waitForTimeout(100);
    await page.clock.runFor(61000 + 125000);
    st = await state(page);
    ok(st.tmr && st.tmr.done && !st.alarm, 'left alone, the chime stops after two minutes and DONE stays');
    ok(!errors.length, errs(errors));
    await ctx.close();
  }

  // 8. night: the moon in its phase on the bottom half; no flare while the screen is dimmed
  {
    console.log('\ntablet: night, the moon');
    const { ctx, page, errors } = await open('tablet', { app: true, query: 'boot=0', at: '2026-10-28T21:58:30-07:00', battery: { level: 1, charging: true } });
    await page.waitForTimeout(1000);
    await page.clock.pauseAt(new Date('2026-10-28T21:58:40-07:00'));
    let st = await state(page);
    ok(st.bead === 'moon' && st.day.a > 90 && st.day.a < 270, `the moon rides the bottom half (${st.day.a.toFixed(1)}°)`);
    ok((await page.getAttribute('#bead path', 'transform')) === 'scale(-1 1)', 'waning, lit on the left (the full moon was 10-26)');
    await shot(page, 'tablet-try-night');
    await page.clock.runFor(70000);
    st = await state(page); ok(st.dimmed, 'a minute untouched: dimmed');
    await page.clock.runFor(60000);
    st = await state(page); ok(st.flares === 0, 'no flare at 22:00 while dimmed');
    ok(!errors.length, errs(errors));
    await ctx.close();
  }

  // 9. holidays (by date and on screen), and the battery running low, then plugged in
  {
    console.log("\ntablet-land: New Year's Eve, the battery at 8%");
    const { ctx, page, errors } = await open('tablet-land', { app: true, query: 'boot=0', at: '2026-12-31T10:00:00-08:00', battery: { level: .08, charging: false } });
    await page.waitForTimeout(1500);
    const days = await page.evaluate(() => ['2026-10-31T12:00', '2026-10-28T12:00', '2026-11-26T12:00', '2026-11-19T12:00', '2026-12-24T12:00', '2026-12-25T12:00', '2026-12-31T12:00', '2027-01-01T12:00', '2027-07-04T12:00', '2027-11-25T12:00'].map(window.hub.holiday));
    ok(days.join() === 'halloween,,thanksgiving,,xmas,xmas,newyear,newyear,july4,thanksgiving', 'holidays by date: ' + days.join());
    ok((await page.textContent('#greet')) === "HAPPY NEW YEAR'S EVE, HECTOR" && (await page.evaluate(() => document.body.dataset.hol)) === 'newyear', "Dec 31: HAPPY NEW YEAR'S EVE, HECTOR, and the day's colors");
    ok(/rgba?\(255, 233, 176/.test(await page.$eval('.mote', m => getComputedStyle(m).backgroundImage)), "the dust wears the day's colors");
    checkLayout(await page.evaluate(geometry), 'tablet-land, the longest greeting');
    const cells = (await lit(page)).slice(0, 8);
    ok(cells.every(c => c.c === '#FF3B30') && cells.filter(c => c.on).length === 1 && /BATTERY LOW/.test(await page.textContent('#toast')), 'at 8% and unplugged: one red cell, and a toast to plug it in');
    await page.evaluate(() => { window.__bat.charging = true; window.__bat.dispatchEvent(new Event('chargingchange')); });
    await page.waitForTimeout(100);
    const st = await state(page);
    ok(st.sparks === 1 && !!(await page.$('#bolt')) && (await lit(page)).slice(0, 8).every(c => c.c === '#FFB547'), 'plugged in: a spark runs up the bracket, the bolt shows, the cells turn gold');
    await shot(page, 'tablet-land-try-holiday');
    ok(!errors.length, errs(errors));
    await ctx.close();
  }
  {
    console.log('\ntablet: ?holiday=halloween, evening');
    const { ctx, page, errors } = await open('tablet', { app: true, query: 'boot=0&holiday=halloween', at: '2026-10-28T19:30:00-07:00', battery: { level: 1, charging: true } });
    await page.waitForTimeout(2500);
    ok((await page.textContent('#greet')) === 'HAPPY HALLOWEEN, HECTOR' && (await page.$eval('#greet', e => getComputedStyle(e).color)) === 'rgb(196, 140, 255)', 'Halloween: HAPPY HALLOWEEN, HECTOR, in purple');
    const motes = await page.$$eval('.mote', ms => ms.map(m => m.getAnimations()[0].effect.getKeyframes().reduce((a, k) => Math.max(a, k.opacity == null ? 0 : +k.opacity), 0)));
    ok(motes.length === 14 && Math.min(...motes) >= .6, 'the holiday dust burns brighter (every mote peaks at .6 or more)');
    await shot(page, 'tablet-try-halloween');
    ok(!errors.length, errs(errors));
    await ctx.close();
  }

  // 11. a TV (the Fire TV Stick, 10-29): the apps ring around the clock, the pods, YouTube and the news; the remote walks them all
  {
    console.log('\ntv: app, the TV layout and the remote');
    const ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
    const APPS = ['Netflix', 'Prime Video', 'HBO Max', 'Disney+', 'Hulu', 'Peacock', 'Apple TV', 'YouTube', 'Tubi', 'The Roku Channel', 'Pluto TV', 'Plex', 'Spotify']
      .map((name, i) => ({ name, pkg: 'pkg.' + i, icon: ICON }));
    const { ctx, page, errors, hits } = await open('tv', { app: true, tv: true, apps: APPS, query: 'boot=0' });
    await page.waitForFunction(() => document.querySelectorAll('.nw').length > 0, null, { timeout: 8000 });
    await page.waitForTimeout(600);
    const cur = sel => page.$eval(sel, e => e.classList.contains('cur'));
    const curName = () => page.evaluate(() => { const c = document.querySelector('.cur'); return c ? (c.dataset.name || c.dataset.k || c.id || c.className) : null; });
    ok(await page.$eval('body', b => b.classList.contains('tv')), 'the page knows it is on a TV');
    // the layout: every app orb, pod, label and tile on screen and clear of the others
    const g = await page.evaluate(() => {
      const box = e => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, r: r.right, b: r.bottom }; };
      const txt = l => { const rs = [...l.children].filter(c => c.getClientRects().length).map(box); return { x: Math.min(...rs.map(r => r.x)), y: Math.min(...rs.map(r => r.y)), r: Math.max(...rs.map(r => r.r)), b: Math.max(...rs.map(r => r.b)) }; };
      const items = [['core', box(document.querySelector('.core'))]];
      document.querySelectorAll('.tapp').forEach((a, i) => items.push(['app' + i, box(a)]));
      document.querySelectorAll('.pod').forEach((p, i) => items.push(['pod' + i, box(p)]));
      document.querySelectorAll('.label').forEach((l, i) => items.push(['label' + i, txt(l)]));
      for (const id of ['wx', 'hours', 'yt', 'news', 'foot']) items.push([id, box(document.getElementById(id))]);
      items.push(['greet', txt(document.querySelector('.greet'))]);
      return { W: innerWidth, H: innerHeight, items };
    });
    const off = g.items.filter(([, r]) => r.x < 0 || r.y < 0 || r.r > g.W + .5 || r.b > g.H + .5).map(([n]) => n);
    ok(!off.length, `tv layout: everything on screen${off.length ? ' (off: ' + off.join(', ') + ')' : ''}`);
    const hits2 = [];
    for (let i = 0; i < g.items.length; i++) for (let j = i + 1; j < g.items.length; j++) {
      const [na, ra] = g.items[i], [nb, rb] = g.items[j];
      if (/^pod(\d)$/.test(na) && nb === 'label' + na.slice(3)) continue;
      const ix = Math.min(ra.r, rb.r) - Math.max(ra.x, rb.x), iy = Math.min(ra.b, rb.b) - Math.max(ra.y, rb.y);
      if (ix > 1 && iy > 1) hits2.push(`${na}×${nb}`);
    }
    ok(!hits2.length, `tv layout: nothing overlaps${hits2.length ? ' (' + hits2.join(', ') + ')' : ''}`);
    ok((await page.$$eval('.tapp', a => a.length)) === 13, 'thirteen apps around the clock');
    ok((await page.$$eval('#yt-ch .ch', c => c.length)) === 13, "the Lounge's twelve channels and the YouTube app in the tile");
    // the remote: it starts on the first app and walks the ring
    ok((await curName()) === 'Netflix', 'the ring starts on the first app');
    ok((await page.textContent('#appname')) === 'NETFLIX' && await page.isVisible('#appname') && !(await page.isVisible('#date')), 'the clock names the app the ring is on');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
    ok((await curName()) === 'HBO Max', 'Down, Down: along the ring to the third app');
    await page.keyboard.press('ArrowUp');
    ok((await curName()) === 'Prime Video', 'Up: back one');
    await page.keyboard.press('Enter');
    ok((await page.evaluate(() => window.__calls)).includes('launch:pkg.1'), 'Select on an app asks the app to open it');
    for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    ok(await cur('#clock') && await page.isVisible('#date'), 'Right from the ring: the clock (its date back)');
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    ok(await page.$eval('#sheet', f => !f.hidden && /KITCHEN TIMER/.test(f.textContent)) && await cur('#sheet [data-min="1"]'), 'Select on the clock: the kitchen timer, the ring on 1 MIN');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    ok(await page.$eval('#sheet', f => f.hidden) && await cur('#clock'), 'Back closes the sheet; the ring is back on the clock');
    await page.keyboard.press('ArrowRight');
    ok(await cur('.pod.pit'), 'Right: the Pit');
    await page.keyboard.press('ArrowUp');
    ok(await cur('.pod'), 'Up: the Lounge');
    await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    ok((await page.evaluate(() => window.__calls)).includes('open:1'), 'Down, Select: the Pit opens in the app');
    // YouTube
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const ch = await curName();
    ok(await page.$eval('.cur', e => e.classList.contains('ch')), `Right, Right: into the YouTube channels (${ch})`);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    const src = await page.$eval('#yt-scr iframe', f => f.src).catch(() => '');
    ok(/^https:\/\/www\.youtube\.com\/embed\/.+autoplay=1.+origin=/.test(src) && !/mute=1/.test(src), 'Select plays the channel in the tile, with sound');
    await page.keyboard.press('Enter');
    ok(await page.$eval('#yt', y => y.classList.contains('full')), 'Select again: full screen');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
    ok(await page.$eval('#yt', y => y.classList.contains('full')) && (await page.$eval('#yt-scr iframe', f => f.src)) !== src, 'Right in full screen: the next channel, still full screen');
    await page.keyboard.press('Escape');
    ok(await page.$eval('#yt', y => !y.classList.contains('full')) && !!(await page.$('#yt-scr iframe')) && await page.$eval('.cur', e => e.classList.contains('ch') && e.classList.contains('on')), 'Back: out of full screen, still playing, the ring on the playing channel');
    await page.keyboard.press('Escape');
    ok(!(await page.$('#yt-scr iframe')), 'Back again: it stops');
    // the news, in his order
    const first = await page.$eval('.nw small', e => e.textContent);
    ok(/^FOX (US|POLITICS)/.test(first), `the news starts with a US story (${first})`);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(100);
    ok(await page.$eval('.cur', e => e.classList.contains('nw')), 'Down from the channels: the news');
    await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    ok(/^https:\/\/news\.test\//.test(hits.story || ''), 'Select on a story opens it (the app shows it on top)');
    await shot(page, 'tv-layout');
    ok(!errors.length, errs(errors));
    await ctx.close();
  }
  {
    const { ctx, page } = await open('tablet', { app: true, query: 'boot=0' });
    await page.waitForTimeout(800);
    await page.keyboard.press('ArrowDown');
    ok(!(await page.$('.cur')), 'the tablet, no TV: the arrows ring nothing');
    await ctx.close();
  }
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
