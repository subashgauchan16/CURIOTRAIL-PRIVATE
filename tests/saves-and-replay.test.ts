// Existing players, replays and unlock rules after the Merchant's Ledger
// became a game with a boss. Saves are untrusted input; nobody may lose an
// unlock they already earned, and nobody may gain one they did not.
import { describe, expect, test } from 'vitest';
import * as engine from '../src/engine/game-engine';
import * as store from '../src/engine/progress-store';
import * as progression from '../src/engine/progression';
import { conceptLevel, recordConcepts } from '../src/engine/games/mastery';
import type { ChoiceScene, Run, SpotScene } from '../src/engine/types';
import { loadAllQuests, loadWorld, memoryStorage } from './helpers';

const quests = loadAllQuests();
const world = loadWorld();
const q = quests.get('market-ledger')!;
const dest = (id: string) => world.destinations.find((d) => d.id === id)!;
const load = (data: unknown) => store.createProgressStore(memoryStorage({ [store.STORAGE_KEY]: JSON.stringify(data) })).load();

// The last run of the PREVIOUS Market Ledger, exactly as v3 saved it.
const oldFinishedRun = {
  questId: 'market-ledger', sceneIndex: 9, sceneId: 'ending', inspected: [], completed: true,
  results: { 'find-cell': { attempts: 1, solved: true, revealed: false }, 'row-revenue': { attempts: 1, solved: true, revealed: false }, total: { attempts: 2, solved: true, revealed: false }, 'average-price': { attempts: 1, solved: true, revealed: false }, absolute: { attempts: 1, solved: true, revealed: false } },
};
const record = (extra: Record<string, unknown> = {}) => ({ run: oldFinishedRun, runXp: 85, lastRun: oldFinishedRun, lastXp: 85, bestXp: 85, bestStars: 2, completed: true, completions: 1, ...extra });
const v3 = (quests: Record<string, unknown>) => ({ version: 3, player: { name: 'Asha', emblem: 'owl' }, quests, achievements: ['ledger-keeper'], lessons: ['market-ledger/lesson-ranges'], settings: { motion: 'system', textSize: 'normal', graphics: 'auto' } });

function play(seed: number, reveal: string[] = []): Run {
  let r = engine.createRun(q, seed);
  while (!r.completed) {
    const scene = engine.currentScene(q, r);
    if (scene.type === 'wheel') r = engine.spinWheel(q, r);
    if (engine.isChallenge(scene)) {
      if (reveal.includes(scene.id)) {
        while (!engine.resultFor(r, scene.id).solved && engine.resultFor(r, scene.id).attempts < engine.revealAfter(scene)) {
          const bad = scene.type === 'runeword' ? { guess: ['ACCRINT', 'ADDRESS', 'BESSELI', 'BESSELJ', 'BESSELK', 'BESSELY'][engine.resultFor(r, scene.id).attempts] }
            : scene.type === 'workshop' ? { formula: '=1+1' }
            : scene.type === 'repair' ? { diagnosis: scene.diagnoses.find((d) => d.id !== scene.correctDiagnosis)!.id, formula: scene.solution }
            : scene.type === 'spot' ? { cell: (engine.resolveScene(scene, r) as SpotScene).answer[0], working: '=1+1' } // wrong working: a miss that uses no pick
            : (scene as ChoiceScene).options.find((o) => o.id !== (engine.resolveScene(scene, r) as ChoiceScene).correct)!.id;
          r = engine.submitAnswer(q, r, bad as never).run;
        }
        if (!engine.resultFor(r, scene.id).solved) r = engine.revealAnswer(q, r);
      } else r = engine.submitAnswer(q, r, engine.correctAnswer(scene, r)!).run;
    }
    r = engine.advance(q, r);
  }
  return r;
}
const complete = (p: store.Progress, run: Run) => store.withCompletion(p, run, engine.computeXp(q, run), engine.computeStars(q, run), engine.isMastered(q, run) ? q.badge?.id : undefined, {
  mastered: engine.isMastered(q, run), mastery: engine.bossScore(q, run), medal: engine.computeMedal(q, run), silver: engine.computeSilver(q, run),
});

describe('players who finished the previous Market Ledger (v3 saves)', () => {
  const p = load(v3({ 'missing-signal': record({ run: null, lastRun: null }), 'market-ledger': record() }));
  test('keep their completion, XP, stars, badge, lessons and the Great Hall', () => {
    const r = store.questRecord(p, 'market-ledger');
    expect(p.version).toBe(store.SCHEMA_VERSION);
    expect(r).toMatchObject({ completed: true, mastered: true, bestXp: 85, bestStars: 2, bestMedal: 'none', bestMastery: null, bestSilver: 0 });
    expect(p.achievements).toEqual(['ledger-keeper']);
    expect(p.lessons).toEqual(['market-ledger/lesson-ranges']);
    expect(progression.destinationStatus(dest('great-hall'), quests, p)).toBe('available');
    expect(progression.questStatus(quests.get('great-hall-dashboard')!, dest('great-hall'), p)).toBe('available');
  });
  test('their old last run is recognised as legacy (no medal claimed) and restores safely', () => {
    const run = engine.restoreRun(q, p.quests['market-ledger'].lastRun);
    expect(engine.isLegacyRun(q, run)).toBe(true);
    expect(run.seed).toBe(1);
    expect(run.wagers).toEqual({});
    expect(() => engine.skillReport(q, run)).not.toThrow();
  });
  test('replaying and failing the new boss never takes the Great Hall away; passing it adds a medal', () => {
    const failed = complete(store.withReplay(p, 'market-ledger'), play(11, ['audit-revenue', 'audit-tax', 'audit-discrepancy', 'audit-rune', 'audit-verdict']));
    expect(store.questRecord(failed, 'market-ledger')).toMatchObject({ mastered: true, bestMedal: 'none', bestXp: Math.max(85, store.questRecord(failed, 'market-ledger').lastXp) });
    expect(progression.isDestinationUnlocked(dest('great-hall'), failed)).toBe(true);
    const passed = complete(store.withReplay(failed, 'market-ledger'), play(12));
    expect(store.questRecord(passed, 'market-ledger')).toMatchObject({ bestMedal: 'gold', bestMastery: 1, mastered: true });
    expect(store.questRecord(passed, 'market-ledger').completions).toBe(3);
  });
});

describe('a v3 player half-way through the previous Market Ledger', () => {
  test('resumes at the first new step they have not done, keeping earlier results', () => {
    const mid = { ...oldFinishedRun, completed: false, sceneId: 'absolute', sceneIndex: 5, results: { ...oldFinishedRun.results, absolute: { attempts: 1, solved: false, revealed: false } } };
    const p = load(v3({ 'missing-signal': record({ run: null, lastRun: null }), 'market-ledger': { run: mid, runXp: 55, lastRun: null, lastXp: 0, bestXp: 0, bestStars: 0, completed: false, completions: 0 } }));
    const run = engine.restoreRun(q, p.quests['market-ledger'].run);
    expect(engine.currentScene(q, run).id).toBe('rune-max'); // new steps before 'absolute' come first
    expect(engine.resultFor(run, 'total').solved).toBe(true);
    expect(store.questRecord(p, 'market-ledger').mastered).toBe(false);
    expect(progression.isDestinationUnlocked(dest('great-hall'), p)).toBe(false);
  });
});

describe('new players: the boss gates the Great Hall', () => {
  const base = store.withCompletion(store.defaultProgress(), { ...engine.createRun(quests.get('missing-signal')!), completed: true }, 60, 3);
  test('finishing with a failed boss completes the quest but unlocks nothing, and withholds the badge', () => {
    const p = complete(base, play(21, ['audit-revenue', 'audit-tax', 'audit-discrepancy']));
    expect(store.questRecord(p, 'market-ledger')).toMatchObject({ completed: true, mastered: false, bestMedal: 'none' });
    expect(p.achievements).not.toContain('ledger-keeper');
    expect(progression.destinationStatus(dest('great-hall'), quests, p)).toBe('locked');
    expect(progression.questStatus(q, dest('trading-market'), p)).toBe('completed');
    const again = complete(p, play(22));
    expect(progression.newlyUnlocked(world, p, again).map((d) => d.id)).toEqual(['great-hall']);
    expect(again.achievements).toContain('ledger-keeper');
  });
  test('replays keep the best result and never stack XP', () => {
    let p = complete(base, play(31));
    const best = store.totalXp(p);
    p = store.withReplay(p, 'market-ledger');
    p = complete(p, play(32, ['find-cell']));
    expect(store.totalXp(p)).toBe(best);
    expect(store.questRecord(p, 'market-ledger').bestMedal).toBe('gold');
  });
});

describe('tampered saves are cleaned', () => {
  test('mastery without completion, unknown medals and negative silver are rejected', () => {
    const p = load({ ...v3({}), version: 4, concepts: { 'XL.FN.SUM': { attempts: 'x' } }, quests: { 'market-ledger': { ...record(), completed: false, mastered: true, bestMedal: 'platinum', bestMastery: 7, bestSilver: -5 } } });
    expect(store.questRecord(p, 'market-ledger')).toMatchObject({ completed: false, mastered: false, bestMedal: 'none', bestMastery: null, bestSilver: 0 });
    expect(p.concepts['XL.FN.SUM'].attempts).toBe(0);
    expect(progression.isDestinationUnlocked(dest('great-hall'), p)).toBe(false);
  });
  test('a save from a newer release is not trusted', () => {
    expect(load({ version: 99, player: { name: 'X' } }).player).toBeNull();
  });
});

describe('concept mastery needs real, spaced evidence', () => {
  test('a revealed answer, retries and practice on the same day cannot reach "mastered"', () => {
    let m = recordConcepts({}, ['XL.FN.SUM'], { firstTry: true, revealed: true, wrongAttempts: 3, context: 'market-ledger/total', day: 50 });
    expect(conceptLevel(m['XL.FN.SUM'])).toBe('seen');
    for (const ctx of ['market-ledger/total', 'market-ledger/rune-wheel-wages', 'market-ledger/audit-tax']) {
      m = recordConcepts(m, ['XL.FN.SUM'], { firstTry: true, revealed: false, wrongAttempts: 0, context: ctx, day: 50 });
    }
    expect(conceptLevel(m['XL.FN.SUM'])).toBe('demonstrated');
    m = recordConcepts(m, ['XL.FN.SUM'], { firstTry: true, revealed: false, wrongAttempts: 0, context: 'market-ledger/total', day: 53 });
    expect(conceptLevel(m['XL.FN.SUM'])).toBe('mastered');
  });
});

describe('evidence picks through the save store', () => {
  test('a mid-step reload keeps the picks made, so the limit cannot be reset by reloading', () => {
    let run = engine.createRun(q, 3);
    run = engine.advance(q, run); // past the opening dialogue to the first evidence step
    expect(engine.currentScene(q, run).id).toBe('find-cell');
    run = engine.submitAnswer(q, run, { cell: 'C3' }).run;
    run = engine.submitAnswer(q, run, { cell: 'A2' }).run;
    const storage = memoryStorage();
    const s = store.createProgressStore(storage);
    s.save(store.withRun(store.defaultProgress(), run, engine.computeXp(q, run)));
    const reloaded = engine.restoreRun(q, store.createProgressStore(storage).load().quests['market-ledger'].run);
    expect(engine.picksMade(reloaded, 'find-cell')).toEqual(['C3', 'A2']);
    const third = engine.submitAnswer(q, reloaded, { cell: 'B5' });
    expect(third.outcome.locked).toBe(true);
  });
});

describe('a v4 save that finished only the first quest', () => {
  test('is accepted, keeps its player, and opens the Trading Market at the Merchant’s Ledger', () => {
    const p = load({ version: 4, player: { name: 'P1', emblem: 'fox' },
      quests: { 'missing-signal': { run: null, runXp: 0, lastRun: null, lastXp: 60, bestXp: 60, bestStars: 3, completed: true, completions: 1, mastered: true, bestMastery: null, bestMedal: 'none', bestSilver: 0 } },
      achievements: [], lessons: [], settings: { motion: 'system', textSize: 'normal', graphics: 'auto' }, concepts: {} });
    expect(p.player).toEqual({ name: 'P1', emblem: 'fox' });
    expect(progression.isDestinationUnlocked(dest('trading-market'), p)).toBe(true);
    expect(progression.questStatus(q, dest('trading-market'), p)).toBe('available');
  });
});
