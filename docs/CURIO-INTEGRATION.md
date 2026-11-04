# CURIO feature integration

What was compared, what was brought in from the public CURIO repository, what was adapted and what was left out.

- **Target:** `subashgauchan16/CURIOTRAIL-PRIVATE`, branch `feature/curio-feature-integration`, based on `main` at `07d4446`.
- **Source (read-only):** `subashgauchan16/CURIO`, `main` at `f9e03e2`. Nothing in that repository was changed.
- **Shared history:** both descend from `76c94c6` (`mit-final`). After it, the target added the brand mark, licence records and the exploration work; the source added the game-first quest and the learner profile.

## Audit

| Feature | Source implementation | Target before | Gap or incompatibility | Action |
|---|---|---|---|---|
| Cookies | No cookies in the game. `prototype/profile-analytics/` is a standalone demo: `consent.js` writes `curio-proto-consent` and `curio-proto-prefs` to localStorage, with a banner in `index.html`. Its README says it's not a consent-management platform and needs UK GDPR and PECR review. The game's real controls are `PrivacyPanel` in `src/ui/profile/Profile.tsx`. | No cookies. The only mention is the README's privacy line. | "Cookie" means a design prototype plus a privacy panel, not a cookie system. A banner would ask for consent to nothing. | Port the privacy panel. Omit the banner and prototype. |
| Storage | `curiotrail.progress`, `curiotrail.lab-draft.*`. | The same, plus `curiotrail.explore.player` (session) and `curiotrail.explore.controls-seen`. | The source panel says the reset erases everything, but `store.reset()` removes only the save. | Adapt: reset now clears every `curiotrail.` key (`clearOwnedKeys`), and the panel names the extras. |
| XP | `sceneXp` and `computeXp`; `isFirstTry` with `parFor` (rune-words count "first time" within par). | `sceneXp` and `computeXp`; first try means one attempt. | Same rules for existing quests; the source generalises first try. | Port. |
| Reveals | No XP. Evidence steps also have a pick limit (`pickLimit`), and running out counts as revealed. | No XP after a reveal. | No pick limits, because there are no evidence steps. | Port. |
| Stars, medals | `computeStars`; game quests mirror `computeMedal`. | `computeStars` only. | No medals. | Port. |
| Boss and mastery | `bossScore`, `stepCredit`, `isMastered`; pass mark 70% (`DEFAULT_MASTERY`). | None. | Unlocks follow completion in the target. | Port. `isQuestMastered` now drives unlocks in `progression.ts`. |
| Replays | `withCompletion` keeps best XP, stars, mastery, medal and silver; replays never remove mastery. | Keeps best XP and stars. | New fields only. | Port. |
| Silver wagers | `placeWager`, `computeSilver`; never affects XP, medals or unlocks. | None. | Separate side-game. | Port with the quest, because the quest's data uses it. |
| Skill evidence | `skillReport`, `conceptReport`, per-concept records in `games/mastery.ts`, `learning-analytics.ts`. | `skillReport`. | No concept mastery or history. | Port. |
| Levels | `LEVELS`, `levelFor`. | Identical. | None. | Retain. |
| Persistence | Schema v5: v3→v4 (mastery, medals, concepts), v4→v5 (events, `recordEvents`). `sanitizeEvents`, `sanitizeConcepts`. | Schema v3. | The target's v3 is the source's v3, so the existing migrations apply unchanged. | Port. Onboarding fields left out. |
| Modules | `public/data/curriculum.json`; `moduleStatus` in `progression.ts`. | Byte-identical curriculum and function. | Status logic is the same, but it now reads mastery through `questStatus`. | Retain. Tests added. |
| Quest order | `recommendedOrder` in `world.json`; `recommendedNext`. | Map order; `nextQuestAt`. | The source's `world.json` positions are for island A. | Adapt: add the order and list the Market before the Workshop. Island B positions, landmarks and `island` are kept. |
| Market quest | `market-ledger.json`: The Merchant's Ledger, 20 steps, 7 mechanics, a five-step boss. | The Market Ledger, 9 steps. | Without it, boss, medals, wagers, practice and the Codex would never run. | Port the data, `src/ui/games/`, `games.css`, `PracticeScreen` and `codex.json`. |
| Excel engine | `excel-lite.ts` follows Excel precedence, adds `%`, Excel's `ROUND`, circular range checks and clearer unsupported messages. | Simpler evaluator. | Behaviour change for `=-2^2` (now 4, as in Excel). | Port. |
| World reactions | `src/world/market.ts`; `react`, `highlight`, `revealUnlock` in `WorldRenderer`. | None. Island B is scaled by `s` = 0.25. | The source assumes island A units. | Adapt: every distance and the stall size multiply by `s`. |
| Progress screen | Profile above the Atlas card. | Atlas card only. | The new page heading is the player's name, in the profile header. | Adapt: the target card stays below, with its copyright notice. |

## Fixed while integrating

Two things in the source were inconsistent, and were corrected here rather than copied:

- **A failed audit said it had passed.** The ending and the results heading read "The audit is passed" whatever the score. The quest now has an `ifNotMastered` ending (`endingFor` in `game-engine.ts`), and the results heading falls back to "Quest complete", including for legacy completions.
- **Reset left data behind.** See *Storage* above.

The source's end-to-end suite also still expected save version 4; here it expects 5.

## Target UI preserved

Island B and its chunked rendering, exploration (`/explore`, `ExploreScreen`, rigged NPCs), the SG · CurioTrail mark on each screen, the copyright notice, the "Return to the island" links and the home copy are all unchanged. The source's older island coordinates, its "open-source" home line and its licence wording weren't brought in.

Files changed only where a feature needed them: `App`, `router`, `game`, `main`, `TopBar`, `MapScreen`, `ProgressScreen`, `CompleteScreen`, `QuestScreen`, `Scenes`, `common` and `WorldRenderer`.

`HomeScreen`, `StartScreen`, `ExploreScreen`, `WorldStage` and `BrandMark` weren't touched.

## Left out

| Item | Why |
|---|---|
| Consent banner and `prototype/profile-analytics/` | There are no optional cookies or storage categories to consent to. |
| Onboarding background and goal (`StartScreen`, `Player` fields) | New personal data that nothing in the game uses. |
| `/start/:quest` return path | Not needed for these features; `StartScreen` stays as it is. |
| Usability kit, feedback templates, acceptance reviews | Process documents for the public repository. |
| Source `README`, `LICENSE`, `package.json` licence field, `index.html` description | The target's identity and legal notices stay. |

## Save compatibility

- v3 saves migrate to v5. A completed quest counts as mastered, so nobody loses an unlock.
- A finished old Market Ledger keeps its completion, XP, stars and badge, and shows "Completed in an earlier version" until replayed.
- A half-finished old Market Ledger resumes at the first new step not yet done.
- Migration is one-way. A v5 save opened by an older build is ignored as a newer release's data, so don't roll back the deployed build without expecting that.

## Verification

Run on 2026-11-04 in a cloud container with software rendering (no GPU).

| Check | `main` at `07d4446` | This branch |
|---|---|---|
| `npm run typecheck` | Passes | Passes |
| `npm test` | 126 passed | 304 passed |
| `npm run build` | Passes | Passes |
| `npm run e2e` | 35 of 35 | 36 of 36 |
| `node e2e/explore-check.cjs` (software rendering) | 11 of 16 | 11 of 16, with the same five failures |

- The first e2e run on this branch was 34 of 36. L6 failed because of a mistake in the new check itself, now fixed. A13b timed out once, which matches its intermittent record in `docs/exploration/`, then passed three isolated runs and the full run above.
- The five exploration failures (X2, X4, X5b, X6, X10a) fail the same way on `main`. All are movement or travel checks; that suite's recorded 16 of 16 was run with `--gpu`. It should be rerun on a real GPU.
- Not tested: real phones, real screen readers, and a real save from a deployed build. Migration was tested with constructed v3 saves.

## Open questions

- **Licensing:** see [PROVENANCE.md](../PROVENANCE.md#6-material-integrated-from-the-curio-repository).
- **PECR:** the learning history is on by default and stored on the device. Whether that storage needs consent wasn't assessed here and should go to the legal review of the licence and privacy text.
- **Market stall on island B:** it's placed by the same rule as on island A, scaled to island B, and it reacts correctly in the quest view. It stands close to island B's own market desk, and the walk grid doesn't know about it, so the Pathfinder can walk through it in free exploration. It needs a look by eye.
