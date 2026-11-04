// Per-concept mastery, kept on the device only. A concept is an encyclopedia
// id such as "XL.REF.ABSOLUTE". Records grow from real results: XP or clicks
// alone never raise a level.
//
//   seen         met the concept
//   practised    solved it, with help or after retries
//   demonstrated solved it first time in at least 2 different contexts
//   mastered     demonstrated, and solved first time again on a later day
//                (spaced recall), in at least 3 contexts overall

export type ConceptLevel = 'seen' | 'practised' | 'demonstrated' | 'mastered';

export interface ConceptRecord {
  attempts: number; // challenges finished that practise this concept
  solved: number; // solved without revealing the answer
  firstTry: number; // solved first time
  revealed: number;
  /** "quest/step" ids where it was solved first time (distinct contexts). */
  contexts: string[];
  /** Days (since epoch) on which it was solved first time; used for spaced recall. */
  days: number[];
  lastSeen: number; // day number
  /** Wrong attempts so far (capped), to spot concepts that keep tripping the player up. */
  slips: number;
}

export const MAX_CONCEPTS = 500;
const CONCEPT_ID = /^[A-Z]{2,4}(\.[A-Z0-9_]{1,24}){1,3}$/;

export function dayNumber(date = new Date()): number {
  return Math.floor(date.getTime() / 86_400_000);
}

export function emptyConcept(): ConceptRecord {
  return { attempts: 0, solved: 0, firstTry: 0, revealed: 0, contexts: [], days: [], lastSeen: 0, slips: 0 };
}

export function isConceptId(id: string): boolean {
  return CONCEPT_ID.test(id);
}

/** Record one finished challenge for each concept it practises. */
export function recordConcepts(
  concepts: Record<string, ConceptRecord>,
  ids: string[],
  outcome: { firstTry: boolean; revealed: boolean; wrongAttempts: number; context: string; day: number },
): Record<string, ConceptRecord> {
  const next = { ...concepts };
  for (const id of ids) {
    if (!isConceptId(id)) continue;
    if (!next[id] && Object.keys(next).length >= MAX_CONCEPTS) continue;
    const r = { ...(next[id] || emptyConcept()) };
    r.attempts += 1;
    if (outcome.revealed) r.revealed += 1;
    else r.solved += 1;
    if (outcome.firstTry && !outcome.revealed) {
      r.firstTry += 1;
      if (!r.contexts.includes(outcome.context)) r.contexts = [...r.contexts, outcome.context].slice(-20);
      if (!r.days.includes(outcome.day)) r.days = [...r.days, outcome.day].slice(-10);
    }
    r.slips = Math.min(99, r.slips + outcome.wrongAttempts);
    r.lastSeen = outcome.day;
    next[id] = r;
  }
  return next;
}

export function conceptLevel(r: ConceptRecord | undefined): ConceptLevel {
  if (!r || r.attempts === 0) return 'seen';
  const contexts = r.contexts.length;
  if (r.firstTry >= 3 && contexts >= 3 && r.days.length >= 2) return 'mastered';
  if (contexts >= 2) return 'demonstrated';
  if (r.solved > 0) return 'practised';
  return 'seen';
}

/**
 * How much a concept needs review: higher for weak or long-unseen concepts.
 * Used to weight recall rounds (the rune wheel) towards what is fading.
 */
export function reviewWeight(r: ConceptRecord | undefined, today: number): number {
  const level = conceptLevel(r);
  const base = { seen: 3, practised: 2.5, demonstrated: 1.5, mastered: 1 }[level];
  const gap = r && r.lastSeen ? Math.min(30, Math.max(0, today - r.lastSeen)) : 0;
  const slips = r ? Math.min(3, r.slips / 3) : 0;
  return base + gap / 10 + slips;
}

export function sanitizeConcepts(raw: unknown): Record<string, ConceptRecord> {
  const out: Record<string, ConceptRecord> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const int = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 0 ? Math.min(v as number, max) : 0);
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isConceptId(id) || !value || typeof value !== 'object') continue;
    if (Object.keys(out).length >= MAX_CONCEPTS) break;
    const v = value as Record<string, unknown>;
    out[id] = {
      attempts: int(v.attempts, 9999),
      solved: int(v.solved, 9999),
      firstTry: int(v.firstTry, 9999),
      revealed: int(v.revealed, 9999),
      contexts: Array.isArray(v.contexts) ? [...new Set(v.contexts.filter((c): c is string => typeof c === 'string' && /^[a-z0-9-]{1,64}\/[a-z0-9-]{1,64}$/.test(c)))].slice(-20) : [],
      days: Array.isArray(v.days) ? [...new Set(v.days.filter((d): d is number => Number.isInteger(d) && d > 0 && d < 1e6))].slice(-10) : [],
      lastSeen: int(v.lastSeen, 1e6),
      slips: int(v.slips, 99),
    };
  }
  return out;
}
