// Pure game rules. No DOM, no React, no Three.js, no storage: every function
// takes state and returns new state, so the interface and 3D world can change
// without touching quests, and every rule is unit-tested.

import type {
  Answer, AssembleScene, ChallengeResult, ChallengeScene, ChoiceScene, ExcelScene, Issue,
  KpiScene, Outcome, PythonScene, Quest, Run, Scene, SchemaScene, SqlScene,
} from './types';
import { evaluatePython, str as pyStr, toJs } from './python-lite';
import { evaluateFormula, fillFormula, makeSheet, splitRef } from './excel-lite';
import { compareRows, formatTable } from './sql-check';
import { cleanModel, solutionModel, validateModel } from './schema-lab';

export const CHALLENGE_TYPES = new Set(['choice', 'assemble', 'sql', 'python', 'excel', 'kpi', 'schema']);
export const REVEAL_AFTER_ATTEMPTS = 3;

export const LEVELS = [
  { min: 0, name: 'Newcomer' },
  { min: 40, name: 'Scout' },
  { min: 100, name: 'Trailblazer' },
  { min: 200, name: 'Wayfinder' },
  { min: 320, name: 'Navigator' },
  { min: 480, name: 'Cartographer' },
];

export function isChallenge(scene: Scene | undefined): scene is ChallengeScene {
  return Boolean(scene) && CHALLENGE_TYPES.has(scene!.type);
}

export function createRun(quest: Quest): Run {
  return { questId: quest.id, sceneIndex: 0, sceneId: quest.scenes[0]?.id, inspected: [], results: {}, completed: false };
}

/** Stable key for a lesson, used to remember which lessons a player has read. */
export function lessonKey(quest: Quest, scene: Scene): string {
  return `${quest.id}/${scene.id}`;
}

// Rebuild a run from saved (untrusted) data, discarding anything that no
// longer matches the quest. Falls back to a fresh run when unusable.
export function restoreRun(quest: Quest, saved: unknown): Run {
  const s = saved as Partial<Run> | null;
  if (!s || typeof s !== 'object' || s.questId !== quest.id) return createRun(quest);
  const last = quest.scenes.length - 1;
  // Prefer the stable step id: indices shift when content (e.g. lessons) is added.
  const byId = typeof s.sceneId === 'string' ? quest.scenes.findIndex((sc) => sc.id === s.sceneId) : -1;
  const index = byId >= 0 ? byId : Number.isInteger(s.sceneIndex) ? Math.min(Math.max(s.sceneIndex!, 0), last) : 0;
  const evidenceIds = new Set(quest.evidence.map((e) => e.id));
  const inspected = Array.isArray(s.inspected)
    ? [...new Set(s.inspected.filter((id): id is string => typeof id === 'string' && evidenceIds.has(id)))]
    : [];
  const results: Record<string, ChallengeResult> = {};
  for (const scene of quest.scenes.filter(isChallenge)) {
    const r = s.results && (s.results as Record<string, unknown>)[scene.id] as Partial<ChallengeResult> | undefined;
    if (!r || typeof r !== 'object') continue;
    const attempts = Number.isInteger(r.attempts) && r.attempts! > 0 ? Math.min(r.attempts!, 99) : 0;
    if (!attempts && !r.revealed) continue;
    results[scene.id] = { attempts, solved: Boolean(r.solved), revealed: Boolean(r.revealed) };
  }
  const run: Run = { questId: quest.id, sceneIndex: index, inspected, results, completed: false };
  // Never let a restored run sit beyond a step that was not finished.
  for (let i = 0; i < index; i += 1) {
    if (!isSceneDone(run, quest.scenes[i])) {
      run.sceneIndex = i;
      break;
    }
  }
  run.sceneId = quest.scenes[run.sceneIndex].id;
  run.completed = Boolean(s.completed) && run.sceneIndex === last;
  return run;
}

export function currentScene(quest: Quest, run: Run): Scene {
  return quest.scenes[run.sceneIndex];
}

export function resultFor(run: Run, sceneId: string): ChallengeResult {
  return run.results[sceneId] || { attempts: 0, solved: false, revealed: false };
}

/** Solved on the first checked answer, without the answer being shown. */
export function isFirstTry(_scene: Scene, result: ChallengeResult): boolean {
  return result.solved && !result.revealed && result.attempts === 1;
}

function isSceneDone(run: Run, scene: Scene): boolean {
  if (scene.type === 'evidence') return scene.evidence.every((id) => run.inspected.includes(id));
  if (isChallenge(scene)) return resultFor(run, scene.id).solved;
  return true;
}

export function canAdvance(quest: Quest, run: Run): boolean {
  return !run.completed && isSceneDone(run, currentScene(quest, run));
}

export function inspectEvidence(quest: Quest, run: Run, evidenceId: string): Run {
  const scene = currentScene(quest, run);
  if (scene.type !== 'evidence' || !scene.evidence.includes(evidenceId)) return run;
  if (run.inspected.includes(evidenceId)) return run;
  return { ...run, inspected: [...run.inspected, evidenceId] };
}

export function advance(quest: Quest, run: Run): Run {
  if (!canAdvance(quest, run)) return run;
  if (currentScene(quest, run).type === 'ending') return { ...run, completed: true };
  const sceneIndex = run.sceneIndex + 1;
  return { ...run, sceneIndex, sceneId: quest.scenes[sceneIndex].id };
}

// ---- Evaluation per challenge type ----

type Evaluation = Omit<Outcome, 'attempts' | 'hint' | 'canReveal' | 'explanation'>;

function evaluateChoice(scene: ChoiceScene, answer: Answer): Evaluation {
  const option = scene.options.find((o) => o.id === answer);
  if (!option) return { valid: false, message: 'Choose an option first.' };
  return { valid: true, correct: option.id === scene.correct, feedback: option.feedback, issues: [] };
}

function evaluateAssemble(scene: AssembleScene, answer: Answer): Evaluation {
  const a = (answer && typeof answer === 'object' && 'slots' in answer) ? answer : { slots: {}, extras: [] };
  const extras = new Set(a.extras || []);
  const missing = scene.slots.filter((slot) => !slot.options.some((o) => o.id === a.slots[slot.id]));
  if (missing.length) {
    return { valid: false, message: `Choose an option for: ${missing.map((s) => s.label).join(', ')}.` };
  }
  const issues: Issue[] = [];
  for (const slot of scene.slots) {
    const chosen = slot.options.find((o) => o.id === a.slots[slot.id])!;
    if (!chosen.correct) issues.push({ id: slot.id, label: slot.label, text: chosen.feedback || 'This line is not supported.' });
  }
  for (const extra of scene.extras || []) {
    if (extras.has(extra.id) && !extra.supported) issues.push({ id: extra.id, label: extra.text, text: extra.feedback || 'Not supported by the source.' });
  }
  const correct = issues.length === 0;
  return {
    valid: true,
    correct,
    feedback: correct ? scene.successFeedback || 'Everything checks out.' : `${issues.length} ${issues.length === 1 ? 'line needs' : 'lines need'} another look.`,
    issues,
  };
}

function missingKeywords(text: string, keywords: string[] = []): string[] {
  const normalised = ` ${text.toUpperCase().replace(/\s+/g, ' ')} `;
  return keywords.filter((k) => !normalised.includes(` ${k.toUpperCase()} `) && !normalised.includes(` ${k.toUpperCase()}(`));
}

function evaluateSql(scene: SqlScene, answer: Answer): Evaluation {
  const a = answer && typeof answer === 'object' && 'query' in answer ? answer : null;
  if (!a || !a.query.trim()) return { valid: false, message: 'Write a query first.' };
  if (a.error) {
    return { valid: true, correct: false, feedback: 'The database could not run that query.', output: `Error: ${a.error}`, issues: [] };
  }
  if (!a.result) return { valid: false, message: 'The query has not been run yet.' };
  const output = formatTable(a.result);
  const absent = missingKeywords(a.query, scene.requireKeywords);
  if (absent.length) {
    return {
      valid: true, correct: false, output, issues: [],
      feedback: `Your query ran, but this step is practising ${absent.join(' and ')}. Use ${absent.length === 1 ? 'it' : 'them'} so the database does the work.`,
    };
  }
  const diff = compareRows(a.result.rows, scene.expected.rows, Boolean(scene.expected.ordered));
  if (diff) return { valid: true, correct: false, feedback: diff, output, issues: [] };
  return { valid: true, correct: true, feedback: scene.successFeedback || 'The results match.', output, issues: [] };
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => valuesEqual(x, b[i]));
  return a === b;
}

function evaluatePythonScene(scene: PythonScene, answer: Answer): Evaluation {
  const a = answer && typeof answer === 'object' && 'expression' in answer ? answer : null;
  if (!a || !a.expression.trim()) return { valid: false, message: 'Type your Python first.' };
  const result = evaluatePython(a.expression, scene.variables);
  if (!result.ok) {
    return { valid: true, correct: false, output: result.error, feedback: 'Python stopped with an error. Read the last line: it names the problem.', issues: [] };
  }
  const output = pyStr(result.value);
  if (scene.forbidPattern && new RegExp(scene.forbidPattern).test(a.expression)) {
    return { valid: true, correct: false, output, issues: [], feedback: 'That gives the right number today, but it is typed in by hand. Calculate it from the variables so it stays right when the data changes.' };
  }
  const missingNames = (scene.requireNames || []).filter((n) => !result.names.includes(n));
  if (missingNames.length) {
    return { valid: true, correct: false, output, issues: [], feedback: `Use ${missingNames.map((n) => `\`${n}\``).join(' and ')} in your answer so the program works from the data.` };
  }
  const ok = scene.expected.output !== undefined
    ? output === scene.expected.output
    : valuesEqual(toJs(result.value), scene.expected.value);
  if (!ok) {
    const want = scene.expected.output ?? String(scene.expected.value);
    return { valid: true, correct: false, output, issues: [], feedback: `It runs, but the program prints ${output} and we need ${want}.` };
  }
  return { valid: true, correct: true, output, issues: [], feedback: scene.successFeedback || 'The program now prints the expected output.' };
}

function evaluateExcel(scene: ExcelScene, answer: Answer): Evaluation {
  const a = answer && typeof answer === 'object' && 'formula' in answer ? answer : null;
  if (!a || !a.formula.trim()) return { valid: false, message: `Type a formula for cell ${scene.target} first.` };
  const sheet = makeSheet(scene.columns, scene.rows);
  const start = splitRef(scene.target);
  const end = scene.fillDownTo ? splitRef(scene.fillDownTo).row : start.row;
  const results: string[] = [];
  const issues: Issue[] = [];
  let firstFunctions: string[] = [];
  for (let row = start.row; row <= end; row += 1) {
    const cell = `${start.col}${row}`;
    const formula = row === start.row ? a.formula : fillFormula(a.formula, row - start.row);
    const r = evaluateFormula(formula, sheet, cell);
    if (row === start.row) {
      firstFunctions = r.functions;
      if (!r.ok) return { valid: true, correct: false, output: r.error, feedback: r.error?.startsWith('#') ? errorExplanation(r.error) : r.error, issues: [] };
      if (!r.refs.length) {
        return { valid: true, correct: false, output: String(r.value), issues: [], feedback: 'That formula only uses typed numbers. Refer to the cells (like B2) so it updates when the data changes.' };
      }
    }
    if (!r.ok) { issues.push({ id: cell, label: cell, text: `${formula} gives ${r.error}` }); continue; }
    sheet[cell] = r.value!;
    results.push(`${cell} = ${round(r.value!)}`);
    const expected = scene.expected[cell];
    if (expected !== undefined && Math.abs(r.value! - expected) > 1e-6) {
      issues.push({ id: cell, label: cell, text: row === start.row ? `${formula} gives ${round(r.value!)}, but this cell should be ${round(expected)}.` : `When filled down it becomes ${formula} and gives ${round(r.value!)} instead of ${round(expected)}.` });
    }
  }
  const output = results.join('\n');
  const absentFns = (scene.requireFunctions || []).filter((f) => !firstFunctions.includes(f.toUpperCase()));
  if (!issues.length && absentFns.length) {
    return { valid: true, correct: false, output, issues: [], feedback: `The number is right, but this step practises the ${absentFns.join(', ')} function. Try using it.` };
  }
  if (issues.length) return { valid: true, correct: false, output, issues, feedback: `${issues.length} ${issues.length === 1 ? 'cell is' : 'cells are'} not right yet.` };
  return { valid: true, correct: true, output, issues: [], feedback: scene.successFeedback || 'The formula gives the right result.' };
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}

function errorExplanation(code: string): string {
  switch (code) {
    case '#NAME?': return 'Excel shows #NAME? when it doesn’t recognise a word in the formula. Check the function name is spelled correctly.';
    case '#DIV/0!': return 'Excel shows #DIV/0! when a formula divides by zero or an empty cell.';
    case '#VALUE!': return 'Excel shows #VALUE! when a calculation uses text instead of a number. Check which cells you referenced.';
    case '#REF!': return 'Excel shows #REF! when a cell reference isn’t valid.';
    default: return `Excel shows ${code} for this formula.`;
  }
}

function evaluateKpi(scene: KpiScene, answer: Answer): Evaluation {
  const placement = answer && typeof answer === 'object' && 'placement' in answer ? answer.placement : {};
  const unplaced = scene.cards.filter((c) => !scene.categories.some((cat) => cat.id === placement[c.id]));
  if (unplaced.length) return { valid: false, message: `Place every card first (${unplaced.length} left).` };
  const issues: Issue[] = scene.cards
    .filter((c) => placement[c.id] !== c.category)
    .map((c) => ({ id: c.id, label: c.label, text: c.feedback }));
  const correct = issues.length === 0;
  return {
    valid: true, correct, issues,
    feedback: correct ? scene.successFeedback || 'Every KPI is in the right place.' : `${issues.length} ${issues.length === 1 ? 'card belongs' : 'cards belong'} somewhere else.`,
  };
}

function evaluateSchema(scene: SchemaScene, answer: Answer): Evaluation {
  const raw = answer && typeof answer === 'object' && 'model' in answer ? answer.model : null;
  const model = cleanModel(scene, raw);
  if (!model.placed.length) return { valid: false, message: 'Add the tables you need to the workspace first.' };
  const result = validateModel(scene, model);
  const errors = result.issues.filter((i) => i.severity === 'error');
  const warnings = result.issues.filter((i) => i.severity === 'warning');
  if (errors.length) {
    return {
      valid: true, correct: false,
      feedback: `${errors.length} ${errors.length === 1 ? 'problem' : 'problems'} found in your model.`,
      issues: [...errors, ...warnings].map((i) => ({ id: i.id, label: i.title, text: i.text })),
    };
  }
  const note = warnings.length ? ` (Note: ${warnings.map((w) => w.title).join('; ')}.)` : '';
  return { valid: true, correct: true, feedback: (scene.successFeedback || 'Your model works.') + note, issues: [] };
}

export function evaluate(scene: Scene, answer: Answer): Evaluation {
  switch (scene.type) {
    case 'choice': return evaluateChoice(scene, answer);
    case 'assemble': return evaluateAssemble(scene, answer);
    case 'sql': return evaluateSql(scene, answer);
    case 'python': return evaluatePythonScene(scene, answer);
    case 'excel': return evaluateExcel(scene, answer);
    case 'kpi': return evaluateKpi(scene, answer);
    case 'schema': return evaluateSchema(scene, answer);
    default: return { valid: false, message: 'This step has no answer to check.' };
  }
}

// Submit an answer for the current challenge. Invalid submissions (nothing
// entered yet) do not count as an attempt.
export function submitAnswer(quest: Quest, run: Run, answer: Answer): { run: Run; outcome: Outcome } {
  const scene = currentScene(quest, run);
  const previous = resultFor(run, scene.id);
  if (!isChallenge(scene) || previous.solved) {
    return { run, outcome: { valid: false, message: 'This step is already complete.' } };
  }
  const result = evaluate(scene, answer);
  if (!result.valid) return { run, outcome: result };

  const attempts = previous.attempts + 1;
  const next: ChallengeResult = { attempts, solved: Boolean(result.correct), revealed: false };
  const outcome: Outcome = { ...result, attempts };
  if (result.correct) {
    outcome.explanation = scene.explanation;
  } else {
    const hints = scene.hints || [];
    outcome.hint = hints.length ? hints[Math.min(attempts - 1, hints.length - 1)] : null;
    outcome.canReveal = attempts >= REVEAL_AFTER_ATTEMPTS;
  }
  return { run: { ...run, results: { ...run.results, [scene.id]: next } }, outcome };
}

// After several attempts the player may ask to see the answer. The step is
// then complete but earns no XP and the skill is recorded as "reviewed".
export function revealAnswer(quest: Quest, run: Run): Run {
  const scene = currentScene(quest, run);
  const previous = resultFor(run, scene.id);
  if (!isChallenge(scene) || previous.solved || previous.attempts < REVEAL_AFTER_ATTEMPTS) return run;
  return { ...run, results: { ...run.results, [scene.id]: { attempts: previous.attempts, solved: true, revealed: true } } };
}

export function correctAnswer(scene: Scene): Answer | null {
  switch (scene.type) {
    case 'choice': return scene.correct;
    case 'assemble': {
      const slots: Record<string, string> = {};
      for (const slot of scene.slots) slots[slot.id] = slot.options.find((o) => o.correct)!.id;
      return { slots, extras: (scene.extras || []).filter((e) => e.supported).map((e) => e.id) };
    }
    case 'sql': return { query: scene.solution };
    case 'python': return { expression: scene.solution };
    case 'excel': return { formula: scene.solution };
    case 'kpi': return { placement: Object.fromEntries(scene.cards.map((c) => [c.id, c.category])) };
    case 'schema': return { model: solutionModel(scene) };
    default: return null;
  }
}

export function sceneXp(quest: Quest, scene: Scene, result: ChallengeResult): number {
  if (!isChallenge(scene) || !result.solved || result.revealed) return 0;
  return (scene.xp || 0) + (result.attempts === 1 ? quest.xp.firstTryBonus || 0 : 0);
}

export function computeXp(quest: Quest, run: Run): number {
  let total = 0;
  for (const scene of quest.scenes) total += sceneXp(quest, scene, resultFor(run, scene.id));
  if (run.completed) total += quest.xp.completion || 0;
  return total;
}

export function maxXp(quest: Quest): number {
  const perfect = { attempts: 1, solved: true, revealed: false };
  return quest.scenes.reduce((sum, scene) => sum + sceneXp(quest, scene, perfect), 0) + (quest.xp.completion || 0);
}

/**
 * Stars for a finished run: 3 = every challenge right first time,
 * 2 = finished without revealing any answer, 1 = finished with help.
 */
export function computeStars(quest: Quest, run: Run): number {
  if (!run.completed) return 0;
  const results = quest.scenes.filter(isChallenge).map((s) => resultFor(run, s.id));
  if (results.some((r) => r.revealed)) return 1;
  if (results.every((r) => r.attempts === 1)) return 3;
  return 2;
}

export const SKILL_STATUS = {
  demonstrated: 'Demonstrated first time',
  'with-hints': 'Demonstrated after a hint',
  reviewed: 'Reviewed with help',
  'not-yet': 'Not yet demonstrated',
} as const;

export type SkillStatus = keyof typeof SKILL_STATUS;

// A badge alone is not proof of learning: report each objective with how it
// was shown, based on the challenges mapped to it.
export function skillReport(quest: Quest, run: Run) {
  return quest.objectives.map((objective) => {
    const scenes = quest.scenes.filter((s) => isChallenge(s) && (s.skills || []).includes(objective.id));
    const results = scenes.map((s) => resultFor(run, s.id));
    let status: SkillStatus = 'not-yet';
    if (results.length && results.every((r) => r.solved)) {
      if (results.some((r) => r.revealed)) status = 'reviewed';
      else if (results.every((r) => r.attempts === 1)) status = 'demonstrated';
      else status = 'with-hints';
    }
    return { id: objective.id, label: objective.label, status, statusLabel: SKILL_STATUS[status] };
  });
}

export function progressSummary(quest: Quest, run: Run) {
  return { step: run.sceneIndex + 1, total: quest.scenes.length };
}

export function levelFor(xp: number) {
  let index = 0;
  LEVELS.forEach((level, i) => {
    if (xp >= level.min) index = i;
  });
  const next = LEVELS[index + 1] || null;
  return { level: index + 1, name: LEVELS[index].name, min: LEVELS[index].min, next };
}
