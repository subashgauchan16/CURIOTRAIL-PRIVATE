// Stage 2 evidence: drives /dev/character-check.html (needs `npx vite --port 5199` running and
// dev-assets/ populated). Writes screenshots and a JSON report to docs/exploration/stage2/.
// Usage: node e2e/character-check.cjs [--gpu]
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'docs', 'exploration', 'stage2');
const URL = 'http://localhost:5199/dev/character-check.html?quality=high';
const gpu = process.argv.includes('--gpu');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: gpu ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => window.__charCheck && (window.__charCheck.ready || window.__charCheck.error), null, { timeout: 120000 });
  const ready = await page.evaluate(() => window.__charCheck.ready);
  if (!ready) throw new Error(await page.evaluate(() => window.__charCheck.error));
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
  const wait = (ms) => page.waitForTimeout(ms);
  const stats = () => page.evaluate(() => window.__charCheck.stats());
  const report = { url: URL, gpuRequested: gpu, gpu: await page.evaluate(() => window.__charCheck.gpu), timings: await page.evaluate(() => window.__charCheck.timings) };

  await wait(1500); await shot('01-idle-close'); report.idle = await stats();
  await page.evaluate(() => window.__charCheck.view('wide')); await wait(800); await shot('02-idle-wide');
  await page.evaluate(() => { window.__charCheck.view('close'); window.__charCheck.patrol(); });
  await wait(2500); await shot('03-walking'); report.walking = await stats();
  const p0 = report.walking.position;
  await wait(4000);
  report.walkingLater = await stats();
  await page.evaluate(() => window.__charCheck.setSpeed(3.6)); await wait(1200); await shot('04-running'); report.running = await stats();
  await page.evaluate(() => window.__charCheck.setSpeed(0)); await wait(800); report.backToIdle = await stats();
  await page.evaluate(() => window.__charCheck.gesture('Talk')); await wait(700); await shot('05-talk-gesture');
  await page.evaluate(() => window.__charCheck.house()); await wait(1200); await shot('06-scale-at-miras-house');
  report.atHouse = await stats();
  await page.evaluate(() => window.__charCheck.look('Mira')); await wait(900); await shot('08-mira-at-home');
  await page.evaluate(() => window.__charCheck.npcGesture('Mira', 'Talk')); await wait(700); await shot('09-mira-talk');
  await page.evaluate(() => window.__charCheck.look('Tove')); await wait(900); await shot('10-tove-at-market');
  await page.evaluate(() => window.__charCheck.lineup()); await wait(1200); await shot('11-lineup');
  report.lineup = await stats();
  report.disposal = await page.evaluate(() => window.__charCheck.disposeCharacter());
  report.consoleErrors = errors;
  report.walkMoved = Math.hypot(report.walkingLater.position[0] - p0[0], report.walkingLater.position[2] - p0[2]);
  fs.writeFileSync(path.join(OUT, `report${gpu ? '-gpu' : ''}.json`), JSON.stringify(report, null, 1));
  console.log(JSON.stringify(report, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
