// Small deterministic random numbers. Every random choice in a run (data
// variants, wheel spins) comes from the run's seed, so a run can be replayed
// exactly and tests can pin results.

/** Mulberry32: a fast 32-bit PRNG with good distribution for game use. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string, used to derive independent streams per step. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A value in [0, 1) that depends only on the seed and a label. */
export function draw(seed: number, label: string): number {
  return mulberry32((seed ^ hashString(label)) >>> 0)();
}

/** Pick an index with probability proportional to its weight. */
export function weightedIndex(weights: number[], r: number): number {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return Math.min(weights.length - 1, Math.floor(r * weights.length));
  let x = r * total;
  for (let i = 0; i < weights.length; i += 1) {
    x -= Math.max(0, weights[i]);
    if (x < 0) return i;
  }
  return weights.length - 1;
}

export function newSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff) + 1;
}
