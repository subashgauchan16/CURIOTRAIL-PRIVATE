// End-to-end browser test for CurioTrail.
// Runs the *production build* in real Chromium, served under /CURIO/ like
// GitHub Pages. Usage:
//   npm run build && npm run e2e
// Requires Playwright with Chromium (`npx playwright install chromium`).
// Writes screenshots to docs/screenshots and results to docs/test-results/e2e.json.

const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const RESULTS = path.join(ROOT, 'docs', 'test-results');
const BASE = '/CURIO/';
const PORT = Number(process.env.E2E_PORT || 4321);
const URL_BASE = `http://localhost:${PORT}${BASE}`;

const results = [];
let current = null;
function check(id, title, fn) {
  return { id, title, fn };
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}

// ---- Static server that mimics GitHub Pages (site lives under /CURIO/) ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.png': 'image/png' };
function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (!url.startsWith(BASE)) { res.writeHead(404); res.end('Not found (outside base path)'); return; }
      let file = path.join(DIST, url.slice(BASE.length));
      if (file.endsWith(path.sep) || url === BASE) file = path.join(file, 'index.html');
      if (!file.startsWith(DIST) || !fs.existsSync(file)) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

// ---- Helpers ----
const LAUNCH = { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };
const consoleErrors = [];
function watch(page, label) {
  page.on('pageerror', (e) => consoleErrors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`[${label}] console: ${m.text()}`); });
}
async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 78 });
}
async function waitForIsland(page) {
  await page.waitForFunction(() => window.__curioWorld && window.__curioWorld.stats().lod !== 'none', null, { timeout: 180000 });
}
const stats = (page) => page.evaluate(() => window.__curioWorld && window.__curioWorld.stats());
const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('curiotrail.progress') || 'null'));
async function heading(page) { return (await page.locator('h1').first().textContent()).trim(); }
async function sceneTitle(page) { return (await page.locator('.scene-title').textContent()).trim(); }
async function choose(page, text) {
  await page.locator('label.option', { hasText: text }).first().click();
  await page.getByRole('button', { name: /^Check/ }).click();
}
async function learn(page, { expectSeen = false } = {}) {
  await page.waitForSelector('.lesson-card');
  if (expectSeen) expect(await page.locator('.lesson-seen').isVisible(), 'replayed lesson should open in the short version');
  await page.locator('.lesson-card .actions button').click();
}
async function next(page) { await page.getByRole('button', { name: 'Continue', exact: true }).click(); }
async function feedbackText(page) { return (await page.locator('[data-feedback]').innerText()).replace(/\s+/g, ' '); }
async function setCode(page, selector, value) {
  const el = page.locator(selector);
  await el.fill(value);
}

// ---- Playthrough helpers for each quest ----
async function playMissingSignalPerfect(page, opts = {}) {
  await page.getByRole('button', { name: 'Investigate' }).click();
  for (const t of ["Organiser's notice", "Assistant's summary", 'Message from Tobin']) await page.getByRole('button', { name: `Inspect ${t}` }).click();
  await page.getByRole('button', { name: "I've read them all" }).click();
  await learn(page, opts);
  await choose(page, "The organiser's notice"); await next(page);
  await choose(page, 'The start time'); await next(page);
  await choose(page, 'Check the original notice'); await next(page);
  await choose(page, 'No. Keep 14:00'); await next(page);
  await learn(page, opts);
  await choose(page, 'Using only the organiser'); await next(page);
  await page.getByLabel('Saturday at 14:00').check();
  await page.getByLabel('A small number of laptops are available to borrow').check();
  await page.getByLabel('Please register at the library desk').check();
  await page.getByRole('button', { name: 'Check announcement' }).click(); await next(page);
  await page.getByRole('button', { name: 'See what you learned' }).click();
  await page.waitForURL(/#\/complete\/missing-signal/);
}


// ---- Modelling-lab helpers ----
function labColumn(page, table, column) {
  return page.locator('.lab-table', { has: page.locator('.lab-table-name', { hasText: new RegExp(`^${table}$`) }) })
    .getByRole('button', { name: new RegExp(`^${column}( \\(|$)`) });
}
async function connect(page, a, b) {
  const [ta, ca] = a.split('.');
  const [tb, cb] = b.split('.');
  await labColumn(page, ta, ca).click();
  await labColumn(page, tb, cb).click();
}
async function setCardinality(page, endsText, value) {
  await page.locator('.lab-rel', { hasText: endsText }).locator('select').first().selectOption(value);
}
async function seedProgress(page, completed, settings = {}) {
  const done = (id) => ({ run: { questId: id, sceneIndex: 0, sceneId: 'ending', inspected: [], results: {}, completed: true }, runXp: 50, lastRun: null, lastXp: 0, bestXp: 50, bestStars: 2, completed: true, completions: 1 });
  await page.evaluate(([ids, st]) => localStorage.setItem('curiotrail.progress', JSON.stringify({
    version: 3, player: { name: 'Tester', emblem: 'owl' }, quests: Object.fromEntries(ids.map((id) => [id, null])), achievements: [], lessons: [],
    settings: { motion: 'system', textSize: 'normal', graphics: 'auto', ...st },
  })), [completed, settings]);
  await page.evaluate((records) => {
    const p = JSON.parse(localStorage.getItem('curiotrail.progress'));
    p.quests = records;
    localStorage.setItem('curiotrail.progress', JSON.stringify(p));
  }, Object.fromEntries(completed.map((id) => [id, done(id)])));
}

const tests = [];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.mkdirSync(RESULTS, { recursive: true });
  expect(fs.existsSync(path.join(DIST, 'index.html')), 'Run `npm run build` first.');
  const server = await serve();
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  const perf = {};

  const run = async (id, title, fn) => {
    // E2E_ONLY=A15b,L4 runs just those checks (for re-checking failures; the full run is the record)
    if (process.env.E2E_ONLY && !process.env.E2E_ONLY.split(',').includes(id)) return;
    const started = Date.now();
    try {
      await fn();
      results.push({ id, title, status: 'pass', ms: Date.now() - started });
      console.log(`PASS ${id} ${title}`);
    } catch (e) {
      results.push({ id, title, status: 'fail', ms: Date.now() - started, error: e.message.split('\n')[0] });
      console.log(`FAIL ${id} ${title}\n     ${e.message.split('\n')[0]}`);
    }
  };

  // 1 / 18 — home loads at the Pages base path, no console errors, 3D island renders
  await run('A1', 'Home screen loads from the /CURIO/ base path', async () => {
    const t0 = Date.now();
    await page.goto(URL_BASE);
    await page.waitForSelector('h1:has-text("Find your way through the digital world.")');
    perf.homeInteractiveMs = Date.now() - t0;
    await waitForIsland(page);
    perf.islandLowMs = await page.evaluate(() => Math.round(performance.getEntriesByName('curio-island-low')[0]?.startTime ?? -1));
    perf.resources = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter((r) => /\.(glb|wasm|js|css|json)$/.test(r.name))
      .map((r) => ({ file: r.name.split('/').slice(-2).join('/'), kb: Math.round(r.transferSize / 1024), ms: Math.round(r.duration) })));
    await page.waitForTimeout(1500);
    await shot(page, '01-home-desktop');
  });

  await run('A14', '3D world renders genuine geometry attached to the island', async () => {
    const s = await stats(page);
    perf.desktopStats = s;
    expect(s.triangles > 100000, `only ${s.triangles} triangles drawn`);
    expect(s.drawCalls > 0, 'no draw calls');
    expect(s.markers.length === 5, 'expected 5 markers');
    expect(s.markers.every((m) => m.y > 0), `markers not on the island: ${JSON.stringify(s.markers)}`);
    // The canvas really contains a varied image (not a flat colour or a static picture).
    // Screenshot the canvas itself and count distinct colours in it.
    const png = await page.locator('canvas.stage-canvas').screenshot();
    const variance = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const tmp = document.createElement('canvas');
      tmp.width = 96; tmp.height = 60;
      const ctx2 = tmp.getContext('2d');
      ctx2.drawImage(img, 0, 0, 96, 60);
      const d = ctx2.getImageData(0, 0, 96, 60).data;
      const colours = new Set();
      for (let i = 0; i < d.length; i += 4) colours.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
      return colours.size;
    }, png.toString('base64'));
    perf.canvasColourBuckets = variance;
    expect(variance > 40, `canvas looks flat (${variance} colour buckets)`);
    const imgs = await page.locator('main img, .stage img').count();
    expect(imgs === 0, 'world should not be a static image');
  });

  await run('A2', '"Start Your First Quest" opens the identity step, then the real quest', async () => {
    await page.getByRole('link', { name: 'Start Your First Quest' }).click();
    await page.waitForURL(/#\/start/);
    await page.getByLabel('What should Mira call you?').fill('Asha');
    await page.getByRole('radio', { name: /Owl/ }).check();
    await shot(page, '02-identity');
    await page.getByRole('button', { name: 'Begin the quest' }).click();
    await page.waitForURL(/#\/quest\/missing-signal/);
    await page.waitForSelector('h1:has-text("The Missing Signal")', { timeout: 10000 });
    expect((await heading(page)) === 'The Missing Signal', 'wrong quest opened');
  });

  await run('C', 'Story introduction shows Mira (3D character + dialogue) and transitions to the investigation', async () => {
    await page.waitForTimeout(2500);
    const s = await stats(page);
    expect(s.character === 'mira', `character in world: ${s.character}`);
    expect(s.mode === 'focus', `camera mode ${s.mode}`);
    expect((await page.locator('.speech-bubble').innerText()).includes('Will you help me check it'), 'dialogue missing');
    await shot(page, '03-story-mira');
    await page.getByRole('button', { name: 'Investigate' }).click();
    expect((await sceneTitle(page)) === 'Gather the evidence', 'did not reach evidence');
  });

  await run('A3', 'All three evidence items can be inspected; continue is gated until then', async () => {
    expect(!(await page.getByRole('button', { name: "I've read them all" }).isVisible().catch(() => false)), 'continue shown too early');
    for (const t of ["Organiser's notice", "Assistant's summary", 'Message from Tobin']) {
      await page.getByRole('button', { name: `Inspect ${t}` }).click();
    }
    const bodies = await page.locator('.evidence-body:visible').count();
    expect(bodies === 3, `${bodies} evidence bodies visible`);
    await shot(page, '04-evidence');
    await page.getByRole('button', { name: "I've read them all" }).click();
  });

  await run('L1', 'A theory card appears before the first challenge, with every teaching section', async () => {
    await page.waitForSelector('.lesson-card');
    expect((await page.locator('.phase-badge').innerText()).includes('Learn'), 'no Learn badge');
    const text = await page.locator('.lesson-card').innerText();
    for (const part of ['You’ll learn to:', 'In plain English', 'Think of it like this', 'Example', 'Why it matters', 'Common mistake', 'Takeaway']) {
      expect(text.toLowerCase().includes(part.toLowerCase()), `lesson is missing "${part}"`); // CSS may uppercase labels
    }
    expect(text.includes('Sources and summaries') && text.includes('cookbook'), 'lesson content not from quest data');
    await page.locator('.lesson-card summary', { hasText: 'Why it matters' }).click(); // sections collapse
    expect(!(await page.locator('.lesson-card details', { hasText: 'Why it matters' }).getAttribute('open')), 'section did not collapse');
    await shot(page, '04b-theory-card');
    await learn(page);
    expect((await page.locator('.phase-badge').innerText()).includes('Guided exercise'), 'exercise not labelled as guided');
  });

  await run('A4', 'A wrong answer gives the feedback written for that answer, plus hint 1', async () => {
    await choose(page, "The AI assistant's summary");
    const fb = await feedbackText(page);
    expect(fb.includes('Not quite'), 'no retry feedback');
    expect(fb.includes("It's a copy, not the source"), `feedback not from quest data: ${fb}`);
    expect(fb.includes('Hint 1 of 2'), 'hint 1 not shown');
    await shot(page, '05-feedback-wrong');
  });

  await run('A5', 'A correct answer gives the explanation from the quest data and XP', async () => {
    await choose(page, "The organiser's notice");
    const fb = await feedbackText(page);
    expect(fb.includes('Correct!'), 'not marked correct');
    expect(fb.includes('An original source comes from the person or organisation responsible'), 'explanation missing');
    expect(fb.includes('+10 XP (solved on attempt 2)'), `XP note wrong: ${fb}`);
    await shot(page, '06-feedback-correct');
    await next(page);
  });

  await run('A7', 'Hints progress and the answer can be revealed after three tries (no XP)', async () => {
    await choose(page, 'The start time'); await next(page); // first try
    for (const o of ['Trust the AI because it sounds confident', 'Average the two times', 'Choose whichever time looks more reasonable']) await choose(page, o);
    const fb = await feedbackText(page);
    expect(fb.includes('Show me the answer'), 'reveal not offered after 3 tries');
    await page.getByRole('button', { name: 'Show me the answer' }).click();
    const after = await feedbackText(page);
    expect(after.includes('Here’s the answer') && after.includes('No XP for this step'), `reveal feedback: ${after}`);
    await next(page);
  });

  await run('A10', 'Refreshing the browser preserves progress mid-quest', async () => {
    await page.reload();
    await page.waitForSelector('.scene-title');
    expect((await sceneTitle(page)) === 'A second opinion?', `after reload: ${await sceneTitle(page)}`);
    expect((await page.locator('#quest-progress-label').innerText()) === 'Step 7 of 11', 'step not restored');
  });

  await run('A6/F', 'Prompt-writing challenge evaluates real choices', async () => {
    await choose(page, 'No. Keep 14:00'); await next(page);
    await learn(page);
    expect((await sceneTitle(page)) === 'Improve the instructions', 'not at prompt challenge');
    await choose(page, 'Write an exciting announcement');
    expect((await feedbackText(page)).includes('encourages exaggeration'), 'prompt feedback missing');
    await shot(page, '07-prompt-challenge');
    await choose(page, 'Using only the organiser');
    expect((await feedbackText(page)).includes('tells the assistant not to make things up'), 'correct prompt feedback missing');
    await next(page);
  });

  await run('A4b', 'The final announcement lists every unsupported line', async () => {
    await page.getByLabel('Saturday at 15:00').check();
    await page.getByLabel('A small number of laptops are available to borrow').check();
    await page.getByLabel('No registration needed, just turn up').check();
    await page.getByLabel('Lunch provided').check();
    await page.getByRole('button', { name: 'Check announcement' }).click();
    const fb = await feedbackText(page);
    expect(fb.includes('3 lines need another look') && fb.includes('Lunch provided:'), fb);
    await page.getByLabel('Saturday at 14:00').check();
    await page.getByLabel('Please register at the library desk').check();
    await page.getByLabel('Lunch provided').uncheck();
    await page.getByRole('button', { name: 'Check announcement' }).click();
    await next(page);
    await shot(page, '08-ending');
    await page.getByRole('button', { name: 'See what you learned' }).click();
    await page.waitForURL(/#\/complete\/missing-signal/);
  });

  await run('A8/G', 'Completion shows engine-calculated XP, level change, stars and skill statuses', async () => {
    // find-source 2nd try 10, spot-conflict 1st 15, verify-time revealed 0,
    // rumour 1st 15, better-prompt 2nd 10, assemble 2nd 20, completion 25 = 95
    const stat = async (label) => (await page.locator('.stat', { hasText: label }).locator('dd').innerText()).trim();
    expect((await stat('XP this run')) === '95', `XP this run ${await stat('XP this run')}`);
    expect((await stat('Added to your total')) === '+95', `added ${await stat('Added to your total')}`);
    expect((await stat('Level')) === '2 · Scout', `level ${await stat('Level')}`);
    expect((await page.locator('.level-up').innerText()).includes('Newcomer → Scout'), 'level-up message missing');
    expect((await page.locator('.stat', { hasText: 'Stars' }).getByRole('img').getAttribute('aria-label')) === '1 of 3 stars', 'stars wrong');
    const skills = await page.locator('.skill').allInnerTexts();
    const status = (label) => skills.find((s) => s.includes(label)) || '';
    expect(status('Tell an original source').includes('Demonstrated after a hint'), status('Tell an original source'));
    expect(status('Spot where two pieces').includes('Demonstrated first time'), status('Spot where'));
    expect(status('Choose a sensible way').includes('Reviewed with help'), status('Choose a sensible'));
    await page.waitForTimeout(1500);
    await shot(page, '09-completion');
    const hud = await page.locator('.hud').innerText();
    expect(hud.includes('95') && hud.includes('Scout'), `HUD: ${hud}`);
  });

  await run('A9', 'Completion unlocks only the appropriate content', async () => {
    const unlocked = await page.locator('.unlocked').innerText();
    expect(unlocked.includes('The Viking Workshop') && unlocked.includes('The Trading Market') && !unlocked.includes('Great Hall'), unlocked);
    await page.goto(`${URL_BASE}#/map`);
    const card = async (name) => (await page.locator('.destination-card', { hasText: name }).innerText()).replace(/\s+/g, ' ');
    expect((await card('The Viking Workshop')).includes('Available'), await card('The Viking Workshop'));
    expect((await card('The Trading Market')).includes('Available'), 'market');
    expect((await card('The Great Hall')).includes('Locked'), 'hall should stay locked');
    expect((await card('The Web Frontier')).includes('Planned'), 'frontier planned');
    expect((await card('The Signal Woods')).includes('Next: The Ledger in the Woods'), 'SQL quest should be next');
    // Directly opening a locked quest is refused.
    await page.goto(`${URL_BASE}#/quest/great-hall-dashboard`);
    await page.waitForURL(/#\/map\/great-hall/);
    expect((await page.locator('.locked-note').innerText()).includes('The Market Ledger'), 'unlock requirement not explained');
    await page.waitForTimeout(2000);
    await shot(page, '10-map-locked-destination');
  });

  await run('A11', 'Replaying a quest never duplicates rewards', async () => {
    await page.goto(`${URL_BASE}#/complete/missing-signal`);
    await page.getByRole('button', { name: 'Replay quest' }).click();
    await page.waitForURL(/#\/quest\/missing-signal/);
    await playMissingSignalPerfect(page, { expectSeen: true });
    const added1 = await page.locator('.stat', { hasText: 'Added to your total' }).locator('dd').innerText();
    expect(added1.trim() === '+30', `perfect replay should add only the improvement (+30), got ${added1}`);
    await page.getByRole('button', { name: 'Replay quest' }).click();
    await playMissingSignalPerfect(page);
    const added2 = await page.locator('.stat', { hasText: 'Added to your total' }).locator('dd').innerText();
    expect(added2.trim() === '+0', `second perfect replay should add +0, got ${added2}`);
    expect((await page.locator('.note').innerText()).includes('Rewards are never counted twice'), 'no replay note');
    const p = await saved(page);
    expect(p.quests['missing-signal'].bestXp === 125 && p.quests['missing-signal'].completions === 3, JSON.stringify(p.quests['missing-signal']));
    expect(p.achievements.filter((a) => a === 'signal-restorer').length === 1, 'badge awarded twice');
  });

  await run('P9-4', 'Each destination can be selected from the island and opens its details', async () => {
    await page.goto(`${URL_BASE}#/map`);
    await page.waitForTimeout(1500);
    for (const [id, name] of [['signal-woods', 'The Signal Woods'], ['viking-workshop', 'The Viking Workshop'], ['trading-market', 'The Trading Market'], ['great-hall', 'The Great Hall']]) {
      await page.goto(`${URL_BASE}#/map`);
      await page.waitForTimeout(1200);
      // Click the label that is anchored to the destination's 3D position.
      await page.locator('.stage-labels .world-label', { hasText: name }).click({ force: true });
      await page.waitForURL(new RegExp(`#/map/${id}`));
      expect((await page.locator('.destination-detail h2').innerText()).includes(name), `detail for ${name}`);
    }
    // And a direct click on the 3D marker geometry (raycast picking).
    await page.goto(`${URL_BASE}#/map`);
    await page.waitForTimeout(2500);
    const box = await page.locator('.stage-labels .world-label', { hasText: 'The Signal Woods' }).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height + 30);
    await page.waitForTimeout(500);
    perf.markerPickUrl = page.url();
  });

  await run('P9-3', 'The camera can inspect the island (drag, keyboard and buttons)', async () => {
    await page.goto(`${URL_BASE}#/map`);
    await page.waitForTimeout(2800);
    const a = (await stats(page)).camera;
    // Destination labels move with the island model, so drag from a point that is really on the canvas.
    const start = await page.evaluate(() => {
      const under = document.elementFromPoint(400, 400);
      for (let y = 400; y <= 640; y += 40) for (let x = 400; x >= 160; x -= 40) {
        if (document.elementFromPoint(x, y)?.tagName === 'CANVAS') return { x, y, was: under ? `${under.tagName}.${under.className}` : 'none' };
      }
      return { x: 400, y: 400, was: 'no free canvas point found' };
    });
    if (start.was !== 'CANVAS.stage-canvas') console.log(`     P9-3: (400,400) was ${start.was}; dragging from (${start.x},${start.y})`);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 150, start.y - 20, { steps: 8 });
    await page.mouse.up();
    // Software rendering can drop to a few frames per second: wait for the camera to change
    // (up to 5 s) instead of assuming a frame lands within a fixed delay.
    const moved = (before) => page.waitForFunction((prev) => JSON.stringify(window.__curioWorld.stats().camera) !== prev, JSON.stringify(before), { timeout: 5000 }).catch(() => null);
    await moved(a);
    const b = (await stats(page)).camera;
    expect(JSON.stringify(a) !== JSON.stringify(b), 'drag did not move the camera');
    await page.locator('body').press('q');
    await moved(b);
    const c = (await stats(page)).camera;
    expect(JSON.stringify(b) !== JSON.stringify(c), 'Q key did not rotate');
    await page.getByRole('button', { name: 'Zoom in (+)' }).click();
    await moved(c);
    const d = (await stats(page)).camera;
    expect(JSON.stringify(c) !== JSON.stringify(d), 'zoom button did nothing');
    await shot(page, '11-map-3d');
  });

  await run('P9-6a', 'SQL quest runs real queries and evaluates them', async () => {
    await page.goto(`${URL_BASE}#/quest/the-ledger`);
    await page.getByRole('button', { name: 'Open the ledger' }).click();
    await choose(page, 'Show the product and revenue columns'); await next(page);
    await learn(page);
    await setCode(page, 'textarea.code-input', "SELECT product, revenue\nFROM sales\nWHERE region = 'north';");
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('[data-feedback]');
    expect((await feedbackText(page)).includes('returned no rows'), await feedbackText(page));
    await setCode(page, 'textarea.code-input', "SELECT product, revenue\nFROM sales\nWHERE region = 'North';");
    await page.getByRole('button', { name: 'Run query' }).click();
    await page.waitForSelector('.preview table');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('.feedback--correct');
    await shot(page, '12-sql-challenge');
    await next(page);
    expect((await page.locator('.lesson-card').innerText()).includes('coffee shop manager'), 'GROUP BY lesson missing');
    await learn(page);
    await setCode(page, 'textarea.code-input', 'SELEC product FROM sales');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('.feedback--retry');
    expect((await feedbackText(page)).includes('syntax error'), 'SQLite error not shown');
    await setCode(page, 'textarea.code-input', 'SELECT product, SUM(revenue) AS total FROM sales GROUP BY product;');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('.feedback--correct');
    await next(page);
    await learn(page);
    await setCode(page, 'textarea.code-input', 'SELECT product, SUM(revenue) AS total FROM sales GROUP BY product ORDER BY total DESC LIMIT 1;');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('.feedback--correct');
    expect((await feedbackText(page)).includes('Lantern'), 'top product');
    await next(page);
    await choose(page, 'Lanterns brought in the most revenue'); await next(page);
    await page.getByRole('button', { name: 'See what you learned' }).click();
    await page.waitForURL(/#\/complete\/the-ledger/);
  });

  await run('P9-6b', 'Python quest reproduces the real error and evaluates expressions', async () => {
    await page.goto(`${URL_BASE}#/quest/broken-tally`);
    await page.getByRole('button', { name: 'Look at the program' }).click();
    await learn(page);
    await choose(page, 'Line 3 tries to join text and a number'); await next(page);
    await page.getByRole('button', { name: 'Check answer' }).click(); // starter contains the bug
    await page.waitForSelector('[data-feedback]');
    expect((await feedbackText(page)).includes('TypeError: can only concatenate str (not "int") to str'), await feedbackText(page));
    await page.locator('input.code-inline').fill('"Total shields: " + str(total)');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    expect((await page.locator('.preview').innerText()).includes('Total shields: 32'), 'run preview');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('.feedback--correct');
    await shot(page, '13-python-challenge');
    await next(page);
    await learn(page);
    await page.locator('input.code-inline').fill('sum(orders) / len(orders)');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('.feedback--correct');
    expect((await feedbackText(page)).includes('8.0'), 'output 8.0');
    await next(page);
    await page.locator('input.code-inline').fill('total * price');
    await page.getByRole('button', { name: 'Check answer' }).click();
    await page.waitForSelector('.feedback--correct');
    await next(page);
    await choose(page, '10.7'); await next(page);
    await page.getByRole('button', { name: 'See what you learned' }).click();
    await page.waitForURL(/#\/complete\/broken-tally/);
  });

  await run('P9-6c', 'Excel quest evaluates formulas, fill-down and functions', async () => {
    await page.goto(`${URL_BASE}#/quest/market-ledger`);
    await page.getByRole('button', { name: 'Open the spreadsheet' }).click();
    await learn(page);
    await choose(page, 'B3'); await next(page);
    await page.locator('input.formula-input').fill('=B2*C2');
    expect((await page.locator('td.is-target').innerText()).trim() === '150', 'live preview');
    await page.getByRole('button', { name: 'Check formula' }).click();
    await page.waitForSelector('.feedback--correct');
    expect((await feedbackText(page)).includes('D5 = 110'), 'fill-down output');
    await shot(page, '14-excel-challenge');
    await next(page);
    await learn(page);
    await page.locator('input.formula-input').fill('=150+120+120+110');
    await page.getByRole('button', { name: 'Check formula' }).click();
    await page.waitForSelector('[data-feedback]');
    expect((await feedbackText(page)).includes('only uses typed numbers'), 'hard-coded formula accepted');
    await page.locator('input.formula-input').fill('=SUM(D2:D5)');
    await page.getByRole('button', { name: 'Check formula' }).click();
    await page.waitForSelector('.feedback--correct');
    await next(page);
    await page.locator('input.formula-input').fill('=AVERAGE(B2:B5)');
    await page.getByRole('button', { name: 'Check formula' }).click();
    await page.waitForSelector('.feedback--correct');
    await next(page);
    await choose(page, 'Filling down shifted F1'); await next(page);
    await page.getByRole('button', { name: 'See what you learned' }).click();
    await page.waitForURL(/#\/complete\/market-ledger/);
    expect((await page.locator('.unlocked').innerText()).includes('The Great Hall'), 'Great Hall should unlock after Excel');
  });

  await run('P9-6d', 'KPI dashboard: drag-and-drop and keyboard alternative, evaluated by the engine', async () => {
    await page.goto(`${URL_BASE}#/quest/great-hall-dashboard`);
    await page.getByRole('button', { name: 'Begin' }).click();
    await choose(page, 'A measure linked to a goal'); await next(page);
    await learn(page);
    // Drag one card with the mouse (scroll so the card and its target are both on screen)…
    await page.locator('.kpi-zone', { hasText: 'Revenue & growth' }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -160));
    const cardBox = await page.locator('.kpi-card', { hasText: 'Total sales this month' }).boundingBox();
    const zoneBox = await page.locator('.kpi-zone', { hasText: 'Revenue & growth' }).boundingBox();
    await page.mouse.move(cardBox.x + 20, cardBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 10 });
    await page.mouse.up();
    expect((await page.locator('.kpi-zone', { hasText: 'Revenue & growth' }).innerText()).includes('Total sales this month'), 'drag and drop failed');
    // …and place the rest with the accessible menus (one deliberately wrong).
    const placements = { 'Sales growth': 'Revenue & growth', 'Average order value': 'Revenue & growth', 'Gross profit margin': 'Revenue & growth', 'Cost per order': 'Profitability', 'Net profit': 'Profitability', 'Customer satisfaction': 'Customer experience', 'Repeat-customer rate': 'Customer experience', 'Average delivery time': 'Customer experience' };
    for (const [label, cat] of Object.entries(placements)) {
      await page.getByLabel(new RegExp(`Place “${label}`)).selectOption({ label: cat });
    }
    await page.getByRole('button', { name: 'Check dashboard' }).click();
    await page.waitForSelector('[data-feedback]');
    expect((await feedbackText(page)).includes('Gross profit margin:'), 'misplaced card not explained');
    await page.getByLabel(/Place “Gross profit margin/).selectOption({ label: 'Profitability' });
    await page.getByRole('button', { name: 'Check dashboard' }).click();
    await page.waitForSelector('.feedback--correct');
    await shot(page, '15-kpi-challenge');
    await next(page);
    await choose(page, 'selling more, but keeping less'); await next(page);
    await learn(page);
    await choose(page, 'A line chart'); await next(page);
    await page.getByRole('button', { name: 'See what you learned' }).click();
    await page.waitForURL(/#\/complete\/great-hall-dashboard/);
  });


  await run('L2', 'Modelling lab: build, get specific feedback, repair, and pass with real rules', async () => {
    await page.goto(`${URL_BASE}#/map/great-hall`);
    const item = page.locator('.quest-item', { hasText: 'The Star Chart' });
    expect((await item.innerText()).includes('Module 5: Data Modelling'), 'module tag missing');
    await item.getByRole('link', { name: 'Enter quest' }).click();
    await page.getByRole('button', { name: 'Show me' }).click();
    await learn(page);
    await choose(page, 'already summarised'); await next(page);
    expect((await page.locator('.lesson-simplification').innerText()).includes('many-to-one, single direction'), 'simplification not disclosed');
    await learn(page);
    expect((await page.locator('.phase-badge').innerText()).includes('Lab'), 'lab not labelled');
    // Inspect a distractor's sample rows, then build a flawed model.
    await page.locator('.lab-tray-item', { hasText: 'ProductList_Export' }).locator('summary').click();
    expect((await page.locator('.lab-tray-item', { hasText: 'ProductList_Export' }).locator('table').innerText()).match(/102\s+Map[\s\S]*102\s+Map/), 'duplicate key not visible in sample rows');
    for (const t of ['FactSales', 'DimDate', 'DimCountry', 'ProductList_Export']) await page.getByRole('button', { name: `Add ${t} to model` }).click();
    // Move a card with the mouse and with the keyboard.
    const head = page.locator('.lab-table', { has: page.locator('.lab-table-name', { hasText: /^DimDate$/ }) }).locator('.lab-table-head');
    const before = await head.boundingBox();
    await page.mouse.move(before.x + 40, before.y + 15);
    await page.mouse.down();
    await page.mouse.move(before.x - 60, before.y + 60, { steps: 6 });
    await page.mouse.up();
    const afterDrag = await head.boundingBox();
    expect(Math.abs(afterDrag.x - before.x) > 40, 'mouse drag did not move the card');
    await head.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    expect((await head.boundingBox()).x > afterDrag.x, 'arrow keys did not move the card');
    await connect(page, 'FactSales.ProductKey', 'ProductList_Export.ProductKey');
    await connect(page, 'FactSales.Quantity', 'DimCountry.CountryKey');
    await connect(page, 'FactSales.DateKey', 'DimDate.DateKey');
    await setCardinality(page, 'ProductList_Export', 'many-to-one');
    await setCardinality(page, 'FactSales.DateKey', 'many-to-one');
    await page.locator('.lab-rel', { hasText: 'FactSales.DateKey' }).locator('select').nth(1).selectOption('both');
    await page.getByRole('button', { name: 'Check model' }).click();
    await page.waitForSelector('.feedback--retry');
    const fb = await feedbackText(page);
    for (const expected of ['No fact table chosen', 'DimProduct is missing', 'accidentally many-to-many', "ProductKey isn’t unique", 'doesn’t use key fields', 'use a single filter direction', 'Hint 1 of 3']) {
      expect(fb.includes(expected), `missing feedback: ${expected}`);
    }
    await shot(page, '24-lab-feedback');
    // Repair: remove the wrong links and the distractor, add what's missing.
    await page.locator('.lab-rel', { hasText: 'FactSales.Quantity' }).getByRole('button', { name: /^Remove/ }).click();
    await page.getByRole('button', { name: 'Remove ProductList_Export from the model' }).click();
    expect((await page.locator('.lab-rel').count()) === 1, 'removing the table should remove its relationship');
    await page.locator('.lab-rel', { hasText: 'FactSales.DateKey' }).locator('select').nth(1).selectOption('single');
    await page.getByRole('button', { name: 'Add DimProduct to model' }).click();
    await connect(page, 'FactSales.ProductKey', 'DimProduct.ProductKey');
    await connect(page, 'DimCountry.CountryKey', 'FactSales.CountryKey'); // from the dimension side
    await setCardinality(page, 'DimProduct.ProductKey', 'many-to-one');
    await setCardinality(page, 'DimCountry.CountryKey', 'one-to-many');
    await page.getByRole('radio', { name: 'FactSales' }).check();
    await page.getByRole('button', { name: 'Check model' }).click();
    await page.waitForSelector('.feedback--correct');
    const why = await page.locator('.lab-why').innerText();
    expect(why.includes('Each dimension key is unique') && why.includes('All 10 values in FactSales.ProductKey match DimProduct.ProductKey'), why);
    expect((await feedbackText(page)).includes('+40 XP (solved on attempt 2)'), await feedbackText(page));
    expect((await page.locator('svg.lab-lines .lab-line').count()) === 3, 'relationship lines not drawn');
    await shot(page, '25-lab-correct');
    await next(page);
    await choose(page, 'DimCountry filters FactSales'); await next(page);
    await page.getByRole('button', { name: 'See what you learned' }).click();
    await page.waitForURL(/#\/complete\/star-chart/);
    // 10 (grain, 1st) + 15 (bonus) ... grain 10+5, lab 40, check 15+5, completion 30 = 105
    expect((await page.locator('.stat', { hasText: 'XP this run' }).locator('dd').innerText()).trim() === '105', 'lab XP');
    expect((await page.locator('.badge-card').innerText()).includes('Star Cartographer'), 'badge');
    const p = await saved(page);
    expect(p.lessons.includes('star-chart/lesson-keys') && p.lessons.includes('the-ledger/lesson-group-by'), `lessons not saved: ${p.lessons}`);
    expect(p.version === 4, 'save version (v4: learning history)');
  });

  await run('P9-7/8', 'Rewards come from the engine and persist; destination states update after refresh', async () => {
    const p = await saved(page);
    const sum = Object.values(p.quests).reduce((s, r) => s + Math.max(r.bestXp, r.runXp), 0);
    await page.reload();
    await page.waitForSelector('.hud');
    const hud = await page.locator('.hud').innerText();
    expect(hud.includes(String(sum)), `HUD ${hud} vs saved ${sum}`);
    perf.finalProgress = { totalXp: sum, stars: Object.values(p.quests).reduce((s, r) => s + r.bestStars, 0), badges: p.achievements };
    await page.goto(`${URL_BASE}#/map`);
    await page.waitForTimeout(1500);
    const s = await stats(page);
    const byId = Object.fromEntries(s.markers.map((m) => [m.id, m.status]));
    expect(byId['signal-woods'] === 'completed' && byId['viking-workshop'] === 'completed' && byId['trading-market'] === 'completed' && byId['great-hall'] === 'completed' && byId['web-frontier'] === 'planned', JSON.stringify(byId));
    await shot(page, '16-map-all-complete');
  });

  await run('A13/I', 'Progress & settings: real data, text size, motion, graphics', async () => {
    await page.goto(`${URL_BASE}#/progress`);
    const rows = await page.locator('.progress-table tbody tr').count();
    expect(rows === 6, `${rows} quest rows`);
    await page.getByLabel('Larger text').check();
    expect((await page.evaluate(() => document.documentElement.dataset.textSize)) === 'large', 'text size not applied');
    await page.getByLabel(/Reduce motion/).check();
    expect((await page.evaluate(() => document.documentElement.dataset.motion)) === 'reduce', 'motion not applied');
    await shot(page, '17-progress-settings');
    await page.reload();
    await page.waitForSelector('#progress-title');
    expect((await page.evaluate(() => document.documentElement.dataset.textSize)) === 'large', 'text size not persisted');
    await page.getByLabel('Standard').check();
    await page.getByLabel('Follow my device setting').check();
  });


  await run('L3', 'Learning path: eight modules from real data, planned modules clearly labelled', async () => {
    await page.goto(`${URL_BASE}#/progress`);
    const modules = page.locator('.module-list > li');
    expect((await modules.count()) === 8, 'expected 8 modules');
    const text = (await page.locator('.module-list').innerText()).replace(/\s+/g, ' ');
    expect(text.includes('Module 0: Digital Foundations') && text.includes('Module 5: Data Modelling') && text.includes('Module 7: Analytics and Projects'), text.slice(0, 200));
    expect((await page.locator('.module--planned').count()) === 5, 'planned modules');
    expect((await page.locator('.module--completed').count()) === 3, 'completed modules (0, 1 and 5)');
    expect(text.includes('Lessons read: 3 of 3') && text.includes('Lessons read: 2 of 2'), 'lesson counts for SQL (3) and Data Modelling (2)');
    expect((await page.locator('.module--planned a, .module--planned button').count()) === 0, 'planned modules must not have controls');
    await page.locator('.module-list').scrollIntoViewIfNeeded();
    await shot(page, '26-learning-path');
  });

  await run('A15a', 'Graphics off: 2D fallback map, quests still playable', async () => {
    await page.goto(`${URL_BASE}#/progress`);
    await page.getByLabel(/^Off/).check();
    await page.goto(`${URL_BASE}#/map`);
    expect((await page.locator('canvas.stage-canvas').count()) === 0, 'canvas still present');
    expect((await page.locator('.fallback-map').count()) === 1, 'no fallback map');
    await page.locator('.fallback-markers .world-label', { hasText: 'The Trading Market' }).click();
    await page.waitForURL(/#\/map\/trading-market/);
    await page.goto(`${URL_BASE}#/progress`);
    await page.getByLabel(/^Automatic/).check();
  });

  await run('A12', 'Reset progress asks for confirmation and erases everything', async () => {
    await page.goto(`${URL_BASE}#/progress`);
    await page.getByRole('button', { name: 'Reset all progress' }).click();
    await page.getByRole('button', { name: 'Keep my progress' }).click();
    expect((await saved(page)) !== null, 'cancel erased data');
    await page.getByRole('button', { name: 'Reset all progress' }).click();
    await page.getByRole('button', { name: 'Yes, reset everything' }).click();
    await page.waitForURL((u) => u.hash === '#/' || u.hash === '');
    expect((await saved(page)) === null, 'storage not cleared');
    expect((await page.locator('.hud').count()) === 0, 'HUD still shown');
  });

  await run('A13b', 'Keyboard: skip link and answering a question without a mouse', async () => {
    await page.goto(URL_BASE);
    await page.waitForSelector('#hero-title');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement.textContent);
    expect(first.includes('Skip to main content'), `first tab stop: ${first}`);
    await page.goto(`${URL_BASE}#/start`);
    await page.getByRole('button', { name: 'Begin the quest' }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/#\/quest\/missing-signal/);
    await page.getByRole('button', { name: 'Investigate' }).focus();
    await page.keyboard.press('Enter');
    for (const t of ["Organiser's notice", "Assistant's summary", 'Message from Tobin']) {
      await page.getByRole('button', { name: `Inspect ${t}` }).focus();
      await page.keyboard.press('Enter');
    }
    await page.getByRole('button', { name: "I've read them all" }).focus();
    await page.keyboard.press('Enter');
    await page.locator('.lesson-card .actions button').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('radio', { name: "The organiser's notice" }).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.feedback--correct');
    const focused = await page.evaluate(() => document.activeElement.hasAttribute('data-feedback'));
    expect(focused, 'focus did not move to the feedback');
  });

  await ctx.close();

  // ---- Failure modes ----
  await run('A15b', 'Island model fails to load: clear error, retry, and quests still work', async () => {
    const c = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    const p = await c.newPage();
    watch(p, 'model-fail');
    await p.route('**/models/**/*.glb', (route) => route.abort());   // island files may sit in a subfolder
    await p.goto(`${URL_BASE}#/map`);
    await p.waitForSelector('.stage-error', { timeout: 60000 });
    expect((await p.locator('.stage-error').innerText()).includes('Try again'), 'no retry');
    await p.locator('.destination-card', { hasText: 'The Signal Woods' }).click();
    await p.getByRole('link', { name: 'Enter quest' }).click();
    await p.waitForURL(/#\/(start|quest)/);
    await shot(p, '18-fallback-model-error');
    await c.close();
    // These aborted requests are expected; remove their console noise.
    for (let i = consoleErrors.length - 1; i >= 0; i -= 1) if (consoleErrors[i].startsWith('[model-fail]')) consoleErrors.splice(i, 1);
  });

  await run('A15c', 'WebGL unavailable: 2D map and the first quest is fully playable', async () => {
    const c = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    await c.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        if (/webgl/.test(type)) return null;
        return original.call(this, type, ...rest);
      };
    });
    const p = await c.newPage();
    watch(p, 'no-webgl');
    await p.goto(URL_BASE);
    await p.waitForSelector('#hero-title');
    expect((await p.locator('.fallback-map').count()) === 1, 'no fallback map');
    await p.getByRole('link', { name: 'Start Your First Quest' }).click();
    await p.getByRole('button', { name: 'Begin the quest' }).click();
    await playMissingSignalPerfect(p);
    expect((await p.locator('.stat', { hasText: 'XP this run' }).locator('dd').innerText()).trim() === '125', 'no-WebGL run');
    await shot(p, '19-no-webgl-completion');
    await c.close();
  });


  await run('L4', 'A save from the previous release resumes on the right step after the lesson update', async () => {
    const c = await browser.newContext({ viewport: { width: 1366, height: 820 } });
    const p = await c.newPage();
    watch(p, 'migration');
    await p.goto(URL_BASE);
    // Exactly what release 0.2 stored: schema v2, position as an index only (5 = "rumour").
    await p.evaluate(() => localStorage.setItem('curiotrail.progress', JSON.stringify({
      version: 2, player: { name: 'Returning', emblem: 'deer' },
      quests: { 'missing-signal': { run: { questId: 'missing-signal', sceneIndex: 5, inspected: ['notice', 'ai-draft', 'message'], results: { 'find-source': { attempts: 1, solved: true, revealed: false }, 'spot-conflict': { attempts: 1, solved: true, revealed: false }, 'verify-time': { attempts: 1, solved: true, revealed: false } }, completed: false }, runXp: 45, lastRun: null, lastXp: 0, bestXp: 0, bestStars: 0, completed: false, completions: 0 } },
      achievements: [], settings: { motion: 'reduce', textSize: 'large', graphics: 'off' },
    })));
    await p.goto(`${URL_BASE}#/quest/missing-signal`);
    await p.waitForSelector('.scene-title');
    expect((await sceneTitle(p)) === 'A second opinion?', `resumed at ${await sceneTitle(p)}`);
    expect((await p.locator('.hud').innerText()).includes('45'), 'XP lost in migration');
    expect((await p.evaluate(() => document.documentElement.dataset.textSize)) === 'large', 'settings lost');
    await c.close();
  });

  // ---- Mobile ----
  await run('A16/H', 'Mobile layout: home, map bottom sheet, quest panel; no sideways scroll; touch targets', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    watch(p, 'mobile');
    await p.goto(URL_BASE);
    await waitForIsland(p);
    perf.mobileStats = await stats(p);
    expect(perf.mobileStats.lod === 'low', `mobile should use the light island, got ${perf.mobileStats.lod}`);
    await p.waitForTimeout(1500);
    await shot(p, '20-mobile-home');
    await p.getByRole('link', { name: 'Start Your First Quest' }).tap();
    await p.getByRole('button', { name: 'Begin the quest' }).tap();
    await p.waitForTimeout(2500);
    await shot(p, '21-mobile-quest');
    await p.getByRole('button', { name: 'Investigate' }).tap();
    await p.getByRole('button', { name: "Inspect Organiser's notice" }).tap();
    await shot(p, '22-mobile-evidence');
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(!overflow, 'horizontal overflow on mobile');
    const small = await p.evaluate(() => [...document.querySelectorAll('main button, main a.btn, main input[type=radio]')]
      .filter((el) => el.offsetParent !== null && el.type !== 'radio')
      .filter((el) => { const r = el.getBoundingClientRect(); return r.height < 40 || r.width < 40; })
      .map((el) => el.textContent.trim().slice(0, 30)));
    expect(small.length === 0, `small touch targets: ${small.join(', ')}`);
    await p.goto(`${URL_BASE}#/map`);
    await p.waitForTimeout(2500);
    await shot(p, '23-mobile-map');
    await p.locator('.destination-card', { hasText: 'The Signal Woods' }).tap();
    await p.waitForURL(/#\/map\/signal-woods/);
    await c.close();
  });


  await run('L5', 'Mobile: theory card and modelling lab work with taps only (no dragging)', async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await c.newPage();
    watch(p, 'mobile-lab');
    await p.goto(URL_BASE);
    await seedProgress(p, ['missing-signal', 'market-ledger', 'great-hall-dashboard', 'the-ledger'], { graphics: 'low' });
    await p.goto(`${URL_BASE}#/quest/star-chart`);
    await p.getByRole('button', { name: 'Show me' }).tap();
    await p.waitForSelector('.lesson-card');
    await shot(p, '27-mobile-theory-card');
    await p.locator('.lesson-card .actions button').tap();
    await p.locator('label.option', { hasText: 'already summarised' }).tap();
    await p.getByRole('button', { name: /^Check/ }).tap();
    await p.getByRole('button', { name: 'Continue', exact: true }).tap();
    await p.locator('.lesson-card .actions button').tap();
    for (const t of ['FactSales', 'DimProduct', 'DimDate', 'DimCountry']) await p.getByRole('button', { name: `Add ${t} to model` }).tap();
    expect((await p.locator('.lab-workspace--compact').count()) === 1, 'compact layout not used on a phone');
    for (const [a, b] of [['FactSales.ProductKey', 'DimProduct.ProductKey'], ['FactSales.DateKey', 'DimDate.DateKey'], ['FactSales.CountryKey', 'DimCountry.CountryKey']]) {
      const [ta, ca] = a.split('.');
      const [tb, cb] = b.split('.');
      await labColumn(p, ta, ca).tap();
      await labColumn(p, tb, cb).tap();
    }
    for (const sel of await p.locator('.lab-rel').all()) await sel.locator('select').first().selectOption('many-to-one');
    await p.getByRole('radio', { name: 'FactSales' }).tap();
    await p.getByRole('button', { name: 'Check model' }).tap();
    await p.waitForSelector('.feedback--correct');
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(!overflow, 'horizontal overflow in the lab on mobile');
    await p.locator('.lab-workspace').scrollIntoViewIfNeeded();
    await shot(p, '28-mobile-lab');
    await c.close();
  });

  // ---- Branding ----
  await run('W1', 'SG · CurioTrail mark: on home, map, quest and completion; labelled once; never blocks controls; copyright and notices', async () => {
    const ids = ['missing-signal', 'the-ledger', 'broken-tally', 'market-ledger', 'great-hall-dashboard', 'star-chart'];
    const routes = ['#/', '#/map', '#/map/signal-woods', '#/quest/missing-signal', '#/complete/missing-signal'];
    for (const [label, opts, graphics] of [
      ['desktop', { viewport: { width: 1366, height: 820 }, reducedMotion: 'reduce' }, 'auto'],
      ['mobile', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }, 'off'],
    ]) {
      const c = await browser.newContext(opts);
      const p = await c.newPage();
      watch(p, `brand-${label}`);
      await p.goto(URL_BASE);
      await seedProgress(p, ids, { graphics });
      for (const r of routes) {
        await p.goto(`${URL_BASE}${r}`);
        await p.waitForSelector('main h1');
        await p.waitForTimeout(400);
        const info = await p.evaluate(() => {
          const marks = [...document.querySelectorAll('main .brand-mark')];
          const m = marks[0];
          if (!m) return { count: 0 };
          m.scrollIntoView({ block: 'center' });
          const rect = m.getBoundingClientRect();
          const cs = getComputedStyle(m);
          // Interactive elements other than the mark itself and the containers around it.
          // The 3D canvas sits behind every panel; the mark takes no pointer input, so it can't block it.
          const overlaps = [...document.querySelectorAll('a, button, input, select, textarea, summary, [tabindex]')]
            .filter((el) => !m.contains(el) && !el.contains(m) && el.offsetParent !== null)
            .filter((el) => { const b = el.getBoundingClientRect(); return b.left < rect.right && b.right > rect.left && b.top < rect.bottom && b.bottom > rect.top; })
            // Only count elements a player can actually see there: something already
            // hidden behind the mark's panel (e.g. a map label under the card) isn't covered by the mark.
            .filter((el) => {
              const b = el.getBoundingClientRect();
              const x = (Math.max(b.left, rect.left) + Math.min(b.right, rect.right)) / 2;
              const y = (Math.max(b.top, rect.top) + Math.min(b.bottom, rect.bottom)) / 2;
              const top = document.elementFromPoint(x, y);
              return !!top && el.contains(top);
            })
            .map((el) => el.tagName + ':' + (el.textContent || '').trim().slice(0, 20));
          const svg = m.querySelector('svg');
          return {
            count: marks.length,
            labelled: document.querySelectorAll('main [aria-label="SG · CurioTrail"]').length,
            text: m.textContent.replace(/\s+/g, ' ').trim(),
            visible: rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.3,
            pointer: cs.pointerEvents,
            position: cs.position,
            // The global reduced-motion rule sets 0.001ms; anything longer would be visible motion.
            animated: cs.animationName !== 'none' || cs.transitionDuration.split(',').some((d) => parseFloat(d) > 0.01),
            vector: !!svg && svg.getAttribute('viewBox') === '0 0 24 24',
            overlaps,
            overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
          };
        });
        const where = `${label} ${r}`;
        expect(info.count === 1, `${where}: expected one mark, found ${info.count}`);
        expect(info.labelled === 1, `${where}: expected one labelled mark, found ${info.labelled}`);
        expect(info.text.includes('SG · CurioTrail'), `${where}: mark text was "${info.text}"`);
        expect(info.visible, `${where}: mark not visible`);
        expect(info.vector, `${where}: mark is not an SVG`);
        expect(info.pointer === 'none', `${where}: mark should not take pointer input, got ${info.pointer}`);
        expect(!['fixed', 'absolute'].includes(info.position), `${where}: mark is an overlay (${info.position})`);
        expect(!info.animated, `${where}: mark animates`);
        expect(info.overlaps.length === 0, `${where}: mark overlaps ${info.overlaps.join(', ')}`);
        expect(!info.overflow, `${where}: horizontal overflow`);
        if (label === 'mobile' && r === '#/quest/missing-signal') await shot(p, '29-mobile-brand-quest');
        if (label === 'desktop' && r === '#/') await shot(p, '29-brand-home');
      }
      // The island credit is still on the home screen, unchanged and not covered.
      await p.goto(URL_BASE);
      await p.locator('details.about summary').click();
      const about = await p.locator('details.about').innerText();
      expect(about.includes('“Viking Island – Minecraft” by cubical.xyz (CC-BY-4.0)'), 'island credit missing from About');
      expect(/© 2026 SG · CurioTrail/.test(about), 'copyright missing from About');
      await p.goto(`${URL_BASE}#/progress`);
      await p.waitForSelector('main h1');
      const notice = p.locator('.copyright-notice');
      expect((await notice.count()) === 1, 'copyright missing from Progress');
      const href = await notice.locator('a').getAttribute('href');
      const res = await p.request.get(new URL(href, `${URL_BASE}`).toString());
      expect(res.ok() && (await res.text()).includes('CC-BY-4.0'), `third-party notices not served at ${href}`);
      await c.close();
    }
  });

  await run('A1b', 'No console errors during the whole run', async () => {
    expect(consoleErrors.length === 0, consoleErrors.join(' | '));
  });

  await browser.close();
  server.close();

  const passed = results.filter((r) => r.status === 'pass').length;
  const report = { date: new Date().toISOString(), base: URL_BASE, browser: `Chromium ${browser.version ? '' : ''}(SwiftShader software WebGL)`, passed, failed: results.length - passed, results, perf };
  fs.writeFileSync(path.join(RESULTS, 'e2e.json'), JSON.stringify(report, null, 2));
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
