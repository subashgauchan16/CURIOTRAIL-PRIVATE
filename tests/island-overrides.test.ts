// The route overrides (tools/island-pipeline/route-overrides.json) are hand-authored corrections that
// make_nav.py applies on every pipeline run. These tests pin the contract between that file and the
// generated outputs in the repo, so a regeneration that forgets them fails here, not on the island.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fromBlender, NavGrid, type NavData } from '../src/world/explore';
import { readJson } from './helpers';

interface Overrides {
  version: number;
  tree_match_radius_m: number;
  removed_trees: { x: number; y: number; height?: number; reason: string }[];
  blocked_cells: { cells: [number, number][]; reason: string }[];
}

const OV_PATH = 'tools/island-pipeline/route-overrides.json';
const ov = readJson<Overrides>(OV_PATH);
const nav = readJson<NavData>('public/data/nav-island-realistic.json');
const inst = readJson<{ trees: [number, number, number, number, string][] }>('public/models/island-realistic/instances.json');
const g = new NavGrid(nav);

describe('route overrides file', () => {
  it('is version 1 and every entry carries a reason', () => {
    expect(ov.version).toBe(1);
    for (const t of ov.removed_trees) expect(t.reason.length, `${t.x},${t.y}`).toBeGreaterThan(10);
    for (const b of ov.blocked_cells) { expect(b.reason.length).toBeGreaterThan(10); expect(b.cells.length).toBeGreaterThan(0); }
  });

  it('lists only cells that are on land, so a typo cannot silently block the sea', () => {
    for (const b of ov.blocked_cells) for (const [bx, by] of b.cells) {
      expect(nav.h[bx + nav.half]?.[by + nav.half], `${bx},${by}`).not.toBeNull();
    }
  });

  it('is applied by make_nav.py and verified by check.mjs (the pipeline reads it)', () => {
    const makeNav = readFileSync('tools/island-pipeline/make_nav.py', 'utf8');
    const check = readFileSync('tools/island-pipeline/check.mjs', 'utf8');
    expect(makeNav).toMatch(/nav_overrides\.filter_trees/);
    expect(makeNav).toMatch(/nav_overrides\.apply_blocked/);
    expect(check).toMatch(/route-overrides\.json/);
    expect(existsSync('tools/island-pipeline/nav_overrides.py')).toBe(true);
  });
});

describe('generated walk grid and vegetation honour the overrides', () => {
  it('has no tree within the match radius of a removed tree', () => {
    for (const t of ov.removed_trees) {
      const near = inst.trees.filter((k) => Math.hypot(k[0] - t.x, k[2] + t.y) <= ov.tree_match_radius_m);   // three.js z = -blender y
      expect(near, `tree at (${t.x}, ${t.y})`).toEqual([]);
    }
  });

  it('keeps every forced cell blocked, and the cell is not walkable for the player', () => {
    for (const b of ov.blocked_cells) for (const [bx, by] of b.cells) {
      expect(nav.blocked[bx + nav.half][by + nav.half], `${bx},${by}`).toBe('1');
      const t = fromBlender(bx + 0.5, by + 0.5);
      expect(g.height(t.x, t.z)).toBeNull();
    }
  });

  it('records the overrides in the walk grid provenance once it is regenerated (informational)', () => {
    // The current grid was patched by hand on the route pass; after the next make_nav.py run its `source`
    // carries the overrides version. Either form is accepted; a grid with neither would be a stale rebuild.
    expect((nav as NavData & { source?: string }).source ?? '').toMatch(/route-overrides\.json|route pass/);
  });
});
