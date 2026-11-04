// Browser-side progress. localStorage is user-controlled, so everything read
// back is treated as untrusted: migrated, validated and clamped. Suitable for
// a personal prototype, not for accounts or trusted scores.

import type { Quest, Run } from './types';
import { computeStars, restoreRun, MEDAL_RANK, type Medal } from './game-engine';
import { sanitizeConcepts, type ConceptRecord } from './games/mastery';

export const STORAGE_KEY = 'curiotrail.progress';
export const SCHEMA_VERSION = 5;
export const MEDALS: Medal[] = ['none', 'bronze', 'silver', 'gold'];
export const EMBLEMS = ['fox', 'owl', 'deer', 'badger'] as const;
export const MAX_NAME_LENGTH = 24;

export interface Player { name: string; emblem: Emblem }
const MAX_XP = 100000;

export type Emblem = (typeof EMBLEMS)[number];
export type Motion = 'system' | 'reduce' | 'full';
export type TextSize = 'normal' | 'large';
export type Graphics = 'auto' | 'high' | 'low' | 'off';

export interface Settings { motion: Motion; textSize: TextSize; graphics: Graphics }

export interface QuestRecord {
  run: Run | null; // in-progress (or just finished) run
  runXp: number;
  lastRun: Run | null; // last finished run, shown on the results screen
  lastXp: number;
  bestXp: number;
  bestStars: number;
  completed: boolean;
  completions: number;
  /** Mastery reached (boss threshold met). Unlocks depend on this, not on XP. */
  mastered: boolean;
  /** Best boss mastery (0–1) across runs; null when the quest has no boss or it was never scored. */
  bestMastery: number | null;
  bestMedal: Medal;
  /** Best silver purse (the optional wager side-game). Affects nothing else. */
  bestSilver: number;
}

export interface Progress {
  version: number;
  player: Player | null;
  quests: Record<string, QuestRecord>;
  achievements: string[];
  /** Lessons (theory cards) the player has read, as "questId/sceneId". */
  lessons: string[];
  settings: Settings;
  /** Per-concept mastery (encyclopedia ids), kept on this device only. */
  concepts: Record<string, ConceptRecord>;
  /** Learning history behind the profile's field notes (this device only). */
  events: LearningEvent[];
  /** The player can pause the learning history; nothing new is recorded while false. */
  recordEvents: boolean;
}

/**
 * One learning event, recorded on this device only (never sent anywhere).
 * Kept small: the log is capped at MAX_EVENTS, oldest first out.
 *   start     a challenge step was opened with no answer yet in this run
 *   answer    an answer was checked (ok = correct)
 *   hint      the game showed a hint after a wrong answer
 *   reveal    the answer was shown (asked for, or out of picks): no credit
 *   finish    a quest run was finished (score = mastery score 0-100)
 *   practice  a practice round was finished (ok = right first time, not revealed)
 *   lesson    a lesson (theory card) was read
 */
export const EVENT_KINDS = ['start', 'answer', 'hint', 'reveal', 'finish', 'practice', 'lesson'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export interface LearningEvent {
  /** Time (ms since epoch). */
  t: number;
  k: EventKind;
  /** Quest id. */
  q: string;
  /** Step id (absent for "finish"). */
  s?: string;
  /** The run's seed, so a replay's answers are counted as a new run. */
  r?: number;
  ok?: boolean;
  /** "finish" only: mastery score 0-100. */
  score?: number;
}
export const MAX_EVENTS = 2000;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function defaultSettings(): Settings {
  return { motion: 'system', textSize: 'normal', graphics: 'auto' };
}

export function defaultProgress(): Progress {
  return { version: SCHEMA_VERSION, player: null, quests: {}, achievements: [], lessons: [], settings: defaultSettings(), concepts: {}, events: [], recordEvents: true };
}

export function emptyRecord(): QuestRecord {
  return { run: null, runXp: 0, lastRun: null, lastXp: 0, bestXp: 0, bestStars: 0, completed: false, completions: 0, mastered: false, bestMastery: null, bestMedal: 'none', bestSilver: 0 };
}

function clampInt(value: unknown, max = MAX_XP): number {
  return Number.isInteger(value) && (value as number) > 0 ? Math.min(value as number, max) : 0;
}

export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Drop control characters; the UI always renders names as text, never HTML.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

function sanitizePlayer(raw: unknown): Progress['player'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    name: cleanName(r.name) || 'Pathfinder',
    emblem: (EMBLEMS as readonly string[]).includes(r.emblem as string) ? (r.emblem as Emblem) : EMBLEMS[0],
  };
}

function sanitizeSettings(raw: unknown): Settings {
  const settings = defaultSettings();
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (['system', 'reduce', 'full'].includes(r.motion as string)) settings.motion = r.motion as Motion;
    if (['normal', 'large'].includes(r.textSize as string)) settings.textSize = r.textSize as TextSize;
    if (['auto', 'high', 'low', 'off'].includes(r.graphics as string)) settings.graphics = r.graphics as Graphics;
  }
  return settings;
}

function sanitizeQuestRecord(id: string, raw: unknown): QuestRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  // Runs are re-checked against quest content by restoreRun().
  const ownRun = (value: unknown) => (value && typeof value === 'object' && (value as Run).questId === id ? (value as Run) : null);
  const run = ownRun(r.run);
  const lastRun = ownRun(r.lastRun);
  return {
    run,
    runXp: run ? clampInt(r.runXp) : 0,
    lastRun,
    lastXp: lastRun ? clampInt(r.lastXp) : 0,
    bestXp: clampInt(r.bestXp),
    bestStars: clampInt(r.bestStars, 3),
    completed: r.completed === true,
    completions: clampInt(r.completions, 9999),
    // Saves from before mastery existed: a completed quest keeps its unlocks.
    mastered: typeof r.mastered === 'boolean' ? r.mastered && r.completed === true : r.completed === true,
    bestMastery: typeof r.bestMastery === 'number' && r.bestMastery >= 0 && r.bestMastery <= 1 ? r.bestMastery : null,
    bestMedal: (MEDALS as string[]).includes(r.bestMedal as string) ? (r.bestMedal as Medal) : 'none',
    bestSilver: clampInt(r.bestSilver),
  };
}

/**
 * Step order of each quest in schema v2 (release 0.2). v2 saves record a run's
 * position only as an index; v3 adds lesson steps, which shifts indices, so the
 * migration converts each saved index into a stable step id using this table.
 * Do not edit: it describes content that has already shipped.
 */
export const V2_SCENE_ORDER: Record<string, string[]> = {
  'missing-signal': ['arrive', 'investigate', 'find-source', 'spot-conflict', 'verify-time', 'rumour', 'better-prompt', 'assemble', 'restore'],
  'the-ledger': ['arrive', 'read-select', 'filter-north', 'group-products', 'top-product', 'interpret', 'ending'],
  'broken-tally': ['arrive', 'read-error', 'fix-print', 'average', 'revenue', 'predict', 'ending'],
  'market-ledger': ['arrive', 'find-cell', 'row-revenue', 'total', 'average-price', 'absolute', 'ending'],
  'great-hall-dashboard': ['arrive', 'what-kpi', 'sort-kpis', 'tradeoff', 'chart', 'ending'],
};

function addSceneId(questId: string, run: unknown): unknown {
  if (!run || typeof run !== 'object') return run;
  const r = run as Record<string, unknown>;
  if (typeof r.sceneId === 'string') return run;
  const order = V2_SCENE_ORDER[questId];
  const id = order && Number.isInteger(r.sceneIndex) ? order[r.sceneIndex as number] : undefined;
  return id ? { ...r, sceneId: id } : run;
}

// Upgrade older saves to the current shape. One step per schema change.
export function migrate(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const data: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  if (!Number.isInteger(data.version)) return null;
  if ((data.version as number) > SCHEMA_VERSION) return null; // saved by a newer release
  if (data.version === 1) {
    // v2 added star ratings (back-filled from the last finished run once quest
    // content is loaded, see reconcileStars) and the graphics setting.
    data.version = 2;
  }
  if (data.version === 2) {
    // v3 added lessons (theory cards) and stable step ids on runs.
    const quests: Record<string, unknown> = {};
    if (data.quests && typeof data.quests === 'object' && !Array.isArray(data.quests)) {
      for (const [id, record] of Object.entries(data.quests as Record<string, unknown>)) {
        quests[id] = record && typeof record === 'object'
          ? { ...(record as Record<string, unknown>), run: addSceneId(id, (record as Record<string, unknown>).run), lastRun: addSceneId(id, (record as Record<string, unknown>).lastRun) }
          : record;
      }
    }
    data.quests = quests;
    data.lessons = [];
    data.version = 3;
  }
  if (data.version === 3) {
    // v4 added mastery (unlocks follow mastery), medals, wagers and per-concept
    // records. Completed quests are treated as mastered so no one loses an
    // unlock they already earned (see sanitizeQuestRecord).
    data.concepts = {};
    data.version = 4;
  }
  if (data.version === 4) {
    // v5 added the on-device learning history behind the profile. Older play
    // has no history; it starts from the first step played after updating.
    data.events = [];
    data.recordEvents = true;
    data.version = 5;
  }
  return data;
}

const ID = /^[a-z0-9-]{1,64}$/;
const EARLIEST = Date.UTC(2024, 0, 1);

export function sanitizeEvents(raw: unknown, now = Date.now()): LearningEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: LearningEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (!(EVENT_KINDS as readonly string[]).includes(e.k as string)) continue;
    if (typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t < EARLIEST || e.t > now + 86_400_000) continue;
    if (typeof e.q !== 'string' || !ID.test(e.q)) continue;
    const ev: LearningEvent = { t: Math.round(e.t), k: e.k as EventKind, q: e.q };
    if (e.k !== 'finish') {
      if (typeof e.s !== 'string' || !ID.test(e.s)) continue;
      ev.s = e.s;
    }
    if (Number.isInteger(e.r)) ev.r = e.r as number;
    if (typeof e.ok === 'boolean') ev.ok = e.ok;
    if (e.k === 'finish') {
      if (!Number.isInteger(e.score) || (e.score as number) < 0 || (e.score as number) > 100) continue;
      ev.score = e.score as number;
    }
    out.push(ev);
  }
  out.sort((a, b) => a.t - b.t);
  return out.slice(-MAX_EVENTS);
}

export function sanitizeProgress(raw: unknown): Progress {
  const data = migrate(raw);
  if (!data) return defaultProgress();
  const quests: Record<string, QuestRecord> = {};
  if (data.quests && typeof data.quests === 'object' && !Array.isArray(data.quests)) {
    for (const [id, record] of Object.entries(data.quests as Record<string, unknown>)) {
      if (!/^[a-z0-9-]{1,64}$/.test(id)) continue;
      const clean = sanitizeQuestRecord(id, record);
      if (clean) quests[id] = clean;
    }
  }
  const achievements = Array.isArray(data.achievements)
    ? [...new Set(data.achievements.filter((a): a is string => typeof a === 'string' && /^[a-z0-9-]{1,64}$/.test(a)))]
    : [];
  const lessons = Array.isArray(data.lessons)
    ? [...new Set(data.lessons.filter((l): l is string => typeof l === 'string' && /^[a-z0-9-]{1,64}\/[a-z0-9-]{1,64}$/.test(l)))].slice(0, 1000)
    : [];
  return {
    version: SCHEMA_VERSION,
    player: sanitizePlayer(data.player),
    quests,
    achievements,
    lessons,
    settings: sanitizeSettings(data.settings),
    concepts: sanitizeConcepts(data.concepts),
    events: sanitizeEvents(data.events),
    recordEvents: data.recordEvents !== false,
  };
}

function browserStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    const probe = '__curiotrail_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null; // private mode, blocked storage, or no window
  }
}

export function createProgressStore(storage: StorageLike | null = browserStorage()) {
  return {
    available: Boolean(storage),
    load(): Progress {
      if (!storage) return defaultProgress();
      try {
        const text = storage.getItem(STORAGE_KEY);
        return text ? sanitizeProgress(JSON.parse(text)) : defaultProgress();
      } catch {
        return defaultProgress(); // corrupted JSON
      }
    },
    save(progress: Progress): boolean {
      if (!storage) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(progress));
        return true;
      } catch {
        return false; // quota exceeded or storage revoked
      }
    },
    reset(): void {
      if (!storage) return;
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to clear */
      }
    },
  };
}

// ---- Pure helpers for updating progress ----

export function questRecord(progress: Progress, questId: string): QuestRecord {
  return progress.quests[questId] || emptyRecord();
}

export function withPlayer(progress: Progress, name: string, emblem: string): Progress {
  return { ...progress, player: sanitizePlayer({ name, emblem }) };
}

export function withSettings(progress: Progress, settings: Partial<Settings>): Progress {
  return { ...progress, settings: sanitizeSettings({ ...progress.settings, ...settings }) };
}

export function withRun(progress: Progress, run: Run, runXp: number): Progress {
  const record = questRecord(progress, run.questId);
  return { ...progress, quests: { ...progress.quests, [run.questId]: { ...record, run, runXp: clampInt(runXp) } } };
}

// Record a finished run. Replays keep the best score rather than stacking XP,
// so total XP reflects demonstrated skill, not repetition.
export interface CompletionResult {
  /** Whether this run reached mastery. Defaults to true for quests without a boss. */
  mastered?: boolean;
  mastery?: number | null;
  medal?: Medal;
  silver?: number;
}

export function withCompletion(progress: Progress, run: Run, xp: number, stars: number, achievementId?: string, result: CompletionResult = {}): Progress {
  const record = questRecord(progress, run.questId);
  const alreadyCounted = Boolean(record.run && record.run.completed);
  const mastered = result.mastered ?? true;
  const mastery = typeof result.mastery === 'number' ? result.mastery : null;
  const medal = result.medal ?? 'none';
  const quests = {
    ...progress.quests,
    [run.questId]: {
      run,
      runXp: clampInt(xp),
      lastRun: run,
      lastXp: clampInt(xp),
      bestXp: Math.max(record.bestXp, clampInt(xp)),
      bestStars: Math.max(record.bestStars, clampInt(stars, 3)),
      completed: true,
      completions: record.completions + (alreadyCounted ? 0 : 1),
      // Replays never take mastery or a medal away.
      mastered: record.mastered || mastered,
      bestMastery: mastery === null ? record.bestMastery : Math.max(record.bestMastery ?? 0, mastery),
      bestMedal: MEDAL_RANK[medal] > MEDAL_RANK[record.bestMedal] ? medal : record.bestMedal,
      bestSilver: Math.max(record.bestSilver, clampInt(result.silver ?? 0)),
    },
  };
  const achievements = achievementId && !progress.achievements.includes(achievementId)
    ? [...progress.achievements, achievementId]
    : progress.achievements;
  return { ...progress, quests, achievements };
}

export function withReplay(progress: Progress, questId: string): Progress {
  const record = questRecord(progress, questId);
  return { ...progress, quests: { ...progress.quests, [questId]: { ...record, run: null, runXp: 0 } } };
}

/** Prefix shared by every key the game writes to browser storage. */
export const OWNED_PREFIX = 'curiotrail.';

/**
 * Remove every CurioTrail key from one storage area: the save, modelling-lab
 * drafts, and the exploration position and "controls seen" flag. Nothing else
 * on the site's origin is touched.
 */
export function clearOwnedKeys(area: Pick<Storage, 'length' | 'key' | 'removeItem'>): void {
  const keys: string[] = [];
  for (let i = 0; i < area.length; i += 1) {
    const key = area.key(i);
    if (key?.startsWith(OWNED_PREFIX)) keys.push(key);
  }
  keys.forEach((key) => area.removeItem(key));
}

/** Replace the per-concept mastery records (computed by games/mastery.ts). */
export function withConcepts(progress: Progress, concepts: Record<string, ConceptRecord>): Progress {
  return concepts === progress.concepts ? progress : { ...progress, concepts };
}

/** Remember that a lesson was read. Lessons award no XP: XP is for demonstrated skill. */
export function withLessonRead(progress: Progress, key: string): Progress {
  if (progress.lessons.includes(key) || !/^[a-z0-9-]{1,64}\/[a-z0-9-]{1,64}$/.test(key)) return progress;
  return { ...progress, lessons: [...progress.lessons, key] };
}

/** Add one learning event, unless the player has paused the history. */
export function withEvent(progress: Progress, event: Omit<LearningEvent, 't'> & { t?: number }): Progress {
  if (!progress.recordEvents) return progress;
  const clean = sanitizeEvents([{ t: Date.now(), ...event }]);
  if (!clean.length) return progress;
  const events = [...progress.events, clean[0]];
  return { ...progress, events: events.length > MAX_EVENTS ? events.slice(-MAX_EVENTS) : events };
}

/** Pause or resume the learning history. Pausing keeps what is already recorded. */
export function withRecordEvents(progress: Progress, recordEvents: boolean): Progress {
  return progress.recordEvents === recordEvents ? progress : { ...progress, recordEvents };
}

/** Delete the learning history only; quests, XP and settings stay. */
export function withEventsCleared(progress: Progress): Progress {
  return progress.events.length ? { ...progress, events: [] } : progress;
}

export function totalXp(progress: Progress): number {
  return Object.values(progress.quests).reduce((sum, r) => sum + Math.max(r.bestXp, r.runXp), 0);
}

export function totalStars(progress: Progress): number {
  return Object.values(progress.quests).reduce((sum, r) => sum + r.bestStars, 0);
}

/** Back-fill stars for saves made before stars existed (schema v1). */
export function reconcileStars(progress: Progress, quests: Map<string, Quest>): Progress {
  let changed = false;
  const next = { ...progress.quests };
  for (const [id, record] of Object.entries(progress.quests)) {
    const quest = quests.get(id);
    if (!quest || !record.completed || record.bestStars > 0 || !record.lastRun) continue;
    const stars = computeStars(quest, restoreRun(quest, record.lastRun));
    if (stars > 0) {
      next[id] = { ...record, bestStars: stars };
      changed = true;
    }
  }
  return changed ? { ...progress, quests: next } : progress;
}
