// Stage 3 vertical-slice acceptance test for free exploration (brief, Phase 4).
// Needs the dev server: `npx vite --port 5199`. Usage: node e2e/explore-check.cjs [--gpu]
// Writes screenshots and results to docs/exploration/stage3/.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'http://localhost:5199/';
const OUT = path.join(__dirname, '..', 'docs', 'exploration', 'stage3');
const gpu = process.argv.includes('--gpu');
const KEY = 'curiotrail.progress';
const results = [];
let failures = 0;

const freshSave = { version: 3, player: { name: 'Tester', emblem: 'owl' }, quests: {}, achievements: [], lessons: [] };
const record = (xp) => ({ run: null, runXp: 0, lastRun: null, lastXp: xp, bestXp: xp, bestStars: 3, completed: true, completions: 1 });
const afterSignal = { ...freshSave, quests: { 'missing-signal': record(120) }, achievements: ['signal-restorer'] };

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

async function openWith(browser, save, hash = '#/explore', opts = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  if (opts.route) await page.route(opts.route, (r) => r.abort());
  await page.goto(BASE);
  await page.evaluate(([k, v]) => { localStorage.setItem(k, JSON.stringify(v)); localStorage.setItem('curiotrail.explore.controls-seen', '1'); sessionStorage.clear(); }, [KEY, save]);
  await page.goto(BASE + hash);
  await page.reload();
  return page;
}

const stats = (page) => page.evaluate(() => window.__curioWorld?.stats());
const player = async (page) => (await stats(page))?.explore?.player;
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
async function waitReady(page) {
  await page.waitForFunction(() => window.__curioWorld?.stats()?.explore?.active && window.__curioWorld.stats().explore.player, null, { timeout: 60000 });
  await page.waitForTimeout(600);
}
async function hold(page, key, ms) { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); }
async function placeFacing(page, x, z, tx, tz) {
  await page.evaluate(([x, z, tx, tz]) => {
    const e = window.__curioWorld.explore;
    e.place(x, z, Math.atan2(tx - x, tz - z));
  }, [x, z, tx, tz]);
  await page.waitForTimeout(500);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
  const page = await openWith(browser, freshSave);
  let worldId;
  let leftAt;

  await check('X1', 'Load the island and spawn as the Pathfinder (third person)', async () => {
    await waitReady(page);
    const s = await stats(page);
    expect(s.mode === 'explore' && s.explore.view === 'third', `mode ${s.mode} view ${s.explore.view}`);
    expect(Math.abs(s.explore.player.z - 47.8) < 2.5, `spawn ${JSON.stringify(s.explore.player)}`);
    await page.evaluate(() => { window.__worldAtStart = window.__curioWorld; });
    worldId = true;
    await shot(page, '01-spawn');
    return { player: s.explore.player, npcs: s.explore.npcs, fps: s.fps };
  });

  await check('X2', 'Move with the keyboard (W, then arrows); frame-rate-independent walking and running', async () => {
    const a = await player(page);
    await hold(page, 'w', 1500);
    const b = await player(page);
    expect(b.z < a.z - 1.2, `W did not move north: ${a.z} → ${b.z}`);
    await page.keyboard.down('Shift'); await hold(page, 'ArrowUp', 1000); await page.keyboard.up('Shift');
    const c = await player(page);
    expect(c.z < b.z - 1.5, `running up did not move: ${b.z} → ${c.z}`);
    await shot(page, '02-walking');
    return { start: a, walked: b, ran: c };
  });

  await check('X2b', 'The ground and buildings block movement (never walks through the storehouse or into the sea)', async () => {
    // storehouse at Blender (36, -27) → Three (36, 27): walk west → east into it
    await placeFacing(page, 29.5, 27.5, 36, 27.5);
    await page.evaluate(() => { window.__curioWorld.explore.yaw = Math.PI / 2; });   // camera looks east (+X)
    await hold(page, 'w', 2500);
    const p = await player(page);
    expect(p.x < 33.5, `walked into the storehouse: x=${p.x}`);
    // the dock's south end: keep walking south (+Z) and stay on walkable ground
    await placeFacing(page, 0.5, 50, 0.5, 60);
    await page.evaluate(() => { window.__curioWorld.explore.yaw = 0; });
    await hold(page, 'w', 3000);
    const q = await player(page);
    const walkable = await page.evaluate(([x, z]) => window.__curioWorld.surfaceHeight(x, z) !== null, [q.x, q.z]);
    expect(walkable && q.z < 60, `left the island: ${JSON.stringify(q)}`);
    return { storehouse: p, dockEnd: q };
  });

  await check('X3', 'Approach Mira and start a dialogue with E', async () => {
    const mira = (await stats(page)).explore.npcs.mira;
    await placeFacing(page, mira.x + 2.2, mira.z, mira.x, mira.z);   // Mira faces east: meet her face to face
    await page.getByRole('button', { name: /Talk to Mira/ }).waitFor({ timeout: 5000 });
    await page.keyboard.press('e');
    const dialog = page.getByRole('dialog', { name: /Conversation with Mira/ });
    await dialog.waitFor({ timeout: 3000 });
    const text = await dialog.innerText();
    expect(/Pathfinder/.test(text), `first line missing: ${text}`);
    await dialog.getByRole('button', { name: 'Continue →' }).click();
    await shot(page, '03-mira-dialogue');
    return { line: (await dialog.innerText()).split('\n')[1] };
  });

  await check('X4', 'Leave the dialogue (Escape) and keep exploring', async () => {
    const before = await player(page);
    await hold(page, 'w', 400);   // ignored while the dialogue is open
    const blocked = await player(page);
    expect(Math.hypot(blocked.x - before.x, blocked.z - before.z) < 0.05, 'moved while talking');
    await page.keyboard.press('Escape');
    expect(await page.getByRole('dialog').count() === 0, 'dialogue still open');
    await hold(page, 's', 800);
    const after = await player(page);
    expect(Math.hypot(after.x - before.x, after.z - before.z) > 0.5, 'could not walk after leaving');
    return { before, after };
  });

  await check('X5', 'Inspect an apple basket by Mira’s door', async () => {
    await placeFacing(page, -26.6, 9.4, -26.6, 7.6);
    await page.getByRole('button', { name: /Inspect Basket of apples/ }).waitFor({ timeout: 5000 });
    await page.keyboard.press('e');
    const panel = page.getByRole('dialog', { name: 'Basket of apples' });
    await panel.waitFor({ timeout: 3000 });
    await shot(page, '04-inspect-basket');
    await panel.getByRole('button', { name: 'Return to exploration' }).click();
    expect(await page.getByRole('dialog').count() === 0, 'panel did not close');
  });

  await check('X5b', 'Too far / unavailable feedback', async () => {
    const mira = (await stats(page)).explore.npcs.mira;
    await placeFacing(page, mira.x + 5, mira.z, mira.x, mira.z);
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    const msg = await page.locator('.explore-message').innerText();
    // from 5 m east the basket (4.4 m) is nearer than Mira (5 m); either is correct feedback
    expect(/Move closer to (Mira|Basket of apples)./.test(msg), `message: ${msg}`);
    return { message: msg };
  });

  await check('X6', 'Travel to the Trading Market in the same world (M map), market locked on a new save', async () => {
    await page.keyboard.press('m');
    await page.getByRole('dialog', { name: 'Island map' }).getByRole('button', { name: /Travel here to The Trading Market/ }).click();
    await page.waitForTimeout(500);
    const p = await player(page);
    expect(Math.hypot(p.x - 14, p.z - 30) < 4, `not at the market: ${JSON.stringify(p)}`);
    const same = await page.evaluate(() => window.__worldAtStart === window.__curioWorld);
    expect(same, 'the 3D world was recreated');
    await placeFacing(page, 14, 32, 14, 30);
    await page.keyboard.press('e');
    await page.waitForTimeout(300);
    const msg = await page.locator('.explore-message').innerText();
    expect(/locked/i.test(msg), `expected a locked message, got: ${msg}`);
    await shot(page, '05-market-locked');
    return { message: msg };
  });

  // A returning player who has finished The Missing Signal, so the market is open.
  const p2 = await openWith(browser, afterSignal);
  let progressBefore;
  await check('X7', 'Enter the Trading Market and launch the existing quest from the same world', async () => {
    await waitReady(p2);
    progressBefore = await p2.evaluate((k) => localStorage.getItem(k), KEY);
    await p2.evaluate(() => { window.__worldAtStart = window.__curioWorld; });
    await p2.keyboard.press('m');
    await p2.getByRole('dialog', { name: 'Island map' }).getByRole('button', { name: /Travel here to The Trading Market/ }).click();
    await placeFacing(p2, 14, 32.2, 14, 30);
    leftAt = await player(p2);
    await p2.getByRole('button', { name: /Enter The Trading Market/ }).waitFor({ timeout: 5000 });
    await p2.keyboard.press('e');
    await p2.waitForURL(/#\/quest\/market-ledger/, { timeout: 10000 });
    await p2.waitForTimeout(2500);
    const s = await stats(p2);
    expect(s.mode === 'focus', `mode ${s.mode}`);
    expect(s.character === 'tove', `quest character ${s.character} (expected the rigged Tove)`);
    expect(s.explore.npcs.tove.borrowed, 'Tove not moved to the quest spot');
    expect(await p2.evaluate(() => window.__worldAtStart === window.__curioWorld), 'the 3D world was recreated');
    await shot(p2, '06-quest-launched');
    return { character: s.character, tove: s.explore.npcs.tove };
  });

  await check('X8', 'Exit the quest and return to the same island position', async () => {
    await p2.getByRole('link', { name: 'Return to the island' }).click();
    await p2.waitForURL(/#\/explore/);
    await waitReady(p2);
    const back = await player(p2);
    expect(Math.hypot(back.x - leftAt.x, back.z - leftAt.z) < 1.5, `returned to ${JSON.stringify(back)}, left at ${JSON.stringify(leftAt)}`);
    const s = await stats(p2);
    expect(!s.explore.npcs.tove.borrowed, 'Tove did not go back home');
    expect(await p2.evaluate(() => window.__worldAtStart === window.__curioWorld), 'the 3D world was recreated');
    await shot(p2, '07-returned');
    return { leftAt, back };
  });

  await check('X9', 'Player progress and quest completion are intact', async () => {
    const after = JSON.parse(await p2.evaluate((k) => localStorage.getItem(k), KEY));
    const before = JSON.parse(progressBefore);
    expect(after.quests['missing-signal']?.completed === true, 'missing-signal no longer completed');
    expect(after.quests['missing-signal'].bestXp === before.quests['missing-signal'].bestXp, 'XP changed');
    expect(JSON.stringify(after.achievements) === JSON.stringify(before.achievements), 'achievements changed');
    expect(!Object.keys(after).some((k) => /explore|player\.x/i.test(k)), 'exploration state leaked into the save file');
    return { missingSignal: after.quests['missing-signal'], marketLedgerStarted: Boolean(after.quests['market-ledger']) };
  });

  await check('X10a', 'Resize keeps exploration working', async () => {
    await p2.setViewportSize({ width: 820, height: 600 });
    await p2.waitForTimeout(500);
    const a = await player(p2);
    await hold(p2, 'w', 700);
    const b = await player(p2);
    expect(Math.hypot(b.x - a.x, b.z - a.z) > 0.4, 'no movement after resize');
    await shot(p2, '08-resized');
    await p2.setViewportSize({ width: 1280, height: 800 });
  });

  await check('X10b', 'Keyboard only: Tab to the prompt, Enter to act; first-person toggle (V)', async () => {
    const mira = (await stats(p2)).explore.npcs.mira;
    await placeFacing(p2, mira.x + 2.2, mira.z, mira.x, mira.z);
    const prompt = p2.getByRole('button', { name: /Talk to Mira/ });
    await prompt.waitFor({ timeout: 5000 });
    await prompt.focus();
    await p2.keyboard.press('Enter');
    await p2.getByRole('dialog', { name: /Conversation with Mira/ }).waitFor({ timeout: 3000 });
    await p2.keyboard.press('Escape');
    await p2.keyboard.press('v');
    await p2.waitForTimeout(400);
    const s = await stats(p2);
    expect(s.explore.view === 'first', `view ${s.explore.view}`);
    await shot(p2, '09-first-person');
    await p2.keyboard.press('v');
  });

  await check('X10c', 'Cleanup: leaving exploration stops input and hides the player; no console errors', async () => {
    await p2.goto(BASE + '#/map');
    await p2.waitForTimeout(1500);
    const a = await stats(p2);
    expect(!a.explore.active, 'exploration still active on the map');
    await hold(p2, 'w', 500);
    const b = await stats(p2);
    expect(JSON.stringify(a.explore.player) === JSON.stringify(b.explore.player), 'player moved while on the map');
    expect(page.errors.length === 0 && p2.errors.length === 0, `console errors: ${JSON.stringify([...page.errors, ...p2.errors])}`);
  });
  await page.close();
  await p2.close();

  await check('X10d', 'Island fails to load: exploration shows a clear fallback, map still works', async () => {
    const p = await openWith(browser, afterSignal, '#/explore', { route: '**/island-b/**' });
    await p.getByText('Walking around the island needs 3D graphics').waitFor({ timeout: 30000 });
    await shot(p, '10-load-failure');
    await p.getByRole('link', { name: 'Open the map' }).first().click();
    await p.waitForURL(/#\/map/);
    await p.close();
  });

  await check('X10e', 'Graphics off (WebGL fallback): exploration explains itself, quests still reachable', async () => {
    const save = { ...afterSignal, settings: { textSize: 'normal', motion: 'system', graphics: 'off' } };
    const p = await openWith(browser, save);
    await p.getByText('Walking around the island needs 3D graphics').waitFor({ timeout: 15000 });
    await p.goto(BASE + '#/map/trading-market');
    await p.getByText('The Market Ledger').first().waitFor({ timeout: 10000 });
    await p.close();
  });

  fs.writeFileSync(path.join(OUT, `results${gpu ? '-gpu' : ''}.json`), JSON.stringify({ date: new Date().toISOString(), gpu, passed: results.length - failures, failed: failures, results }, null, 1));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
