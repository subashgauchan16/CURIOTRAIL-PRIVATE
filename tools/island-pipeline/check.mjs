// Regression checks for the streamed realistic island (last step of `npm run build-island-realistic`).
//   node tools/island-pipeline/check.mjs public/models/island-realistic docs/test-results/island-realistic-checks.json [--strict]
// Fails (exit 1) on any error; budgets are warnings unless --strict.
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

const [, , dir, out = 'results/pipeline_checks.json', strict] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const errors = [], warnings = [], facts = {};
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
const BUDGET = { chunkBytes: 1.5e6, chunkTrisL0: 60000, totalBytes: 25e6 };
const ALLOWED_EXT = new Set(['EXT_meshopt_compression', 'KHR_mesh_quantization', 'EXT_texture_webp']);
const BUILD_MATS = ['OPT_Thatch', 'OPT_WoodLight', 'OPT_Stone', 'OPT_WoodDark'];

function range(arr, stride, k) {
  const s = arr instanceof Uint16Array ? 65535 : arr instanceof Uint8Array ? 255 : 1;   // normalised integer colours
  let lo = Infinity, hi = -Infinity; for (let i = k; i < arr.length; i += stride) { lo = Math.min(lo, arr[i] / s); hi = Math.max(hi, arr[i] / s); } return [lo, hi];
}
function commonChecks(doc, file) {
  const root = doc.getRoot();
  for (const e of root.listExtensionsUsed()) if (!ALLOWED_EXT.has(e.extensionName)) err(`${file}: unexpected extension ${e.extensionName} (e.g. specular -> MeshPhysicalMaterial)`);
  let tris = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial();
    if (!m) err(`${file}: primitive of ${mesh.getName()} has no material`);
    const idx = p.getIndices(); tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    if (m && m.getBaseColorTexture() && !p.getAttribute('TEXCOORD_0')) err(`${file}: ${mesh.getName()}/${m.getName()} is textured but has no TEXCOORD_0`);
    if (p.getAttribute('TEXCOORD_1')) warn(`${file}: ${mesh.getName()} has a second UV set (UV split across layers?)`);
    const uv = p.getAttribute('TEXCOORD_0'), pos = p.getAttribute('POSITION');
    if (uv && uv.getComponentType() !== 5126) err(`${file}: ${mesh.getName()} UVs are quantized (shared materials have no texture transform)`);
    if (pos && !pos.getNormalized() && pos.getComponentType() !== 5126) err(`${file}: ${mesh.getName()} positions use an unexpected integer encoding`);
  }
  for (const n of root.listNodes()) {   // quantization may add translation + uniform scale, never rotation
    const q = n.getRotation();
    if (n.getMesh() && Math.abs(Math.abs(q[3]) - 1) > 1e-6) err(`${file}: node ${n.getName()} is rotated (unexpected)`);
  }
  return tris;
}

// ---- shared library ----
{
  const file = man.shared.file, doc = await io.read(path.join(dir, file)), root = doc.getRoot();
  facts.shared = { bytes: man.shared.bytes, tris: commonChecks(doc, file), textures: root.listTextures().length };
  const nodes = new Set(root.listNodes().map((n) => n.getName()));
  for (const n of ['MatLib', 'TreeTpl_Spruce_A', 'TreeTpl_Spruce_B', 'TreeTpl_Spruce_C', 'TreeTpl_Pine_A', 'ShipTpl', 'RockTpl']) if (!nodes.has(n)) err(`shared: missing node ${n}`);
  const mats = Object.fromEntries(root.listMaterials().map((m) => [m.getName(), m]));
  for (const n of [...BUILD_MATS, 'OPT_ShipWood', 'OPT_Sail', 'OPT_Bark', 'OPT_Needles', 'OPT_Rock']) {
    if (!mats[n]) err(`shared: missing material ${n}`); else if (!mats[n].getBaseColorTexture()) err(`shared: material ${n} has no base colour texture`);
  }
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const mn = p.getMaterial()?.getName(), name = mesh.getName();
    if (name.startsWith('MatLib')) continue;   // material carrier triangles, not real geometry
    const col = p.getAttribute('COLOR_0');
    if (/Tpl_(Spruce|Pine)/.test(name) && mn === 'OPT_Needles') {
      // sway weights are derived from vertex position in the viewer; the fronds only need full 0..1 UVs for the alpha frond
      const uv = p.getAttribute('TEXCOORD_0');
      if (!uv) err(`shared: ${name} needles have no UVs`);
      else { const [u0, u1] = range(uv.getArray(), 2, 0), [v0, v1] = range(uv.getArray(), 2, 1); if (u1 - u0 < 0.9 || v1 - v0 < 0.9) err(`shared: ${name} frond UVs collapsed`); }
    }
    if (mn === 'OPT_ShipWood') {
      if (!col) err('shared: ship wood lacks COLOR_0 tints');
      else { const [lo] = range(col.getArray(), col.getElementSize(), 1); if (lo > 0.9) err('shared: ship tints are all white (vertex colours lost in export)'); }
    }
    if (mn === 'OPT_Sail') {
      const uv = p.getAttribute('TEXCOORD_0');
      if (!uv) err('shared: sail has no UVs');
      else { const [u0, u1] = range(uv.getArray(), 2, 0), [v0, v1] = range(uv.getArray(), 2, 1); facts.sailUV = [u0, u1, v0, v1].map((x) => +x.toFixed(2)); if (u1 - u0 < 0.5 || v1 - v0 < 0.5) err(`shared: sail UVs collapsed (${facts.sailUV}) -> stripes will not show`); }
    }
  }
}

// ---- tiles ----
facts.chunks = [];
let total = man.shared.bytes;
for (const c of man.chunks) {
  const doc = await io.read(path.join(dir, c.file)), root = doc.getRoot();
  const tris = commonChecks(doc, c.file); total += c.bytes;
  const texs = root.listTextures();
  if (texs.length !== 1) err(`${c.file}: expected exactly 1 texture (baked terrain), found ${texs.length}`);
  const nodes = new Set(root.listNodes().map((n) => n.getName()));
  for (const n of ['Terrain_L0', 'Terrain_L1', 'Terrain_L2']) if (!nodes.has(n)) err(`${c.file}: missing ${n}`);
  if (c.tris_buildings && !(nodes.has('Buildings_L0') && nodes.has('Buildings_L1'))) err(`${c.file}: buildings expected but LOD nodes missing`);
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const n = p.getMaterial()?.getName() || '';
    if (BUILD_MATS.includes(n) && !p.getAttribute('TEXCOORD_0')) err(`${c.file}: ${mesh.getName()}/${n} has no UVs (shared texture would render flat)`);
  }
  for (const m of root.listMaterials()) {
    const n = m.getName();
    if (!(n.startsWith('CHK_Terrain') || BUILD_MATS.includes(n))) err(`${c.file}: unexpected material ${n}`);
    if (!n.startsWith('CHK_Terrain') && m.getBaseColorTexture()) err(`${c.file}: shared material ${n} still carries a texture (duplicate download)`);
  }
  const l0 = (c.tris_terrain?.[0] || 0) + (c.tris_buildings?.[0] || 0);
  if (c.bytes > BUDGET.chunkBytes) warn(`${c.file}: ${(c.bytes / 1e6).toFixed(2)} MB over the ${BUDGET.chunkBytes / 1e6} MB tile budget`);
  if (l0 > BUDGET.chunkTrisL0) warn(`${c.file}: ${l0} LOD0 triangles over the ${BUDGET.chunkTrisL0} budget`);
  facts.chunks.push({ file: c.file, bytes: c.bytes, trisAllLods: tris, trisL0: l0, houses: c.houses });
}
for (const f of man.extras || []) if (!fs.existsSync(path.join(dir, f))) err(`missing extra file ${f}`);
if (fs.existsSync(path.join(dir, 'instances.json'))) {
  const inst = JSON.parse(fs.readFileSync(path.join(dir, 'instances.json'), 'utf8'));
  facts.instances = { trees: inst.trees.length, ships: inst.ships.length, rocks: inst.rocks.length };
  if (!inst.trees.length || !inst.ships.length) err('instances.json has no trees or ships');
}
facts.totalBytes = total;
if (total > BUDGET.totalBytes) warn(`total ${(total / 1e6).toFixed(1)} MB over ${BUDGET.totalBytes / 1e6} MB`);
const res = { ok: errors.length === 0 && (!strict || warnings.length === 0), errors, warnings, budget: BUDGET, facts, checkedAt: new Date().toISOString() };
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log(`checks: ${errors.length} errors, ${warnings.length} warnings, ${man.chunks.length} tiles, total ${(total / 1e6).toFixed(2)} MB`);
for (const e of errors) console.log('ERROR', e); for (const w of warnings) console.log('warn ', w);
process.exit(res.ok ? 0 : 1);
