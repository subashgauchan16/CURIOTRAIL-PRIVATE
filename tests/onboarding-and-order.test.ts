// The suggested quest order: a recommendation only. Unlock rules are unchanged,
// so nobody loses access.
import { describe, expect, test } from 'vitest';
import * as store from '../src/engine/progress-store';
import * as progression from '../src/engine/progression';
import { validateWorld } from '../src/engine/quest-validation';
import type { Run } from '../src/engine/types';
import { loadAllQuests, loadWorld, memoryStorage } from './helpers';

const quests = loadAllQuests();
const world = loadWorld();
const dest = (id: string) => world.destinations.find((d) => d.id === id)!;
const load = (data: unknown) => store.createProgressStore(memoryStorage({ [store.STORAGE_KEY]: JSON.stringify(data) })).load();
/** Record a quest as finished (and passed) the way the quest screen does. */
const finish = (p: store.Progress, id: string, mastered = true) =>
  store.withCompletion(p, { questId: id, sceneIndex: 0, sceneId: 'ending', inspected: [], results: {}, completed: true } as Run, 50, 2, undefined, { mastered });

describe('opening sequence: suggested order only, unlock rules unchanged', () => {
  test('the world file is valid and its recommended order lists every quest once', () => {
    expect(validateWorld(world, [...quests.keys()])).toEqual([]);
    expect([...world.recommendedOrder!].sort()).toEqual([...quests.keys()].sort());
    expect(validateWorld({ ...world, recommendedOrder: ['nope', 'nope'] }, [...quests.keys()]).join('\n')).toMatch(/unknown quest "nope"[\s\S]*twice/);
  });
  test('unlock rules are exactly as before (no new hard dependencies)', () => {
    expect(Object.fromEntries(world.destinations.map((d) => [d.id, d.unlockedBy]))).toEqual({
      'signal-woods': [], 'trading-market': ['missing-signal'], 'viking-workshop': ['missing-signal'], 'great-hall': ['market-ledger'], 'web-frontier': 'planned',
    });
    expect(quests.get('the-ledger')!.requires).toBeUndefined();
    expect(quests.get('broken-tally')!.requires).toBeUndefined();
    expect(quests.get('star-chart')!.requires).toEqual(['the-ledger']);
  });
  test('the map lists the Trading Market (Excel) before the Viking Workshop (Python)', () => {
    const ids = world.destinations.map((d) => d.id);
    expect(ids.indexOf('trading-market')).toBeLessThan(ids.indexOf('viking-workshop'));
    expect(ids[0]).toBe('signal-woods'); // the opening quest's destination stays first
  });
  test('suggested next follows foundations/AI → Excel → SQL → Python → analytics and modelling', () => {
    let p = store.withPlayer(store.defaultProgress(), 'A', 'fox');
    const seq: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const next = progression.recommendedNext(world, quests, p);
      if (!next) break;
      seq.push(next.id);
      p = finish(p, next.id);
    }
    expect(seq).toEqual(['missing-signal', 'market-ledger', 'the-ledger', 'broken-tally', 'great-hall-dashboard', 'star-chart']);
    expect(progression.recommendedNext(world, quests, p)).toBeNull();
  });
  test('after The Missing Signal the suggestion is Excel, not SQL; after the Market it is SQL', () => {
    const p = finish(store.withPlayer(store.defaultProgress(), 'A', 'fox'), 'missing-signal');
    expect(progression.recommendedNext(world, quests, p, 'missing-signal')?.id).toBe('market-ledger');
    expect(progression.recommendedNext(world, quests, finish(p, 'market-ledger'), 'market-ledger')?.id).toBe('the-ledger');
  });
  test('a failed audit does not suggest locked quests', () => {
    const p = finish(finish(store.withPlayer(store.defaultProgress(), 'A', 'fox'), 'missing-signal'), 'market-ledger', false);
    const next = progression.recommendedNext(world, quests, p, 'market-ledger');
    expect(next?.id).toBe('the-ledger'); // Great Hall quests stay locked until the audit is passed
    expect(progression.destinationStatus(dest('great-hall'), quests, p)).toBe('locked');
  });
});

describe('existing players keep everything', () => {
  test('a player who opened SQL or Python before Excel keeps access, and in-progress runs are suggested', () => {
    let p = finish(store.withPlayer(store.defaultProgress(), 'B', 'owl'), 'missing-signal');
    p = store.withRun(p, { questId: 'broken-tally', sceneIndex: 2, sceneId: 'x', inspected: [], results: {}, completed: false } as Run, 10);
    p = finish(p, 'the-ledger');
    expect(progression.questStatus(quests.get('broken-tally')!, dest('viking-workshop'), p)).toBe('in-progress');
    expect(progression.questStatus(quests.get('the-ledger')!, dest('signal-woods'), p)).toBe('completed');
    expect(progression.questStatus(quests.get('market-ledger')!, dest('trading-market'), p)).toBe('available');
  });
  test('a v3 player who finished the old Market keeps the Great Hall', () => {
    const p = load({ version: 3, player: { name: 'Old', emblem: 'owl' }, achievements: [], lessons: [], settings: {},
      quests: { 'missing-signal': { run: null, runXp: 0, lastRun: null, lastXp: 60, bestXp: 60, bestStars: 3, completed: true, completions: 1 }, 'market-ledger': { run: null, runXp: 0, lastRun: null, lastXp: 85, bestXp: 85, bestStars: 2, completed: true, completions: 1 } } });
    expect(progression.destinationStatus(dest('great-hall'), quests, p)).toBe('available');
    expect(progression.recommendedNext(world, quests, p)?.id).toBe('the-ledger');
  });
});
