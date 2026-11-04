// In-quest HUD: the round track (runes instead of a progress bar), XP and the optional silver purse,
// and the Codex — short cards from the Excel Encyclopedia, opened on demand.

import { useEffect, useRef } from 'react';
import type { Codex, Quest, Run } from '../../engine/types';
import * as engine from '../../engine/game-engine';

export function RoundTrack({ quest, run }: { quest: Quest; run: Run }) {
  const challenges = quest.scenes.filter(engine.isChallenge);
  const current = engine.currentScene(quest, run);
  const done = challenges.filter((s) => engine.resultFor(run, s.id).solved).length;
  return (
    <div className="round-track">
      {/* Same words as the visible round badge (engine.roundLabel), plus overall progress. */}
      <p className="sr-only">{engine.roundLabel(quest, current.id)?.text ?? 'Story'}. {done} of {challenges.length} challenges solved.</p>
      <ol className="runes" aria-hidden="true">
        {challenges.map((s) => {
          const r = engine.resultFor(run, s.id);
          const state = r.solved ? (r.revealed ? 'revealed' : engine.isFirstTry(s, r) ? 'gold' : 'silver') : s.id === current.id ? 'current' : 'open';
          return <li key={s.id} className={`rune rune--${state}${s.boss ? ' rune--boss' : ''}`} title={s.title}>{s.boss ? '⚔' : 'ᚱ'}</li>;
        })}
      </ol>
    </div>
  );
}

export function PotMeter({ quest, run }: { quest: Quest; run: Run }) {
  const xp = engine.computeXp(quest, run);
  const max = engine.maxXp(quest);
  const silver = engine.computeSilver(quest, run);
  const net = engine.wagerNet(quest, run);
  const staking = quest.scenes.some((s) => engine.isChallenge(s) && s.wager);
  const pct = Math.min(100, Math.round((xp / Math.max(1, max)) * 100));
  return (
    <div className="pot" role="status" aria-live="polite" aria-label={`${xp} of ${max} XP earned${staking ? `. Trader's purse: ${silver} silver` : ''}`}>
      <span className="pot-coin" aria-hidden="true">✨</span>
      <span className="pot-value">{xp}</span>
      <span className="pot-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></span>
      {staking && (
        <span className="purse-chip" aria-hidden="true" title="Trader's purse: the optional wager game. It never changes XP, medals or unlocks.">
          🪙 {silver}{net !== 0 && <span className={`pot-net ${net > 0 ? 'is-up' : 'is-down'}`}>{net > 0 ? `+${net}` : net}</span>}
        </span>
      )}
    </div>
  );
}

export function CodexDialog({ codex, ids, focusIds, open, onClose }: { codex: Codex; ids: string[]; focusIds: string[]; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
    }
    if (!open && d.open) d.close();
  }, [open]);
  const ordered = [...new Set([...focusIds, ...ids])].filter((id) => codex.entries[id]);
  return (
    <dialog ref={ref} className="codex" aria-labelledby="codex-title" onClose={onClose} onCancel={onClose}>
      <div className="codex-inner parchment">
        <header className="codex-head">
          <h2 id="codex-title">📖 The Codex</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </header>
        <p className="hint">Short cards from the Excel Encyclopedia. Opening the Codex never costs XP — but trying first helps you remember.</p>
        <div className="codex-list">
          {ordered.map((id) => {
            const e = codex.entries[id];
            return (
              <article key={id} className={`codex-card${focusIds.includes(id) ? ' is-now' : ''}`}>
                <h3>{e.title}{focusIds.includes(id) && <span className="codex-now"> · this round</span>}</h3>
                <p>{e.summary}</p>
                {e.example && <p className="codex-example"><span className="label">Example </span><code>{e.example}</code></p>}
                {e.pitfall && <p className="codex-pitfall"><span className="label">Watch out </span>{e.pitfall}</p>}
                <p className="codex-ref">Excel Encyclopedia {e.ref.volume} · {e.ref.chapter}{e.ref.page ? ` · p. ${e.ref.page}` : ''} <span className="codex-id">{id}</span></p>
              </article>
            );
          })}
        </div>
      </div>
    </dialog>
  );
}

export function questConcepts(quest: Quest): string[] {
  const ids: string[] = [];
  for (const s of quest.scenes) {
    if (!engine.isChallenge(s)) continue;
    ids.push(...(s.concepts ?? []));
    if (s.type === 'wheel') s.segments.forEach((g) => ids.push(...g.concepts));
  }
  return [...new Set(ids)];
}
