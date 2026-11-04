// Development-only check of a rigged character in the real WorldRenderer on the
// Blender-refined island (Stage 2 of the exploration milestone). Not part of the
// production build: Vite only serves it from `npm run dev` at /dev/character-check.html.

import * as THREE from 'three';
import { WorldRenderer } from '../world/WorldRenderer';
import { loadCharacterModel, type CharacterModel } from '../world/character-model';

const ASSETS = '/dev-assets/';
const params = new URLSearchParams(location.search);
const quality = params.get('quality') === 'low' ? 'low' : 'high';
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const status = document.getElementById('status') as HTMLElement;

// Island B is authored Z-up in Blender (x east, y north); glTF/Three is Y-up.
const fromBlender = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);
const SPAWN = fromBlender(0, -16, 0);              // open ground south of the village plaza (zone B)
const MIRA_SPOT = fromBlender(-27.5, -6.0, 0);      // nav.json cast: where Mira stands, outside her house
// NPCs at their nav.json cast positions; Blender's rotation about Z maps directly to rotation.y.
const NPCS = [
  { name: 'Mira', file: 'Mira.glb', at: MIRA_SPOT, rot: 90 },
  { name: 'Tove', file: 'Tove.glb', at: fromBlender(14, -36.3, 0), rot: 180 },
];
const npcs = new Map<string, CharacterModel>();

const timings: Record<string, number> = {};
const t0 = performance.now();
let world: WorldRenderer;
let pathfinder: CharacterModel | null = null;
let speed = 0;
let patrol = false;
let heading = Math.PI;                              // the model faces +Z; PI faces north (-Z)
let travelled = 0;
let follow = false;
const baseline: { geometries?: number; textures?: number } = {};

/** The lowest open ground within `radius` of a point (roofs and eaves read as high surfaces). */
function openGround(p: THREE.Vector3, radius = 7) {
  let best: THREE.Vector3 | null = null;
  for (let r = 0; r <= radius; r += 0.5) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
      const x = p.x + Math.cos(a) * r;
      const z = p.z + Math.sin(a) * r;
      const h = world.surfaceHeight(x, z);
      if (h !== null && h > 0.1 && (!best || h < best.y - 0.3)) best = new THREE.Vector3(x, h, z);
    }
    if (best && best.y < 1.8) break;
  }
  return best ?? p.clone();
}

function ground(p: THREE.Vector3) {
  const h = world.surfaceHeight(p.x, p.z);
  if (h !== null) p.y = h;
}

function view(kind: string) {
  if (!pathfinder) return;
  const p = pathfinder.root.position;
  const offsets: Record<string, [number, number, number]> = { close: [1.6, 1.3, -2.6], wide: [6, 4, -9], house: [6.5, 3.2, 6.5], side: [3.4, 1.5, -0.6] };
  const o = offsets[kind] ?? offsets.close;
  world.setMode({ kind: 'inspect', position: [p.x + o[0], p.y + o[1], p.z + o[2]], target: [p.x, p.y + 1.0, p.z] });
}

function report(extra = '') {
  if (!pathfinder) return;
  const s = pathfinder.stats();
  const w = world.stats();
  status.textContent = [
    `island ${timings.island?.toFixed(0)} ms · character ${timings.character?.toFixed(0)} ms`,
    `height ${pathfinder.height.toFixed(2)} m · ${s.triangles} tris · ${s.bones} bones · ${s.textures} textures`,
    `clips ${s.clips.join(', ')}`,
    `state ${s.state} · speed ${speed.toFixed(1)} m/s`,
    `fps ${w.fps} · draw calls ${w.drawCalls} · scene tris ${w.triangles}`,
    extra,
  ].filter(Boolean).join('\n');
}

async function main() {
  world = new WorldRenderer(canvas, {
    quality,
    reducedMotion: false,
    modelBase: ASSETS,
    islandFiles: { low: 'VikingIsland_Scene.glb' },
  });
  await world.loadIsland();
  timings.island = performance.now() - t0;
  // Render one PBR probe so the shared environment map is uploaded before the baseline is taken;
  // otherwise it would be counted against the character.
  const probe = new THREE.Mesh(new THREE.SphereGeometry(0.1), new THREE.MeshStandardMaterial());
  probe.position.copy(SPAWN);
  const probeActor = { root: new THREE.Group().add(probe), update() {}, dispose() { probe.geometry.dispose(); (probe.material as THREE.Material).dispose(); probe.removeFromParent(); } };
  world.addActor(probeActor as unknown as CharacterModel);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  world.removeActor(probeActor as unknown as CharacterModel);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));   // island and environment on the GPU
  const info = world.renderer.info.memory;
  baseline.geometries = info.geometries;
  baseline.textures = info.textures;

  const t1 = performance.now();
  pathfinder = await loadCharacterModel(`${ASSETS}${params.get('model') ?? 'Pathfinder.glb'}`);
  timings.character = performance.now() - t1;
  world.addActor(pathfinder);
  pathfinder.root.position.copy(openGround(SPAWN));
  pathfinder.root.rotation.y = heading;
  view('close');
  for (const npc of NPCS) {
    const t = performance.now();
    const model = await loadCharacterModel(`${ASSETS}${npc.file}`);
    timings[npc.name] = performance.now() - t;
    world.addActor(model);
    model.root.position.copy(openGround(npc.at));
    model.root.rotation.y = THREE.MathUtils.degToRad(npc.rot);
    npcs.set(npc.name, model);
  }

  const clock = new THREE.Timer();
  clock.connect(document);
  const step = () => {
    requestAnimationFrame(step);
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.1);
    if (!pathfinder) return;
    if (patrol) {
      // walk 8 m north, turn, walk back: exercises idle→walk→turn→walk transitions on real terrain
      travelled += speed * dt;
      if (travelled > 8) { travelled = 0; heading += Math.PI; }
    }
    const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    pathfinder.root.position.addScaledVector(forward, speed * dt);
    ground(pathfinder.root.position);
    pathfinder.root.rotation.y = THREE.MathUtils.damp(pathfinder.root.rotation.y, heading, 10, dt);
    if (follow && speed > 0) view('side');
    report();
  };
  step();

  document.getElementById('panel')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b || !pathfinder) return;
    if (b.dataset.speed) { patrol = false; speed = Number(b.dataset.speed); pathfinder.setSpeed(speed); }
    if (b.dataset.patrol) { patrol = true; speed = 1.4; pathfinder.setSpeed(speed); }
    if (b.dataset.gesture) pathfinder.gesture(b.dataset.gesture);
    if (b.dataset.view === 'house') {
      speed = 0; patrol = false; pathfinder.setSpeed(0);
      // beside Mira's door, two metres along the wall from where Mira stands
      pathfinder.root.position.copy(openGround(MIRA_SPOT.clone().add(new THREE.Vector3(0, 0, 2.2)), 3));
      heading = 0; pathfinder.root.rotation.y = 0;
    }
    if (b.dataset.view) view(b.dataset.view);
  });

  /** Camera on one NPC at its home position. */
  const look = (who: string) => {
    const m = npcs.get(who);
    if (!m) return;
    const p = m.root.position;
    const f = new THREE.Vector3(Math.sin(m.root.rotation.y), 0, Math.cos(m.root.rotation.y));
    const cam = p.clone().addScaledVector(f, 3.2).add(new THREE.Vector3(1.2, 1.4, 0));
    world.setMode({ kind: 'inspect', position: cam.toArray() as [number, number, number], target: [p.x, p.y + 1.0, p.z] });
  };
  /** All three side by side on open ground, for a height and style comparison. */
  const lineup = () => {
    if (!pathfinder) return;
    speed = 0; patrol = false; follow = false; pathfinder.setSpeed(0);
    const base = openGround(SPAWN);
    pathfinder.root.position.copy(base); heading = 0; pathfinder.root.rotation.y = 0;
    [...npcs.values()].forEach((m, i) => {
      const p = base.clone().add(new THREE.Vector3(i === 0 ? -1.1 : 1.1, 0, 0));
      ground(p); m.root.position.copy(p); m.root.rotation.y = 0;
    });
    world.setMode({ kind: 'inspect', position: [base.x + 0.4, base.y + 1.3, base.z + 5.2], target: [base.x, base.y + 0.95, base.z] });
  };

  const gl = world.renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  (window as unknown as Record<string, unknown>).__charCheck = {
    ready: true,
    timings,
    gpu: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'unknown',
    stats: () => ({ world: world.stats(), character: pathfinder?.stats(), height: pathfinder?.height, position: pathfinder?.root.position.toArray(),
      npcs: Object.fromEntries([...npcs].map(([n, m]) => [n, { ...m.stats(), height: m.height, position: m.root.position.toArray() }])) }),
    look,
    lineup,
    npcGesture: (who: string, n: string) => npcs.get(who)?.gesture(n),
    setSpeed: (v: number) => { patrol = false; follow = v > 0; speed = v; pathfinder?.setSpeed(v); },
    patrol: () => { patrol = true; follow = true; speed = 1.4; pathfinder?.setSpeed(1.4); },
    follow: (on: boolean) => { follow = on; },
    gesture: (n: string) => pathfinder?.gesture(n),
    view,
    house: () => (document.querySelector('[data-view="house"]') as HTMLButtonElement).click(),
    /** Removes every character and reports GPU resources before/after, against the island-only baseline. */
    disposeCharacter: () => {
      const before = { ...world.renderer.info.memory };
      if (pathfinder) world.removeActor(pathfinder);
      pathfinder = null;
      for (const m of npcs.values()) world.removeActor(m);
      npcs.clear();
      world.renderer.render(new THREE.Scene(), new THREE.PerspectiveCamera());
      return { baseline: { ...baseline }, withCharacter: before, after: { ...world.renderer.info.memory } };
    },
  };
}

main().catch((error: unknown) => {
  status.textContent = `Failed: ${error instanceof Error ? error.message : String(error)}`;
  (window as unknown as Record<string, unknown>).__charCheck = { ready: false, error: String(error) };
});
