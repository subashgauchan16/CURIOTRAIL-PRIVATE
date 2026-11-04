// The learner profile: header and quest trail, overview, field notes
// (filters, KPIs, three charts, step breakdown), journey, insights, and
// privacy controls. Every figure comes from src/engine/learning-analytics.ts.

import { forwardRef, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useGame } from '../../app/game';
import { announce, focusElement } from '../../app/a11y';
import { levelFor } from '../../engine/game-engine';
import { totalXp, withEventsCleared, withRecordEvents, type EventKind } from '../../engine/progress-store';
import * as A from '../../engine/learning-analytics';
import { EMBLEM_INFO } from '../emblems';

const pad2 = (n: number) => String(n).padStart(2, '0');
const plural = A.plural;

// Fixed per quest: identity follows the quest, never its position in a filter.
// Only three hues stay distinguishable across every pair (validated for
// colour-vision deficiency), so each quest has a unique hue + shape pair, and
// quests 04-06 also draw dashed lines.
type ShapeId = 'circle' | 'square' | 'diamond' | 'triangle';
const QUEST_STYLE: Record<string, { color: string; shape: ShapeId; dashed?: boolean }> = {
  'missing-signal': { color: 'var(--c-teal)', shape: 'circle' },
  'the-ledger': { color: 'var(--c-violet)', shape: 'square' },
  'broken-tally': { color: 'var(--c-amber)', shape: 'diamond' },
  'market-ledger': { color: 'var(--c-teal)', shape: 'triangle', dashed: true },
  'great-hall-dashboard': { color: 'var(--c-violet)', shape: 'circle', dashed: true },
  'star-chart': { color: 'var(--c-amber)', shape: 'square', dashed: true },
};
const questStyle = (id: string): { color: string; shape: ShapeId; dashed?: boolean } => QUEST_STYLE[id] ?? { color: 'var(--c-neutral)', shape: 'circle' };

const RECOVERY_STYLE: Record<A.RecoveryId, { cls: string; icon: string }> = {
  'solved-next': { cls: 'pf-rc-solved', icon: '✓' },
  'hint-solved': { cls: 'pf-rc-hint', icon: '💡' },
  'another-try': { cls: 'pf-rc-again', icon: '↻' },
  revealed: { cls: 'pf-rc-shown', icon: '👁' },
  'no-further': { cls: 'pf-rc-none', icon: '…' },
};

function Half() { return <span className="pf-half" aria-hidden="true" />; }

function statusText(r: A.StepRow): string {
  if (r.status === 'completed') {
    if (r.firstTry && !r.retries) return 'Completed on the first attempt';
    if (r.firstTry) return 'Right first time in a later run';
    return `Completed after ${plural(r.retries, 'retry', 'retries')}`;
  }
  if (r.status === 'revealed') return 'Answer shown (no credit)';
  if (r.status === 'incomplete') return 'Not finished yet';
  return 'Started, no answer yet';
}
function StatusMark({ status }: { status: A.StepStatus }) {
  if (status === 'completed') return <span className="pf-mark pf-mark--done" aria-hidden="true">✓</span>;
  if (status === 'revealed') return <span className="pf-mark pf-mark--shown" aria-hidden="true">👁</span>;
  return <span className="pf-mark pf-mark--open"><Half /></span>;
}

// ---- Shared tooltip -----------------------------------------------------------

interface Tip { anchor: HTMLElement; content: ReactNode }
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return;
    const place = () => {
      const r = tip.anchor.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8)}px`;
      const top = r.top - h - 10;
      el.style.top = `${top < 8 ? r.bottom + 10 : top}px`;
    };
    place();
    const onScroll = () => (document.activeElement === tip.anchor ? place() : setTip(null));
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setTip(null); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); document.removeEventListener('keydown', onKey); };
  }, [tip]);
  const bind = (content: () => ReactNode) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => setTip({ anchor: e.currentTarget, content: content() }),
    onPointerLeave: (e: React.PointerEvent<HTMLElement>) => { if (document.activeElement !== e.currentTarget) setTip(null); },
    onFocus: (e: React.FocusEvent<HTMLElement>) => setTip({ anchor: e.currentTarget, content: content() }),
    onBlur: () => setTip(null),
  });
  const node = tip ? <div ref={ref} className="pf-tip" role="tooltip">{tip.content}</div> : null;
  return { bind, node, hide: () => setTip(null) };
}

/** One tab stop per chart; arrow keys, Home and End move between marks. */
function rovingKeys(e: KeyboardEvent<HTMLElement>, selector: string) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(selector)];
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  const next = items[Math.max(0, Math.min(items.length - 1, to))];
  items.forEach((it) => { it.tabIndex = -1; });
  next.tabIndex = 0;
  next.focus();
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="pf-empty"><span aria-hidden="true">🧭</span><p><strong>{title}</strong></p><p className="hint">{children}</p></div>;
}

// ---- 1. Header + trail ----------------------------------------------------------

const STATUS: Record<string, { icon: ReactNode; text: string }> = {
  completed: { icon: '✓', text: 'Completed' }, 'in-progress': { icon: <Half />, text: 'In progress' },
  available: { icon: '●', text: 'Available' }, locked: { icon: '🔒', text: 'Locked' },
};

export function ProfileHeader() {
  const { progress, quests, world } = useGame();
  const o = useMemo(() => A.overview(progress, quests, world), [progress, quests, world]);
  const xp = totalXp(progress);
  const level = levelFor(xp);
  const player = progress.player;
  const emblem = player ? EMBLEM_INFO[player.emblem] : null;
  const circ = 2 * Math.PI * 54;
  const ratio = o.challengesTotal ? o.challengesSolved / o.challengesTotal : 0;
  return (
    <section className="pf-hero card-solid" aria-labelledby="progress-title">
      <div className="pf-hero-top">
        <div className="pf-avatar" aria-hidden="true">
          <svg viewBox="0 0 120 120" focusable="false"><circle cx="60" cy="60" r="54" className="pf-ring-track" /><circle cx="60" cy="60" r="54" className="pf-ring-value" style={{ strokeDasharray: circ, strokeDashoffset: circ * (1 - ratio) }} /></svg>
          <span>{emblem?.symbol ?? '🧭'}</span>
        </div>
        <div className="pf-hero-text">
          <p className="eyebrow">Your Atlas · Pathfinder profile</p>
          <h1 id="progress-title">{player?.name ?? 'Pathfinder'}</h1>
          <p className="pf-level"><span className="pf-level-chip">Level {level.level}</span> {level.name}{emblem && <span className="hint"> · {emblem.label} emblem</span>}</p>
          <div className="pf-xp-row">
            <progress className="pf-xp" max={level.next ? level.next.min - level.min : 1} value={level.next ? xp - level.min : 1} aria-label={level.next ? `${level.next.min - xp} XP until ${level.next.name}` : 'Highest level reached'} />
            <span className="hint">{xp} XP{level.next ? ` · ${level.next.min - xp} to ${level.next.name}` : ' · highest level'}</span>
          </div>
        </div>
        <p className="pf-hero-quests"><strong>{o.questsCompleted}</strong> of {o.stops.length} quests completed<br /><span className="hint">{o.challengesSolved} of {o.challengesTotal} challenges solved (the ring)</span></p>
      </div>
      <h2 className="sr-only">Quest trail</h2>
      <ol className="pf-trail">
        {o.stops.map((q) => (
          <li key={q.id} className={`pf-stop pf-stop--${q.status}`}>
            <span className="pf-stop-marker" aria-hidden="true">{q.icon}</span>
            <span className="pf-stop-num">{pad2(q.number)}</span>
            <span className="pf-stop-title">{q.title}</span>
            <span className="pf-stop-meta">{q.subject} · {q.destination}</span>
            <span className={`status status--${q.status}`}><span aria-hidden="true">{STATUS[q.status].icon}</span> {STATUS[q.status].text}</span>
            {(q.status === 'in-progress' || q.status === 'completed') && <span className="hint">{q.done} of {q.total} challenges</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---- 2. Overview ------------------------------------------------------------------

export function Overview() {
  const { progress, quests, world } = useGame();
  const o = useMemo(() => A.overview(progress, quests, world), [progress, quests, world]);
  const m = o.latestMastery;
  return (
    <section className="pf-section" aria-labelledby="pf-overview-title">
      <h2 id="pf-overview-title" className="pf-title">Learning overview <span className="pf-sub">all time</span></h2>
      <dl className="pf-overview">
        <div><dt>Challenges solved</dt><dd>{o.challengesSolved} <span className="of">/ {o.challengesTotal}</span></dd><p className="hint">without the answer being shown</p></div>
        <div><dt>Concepts revisited</dt><dd>{o.conceptsRevisited}</dd><p className="hint">skills you came back to on a later day</p></div>
        <div><dt>Latest mastery score</dt><dd>{m ? `${m.score}%` : '—'}{m && m.previous !== null && <span className={`pf-delta${m.score < m.previous ? ' pf-delta--down' : ''}`}> {m.score >= m.previous ? '↑' : '↓'} from {m.previous}%</span>}</dd><p className="hint">{m ? `${m.quest} · ${A.fmtDay(m.day)}` : 'Finish a quest to see one'}</p></div>
      </dl>
    </section>
  );
}

// ---- 3. Field notes --------------------------------------------------------------

export function FieldNotes() {
  const { progress, quests } = useGame();
  const [filters, setFilters] = useState<A.Filters>(A.DEFAULT_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const v = useMemo(() => A.computeView(progress.events, quests, filters), [progress.events, quests, filters]);
  const tip = useTip();
  const detailRef = useRef<HTMLElement>(null);
  const ordered = useMemo(() => [...quests.values()].sort((a, b) => a.number - b.number), [quests]);
  const isDefault = filters.period === A.DEFAULT_FILTERS.period && filters.quest === A.DEFAULT_FILTERS.quest;
  const sel = selected ? v.steps.find((r) => r.key === selected) ?? null : null;
  const questName = (id: string) => (id === 'all' ? 'all quests' : `${pad2(quests.get(id)!.number)} ${quests.get(id)!.title}`);

  const change = (next: A.Filters, prefix = '') => {
    tip.hide();
    setFilters(next);
    const nv = A.computeView(progress.events, quests, next);
    if (selected && !nv.steps.some((r) => r.key === selected)) setSelected(null);
    setStatus(`${prefix}${nv.periodLabel}, ${questName(next.quest)}: ${plural(nv.steps.length, 'challenge')}, ${plural(nv.kpis.attempts, 'attempt')}.`);
  };
  const select = (key: string) => {
    const next = selected === key ? null : key;
    setSelected(next);
    if (next) window.setTimeout(() => { detailRef.current?.scrollIntoView({ block: 'nearest' }); focusElement(detailRef.current); }, 30);
  };

  const k = v.kpis;
  const mc = k.masteryChange;
  const kpis = [
    { label: 'Challenges completed', value: String(k.completed), sub: k.active ? `of ${plural(k.active, 'challenge')} you worked on` : 'none in this view' },
    { label: 'Total attempts', value: String(k.attempts), sub: `${k.initial} initial + ${plural(k.retries, 'retry', 'retries')}` },
    { label: 'Retries', value: String(k.retries), sub: 'answers after the first one in a run' },
    { label: 'Retry-to-success', value: k.retryToSuccess === null ? '—' : `${k.retryToSuccess}%`, sub: k.retryToSuccessDen ? `${k.retryToSuccessNum} of ${plural(k.retryToSuccessDen, 'challenge')} with a retry were completed` : 'no retries in this view' },
    { label: 'Concepts revisited', value: String(k.conceptsRevisited), sub: k.conceptsRevisited ? 'skills returned to on a later day' : 'none in this view' },
    { label: 'Mastery change', value: mc === null ? '—' : `${mc > 0 ? '+' : mc < 0 ? '−' : '±'}${Math.abs(mc)} pts`, sub: mc === null ? 'needs two finished runs of the same quest in this view' : `average across ${plural(k.masteryChangeQuests, 'quest')} you finished twice or more`, up: mc !== null && mc > 0 },
  ];

  return (
    <section className="pf-section pf-notes" aria-labelledby="pf-notes-title">
      <div>
        <h2 id="pf-notes-title" className="pf-title">Field notes: how you work through challenges</h2>
        <p className="hint">Counted from the learning history kept on this device{progress.events.length ? `, which began on ${A.fmtDay(A.dayKey(progress.events[0].t))}` : ''}. Change the filters and everything below updates together.</p>
      </div>
      {!progress.events.length && (
        <div className="pf-callout" role="note">
          <p><strong>Your field notes start with your next challenge.</strong> Quests you finished before this update still count on your trail and overview, but their individual attempts weren’t recorded.</p>
        </div>
      )}
      <form className="pf-filters" aria-label="Filter the field notes" onSubmit={(e) => e.preventDefault()}>
        <fieldset className="pf-seg">
          <legend>Period</legend>
          <div className="pf-seg-options">
            {(Object.keys(A.PERIODS) as A.PeriodId[]).map((id) => (
              <label key={id}><input type="radio" name="pf-period" value={id} checked={filters.period === id} onChange={() => change({ ...filters, period: id })} /><span>{A.PERIODS[id].label}</span></label>
            ))}
          </div>
        </fieldset>
        <div className="pf-field">
          <label htmlFor="pf-quest">Quest</label>
          <select id="pf-quest" className="pf-select" value={filters.quest} onChange={(e) => change({ ...filters, quest: e.target.value })}>
            <option value="all">All quests</option>
            {ordered.map((q) => <option key={q.id} value={q.id}>{pad2(q.number)} {q.title}</option>)}
          </select>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" aria-disabled={isDefault} onClick={() => (isDefault ? setStatus('Already showing the default view: Last 28 days, all quests.') : change(A.DEFAULT_FILTERS, 'Filters reset. '))}>Reset filters</button>
        <p className="pf-status" role="status" aria-live="polite">{status}</p>
      </form>

      <div className="pf-kpis">
        {kpis.map((c) => <div key={c.label} className={`pf-kpi${c.up ? ' pf-kpi--up' : ''}`}><p className="pf-kpi-label">{c.label}</p><p className="pf-kpi-value">{c.value}</p><p className="pf-kpi-sub">{c.sub}</p></div>)}
      </div>
      <Definitions />

      <AttemptsChart v={v} selected={selected} onSelect={select} tip={tip} />
      {sel && <StepDetail ref={detailRef} row={sel} onClose={() => { const key = sel.key; setSelected(null); window.setTimeout(() => (document.querySelector<HTMLElement>(`.pf-bar[data-key="${key}"]`))?.focus(), 30); }} />}
      <div className="pf-pair">
        <MasteryChart v={v} tip={tip} />
        <RecoveryChart v={v} tip={tip} />
      </div>
      <Journey v={v} onSelect={(key) => { if (v.steps.some((r) => r.key === key)) { setSelected(null); select(key); } }} questName={questName(filters.quest)} />
      <Insights v={v} questName={questName(filters.quest)} />
      {tip.node}
    </section>
  );
}

function Definitions() {
  return (
    <details className="pf-defs">
      <summary>How these numbers are counted</summary>
      <dl>
        <dt>Attempt</dt><dd>Each answer you check. The first answer to a challenge in a quest run is the <strong>initial attempt</strong>; later answers in the same run are <strong>retries</strong>. Replaying a quest starts a new run. Retries = attempts − initial attempts. Practice rounds aren’t counted as attempts.</dd>
        <dt>Hints</dt><dd>The game shows a hint after a wrong answer. Hints are listed but never counted as attempts.</dd>
        <dt>Challenges completed</dt><dd>Challenges with a correct answer in the selected period and quest. A challenge whose answer was shown isn’t counted as completed.</dd>
        <dt>Retry-to-success rate</dt><dd>Challenges with at least one retry that were then completed ÷ challenges with at least one retry.</dd>
        <dt>Concepts revisited</dt><dd>Different skills you came back to, in a practice round or by reading a lesson again, on a later day than you first met them.</dd>
        <dt>Mastery score</dt><dd>Recorded when you finish a quest: the boss audit’s mastery score for quests that have one, otherwise the share of challenges you solved first time without the answer being shown. Mastery change = latest − earliest score for each quest finished at least twice in the period, averaged across those quests.</dd>
        <dt>Recovery</dt><dd>For each wrong answer, what happened next on that challenge in the same run within {A.RECOVERY_WINDOW_DAYS} days. Recovery rate = wrong answers followed by a correct next answer ÷ all wrong answers.</dd>
      </dl>
    </details>
  );
}

type TipApi = ReturnType<typeof useTip>;

// Chart A ------------------------------------------------------------------------

function AttemptsChart({ v, selected, onSelect, tip }: { v: A.View; selected: string | null; onSelect: (key: string) => void; tip: TipApi }) {
  const rows = v.steps;
  const k = v.kpis;
  let max = Math.max(4, ...rows.map((r) => Math.max(r.attempts, r.hints)));
  const step = max > 8 ? 2 : 1;
  if (max % step) max += step - (max % step);
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  const groups: { quest: string; number: number; title: string; rows: A.StepRow[] }[] = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.quest === r.quest) g.rows.push(r); else groups.push({ quest: r.quest, number: r.questNumber, title: r.questTitle, rows: [r] });
  }
  const active = selected && rows.some((r) => r.key === selected) ? selected : rows[0]?.key;
  const label = (r: A.StepRow) => `${r.title}, ${pad2(r.questNumber)} ${r.questTitle}. Initial attempts: ${r.initial}. Retries: ${r.retries}. Total attempts: ${r.attempts}. Hints: ${r.hints}. ${statusText(r)}. Select to see the full breakdown.`;
  return (
    <article className="pf-card" aria-labelledby="pf-a-title">
      <header className="pf-card-head">
        <div>
          <h3 id="pf-a-title">Attempts &amp; Retries</h3>
          <p className="pf-summary">{rows.length ? `${plural(k.attempts, 'attempt')} on ${plural(rows.length, 'challenge')}: ${k.initial} initial, ${plural(k.retries, 'retry', 'retries')}, plus ${plural(k.hints, 'hint')} shown. ${k.completed} completed.` : 'No activity in this view.'}</p>
        </div>
        <ul className="pf-legend" aria-label="Legend">
          <li><span className="pf-key pf-key-initial" aria-hidden="true" />Initial attempt</li>
          <li><span className="pf-key pf-key-retry" aria-hidden="true" />Retry</li>
          <li><span className="pf-key pf-key-hint" aria-hidden="true" />Hints shown <span className="hint">(not attempts)</span></li>
          <li><span className="pf-mark pf-mark--done" aria-hidden="true">✓</span>Completed</li>
          <li><span className="pf-mark pf-mark--shown" aria-hidden="true">👁</span>Answer shown</li>
          <li><span className="pf-mark pf-mark--open"><Half /></span>Not finished yet</li>
        </ul>
      </header>
      {!rows.length ? <Empty title="No challenge activity in this view">Try a longer period or another quest, or select Reset filters.</Empty> : (
        <>
          <p className="hint pf-howto">Hover or use the arrow keys to see exact counts. Select a challenge to see its full breakdown.</p>
          <div className="pf-bc">
            <div className="pf-bc-y" aria-hidden="true"><span className="pf-bc-ytitle">Attempts</span>{ticks.map((t) => <span key={t} style={{ bottom: `${(100 * t) / max}%` }}>{t}</span>)}</div>
            <div className="pf-bc-scroll" role="region" aria-label="Attempts and retries by challenge" onKeyDown={(e) => rovingKeys(e, '.pf-bar')}>
              <div className="pf-bc-plot">
                <div className="pf-bc-grid" aria-hidden="true">{ticks.map((t) => <span key={t} style={{ bottom: `${(100 * t) / max}%` }} />)}</div>
                {groups.map((g) => (
                  <div key={g.quest} className="pf-bc-group" role="group" aria-label={`Quest ${pad2(g.number)}: ${g.title}`}>
                    <div className="pf-bc-cols">
                      {g.rows.map((r) => (
                        <div key={r.key} className="pf-bc-col">
                          <button type="button" className="pf-bar" data-key={r.key} tabIndex={r.key === active ? 0 : -1} aria-pressed={selected === r.key} aria-controls="pf-detail" aria-label={label(r)} onClick={() => onSelect(r.key)}
                            {...tip.bind(() => (
                              <>
                                <p className="pf-tip-title">{r.title}</p><p className="pf-tip-sub">{pad2(r.questNumber)} {r.questTitle}</p>
                                <dl className="pf-tip-grid"><dt><span className="pf-key pf-key-initial" />Initial attempt</dt><dd>{r.initial}</dd><dt><span className="pf-key pf-key-retry" />Retries</dt><dd>{r.retries}</dd><dt>Total attempts</dt><dd>{r.attempts}</dd><dt><span className="pf-key pf-key-hint" />Hints shown</dt><dd>{r.hints}</dd></dl>
                                <p className="pf-tip-status"><StatusMark status={r.status} /> {statusText(r)}</p>
                              </>
                            ))}>
                            <span className="pf-bars" aria-hidden="true">
                              <span className={`pf-stack${r.attempts ? '' : ' pf-stack--empty'}`} style={{ height: `${(100 * r.attempts) / max}%` }}>
                                <span className="pf-total">{r.attempts}</span>
                                {r.retries > 0 && <span className="pf-seg pf-seg-retry" style={{ flexGrow: r.retries }} />}
                                {r.initial > 0 && <span className="pf-seg pf-seg-initial" style={{ flexGrow: r.initial }} />}
                              </span>
                              <span className={`pf-hint${r.hints ? '' : ' pf-hint--none'}`} style={{ height: `${(100 * r.hints) / max}%` }} />
                            </span>
                          </button>
                          <span className="pf-bc-label" aria-hidden="true"><StatusMark status={r.status} />{r.title}</span>
                        </div>
                      ))}
                    </div>
                    <p className="pf-bc-group-name"><span className="q-num">{pad2(g.number)}</span> {g.title}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <details className="pf-table-view">
            <summary>Show as a table</summary>
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Attempts and retries table">
              <table className="pf-table">
                <thead><tr><th scope="col">Challenge</th><th scope="col">Initial</th><th scope="col">Retries</th><th scope="col">Total attempts</th><th scope="col">Hints</th><th scope="col">Status</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.title}<span className="q-sub">{pad2(r.questNumber)} {r.questTitle}</span></th><td>{r.initial}</td><td>{r.retries}</td><td>{r.attempts}</td><td>{r.hints}</td><td>{statusText(r)}</td></tr>)}</tbody>
                <tfoot><tr><th scope="row">Total</th><td>{k.initial}</td><td>{k.retries}</td><td>{k.attempts}</td><td>{k.hints}</td><td>{k.completed} completed</td></tr></tfoot>
              </table>
            </div>
          </details>
        </>
      )}
    </article>
  );
}

const STEP_TEXT: Partial<Record<EventKind, (e: A.StepRow['events'][number]) => { cls: string; icon: string; text: string }>> = {
  start: () => ({ cls: 'start', icon: '▸', text: 'Started' }),
  hint: () => ({ cls: 'hint', icon: '💡', text: 'Saw a hint' }),
  reveal: () => ({ cls: 'shown', icon: '👁', text: 'Answer shown' }),
  answer: (e) => e.ok ? { cls: 'ok', icon: '✓', text: `${e.isRetry ? 'Retry' : 'Attempt'} ${e.ordinal}: correct` } : { cls: 'no', icon: e.isRetry ? '↻' : '✎', text: `${e.isRetry ? 'Retry' : 'Attempt'} ${e.ordinal}: not yet` },
};

const StepDetail = forwardRef<HTMLElement, { row: A.StepRow; onClose: () => void }>(function StepDetail({ row: r, onClose }, ref) {
  const { quests } = useGame();
  const labels = useMemo(() => A.skillLabels(quests), [quests]);
  const cat = Object.fromEntries(A.RECOVERY_CATEGORIES.map((c) => [c.id, c.label]));
  const when = (t: number) => { const d = new Date(t); return `${A.fmtDay(A.dayKey(t))}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  return (
    <section className="pf-detail" id="pf-detail" ref={ref} tabIndex={-1} aria-labelledby="pf-detail-title">
      <div className="pf-detail-head">
        <div>
          <p className="eyebrow">Challenge breakdown · {pad2(r.questNumber)} {r.questTitle}</p>
          <h3 id="pf-detail-title">{r.title}</h3>
          <p className="hint">Skill{r.skills.length === 1 ? '' : 's'}: {r.skills.length ? r.skills.map((s) => labels[s] ?? s).join(', ') : '—'}</p>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>Close<span className="sr-only"> breakdown</span></button>
      </div>
      <dl className="pf-detail-stats">
        <div><dt>Initial attempts</dt><dd>{r.initial}</dd></div><div><dt>Retries</dt><dd>{r.retries}</dd></div>
        <div><dt>Total attempts</dt><dd>{r.attempts}</dd></div><div><dt>Hints shown</dt><dd>{r.hints}</dd></div>
        <div><dt>Status</dt><dd className="pf-detail-status"><StatusMark status={r.status} /> {statusText(r)}</dd></div>
      </dl>
      <div className="pf-detail-cols">
        <div><h4>What happened, in order</h4>
          <ol className="pf-steps">{r.events.map((e, i) => { const s = STEP_TEXT[e.k]?.(e); return s ? <li key={i} className={`pf-step pf-step--${s.cls}`}><span aria-hidden="true">{s.icon}</span><span>{s.text}</span><span className="pf-time">{when(e.t)}</span></li> : null; })}</ol>
        </div>
        <div><h4>After each wrong answer</h4>
          {r.recovery.length ? <ul className="plain-list">{r.recovery.map((x, i) => <li key={i}>Wrong answer {i + 1}: {cat[x.outcome].toLowerCase()}</li>)}</ul> : <p className="hint">No wrong answers on this challenge in this view.</p>}
          <p className="hint">Each replay of a quest is a new run, so it starts with a new initial attempt.</p>
        </div>
      </div>
    </section>
  );
});

// Chart B ------------------------------------------------------------------------

function Shape({ quest }: { quest: string }) {
  const st = questStyle(quest);
  return <span className={`pf-shape pf-shape--${st.shape}`} style={{ '--c': st.color } as React.CSSProperties} aria-hidden="true" />;
}

function MasteryChart({ v, tip }: { v: A.View; tip: TipApi }) {
  const series = v.mastery.series;
  const from = new Date(`${v.range.from}T00:00`).getTime();
  let to = new Date(`${v.range.to}T00:00`).getTime();
  if (to <= from) to = from + 86_400_000;
  const dayT = (day: string) => new Date(`${day}T00:00`).getTime();
  const x = (day: string) => 3 + (94 * (dayT(day) - from)) / (to - from);
  const span = Math.round((to - from) / 86_400_000);
  const n = Math.min(5, Math.max(2, Math.floor(span / 3) + 1));
  const xTicks = Array.from({ length: n }, (_, i) => {
    const d = new Date(from); d.setDate(d.getDate() + Math.round((span * i) / (n - 1)));
    return A.dayKey(d.getTime());
  });
  const points = series.flatMap((s) => s.points.map((p, i) => ({ s, p, prev: i ? s.points[i - 1] : null }))).sort((a, b) => a.p.t - b.p.t);
  return (
    <article className="pf-card" aria-labelledby="pf-b-title">
      <header className="pf-card-head">
        <div>
          <h3 id="pf-b-title">Learning Over Time</h3>
          <p className="pf-summary">{series.length ? `${plural(v.mastery.checks, 'finished run')}: ${series.map((s) => `${s.title} ${s.points.length > 1 ? `${s.points[0].score}% → ${s.points[s.points.length - 1].score}%` : `${s.points[0].score}% (one run)`}`).join('; ')}.` : 'No finished quests in this view.'}</p>
        </div>
        {series.length > 0 && <ul className="pf-legend" aria-label="Legend">{series.map((s) => <li key={s.quest}><Shape quest={s.quest} />{pad2(s.number)} {s.title} <span className="hint">({s.change === null ? plural(s.points.length, 'run') : `${s.change > 0 ? '+' : s.change < 0 ? '−' : '±'}${Math.abs(s.change)} pts`})</span></li>)}</ul>}
      </header>
      {!series.length ? <Empty title="No mastery scores in this view">A mastery score is recorded each time you finish a quest. Replay one to see whether it changes.</Empty> : (
        <div className="pf-lc">
          <span className="pf-lc-ytitle" aria-hidden="true">Mastery score</span>
          <div className="pf-lc-plot" role="group" aria-label="Mastery scores over time" onKeyDown={(e) => rovingKeys(e, '.pf-point')}>
            <div aria-hidden="true">{[0, 25, 50, 75, 100].map((t) => <span key={t}><span className="pf-lc-grid" style={{ top: `${100 - t}%` }} /><span className="pf-lc-tick" style={{ top: `${100 - t}%` }}>{t}%</span></span>)}</div>
            <svg className="pf-lc-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {series.filter((s) => s.points.length > 1).map((s) => <polyline key={s.quest} vectorEffect="non-scaling-stroke" className={`pf-lc-line${questStyle(s.quest).dashed ? ' pf-lc-line--dashed' : ''}`} style={{ stroke: questStyle(s.quest).color }} points={s.points.map((p) => `${x(p.day)},${100 - p.score}`).join(' ')} />)}
            </svg>
            {points.map((m, i) => (
              <button key={`${m.s.quest}-${m.p.t}`} type="button" className="pf-point" tabIndex={i === 0 ? 0 : -1} style={{ left: `${x(m.p.day)}%`, top: `${100 - m.p.score}%` }}
                aria-label={`Mastery score ${m.p.score}%, ${pad2(m.s.number)} ${m.s.title}, ${A.fmtDay(m.p.day)}.${m.prev ? ` Previous run: ${m.prev.score}%.` : ' First finished run in this view.'}`}
                {...tip.bind(() => <><p className="pf-tip-title">{m.p.score}% mastery</p><p className="pf-tip-sub">{pad2(m.s.number)} {m.s.title} · {A.fmtDay(m.p.day)}</p>{m.prev && <p>Previous run: {m.prev.score}%</p>}</>)}>
                <Shape quest={m.s.quest} />
              </button>
            ))}
          </div>
          <div className="pf-lc-x" aria-hidden="true">{xTicks.map((d, i) => <span key={d} className={i === 0 ? 'pf-start' : i === xTicks.length - 1 ? 'pf-end' : ''} style={{ left: `${x(d)}%` }}>{A.fmtDay(d)}</span>)}</div>
        </div>
      )}
      <p className="hint">Mastery score is recorded when you finish a quest. Lines join runs of the same quest only.</p>
      {series.length > 0 && (
        <details className="pf-table-view"><summary>Show as a table</summary>
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Mastery scores table"><table className="pf-table"><thead><tr><th scope="col">Date</th><th scope="col">Quest</th><th scope="col">Mastery score</th></tr></thead>
            <tbody>{points.map((m) => <tr key={`${m.s.quest}-${m.p.t}`}><th scope="row">{A.fmtDay(m.p.day)}</th><td>{pad2(m.s.number)} {m.s.title}</td><td>{m.p.score}%</td></tr>)}</tbody></table></div>
        </details>
      )}
    </article>
  );
}

// Chart C ------------------------------------------------------------------------

function RecoveryChart({ v, tip }: { v: A.View; tip: TipApi }) {
  const r = v.recovery;
  const [open, setOpen] = useState<string | null>(null);
  const pct = (n: number) => (r.denominator ? Math.round((100 * n) / r.denominator) : 0);
  const who: Record<string, string[]> = {};
  for (const row of v.steps) for (const x of row.recovery) { const list = (who[x.outcome] ??= []); if (!list.includes(row.title)) list.push(row.title); }
  return (
    <article className="pf-card" aria-labelledby="pf-c-title">
      <header className="pf-card-head"><div>
        <h3 id="pf-c-title">After a wrong answer</h3>
        <p className="pf-summary">{r.denominator ? `What happened after each of the ${plural(r.denominator, 'wrong answer')} in this view.` : 'What happens after a wrong answer.'}</p>
      </div></header>
      {!r.denominator ? <Empty title="No wrong answers in this view">{v.steps.length ? 'Every answer here was right first time, so there’s nothing to break down.' : 'There’s no challenge activity in this view yet.'}</Empty> : (
        <>
          <div className="pf-rc-head"><p className="pf-rc-rate">{r.rate}<span>%</span></p><p>recovery rate: <strong>{r.recovered} of {r.denominator}</strong> wrong answers were followed by a correct next answer within {r.windowDays} days.</p></div>
          <div className="pf-rc-bar" aria-hidden="true">
            {A.RECOVERY_CATEGORIES.filter((c) => r.counts[c.id]).map((c) => (
              <span key={c.id} className={`pf-rc-segment ${RECOVERY_STYLE[c.id].cls}`} style={{ flexGrow: r.counts[c.id] }}
                {...tip.bind(() => <><p className="pf-tip-title">{c.label}</p><p>{r.counts[c.id]} of {r.denominator} wrong answers ({pct(r.counts[c.id])}%)</p></>)}>
                <span>{r.counts[c.id]}</span>
              </span>
            ))}
          </div>
          <p className="hint">Each row is a share of the {r.denominator} wrong answers in this view. Select a row to see which challenges.</p>
          <ul className="pf-rc-list">
            {A.RECOVERY_CATEGORIES.map((c) => (
              <li key={c.id}>
                <button type="button" className="pf-rc-row" aria-expanded={open === c.id} aria-controls={`pf-rc-${c.id}`} disabled={!r.counts[c.id]} onClick={() => setOpen(open === c.id ? null : c.id)}>
                  <span className={`pf-key ${RECOVERY_STYLE[c.id].cls}`} aria-hidden="true" /><span aria-hidden="true">{RECOVERY_STYLE[c.id].icon}</span>
                  <span className="pf-rc-name">{c.label}</span><span className="pf-rc-count"><strong>{r.counts[c.id]}</strong> <span className="hint">{pct(r.counts[c.id])}%</span></span>
                </button>
                <p id={`pf-rc-${c.id}`} className="hint pf-rc-who" hidden={open !== c.id}>{(who[c.id] ?? []).join(', ')}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hint">Getting something wrong is part of working it out. A retry isn’t automatically learning, and seeing a hint isn’t a weakness: this shows what happened next, not how able you are.</p>
    </article>
  );
}

// ---- 4. Journey & 5. Insights ------------------------------------------------------

const JOURNEY_STEP = 12;

function Journey({ v, onSelect, questName }: { v: A.View; onSelect: (key: string) => void; questName: string }) {
  const [limit, setLimit] = useState(JOURNEY_STEP);
  const listRef = useRef<HTMLOListElement>(null);
  const total = v.journey.reduce((n, d) => n + d.items.length, 0);
  // Show the newest entries first, up to the limit, keeping them grouped by day.
  let budget = limit;
  const shown = v.journey.map((d) => { const items = d.items.slice(0, Math.max(0, budget)); budget -= items.length; return { ...d, items }; }).filter((d) => d.items.length);
  const left = total - Math.min(total, limit);
  const more = () => {
    const before = listRef.current?.querySelectorAll('.pf-ji').length ?? 0;
    setLimit(limit + JOURNEY_STEP);
    window.setTimeout(() => focusElement(listRef.current?.querySelectorAll<HTMLElement>('.pf-ji')[before] ?? null), 30);
  };
  return (
    <section className="pf-section" aria-labelledby="pf-journey-title">
      <h2 id="pf-journey-title" className="pf-title">Your trail so far <span className="pf-sub">{v.periodLabel} · {questName}</span></h2>
      {!shown.length ? <Empty title="Nothing on the trail in this view">Steps you play will appear here.</Empty> : (
        <ol className="pf-journey" ref={listRef}>
          {shown.map((d) => (
            <li key={d.day} className="pf-day"><h3 className="pf-day-date">{A.fmtDay(d.day)}</h3>
              <ol>{d.items.map((it, i) => (
                <li key={i} className={`pf-ji pf-ji--${it.kind}`} tabIndex={-1}><span className="pf-ji-icon" aria-hidden="true">{it.icon}</span>
                  <span className="pf-ji-body">{it.key && it.stepTitle ? <button type="button" className="pf-link" onClick={() => onSelect(it.key!)}>{it.stepTitle}</button> : <span className="pf-ji-quest">{it.stepTitle ? `${it.questTitle} · ${it.stepTitle}` : it.questTitle}</span>}<span>{it.text}</span></span>
                  <span className="pf-time">{it.time}</span></li>
              ))}</ol>
            </li>
          ))}
        </ol>
      )}
      {left > 0 && <button type="button" className="btn btn-sm btn-ghost" onClick={more}>Show {Math.min(JOURNEY_STEP, left)} earlier {Math.min(JOURNEY_STEP, left) === 1 ? 'entry' : 'entries'} <span className="hint">({left} more)</span></button>}
    </section>
  );
}

function Insights({ v, questName }: { v: A.View; questName: string }) {
  return (
    <section className="pf-section" aria-labelledby="pf-insights-title">
      <h2 id="pf-insights-title" className="pf-title">What your notes show <span className="pf-sub">{v.periodLabel} · {questName}</span></h2>
      {v.insights.length ? (
        <ul className="pf-insights">{v.insights.map((i) => <li key={i.id}><span className="pf-insight-icon" aria-hidden="true">{i.icon}</span><div><p className="pf-insight-title">{i.title}</p><p className="hint"><strong>Based on:</strong> {i.evidence}</p></div></li>)}</ul>
      ) : <Empty title="No observations for this view yet">Observations only appear when the activity in this view supports them.</Empty>}
    </section>
  );
}

// ---- 6. Privacy & your data ---------------------------------------------------------

const EVENT_LABEL: Record<EventKind, string> = {
  start: 'Challenge started', answer: 'Answer checked', hint: 'Hint shown', reveal: 'Answer shown',
  finish: 'Quest finished (mastery score)', practice: 'Practice round', lesson: 'Lesson read',
};

export function PrivacyPanel() {
  const { progress, update, storageAvailable, quests } = useGame();
  const [confirming, setConfirming] = useState(false);
  const recent = progress.events.slice(-50).reverse();
  return (
    <section className="pf-privacy card-solid" aria-labelledby="pf-privacy-title">
      <p className="eyebrow">Privacy and your data</p>
      <h2 id="pf-privacy-title">How CurioTrail remembers things</h2>
      <p>There are two separate things: <strong>storage</strong> that lets the game remember you, and a <strong>learning history</strong> that powers the field notes above. Both stay in this browser. Nothing is sent to a server, and CurioTrail uses no cookies, analytics or advertising.</p>
      <div className="pf-layers">
        <div className="pf-layer">
          <p className="pf-layer-num">Storage</p>
          <h3>Your save in this browser</h3>
          <p>Your Pathfinder name and emblem, quest progress, XP, settings and the learning history are kept together in this browser’s local storage. The game needs it to remember you.</p>
          <ul className="pf-state"><li><span>Saved in this browser</span><span className="pf-state-on">{storageAvailable ? '● Working' : '○ Blocked'}</span></li><li><span>Cookies, analytics, advertising</span><span className="pf-state-off">None used</span></li></ul>
        </div>
        <div className="pf-layer">
          <p className="pf-layer-num">Learning history</p>
          <h3>What the field notes are built from</h3>
          <p>While it’s on, the game notes these events, each with the time, quest and step:</p>
          <ul className="pf-event-kinds">{(Object.keys(EVENT_LABEL) as EventKind[]).map((k) => <li key={k}>{EVENT_LABEL[k]}</li>)}</ul>
          <p className="hint">It doesn’t record what you type, your location, or anything about your device.</p>
          <label className="pf-switch-row">
            <span><strong>Keep a learning history</strong><span className="hint"> {progress.events.length ? `(${plural(progress.events.length, 'event')} so far)` : '(nothing recorded yet)'}</span></span>
            <input type="checkbox" className="pf-switch" checked={progress.recordEvents} onChange={(e) => { const on = e.target.checked; update((p) => withRecordEvents(p, on)); announce(on ? 'Learning history is on.' : 'Learning history paused. Nothing new will be recorded.'); }} />
          </label>
          <p className="hint">Pausing stops new events being recorded. It doesn’t delete what’s already there.</p>
        </div>
      </div>
      <details className="pf-history">
        <summary>See your learning history{progress.events.length > 50 ? ' (latest 50)' : ''}</summary>
        {recent.length ? (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="Learning history"><table className="pf-table">
            <thead><tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Quest</th><th scope="col">Step</th><th scope="col">Detail</th></tr></thead>
            <tbody>{recent.map((e, i) => { const step = e.s ? quests.get(e.q)?.scenes.find((s) => s.id === e.s)?.title ?? e.s : ''; const d = new Date(e.t); return <tr key={i}><td>{A.fmtDay(A.dayKey(e.t))} {pad2(d.getHours())}:{pad2(d.getMinutes())}</td><td>{EVENT_LABEL[e.k]}</td><td>{quests.get(e.q)?.title ?? e.q}</td><td>{step}</td><td>{e.k === 'answer' ? (e.ok ? 'correct' : 'not yet') : e.k === 'finish' ? `${e.score}%` : e.k === 'practice' ? (e.ok ? 'right first time' : '') : ''}</td></tr>; })}</tbody>
          </table></div>
        ) : <p className="hint">Nothing recorded yet.</p>}
      </details>
      <div className="pf-delete">
        {!confirming ? <button type="button" className="btn btn-danger-ghost" disabled={!progress.events.length} onClick={() => setConfirming(true)}>Delete learning history</button> : (
          <div className="confirm" role="group" aria-labelledby="pf-del-text">
            <p id="pf-del-text"><strong>Delete your learning history?</strong> The field notes will start again from your next challenge. Your quests, XP, stars and settings stay as they are.</p>
            <div className="cta-row">
              <button type="button" className="btn btn-danger" onClick={() => { update(withEventsCleared); setConfirming(false); announce('Learning history deleted.'); }}>Yes, delete the history</button>
              <button type="button" className="btn btn-ghost" autoFocus onClick={() => setConfirming(false)}>Keep it</button>
            </div>
          </div>
        )}
      </div>
      <p className="hint">To erase everything, use “Reset all progress” at the bottom of this page. If CurioTrail ever adds optional cookies, such as analytics, you’ll be asked first and your choices will appear here.</p>
    </section>
  );
}
