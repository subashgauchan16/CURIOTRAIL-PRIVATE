# CurioTrail

**Find your way through the digital world.**

CurioTrail is a free, story-driven 3D learning game by SG. You become a *Pathfinder* on a Viking island, and each destination on the island teaches a practical digital skill through short quests: checking AI-generated information, querying data with SQL, repairing Python, building spreadsheet formulas and reading business KPIs.

> **Status:** playable prototype. Six quests are complete from start to finish, including a hands-on data-modelling lab, each with theory cards. They're organised into an eight-module learning path; modules with no content yet are clearly marked *planned*. No unfinished feature is presented as working.
> "CurioTrail" is a working name. Trademarks and domains have not been checked.

**Play:** https://subashgauchan16.github.io/CURIOTRAIL-PRIVATE/ (deployed from `main`; see [Deploy](#deploy)).

**Islands.**
- **The realistic island** is a streamed, textured rebuild of the Viking island, open at `?island=realistic`. It becomes the default on capable devices once PR #6 (`feature/realistic-island-default`) is merged.
- **Island B**, the lighter block island, is used on phones, on weak devices, with CPU-only graphics and with the **Light** graphics setting. You can always open it at `?island=b`.
- **Free exploration:** walk the island as the Pathfinder at `#/explore`.

See [docs/exploration/08-REALISTIC-ISLAND-DEFAULT.md](docs/exploration/08-REALISTIC-ISLAND-DEFAULT.md).

![The 3D map](docs/screenshots/11-map-3d.jpg)

## What's in the game

| Destination (on the island) | Quest | Skill | Challenge types |
|---|---|---|---|
| 🌲 The Signal Woods (forest hamlet) | 01 The Missing Signal | AI literacy | Evidence inspection, choices, prompt choice, announcement assembly |
| 🌲 The Signal Woods | 02 The Ledger in the Woods | SQL | Real SQLite queries: `WHERE`, `GROUP BY` + `SUM`, `ORDER BY` + `LIMIT` |
| 🛠️ The Viking Workshop | 03 The Broken Tally | Python | Read a real `TypeError`, fix it, write expressions, predict output |
| ⚖️ The Trading Market (harbour) | 04 The Market Ledger | Excel | Cell addresses, `=B2*C2` with fill-down, `SUM`, `AVERAGE`, `$` references |
| 🏛️ The Great Hall (longhouse) | 05 The Jarl's Dashboard | Business analytics | Drag KPI cards into a dashboard, interpret trade-offs, choose a chart |
| 🏛️ The Great Hall | 06 The Star Chart (lab) | Data modelling | Build a star schema: add tables, connect keys, set cardinality and direction; the model is checked by real rules |
| 🧭 The Web Frontier (pier tower) | Planned | Digital tools | Not playable yet |

**Unlocking:** The Missing Signal opens the Workshop and the Market. The SQL quest follows it in the Signal Woods. The Market Ledger opens the Great Hall. The Star Chart also requires the SQL quest. All of this is driven by `public/data/world.json` and each quest's `requires`.

**Learning cycle:** each quest moves through **Learn → Guided exercise → Practice → Check your understanding**, shown as colour-coded badges.
- **Theory cards** teach each concept before it's practised. Each card has an objective, a plain-English explanation, an analogy, an example, why it matters, a common mistake and a takeaway, and states any simplification.
- On a replay, a lesson opens in its short version, so experienced learners aren't made to re-read it.
- Lessons award no XP, because XP is for demonstrated skill.

**Learning path:** eight modules, from 0 Digital Foundations to 7 Analytics and Projects (see *Progress & settings*). Modules 0, 1 and 5 have playable content; modules 2, 3, 4, 6 and 7 are listed as planned, with their topics.

**Learner profile:** *Progress & settings* opens with the player's profile. It has:
- a quest trail and an all-time overview;
- *field notes* built from a learning history kept only in this browser: attempts and retries per challenge, a mastery score per finished run, what happened after each wrong answer, a journey timeline, and observations that appear only when the data supports them.

Players can view, pause or delete the history there. Metric definitions are at the top of `src/engine/learning-analytics.ts`. The profile was ported from the CURIO repository; this release has no boss or practice rounds, so those parts of the notes stay empty.

**Scoring:**
- Each challenge gives XP, plus a first-try bonus.
- Wrong answers give the feedback written for that answer and progressively stronger hints.
- After three tries the player can reveal the answer. That step then earns no XP.
- Stars per quest: ★★★ = all first try, ★★ = no reveals, ★ = finished with help.
- Replays keep your **best** score, so rewards are never counted twice.
- The results screen reports each skill as *demonstrated first time*, *after a hint*, or *reviewed with help*.

## Architecture

```
Quest data (JSON) → game rules (src/engine, pure TS) → player state (progress-store)
                                                     → React UI (src/ui)  +  3D world (src/world)
```

- **`src/engine/`** has no DOM, React or Three.js. It holds:
  - `game-engine.ts`: progression, evaluation of every challenge type, XP, stars, skill report and levels
  - `progress-store.ts`: versioned localStorage save (schema v4, with step-by-step migrations from v1) that validates and clamps all loaded data, including the on-device learning history (capped at 2,000 events)
  - `learning-analytics.ts`: the learner profile's field notes, all computed from that one history
  - `progression.ts`: unlock and destination states
  - `quest-validation.ts`: content checks, including running every Python and Excel solution
  - `python-lite.ts`: a sandboxed evaluator for a subset of Python expressions, with CPython-style errors
  - `excel-lite.ts`: a formula evaluator with fill-down
  - `sql-check.ts`: compares query results
  - `schema-lab.ts`: the modelling lab's interaction reducer and its rule-based validator (key uniqueness and foreign-key matching are computed from sample rows)
- **`src/runtime/sql-runner.ts`** runs learners' SQL on a fresh in-memory **SQLite** database (sql.js / WebAssembly, loaded only when needed).
- **`src/world/`** is imperative Three.js. `WorldRenderer` loads island B progressively (light version first, then detailed), or streams the realistic island's 96 m tiles by distance (`streamed-island.ts`). It also places markers by raycasting onto the model, handles camera fly-to transitions, picking, orbit, zoom and keyboard controls, characters, effects, quality tiers, context loss and full disposal. Characters are original low-poly figures with procedural poses.
- **`src/ui/`** contains the React screens:
  - Home (A)
  - Map (B)
  - Quest (C–F)
  - Completion (G)
  - Progress & settings (I)
  - Mobile layouts (H) throughout

  All text is HTML over the canvas. A 2D fallback map is used when WebGL is unavailable, switched off or fails, and every quest still works.

The full audit and implementation plan is in [docs/AUDIT-AND-PLAN.md](docs/AUDIT-AND-PLAN.md).

## Run locally

Requires Node 22+.

```sh
npm ci
npm run dev          # http://localhost:5173 with hot reload
npm test             # unit tests (Vitest)
npm run typecheck
npm run build        # production build in dist/
npm run preview      # serve the build
npm run e2e          # 35 real-browser checks (needs Playwright + Chromium; see below)
```

`npm run e2e` serves `dist/` under `/CURIO/` (like GitHub Pages) and drives Chromium through every quest, the failure modes and the mobile layout. It writes screenshots to `docs/screenshots/` and results to `docs/test-results/e2e.json`. Install Chromium once with `npx playwright install chromium`.

Other browser checks (each needs a dev server on its port; see the first line of each file):
- `e2e/explore-check.cjs`: free exploration;
- `e2e/island-realistic-check.cjs`: the realistic island, best run with `--gpu`.

The learner-profile design prototype, with charts, KPIs and the cookie / privacy banner design, is a standalone page in `prototype/profile-analytics/`. It is not part of the game build. Open `prototype/profile-analytics/index.html` directly; see its README.

## Deploy

GitHub Pages builds from `main` using `.github/workflows/deploy-pages.yml`: `npm ci`, typecheck, tests, `vite build`, then publishing `dist/`. In the repository's **Settings → Pages**, the source must be **GitHub Actions**. Vite uses a relative base (`./`), so the same build works at `/CURIO/` or any other path. `.github/workflows/test.yml` runs typecheck, tests and the build on every push and pull request.

## Accessibility

- Semantic HTML: radio groups, `fieldset`/`legend`, real buttons and links, and labelled regions for tables and the spreadsheet
- Skip link, visible focus, and focus moved to the new heading on navigation and to the feedback after each answer
- Polite live announcements for changes that don't move focus
- Every 3D interaction has an HTML alternative: the destination list, camera buttons and keyboard shortcuts (Q/E rotate, +/− zoom, R reset), and a select menu for every draggable KPI card
- Settings for text size, motion (follow the device, reduce or allow) and graphics (auto, high, light or off)
- Status is always shown with text and an icon, never colour alone. Mobile touch targets are at least 40px.
- **Not yet done:** testing with real screen readers (NVDA, VoiceOver, TalkBack) and with beginner users.

## Assets and credits

- **3D island:** based on ["Viking Island - Minecraft"](https://sketchfab.com/3d-models/viking-island-minecraft-fd76e3824b7647d98be20d3e2160e018) by [cubical.xyz](https://sketchfab.com/cubical), licensed under [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). It was optimised for the web: 376 MB and 4.5M triangles became 0.6 MB (light) and 4.4 MB (detailed). The two model files remain CC-BY-4.0. See [docs/ASSETS.md](docs/ASSETS.md) and `public/models/CREDITS.txt`.
- **Realistic island:** a rebuild of the same island in Blender, streamed as 28 tiles (`public/models/island-realistic/`, about 20 MB in total, about 8 MB for the first view). As an adaptation of the island above it is CC-BY-4.0. Its surface textures and sky are CC0 1.0 from [Poly Haven](https://polyhaven.com). Build it with `npm run build-island-realistic` (see `tools/island-pipeline/README.md`).
- Everything else is original to this project: code, quest content, characters, sky, water, clouds and markers.
- **Libraries:** React, Three.js and sql.js (SQLite) ship in the game under their own MIT or public-domain terms; Vite and the other build tools are not shipped. Versions, copyright lines and full licence texts are in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (regenerate with `npm run notices`).

## Privacy

There are no analytics services, cookies or third-party requests.
- **Progress and the learning history** behind the profile's field notes stay in your browser (localStorage), and nothing is sent to a server.
- **Your controls:** you can pause or delete the learning history in *Progress & settings → How CurioTrail remembers things*. Clearing your browsing data erases everything.
- **No cookie banner yet**, because there are no optional cookies to ask about. The banner and preference-centre design for when there are is in `prototype/profile-analytics/` (`consent.js`).

## Known limitations

See [docs/TEST-REPORT.md](docs/TEST-REPORT.md#incomplete-or-limited) for the full, honest list. In short:
- The characters are stylised and procedural, not rigged models.
- Python is a sandboxed *subset* (expressions only).
- The light island looks coarse up close.
- The realistic island has only been measured on one laptop GPU (Intel Arc 130V: 60 fps). No real phone or low-end device has been tested. Light devices get the block island instead.

## Licence

© 2026 SG · CurioTrail. CurioTrail is **not open source**. A proposed proprietary licence is in [LICENSE](LICENSE); it is a **draft awaiting legal review**.

- **Learners:** playing the official game is free for personal learning, with no account and no ads.
- **Source code:** visible here for review and transparency. Copying, redistributing, hosting a copy or modifying it needs written permission.
- **Organisations:** training use, hosting, embedding, integration, white-labelling and resale need a commercial licence. See [docs/COMMERCIAL-LICENSING.md](docs/COMMERCIAL-LICENSING.md).
- **Earlier versions:** commits published before the new licence were MIT-licensed, and those versions stay MIT. See [docs/IP-OWNERSHIP.md](docs/IP-OWNERSHIP.md).
- **Third-party material** keeps its own licence, including the CC-BY-4.0 island models. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Security issues: see [SECURITY.md](SECURITY.md).

## Feedback

[Open an issue](https://github.com/denilthaks/CURIO/issues/new?title=CurioTrail%20feedback).
