// Rune-word: a Wordle-style puzzle where the hidden word is an Excel function.
// Scoring follows Wordle's rules, including repeated letters: a letter is
// marked "near" only as many times as it still occurs unmatched in the word.

import type { Tile } from '../types';
import { FUNCTION_NAMES } from './function-names';

export function normaliseGuess(guess: string): string {
  return guess.trim().toUpperCase().replace(/[^A-Z]/g, '');
}

export function scoreGuess(guess: string, word: string): Tile[] {
  const g = guess.toUpperCase();
  const w = word.toUpperCase();
  const tiles: Tile[] = Array(g.length).fill('miss');
  const remaining: Record<string, number> = {};
  for (let i = 0; i < w.length; i += 1) {
    if (g[i] === w[i]) tiles[i] = 'hit';
    else remaining[w[i]] = (remaining[w[i]] || 0) + 1;
  }
  for (let i = 0; i < g.length; i += 1) {
    if (tiles[i] === 'hit') continue;
    if (remaining[g[i]]) {
      tiles[i] = 'near';
      remaining[g[i]] -= 1;
    }
  }
  return tiles;
}

/** Why a guess cannot be played (not counted as an attempt), or null when it is fine. */
export function guessProblem(guess: string, word: string, previous: string[]): string | null {
  const g = normaliseGuess(guess);
  if (!g) return 'Type a function name first.';
  if (g.length !== word.length) return `The hidden function has ${word.length} letters; “${g}” has ${g.length}.`;
  if (!FUNCTION_NAMES.has(g)) return `“${g}” isn’t an Excel function name. Guesses must be real functions.`;
  if (previous.includes(g)) return `You already tried ${g}.`;
  return null;
}

/** Letters known to be absent / present / placed, for the on-screen keyboard. */
export function letterStates(guesses: string[], word: string): Record<string, Tile> {
  const rank: Record<Tile, number> = { miss: 0, near: 1, hit: 2 };
  const states: Record<string, Tile> = {};
  for (const guess of guesses) {
    scoreGuess(guess, word).forEach((tile, i) => {
      const letter = guess[i];
      if (!states[letter] || rank[tile] > rank[states[letter]]) states[letter] = tile;
    });
  }
  return states;
}
