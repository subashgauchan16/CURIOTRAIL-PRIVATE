// Verification of boss scoring, medals and unlock rules for the Merchant's
// Ledger. Part 1 plays each boss step through the engine for every outcome
// class (first time, one extra try, more tries, budget exhausted, revealed).
// Part 2 checks all 4^5 combinations of boss outcomes against the pass mark
// and the medal rules, so no combination can pass or earn a medal by accident.
import { describe, expect, test } from 'vitest';
import * as engine from '../src/engine/game-engine';
import * as store from '../src/engine/progress-store';
import * as progression from '../src/engine/progression';
import type { Answer, ChallengeResult, Run, SpotScene } from '../src/engine/types';
import { recordStep } from '../src/ui/screens/QuestScreen';
import { loadAllQuests, loadWorld } from './helpers';

const quests = loadAllQuests();
const q = quests.get('market-ledger')!;
const hall = loadWorld().destinations.find((d) => d.id === 'great-hall')!;
const BOSS = ['audit-revenue', 'audit-tax', 'audit-discrepancy', 'audit-rune', 'audit-verdict'] as const;

/** A run that reached `id` with everything before it solved first time. */
function reach(id: string, seed = 7): Run {
  let r = engine.createRun(q, seed);
  while (engine.currentScene(q, r).id !== id) {
    const s = engine.currentScene(q, r);
    if (s.type === 'wheel') r = engine.spinWheel(q, r);
    if (engine.isChallenge(s)) r = engine.submitAnswer(q, r, engine.correctAnswer(s, r)!).run;
    r = engine.advance(q, r);
  }
  return r;
}
const credit = (r: Run, id: string) => engine.stepCredit(q.scenes.find((s) => s.id === id)!, engine.resultFor(r, id));
const submit = (r: Run, a: Answer) => engine.submitAnswer(q, r, a).run;
const right = (r: Run) => submit(r, engine.correctAnswer(engine.currentScene(q, r), r)!);

describe('Part 1: what each boss step awards, played through the engine', () => {
  test('I · revenue (workshop): 1 → 0.6 → 0.3 by attempts; revealed 0', () => {
    const base = reach('audit-revenue');
    const bad = { formula: '=B2*C$2' };
    expect(credit(right(base), 'audit-revenue')).toBe(1);
    expect(credit(right(submit(base, bad)), 'audit-revenue')).toBe(0.6);
    expect(credit(right(submit(submit(base, bad), { formula: '=1+1' })), 'audit-revenue')).toBe(0.3);
    let r = base; for (const f of ['=1', '=2', '=3']) r = submit(r, { formula: f });
    expect(credit(engine.revealAnswer(q, r), 'audit-revenue')).toBe(0);
  });
  test('II · tax (repair): a wrong diagnosis with a right fix still costs the first-time credit', () => {
    const base = reach('audit-tax');
    const s = engine.currentScene(q, base);
    if (s.type !== 'repair') throw new Error('expected repair');
    const wrongDx = { diagnosis: s.diagnoses.find((d) => d.id !== s.correctDiagnosis)!.id, formula: s.solution };
    expect(credit(right(base), 'audit-tax')).toBe(1);
    expect(credit(right(submit(base, wrongDx)), 'audit-tax')).toBe(0.6);
  });
  test('III · missing coins (evidence + working): working misses and wrong picks both cost credit; 3 wrong picks lock at 0', () => {
    const base = reach('audit-discrepancy');
    const s = engine.resolveScene(engine.currentScene(q, base), base) as SpotScene;
    const wrongCells = ['D2', 'D3', 'D4', 'D5'].filter((c) => c !== s.answer[0]);
    expect(credit(right(base), 'audit-discrepancy')).toBe(1);
    expect(credit(right(submit(base, { cell: s.answer[0], working: '=B2' })), 'audit-discrepancy')).toBe(0.6);
    expect(credit(right(submit(base, { cell: wrongCells[0], working: '=B2*C2' })), 'audit-discrepancy')).toBe(0.6);
    let r = base; for (const c of wrongCells) r = submit(r, { cell: c, working: '=B2*C2' });
    expect(engine.resultFor(r, 'audit-discrepancy')).toMatchObject({ solved: true, revealed: true });
    expect(credit(r, 'audit-discrepancy')).toBe(0);
  });
  test('IV · rune (recall, weight 0.5): within par 3 counts first time; 4 guesses 0.6; 5–6 guesses 0.3', () => {
    const base = reach('audit-rune');
    const seven = ['ACCRINT', 'ADDRESS', 'BESSELI', 'BESSELJ', 'BESSELK'];
    let r = base; for (const g of seven.slice(0, 2)) r = submit(r, { guess: g });
    expect(credit(right(r), 'audit-rune')).toBe(1); // 3rd guess: within par
    r = base; for (const g of seven.slice(0, 3)) r = submit(r, { guess: g });
    expect(credit(right(r), 'audit-rune')).toBe(0.6);
    r = base; for (const g of seven.slice(0, 4)) r = submit(r, { guess: g });
    expect(credit(right(r), 'audit-rune')).toBe(0.3);
  });
  test('V · verdict (evidence + working, 4 rows): budget is 2, so one wrong row gives 0.6 and a second locks at 0', () => {
    const base = reach('audit-verdict');
    const s = engine.resolveScene(engine.currentScene(q, base), base) as SpotScene;
    const rows = [2, 3, 4, 5].filter((n) => n !== Number(s.answer[0].slice(1)));
    expect(engine.pickLimit(s)).toBe(2);
    const one = submit(base, { cell: `A${rows[0]}`, working: '=B2-C2' });
    expect(credit(right(one), 'audit-verdict')).toBe(0.6);
    const two = submit(one, { cell: `A${rows[1]}`, working: '=B2-C2' });
    expect(engine.resultFor(two, 'audit-verdict')).toMatchObject({ solved: true, revealed: true });
    // 0.3 is reachable only through working-formula misses, never through a third pick.
    const w = submit(submit(base, { cell: s.answer[0], working: '=B2' }), { cell: `A${rows[0]}`, working: '=B2-C2' });
    expect(credit(right(w), 'audit-verdict')).toBe(0.3);
  });
});

// ---- Part 2: all combinations ----

type Outcome = 1 | 0.6 | 0.3 | 0;
const OUTCOMES: Outcome[] = [1, 0.6, 0.3, 0];
const WEIGHT: Record<string, number> = { 'audit-revenue': 1, 'audit-tax': 1, 'audit-discrepancy': 1, 'audit-rune': 0.5, 'audit-verdict': 1 };
/** A result that earns exactly `c` on that step (the rune-word's par is 3 guesses). */
function resultFor(id: string, c: Outcome): ChallengeResult {
  const par = id === 'audit-rune' ? 3 : 1;
  if (c === 0) return { attempts: 3, solved: true, revealed: true };
  return { attempts: par + (c === 1 ? 0 : c === 0.6 ? 1 : 2), solved: true, revealed: false };
}
const perfect = (() => { let r = engine.createRun(q, 11); while (!r.completed) r = engine.advance(q, (() => { const s = engine.currentScene(q, r); if (s.type === 'wheel') r = engine.spinWheel(q, r); return engine.isChallenge(s) ? right(r) : r; })()); return r; })();
function combos(): Outcome[][] {
  const out: Outcome[][] = [];
  const walk = (prefix: Outcome[]) => { if (prefix.length === 5) { out.push(prefix); return; } for (const o of OUTCOMES) walk([...prefix, o]); };
  walk([]);
  return out;
}
const withBoss = (run: Run, c: Outcome[], extra: Record<string, ChallengeResult> = {}): Run =>
  ({ ...run, results: { ...run.results, ...Object.fromEntries(BOSS.map((id, i) => [id, resultFor(id, c[i])])), ...extra } });

describe('Part 2: every boss combination against the pass mark and the medals', () => {
  const all = combos();
  test('there are 1024 combinations and the engine score equals the weighted average for each', () => {
    expect(all.length).toBe(1024);
    for (const c of all) {
      const expected = BOSS.reduce((s, id, i) => s + WEIGHT[id] * c[i], 0) / 4.5;
      expect(engine.bossScore(q, withBoss(perfect, c))).toBeCloseTo(expected, 3);
    }
  });
  test('pass ⇔ weighted score ≥ 70%; no other route to mastery', () => {
    for (const c of all) {
      const run = withBoss(perfect, c);
      const score = BOSS.reduce((s, id, i) => s + WEIGHT[id] * c[i], 0) / 4.5;
      expect(engine.isMastered(q, run)).toBe(score >= 0.7 - 1e-9);
    }
  });
  test('no pass with two full-weight steps at 0, or with every step at 0.6, or with a 0 and any other full-weight step below 1', () => {
    for (const c of all) {
      const run = withBoss(perfect, c);
      const fullZero = [0, 1, 2, 4].filter((i) => c[i] === 0).length;
      if (fullZero >= 2) expect(engine.isMastered(q, run)).toBe(false);
      if (fullZero === 1 && [0, 1, 2, 4].some((i) => c[i] !== 0 && c[i] < 1)) expect(engine.isMastered(q, run)).toBe(false);
    }
    expect(engine.isMastered(q, withBoss(perfect, [0.6, 0.6, 0.6, 0.6, 0.6]))).toBe(false);
  });
  test('the only passes with a revealed (0) step: one full-weight step at 0 and the rest first time (rune may be 1, 0.6 or 0.3)', () => {
    const passes = all.filter((c) => c.includes(0) && engine.isMastered(q, withBoss(perfect, c)));
    for (const c of passes) {
      const zeros = [0, 1, 2, 3, 4].filter((i) => c[i] === 0);
      expect(zeros.length).toBe(1);
      if (zeros[0] === 3) continue; // rune at 0: others may vary (checked by the threshold test)
      expect([0, 1, 2, 4].filter((i) => i !== zeros[0]).every((i) => c[i] === 1)).toBe(true);
    }
    const fullZeroPasses = passes.filter((c) => [0, 1, 2, 4].some((i) => c[i] === 0));
    expect(fullZeroPasses.length).toBe(4 * 3); // 4 steps × rune at 1/0.6/0.3
  });
  test('medals: none below 70%; gold needs boss ≥ 85%, no reveal anywhere and ≥ 80% first time; silver needs ≥ 60% first time', () => {
    for (const c of all) {
      const run = withBoss(perfect, c);
      const ev = engine.masteryEvidence(q, run);
      const medal = engine.computeMedal(q, run);
      if (!ev.mastered) { expect(medal).toBe('none'); continue; }
      if (medal === 'gold') {
        expect(ev.boss!).toBeGreaterThanOrEqual(0.85);
        expect(ev.revealed).toBe(0);
        expect(ev.firstTimeShare).toBeGreaterThanOrEqual(0.8);
      }
      if (c.includes(0)) expect(medal).not.toBe('gold');
      expect(engine.computeStars(q, run)).toBe({ gold: 3, silver: 2, bronze: 1, none: 0 }[medal]);
    }
  });
  test('a locked or revealed practice round outside the boss rules out gold but cannot block the unlock', () => {
    const run = withBoss(perfect, [1, 1, 1, 1, 1], { 'find-cell': { attempts: 3, solved: true, revealed: true } });
    expect(engine.isMastered(q, run)).toBe(true);
    expect(engine.computeMedal(q, run)).toBe('silver');
  });
  test('the Great Hall opens only from a stored, mastered completion; a failed boss never opens it', () => {
    const base = store.withCompletion(store.defaultProgress(), { ...engine.createRun(quests.get('missing-signal')!), completed: true }, 60, 3, undefined, { mastered: true });
    for (const [c, open] of [[[1, 1, 1, 1, 1], true], [[0, 0, 1, 1, 1], false], [[0.6, 0.6, 0.6, 0.6, 0.6], false]] as [Outcome[], boolean][]) {
      const run = withBoss(perfect, c);
      const p = store.withCompletion(base, run, engine.computeXp(q, run), engine.computeStars(q, run), undefined, {
        mastered: engine.isMastered(q, run), mastery: engine.bossScore(q, run), medal: engine.computeMedal(q, run),
      });
      expect(progression.isDestinationUnlocked(hall, p)).toBe(open);
    }
  });
});

describe('D1: a revealed boss answer caps the medal at bronze, and changes nothing else', () => {
  const all = combos();
  test('every passing combination with a boss step at 0 (revealed or out of picks) is bronze; without one, never capped', () => {
    for (const c of all) {
      const run = withBoss(perfect, c);
      if (!engine.isMastered(q, run)) { expect(engine.computeMedal(q, run)).toBe('none'); continue; }
      if (c.includes(0)) expect(engine.computeMedal(q, run)).toBe('bronze');
      else expect(engine.computeMedal(q, run)).not.toBe('bronze'); // all other rounds first time → silver or gold
    }
  });
  test('the cap does not change the boss score, the pass, XP or the unlock', () => {
    const run = withBoss(perfect, [0, 1, 1, 1, 1]);
    expect(engine.bossScore(q, run)).toBeCloseTo(3.5 / 4.5, 3); // the revealed step still earns 0, nothing more is taken
    expect(engine.isMastered(q, run)).toBe(true);
    expect(engine.computeMedal(q, run)).toBe('bronze');
    expect(engine.computeStars(q, run)).toBe(1);
    // XP is per step and independent of the medal: the same as the uncapped run minus only the revealed step's XP.
    const audit = q.scenes.find((s) => s.id === 'audit-revenue')!;
    expect(engine.computeXp(q, run)).toBe(engine.computeXp(q, perfect) - engine.sceneXp(q, audit, engine.resultFor(perfect, 'audit-revenue')));
    const base = store.withCompletion(store.defaultProgress(), { ...engine.createRun(quests.get('missing-signal')!), completed: true }, 60, 3, undefined, { mastered: true });
    const p = store.withCompletion(base, run, engine.computeXp(q, run), engine.computeStars(q, run), q.badge?.id, {
      mastered: engine.isMastered(q, run), mastery: engine.bossScore(q, run), medal: engine.computeMedal(q, run),
    });
    expect(progression.isDestinationUnlocked(hall, p)).toBe(true);
    expect(store.questRecord(p, 'market-ledger').bestMedal).toBe('bronze');
    expect(engine.nextMedalHint(q, run)).toMatch(/final challenge was revealed/);
  });
  test('a boss step locked by the pick budget counts as revealed for the cap, played through the engine', () => {
    let r = reach('audit-verdict');
    const s = engine.resolveScene(engine.currentScene(q, r), r) as SpotScene;
    for (const row of [2, 3, 4, 5].filter((n) => n !== Number(s.answer[0].slice(1))).slice(0, 2)) r = submit(r, { cell: `A${row}`, working: '=B2-C2' });
    expect(engine.resultFor(r, 'audit-verdict').revealed).toBe(true);
    while (!r.completed) { const sc = engine.currentScene(q, r); if (engine.isChallenge(sc) && !engine.resultFor(r, sc.id).solved) r = right(r); r = engine.advance(q, r); }
    expect(engine.isMastered(q, r)).toBe(true); // 3.5 / 4.5
    expect(engine.computeMedal(q, r)).toBe('bronze');
  });
  test('a revealed round outside the boss still allows silver (only boss reveals cap at bronze)', () => {
    const run = withBoss(perfect, [1, 1, 1, 1, 1], { 'find-cell': { attempts: 3, solved: true, revealed: true } });
    expect(engine.computeMedal(q, run)).toBe('silver');
  });
});

describe('D2: the pass mark is 70% or more (a design rule, not a validated threshold)', () => {
  test('exactly 70% passes', () => {
    const run = withBoss(perfect, [0, 1, 1, 0.3, 1]); // (0 + 1 + 1 + 0.5·0.3 + 1) / 4.5 = 0.7
    expect(engine.bossScore(q, run)).toBe(0.7);
    expect(engine.isMastered(q, run)).toBe(true);
  });
  test('the highest score below 70% fails, with no unlock and no medal', () => {
    const below = all70Below();
    expect(below.score).toBeLessThan(0.7);
    const run = withBoss(perfect, below.combo);
    expect(engine.isMastered(q, run)).toBe(false);
    expect(engine.computeMedal(q, run)).toBe('none');
  });
  test('the comparison is on the rounded score, so floating-point error cannot flip the boundary', () => {
    const shifted = { ...q, mastery: { threshold: 0.733, gold: 0.85 } };
    const run = withBoss(perfect, [0.6, 0.6, 1, 1, 0.6]); // 3.3 / 4.5 = 0.7333…
    expect(engine.bossScore(shifted, run)).toBe(0.733);
    expect(engine.isMastered(shifted, run)).toBe(true);
  });
});

/** The best boss score strictly below 70%, over every combination. */
function all70Below(): { combo: Outcome[]; score: number } {
  let best = { combo: [0, 0, 0, 0, 0] as Outcome[], score: 0 };
  for (const c of combos()) {
    const score = engine.bossScore(q, withBoss(perfect, c))!;
    if (score < 0.7 && score > best.score) best = { combo: c, score };
  }
  return best;
}

describe('F1 and F2', () => {
  test('F1: running out of picks finishes the step once, and its concept event is recorded as revealed', () => {
    let r = reach('find-cell');
    let last = engine.submitAnswer(q, r, { cell: 'C3' });
    expect(engine.stepFinished(last.outcome)).toBe(false); // a wrong pick is not an event
    for (const c of ['A2', 'B5']) { r = last.run; last = engine.submitAnswer(q, r, { cell: c }); }
    expect(last.outcome.locked).toBe(true);
    expect(engine.stepFinished(last.outcome)).toBe(true);
    // Once finished, nothing else can finish it again: no double events.
    expect(engine.stepFinished(engine.submitAnswer(q, last.run, { cell: 'B3' }).outcome)).toBe(false);
    expect(engine.revealAnswer(q, last.run)).toBe(last.run);
    // A right answer is an event; an invalid one is not.
    const fresh = reach('find-cell', 8);
    expect(engine.stepFinished(engine.submitAnswer(q, fresh, { cell: 'B3' }).outcome)).toBe(true);
    expect(engine.stepFinished(engine.submitAnswer(q, fresh, { cell: 'Z9' }).outcome)).toBe(false);
  });
  test('F2: one round label for the badge and the screen-reader text: rounds 1–12, boss stages 1–5', () => {
    const challenges = q.scenes.filter(engine.isChallenge);
    const labels = challenges.map((s) => engine.roundLabel(q, s.id)!);
    const rounds = labels.filter((l) => l.kind === 'round');
    const boss = labels.filter((l) => l.kind === 'boss');
    expect(rounds.map((l) => l.index)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(rounds.every((l) => l.total === 12 && l.text === `Round ${l.index} of 12`)).toBe(true);
    expect(boss.map((l) => l.text)).toEqual([1, 2, 3, 4, 5].map((i) => `Boss stage ${i} of 5`));
    expect(engine.roundLabel(q, 'arrive')).toBeNull(); // story steps are not rounds
  });
});

describe('F1 through the screens\' own recordStep', () => {
  test('a locked evidence step is recorded once, as revealed: no first-time credit, no context or day toward mastery', () => {
    let r = reach('find-cell');
    let last = engine.submitAnswer(q, r, { cell: 'C3' });
    for (const c of ['A2', 'B5']) { r = last.run; last = engine.submitAnswer(q, r, { cell: c }); }
    const scene = q.scenes.find((s) => s.id === 'find-cell')!;
    const p = recordStep(store.defaultProgress(), q, last.run, scene);
    const rec = p.concepts['XL.CELL.ADDRESS'];
    expect(rec).toMatchObject({ attempts: 1, revealed: 1, solved: 0, firstTry: 0 });
    expect(rec.contexts).toEqual([]);
    expect(rec.days).toEqual([]);
  });
});
