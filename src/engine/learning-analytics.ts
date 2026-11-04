// Learning-behaviour analytics for the profile. Pure: no DOM, no React.
// Everything the profile's field notes show (KPIs, the three charts, the
// journey and the insights) is computed by computeView() from ONE event log,
// so the figures cannot disagree. Definitions:
//
//  Attempt          One checked answer ("answer" event) in a quest run.
//  Initial attempt  The first answer to a step in a run. A replay is a new run,
//                   so its first answer is initial again. Practice rounds are
//                   not counted as attempts (they are concept revisits).
//  Retry            Any later answer to the same step in the same run.
//                   retries = attempts − initial attempts.
//  Hint shown       The game shows a hint after a wrong answer. Not an attempt.
//  Completed        A correct answer in the view.
//  Answer shown     The answer was revealed (asked for, or out of picks): the
//                   step is finished but not counted as completed.
//  Recovery         For each wrong answer in the view, the next thing that
//                   happened on that step in that run within 7 days:
//                     solved-next   next answer right, no hint in between
//                     hint-solved   a hint was shown, then the next answer was right
//                     another-try   next answer also wrong
//                     revealed      the answer was shown instead
//                     no-further    nothing further (yet)
//  Recovery rate    (solved-next + hint-solved) ÷ wrong answers in view.
//  Retry-to-success Steps with ≥ 1 retry in view that were completed
//                   ÷ steps with ≥ 1 retry in view.
//  Concept revisit  A practice round, or reading a lesson again, for a skill
//                   first met on an earlier calendar day. KPI = distinct skills.
//  Mastery score    Recorded when a quest run is finished: the boss mastery for
//                   quests with a boss, otherwise steps solved first time
//                   without the answer shown ÷ steps in the run (see runScore).
//  Mastery change   Per quest with ≥ 2 finished runs in view: latest − earliest
//                   score (points); KPI = mean across those quests.

import type { ChallengeScene, Quest, Run, World } from './types';
import type { LearningEvent, Progress } from './progress-store';
import { bossScore, isChallenge, isFirstTry, resultFor } from './game-engine';
import { destinationForQuest, questStatus, type QuestStatus } from './progression';

export const RECOVERY_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export type PeriodId = '7d' | '14d' | '28d' | 'all';
export const PERIODS: Record<PeriodId, { days: number | null; label: string }> = {
  '7d': { days: 7, label: 'Last 7 days' },
  '14d': { days: 14, label: 'Last 14 days' },
  '28d': { days: 28, label: 'Last 28 days' },
  all: { days: null, label: 'All time' },
};
export interface Filters { period: PeriodId; quest: string }
export const DEFAULT_FILTERS: Filters = { period: '28d', quest: 'all' };

export type RecoveryId = 'solved-next' | 'hint-solved' | 'another-try' | 'revealed' | 'no-further';
export const RECOVERY_CATEGORIES: { id: RecoveryId; label: string }[] = [
  { id: 'solved-next', label: 'Solved on the next try' },
  { id: 'hint-solved', label: 'Saw a hint, then solved it' },
  { id: 'another-try', label: 'Needed another try' },
  { id: 'revealed', label: 'Answer shown instead' },
  { id: 'no-further', label: 'No further attempt yet' },
];

export type StepStatus = 'completed' | 'revealed' | 'incomplete' | 'started';

/** Local calendar day, YYYY-MM-DD. */
export function dayKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12).getTime());
}

export interface StepInfo {
  key: string; quest: string; questTitle: string; questNumber: number;
  id: string; title: string; skills: string[]; order: number;
}

/** Every challenge step in the content, keyed "questId/stepId". */
export function stepIndex(quests: Map<string, Quest>): Record<string, StepInfo> {
  const map: Record<string, StepInfo> = {};
  for (const q of quests.values()) {
    q.scenes.forEach((s, i) => {
      if (!isChallenge(s)) return;
      map[`${q.id}/${s.id}`] = { key: `${q.id}/${s.id}`, quest: q.id, questTitle: q.title, questNumber: q.number,
        id: s.id, title: s.title, skills: (s as ChallengeScene).skills ?? [], order: q.number * 1000 + i };
    });
  }
  return map;
}

/** Skills taught or practised by any step (challenge or lesson). */
function sceneSkills(quests: Map<string, Quest>): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const q of quests.values()) for (const s of q.scenes) {
    const skills = (s as { skills?: string[] }).skills;
    if (skills?.length) map[`${q.id}/${s.id}`] = skills;
  }
  return map;
}

/** Readable skill names: the lesson's own concept title where a lesson teaches it. */
export function skillLabels(quests: Map<string, Quest>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const q of quests.values()) for (const s of q.scenes) {
    if (s.type === 'lesson' && s.skills?.length === 1 && s.lesson?.concept) labels[s.skills[0]] = s.lesson.concept;
  }
  for (const q of quests.values()) for (const s of q.scenes) {
    for (const id of (s as { skills?: string[] }).skills ?? []) {
      if (!labels[id]) labels[id] = id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
    }
  }
  return labels;
}

/**
 * Mastery score (0-100) for a finished run, recorded in the "finish" event.
 * Quests with a boss already score mastery; others use the share of steps
 * solved first time without the answer being shown.
 */
export function runScore(quest: Quest, run: Run): number {
  const boss = bossScore(quest, run);
  if (typeof boss === 'number') return Math.round(boss * 100);
  const steps = quest.scenes.filter(isChallenge);
  if (!steps.length) return 0;
  const first = steps.filter((s) => isFirstTry(s, resultFor(run, s.id))).length;
  return Math.round((100 * first) / steps.length);
}

interface Annotated extends LearningEvent { key: string; runKey: string; ordinal?: number; isRetry?: boolean; validRevisit?: boolean; skills: string[] }

function annotate(events: LearningEvent[], skillsOf: Record<string, string[]>): Annotated[] {
  const ordinals: Record<string, number> = {};
  const firstMet: Record<string, string> = {};
  return events.map((e) => {
    const key = e.s ? `${e.q}/${e.s}` : e.q;
    const a: Annotated = { ...e, key, runKey: `${key}#${e.r ?? 0}`, skills: e.s ? skillsOf[key] ?? [] : [] };
    if (e.k === 'answer') {
      ordinals[a.runKey] = (ordinals[a.runKey] ?? 0) + 1;
      a.ordinal = ordinals[a.runKey];
      a.isRetry = a.ordinal > 1;
    }
    const day = dayKey(e.t);
    if (e.k === 'practice' || e.k === 'lesson') {
      a.validRevisit = a.skills.length > 0 && a.skills.some((s) => firstMet[s] !== undefined && firstMet[s] < day);
    }
    for (const s of a.skills) if (!firstMet[s]) firstMet[s] = day;
    return a;
  });
}

export interface StepRow extends StepInfo {
  initial: number; retries: number; attempts: number; hints: number; wrong: number;
  completed: boolean; firstTry: boolean; revealed: boolean; status: StepStatus;
  events: Annotated[]; recovery: { t: number; outcome: RecoveryId }[];
}

export interface MasteryPoint { t: number; day: string; score: number }
export interface MasterySeries { quest: string; title: string; number: number; points: MasteryPoint[]; change: number | null }

export interface JourneyItem {
  t: number; time: string; key: string | null; kind: string; icon: string; text: string;
  stepTitle: string | null; questTitle: string;
}

export interface Insight { id: string; icon: string; title: string; evidence: string }

export interface View {
  filters: Filters; range: { from: string; to: string }; periodLabel: string;
  steps: StepRow[];
  kpis: {
    completed: number; active: number; attempts: number; initial: number; retries: number; hints: number;
    retryToSuccess: number | null; retryToSuccessNum: number; retryToSuccessDen: number;
    conceptsRevisited: number; masteryChange: number | null; masteryChangeQuests: number;
  };
  recovery: { counts: Record<RecoveryId, number>; denominator: number; recovered: number; rate: number | null; windowDays: number };
  mastery: { series: MasterySeries[]; change: number | null; checks: number };
  revisits: { t: number; skill: string; label: string; via: 'practice' | 'lesson'; quest: string }[];
  journey: { day: string; items: JourneyItem[] }[];
  insights: Insight[];
  eventCount: number;
}

export function periodRange(period: PeriodId, today: string, events: { t: number }[]): { from: string; to: string } {
  const p = PERIODS[period] ?? PERIODS[DEFAULT_FILTERS.period];
  if (p.days === null) {
    const first = events.length ? dayKey(events[0].t) : today;
    return { from: first < today ? first : today, to: today };
  }
  return { from: shiftDay(today, -(p.days - 1)), to: today };
}

function recoveryOf(all: Annotated[], i: number): RecoveryId {
  const e = all[i];
  const limit = e.t + RECOVERY_WINDOW_DAYS * DAY_MS;
  let hint = false;
  for (let j = i + 1; j < all.length; j++) {
    const n = all[j];
    if (n.runKey !== e.runKey) continue;
    if (n.t > limit) break;
    if (n.k === 'hint') hint = true;
    if (n.k === 'reveal') return 'revealed';
    if (n.k === 'answer') return n.ok ? (hint ? 'hint-solved' : 'solved-next') : 'another-try';
  }
  return 'no-further';
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDay(day: string): string { const [, m, d] = day.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; }
function clock(t: number): string { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }

export function computeView(events: LearningEvent[], quests: Map<string, Quest>, filters: Partial<Filters> = {}, now = Date.now()): View {
  const f: Filters = { ...DEFAULT_FILTERS, ...filters };
  const index = stepIndex(quests);
  const labels = skillLabels(quests);
  const all = annotate(events, sceneSkills(quests));
  const range = periodRange(f.period, dayKey(now), all);
  const inView = (e: Annotated) => {
    const d = dayKey(e.t);
    return d >= range.from && d <= range.to && (f.quest === 'all' || e.q === f.quest);
  };
  const view = all.filter(inView);

  // ---- Steps (Chart A, breakdown) — quest play only, not practice rounds ----
  const rows: Record<string, StepRow> = {};
  for (const e of view) {
    if (!['start', 'answer', 'hint', 'reveal'].includes(e.k) || !index[e.key]) continue;
    const r = rows[e.key] ??= { ...index[e.key], initial: 0, retries: 0, attempts: 0, hints: 0, wrong: 0,
      completed: false, firstTry: false, revealed: false, status: 'started', events: [], recovery: [] };
    r.events.push(e);
    if (e.k === 'hint') r.hints++;
    if (e.k === 'reveal') r.revealed = true;
    if (e.k === 'answer') {
      r.attempts++;
      if (e.isRetry) r.retries++; else r.initial++;
      if (e.ok) { r.completed = true; if (!e.isRetry) r.firstTry = true; } else r.wrong++;
    }
  }
  const steps = Object.values(rows).sort((a, b) => a.order - b.order);
  for (const r of steps) r.status = r.completed ? 'completed' : r.revealed ? 'revealed' : r.attempts ? 'incomplete' : 'started';

  // ---- Recovery (Chart C) ----
  const counts: Record<RecoveryId, number> = { 'solved-next': 0, 'hint-solved': 0, 'another-try': 0, revealed: 0, 'no-further': 0 };
  all.forEach((e, i) => {
    if (e.k !== 'answer' || e.ok || !inView(e) || !rows[e.key]) return;
    const outcome = recoveryOf(all, i);
    counts[outcome]++;
    rows[e.key].recovery.push({ t: e.t, outcome });
  });
  const wrongTotal = steps.reduce((s, r) => s + r.wrong, 0);
  const recovered = counts['solved-next'] + counts['hint-solved'];

  // ---- Mastery (Chart B) ----
  const finishes = view.filter((e) => e.k === 'finish');
  const byQuest: Record<string, MasteryPoint[]> = {};
  for (const e of finishes) (byQuest[e.q] ??= []).push({ t: e.t, day: dayKey(e.t), score: e.score ?? 0 });
  const series: MasterySeries[] = [...quests.values()].sort((a, b) => a.number - b.number).filter((q) => byQuest[q.id]).map((q) => {
    const pts = byQuest[q.id];
    return { quest: q.id, title: q.title, number: q.number, points: pts, change: pts.length >= 2 ? pts[pts.length - 1].score - pts[0].score : null };
  });
  const changes = series.filter((s) => s.change !== null);
  const masteryChange = changes.length ? round1(changes.reduce((s, c) => s + (c.change ?? 0), 0) / changes.length) : null;

  // ---- Revisits ----
  const revisitEvents = view.filter((e) => (e.k === 'practice' || e.k === 'lesson') && e.validRevisit);
  const revisits: View['revisits'] = [];
  const revisitedSkills = new Set<string>();
  for (const e of revisitEvents) for (const s of e.skills) {
    revisitedSkills.add(s);
    revisits.push({ t: e.t, skill: s, label: labels[s] ?? s, via: e.k as 'practice' | 'lesson', quest: e.q });
  }

  const withRetry = steps.filter((r) => r.retries > 0);
  const withRetryDone = withRetry.filter((r) => r.completed);
  const kpis: View['kpis'] = {
    completed: steps.filter((r) => r.completed).length,
    active: steps.length,
    attempts: steps.reduce((s, r) => s + r.attempts, 0),
    initial: steps.reduce((s, r) => s + r.initial, 0),
    retries: steps.reduce((s, r) => s + r.retries, 0),
    hints: steps.reduce((s, r) => s + r.hints, 0),
    retryToSuccess: withRetry.length ? Math.round((100 * withRetryDone.length) / withRetry.length) : null,
    retryToSuccessNum: withRetryDone.length,
    retryToSuccessDen: withRetry.length,
    conceptsRevisited: revisitedSkills.size,
    masteryChange,
    masteryChangeQuests: changes.length,
  };

  // ---- Journey (newest day first) ----
  const questTitle = (id: string) => quests.get(id)?.title ?? id;
  const journey: View['journey'] = [];
  for (const e of [...view].reverse()) {
    const day = dayKey(e.t);
    let group = journey[journey.length - 1];
    if (!group || group.day !== day) journey.push(group = { day, items: [] });
    group.items.push(journeyItem(e, index, labels, questTitle(e.q)));
  }

  const v: View = {
    filters: f, range, periodLabel: PERIODS[f.period].label, steps, kpis,
    recovery: { counts, denominator: wrongTotal, recovered, rate: wrongTotal ? Math.round((100 * recovered) / wrongTotal) : null, windowDays: RECOVERY_WINDOW_DAYS },
    mastery: { series, change: masteryChange, checks: finishes.length },
    revisits, journey, insights: [], eventCount: view.length,
  };
  v.insights = insights(v);
  return v;
}

function journeyItem(e: Annotated, index: Record<string, StepInfo>, labels: Record<string, string>, questTitle: string): JourneyItem {
  const step = index[e.key];
  const base = { t: e.t, time: clock(e.t), key: step ? e.key : null, stepTitle: step?.title ?? null, questTitle };
  const skillText = e.skills.map((s) => labels[s] ?? s).join(', ');
  switch (e.k) {
    case 'start': return { ...base, kind: 'start', icon: '▸', text: 'Started' };
    case 'hint': return { ...base, kind: 'hint', icon: '💡', text: 'Saw a hint' };
    case 'reveal': return { ...base, kind: 'reveal', icon: '👁', text: 'Answer shown (no credit)' };
    case 'answer':
      if (e.ok) return { ...base, kind: 'complete', icon: '✓', text: e.isRetry ? `Completed on a retry (attempt ${e.ordinal})` : 'Completed on the first attempt' };
      return { ...base, kind: e.isRetry ? 'retry' : 'attempt', icon: e.isRetry ? '↻' : '✎', text: e.isRetry ? `Retried (attempt ${e.ordinal}), not right yet` : 'First attempt, not right yet' };
    case 'finish': return { ...base, key: null, stepTitle: null, kind: 'mastery', icon: '◎', text: `Finished the quest · mastery score ${e.score}%` };
    case 'practice': return { ...base, key: null, kind: 'revisit', icon: '↺', text: `Practice round${e.ok ? ', right first time' : ''}${e.validRevisit && skillText ? ` · revisited ${skillText}` : ''}` };
    case 'lesson': return { ...base, key: null, kind: e.validRevisit ? 'revisit' : 'lesson', icon: e.validRevisit ? '↺' : '📖', text: e.validRevisit ? `Re-read the lesson · revisited ${skillText}` : 'Read the lesson' };
    default: return { ...base, kind: 'other', icon: '•', text: e.k };
  }
}

/** Supportive observations, each shown only when the view's data supports it. */
function insights(v: View): Insight[] {
  const out: Insight[] = [];
  const afterRetry = v.steps.filter((r) => r.completed && r.retries > 0);
  if (afterRetry.length) out.push({ id: 'after-retry', icon: '↻', title: afterRetry.length === 1 ? 'You solved a challenge after a retry' : `You solved ${afterRetry.length} challenges after a retry`, evidence: afterRetry.map((r) => r.title).join(', ') });
  const hintHelped = v.steps.filter((r) => r.recovery.some((x) => x.outcome === 'hint-solved'));
  if (hintHelped.length) out.push({ id: 'hints', icon: '💡', title: `Hints helped you keep going through ${hintHelped.length === 1 ? 'a tricky challenge' : `${hintHelped.length} tricky challenges`}`, evidence: `${hintHelped.map((r) => r.title).join(', ')}: a hint, then a correct answer` });
  if (v.revisits.length) {
    const names = [...new Set(v.revisits.map((r) => r.label))];
    out.push({ id: 'revisit', icon: '↺', title: names.length === 1 ? 'You revisited an earlier concept' : `You revisited ${names.length} earlier concepts`, evidence: names.join(', ') });
  }
  for (const s of v.mastery.series) {
    const n = s.points.length;
    if (n >= 2 && s.points[n - 1].score > s.points[n - 2].score) {
      out.push({ id: `mastery-${s.quest}`, icon: '◎', title: `Your latest mastery score in ${s.title} was higher than the one before`, evidence: `${s.points[n - 2].score}% → ${s.points[n - 1].score}% (${fmtDay(s.points[n - 2].day)} and ${fmtDay(s.points[n - 1].day)})` });
    }
  }
  const waiting = v.steps.filter((r) => r.status === 'incomplete' || r.status === 'started');
  if (waiting.length) out.push({ id: 'waiting', icon: '🧭', title: waiting.length === 1 ? 'One challenge is waiting for you' : `${waiting.length} challenges are waiting for you`, evidence: `${waiting.map((r) => r.title).join(', ')}: you can pick up where you left off` });
  return out;
}

// ---- All-time overview (from the save, so it includes play from before the history existed) ----

export interface QuestTrailStop { id: string; number: number; title: string; subject: string; icon: string; destination: string; status: QuestStatus; done: number; total: number }

export function overview(progress: Progress, quests: Map<string, Quest>, world: World) {
  const ordered = [...quests.values()].sort((a, b) => a.number - b.number);
  const stops: QuestTrailStop[] = ordered.map((q) => {
    const dest = destinationForQuest(world, q.id)!;
    const record = progress.quests[q.id];
    const steps = q.scenes.filter(isChallenge);
    const solved = new Set<string>();
    for (const run of [record?.lastRun, record?.run]) {
      if (!run) continue;
      for (const s of steps) { const r = run.results?.[s.id]; if (r?.solved && !r.revealed) solved.add(s.id); }
    }
    return { id: q.id, number: q.number, title: q.title, subject: q.subject, icon: dest.icon, destination: dest.name,
      status: questStatus(q, dest, progress), done: record?.completed ? Math.max(solved.size, 0) : solved.size, total: steps.length };
  });
  const finishes = progress.events.filter((e) => e.k === 'finish');
  const latest = finishes[finishes.length - 1];
  const previous = latest ? [...finishes.slice(0, -1)].reverse().find((e) => e.q === latest.q) : undefined;
  const all = computeView(progress.events, quests, { period: 'all', quest: 'all' });
  return {
    stops,
    questsCompleted: stops.filter((s) => s.status === 'completed').length,
    challengesSolved: stops.reduce((s, q) => s + q.done, 0),
    challengesTotal: stops.reduce((s, q) => s + q.total, 0),
    conceptsRevisited: all.kpis.conceptsRevisited,
    latestMastery: latest ? { quest: quests.get(latest.q)?.title ?? latest.q, score: latest.score ?? 0, day: dayKey(latest.t), previous: previous?.score ?? null } : null,
    historyStarted: progress.events.length ? dayKey(progress.events[0].t) : null,
  };
}

export { plural };
