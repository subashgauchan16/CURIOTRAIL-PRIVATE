import { describe, expect, test } from 'vitest';
import * as engine from '../src/engine/game-engine';
import * as store from '../src/engine/progress-store';
import * as lab from '../src/engine/schema-lab';
import * as progression from '../src/engine/progression';
import { validateCurriculum, validateQuest, validateRequirements } from '../src/engine/quest-validation';
import type { Curriculum, LabModel, LessonScene, SchemaScene } from '../src/engine/types';
import { QUEST_IDS, loadAllQuests, loadQuest, loadWorld, memoryStorage, readJson } from './helpers';

const quests = loadAllQuests();
const world = loadWorld();
const curriculum = readJson<Curriculum>('public/data/curriculum.json');
const starQuest = loadQuest('star-chart');
const scene = starQuest.scenes.find((s): s is SchemaScene => s.type === 'schema')!;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- Helpers for building lab models ----
const solution = () => lab.solutionModel(scene);
const rel = (from: string, to: string, cardinality: LabModel['relationships'][number]['cardinality'] = 'many-to-one', direction: 'single' | 'both' = 'single', id = `x-${from}-${to}`) => {
  const [ft, fc] = from.split('.');
  const [tt, tc] = to.split('.');
  return { id, from: { table: ft, column: fc }, to: { table: tt, column: tc }, cardinality, direction };
};
const rules = (model: LabModel) => lab.validateModel(scene, model).issues.map((i) => `${i.severity}:${i.rule}`);

describe('theory cards (lessons)', () => {
  // Game-first quests teach in context instead of front-loading theory cards:
  // every challenge names its concepts, and each concept has a Codex card
  // (validated against public/data/codex.json in tests/game-mechanics.test.ts).
  test('every quest teaches: lesson cards, or concept-tagged challenges backed by the Codex', () => {
    for (const id of QUEST_IDS) {
      const q = loadQuest(id);
      const lessons = q.scenes.filter((s): s is LessonScene => s.type === 'lesson');
      if (!lessons.length) {
        const challenges = q.scenes.filter((s) => engine.isChallenge(s));
        expect(challenges.every((s) => s.type === 'wheel' || ((s as { concepts?: string[] }).concepts ?? []).length > 0), `${id}: untagged challenge`).toBe(true);
        continue;
      }
      for (const l of lessons) {
        expect(l.lesson.plainEnglish.length, `${id}/${l.id}`).toBeGreaterThan(120);
        expect(l.lesson.commonMistake.length).toBeGreaterThan(40);
        expect(l.skills.length).toBeGreaterThan(0);
      }
    }
  });

  test('the SQL GROUP BY lesson uses the coffee-shop example, not the challenge answer', () => {
    const groupBy = loadQuest('the-ledger').scenes.find((s) => s.id === 'lesson-group-by') as LessonScene;
    expect(groupBy.lesson.example!.code).toContain('GROUP BY product_name');
    const challenge = loadQuest('the-ledger').scenes.find((s) => s.id === 'group-products') as { solution: string };
    expect(groupBy.lesson.example!.code).not.toContain(challenge.solution.split('\n')[0]);
  });

  test('a lesson comes before the challenge it prepares for, and awards no XP', () => {
    const q = loadQuest('the-ledger');
    const ids = q.scenes.map((s) => s.id);
    expect(ids.indexOf('lesson-group-by')).toBe(ids.indexOf('group-products') - 1);
    let run = engine.createRun(q);
    while (engine.currentScene(q, run).type !== 'lesson') run = engine.advance(q, engine.isChallenge(engine.currentScene(q, run)) ? engine.submitAnswer(q, run, engine.correctAnswer(engine.currentScene(q, run))!).run : run);
    const before = engine.computeXp(q, run);
    expect(engine.canAdvance(q, run)).toBe(true);
    const after = engine.advance(q, run);
    expect(engine.computeXp(q, after)).toBe(before);
    expect(after.sceneId).toBe(q.scenes[after.sceneIndex].id);
  });

  test('a lesson with missing content is rejected by validation', () => {
    const broken = clone(loadQuest('the-ledger'));
    const l = broken.scenes.find((s) => s.type === 'lesson') as LessonScene;
    l.lesson.commonMistake = '';
    l.skills = ['nope'];
    const errors = validateQuest(broken).join('\n');
    expect(errors).toMatch(/lesson needs commonMistake/);
    expect(errors).toMatch(/unknown objective "nope"/);
  });

  test('reading a lesson is remembered once, without rewards', () => {
    let p = store.defaultProgress();
    p = store.withLessonRead(p, 'the-ledger/lesson-group-by');
    p = store.withLessonRead(p, 'the-ledger/lesson-group-by');
    expect(p.lessons).toEqual(['the-ledger/lesson-group-by']);
    expect(store.totalXp(p)).toBe(0);
    expect(store.withLessonRead(p, '<script>')).toBe(p);
    const s = store.createProgressStore(memoryStorage());
    s.save(p);
    expect(s.load().lessons).toEqual(['the-ledger/lesson-group-by']);
  });
});

describe('save migration v2 → v3 (lesson steps shift indices)', () => {
  test('a v2 player mid-quest resumes on the same step, with results and XP intact', () => {
    const q = quests.get('missing-signal')!;
    // v2 index 5 = "rumour"; in v3 content that step has moved to index 6.
    const v2Run = { questId: q.id, sceneIndex: 5, inspected: ['notice', 'ai-draft', 'message'], results: { 'find-source': { attempts: 1, solved: true, revealed: false }, 'spot-conflict': { attempts: 2, solved: true, revealed: false }, 'verify-time': { attempts: 3, solved: true, revealed: true } }, completed: false };
    const v2 = { version: 2, player: { name: 'Asha', emblem: 'owl' }, quests: { 'missing-signal': { run: v2Run, runXp: 25, lastRun: null, lastXp: 0, bestXp: 0, bestStars: 0, completed: false, completions: 0 } }, achievements: [], settings: { motion: 'system', textSize: 'normal', graphics: 'auto' } };
    const loaded = store.createProgressStore(memoryStorage({ [store.STORAGE_KEY]: JSON.stringify(v2) })).load();
    expect(loaded.version).toBe(store.SCHEMA_VERSION); // v2 → v3 → v4
    expect(loaded.player).toEqual({ name: 'Asha', emblem: 'owl' });
    expect(store.totalXp(loaded)).toBe(25);
    const run = engine.restoreRun(q, loaded.quests['missing-signal'].run);
    expect(engine.currentScene(q, run).id).toBe('rumour');
    expect(run.sceneIndex).toBe(q.scenes.findIndex((s) => s.id === 'rumour'));
    expect(engine.computeXp(q, run)).toBe(25);
  });

  test('a v2 completed quest keeps its completion, best XP and stars; unlocks still hold', () => {
    const q = quests.get('missing-signal')!;
    // A real finished v2 run: every challenge solved, evidence inspected, index 8 = "restore" in v2.
    const results = Object.fromEntries(q.scenes.filter((sc) => engine.isChallenge(sc)).map((sc) => [sc.id, { attempts: 1, solved: true, revealed: false }]));
    const done = { questId: q.id, sceneIndex: 8, inspected: ['notice', 'ai-draft', 'message'], results, completed: true };
    const v2 = { version: 2, player: { name: 'B', emblem: 'fox' }, quests: { 'missing-signal': { run: done, runXp: 125, lastRun: done, lastXp: 125, bestXp: 125, bestStars: 3, completed: true, completions: 1 } }, achievements: ['signal-restorer'], settings: {} };
    const loaded = store.sanitizeProgress(v2);
    expect(loaded.quests['missing-signal']).toMatchObject({ bestXp: 125, bestStars: 3, completed: true, completions: 1 });
    expect((loaded.quests['missing-signal'].lastRun as { sceneId?: string }).sceneId).toBe('restore');
    const restored = engine.restoreRun(q, loaded.quests['missing-signal'].lastRun);
    expect(restored.completed).toBe(true);
    expect(engine.currentScene(q, restored).id).toBe('restore');
    const workshop = world.destinations.find((d) => d.id === 'viking-workshop')!;
    expect(progression.destinationStatus(workshop, quests, loaded)).toBe('available');
  });

  test('new runs carry a stable step id', () => {
    const q = quests.get('broken-tally')!;
    let run = engine.createRun(q);
    expect(run.sceneId).toBe('arrive');
    run = engine.advance(q, run);
    expect(run.sceneId).toBe(q.scenes[1].id);
    expect(engine.restoreRun(q, { ...run, sceneIndex: 0 }).sceneId).toBe(run.sceneId); // id wins over index
  });
});

describe('data-modelling lab: validation rules', () => {
  test('the intended star schema passes every rule, with explanations', () => {
    const result = lab.validateModel(scene, solution());
    expect(result.correct).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.checks.every((c) => c.passed)).toBe(true);
    expect(result.checks.find((c) => c.rule === 'unique-dimension-key')!.detail).toContain('DimProduct.ProductKey: 4 unique values');
    expect(result.checks.find((c) => c.rule === 'keys-match')!.detail).toContain('All 10 values in FactSales.ProductKey match DimProduct.ProductKey');
  });

  test('cardinality is derived from the data', () => {
    const fact = lab.tableById(scene, 'FactSales')!;
    const product = lab.tableById(scene, 'DimProduct')!;
    const exp = lab.tableById(scene, 'ProductList_Export')!;
    expect(lab.detectCardinality(lab.columnValues(fact, 'ProductKey'), lab.columnValues(product, 'ProductKey'))).toBe('many-to-one');
    expect(lab.detectCardinality(lab.columnValues(product, 'ProductKey'), lab.columnValues(fact, 'ProductKey'))).toBe('one-to-many');
    expect(lab.detectCardinality(lab.columnValues(fact, 'ProductKey'), lab.columnValues(exp, 'ProductKey'))).toBe('many-to-many');
  });

  test('missing tables and missing fact table are reported', () => {
    const m = solution();
    m.placed = m.placed.filter((p) => p.table !== 'DimCountry');
    m.relationships = m.relationships.filter((r) => r.to.table !== 'DimCountry');
    m.factTable = null;
    expect(rules(m)).toEqual(expect.arrayContaining(['error:required-tables', 'error:fact-grain']));
  });

  test('an aggregated table cannot be the fact table (grain)', () => {
    const m = solution();
    m.placed.push({ table: 'MonthlySalesSummary', x: 0.5, y: 0.1 });
    m.factTable = 'MonthlySalesSummary';
    const issues = lab.validateModel(scene, m).issues;
    const grain = issues.find((i) => i.rule === 'fact-grain')!;
    expect(grain.text).toContain('One row per product per month');
    expect(grain.text).toContain('already summarised');
  });

  test('duplicate dimension keys create an accidental many-to-many', () => {
    const m = solution();
    m.placed.push({ table: 'ProductList_Export', x: 0.5, y: 0.1 });
    m.relationships = [rel('FactSales.ProductKey', 'ProductList_Export.ProductKey', 'many-to-many'), ...m.relationships.slice(1)];
    const issues = lab.validateModel(scene, m).issues;
    const m2m = issues.find((i) => i.rule === 'unique-dimension-key')!;
    expect(m2m.title).toMatch(/accidentally many-to-many/);
    expect(m2m.text).toContain("ProductKey isn’t unique");
    expect(rules(m)).toContain('error:connected'); // DimProduct is now unconnected
  });

  test('non-key columns, mismatched keys and dimension-to-dimension links are each explained', () => {
    const quantity = solution();
    quantity.relationships[2] = rel('FactSales.Quantity', 'DimCountry.CountryKey');
    expect(rules(quantity)).toContain('error:key-fields');

    const mismatch = solution();
    mismatch.relationships[2] = rel('FactSales.ProductKey', 'DimCountry.CountryKey', 'many-to-one');
    const text = lab.validateModel(scene, mismatch).issues.find((i) => i.rule === 'keys-match')!.text;
    expect(text).toMatch(/10 of 10 values in FactSales.ProductKey have no match/);

    const dimToDim = solution();
    dimToDim.relationships.push(rel('DimProduct.ProductKey', 'DimDate.DateKey', 'one-to-one'));
    expect(rules(dimToDim)).toContain('error:star-shape');
  });

  test('wrong or unset cardinality, and two-way filters, are rejected', () => {
    const unset = solution();
    unset.relationships[0].cardinality = null;
    expect(rules(unset)).toContain('error:cardinality');

    const wrong = solution();
    wrong.relationships[0].cardinality = 'one-to-one';
    expect(lab.validateModel(scene, wrong).issues.find((i) => i.rule === 'cardinality')!.text).toContain('FactSales.ProductKey repeats while DimProduct.ProductKey is unique');

    const both = solution();
    both.relationships[1].direction = 'both';
    expect(rules(both)).toContain('error:direction');
  });

  test('two relationships between the same tables are ambiguous', () => {
    const m = solution();
    m.relationships.push(rel('FactSales.SalesID', 'DimProduct.ProductKey', 'one-to-one'));
    expect(rules(m)).toContain('error:ambiguous');
  });

  test('connecting from the dimension side is fine if the cardinality matches', () => {
    const m = solution();
    m.relationships[0] = rel('DimProduct.ProductKey', 'FactSales.ProductKey', 'one-to-many');
    expect(lab.validateModel(scene, m).correct).toBe(true);
  });

  test('an unused extra table is only a warning', () => {
    const m = solution();
    m.placed.push({ table: 'MonthlySalesSummary', x: 0.5, y: 0.1 });
    const result = lab.validateModel(scene, m);
    expect(result.correct).toBe(true);
    expect(result.issues.map((i) => `${i.severity}:${i.rule}`)).toEqual(['warning:extra-table']);
  });

  test('the engine turns validation into feedback, hints and XP', () => {
    let run = engine.createRun(starQuest);
    while (engine.currentScene(starQuest, run).id !== 'build-star') {
      const sc = engine.currentScene(starQuest, run);
      if (engine.isChallenge(sc)) run = engine.submitAnswer(starQuest, run, engine.correctAnswer(sc)!).run;
      run = engine.advance(starQuest, run);
    }
    expect(engine.submitAnswer(starQuest, run, { model: lab.emptyModel() }).outcome.valid).toBe(false);
    const wrong = solution();
    wrong.relationships[0].direction = 'both';
    const first = engine.submitAnswer(starQuest, run, { model: wrong });
    expect(first.outcome.correct).toBe(false);
    expect(first.outcome.hint).toBe(scene.hints[0]);
    expect(first.outcome.issues!.some((i) => /single filter direction/.test(i.label))).toBe(true);
    const second = engine.submitAnswer(starQuest, first.run, { model: solution() });
    expect(second.outcome.correct).toBe(true);
    expect(engine.sceneXp(starQuest, scene, engine.resultFor(second.run, scene.id))).toBe(40); // second try: no bonus
  });
});

describe('data-modelling lab: interaction state', () => {
  const reduce = (state: lab.LabState, ...actions: lab.LabAction[]) => actions.reduce((s, a) => lab.labReducer(scene, s, a), state);

  test('adding, moving and removing tables', () => {
    let s = reduce(lab.initialLabState(), { type: 'add', table: 'FactSales' }, { type: 'add', table: 'DimProduct' }, { type: 'add', table: 'FactSales' });
    expect(s.model.placed.map((p) => p.table)).toEqual(['FactSales', 'DimProduct']);
    expect(s.model.placed[0]).toMatchObject({ x: 0.5, y: 0.5 });
    s = reduce(s, { type: 'nudge', table: 'DimProduct', dx: -5, dy: 0 }, { type: 'move', table: 'FactSales', x: 0.3, y: 2 });
    expect(s.model.placed[1].x).toBe(0);
    expect(s.model.placed[0]).toMatchObject({ x: 0.3, y: 1 });
    expect(reduce(s, { type: 'add', table: 'NotATable' })).toBe(s);
  });

  test('click-to-connect: select, switch, cancel, connect, refuse duplicates', () => {
    let s = reduce(lab.initialLabState(), { type: 'add', table: 'FactSales' }, { type: 'add', table: 'DimProduct' });
    s = reduce(s, { type: 'select-column', ref: { table: 'FactSales', column: 'Quantity' } });
    expect(s.pending).toEqual({ table: 'FactSales', column: 'Quantity' });
    s = reduce(s, { type: 'select-column', ref: { table: 'FactSales', column: 'ProductKey' } });
    expect(s.pending!.column).toBe('ProductKey'); // same table: switches the selection
    s = reduce(s, { type: 'select-column', ref: { table: 'FactSales', column: 'ProductKey' } });
    expect(s.pending).toBeNull(); // same column: cancels
    s = reduce(s, { type: 'select-column', ref: { table: 'FactSales', column: 'ProductKey' } }, { type: 'select-column', ref: { table: 'DimProduct', column: 'ProductKey' } });
    expect(s.model.relationships).toHaveLength(1);
    expect(s.model.relationships[0]).toMatchObject({ cardinality: null, direction: 'single' });
    s = reduce(s, { type: 'select-column', ref: { table: 'DimProduct', column: 'ProductKey' } }, { type: 'select-column', ref: { table: 'FactSales', column: 'ProductKey' } });
    expect(s.model.relationships).toHaveLength(1);
    expect(s.message).toMatch(/already connected/);
    // Columns of tables not in the workspace can't be selected.
    expect(reduce(s, { type: 'select-column', ref: { table: 'DimDate', column: 'DateKey' } })).toBe(s);
  });

  test('editing, removing and repairing relationships; removing a table removes its links', () => {
    let s = reduce(lab.initialLabState(), { type: 'add', table: 'FactSales' }, { type: 'add', table: 'DimCountry' }, { type: 'set-fact', table: 'FactSales' },
      { type: 'select-column', ref: { table: 'FactSales', column: 'Quantity' } }, { type: 'select-column', ref: { table: 'DimCountry', column: 'CountryKey' } });
    const id = s.model.relationships[0].id;
    s = reduce(s, { type: 'set-cardinality', id, value: 'many-to-one' }, { type: 'set-direction', id, value: 'both' });
    expect(s.model.relationships[0]).toMatchObject({ cardinality: 'many-to-one', direction: 'both' });
    s = reduce(s, { type: 'remove-relationship', id });
    expect(s.model.relationships).toHaveLength(0);
    s = reduce(s, { type: 'select-column', ref: { table: 'FactSales', column: 'CountryKey' } }, { type: 'select-column', ref: { table: 'DimCountry', column: 'CountryKey' } });
    expect(s.model.relationships[0].id).not.toBe(id); // ids are never reused
    s = reduce(s, { type: 'remove', table: 'FactSales' });
    expect(s.model).toEqual({ placed: [{ table: 'DimCountry', x: expect.any(Number), y: expect.any(Number) }], relationships: [], factTable: null });
  });

  test('reset clears everything; load restores a saved model', () => {
    const s = reduce(lab.initialLabState(), { type: 'load', model: solution() });
    expect(s.model.relationships).toHaveLength(3);
    expect(s.nextId).toBe(4);
    const r = reduce(s, { type: 'reset' });
    expect(r.model).toEqual(lab.emptyModel());
  });

  test('cleanModel drops tampered or invalid data', () => {
    const dirty = {
      placed: [{ table: 'FactSales', x: 5, y: -1 }, { table: 'FactSales', x: 0, y: 0 }, { table: 'Hacker', x: 0, y: 0 }, { table: 'DimDate', x: NaN, y: 0 }],
      relationships: [rel('FactSales.ProductKey', 'DimProduct.ProductKey'), rel('FactSales.Nope', 'FactSales.SalesID'), { from: 'x' }],
      factTable: 'Hacker',
    };
    expect(lab.cleanModel(scene, dirty)).toEqual({ placed: [{ table: 'FactSales', x: 1, y: 0 }], relationships: [], factTable: null });
    expect(lab.cleanModel(scene, null)).toEqual(lab.emptyModel());
  });

  test('a broken lab definition is caught by quest validation', () => {
    const broken = clone(starQuest);
    const sc = broken.scenes.find((s) => s.type === 'schema') as SchemaScene;
    sc.solution.relationships[0].cardinality = 'one-to-one';
    expect(validateQuest(broken).join('\n')).toMatch(/solution fails the model rules/);
  });
});

describe('prerequisites and curriculum', () => {
  test('The Star Chart needs the Jarl’s Dashboard (order) and The Ledger (prerequisite)', () => {
    const hall = world.destinations.find((d) => d.id === 'great-hall')!;
    const done = (p: store.Progress, id: string) => store.withCompletion(p, { ...engine.createRun(quests.get(id)!), completed: true }, 50, 2);
    let p = ['missing-signal', 'market-ledger', 'great-hall-dashboard'].reduce(done, store.defaultProgress());
    expect(progression.questStatus(starQuest, hall, p)).toBe('locked');
    expect(progression.questRequirement(starQuest, hall, quests, p)).toMatch(/The Ledger in the Woods/);
    p = done(p, 'the-ledger');
    expect(progression.questStatus(starQuest, hall, p)).toBe('available');
    expect(progression.questRequirement(starQuest, hall, quests, p)).toBe('');
  });

  test('quest prerequisites are valid and acyclic', () => {
    expect(validateRequirements([...quests.values()])).toEqual([]);
    const a = clone(starQuest);
    const b = clone(quests.get('the-ledger')!);
    b.requires = ['star-chart'];
    expect(validateRequirements([a, b]).join()).toMatch(/cycle/);
  });

  test('the curriculum is valid: eight modules, every quest in exactly one', () => {
    expect(validateCurriculum(curriculum, QUEST_IDS)).toEqual([]);
    expect(curriculum.modules.map((m) => m.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(progression.moduleForQuest(curriculum.modules, 'star-chart')!.id).toBe('data-modelling');
    expect(progression.moduleForQuest(curriculum.modules, 'the-ledger')!.id).toBe('sql-essentials');
  });

  test('module status comes only from real content', () => {
    const m = (id: string) => curriculum.modules.find((x) => x.id === id)!;
    const fresh = store.defaultProgress();
    expect(progression.moduleStatus(m('dax-core'), world, quests, fresh)).toBe('planned');
    expect(progression.moduleStatus(m('digital-foundations'), world, quests, fresh)).toBe('available');
    expect(progression.moduleStatus(m('data-modelling'), world, quests, fresh)).toBe('locked');
    let p = ['missing-signal', 'the-ledger'].reduce((acc, id) => store.withCompletion(acc, { ...engine.createRun(quests.get(id)!), completed: true }, 50, 2), fresh);
    expect(progression.moduleStatus(m('sql-essentials'), world, quests, p)).toBe('completed');
    p = store.withRun(fresh, { ...engine.createRun(quests.get('missing-signal')!), sceneIndex: 3 }, 10);
    expect(progression.moduleStatus(m('digital-foundations'), world, quests, p)).toBe('in-progress');
  });

  test('broken curricula are reported', () => {
    const bad = clone(curriculum);
    bad.modules[1].quests.push('missing-signal', 'ghost');
    bad.modules[2].requires = ['nowhere'];
    const errors = validateCurriculum(bad, QUEST_IDS).join('\n');
    expect(errors).toMatch(/"missing-signal" is in modules/);
    expect(errors).toMatch(/unknown quest "ghost"/);
    expect(errors).toMatch(/unknown module "nowhere"/);
  });
});
