import { describe, expect, test } from 'vitest';
import * as engine from '../src/engine/game-engine';
import * as store from '../src/engine/progress-store';
import * as progression from '../src/engine/progression';
import { evaluateFormula, excelRound, makeSheet } from '../src/engine/excel-lite';
import { scoreGuess, guessProblem, letterStates } from '../src/engine/games/runeword';
import { draw, mulberry32, weightedIndex } from '../src/engine/games/rng';
import { conceptLevel, recordConcepts, reviewWeight, sanitizeConcepts } from '../src/engine/games/mastery';
import { buildableFrom, validateCodex, validateQuest } from '../src/engine/quest-validation';
import type { Answer, Codex, GambitScene, Quest, RepairScene, Run, SpotScene, SpotTask, WheelScene } from '../src/engine/types';
import { QUEST_IDS, loadAllQuests, loadQuest, loadWorld, memoryStorage, readJson } from './helpers';

const q = loadQuest('market-ledger');
const quests = loadAllQuests();
const world = loadWorld();
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

/** Advance to a step, solving everything before it correctly on the first try. */
function goTo(id: string, seed = 1, quest: Quest = q): Run {
  let run = engine.createRun(quest, seed);
  while (engine.currentScene(quest, run).id !== id) {
    const scene = engine.currentScene(quest, run);
    if (scene.type === 'wheel') run = engine.spinWheel(quest, run);
    if (engine.isChallenge(scene)) run = engine.submitAnswer(quest, run, engine.correctAnswer(scene, run)!).run;
    run = engine.advance(quest, run);
  }
  return run;
}

function finish(run: Run, quest: Quest = q, answer: (r: Run) => Answer | null = (r) => engine.correctAnswer(engine.currentScene(quest, r), r)): Run {
  let r = run;
  while (!r.completed) {
    const scene = engine.currentScene(quest, r);
    if (scene.type === 'wheel') r = engine.spinWheel(quest, r);
    if (engine.isChallenge(scene) && !engine.resultFor(r, scene.id).solved) {
      const a = answer(r);
      r = a ? engine.submitAnswer(quest, r, a).run : r;
      if (!engine.resultFor(r, scene.id).solved) {
        while (!engine.resultFor(r, scene.id).solved && engine.resultFor(r, scene.id).attempts < engine.revealAfter(scene)) {
          const before = engine.resultFor(r, scene.id).attempts;
          r = engine.submitAnswer(quest, r, wrongAnswer(scene, r)).run;
          if (engine.resultFor(r, scene.id).attempts === before) throw new Error(`wrong answer for ${scene.id} was not a valid attempt`);
        }
        r = engine.revealAnswer(quest, r);
      }
    }
    r = engine.advance(quest, r);
  }
  return r;
}

/** A data cell that does not answer an evidence step (a different row for row steps). */
function wrongCell(task: SpotTask, tried: string[] = []): string {
  const rows = task.answer.map((a) => Number(a.slice(1)));
  const used = (cell: string) => tried.some((t) => (task.select === 'row' ? t.slice(1) === cell.slice(1) : t === cell));
  for (let r = 2; r <= task.rows.length + 1; r += 1) {
    for (let c = 0; c < task.columns.length; c += 1) {
      const cell = `${String.fromCharCode(65 + c)}${r}`;
      if ((task.select === 'row' ? !rows.includes(r) : !task.answer.includes(cell)) && !used(cell)) return cell;
    }
  }
  throw new Error('no wrong cell');
}

/** A valid but wrong answer for any step type in the Market quest. */
function wrongAnswer(scene: ReturnType<typeof engine.currentScene>, run: Run): Answer {
  const guesses = run.guesses?.[scene.id] ?? [];
  switch (scene.type) {
    case 'choice': return scene.options.find((o) => o.id !== engine.resolveScene(scene, run).correct)!.id;
    case 'workshop': return { formula: '=1+1' };
    case 'repair': return { diagnosis: scene.diagnoses.find((d) => d.id !== scene.correctDiagnosis)!.id, formula: scene.solution };
    case 'runeword': return { guess: (scene.word.length === 3 ? ['SUM', 'MIN', 'ABS', 'DAY', 'COS', 'EXP', 'INT', 'LEN'] : ['ACCRINT', 'ADDRESS', 'BESSELI', 'BESSELJ', 'BESSELK', 'BESSELY', 'BETAINV', 'CEILING']).filter((w) => w.length === scene.word.length && !guesses.includes(w) && w !== scene.word)[0] };
    case 'match': return { pairs: Object.fromEntries(scene.left.map((l, i) => [l.id, scene.right[(i + 1) % scene.right.length].id])) };
    case 'gambit': return { orders: scene.items.map((it) => it.demand), formula: scene.solution.formula };
    case 'spot': {
      const s = engine.resolveScene(scene, run);
      // With an assessed working column, a wrong working formula is a miss that uses no pick.
      if (s.scratch?.solutions?.length) return { cell: s.answer[0], working: '=1+1' };
      return { cell: wrongCell(s, engine.picksMade(run, scene.id)) };
    }
    case 'wheel': {
      const c = engine.landedSegment(scene, run)!.challenge;
      return { response: c.kind === 'choice' ? c.options.find((o) => o.id !== c.correct)!.id : c.kind === 'spot' ? { cell: wrongCell(c, engine.picksMade(run, scene.id)) } : { formula: '=1' } };
    }
    default: throw new Error(`no wrong answer for ${scene.type}`);
  }
}

describe('excel-lite follows Excel', () => {
  const val = (f: string) => evaluateFormula(f, makeSheet(['A'], [[5]])).value;
  test('negation binds tighter than ^, and ^ is left-associative', () => {
    expect(val('=-2^2')).toBe(4);
    expect(val('=0-2^2')).toBe(-4);
    expect(val('=2^3^2')).toBe(64);
    expect(val('=2^-1')).toBe(0.5);
  });
  test('percent and decimal literals', () => {
    expect(val('=50%')).toBe(0.5);
    expect(val('=A2*10%')).toBeCloseTo(0.5);
    expect(val('=.5+.25')).toBe(0.75);
  });
  test('ROUND rounds halves away from zero and uses the decimal value', () => {
    expect(excelRound(-2.5, 0)).toBe(-3);
    expect(excelRound(2.5, 0)).toBe(3);
    expect(excelRound(1.005, 2)).toBe(1.01);
    expect(excelRound(1234.5, -2)).toBe(1200);
    expect(val('=ROUND(-2.5,0)')).toBe(-3);
  });
  test('MIN of two expressions caps sales at demand', () => {
    expect(evaluateFormula('=B2*MIN(D2,E2)-C2*E2', makeSheet(['A', 'B', 'C', 'D', 'E'], [['Rope', 5, 2, 22, 30]]), 'F2').value).toBe(50);
  });
});

describe('random draws are reproducible', () => {
  test('same seed and label give the same draw; labels are independent', () => {
    expect(draw(42, 'a')).toBe(draw(42, 'a'));
    expect(draw(42, 'a')).not.toBe(draw(42, 'b'));
    const r = mulberry32(7);
    const first = [r(), r(), r()];
    const s = mulberry32(7);
    expect([s(), s(), s()]).toEqual(first);
  });
  test('weighted picks respect weights', () => {
    expect(weightedIndex([0, 0, 5], 0.01)).toBe(2);
    expect(weightedIndex([1, 1], 0.49)).toBe(0);
    expect(weightedIndex([1, 1], 0.51)).toBe(1);
  });
});

describe('Rune-word (Wordle rules)', () => {
  test('hits, near-misses and repeated letters', () => {
    expect(scoreGuess('MIN', 'MAX')).toEqual(['hit', 'miss', 'miss']);
    expect(scoreGuess('AVERAGEA'.slice(0, 7), 'AVERAGE')).toEqual(Array(7).fill('hit'));
    // Only one unmatched A remains in COUNTA, so the second A in the guess is a miss.
    expect(scoreGuess('AAAAAA', 'COUNTA')).toEqual(['miss', 'miss', 'miss', 'miss', 'miss', 'hit']);
    expect(scoreGuess('ROUND', 'COUNT')).toEqual(['miss', 'hit', 'hit', 'hit', 'miss']);
    expect(scoreGuess('TRUNC', 'COUNT')).toEqual(['near', 'miss', 'hit', 'hit', 'near']);
  });
  test('only real function names of the right length count as guesses', () => {
    expect(guessProblem('ab', 'MAX', [])).toMatch(/3 letters/);
    expect(guessProblem('XYZ', 'MAX', [])).toMatch(/isn’t an Excel function/);
    expect(guessProblem('sum', 'MAX', ['SUM'])).toMatch(/already tried/);
    expect(guessProblem('min', 'MAX', [])).toBeNull();
    expect(letterStates(['MIN', 'SUM'], 'MAX')).toMatchObject({ M: 'hit', I: 'miss', S: 'miss' });
  });
  test('invalid guesses are not attempts; guesses are remembered; par counts as first time', () => {
    let run = goTo('rune-max');
    const bad = engine.submitAnswer(q, run, { guess: 'ZZZ' });
    expect(bad.outcome.valid).toBe(false);
    let r = engine.submitAnswer(q, run, { guess: 'sum' });
    expect(r.outcome.tiles).toEqual(['miss', 'miss', 'near']);
    run = r.run;
    r = engine.submitAnswer(q, run, { guess: 'MIN' });
    run = r.run;
    r = engine.submitAnswer(q, run, { guess: 'MAX' });
    expect(r.outcome.correct).toBe(true);
    expect(r.run.guesses!['rune-max']).toEqual(['SUM', 'MIN', 'MAX']);
    const scene = engine.currentScene(q, r.run);
    expect(engine.isFirstTry(scene, engine.resultFor(r.run, 'rune-max'))).toBe(true); // 3 guesses = par
  });
});

describe('Ledger Workshop', () => {
  test('the fill-down workshop keeps the original Excel checks', () => {
    const run = goTo('row-revenue');
    expect(engine.submitAnswer(q, run, { formula: '=B2*C2' }).outcome.correct).toBe(true);
    expect(engine.submitAnswer(q, run, { formula: '=25*6' }).outcome.feedback).toMatch(/typed numbers/);
    expect(engine.submitAnswer(q, run, { formula: '=$B$2*$C$2' }).outcome.issues!.map((i) => i.id)).toEqual(['D3', 'D4', 'D5']);
  });
  test('solutions must be buildable from the bench fragments', () => {
    expect(buildableFrom('=SUM(D2:D5)', ['=', 'SUM(', 'D2:D5', ')'])).toBe(true);
    expect(buildableFrom('=SUM(D2:D5)', ['=', 'SUM(', 'D2:D6', ')'])).toBe(false);
    const broken = clone(q);
    (broken.scenes.find((s) => s.id === 'total') as { tokens: string[] }).tokens = ['=', 'SUM(', ')', 'D2:D6'];
    expect(validateQuest(broken).join('\n')).toMatch(/cannot be built from its fragments/);
  });
});

describe('Repair Mission', () => {
  const run = goTo('absolute');
  test('both the diagnosis and the fix are checked', () => {
    expect(engine.submitAnswer(q, run, { diagnosis: 'drift', formula: '=B2*$E$2' }).outcome.correct).toBe(true);
    const wrongCause = engine.submitAnswer(q, run, { diagnosis: 'rate', formula: '=B2*$E$2' }).outcome;
    expect(wrongCause.correct).toBe(false);
    expect(wrongCause.feedback).toMatch(/diagnosis is off/);
    expect(engine.submitAnswer(q, run, { diagnosis: 'drift', formula: '=B2*E2' }).outcome.correct).toBe(false);
  });
  test('a fix that only works on today’s numbers fails the second ledger', () => {
    const typed = engine.submitAnswer(q, run, { diagnosis: 'drift', formula: '=B2*0.1' }).outcome;
    expect(typed.correct).toBe(false);
    expect(typed.issues!.map((i) => i.id)).toContain('check');
  });
  test('content validation rejects a "broken" formula that actually works', () => {
    const bad = clone(q);
    (bad.scenes.find((s) => s.id === 'absolute') as RepairScene).broken = '=B2*$E$2';
    expect(validateQuest(bad).join('\n')).toMatch(/not actually broken/);
  });
});

describe('Rune Wheel', () => {
  test('must spin before answering; the spin is reproducible and cannot be redone', () => {
    const run = goTo('rune-wheel', 99);
    expect(engine.submitAnswer(q, run, { response: 'x' }).outcome.message).toMatch(/Spin the wheel/);
    const a = engine.spinWheel(q, run);
    const b = engine.spinWheel(q, goTo('rune-wheel', 99));
    expect(a.spins!['rune-wheel']).toBe(b.spins!['rune-wheel']);
    expect(engine.spinWheel(q, a)).toBe(a); // no re-spin
    const scene = engine.currentScene(q, a) as WheelScene;
    const seg = engine.landedSegment(scene, a)!;
    expect(engine.submitAnswer(q, a, engine.correctAnswer(scene, a)!).outcome.correct).toBe(true);
    // Hints and concepts come from the landed segment.
    const wrong = engine.submitAnswer(q, a, wrongAnswer(scene, a)).outcome;
    expect(wrong.hint).toBe(seg.hints[0]);
    expect(engine.conceptsFor(scene, a)).toEqual(seg.concepts);
  });
  test('every segment can land, and review weights steer the spin towards weak concepts', () => {
    const landed = new Set<string>();
    for (let seed = 1; seed < 400; seed += 1) landed.add(engine.spinWheel(q, goTo('rune-wheel', seed)).spins!['rune-wheel']);
    expect(landed.size).toBe((q.scenes.find((s) => s.id === 'rune-wheel') as WheelScene).segments.length);
    const weights = { 'XL.REF.ABSOLUTE': 1000 };
    let hits = 0;
    for (let seed = 1; seed < 60; seed += 1) if (engine.spinWheel(q, goTo('rune-wheel', seed), weights).spins!['rune-wheel'] === 'exchange') hits += 1;
    expect(hits).toBeGreaterThan(50);
  });
  test('segments may only use concepts the quest has already taught', () => {
    const bad = clone(q);
    const wheel = bad.scenes.find((s) => s.id === 'rune-wheel') as WheelScene;
    wheel.segments[0].concepts = ['XL.LOOKUP.XLOOKUP'];
    expect(validateQuest(bad).join('\n')).toMatch(/before it is introduced/);
  });
});

describe('Rune match', () => {
  test('incomplete boards are not attempts; wrong pairs are explained', () => {
    const run = goTo('error-runes');
    expect(engine.submitAnswer(q, run, { pairs: { div0: 'zero' } }).outcome.valid).toBe(false);
    const swapped = { div0: 'zero', name: 'text', value: 'spell', ref: 'deleted' };
    const out = engine.submitAnswer(q, run, { pairs: swapped }).outcome;
    expect(out.correct).toBe(false);
    expect(out.issues!.map((i) => i.id).sort()).toEqual(['name', 'value']);
  });
});

describe("Trader's Gambit: the player's own numbers decide the outcome", () => {
  const run = goTo('restock');
  const scene = engine.currentScene(q, run) as GambitScene;
  const formula = scene.solution.formula;
  test('a profitable, affordable restock with a correct model succeeds', () => {
    const out = engine.submitAnswer(q, run, { orders: [6, 15, 0, 22], formula }).outcome;
    expect(out.correct).toBe(true);
    expect(out.trade!.total).toBe(186);
    expect(out.trade!.spend).toBe(194);
  });
  test('overspending the purse is refused', () => {
    const out = engine.submitAnswer(q, run, { orders: [6, 15, 3, 22], formula }).outcome;
    expect(out.issues!.map((i) => i.id)).toContain('purse');
  });
  test('too little profit fails, with the true outcome reported', () => {
    const out = engine.submitAnswer(q, run, { orders: [0, 5, 0, 10], formula }).outcome;
    expect(out.issues!.map((i) => i.id)).toEqual(['profit']);
    expect(out.trade!.total).toBe(50);
  });
  test('a profit formula that ignores demand is caught, even on orders where it happens to work', () => {
    const naive = engine.submitAnswer(q, run, { orders: [6, 15, 0, 22], formula: '=(B2-C2)*E2' }).outcome;
    expect(naive.correct).toBe(false);
    expect(naive.issues!.map((i) => i.id)).toContain('probe');
  });
  test('invalid orders are not attempts', () => {
    expect(engine.submitAnswer(q, run, { orders: [1, 2], formula }).outcome.valid).toBe(false);
    expect(engine.submitAnswer(q, run, { orders: [1, 2, 3, 99], formula }).outcome.valid).toBe(false);
  });
});

describe('Boss mission with data variants', () => {
  test('variants are chosen per run and stay fixed for that run', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed < 60; seed += 1) seen.add(engine.variantIndex(q.scenes.find((s) => s.id === 'audit-revenue')!, engine.createRun(q, seed)));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
  test('a memorised answer from another variant fails', () => {
    // Find two seeds that give different discrepancy variants.
    const scene = q.scenes.find((s) => s.id === 'audit-discrepancy')!;
    const seeds = [...Array(60).keys()].map((i) => i + 1);
    const a = seeds.find((s) => engine.variantIndex(scene, engine.createRun(q, s)) === 0)!;
    const b = seeds.find((s) => engine.variantIndex(scene, engine.createRun(q, s)) === 1)!;
    const runA = goTo('audit-discrepancy', a);
    const runB = goTo('audit-discrepancy', b);
    const w = '=B2*C2';
    expect(engine.submitAnswer(q, runA, { cell: 'D4', working: w }).outcome.correct).toBe(true);
    expect(engine.submitAnswer(q, runB, { cell: 'D4', working: w }).outcome.correct).toBe(false);
    expect(engine.submitAnswer(q, runB, { cell: 'D3', working: w }).outcome.correct).toBe(true);
  });
  test('boss steps hold back the first hint', () => {
    const run = goTo('audit-revenue');
    const first = engine.submitAnswer(q, run, { formula: '=1+1' });
    expect(first.outcome.hint).toBeNull();
    expect(engine.submitAnswer(q, first.run, { formula: '=1+1' }).outcome.hint).toBeTruthy();
  });
  test('perfect boss = mastery 1; a weak boss is not mastered and does not unlock the Great Hall', () => {
    const perfect = finish(goTo('audit-revenue'));
    expect(engine.bossScore(q, perfect)).toBe(1);
    expect(engine.isMastered(q, perfect)).toBe(true);

    // Reveal every boss answer: 0 mastery.
    let weak = goTo('audit-revenue');
    weak = finish(weak, q, (r) => wrongAnswer(engine.currentScene(q, r), r));
    expect(engine.bossScore(q, weak)).toBe(0);
    expect(engine.isMastered(q, weak)).toBe(false);
    expect(engine.computeMedal(q, weak)).toBe('none');

    const base = store.withCompletion(store.defaultProgress(), { ...engine.createRun(quests.get('missing-signal')!), completed: true }, 50, 3);
    const hall = world.destinations.find((d) => d.id === 'great-hall')!;
    const failed = store.withCompletion(base, weak, engine.computeXp(q, weak), 1, q.badge?.id, { mastered: false, mastery: 0, medal: 'none' });
    expect(progression.isDestinationUnlocked(hall, failed)).toBe(false);
    expect(progression.unlockRequirement(hall, quests, failed)).toMatch(/Pass the final challenge/);
    const passed = store.withCompletion(failed, perfect, engine.computeXp(q, perfect), 3, q.badge?.id, { mastered: true, mastery: 1, medal: 'silver' });
    expect(progression.isDestinationUnlocked(hall, passed)).toBe(true);
    expect(progression.newlyUnlocked(world, failed, passed).map((d) => d.id)).toEqual(['great-hall']);
    // A later weak replay never takes mastery or the medal away.
    const replay = store.withCompletion(passed, weak, 10, 1, undefined, { mastered: false, mastery: 0, medal: 'none' });
    expect(store.questRecord(replay, 'market-ledger')).toMatchObject({ mastered: true, bestMastery: 1, bestMedal: 'silver' });
  });
});

/**
 * Play the whole quest: `plan` says how many wrong attempts to make on a step
 * (or 'reveal'), `stakes` which steps to stake the maximum on.
 */
function playRun(seed: number, plan: Record<string, number | 'reveal'> = {}, stakes: string[] = []): Run {
  let r = engine.createRun(q, seed);
  while (!r.completed) {
    const scene = engine.currentScene(q, r);
    if (scene.type === 'wheel') r = engine.spinWheel(q, r);
    if (engine.isChallenge(scene)) {
      if (stakes.includes(scene.id)) r = engine.placeWager(q, r, engine.maxStake(q, r));
      const p = plan[scene.id] ?? 0;
      const misses = p === 'reveal' ? engine.revealAfter(scene) : p;
      for (let i = 0; i < misses && !engine.resultFor(r, scene.id).solved; i += 1) r = engine.submitAnswer(q, r, wrongAnswer(scene, r)).run;
      if (!engine.resultFor(r, scene.id).solved) r = p === 'reveal' ? engine.revealAnswer(q, r) : engine.submitAnswer(q, r, engine.correctAnswer(scene, r)!).run;
      expect(engine.resultFor(r, scene.id).solved, scene.id).toBe(true);
    }
    r = engine.advance(q, r);
  }
  return r;
}

describe('silver purse (optional wagers) is separate from XP, medals and unlocks', () => {
  test('stakes are capped at half the silver purse so far, and only before the first attempt', () => {
    const run = goTo('rune-max');
    const purse = engine.purseBefore(q, run, 'rune-max');
    expect(purse).toBe(engine.computeXp(q, run)); // no stakes yet: silver mirrors XP earned
    expect(engine.maxStake(q, run)).toBe(Math.floor(purse / 2));
    const staked = engine.placeWager(q, run, 10_000);
    expect(staked.wagers!['rune-max']).toBe(engine.maxStake(q, run));
    const tried = engine.submitAnswer(q, staked, { guess: 'SUM' }).run;
    expect(engine.placeWager(q, tried, 1)).toBe(tried); // locked after an attempt
    const other = goTo('total');
    expect(engine.maxStake(q, other)).toBe(0);
    expect(engine.placeWager(q, other, 5)).toBe(other);
  });
  test('winning or losing a stake changes silver only — XP is identical', () => {
    const run = goTo('rune-max');
    const stake = engine.maxStake(q, run);
    const won = engine.submitAnswer(q, engine.placeWager(q, run, stake), { guess: 'MAX' }).run;
    const plain = engine.submitAnswer(q, run, { guess: 'MAX' }).run;
    expect(engine.wagerNet(q, won)).toBe(stake);
    expect(engine.computeXp(q, won)).toBe(engine.computeXp(q, plain));
    expect(engine.computeSilver(q, won)).toBe(engine.computeSilver(q, plain) + stake);

    let lost = engine.placeWager(q, run, stake);
    for (const g of ['SUM', 'MIN', 'ABS', 'DAY']) lost = engine.submitAnswer(q, lost, { guess: g }).run; // beyond par
    lost = engine.submitAnswer(q, lost, { guess: 'MAX' }).run;
    expect(engine.wagerNet(q, lost)).toBe(-stake);
    expect(engine.computeXp(q, lost)).toBe(engine.baseXp(q, lost));
    expect(engine.computeSilver(q, lost)).toBeGreaterThanOrEqual(Math.ceil(engine.baseXp(q, lost) / 2));
  });
});

describe('medals come from demonstrated mastery only', () => {
  test('a perfect run earns gold without any stake', () => {
    const run = playRun(3);
    expect(engine.stakesPlaced(q, run)).toBe(0);
    expect(engine.computeMedal(q, run)).toBe('gold');
    expect(engine.nextMedalHint(q, run)).toBe('');
  });
  test('the same play earns the same medal with or without stakes, won or lost', () => {
    const plan = { 'rune-max': 4, 'find-cell': 1 }; // rune-max beyond par → its stake is lost
    const safe = playRun(5, plan);
    const bold = playRun(5, plan, ['rune-max', 'rune-wheel', 'restock']);
    expect(engine.wagerNet(q, bold)).not.toBe(0);
    expect(engine.computeMedal(q, bold)).toBe(engine.computeMedal(q, safe));
    expect(engine.computeXp(q, bold)).toBe(engine.computeXp(q, safe));
  });
  test('any revealed answer rules out gold; many retries drop to bronze; a weak boss earns nothing', () => {
    expect(engine.computeMedal(q, playRun(7, { 'error-runes': 'reveal' }))).toBe('silver');
    const retries = Object.fromEntries(['find-cell', 'row-revenue', 'total', 'average-price', 'highest-price', 'absolute', 'profit-fix'].map((id) => [id, 1]));
    const bronze = playRun(7, retries);
    expect(engine.computeMedal(q, bronze)).toBe('bronze');
    expect(engine.nextMedalHint(q, bronze)).toMatch(/for silver/);
    const weak = playRun(7, { 'audit-revenue': 'reveal', 'audit-tax': 'reveal', 'audit-discrepancy': 'reveal' });
    expect(engine.isMastered(q, weak)).toBe(false);
    expect(engine.computeMedal(q, weak)).toBe('none');
    expect(engine.nextMedalHint(q, weak)).toMatch(/final challenge/);
  });
  test('boss retries cost gold but not the unlock', () => {
    const run = playRun(9, { 'audit-revenue': 1, 'audit-tax': 1 });
    // The rune step (recall) counts half: (0.6 + 0.6 + 1 + 0.5·1 + 1) / 4.5.
    expect(engine.bossScore(q, run)).toBeCloseTo((0.6 + 0.6 + 1 + 0.5 + 1) / 4.5, 2);
    expect(engine.isMastered(q, run)).toBe(true);
    expect(engine.computeMedal(q, run)).toBe('silver');
  });
  test('wagers survive save and reload; tampered values are cleaned', () => {
    const run = engine.placeWager(q, goTo('rune-max'), 5);
    const restored = engine.restoreRun(q, JSON.parse(JSON.stringify(run)));
    expect(restored.wagers).toEqual({ 'rune-max': 5 });
    expect(restored.seed).toBe(run.seed);
    const tampered = engine.restoreRun(q, { ...run, wagers: { 'rune-max': -9, nope: 3 }, spins: { 'rune-wheel': 'ghost' }, guesses: { 'rune-max': ['<b>', 'MIN'] } });
    expect(tampered.wagers).toEqual({});
    expect(tampered.spins).toEqual({});
    expect(tampered.guesses).toEqual({ 'rune-max': ['MIN'] });
  });
});

describe('concept mastery and spaced recall', () => {
  const ctx = (c: string, day: number) => ({ firstTry: true, revealed: false, wrongAttempts: 0, context: c, day });
  test('levels rise only with real first-time successes across contexts and days', () => {
    let m = recordConcepts({}, ['XL.FN.SUM'], { firstTry: false, revealed: false, wrongAttempts: 2, context: 'market-ledger/total', day: 100 });
    expect(conceptLevel(m['XL.FN.SUM'])).toBe('practised');
    m = recordConcepts(m, ['XL.FN.SUM'], ctx('market-ledger/total', 100));
    m = recordConcepts(m, ['XL.FN.SUM'], ctx('market-ledger/rune-wheel', 100));
    expect(conceptLevel(m['XL.FN.SUM'])).toBe('demonstrated');
    m = recordConcepts(m, ['XL.FN.SUM'], ctx('market-ledger/audit-tax', 100));
    expect(conceptLevel(m['XL.FN.SUM'])).toBe('demonstrated'); // same day: not yet spaced
    m = recordConcepts(m, ['XL.FN.SUM'], ctx('market-ledger/rune-wheel', 103));
    expect(conceptLevel(m['XL.FN.SUM'])).toBe('mastered');
    const revealed = recordConcepts({}, ['XL.FN.MINMAX'], { firstTry: true, revealed: true, wrongAttempts: 3, context: 'market-ledger/rune-max', day: 1 });
    expect(conceptLevel(revealed['XL.FN.MINMAX'])).toBe('seen');
  });
  test('weak and fading concepts get more review weight', () => {
    const strong = recordConcepts({}, ['XL.FN.SUM'], ctx('a/b', 100))['XL.FN.SUM'];
    expect(reviewWeight(undefined, 100)).toBeGreaterThan(reviewWeight(strong, 100));
    expect(reviewWeight(strong, 120)).toBeGreaterThan(reviewWeight(strong, 100));
  });
  test('saved concept records are sanitised', () => {
    const clean = sanitizeConcepts({ 'XL.FN.SUM': { attempts: 3, contexts: ['a/b', '<x>'], days: [5, -1] }, 'bad id': {} });
    expect(Object.keys(clean)).toEqual(['XL.FN.SUM']);
    expect(clean['XL.FN.SUM'].contexts).toEqual(['a/b']);
    expect(clean['XL.FN.SUM'].days).toEqual([5]);
  });
});

describe('save schema v4', () => {
  test('a v3 save keeps completions and unlocks: completed quests count as mastered', () => {
    const v3 = { version: 3, player: { name: 'Asha', emblem: 'owl' }, quests: { 'missing-signal': { run: null, runXp: 0, lastRun: null, lastXp: 60, bestXp: 60, bestStars: 3, completed: true, completions: 1 }, 'market-ledger': { run: null, runXp: 0, lastRun: null, lastXp: 50, bestXp: 50, bestStars: 2, completed: true, completions: 1 } }, achievements: [], lessons: [], settings: { motion: 'system', textSize: 'normal', graphics: 'auto' } };
    const loaded = store.createProgressStore(memoryStorage({ [store.STORAGE_KEY]: JSON.stringify(v3) })).load();
    expect(loaded.version).toBe(store.SCHEMA_VERSION);
    expect(loaded.concepts).toEqual({});
    expect(store.questRecord(loaded, 'market-ledger')).toMatchObject({ completed: true, mastered: true, bestMedal: 'none', bestMastery: null });
    expect(progression.isDestinationUnlocked(world.destinations.find((d) => d.id === 'great-hall')!, loaded)).toBe(true);
  });
  test('progress with concepts and medals round-trips', () => {
    let p = store.withConcepts(store.defaultProgress(), recordConcepts({}, ['XL.FN.SUM'], ctx2()));
    p = store.withCompletion(p, { ...engine.createRun(q), completed: true }, 100, 3, undefined, { mastered: true, mastery: 0.9, medal: 'gold' });
    const s = store.createProgressStore(memoryStorage());
    s.save(p);
    const back = s.load();
    expect(back.concepts['XL.FN.SUM'].firstTry).toBe(1);
    expect(store.questRecord(back, 'market-ledger')).toMatchObject({ bestMedal: 'gold', bestMastery: 0.9, mastered: true });
  });
  function ctx2() { return { firstTry: true, revealed: false, wrongAttempts: 0, context: 'market-ledger/total', day: 10 }; }
});

describe('Codex and content integrity', () => {
  const codex = readJson<Codex>('public/data/codex.json');
  test('every concept used by any quest has a Codex card with an encyclopedia reference', () => {
    expect(validateCodex(codex, [...quests.values()])).toEqual([]);
  });
  test('missing Codex cards are reported', () => {
    const c = clone(codex);
    delete c.entries['XL.FN.SUM'];
    expect(validateCodex(c, [q]).join('\n')).toMatch(/XL.FN.SUM/);
  });
  test('every quest validates, including every data variant', () => {
    for (const id of QUEST_IDS) expect(validateQuest(loadQuest(id)), id).toEqual([]);
  });
  test('the Merchant’s Ledger mixes at least five distinct mechanics and ends in a boss', () => {
    const types = new Set(q.scenes.filter((s) => engine.isChallenge(s)).map((s) => s.type));
    expect(types.size).toBeGreaterThanOrEqual(5);
    expect(engine.bossScenes(q).length).toBeGreaterThanOrEqual(4);
    expect(new Set(engine.bossScenes(q).map((s) => s.type)).size).toBeGreaterThanOrEqual(3);
  });
});

describe('Evidence steps: the player points at the proof in the ledger', () => {
  const spot = (id: string) => q.scenes.find((s) => s.id === id) as SpotScene;
  test('no step in the Market quest is a plain multiple-choice question any more', () => {
    expect(q.scenes.filter((s) => s.type === 'choice')).toEqual([]);
    const wheel = q.scenes.find((s) => s.type === 'wheel') as WheelScene;
    expect(wheel.segments.filter((g) => g.challenge.kind === 'choice')).toEqual([]);
  });
  test('selecting or typing the address both work, in any spelling Excel accepts', () => {
    const s = spot('find-cell');
    for (const cell of ['B3', 'b3', ' $B$3 ', 'B$3']) expect(engine.evaluate(s, { cell }).correct).toBe(true);
  });
  test('a wrong cell gets feedback about what that cell actually holds', () => {
    const s = spot('find-cell');
    expect(engine.evaluate(s, { cell: 'C3' }).feedback).toMatch(/quantity sold/);
    expect(engine.evaluate(s, { cell: 'C5' }).feedback).toMatch(/C5 holds 22/);
    expect(engine.evaluate(s, { cell: 'A1' }).feedback).toMatch(/heading “Item”/);
  });
  test('outside the ledger, or not an address, is not counted as an attempt', () => {
    const s = spot('find-cell');
    for (const cell of ['D2', 'B9', 'B0', 'honey', '3B', '']) expect(engine.evaluate(s, { cell }).valid).toBe(false);
    // The working column next to the audit ledger is the player's, not evidence.
    expect(engine.evaluate(spot('audit-discrepancy'), { cell: 'E4' }).valid).toBe(false);
  });
  test('row steps accept any cell in the right row and nothing else', () => {
    const s = spot('audit-verdict');
    for (const cell of ['A4', 'B4', 'C4']) expect(engine.evaluate(s, { cell, working: '=B2-C2' }).correct).toBe(true);
    for (const cell of ['A2', 'B3', 'C5']) expect(engine.evaluate(s, { cell, working: '=B2-C2' }).correct).toBe(false);
  });
  test('the explanation step needs the cause (unsold stock), not the nearby numbers', () => {
    const s = spot('explain-restock');
    expect(engine.evaluate(s, { cell: 'D3' }).correct).toBe(true);
    for (const cell of ['B3', 'C3', 'F3', 'D2']) expect(engine.evaluate(s, { cell }).correct).toBe(false);
  });
  test('the wheel CELL segment is an evidence pick; ORDER is a formula that needs brackets', () => {
    const wheel = q.scenes.find((s) => s.type === 'wheel') as WheelScene;
    const cell = wheel.segments.find((g) => g.id === 'address')!.challenge as SpotTask;
    expect(engine.evaluateSpot(cell, 'C4').correct).toBe(true);
    expect(engine.evaluateSpot(cell, 'C3').correct).toBe(false);
    const order = wheel.segments.find((g) => g.id === 'order')!.challenge as Parameters<typeof engine.evaluateSheet>[0];
    expect(engine.evaluateSheet(order, '=(A2+B2)*C2').correct).toBe(true);
    expect(engine.evaluateSheet(order, '=A2+B2*C2').correct).toBe(false);
    expect(engine.evaluateSheet(order, '=36').correct).toBe(false);
  });
  test('content checks reject an answer on a heading or outside the ledger', () => {
    const bad = (answer: string[]) => ({ ...q, scenes: q.scenes.map((s) => (s.id === 'find-cell' ? { ...s, answer } : s)) }) as Quest;
    expect(validateQuest(bad(['B1'])).join('\n')).toMatch(/not a data cell/);
    expect(validateQuest(bad(['Z9'])).join('\n')).toMatch(/not a data cell/);
    expect(validateQuest(bad(['b3'])).join('\n')).toMatch(/not a cell address/);
  });
});

describe('game quests have one rating: the medal', () => {
  test('stars for a game quest mirror its medal, never a separate score', () => {
    expect(engine.isGameQuest(q)).toBe(true);
    const cases: [Record<string, number | 'reveal'>, string, number][] = [
      [{}, 'gold', 3],
      [{ 'error-runes': 'reveal' }, 'silver', 2],
      [{ 'audit-revenue': 'reveal', 'audit-tax': 'reveal', 'audit-discrepancy': 'reveal' }, 'none', 0],
    ];
    for (const [plan, medal, stars] of cases) {
      const run = playRun(9, plan);
      expect(engine.computeMedal(q, run)).toBe(medal);
      expect(engine.computeStars(q, run)).toBe(stars);
    }
  });
  test('wagers change neither the medal nor the stars', () => {
    const safe = playRun(4, { 'rune-max': 4 });
    const bold = playRun(4, { 'rune-max': 4 }, ['rune-max', 'rune-wheel', 'restock']);
    expect(engine.computeStars(q, bold)).toBe(engine.computeStars(q, safe));
    expect(engine.computeXp(q, bold)).toBe(engine.computeXp(q, safe));
  });
  test('course quests keep their star rules', () => {
    const course = loadAllQuests().get('missing-signal')!;
    expect(engine.isGameQuest(course)).toBe(false);
  });
});

describe('Evidence picks cannot be won by clicking until correct', () => {
  const spot = (id: string) => q.scenes.find((s) => s.id === id) as SpotScene;
  const wheel = q.scenes.find((s) => s.type === 'wheel') as WheelScene;
  test('each step allows at most half its candidates (never more than three) as wrong picks', () => {
    const tasks: SpotTask[] = [...q.scenes.filter((s): s is SpotScene => s.type === 'spot'), ...wheel.segments.flatMap((g) => (g.challenge.kind === 'spot' ? [g.challenge] : []))];
    for (const t of tasks) {
      expect(engine.pickLimit(t)).toBeLessThanOrEqual(Math.min(3, engine.pickCandidates(t) / 2));
      expect(engine.pickLimit(t)).toBeGreaterThanOrEqual(1);
    }
    expect(engine.pickLimit(spot('find-cell'))).toBe(3); // 15 cells
    expect(engine.pickLimit(spot('audit-verdict'))).toBe(2); // 4 rows
  });
  test('trying the same cell (or the same row) again is not counted', () => {
    let run = goTo('find-cell');
    run = engine.submitAnswer(q, run, { cell: 'C3' }).run;
    const again = engine.submitAnswer(q, run, { cell: 'c3' });
    expect(again.outcome.valid).toBe(false);
    expect(again.outcome.message).toMatch(/already tried C3/);
    expect(engine.resultFor(again.run, 'find-cell').attempts).toBe(1);
    let v = goTo('audit-verdict');
    v = engine.submitAnswer(q, v, { cell: 'A2', working: '=B2-C2' }).run;
    expect(engine.submitAnswer(q, v, { cell: 'C2', working: '=B2-C2' }).outcome.message).toMatch(/already showed row 2/);
  });
  test('wrong picks get evidence about that cell, never the answer address', () => {
    const run = goTo('find-cell');
    for (const cell of ['C3', 'A2', 'B5']) {
      const o = engine.submitAnswer(q, run, { cell }).outcome;
      expect(o.correct).toBe(false);
      expect(o.feedback).not.toMatch(/\bB3\b/);
    }
    const first = engine.submitAnswer(q, run, { cell: 'C3' }).outcome;
    expect(first.picksLeft).toBe(2);
    expect(first.hint).toBeTruthy(); // practice steps hint from the first miss
  });
  test('at the limit the answer is shown with its explanation; the step earns nothing', () => {
    let run = goTo('find-cell');
    let last = engine.submitAnswer(q, run, { cell: 'C3' });
    for (const cell of ['A2', 'B5']) { run = last.run; last = engine.submitAnswer(q, run, { cell }); }
    expect(last.outcome.locked).toBe(true);
    expect(last.outcome.explanation).toBeTruthy();
    const r = engine.resultFor(last.run, 'find-cell');
    expect(r).toEqual({ attempts: 3, solved: true, revealed: true });
    expect(engine.sceneXp(q, spot('find-cell'), r)).toBe(0);
    expect(engine.stepCredit(spot('find-cell'), r)).toBe(0);
    // Further submissions are refused, not counted.
    expect(engine.submitAnswer(q, last.run, { cell: 'B3' }).outcome.valid).toBe(false);
  });
  test('a locked evidence step rules out gold, like any revealed answer', () => {
    const run = playRun(6, { 'find-cell': 3 });
    expect(engine.resultFor(run, 'find-cell').revealed).toBe(true);
    expect(engine.computeMedal(q, run)).not.toBe('gold');
    expect(engine.isMastered(q, run)).toBe(true); // a practice round never takes the unlock away
  });
  test('the wheel evidence segment follows the same policy', () => {
    let run = goTo('rune-wheel');
    const seg = wheel.segments.find((g) => g.id === 'address')!;
    run = { ...run, spins: { ...run.spins, 'rune-wheel': seg.id } };
    for (const cell of ['A2', 'A3', 'A4']) run = engine.submitAnswer(q, run, { response: { cell } }).run;
    expect(engine.resultFor(run, 'rune-wheel')).toMatchObject({ solved: true, revealed: true });
  });
  test('picks survive save and reload; tampered picks are cleaned; a replay starts fresh', () => {
    let run = goTo('find-cell');
    run = engine.submitAnswer(q, run, { cell: 'C3' }).run;
    const restored = engine.restoreRun(q, JSON.parse(JSON.stringify(run)));
    expect(engine.picksMade(restored, 'find-cell')).toEqual(['C3']);
    expect(engine.submitAnswer(q, restored, { cell: 'C3' }).outcome.valid).toBe(false);
    const tampered = engine.restoreRun(q, { ...run, guesses: { 'find-cell': ['C3', 'x', 7, 'B2', 'A2', 'A3', 'A4'] } });
    expect(engine.picksMade(tampered, 'find-cell')).toEqual(['C3', 'B2', 'A2']);
    expect(engine.picksMade(engine.createRun(q, 2), 'find-cell')).toEqual([]);
  });
});

describe('The boss assesses the skill each step claims', () => {
  const spot = (id: string) => q.scenes.find((s) => s.id === id) as SpotScene;
  test('the missing-coins and verdict steps need a correct working formula before a pick counts', () => {
    const run = goTo('audit-discrepancy', 1);
    const answer = spot('audit-discrepancy').answer[0];
    const none = engine.submitAnswer(q, run, { cell: answer });
    expect(none.outcome.valid).toBe(false); // no working: nothing counted
    expect(engine.resultFor(none.run, 'audit-discrepancy').attempts).toBe(0);
    const typed = engine.submitAnswer(q, run, { cell: answer, working: '=150' });
    expect(typed.outcome.correct).toBe(false); // typed numbers are not a calculation
    expect(typed.outcome.feedback).toMatch(/checks your working first/);
    expect(engine.picksMade(typed.run, 'audit-discrepancy')).toEqual([]); // a failed calculation uses no pick
  });
  test('either an expected column or a difference column is accepted as working', () => {
    const run = goTo('audit-discrepancy', 1);
    const answer = engine.resolveScene(spot('audit-discrepancy'), run).answer[0];
    for (const working of ['=B2*C2', '=C2*B2', '=D2-B2*C2', '=B2*C2-D2']) {
      expect(engine.submitAnswer(q, run, { cell: answer, working }).outcome.correct, working).toBe(true);
    }
  });
  test('the verdict needs profit (revenue − cost), not revenue', () => {
    const run = goTo('audit-verdict', 1);
    const s = engine.resolveScene(spot('audit-verdict'), run);
    expect(engine.submitAnswer(q, run, { cell: s.answer[0], working: '=B2' }).outcome.correct).toBe(false);
    expect(engine.submitAnswer(q, run, { cell: s.answer[0], working: '=B2-C2' }).outcome.correct).toBe(true);
  });
  test('a wrong pick after correct working is told what the player’s own working shows', () => {
    const run = goTo('audit-verdict', 1);
    const s = engine.resolveScene(spot('audit-verdict'), run);
    const wrongRow = [2, 3, 4, 5].find((r) => r !== Number(s.answer[0].slice(1)))!;
    const o = engine.submitAnswer(q, run, { cell: `A${wrongRow}`, working: '=B2-C2' }).outcome;
    expect(o.feedback).toMatch(/your profit column shows/);
  });
  test('the recall step (rune-word) counts half in the boss score; formula steps count fully', () => {
    const rune = q.scenes.find((s) => s.id === 'audit-rune')!;
    expect(engine.isChallenge(rune) && rune.bossWeight).toBe(0.5);
    const missedRune = playRun(9, { 'audit-rune': 'reveal' });
    const missedFormula = playRun(9, { 'audit-revenue': 'reveal' });
    expect(engine.bossScore(q, missedRune)).toBeCloseTo(4 / 4.5, 3);
    expect(engine.bossScore(q, missedFormula)).toBeCloseTo(3.5 / 4.5, 3);
  });
});
