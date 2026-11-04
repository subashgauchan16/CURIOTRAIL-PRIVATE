// Pure game rules. No DOM, no React, no Three.js, no storage: every function
// takes state and returns new state, so the interface and 3D world can change
// without touching quests, and every rule is unit-tested.

import type {
  Answer, AssembleScene, Cell, ChallengeResult, ChallengeScene, ChoiceScene, EndingScene, GambitScene, Issue,
  KpiScene, MatchScene, Outcome, PythonScene, Quest, RepairScene, Run, RunewordScene, Scene, SchemaScene, SqlScene,
  SpotScene, SpotTask, TradeReport, WheelScene, WheelSegment, WorkshopScene,
} from './types';
import { evaluatePython, str as pyStr, toJs } from './python-lite';
import { colName, evaluateFormula, fillFormula, makeSheet, splitRef } from './excel-lite';
import { compareRows, formatTable } from './sql-check';
import { cleanModel, solutionModel, validateModel } from './schema-lab';
import { draw, weightedIndex } from './games/rng';
import { guessProblem, normaliseGuess, scoreGuess } from './games/runeword';

export const CHALLENGE_TYPES = new Set([
  'choice', 'assemble', 'sql', 'python', 'excel', 'kpi', 'schema',
  'workshop', 'repair', 'runeword', 'wheel', 'match', 'gambit', 'spot',
]);
export const REVEAL_AFTER_ATTEMPTS = 3;
/** Share of the silver purse so far that can be staked on one step. */
export const MAX_STAKE_SHARE = 0.5;
/** Stake losses can never take the silver purse below this share of the silver earned. */
export const POT_FLOOR_SHARE = 0.5;
export const DEFAULT_MASTERY = { threshold: 0.7, gold: 0.85 };

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

export function createRun(quest: Quest, seed = 1): Run {
  return {
    questId: quest.id, sceneIndex: 0, sceneId: quest.scenes[0]?.id, inspected: [], results: {}, completed: false,
    seed: Math.max(1, Math.floor(Math.abs(seed)) % 0x7fffffff || 1), wagers: {}, spins: {}, guesses: {},
  };
}

/** Steps solved within this many attempts count as "first time" (rune-words allow a few guesses). */
export function parFor(scene: Scene): number {
  return scene.type === 'runeword' ? Math.max(1, scene.par) : 1;
}

export function revealAfter(scene: Scene): number {
  return scene.type === 'runeword' ? Math.max(1, scene.maxGuesses) : REVEAL_AFTER_ATTEMPTS;
}

export function isFirstTry(scene: Scene, result: ChallengeResult): boolean {
  return result.solved && !result.revealed && result.attempts >= 1 && result.attempts <= parFor(scene);
}

// ---- Data variants: a boss uses different numbers on different runs ----

type VariantScene = ChoiceScene | WorkshopScene | RepairScene | SpotScene;

export function variantIndex(scene: Scene, run: Run): number {
  const variants = (scene as VariantScene).variants;
  if (!variants || !variants.length) return 0;
  return Math.floor(draw(run.seed ?? 1, `variant:${scene.id}`) * (variants.length + 1));
}

/** The step as this run sees it: variant data substituted for the defaults. */
export function resolveScene<S extends Scene>(scene: S, run: Run): S {
  const index = variantIndex(scene, run);
  if (index === 0) return scene;
  const v = (scene as unknown as VariantScene).variants![index - 1];
  if (scene.type === 'choice') {
    return { ...scene, sheet: scene.sheet ? { ...scene.sheet, rows: v.rows } : scene.sheet, correct: v.correct ?? scene.correct, context: v.context ?? scene.context };
  }
  if (scene.type === 'spot') return { ...scene, rows: v.rows, answer: v.answer ?? scene.answer, context: v.context ?? scene.context };
  return { ...scene, rows: v.rows, expected: v.expected ?? (scene as unknown as WorkshopScene).expected, context: v.context ?? scene.context };
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
  const sceneIds = new Set(quest.scenes.map((sc) => sc.id));
  const seed = Number.isInteger(s.seed) && s.seed! > 0 ? Math.min(s.seed!, 0x7fffffff) : 1;
  const wagers: Record<string, number> = {};
  for (const [id, v] of Object.entries((s.wagers && typeof s.wagers === 'object' ? s.wagers : {}) as Record<string, unknown>)) {
    if (sceneIds.has(id) && Number.isInteger(v) && (v as number) >= 0) wagers[id] = Math.min(v as number, 100000);
  }
  const spins: Record<string, string> = {};
  for (const [id, v] of Object.entries((s.spins && typeof s.spins === 'object' ? s.spins : {}) as Record<string, unknown>)) {
    const sc = quest.scenes.find((x) => x.id === id);
    if (sc?.type === 'wheel' && sc.segments.some((seg) => seg.id === v)) spins[id] = v as string;
  }
  const guesses: Record<string, string[]> = {};
  for (const [id, v] of Object.entries((s.guesses && typeof s.guesses === 'object' ? s.guesses : {}) as Record<string, unknown>)) {
    const sc = quest.scenes.find((x) => x.id === id);
    if (sc?.type === 'runeword' && Array.isArray(v)) {
      guesses[id] = v.filter((g): g is string => typeof g === 'string' && g.length === sc.word.length && /^[A-Z]+$/.test(g)).slice(0, sc.maxGuesses + 4);
    } else if ((sc?.type === 'spot' || sc?.type === 'wheel') && Array.isArray(v)) {
      // Evidence picks: addresses only, never more than the largest pick limit.
      guesses[id] = v.filter((g): g is string => normaliseAddress(g) === g).slice(0, 3);
    }
  }
  const run: Run = { questId: quest.id, sceneIndex: index, inspected, results, completed: false, seed, wagers, spins, guesses };
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

interface SheetTask {
  columns: string[];
  rows: Cell[][];
  target: string;
  fillDownTo?: string;
  expected: Record<string, number>;
  requireFunctions?: string[];
  /** Cells the formula must read, so a typed-in constant cannot pass. */
  requireRefs?: string[];
  successFeedback?: string;
}

function formulaOf(answer: Answer): string | null {
  return answer && typeof answer === 'object' && 'formula' in answer && typeof answer.formula === 'string' ? answer.formula : null;
}

function evaluateExcel(scene: SheetTask, answer: Answer): Evaluation {
  const formula = formulaOf(answer);
  if (!formula || !formula.trim()) return { valid: false, message: `Build a formula for cell ${scene.target} first.` };
  return evaluateSheet(scene, formula);
}

/** Run a formula on a ledger (with fill-down) and compare every target cell. */
export function evaluateSheet(scene: SheetTask, formula: string): Evaluation {
  const a = { formula };
  const sheet = makeSheet(scene.columns, scene.rows);
  const start = splitRef(scene.target);
  const end = scene.fillDownTo ? splitRef(scene.fillDownTo).row : start.row;
  const results: string[] = [];
  const issues: Issue[] = [];
  let firstFunctions: string[] = [];
  let firstRefs: string[] = [];
  for (let row = start.row; row <= end; row += 1) {
    const cell = `${start.col}${row}`;
    const formula = row === start.row ? a.formula : fillFormula(a.formula, row - start.row);
    const r = evaluateFormula(formula, sheet, cell);
    if (row === start.row) {
      firstFunctions = r.functions;
      firstRefs = r.refs;
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
  const absentRefs = (scene.requireRefs || []).filter((ref) => !firstRefs.includes(ref.toUpperCase()));
  if (!issues.length && absentRefs.length) {
    return { valid: true, correct: false, output, issues: [], feedback: `The numbers match today, but ${absentRefs.join(', ')} is typed in rather than referenced. Point at the cell so the ledger updates when it changes.` };
  }
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

function evaluateRepair(scene: RepairScene, answer: Answer): Evaluation {
  const a = answer && typeof answer === 'object' && 'diagnosis' in answer ? answer : null;
  if (!a || !scene.diagnoses.some((d) => d.id === a.diagnosis)) return { valid: false, message: 'First choose what went wrong.' };
  if (!a.formula || !a.formula.trim() || a.formula.trim() === '=') return { valid: false, message: `Now write the repaired formula for ${scene.target}.` };
  const diagnosis = scene.diagnoses.find((d) => d.id === a.diagnosis)!;
  const fix = evaluateSheet(scene, a.formula);
  const issues: Issue[] = [...(fix.issues || [])];
  const diagnosisRight = a.diagnosis === scene.correctDiagnosis;
  if (!diagnosisRight) issues.unshift({ id: 'diagnosis', label: 'Diagnosis', text: diagnosis.feedback });
  if (fix.correct && scene.check) {
    // The repair must work on other data too, so a typed-in result cannot pass.
    const again = evaluateSheet({ ...scene, rows: scene.check.rows, expected: scene.check.expected }, a.formula);
    if (!again.correct) {
      issues.push({ id: 'check', label: 'New week’s ledger', text: 'Your fix gives the right numbers here, but not when the ledger changes. Refer to the cells instead of fixed numbers.' });
    }
  }
  const correct = diagnosisRight && Boolean(fix.correct) && issues.length === 0;
  if (correct) return { valid: true, correct, output: fix.output, issues: [], feedback: scene.successFeedback || 'Diagnosed and repaired.' };
  const feedback = !diagnosisRight && fix.correct
    ? 'The repaired formula works, but the diagnosis is off. Knowing why it broke is what stops it happening again.'
    : !diagnosisRight ? 'Look again at both the cause and the fix.' : fix.feedback;
  return { valid: true, correct: false, output: fix.output, issues, feedback };
}

function evaluateRuneword(scene: RunewordScene, answer: Answer, previous: string[]): Evaluation {
  const raw = answer && typeof answer === 'object' && 'guess' in answer ? answer.guess : '';
  const problem = guessProblem(raw, scene.word, previous);
  if (problem) return { valid: false, message: problem };
  const guess = normaliseGuess(raw);
  const tiles = scoreGuess(guess, scene.word);
  const correct = guess === scene.word.toUpperCase();
  const hits = tiles.filter((t) => t === 'hit').length;
  const near = tiles.filter((t) => t === 'near').length;
  return {
    valid: true, correct, tiles, issues: [],
    feedback: correct ? `${scene.word} it is.` : `${guess}: ${hits} in the right place, ${near} in the word but elsewhere.`,
  };
}

export function landedSegment(scene: WheelScene, run: Run): WheelSegment | null {
  const id = run.spins?.[scene.id];
  return scene.segments.find((s) => s.id === id) ?? null;
}

function evaluateWheel(scene: WheelScene, answer: Answer, run: Run): Evaluation {
  const segment = landedSegment(scene, run);
  if (!segment) return { valid: false, message: 'Spin the wheel first.' };
  const response = answer && typeof answer === 'object' && 'response' in answer ? answer.response : null;
  const c = segment.challenge;
  if (c.kind === 'choice') {
    const option = c.options.find((o) => o.id === response);
    if (!option) return { valid: false, message: 'Choose an answer first.' };
    return { valid: true, correct: option.id === c.correct, feedback: option.feedback, issues: [] };
  }
  if (c.kind === 'spot') return evaluateSpot(c, response && typeof response === 'object' && 'cell' in response ? response.cell : null, picksMade(run, scene.id));
  const formula = response && typeof response === 'object' && 'formula' in response ? response.formula : '';
  if (!formula || !formula.trim() || formula.trim() === '=') return { valid: false, message: `Build a formula for ${c.target} first.` };
  return evaluateSheet(c, formula);
}

const ADDRESS = /^([A-Z])([1-9]\d*)$/;

/** Read a selected or typed address ("b3", "$B$3") as "B3"; null if it isn't one. */
export function normaliseAddress(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const t = text.trim().toUpperCase().replace(/\$/g, '');
  return ADDRESS.test(t) ? t : null;
}

/** What a cell holds, as the player sees it. */
export function spotCell(task: Pick<SpotTask, 'columns' | 'rows'>, cell: string): { inside: boolean; value: Cell | undefined; header: boolean } {
  const m = ADDRESS.exec(cell);
  if (!m) return { inside: false, value: undefined, header: false };
  const col = m[1].charCodeAt(0) - 65;
  const row = Number(m[2]);
  const inside = col < task.columns.length && row >= 1 && row <= task.rows.length + 1;
  if (!inside) return { inside, value: undefined, header: false };
  return { inside, header: row === 1, value: row === 1 ? task.columns[col] : task.rows[row - 2][col] };
}

function evaluateSpotScene(scene: SpotScene, answer: Answer, tried: string[]): Evaluation {
  const a = answer && typeof answer === 'object' && 'cell' in answer ? answer : null;
  if (!scene.scratch?.solutions?.length) return evaluateSpot(scene, a?.cell ?? null, tried);
  // The working column is assessed first: the pick only counts once the calculation is right.
  const formula = a?.working ?? '';
  const col = colName(scene.columns.length);
  if (!formula.trim() || formula.trim() === '=') return { valid: false, message: `First build your ${scene.scratch.label.toLowerCase()} formula in ${col}2 (it is filled down).` };
  const work = evaluateWorking(scene, formula);
  if (!work.correct) {
    return { ...work, values: undefined, feedback: `Hrolf checks your working first. ${work.feedback ?? ''}`.trim() } as Evaluation;
  }
  const pick = evaluateSpot(scene, a?.cell ?? null, tried, { label: scene.scratch.label, values: work.values! });
  if (!pick.valid && normaliseAddress(a?.cell) === null) return { valid: false, message: `Your working is right. Now select the ${scene.select === 'row' ? 'row' : 'cell'} it points to.` };
  return pick;
}

// ---- Evidence picks: a proportionate attempt policy ----
//
// Evidence steps are finite: a player could click cells until one is right.
// So a step allows at most half its candidates as wrong picks (never more
// than three). The same cell, or the same row in a row step, is never
// counted twice. Each wrong pick is told what that cell shows. When the
// limit is reached the answer is shown with its explanation and the step
// earns nothing: no XP, no boss credit, no first-time credit.

/** How many cells (or rows) the player could pick from. */
export function pickCandidates(task: Pick<SpotTask, 'columns' | 'rows' | 'select'>): number {
  return task.select === 'row' ? task.rows.length : task.rows.length * task.columns.length;
}

/** Wrong picks allowed before the answer is shown. */
export function pickLimit(task: Pick<SpotTask, 'columns' | 'rows' | 'select'>): number {
  return Math.max(1, Math.min(3, Math.floor(pickCandidates(task) / 2)));
}

/** Two picks are "the same" when they are the same cell, or the same row in a row step. */
function pickKey(task: Pick<SpotTask, 'select'>, cell: string): string {
  return task.select === 'row' ? `row:${cell.slice(1)}` : cell;
}

/** The wrong picks already made on a step this run. */
export function picksMade(run: Run | undefined, sceneId: string): string[] {
  return run?.guesses?.[sceneId] ?? [];
}

/**
 * The player points at a cell; the engine checks it against the evidence.
 * `tried` holds earlier wrong picks; `working` the player's working column, if any.
 */
export function evaluateSpot(task: SpotTask, picked: unknown, tried: string[] = [], working?: { label: string; values: Record<string, number> }): Evaluation {
  const cell = normaliseAddress(picked);
  if (!cell) return { valid: false, message: 'Select a cell in the ledger, or type its address (like B3).' };
  const { inside, value, header } = spotCell(task, cell);
  if (!inside) return { valid: false, message: `${cell} is outside this ledger. Pick a cell inside it.` };
  const row = Number(cell.slice(1));
  const correct = task.select === 'row'
    ? task.answer.some((a) => Number(a.slice(1)) === row)
    : task.answer.includes(cell);
  const shown = value === null || value === undefined || value === '' ? 'nothing' : String(value);
  if (correct) {
    return { valid: true, correct: true, issues: [], output: cell, pick: cell, feedback: task.successFeedback ?? `${cell} it is: ${shown}.` };
  }
  if (tried.some((t) => pickKey(task, t) === pickKey(task, cell))) {
    return { valid: false, message: task.select === 'row' ? `You already showed row ${row}. Pick a different row.` : `You already tried ${cell}. Pick a different cell.` };
  }
  const specific = task.feedback?.[cell] ?? task.feedback?.[`row:${row}`];
  const label = task.rows[row - 2]?.[0];
  const work = working && !header ? working.values[`${colName(task.columns.length)}${row}`] : undefined;
  // Evidence-based, never the answer: what this cell (and the player's own working) shows.
  const fallback = header ? `${cell} is the heading “${shown}”. The evidence is in the rows below.`
    : work !== undefined ? `${task.select === 'row' ? `Row ${row} (${label})` : `${cell} holds ${shown}`}: your ${working!.label.toLowerCase()} column shows ${Math.round(work * 100) / 100} on that row. Compare it with the other rows.`
    : `${cell} holds ${shown}. That isn’t the evidence you need.`;
  const text = specific ?? fallback;
  return { valid: true, correct: false, issues: [{ id: cell, label: cell, text }], output: cell, pick: cell, feedback: text };
}

/** The values a formula fills into a column (for a working column's expected results). */
function columnValues(columns: string[], rows: Cell[][], target: string, last: number, formula: string): Record<string, number> | null {
  const sheet = makeSheet(columns, rows);
  const start = splitRef(target);
  const out: Record<string, number> = {};
  for (let row = start.row; row <= last; row += 1) {
    const cell = `${start.col}${row}`;
    const r = evaluateFormula(row === start.row ? formula : fillFormula(formula, row - start.row), sheet, cell);
    if (!r.ok) return null;
    out[cell] = r.value!;
    sheet[cell] = r.value!;
  }
  return out;
}

/** Check a required working column: it must match one of the accepted formulas' columns on this data. */
export function evaluateWorking(scene: SpotScene, formula: string): Evaluation & { values?: Record<string, number> } {
  const col = colName(scene.columns.length);
  const last = scene.rows.length + 1;
  const columns = [...scene.columns, scene.scratch!.label];
  const rows = scene.rows.map((r) => [...r, null]);
  const task = { columns, rows, target: `${col}2`, fillDownTo: `${col}${last}` };
  let first: Evaluation | null = null;
  for (const solution of scene.scratch!.solutions ?? []) {
    const expected = columnValues(columns, rows, task.target, last, solution);
    if (!expected) continue;
    const ev = evaluateSheet({ ...task, expected }, formula);
    if (ev.correct) return { ...ev, values: expected };
    first ??= ev;
  }
  return first ?? { valid: true, correct: false, issues: [], feedback: 'That working formula does not work on this ledger.' };
}

function evaluateMatch(scene: MatchScene, answer: Answer): Evaluation {
  const pairs = answer && typeof answer === 'object' && 'pairs' in answer ? answer.pairs : {};
  const rightIds = new Set(scene.right.map((r) => r.id));
  const open = scene.left.filter((l) => !rightIds.has(pairs[l.id]));
  if (open.length) return { valid: false, message: `Pair every rune first (${open.length} left).` };
  const issues: Issue[] = scene.left
    .filter((l) => pairs[l.id] !== scene.pairs[l.id])
    .map((l) => ({ id: l.id, label: l.text, text: scene.feedback[l.id] || 'This pair does not belong together.' }));
  const correct = issues.length === 0;
  return {
    valid: true, correct, issues,
    feedback: correct ? scene.successFeedback || 'Every pair matches.' : `${issues.length} ${issues.length === 1 ? 'pair is' : 'pairs are'} wrong.`,
  };
}

export const GAMBIT_COLUMNS = ['Item', 'Price', 'Cost', 'Demand', 'Order', 'Profit'];

function gambitSheet(scene: GambitScene, orders: number[]): { columns: string[]; rows: Cell[][] } {
  return { columns: GAMBIT_COLUMNS, rows: scene.items.map((it, i) => [it.name, it.price, it.cost, it.demand, orders[i] ?? 0, null]) };
}

/** True profit of a restock: everything ordered is paid for; only what customers want is sold. */
export function tradeProfit(item: { price: number; cost: number; demand: number }, order: number): number {
  return item.price * Math.min(item.demand, order) - item.cost * order;
}

function evaluateGambit(scene: GambitScene, answer: Answer): Evaluation {
  const a = answer && typeof answer === 'object' && 'orders' in answer ? answer : null;
  if (!a || !Array.isArray(a.orders) || a.orders.length !== scene.items.length) return { valid: false, message: 'Set an order for every item first.' };
  const orders = a.orders.map((n) => (Number.isInteger(n) ? n : NaN));
  if (orders.some((n) => !(n >= 0 && n <= scene.maxOrder))) return { valid: false, message: `Orders must be whole numbers from 0 to ${scene.maxOrder}.` };
  if (!a.formula || !a.formula.trim() || a.formula.trim() === '=') return { valid: false, message: 'Write the profit formula for F2 first.' };

  const last = scene.items.length + 1;
  const truth = scene.items.map((it, i) => tradeProfit(it, orders[i]));
  const sheet = gambitSheet(scene, orders);
  const expected = Object.fromEntries(truth.map((p, i) => [`F${i + 2}`, p]));
  const yours = evaluateSheet({ ...sheet, target: 'F2', fillDownTo: `F${last}`, expected }, a.formula);
  // The formula must also price a restock it has not seen (over-ordering and zero orders).
  const probeOrders = scene.items.map((it, i) => (i % 2 === 0 ? it.demand + 3 : 0));
  const probe = evaluateSheet({ ...gambitSheet(scene, probeOrders), target: 'F2', fillDownTo: `F${last}`, expected: Object.fromEntries(scene.items.map((it, i) => [`F${i + 2}`, tradeProfit(it, probeOrders[i])])) }, a.formula);

  const spend = scene.items.reduce((s, it, i) => s + it.cost * orders[i], 0);
  const total = truth.reduce((s, p) => s + p, 0);
  const sheetValues = makeSheet(sheet.columns, sheet.rows);
  const yourValues = scene.items.map((_, i) => {
    const r = evaluateFormula(i === 0 ? a.formula : fillFormula(a.formula, i), sheetValues, `F${i + 2}`);
    return r.ok ? r.value! : null;
  });
  const trade: TradeReport = {
    rows: scene.items.map((it, i) => ({ item: it.name, order: orders[i], sold: Math.min(it.demand, orders[i]), leftover: Math.max(0, orders[i] - it.demand), profit: truth[i], yours: yourValues[i] })),
    spend, purse: scene.purse, total, target: scene.targetProfit,
  };
  const issues: Issue[] = [];
  if (!yours.correct) issues.push({ id: 'formula', label: 'Your profit column', text: yours.feedback || 'The profit formula does not match what really happened.' });
  else if (!probe.correct) issues.push({ id: 'probe', label: 'Another week', text: 'Your formula only works for these orders. When an order is bigger than demand, unsold stock is still paid for: the profit must count sales and costs separately.' });
  if (spend > scene.purse) issues.push({ id: 'purse', label: 'Purse', text: `This restock costs ${spend} silver but the purse holds ${scene.purse}. The supplier refuses the order.` });
  else if (total < scene.targetProfit) issues.push({ id: 'profit', label: 'Profit', text: `The market would earn ${total} silver; Tove needs at least ${scene.targetProfit}. Look at which items earn the most per coin spent, and at stock nobody buys.` });
  const correct = issues.length === 0;
  return {
    valid: true, correct, issues, trade, output: yours.output,
    feedback: correct ? scene.successFeedback || `Restock done: ${total} silver profit.` : `${issues.length} ${issues.length === 1 ? 'problem' : 'problems'} with this restock.`,
  };
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

/**
 * Check an answer. Steps with per-run state (variants, wheel spins, guesses)
 * need the run; without it the step's default data is used.
 */
export function evaluate(scene: Scene, answer: Answer, run?: Run): Evaluation {
  const s = run ? resolveScene(scene, run) : scene;
  switch (s.type) {
    case 'choice': return evaluateChoice(s, answer);
    case 'assemble': return evaluateAssemble(s, answer);
    case 'sql': return evaluateSql(s, answer);
    case 'python': return evaluatePythonScene(s, answer);
    case 'excel': return evaluateExcel(s, answer);
    case 'workshop': return evaluateExcel(s, answer);
    case 'repair': return evaluateRepair(s, answer);
    case 'runeword': return evaluateRuneword(s, answer, run?.guesses?.[s.id] ?? []);
    case 'wheel': return run ? evaluateWheel(s, answer, run) : { valid: false, message: 'Spin the wheel first.' };
    case 'match': return evaluateMatch(s, answer);
    case 'gambit': return evaluateGambit(s, answer);
    case 'spot': return evaluateSpotScene(s, answer, picksMade(run, s.id));
    case 'kpi': return evaluateKpi(s, answer);
    case 'schema': return evaluateSchema(s, answer);
    default: return { valid: false, message: 'This step has no answer to check.' };
  }
}

/** Hints and explanation for the current step (a wheel uses its landed segment's). */
export function guidanceFor(scene: ChallengeScene, run: Run): { hints: string[]; explanation: string } {
  if (scene.type === 'wheel') {
    const seg = landedSegment(scene, run);
    if (seg) return { hints: seg.hints, explanation: seg.explanation };
  }
  return { hints: scene.hints || [], explanation: scene.explanation };
}

/** Concepts practised by the current step (a wheel practises its landed segment's). */
export function conceptsFor(scene: Scene, run: Run): string[] {
  if (scene.type === 'wheel') return landedSegment(scene, run)?.concepts ?? [];
  return isChallenge(scene) ? scene.concepts ?? [] : [];
}

// Submit an answer for the current challenge. Invalid submissions (nothing
// entered yet) do not count as an attempt.
export function submitAnswer(quest: Quest, run: Run, answer: Answer): { run: Run; outcome: Outcome } {
  const scene = currentScene(quest, run);
  const previous = resultFor(run, scene.id);
  if (!isChallenge(scene) || previous.solved) {
    return { run, outcome: { valid: false, message: 'This step is already complete.' } };
  }
  const result = evaluate(scene, answer, run);
  if (!result.valid) return { run, outcome: result };

  const attempts = previous.attempts + 1;
  const next: ChallengeResult = { attempts, solved: Boolean(result.correct), revealed: false };
  const outcome: Outcome = { ...result, attempts };
  const { hints, explanation } = guidanceFor(scene, run);
  if (result.correct) {
    outcome.explanation = explanation;
  } else {
    // Boss steps keep hints back until the second miss: retrieval first.
    const offset = scene.boss ? 1 : 0;
    const index = attempts - 1 - offset;
    outcome.hint = hints.length && index >= 0 ? hints[Math.min(index, hints.length - 1)] : null;
    outcome.canReveal = attempts >= revealAfter(scene);
  }
  let after: Run = { ...run, results: { ...run.results, [scene.id]: next } };
  const task = pickTask(scene, run);
  if (task && !result.correct && result.pick) {
    const picks = [...picksMade(run, scene.id), result.pick];
    after = { ...after, guesses: { ...(run.guesses || {}), [scene.id]: picks } };
    const left = pickLimit(task) - picks.length;
    outcome.picksLeft = Math.max(0, left);
    if (left <= 0) {
      // Out of picks: show the answer and why. Counted like a revealed answer.
      after = { ...after, results: { ...after.results, [scene.id]: { attempts, solved: true, revealed: true } } };
      outcome.locked = true;
      outcome.canReveal = false;
      outcome.hint = null;
      outcome.explanation = explanation;
    }
  } else if (task && !result.correct) {
    outcome.picksLeft = Math.max(0, pickLimit(task) - picksMade(run, scene.id).length);
  }
  if (scene.type === 'runeword') {
    after = { ...after, guesses: { ...(run.guesses || {}), [scene.id]: [...(run.guesses?.[scene.id] ?? []), normaliseGuess((answer as { guess: string }).guess)] } };
  }
  return { run: after, outcome };
}

/** The evidence ledger behind a step, if the step is (or landed on) an evidence pick. */
export function pickTask(scene: Scene, run: Run): SpotTask | null {
  const s = resolveScene(scene, run);
  if (s.type === 'spot') return s;
  if (s.type === 'wheel') {
    const seg = landedSegment(s, run);
    return seg?.challenge.kind === 'spot' ? seg.challenge : null;
  }
  return null;
}

// After several attempts the player may ask to see the answer. The step is
// then complete but earns no XP and the skill is recorded as "reviewed".
export function revealAnswer(quest: Quest, run: Run): Run {
  const scene = currentScene(quest, run);
  const previous = resultFor(run, scene.id);
  if (!isChallenge(scene) || previous.solved || previous.attempts < revealAfter(scene)) return run;
  return { ...run, results: { ...run.results, [scene.id]: { attempts: previous.attempts, solved: true, revealed: true } } };
}

export function correctAnswer(scene: Scene, run?: Run): Answer | null {
  const s = run ? resolveScene(scene, run) : scene;
  switch (s.type) {
    case 'choice': return s.correct;
    case 'assemble': {
      const slots: Record<string, string> = {};
      for (const slot of s.slots) slots[slot.id] = slot.options.find((o) => o.correct)!.id;
      return { slots, extras: (s.extras || []).filter((e) => e.supported).map((e) => e.id) };
    }
    case 'sql': return { query: s.solution };
    case 'python': return { expression: s.solution };
    case 'excel':
    case 'workshop': return { formula: s.solution };
    case 'repair': return { diagnosis: s.correctDiagnosis, formula: s.solution };
    case 'runeword': return { guess: s.word };
    case 'wheel': {
      const seg = run ? landedSegment(s, run) : null;
      if (!seg) return null;
      const c = seg.challenge;
      return { response: c.kind === 'choice' ? c.correct : c.kind === 'spot' ? { cell: c.answer[0] } : { formula: c.solution } };
    }
    case 'match': return { pairs: { ...s.pairs } };
    case 'gambit': return { orders: [...s.solution.orders], formula: s.solution.formula };
    case 'spot': return s.scratch?.solutions?.length ? { cell: s.answer[0], working: s.scratch.solutions[0] } : { cell: s.answer[0] };
    case 'kpi': return { placement: Object.fromEntries(s.cards.map((c) => [c.id, c.category])) };
    case 'schema': return { model: solutionModel(s) };
    default: return null;
  }
}

// ---- The rune wheel ----

/**
 * Spin the wheel for the current step. The landed segment depends only on the
 * run's seed and, when given, review weights (weak or fading concepts come up
 * more often). A step is spun once: re-spinning to dodge a question is not allowed.
 */
export function spinWheel(quest: Quest, run: Run, weights: Record<string, number> = {}): Run {
  const scene = currentScene(quest, run);
  if (scene.type !== 'wheel' || run.spins?.[scene.id] || resultFor(run, scene.id).solved) return run;
  const segmentWeights = scene.segments.map((seg) => {
    const w = seg.concepts.map((c) => weights[c] ?? 1);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 1;
  });
  const index = weightedIndex(segmentWeights, draw(run.seed ?? 1, `spin:${scene.id}`));
  return { ...run, spins: { ...(run.spins || {}), [scene.id]: scene.segments[index].id } };
}

/** Where the wheel stops, as a fraction of a turn (for the animation). */
export function wheelStopAngle(scene: WheelScene, segmentId: string): number {
  const i = Math.max(0, scene.segments.findIndex((s) => s.id === segmentId));
  return (i + 0.5) / scene.segments.length;
}

// ---- XP, the silver purse (wagers) and medals ----
//
// Three separate tallies, deliberately independent:
//   XP      — earned only by solving steps; drives levels. Wagers never touch it.
//   Silver  — the trader's purse: the optional wager side-game. Every solved
//             step adds its XP value in silver; stakes win or lose silver.
//             Silver affects nothing else (no XP, levels, medals or unlocks).
//   Medal   — evidence of mastery only (boss score, first-time accuracy,
//             answers revealed). Gold is reachable without ever staking.

export function sceneXp(quest: Quest, scene: Scene, result: ChallengeResult): number {
  if (!isChallenge(scene) || !result.solved || result.revealed) return 0;
  return (scene.xp || 0) + (isFirstTry(scene, result) ? quest.xp.firstTryBonus || 0 : 0);
}

/** XP from solving steps (and finishing). The only XP a run earns. */
export function baseXp(quest: Quest, run: Run): number {
  let total = 0;
  for (const scene of quest.scenes) total += sceneXp(quest, scene, resultFor(run, scene.id));
  if (run.completed) total += quest.xp.completion || 0;
  return total;
}

/** XP for a run. Wagers are a separate silver purse and never change XP. */
export function computeXp(quest: Quest, run: Run): number {
  return baseXp(quest, run);
}

/** Net silver from one settled stake: won when solved first time, lost otherwise. Unsettled = 0. */
export function wagerResult(scene: Scene, run: Run): number {
  const stake = run.wagers?.[scene.id] ?? 0;
  const r = resultFor(run, scene.id);
  if (!stake || !r.solved) return 0;
  return isFirstTry(scene, r) ? stake : -stake;
}

export function wagerNet(quest: Quest, run: Run): number {
  return quest.scenes.reduce((sum, scene) => sum + wagerResult(scene, run), 0);
}

/** Silver earned before `sceneId` (or in the whole run when omitted), including stake results; never below the floor. */
export function purseBefore(quest: Quest, run: Run, sceneId?: string): number {
  let earned = 0;
  let net = 0;
  for (const scene of quest.scenes) {
    if (scene.id === sceneId) break;
    earned += sceneXp(quest, scene, resultFor(run, scene.id));
    net += wagerResult(scene, run);
  }
  return Math.max(Math.ceil(earned * POT_FLOOR_SHARE), earned + net);
}

/** The trader's purse at the end (or current point) of a run. */
export function computeSilver(quest: Quest, run: Run): number {
  return purseBefore(quest, run);
}

export function maxStake(quest: Quest, run: Run): number {
  const scene = currentScene(quest, run);
  if (!isChallenge(scene) || !scene.wager) return 0;
  return Math.floor(purseBefore(quest, run, scene.id) * MAX_STAKE_SHARE);
}

/** Stake silver on the current step. Only before its first attempt; 0 withdraws the stake. */
export function placeWager(quest: Quest, run: Run, amount: number): Run {
  const scene = currentScene(quest, run);
  if (!isChallenge(scene) || !scene.wager) return run;
  const r = resultFor(run, scene.id);
  if (r.attempts > 0 || r.solved) return run;
  const stake = Math.max(0, Math.min(Math.floor(Number.isFinite(amount) ? amount : 0), maxStake(quest, run)));
  return { ...run, wagers: { ...(run.wagers || {}), [scene.id]: stake } };
}

export function stakesPlaced(quest: Quest, run: Run): number {
  return quest.scenes.filter((s) => (run.wagers?.[s.id] ?? 0) > 0).length;
}

/** Credit for one boss step: full marks first time, less after retries, none when revealed. */
export function stepCredit(scene: Scene, result: ChallengeResult): number {
  if (!result.solved || result.revealed) return 0;
  if (isFirstTry(scene, result)) return 1;
  const extra = result.attempts - parFor(scene);
  return extra <= 1 ? 0.6 : 0.3;
}

export function bossScenes(quest: Quest): ChallengeScene[] {
  return quest.scenes.filter((s): s is ChallengeScene => isChallenge(s) && Boolean(s.boss));
}

/** Boss mastery from 0 to 1, or null when the quest has no boss. */
export function bossScore(quest: Quest, run: Run): number | null {
  const scenes = bossScenes(quest);
  if (!scenes.length) return null;
  const weight = (scene: ChallengeScene) => Math.max(0, scene.bossWeight ?? 1);
  const total = scenes.reduce((s, scene) => s + weight(scene) * stepCredit(scene, resultFor(run, scene.id)), 0);
  const max = scenes.reduce((s, scene) => s + weight(scene), 0);
  return max ? Math.round((total / max) * 1000) / 1000 : 0;
}

/** A finished run counts as mastered (and unlocks what follows) when the boss score reaches the threshold. */
export function isMastered(quest: Quest, run: Run): boolean {
  if (!run.completed) return false;
  const score = bossScore(quest, run);
  return score === null || score >= (quest.mastery ?? DEFAULT_MASTERY).threshold;
}

/** The ending this run earned: a failed boss doesn't get the victory text. */
export function endingFor(quest: Quest, run: Run, scene: EndingScene): EndingScene {
  if (!scene.ifNotMastered || isMastered(quest, { ...run, completed: true })) return scene;
  return { ...scene, ...scene.ifNotMastered };
}

export type Medal = 'gold' | 'silver' | 'bronze' | 'none';
/** Share of all rounds solved first time needed for each medal. */
export const MEDAL_RULES = { gold: 0.8, silver: 0.6 };

/** The evidence a medal is based on: never XP, silver or stakes. */
export function masteryEvidence(quest: Quest, run: Run) {
  const rounds = quest.scenes.filter(isChallenge);
  const results = rounds.map((s) => resultFor(run, s.id));
  const firstTime = rounds.filter((s, i) => isFirstTry(s, results[i])).length;
  return {
    rounds: rounds.length,
    firstTime,
    firstTimeShare: rounds.length ? firstTime / rounds.length : 1,
    revealed: results.filter((r) => r.revealed).length,
    /** Boss steps whose answer was revealed (by request or by running out of picks). */
    bossRevealed: bossScenes(quest).filter((s) => resultFor(run, s.id).revealed).length,
    boss: bossScore(quest, run),
    mastered: isMastered(quest, run),
  };
}

/**
 * Medal for a finished run, from demonstrated mastery only.
 *   Bronze: the boss mission reached the mastery threshold (the quest is mastered).
 *   Silver: mastered, and at least 60% of all rounds solved first time.
 *   Gold:   boss at the gold level (85%), at least 80% of rounds first time,
 *           and no answer revealed anywhere in the quest.
 * A revealed boss answer caps the medal at bronze. It changes nothing else:
 * the step already earns no credit, and the pass, XP and unlocks follow the
 * boss score as usual.
 * Wagers play no part: the same play earns the same medal with or without stakes.
 */
export function computeMedal(quest: Quest, run: Run): Medal {
  const e = masteryEvidence(quest, run);
  if (!e.mastered) return 'none';
  if (e.bossRevealed > 0) return 'bronze';
  const gold = (quest.mastery ?? DEFAULT_MASTERY).gold;
  if ((e.boss ?? 1) >= gold && e.firstTimeShare >= MEDAL_RULES.gold && e.revealed === 0) return 'gold';
  if (e.firstTimeShare >= MEDAL_RULES.silver) return 'silver';
  return 'bronze';
}

/** What the player still needs for the next medal, in words (empty at gold). */
export function nextMedalHint(quest: Quest, run: Run): string {
  const e = masteryEvidence(quest, run);
  const medal = computeMedal(quest, run);
  const t = quest.mastery ?? DEFAULT_MASTERY;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (medal === 'none') return `Reach ${pct(t.threshold)} in the final challenge (you scored ${pct(e.boss ?? 0)}).`;
  if (medal === 'bronze' && e.bossRevealed > 0) return 'Bronze at most: an answer in the final challenge was revealed. Replay without revealing one to aim for silver or gold.';
  if (medal === 'bronze') return `Solve at least ${pct(MEDAL_RULES.silver)} of rounds first time for silver (you solved ${e.firstTime} of ${e.rounds}).`;
  if (medal === 'silver') {
    const needs = [];
    if ((e.boss ?? 1) < t.gold) needs.push(`a final-challenge score of ${pct(t.gold)} (you scored ${pct(e.boss ?? 0)})`);
    if (e.firstTimeShare < MEDAL_RULES.gold) needs.push(`${pct(MEDAL_RULES.gold)} of rounds first time (you solved ${e.firstTime} of ${e.rounds})`);
    if (e.revealed) needs.push('no revealed answers');
    return `For gold: ${needs.join(', ')}.`;
  }
  return '';
}

/**
 * A finished run saved by an earlier version of a quest that has since gained a
 * boss: it has no boss results. It keeps its completion and unlocks (see the
 * v4 save migration) but cannot be scored for a medal.
 */
export function isLegacyRun(quest: Quest, run: Run): boolean {
  const boss = bossScenes(quest);
  return boss.length > 0 && boss.every((s) => !resultFor(run, s.id).solved);
}

export const MEDAL_RANK: Record<Medal, number> = { none: 0, bronze: 1, silver: 2, gold: 3 };

/** Strengths and weaknesses by concept for the results screen. */
export function conceptReport(quest: Quest, run: Run) {
  const by = new Map<string, { firstTry: number; total: number; revealed: number }>();
  for (const scene of quest.scenes) {
    if (!isChallenge(scene)) continue;
    const r = resultFor(run, scene.id);
    if (!r.solved) continue;
    for (const c of conceptsFor(scene, run)) {
      const e = by.get(c) || { firstTry: 0, total: 0, revealed: 0 };
      e.total += 1;
      if (isFirstTry(scene, r)) e.firstTry += 1;
      if (r.revealed) e.revealed += 1;
      by.set(c, e);
    }
  }
  return [...by.entries()].map(([id, e]) => ({
    id, ...e, strength: e.revealed ? 'review' as const : e.firstTry === e.total ? 'strong' as const : 'developing' as const,
  }));
}

/** Column letter helper re-exported for game views. */
export const columnLetter = colName;

export function maxXp(quest: Quest): number {
  const perfect = { attempts: 1, solved: true, revealed: false };
  return quest.scenes.reduce((sum, scene) => sum + sceneXp(quest, scene, perfect), 0) + (quest.xp.completion || 0);
}

/**
 * Stars for a finished run: 3 = every challenge right first time,
 * 2 = finished without revealing any answer, 1 = finished with help.
 */
/**
 * Whether a check finished the step, so its concept event should be recorded:
 * a right answer, or running out of evidence picks (recorded as revealed).
 * A step can finish only once, so this never double-counts.
 */
export function stepFinished(outcome: Outcome): boolean {
  return Boolean(outcome.valid && (outcome.correct || outcome.locked));
}

/**
 * Where a step sits in a game quest, as one source for both the visible badge
 * and the screen-reader announcement: "Round 3 of 12" or "Boss stage 2 of 5".
 */
export function roundLabel(quest: Quest, sceneId: string): { kind: 'round' | 'boss'; index: number; total: number; text: string } | null {
  const scene = quest.scenes.find((s) => s.id === sceneId);
  if (!isChallenge(scene)) return null;
  const group = quest.scenes.filter((s) => isChallenge(s) && Boolean(s.boss) === Boolean(scene.boss));
  const index = group.findIndex((s) => s.id === sceneId) + 1;
  return scene.boss
    ? { kind: 'boss', index, total: group.length, text: `Boss stage ${index} of ${group.length}` }
    : { kind: 'round', index, total: group.length, text: `Round ${index} of ${group.length}` };
}

/** Quests built from the game mechanics: rated by medal, not stars. */
export function isGameQuest(quest: Quest): boolean {
  return quest.scenes.some((s) => isChallenge(s) && Boolean(s.mechanic));
}

const MEDAL_STARS: Record<Medal, number> = { gold: 3, silver: 2, bronze: 1, none: 0 };

/**
 * Stars for course quests. A game quest has one rating, its medal, so its
 * stars simply mirror the medal (gold 3 … none 0) to keep the island's star
 * total consistent without a second, competing score.
 */
export function computeStars(quest: Quest, run: Run): number {
  if (!run.completed) return 0;
  if (isGameQuest(quest)) return MEDAL_STARS[computeMedal(quest, run)];
  const scenes = quest.scenes.filter(isChallenge);
  const results = scenes.map((s) => resultFor(run, s.id));
  if (results.some((r) => r.revealed)) return 1;
  if (scenes.every((s, i) => isFirstTry(s, results[i]))) return 3;
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
      else if (scenes.every((s, i) => isFirstTry(s, results[i]))) status = 'demonstrated';
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
