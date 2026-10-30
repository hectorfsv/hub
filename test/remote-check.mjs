// node test/remote-check.mjs [--webkit]   The remote (remote.html) against a mock of the stick (test/remote-mock.mjs): real WebKit
// (Safari's engine, 18.4, his iPhone) and, when its cached copy is on this Mac, headless Chromium (the tablet's WebView is
// Chromium; --webkit skips it). Sizes: the tablet upright (533x853 at 1.5x, touch: the main one), sideways, his iPhone
// (440x956 at 3x). One browser at a time, each closed in a finally; a hard timeout ends the run. Nothing real is called.
// Screenshots: test/shots/remote-<size>.png (WebKit), remote-<size>-chromium.png (not committed).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock, TOKEN } from './remote-mock.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const { webkit, chromium } = require(path.resolve(ROOT, '../webkit-check/node_modules/playwright'));
const SHELL = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-x64/chrome-headless-shell');
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const VIEWS = {
  tablet: { viewport: { width: 533, height: 853 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  'tablet-land': { viewport: { width: 853, height: 533 }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true },
  iphone: { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};
// the HUB's channels, read from index.html itself: the remote must show the same keys and names in the same order
const HUB_TV = [...fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').matchAll(/\{k:'([^']+)', group:'[^']*', short:'([^']+)'/g)].map(m => ({ k: m[1], short: m[2] }));

let browser = null, pass = 0, fail = 0, engineName = '';
const KILL = setTimeout(async () => { console.log('\nHARD TIMEOUT (9 min): closing the browser'); try { if (browser) await browser.close(); } catch (e) { /* gone */ } process.exit(3); }, 9 * 60e3);
process.on('SIGINT', async () => { try { if (browser) await browser.close(); } catch (e) { /* gone */ } process.exit(130); });
const ok = (cond, what) => { if (cond) { pass++; console.log('  ok  ', what); } else { fail++; console.log('  FAIL', what); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const mock = await startMock();
const keyCalls = (from = 0) => mock.calls.slice(from).filter(c => c.path === '/api/key' && c.delivered);
const sumKey = (k, from = 0) => keyCalls(from).filter(c => c.body.k === k).reduce((s, c) => s + c.body.n, 0);
const anyKeyRequest = (from = 0) => mock.calls.slice(from).filter(c => c.path === '/api/key');

async function open(view, { query = '', app = false, lane = false, at = '/' } = {}) {
  const ctx = await browser.newContext(Object.assign({ timezoneId: 'America/Los_Angeles' }, VIEWS[view]));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::|ERR_|NetworkError|Load failed|cancelled|aborted/i.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(([app, lane]) => {
    window.__fetchAt = [];                   // where the page stood when it made each call (the key must already be gone)
    const f = window.fetch.bind(window);
    window.fetch = (input, init) => { window.__fetchAt.push({ url: String((input && input.url) || input), href: location.href }); return f(input, init); };
    if (app) {   // the Hubs app's bridge, recording; services() mirrors Hubs.DEFAULT_NAMES (The Pit is index 1)
      window.__dim = []; window.__open = [];
      window.HubsApp = {
        dim: on => window.__dim.push(on),
        panel: () => { window.__panel = (window.__panel || 0) + 1; },
        services: () => JSON.stringify({ services: [{ name: 'Lounge' }, { name: 'The Pit' }, { name: 'Home Assistant' }] }),
        open: i => window.__open.push(i),
      };
      if (lane) {   // the tablet's key lane: press/type answer with the link's state; keyLane() is how the app reports a change
        window.__lane = { state: 'off', presses: [], texts: [] };
        Object.assign(window.HubsApp, {
          keyState: () => window.__lane.state,
          press: (k, n) => { if (window.__lane.state !== 'ok') return window.__lane.state; window.__lane.presses.push(k + '×' + n); return 'ok'; },
          type: t => { if (window.__lane.state !== 'ok') return window.__lane.state; window.__lane.texts.push(t); return 'ok'; },
        });
      }
    }
  }, [app, lane]);
  await page.goto(mock.url + at + (query ? '?' + query : ''));
  return { ctx, page, errors };
}
const until = (page, fn, ms = 3000, arg) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const linked = page => until(page, () => window.remote && remote.state().live && remote.state().apps > 0, 8000);
const st = page => page.evaluate(() => remote.state());
const chip = page => page.evaluate(() => { const c = document.getElementById('chip'); return c.hidden ? '' : c.textContent; });
const segPt = (g, d) => ({ up: [g.cx, g.cy - g.R * .6], right: [g.cx + g.R * .6, g.cy], down: [g.cx, g.cy + g.R * .6], left: [g.cx - g.R * .6, g.cy] })[d];
async function centre(page, sel) { const b = await page.locator(sel).first().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; }
const tap = async (page, sel) => { const [x, y] = await centre(page, sel); await page.touchscreen.tap(x, y); };
// a synthetic finger: for two at once, a cancel, a slide (Playwright drives one pointer at a time)
const finger = (page, type, id, x, y) => page.evaluate(([type, id, x, y]) => {
  const el = document.elementFromPoint(x, y) || document.body;
  el.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: false, button: 0, buttons: /up|cancel/.test(type) ? 0 : 1 }));
}, [type, id, x, y]);
// every animation running now: what it moves (WAAPI keyframes, CSS transitions and animations)
const moving = page => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' || a.playState === 'pending').map(a => {
  const t = a.effect && a.effect.target, who = t ? (t.id || String(t.className && t.className.baseVal != null ? t.className.baseVal : t.className) || t.tagName) : '?';
  let props = [];
  if (a.transitionProperty) props = [a.transitionProperty];
  else if (a.animationName) props = ['css-animation ' + a.animationName];
  else props = [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(p => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)))];
  return { who, props, infinite: a.effect && a.effect.getTiming().iterations === Infinity };
}));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png') });
// Chromium only: the composited layers at rest, by element. At rest no frame is drawn, but during a press the tablet's GPU blends every
// layer each frame, so only the reactor's moving parts, the two scrolling rows and the page may have one (one quiet commit to read them)
async function layersAtRest(page) {
  const c = await page.context().newCDPSession(page);
  await c.send('DOM.getDocument', { depth: -1 });
  const got = new Promise(ok => c.on('LayerTree.layerTreeDidChange', e => { if (e.layers) ok(e.layers); }));
  await c.send('LayerTree.enable');
  let have = false; got.then(() => { have = true; });
  for (let i = 0; i < 20 && !have; i++) { await page.evaluate(() => { const s = document.getElementById('sa'); s.style.width = s.style.width === '2px' ? '1px' : '2px'; }); await sleep(150); }
  const layers = await Promise.race([got, sleep(1000).then(() => null)]), names = [];
  for (const l of layers || []) {
    if (!l.drawsContent) continue;
    const { node } = l.backendNodeId ? await c.send('DOM.describeNode', { backendNodeId: l.backendNodeId }).catch(() => ({})) : {};
    const a = (node && node.attributes) || [], i = a.indexOf('id'), k = a.indexOf('class');
    names.push(node && node.localName ? node.localName + (i >= 0 ? '#' + a[i + 1] : '') + (k >= 0 ? '.' + a[k + 1].split(' ')[0] : '') : '(page)');   // the document has no local name
  }
  await c.send('LayerTree.disable'); await c.detach();
  return layers ? { all: layers.length, names } : null;
}

// every control on screen, uncovered, at least 48 px; nothing scrolls the page; nothing overlaps; nothing inside the reactor's circle
async function layoutChecks(page, name) {
  const L = await page.evaluate(() => {
    const W = innerWidth, H = innerHeight, de = document.documentElement, g = remote.state().geo;
    const sel = ['#reactor', '.pod[data-key=back]', '.pod[data-key=home]', '.pod[data-key=menu]', '[data-key=wake]', '[data-key=sleep]', '[data-key=mute]', '[data-key=volup]', '[data-key=voldown]',
      '[data-key=rewind]', '[data-key=playpause]', '[data-key=forward]', '[data-key=search]', '#type-in', '[data-key=del]', '[data-key=enter]', '#yt-stop', '#yt-full',
      '#apps-rail .orb', '#yt-rail .ch', '#now-name', '#clock', '#link'];
    const items = sel.map(s => {
      const e = document.querySelector(s); if (!e) return { s, missing: true };
      const r = e.getBoundingClientRect(), top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { s, x: r.left, y: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, hit: !!top && (top === e || e.contains(top)) };
    });
    window.scrollTo(300, 300); document.body.scrollLeft = 300; document.body.scrollTop = 300;   // try to move the page: it must not
    const moved = window.scrollX || window.scrollY || document.body.scrollLeft || document.body.scrollTop || de.scrollLeft || de.scrollTop;
    return { W, H, sw: de.scrollWidth, sh: de.scrollHeight, bw: document.body.scrollWidth, moved, g, items };
  });
  const it = L.items;
  ok(L.sw <= L.W && L.bw <= L.W && !L.moved, `${name}: no sideways overflow (${Math.max(L.sw, L.bw)} in ${L.W}; scrolled ${L.moved})`);
  ok(L.sh <= L.H, `${name}: the page never scrolls (${L.sh} in ${L.H})`);
  const off = it.filter(i => i.missing || i.x < -.5 || i.y < -.5 || i.r > L.W + .5 || i.b > L.H + .5).map(i => i.s + (i.missing ? ' missing' : ''));
  ok(!off.length, `${name}: every control on screen${off.length ? ' (off: ' + off.join(', ') + ')' : ''}`);
  const covered = it.filter(i => !i.missing && !i.hit).map(i => i.s);
  ok(!covered.length, `${name}: nothing covers a control (each is what a finger at its centre touches)${covered.length ? ' (covered: ' + covered.join(', ') + ')' : ''}`);
  const small = it.filter(i => !i.missing && !['#now-name', '#clock', '#link', '#reactor'].includes(i.s) && (i.w < 47.5 || i.h < 47.5)).map(i => `${i.s} ${i.w | 0}x${i.h | 0}`);
  ok(!small.length, `${name}: every touch target at least 48 px${small.length ? ' (' + small.join(', ') + ')' : ''}`);
  const boxes = it.filter(i => !i.missing && !['#reactor', '#apps-rail .orb', '#yt-rail .ch'].includes(i.s)), hits = [];
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const A = boxes[a], B = boxes[b], ix = Math.min(A.r, B.r) - Math.max(A.x, B.x), iy = Math.min(A.b, B.b) - Math.max(A.y, B.y);
    if (ix > 1 && iy > 1) hits.push(`${A.s}×${B.s}`);
  }
  ok(!hits.length, `${name}: no control overlaps another${hits.length ? ' (' + hits.join(', ') + ')' : ''}`);
  const g = L.g, inside = boxes.filter(i => { const nx = Math.max(i.x, Math.min(g.cx, i.r)), ny = Math.max(i.y, Math.min(g.cy, i.b)); return Math.hypot(nx - g.cx, ny - g.cy) < g.R - 1; }).map(i => i.s);
  ok(!inside.length, `${name}: nothing sits on the reactor (R ${g.R} px)${inside.length ? ' (' + inside.join(', ') + ')' : ''}`);
  ok(g.R >= (name.startsWith('tablet') ? 150 : 130), `${name}: the d-pad is big (${2 * g.R} px across)`);
}

async function tabletFull() {
  const name = `${engineName} tablet`;
  console.log(`\n${name}: the main size, every control`);
  mock.reset();
  const { ctx, page, errors } = await open('tablet', { query: 'k=' + TOKEN });
  try {
    ok(await linked(page), 'opened with ?k=: linked to the stick, the apps listed');
    const t = await page.evaluate(() => ({ href: location.href, k: localStorage.getItem('hubs.remote.k'), at: window.__fetchAt }));
    ok(!/[?&]k=/.test(t.href), 'the key is gone from the address bar');
    ok(t.k === TOKEN, 'the key is kept on this device');
    ok(t.at.length > 0 && t.at.every(f => !/[?&]k=/.test(f.href)), `every call was made after the key left the address bar (${t.at.length} calls)`);
    const api = mock.calls.filter(c => c.path.startsWith('/api/'));
    ok(api.filter(c => c.path !== '/api/events').length > 0 && api.filter(c => c.path !== '/api/events').every(c => c.auth === 'header'), 'calls carry the key as X-Hubs-Key');
    ok(api.some(c => c.path === '/api/events') && api.filter(c => c.path === '/api/events').every(c => c.auth === 'query'), 'the event stream carries it as ?k=');
    const refs = mock.calls.filter(c => c.referer);
    ok(mock.calls.every(c => !c.referer || (!c.referer.includes(TOKEN) && !/[?&]k=/.test(c.referer))), `no request carries the key, not even in a Referer (${refs.length ? refs.length + ' font loads send the address, already without it' : 'none sent'})`);
    ok(await page.$eval('#now-name', e => e.textContent) === 'NETFLIX' && await page.$eval('#now-ic img', e => e.src.startsWith('data:image/png')).catch(() => false), 'NOW ON TV: the app and its icon');
    await sleep(1800);
    const rest = await moving(page);
    ok(rest.length === 0, `at rest nothing moves: no animation runs (${rest.length}${rest.length ? ': ' + JSON.stringify(rest) : ''})`);
    await layoutChecks(page, 'tablet');
    await shot(page, engineName === 'webkit' ? 'remote-tablet' : 'remote-tablet-chromium');
    if (engineName === 'chromium') {
      const L = await layersAtRest(page), allowed = /^(\(page\)|body|div#tilt|div#r-ticks|div\.fl|div#cflash\.cflash|i#dot\.dot|div\.wave|div#apps-rail\.rail|div#yt-rail\.rail)$/;
      const extra = L ? L.names.filter(n => !allowed.test(n)) : ['(no layer tree)'];
      ok(L && L.all <= 22 && !extra.length, `at rest ${L ? L.all : '?'} layers; only the reactor's moving parts, the scrolling rows and the page draw in one${extra.length ? ' (also: ' + extra.join(', ') + ')' : ''}`);
    }
    const g = (await st(page)).geo;

    // every key sends its own call, once
    const KEYS = [['.pod[data-key=back]', 'back'], ['.pod[data-key=home]', 'home'], ['.pod[data-key=menu]', 'menu'], ['[data-key=sleep]', 'sleep'], ['[data-key=wake]', 'wake'],
      ['[data-key=mute]', 'mute'], ['[data-key=volup]', 'volup'], ['[data-key=voldown]', 'voldown'], ['[data-key=rewind]', 'rewind'], ['[data-key=playpause]', 'playpause'],
      ['[data-key=forward]', 'forward'], ['[data-key=search]', 'search'], ['[data-key=del]', 'del'], ['[data-key=enter]', 'enter']];
    const wrong = [];
    for (const [sel, k] of KEYS) {
      const from = mock.calls.length;
      await tap(page, sel);
      await mock.waitFor(() => keyCalls(from).length > 0, 1500);
      await sleep(60);
      const got = keyCalls(from).map(c => c.body);
      if (!(got.length === 1 && got[0].k === k && got[0].n === 1)) wrong.push(`${k}: ${JSON.stringify(got)}`);
    }
    ok(!wrong.length, `each of the ${KEYS.length} keys sends its own call, once${wrong.length ? ' (' + wrong.join('; ') + ')' : ''}`);
    const pads = [];
    for (const d of ['up', 'right', 'down', 'left']) {
      const from = mock.calls.length; await page.touchscreen.tap(...segPt(g, d));
      await mock.waitFor(() => keyCalls(from).length > 0, 1500); await sleep(60);
      const got = keyCalls(from).map(c => c.body); if (!(got.length === 1 && got[0].k === d && got[0].n === 1)) pads.push(`${d}: ${JSON.stringify(got)}`);
    }
    ok(!pads.length, `a tap on each segment sends its arrow, once${pads.length ? ' (' + pads.join('; ') + ')' : ''}`);
    let from = mock.calls.length;
    await page.touchscreen.tap(g.cx, g.cy);
    await mock.waitFor(() => keyCalls(from).length > 0, 1500); await sleep(80);
    ok(JSON.stringify(keyCalls(from).map(c => c.body)) === '[{"k":"select","n":1}]', 'a tap on the core sends select');

    // a hold repeats after 350 ms, faster and faster, and stops on release
    await sleep(400);
    from = mock.calls.length;
    await page.mouse.move(...segPt(g, 'up')); await page.mouse.down();
    await sleep(1300);
    await page.mouse.up();
    await sleep(150);
    const held = sumKey('up', from), times = keyCalls(from).filter(c => c.body.k === 'up').map(c => c.t);
    await sleep(700);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    ok(held >= 6 && held <= 14, `hold up 1.3 s: ${held} presses`);
    ok(gaps.length > 3 && gaps[0] >= 430 && gaps[0] <= 600 && gaps[gaps.length - 1] < gaps[1], `the first repeat after ~500 ms, so a slow tap is one step (${gaps[0]}), then faster (last gap ${gaps[gaps.length - 1]} ms)`);
    ok(sumKey('up', from) === held, 'released: the repeat stops');
    from = mock.calls.length;
    await finger(page, 'pointerdown', 7, ...segPt(g, 'right'));
    await sleep(900);
    await finger(page, 'pointercancel', 7, ...segPt(g, 'right'));
    await sleep(150);
    const c1 = sumKey('right', from);
    await sleep(700);
    ok(c1 >= 3 && sumKey('right', from) === c1, `pointercancel stops the repeat (${c1} presses, then none)`);
    from = mock.calls.length;
    const [lx, ly] = segPt(g, 'left');
    await finger(page, 'pointerdown', 8, lx, ly);
    await sleep(700);
    await finger(page, 'pointermove', 8, lx, ly - g.R * .75);   // slides off onto the up segment
    await sleep(150);
    const c2 = sumKey('left', from);
    await sleep(600);
    await finger(page, 'pointerup', 8, lx, ly - g.R * .75);
    await sleep(100);
    ok(c2 >= 2 && sumKey('left', from) === c2 && sumKey('up', from) === 0, `sliding off a segment stops its repeat and presses nothing else (${c2} lefts, 0 ups)`);
    from = mock.calls.length;
    const [rx, ry] = segPt(g, 'right');
    await finger(page, 'pointerdown', 21, lx, ly);
    await finger(page, 'pointerdown', 22, rx, ry);
    await sleep(800);
    await finger(page, 'pointerup', 21, lx, ly);
    await sleep(120);
    const l1 = sumKey('left', from), r1 = sumKey('right', from);
    await sleep(500);
    const l2 = sumKey('left', from), r2 = sumKey('right', from);
    await finger(page, 'pointerup', 22, rx, ry);
    await sleep(120);
    const r3 = sumKey('right', from);
    await sleep(500);
    ok(l1 >= 2 && r1 >= 2, `two fingers on two segments: both press and repeat (${l1} lefts, ${r1} rights)`);
    ok(l2 === l1 && r2 > r1, 'one lifts: its repeat stops, the other keeps going');
    ok(sumKey('right', from) === r3 && (await st(page)).pointers === 0, 'both up: all quiet');

    // the trackpad: a drag from the core sends arrows by direction, more the further it goes, batched with n
    await sleep(300);
    const step = (await st(page)).step;
    from = mock.calls.length;
    await page.mouse.move(g.cx, g.cy); await page.mouse.down();
    await page.mouse.move(g.cx + step * 3.4, g.cy + 4, { steps: 1 });
    await sleep(200);
    const fast = keyCalls(from).map(c => c.body);
    ok(fast.length === 1 && fast[0].k === 'right' && fast[0].n === 3, `a fast swipe of 3.4 steps right: one call {right, n:3} (${JSON.stringify(fast)})`);
    await page.mouse.move(g.cx + step * 5.5, g.cy + 6, { steps: 8 });
    await sleep(120);
    await page.mouse.move(g.cx + step * 5.5, g.cy + 6 + step * 2.4, { steps: 6 });
    await page.mouse.up();
    await sleep(250);
    const tot = k => sumKey(k, from);
    ok(tot('right') === 5 && tot('down') === 2 && tot('left') + tot('up') === 0, `then on: 5 rights in all, then 2 downs (got right ${tot('right')}, down ${tot('down')}, left ${tot('left')}, up ${tot('up')})`);
    ok(tot('select') === 0, 'a drag is not a tap: no select');
    from = mock.calls.length;
    await page.mouse.move(g.cx, g.cy); await page.mouse.down();
    await page.mouse.move(g.cx + 6, g.cy - 5, { steps: 3 });   // a wobble under the slop
    await page.mouse.up();
    await sleep(250);
    ok(JSON.stringify(keyCalls(from).map(c => c.body)) === '[{"k":"select","n":1}]', 'a tap that wobbles a few px is still select');

    // nothing animates but transform and opacity, and nothing runs once the press is over
    const seen = new Set(), infinite = [];
    const sample = async () => { for (const a of await moving(page)) { a.props.forEach(p => seen.add(p)); if (a.infinite) infinite.push(a.who); } };
    await page.mouse.move(...segPt(g, 'down')); await page.mouse.down(); await sleep(60); await sample(); await sleep(500); await sample(); await page.mouse.up(); await sleep(40); await sample();
    await page.touchscreen.tap(g.cx, g.cy); await sleep(50); await sample();
    await page.mouse.move(g.cx, g.cy); await page.mouse.down(); await page.mouse.move(g.cx - step * 2.2, g.cy, { steps: 4 }); await sample(); await page.mouse.up(); await sleep(30); await sample();
    await tap(page, '.pod[data-key=menu]'); await sleep(30); await sample();
    await tap(page, '[data-key=playpause]'); await sleep(30); await sample();
    ok([...seen].length > 0 && [...seen].every(p => p === 'transform' || p === 'opacity'), `a press animates only transform and opacity (${[...seen].join(', ')})`);
    ok(!infinite.length, 'no press starts an endless animation');
    await sleep(1400);
    const after = await moving(page);
    ok(after.length === 0, `once the presses are over, nothing moves (${after.length})`);

    // typing: what is added goes as text, what is erased as del, Enter as enter, in order
    from = mock.calls.length;
    await page.locator('#type-in').click();
    await page.keyboard.type('abc', { delay: 40 });
    await sleep(150);
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    await sleep(150);
    await page.keyboard.press('Enter');
    await sleep(250);
    const seq = mock.calls.slice(from).filter(c => c.delivered && (c.path === '/api/text' || c.path === '/api/key'));
    const txt = seq.filter(c => c.path === '/api/text').map(c => c.body.text).join(''), dels = seq.filter(c => c.path === '/api/key' && c.body.k === 'del').reduce((s, c) => s + c.body.n, 0);
    const last = { text: seq.map(c => c.path).lastIndexOf('/api/text'), del: seq.findIndex(c => c.body && c.body.k === 'del'), enter: seq.findIndex(c => c.body && c.body.k === 'enter') };
    ok(txt === 'abc', `typing abc sends the text "abc" (${JSON.stringify(txt)})`);
    ok(dels === 2, `two Backspaces send del x2 (${dels})`);
    ok(last.enter === seq.length - 1 && last.text < last.del && last.del < last.enter, 'Enter sends enter, after the text and the dels');
    ok(await page.$eval('#type-in', e => e.value) === '' && (await st(page)).queue === 0, 'after Enter the pad is clear');
    await page.keyboard.press('Escape');

    // the apps: orbs from /api/apps; a tap opens one on the TV; NOW ON TV follows over the event stream
    const orbs = await page.$$eval('#apps-rail .orb', l => l.map(o => ({ pkg: o.dataset.pkg, name: o.textContent, img: (o.querySelector('img') || {}).src || '' })));
    ok(orbs.length === mock.apps.length && orbs.every((o, i) => o.pkg === mock.apps[i].pkg && o.img.startsWith('data:image/png;base64,')), `the apps as orbs, in the stick's order, with their icons (${orbs.length})`);
    mock.setFront({ pkg: 'com.netflix.ninja', name: 'Netflix' });   // the HUB key earlier brought the HUB to the front
    ok(await until(page, () => (document.querySelector('#apps-rail .orb.live') || {}).dataset?.pkg === 'com.netflix.ninja', 1500), 'the app on the TV wears the live ring');
    from = mock.calls.length;
    await page.locator('#apps-rail .orb[data-pkg="com.disney.disneyplus"]').tap();
    await mock.waitFor(() => mock.calls.slice(from).some(c => c.path === '/api/launch' && c.delivered), 1500);
    const launches = mock.calls.slice(from).filter(c => c.path === '/api/launch').map(c => c.body);
    ok(JSON.stringify(launches) === '[{"pkg":"com.disney.disneyplus"}]', `a tap on an orb: /api/launch {pkg} (${JSON.stringify(launches)})`);
    ok(await until(page, () => document.getElementById('now-name').textContent === 'DISNEY+', 1500), 'NOW ON TV follows the stick (DISNEY+, pushed)');
    mock.setFront({ pkg: 'com.amazon.avod', name: 'Prime Video' });
    ok(await until(page, () => document.getElementById('now-name').textContent === 'PRIME VIDEO' && document.querySelector('#apps-rail .orb.live').dataset.pkg === 'com.amazon.avod', 1500), 'the stick says Prime Video: the name, the icon, the live orb follow');
    mock.setFront({ hub: true });
    ok(await until(page, () => document.getElementById('now-name').textContent === 'THE HUB' && !document.querySelector('#apps-rail .orb.live'), 1500), 'the HUB in front: THE HUB');
    from = mock.calls.length;
    // a swipe along the apps row scrolls it and opens nothing
    const rail = await page.locator('#apps-rail').boundingBox();
    const sc0 = await page.$eval('#apps-rail', e => e.scrollLeft);
    if (engineName === 'chromium') {
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(rail.x + rail.width * .7), y: Math.round(rail.y + rail.height / 2), xDistance: -160, yDistance: 0, gestureSourceType: 'touch', speed: 800 });
      await sleep(300);
      ok(await page.$eval('#apps-rail', e => e.scrollLeft) > sc0 && !mock.calls.slice(from).some(c => c.path === '/api/launch'), 'a swipe along the apps row scrolls it and opens nothing');
    }

    // YouTube on the HUB: the HUB's channels, same keys and names, same order
    const chips = await page.$$eval('#yt-rail .ch', l => l.map(b => ({ k: b.dataset.k, t: b.textContent })));
    ok(HUB_TV.length === 12 && chips.length === HUB_TV.length + 1 && HUB_TV.every((c, i) => chips[i].k === c.k && chips[i].t === c.short.toUpperCase()) && chips[12].k === 'app',
      `the channels are the HUB's (${HUB_TV.length}, read from index.html: same keys, names, order) and the YouTube app`);
    from = mock.calls.length;
    await page.locator('#yt-rail .ch[data-k="cnn"]').tap();
    await page.locator('#yt-full').tap();
    await page.locator('#yt-full').tap();
    await page.locator('#yt-stop').tap();
    await page.locator('#yt-rail .ch[data-k="lomlb"]').tap();
    await page.locator('#yt-rail .ch[data-k="app"]').tap();
    await mock.waitFor(() => mock.calls.slice(from).filter(c => (c.path === '/api/hub' || c.path === '/api/launch') && c.delivered).length >= 6, 2000);
    const hubs = mock.calls.slice(from).filter(c => c.path === '/api/hub' || c.path === '/api/launch').map(c => c.path.slice(5) + ' ' + JSON.stringify(c.body));
    ok(JSON.stringify(hubs) === JSON.stringify(['hub {"do":"yt","k":"cnn"}', 'hub {"do":"yt-full","on":true}', 'hub {"do":"yt-full","on":false}', 'hub {"do":"yt-stop"}', 'hub {"do":"yt","k":"lomlb"}', 'launch {"pkg":"com.amazon.firetv.youtube"}']),
      `a channel plays on the HUB, full screen on and off, stop, another, the YouTube app (${hubs.join(' | ')})`);
    ok(!(await page.$('#yt-rail .ch.on')), 'the YouTube app opened: no channel marked as playing');

    // adb: the TV asks once; keys wait for him, a banner says so
    mock.setAdb('asking');
    ok(await until(page, () => !document.getElementById('banner').hidden && /PRESS OK ON THE TV ONCE/.test(document.getElementById('banner').textContent), 1500), 'adb asking: the banner says PRESS OK ON THE TV ONCE');
    ok(await chip(page) === 'PRESS OK ON THE TV ONCE', 'and so does the status chip');
    from = mock.calls.length;
    await page.touchscreen.tap(...segPt(g, 'up')); await sleep(400);
    ok(anyKeyRequest(from).length === 0, 'a key while the TV asks is not sent');
    mock.setAdb('off');
    ok(await until(page, () => document.getElementById('banner').hidden, 1500), 'adb off: the banner goes');
    from = mock.calls.length;
    await page.touchscreen.tap(...segPt(g, 'up'));
    ok(await until(page, () => /KEYS RETRYING/.test(document.getElementById('chip').textContent) && !document.getElementById('chip').hidden, 1500) && anyKeyRequest(from).length === 1 && keyCalls(from).length === 0,
      'adb off: the key is tried (the stick retries), refused, and the chip says KEYS RETRYING');
    mock.setAdb('ok');
    ok(await until(page, () => document.getElementById('chip').hidden, 1500), 'adb ok: the chip goes');
    from = mock.calls.length;
    await page.touchscreen.tap(...segPt(g, 'up'));
    ok(await mock.waitFor(() => sumKey('up', from) === 1, 1500), 'and keys go through');

    // a slow stick: a key that waited too long is dropped, never sent late
    mock.setDelay(1500);
    from = mock.calls.length;
    await page.touchscreen.tap(...segPt(g, 'up'));
    await sleep(120);
    await page.touchscreen.tap(...segPt(g, 'right')); await page.touchscreen.tap(...segPt(g, 'right'));
    await sleep(2200);
    mock.setDelay(0);
    await sleep(400);
    ok(sumKey('up', from) === 1 && anyKeyRequest(from).filter(c => c.body && c.body.k === 'right').length === 0, `a slow answer (1.5 s): the up lands, the rights pressed behind it are dropped, not sent late (${anyKeyRequest(from).map(c => c.body.k).join(',')})`);

    // offline: the chip says so, keys are dropped, nothing is replayed when it comes back
    mock.setOffline('refuse');
    ok(await until(page, () => /RECONNECTING|STICK OFFLINE/.test(document.getElementById('chip').textContent) && !document.getElementById('chip').hidden, 4000), `the stick goes away: the chip says so (${await chip(page)})`);
    ok(await until(page, () => document.getElementById('chip').textContent === 'STICK OFFLINE', 8000), 'and soon: STICK OFFLINE');
    from = mock.calls.length;
    for (let i = 0; i < 3; i++) await page.touchscreen.tap(...segPt(g, 'up'));
    await page.mouse.move(...segPt(g, 'left')); await page.mouse.down(); await sleep(700); await page.mouse.up();
    await tap(page, '[data-key=playpause]');
    await sleep(300);
    ok(anyKeyRequest(from).length === 0, 'keys pressed while it is offline are not sent (dropped)');
    ok((await st(page)).queue === 0, 'and nothing waits in a queue');
    mock.setOffline(false);
    ok(await until(page, () => remote.state().net === 'ok' && remote.state().live, 9000), 'it comes back: the remote relinks by itself');
    await sleep(1200);
    ok(anyKeyRequest(from).length === 0, 'and replays none of the dropped keys');
    ok(await chip(page) === '', 'the chip goes');
    from = mock.calls.length;
    await page.touchscreen.tap(...segPt(g, 'down'));
    ok(await mock.waitFor(() => sumKey('down', from) === 1, 1500), 'the next key goes through');
    mock.setOffline('hang');
    from = mock.calls.length;
    await page.touchscreen.tap(...segPt(g, 'right')); await page.touchscreen.tap(...segPt(g, 'right')); await page.touchscreen.tap(...segPt(g, 'right'));
    ok(await until(page, () => /RECONNECTING|STICK OFFLINE/.test(document.getElementById('chip').textContent) && !document.getElementById('chip').hidden, 4000), 'a stick that goes silent: the call times out and the chip says so');
    mock.setOffline(false);
    ok(await until(page, () => remote.state().net === 'ok' && remote.state().live, 12000), 'it answers again: relinked');
    await sleep(1200);
    ok(sumKey('right', from) === 0, 'keys from the silent moment are never sent late');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

    // the key stays: the next visit needs no ?k=
    await page.goto(mock.url + '/');
    ok(await linked(page), 'reopened without ?k=: the kept key links it');
  } finally { await ctx.close(); }

  // idle: it stays the remote (Hector 10-30: "just be a controller"); 10 minutes untouched only dims the backlight, and every touch works
  console.log(`\n${name}: idle (?dim=3000, standing in for 10 min)`);
  mock.reset();
  {
    const { ctx, page, errors } = await open('tablet', { query: 'k=' + TOKEN + '&dim=3000', app: true });
    try {
      ok(await linked(page), 'linked');
      ok(await until(page, () => window.__dim.includes(true), 5000), 'untouched: HubsApp.dim(true)');
      ok(!(await page.$('#amb')) && await page.isVisible('#reactor'), 'no other view: the remote is still on screen');
      await sleep(100);
      ok((await moving(page)).length === 0, 'dimmed: nothing moves');
      const g = (await st(page)).geo, from = mock.calls.length;
      await page.touchscreen.tap(...segPt(g, 'up'));
      ok(await mock.waitFor(() => sumKey('up', from) === 1, 1500), 'dimmed, a touch on Up presses Up at once');
      ok(await page.evaluate(() => window.__dim[window.__dim.length - 1] === false), 'and brings the backlight back: HubsApp.dim(false)');
      ok(await until(page, () => window.__dim.filter(x => x).length >= 2, 5000), 'untouched again: dimmed again');
      const o = await page.locator('#apps-rail .orb').first().boundingBox(), from2 = mock.calls.length;
      await page.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2);
      ok(await mock.waitFor(() => mock.calls.slice(from2).some(c => c.path === '/api/launch'), 1500), 'dimmed, a touch on an app opens it: every key works');
      await page.keyboard.press('ArrowLeft');
      ok(await mock.waitFor(() => sumKey('left', from) === 1, 1500), 'a keyboard works it too (ArrowLeft)');
      ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    } finally { await ctx.close(); }
  }

  // the Pit: the button asks the native bridge by name, the same switch the HUB's own service grid uses
  console.log(`\n${name}: the Pit button`);
  mock.reset();
  {
    const { ctx, page, errors } = await open('tablet', { query: 'k=' + TOKEN, app: true });
    try {
      ok(await linked(page), 'linked');
      await page.locator('#pit-btn').tap();
      const opened = await page.evaluate(() => window.__open.slice());
      ok(opened.length === 1 && opened[0] === 1, `HubsApp.open asked for index 1 ("The Pit" in the mock services list), got ${JSON.stringify(opened)}`);
      ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    } finally { await ctx.close(); }
  }

  // the tablet's key lane: keys go through the app's own adb link to the stick, never to /api/key
  console.log(`\n${name}: the tablet's key lane`);
  mock.reset();
  {
    const { ctx, page, errors } = await open('tablet', { query: 'k=' + TOKEN, app: true, lane: true });
    try {
      ok(await linked(page), 'linked');
      const g = (await st(page)).geo;
      let from = mock.calls.length;
      await page.touchscreen.tap(...segPt(g, 'up'));
      ok(await until(page, () => /KEYS RETRYING/.test(document.getElementById('chip').textContent) && !document.getElementById('chip').hidden, 1500),
        'link off: the first press is refused by the app and the chip says KEYS RETRYING');
      await page.evaluate(() => { window.__lane.state = 'asking'; keyLane('asking'); });
      ok(await until(page, () => !document.getElementById('banner').hidden && /PRESS OK ON THE TV ONCE/.test(document.getElementById('banner').textContent), 1500), 'the app says asking: PRESS OK ON THE TV ONCE');
      await page.evaluate(() => { window.__lane.state = 'ok'; keyLane('ok'); });
      ok(await until(page, () => document.getElementById('chip').hidden && document.getElementById('banner').hidden, 1500), 'the app says ok: banner and chip go');
      await page.touchscreen.tap(...segPt(g, 'up'));
      await page.touchscreen.tap(...segPt(g, 'right'));
      ok(await until(page, () => window.__lane.presses.length >= 2, 1500), `keys go through the app (${await page.evaluate(() => window.__lane.presses.join(' '))})`);
      await sleep(300);
      ok(mock.calls.slice(from).every(c => c.path !== '/api/key' && c.path !== '/api/text'), 'and never to the stick\'s /api/key or /api/text');
      from = mock.calls.length;
      await page.locator('.pod[data-key="home"]').tap();
      ok(await mock.waitFor(() => mock.keys('home') === 1, 1500), 'HUB goes to the stick\'s /api/key, not the lane (the lane has no Home: 10-30 it did nothing in Netflix)');
      ok(await until(page, () => document.getElementById('now-name').textContent === 'THE HUB', 1500), 'and the HUB comes to the front');
      ok(!(await page.evaluate(() => window.__lane.presses.some(p => p.startsWith('home')))), 'the lane never saw it');
      ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    } finally { await ctx.close(); }
  }

  // OFF: only ON wakes the TV (his word 10-30); the volume the stick reports
  console.log(`\n${name}: off, on and the volume`);
  mock.reset();
  {
    const { ctx, page, errors } = await open('tablet', { query: 'k=' + TOKEN });
    try {
      ok(await linked(page), 'linked');
      ok(await page.locator('#vol-t').textContent() === 'VOL 15', 'the stick\'s volume shows: VOL 15');
      mock.setVol({ l: 9 });
      ok(await until(page, () => document.getElementById('vol-t').textContent === 'VOL 9', 1500), 'a change on the stick shows at once: VOL 9');
      mock.setVol({ l: 0, mute: true });
      ok(await until(page, () => document.getElementById('vol-t').textContent === 'MUTED' && document.querySelector('[data-key="mute"]').classList.contains('lit'), 1500), 'muted: MUTED, and the mute key is lit');
      mock.setVol({ l: 9, mute: false });
      await page.locator('[data-key="sleep"]').tap();
      ok(await until(page, () => document.body.classList.contains('asleep') && /TV OFF/.test(document.getElementById('now-name').textContent), 1500), 'OFF: the remote says TV OFF · PRESS ON');
      ok(await mock.waitFor(() => mock.keys('sleep') === 1 && mock.state.awake === false, 1500), 'and the stick got sleep');
      const from = mock.calls.length;
      const g = (await st(page)).geo;
      await page.touchscreen.tap(...segPt(g, 'up'));
      await page.locator('[data-key="volup"]').tap();
      await page.locator('.pod[data-key="home"]').tap();
      await page.locator('[data-key="mute"]').tap();
      await sleep(400);
      ok(anyKeyRequest(from).length === 0, 'asleep: arrows, volume, HUB and mute send nothing');
      ok(await until(page, () => /PRESS ON/.test(document.getElementById('toast').textContent), 500), 'and say THE TV IS OFF · PRESS ON');
      await page.locator('[data-key="wake"]').tap();
      ok(await mock.waitFor(() => mock.keys('wake') === 1 && mock.state.awake === true, 1500), 'ON goes out and wakes the stick');
      ok(await until(page, () => !document.body.classList.contains('asleep') && document.getElementById('now-name').textContent === 'THE HUB', 1500), 'awake: the keys are back, THE HUB in front');
      const f2 = mock.calls.length;
      await page.touchscreen.tap(...segPt(g, 'up'));
      ok(await mock.waitFor(() => keyCalls(f2).some(c => c.body.k === 'up'), 1500), 'and an arrow goes out again');
      mock.setAwake(false);   // slept some other way (the stick's own timer)
      ok(await until(page, () => document.body.classList.contains('asleep'), 4500), 'the stick asleep by itself: the remote locks too');
      ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    } finally { await ctx.close(); }
  }

  // no key, a wrong key, the key sheet
  console.log(`\n${name}: the key`);
  mock.reset();
  {
    const { ctx, page, errors } = await open('tablet');
    try {
      await sleep(700);
      ok(await chip(page) === 'KEY NEEDED' && !mock.calls.some(c => c.path.startsWith('/api/')), 'no key at all: KEY NEEDED, and nothing is asked of the stick');
      const from = mock.calls.length;
      await page.touchscreen.tap(...segPt((await st(page)).geo, 'up')); await sleep(200);
      ok(anyKeyRequest(from).length === 0, 'a key without the key goes nowhere');
    } finally { await ctx.close(); }
  }
  {
    const { ctx, page, errors } = await open('tablet', { query: 'k=00000000000000000000000000000000' });
    try {
      ok(await until(page, () => document.getElementById('chip').textContent === 'KEY NEEDED', 4000), 'a wrong key: the stick says 401, the chip says KEY NEEDED');
      ok(mock.calls.filter(c => c.path === '/api/events').length === 1, 'and it does not keep knocking');
      await page.locator('#chip').tap();
      ok(await until(page, () => !document.getElementById('sheet').hidden, 1000), 'a tap on the chip opens the key sheet');
      await page.locator('#sh-k').fill(TOKEN);
      await page.locator('#sheet button.go').tap();
      ok(await linked(page), 'the right key pasted: linked');
      ok(await page.evaluate(() => localStorage.getItem('hubs.remote.k')) === TOKEN, 'and kept');
      ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    } finally { await ctx.close(); }
  }
  {
    const { ctx, page, errors } = await open('tablet', { query: 'k=' + TOKEN + '&sse=es' });
    try {
      ok(await linked(page) && (await st(page)).streams === false, 'the EventSource fallback links too');
      mock.setFront({ pkg: 'com.tubitv', name: 'Tubi' });
      ok(await until(page, () => document.getElementById('now-name').textContent === 'TUBI', 2000), 'and follows the stick');
      ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    } finally { await ctx.close(); }
  }
}

async function otherSize(view) {
  console.log(`\n${engineName} ${view}`);
  mock.reset();
  const { ctx, page, errors } = await open(view, { query: 'k=' + TOKEN });
  try {
    ok(await linked(page), 'linked');
    await sleep(1800);
    ok((await moving(page)).length === 0, 'at rest nothing moves');
    await layoutChecks(page, view);
    await shot(page, engineName === 'webkit' ? 'remote-' + view : `remote-${view}-chromium`);
    const g = (await st(page)).geo;
    let from = mock.calls.length;
    await page.touchscreen.tap(g.cx, g.cy); await page.touchscreen.tap(...segPt(g, 'left'));
    await tap(page, '[data-key=volup]'); await tap(page, '.pod[data-key=back]'); await tap(page, '[data-key=sleep]'); await tap(page, '[data-key=wake]');
    await mock.waitFor(() => keyCalls(from).length >= 6, 2000); await sleep(80);
    ok(keyCalls(from).map(c => c.body.k).join(',') === 'select,left,volup,back,sleep,wake', `OK, an arrow, volume, back, off, on: each its call (${keyCalls(from).map(c => c.body.k).join(',')})`);
    const step = (await st(page)).step;
    from = mock.calls.length;
    await page.mouse.move(g.cx, g.cy); await page.mouse.down(); await page.mouse.move(g.cx, g.cy - step * 2.5, { steps: 1 }); await page.mouse.up();
    await sleep(250);
    ok(JSON.stringify(keyCalls(from).map(c => c.body)) === '[{"k":"up","n":2}]', `a swipe up of 2.5 steps: {up, n:2} (${JSON.stringify(keyCalls(from).map(c => c.body))})`);
    from = mock.calls.length;
    await page.locator('#type-in').click(); await page.keyboard.type('hi'); await page.keyboard.press('Enter'); await sleep(250);
    ok(mock.calls.slice(from).filter(c => c.path === '/api/text' && c.delivered).map(c => c.body.text).join('') === 'hi' && sumKey('enter', from) === 1, 'typing works');
    await page.keyboard.press('Escape');
    from = mock.calls.length;
    await page.locator('#apps-rail .orb').nth(1).tap();
    ok(await mock.waitFor(() => mock.calls.slice(from).some(c => c.path === '/api/launch' && c.delivered && c.body.pkg === mock.apps[1].pkg), 1500), 'an orb opens its app');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } finally { await ctx.close(); }
}

// the tablet as the controller (10-30, his ask): the HUB drawn as on the TV (served by the stick at /hub?ctl), every touch to the TV
async function controller() {
  console.log(`\n${engineName} controller: the HUB on the tablet, driving the TV`);
  mock.reset();
  const { ctx, page, errors } = await open('tablet-land', { at: '/hub', query: 'ctl&boot=0&dim=6000&k=' + TOKEN, app: true, lane: true });
  try {
    await page.evaluate(() => { window.__lane.state = 'ok'; });
    const c = () => page.evaluate(() => window.hub.ctl());
    ok(await until(page, () => window.hub && window.hub.ctl && window.hub.ctl().link === 'ok' && window.hub.ctl().apps > 0, 8000), 'linked to the stick, the ring holds the stick\'s apps');
    const geo = await page.evaluate(() => ({ W: innerWidth, H: innerHeight, sw: document.documentElement.scrollWidth, cls: document.body.className, url: location.href, k: localStorage.getItem('hubs.remote.k') }));
    ok(engineName === 'webkit' || geo.W === 1443, `the TV's own width: ${geo.W} CSS px (1443 on the TV)`);
    ok(/\bctl\b/.test(geo.cls) && /\btv\b/.test(geo.cls), 'the TV\'s layout, in controller mode');
    ok(!/k=/.test(geo.url) && geo.k === TOKEN, 'the key left the address and is kept where the remote keeps it');
    ok(geo.sw <= geo.W, `no sideways overflow (${geo.sw} in ${geo.W})`);
    ok(await until(page, () => !document.body.classList.contains('landing') && !document.getElementById('boot'), 5000), 'the boot is over');
    ok(await page.evaluate(() => document.getElementById('c-chip').hidden), 'an idle key link shows no chip (only a refused press does)');
    await sleep(300);
    await shot(page, 'ctl-tablet-land');
    const shown = await page.evaluate(() => [...document.querySelectorAll('.pod,.label')].map(e => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return (e.id || e.className) + ':' + (b.width > 10 && +cs.opacity > .05 ? 'on' : 'OFF'); }));
    ok(shown.every(x => x.endsWith(':on')), `every pod and its label drawn (${shown.join(' ')})`);
    const boxes = await page.evaluate(() => {
      const r = e => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const bar = r(document.getElementById('ctl'));
      const hub = [...document.querySelectorAll('#reactor,.pod,.label,.tapp,#tvcol,#yt-ch .ch,#foot')].filter(e => e.getClientRects().length).map(e => ({ id: e.id || e.className, ...r(e) }));
      const keys = [...document.querySelectorAll('#ctl .ck')].map(e => ({ k: e.dataset.k || e.id, ...r(e) }));
      return { bar, over: hub.filter(h => h.b > bar.t + 1).map(h => h.id), keys, vh: innerHeight, vw: innerWidth };
    });
    ok(boxes.bar.b <= boxes.vh + 1 && boxes.bar.t >= boxes.vh - 100, `the key bar sits at the bottom (${Math.round(boxes.bar.t)}-${Math.round(boxes.bar.b)} of ${boxes.vh})`);
    ok(!boxes.over.length, 'nothing of the HUB reaches into the bar' + (boxes.over.length ? ': ' + boxes.over.join(', ') : ''));
    ok(boxes.keys.every(k => k.r <= boxes.vw + 1 && k.l >= -1 && (k.r - k.l) * (1280 / boxes.vw) >= 64), `every key on screen and at least 64 px wide on the glass (${boxes.keys.length} keys)`);
    ok(await page.locator('#c-now').textContent() === 'NETFLIX' && await page.locator('#c-vol').textContent() === 'VOL 15', 'NOW ON TV: NETFLIX, VOL 15');

    // the clock is the arrows and OK
    const g = await page.evaluate(() => { const b = document.getElementById('reactor').getBoundingClientRect(); return { cx: b.left + b.width / 2, cy: b.top + b.height / 2, R: b.width / 2 }; });
    const pr = () => page.evaluate(() => window.__lane.presses.slice());
    let n0 = (await pr()).length;
    await page.touchscreen.tap(g.cx, g.cy);
    await page.touchscreen.tap(g.cx + g.R * .8, g.cy);
    await page.touchscreen.tap(g.cx, g.cy - g.R * .8);
    ok(await until(page, n => window.__lane.presses.length >= n + 3, 1500, n0) && (await pr()).slice(n0).join(' ') === 'select×1 right×1 up×1', `a tap: the middle is OK, a side its arrow (${(await pr()).slice(n0).join(' ')})`);
    n0 = (await pr()).length;
    const cdp = engineName === 'chromium' ? await ctx.newCDPSession(page) : null;
    if (cdp) {
      const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
      await tp('touchStart', g.cx + 40, g.cy);
      for (let k = 1; k <= 10; k++) { await tp('touchMove', g.cx + 40 - k * 20, g.cy + k); await sleep(16); }
      await tp('touchEnd');
      await sleep(250);
      const got = (await pr()).slice(n0), lefts = got.filter(p => p.startsWith('left')).reduce((s, p) => s + +p.split('×')[1], 0);
      ok(lefts === 3 && got.every(p => p.startsWith('left')), `a swipe of 200 px left walks 3 lefts and nothing else (${got.join(' ')})`);
    }

    // the ring, the pods, the channels
    let from = mock.calls.length;
    await page.locator('.tapp').nth(1).tap();
    ok(await mock.waitFor(() => mock.calls.slice(from).some(c => c.path === '/api/launch' && c.delivered && c.body.pkg === mock.apps[1].pkg), 1500), 'an app on the ring opens on the TV (/api/launch)');
    from = mock.calls.length;
    await page.locator('.pod.pit').tap();
    ok(await mock.waitFor(() => mock.calls.slice(from).some(c => c.path === '/api/hub' && c.delivered && c.body.do === 'open' && c.body.i === 1), 1500), 'The Pit\'s pod opens The Pit on the TV (/api/hub open 1)');
    from = mock.calls.length;
    await page.locator('#yt-ch .ch[data-k="cnn"]').tap();
    ok(await mock.waitFor(() => mock.calls.slice(from).some(c => c.path === '/api/hub' && c.body.do === 'yt' && c.body.k === 'cnn'), 1500), 'a channel plays on the TV\'s tile (/api/hub yt cnn)');
    ok(await until(page, () => /PLAYING ON THE TV/.test(document.getElementById('yt-hint').textContent) && document.querySelector('#yt-ch .ch.on') && !document.querySelector('#yt-scr iframe'), 1500), 'the tile here says PLAYING ON THE TV, and plays nothing itself');
    await page.locator('#yt-scr').tap();
    ok(await mock.waitFor(() => mock.calls.slice(from).some(c => c.path === '/api/hub' && c.body.do === 'yt-full' && c.body.on === true), 1500), 'a tap on the tile: full screen on the TV');
    await page.locator('#yt-ch .ch[data-k="cnn"]').tap();
    ok(await mock.waitFor(() => mock.calls.slice(from).some(c => c.path === '/api/hub' && c.body.do === 'yt-stop'), 1500), 'the same channel again stops it');

    // the bar
    n0 = (await pr()).length; from = mock.calls.length;
    await page.locator('#ctl [data-k="back"]').tap(); await page.locator('#ctl [data-k="volup"]').tap(); await page.locator('#ctl [data-k="mute"]').tap();
    ok(await until(page, n => window.__lane.presses.length >= n + 3, 1500, n0) && (await pr()).slice(n0).join(' ') === 'back×1 volup×1 mute×1', `BACK, VOL +, MUTE go through the tablet's key lane (${(await pr()).slice(n0).join(' ')})`);
    await page.locator('#ctl [data-k="home"]').tap();
    ok(await mock.waitFor(() => mock.keys('home') === 1, 1500), 'HUB goes to the stick itself');
    ok(await until(page, () => document.getElementById('c-now').textContent === 'THE HUB', 1500), 'and NOW ON TV follows: THE HUB');
    mock.setVol({ l: 0, mute: true });
    ok(await until(page, () => document.getElementById('c-vol').textContent === 'MUTED' && document.getElementById('c-mute').classList.contains('lit'), 1500), 'muted on the stick: MUTED, the mute key lit');
    mock.setVol({ l: 9, mute: false });
    ok(await until(page, () => document.getElementById('c-vol').textContent === 'VOL 9', 1500), 'VOL 9');
    await page.locator('#c-type').tap();
    await page.locator('#c-ti').fill('abc');
    ok(await until(page, () => window.__lane.texts.join('') === 'abc', 1500), `TYPE: the text goes out live (${await page.evaluate(() => window.__lane.texts.join(''))})`);
    await page.locator('#c-x').tap();

    // off: only ON wakes it
    await page.locator('#ctl [data-k="sleep"]').tap(); mock.setAwake(false);
    ok(await until(page, () => document.body.classList.contains('asleep') && /TV OFF/.test(document.getElementById('c-now').textContent), 1500), 'OFF: TV OFF · PRESS ON');
    n0 = (await pr()).length; from = mock.calls.length;
    await page.touchscreen.tap(g.cx, g.cy); await page.locator('#ctl [data-k="volup"]').tap(); await page.locator('#ctl [data-k="home"]').tap(); await page.locator('.tapp').nth(0).tap();
    await sleep(400);
    ok((await pr()).length === n0 && !mock.calls.slice(from).some(c => c.method !== 'GET' && c.path.startsWith('/api/') && c.path !== '/api/events'), 'asleep: OK, VOL, HUB and an app send nothing');
    await page.locator('#ctl [data-k="wake"]').tap(); mock.setAwake(true);
    ok(await until(page, () => !document.body.classList.contains('asleep'), 4500), 'ON: awake again');
    n0 = (await pr()).length;
    await page.touchscreen.tap(g.cx, g.cy);
    ok(await until(page, n => window.__lane.presses.length > n, 1500, n0), 'and OK goes out again');

    // a story stays on the TV; the screen dims after its quiet time and any touch still acts
    const href = await page.evaluate(() => location.href);
    if (await page.locator('.nw').count()) { await page.locator('.nw').first().tap(); await sleep(300); }
    ok(await page.evaluate(() => location.href) === href, 'a news row never takes this page away');
    ok(await until(page, () => document.body.classList.contains('dim') && window.__dim.includes(true), 8000), 'quiet: the tablet\'s screen dims (?dim=6000 here; 10 minutes for real)');
    n0 = (await pr()).length;
    await page.touchscreen.tap(g.cx, g.cy);
    ok(await until(page, n => !document.body.classList.contains('dim') && window.__dim[window.__dim.length - 1] === false && window.__lane.presses.length > n, 1500, n0), 'a touch brightens it and still presses OK');
    await page.locator('#gear').tap();
    ok(await page.evaluate(() => window.__panel === 1), 'the gear opens the tablet\'s own panel');
    ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  } finally { await ctx.close(); }
}

const engines = [['webkit', webkit, {}]];
if (!process.argv.includes('--webkit')) {
  if (fs.existsSync(SHELL)) engines.push(['chromium', chromium, { executablePath: SHELL }]);
  else console.log('(Chromium: no cached headless shell on this Mac, skipped; nothing is downloaded)');
}
try {
  for (const [n, eng, opts] of engines) {
    engineName = n;
    console.log(`\n═══ ${n.toUpperCase()} ═══`);
    browser = await eng.launch(opts);
    try {
      await tabletFull();
      await otherSize('tablet-land');
      await otherSize('iphone');
      if (n === 'chromium') await controller();   // the tablet's web view is Chromium; WebKit's synthetic taps land ~11% off on a page zoomed to 1443 px (measured 10-30)
    } finally { await browser.close(); browser = null; }
  }
} finally {
  await mock.close();
  clearTimeout(KILL);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
