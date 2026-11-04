import { describe, expect, test } from 'vitest';
import * as engine from '../src/engine/game-engine';
import type { Answer, Quest, Run } from '../src/engine/types';
import { QUEST_IDS, loadQuest } from './helpers';

const quest = loadQuest();

// Answers for sql scenes need the query result; tests feed the expected rows.
function answerFor(scene: ReturnType<typeof engine.currentScene>, run?: Run): Answer {
  if (scene.type === 'sql') return { query: scene.solution, result: { columns: ['a', 'b'], rows: scene.expected.rows } };
  return engine.correctAnswer(scene, run)!;
}

/** Wheel steps must be spun before they can be answered. */
function prepare(q: Quest, run: Run): Run {
  return engine.currentScene(q, run).type === 'wheel' ? engine.spinWheel(q, run) : run;
}

function playPerfectly(q: Quest = quest): Run {
  let run = engine.createRun(q);
  while (!run.completed) {
    const scene = engine.currentScene(q, run);
    if (scene.type === 'evidence') for (const id of scene.evidence) run = engine.inspectEvidence(q, run, id);
    if (engine.isChallenge(scene)) {
      run = prepare(q, run);
      const { run: next, outcome } = engine.submitAnswer(q, run, answerFor(scene, run));
      expect(outcome.correct, `correct answer accepted for ${q.id}/${scene.id}: ${outcome.feedback}`).toBe(true);
      run = next;
    }
    const before = run;
    run = engine.advance(q, run);
    expect(run, `advanced past ${scene.id}`).not.toBe(before);
  }
  return run;
}

function goTo(sceneId: string, q: Quest = quest): Run {
  let run = engine.createRun(q);
  while (engine.currentScene(q, run).id !== sceneId) {
    const scene = engine.currentScene(q, run);
    if (scene.type === 'evidence') scene.evidence.forEach((id) => { run = engine.inspectEvidence(q, run, id); });
    if (engine.isChallenge(scene)) { run = prepare(q, run); run = engine.submitAnswer(q, run, answerFor(scene, run)).run; }
    run = engine.advance(q, run);
  }
  return run;
}

describe('The Missing Signal (ported from the original suite)', () => {
  test('a perfect playthrough completes with maximum XP and 3 stars', () => {
    const run = playPerfectly();
    expect(run.completed).toBe(true);
    expect(engine.computeXp(quest, run)).toBe(engine.maxXp(quest));
    expect(engine.computeStars(quest, run)).toBe(3);
    expect(engine.skillReport(quest, run).every((s) => s.status === 'demonstrated')).toBe(true);
  });

  test('evidence must all be inspected before continuing', () => {
    let run = goTo('investigate');
    expect(engine.canAdvance(quest, run)).toBe(false);
    run = engine.inspectEvidence(quest, run, 'notice');
    run = engine.inspectEvidence(quest, run, 'notice');
    expect(run.inspected).toEqual(['notice']);
    expect(engine.advance(quest, run)).toBe(run);
    run = engine.inspectEvidence(quest, run, 'ai-draft');
    run = engine.inspectEvidence(quest, run, 'message');
    expect(engine.canAdvance(quest, run)).toBe(true);
  });

  test('unknown evidence ids are ignored', () => {
    const run = goTo('investigate');
    expect(engine.inspectEvidence(quest, run, 'nope')).toBe(run);
  });

  test('a challenge cannot be skipped without solving it', () => {
    const run = goTo('verify-time');
    expect(engine.canAdvance(quest, run)).toBe(false);
    expect(engine.advance(quest, run)).toBe(run);
  });

  test('submitting nothing does not count as an attempt', () => {
    const run = goTo('verify-time');
    const { run: after, outcome } = engine.submitAnswer(quest, run, undefined as unknown as Answer);
    expect(outcome.valid).toBe(false);
    expect(after).toBe(run);
  });

  test('wrong answers give option feedback, progressive hints and then a reveal', () => {
    let run = goTo('verify-time');
    const scene = engine.currentScene(quest, run) as { hints: string[]; id: string };

    let result = engine.submitAnswer(quest, run, 'trust-ai');
    expect(result.outcome.correct).toBe(false);
    expect(result.outcome.feedback).toMatch(/confident/i);
    expect(result.outcome.hint).toBe(scene.hints[0]);
    expect(result.outcome.canReveal).toBe(false);
    run = result.run;

    result = engine.submitAnswer(quest, run, 'average');
    expect(result.outcome.hint).toBe(scene.hints[1]);
    run = result.run;

    expect(engine.revealAnswer(quest, run)).toBe(run);
    result = engine.submitAnswer(quest, run, 'reasonable');
    expect(result.outcome.hint).toBe(scene.hints[1]);
    expect(result.outcome.canReveal).toBe(true);
    run = engine.revealAnswer(quest, result.run);
    expect(engine.resultFor(run, scene.id)).toEqual({ attempts: 3, solved: true, revealed: true });
    expect(engine.canAdvance(quest, run)).toBe(true);
  });

  test('XP: first-try bonus, retry still earns base XP, reveal earns none', () => {
    const scene = quest.scenes.find((s) => s.id === 'verify-time')!;
    const xp = (scene as { xp: number }).xp;
    expect(engine.sceneXp(quest, scene, { attempts: 1, solved: true, revealed: false })).toBe(xp + quest.xp.firstTryBonus);
    expect(engine.sceneXp(quest, scene, { attempts: 2, solved: true, revealed: false })).toBe(xp);
    expect(engine.sceneXp(quest, scene, { attempts: 3, solved: true, revealed: true })).toBe(0);
    expect(engine.sceneXp(quest, scene, { attempts: 2, solved: false, revealed: false })).toBe(0);
  });

  test('a solved challenge cannot be re-submitted for more attempts', () => {
    let run = goTo('find-source');
    run = engine.submitAnswer(quest, run, 'notice').run;
    const again = engine.submitAnswer(quest, run, 'ai-draft');
    expect(again.outcome.valid).toBe(false);
    expect(again.run).toBe(run);
  });

  test('assemble: lists every unsupported line and requires every slot', () => {
    let run = goTo('assemble');
    const incomplete = engine.submitAnswer(quest, run, { slots: { time: '1400' }, extras: [] });
    expect(incomplete.outcome.valid).toBe(false);
    expect(incomplete.outcome.message).toMatch(/Laptops/);

    const wrong = engine.submitAnswer(quest, run, { slots: { time: '1500', laptops: 'borrow', registration: 'none' }, extras: ['free', 'lunch'] });
    expect(wrong.outcome.correct).toBe(false);
    expect(wrong.outcome.issues!.map((i) => i.id)).toEqual(['time', 'registration', 'lunch']);
    run = wrong.run;

    const right = engine.submitAnswer(quest, run, { slots: { time: '1400', laptops: 'borrow', registration: 'desk' }, extras: ['beginners'] });
    expect(right.outcome.correct).toBe(true);
    expect(right.outcome.explanation).toBeTruthy();
  });

  test('skill report distinguishes hints and reveals', () => {
    let run = goTo('find-source');
    run = engine.submitAnswer(quest, run, 'message').run;
    run = engine.submitAnswer(quest, run, 'notice').run;
    const report = Object.fromEntries(engine.skillReport(quest, run).map((s) => [s.id, s.status]));
    expect(report['identify-contradiction']).toBe('not-yet');
    expect(report['distinguish-source']).toBe('not-yet');

    const full = playPerfectly();
    const withHint = { ...full, results: { ...full.results, rumour: { attempts: 2, solved: true, revealed: false } } };
    const withReveal = { ...full, results: { ...full.results, 'better-prompt': { attempts: 3, solved: true, revealed: true } } };
    const hintReport = Object.fromEntries(engine.skillReport(quest, withHint).map((s) => [s.id, s.status]));
    const revealReport = Object.fromEntries(engine.skillReport(quest, withReveal).map((s) => [s.id, s.status]));
    expect(hintReport['distinguish-source']).toBe('with-hints');
    expect(hintReport['verify-claims']).toBe('with-hints');
    expect(revealReport['prompt-context']).toBe('reviewed');
    expect(engine.computeStars(quest, withHint)).toBe(2);
    expect(engine.computeStars(quest, withReveal)).toBe(1);
  });

  test('restoreRun keeps valid progress and rejects tampered data', () => {
    const run = goTo('rumour');
    expect(engine.restoreRun(quest, JSON.parse(JSON.stringify(run)))).toEqual(run);
    expect(engine.restoreRun(quest, null)).toEqual(engine.createRun(quest));
    expect(engine.restoreRun(quest, { questId: 'other' })).toEqual(engine.createRun(quest));

    const skipped = engine.restoreRun(quest, { questId: quest.id, sceneIndex: 7, inspected: ['notice', 'bogus'], results: {} });
    expect(engine.currentScene(quest, skipped).id).toBe('investigate');
    expect(skipped.inspected).toEqual(['notice']);

    const clamped = engine.restoreRun(quest, { questId: quest.id, sceneIndex: 999, inspected: [], results: {} });
    expect(clamped.sceneIndex).toBeLessThan(quest.scenes.length);

    const fakeCompletion = engine.restoreRun(quest, { questId: quest.id, sceneIndex: 0, completed: true });
    expect(fakeCompletion.completed).toBe(false);
  });

  test('levels', () => {
    expect(engine.levelFor(0).name).toBe('Newcomer');
    expect(engine.levelFor(39).level).toBe(1);
    expect(engine.levelFor(40).name).toBe('Scout');
    expect(engine.levelFor(engine.maxXp(quest)).name).toBe('Trailblazer');
    expect(engine.levelFor(100000).next).toBeNull();
  });
});

describe('every quest', () => {
  test.each(QUEST_IDS)('%s can be completed perfectly for full XP and 3 stars', (id) => {
    const q = loadQuest(id);
    const run = playPerfectly(q);
    expect(engine.computeXp(q, run)).toBe(engine.maxXp(q));
    expect(engine.computeStars(q, run)).toBe(3);
  });

  test('stars are 0 for an unfinished run', () => {
    expect(engine.computeStars(quest, goTo('rumour'))).toBe(0);
  });
});

describe('SQL challenges (engine side)', () => {
  const q = loadQuest('the-ledger');
  test('wrong rows, missing keywords and database errors are each explained', () => {
    const run = goTo('group-products', q);
    const error = engine.submitAnswer(q, run, { query: 'SELEC product', error: 'near "SELEC": syntax error' });
    expect(error.outcome.correct).toBe(false);
    expect(error.outcome.output).toMatch(/syntax error/);
    expect(error.outcome.attempts).toBe(1);

    const noGroup = engine.submitAnswer(q, error.run, { query: "SELECT 'Lantern', 1240", result: { columns: ['a', 'b'], rows: [['Lantern', 1240], ['Map', 540], ['Compass', 490]] } });
    expect(noGroup.outcome.correct).toBe(false);
    expect(noGroup.outcome.feedback).toMatch(/GROUP BY/);

    const wrongCount = engine.submitAnswer(q, noGroup.run, { query: 'SELECT product, SUM(revenue) FROM sales GROUP BY region', result: { columns: ['p', 's'], rows: [['Map', 1], ['Lantern', 2]] } });
    expect(wrongCount.outcome.feedback).toMatch(/returned 2 rows; we expected 3/);
    expect(wrongCount.outcome.canReveal).toBe(true);
  });

  test('ordered results must be in order', () => {
    const run = goTo('top-product', q);
    const out = engine.submitAnswer(q, run, { query: 'SELECT product, SUM(revenue) t FROM sales GROUP BY product', result: { columns: ['p', 't'], rows: [['Lantern', 1240], ['Map', 540], ['Compass', 490]] } });
    expect(out.outcome.correct).toBe(false);
    expect(out.outcome.feedback).toMatch(/returned 3 rows; we expected 1/);
  });

  test('an empty query is not an attempt', () => {
    const run = goTo('filter-north', q);
    expect(engine.submitAnswer(q, run, { query: '   ' }).outcome.valid).toBe(false);
  });
});

describe('Python challenges', () => {
  const q = loadQuest('broken-tally');
  test('the original bug reproduces the real TypeError', () => {
    const run = goTo('fix-print', q);
    const out = engine.submitAnswer(q, run, { expression: '"Total shields: " + total' });
    expect(out.outcome.correct).toBe(false);
    expect(out.outcome.output).toBe('TypeError: can only concatenate str (not "int") to str');
  });
  test('hard-coding the answer is rejected even though it prints correctly', () => {
    const run = goTo('fix-print', q);
    const out = engine.submitAnswer(q, run, { expression: '"Total shields: 32"' });
    expect(out.outcome.correct).toBe(false);
    expect(out.outcome.feedback).toMatch(/typed in by hand/);
  });
  test('alternative correct expressions are accepted', () => {
    const run = goTo('average', q);
    expect(engine.submitAnswer(q, run, { expression: 'sum(orders)/len(orders)' }).outcome.correct).toBe(true);
    expect(engine.submitAnswer(q, run, { expression: '(orders[0]+orders[1]+orders[2]+orders[3])/4' }).outcome.correct).toBe(true);
    expect(engine.submitAnswer(q, run, { expression: 'sum(orders)/3' }).outcome.correct).toBe(false);
  });
  test('the printed output is shown for a correct answer', () => {
    const run = goTo('average', q);
    expect(engine.submitAnswer(q, run, { expression: 'sum(orders) / len(orders)' }).outcome.output).toBe('8.0');
  });
});

describe('Excel challenges', () => {
  const q = loadQuest('market-ledger');
  test('a formula is filled down and every row is checked', () => {
    const run = goTo('row-revenue', q);
    const good = engine.submitAnswer(q, run, { formula: '=b2*c2' });
    expect(good.outcome.correct).toBe(true);
    expect(good.outcome.output).toContain('D5 = 110');
    const absolute = engine.submitAnswer(q, run, { formula: '=$B$2*$C$2' });
    expect(absolute.outcome.correct).toBe(false);
    expect(absolute.outcome.issues!.map((i) => i.id)).toEqual(['D3', 'D4', 'D5']);
  });
  test('typed numbers, missing = and unknown functions are explained', () => {
    const run = goTo('total', q);
    expect(engine.submitAnswer(q, run, { formula: '=150+120+120+110' }).outcome.feedback).toMatch(/only uses typed numbers/);
    expect(engine.submitAnswer(q, run, { formula: 'SUM(D2:D5)' }).outcome.feedback).toMatch(/must start with "="/);
    expect(engine.submitAnswer(q, run, { formula: '=SUMM(D2:D5)' }).outcome.output).toBe('#NAME?');
    expect(engine.submitAnswer(q, run, { formula: '=D2+D3+D4+D5' }).outcome.feedback).toMatch(/SUM function/);
    expect(engine.submitAnswer(q, run, { formula: '=SUM(D2:D5)' }).outcome.correct).toBe(true);
  });
});

describe('KPI challenges', () => {
  const q = loadQuest('great-hall-dashboard');
  test('every card must be placed, and misplaced cards are explained individually', () => {
    const run = goTo('sort-kpis', q);
    expect(engine.submitAnswer(q, run, { placement: { sales: 'revenue' } }).outcome.valid).toBe(false);
    const placement = { ...(engine.correctAnswer(engine.currentScene(q, run)) as { placement: Record<string, string> }).placement };
    placement.margin = 'revenue';
    placement.delivery = 'profitability';
    const out = engine.submitAnswer(q, run, { placement });
    expect(out.outcome.correct).toBe(false);
    expect(out.outcome.issues!.map((i) => i.id).sort()).toEqual(['delivery', 'margin']);
  });
});
