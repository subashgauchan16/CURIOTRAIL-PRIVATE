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
export interface EndingScene extends SceneBase { type: 'ending' }
export interface EvidenceScene extends SceneBase { type: 'evidence'; evidence: string[] }

export interface ChoiceOption { id: string; text: string; feedback: string; code?: boolean }
export interface ChoiceScene extends ChallengeBase {
  type: 'choice';
  options: ChoiceOption[];
  correct: string;
  code?: string; // optional code/data snippet shown with the question
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

export type ChallengeScene = ChoiceScene | AssembleScene | SqlScene | PythonScene | ExcelScene | KpiScene | SchemaScene;
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
}

export interface SqlResult { columns: string[]; rows: Cell[][] }

export type Answer =
  | string // choice option id
  | { slots: Record<string, string>; extras: string[] } // assemble
  | { query: string; result?: SqlResult; error?: string } // sql (executed by sql-runner)
  | { expression: string } // python
  | { formula: string } // excel
  | { placement: Record<string, string> } // kpi
  | { model: LabModel }; // schema lab

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
}

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
