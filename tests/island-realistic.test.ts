import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyIslandOverlay, chooseIslandVariant, islandVariant } from '../src/app/island-variant';
import { placeContent, type ExploreContent } from '../src/app/explore-content';
import { validateWorld } from '../src/engine/quest-validation';
import type { IslandOverlay } from '../src/engine/types';
import { fromBlender, NavGrid, type NavData } from '../src/world/explore';
import { loadWorld, QUEST_IDS, readJson } from './helpers';

const overlay = readJson<IslandOverlay>('public/data/islands/realistic.json');
const world = loadWorld();

describe('island variants', () => {
  it('accepts simple variant names only', () => {
    expect(islandVariant('?island=realistic')).toBe('realistic');
    expect(islandVariant('')).toBeNull();
    expect(islandVariant('?island=../world')).toBeNull();
    expect(islandVariant('?island=a/b')).toBeNull();
  });

  it('changes only the island and positions; quests, unlocks and ids stay', () => {
    const w = applyIslandOverlay(world, overlay);
    expect(w.island?.streamed).toBe('island-realistic/manifest.json');
    expect(w.destinations.map((d) => d.id)).toEqual(world.destinations.map((d) => d.id));
    w.destinations.forEach((d, i) => {
      expect(d.quests).toEqual(world.destinations[i].quests);
      expect(d.unlockedBy).toEqual(world.destinations[i].unlockedBy);
      expect(d.position).toEqual(overlay.positions![d.id]);
    });
    expect(validateWorld(w, QUEST_IDS)).toEqual([]);
    expect(world.island?.nav).toBe('nav-island-realistic.json');   // the realistic island is the default
    expect(world.island?.streamed).toBe(overlay.island.streamed);
    expect(world.destinations.map((d) => d.position)).toEqual(world.destinations.map((d) => overlay.positions![d.id]));
  });

  it('keeps island B available as ?island=b with its original positions', () => {
    const b = readJson<IslandOverlay>('public/data/islands/b.json');
    const w = applyIslandOverlay(world, b);
    expect(w.island?.files).toEqual({ low: 'island-b/VikingIsland_Scene.glb' });
    expect(w.island?.nav).toBe('nav-island-b.json');
    expect(w.island?.streamed).toBeUndefined();
    expect(Object.keys(b.positions!).sort()).toEqual(world.destinations.map((d) => d.id).sort());
    expect(validateWorld(w, QUEST_IDS)).toEqual([]);
    expect(existsSync('public/models/island-b/VikingIsland_Scene.glb')).toBe(true);
  });

  it('uses the light island B on light-graphics devices unless ?island= says otherwise', () => {
    expect(world.island?.lightVariant).toBe('b');
    expect(chooseIslandVariant('', world, 'auto', 'high')).toBeNull();          // capable device: realistic default
    expect(chooseIslandVariant('', world, undefined, 'high')).toBeNull();
    expect(chooseIslandVariant('', world, 'auto', 'low')).toBe('b');            // phone, weak or CPU-only WebGL
    expect(chooseIslandVariant('', world, 'low', 'high')).toBe('b');            // player chose "Light"
    expect(chooseIslandVariant('', world, 'high', 'low')).toBeNull();           // player chose "High detail"
    expect(chooseIslandVariant('?island=realistic', world, 'low', 'low')).toBe('realistic');
    expect(chooseIslandVariant('?island=b', world, 'high', 'high')).toBe('b');
    expect(chooseIslandVariant('', { ...world, island: { ...world.island!, lightVariant: '../x' } }, 'low', 'low')).toBeNull();
  });

  it('rejects positions for unknown destinations', () => {
    expect(() => applyIslandOverlay(world, { ...overlay, positions: { nowhere: [0, 0] } })).toThrow(/unknown destination/);
  });

  it('moves NPCs and objects without changing who they are or what they say', () => {
    const content = readJson<ExploreContent>('public/data/explore.json');
    const placed = placeContent(content, overlay.island.placements);
    expect(placed.npcs.map((n) => [n.id, n.name, n.lines])).toEqual(content.npcs.map((n) => [n.id, n.name, n.lines]));
    expect(placed.objects.map((o) => [o.id, o.text])).toEqual(content.objects.map((o) => [o.id, o.text]));
    expect(placed.npcs.find((n) => n.id === 'tove')!.at).toEqual(overlay.island.placements!.npcs!.tove.at);
    expect(placeContent(content, undefined)).toBe(content);
  });
});

describe('realistic island walk grid and placements', () => {
  const nav = JSON.parse(readFileSync('public/data/nav-island-realistic.json', 'utf8')) as NavData;
  const g = new NavGrid(nav);
  const content = placeContent(readJson<ExploreContent>('public/data/explore.json'), overlay.island.placements);

  it('covers the whole island (577 x 557 m) in 1 m cells', () => {
    expect(nav.cell).toBe(1);
    expect(nav.n).toBeGreaterThanOrEqual(578);
    expect(nav.h.length).toBe(nav.n);
    expect(nav.blocked.length).toBe(nav.n);
  });

  it('spawns on walkable ground', () => {
    const s = fromBlender(nav.spawn.x, nav.spawn.y);
    expect(g.height(s.x, s.z)).not.toBeNull();
  });

  it('puts every destination, NPC and object on walkable ground', () => {
    for (const d of applyIslandOverlay(world, overlay).destinations) expect(g.nearestWalkable(d.position[0], d.position[1], 1), d.id).not.toBeNull();
    for (const p of [...content.npcs, ...content.objects]) {
      const t = fromBlender(p.at[0], p.at[1]);
      expect(g.nearestWalkable(t.x, t.z, 1), p.id).not.toBeNull();
    }
  });

  it('blocks buildings and the sea', () => {
    const hall = fromBlender(111.5, -34.5);           // centre of the great hall
    expect(g.height(hall.x, hall.z)).toBeNull();
    expect(g.height(0, 270)).toBeNull();               // open sea south of the island
  });
});

describe('streamed island assets', () => {
  const dir = 'public/models/island-realistic/';
  it('ships a manifest whose tiles, shared library and extras exist', () => {
    const man = JSON.parse(readFileSync(dir + 'manifest.json', 'utf8')) as { shared: { file: string }; chunks: { file: string; three_bounds: number[] }[]; extras: string[] };
    expect(man.chunks.length).toBe(28);
    for (const f of [man.shared.file, ...man.extras, ...man.chunks.map((c) => c.file)]) expect(existsSync(dir + f), f).toBe(true);
    for (const c of man.chunks) expect(c.three_bounds[1] - c.three_bounds[0]).toBeGreaterThan(0);
  });

  it('places trees, ships and rocks', () => {
    const inst = JSON.parse(readFileSync(dir + 'instances.json', 'utf8')) as { trees: unknown[]; ships: unknown[]; rocks: unknown[] };
    expect(inst.trees.length).toBe(213);   // 215 from the pipeline, minus the two route spruces removed in the route pass
    expect(inst.ships.length).toBe(8);
    expect(inst.rocks.length).toBeGreaterThan(0);
  });
});

describe('realistic island routes on foot', () => {
  const world = loadWorld();
  const nav = readJson<NavData>('public/data/nav-island-realistic.json');
  const g = new NavGrid(nav);
  /** Cells reachable from (x, z) with the game's rule: step up at most step_max, step down freely. */
  function reachable(x: number, z: number) {
    const start = g.nearestWalkable(x, z, 1)!;
    const key = (cx: number, cz: number) => `${Math.floor(cx)},${Math.floor(cz)}`;
    const seen = new Set([key(start.x, start.z)]);
    const queue: [number, number, number][] = [[start.x, start.z, start.y]];
    while (queue.length) {
      const [cx, cz, cy] = queue.shift()!;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, nz = cz + dz;
        if (seen.has(key(nx, nz))) continue;
        const h = g.stepTo(cy, nx, nz);
        if (h === null) continue;
        seen.add(key(nx, nz));
        queue.push([nx, nz, h]);
      }
    }
    return (x2: number, z2: number) => { const c = g.nearestWalkable(x2, z2, 1); return Boolean(c && seen.has(key(c.x, c.z))); };
  }
  const spawn = fromBlender(nav.spawn.x, nav.spawn.y);
  const from = reachable(spawn.x, spawn.z);

  it('reaches every playable destination from the spawn without teleporting', () => {
    for (const d of world.destinations) {
      if (d.unlockedBy === 'planned') continue;
      expect(from(d.position[0], d.position[1]), d.id).toBe(true);
    }
  });

  it('reaches Mira, Tove and the story objects from the spawn', () => {
    const p = world.island!.placements!;
    for (const [id, n] of Object.entries(p.npcs!)) { const t = fromBlender(n.at[0], n.at[1]); expect(from(t.x, t.z), id).toBe(true); }
    for (const [id, at] of Object.entries(p.objects!)) { const t = fromBlender(at[0], at[1]); expect(from(t.x, t.z), id).toBe(true); }
  });

  it('keeps the player out from under the stilt house floor on the spawn-to-board leg', () => {
    for (const [bx, by] of [[-22, 62], [-21, 64], [-15, 65], [-9, 63]]) {
      const t = fromBlender(bx + 0.5, by + 0.5);
      expect(g.height(t.x, t.z), `${bx},${by}`).toBeNull();
    }
  });
});

