# Assets

## Viking Island (3D world)

| | |
|---|---|
| Title | Viking Island - Minecraft |
| Author | cubical.xyz (https://sketchfab.com/cubical) |
| Source | https://sketchfab.com/3d-models/viking-island-minecraft-fd76e3824b7647d98be20d3e2160e018 |
| Licence | CC-BY-4.0. Credit required; commercial use allowed. |
| Required credit | This work is based on "Viking Island - Minecraft" by cubical.xyz, licensed under CC-BY-4.0. |

The credit appears in the README, in the game's "About this prototype" panel, in `public/models/CREDITS.txt`, and inside each GLB's `asset.extras`.

The original archive (`viking_island_-_minecraft.zip`, 29.9 MB compressed) is **not** committed, because its 387 MB binary is far beyond GitHub's 100 MB file limit and it isn't needed at runtime. It was kept unchanged; the pipeline reads it and writes new files.

### What the original contains (inspected)

| Property | Value |
|---|---|
| Format | glTF 2.0 (`scene.gltf` + `scene.bin`, generator Sketchfab-16.12.0) |
| Size | 376 MB (6.9 MB JSON + 387 MB binary) |
| Scene | 8,104 nodes, 4,050 meshes, 4,050 primitives, 20,250 accessors |
| Geometry | 6,935,125 vertices, 4,532,690 triangles |
| Materials | 1 (`Atlas`, alpha mask, `KHR_materials_specular`) |
| Textures | 1 × 1024² PNG atlas of Minecraft block textures |
| Vertex colours | 3 values only: white, water blue (0, 0.59, 0.96) and foliage green (0.28, 0.71, 0.09), used as biome tints |
| Animations | none |
| Dimensions | 577 × 157 × 557 units (1 unit = 1 block), Y-up; sea level at y = 36 |
| Includes | the island plus a square seabed slab with a flat water surface (1.66M water triangles, 1.36M submerged triangles) |

### Why the texture isn't shipped

The atlas is made of Minecraft's block textures, which are Mojang's artwork. The model author's CC-BY licence covers their build, not Mojang's textures. To keep the public repository clean, the pipeline **bakes each face to one flat colour** (the alpha-weighted average of the texels under its UVs, multiplied by its biome tint) and drops the texture. This keeps the island's palette and recognisable look, gives a clean stylised voxel style, and lets flat same-coloured surfaces merge during simplification. If you confirm you have rights to the original textures, the pipeline could keep UVs and the atlas instead.

### Conversion pipeline (`tools/optimize-island.mjs`, reproducible)

```sh
npm run optimize-island -- /path/to/extracted/scene.gltf public/models
```

1. **Bake:** each triangle gets a flat colour from a summed-area table of the atlas (O(1) per triangle), snapped to a 32-level-per-channel palette.
2. **Remove water and seabed:** triangles with the water tint are dropped, and so is everything fully more than 1 block below sea level. CurioTrail draws its own animated water, so the island sits in a real sea instead of on a square slab.
3. **Merge and chunk:** all 4,050 meshes are merged into a 4 × 4 grid of chunks (16 draw calls, frustum-cullable). Positions are snapped to 1/64 block so identical vertices weld.
4. **Simplify:** the detailed version uses meshoptimizer `simplify` (error 0.0004 of the model extent) with chunk borders locked, so chunks never crack. The light version uses `simplifySloppy` on a single merged mesh, with a budget of 220k triangles.
5. **Quantize and compress:** positions are quantized to 14 bits (`KHR_mesh_quantization`) and colours to 8 bits, then reordered and compressed with `EXT_meshopt_compression`. Three.js decodes this with its bundled `MeshoptDecoder`, so there are no remote decoders and no extra hosting requirements.

Running the script twice from the repo produced byte-identical files (SHA-256 checked).

### Results

| File | Triangles | Draw calls | Size | Used for |
|---|---|---|---|---|
| Original | 4,532,690 | 4,050 | 376 MB | — |
| `island-low.glb` | 186,584 | 1 | **0.60 MB** | First paint, phones and low-power devices |
| `island-high.glb` | 1,035,822 | 16 | **4.38 MB** | Loaded progressively on capable desktops |

The light version loads first, so the island is visible quickly, and the detailed version replaces it when ready. If the detailed version fails, the light one stays. If both fail, the game shows a retry banner and a 2D map, and all quests keep working.

**Visual differences from the original:**
- Flat colours instead of pixel textures.
- No water or seabed blocks (replaced by animated water).
- The light version is visibly coarse up close, so quest cameras frame from further back on that tier.
- Transparent texels (glass, plant cut-outs) become solid colour.

## Original assets made for CurioTrail

These are all code, with no image files:
- **Characters:** Mira, Sigrun, Tove and Astrid (`src/world/characters.ts`)
- **Environment:** gradient sky, wave-shader water, clouds and sparkles (`src/world/environment.ts`)
- **Markers:** quest markers and the celebration burst (`src/world/WorldRenderer.ts`)
- **2D art:** the 2D fallback map and the favicon

## Libraries

| Library | Licence | Use |
|---|---|---|
| React 18 | MIT | UI |
| Three.js r186 (incl. GLTFLoader, OrbitControls, MeshoptDecoder) | MIT | 3D world |
| sql.js 1.13 (SQLite compiled to WebAssembly) | MIT | Running learners' SQL |
| Vite, Vitest, TypeScript | MIT / Apache-2.0 | Build and tests |
| glTF-Transform, meshoptimizer, pngjs | MIT | Asset pipeline (dev only) |


## Realistic Viking island (streamed tiles, opt-in with `?island=realistic`)

| | |
|---|---|
| Files | `public/models/island-realistic/`: `manifest.json`, `shared.glb`, 28 × `chunk_<i>_<j>.glb`, `instances.json`, 2 impostor WebPs. Plus `public/data/nav-island-realistic.json` and `public/data/islands/realistic.json`. |
| Derived from | The layout and heights of "Viking Island - Minecraft" by cubical.xyz (CC-BY-4.0): block heightfield, building footprints, walkways, ship and tree positions, rebuilt as new geometry. No original mesh, texture or Minecraft artwork is included. |
| Textures | Poly Haven, CC0 1.0: `aerial_grass_rock`, `aerial_rocks_02`, `coast_sand_01`, `stony_dirt_path` (baked per tile), `brown_planks_05`, `medieval_wood`, `thatch_roof_angled`, `mossy_stone_wall`, `knotted_pine_bark` |
| Licence of the files | CC-BY-4.0 (adaptation of the island above, credit required). The textures inside are CC0. |
| Build | `npm run build-island-realistic -- --source "<Viking_realistic island folder>"` (see `tools/island-pipeline/README.md`) |
| Format | glTF 2.0 + `EXT_meshopt_compression` (decoded by three's bundled `MeshoptDecoder`, as for the other islands) + `EXT_texture_webp`. Positions and UVs are float, because tiles share the library's materials. |

The master Blender file (`Viking_realistic_island.blend`) and the source data stay outside the repository. The pipeline only reads them.
