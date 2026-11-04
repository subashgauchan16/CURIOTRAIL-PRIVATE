// Opt-in island variants. The default island stays whatever world.json says (island B); `?island=<name>` swaps in
// data/islands/<name>.json, which may only change the island config and where things stand. Quests, unlock rules,
// destinations' ids, NPC ids and dialogue are never changed by a variant.

import type { IslandOverlay, World } from '../engine/types';

/** The variant name from the page URL, or null. Only simple names are accepted (no paths). */
export function islandVariant(search: string): string | null {
  const name = new URLSearchParams(search).get('island');
  return name && /^[a-z0-9-]{1,32}$/.test(name) ? name : null;
}

/** World with the overlay's island config, destination positions and landmark texts applied (pure; input untouched). */
export function applyIslandOverlay(world: World, overlay: IslandOverlay): World {
  if (overlay.schemaVersion !== 1 || !overlay.island) throw new Error('Island variant: unsupported format.');
  const known = new Set(world.destinations.map((d) => d.id));
  for (const id of Object.keys(overlay.positions ?? {})) if (!known.has(id)) throw new Error(`Island variant positions an unknown destination "${id}".`);
  return {
    ...world,
    island: overlay.island,
    destinations: world.destinations.map((d) => ({
      ...d,
      position: overlay.positions?.[d.id] ?? d.position,
      landmark: overlay.landmarks?.[d.id] ?? d.landmark,
    })),
  };
}
