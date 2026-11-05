// The 3D world. Imperative Three.js, independent of React: the UI tells it
// what to show (camera mode, destination states, character pose) and it
// reports selections and loading state back. Game rules never live here.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE, createClouds, createSky, createSparkles, createWater, setWaterAnimated, updateClouds, type Water } from './environment';
import { createCharacter, type Character, type Pose } from './characters';
import type { CharacterModel } from './character-model';
import { ExploreRuntime, type ExploreView } from './explore-runtime';
import { CinematicPlayer, type CinematicSequence, type CinematicCallbacks } from './cinematic';
import { loadStreamedIsland, type StreamedIsland } from './streamed-island';

import type { Quality } from './capabilities';

export type { Quality };
export type MarkerStatus = 'available' | 'in-progress' | 'completed' | 'locked' | 'planned';

export interface DestinationView {
  id: string;
  name: string;
  status: MarkerStatus;
  position: [number, number];
}

export type CameraMode =
  | { kind: 'overview'; panel?: 'left' | 'right' | 'bottom' }
  | { kind: 'map'; selected?: string | null; panel?: 'left' | 'right' | 'bottom' }
  | { kind: 'focus'; destination: string; character?: string; pose?: Pose; panel?: 'right' | 'bottom' }
  | { kind: 'celebrate'; destination: string; character?: string }
  // A fixed camera, used by development checks of rigged characters.
  | { kind: 'inspect'; position: [number, number, number]; target: [number, number, number] }
  // Free exploration: the Pathfinder walks the island with a follow or first-person camera.
  | { kind: 'explore'; view: ExploreView };

export interface LoadState {
  phase: 'loading' | 'refining' | 'ready' | 'error';
  progress: number; // 0..1 for the current download
  lod: 'none' | 'low' | 'high';
  error?: string;
}

export interface WorldOptions {
  quality: Quality;
  reducedMotion: boolean;
  modelBase: string; // e.g. "./models/"
  /** Island files under modelBase; defaults to island-low.glb then island-high.glb. */
  islandFiles?: { low: string; high?: string };
  /** World units per island-A block: 1 for the original island, 0.25 for the metre-scale island B. */
  scale?: number;
  /** Streamed-tile manifest under modelBase (realistic island). When set, `islandFiles` is not used for drawing. */
  streamed?: string;
  /** Scale of the procedural quest characters (they are about 1.8 units tall at scale 1). */
  characterScale?: number;
  onSelect?: (id: string) => void;
  onHover?: (id: string | null) => void;
  onLoad?: (state: LoadState) => void;
}

interface Marker {
  id: string;
  group: THREE.Group;
  ring: THREE.Mesh;
  gem: THREE.Mesh;
  beam: THREE.Mesh;
  hit: THREE.Mesh;
  ground: THREE.Vector3;
  status: MarkerStatus;
  label?: HTMLElement;
}

const STATUS_COLOR: Record<MarkerStatus, string> = {
  available: '#f2b134',
  'in-progress': '#f2b134',
  completed: '#2dd4bf',
  locked: '#8a94a6',
  planned: '#cfe9ff',
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private clock = new THREE.Timer();
  private frame = 0;
  private disposed = false;
  private options: WorldOptions;
  private island = new THREE.Group();
  private islandMeshes: THREE.Mesh[] = [];   // ray tests (ground, camera obstruction, markers)
  private islandChunks: THREE.Mesh[] = [];   // merged render geometry, when the island was merged
  private islandMaterial: THREE.MeshLambertMaterial;
  private shimmer = { value: 0 };
  private water: Water;
  private clouds: THREE.Group;
  private sparkles: THREE.Points;
  private markers = new Map<string, Marker>();
  private destinations: DestinationView[] = [];
  private character: Character | null = null;
  private characterKey: string | null = null;
  private burst: { points: THREE.Points; start: number } | null = null;
  private mode: CameraMode = { kind: 'overview' };
  private flight: { fromPos: THREE.Vector3; fromTarget: THREE.Vector3; toPos: THREE.Vector3; toTarget: THREE.Vector3; start: number; duration: number } | null = null;
  private pointer = new THREE.Vector2();
  private raycaster = new THREE.Raycaster();
  private hovered: string | null = null;
  private resizeObserver: ResizeObserver;
  private listeners: [EventTarget, string, EventListener][] = [];
  private lod: LoadState['lod'] = 'none';
  private fps = { frames: 0, last: 0, value: 0 };
  private viewOffset: 'left' | 'right' | 'bottom' | null = null;
  private actors = new Set<CharacterModel>();
  private environment: THREE.Texture;
  /** Distances, marker sizes and camera framing were authored for island A; `s` rescales them. */
  private readonly s: number;
  private readonly charScale: number;
  /** Player, persistent NPCs, input and the follow camera for free exploration. */
  readonly explore: ExploreRuntime;
  /** Real-time cinematics played inside the explore world (opening, quest transitions). */
  readonly cinematic: CinematicPlayer;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private borrowedNpc: string | null = null;
  private markersHidden = false;
  /** Distance-streamed tiles (realistic island only); null for the single-GLB islands A and B. */
  private streamed: StreamedIsland | null = null;
  private streamFocus = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, options: WorldOptions) {
    this.options = options;
    this.s = options.scale ?? 1;
    this.charScale = options.characterScale ?? 2.2;
    const s = this.s;
    const high = options.quality === 'high';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: high, powerPreference: high ? 'high-performance' : 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // life-size islands (B, and the streamed realistic island at island-A scale) need a close near plane for first person
    this.camera = new THREE.PerspectiveCamera(42, 1, s === 1 && !options.streamed ? 1 : 0.05, 6000);
    this.camera.position.set(-330 * s, 300 * s, 470 * s);

    this.scene.fog = new THREE.Fog(PALETTE.fog, 900 * s, 3200 * s);
    this.scene.add(createSky());
    this.hemi = new THREE.HemisphereLight('#eaf6ff', '#4b6b4e', 1.5);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight('#fff4dc', 2.1);
    sun.position.set(-260, 420, 200);
    this.scene.add(sun);
    this.sun = sun;
    // Image-based light for PBR characters (leather, cloth, skin). The island's
    // Lambert material ignores scene.environment, so its look is unchanged.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.environment;
    this.scene.environmentIntensity = 0.55;

    this.water = createWater(!options.reducedMotion);
    this.scene.add(this.water.mesh);
    this.clouds = createClouds(high ? 14 : 7);
    this.scene.add(this.clouds);
    this.sparkles = createSparkles(high ? 220 : 70);
    this.scene.add(this.sparkles);

    this.islandMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.islandMaterial.onBeforeCompile = (shader) => {
      // Foliage "wind shimmer": a soft brightness wave over green surfaces.
      // (Shading only, so the merged island mesh never cracks.)
      shader.uniforms.uShimmer = this.shimmer;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uShimmer;\nvarying vec3 vWorldPos;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          float greenness = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * 5.0, 0.0, 1.0);
          float wave = sin(vWorldPos.x * 0.08 + vWorldPos.z * 0.05 + uShimmer * 1.6) * sin(vWorldPos.z * 0.11 - uShimmer * 1.1);
          diffuseColor.rgb *= 1.0 + greenness * wave * 0.07;`);
    };
    this.island.name = 'viking-island';
    this.scene.add(this.island);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = !options.reducedMotion;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 60 * s;
    this.controls.maxDistance = 1100 * s;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minPolarAngle = 0.25;
    this.controls.target.set(0, 20 * s, 0);
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.enabled = false;
    this.controls.addEventListener('start', () => { this.flight = null; });

    this.listen(canvas, 'pointermove', (e) => this.onPointerMove(e as PointerEvent));
    this.listen(canvas, 'pointerleave', () => this.setHovered(null));
    this.listen(canvas, 'click', (e) => this.onClick(e as MouseEvent));
    this.listen(canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.options.onLoad?.({ phase: 'error', progress: 0, lod: this.lod, error: 'The graphics context was lost.' });
    });
    this.clock.connect(document); // pauses the timer while the tab is hidden

    this.explore = new ExploreRuntime({
      scene: this.scene,
      camera: this.camera,
      canvas,
      islandMeshes: () => this.islandMeshes,
      addActor: (a) => this.addActor(a),
      removeActor: (a) => this.removeActor(a),
      modelBase: options.modelBase,
    });

    this.cinematic = new CinematicPlayer({
      scene: this.scene,
      camera: this.camera,
      explore: this.explore,
      hemi: this.hemi,
      sun: this.sun,
      reducedMotion: () => Boolean(this.options.reducedMotion),
      setMarkersVisible: (visible) => { this.markersHidden = !visible; for (const m of this.markers.values()) m.group.visible = visible; },
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.loop();
  }

  // ---- Loading ----

  async loadIsland(): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const base = this.options.modelBase;
    const files = this.options.islandFiles ?? { low: 'island-low.glb', high: 'island-high.glb' };
    const report = (state: LoadState) => { if (!this.disposed) this.options.onLoad?.(state); };
    if (this.options.streamed) return this.loadStreamed(loader, report);
    try {
      report({ phase: 'loading', progress: 0, lod: 'none' });
      const low = await loader.loadAsync(`${base}${files.low}`, (e) => {
        if (e.total) report({ phase: 'loading', progress: e.loaded / e.total, lod: 'none' });
      });
      if (this.disposed) return;
      this.setIsland(low.scene, 'low');
      if (this.options.quality !== 'high' || !files.high) {
        report({ phase: 'ready', progress: 1, lod: 'low' });
        return;
      }
      report({ phase: 'refining', progress: 0, lod: 'low' });
      try {
        const high = await loader.loadAsync(`${base}${files.high}`, (e) => {
          if (e.total) report({ phase: 'refining', progress: e.loaded / e.total, lod: 'low' });
        });
        if (this.disposed) return;
        this.setIsland(high.scene, 'high');
        report({ phase: 'ready', progress: 1, lod: 'high' });
      } catch {
        // The low-detail island is already showing; keep it.
        report({ phase: 'ready', progress: 1, lod: 'low' });
      }
    } catch (error) {
      report({ phase: 'error', progress: 0, lod: this.lod, error: error instanceof Error ? error.message : 'The island model could not be loaded.' });
    }
  }

  /** Realistic island: shared library + nearby tiles first, then distance streaming (see streamed-island.ts). */
  private async loadStreamed(loader: GLTFLoader, report: (state: LoadState) => void) {
    try {
      report({ phase: 'loading', progress: 0, lod: 'none' });
      const dir = this.options.streamed!.replace(/[^/]*$/, '');
      const island = await loadStreamedIsland({
        loader,
        base: `${this.options.modelBase}${dir}`,
        parent: this.island,
        focus: this.controls.target.clone(),
        onProgress: (p) => report({ phase: 'loading', progress: p, lod: 'none' }),
        onTilesChanged: () => {
          // new ground under markers and quest cameras; the camera itself is not moved
          if (!this.streamed) return;
          this.islandMeshes = this.streamed.proxies();
          this.focusCache.clear();
          this.refreshMarkerHeights();
        },
      });
      if (this.disposed) { island.dispose(); return; }
      this.streamed = island;
      this.islandMeshes = island.proxies();
      this.lod = 'high';
      this.placeMarkers();
      report({ phase: 'ready', progress: 1, lod: 'high' });
    } catch (error) {
      report({ phase: 'error', progress: 0, lod: this.lod, error: error instanceof Error ? error.message : 'The island could not be loaded.' });
    }
  }

  /** Re-reads marker ground heights (streamed tiles arrived) without re-framing the camera. */
  private refreshMarkerHeights() {
    for (const d of this.destinations) {
      const marker = this.markers.get(d.id);
      if (!marker) continue;
      const y = this.surfaceHeight(d.position[0], d.position[1]);
      if (y === null || Math.abs(y - marker.ground.y) < 0.01) continue;
      marker.ground.set(d.position[0], y, d.position[1]);
      marker.group.position.copy(marker.ground);
    }
    if (this.character && (this.mode.kind === 'focus' || this.mode.kind === 'celebrate')) this.placeCharacter();
  }

  private setIsland(root: THREE.Object3D, lod: 'low' | 'high') {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        (mesh.material as THREE.Material).dispose();
        mesh.material = this.islandMaterial;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        meshes.push(mesh);
      }
    });
    for (const old of this.islandMeshes) old.geometry.dispose();
    for (const old of this.islandChunks) old.geometry.dispose();
    this.islandChunks = [];
    this.island.clear();
    root.updateMatrixWorld(true);
    // An island exported object by object (island B: ~215 meshes) is drawn as a grid of merged
    // chunks (one material, far fewer draw calls). The original small meshes are kept, off-scene,
    // for ray tests: their tight bounds keep per-frame camera checks cheap.
    const merged = meshes.length > 64 ? this.mergeIntoChunks(meshes, 8) : null;
    if (merged) {
      for (const chunk of merged) this.island.add(chunk);
      this.islandChunks = merged;
    } else {
      this.island.add(root);
    }
    this.islandMeshes = meshes;
    this.lod = lod;
    this.placeMarkers();
  }

  /** Bakes world transforms and merges meshes into an n × n grid of chunks (positions, normals, colours). */
  private mergeIntoChunks(meshes: THREE.Mesh[], n: number): THREE.Mesh[] {
    const box = new THREE.Box3();
    meshes.forEach((m) => box.expandByObject(m));
    const size = box.getSize(new THREE.Vector3());
    const cells = new Map<number, THREE.BufferGeometry[]>();
    const centre = new THREE.Vector3();
    for (const mesh of meshes) {
      const src = mesh.geometry;
      const count = src.attributes.position.count;
      const g = new THREE.BufferGeometry();
      const copy = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined, size: number, fill: number) => {
        const out = new Float32Array(count * size);
        for (let i = 0; i < count; i += 1) {
          out[i * size] = attr ? attr.getX(i) : fill;
          out[i * size + 1] = attr ? attr.getY(i) : fill;
          out[i * size + 2] = attr ? attr.getZ(i) : fill;
        }
        return new THREE.BufferAttribute(out, size);
      };
      g.setAttribute('position', copy(src.attributes.position, 3, 0));
      g.setAttribute('normal', copy(src.attributes.normal, 3, 0));
      g.setAttribute('color', copy(src.attributes.color, 3, 1));
      g.setIndex(src.index ? Array.from(src.index.array) : [...Array(count).keys()]);
      if (!src.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(mesh.matrixWorld);
      g.computeBoundingBox();
      g.boundingBox!.getCenter(centre);
      const cx = THREE.MathUtils.clamp(Math.floor(((centre.x - box.min.x) / (size.x || 1)) * n), 0, n - 1);
      const cz = THREE.MathUtils.clamp(Math.floor(((centre.z - box.min.z) / (size.z || 1)) * n), 0, n - 1);
      const key = cz * n + cx;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key)!.push(g);
    }
    const chunks: THREE.Mesh[] = [];
    for (const [key, parts] of cells) {
      const geometry = mergeGeometries(parts, false);
      parts.forEach((p) => p.dispose());
      if (!geometry) continue;
      geometry.computeBoundingSphere();
      const chunk = new THREE.Mesh(geometry, this.islandMaterial);
      chunk.name = `island-chunk-${key}`;
      chunk.matrixAutoUpdate = false;
      chunks.push(chunk);
    }
    return chunks;
  }

  /** Height of the island surface at (x, z), or null over open water. */
  surfaceHeight(x: number, z: number): number | null {
    if (!this.islandMeshes.length) return null;
    this.raycaster.set(new THREE.Vector3(x, 400, z), new THREE.Vector3(0, -1, 0));
    this.raycaster.far = 500;
    const hit = this.raycaster.intersectObjects(this.islandMeshes, false)[0];
    return hit ? hit.point.y : null;
  }

  // ---- Destinations / markers ----

  setDestinations(list: DestinationView[]) {
    this.destinations = list;
    for (const d of list) {
      let marker = this.markers.get(d.id);
      if (!marker) {
        marker = this.createMarker(d);
        this.markers.set(d.id, marker);
        this.scene.add(marker.group);
      }
      this.applyStatus(marker, d.status);
    }
    this.placeMarkers();
  }

  setLabel(id: string, el: HTMLElement | null) {
    const marker = this.markers.get(id);
    if (marker) marker.label = el ?? undefined;
  }

  private createMarker(d: DestinationView): Marker {
    const group = new THREE.Group();
    group.name = `marker-${d.id}`;
    group.scale.setScalar(this.s);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(7, 0.8, 8, 40), new THREE.MeshBasicMaterial({ color: '#f2b134' }));
    ring.rotation.x = Math.PI / 2;
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(3.2, 0), new THREE.MeshLambertMaterial({ color: '#f2b134', emissive: '#7a5200', flatShading: true }));
    gem.position.y = 16;
    const beamGeometry = new THREE.CylinderGeometry(1.4, 2.6, 38, 12, 1, true);
    beamGeometry.translate(0, 19, 0);
    const beam = new THREE.Mesh(beamGeometry, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    const hit = new THREE.Mesh(new THREE.SphereGeometry(13, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 12;
    hit.userData.destination = d.id;
    group.add(ring, gem, beam, hit);
    return { id: d.id, group, ring, gem, beam, hit, ground: new THREE.Vector3(d.position[0], 20, d.position[1]), status: d.status };
  }

  private applyStatus(marker: Marker, status: MarkerStatus) {
    marker.status = status;
    const color = new THREE.Color(STATUS_COLOR[status]);
    (marker.ring.material as THREE.MeshBasicMaterial).color.copy(color);
    const gemMat = marker.gem.material as THREE.MeshLambertMaterial;
    gemMat.color.copy(color);
    gemMat.emissive.copy(color).multiplyScalar(status === 'locked' ? 0.05 : 0.35);
    marker.beam.visible = status === 'available' || status === 'in-progress';
    (marker.beam.material as THREE.MeshBasicMaterial).color.copy(color);
    marker.gem.scale.setScalar(status === 'planned' ? 0.7 : 1);
  }

  private placeMarkers() {
    for (const d of this.destinations) {
      const marker = this.markers.get(d.id);
      if (!marker) continue;
      const y = this.surfaceHeight(d.position[0], d.position[1]) ?? 18;
      marker.ground.set(d.position[0], y, d.position[1]);
      marker.group.position.copy(marker.ground);
    }
    if (this.character && this.mode.kind !== 'overview' && this.mode.kind !== 'map') this.placeCharacter();
    this.applyMode(false);
  }

  // ---- Camera modes ----

  setMode(mode: CameraMode) {
    const same = JSON.stringify(mode) === JSON.stringify(this.mode);
    this.mode = mode;
    if (same) return;
    if (mode.kind === 'explore') { this.flight = null; this.explore.enter(mode.view); } else { this.cinematic.skip(); this.explore.exit(); }
    let wantCharacter = (mode.kind === 'focus' || mode.kind === 'celebrate') && mode.character ? mode.character : null;
    // A quest character who exists as a rigged NPC is walked to the quest spot instead of
    // being drawn with primitives; the others keep the procedural figure for now.
    const npc = wantCharacter && this.explore.npcs.has(wantCharacter) ? wantCharacter : null;
    if (npc !== this.borrowedNpc) { this.explore.release(); this.borrowedNpc = npc; }
    if (npc) {
      wantCharacter = null;
      const model = this.explore.npcs.get(npc)!.model;
      if (mode.kind === 'focus' && mode.pose === 'talk') model.gesture('Talk');
      if (mode.kind === 'focus' && (mode.pose === 'point' || mode.pose === 'wave')) model.gesture('Interact');
    }
    if (wantCharacter !== this.characterKey) {
      if (this.character) {
        this.scene.remove(this.character.group);
        this.character.dispose();
        this.character = null;
      }
      this.characterKey = wantCharacter;
      if (wantCharacter) {
        this.character = createCharacter(wantCharacter);
        this.scene.add(this.character.group);
      }
    }
    if (this.character) {
      this.placeCharacter();
      this.character.setPose(mode.kind === 'celebrate' ? 'celebrate' : (mode.kind === 'focus' && mode.pose) || 'idle');
    }
    if (mode.kind === 'celebrate') this.celebrate(mode.destination);
    this.applyMode(true);
  }

  private characterSpot(destination: string): THREE.Vector3 {
    const marker = this.markers.get(destination);
    const base = marker ? marker.ground.clone() : new THREE.Vector3();
    const x = base.x + 9 * this.s;
    const z = base.z + 7 * this.s;
    const y = this.surfaceHeight(x, z) ?? base.y;
    return new THREE.Vector3(x, y, z);
  }

  private placeCharacter() {
    if (this.mode.kind !== 'focus' && this.mode.kind !== 'celebrate') return;
    if (this.borrowedNpc) {
      const spot = this.characterSpot(this.mode.destination);
      this.explore.borrow(this.borrowedNpc, spot, this.camera.position);
      return;
    }
    if (!this.character) return;
    const spot = this.characterSpot(this.mode.destination);
    this.character.group.position.copy(spot);
    this.character.group.scale.setScalar(this.charScale);
  }

  private applyMode(animate: boolean) {
    const mode = this.mode;
    let pos: THREE.Vector3;
    let target: THREE.Vector3;
    this.controls.enabled = mode.kind === 'map';
    this.controls.autoRotate = mode.kind === 'overview' && !this.options.reducedMotion;
    this.controls.autoRotateSpeed = 0.35;
    this.viewOffset = mode.kind === 'celebrate' || mode.kind === 'inspect' || mode.kind === 'explore' ? null : mode.panel ?? null;
    this.resize();
    if (mode.kind === 'explore') { this.controls.enabled = false; this.controls.autoRotate = false; return; }
    // Map-scale zoom limits would push a close character camera 60 units away.
    this.controls.minDistance = mode.kind === 'inspect' ? 0.5 : 60 * this.s;
    if (mode.kind === 'inspect') {
      pos = new THREE.Vector3(...mode.position);
      target = new THREE.Vector3(...mode.target);
    } else if (mode.kind === 'overview') {
      target = new THREE.Vector3(0, 25 * this.s, 0);
      const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
      if (!Number.isFinite(dir.x) || dir.lengthSq() < 0.5) dir.set(-0.6, 0, 0.8);
      pos = target.clone().add(dir.multiplyScalar(560 * this.s)).setY(330 * this.s);
    } else if (mode.kind === 'map') {
      const marker = mode.selected ? this.markers.get(mode.selected) : undefined;
      if (marker) {
        target = marker.ground.clone().add(new THREE.Vector3(0, 10 * this.s, 0));
        const dir = this.camera.position.clone().sub(target).setY(0).normalize();
        if (dir.lengthSq() < 0.5) dir.set(0, 0, 1);
        pos = target.clone().add(dir.multiplyScalar(190 * this.s)).add(new THREE.Vector3(0, 140 * this.s, 0));
      } else {
        target = new THREE.Vector3(0, 20 * this.s, 0);
        const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize();
        if (dir.lengthSq() < 0.5) dir.set(-0.6, 0, 0.8);
        pos = target.clone().add(dir.multiplyScalar(520 * this.s)).setY(380 * this.s);
      }
    } else {
      // The light island is coarser up close, so frame from further back.
      // life-size characters on a metre-scale island are framed closer than the original's 4-block figures
      const distance = (mode.kind === 'celebrate' ? 40 : 28) * (this.charScale / 2.2) * (this.s === 1 ? (this.lod === 'low' ? 1.6 : 1) : 0.55);
      ({ pos, target } = this.focusView(mode.destination, distance));
      if (this.character) this.character.group.lookAt(pos.x, this.character.group.position.y, pos.z);
      if (this.borrowedNpc) this.explore.borrow(this.borrowedNpc, this.characterSpot(mode.destination), pos);
    }
    this.flyTo(pos, target, animate);
  }

  private focusCache = new Map<string, { pos: THREE.Vector3; target: THREE.Vector3 }>();

  /**
   * Camera framing for a quest scene: the character in front, the destination
   * marker behind. Tries several angles and keeps the first one whose line of
   * sight to the character isn't blocked by trees or buildings.
   */
  private focusView(destination: string, distance: number) {
    const key = `${destination}:${distance}:${this.lod}`;
    const cached = this.focusCache.get(key);
    if (cached) return { pos: cached.pos.clone(), target: cached.target.clone() };
    const spot = this.characterSpot(destination);
    const marker = this.markers.get(destination);
    const toMarker = marker ? marker.ground.clone().sub(spot).setY(0).normalize() : new THREE.Vector3(-1, 0, 0);
    if (toMarker.lengthSq() < 0.5) toMarker.set(-1, 0, 0);
    const k = this.charScale / 2.2;                  // framing scales with the character
    const head = spot.clone().add(new THREE.Vector3(0, 4.5 * k, 0));
    const target = spot.clone().add(new THREE.Vector3(0, 3.2 * k, 0)).add(toMarker.clone().multiplyScalar(4 * k));
    const baseAngle = Math.atan2(-toMarker.z, -toMarker.x) + 0.9; // behind the character, off to one side
    let best: THREE.Vector3 | null = null;
    for (let k = 0; k < 12 && !best; k += 1) {
      const angle = baseAngle + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
      const pos = head.clone().add(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).multiplyScalar(distance)).add(new THREE.Vector3(0, distance * 0.42, 0));
      const ground = this.surfaceHeight(pos.x, pos.z);
      if (ground !== null && pos.y < ground + 4 * k) continue;
      if (!this.islandMeshes.length) { best = pos; break; }
      const toHead = head.clone().sub(pos);
      const length = toHead.length();
      this.raycaster.set(pos, toHead.normalize());
      this.raycaster.far = length - 1.5 * k;
      if (!this.raycaster.intersectObjects(this.islandMeshes, false).length) best = pos;
    }
    if (!best) best = head.clone().add(new THREE.Vector3(Math.cos(baseAngle), 1.4, Math.sin(baseAngle)).multiplyScalar(distance));
    this.focusCache.set(key, { pos: best.clone(), target: target.clone() });
    return { pos: best, target };
  }

  private flyTo(pos: THREE.Vector3, target: THREE.Vector3, animate: boolean) {
    if (!animate || this.options.reducedMotion) {
      this.flight = null;
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    const distance = this.camera.position.distanceTo(pos);
    this.flight = {
      fromPos: this.camera.position.clone(),
      fromTarget: this.controls.target.clone(),
      toPos: pos,
      toTarget: target,
      start: this.clock.getElapsed(),
      duration: Math.min(2.4, 0.9 + distance / (600 * this.s)),
    };
  }

  /** Keyboard / button camera control in map mode. */
  orbit(deltaAzimuth: number, deltaPolar: number) {
    if (this.mode.kind !== 'map') return;
    this.flight = null;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += deltaAzimuth;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + deltaPolar, this.controls.minPolarAngle, this.controls.maxPolarAngle);
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  zoom(factor: number) {
    if (this.mode.kind !== 'map') return;
    this.flight = null;
    const offset = this.camera.position.clone().sub(this.controls.target);
    const length = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(length));
    this.controls.update();
  }

  resetView() {
    if (this.mode.kind === 'map') this.setMode({ kind: 'map', selected: null });
  }

  // ---- Rigged characters ----

  /** Plays a cinematic in the explore world; resolves through callbacks. Only valid while exploring. */
  playCinematic(seq: CinematicSequence, cb: CinematicCallbacks = {}) {
    if (this.mode.kind !== 'explore' || !this.explore.ready) { cb.onEnd?.(true); return; }
    this.cinematic.play(seq, cb);
  }

  skipCinematic() { this.cinematic.skip(); }

  /** Adds a loaded character to the scene; it is animated every frame and disposed with the world. */
  addActor(actor: CharacterModel) {
    this.actors.add(actor);
    this.scene.add(actor.root);
  }

  removeActor(actor: CharacterModel) {
    if (this.actors.delete(actor)) actor.dispose();
  }

  // ---- Effects ----

  private celebrate(destination: string) {
    const marker = this.markers.get(destination);
    if (!marker || this.options.reducedMotion) return;
    if (this.burst) this.disposeBurst();
    const count = 160;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const gold = new THREE.Color('#f2b134');
    const teal = new THREE.Color('#2dd4bf');
    for (let i = 0; i < count; i += 1) {
      positions.set([marker.ground.x, marker.ground.y + 18 * this.s, marker.ground.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const up = (12 + Math.random() * 18) * this.s;
      const out = (6 + Math.random() * 14) * this.s;
      velocities.set([Math.cos(a) * out, up, Math.sin(a) * out], i * 3);
      (i % 2 ? gold : teal).toArray(colors, i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.userData.velocities = velocities;
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2.2 * this.s, vertexColors: true, transparent: true }));
    this.scene.add(points);
    this.burst = { points, start: this.clock.getElapsed() };
  }

  private disposeBurst() {
    if (!this.burst) return;
    this.scene.remove(this.burst.points);
    this.burst.points.geometry.dispose();
    (this.burst.points.material as THREE.Material).dispose();
    this.burst = null;
  }

  setReducedMotion(reduced: boolean) {
    this.options.reducedMotion = reduced;
    this.controls.enableDamping = !reduced;
    setWaterAnimated(this.water, !reduced);
    this.applyMode(false);
  }

  // ---- Input ----

  private listen(target: EventTarget, type: string, handler: EventListener) {
    target.addEventListener(type, handler);
    this.listeners.push([target, type, handler]);
  }

  private pick(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.far = Infinity;
    const hits = this.raycaster.intersectObjects([...this.markers.values()].map((m) => m.hit), false);
    return hits.length ? (hits[0].object.userData.destination as string) : null;
  }

  private onPointerMove(e: PointerEvent) {
    if (this.mode.kind !== 'map') return;
    this.setHovered(this.pick(e.clientX, e.clientY));
  }

  private setHovered(id: string | null) {
    if (id === this.hovered) return;
    this.hovered = id;
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.options.onHover?.(id);
  }

  private onClick(e: MouseEvent) {
    if (this.mode.kind !== 'map') return;
    const id = this.pick(e.clientX, e.clientY);
    if (id) this.options.onSelect?.(id);
  }

  // ---- Frame loop ----

  private resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    // When a quest panel covers the right side, shift the view so the
    // character sits in the visible part of the screen.
    if (this.viewOffset === 'right' && w > 900) this.camera.setViewOffset(w, h, w * 0.2, 0, w, h);
    else if (this.viewOffset === 'left' && w > 900) this.camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    this.clock.update();
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const time = this.clock.getElapsed();
    const still = this.options.reducedMotion;

    if (this.flight) {
      const t = Math.min(1, (time - this.flight.start) / this.flight.duration);
      const k = ease(t);
      this.camera.position.lerpVectors(this.flight.fromPos, this.flight.toPos, k);
      // Arc upward mid-flight for a smoother sense of travel.
      this.camera.position.y += Math.sin(Math.PI * k) * Math.min(120 * this.s, this.flight.fromPos.distanceTo(this.flight.toPos) * 0.15);
      this.controls.target.lerpVectors(this.flight.fromTarget, this.flight.toTarget, k);
      if (t >= 1) this.flight = null;
    }
    if (this.mode.kind !== 'explore') this.controls.update(delta);
    this.cinematic.update(delta);
    this.explore.update(delta, still);
    if (this.streamed) {
      const p = this.explore.isActive ? this.explore.state : null;
      if (p) this.streamFocus.set(p.x, p.y, p.z); else this.streamFocus.copy(this.controls.target);
      this.streamed.update(delta, still ? 0 : time, this.camera, this.streamFocus);
    }

    if (!still) {
      this.water.update(time);
      updateClouds(this.clouds, delta);
      this.shimmer.value = time;
      ((this.sparkles.material as THREE.ShaderMaterial).uniforms.time.value = time);
    }
    for (const marker of this.markers.values()) {
      const active = marker.status === 'available' || marker.status === 'in-progress';
      const selected = (this.mode.kind === 'map' && this.mode.selected === marker.id) || this.hovered === marker.id;
      marker.gem.position.y = 16 + (still ? 0 : Math.sin(time * 1.8 + marker.ground.x) * 1.2);
      if (!still) marker.gem.rotation.y += delta * (active ? 1.2 : 0.4);
      const s = selected ? 1.35 : 1;
      marker.ring.scale.setScalar(s * (active && !still ? 1 + Math.sin(time * 3) * 0.06 : 1));
    }
    if (this.character) this.character.update(time, delta, still);
    for (const actor of this.actors) actor.update(delta);
    if (this.burst) {
      const age = time - this.burst.start;
      const attr = this.burst.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const v = this.burst.points.geometry.userData.velocities as Float32Array;
      for (let i = 0; i < attr.count; i += 1) {
        v[i * 3 + 1] -= 22 * this.s * delta;
        attr.setXYZ(i, attr.getX(i) + v[i * 3] * delta, attr.getY(i) + v[i * 3 + 1] * delta, attr.getZ(i) + v[i * 3 + 2] * delta);
      }
      attr.needsUpdate = true;
      (this.burst.points.material as THREE.PointsMaterial).opacity = Math.max(0, 1 - age / 2.6);
      if (age > 2.6) this.disposeBurst();
    }

    this.renderer.render(this.scene, this.camera);
    this.updateLabels();

    this.fps.frames += 1;
    if (time - this.fps.last >= 1) {
      this.fps.value = this.fps.frames / (time - this.fps.last);
      this.fps.frames = 0;
      this.fps.last = time;
    }
  };

  private projected = new THREE.Vector3();
  private updateLabels() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const placed: { x: number; y: number; w: number; h: number; el: HTMLElement }[] = [];
    for (const marker of this.markers.values()) {
      if (!marker.label) continue;
      this.projected.copy(marker.ground).setY(marker.ground.y + 26 * this.s).project(this.camera);
      const visible = !this.markersHidden && this.projected.z < 1 && Math.abs(this.projected.x) < 1.1 && Math.abs(this.projected.y) < 1.1;
      marker.label.style.visibility = visible ? 'visible' : 'hidden';
      if (visible) {
        placed.push({
          x: (this.projected.x * 0.5 + 0.5) * w,
          y: (-this.projected.y * 0.5 + 0.5) * h,
          w: marker.label.offsetWidth,
          h: marker.label.offsetHeight + 6,
          el: marker.label,
        });
      }
    }
    // Labels are anchored to their 3D point; when two would overlap on screen,
    // lift the higher one so both stay readable.
    placed.sort((a, b) => b.y - a.y);
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const a = placed[i];
        const b = placed[j];
        const overlapX = Math.abs(a.x - b.x) < (a.w + b.w) / 2;
        const overlapY = a.y > b.y - b.h && a.y - a.h < b.y;
        if (overlapX && overlapY) a.y = b.y - b.h;
      }
    }
    for (const p of placed) p.el.style.transform = `translate(-50%, -100%) translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }

  /** Measured numbers for the performance report and tests. */
  stats() {
    const info = this.renderer.info;
    return {
      fps: Math.round(this.fps.value),
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      lod: this.lod,
      pixelRatio: this.renderer.getPixelRatio(),
      markers: [...this.markers.values()].map((m) => ({ id: m.id, y: Math.round(m.ground.y * 10) / 10, status: m.status })),
      camera: this.camera.position.toArray().map((v) => Math.round(v * 100) / 100),   // cm: island B is metre-scale
      character: this.borrowedNpc ?? this.characterKey,
      mode: this.mode.kind,
      explore: this.explore.stats(),
      streamed: this.streamed?.stats() ?? null,
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.clock.dispose();
    for (const [target, type, handler] of this.listeners) target.removeEventListener(type, handler);
    this.listeners = [];
    this.controls.dispose();
    this.disposeBurst();
    this.character?.dispose();
    this.cinematic.skip();
    this.explore.dispose();
    this.streamed?.dispose();
    this.streamed = null;
    for (const actor of this.actors) actor.dispose();
    this.actors.clear();
    this.environment.dispose();
    for (const m of this.islandMeshes) m.geometry.dispose();   // off-scene ray-test meshes
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.islandMaterial.dispose();
    this.renderer.dispose();
  }
}
