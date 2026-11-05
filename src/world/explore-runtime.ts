// Free exploration inside the island scene: the Pathfinder, persistent NPCs,
// keyboard/mouse input and the follow camera. Movement and targeting rules are
// in ./explore (pure, unit-tested); quest rules stay in the engine and React.

import * as THREE from 'three';
import { loadCharacterModel, type CharacterModel } from './character-model';
import { NavGrid, pickTarget, stepPlayer, type Interactable, type MoveInput, type PlayerState, type Targeting } from './explore';

export type ExploreView = 'third' | 'first';

export interface NpcSpec { id: string; model: string; x: number; z: number; rot: number }

interface Host {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  islandMeshes: () => THREE.Mesh[];
  addActor: (a: CharacterModel) => void;
  removeActor: (a: CharacterModel) => void;
  modelBase: string;
}

const KEYS: Record<string, keyof typeof AXES> = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};
const AXES = { up: 0, down: 0, left: 0, right: 0 };
const EYE = 1.62;            // first-person eye height above the feet (Pathfinder is 1.74 m)
const FOLLOW = { distance: 4.2, height: 1.45, minPitch: -0.35, maxPitch: 0.75 };

export class ExploreRuntime {
  readonly npcs = new Map<string, { model: CharacterModel; home: THREE.Vector3; rot: number; borrowed: boolean }>();
  player: CharacterModel | null = null;
  state: PlayerState | null = null;
  view: ExploreView = 'third';
  yaw = Math.PI;             // camera looks north at the start (towards the village from the dock)
  pitch = 0.18;
  inputEnabled = true;
  /** True while a cinematic owns the camera: no movement, no follow camera, no NPC turn-to-face. Set by CinematicPlayer. */
  suspended = false;
  onTarget?: (t: Targeting) => void;
  private active = false;
  private nav: NavGrid | null = null;
  private items: Interactable[] = [];
  private keys = { ...AXES };
  private run = false;
  private drag: { x: number; y: number } | null = null;
  private listeners: [EventTarget, string, EventListener][] = [];
  private lastTarget = '';
  private targetTimer = 0;
  private raycaster = new THREE.Raycaster();
  private camPos = new THREE.Vector3();
  private loading: Promise<void> | null = null;

  constructor(private host: Host) {
    const on = (t: EventTarget, type: string, fn: EventListener) => { t.addEventListener(type, fn); this.listeners.push([t, type, fn]); };
    on(window, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    on(window, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    on(window, 'blur', () => { this.keys = { ...AXES }; this.run = false; });
    on(host.canvas, 'pointerdown', (e) => {
      if (!this.active) return;
      const p = e as PointerEvent;
      this.drag = { x: p.clientX, y: p.clientY };
      host.canvas.setPointerCapture?.(p.pointerId);
    });
    on(host.canvas, 'pointermove', (e) => {
      if (!this.active || !this.drag) return;
      const p = e as PointerEvent;
      this.rotate(-(p.clientX - this.drag.x) * 0.006, (p.clientY - this.drag.y) * 0.004);
      this.drag = { x: p.clientX, y: p.clientY };
    });
    on(host.canvas, 'pointerup', () => { this.drag = null; });
    on(host.canvas, 'pointercancel', () => { this.drag = null; });
  }

  setNav(nav: NavGrid) { this.nav = nav; }
  setInteractables(items: Interactable[]) { this.items = items; this.lastTarget = ''; }
  get ready() { return Boolean(this.player && this.nav); }
  get isActive() { return this.active; }

  /** Loads the Pathfinder and the NPCs once; NPCs stay in the world in every mode. */
  load(playerModel: string, npcs: NpcSpec[]): Promise<void> {
    if (!this.loading) {
      this.loading = (async () => {
        const [player, ...models] = await Promise.all([
          loadCharacterModel(this.host.modelBase + playerModel),
          ...npcs.map((n) => loadCharacterModel(this.host.modelBase + n.model)),
        ]);
        this.player = player;
        player.root.visible = this.active && this.view === 'third';
        this.host.addActor(player);
        npcs.forEach((n, i) => {
          const model = models[i];
          const home = new THREE.Vector3(n.x, this.ground(n.x, n.z), n.z);
          model.root.position.copy(home);
          model.root.rotation.y = THREE.MathUtils.degToRad(n.rot);
          this.host.addActor(model);
          this.npcs.set(n.id, { model, home, rot: model.root.rotation.y, borrowed: false });
        });
      })();
    }
    return this.loading;
  }

  enter(view: ExploreView = this.view) {
    this.active = true;
    this.setView(view);
    this.lastTarget = '';
  }

  exit() {
    this.active = false;
    this.keys = { ...AXES };
    this.drag = null;
    if (this.player) { this.player.root.visible = false; this.player.setSpeed(0); }
  }

  setView(view: ExploreView) {
    // first person looks where the Pathfinder is facing
    if (view === 'first' && this.view !== 'first' && this.state) { this.yaw = this.state.heading; this.pitch = 0.05; }
    this.view = view;
    if (this.player) this.player.root.visible = this.active && view === 'third';
  }

  rotate(dYaw: number, dPitch: number) {
    this.yaw += dYaw;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dPitch, FOLLOW.minPitch, FOLLOW.maxPitch);
  }

  /** Places the player (spawn, returning from a quest, tests). Snaps to walkable ground. */
  place(x: number, z: number, heading = this.state?.heading ?? Math.PI) {
    const spot = this.nav?.nearestWalkable(x, z) ?? { x, z, y: 0 };
    this.state = { x: spot.x, y: spot.y, z: spot.z, heading, speed: 0 };
    if (this.player) {
      this.player.root.position.set(spot.x, spot.y, spot.z);
      this.player.root.rotation.y = heading;
    }
    this.camPos.set(spot.x, spot.y + 3, spot.z + 4);
  }

  /** Moves an NPC next to a quest destination for a quest scene; `release` puts it back home. */
  borrow(id: string, at: THREE.Vector3, face: THREE.Vector3): CharacterModel | null {
    const npc = this.npcs.get(id);
    if (!npc) return null;
    npc.borrowed = true;
    npc.model.root.position.copy(at);
    npc.model.root.lookAt(face.x, at.y, face.z);
    return npc.model;
  }

  release(id?: string) {
    for (const [key, npc] of this.npcs) {
      if (id && key !== id) continue;
      if (!npc.borrowed) continue;
      npc.borrowed = false;
      npc.model.root.position.copy(npc.home);
      npc.model.root.rotation.set(0, npc.rot, 0);
      npc.model.setSpeed(0);
    }
  }

  private ground(x: number, z: number) {
    return this.nav?.nearestWalkable(x, z, 3)?.y ?? 0;
  }

  /** Walk-grid height at (x, z) for placing props; `fallback` when the cell is not on the grid. */
  groundAt(x: number, z: number, fallback: number) {
    return this.nav?.nearestWalkable(x, z, 3)?.y ?? fallback;
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.key === 'Shift') this.run = down;
    const axis = KEYS[e.code];
    if (!axis) return;
    if (!down) { this.keys[axis] = 0; return; }
    if (!this.active || !this.inputEnabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
    this.keys[axis] = 1;
    e.preventDefault();   // arrows would otherwise scroll the page
  }

  input(): MoveInput {
    if (!this.inputEnabled || this.suspended) return { forward: 0, right: 0, run: false };
    return { forward: this.keys.up - this.keys.down, right: this.keys.right - this.keys.left, run: this.run };
  }

  update(delta: number, reducedMotion: boolean) {
    if (this.suspended) return;           // a cinematic is placing actors and driving the camera
    // NPCs turn to face a nearby player (only while exploring, never while borrowed for a quest)
    for (const npc of this.npcs.values()) {
      if (npc.borrowed || !this.active || !this.state) continue;
      const dx = this.state.x - npc.home.x;
      const dz = this.state.z - npc.home.z;
      const want = Math.hypot(dx, dz) < 4 ? Math.atan2(dx, dz) : npc.rot;
      let d = want - npc.model.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      npc.model.root.rotation.y += d * (1 - Math.exp(-6 * delta));
    }
    if (!this.active || !this.nav || !this.state || !this.player) return;
    this.state = stepPlayer(this.state, this.input(), this.yaw, delta, this.nav);
    const s = this.state;
    const root = this.player.root;
    root.position.x = s.x;
    root.position.z = s.z;
    root.position.y = THREE.MathUtils.damp(root.position.y, s.y, 14, delta);   // soften 1 m grid steps
    root.rotation.y = s.heading;
    this.player.setSpeed(s.speed);
    this.updateCamera(delta, reducedMotion);

    this.targetTimer -= delta;
    if (this.targetTimer <= 0) {
      this.targetTimer = 0.1;
      const items = this.items.map((it) => {
        const npc = it.kind === 'npc' ? this.npcs.get(it.id) : undefined;
        return npc ? { ...it, x: npc.model.root.position.x, z: npc.model.root.position.z } : it;
      });
      const t = pickTarget(s, items);
      const key = `${t.target?.id ?? ''}|${t.nearby?.id ?? ''}|${Math.round(t.distance)}`;
      if (key !== this.lastTarget) { this.lastTarget = key; this.onTarget?.(t); }
    }
  }

  private updateCamera(delta: number, reducedMotion: boolean) {
    const s = this.state!;
    const cam = this.host.camera;
    const dir = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), -Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    if (this.view === 'first') {
      const eye = new THREE.Vector3(s.x, this.player!.root.position.y + EYE, s.z);
      cam.position.copy(eye);
      cam.lookAt(eye.clone().add(dir));
      this.camPos.copy(eye);
      return;
    }
    const target = new THREE.Vector3(s.x, this.player!.root.position.y + FOLLOW.height, s.z);
    let distance = FOLLOW.distance;
    // pull the camera in front of walls, roofs and trees between it and the player
    const back = dir.clone().negate();
    this.raycaster.set(target, back);
    this.raycaster.far = distance;
    const hit = this.raycaster.intersectObjects(this.host.islandMeshes(), false)[0];
    if (hit) distance = Math.max(0.6, hit.distance - 0.25);
    const want = target.clone().addScaledVector(back, distance);
    const floor = (this.nav?.height(want.x, want.z) ?? want.y - 1) + 0.35;
    if (want.y < floor) want.y = floor;
    if (reducedMotion) this.camPos.copy(want);
    else this.camPos.lerp(want, 1 - Math.exp(-12 * delta));
    cam.position.copy(this.camPos);
    cam.lookAt(target);
  }

  stats() {
    return {
      active: this.active,
      view: this.view,
      player: this.state && { x: +this.state.x.toFixed(2), y: +this.state.y.toFixed(2), z: +this.state.z.toFixed(2), heading: +this.state.heading.toFixed(2), speed: +this.state.speed.toFixed(2) },
      state: this.player?.state ?? null,
      npcs: Object.fromEntries([...this.npcs].map(([id, n]) => [id, { x: +n.model.root.position.x.toFixed(2), z: +n.model.root.position.z.toFixed(2), borrowed: n.borrowed }])),
      target: this.lastTarget,
    };
  }

  dispose() {
    for (const [t, type, fn] of this.listeners) t.removeEventListener(type, fn);
    this.listeners = [];
    // actors (player and NPCs) are disposed by the renderer with the scene
  }
}
