# Intellectual property and ownership

> **For legal review.** This is a factual record prepared to help a lawyer review CurioTrail's position. It is not legal advice and does not claim any right that has not been verified. Placeholders are in [square brackets].

## Owner and creator

- **Creator mark:** SG
- **Owner:** [FULL LEGAL NAME OR ENTITY: TO BE CONFIRMED]. No company or legal entity has been set up or verified for CurioTrail.
- **Repository:** https://github.com/denilthaks/CURIO (account `denilthaks`)
- **Published game:** https://denilthaks.github.io/CURIO/

## What CurioTrail's own work covers

Source code in `src/`, `tests/`, `e2e/` and `tools/`; quest, lesson and curriculum content in `public/data/`; the interface design, original characters, sky, water, clouds and markers; the favicon; and the documentation.

## Rights already granted under MIT (cannot be withdrawn)

Until this change, the repository's `LICENSE` was MIT ("Copyright (c) 2026 CurioTrail contributors"), and README and the game described CurioTrail as open source. These public commits carry the MIT licence (all authored by `denilthaks`):

| Commit | Content |
|---|---|
| `c45a797` | Initial commit (a one-line README; no MIT licence file yet) |
| `5d51cd1` | First prototype, MIT `LICENSE` added (branch `CURIO`) |
| `fc54e59` | 3D world and five quests |
| `76c94c6` | Learning platform Phase 1 (current `main`) |

Anyone who obtained those versions may keep using, modifying and redistributing them under MIT, including commercially, as long as they keep the MIT notice. A new licence applies only to work published after it. Deleting history or making the repository private would **not** withdraw these grants, and copies or forks may already exist.

**For review:** the old notice names "CurioTrail contributors" rather than a person; confirm who the copyright holder is and that changing the licence is possible (this depends on there being no other contributors whose work is included under MIT only).

## AI-assisted development

Much of the code and content was produced with an AI coding assistant, directed and reviewed by the creator. Whether, and how far, copyright protects AI-assisted work varies by country and is unsettled. **For review:** the extent of protectable authorship, and whether the commercial model should rely more on contract terms, the official hosted service and the brand than on copyright alone.

## Contributions

No outside contributions have been accepted so far. **For review:** before accepting any, decide on a contributor licence agreement or copyright assignment, otherwise contributors keep copyright in their changes.

## Third-party material (not owned)

Listed with versions and licences in [THIRD-PARTY-NOTICES.md](../THIRD-PARTY-NOTICES.md). In summary:

- **Island model** (`public/models/*.glb`): a derivative of "Viking Island - Minecraft" by cubical.xyz under **CC-BY-4.0**. The derivative must stay available under CC-BY-4.0 with attribution, and no extra restrictions may be placed on it. The original attribution in `public/models/CREDITS.txt` is kept unchanged.
- **Minecraft textures:** the original model uses a Minecraft-style texture atlas, which may contain Mojang material. It is **not shipped**: the models were baked to flat colours. **For review:** whether the model's Minecraft-inspired geometry or the word "Minecraft" in the credited title raises any brand issue.
- **Libraries:** React, react-dom, scheduler, three (with GLTFLoader, OrbitControls and the meshopt decoder) and sql.js under MIT; SQLite in the public domain.

## Name and marks

- "CurioTrail" is a working name. **No trademark search, registration or domain check has been done.** The README says so.
- "SG" is a creator mark used in the interface. It is not registered.
- **For review:** a clearance search for "CurioTrail" in the relevant classes and countries before any commercial launch.

## What technical measures can and can't do

The game runs in the browser, so its JavaScript, data files and models are downloaded by every player and can be read with ordinary browser tools. Minification and the visible SG · CurioTrail mark are deterrents and evidence of origin, not protection. Real protection comes from the licence terms, keeping the source repository private, and the brand. CurioTrail deliberately has no tracking, fingerprinting, DRM or anti-inspection code. See [SECURITY-RECOMMENDATIONS.md](SECURITY-RECOMMENDATIONS.md).
