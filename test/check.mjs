// node test/check.mjs [--shots]   The HUB in headless Chromium at the desk tablet's size and others. Nothing real is
// called: the weather is a saved Open-Meteo answer, the Pit's notebook and the services' pages are routed fakes, and
// window.HubsApp is a recorder standing in for the app. Screenshots land in test/shots/ (not committed).
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
};
const COOK = [{ id: 7, meat: 'Brisket', status: 'running', started_at: new Date(Date.now() - 372 * 60e3).toISOString(),
  state: { phase: 'cook', probes: { brisket: 'p0' }, plan: { name: 'Monclova low n slow', probes: ['brisket'], tracks: { brisket: [{ until: { at_least: 203 } }] } } } }];
const READING = [{ at: new Date(Date.now() - 30e3).toISOString(), pit: 251, setpoint: 250, probes: { p0: 168.4 } }];

let failures = 0;
const ok = (cond, what) => { if (cond) console.log('  ok  ', what); else { failures++; console.log('  FAIL', what); } };

const browser = await chromium.launch({ executablePath: SHELL });
async function open(view, { app = false, linked = false, cooking = false, query = '' } = {}) {
  const ctx = await browser.newContext(VIEWS[view]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://api.open-meteo.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: WX }));
  await page.route('https://hectorfsv.github.io/**', r => r.fulfill({ status: 200, body: '' }));
  const pit = { cooks: cooking ? COOK : [], token: 0 };
  await page.route('https://pit.test/**', r => {
    const u = r.request().url();
    if (u.includes('/auth/v1/token')) { pit.token++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'a' + pit.token, refresh_token: 'r' + pit.token, expires_in: 3600, user: { email: 'pit@test' } }) }); }
    if (u.includes('/rest/v1/cooks')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pit.cooks) });
    if (u.includes('/rest/v1/readings')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(READING) });
    return r.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript(([app, linked]) => {
    if (linked) localStorage.setItem('hub.pit', JSON.stringify({ access_token: 'a0', refresh_token: 'r0', expires_at: Date.now() + 3e6, email: 'pit@test' }));
    if (app) {
      window.__calls = [];
      window.HubsApp = {
        services: () => JSON.stringify({ version: '2.0', services: [
          { name: 'Lounge', url: 'https://hectorfsv.github.io/lounge/', mic: true },
          { name: 'The Pit', url: 'https://hectorfsv.github.io/the-pit/', mic: false },
          { name: 'Home Assistant', url: '', mic: false }] }),
        open: i => window.__calls.push('open:' + i), talk: () => window.__calls.push('talk'), panel: () => window.__calls.push('panel'), dim: on => window.__calls.push('dim:' + on),
      };
    }
  }, [app, linked]);
  await page.goto(BASE + (query ? '?' + query : ''));
  return { ctx, page, errors, pit };
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

  // 3. in the app: a pod opens its service, the core talks, the gear opens the panel, Home does nothing
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
    await tapAt('#clock'); await page.waitForTimeout(500);
    ok((await page.evaluate(() => window.__calls)).includes('talk'), 'a tap on the core asks the app to talk');
    await page.evaluate(() => window.hub.returned(0)); await page.waitForTimeout(900);
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
} finally {
  await browser.close(); server.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
