// The profile's field notes: event log in the save, and every figure computed
// from it. Expected values were counted by hand from the script below.
import { describe, expect, test } from 'vitest';
import * as store from '../src/engine/progress-store';
import * as A from '../src/engine/learning-analytics';
import * as engine from '../src/engine/game-engine';
import type { LearningEvent } from '../src/engine/progress-store';
import { loadAllQuests, loadQuest, loadWorld } from './helpers';

const quests = loadAllQuests();
const world = loadWorld();
const at = (day: string, hh: number, mm = 0) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d, hh, mm).getTime(); };
const NOW = at('2026-10-28', 20);

let clock = 0;
function ev(day: string, hh: number, k: LearningEvent['k'], q: string, s?: string, extra: Partial<LearningEvent> = {}): LearningEvent {
  clock += 1;
  return { t: at(day, hh, clock % 60), k, q, ...(s ? { s } : {}), ...extra };
}

// A learner who plays, replays, practises, sees hints and reveals an answer.
const EVENTS: LearningEvent[] = [
  ev('2026-10-06', 18, 'start', 'the-ledger', 'filter-north', { r: 1 }),
  ev('2026-10-06', 18, 'answer', 'the-ledger', 'filter-north', { r: 1, ok: false }),
  ev('2026-10-06', 18, 'hint', 'the-ledger', 'filter-north', { r: 1 }),
  ev('2026-10-06', 18, 'answer', 'the-ledger', 'filter-north', { r: 1, ok: true }),
  ev('2026-10-06', 18, 'start', 'the-ledger', 'group-products', { r: 1 }),
  ev('2026-10-06', 18, 'answer', 'the-ledger', 'group-products', { r: 1, ok: false }),
  ev('2026-10-06', 18, 'hint', 'the-ledger', 'group-products', { r: 1 }),
  ev('2026-10-06', 18, 'answer', 'the-ledger', 'group-products', { r: 1, ok: false }),
  ev('2026-10-06', 18, 'hint', 'the-ledger', 'group-products', { r: 1 }),
  ev('2026-10-06', 18, 'answer', 'the-ledger', 'group-products', { r: 1, ok: true }),
  ev('2026-10-06', 18, 'start', 'the-ledger', 'top-product', { r: 1 }),
  ev('2026-10-06', 18, 'answer', 'the-ledger', 'top-product', { r: 1, ok: true }),
  ev('2026-10-06', 19, 'finish', 'the-ledger', undefined, { r: 1, score: 40 }),
  // Replay: a new run, so its first answer is an initial attempt again.
  ev('2026-10-20', 18, 'start', 'the-ledger', 'filter-north', { r: 2 }),
  ev('2026-10-20', 18, 'answer', 'the-ledger', 'filter-north', { r: 2, ok: true }),
  ev('2026-10-20', 19, 'finish', 'the-ledger', undefined, { r: 2, score: 80 }),
  // Practice on a later day: a concept revisit, not an attempt.
  ev('2026-10-24', 18, 'practice', 'the-ledger', 'group-products', { ok: true }),
  // Broken Tally: an answer revealed, and one left unfinished.
  ev('2026-10-25', 18, 'lesson', 'broken-tally', 'lesson-errors-types'),
  ev('2026-10-25', 18, 'start', 'broken-tally', 'average', { r: 3 }),
  ev('2026-10-25', 18, 'answer', 'broken-tally', 'average', { r: 3, ok: false }),
  ev('2026-10-25', 18, 'hint', 'broken-tally', 'average', { r: 3 }),
  ev('2026-10-25', 18, 'reveal', 'broken-tally', 'average', { r: 3 }),
  ev('2026-10-25', 19, 'start', 'broken-tally', 'read-error', { r: 3 }),
  ev('2026-10-25', 19, 'answer', 'broken-tally', 'read-error', { r: 3, ok: false }),
];
const view = (f: Partial<A.Filters>) => A.computeView(EVENTS, quests, f, NOW);

describe('learning history in the save (schema v5)', () => {
  test('v4 saves migrate with an empty history that is recording', () => {
    const p = store.sanitizeProgress({ version: 4, player: null, quests: {}, achievements: [], lessons: [], settings: {}, concepts: {} });
    expect(p.version).toBe(5);
    expect(p.events).toEqual([]);
    expect(p.recordEvents).toBe(true);
  });

  test('untrusted events are validated, sorted and capped', () => {
    const now = Date.now();
    const bad = [
      { t: now, k: 'answer', q: 'the-ledger', s: 'filter-north', ok: true },
      { t: now - 5, k: 'explode', q: 'the-ledger', s: 'x' },
      { t: now, k: 'answer', q: '<script>', s: 'x' },
      { t: 12, k: 'answer', q: 'the-ledger', s: 'x' },
      { t: now + 10 * 86_400_000, k: 'answer', q: 'the-ledger', s: 'x' },
      { t: now, k: 'finish', q: 'the-ledger', score: 140 },
      { t: now, k: 'answer', q: 'the-ledger' },
      { t: now - 10, k: 'finish', q: 'the-ledger', score: 60, ok: 'yes' },
    ];
    const clean = store.sanitizeEvents(bad, now);
    expect(clean).toEqual([{ t: now - 10, k: 'finish', q: 'the-ledger', score: 60 }, { t: now, k: 'answer', q: 'the-ledger', s: 'filter-north', ok: true }]);
    const many = Array.from({ length: store.MAX_EVENTS + 50 }, (_, i) => ({ t: now - 100_000 + i, k: 'answer', q: 'the-ledger', s: 'filter-north', ok: false }));
    const capped = store.sanitizeEvents(many, now);
    expect(capped).toHaveLength(store.MAX_EVENTS);
    expect(capped[0].t).toBe(now - 100_000 + 50); // oldest dropped first
  });

  test('pausing stops new events, keeps old ones; deleting clears only the history', () => {
    let p = store.withEvent(store.defaultProgress(), { k: 'answer', q: 'the-ledger', s: 'filter-north', ok: true });
    expect(p.events).toHaveLength(1);
    p = store.withRecordEvents(p, false);
    expect(store.withEvent(p, { k: 'hint', q: 'the-ledger', s: 'filter-north' })).toBe(p);
    p = store.withSettings(p, { textSize: 'large' });
    p = store.withEventsCleared(p);
    expect(p.events).toEqual([]);
    expect(p.settings.textSize).toBe('large');
    expect(p.recordEvents).toBe(false);
  });

  test('the history and its switch survive a save and load', () => {
    const storage = new Map<string, string>();
    const s = store.createProgressStore({ getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => void storage.set(k, v), removeItem: (k) => void storage.delete(k) });
    const p = store.withRecordEvents(store.withEvent(store.defaultProgress(), { k: 'lesson', q: 'the-ledger', s: 'lesson-where' }), false);
    s.save(p);
    const back = s.load();
    expect(back.events).toHaveLength(1);
    expect(back.recordEvents).toBe(false);
  });
});

describe('field notes figures', () => {
  test('all time: attempts per run, retries exclude initial attempts', () => {
    const k = view({ period: 'all' }).kpis;
    expect([k.attempts, k.initial, k.retries, k.hints, k.completed, k.active]).toEqual([9, 6, 3, 4, 3, 5]);
    expect(k.retries).toBe(k.attempts - k.initial);
  });

  test('a replay starts a new run, so its first answer is initial', () => {
    const fn = view({ period: 'all' }).steps.find((r) => r.id === 'filter-north')!;
    expect([fn.initial, fn.retries, fn.attempts]).toEqual([2, 1, 3]);
  });

  test('practice rounds are not attempts', () => {
    const g = view({ period: 'all' }).steps.find((r) => r.id === 'group-products')!;
    expect(g.attempts).toBe(3);
  });

  test('retry-to-success and recovery have explicit denominators', () => {
    const v = view({ period: 'all' });
    expect([v.kpis.retryToSuccessNum, v.kpis.retryToSuccessDen, v.kpis.retryToSuccess]).toEqual([2, 2, 100]);
    expect(v.recovery.counts).toEqual({ 'solved-next': 0, 'hint-solved': 2, 'another-try': 1, revealed: 1, 'no-further': 1 });
    expect(v.recovery.denominator).toBe(5);
    expect(Object.values(v.recovery.counts).reduce((a, b) => a + b, 0)).toBe(5);
    expect(v.recovery.rate).toBe(40);
  });

  test('revealed and unfinished steps have their own status', () => {
    const st = Object.fromEntries(view({ period: 'all' }).steps.map((r) => [r.id, r.status]));
    expect(st).toMatchObject({ average: 'revealed', 'read-error': 'incomplete', 'top-product': 'completed' });
  });

  test('mastery change and concept revisits', () => {
    const v = view({ period: 'all' });
    expect(v.mastery.series.map((s) => [s.quest, s.change])).toEqual([['the-ledger', 40]]);
    expect(v.kpis.masteryChange).toBe(40);
    expect(v.kpis.conceptsRevisited).toBe(1); // group-aggregate; the first lesson read is not a revisit
    expect(v.revisits[0].skill).toBe('group-aggregate');
  });

  test('periods change the figures', () => {
    const week = view({ period: '7d' }).kpis;
    expect([week.attempts, week.retries, week.retryToSuccess, week.conceptsRevisited, week.masteryChange]).toEqual([2, 0, null, 1, null]);
    const fortnight = view({ period: '14d' });
    expect(fortnight.kpis.attempts).toBe(3);
    expect(fortnight.mastery.series[0].points).toHaveLength(1);
  });

  test('quest filter, and chart rows always add up to the KPIs', () => {
    for (const period of ['7d', '14d', '28d', 'all'] as const) {
      for (const quest of ['all', ...quests.keys()]) {
        const v = view({ period, quest });
        expect(v.steps.reduce((s, r) => s + r.initial + r.retries, 0)).toBe(v.kpis.attempts);
        expect(v.steps.reduce((s, r) => s + r.hints, 0)).toBe(v.kpis.hints);
        if (quest !== 'all') expect(v.steps.every((r) => r.quest === quest)).toBe(true);
      }
    }
  });

  test('no history: empty views, no insights, no division by zero', () => {
    const v = A.computeView([], quests, { period: 'all' }, NOW);
    expect(v.steps).toEqual([]);
    expect(v.insights).toEqual([]);
    expect(v.kpis.retryToSuccess).toBeNull();
    expect(v.recovery.rate).toBeNull();
  });

  test('insights only appear when supported', () => {
    const ids = view({ period: 'all' }).insights.map((i) => i.id);
    expect(ids).toEqual(['after-retry', 'hints', 'revisit', 'mastery-the-ledger', 'waiting']);
    expect(view({ period: '7d' }).insights.map((i) => i.id)).not.toContain('after-retry');
  });
});

describe('mastery score and overview', () => {
  test('runScore: share of steps solved first time without the answer shown', () => {
    const q = loadQuest('the-ledger');
    const run = engine.createRun(q, 1);
    const steps = q.scenes.filter(engine.isChallenge);
    const results = Object.fromEntries(steps.map((s, i) => [s.id, { attempts: i === 0 ? 2 : 1, solved: true, revealed: false }]));
    expect(A.runScore(q, { ...run, results })).toBe(Math.round((100 * (steps.length - 1)) / steps.length));
  });

  test('overview uses the real save and unlock rules', () => {
    const p = { ...store.defaultProgress(), events: EVENTS };
    const o = A.overview(p, quests, world);
    expect(o.stops.find((s) => s.id === 'missing-signal')!.status).toBe('available');
    expect(o.stops.find((s) => s.id === 'great-hall-dashboard')!.status).toBe('locked');
    expect(o.challengesTotal).toBe([...quests.values()].reduce((s, q) => s + q.scenes.filter(engine.isChallenge).length, 0));
    expect(o.latestMastery).toMatchObject({ quest: 'The Ledger in the Woods', score: 80, previous: 40 });
  });
});
