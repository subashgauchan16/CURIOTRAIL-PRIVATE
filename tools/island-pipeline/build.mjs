// One command for the streamed realistic Viking island:  npm run build-island-realistic -- --source "<folder>"
//
//   <folder> = the "Viking_realistic island" working folder (Viking_realistic_island.blend, data/, polyhaven_dl/).
//   Also read from VIKING_SOURCE. Blender from BLENDER (default: Blender 5.2's Windows install path); a Python 3
//   with numpy + Pillow from PYTHON (default: "python").
//
// Steps (all logged to docs/test-results/island-realistic-pipeline.json):
//   1. blender   tools/island-pipeline/export_island.py, headless. The master .blend is opened read-only and the
//                build fails if its modification time changes.
//   2. webp      tools/island-pipeline/to_webp.py (Pillow)
//   3. nav       tools/island-pipeline/make_nav.py -> public/data/nav-island-realistic.json + instances.json
//   4. optimise  tools/island-pipeline/optimise.mjs -> public/models/island-realistic/ (meshopt, shared textures)
//   5. checks    tools/island-pipeline/check.mjs -> docs/test-results/island-realistic-checks.json (non-zero exit fails)
// Flags: --skip-blender (reuse the last Blender output), --only i,j (one tile, for debugging), --chunk, --tex.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const source = path.resolve(opt('--source', process.env.VIKING_SOURCE || ''));
const blender = process.env.BLENDER || 'C:\\Program Files\\Blender Foundation\\Blender 5.2\\blender.exe';
const python = process.env.PYTHON || 'python';
const master = path.join(source, 'Viking_realistic_island.blend');
const build = path.join(source, 'build_island_game');
const out = path.join(repo, 'public', 'models', 'island-realistic');
const results = path.join(repo, 'docs', 'test-results');
if (!fs.existsSync(master) || !fs.existsSync(path.join(source, 'data'))) {
  console.error(`--source must be the "Viking_realistic island" folder (missing ${master} or data/). Got: ${source}`);
  process.exit(2);
}
fs.mkdirSync(results, { recursive: true });
const steps = [];
function run(step, cmd, args, log) {
  const t = Date.now();
  console.log(`== ${step}`);
  const r = spawnSync(cmd, args, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (log) fs.writeFileSync(log, (r.stdout || '') + (r.stderr || ''));
  else process.stdout.write((r.stdout || '') + (r.stderr || ''));
  steps.push({ step, seconds: +((Date.now() - t) / 1000).toFixed(1), code: r.status ?? -1 });
  if (r.status !== 0) { finish(); console.error(`FAILED: ${step}${log ? ` (see ${log})` : ''}${r.error ? `: ${r.error.message}` : ''}`); process.exit(r.status || 1); }
}
function finish() {
  fs.writeFileSync(path.join(results, 'island-realistic-pipeline.json'), JSON.stringify({ when: new Date().toISOString(), source, steps }, null, 1));
  for (const s of steps) console.log(`   ${s.step.padEnd(9)} ${String(s.seconds).padStart(7)} s  exit ${s.code}`);
}

const before = fs.statSync(master).mtimeMs;
if (!argv.includes('--skip-blender')) {
  fs.rmSync(build, { recursive: true, force: true });
  const pass = ['--chunk', '--tex', '--only'].flatMap((f) => (opt(f) ? [f, opt(f)] : []));
  run('blender', blender, ['-b', master, '-P', path.join(repo, 'tools', 'island-pipeline', 'export_island.py'), '--', '--source', source, '--out', build, ...pass],
    path.join(build + '_log.txt'));
}
run('webp', python, ['-I', path.join(repo, 'tools', 'island-pipeline', 'to_webp.py'), build, path.join(build, 'webp')]);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
run('nav', python, ['-I', path.join(repo, 'tools', 'island-pipeline', 'make_nav.py'), '--source', source,
  '--overlay', path.join(repo, 'public', 'data', 'islands', 'realistic.json'), '--world', path.join(repo, 'public', 'data', 'world.json'),
  '--out', path.join(repo, 'public', 'data', 'nav-island-realistic.json'), '--instances', path.join(out, 'instances.json')]);
run('optimise', process.execPath, [path.join(repo, 'tools', 'island-pipeline', 'optimise.mjs'), build, path.join(build, 'webp'), out]);
run('checks', process.execPath, [path.join(repo, 'tools', 'island-pipeline', 'check.mjs'), out, path.join(results, 'island-realistic-checks.json')]);
if (fs.statSync(master).mtimeMs !== before) { console.error('The master .blend was modified during the build.'); process.exit(1); }
console.log(`master .blend untouched (${new Date(before).toISOString()})`);
finish();
