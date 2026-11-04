// Integration check for the streamed realistic Viking island (opt-in variant `?island=realistic`).
// Needs a dev server: `npx vite --port 5180`. Usage: node e2e/island-realistic-check.cjs [--gpu]  (BASE=... to override)
// Writes screenshots and results to docs/exploration/stage4/.
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('playwright-core')); }
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.BASE || 'http://127.0.0.1:5180/';
const VARIANT = process.env.VARIANT ?? '';   // the realistic island is the default; VARIANT='?island=realistic' also works
const OUT = path.join(__dirname, '..', 'docs', 'exploration', 'stage4');
const gpu = process.argv.includes('--gpu');
const KEY = 'curiotrail.progress';
const results = [];
let failures = 0;
const freshSave = { version: 3, player: { name: 'Tester', emblem: 'owl' }, quests: {}, achievements: [], lessons: [] };

function expect(ok, message) { if (!ok) throw new Error(message); }
async function check(id, title, fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    results.push({ id, title, status: 'pass', ms: Date.now() - t0, detail });
    console.log(`PASS ${id} ${title}`);
  } catch (error) {
    failures += 1;
    results.push({ id, title, status: 'fail', ms: Date.now() - t0, error: String(error.message || error) });
    console.log(`FAIL ${id} ${title}\n     ${error.message || error}`);
  }
}

async function open(browser, hash = '#/explore') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.errors = []; page.failed = []; page.bytes = 0;
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('requestfailed', (r) => page.failed.push(`${r.url()} ${r.failure()?.errorText}`));
  page.on('response', async (r) => {
    if (r.status() >= 400) page.failed.push(`${r.url()} HTTP ${r.status()}`);
    if (/island-realistic|nav-island-realistic|islands\/realistic/.test(r.url())) {
      try { page.bytes += (await r.body()).length; } catch { /* aborted */ }
    }
  });
  await page.goto(BASE);
  await page.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('curiotrail.explore.controls-seen', '1'); sessionStorage.clear(); }, [KEY, freshSave]);
  page.bytes = 0;
  page.t0 = Date.now();
  await page.goto(BASE + VARIANT + hash);
  return page;
}
const stats = (page) => page.evaluate(() => window.__curioWorld?.stats());
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 82 });
async function waitExplore(page) {
  await page.waitForFunction(() => window.__curioWorld?.stats()?.explore?.active && window.__curioWorld.stats().explore.player, null, { timeout: 90000 });
}
async function settle(page, ms = 15000) {
  await page.waitForFunction(() => { const s = window.__curioWorld?.stats()?.streamed; return s && s.loading === 0; }, null, { timeout: ms }).catch(() => {});
  await page.waitForTimeout(700);
}
async function hold(page, keys, ms) { for (const k of keys) await page.keyboard.down(k); await page.waitForTimeout(ms); for (const k of keys.reverse()) await page.keyboard.up(k); }
async function frameStats(page, seconds = 3) {
  return page.evaluate(async (sec) => {
    const times = []; let last = performance.now();
    await new Promise((res) => { const end = last + sec * 1000; const f = (t) => { times.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    times.sort((a, b) => a - b);
    const s = window.__curioWorld.stats();
    return { fps: +(1000 / (times.reduce((a, b) => a + b, 0) / times.length)).toFixed(1), p95ms: +times[Math.floor(times.length * 0.95)].toFixed(1), drawCalls: s.drawCalls, triangles: s.triangles, geometries: s.geometries, textures: s.textures, tiles: s.streamed };
  }, seconds);
}
/** Walk-grid height under a Three.js point (null = blocked / water), read from the game's own NavGrid. */
const navHeight = (page, x, z) => page.evaluate(([x, z]) => window.__curioWorld.explore.nav.height(x, z), [x, z]);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
  const page = await open(browser);
  const perf = {};

  await check('R1', 'Load the realistic island and spawn the Pathfinder on walkable ground (first view)', async () => {
    await waitExplore(page);
    const ready = Date.now() - page.t0;
    const s = await stats(page);
    const p = s.explore.player;
    const h = await navHeight(page, p.x, p.z);
    expect(h !== null && Math.abs(h - p.y) < 0.05, `spawn not on the walk grid: ${JSON.stringify(p)} grid ${h}`);
    expect(s.streamed && s.streamed.tiles === 28, `expected 28 tiles in the manifest: ${JSON.stringify(s.streamed)}`);
    perf.firstView = { readyMs: ready, bytes: page.bytes, tilesLoaded: s.streamed.loaded };
    await settle(page); await shot(page, 'r1-spawn-third-person');
    return perf.firstView;
  });

  await check('R2', 'All 28 tiles and the shared library load with no failed requests', async () => {
    await page.evaluate(() => window.__curioWorld.explore.place(0, 0));          // island centre: every tile is within the load radius
    await page.waitForFunction(() => window.__curioWorld.stats().streamed.loaded === 28, null, { timeout: 60000 });
    const s = await stats(page);
    expect(!page.failed.length, `failed requests: ${page.failed.slice(0, 3).join(' | ')}`);
    perf.allTiles = { bytes: page.bytes, loaded: s.streamed.loaded, loads: s.streamed.loads };
    return perf.allTiles;
  });

  await check('R3', 'Walk across a tile boundary (x = 0, -96 or 96) without a step, gap or stop', async () => {
    // find a straight, walkable east-west line across a tile edge (tiles are 96 m; edges at x = -96, 0, 96)
    const start = await page.evaluate(() => {
      const nav = window.__curioWorld.explore.nav;
      for (const bx of [0, -96, 96]) {
        for (let z = -200; z < 200; z += 1) {
          let ok = true; let prev = null;
          for (let x = bx - 12; x <= bx + 14; x += 1) {
            const h = nav.height(x + 0.5, z + 0.5);
            if (h === null || (prev !== null && Math.abs(h - prev) > 0.5)) { ok = false; break; }
            prev = h;
          }
          if (ok) return { x: bx - 11.5, z: z + 0.5, edge: bx };
        }
      }
      return null;
    });
    expect(start, 'no straight walkable line across any tile boundary');
    await page.evaluate(({ x, z }) => { const e = window.__curioWorld.explore; e.place(x, z, Math.PI / 2); e.yaw = Math.PI / 2; }, start);
    await settle(page);
    const samples = [];
    await page.keyboard.down('Shift'); await page.keyboard.down('KeyW');
    for (let k = 0; k < 14; k += 1) {
      await page.waitForTimeout(500);
      const s = await stats(page);
      samples.push({ ...s.explore.player, grid: await navHeight(page, s.explore.player.x, s.explore.player.z), loaded: s.streamed.loaded });
    }
    await page.keyboard.up('KeyW'); await page.keyboard.up('Shift');
    const end = samples[samples.length - 1];
    expect(end.x > start.edge + 2, `did not cross the tile edge x = ${start.edge}: ${JSON.stringify(end)}`);
    for (const p of samples) expect(p.grid !== null && Math.abs(p.grid - p.y) < 0.6, `off the walk grid at ${JSON.stringify(p)}`);
    await shot(page, 'r3-tile-boundary');
    return { start, end: { x: end.x, y: end.y, z: end.z }, samples: samples.length };
  });

  await check('R4', 'Distant tiles unload and reload as the player moves', async () => {
    // The island is 577 m across and tiles unload beyond 420 m, so only opposite corners are far enough apart:
    // stand on the north-east coast, then the south-west coast.
    const corners = await page.evaluate(() => {
      const nav = window.__curioWorld.explore.nav; let ne = null, sw = null;
      for (let x = -290; x < 290; x += 2) for (let z = -290; z < 290; z += 2) {
        if (nav.height(x + 0.5, z + 0.5) === null) continue;
        const k = x - z;                         // north-east = large x, small z
        if (!ne || k > ne.k) ne = { x: x + 0.5, z: z + 0.5, k };
        if (!sw || k < sw.k) sw = { x: x + 0.5, z: z + 0.5, k };
      }
      return { ne, sw };
    });
    await page.evaluate(({ ne }) => window.__curioWorld.explore.place(ne.x, ne.z), corners);
    await page.waitForTimeout(1500); await settle(page);
    const before = await stats(page);
    await page.evaluate(({ sw }) => window.__curioWorld.explore.place(sw.x, sw.z), corners);
    await page.waitForTimeout(1500); await settle(page);
    const far = await stats(page);
    expect(far.streamed.unloads > before.streamed.unloads, `nothing unloaded: ${JSON.stringify(far.streamed)}`);
    expect(far.streamed.loaded < 28, `still every tile loaded: ${JSON.stringify(far.streamed)}`);
    await page.evaluate(() => window.__curioWorld.explore.place(-22.5, -69.5));
    await page.waitForTimeout(1500); await settle(page);
    const back = await stats(page);
    expect(back.streamed.loads > far.streamed.loads, `nothing reloaded: ${JSON.stringify(back.streamed)}`);
    const h = await navHeight(page, back.explore.player.x, back.explore.player.z);
    expect(h !== null, 'not on walkable ground after returning');
    return { corners, before: before.streamed, far: { ...far.streamed, geometries: far.geometries, textures: far.textures }, back: { ...back.streamed, geometries: back.geometries, textures: back.textures } };
  });

  await check('R5', 'Terrain height follows the walk grid; buildings and the sea block the player', async () => {
    // walk at the great hall's west wall (hall centre: x 111.5, z 34.5)
    await page.evaluate(() => { const e = window.__curioWorld.explore; e.place(80, 34.5, Math.PI / 2); e.yaw = Math.PI / 2; });
    await settle(page);
    await hold(page, ['Shift', 'KeyW'], 9000);
    const hall = (await stats(page)).explore.player;
    expect(hall.x < 99.5, `walked into the great hall: ${JSON.stringify(hall)}`);
    // walk south into the sea from the south beach
    await page.evaluate(() => { const e = window.__curioWorld.explore; const s = e.nav.nearestWalkable(-11.5, 200, 20); e.place(s.x, s.z, 0); e.yaw = 0; });
    await settle(page);
    await hold(page, ['Shift', 'KeyW'], 8000);
    const sea = (await stats(page)).explore.player;
    const h = await navHeight(page, sea.x, sea.z);
    expect(h !== null && Math.abs(h - sea.y) < 0.6, `left the walkable island: ${JSON.stringify(sea)}`);
    return { stoppedAtHallX: hall.x, beach: sea };
  });

  await check('R6', 'Materials: textured buildings and terrain, striped sails, alpha-tested trees, tinted ships', async () => {
    await page.evaluate(() => window.__curioWorld.explore.place(-22.5, -69.5));
    await settle(page);
    const m = await page.evaluate(() => {
      const scene = window.__curioWorld.scene; const out = {};
      scene.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        for (const mat of [].concat(o.material)) {
          const k = mat.name || '(unnamed)';
          if (!out[k]) out[k] = { map: !!mat.map, uv: !!o.geometry.attributes.uv, alphaTest: mat.alphaTest, vertexColors: mat.vertexColors, count: 0 };
          out[k].count += 1;
        }
      });
      return out;
    });
    for (const n of ['OPT_Thatch', 'OPT_WoodLight', 'OPT_WoodDark', 'OPT_Stone']) expect(m[n]?.map && m[n]?.uv, `${n} missing texture or UVs: ${JSON.stringify(m[n])}`);
    expect(m.OPT_Sail?.map, 'sail has no texture');
    expect(m.OPT_ShipWood?.vertexColors, 'ship tints missing');
    expect(Object.keys(m).some((k) => k.startsWith('CHK_Terrain') && m[k].map), 'terrain tiles have no baked texture');
    expect(Object.entries(m).some(([k, v]) => k === 'OPT_Needles' && v.alphaTest > 0), 'needles are not alpha-tested');
    // screenshots for the visual review
    const views = {
      'r6-village-third-person': async () => { await page.evaluate(() => { const e = window.__curioWorld.explore; e.place(-22.5, -69.5, -Math.PI / 2); e.yaw = -Math.PI / 2; e.pitch = 0.12; }); },
      'r6-docks-sails': async () => { await page.evaluate(() => { const e = window.__curioWorld.explore; const s = e.nav.nearestWalkable(-60, -110, 12); e.place(s.x, s.z, Math.PI); e.yaw = Math.PI * 0.9; e.pitch = 0.05; }); },
      'r6-great-hall': async () => { await page.evaluate(() => { const e = window.__curioWorld.explore; const s = e.nav.nearestWalkable(84, 30, 10); e.place(s.x, s.z, Math.PI / 2); e.yaw = Math.PI / 2; e.pitch = 0.2; }); },
      'r6-first-person-forest': async () => { await page.evaluate(() => { const e = window.__curioWorld.explore; const s = e.nav.nearestWalkable(-14.6, 170.5, 10); e.place(s.x, s.z, 0); e.yaw = 0.3; }); await page.keyboard.press('KeyV'); },
    };
    for (const [name, go] of Object.entries(views)) { await go(); await page.waitForTimeout(1200); await settle(page); await shot(page, name); }
    await page.keyboard.press('KeyV');
    return m;
  });

  await check('R7', 'NPC dialogue and a quest trigger work on the realistic island (existing systems)', async () => {
    await page.evaluate(() => { const e = window.__curioWorld.explore; const n = window.__curioWorld.stats().explore.npcs.mira; e.place(n.x + 1.6, n.z, -Math.PI / 2); });
    await page.waitForTimeout(900);
    await page.getByText('Talk to Mira').first().waitFor({ timeout: 8000 });
    await page.keyboard.press('KeyE');
    await page.getByRole('button', { name: 'Continue' }).first().waitFor({ timeout: 5000 });
    await shot(page, 'r7-mira-dialogue');
    await page.keyboard.press('Escape');
    // Signal Woods is available on a fresh save: E at its marker opens the existing quest route
    await page.evaluate(() => { const e = window.__curioWorld.explore; e.place(-11.5, 171.5 + 1.2, Math.PI); });
    await settle(page);
    await page.waitForTimeout(900);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => location.hash.startsWith('#/quest/'), null, { timeout: 10000 });
    const hash = await page.evaluate(() => location.hash);
    await page.waitForTimeout(1500);
    await shot(page, 'r7-quest-from-explore');
    await page.getByRole('link', { name: 'Return to the island' }).first().click({ timeout: 10000 });
    await waitExplore(page);
    const p = (await stats(page)).explore.player;
    expect(Math.hypot(p.x + 11.5, p.z - 172.7) < 3, `did not return to the same spot: ${JSON.stringify(p)}`);
    return { questRoute: hash, returnedTo: p };
  });

  await check('R8', 'Performance in exploration and on the map (this machine)', async () => {
    await page.evaluate(() => { const e = window.__curioWorld.explore; e.place(-22.5, -69.5, Math.PI); e.yaw = Math.PI; });
    await settle(page);
    perf.exploreVillage = await frameStats(page);
    await page.evaluate(() => { location.hash = '#/map'; });
    await page.waitForTimeout(3500); await settle(page);
    perf.map = await frameStats(page);
    await shot(page, 'r8-map-overview');
    return perf;
  });

  await check('R9', 'No console errors and no missing assets', async () => {
    expect(!page.errors.length, `console errors: ${page.errors.slice(0, 3).join(' | ')}`);
    expect(!page.failed.length, `failed requests: ${page.failed.slice(0, 3).join(' | ')}`);
    return { errors: 0, failed: 0 };
  });

  const renderer = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }).catch(() => 'unknown');
  await browser.close();
  const passed = results.filter((r) => r.status === 'pass').length;
  fs.writeFileSync(path.join(OUT, gpu ? 'results-gpu.json' : 'results.json'), JSON.stringify({ date: new Date().toISOString(), base: BASE + VARIANT, gpu, renderer, passed, failed: failures, perf, results }, null, 2));
  console.log(`${passed}/${results.length} passed`);
  process.exit(failures ? 1 : 0);
})();
