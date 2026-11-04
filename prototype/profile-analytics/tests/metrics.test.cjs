// Formula checks for the profile prototype. Run: node --test prototype/profile-analytics/tests/
// Expected values were counted by hand from the attempt scripts in data.js.
const test = require('node:test');
const assert = require('node:assert/strict');
// The repo's package.json sets "type": "module", so these classic browser
// scripts load as ES modules here; both attach themselves to globalThis.
require('../data.js');
require('../metrics.js');
const data = globalThis.CURIO_PROTO;
const M = globalThis.CURIO_METRICS;

const events = data.scenarios.default.events;
const view = (filters) => M.computeView(data, events, filters);

test('periods end on the prototype clock and are inclusive', () => {
  assert.deepEqual(M.periodRange('7d', data.clock, events), { from: '2026-10-22', to: '2026-10-28' });
  assert.deepEqual(M.periodRange('28d', data.clock, events), { from: '2026-10-01', to: '2026-10-28' });
  assert.equal(M.periodRange('all', data.clock, events).from, '2026-09-29');
});

test('last 28 days, all quests: attempts, retries and hints', () => {
  const k = view({ period: '28d', quest: 'all' }).kpis;
  assert.equal(k.totalAttempts, 24);
  assert.equal(k.initialAttempts, 14);
  assert.equal(k.totalRetries, 10);
  assert.equal(k.totalRetries, k.totalAttempts - k.initialAttempts, 'retries exclude initial attempts');
  assert.equal(k.hintsUsed, 5);
  assert.equal(k.challengesCompleted, 13);
  assert.equal(k.challengesActive, 15);
});

test('retry-to-success uses challenges with a retry as the denominator', () => {
  const k = view({ period: '28d', quest: 'all' }).kpis;
  assert.equal(k.retryToSuccessDenominator, 8);
  assert.equal(k.retryToSuccessNumerator, 7);
  assert.equal(k.retryToSuccess, 88); // 7 / 8 = 87.5%, rounded
});

test('recovery outcomes partition the incorrect attempts', () => {
  const r = view({ period: '28d', quest: 'all' }).recovery;
  assert.deepEqual(r.counts, { 'solved-next': 3, 'hint-solved': 4, 'another-try': 3, 'no-further': 1 });
  assert.equal(r.denominator, 11);
  assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), r.denominator);
  assert.equal(r.rate, 64); // 7 / 11
});

test('chart rows add up to the KPI totals', () => {
  for (const period of ['7d', '14d', '28d', 'all']) {
    for (const quest of ['all', ...data.quests.map((q) => q.id)]) {
      const v = view({ period, quest });
      const sum = (f) => v.challenges.reduce((s, r) => s + r[f], 0);
      assert.equal(sum('initial') + sum('retries'), v.kpis.totalAttempts, `${period}/${quest}`);
      assert.equal(sum('hints'), v.kpis.hintsUsed);
      for (const r of v.challenges) assert.ok(r.initial <= 1, 'at most one initial attempt per challenge');
    }
  }
});

test('a period filter never relabels a retry as an initial attempt', () => {
  const all = view({ period: 'all', quest: 'all' });
  const ledger = all.challenges.find((r) => r.key === 'the-ledger/group-products');
  assert.deepEqual([ledger.initial, ledger.retries, ledger.hints], [1, 2, 1]);
  assert.equal(all.kpis.totalAttempts, 35);
  assert.equal(all.kpis.totalRetries, 14);
});

test('changing the period changes the figures', () => {
  const week = view({ period: '7d', quest: 'all' }).kpis;
  assert.equal(week.totalAttempts, 6);
  assert.equal(week.totalRetries, 2);
  assert.equal(week.conceptsRevisited, 2);
  assert.equal(week.masteryChange, null, 'no quest has two checks in the last 7 days');
});

test('quest filter keeps only that quest', () => {
  const v = view({ period: 'all', quest: 'broken-tally' });
  assert.ok(v.challenges.every((r) => r.quest === 'broken-tally'));
  assert.equal(v.kpis.totalAttempts, 9);
  assert.equal(v.mastery.series.length, 1);
  assert.equal(v.mastery.series[0].change, 20);
});

test('concept revisits and mastery change', () => {
  const v = view({ period: '28d', quest: 'all' });
  assert.equal(v.kpis.conceptsRevisited, 4);
  assert.equal(v.kpis.masteryChange, 30); // (+40 the-ledger, +20 broken-tally) / 2
  assert.equal(v.kpis.masteryChangeQuests, 2);
  assert.equal(view({ period: 'all', quest: 'all' }).kpis.masteryChange, 26.7); // (20 + 40 + 20) / 3
});

test('a same-day "revisit" is not counted', () => {
  const extra = [...events, { id: 'x1', type: 'concept_revisited', ts: '2026-10-22T19:00:00', skill: 'read-cells', quest: 'market-ledger', via: 'lesson' }]
    .sort((a, b) => (a.ts < b.ts ? -1 : 1));
  assert.equal(M.computeView(data, extra, { period: '7d', quest: 'all' }).kpis.conceptsRevisited, 2);
});

test('incomplete and started-only challenges', () => {
  const v = view({ period: '7d', quest: 'market-ledger' });
  const status = Object.fromEntries(v.challenges.map((r) => [r.id, r.status]));
  assert.equal(status['average-price'], 'incomplete');
  assert.equal(status['rune-max'], 'started');
  assert.ok(v.insights.some((i) => i.id === 'waiting'));
});

test('zero-retry learner: no division by zero, no unsupported insights', () => {
  const v = M.computeView(data, data.scenarios['no-retries'].events, { period: '28d', quest: 'all' });
  assert.equal(v.kpis.totalRetries, 0);
  assert.equal(v.kpis.retryToSuccess, null);
  assert.equal(v.recovery.denominator, 0);
  assert.equal(v.recovery.rate, null);
  assert.ok(!v.insights.some((i) => i.id === 'after-retry' || i.id === 'hints'));
});

test('empty learner and empty quest views', () => {
  const v = M.computeView(data, [], { period: 'all', quest: 'all' });
  assert.equal(v.challenges.length, 0);
  assert.equal(v.insights.length, 0);
  assert.equal(view({ period: '28d', quest: 'star-chart' }).challenges.length, 0);
});

test('quest states follow the real unlock rules', () => {
  const o = M.overview(data, events);
  const st = Object.fromEntries(o.quests.map((q) => [q.id, q.status]));
  assert.deepEqual(st, { 'missing-signal': 'completed', 'the-ledger': 'completed', 'broken-tally': 'completed',
    'market-ledger': 'in-progress', 'great-hall-dashboard': 'locked', 'star-chart': 'locked' });
  assert.equal(o.challengesCompleted, 20);
  assert.equal(o.challengesTotal, 41);
  assert.equal(o.level.name, 'Trailblazer');
});
