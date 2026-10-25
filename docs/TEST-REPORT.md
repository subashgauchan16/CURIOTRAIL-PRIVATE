# Test report

## Branding and licensing (latest run, not yet pushed)

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ no errors |
| Unit tests | `npm test` | ✅ **105 / 105** in 7 files: the 99 earlier tests, all still passing, plus 6 new (`tests/brand.test.ts`) |
| Production build | `npm run build` | ✅ no source maps; `THIRD-PARTY-NOTICES.txt` is in `dist/` |
| Browser end-to-end | `npm run e2e` | ✅ **35 / 35**: the 34 earlier checks, unchanged and all passing, plus **W1** |

**W1** runs on desktop (1366 × 820) and on a phone (390 × 844, touch), both with reduced motion, on the home, map, destination, quest and completion screens. On each screen it confirms:
- exactly one SG · CurioTrail mark, as an SVG, with exactly one accessible label
- the mark is visible, isn't an overlay, takes no pointer input and doesn't animate
- it doesn't cover any visible link, button, field or other focusable element
- the page doesn't scroll sideways

It also confirms that the island credit is still in *About this prototype*, unchanged, next to the copyright line, and that the Progress screen's notice links to a third-party notices file the site actually serves.

Quests, XP, unlocks, the v1 → v2 → v3 migrations, saves and the 2D fallback are covered by the earlier checks, which all still pass. Screenshots: `docs/screenshots/29-brand-home.jpg` and `29-mobile-brand-quest.jpg`.

**Not tested:** with a real screen reader. The label was checked through the accessibility markup only.

---

## Learning platform, Phase 1



| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ no errors |
| Unit tests | `npm test` | ✅ **99 / 99** in 6 files: the 67 earlier tests, all still passing, plus 32 new |
| Production build | `npx vite build` | ✅ |
| Browser end-to-end | `npm run e2e` | ✅ **34 / 34**: the 29 earlier checks, updated for lesson steps, plus 5 new |

**New unit tests** (`tests/learning.test.ts`):
- Lessons are complete, linked to objectives, placed before their challenge, and award no XP.
- Reading a lesson is remembered once.
- The v2 → v3 migration resumes a mid-quest player on the same step, and keeps completion, best XP, stars and unlocks.
- Every lab rule: missing tables, missing or aggregated fact table, accidental many-to-many from duplicate keys, non-key columns, mismatched keys, dimension-to-dimension links, unset or wrong cardinality, two-way filters, ambiguous duplicate links, an unconnected dimension, and an unused extra table being only a warning. Connecting from the dimension side is accepted.
- The lab reducer: add, move and nudge, click-to-connect (switching, cancelling and refusing duplicates), editing, removing and repairing relationships, removing a table with its links, reset and load. Tampered models are sanitised.
- The engine's hints and XP for the lab.
- Quest prerequisites, including cycle detection; curriculum validation; module status coming from real content.

**New browser checks:**
- **L1:** the theory card shows every section, its sections collapse, and it leads into a guided exercise.
- **L2:** the full desktop lab. Inspect a distractor's sample rows, add tables, move a card by mouse and by keyboard, build a flawed model and get 7 specific explanations plus hint 1, remove a relationship and a table, repair the model (one link drawn from the dimension side), pass with +40 XP, see the relationship lines and "Why this model works", finish the assessment, get 105 XP and the badge, with lessons saved.
- **L3:** the learning path shows 8 modules: 5 planned with no controls, 3 completed, and real lesson counts.
- **L4:** a real v2 save resumes on "A second opinion?" with XP and settings intact.
- **L5:** on a phone, the theory card and the whole lab work with taps only, using the stacked layout, with no horizontal scroll.

The existing A11 check now also confirms that replayed lessons open in their short version.

**Bugs found while testing and fixed:**
- The app crashed when removing a relationship, because the lines were drawn from stale geometry. An error boundary now also keeps any screen error from blanking the game.
- Every table was outlined red after a check. Only table-level problems flag a table now.
- The lab rendered in its phone layout on desktop. Lab steps now use a wide panel.
- On phones, long lines in lesson code examples widened the whole page, which broke taps.
- The 2D fallback's map labels showed behind quest panels.

**Phase 1 limitations:**
- The lab's draft is kept in this browser's localStorage, as a convenience; finished results are saved through the normal progress system.
- The lab's rules are deliberately beginner-level: many-to-one, single direction, one fact table. This simplification is disclosed in the lessons.
- Screenshots: `docs/screenshots/04b-theory-card.jpg`, `24-lab-feedback.jpg`, `25-lab-correct.jpg`, `26-learning-path.jpg`, `27-mobile-theory-card.jpg` and `28-mobile-lab.jpg`.

---

## Previous release (3D world and five quests)

Produced by actually running the application; nothing here comes from inspecting code alone. Raw results: [`docs/test-results/e2e.json`](test-results/e2e.json). Screenshots: [`docs/screenshots/`](screenshots/).

## How it was tested

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ no errors |
| Unit tests (Vitest) | `npm test` | ✅ **67 / 67** passed, in 5 files |
| Production build | `npx vite build` | ✅ builds |
| Browser end-to-end | `npm run e2e` | ✅ **29 / 29** checks passed |
| Asset pipeline reproducibility | `npm run optimize-island` | ✅ byte-identical output (SHA-256) |

**Before any change**, the original suite ran 26 / 26 passing. All 26 tests were ported to TypeScript and still pass, inside the 67.

**Unit tests cover:**
- Every quest playable perfectly for full XP and 3 stars
- Gating, hints, reveal, first-try bonus and star rules
- SQL solutions executed on real SQLite, and realistic wrong queries rejected
- Destructive SQL can't persist; recursive queries are blocked
- Python semantics and CPython error wording; no access to JavaScript through names like `constructor` or `__proto__` (a real bug these tests caught)
- Excel references, ranges, functions, errors and fill-down
- KPI placement
- Save round-trips, plus corrupted, future-version and blocked storage, and tampered values
- v1 → v2 migration with star back-fill
- Replay best-score rules
- Unlock rules
- Content validation, including each Python and Excel solution passing its own check

**Browser environment:** Playwright drives Chromium (headless) against the production `dist/` build, served under **`/CURIO/`** to mimic GitHub Pages. WebGL runs through **SwiftShader, a software (CPU) renderer**, because this machine has no GPU. Desktop is 1366 × 820; mobile is 390 × 844 with touch, at device scale 2.

## End-to-end checks

| # | Check | Result |
|---|---|---|
| 1 | Home loads at the `/CURIO/` base path without console errors (A1, A1b) | ✅ |
| 2 | "Start Your First Quest" opens identity, then The Missing Signal (A2) | ✅ |
| 3 | All three evidence items can be inspected; continuing is gated (A3) | ✅ |
| 4 | A wrong answer shows the feedback written for *that* option, plus hint 1 (A4, A4b) | ✅ |
| 5 | A correct answer shows the quest's explanation and XP (A5) | ✅ |
| 6 | The prompt-writing challenge evaluates real choices (A6/F) | ✅ |
| 7 | Hints progress; reveal after 3 tries gives no XP (A7) | ✅ |
| 8 | XP and level are correct: a controlled run gave **95 XP → Level 2 Scout, ★☆☆**, matching the engine's rules exactly (A8/G) | ✅ |
| 9 | Completion unlocks only the Workshop and Market; the Great Hall stays locked; a locked quest URL redirects with an explanation (A9) | ✅ |
| 10 | Refresh mid-quest restores the exact step (A10) | ✅ |
| 11 | Replays never stack rewards: a perfect replay adds **+30** (improvement only), the next adds **+0**, and the badge is awarded once (A11) | ✅ |
| 12 | Reset requires confirmation; cancel keeps data; confirm erases storage and identity (A12) | ✅ |
| 13 | Settings (text size and motion apply and persist); keyboard-only answering; skip link is the first tab stop; focus moves to feedback (A13/I, A13b) | ✅ |
| 14 | 3D world renders real geometry: 243k triangles, 34 draw calls, 5 markers raycast onto the model; a canvas screenshot has 319 distinct colour buckets, so it isn't a flat image (A14) | ✅ |
| 15 | Model download blocked: error, retry button, quests still playable (A15b). WebGL disabled: 2D map, and the first quest is completed with 125 XP (A15c). Graphics "off": fallback map with working navigation (A15a) | ✅ |
| 16 | Mobile: home, quest, evidence and map bottom sheet; no horizontal scroll; no touch target under 40px; the light island is used (A16/H) | ✅ |
| 17 | Existing and new unit tests pass | ✅ 67 / 67 |
| 18 | Build works with the hosting base path (all of the above ran at `/CURIO/`) | ✅ locally. The live GitHub Pages URL is verified only after merging to `main`. |

**Viking Island checks:**

| # | Check | Result |
|---|---|---|
| 1–2 | The real island asset loads and renders as 3D geometry | ✅ |
| 3 | The camera can inspect it: mouse drag, the Q key and the zoom button each move the camera (P9-3) | ✅ |
| 4 | All four destinations can be selected via their world-anchored labels, and by clicking the 3D marker itself (raycast pick reached `#/map/signal-woods`) (P9-4) | ✅ |
| 5–6 | Each destination opens its challenge. **SQL:** wrong `'north'` returns "no rows" and the SQLite syntax error is shown. **Python:** the real `TypeError`, then a fix with a Run preview. **Excel:** fill-down checks D2:D5 and rejects `=150+120+120+110`. **KPI:** mouse drag-and-drop plus select menus, with misplaced cards explained (P9-6a–d) | ✅ |
| 7–9 | Rewards come from the engine and persist: after all five quests, the HUD total equals the saved progress (555 XP, 11 stars, 5 badges); after refresh, every marker is "completed" except the planned Web Frontier (P9-7/8, A11) | ✅ |
| 10 | Usable at mobile size (A16/H) | ✅ |
| 11 | Missing assets and missing WebGL don't break the activities (A15b, A15c) | ✅ |
| 12 | Model and decoder load with correct relative paths under `/CURIO/` | ✅ |

### Bugs found by these tests and fixed before delivery

- Python names like `constructor` reached JavaScript's prototype chain. Lookups now use own keys only.
- The Python tokenizer rejected `3 + x`.
- "Added to your total" was measured after live in-run XP, showing +25 instead of +95.
- KPI cards made the drop zones jump when picked up. A ghost card now follows the pointer.
- No auto-scroll while dragging on small screens.
- Settings were applied only after content loaded, causing a flash.
- Opening a quest by URL lost the character, because the renderer started from a stale camera mode.
- Mira's hood covered her face.
- Trees could block the quest camera. It now raycasts several angles and picks a clear one.

## Performance (measured)

| Measure | Value |
|---|---|
| Original asset | 376 MB, 4.53M triangles, 4,050 meshes |
| Light / detailed island | 0.60 MB / 4.38 MB (meshopt-compressed GLB) |
| First paint downloads | app 96 KB + React 139 KB + CSS 36 KB + quest JSON about 57 KB (uncompressed transfer from the test server; GitHub Pages also gzips) |
| Loaded on demand | Three.js 574 KB + world code 115 KB; SQLite WebAssembly 660 KB only when a SQL quest opens |
| Home interactive | 183 ms (local server) |
| Light island visible | 726 ms after navigation start (local server) |
| Draw calls / triangles | Light: 34 calls (island 1 + sky, water, clouds, markers), about 243k triangles drawn. Detailed: 13–40 calls, about 0.43–1.08M triangles depending on view |
| GPU resources | 21 geometries, 0 textures (light, home view) |
| Frame rate | **Not meaningful here**: 5 fps desktop and 0–2 fps mobile emulation, because SwiftShader renders on the CPU. **No real GPU or phone has been measured.** |

Performance choices:
- Three.js is lazy-loaded, and quality is picked per device: phones, touch devices, low memory or four cores or fewer get the light island at pixel ratio 1.25.
- No real-time shadows; flat-shaded Lambert materials; no textures.
- 4 × 4 chunks give frustum culling on the detailed island.
- Rendering pauses in hidden tabs.
- Every geometry, material, listener and the animation loop is disposed on teardown.

## Incomplete or limited

- **Real-device performance:** frame rate, memory and GPU load were not measured on real hardware (see above). Please try a laptop and a mid-range phone and use *Progress & settings → Graphics diagnostics → Measure now*.
- **Characters** are original low-poly figures with procedural poses (idle, talk, point, wave, celebrate), not rigged or skinned models. There is **no walking animation**: characters appear at their destination while the camera travels.
- **Foliage animation** is a shading "wind shimmer" on green surfaces, not moving geometry. Geometric sway would crack the merged island mesh.
- **Python** is a sandboxed subset: single expressions, numbers, text, lists and common built-ins. There are no statements, loops or functions.
- **The light island** looks coarse up close. Quest cameras frame from further back on that tier.
- **Flat colours instead of the original Minecraft textures** (see ASSETS.md for why).
- **Screen-reader testing** with NVDA, VoiceOver or TalkBack has **not** been done. Only automated keyboard, focus and ARIA-structure checks ran.
- **Beginner user testing** has not happened yet. It's Phase 4 of the original plan.
- **The Web Frontier** is planned only, and the game says so.
- **Live GitHub Pages** deployment is verified only after this branch is merged to `main`.
