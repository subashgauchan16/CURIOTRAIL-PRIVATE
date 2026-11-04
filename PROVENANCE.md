# Provenance

This file records where the material in this repository comes from, so that inherited, modified, new and third-party material can be told apart. It records facts and open questions; it doesn't claim ownership or state legal conclusions.

## 1. Categories

| Category | What it covers | How to identify it | Status |
|---|---|---|---|
| **A. Inherited (public MIT baseline)** | Every file as it exists at tag `mit-final` (commit `76c94c6`) | `git ls-tree -r --name-only mit-final` | Published with the MIT licence text (see `docs/LICENSING-HISTORY.md`). Moving it into this private repository doesn't change that: copies of the public versions remain available to others under MIT. |
| **B. Modifications to inherited files** | Changes made after `mit-final` to files that existed at `mit-final` | `git diff mit-final..HEAD -- <file>` (on `main`: `git diff --name-only --diff-filter=M mit-final..HEAD`) | The changes haven't been published. The unchanged parts of those files are category A. |
| **C. New work** | Files added after `mit-final` | `git diff --name-only --diff-filter=A mit-final..HEAD` | Not published. Who owns it and on what terms must be confirmed (section 4). |
| **D. Third-party material** | Libraries shipped in the game; the island 3D models | Section 3 | Remains under its own licence in every category above. |
| **E. AI-assisted material** | Material in A, B or C produced with an AI coding assistant | Section 4 | Ownership and copyright status **require further review**. |

The five commits on `held/2026-10-25` (category B/C) were merged into `main` by denilthaks through pull request #1 on 2026-10-26 (merge commit `89347a0e085097ffdfabe5cbaebdd6a8acbd2816`). They include the **draft** licence now in `LICENSE`, which is pending legal review.

**Owner:** Subash Gauchan (GitHub account `denilthaks`), as stated by the owner on 2026-10-27. No company or other legal entity has been named.

## 2. Authors recorded in git

| Name recorded | Commits | Notes |
|---|---|---|
| denilthaks | `c45a797`, `5d51cd1`, `fc54e59`, `76c94c6`, and the five held commits | GitHub account `denilthaks` |
| Claude | `01280a7` (public via pull request #1; not part of `main`; preserved here as tag `evidence/pr-1-head`) | An AI coding assistant (Claude Code). Not a person. Same file tree as `5d51cd1`. |

No other contributors appear in the history. The public repository has no forks, outside pull requests or issues as of 2026-10-25.

## 3. Third-party material

| Material | Location | Licence (evidence) | Obligations |
|---|---|---|---|
| react 18.3.1, react-dom 18.3.1, scheduler 0.23.2 | `package.json`, `package-lock.json`; bundled in the build | MIT (each package's `LICENSE` file) | Keep the copyright and licence notice |
| three 0.186.1 (including GLTFLoader, OrbitControls and the meshopt decoder) | same | MIT (`LICENSE`; decoder file header) | same |
| sql.js 1.13.0 (includes SQLite) | same | MIT (`LICENSE`); SQLite is public domain | same |
| Island models `public/models/island-high.glb`, `public/models/island-low.glb` | `public/models/` | **CC-BY-4.0**: derivative of "Viking Island - Minecraft" by cubical.xyz (`public/models/CREDITS.txt`; `license.txt` in the original download, kept offline) | Credit the author, link the licence, indicate changes; no added terms or technical measures restricting others' CC-BY rights in these files. Not owned by this project. |
| Development tools (Vite, Vitest, TypeScript, glTF-Transform, sharp/libvips, and others) | `devDependencies` | Various (MIT, Apache-2.0, ISC, BSD, LGPL-3.0-or-later for libvips, CC-BY-4.0 for caniuse-lite) | Not shipped in the game |

Not included: the original model's Minecraft texture atlas (deliberately excluded), third-party fonts (system fonts only), sound, or illustrations.

## 4. AI-assisted material

**Verified from repository and GitHub records:**
- Commit `01280a7` records the author and committer as "Claude". Its message carries the trailer `Co-Authored-By: Claude Opus 5.5` and a `Claude-Session:` link to a Claude Code session. It was deployed by GitHub Pages run 40216567729.
- `5d51cd1` is the same file tree re-committed under the name denilthaks, without those trailers.
- Every commit in this history carries an SSH signature (`gpgsig`). The signing key's owner hasn't been verified.

**Verified from session records held by the owner (not stored in this repository):**
- The work from `5d51cd1` through `76c94c6`, and the five held commits, were produced in Claude Code sessions, at the owner's direction, with the owner's review and approval of each publication step.

**Not established:**
- Which individual lines or passages were written by the tool and which by a person. Git doesn't record that.
- Whether any material reproduces third-party text or code. Inspection found no URLs, credits or copy markers in `src/`, `tools/` or `public/data/`, but that can't rule it out.

**Effect on ownership:** none is implied. Using an AI assistant neither establishes nor disproves copyright ownership. The open questions are:
1. The tool provider's output terms in force for the account used (keep a dated copy).
2. How copyright law treats this material in the relevant jurisdiction.
3. Which records of human direction, selection and review should be kept.

## 5. Recording new contributions

For each pull request after `mit-final`, record in its description:
- who made it;
- whether an AI assistant was used;
- any outside sources, assets or code used, and their licences.

Outside contributions shouldn't be accepted until a contributor agreement has been decided.

## 6. Material integrated from the CURIO repository

On 2026-11-04 the branch `feature/curio-feature-integration` brought in material from `https://github.com/subashgauchan16/CURIO` at commit `f9e03e22679e905c2615c770f196394b902dcfd6` (`main`). The CURIO repository wasn't changed. The file-by-file record is in `docs/CURIO-INTEGRATION.md`.

| Type | Files |
|---|---|
| New here, copied from CURIO | `src/engine/games/*`, `src/engine/learning-analytics.ts`, `src/ui/games/*`, `src/ui/profile/Profile.tsx`, `src/ui/screens/PracticeScreen.tsx`, `src/styles/games.css`, `src/styles/profile.css`, `src/world/market.ts`, `public/data/codex.json`, `docs/GAME-FIRST-SLICE.md`, and the tests named there |
| Inherited files changed to CURIO's later version, then adapted | `src/engine/` (`game-engine`, `progression`, `progress-store`, `types`, `excel-lite`, `quest-validation`), `public/data/quests/market-ledger.json`, the screens and world files listed in that record |

**Verified from the CURIO git history:**
- This material was written after `mit-final`, in commits dated 2026-10-28 and 2026-10-29 (from `5dde7a5` to `336d05e`, merged by pull requests including #6 and #7). The commits sampled carry a `Co-Authored-By: Claude Opus 5.5` trailer, and some record "Claude" as author, so section 4 applies to them too.
- The `LICENSE` file at those commits is still the MIT text. CURIO's `LICENSE` changed to a proprietary notice in `9a2a869`, dated 2026-10-31.
- CURIO's current licence names "Curiotrail" as the copyright holder; this repository's names SG · CurioTrail.

**Not established:**
- The dates these commits became publicly visible on CURIO's `main` (git records commit dates, not push dates).
- The origin and terms of the "Excel Encyclopedia (14 volumes, 2026)" cited by `public/data/codex.json` and by the function list in `src/engine/games/function-names.ts`. The codex holds short summaries with volume and chapter references.

**For review:**
1. `docs/LICENSING-HISTORY.md` treats `mit-final` as the last publicly distributed state. The CURIO commits above suggest that may no longer be complete. That document hasn't been changed.
2. Category C above says new work hasn't been published. That doesn't apply to the material in this section, which is public in CURIO.
3. Whether the Encyclopedia can be referenced in shipped content, and who owns it.
