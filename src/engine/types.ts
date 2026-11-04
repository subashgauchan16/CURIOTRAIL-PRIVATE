// Shared types for quest content, runs and saved progress.

export type Cell = string | number | null;

export interface Character {
  name: string;
  role: string;
  initial: string;
}

export interface Evidence {
  id: string;
  kind: 'source' | 'ai' | 'message' | string;
  kindLabel: string;
  title: string;
  from: string;
  body: string[];
}

interface SceneBase {
  id: string;
  title: string;
  speaker?: string;
  lines?: string[];
  context?: string;
  action?: string;
}

export type LearningPhase = 'guided' | 'practice' | 'assessment';

interface ChallengeBase extends SceneBase {
  /** Where this step sits in the learning cycle; shown as a badge. Defaults to practice. */
  phase?: LearningPhase;
  prompt: string;
  hints: string[];
  explanation: string;
  skills: string[];
  xp: number;
  /** Encyclopedia concept ids practised here (e.g. "XL.REF.ABSOLUTE"); drive mastery and the Codex. */
  concepts?: string[];
  /** Part of the quest's boss mission: scored for mastery, fewer hints. */
  boss?: boolean;
  /** Weight of this step in the boss score (default 1). A step that checks recall rather than use counts less. */
  bossWeight?: number;
  /** The player may stake XP on getting this right first time. */
  wager?: boolean;
  /** Short name of the game mechanic, shown on the round banner (e.g. "Ledger Workshop"). */
  mechanic?: string;
  /** How the market stall reacts to this step's result (game quests). */
  consequence?: 'scales' | 'crates' | 'coins';
}

/** Alternative data for a step, chosen per run so a boss cannot be memorised. */
export interface DataVariant {
  rows: Cell[][];
  expected?: Record<string, number>;
  /** For decision steps whose right answer depends on the data. */
  correct?: string;
  /** For evidence steps: the cells that prove the point in this variant. */
  answer?: string[];
  /** Text shown with the step for this variant (e.g. the figures being discussed). */
  context?: string;
}

export interface DialogueScene extends SceneBase { type: 'dialogue' }

/** A theory card. Teaches a concept before it is practised; awards no XP. */
export interface LessonContent {
  concept: string;
  objective: string;
  plainEnglish: string;
  analogy: string;
  example?: { kind: 'sql' | 'python' | 'excel' | 'text' | 'dax'; code: string; caption?: string };
  whyItMatters: string;
  commonMistake: string;
  takeaway: string;
  /** Honest note when the lesson simplifies a concept for beginners. */
  simplification?: string;
}
export interface LessonScene extends SceneBase {
  type: 'lesson';
  lesson: LessonContent;
  skills: string[]; // objectives this lesson teaches (links weak skills back to lessons)
}
export interface EndingScene extends SceneBase {
  type: 'ending';
  /** Shown instead of the ending's title and lines when the run didn't reach mastery. */
  ifNotMastered?: { title: string; lines: string[] };
}
export interface EvidenceScene extends SceneBase { type: 'evidence'; evidence: string[] }

export interface ChoiceOption { id: string; text: string; feedback: string; code?: boolean }
export interface ChoiceScene extends ChallengeBase {
  type: 'choice';
  options: ChoiceOption[];
  correct: string;
  code?: string; // optional code/data snippet shown with the question
  /** Optional ledger shown with the question (e.g. "explain the outcome"); variants may change it. */
  sheet?: { columns: string[]; rows: Cell[][] };
  variants?: DataVariant[];
}

/** A ledger the player reads and points at (shared by evidence steps and wheel segments). */
export interface SpotTask {
  columns: string[];
  rows: Cell[][];
  /** "cell": only the listed cells count; "row": any cell in a listed cell's row counts. */
  select: 'cell' | 'row';
  /** The cell(s) that answer the question. */
  answer: string[];
  /** Feedback for particular wrong picks, keyed by cell ("C3") or row ("row:4"). */
  feedback?: Record<string, string>;
  successFeedback?: string;
}

/**
 * Point at the evidence: the player selects the cell (or row) in the ledger
 * that answers the question, by clicking it or typing its address.
 */
export interface SpotScene extends ChallengeBase, SpotTask {
  type: 'spot';
  /**
   * A working column the player fills with a formula (filled down). Without
   * `solutions` it is an optional aid and never scored. With `solutions` it is
   * required and assessed first: it must produce the same column as one of
   * the solution formulas on this run's data before the pick is checked.
   */
  scratch?: { label: string; solutions?: string[] };
  variants?: DataVariant[];
}

export interface AssembleOption { id: string; text: string; correct?: boolean; feedback?: string }
export interface AssembleScene extends ChallengeBase {
  type: 'assemble';
  heading: string;
  fixedLines?: string[];
  successFeedback?: string;
  slots: { id: string; label: string; options: AssembleOption[] }[];
  extras?: { id: string; text: string; supported: boolean; feedback?: string }[];
}

export interface TableData { name: string; columns: string[]; rows: Cell[][] }

export interface SqlScene extends ChallengeBase {
  type: 'sql';
  setup: string; // SQL run on a fresh in-memory database before each query
  tables: TableData[]; // shown to the player
  starter: string;
  expected: { rows: Cell[][]; ordered?: boolean };
  requireKeywords?: string[];
  solution: string;
  successFeedback?: string;
}

export interface PythonScene extends ChallengeBase {
  type: 'python';
  code: string[]; // program lines; "___" marks where the player's expression goes
  variables: Record<string, unknown>; // values available to the expression
  expected: { value?: unknown; output?: string };
  outputTemplate?: string; // e.g. "print(___)" → shows what the program prints
  requireNames?: string[];
  forbidPattern?: string;
  starter?: string;
  solution: string;
  successFeedback?: string;
}

export interface ExcelScene extends ChallengeBase {
  type: 'excel';
  columns: string[]; // header labels for A, B, C…
  rows: Cell[][]; // row 1 is the first data row under the header (sheet row 2)
  target: string; // e.g. "D2"
  fillDownTo?: string; // e.g. "D5": formula is copied down like Excel's fill handle
  expected: Record<string, number>;
  requireFunctions?: string[];
  starter?: string;
  solution: string;
  successFeedback?: string;
}

/** Build a formula from fragment tokens on a live ledger (drag, tap or keyboard). */
export interface WorkshopScene extends ChallengeBase {
  type: 'workshop';
  columns: string[];
  rows: Cell[][];
  target: string;
  fillDownTo?: string;
  expected: Record<string, number>;
  requireFunctions?: string[];
  solution: string;
  /** Fragments offered on the bench, including some that are not needed. */
  tokens: string[];
  variants?: DataVariant[];
  successFeedback?: string;
}

/** Diagnose why a formula is wrong, then fix it. The fix is also run on a second dataset. */
export interface RepairScene extends ChallengeBase {
  type: 'repair';
  columns: string[];
  rows: Cell[][];
  target: string;
  fillDownTo?: string;
  expected: Record<string, number>;
  broken: string;
  diagnoses: { id: string; text: string; feedback: string }[];
  correctDiagnosis: string;
  solution: string;
  requireFunctions?: string[];
  /** A second dataset the fix must also handle, so a typed-in answer cannot pass. */
  check?: { rows: Cell[][]; expected: Record<string, number> };
  variants?: DataVariant[];
  successFeedback?: string;
}

/** Guess the hidden function name from a business clue (Wordle-style). */
export interface RunewordScene extends ChallengeBase {
  type: 'runeword';
  word: string;
  clue: string;
  /** Guesses allowed before the answer can be revealed. */
  maxGuesses: number;
  /** Solving within this many guesses counts as "first try" for stars, wagers and mastery. */
  par: number;
}

export interface WheelChoice { kind: 'choice'; prompt: string; options: ChoiceOption[]; correct: string; code?: string }
export interface WheelSpot extends SpotTask { kind: 'spot'; prompt: string }
export interface WheelFormula {
  kind: 'formula'; prompt: string; columns: string[]; rows: Cell[][]; target: string; fillDownTo?: string;
  expected: Record<string, number>; solution: string; requireFunctions?: string[]; requireRefs?: string[];
}
export interface WheelSegment {
  id: string;
  label: string; // rune / function family shown on the wheel
  concepts: string[];
  challenge: WheelChoice | WheelFormula | WheelSpot;
  hints: string[];
  explanation: string;
}
/** Spin the rune wheel; the landed segment sets the challenge. The spin never decides a payout. */
export interface WheelScene extends ChallengeBase {
  type: 'wheel';
  segments: WheelSegment[];
}

/** Pair items (errors with causes, questions with functions…). */
export interface MatchScene extends ChallengeBase {
  type: 'match';
  left: { id: string; text: string; code?: boolean }[];
  right: { id: string; text: string; code?: boolean }[];
  pairs: Record<string, string>;
  feedback: Record<string, string>; // per left id, shown when that pair is wrong
  successFeedback?: string;
}

/** Restock decision: the player's own profit formula and order quantities decide the outcome. */
export interface GambitScene extends ChallengeBase {
  type: 'gambit';
  /** Item, Price, Cost, Demand (columns A–D); Order is column E, Profit column F. */
  items: { name: string; price: number; cost: number; demand: number }[];
  purse: number;
  targetProfit: number;
  maxOrder: number;
  solution: { orders: number[]; formula: string };
  successFeedback?: string;
}

export interface KpiScene extends ChallengeBase {
  type: 'kpi';
  categories: { id: string; label: string; description: string }[];
  cards: { id: string; label: string; detail: string; category: string; feedback: string }[];
  successFeedback?: string;
}

// ---- Data-modelling lab (star schema) ----

export type KeyKind = 'pk' | 'fk';
export interface LabColumn { name: string; key?: KeyKind; description?: string }
export interface LabTable {
  id: string;
  label: string;
  /** What one row represents. */
  grain: string;
  /** 'transaction' marks a table at transaction-level grain (a valid fact table). */
  grainLevel: 'transaction' | 'aggregated' | 'lookup';
  description: string;
  columns: LabColumn[];
  rows: Cell[][]; // sample rows used by the validator (uniqueness, matching keys)
}
export type Cardinality = 'many-to-one' | 'one-to-many' | 'one-to-one' | 'many-to-many';
export type FilterDirection = 'single' | 'both';
export interface ColumnRef { table: string; column: string }

export interface SchemaScene extends ChallengeBase {
  type: 'schema';
  tables: LabTable[];
  requiredTables: string[];
  factTable: string;
  dimensions: string[];
  /** The intended model, used for "show me the answer" and tests. */
  solution: {
    tables: string[];
    relationships: { from: ColumnRef; to: ColumnRef; cardinality: Cardinality; direction: FilterDirection }[];
  };
  successFeedback?: string;
}

export interface LabRelationship {
  id: string;
  from: ColumnRef; // the side clicked first
  to: ColumnRef;
  cardinality: Cardinality | null; // null = not chosen yet
  direction: FilterDirection;
}
export interface LabModel {
  placed: { table: string; x: number; y: number }[]; // x, y are 0..1 fractions of the workspace
  relationships: LabRelationship[];
  factTable: string | null;
}

export type ChallengeScene =
  | ChoiceScene | AssembleScene | SqlScene | PythonScene | ExcelScene | KpiScene | SchemaScene
  | WorkshopScene | RepairScene | RunewordScene | WheelScene | MatchScene | GambitScene | SpotScene;
export type Scene = DialogueScene | EvidenceScene | EndingScene | LessonScene | ChallengeScene;

export interface Quest {
  schemaVersion: 1;
  id: string;
  number: number;
  title: string;
  completionTitle?: string;
  region: string;
  destination: string;
  subject: string;
  estimatedMinutes: string;
  intro: string;
  objectives: { id: string; label: string }[];
  characters: Record<string, Character>;
  evidence: Evidence[];
  xp: { firstTryBonus: number; completion: number };
  badge?: { id: string; name: string; description: string; icon?: string };
  takeaway: string;
  /** Quests that must be completed first (prerequisite-based unlocking). */
  requires?: string[];
  /** Boss mastery needed to count as mastered (unlocks), and for a gold medal. */
  mastery?: { threshold: number; gold: number };
  scenes: Scene[];
}

export interface Destination {
  id: string;
  name: string;
  theme: string;
  icon: string;
  quests: string[];
  unlockedBy: string[] | 'planned';
  position: [number, number]; // island x/z in model units; height comes from raycasting
  landmark: string;
  teaser?: string;
}

/** Which island model the world uses, and how its units relate to the original island. */
export interface IslandConfig {
  files: { low: string; high?: string }; // under ./models/
  scale: number; // 1 = original island (1 unit = 1 block); 0.25 = island B (1 unit = 1 m)
  characterScale: number; // scale of the procedural quest characters
  nav?: string; // walk grid under ./data/ (enables free exploration)
}

export interface World {
  schemaVersion: 1;
  /**
   * The suggested order for the "Next" quest (a recommendation only: it never
   * locks anything). Quests not listed fall back to the map order.
   */
  recommendedOrder?: string[];
  destinations: Destination[];
  island?: IslandConfig;
}

// ---- Runs and answers ----

export interface ChallengeResult { attempts: number; solved: boolean; revealed: boolean }

export interface Run {
  questId: string;
  sceneIndex: number;
  /** Stable id of the current step; survives content changes that shift indices. */
  sceneId?: string;
  inspected: string[];
  results: Record<string, ChallengeResult>;
  completed: boolean;
  /** Chooses data variants and wheel spins; fixed per run so results are reproducible. */
  seed?: number;
  /** XP staked per step (placed before the first attempt). */
  wagers?: Record<string, number>;
  /** Landed wheel segment id per wheel step. */
  spins?: Record<string, string>;
  /** Guesses made per rune-word step. */
  guesses?: Record<string, string[]>;
}

export interface SqlResult { columns: string[]; rows: Cell[][] }

export type Answer =
  | string // choice option id
  | { slots: Record<string, string>; extras: string[] } // assemble
  | { query: string; result?: SqlResult; error?: string } // sql (executed by sql-runner)
  | { expression: string } // python
  | { formula: string } // excel
  | { placement: Record<string, string> } // kpi
  | { model: LabModel } // schema lab
  | { diagnosis: string; formula: string } // repair
  | { guess: string } // runeword
  | { response: string | { formula: string } | { cell: string } } // wheel (answer to the landed segment)
  | { cell: string; working?: string } // spot (the selected cell's address, and the working formula if required)
  | { pairs: Record<string, string> } // match
  | { orders: number[]; formula: string }; // gambit

export interface Issue { id: string; label: string; text: string }

export interface Outcome {
  valid: boolean;
  message?: string;
  correct?: boolean;
  feedback?: string;
  issues?: Issue[];
  output?: string; // what the code/query/formula produced, shown to the player
  attempts?: number;
  hint?: string | null;
  canReveal?: boolean;
  explanation?: string;
  /** Rune-word tile colours for the guess just made. */
  tiles?: Tile[];
  /** Gambit: how the restock played out, row by row. */
  trade?: TradeReport;
  /** Evidence steps: the cell that was judged (absent when the working column failed first). */
  pick?: string;
  /** Evidence steps: wrong picks still allowed before the answer is shown. */
  picksLeft?: number;
  /** Evidence steps: the pick limit was reached, so the answer was shown (no credit). */
  locked?: boolean;
}

export type Tile = 'hit' | 'near' | 'miss';

export interface TradeReport {
  rows: { item: string; order: number; sold: number; leftover: number; profit: number; yours: number | null }[];
  spend: number;
  purse: number;
  total: number;
  target: number;
}

// ---- Codex (encyclopedia cards) ----

export interface CodexEntry {
  title: string;
  summary: string;
  example?: string;
  pitfall?: string;
  ref: { volume: string; chapter: string; page?: number };
}
export interface Codex { schemaVersion: 1; source: string; entries: Record<string, CodexEntry> }

// ---- Curriculum (modules) ----

export interface CurriculumModule {
  id: string;
  number: number;
  title: string;
  subject: string;
  level: 'Beginner' | 'Intermediate' | 'Advanced' | 'Capstone';
  summary: string;
  /** Playable quests (including labs) that belong to this module, in order. */
  quests: string[];
  /** Topics planned for this module but not built yet. Shown as planned. */
  planned: string[];
  /** Modules recommended first (used for Phase 2 gating; informational now). */
  requires: string[];
}
export interface Curriculum { schemaVersion: 1; modules: CurriculumModule[] }
