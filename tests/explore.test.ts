import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { basis, fromBlender, MOVE, NavGrid, pickTarget, stepPlayer, type Interactable, type NavData, type PlayerState } from '../src/world/explore';

/** A 20 × 20 m test grid: flat ground at 1 m, a wall along Blender y = 3 (Three z = -3) from x = -5..4, a 1 m ledge east of x = 6, water south of y = -8. */
function grid(): NavGrid {
  const n = 20;
  const half = 10;
  const h: (number | null)[][] = [];
  const blocked: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const col: (number | null)[] = [];
    let row = '';
    for (let j = 0; j < n; j += 1) {
      const bx = i - half;
      const by = j - half;
      col.push(by < -8 ? null : bx >= 6 ? 2.0 : bx === 5 ? 1.4 : 1.0);
      row += by === 3 && bx >= -5 && bx <= 4 ? '1' : '0';
    }
    h.push(col);
    blocked.push(row);
  }
  return new NavGrid({ n, half, cell: 1, step_max: 0.55, h, blocked, spawn: { x: 0, y: 0, z: 1 } });
}

const still = { forward: 0, right: 0, run: false };
const at = (x: number, z: number): PlayerState => ({ x, y: 1, z, heading: 0, speed: 0 });

function walk(start: PlayerState, input: { forward: number; right: number; run: boolean }, yaw: number, seconds: number, hz: number, g = grid()) {
  let s = start;
  for (let t = 0; t < seconds * hz; t += 1) s = stepPlayer(s, input, yaw, 1 / hz, g);
  return s;
}

describe('walk grid', () => {
  it('maps Three.js coordinates to Blender cells (z is minus north)', () => {
    const g = grid();
    expect(g.height(0.5, -0.5)).toBe(1);
    expect(g.height(0.5, 3.5)).toBe(1);        // Blender y = -3.5: flat ground
    expect(g.height(0.5, -3.5)).toBeNull();    // Blender y = 3: the wall
    expect(g.height(0.5, 9.5)).toBeNull();     // Blender y = -9.5: water
    expect(g.height(50, 0)).toBeNull();        // outside the grid
    expect(fromBlender(2, 5, 1)).toEqual({ x: 2, y: 1, z: -5 });
  });

  it('allows small steps up but not ledges taller than step_max', () => {
    const g = grid();
    expect(g.stepTo(1.0, 5.5, 0)).toBe(1.4);
    expect(g.stepTo(1.0, 6.5, 0)).toBeNull();
    expect(g.stepTo(1.4, 6.5, 0)).toBeNull();     // 0.6 m is still taller than a step
    expect(g.stepTo(1.5, 6.5, 0)).toBe(2.0);
    expect(g.stepTo(2.0, 0.5, 0)).toBe(1.0);  // stepping down is always fine
  });

  it('finds the nearest walkable cell for safe spawning', () => {
    const p = grid().nearestWalkable(0.5, -3.5)!;
    expect(grid().height(p.x, p.z)).not.toBeNull();
    expect(Math.hypot(p.x - 0.5, p.z + 3.5)).toBeLessThanOrEqual(1.5);
  });
});

describe('player movement', () => {
  it('moves forward relative to the camera yaw', () => {
    const north = walk(at(0, 0), { forward: 1, right: 0, run: false }, Math.PI, 1, 60); // yaw PI looks towards -Z
    expect(north.z).toBeLessThan(-1);
    expect(Math.abs(north.x)).toBeLessThan(0.05);
    const b = basis(0);
    expect([b.fx, b.fz, b.rx, b.rz].map((v) => Math.round(v))).toEqual([0, 1, -1, 0]);
  });

  it('covers the same distance at 30, 60 and 144 frames per second', () => {
    const d = [30, 60, 144].map((hz) => walk(at(0, 0), { forward: 1, right: 0, run: false }, 0, 2, hz).z);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(0.05);
    expect(d[0]).toBeGreaterThan(MOVE.walk * 2 * 0.7);
  });

  it('runs faster than it walks', () => {
    const w = walk(at(0, 0), { forward: 1, right: 0, run: false }, 0, 2, 60).z;
    const r = walk(at(0, 0), { forward: 1, right: 0, run: true }, 0, 2, 60).z;
    expect(r).toBeGreaterThan(w * 1.8);
  });

  it('stops at a wall and slides along it', () => {
    // camera looking north (yaw PI): forward = north, "left" = west; push diagonally into the wall
    const s = walk(at(0.5, 0), { forward: 1, right: -1, run: false }, Math.PI, 4, 60);
    expect(s.z).toBeGreaterThan(-3);            // never crosses Blender y = 3
    expect(s.x).toBeLessThan(-2);               // but keeps sliding west along it
  });

  it('never walks into water or off the grid', () => {
    const s = walk(at(0.5, 0), { forward: 1, right: 0, run: true }, 0, 10, 60); // south towards the water
    expect(grid().height(s.x, s.z)).not.toBeNull();
    expect(s.z).toBeLessThan(9);
  });

  it('is blocked by a ledge taller than a step', () => {
    const s = walk(at(3.5, 0), { forward: 0, right: -1, run: false }, 0, 4, 60); // east: 1.4 step then 2.0 ledge
    expect(s.x).toBeLessThan(6);
    expect(s.y).toBeCloseTo(1.4);
  });

  it('turns to face the direction of travel and settles when keys are released', () => {
    const s = walk(at(0, 0), { forward: 0, right: -1, run: false }, 0, 1, 60);
    expect(Math.abs(Math.sin(s.heading) - 1)).toBeLessThan(0.05); // facing +X
    const rest = walk(s, still, 0, 1, 60);
    expect(rest.speed).toBeLessThan(0.01);
  });

  it('ignores huge frame gaps (tab switches) instead of teleporting', () => {
    const s = stepPlayer(at(0, 0), { forward: 1, right: 0, run: true }, 0, 5, grid());
    expect(s.z).toBeLessThan(MOVE.run * MOVE.maxDelta + 1e-6);
  });
});

describe('interaction targeting', () => {
  const items: Interactable[] = [
    { id: 'mira', kind: 'npc', name: 'Mira', x: 0, z: 2, reach: 2.5 },
    { id: 'basket', kind: 'object', name: 'Basket', x: 0, z: -2, reach: 2 },
    { id: 'market', kind: 'destination', name: 'Market', x: 5, z: 0, reach: 3 },
  ];

  it('targets the thing in front within reach', () => {
    expect(pickTarget({ ...at(0, 0), heading: 0 }, items).target?.id).toBe('mira');
    expect(pickTarget({ ...at(0, 0), heading: Math.PI }, items).target?.id).toBe('basket');
  });

  it('reports a nearby thing that is too far, so the HUD can say so', () => {
    const t = pickTarget({ ...at(0, 6), heading: Math.PI }, items);
    expect(t.target).toBeNull();
    expect(t.nearby?.id).toBe('mira');
    expect(t.distance).toBeCloseTo(4);
  });

  it('prefers a person to an object at a similar distance', () => {
    const near: Interactable[] = [
      { id: 'basket', kind: 'object', name: 'Basket', x: 0.4, z: 1.2, reach: 2.2 },
      { id: 'mira', kind: 'npc', name: 'Mira', x: 0, z: 1.8, reach: 2.6 },
    ];
    expect(pickTarget({ ...at(0, 0), heading: 0 }, near).target?.id).toBe('mira');
  });

  it('ignores things behind the player', () => {
    expect(pickTarget({ ...at(0, 1.5), heading: 0 }, [items[1]]).target).toBeNull();
  });
});

describe('island B data', () => {
  const nav = JSON.parse(readFileSync('public/data/nav-island-b.json', 'utf8')) as NavData;
  const world = JSON.parse(readFileSync('public/data/world.json', 'utf8')) as { destinations: { id: string; position: [number, number] }[] };
  const g = new NavGrid(nav);

  it('spawns on walkable ground', () => {
    const s = fromBlender(nav.spawn.x, nav.spawn.y);
    expect(g.height(s.x, s.z)).not.toBeNull();
  });

  it('puts every destination on or next to walkable ground', () => {
    for (const d of world.destinations) {
      expect(g.nearestWalkable(d.position[0], d.position[1], 2), d.id).not.toBeNull();
    }
  });
});
