// Compression step of `npm run build-island-realistic` (uses the repo's gltf-transform + meshoptimizer; no Draco).
//   node tools/island-pipeline/optimise.mjs <build dir> <webp dir> <out dir>
// shared_raw.glb  -> shared.glb  : textures swapped for WebP, EXT_meshopt_compression (+ quantization)
// chunk_*_raw.glb -> chunk_*.glb : only the tile's own baked terrain texture is kept (WebP); building materials keep
//                                  their names but lose their textures (the game binds them to the shared library)
// writes manifest.json for src/world/streamed-island.ts
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, reorder, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [, , buildDir, webpDir, outDir] = process.argv;
if (!outDir) { console.error('usage: optimise.mjs <build dir> <webp dir> <out dir>'); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const info = JSON.parse(fs.readFileSync(path.join(buildDir, 'chunks.json'), 'utf8'));

function swapWebp(doc) {
  doc.createExtension(EXTTextureWebP).setRequired(true);
  let n = 0;
  for (const tex of doc.getRoot().listTextures()) {
    const f = path.join(webpDir, tex.getName() + '.webp');
    if (!fs.existsSync(f)) throw new Error('missing WebP for texture ' + tex.getName());
    tex.setImage(new Uint8Array(fs.readFileSync(f))).setMimeType('image/webp').setURI(tex.getName() + '.webp'); n += 1;
  }
  return n;
}
// keepAttributes: building UVs must survive even though their textures now live in the shared library.
// POSITION (14 bit; adds a per-node transform that the game bakes back to world space on load), NORMAL and COLOR_0 are
// quantized. TEXCOORD stays float: quantized UVs need a per-material texture transform, which the shared library
// materials would not carry for every tile. Then EXT_meshopt_compression.
async function compress(doc) {
  await doc.transform(dedup(), prune({ keepAttributes: true }), reorder({ encoder: MeshoptEncoder, target: 'size' }),
    quantize({ pattern: /^(POSITION|NORMAL|COLOR_0)$/ }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}

const sdoc = await io.read(path.join(buildDir, 'shared_raw.glb'));
const sTex = swapWebp(sdoc);
await compress(sdoc);
await io.write(path.join(outDir, 'shared.glb'), sdoc);

const chunks = [];
for (const c of info.chunks) {
  const doc = await io.read(path.join(buildDir, `chunk_${c.name}_raw.glb`));
  for (const m of doc.getRoot().listMaterials()) {
    if (m.getName().startsWith('CHK_Terrain')) continue;
    m.setBaseColorTexture(null).setNormalTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null).setEmissiveTexture(null);
  }
  await doc.transform(prune({ keepAttributes: true }));
  const nt = swapWebp(doc);
  await compress(doc);
  const file = `chunk_${c.name}.glb`;
  await io.write(path.join(outDir, file), doc);
  chunks.push({ ...c, file, bytes: fs.statSync(path.join(outDir, file)).size, textures: nt });
}
for (const f of fs.readdirSync(webpDir).filter((f) => f.startsWith('opt_impostor_'))) fs.copyFileSync(path.join(webpDir, f), path.join(outDir, f));
const manifest = {
  generator: 'tools/island-pipeline (npm run build-island-realistic)',
  chunk_m: info.chunk_m, tex: info.tex,
  shared: { file: 'shared.glb', bytes: fs.statSync(path.join(outDir, 'shared.glb')).size, textures: sTex, tris: info.shared_tris },
  extras: ['instances.json', 'opt_impostor_Spruce_A.webp', 'opt_impostor_Pine_A.webp'],
  chunks,
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
const tileBytes = chunks.reduce((a, c) => a + c.bytes, 0);
console.log(`shared ${(manifest.shared.bytes / 1e6).toFixed(2)} MB, ${chunks.length} tiles ${(tileBytes / 1e6).toFixed(2)} MB, total ${((tileBytes + manifest.shared.bytes) / 1e6).toFixed(2)} MB`);
