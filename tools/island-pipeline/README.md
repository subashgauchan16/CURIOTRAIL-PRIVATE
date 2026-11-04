# Realistic Viking island pipeline

This pipeline builds the streamed realistic island used by the opt-in variant `?island=realistic`.

## Build
```sh
npm run build-island-realistic -- --source "C:\Users\thaka\Downloads\Viking_realistic island"
# Optional flags:
#   --skip-blender    reuse the last Blender output (about 40 s instead of about 3 min)
#   --only 2,2        export one tile only
#   --chunk 96        tile size in metres
#   --tex 1024        baked terrain texture size per tile
```
Environment variables:
- `VIKING_SOURCE`: the source folder. Same as `--source`.
- `BLENDER`: the path to Blender. Default: `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.
- `PYTHON`: a Python 3 with **numpy** and **Pillow**. Default: `python`. On the development machine use `C:\Users\thaka\anaconda3\python.exe`, because `python` there is the Windows Store stub.

**The source folder (outside the repo, read-only).** It holds:
- `Viking_realistic_island.blend`, the master scene;
- `data/` (`ground.npy`, `deck_h.npy`, `features.json`, `trees.json`), from the Blender build scripts in that folder;
- `polyhaven_dl/`, the CC0 Poly Haven textures.

## Steps
| # | Step | Script | Output |
|---|---|---|---|
| 1 | Blender, headless. The master `.blend` is opened read-only, and the build fails if its modification time changes. | `export_island.py` | `<source>/build_island_game/`: 28 raw tiles, raw shared library, images, `chunks.json` |
| 2 | WebP (Pillow) | `to_webp.py` | `<source>/build_island_game/webp/` |
| 3 | Walk grid + instance placements | `make_nav.py` | `public/data/nav-island-realistic.json` (the game's `NavData` format), `public/models/island-realistic/instances.json` |
| 4 | Compression | `optimise.mjs` | `public/models/island-realistic/`: `manifest.json`, `shared.glb`, `chunk_*.glb`, impostors |
| 5 | Regression checks (a non-zero exit fails the build) | `check.mjs` | `docs/test-results/island-realistic-checks.json` |

Every run is logged to `docs/test-results/island-realistic-pipeline.json`.

## What the checks enforce
- **Extensions:** only `EXT_meshopt_compression`, `KHR_mesh_quantization` and `EXT_texture_webp`. No specular extension, so materials never become `MeshPhysicalMaterial`.
- **Primitives:** every primitive has a material. Textured primitives have float `TEXCOORD_0` (tiles share library materials, which carry no per-tile texture transform). No second UV set.
- **Building UVs:** building primitives in every tile have UVs. Without them the shared textures render flat.
- **Shared library:** all 7 templates and all 9 materials are present, with textures. Ship tints are not white. Sail and frond UVs span 0..1 (stripes and needles visible).
- **Tiles:** exactly one texture per tile (its baked terrain). No shared texture duplicated in a tile. Terrain L0–L2 present, and buildings L0/L1 where there are buildings.
- **Extra files:** the manifest's extra files exist, and `instances.json` has trees and ships.
- **Budgets:** 1.5 MB per tile, 60 k LOD0 triangles per tile, 25 MB in total. These raise warnings, or errors with `--strict`.

## Format notes
- **Compression:** meshopt, the same decoder the game already bundles for islands A and B. No Draco.
- **Quantization:** POSITION is quantized to 14 bits; `streamed-island.ts` bakes the node transform back into world space when it loads a tile. NORMAL and COLOR_0 are quantized. TEXCOORD stays float.
- **Shared materials:** buildings in each tile reference `OPT_Thatch`, `OPT_WoodLight`, `OPT_WoodDark` and `OPT_Stone` by name only. The game binds them to the textured materials in `shared.glb`.
