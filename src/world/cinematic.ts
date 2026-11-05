// Real-time cinematics inside the exploration world. A sequence is data
// (public/data/cinematics/*.json): shots with a camera, a light mood, actors
// placed and given one of their existing clips, a few named effects and timed
// subtitles. The player drives the camera and the effects; movement, quest
// rules and the save file are never touched. Anything missing (an NPC, a bone,
// an effect name) is skipped, never fatal.

import * as THREE from 'three';
import type { ExploreRuntime } from './explore-runtime';
import { PALETTE } from './environment';

export interface CinematicActor { id: 'player' | string; at?: [number, number, number]; face?: [number, number]; gesture?: string; hidden?: boolean }
export interface CinematicSubtitle { at: number; who: string; line: string }
export interface CinematicMood { sky?: [string, string]; fog?: string; fogRange?: [number, number]; sun?: { colour?: string; intensity?: number; dir?: [number, number, number] }; hemi?: { sky?: string; ground?: string; intensity?: number } }
export interface CinematicShot {
  n: number;
  duration: number;
  camera: { pos: [number, number, number]; target: [number, number, number]; fov?: number; moveTo?: [number, number, number] };
  mood?: string;
  actors?: CinematicActor[];
  fx?: string[];
  subtitles?: CinematicSubtitle[];
}
export interface CinematicSequence {
  id: string;
  moods?: Record<string, CinematicMood>;
  props?: Record<string, [number, number, number]>;
  shots: CinematicShot[];
  end: { spawn: [number, number]; heading?: number };
}

export interface CinematicHost {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  explore: ExploreRuntime;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  reducedMotion: () => boolean;
  /** Hide or show the destination markers and their HTML labels while a sequence plays. */
  setMarkersVisible?: (visible: boolean) => void;
}

export interface CinematicCallbacks { onSubtitle?: (text: string | null) => void; onShot?: (n: number) => void; onEnd?: (skipped: boolean) => void }

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CinematicPlayer {
  private seq: CinematicSequence | null = null;
  private cb: CinematicCallbacks = {};
  private shot = -1;
  private t = 0;
  private fx = new THREE.Group();
  private pulses: { light: THREE.PointLight; start: number }[] = [];
  private saved: { fov: number; hemi: [THREE.Color, THREE.Color, number]; sun: [THREE.Color, number, THREE.Vector3]; fog: [THREE.Color, number, number]; sky: [THREE.Color, THREE.Color]; view: 'third' | 'first' } | null = null;
  private shown = new Set<string>();
  private elapsed = 0;

  constructor(private host: CinematicHost) { this.fx.name = 'cinematic-fx'; }

  get playing() { return this.seq !== null; }

  play(seq: CinematicSequence, cb: CinematicCallbacks = {}) {
    if (this.seq) this.finish(true);
    const { explore, camera, hemi, sun, scene } = this.host;
    this.seq = seq; this.cb = cb; this.shot = -1; this.t = 0; this.elapsed = 0;
    const fog = scene.fog as THREE.Fog;
    this.saved = {
      fov: camera.fov,
      hemi: [hemi.color.clone(), hemi.groundColor.clone(), hemi.intensity],
      sun: [sun.color.clone(), sun.intensity, sun.position.clone()],
      fog: [fog.color.clone(), fog.near, fog.far],
      sky: [PALETTE.skyTop.clone(), PALETTE.skyHorizon.clone()],
      view: explore.view,
    };
    this.host.setMarkersVisible?.(false);
    explore.suspended = true;      // no movement, no follow camera; NPC turn-to-face is off while suspended
    explore.inputEnabled = false;
    scene.add(this.fx);
    this.next();
  }

  skip() { if (this.seq) this.finish(true); }

  /** Called every frame by the renderer with the frame delta. */
  update(delta: number) {
    if (!this.seq) return;
    const shot = this.seq.shots[this.shot];
    if (!shot) return;
    this.t += delta; this.elapsed += delta;
    // camera move
    if (shot.camera.moveTo && !this.host.reducedMotion()) {
      const k = ease(Math.min(1, this.t / shot.duration));
      this.host.camera.position.lerpVectors(v3(shot.camera.pos), v3(shot.camera.moveTo), k);
      this.host.camera.lookAt(v3(shot.camera.target));
    }
    // subtitles
    for (const s of shot.subtitles ?? []) {
      const key = `${shot.n}:${s.at}`;
      if (this.t >= s.at && !this.shown.has(key)) { this.shown.add(key); this.cb.onSubtitle?.(`${s.who}: ${s.line}`); }
    }
    // effects with a life of their own
    for (const p of this.pulses) {
      const age = this.elapsed - p.start;
      p.light.intensity = age < 0.4 ? 3 * (age / 0.4) : Math.max(0, 3 * (1 - (age - 0.4) / 1.2));
    }
    this.fx.traverse((o) => { if (o.userData.flicker) (o as THREE.Mesh).visible = Math.sin(this.elapsed * 19) > -0.7; });
    if (this.t >= shot.duration) this.next();
  }

  private next() {
    if (!this.seq) return;
    this.shot += 1;
    this.t = 0;
    const shot = this.seq.shots[this.shot];
    if (!shot) { this.finish(false); return; }
    this.cb.onShot?.(shot.n);
    this.cb.onSubtitle?.(null);
    const { camera } = this.host;
    camera.position.set(...shot.camera.pos);
    camera.fov = shot.camera.fov ?? 40;
    camera.updateProjectionMatrix();
    camera.lookAt(v3(shot.camera.target));
    if (shot.mood && this.seq.moods?.[shot.mood]) this.applyMood(this.seq.moods[shot.mood]);
    for (const a of shot.actors ?? []) this.placeActor(a);
    this.fx.clear(); this.pulses = [];
    for (const f of shot.fx ?? []) this.effect(f);
  }

  private placeActor(a: CinematicActor) {
    const { explore } = this.host;
    const model = a.id === 'player' ? explore.player : explore.npcs.get(a.id)?.model;
    if (!model) return;                                   // an NPC this island does not have: skip
    if (a.id !== 'player') explore.borrow(a.id, a.at ? v3(a.at) : explore.npcs.get(a.id)!.home, a.face ? new THREE.Vector3(a.face[0], 0, a.face[1]) : model.root.position);
    else if (a.at) model.root.position.set(...a.at);
    if (a.face) model.root.lookAt(a.face[0], model.root.position.y, a.face[1]);
    model.root.visible = !a.hidden;
    if (a.gesture && model.clips.includes(a.gesture)) model.gesture(a.gesture);
  }

  private applyMood(m: CinematicMood) {
    const { hemi, sun, scene } = this.host;
    const fog = scene.fog as THREE.Fog;
    if (m.sky) { PALETTE.skyTop.set(m.sky[0]); PALETTE.skyHorizon.set(m.sky[1]); }
    if (m.fog) { fog.color.set(m.fog); PALETTE.fog.set(m.fog); }
    if (m.fogRange) { fog.near = m.fogRange[0]; fog.far = m.fogRange[1]; }
    if (m.sun?.colour) sun.color.set(m.sun.colour);
    if (m.sun?.intensity !== undefined) sun.intensity = m.sun.intensity;
    if (m.sun?.dir) sun.position.set(...m.sun.dir);
    if (m.hemi?.sky) hemi.color.set(m.hemi.sky);
    if (m.hemi?.ground) hemi.groundColor.set(m.hemi.ground);
    if (m.hemi?.intensity !== undefined) hemi.intensity = m.hemi.intensity;
  }

  /** Named effects. Unknown names are ignored so a sequence file can mention effects this build lacks. */
  private effect(name: string) {
    const props = this.seq?.props ?? {};
    const at = (key: string) => (props[key] ? v3(props[key]) : null);
    try {
      if (name.startsWith('tear')) {
        const p = at('tear'); if (!p) return;
        const k = Number(name.split(':')[1] ?? 1);
        const g = new THREE.Group(); g.position.copy(p);
        const core = new THREE.Mesh(new THREE.PlaneGeometry(0.35 * k, 2.8), new THREE.MeshBasicMaterial({ color: '#dff2ff', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        core.position.y = 1.4; g.add(core);
        for (let i = 0; i < 4; i += 1) {
          const halo = new THREE.Mesh(new THREE.PlaneGeometry((1.2 + i * 0.9) * k, 3 + i * 0.3), new THREE.MeshBasicMaterial({ color: '#8fc8ff', transparent: true, opacity: 0.3 / (i + 1), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
          halo.position.y = 1.5; halo.rotation.y = i * 0.5; halo.userData.flicker = true; g.add(halo);
        }
        const light = new THREE.PointLight('#9fd0ff', 60 * k, 40, 1.4); light.position.y = 1.7; g.add(light);
        this.fx.add(g);
      } else if (name === 'apples') {
        const from = at('basket'), to = at('arrival'); if (!from || !to) return;
        const dir = to.clone().sub(from).setY(0).normalize();
        const red = new THREE.MeshStandardMaterial({ color: '#b3302a', roughness: 0.55 }), bruised = new THREE.MeshStandardMaterial({ color: '#8a5a2b', roughness: 0.8 });
        let seed = 3; const r = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
        for (let i = 0; i < 16; i += 1) {
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), r() < 0.3 ? bruised : red);
          m.position.copy(from).addScaledVector(dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), (r() - 0.5) * 1.2), r() * 3.4);
          m.position.y = this.host.explore.groundAt(m.position.x, m.position.z, from.y) + 0.045;
          this.fx.add(m);
        }
      } else if (name === 'basket' || name === 'basket:tipped') {
        const p = at('basket'); if (!p) return;
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.26, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#a8824e', roughness: 0.9, side: THREE.DoubleSide }));
        b.position.copy(p); b.position.y += 0.13;
        if (name.endsWith('tipped')) { b.rotation.z = Math.PI / 2 - 0.3; b.position.y += 0.05; }
        this.fx.add(b);
      } else if (name === 'band-pulse') {
        const player = this.host.explore.player; if (!player) return;
        let hand: THREE.Object3D | undefined;
        player.root.traverse((o) => { if (!hand && (o as THREE.Bone).isBone && o.name === 'hand_l') hand = o; });
        const light = new THREE.PointLight('#2dd4bf', 0, 2.5, 1.5);
        (hand ?? player.root).add(light);
        light.position.set(0, hand ? 0.02 : 1.0, 0);
        this.pulses.push({ light, start: this.elapsed });
        this.fx.add(new THREE.Object3D());          // keeps the group non-empty; the light itself is removed in finish()
        this.lights.push(light);
      }
    } catch { /* an effect that cannot be built is simply not shown */ }
  }
  private lights: THREE.PointLight[] = [];

  private finish(skipped: boolean) {
    const seq = this.seq; if (!seq) return;
    const { explore, camera, hemi, sun, scene } = this.host;
    this.seq = null;
    this.fx.clear(); scene.remove(this.fx);
    for (const l of this.lights) l.removeFromParent(); this.lights = []; this.pulses = [];
    if (this.saved) {
      const s = this.saved;
      camera.fov = s.fov; camera.updateProjectionMatrix();
      hemi.color.copy(s.hemi[0]); hemi.groundColor.copy(s.hemi[1]); hemi.intensity = s.hemi[2];
      sun.color.copy(s.sun[0]); sun.intensity = s.sun[1]; sun.position.copy(s.sun[2]);
      const fog = scene.fog as THREE.Fog; fog.color.copy(s.fog[0]); fog.near = s.fog[1]; fog.far = s.fog[2];
      PALETTE.fog.copy(s.fog[0]); PALETTE.skyTop.copy(s.sky[0]); PALETTE.skyHorizon.copy(s.sky[1]);
      explore.setView(s.view);
    }
    this.host.setMarkersVisible?.(true);
    explore.release();
    explore.place(seq.end.spawn[0], seq.end.spawn[1], seq.end.heading ?? Math.PI);
    explore.yaw = seq.end.heading ?? Math.PI;
    explore.suspended = false;
    explore.inputEnabled = true;
    this.shown.clear();
    this.cb.onSubtitle?.(null);
    this.cb.onEnd?.(skipped);
  }
}

function v3(a: [number, number, number]) { return new THREE.Vector3(a[0], a[1], a[2]); }
