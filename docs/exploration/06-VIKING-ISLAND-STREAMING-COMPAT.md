# Viking island streaming: compatibility report (written before integration)

4 November 2026 · branch `feature/viking-island-streaming` (from `feature/continuous-exploration` @ `d4a9477`)

## What exists in the game today (audited)
| System | Where | How it works |
|---|---|---|
| Entry point | `index.html` → `src/main.tsx` → `App.tsx` | `App` loads `data/world.json` (destinations + `island` config), the quests and the curriculum, validates them, then renders the screens over one persistent `WorldStage`. |
| World loading | `WorldRenderer.loadIsland()` | Loads `island.files.low`, then optionally `.high`, as **meshopt-compressed** GLBs (`MeshoptDecoder`). It **replaces every material** with one vertex-colour Lambert material, merges more than 64 meshes into an 8×8 chunk grid, and keeps the original meshes off-scene for ray tests. |
| Rendering engine | three.js **0.186** (React 18 + Vite 6) | Hemisphere and sun lights, `RoomEnvironment` image-based light, procedural sky, water at y = −0.4, clouds, fog, no shadow maps. |
| Island in use | `world.json → island` | **Island B** (144 m, `scale 0.25`, `nav-island-b.json`). Island A's GLBs are still shipped. |
| Player controller | `src/world/explore.ts` (pure TS, unit tested) + `explore-runtime.ts` | 1 m **walk grid** (`NavData`: heights, blocked cells, `step_max`, spawn, zones), camera-relative WASD, slide-along-walls. Third-person follow camera that raycasts island meshes for obstructions, first person on V. |
| Collision | Walk grid only | Blocked cells (buildings, trees, walls) and null cells (water and void). There is no physics library. |
| Terrain height | Walk grid (player) and raycasts on island meshes (markers, quest camera, NPC spots) | |
| NPCs, dialogue, interactions | `public/data/explore.json`, `ExploreScreen.tsx`, `pickTarget()` | Mira and Tove are rigged GLBs at fixed positions in Blender coordinates. Objects use `at` positions. Destinations act as quest triggers. |
| Quests, UI, HUD, learning | `src/engine/*`, `src/ui/*` | Independent of the 3D world. Destinations come from `world.json` positions. |
| Asset tooling | `tools/optimize-island.mjs` | gltf-transform 4.5 + meshoptimizer (EXT_meshopt_compression), Node 22. |

## What the standalone pipeline is (reviewed)
- **Location:** `Downloads/Viking_realistic island/threejs_validation/`.
- **Reports reviewed:** `ISLAND_PIPELINE_REPORT.md` and `README.md`. All 0 errors and 0 warnings in `results/pipeline_checks.json`.
- **Standalone measurements:** first view 8.23 MB, draw calls 44–90, 6.8–12.1 ms frame cost (`bench_island-optimised.json`). Streaming had 0 misses and full unload and reload (`island_streaming_test.json`).
- **Build:** Blender headless exporter → Pillow WebP → gltf-transform (**Draco**) → checks.
- **Output:** 28 tiles + `shared.glb`, 13.6 MB in total.
- **Viewer:** three **0.170**, its own player and collision code (OBB and circle colliders, 16-bit heightmaps), its own sky, sun and water.

## Compatibility findings
| Topic | Finding | Decision |
|---|---|---|
| three.js version | Viewer 0.170, game 0.186. The viewer's API use (LOD, InstancedMesh, `onBeforeCompile`, GLTFLoader) is the same in 0.186. | Port the streaming code to TypeScript against the game's three 0.186. Add no second copy of three. |
| Geometry compression | Viewer uses Draco (needs a decoder and wasm). Game uses meshopt (decoder already bundled). | **Switch the pipeline to meshopt** (`meshoptimizer`, already a devDependency). No Draco in the game. |
| gltf-transform | Viewer 4.1.1 (its own install). Game has 4.5.1 + meshoptimizer. | Use the repo's packages. Add no new npm dependencies. |
| Materials | `WorldRenderer.setIsland()` overwrites all materials with a Lambert vertex-colour material, which would erase the textures. | The streamed island **bypasses `setIsland`** and keeps its own textured MeshStandardMaterials. Islands A and B are unchanged. |
| Coordinate frame | The realistic island and the game's island A GLB share the frame: centred the same way, sea at y = 0, the same heights (island A max 121 including towers, terrain max 116). Blender (x, y) → three (x, −y), the same `fromBlender()` convention as the game. | Reuse **island A's original destination positions** (from git, `fc54e59`). They were authored on the same layout. Every position is checked for walkable ground by a unit test. |
| Scale | The realistic island is island-A sized (`scale 1` for map and quest framing) but life-size (1 unit = 1 m, like island B), so characters use `characterScale 1`. The camera near plane is 1 m at `scale 1`, which clips in first person. | `scale 1`, `characterScale 1`; near plane 0.05 for streamed islands. |
| Player controller | The viewer's controller differs from the game's (capsule, jump, OBB colliders). The brief forbids replacing the game's controller. | **Keep the game's controller.** The pipeline generates a `NavData` walk grid in the game's own format (`nav-island-realistic.json`) from the same ground, deck and collider data. |
| Collision | The game is grid-based: blocked cells. Viewer colliders (53 buildings, 8 ships, 215 trees, 41 rocks) are rasterised into blocked cells. Boardwalk stairs in the source are 1 m blocks, against the game's default `step_max` of 0.55 m. | Blocked cells come from the colliders. `step_max` 1.05 **in the data file only** (it is already per-island data). No code change to movement rules. |
| Terrain height (markers, quest camera, NPC spots) | `surfaceHeight()` raycasts island meshes, and tiles stream in and out. | Ray-test proxies: the tile's 2 m terrain LOD + building LOD1, registered as tiles load. Markers and the focus cache are re-placed when tiles arrive. |
| Follow-camera obstruction | Raycasts `islandMeshes()` (a closure, so it picks up streamed proxies). | Works unchanged. |
| NPCs and objects | `explore.json` positions are island-B Blender coordinates. Dialogue text and ids stay. | Per-island **placement overrides** (positions only) in the island config. No behaviour change. |
| Quest triggers and HUD | Driven by destinations, `pickTarget` and progression rules. | Unchanged. Destinations get island-specific positions via the same overlay. |
| Saved player position | Session storage key `curiotrail.explore.player` is shared by every island. A B position would put the player in the sea on another island. | Namespace the key by walk grid (island B keeps the old key, so existing sessions are unchanged). |
| Switching islands | `world.json → island` selects the island. Island B is the approved default. | **Opt-in only:** `?island=realistic` loads `data/islands/realistic.json`, an overlay with the island config and positions. The default stays island B, so the existing world and every e2e check keep running on it. |
| Water, sky, lighting | The game's own (water at −0.4, procedural sky, hemisphere + sun + room environment). | Use the game's environment, not the viewer's, which means no art-direction change. The streamed island's textured materials respond to the game's lights. |
| Licensing | Tiles derive from the CC-BY island (already credited) and CC0 Poly Haven textures. | Add Poly Haven CC0 and the derivation note to `public/models/CREDITS.txt` and `docs/ASSETS.md`. |
| Asset size | 13.6 MB of new assets. Island B is 7.2 MB, characters 7.2 MB. | Commit under `public/models/island-realistic/`. The size is documented. Vite copies `public/` as is. |

## Out of scope (per brief)
- no new quests, NPC behaviour or gameplay features;
- no change to the default island;
- no merge to `main`;
- no S1 art direction;
- the master `.blend` stays untouched.
