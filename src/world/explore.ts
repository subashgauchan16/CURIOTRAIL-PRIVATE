// Free exploration on the island: the walk grid, the player controller and
// interaction targeting. Pure TypeScript (no Three.js, DOM or React), so the
// rules of movement are unit-tested; WorldRenderer only draws the result.

/** Walk grid exported with island B (`nav.json`): 1 m cells in Blender axes (x east, y north). */
export interface NavData {
  n: number;
  half: number;
  cell: number;
  step_max: number;
  h: (number | null)[][]; // h[i][j], i = floor(bx) + half, j = floor(by) + half; null = water or void
  blocked: string[]; // blocked[i][j] === '1' where a building, tree or wall stands
  spawn: { x: number; y: number; z: number };
  cast?: Record<string, { x: number; y: number; rot: number }>;
  interact?: { id: string; kind: string; x: number; y: number; z: number }[];
  zones?: Record<string, { name: string; x: number; y: number }>;
}

/** Blender (x east, y north, z up) to Three.js (x, y up, z = -north). */
export function fromBlender(x: number, y: number, z = 0) {
  return { x, y: z, z: -y };
}

export class NavGrid {
  constructor(readonly data: NavData) {}

  private cell(x: number, z: number): { i: number; j: number } | null {
    const i = Math.floor(x) + this.data.half;
    const j = Math.floor(-z) + this.data.half;
    return i >= 0 && j >= 0 && i < this.data.n && j < this.data.n ? { i, j } : null;
  }

  /** Walkable surface height at a Three.js point, or null for water, void and blocked cells. */
  height(x: number, z: number): number | null {
    const c = this.cell(x, z);
    if (!c) return null;
    const h = this.data.h[c.i]?.[c.j];
    if (h === null || h === undefined || this.data.blocked[c.i]?.[c.j] === '1') return null;
    return h;
  }

  /** Can someone standing at height `fromY` step onto (x, z)? Returns the new height or null. */
  stepTo(fromY: number, x: number, z: number): number | null {
    const h = this.height(x, z);
    if (h === null || h - fromY > this.data.step_max) return null;
    return h;
  }

  /** Nearest walkable cell centre to a point (spiral search), for spawning and returning safely. */
  nearestWalkable(x: number, z: number, radius = 8): { x: number; z: number; y: number } | null {
    for (let r = 0; r <= radius; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dz = -r; dz <= r; dz += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = Math.floor(x) + dx + 0.5;
          const pz = Math.floor(z) + dz + 0.5;
          const h = this.height(px, pz);
          if (h !== null) return { x: px, z: pz, y: h };
        }
      }
    }
    return null;
  }
}

export interface PlayerState {
  x: number;
  y: number; // feet height (the walk grid's surface height)
  z: number;
  heading: number; // radians; 0 faces +Z (the character models' front)
  speed: number; // current ground speed, m/s
}

export interface MoveInput {
  forward: number; // -1..1 (W/S, up/down)
  right: number; // -1..1 (D/A, right/left)
  run: boolean; // Shift
}

export const MOVE = { walk: 1.6, run: 3.8, accel: 10, turn: 12, radius: 0.3, maxDelta: 0.1 } as const;

/** Forward and right unit vectors on the ground for a camera yaw (same convention as heading). */
export function basis(yaw: number) {
  return { fx: Math.sin(yaw), fz: Math.cos(yaw), rx: -Math.cos(yaw), rz: Math.sin(yaw) };
}

function approach(current: number, target: number, rate: number, dt: number) {
  return target + (current - target) * Math.exp(-rate * dt);
}

function turnTowards(current: number, target: number, rate: number, dt: number) {
  let d = target - current;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return current + d * (1 - Math.exp(-rate * dt));
}

/**
 * One frame of movement. Frame-rate independent (delta is clamped and all
 * smoothing is exponential); collides with the walk grid axis by axis so the
 * player slides along walls; never leaves walkable ground.
 */
export function stepPlayer(state: PlayerState, input: MoveInput, cameraYaw: number, delta: number, grid: NavGrid): PlayerState {
  const dt = Math.min(Math.max(delta, 0), MOVE.maxDelta);
  const b = basis(cameraYaw);
  let dx = b.fx * input.forward + b.rx * input.right;
  let dz = b.fz * input.forward + b.rz * input.right;
  const len = Math.hypot(dx, dz);
  if (len > 1) { dx /= len; dz /= len; }
  const target = (input.run ? MOVE.run : MOVE.walk) * Math.min(1, len);
  const speed = approach(state.speed, target, MOVE.accel, dt);
  let { x, y, z, heading } = state;
  if (len > 1e-3) heading = turnTowards(heading, Math.atan2(dx, dz), MOVE.turn, dt);
  if (speed > 1e-3 && len > 1e-3) {
    const ux = dx / Math.max(len, 1e-6);
    const uz = dz / Math.max(len, 1e-6);
    const step = speed * dt;
    // probe a little ahead (body radius) so the player stops before walls, not inside them
    const nx = x + ux * step;
    const probeX = nx + Math.sign(ux) * MOVE.radius;
    const hx = Math.abs(ux) > 1e-6 ? grid.stepTo(y, probeX, z) : null;
    if (hx !== null && grid.stepTo(y, nx, z) !== null) { x = nx; y = grid.height(x, z) ?? y; }
    const nz = z + uz * step;
    const probeZ = nz + Math.sign(uz) * MOVE.radius;
    const hz = Math.abs(uz) > 1e-6 ? grid.stepTo(y, x, probeZ) : null;
    if (hz !== null && grid.stepTo(y, x, nz) !== null) { z = nz; y = grid.height(x, z) ?? y; }
  }
  return { x, y, z, heading, speed: len > 1e-3 ? speed : approach(state.speed, 0, MOVE.accel, dt) };
}

export interface Interactable {
  id: string;
  kind: 'npc' | 'object' | 'destination';
  name: string;
  x: number;
  z: number;
  /** How close the player must be (metres). */
  reach: number;
}

export interface Targeting {
  target: Interactable | null; // within reach: E acts on this
  nearby: Interactable | null; // visible but too far: the HUD says "move closer"
  distance: number;
}

/** The interactable the player is facing within reach, preferring the closest, plus the nearest one just out of reach. */
export function pickTarget(player: PlayerState, items: Interactable[], notice = 6): Targeting {
  let best: { item: Interactable; score: number; d: number } | null = null;
  let near: { item: Interactable; d: number } | null = null;
  const fx = Math.sin(player.heading);
  const fz = Math.cos(player.heading);
  for (const item of items) {
    const dx = item.x - player.x;
    const dz = item.z - player.z;
    const d = Math.hypot(dx, dz);
    if (d <= item.reach) {
      const facing = d < 0.5 ? 1 : (dx * fx + dz * fz) / d;      // standing on it counts as facing
      if (facing < -0.2) continue;                              // behind the player
      const score = d - facing * 0.75 - (item.kind === 'npc' ? 0.6 : 0);   // people before props
      if (!best || score < best.score) best = { item, score, d };
    } else if (d <= notice && (!near || d < near.d)) {
      near = { item, d };
    }
  }
  if (best) return { target: best.item, nearby: null, distance: best.d };
  return { target: null, nearby: near?.item ?? null, distance: near?.d ?? Infinity };
}
