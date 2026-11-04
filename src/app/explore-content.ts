// Content for free exploration: who and what is on the island (public/data/explore.json)
// and the island's walk grid. Loaded once and shared by the 3D stage and the HUD.

import { fromBlender, type Interactable, type NavData } from '../world/explore';
import type { Destination, IslandConfig } from '../engine/types';

export interface ExploreNpc { id: string; name: string; role: string; model: string; at: [number, number]; rot: number; lines: string[] }
export interface ExploreObject { id: string; name: string; at: [number, number]; text: string }
export interface ExploreContent { player: { model: string }; npcs: ExploreNpc[]; objects: ExploreObject[] }

let cache: { file: string; promise: Promise<{ content: ExploreContent; nav: NavData }> } | null = null;

/** explore.json content with an island's own NPC/object positions applied (ids, names and dialogue unchanged). */
export function placeContent(content: ExploreContent, placements?: IslandConfig['placements']): ExploreContent {
  if (!placements) return content;
  return {
    ...content,
    npcs: content.npcs.map((n) => {
      const p = placements.npcs?.[n.id];
      return p ? { ...n, at: p.at, rot: p.rot ?? n.rot } : n;
    }),
    objects: content.objects.map((o) => ({ ...o, at: placements.objects?.[o.id] ?? o.at })),
  };
}

export function loadExplore(navFile: string, placements?: IslandConfig['placements']) {
  if (!cache || cache.file !== navFile) {
    const json = (url: string) => fetch(url).then((r) => {
      if (!r.ok) throw new Error(`${url}: ${r.status}`);
      return r.json();
    });
    const promise = Promise.all([json('./data/explore.json'), json(`./data/${navFile}`)])
      .then(([content, nav]) => ({ content: placeContent(content as ExploreContent, placements), nav: nav as NavData }));
    promise.catch(() => { cache = null; });     // allow a retry after a failed load
    cache = { file: navFile, promise };
  }
  return cache.promise;
}

/** Everything the player can act on, in Three.js coordinates. */
export function interactables(content: ExploreContent, destinations: Pick<Destination, 'id' | 'name' | 'position'>[]): Interactable[] {
  const at = (p: [number, number]) => { const t = fromBlender(p[0], p[1]); return { x: t.x, z: t.z }; };
  return [
    ...content.npcs.map((n) => ({ id: n.id, kind: 'npc' as const, name: n.name, ...at(n.at), reach: 2.6 })),
    ...content.objects.map((o) => ({ id: o.id, kind: 'object' as const, name: o.name, ...at(o.at), reach: 2.2 })),
    ...destinations.map((d) => ({ id: d.id, kind: 'destination' as const, name: d.name, x: d.position[0], z: d.position[1], reach: 3 })),
  ];
}
