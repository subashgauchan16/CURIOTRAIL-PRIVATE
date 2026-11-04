// The realistic Viking island, drawn as distance-streamed 96 m tiles (built by tools/island-pipeline).
// manifest.json lists the tiles; shared.glb holds the material library and the tree/ship/rock templates;
// instances.json places the trees, ships and rocks. Tiles load within LOAD_R of the focus point (the explorer,
// or the orbit target) and unload beyond UNLOAD_R. Only drawing lives here: walking and collision use the
// game's own walk grid (nav-island-realistic.json), like every other island.

import * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const STREAM = { loadRadius: 300, unloadRadius: 420, readyRadius: 110, treeNear: 75, parallel: 4 } as const;

interface TileInfo {
  name: string;
  file: string;
  bytes: number;
  three_bounds: [number, number, number, number]; // x0, x1, z0, z1
}
interface Manifest { chunk_m: number; shared: { file: string; bytes: number }; chunks: TileInfo[] }
interface Instances {
  trees: [number, number, number, number, string][]; // x, base y, z, height, kind
  ships: [number, number, number][];                  // x, z, heading (rad)
  rocks: [number, number, number, number][];          // x, base y, z, size
}
interface Tile extends TileInfo { state: 'idle' | 'loading' | 'loaded' | 'error'; group: THREE.Group | null; proxies: THREE.Mesh[]; dist: number }

export interface StreamedIsland {
  readonly root: THREE.Group;
  /** Low-detail meshes of the loaded tiles, for ray tests (markers, quest framing, follow-camera obstruction). */
  proxies(): THREE.Mesh[];
  update(delta: number, time: number, camera: THREE.Camera, focus: THREE.Vector3): void;
  /** Resolves when every tile within `radius` of `focus` is loaded. */
  whenIdle(focus: THREE.Vector3, radius?: number): Promise<void>;
  stats(): { tiles: number; loaded: number; loading: number; loads: number; unloads: number; loadedBytes: number; sharedBytes: number };
  dispose(): void;
}

const uTime = { value: 0 };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Vertex-shader wind: gusts and flutter weighted by the per-vertex `sway` attribute, phase from the instance position. */
function addWind(mat: THREE.Material) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
        #else
          vec3 ip = vec3(0.0);
        #endif
        float ph = ip.x * 0.045 + ip.z * 0.035;
        float gust = sin(uTime * 1.05 + ph) * 0.6 + sin(uTime * 2.2 + ph * 1.7) * 0.3;
        float flut = sin(uTime * 6.0 + position.y * 1.3 + ph * 5.0) * 0.12;
        transformed.x += sway * (gust * 0.55 + flut);
        transformed.z += sway * (flut * 0.6 + gust * 0.12);`);
  };
  mat.customProgramCacheKey = () => 'curio-wind';
}

/** Same weighting as the Blender 'sway' group: height^1.5, plus distance along the branch for needles. */
function swayFromPosition(g: THREE.BufferGeometry, needles: boolean) {
  const p = g.attributes.position;
  const w = new Float32Array(p.count);
  for (let i = 0; i < p.count; i += 1) {
    const h = Math.max(0, p.getY(i) / 20);
    const r = Math.hypot(p.getX(i), p.getZ(i));
    w[i] = needles ? Math.min(1, h ** 1.5 * 0.7 + Math.min(1, r / 4) * 0.45) : h ** 1.8 * 0.6;
  }
  g.setAttribute('sway', new THREE.BufferAttribute(w, 1));
  if (g.attributes.color) g.deleteAttribute('color');
}

function toStandard(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const s = new THREE.MeshStandardMaterial({
    name: m.name, map: m.map, normalMap: m.normalMap, roughness: m.roughness ?? 0.85, metalness: 0, side: m.side,
    vertexColors: m.name === 'OPT_ShipWood',
  });
  if (m.name === 'OPT_Needles') { s.alphaTest = 0.45; s.side = THREE.DoubleSide; }
  return s;
}

/** Positions are quantized in the files (node transform + normalised integers): bake them back to float world space. */
function bakeToWorld(m: THREE.Mesh) {
  m.updateWorldMatrix(true, false);
  const g = m.geometry;
  for (const name of ['position', 'normal'] as const) {
    const a = g.getAttribute(name);
    if (!a || a.array instanceof Float32Array) continue;
    const f = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i += 1) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); }
    g.setAttribute(name, new THREE.BufferAttribute(f, 3));
  }
  g.applyMatrix4(m.matrixWorld);
  m.position.set(0, 0, 0); m.quaternion.identity(); m.scale.set(1, 1, 1); m.updateMatrix();
}

function meshesOf(o: THREE.Object3D | undefined): THREE.Mesh[] {
  const a: THREE.Mesh[] = [];
  o?.traverse((m) => { if ((m as THREE.Mesh).isMesh) a.push(m as THREE.Mesh); });
  return a;
}

function distToRect(x: number, z: number, b: [number, number, number, number]) {
  return Math.hypot(Math.max(b[0] - x, 0, x - b[1]), Math.max(b[2] - z, 0, z - b[3]));
}

/** LOD of meshes whose vertices are in world space: recentred so LOD distances are measured from the tile. */
function lodOf(levels: (THREE.Object3D | null)[], distances: number[]) {
  const lod = new THREE.LOD();
  const box = new THREE.Box3();
  levels.forEach((o) => { if (o) box.expandByObject(o); });
  const c = box.getCenter(new THREE.Vector3());
  levels.forEach((o, k) => {
    if (!o) return;
    for (const m of meshesOf(o)) { m.geometry.translate(-c.x, -c.y, -c.z); m.geometry.computeBoundingSphere(); m.position.set(0, 0, 0); }
    lod.addLevel(o, distances[k]);
  });
  lod.position.copy(c);
  return lod;
}

function crossQuads(): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(11, 22); a.translate(0, 10, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  for (const k of ['position', 'normal', 'uv'] as const) {
    const A = a.attributes[k].array as Float32Array, B = b.attributes[k].array as Float32Array;
    const out = new Float32Array(A.length + B.length); out.set(A); out.set(B, A.length);
    g.setAttribute(k, new THREE.BufferAttribute(out, a.attributes[k].itemSize));
  }
  const n = a.attributes.position.count, ia = a.index!.array, ib = b.index!.array;
  const idx = new Uint16Array(ia.length + ib.length); idx.set(ia);
  for (let i = 0; i < ib.length; i += 1) idx[ia.length + i] = ib[i] + n;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const sw = new Float32Array(g.attributes.position.count);
  for (let i = 0; i < sw.length; i += 1) sw[i] = Math.max(0, g.attributes.position.getY(i) / 22) ** 1.5 * 0.6;
  g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  a.dispose(); b.dispose();
  return g;
}

export async function loadStreamedIsland(opts: {
  loader: GLTFLoader;
  base: string;          // e.g. "./models/island-realistic/"
  parent: THREE.Object3D;
  focus: THREE.Vector3;  // first view: tiles within STREAM.readyRadius are loaded before this resolves
  onProgress?: (fraction: number) => void;
  onTilesChanged?: () => void;
}): Promise<StreamedIsland> {
  const { loader, base, parent } = opts;
  const getJson = async <T,>(f: string) => {
    const r = await fetch(base + f);
    if (!r.ok) throw new Error(`${base}${f}: HTTP ${r.status}`);
    return r.json() as Promise<T>;
  };
  const [man, inst] = await Promise.all([getJson<Manifest>('manifest.json'), getJson<Instances>('instances.json')]);
  const load = (f: string) => loader.loadAsync(base + f) as Promise<GLTF>;
  const shared = await load(man.shared.file);
  shared.scene.updateMatrixWorld(true);
  for (const m of meshesOf(shared.scene)) bakeToWorld(m);
  opts.onProgress?.(0.5);

  const root = new THREE.Group();
  root.name = 'streamed-island';
  parent.add(root);
  const owned: { dispose(): void }[] = [];   // everything created here, disposed with the island

  // ---- material library (standard PBR; respects the game's lights and fog) ----
  const lib: Record<string, THREE.MeshStandardMaterial> = {};
  shared.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if ((o as THREE.Mesh).isMesh && m && !lib[m.name]) { lib[m.name] = toStandard(m); owned.push(lib[m.name]); }
  });
  const node = (n: string) => shared.scene.getObjectByName(n);

  // ---- trees: instanced near meshes + crossed-quad impostors, wind in the vertex shader ----
  const r = rng(42);
  const tplNames = ['Spruce_A', 'Spruce_B', 'Spruce_C', 'Pine_A'];
  const groups: THREE.Matrix4[][] = tplNames.map(() => []);
  for (const [x, y, z, height, kind] of inst.trees) {
    const ti = kind === 'pine' ? 3 : Math.floor(r() * 3);
    const s = height / 20, sx = s * (0.9 + r() * 0.2);
    groups[ti].push(new THREE.Matrix4().compose(new THREE.Vector3(x, y - 0.3, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2), new THREE.Vector3(sx, s, sx)));
  }
  const texLoader = new THREE.TextureLoader();
  const treeSets: { near: THREE.InstancedMesh[]; far: THREE.InstancedMesh; mats: THREE.Matrix4[] }[] = [];
  tplNames.forEach((n, ti) => {
    const mats = groups[ti];
    if (!mats.length) return;
    const near = meshesOf(node('TreeTpl_' + n)).map((m) => {
      const src = m.material as THREE.MeshStandardMaterial;
      swayFromPosition(m.geometry, src.name === 'OPT_Needles');
      const mat = (lib[src.name] ?? toStandard(src)).clone(); addWind(mat); owned.push(mat, m.geometry);
      const im = new THREE.InstancedMesh(m.geometry, mat, mats.length);
      im.frustumCulled = false; root.add(im); owned.push(im);
      return im;
    });
    const tex = texLoader.load(`${base}opt_impostor_${ti === 3 ? 'Pine_A' : 'Spruce_A'}.webp`);
    tex.colorSpace = THREE.SRGBColorSpace;
    const impMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 });
    addWind(impMat);
    const cross = crossQuads();
    const far = new THREE.InstancedMesh(cross, impMat, mats.length);
    far.frustumCulled = false; root.add(far); owned.push(tex, impMat, cross, far);
    treeSets.push({ near, far, mats });
  });

  // ---- ships and rocks ----
  const shipIMs = meshesOf(node('ShipTpl')).map((m) => {
    const im = new THREE.InstancedMesh(m.geometry, lib[(m.material as THREE.Material).name], inst.ships.length);
    im.frustumCulled = false; root.add(im); owned.push(m.geometry, im);
    return im;
  });
  const rock = meshesOf(node('RockTpl'))[0];
  if (rock) {
    const im = new THREE.InstancedMesh(rock.geometry, lib[(rock.material as THREE.Material).name], inst.rocks.length);
    inst.rocks.forEach(([x, y, z, size], i) => {
      const s = size * 0.5;
      im.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, y - s * 0.15, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7), new THREE.Vector3(s, s * 0.9, s)));
    });
    im.computeBoundingSphere(); root.add(im); owned.push(rock.geometry, im);
  }

  // ---- tile streaming ----
  const tiles: Tile[] = man.chunks.map((c) => ({ ...c, state: 'idle', group: null, proxies: [], dist: Infinity }));
  const stats = { loads: 0, unloads: 0, loadedBytes: 0 };
  let loading = 0;
  let disposed = false;
  let proxyList: THREE.Mesh[] = [];
  const changed = () => { proxyList = tiles.flatMap((t) => t.proxies); opts.onTilesChanged?.(); };

  async function loadTile(t: Tile) {
    t.state = 'loading'; loading += 1;
    try {
      const g = await load(t.file);
      if (disposed) { disposeObject(g.scene); return; }
      g.scene.updateMatrixWorld(true);
      for (const m of meshesOf(g.scene)) bakeToWorld(m);
      const grp = new THREE.Group(); grp.name = `tile-${t.name}`;
      const terrain = [0, 1, 2].map((k) => meshesOf(g.scene.getObjectByName(`Terrain_L${k}`))[0] ?? null);
      for (const m of terrain) if (m) m.removeFromParent();
      grp.add(lodOf(terrain, [0, 140, 300]));
      const proxies: THREE.Mesh[] = terrain[1] ? [terrain[1]] : [];
      const b0 = g.scene.getObjectByName('Buildings_L0'), b1 = g.scene.getObjectByName('Buildings_L1');
      if (b0) {
        const levels = [b0, b1 ?? null].map((n) => {
          if (!n) return null;
          const gg = new THREE.Group();
          for (const m of meshesOf(n)) {
            const name = (m.material as THREE.Material).name;
            if (lib[name]) { (m.material as THREE.Material).dispose(); m.material = lib[name]; }
            m.removeFromParent(); gg.add(m);
          }
          return gg;
        });
        grp.add(lodOf(levels, [0, 220]));
        proxies.push(...meshesOf(levels[1] ?? levels[0]!));
      }
      root.add(grp); grp.updateMatrixWorld(true);
      t.group = grp; t.proxies = proxies; t.state = 'loaded';
      stats.loads += 1; stats.loadedBytes += t.bytes;
      changed();
    } catch (e) {
      console.warn(`Island tile ${t.name} could not be loaded:`, e);
      t.state = 'error';
    } finally {
      loading -= 1;
    }
  }

  function disposeObject(o: THREE.Object3D) {
    o.traverse((x) => {
      const m = x as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      for (const mat of ([] as THREE.Material[]).concat(m.material)) {
        if (Object.values(lib).includes(mat as THREE.MeshStandardMaterial)) continue;   // shared library stays
        (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose();
      }
    });
  }

  function unloadTile(t: Tile) {
    if (t.group) { root.remove(t.group); disposeObject(t.group); }
    t.group = null; t.proxies = []; t.state = 'idle'; stats.unloads += 1;
    changed();
  }

  function stream(f: THREE.Vector3, radius: number = STREAM.loadRadius) {
    for (const t of tiles) {
      t.dist = distToRect(f.x, f.z, t.three_bounds);
      if (t.state === 'loaded' && t.dist > STREAM.unloadRadius) unloadTile(t);
    }
    const want = tiles.filter((t) => t.state === 'idle' && t.dist < radius).sort((a, b) => a.dist - b.dist);
    while (loading < STREAM.parallel && want.length) void loadTile(want.shift()!);
  }

  async function whenIdle(f: THREE.Vector3, radius: number = STREAM.loadRadius) {
    const done = () => tiles.every((t) => t.state !== 'loading' && !(t.state === 'idle' && t.dist < radius));
    stream(f, radius);
    for (let k = 0; k < 1200 && !done() && !disposed; k += 1) {
      await new Promise((res) => setTimeout(res, 50));
      stream(f, radius);
    }
  }

  await whenIdle(opts.focus, STREAM.readyRadius);
  opts.onProgress?.(1);

  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  let accTrees = 1, accStream = 1;
  return {
    root,
    proxies: () => proxyList,
    whenIdle,
    update(delta, time, camera, focus) {
      if (disposed) return;
      uTime.value = time;
      accStream += delta;
      if (accStream > 0.3) { accStream = 0; stream(focus); }
      accTrees += delta;
      if (accTrees > 0.2) {
        accTrees = 0;
        for (const set of treeSets) {
          let n = 0, fc = 0;
          for (const m4 of set.mats) {
            tmpV.setFromMatrixPosition(m4);
            if (tmpV.distanceTo(camera.position) < STREAM.treeNear) { for (const im of set.near) im.setMatrixAt(n, m4); n += 1; }
            else { set.far.setMatrixAt(fc, m4); fc += 1; }
          }
          for (const im of set.near) { im.count = n; im.instanceMatrix.needsUpdate = true; }
          set.far.count = fc; set.far.instanceMatrix.needsUpdate = true;
        }
      }
      inst.ships.forEach(([x, z, heading], i) => {
        tmpM.compose(tmpV.set(x, 0.05 + Math.sin(time * 0.8 + i * 2.1) * 0.12, z),
          q.setFromEuler(e.set(Math.sin(time * 0.45 + i * 1.3) * 0.015, heading, Math.sin(time * 0.6 + i) * 0.025, 'YXZ')), one);
        for (const im of shipIMs) { im.setMatrixAt(i, tmpM); im.instanceMatrix.needsUpdate = true; }
      });
    },
    stats: () => ({
      tiles: tiles.length,
      loaded: tiles.filter((t) => t.state === 'loaded').length,
      loading,
      loads: stats.loads,
      unloads: stats.unloads,
      loadedBytes: stats.loadedBytes,
      sharedBytes: man.shared.bytes,
    }),
    dispose() {
      disposed = true;
      for (const t of tiles) if (t.group) { root.remove(t.group); disposeObject(t.group); t.group = null; }
      disposeObject(shared.scene);
      for (const o of owned) o.dispose();
      root.removeFromParent();
    },
  };
}
