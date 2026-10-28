# Licensing history

This is a factual record of how CurioTrail was published and under which licence. It doesn't state legal conclusions; questions for legal review are marked **For review**.

## Public repository

- Repository: `https://github.com/denilthaks/CURIO` (public)
- Live game: `https://denilthaks.github.io/CURIO/` (GitHub Pages, deployed by `.github/workflows/deploy-pages.yml` on pushes to `main`)

## Publicly distributed states

| Commit | Date (UTC) | Author recorded in git | Licence file | `package.json` licence | Public channel |
|---|---|---|---|---|---|
| `c45a7970d571c57d5dfd670a2e22cfc1c320dea4` | 2026-10-25 17:03 | denilthaks | none | none | `main` (initial commit) |
| `01280a7f81a80db598c082db17b5cb2c2ff5323f` | 2026-10-25 17:22 | Claude (AI coding assistant), with a co-author trailer | MIT, "Copyright (c) 2026 CurioTrail contributors" | MIT | `main` (later replaced); Pages deploy run 40216567729; still reachable as `refs/pull/1/head` (pull request #1) |
| `5d51cd1ed22feafdee54a5d5d0fcd5a59b8e580f` | 2026-10-25 17:39 | denilthaks | MIT (same text) | MIT | `main`; Pages deploy run 40218121696; branch `CURIO` |
| `fc54e59c64e8ebc47719de02033d778493316089` | 2026-10-25 19:52 | denilthaks | MIT (same text) | MIT | `main`; Pages deploy run 40228414110 |
| `76c94c69c058e0d106348aff213c8a1690b9c269` | 2026-10-25 21:48 | denilthaks | MIT (same text) | MIT | `main`; Pages deploy run 40237455579 (the live game at the time of writing) |

Notes:
- `01280a7` and `5d51cd1` have identical file trees (`3b9de55340ccbd4cd4c20668e0d7e841b6211261`) and the same parent (`c45a797`). `5d51cd1` is an amended version of `01280a7` (author changed, trailers removed), and `main` was force-updated to it.
- The Pages deployments of `01280a7` and `5d51cd1` published `index.html`, `assets/`, `css/`, `js/`, `data/` **and `LICENSE`** as the site itself. Later deployments (`fc54e59`, `76c94c6`) published the Vite build (`dist/`), which doesn't include `LICENSE`.
- The README at `fc54e59` and `76c94c6` describes the project as "open-source" and states that "The code and quest content are MIT". The home screen at `76c94c6` reads "A free, open-source learning adventure".
- The verbatim MIT licence text of the public baseline is kept in `LICENSES/MIT-HISTORICAL.txt`.

## Boundary

- **`mit-final`** is a tag on `76c94c6`, the last publicly distributed state.
- Everything reachable from `mit-final`, and the separately published `01280a7`, was published with the MIT licence text above.
- Commits after `mit-final` in this private repository haven't been published. The owner, Subash Gauchan, intends them to be proprietary (see `COPYRIGHT.md`). The final licence terms are pending legal review.

**For review:**
1. The legal effect of the MIT grant made under the name "CurioTrail contributors".
2. Whether later versions that contain unchanged MIT-era material can carry different terms.
3. The status of AI-generated material (see `PROVENANCE.md`).

## Unpublished work held before the private repository

Five commits were made locally on 2026-10-25 on top of `76c94c6` and were never pushed to any public repository. They're preserved unchanged on the private branch `held/2026-10-25`, and were merged into private `main` through pull request #1 on 2026-10-26 (merge commit `89347a0e085097ffdfabe5cbaebdd6a8acbd2816`). That made the **draft** proprietary licence the content of `LICENSE` on private `main`; it's pending legal review. They're also kept in an offline backup (`curio-held-commits-2026-10-25.tar.gz`, SHA-256 `59adb2a64516add4669034ae468b323e88a12092f0993a2c5f2625b2dab8429a`).

| Commit | Content |
|---|---|
| `a9d2b5beb516e30d0de82b7a36996c7df7450886` | Brand mark and copyright line |
| `b358a5dccc4e06cf66466c1d51895a0db1348576` | Third-party notices and generator |
| `e7bfeb15c729cf9782841a99fd4e8e177587cf71` | **Draft** proprietary licence and licensing documents (not legally reviewed; present in private `main` since PR #1) |
| `4cde53a66008e9c3ecd4a4dda459fdc97bbd2525` | Security documentation, `.gitignore` additions |
| `8e1e2033e8bc197445798072db38783ee7391a24` | Browser test for the brand mark; test report |

## Third-party material

The third-party material has its own licences, which apply regardless of anything above. See `PROVENANCE.md`.
