// Verification of persistence for the Merchant's Ledger: refreshes during an
// evidence step, spent picks, replays, migration, and runs or records written
// under earlier scoring rules on this branch. Saves are untrusted input.
import { describe, expect, test } from 'vitest';
import * as engine from '../src/engine/game-engine';
import * as store from '../src/engine/progress-store';
import * as progression from '../src/engine/progression';
import type { Run, SpotScene } from '../src/engine/types';
import { loadAllQuests, loadWorld, memoryStorage } from './helpers';

const quests = loadAllQuests();
const q = quests.get('market-ledger')!;
const hall = loadWorld().destinations.find((d) => d.id === 'great-hall')!;

function reach(id: string, seed = 5): Run {
  let r = engine.createRun(q, seed);
  while (engine.currentScene(q, r).id !== id) {
    const s = engine.currentScene(q, r);
    if (s.type === 'wheel') r = engine.spinWheel(q, r);
    if (engine.isChallenge(s)) r = engine.submitAnswer(q, r, engine.correctAnswer(s, r)!).run;
    r = engine.advance(q, r);
  }
  return r;
}
/** Save the run through the real store and load it back, as a page refresh does. */
function refresh(run: Run): Run {
  const storage = memoryStorage();
  store.createProgressStore(storage).save(store.withRun(store.defaultProgress(), run, engine.computeXp(q, run)));
  return engine.restoreRun(q, store.createProgressStore(storage).load().quests['market-ledger'].run);
}

describe('refresh during an evidence step', () => {
  test('the step, its data variant, spent picks and attempts all survive; the next miss is judged against the same budget', () => {
    let run = reach('audit-verdict');
    const s = engine.resolveScene(engine.currentScene(q, run), run) as SpotScene;
    const wrong = [2, 3, 4, 5].find((r) => r !== Number(s.answer[0].slice(1)))!;
    run = engine.submitAnswer(q, run, { cell: `A${wrong}`, working: '=B2-C2' }).run;
    const back = refresh(run);
    expect(engine.currentScene(q, back).id).toBe('audit-verdict');
    expect((engine.resolveScene(engine.currentScene(q, back), back) as SpotScene).answer).toEqual(s.answer); // same seed, same variant
    expect(engine.picksMade(back, 'audit-verdict')).toEqual([`A${wrong}`]);
    expect(engine.resultFor(back, 'audit-verdict').attempts).toBe(1);
    const other = [2, 3, 4, 5].find((r) => r !== wrong && r !== Number(s.answer[0].slice(1)))!;
    expect(engine.submitAnswer(q, back, { cell: `A${other}`, working: '=B2-C2' }).outcome.locked).toBe(true);
  });
  test('a step locked by the budget stays locked (solved, revealed, no credit) after a refresh', () => {
    let run = reach('find-cell');
    for (const c of ['C3', 'A2', 'B5']) run = engine.submitAnswer(q, run, { cell: c }).run;
    const back = refresh(run);
    expect(engine.resultFor(back, 'find-cell')).toEqual({ attempts: 3, solved: true, revealed: true });
    expect(engine.submitAnswer(q, back, { cell: 'B3' }).outcome.valid).toBe(false);
  });
  test('a refresh after a wrong working formula keeps the attempt but no pick', () => {
    let run = reach('audit-discrepancy');
    run = engine.submitAnswer(q, run, { cell: 'D2', working: '=B2' }).run;
    const back = refresh(run);
    expect(engine.resultFor(back, 'audit-discrepancy').attempts).toBe(1);
    expect(engine.picksMade(back, 'audit-discrepancy')).toEqual([]);
  });
  test('tampered picks cannot widen the budget, and extra stored picks make the next miss lock at once', () => {
    const run = reach('audit-verdict');
    const s = engine.resolveScene(engine.currentScene(q, run), run) as SpotScene;
    const others = [2, 3, 4, 5].filter((r) => r !== Number(s.answer[0].slice(1)));
    const tampered = engine.restoreRun(q, { ...run, guesses: { 'audit-verdict': ['A9', 'A8', 'A7', 'A6', 'zz'] } });
    expect(engine.picksMade(tampered, 'audit-verdict').length).toBeLessThanOrEqual(3);
    expect(engine.submitAnswer(q, tampered, { cell: `A${others[0]}`, working: '=B2-C2' }).outcome.locked).toBe(true);
    // Removing picks from a save is possible (client-side data): it can only restore the normal budget.
    const cleared = engine.restoreRun(q, { ...run, guesses: {} });
    expect(engine.picksMade(cleared, 'audit-verdict')).toEqual([]);
  });
});

describe('replay', () => {
  test('a replay starts a fresh run: new seed, no picks, no results; the stored best result is untouched', () => {
    let run = reach('find-cell');
    run = engine.submitAnswer(q, run, { cell: 'C3' }).run;
    let p = store.withRun(store.defaultProgress(), run, 0);
    p = store.withReplay(p, 'market-ledger');
    expect(store.questRecord(p, 'market-ledger').run).toBeNull();
    const fresh = engine.createRun(q, 99);
    expect(engine.picksMade(fresh, 'find-cell')).toEqual([]);
    expect(fresh.results).toEqual({});
  });
});

describe('runs and records written under earlier rules', () => {
  test('a completed run from before working columns were required is restored and rescored under the current rules', () => {
    // The previous build accepted a verdict pick without working: its saved result is just {attempts, solved}.
    const old = { ...reach('ending'), completed: true };
    const back = engine.restoreRun(q, JSON.parse(JSON.stringify(old)));
    expect(engine.isLegacyRun(q, back)).toBe(false);
    expect(engine.computeMedal(q, back)).toBe('gold');
  });
  test('stored mastery and medals never go down: a record from an earlier rule set keeps them, even if a rescore would differ', () => {
    // Under the earlier equal weighting a revealed rune step scored 80%; it now scores 89%. Either way the record keeps its best.
    let p = store.withCompletion(store.defaultProgress(), { ...engine.createRun(q), completed: true }, 300, 3, 'ledger-keeper', { mastered: true, mastery: 0.8, medal: 'gold' });
    p = store.withCompletion(p, { ...engine.createRun(q), completed: true }, 100, 1, undefined, { mastered: false, mastery: 0.3, medal: 'none' });
    expect(store.questRecord(p, 'market-ledger')).toMatchObject({ mastered: true, bestMedal: 'gold', bestMastery: 0.8 });
    expect(progression.isDestinationUnlocked(hall, { ...p, quests: { ...p.quests, 'missing-signal': { ...store.emptyRecord(), completed: true, mastered: true } } })).toBe(true);
  });
  test('a v3 save still migrates: completion kept, counted as mastered, no medal claimed', () => {
    const v3 = { version: 3, player: { name: 'A', emblem: 'owl' }, quests: { 'missing-signal': { run: null, runXp: 0, lastRun: null, lastXp: 60, bestXp: 60, bestStars: 3, completed: true, completions: 1 }, 'market-ledger': { run: null, runXp: 0, lastRun: null, lastXp: 85, bestXp: 85, bestStars: 2, completed: true, completions: 1 } }, achievements: [], lessons: [], settings: {} };
    const p = store.createProgressStore(memoryStorage({ [store.STORAGE_KEY]: JSON.stringify(v3) })).load();
    expect(store.questRecord(p, 'market-ledger')).toMatchObject({ completed: true, mastered: true, bestMedal: 'none', bestStars: 2 });
    expect(progression.isDestinationUnlocked(hall, p)).toBe(true);
  });
});
