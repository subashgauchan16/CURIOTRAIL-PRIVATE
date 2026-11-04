# The realistic island becomes the default

4 November 2026 · branch `feature/realistic-island-default` (from `main` @ `69a28af`).
This follows [07-VIKING-ISLAND-STREAMING-INTEGRATION.md](07-VIKING-ISLAND-STREAMING-INTEGRATION.md), where the island shipped as the opt-in `?island=realistic`.

## What changed
- **`public/data/world.json`** now holds the realistic island's config and destination positions. It is the default without any URL parameter.
- **Island B** (the 144 m block island) is kept as the variant `public/data/islands/b.json`:
  - It has the Stage 3 positions and landmark texts.
  - Open it with `?island=b`.
- **Light-graphics fallback.** The realistic island has no light tier. Playing it on a CPU-only renderer saturated the page, and clicks timed out (see *Why the fallback*). So the island config names `"lightVariant": "b"`, and `chooseIslandVariant()` (`src/app/island-variant.ts`) loads island B instead when graphics are light:
  - the saved graphics setting is **Light**; or
  - the setting is **Automatic** and the device is light. That means the existing `detectQuality()` check (touch screen, small screen, ≤ 4 GB memory or ≤ 4 cores) says so, or WebGL runs on the CPU (`softwareRenderer()`: SwiftShader, llvmpipe, Microsoft Basic Render Driver).
- **Overrides.** **High detail** always gets the realistic island, and `?island=<name>` always wins. The choice is made once per page load. The Progress & settings page says a change applies the next time CurioTrail loads.
- **One WebGL probe.** `webglAvailable()` and `softwareRenderer()` share one throwaway WebGL context per page. A second context before the first screen slowed CPU-only start-up enough to fail W1.
- Quests, unlock rules, NPC ids and dialogue are unchanged. Every variant only moves things (`applyIslandOverlay`).

## Why the fallback
These runs had the realistic island on every device and no fallback. The game's own e2e suite (`npm run e2e`, Chromium on SwiftShader) gave:

| Run | Passed | Notes |
|---|---|---|
| 1 | 32 / 35 | A16 failed (mobile got the full island); A13 and W1 timed out |
| 2 | 20 / 35 | Same build, with a git clone running alongside |
| 3 | 14 / 35 | Same build, with a browser tab rendering the island alongside |

The swing came from how busy the machine was. The 540 k-triangle island leaves no headroom on a CPU renderer, while island B never did.

## Validation (this machine: Intel Arc 130V, Windows 11)
| Suite | Island | Result |
|---|---|---|
| `npx tsc --noEmit` | – | clean |
| `npx vitest run` | – | **138 / 138** (new: default and `?island=b` data, light-variant choice) |
| `npm run build` | – | OK |
| `npm run e2e` (SwiftShader, so the light fallback loads island B) | B via fallback | **35 / 35** (`docs/test-results/e2e.json`) |
| `node e2e/island-realistic-check.cjs --gpu` (default URL, no parameter) | realistic | **9 / 9** (`docs/exploration/stage4/results-gpu.json`) |
| `node e2e/explore-check.cjs --gpu` (now opens `?island=b`) | B | **16 / 16** (results kept outside the repo; the committed Stage 3 evidence is unchanged) |

Realistic island on the default URL, GPU:
- first view 8.36 MB, ready in 4.25 s;
- exploring at 60 fps, p95 16.7 ms, 157 draw calls, 540 k triangles.

## Not verified
- **No real phone or low-end laptop was tested.** On those, the fallback is chosen by the same heuristics the game already used for its light tier.
- A desktop with a weak GPU that passes `detectQuality()` gets the realistic island. The player can pick **Light** in Progress & settings.

## Rollback
- **Per player:** pick **Light**, or open `?island=b`.
- **For everyone:** revert this branch's merge commit. `world.json` then goes back to island B, and `?island=realistic` still works.
