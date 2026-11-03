// Rigged GLB characters (Pathfinder, Mira, Tove) with idle/walk/run blending.
// Rendering only: movement, collision and quest rules live elsewhere and just
// tell a character how fast it is moving.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Locomotion = 'Idle' | 'Walk' | 'Run';

/** Speeds (m/s) at which the authored Walk and Run clips look right, and the switch points. */
export const GAIT = { walkSpeed: 1.4, runSpeed: 3.6, startWalk: 0.15, startRun: 2.6 } as const;

/** Which locomotion clip a speed should use. Pure, so it is unit-tested. */
export function locomotionFor(speed: number): Locomotion {
  if (speed >= GAIT.startRun) return 'Run';
  if (speed >= GAIT.startWalk) return 'Walk';
  return 'Idle';
}

/** Playback rate so feet don't slide: the clip's authored speed scaled to the actual speed, clamped. */
export function playbackRate(state: Locomotion, speed: number): number {
  if (state === 'Walk') return THREE.MathUtils.clamp(speed / GAIT.walkSpeed, 0.6, 1.5);
  if (state === 'Run') return THREE.MathUtils.clamp(speed / GAIT.runSpeed, 0.7, 1.4);
  return 1;
}

export interface CharacterModel {
  readonly root: THREE.Group;
  readonly clips: string[];
  readonly height: number;
  /** Current locomotion clip. */
  readonly state: Locomotion;
  setSpeed(speed: number): void;
  /** One-off gesture (Talk, Interact, PickUp); returns to locomotion afterwards. */
  gesture(name: string): void;
  update(delta: number): void;
  stats(): { triangles: number; textures: number; bones: number; clips: string[]; state: Locomotion };
  dispose(): void;
}

const FADE = 0.25;

export async function loadCharacterModel(url: string, onProgress?: (fraction: number) => void): Promise<CharacterModel> {
  const gltf = await new GLTFLoader().loadAsync(url, (e) => { if (e.total) onProgress?.(e.loaded / e.total); });
  const root = new THREE.Group();
  root.name = `character:${url.split('/').pop()}`;
  root.add(gltf.scene);

  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const skeletons = new Set<THREE.Skeleton>(); // each owns a bone-matrix texture on the GPU
  let triangles = 0;
  let bones = 0;
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if ((o as THREE.Bone).isBone) bones += 1;
    if (!mesh.isMesh) return;
    // Skinned meshes are culled by their bind-pose bounds, which animation can leave behind.
    mesh.frustumCulled = false;
    if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
    geometries.add(mesh.geometry);
    const index = mesh.geometry.index;
    triangles += (index ? index.count : mesh.geometry.attributes.position.count) / 3;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture)?.isTexture) textures.add(value as THREE.Texture);
    }
  });

  const box = new THREE.Box3().setFromObject(gltf.scene);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));

  let state: Locomotion = 'Idle';
  let speed = 0;
  let gesturing: THREE.AnimationAction | null = null;
  const locomotion = (name: Locomotion) => actions.get(name) ?? actions.get('Idle');
  locomotion('Idle')?.play();

  const onFinished = (e: { action: THREE.AnimationAction }) => {
    if (e.action !== gesturing) return;
    const back = locomotion(state);
    if (back) { back.reset().play(); e.action.crossFadeTo(back, FADE, false); }
    gesturing = null;
  };
  mixer.addEventListener('finished', onFinished);

  return {
    root,
    clips: [...actions.keys()],
    height: box.max.y - box.min.y,
    get state() { return state; },
    setSpeed(next) {
      speed = Math.max(0, next);
      const target = locomotionFor(speed);
      const action = locomotion(target);
      if (target !== state && !gesturing) {
        const from = locomotion(state);
        if (action && from && action !== from) {
          action.reset().play();
          from.crossFadeTo(action, FADE, true);
        }
      }
      state = target;
      action?.setEffectiveTimeScale(playbackRate(target, speed));
    },
    gesture(name) {
      const action = actions.get(name);
      if (!action || gesturing) return;
      action.reset().setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      locomotion(state)?.crossFadeTo(action, FADE, false);
      gesturing = action;
    },
    update(delta) { mixer.update(delta); },
    stats: () => ({ triangles: Math.round(triangles), textures: textures.size, bones, clips: [...actions.keys()], state }),
    dispose() {
      mixer.removeEventListener('finished', onFinished);
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      root.removeFromParent();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
      skeletons.forEach((s) => s.dispose());
    },
  };
}
