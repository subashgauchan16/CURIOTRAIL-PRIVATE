# Stage 2b: Mira and Tove, built and validated with the Pathfinder

3 November 2026 · branch `feature/continuous-exploration`

The founder accepted the Pathfinder prototype as the quality benchmark on 3 Nov 2026 and asked for Mira and Tove to be built the same way.

## 1. References used

| Character | Reference | Design read from it |
|---|---|---|
| Mira, "orchard keeper" | Figma frames 07, 09, 22 | Auburn hair in a single side braid; sage-green wool top; dark clothing; practical leather |
| Tove, "voyage keeper" | Figma "Tove prepares the voyage" (`3:3423`) | Blonde side braid; olive-green dress; brown leather belt and pouch |

**Needs confirmation:** the mobile frame "Merchant's Ledger" (`7:50566`) shows a **red-haired woman** at the stall, captioned "TOVE / HROLF". I used the voyage frame as Tove's reference.

## 2. Pipeline: one script for all three

`tools/characters/build_character.py -- <Pathfinder|Mira|Tove>` replaces the Pathfinder-only script. Each character is a short configuration entry: outfit set, garment colours, hair, brows, accessories, height. The Pathfinder rebuilt from it matches the accepted prototype (22,864 triangles, 1.74 m).

| | Pathfinder | Mira | Tove |
|---|---|---|---|
| Outfit (CC0) | Peasant, recoloured chambray / charcoal / brown | **Ranger**: green cloth recoloured sage across the atlas; leather, buckles and boots kept | **Peasant**: lighter cloth tinted olive; dark leather bodice kept as the belt; brown boots |
| Hair | Built curls | Close-crop cap (CC0) + **built side braid**, auburn | Close-crop cap (CC0) + **built side braid**, blonde |
| Skin texture | Base "Dark" | Base "Light" | Base "Light" |
| Accessories | Satchel, strap, Zeus Band | — | Belt pouch |
| Height | **1.74 m** (Figma scale contract) | **1.66 m** (assumption) | **1.70 m** (assumption) |
| GLB | 2.03 MB · 22,864 tris | 3.25 MB · 30,194 tris | 1.94 MB · 20,732 tris |
| Rig and clips | 65 bones · Idle, Walk, Run, Talk, Interact, PickUp | same | same |

Hair-cap choice: I rendered all four free caps on this head. "SimpleParted" sits only on the crown, which reads as shaved sides, so it was replaced by the close crop plus the built braid.

## 3. Validation in the real `WorldRenderer` on island B

Command: `node e2e/character-check.cjs --gpu`, with the dev server on port 5199. Hardware: Intel Arc 130V (D3D11). Screenshots: `stage2/08`–`11` and `cast-sheet.png`.

| Check | Result |
|---|---|
| Stable world positions | Mira at her `nav.json` cast point outside her house; Tove at the market cast point behind the ledger desk; both on the ground |
| Heights in the browser | Pathfinder 1.740 m · Mira 1.660 m · Tove 1.700 m |
| Animation | All 6 clips on both NPCs; Mira's Talk gesture plays and returns to Idle |
| Performance, all three loaded | **60 fps** on every view; 363 draw calls in the line-up view. Load times: Mira 0.95 s on the first run (the largest file), Tove 0.18 s |
| Cleanup of all three | Baseline 215 geometries / 2 textures → with all three 273 / 26 → after removal **215 / 2** |
| Console errors | None |

**Regression checks:** typecheck clean; 109 / 109 unit tests; production build passes. Full browser suite: see §5.

## 4. Known limitations, carried over from the accepted benchmark

- **All three share one face mesh** (the only female head in the free tier). They are told apart by hair, skin texture, outfit and height, but in close-ups the faces match. Distinct faces need either the paid source tier's other heads or face sculpting by an artist.
- Braids are built from ellipsoid segments: they read at play distance but are simple in close-up. Braid segments follow the head or the chest rigidly, so a small gap can open when the head turns.
- No facial rig: no blinking or expressions.
- Mira's sleeves keep the Ranger set's darker green, so she has a two-tone top.
- Proportions are the free tier's "Superhero" body.

## 5. Full browser regression suite

**34 / 35 passed** (`stage2/e2e-regression-2b.log`). The failure is **A13b** (keyboard-only quest), which now has this history across runs:

| Run | A13b | Failure point |
|---|---|---|
| Before any change | Fail | `page.waitForURL` timeout |
| After Stage 2 | Pass | — |
| After Stage 2b | Fail | `locator.focus` timeout |

Stage 2b changed **no application code**: only the dev check page, the evidence script and the Blender tools, none of which ship in the production bundle. The failure point also differs between runs. That points to a **pre-existing intermittent timing problem** in the A13b check, or in focus handling under software rendering. It is not caused by this work. It should be investigated as its own task before Stage 3 adds keyboard controls.

## 6. Next (needs your OK)

- Commit the three character GLBs (2.0 + 3.3 + 1.9 MB ≈ 7.2 MB) to `public/models/characters/`.
- Bring island B (7.2 MB) into the game, which replaces the island files.
- Start **Stage 3**: movement and collision on island B (height grid), follow camera and V toggle, persistent NPCs at these positions, proximity prompts, dialogue and inspection, HUD, M map overlay and the quest bridge.
