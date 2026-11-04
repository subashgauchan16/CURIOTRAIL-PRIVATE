// Checks quest and world content is well formed, so a content mistake shows
// up in tests (or as a clear error) instead of as a broken quest.

import type { Codex, Quest, Run, SpotTask, World } from './types';
import type { Curriculum } from './types';
import { evaluate, correctAnswer, createRun, evaluateSheet, evaluateSpot, isChallenge, normaliseAddress, spotCell, tradeProfit } from './game-engine';
import { solutionModel, validateModel } from './schema-lab';
import { FUNCTION_NAMES } from './games/function-names';
import { isConceptId } from './games/mastery';
import * as rng from './games/rng';

const CHALLENGES = ['choice', 'assemble', 'sql', 'python', 'excel', 'kpi', 'schema', 'workshop', 'repair', 'runeword', 'wheel', 'match', 'gambit', 'spot'];
const SCENE_TYPES = new Set(['dialogue', 'evidence', 'lesson', 'ending', ...CHALLENGES]);

/** Can `text` be built exactly from the given fragments (each usable any number of times)? */
export function buildableFrom(text: string, tokens: string[]): boolean {
  const norm = (t: string) => t.toUpperCase().replace(/\s+/g, '');
  const target = norm(text);
  const parts = [...new Set(tokens.map(norm))].filter(Boolean);
  const ok: boolean[] = Array(target.length + 1).fill(false);
  ok[0] = true;
  for (let i = 0; i < target.length; i += 1) {
    if (!ok[i]) continue;
    for (const p of parts) if (target.startsWith(p, i)) ok[i + p.length] = true;
  }
  return ok[target.length];
}

/** A run forced onto a given data variant (index 0 = the step's default data). */
function runWithVariant(quest: Quest, sceneId: string, index: number): Run {
  // Search seeds deterministically until the variant draw lands on `index`.
  for (let seed = 1; seed < 5000; seed += 1) {
    const run = createRun(quest, seed);
    const scene = quest.scenes.find((s) => s.id === sceneId)!;
    const variants = (scene as { variants?: unknown[] }).variants || [];
    if (!variants.length) return run;
    // Same rule as variantIndex() in the engine.
    const { draw } = rng;
    if (Math.floor(draw(seed, `variant:${sceneId}`) * (variants.length + 1)) === index) return run;
  }
  throw new Error(`No seed reaches variant ${index} of ${sceneId}`);
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const duplicates = (ids: string[]) => ids.filter((id, i) => ids.indexOf(id) !== i);

export function validateQuest(quest: unknown): string[] {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);
  if (!quest || typeof quest !== 'object') return ['Quest is not an object.'];
  const q = quest as Quest;

  if (q.schemaVersion !== 1) fail('Unsupported schemaVersion.');
  if (!isText(q.id) || !/^[a-z0-9-]+$/.test(q.id)) fail('Quest id must be a lowercase slug.');
  for (const key of ['title', 'region', 'destination', 'subject', 'intro', 'takeaway'] as const) if (!isText(q[key])) fail(`Missing ${key}.`);
  if (!q.xp || !Number.isFinite(q.xp.completion) || !Number.isFinite(q.xp.firstTryBonus)) {
    fail('xp.completion and xp.firstTryBonus must be numbers.');
  }

  const objectives = Array.isArray(q.objectives) ? q.objectives : [];
  if (!objectives.length) fail('Quest needs at least one learning objective.');
  const objectiveIds = objectives.map((o) => o.id);
  duplicates(objectiveIds).forEach((id) => fail(`Duplicate objective id "${id}".`));
  objectives.forEach((o) => isText(o.label) || fail(`Objective "${o.id}" needs a label.`));

  const evidence = Array.isArray(q.evidence) ? q.evidence : [];
  const evidenceIds = evidence.map((e) => e.id);
  duplicates(evidenceIds).forEach((id) => fail(`Duplicate evidence id "${id}".`));
  evidence.forEach((e) => {
    if (!isText(e.title) || !isText(e.kindLabel) || !Array.isArray(e.body) || !e.body.length) {
      fail(`Evidence "${e.id}" needs a title, kindLabel and body.`);
    }
  });

  const characters = q.characters || {};
  const scenes = Array.isArray(q.scenes) ? q.scenes : [];
  if (!scenes.length) fail('Quest has no scenes.');
  duplicates(scenes.map((s) => s.id)).forEach((id) => fail(`Duplicate scene id "${id}".`));
  if (scenes.length && scenes[scenes.length - 1].type !== 'ending') fail('The last scene must be an ending.');
  if (scenes.filter((s) => s.type === 'ending').length > 1) fail('Only one ending scene is allowed.');

  const covered = new Set<string>();
  scenes.forEach((scene) => {
    const at = `Scene "${scene.id}"`;
    if (!SCENE_TYPES.has(scene.type)) { fail(`${at} has unknown type "${(scene as { type: string }).type}".`); return; }
    if (!isText(scene.title)) fail(`${at} needs a title.`);
    if (scene.speaker && !characters[scene.speaker]) fail(`${at} speaker "${scene.speaker}" is not a character.`);

    if (scene.type === 'evidence') {
      if (!Array.isArray(scene.evidence) || !scene.evidence.length) fail(`${at} lists no evidence.`);
      (scene.evidence || []).forEach((id) => evidenceIds.includes(id) || fail(`${at} references unknown evidence "${id}".`));
    }

    if (scene.type === 'lesson') {
      const l = scene.lesson;
      if (!l) { fail(`${at} has no lesson content.`); return; }
      for (const key of ['concept', 'objective', 'plainEnglish', 'analogy', 'whyItMatters', 'commonMistake', 'takeaway'] as const) {
        if (!isText(l[key])) fail(`${at} lesson needs ${key}.`);
      }
      if (l.example && !isText(l.example.code)) fail(`${at} lesson example needs code.`);
      if (!Array.isArray(scene.skills) || !scene.skills.length) fail(`${at} lesson must name the objectives it teaches.`);
      (scene.skills || []).forEach((id) => objectiveIds.includes(id) || fail(`${at} lesson references unknown objective "${id}".`));
    }

    if (CHALLENGES.includes(scene.type)) {
      const c = scene as Extract<typeof scene, { prompt: string }>;
      if (!isText(c.prompt)) fail(`${at} needs a prompt.`);
      if (!isText(c.explanation)) fail(`${at} needs an explanation.`);
      if (!Array.isArray(c.hints) || !c.hints.length) fail(`${at} needs at least one hint.`);
      if (!Number.isFinite(c.xp) || c.xp < 0) fail(`${at} needs a non-negative xp value.`);
      if (!Array.isArray(c.skills) || !c.skills.length) fail(`${at} must map to at least one objective.`);
      (c.skills || []).forEach((id) => {
        if (objectiveIds.includes(id)) covered.add(id);
        else fail(`${at} references unknown objective "${id}".`);
      });
    }

    if (scene.type === 'choice') {
      const options = Array.isArray(scene.options) ? scene.options : [];
      if (options.length < 2) fail(`${at} needs at least two options.`);
      duplicates(options.map((o) => o.id)).forEach((id) => fail(`${at} has duplicate option "${id}".`));
      if (!options.some((o) => o.id === scene.correct)) fail(`${at} correct answer "${scene.correct}" is not an option.`);
      options.forEach((o) => (isText(o.text) && isText(o.feedback)) || fail(`${at} option "${o.id}" needs text and feedback.`));
    }

    if (scene.type === 'assemble') {
      const slots = Array.isArray(scene.slots) ? scene.slots : [];
      if (!slots.length) fail(`${at} needs at least one slot.`);
      slots.forEach((slot) => {
        const options = Array.isArray(slot.options) ? slot.options : [];
        if (options.filter((o) => o.correct).length !== 1) fail(`${at} slot "${slot.id}" needs exactly one correct option.`);
        options.forEach((o) => {
          if (!isText(o.text)) fail(`${at} slot "${slot.id}" option "${o.id}" needs text.`);
          if (!o.correct && !isText(o.feedback)) fail(`${at} slot "${slot.id}" option "${o.id}" needs feedback.`);
        });
      });
      (scene.extras || []).forEach((extra) => {
        if (!isText(extra.text)) fail(`${at} extra "${extra.id}" needs text.`);
        if (!extra.supported && !isText(extra.feedback)) fail(`${at} extra "${extra.id}" needs feedback.`);
      });
    }

    if (scene.type === 'sql') {
      if (!isText(scene.setup) || !isText(scene.solution)) fail(`${at} needs setup SQL and a solution.`);
      if (!Array.isArray(scene.tables) || !scene.tables.length) fail(`${at} must show at least one table.`);
      if (!scene.expected || !Array.isArray(scene.expected.rows) || !scene.expected.rows.length) fail(`${at} needs expected rows.`);
      // The solution itself is executed against the setup in tests/sql-runner.test.ts.
    }

    if (scene.type === 'python' || scene.type === 'excel') {
      if (!isText(scene.solution)) fail(`${at} needs a solution.`);
      else {
        const result = evaluate(scene, correctAnswer(scene)!);
        if (!result.correct) fail(`${at} solution does not pass its own check: ${result.feedback ?? result.message}`);
      }
    }

    if (scene.type === 'schema') {
      const ids = (scene.tables || []).map((t) => t.id);
      duplicates(ids).forEach((id) => fail(`${at} has duplicate table "${id}".`));
      [...(scene.requiredTables || []), scene.factTable, ...(scene.dimensions || [])].forEach((id) => ids.includes(id) || fail(`${at} references unknown table "${id}".`));
      (scene.tables || []).forEach((t) => {
        if (!t.rows?.length || t.rows.some((r) => r.length !== t.columns.length)) fail(`${at} table "${t.id}" rows must match its columns.`);
      });
      if (scene.solution) {
        const result = validateModel(scene, solutionModel(scene));
        if (!result.correct) fail(`${at} solution fails the model rules: ${result.issues.filter((i) => i.severity === 'error').map((i) => i.title).join('; ')}`);
      } else fail(`${at} needs a solution.`);
    }

    if (isChallenge(scene)) {
      (scene.concepts || []).forEach((c) => isConceptId(c) || fail(`${at} has a malformed concept id "${c}".`));
    }

    if (scene.type === 'spot') {
      spotProblems(scene).forEach((p) => fail(`${at} ${p}`));
      (scene.variants || []).forEach((v, i) => {
        if (!Array.isArray(v.rows)) fail(`${at} variant ${i + 1} needs rows.`);
        else spotProblems({ ...scene, rows: v.rows, answer: v.answer ?? scene.answer }).forEach((p) => fail(`${at} variant ${i + 1} ${p}`));
      });
    }

    // Steps with data variants: the solution must pass on every variant.
    if (scene.type === 'workshop' || scene.type === 'repair' || scene.type === 'choice' || scene.type === 'spot') {
      const variants = scene.variants || [];
      for (let i = 0; i <= variants.length; i += 1) {
        if (i > 0 && (scene.type === 'workshop' || scene.type === 'repair') && (!variants[i - 1].expected || !Array.isArray(variants[i - 1].rows))) fail(`${at} variant ${i} needs rows and expected values.`);
        if (i > 0 && scene.type === 'choice' && variants[i - 1].correct && !scene.options.some((o) => o.id === variants[i - 1].correct)) fail(`${at} variant ${i} correct answer is not an option.`);
        if ((scene.type === 'choice' || scene.type === 'spot') && !variants.length) break;
        const run = runWithVariant(q, scene.id, i);
        const result = evaluate(scene, correctAnswer(scene, run)!, run);
        if (!result.correct) fail(`${at} solution does not pass its own check on data variant ${i}: ${result.feedback ?? result.message}`);
      }
    }

    if (scene.type === 'workshop') {
      if (!Array.isArray(scene.tokens) || scene.tokens.length < 3) fail(`${at} needs at least three fragments on the bench.`);
      else if (!buildableFrom(scene.solution, scene.tokens)) fail(`${at} solution cannot be built from its fragments.`);
    }

    if (scene.type === 'repair') {
      if (!scene.diagnoses?.some((d) => d.id === scene.correctDiagnosis)) fail(`${at} correct diagnosis is not an option.`);
      (scene.diagnoses || []).forEach((d) => (isText(d.text) && isText(d.feedback)) || fail(`${at} diagnosis "${d.id}" needs text and feedback.`));
      if (evaluateSheet(scene, scene.broken).correct) fail(`${at} broken formula is not actually broken.`);
      if (scene.check && !evaluateSheet({ ...scene, rows: scene.check.rows, expected: scene.check.expected }, scene.solution).correct) fail(`${at} solution fails the second dataset.`);
    }

    if (scene.type === 'runeword') {
      if (!FUNCTION_NAMES.has(String(scene.word).toUpperCase())) fail(`${at} word "${scene.word}" is not an Excel function name.`);
      if (!isText(scene.clue)) fail(`${at} needs a clue.`);
      if (!(scene.maxGuesses >= 3 && scene.maxGuesses <= 8)) fail(`${at} maxGuesses must be 3–8.`);
      if (!(scene.par >= 1 && scene.par <= scene.maxGuesses)) fail(`${at} par must be between 1 and maxGuesses.`);
    }

    if (scene.type === 'wheel') {
      const segments = Array.isArray(scene.segments) ? scene.segments : [];
      if (segments.length < 3) fail(`${at} needs at least three wheel segments.`);
      duplicates(segments.map((g) => g.id)).forEach((id) => fail(`${at} has duplicate segment "${id}".`));
      const index = scenes.indexOf(scene);
      const introduced = new Set(scenes.slice(0, index).flatMap((s) => (isChallenge(s) ? s.concepts || [] : [])));
      segments.forEach((g) => {
        if (!isText(g.label) || !isText(g.explanation) || !g.hints?.length) fail(`${at} segment "${g.id}" needs a label, hints and an explanation.`);
        // Recall rounds only draw on concepts the quest has already taught.
        (g.concepts || []).forEach((c) => introduced.has(c) || fail(`${at} segment "${g.id}" uses concept "${c}" before it is introduced.`));
        const c = g.challenge;
        if (c.kind === 'choice') {
          if (!c.options.some((o) => o.id === c.correct)) fail(`${at} segment "${g.id}" correct answer is not an option.`);
        } else if (c.kind === 'spot') {
          spotProblems(c).forEach((p) => fail(`${at} segment "${g.id}" ${p}`));
        } else if (!evaluateSheet(c, c.solution).correct) fail(`${at} segment "${g.id}" solution fails its own check.`);
      });
    }

    if (scene.type === 'match') {
      const leftIds = (scene.left || []).map((l) => l.id);
      const rightIds = (scene.right || []).map((r) => r.id);
      if (leftIds.length < 3) fail(`${at} needs at least three pairs.`);
      leftIds.forEach((id) => {
        if (!rightIds.includes(scene.pairs?.[id])) fail(`${at} pair for "${id}" points to an unknown item.`);
        if (!isText(scene.feedback?.[id])) fail(`${at} needs feedback for "${id}".`);
      });
      duplicates(leftIds.map((id) => scene.pairs?.[id])).forEach((id) => fail(`${at} right item "${id}" is used twice.`));
    }

    if (scene.type === 'gambit') {
      const items = scene.items || [];
      if (items.length < 2) fail(`${at} needs at least two items.`);
      const orders = scene.solution?.orders || [];
      const spend = items.reduce((s, it, i) => s + it.cost * (orders[i] ?? 0), 0);
      const profit = items.reduce((s, it, i) => s + tradeProfit(it, orders[i] ?? 0), 0);
      if (spend > scene.purse) fail(`${at} solution overspends the purse.`);
      if (profit < scene.targetProfit) fail(`${at} solution misses the target profit.`);
      const result = evaluate(scene, correctAnswer(scene)!);
      if (!result.correct) fail(`${at} solution fails its own check: ${result.feedback}`);
    }

    if (scene.type === 'kpi') {
      const ids = (scene.categories || []).map((c) => c.id);
      if (ids.length < 2) fail(`${at} needs at least two categories.`);
      (scene.cards || []).forEach((card) => {
        if (!ids.includes(card.category)) fail(`${at} card "${card.id}" has an unknown category.`);
        if (!isText(card.feedback)) fail(`${at} card "${card.id}" needs feedback.`);
      });
      if ((scene.cards || []).length < 3) fail(`${at} needs at least three cards.`);
    }
  });

  objectiveIds.filter((id) => !covered.has(id)).forEach((id) => fail(`Objective "${id}" is never assessed.`));
  const boss = scenes.filter((s) => isChallenge(s) && s.boss);
  if (boss.length && boss.length < 3) fail('A boss mission needs at least three steps.');
  if (q.mastery && !(q.mastery.threshold > 0 && q.mastery.threshold <= q.mastery.gold && q.mastery.gold <= 1)) fail('mastery thresholds must satisfy 0 < threshold ≤ gold ≤ 1.');
  return errors;
}

/** Every concept a quest uses must have a Codex card, so the player can always look it up. */
export function validateCodex(codex: unknown, quests: Quest[]): string[] {
  const errors: string[] = [];
  const c = codex as Codex | null;
  if (!c || c.schemaVersion !== 1 || !c.entries || typeof c.entries !== 'object') return ['Codex is missing or has an unsupported schemaVersion.'];
  for (const [id, e] of Object.entries(c.entries)) {
    if (!isConceptId(id)) errors.push(`Codex id "${id}" is malformed.`);
    if (!isText(e.title) || !isText(e.summary) || !e.ref || !isText(e.ref.volume) || !isText(e.ref.chapter)) errors.push(`Codex entry "${id}" needs a title, summary and reference.`);
  }
  for (const q of quests) {
    for (const s of q.scenes) {
      const ids = isChallenge(s) ? [...(s.concepts || []), ...(s.type === 'wheel' ? s.segments.flatMap((g) => g.concepts) : [])] : [];
      ids.forEach((id) => c.entries[id] || errors.push(`Quest "${q.id}" step "${s.id}" uses concept "${id}" with no Codex entry.`));
    }
  }
  return [...new Set(errors)];
}

export function validateWorld(world: unknown, questIds: string[] = []): string[] {
  const errors: string[] = [];
  const w = world as World | null;
  const destinations = w && Array.isArray(w.destinations) ? w.destinations : [];
  if (!destinations.length) return ['World has no destinations.'];
  duplicates(destinations.map((d) => d.id)).forEach((id) => errors.push(`Duplicate destination id "${id}".`));
  destinations.forEach((d) => {
    if (!isText(d.name) || !isText(d.theme)) errors.push(`Destination "${d.id}" needs a name and theme.`);
    if (!Array.isArray(d.position) || d.position.length !== 2 || !d.position.every(Number.isFinite)) {
      errors.push(`Destination "${d.id}" needs an [x, z] position.`);
    }
    (d.quests || []).forEach((q) => questIds.includes(q) || errors.push(`Destination "${d.id}" references unknown quest "${q}".`));
    if (d.unlockedBy !== 'planned') {
      if (!Array.isArray(d.unlockedBy)) errors.push(`Destination "${d.id}" needs unlockedBy (array or "planned").`);
      else d.unlockedBy.forEach((q) => questIds.includes(q) || errors.push(`Destination "${d.id}" is unlocked by unknown quest "${q}".`));
      if (!d.quests?.length) errors.push(`Destination "${d.id}" is not planned but has no quests.`);
    }
  });
  const order = w?.recommendedOrder;
  if (order !== undefined) {
    if (!Array.isArray(order)) errors.push('recommendedOrder must be a list of quest ids.');
    else {
      order.forEach((q) => questIds.includes(q) || errors.push(`recommendedOrder references unknown quest "${q}".`));
      duplicates(order).forEach((q) => errors.push(`recommendedOrder lists "${q}" twice.`));
    }
  }
  return errors;
}

/** Quest prerequisites must exist and must not form a cycle. */
export function validateRequirements(quests: Quest[]): string[] {
  const errors: string[] = [];
  const ids = new Set(quests.map((q) => q.id));
  for (const q of quests) (q.requires || []).forEach((r) => ids.has(r) || errors.push(`Quest "${q.id}" requires unknown quest "${r}".`));
  const byId = new Map(quests.map((q) => [q.id, q]));
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string): boolean => {
    if (done.has(id)) return true;
    if (visiting.has(id)) return false;
    visiting.add(id);
    const ok = (byId.get(id)?.requires || []).every(visit);
    visiting.delete(id);
    done.add(id);
    return ok;
  };
  for (const q of quests) if (!visit(q.id)) errors.push(`Quest prerequisites form a cycle involving "${q.id}".`);
  return [...new Set(errors)];
}

export function validateCurriculum(curriculum: unknown, questIds: string[]): string[] {
  const errors: string[] = [];
  const c = curriculum as Curriculum | null;
  const modules = c && Array.isArray(c.modules) ? c.modules : [];
  if (!modules.length) return ['Curriculum has no modules.'];
  const moduleIds = modules.map((m) => m.id);
  duplicates(moduleIds).forEach((id) => errors.push(`Duplicate module id "${id}".`));
  duplicates(modules.map((m) => String(m.number))).forEach((n) => errors.push(`Duplicate module number ${n}.`));
  const seen = new Map<string, string>();
  for (const m of modules) {
    if (!isText(m.title) || !isText(m.subject) || !isText(m.summary)) errors.push(`Module "${m.id}" needs a title, subject and summary.`);
    if (!['Beginner', 'Intermediate', 'Advanced', 'Capstone'].includes(m.level)) errors.push(`Module "${m.id}" has an unknown level.`);
    (m.quests || []).forEach((q) => {
      if (!questIds.includes(q)) errors.push(`Module "${m.id}" lists unknown quest "${q}".`);
      if (seen.has(q)) errors.push(`Quest "${q}" is in modules "${seen.get(q)}" and "${m.id}".`);
      seen.set(q, m.id);
    });
    (m.requires || []).forEach((r) => moduleIds.includes(r) || errors.push(`Module "${m.id}" requires unknown module "${r}".`));
    if (!(m.quests || []).length && !(m.planned || []).length) errors.push(`Module "${m.id}" has neither quests nor planned topics.`);
  }
  questIds.filter((q) => !seen.has(q)).forEach((q) => errors.push(`Quest "${q}" is not in any module.`));
  return errors;
}

/** An evidence ledger must be rectangular and its answer cells must be inside it, not headings. */
function spotProblems(task: SpotTask): string[] {
  const problems: string[] = [];
  if (!Array.isArray(task.columns) || task.columns.length < 2) problems.push('needs at least two columns.');
  if (!Array.isArray(task.rows) || !task.rows.length || task.rows.some((r) => r.length !== task.columns?.length)) problems.push('rows must match its columns.');
  if (task.select !== 'cell' && task.select !== 'row') problems.push('select must be "cell" or "row".');
  if (!Array.isArray(task.answer) || !task.answer.length) problems.push('needs at least one answer cell.');
  for (const a of task.answer || []) {
    const cell = normaliseAddress(a);
    if (!cell || cell !== a) problems.push(`answer "${a}" is not a cell address.`);
    else if (!problems.length) {
      const where = spotCell(task, cell);
      if (!where.inside || where.header) problems.push(`answer ${cell} is not a data cell of the ledger.`);
      else if (!evaluateSpot(task, cell).correct) problems.push(`answer ${cell} does not pass its own check.`);
    }
  }
  return problems;
}
