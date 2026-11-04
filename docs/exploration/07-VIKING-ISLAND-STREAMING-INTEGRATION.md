# Viking island streaming pipeline: integration (ready for review, not merged)

4 November 2026 · branch `feature/viking-island-streaming` (from `feature/continuous-exploration` @ `d4a9477`) · nothing pushed or merged.
The compatibility report written before integration is in [06-VIKING-ISLAND-STREAMING-COMPAT.md](06-VIKING-ISLAND-STREAMING-COMPAT.md).

> **Update (4 Nov 2026):** the realistic island is now the default, with island B as `?island=b` and as the light-graphics fallback. See [08-REALISTIC-ISLAND-DEFAULT.md](08-REALISTIC-ISLAND-DEFAULT.md).

## 1. What this adds
The chunked realistic Viking island (28 streamed 96 m tiles) runs inside the real game as an **opt-in island variant**. Add `?island=realistic` to the page URL, for example `http://localhost:5173/?island=realistic#/explore`.

**Without the parameter nothing changes.** The game still runs on island B, and every existing check below was run on it.

On the realistic island the game uses its own systems unchanged:
- player controller, follow and first-person camera, movement and collision rules (`explore.ts`, `explore-runtime.ts`);
- NPCs and dialogue;
- interaction targeting and quest triggers;
- progression, HUD, map, quests and learning activities.

The standalone viewer's controller and colliders were **not** ported. The island supplies a walk grid in the game's own `NavData` format instead.

## 2. Integration architecture
```
?island=realistic ──► App.loadContent(): applyIslandOverlay(world.json, data/islands/realistic.json)
                         (island config + destination positions/landmarks; quests, unlocks, ids untouched)
WorldStage ──► WorldRenderer({ streamed: 'island-realistic/manifest.json', scale 1, characterScale 1 })
                 └─ loadStreamed() ──► streamed-island.ts
                      manifest.json ─ shared.glb (9 PBR materials, tree/ship/rock templates) ─ instances.json
                      28 × chunk_i_j.glb: terrain LOD 1/2/4 m + skirts, buildings LOD0/LOD1, own baked terrain texture
                      load ≤ 300 m / unload > 420 m from the focus (explorer, or orbit target on the map)
                      ray-test proxies (terrain 2 m LOD + building LOD1) → markers, quest framing, follow-camera obstruction
loadExplore(nav, placements) ──► nav-island-realistic.json (NavData: heights incl. boardwalks, blocked cells) → NavGrid
                                 explore.json NPC/object positions overridden per island (ids and dialogue unchanged)
```

## 3. Files
**Added**
| File | Purpose |
|---|---|
| `src/world/streamed-island.ts` | Tile streaming, the shared material library, instanced trees (impostors beyond 75 m, vertex-shader wind), ships and rocks, ray-test proxies, disposal |
| `src/app/island-variant.ts` | `?island=` parsing and the pure overlay function |
| `public/data/islands/realistic.json` | The variant: island config, destination positions (island A's originals, snapped to walkable ground), landmark texts, NPC and object positions, spawn |
| `public/data/nav-island-realistic.json` | Walk grid, 580 × 580 cells of 1 m (generated) |
| `public/models/island-realistic/` | `manifest.json`, `shared.glb`, 28 × `chunk_*.glb`, `instances.json`, 2 impostor WebPs (generated) |
| `tools/island-pipeline/` | `build.mjs` (one command), `export_island.py` (Blender), `to_webp.py`, `make_nav.py`, `optimise.mjs`, `check.mjs`, `README.md` |
| `tests/island-realistic.test.ts` | 10 unit tests: overlay, placements, walk grid, assets |
| `e2e/island-realistic-check.cjs` | 9 browser checks for this integration (R1–R9) |
| `docs/exploration/06-…`, `07-…`, `stage4/` | Compatibility report, this report, results and screenshots |
| `docs/test-results/island-realistic-{checks,pipeline}.json` | Latest pipeline check and run log |

**Modified** (9 files, +139/−13 lines)
| File | Change |
|---|---|
| `src/world/WorldRenderer.ts` | The `streamed` option. `loadStreamed()` bypasses `setIsland`, so textures are kept. Marker heights are refreshed (without re-framing the camera) as tiles arrive. The stream focus is updated per frame. `stats().streamed`. Disposal. Near plane 0.05 for the streamed island. |
| `src/engine/types.ts` | `IslandConfig.streamed`, `IslandConfig.placements`, `IslandOverlay` |
| `src/app/App.tsx` | Loads the overlay when `?island=` is present |
| `src/app/explore-content.ts` | `placeContent()`; `loadExplore(nav, placements)` |
| `src/ui/WorldStage.tsx` | Passes `streamed` and `placements` through |
| `src/ui/screens/ExploreScreen.tsx` | The saved return spot is keyed per walk grid. Island B keeps the old key, so existing sessions are unchanged. |
| `package.json` | Script `build-island-realistic` (no new dependencies) |
| `docs/ASSETS.md`, `public/models/CREDITS.txt` | Credits: CC-BY adaptation note and Poly Haven CC0 textures |

**Not changed:** quest engine, quest content, progression, save schema, `world.json`, `explore.json`, movement rules, the island A and B files and the default island.

## 4. Build
```sh
npm run build-island-realistic -- --source "C:\Users\thaka\Downloads\Viking_realistic island"
# set PYTHON to a Python 3 with numpy + Pillow (dev machine: C:\Users\thaka\anaconda3\python.exe)
```
Full run, measured: Blender 151.8 s, WebP 29.4 s, walk grid 2.5 s, optimise 3.2 s, checks 0.3 s. Result: 0 errors, 0 warnings, 28 tiles, master `.blend` unchanged (`2026-11-04T12:55:58Z`). Details are in [tools/island-pipeline/README.md](../../tools/island-pipeline/README.md).

**Dependencies:**
- npm: none new. It uses the repo's three 0.186, gltf-transform 4.5 and meshoptimizer.
- Off-repo build tools: Blender 5.2, and Python 3 with numpy and Pillow.
- Browser checks: `e2e/*.cjs` need Playwright (not a repo dependency, as before). This run used an existing Playwright 1.64.1 install through `NODE_PATH`.

## 5. Asset sizes
| | Size |
|---|---|
| `public/models/island-realistic/` (28 tiles 16.45 MB, shared.glb 3.04 MB, instances 9 KB, impostors 56 KB) | **19.57 MB** |
| `public/data/nav-island-realistic.json` | 2.07 MB (0.22 MB gzipped) |
| `public/data/islands/realistic.json` | 2 KB |
| Largest tile | 1.26 MB (village `chunk_3_2`). Budget is 1.5 MB. |

The meshopt files are larger than the standalone Draco build (13.59 MB). UVs must stay float so tiles can share the library's materials, and meshopt compresses floats less than Draco does. Meshopt was kept because the game already bundles its decoder, and a second (Draco/wasm) decoder would be a duplicate library.

## 6. Validation
### 6.1 Realistic island in the real game: `node e2e/island-realistic-check.cjs --gpu`, **9 / 9 passed** (`stage4/results-gpu.json`)
| # | Check (brief) | Result |
|---|---|---|
| R1 | Build from the documented command and load. The Pathfinder spawns on walkable ground (4) | Pass. First view: 16 tiles, **8.10 MB**, ready in **3.8 s** (localhost) |
| R2 | All 28 tiles and the shared assets load (2) | Pass, no failed requests |
| R3 | Movement across tile boundaries (4) | Pass. Ran from x −11.5 to +15.3 across the x = 0 tile edge; height followed the walk grid at every sample |
| R4 | Unloading and reloading distant tiles (5) | Pass. NE corner → SW corner: 5 tiles unloaded, back: reloaded (38 loads, 10 unloads in total) |
| R5 | Terrain height and collision (6) | Pass. Stopped at the great hall's wall (x 98.7, wall at about 99.5). Walking into the sea stops on the beach |
| R6 | Building UVs, sail stripes, trees, material colours (7) | Pass (programmatic: every library material textured and with UVs, sail textured, ship tints present, needles alpha-tested, every tile terrain textured). Visual review: `stage4/sheet-realistic.jpg` |
| R7 | Existing NPC, dialogue, interaction and quest systems (9) | Pass. "Talk to Mira" → E → dialogue; E at Signal Woods → `#/quest/missing-signal`; "Return to the island" → back on the same spot |
| R8 | Performance (10) | See 6.3 |
| R9 | Missing assets and console errors (8) | Pass: 0 console errors, 0 failed requests |

### 6.2 Existing CURIOtrail functionality (default island B, 9)
| Suite | Result |
|---|---|
| Typecheck | Clean |
| Unit tests | **136 / 136** (126 existing + 10 new) |
| Production build | Passes |
| Stage 3 exploration suite (`explore-check.cjs --gpu`, Arc 130V) | **16 / 16** |
| Full browser suite (`run-e2e.cjs`, 35 checks, SwiftShader) | **35 / 35**, including A1b "no console errors" |

Both suites ran from copies whose output went to `stage4/regression-*`, so the committed Stage 3 and `docs/test-results` evidence was not overwritten.

### 6.3 Performance on the available machine (measured: Intel Arc 130V, Chromium/ANGLE D3D11, 1280×800)
| | Integrated (game) | Standalone viewer (earlier, for reference only) |
|---|---|---|
| First view | 8.10 MB, 3.8 s, 16 tiles | 8.23 MB, 4.0–4.5 s, 10 tiles |
| Explore, village (everything loaded) | 60 fps (vsync), p95 16.7 ms, **157 draw calls, 540 k triangles** | 60 fps, 44 draw calls, 270 k triangles (no characters, NPCs, markers, clouds or game HUD) |
| Map overview | 60 fps, p95 16.8 ms, 163 draw calls, 227 k triangles | 90 draw calls, 120 k triangles |
| All tiles downloaded | 19.6 MB island + 2.07 MB walk grid | 13.6 MB + 1.3 MB |

**How the numbers differ:**
- The standalone figures were measured in a different viewer, with different lighting, no game scene content, a 1280×720 canvas and Draco files. They are not a like-for-like baseline.
- The integrated draw calls and triangles include the game's own scene: the rigged Pathfinder, Mira and Tove, the markers, clouds, sparkles and the higher-detail water.
- **Island B on the same machine** (Stage 3 report) draws 65–73 calls at 60 fps. The realistic island costs about twice as many draw calls and still holds 60 fps on this GPU.

**Not measured:** a low-end laptop, a phone, or software rendering of the realistic island. **No low-end compatibility is claimed.** Under SwiftShader, island B already runs at 3–5 fps (Stage 3 report). The realistic island draws more, so slow devices need the reduced settings listed below before it could become a default.

## 7. Known limitations
1. **Opt-in only.** The default stays island B. Making the realistic island the default is a separate product decision.
2. **Quest markers are sized for island A.** Marker scale follows `scale` (1). In first person, standing at a destination, the 38 m beam fills the view (`stage4/r6-first-person-forest.jpg`). A separate marker scale would fix it, but that is a marker-system change, so it is left for review.
3. **Streaming radius against island size.** The island is only 577 m wide against a 300 m load / 420 m unload radius, so after a little walking most tiles stay resident. Unloading happens only between opposite corners. GPU memory with every tile loaded is about 200 MB of textures (standalone estimate). KTX2 compression or lower-resolution far-tile textures would cut it.
4. **Destination and NPC positions moved.**
   - Island A's positions were snapped to walkable ground. The Trading Market marker moved 3.5 m, the others 0.7 m.
   - The planned Web Frontier moved 32.7 m to the nearest walkable pier (the original spot is over water).
   - Tove moved 8.5 m and the ledger desk 9.9 m out of the rebuilt market building.
5. **Walk-grid simplifications** (as on island B):
   - single layer, so you can't walk under stilt houses or boardwalks;
   - posts and railings are not colliders, so a player can step off a high boardwalk edge (the game always allows stepping down);
   - `step_max` is 1.05 m on this island (data only), because the source stairs are 1 m blocks.
6. **Asset size:** the files are 44 % larger than the standalone Draco build (see section 5).
7. **Visual gaps carried over from the standalone build:**
   - no shallow-water tint or foam (the game's water is used);
   - the terrain is soft at eye level;
   - impostors pop in at 75 m;
   - 41 rock instances (one per feature).
8. **Art direction:** the realistic look still conflicts with the unapproved Figma S1 direction. This integration does not adopt S1.
9. **Untracked files:** `assets_dl/`, `cp/`, `exploration/`, `figma-ref/`, `venture/`, `serve.mjs` and `cp-e2e-baseline.json` appeared in the working tree during the session (copied in when the session moved folders). They are not part of this branch and were not committed or deleted.

## 8. Rollback
- **Turn it off:** remove `?island=realistic` from the URL. Without it the variant is never loaded.
- **Remove it completely:** `git switch feature/continuous-exploration`. The branch has not been merged or pushed.
- **To revert after a merge:** `git revert <merge commit>`. Or delete `public/models/island-realistic/`, `public/data/nav-island-realistic.json` and `public/data/islands/`; with those gone, `?island=realistic` fails with "Could not load data/islands/realistic.json" while the default island keeps working.
- **What a revert reverses:** the code changes are additive (`streamed` and `placements` are optional), so reverting them restores the exact previous behaviour.
- **Outside the repo:** the master `.blend`, the source data and the standalone validation project in `Downloads/Viking_realistic island/` are untouched.
