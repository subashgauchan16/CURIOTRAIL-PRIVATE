# Stage 3: one continuous explorable island (vertical slice)

4 November 2026 · branch `feature/continuous-exploration`

Approved by the founder on 3 Nov 2026: commit the models and start Stage 3.

## 1. What changed

| Area | Change | Files |
|---|---|---|
| Island | The game now runs on **island B** (the Blender-refined island, 1 unit = 1 m). The original island GLBs stay in `public/models/` untouched, and switching back is one setting (`world.json → island`) | `public/models/island-b/VikingIsland_Scene.glb` (7.2 MB), `public/data/world.json` |
| Destinations | Re-mapped to island B landmarks: Signal Woods → forest below the lookout; Workshop → workshop; Trading Market → between the stalls; Great Hall → longhouse; Web Frontier (planned) → dock. Unit tests check that every destination is on walkable ground | `world.json` |
| Island draw cost | Island B is exported as ~215 separate meshes. At load they are merged into an 8 × 8 grid of chunks (one shared material): **draw calls fell from 263–363 to 65–73**, and both map and exploration hold **60 fps** on the Intel Arc 130V. The original small meshes are kept off-scene for ray tests (ground height, camera obstruction), because their tight bounds keep the per-frame camera check cheap. Islands of 64 meshes or fewer, such as the original, are drawn as before | `WorldRenderer.ts` (`mergeIntoChunks`) |
| Renderer scale | One `scale` setting (0.25) rescales everything authored for island A: camera distances, map and overview framing, marker size, labels, celebration effects, fog, near plane. The map, overview, quest and celebration modes are otherwise unchanged | `src/world/WorldRenderer.ts` |
| Characters | `Pathfinder.glb`, `Mira.glb`, `Tove.glb` committed (2.0 + 3.3 + 1.9 MB) | `public/models/characters/` |
| Walk grid and movement | Pure, unit-tested movement on the island's own walk grid (`nav-island-b.json`, 1 m cells). Camera-relative WASD/arrows, Shift to run. Frame-rate independent. Steps of up to 0.55 m. Slides along walls; never enters buildings, water or the edge of the map | `src/world/explore.ts`, `tests/explore.test.ts` |
| Player, NPCs, camera | Pathfinder as a persistent player entity with idle/walk/run blending. Mira and Tove **persist at their homes in every mode** and turn to face a nearby player. Third-person follow camera that pulls in when walls or roofs block it, and never dips below the ground. First-person view (V). Mouse-drag or `[` `]` to turn the camera | `src/world/explore-runtime.ts` |
| Interactions | Proximity targeting (people before props, things behind you ignored). Prompts. Dialogue (Continue / Leave / Esc). Object inspection. "Move closer" and "locked / planned / all done" feedback | `explore.ts`, `ExploreScreen.tsx`, `public/data/explore.json` |
| HUD | Figma-styled HUD: location, objective (next available quest), V/M/H buttons with keycaps, prompt, dialogue, inspection, controls guide (shown on first visit), and an M map overlay with **Travel here**, the keyboard and accessible way to cross the island | `src/ui/screens/ExploreScreen.tsx`, `src/styles/explore.css` |
| Quest bridge | E at a destination uses the **existing** progression rules (`destinationStatus`, `nextQuestAt`, `unlockRequirement`) and the existing route `#/quest/:id`. The quest engine is unchanged. Quest scenes with Mira or Tove now use the **rigged NPC**, walked to the quest spot and returned home afterwards; other quest characters keep the old procedural figure. "Return to the island" on the quest and completion screens restores the player's spot (session storage only; the save file is untouched) | `WorldRenderer.ts`, `QuestScreen.tsx`, `CompleteScreen.tsx` |
| Navigation | New `#/explore` route (needs an identity; falls back to the map on islands without a walk grid). "Explore" in the top bar; "Explore the island" on the home screen | `router.ts`, `App.tsx`, `TopBar.tsx`, `HomeScreen.tsx` |

**What I didn't do:**
- No new engine or physics library.
- No changes to the quest engine, quest content, progression or save schema.
- No island expansion and no new worlds.
- Nothing merged or deployed.

## 2. Acceptance evidence (brief, Phase 4)

`node e2e/explore-check.cjs --gpu` (dev server on port 5199; Intel Arc 130V): **16 / 16 passed**. Results are in `stage3/results-gpu.json`, screenshots in `stage3/` (`sheet-a.png`, `sheet-b.png`).

| # | Criterion | Check | Result |
|---|---|---|---|
| 1 | Load the island, spawn as the Pathfinder | X1: explore mode, third person, spawn at the dock | Pass |
| 2 | Move with the keyboard | X2: W walks about 2 m north in 1.5 s; Shift + ↑ runs. X2b: stopped by the storehouse wall; stays on land at the dock's end | Pass |
| 3 | Approach Mira, start dialogue | X3: "Talk to Mira" prompt, E opens the conversation, Continue advances | Pass |
| 4 | Leave dialogue, keep exploring | X4: movement ignored while talking; Esc closes; walking resumes | Pass |
| 5 | Inspect an apple basket | X5: "Inspect Basket of apples", E opens the panel, "Return to exploration". X5b: "Move closer to …" when too far | Pass |
| 6 | Navigate to the Trading Market in the same world | X6: M map → Travel here; **same renderer instance throughout**; market shows "locked" on a new save | Pass |
| 7 | Launch the existing quest | X7: E at the market → `#/quest/market-ledger`; focus mode; **rigged Tove** walked to the quest spot; same world | Pass |
| 8 | Complete or exit, return to the same island | X8: "Return to the island" → within 1.5 m of where the player left; Tove back home; same world | Pass (exit path; completing the full quest was not automated) |
| 9 | Progress and completion intact | X9: completion, XP and achievements unchanged; nothing about exploration written to the save file | Pass |
| 10 | Resize, load failure, WebGL fallback, cleanup, keyboard | X10a resize; X10d island fails to load → clear fallback and map link; X10e graphics off → explanation, quests reachable; X10c leaving explore stops input and hides the player, no console errors; X10b keyboard only: Tab to the prompt, Enter, Esc, V | Pass |

### Manual checks still to do (camera and feel)

These can't be judged by a script:
1. **Walking feel:** walk the whole loop dock → village → Mira's house → orchard → market → storehouse → forest path.
2. **Steps:** the 1 m walk-grid steps are smoothed. Watch for bobbing on stairs and slopes.
3. **Camera:** turning near walls and under eaves; dragging the camera while walking; first person under roofs.
4. **Frame rate on your own machine and on phones.** On the Intel Arc 130V: 60 fps on the map and while walking. Under software rendering (the regression suite's environment) the island runs at 3–5 fps, so slow or old devices need the planned LOD split.
5. **Screen reader:** the HUD prompt and panels announce changes (live region); not yet tried with NVDA.

## 3. Regression checks

| Suite | Result |
|---|---|
| Typecheck | Clean |
| Unit tests | **126 / 126** (109 earlier + 17 new exploration tests) |
| Production build | Passes |
| Existing browser suite (35 checks) | See §6. Two checks assumed island A and were updated, without weakening what they assert. **A15b** blocked `models/*.glb`, which doesn't match the island B subfolder; it now blocks `models/**/*.glb`. **P9-3**'s camera positions were rounded to whole units (stats now report centimetres), and it waited a fixed 600 ms for a frame; it now waits up to 5 s for the camera to change, because software rendering of island B can be slower than one frame per 600 ms late in the run. An `E2E_ONLY=` filter was added to re-run single checks |

## 4. Known limitations and next steps

- **Mobile controls not built yet.** On touch devices: tap the prompt to act, M → Travel here to move. A virtual joystick and drag-to-look are the next increment.
- Sigrun, Astrid and Tobin still use the procedural figure in their quest scenes (no rigged models yet).
- The quest-scene camera frames Mira and Tove quite small beside the quest panel. Needs tuning.
- The walk grid is 1 m. Narrow gaps under 1 m between props are treated as blocked; building interiors aren't walkable (out of scope).
- The island B GLB has no LOD split (one 7.2 MB file) and no real phone test.
- Out of scope, as agreed: jump, crouch, the Zeus Band, and Figma's pick-up action.
- The keyboard check A13b in the old suite is intermittent (see the Stage 2b report).

## 5. Asset sizes committed in this stage

| File | Size |
|---|---|
| `public/models/island-b/VikingIsland_Scene.glb` | 7.25 MB |
| `public/models/characters/Pathfinder.glb` | 2.03 MB |
| `public/models/characters/Mira.glb` | 3.25 MB |
| `public/models/characters/Tove.glb` | 1.94 MB |
| `public/data/nav-island-b.json` | 0.12 MB |

## 6. Full regression run

**Record run: 35 / 35 passed** (`stage3/e2e-regression.log`), with the A15b and P9-3 updates above.

Runs before the record:

| Run | Result | Cause |
|---|---|---|
| First run on island B | 30 / 35 | A15b and P9-3 assumed island A. L4, L5 and W1 failed only in the full run and passed on their own: knock-on effects of A15b's 60 s timeout |
| Next three full runs | 34 / 35 each | Only P9-3 failed |

P9-3 passed in every short run and in the record run, and its drag point was on the canvas when checked. So it is **timing-sensitive under software rendering** on island B, which runs at 3–5 fps without a GPU. Keep an eye on it in CI, or run the suite with GPU flags.

The keyboard check A13b passed in all Stage 3 runs.
