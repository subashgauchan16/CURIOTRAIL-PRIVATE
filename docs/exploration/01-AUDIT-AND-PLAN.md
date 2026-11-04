# Continuous 3D exploration: Phase 0 audit and implementation plan

Repository: `subashgauchan16/CURIOTRAIL-PRIVATE` · `main` at `f0db667` (28 Oct 2026) · audited 3 Nov 2026 in a local clone. No changes have been made to the repository.
Design reference: Figma `CURIOTRAIL-Prototyp`, page 1 (75 top-level frames).

## 1. Baseline (run before any change)

| Check | Result |
|---|---|
| `npm ci` | OK |
| `npm run typecheck` | Clean |
| `npm test` (Vitest) | **105 / 105** passed in 7 files |
| `npx vite build` | OK. JS: react 45.6 kB, app chunk, three 148 kB (gzipped) |
| `npm run e2e` (Playwright 1.64.1 Chromium, installed with `--no-save` because Playwright isn't a repo dependency) | **34 / 35**. **A13b fails before any change**: "Keyboard: skip link and answering a question without a mouse", where `page.waitForURL` times out after 30 s. To be investigated separately; not caused by this work |
| Rendering in e2e | SwiftShader software WebGL: the island renders but at 0–3 fps. **No real GPU measurement exists.** Movement tests must therefore use time-based checks, not frame counts |

The e2e run rewrites `docs/screenshots/` and `docs/test-results/`. I restored them in the clone, so it is clean.

## 2. What exists

| Area | Found | Files |
|---|---|---|
| Island assets | `island-low.glb` (615 kB, **242k triangles**, one sloppy-simplified mesh) and `island-high.glb` (4.4 MB, **1.09M triangles**, 16 chunks). Meshopt-compressed, flat vertex colours, **1 unit = 1 block**, about 577 × 557 units | `public/models/`, `docs/ASSETS.md` |
| Loading and LOD | Low first, then high when quality is "high". Load progress, error and retry; 2D fallback map when WebGL is off, unavailable or fails | `WorldRenderer.loadIsland`, `WorldStage.tsx` |
| Ground queries | `surfaceHeight(x, z)`: one downward raycast against the island meshes (no acceleration structure) | `WorldRenderer.ts` |
| Destinations | 5 in `world.json` with 2D positions `[x, z]`; markers (ring, gem, beam, hit sphere) placed on the surface; HTML labels projected each frame | `world.json`, `WorldRenderer` |
| Camera modes | `overview` (auto-rotate), `map` (OrbitControls, keyboard orbit and zoom, click to select), `focus` (framing a character beside a destination, with line-of-sight search), `celebrate` | `WorldRenderer.setMode` |
| Characters | Procedural low-poly figures from primitives, with 5 poses (`idle`, `talk`, `point`, `wave`, `celebrate`) and looks for mira, sigrun, tove and astrid (tobin falls back to mira). **Only one character exists at a time**; it's created when a quest scene needs it and disposed afterwards. **No Pathfinder model, no walk animation** | `characters.ts` |
| Quest entry | Map screen → destination panel → `#/quest/:id`. Quest screen → `#/complete/:id`. There is **no explicit "leave quest" control**; the top bar's links are the way out | `MapScreen.tsx`, `QuestScreen.tsx`, `TopBar.tsx` |
| Persistent world | `WorldStage` is mounted once in `App.tsx` and survives route changes. Quests already happen **in the same canvas**; only the camera mode changes | `App.tsx` |
| Game rules | Pure engine (progression, evaluation, XP, stars, hints); progress store schema v3 with migrations | `src/engine/` |
| Keyboard | Map screen: Q/E rotate, +/- zoom, R reset. Schema lab has its own keys. No global input system | `MapScreen.tsx` |
| Accessibility | Every 3D action has an HTML alternative (destination list, label buttons), reduced-motion and graphics settings, live announcements | `a11y.ts`, screens |
| Tests | Unit: engine, store, validation, interpreters, learning, brand. e2e: 35 checks including fallback, failed island load, mobile and save migration | `tests/`, `e2e/run-e2e.cjs` |

## 3. What's missing for the brief

| Required | State |
|---|---|
| Controllable Pathfinder; WASD/arrows; frame-rate-independent movement | **Missing**: no player entity or input loop |
| Ground following; blocking world geometry; staying on the island | **Missing**. Raycasting a 0.24M–1.1M-triangle mesh with no acceleration is too slow per frame. A pre-built height grid is needed |
| Third-person follow camera, first-person toggle (V), mouse look, camera obstruction | **Missing**. The line-of-sight idea exists only in `focusView` |
| Idle and walk animation | **Missing** walk (poses only) |
| Persistent NPCs (Mira, Tove) at stable positions | **Missing**: only one character, and only during quests |
| Proximity, prompts (E), dialogue, inspectable objects, "too far" and "unavailable" feedback | **Missing** |
| Quest interaction points tied to destination and quest ids | Partly: destination data and markers exist; there is no proximity entry |
| Map (M) as an optional overlay; Escape closes overlays | Map exists as a **route**, not an overlay |
| Exploration HUD, objective, controls guide, camera toggle (Figma) | **Missing** in code. Figma frames are explicitly labelled *"Visual interaction states • not runtime gameplay"* |
| Mobile controls (joystick, action buttons) | **Missing** |
| Return to the same spot after a quest | **Missing**: no stored player position |

## 4. Design facts from Figma (frames 19, 20 and the components sheet)

- **HUD:**
  - Top left: wordmark, location, objective (gold "THE APPLE HARVEST" label, serif title, one-line instruction).
  - Top centre: compass strip.
  - Top right: "Zeus Band" and "Map" buttons.
  - Bottom: an "E · Talk to Mira" contextual prompt; keycap hints (V Camera, M Map, Z Zeus Band); "Show controls".
- **Components:** contextual prompt (object name, "Within reach", Pick up and Inspect); dialogue panel (speaker, line, Continue, Leave conversation); dialogue choices; inspection panel (title, text, "Return to exploration"); first/third-person toggle; map markers ("You are here"); a tutorial overlay of key bindings; a virtual joystick.
- **Palette:** deep teal and navy surfaces, cream text, pale green primary buttons, gold labels. This matches the repo tokens.
- **The Figma controls list includes Space (jump), C (crouch), F (inspect) and Z (Zeus Band).** The brief requires only WASD/arrows, mouse, E, V, M and Escape. I propose leaving jump, crouch and the Zeus Band **out of this slice**, with F as an alias for inspect.
- The painted backgrounds are concept art. The real world stays the voxel island (per the brief).

## 5. Technical approach

### 5.1 Walkability and collision (no new dependency)

When an island LOD finishes loading, **rasterise the island's triangles into a height grid**: 1-block cells over about 577 × 557, keeping the highest surface per cell. It is built in time slices so the page stays responsive, and rebuilt when the high LOD arrives.

- A cell is **walkable** if:
  - it has ground above sea level
  - its step to its neighbours is at most about 1 block (auto-step, like stairs)
  - it isn't a narrow spike (tree trunk, wall top)
- **Movement:**
  - desired velocity from the input, relative to the camera
  - separate X and Z resolution against the grid, so the player slides along walls
  - feet height eased towards the grid height
  - delta time clamped at 0.1 s, so movement is frame-rate independent
- **Island boundary:** non-walkable cells (water, cliffs) form the edge automatically.
- **Camera obstruction:** march along the camera's line using the height grid and pull the camera in when it would go into terrain or a roof.
- **Risk:** the sloppy low-LOD mesh may leave lumpy ground or holes. Mitigations: build from the high LOD where loaded, smooth the grid, and fall back to "last valid position". This is verified in step 2 below **before** any UI work.

Why not `three-mesh-bvh` or a physics engine? Neither is needed for walk-and-step on a voxel world. The brief asks to avoid large dependencies, and a grid is cheaper to test.

### 5.2 Architecture

```
Input (keyboard / pointer)  ─►  explore/controller (pure TS: movement, camera rig, interaction selection)
                                          │ uses
            world/heightfield (pure TS: build grid from triangles, height(), walkable(), sweep)
                                          │
WorldRenderer: new CameraMode { kind: 'explore' } → owns player avatar, NPC set, props, follow camera
                                          │ reports (onNearby, onPlayerMoved)
React: ExploreScreen (HUD, prompt, dialogue, inspection, controls guide, map overlay) ─► existing router
                                          │ launches
Existing QuestScreen (unchanged rules) ─► complete ─► "Return to the island" → #/explore (same position)
```

- **Rules stay in the engine.** World code only reports "near the Trading Market". The React layer checks unlock state with the existing `progression.ts` and calls the existing `navigate('/quest/...')`.
- **New content data** (`public/data/explore.json`): spawn point, NPC positions and short ambient dialogue lines, and inspectable objects (for example an apple basket built from primitives), each linked to existing destination ids. It is validated by a unit test, like the quest validation.
- **Player position** is kept in memory and in `sessionStorage`, not in the save file. So **no save-schema migration** is needed.
- The map stays available as the `#/map` route and as an **M overlay** in explore mode, so map navigation remains an option.

## 6. Implementation sequence (smallest coherent slice first)

| Step | Work | Proof before moving on |
|---|---|---|
| 1 | Branch `feature/continuous-exploration`. Add `src/world/heightfield.ts` (pure) and unit tests on synthetic geometry: flat floor, step, wall, hole, water | Unit tests pass |
| 2 | **Spike:** build the grid from the real low and high islands in the browser; record build time, walkable area and the heights at the 5 destinations; save a debug image of the walkable mask | Mask image looks right; build stays under a measured budget. **If not, stop and report** |
| 3 | `src/world/explore.ts` (pure controller): input → velocity → swept move; camera rig (third and first person); yaw and pitch; obstruction pull-in. Unit tests for frame-rate independence (same distance at 30 and 120 Hz), wall sliding and staying in bounds | Unit tests pass |
| 4 | `WorldRenderer`: `explore` mode, Pathfinder avatar (new procedural look, idle and walk animation), facing the direction of travel, avatar scale to block scale, follow camera, pointer lock on click (Escape releases), `__curioWorld` test hooks (player position, teleport) | Manual check plus an e2e smoke test (spawn, move) |
| 5 | Persistent NPCs (Mira, Tove) and props from `explore.json`; proximity and nearest-target selection; `onNearby` events | Unit tests on selection; e2e: prompt appears near Mira |
| 6 | React `ExploreScreen` + route `#/explore`: HUD (location, objective, compass), contextual prompt (E/F), dialogue panel (Continue, Leave; Escape), inspection panel, "too far" and "locked" feedback, controls guide, camera toggle (V and a button), M map overlay; Figma styling with existing tokens. Entry from Home ("Explore the island") and after identity | e2e: dialogue and inspect flows |
| 7 | Quest bridge: E at a destination → existing unlock check → `#/quest/:id`; "Return to the island" on the quest and completion screens → `#/explore` at the saved position | e2e: the full vertical-slice route |
| 8 | Hardening: resize; island-load failure and no WebGL (explore shows the 2D fallback and destination list); `dispose()` on route change; keyboard-only path (Tab to the prompt button and "Travel to…" list); reduced motion | Full suite green, except the pre-existing A13b (report it separately) |
| 9 | **Mobile (next increment, after desktop works):** virtual joystick, drag to look, Interact button. Until then, touch devices get explore with tap-to-act prompts plus the map and travel list | — |

## 7. Acceptance-test plan (brief Phase 4)

| # | Criterion | How it will be proven |
|---|---|---|
| 1 | Load island, spawn as Pathfinder | e2e: `#/explore` → stats show `mode: explore`, player at the spawn point, avatar present |
| 2 | Keyboard movement | e2e: hold W for 1.5 s → position changes in the camera-forward direction; it stops on release |
| 3 | Approach Mira, start dialogue | e2e: teleport near Mira → prompt "Talk to Mira" → E → dialogue panel with her line |
| 4 | Leave dialogue, keep exploring | e2e: Escape or "Leave conversation" → panel closed, movement works again |
| 5 | Inspect the apple basket | e2e: near basket → F/E → inspection panel → "Return to exploration" |
| 6 | Navigate to the Trading Market in the same world | e2e: walk or teleport; assert the canvas was never recreated (renderer instance id unchanged) |
| 7 | Launch the Market Ledger quest | e2e: E at the market marker → `#/quest/market-ledger`. Note: it is locked until The Missing Signal is complete, so the test seeds that completion through a real playthrough or a valid save. A separate e2e checks the **locked** message on a fresh save |
| 8 | Complete or exit, return to the same island | e2e: complete the quest → "Return to the island" → `#/explore`, position within 1 block of before |
| 9 | Progress intact | e2e: XP, stars and completion in the save match before and after |
| 10 | Resize, loading failure, WebGL fallback, cleanup, keyboard | e2e: viewport change; GLB request blocked; WebGL disabled; route away → renderer disposed (no listeners left); a keyboard-only run |
| — | Camera, collision and feel | **Manual steps** (written checklist): walls, cliffs, water edge, obstruction, V toggle, pointer lock, frame rate on a real GPU |

## 8. Decisions needed before implementation

1. **Branch and push:** create `feature/continuous-exploration` in `CURIOTRAIL-PRIVATE` and push it there. No PR into public `CURIO`, no deployment. *(Recommended: yes.)*
2. **Which Market Ledger:** the private `main` is **behind the public `CURIO` repo**. It doesn't have the game-first Market Ledger (Ledger Workshop, Rune-word and so on; 48 kB of content vs 13 kB), the usability kit or the onboarding commits. *(Recommended: build on private `main` as the brief says, and port those commits in a separate step.)*
3. **Out of scope for this slice:** jump, crouch, the Zeus Band, entering building interiors, and the mobile joystick (step 9 comes after desktop). *(Recommended: agree.)*
4. **Avatar scale in explore mode:** about 1.8 blocks tall so it fits the voxel world. Quest framing keeps its current larger scale. *(Recommended: agree.)*
5. **Conflict with the validation plan:** Phase 4 of the venture plan (decision approved 3 Nov) said to freeze immersive work until Gate 3. This brief overrides that for one bounded slice. It doesn't change X1–X3, which use the existing quest screens, but founder time spent reviewing it comes out of the validation hours. *(Your call; recorded either way.)*

## 9. Skills mentioned in the request and not used

- **spaitial-ai (create-world, edit-world, export-mesh):** these generate a new AI world, which conflicts with "use the existing island, don't rebuild it". The service also needs authorisation (`/mcp`) in this session.
- **unity:physics-3d-collision:** Unity-specific; the brief says to keep Three.js and add no other engine. The collision approach is in 5.1.
