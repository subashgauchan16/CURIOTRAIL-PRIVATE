// Building blocks shared by the game mechanics: a live ledger, a formula
// builder (drag, tap or keyboard), the silver wager panel and market reactions.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Cell } from '../../engine/types';
import { colName, evaluateFormula, fillFormula, makeSheet, splitRef } from '../../engine/excel-lite';

export function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Values a formula would produce in its target column (a live preview, never an attempt). */
export function previewColumn(formula: string, columns: string[], rows: Cell[][], target: string, fillDownTo?: string): Record<string, string> {
  const out: Record<string, string> = {};
  const f = formula.trim();
  if (!f.startsWith('=') || f === '=') return out;
  const sheet = makeSheet(columns, rows);
  const start = splitRef(target);
  const end = fillDownTo ? splitRef(fillDownTo).row : start.row;
  for (let row = start.row; row <= end; row += 1) {
    const cell = `${start.col}${row}`;
    const r = evaluateFormula(row === start.row ? f : fillFormula(f, row - start.row), sheet, cell);
    out[cell] = r.ok ? fmt(r.value!) : r.error?.startsWith('#') ? r.error : '…';
    if (r.ok) sheet[cell] = r.value!;
  }
  return out;
}

/** Selecting cells in a ledger (evidence steps): which cell is chosen, and how. */
export interface CellPicker {
  selected: string | null;
  onPick: (cell: string) => void;
  /** Only the first `columns` columns are evidence; any working columns after them are not selectable. */
  columns: number;
  /** "row" highlights the whole row of the selected cell. */
  mode: 'cell' | 'row';
  disabled?: boolean;
}

/** A spreadsheet grid with column letters and row numbers, like Excel. */
export function LedgerGrid({ columns, rows, target, fillDownTo, values = {}, label = 'Ledger', highlight = [], good = [], solved = false, pick }: {
  columns: string[]; rows: Cell[][]; target?: string; fillDownTo?: string; values?: Record<string, string>;
  label?: string; highlight?: string[]; good?: string[]; solved?: boolean; pick?: CellPicker;
}) {
  const t = target ? splitRef(target) : null;
  const end = t && fillDownTo ? splitRef(fillDownTo).row : t?.row ?? 0;
  const selectedRow = pick?.selected ? Number(pick.selected.slice(1)) : null;
  // Verdicts are never colour alone: a ✓ or ✗ mark, and words for screen readers.
  const verdict = (ref: string) => (highlight.includes(ref) ? 'wrong' : good.includes(ref) ? 'right' : null);
  const cell = (ref: string, c: number, content: ReactNode, text: string) => {
    const v = verdict(ref);
    const marked = v ? <>{content}<span className="cell-mark" aria-hidden="true">{v === 'right' ? '✓' : '✗'}</span></> : content;
    if (!pick || c >= pick.columns) return v ? <>{marked}<span className="sr-only"> ({v})</span></> : content;
    return (
      <button
        type="button" className="cell-btn" disabled={pick.disabled} aria-pressed={pick.selected === ref}
        aria-label={`${ref}: ${text || 'empty'}${v === 'wrong' ? ', already tried' : v === 'right' ? ', the evidence' : ''}`} onClick={() => pick.onPick(ref)}
      >{marked}</button>
    );
  };
  return (
    <div className={`table-scroll ledger-scroll${pick ? ' ledger-scroll--pick' : ''}`} tabIndex={pick ? -1 : 0} role="region" aria-label={label}>
      <table className={`sheet ledger${solved ? ' ledger--solved' : ''}${pick ? ' ledger--pick' : ''}`}>
        <thead><tr><th aria-hidden="true" />{columns.map((_, c) => <th key={c} scope="col" className={pick && c >= pick.columns ? 'is-working' : undefined}>{colName(c)}</th>)}</tr></thead>
        <tbody>
          <tr>
            <th scope="row">1</th>
            {columns.map((h, c) => {
              const ref = `${colName(c)}1`;
              const cls = [pick?.selected === ref ? 'is-picked' : '', highlight.includes(ref) ? 'is-flag' : '', pick && c >= pick.columns ? 'is-working' : ''].filter(Boolean).join(' ');
              return <td key={c} className={`sheet-header ${cls}`.trim()}>{cell(ref, c, h, String(h))}</td>;
            })}
          </tr>
          {rows.map((r, i) => {
            const rowNo = i + 2;
            const rowPicked = pick?.mode === 'row' && selectedRow === rowNo;
            return (
              <tr key={rowNo} style={{ ['--row' as string]: i }} className={rowPicked ? 'is-picked-row' : undefined}>
                <th scope="row">{rowNo}</th>
                {columns.map((_, c) => {
                  const ref = `${colName(c)}${rowNo}`;
                  const isTarget = Boolean(t && colName(c) === t.col && rowNo === t.row);
                  const isFill = Boolean(t && colName(c) === t.col && rowNo > t.row && rowNo <= end);
                  const shown = values[ref];
                  const raw = r[c];
                  const cls = [
                    isTarget ? 'is-target' : '', isFill ? 'is-fill' : '', highlight.includes(ref) ? 'is-flag' : '', good.includes(ref) ? 'is-good' : '',
                    pick?.selected === ref ? 'is-picked' : '', pick && c >= pick.columns ? 'is-working' : '',
                    typeof raw === 'number' || shown !== undefined ? 'num' : '', shown?.startsWith('#') ? 'is-error' : '',
                  ].filter(Boolean).join(' ');
                  const content = shown !== undefined ? shown : isTarget ? <span className="placeholder">?</span> : isFill ? <span className="placeholder">↓</span> : raw ?? '';
                  return <td key={ref} className={cls}>{cell(ref, c, content, shown ?? (raw === null || raw === undefined ? '' : String(raw)))}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Formula builder. Fragments can be dragged onto the formula bar, tapped, or
 * chosen with the keyboard (Tab to a fragment, Enter to add). Backspace on the
 * bar removes the last fragment. Players who prefer can type the formula.
 */
export function FormulaBuilder({ id, tokens, value, onChange, disabled, cell, label }: {
  id: string; tokens: string[]; value: string; onChange: (formula: string) => void; disabled?: boolean; cell: string; label: string;
}) {
  const [parts, setParts] = useState<string[]>(() => (value && value !== '=' ? [value] : []));
  const [typing, setTyping] = useState(false);
  const [drag, setDrag] = useState<{ token: string; x: number; y: number } | null>(null);
  const [over, setOver] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  // A drop on the bar adds the fragment; the click that follows must not add it again.
  const dropped = useRef(false);

  const update = (next: string[]) => { setParts(next); onChange(next.join('')); };
  const add = (token: string) => !disabled && update([...parts, token]);
  const overBar = (x: number, y: number) => {
    const r = barRef.current?.getBoundingClientRect();
    return Boolean(r && x >= r.left && x <= r.right && y >= r.top - 12 && y <= r.bottom + 12);
  };

  return (
    <div className="builder">
      <div className="formula-bar builder-bar-wrap">
        <span className="cell-name" aria-hidden="true">{cell}</span>
        <span className="fx" aria-hidden="true">fx</span>
        {typing ? (
          <input
            id={`${id}-input`} className="formula-input" aria-label={label} value={value} readOnly={disabled}
            onChange={(e) => { setParts([e.target.value]); onChange(e.target.value); }}
            spellCheck={false} autoCapitalize="off" autoCorrect="off" placeholder="=…"
          />
        ) : (
          <div
            ref={barRef}
            id={`${id}-bar`}
            className={`builder-bar${over ? ' is-over' : ''}${parts.length ? '' : ' is-empty'}`}
            role="group"
            aria-label={`${label}. Current formula: ${parts.join('') || 'empty'}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (disabled) return;
              if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); update(parts.slice(0, -1)); }
            }}
          >
            {parts.length === 0 && <span className="builder-placeholder">Drag or tap fragments here</span>}
            {parts.map((p, i) => (
              <button
                key={`${p}-${i}`} type="button" className="chip chip--placed" disabled={disabled}
                onClick={() => update(parts.filter((_, j) => j !== i))}
                aria-label={`${p}, remove`}
              >{p}</button>
            ))}
          </div>
        )}
      </div>
      {!disabled && (
        <>
          {!typing && (
            <div className="bench" role="group" aria-label="Fragments on the bench">
              {tokens.map((tk) => (
                <button
                  key={tk} type="button" className={`chip chip--bench${drag?.token === tk ? ' is-dragging' : ''}`}
                  onClick={() => { if (dropped.current) { dropped.current = false; return; } add(tk); }}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    dropped.current = false;
                    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                    setDrag({ token: tk, x: e.clientX, y: e.clientY });
                  }}
                  onPointerMove={(e) => { if (drag?.token === tk) { setDrag({ token: tk, x: e.clientX, y: e.clientY }); setOver(overBar(e.clientX, e.clientY)); } }}
                  onPointerUp={(e) => {
                    if (drag?.token !== tk) return;
                    if (overBar(e.clientX, e.clientY)) { add(tk); dropped.current = true; }
                    setDrag(null); setOver(false);
                  }}
                  onPointerCancel={() => { setDrag(null); setOver(false); }}
                >{tk}</button>
              ))}
            </div>
          )}
          <div className="builder-tools">
            {!typing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(parts.slice(0, -1))} disabled={!parts.length}>⌫ Undo fragment</button>}
            {!typing && <button type="button" className="btn btn-ghost btn-sm" onClick={() => update([])} disabled={!parts.length}>Clear</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setTyping((t) => !t); }} aria-pressed={typing}>
              {typing ? 'Use the fragment bench' : '⌨ Type it instead'}
            </button>
          </div>
        </>
      )}
      {drag && (
        <div className="chip chip--ghost" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>{drag.token}</div>
      )}
    </div>
  );
}

/**
 * Stake silver on getting the step right first time. An optional side-game:
 * silver never changes XP, medals or unlocks, and no luck decides the payout.
 */
export function WagerPanel({ max, stake, locked, onStake, firstTryRule }: {
  max: number; stake: number; locked: boolean; onStake: (n: number) => void; firstTryRule: string;
}) {
  const presets = useMemo(() => [...new Set([0, Math.floor(max / 4), Math.floor(max / 2), max])].filter((n) => n >= 0), [max]);
  if (max <= 0 && !stake) {
    return <p className="wager wager--empty">🪙 Earn silver in earlier rounds to stake on this one (optional).</p>;
  }
  return (
    <div className={`wager${stake ? ' wager--live' : ''}`} role="group" aria-labelledby="wager-title">
      <p id="wager-title" className="wager-title"><span aria-hidden="true">🪙 </span>Optional: stake silver <span className="wager-rule">— win your stake if you’re right {firstTryRule}; lose it otherwise. Silver is a side-game: it never changes your XP, medal or unlocks.</span></p>
      {locked ? (
        <p className="wager-locked">{stake ? <>Staked <strong>{stake} silver</strong>. Locked in.</> : 'No stake this round.'}</p>
      ) : (
        <div className="wager-row">
          {presets.map((n) => (
            <button key={n} type="button" className={`chip chip--stake${stake === n ? ' is-on' : ''}`} aria-pressed={stake === n} onClick={() => onStake(n)}>
              {n === 0 ? 'No stake' : `${n} silver`}
            </button>
          ))}
          <label className="wager-custom">
            <span className="sr-only">Exact stake in silver, up to {max}</span>
            <input type="range" min={0} max={max} value={stake} onChange={(e) => onStake(Number(e.target.value))} aria-valuetext={`${stake} silver`} />
          </label>
        </div>
      )}
    </div>
  );
}

/** The market's reaction to the ledger: scales, coin chest or crates. Purely visual (aria-hidden). */
export function MarketReaction({ kind, state }: { kind: 'scales' | 'coins' | 'crates'; state: 'idle' | 'right' | 'wrong' }) {
  if (kind === 'scales') {
    const tilt = state === 'right' ? 0 : state === 'wrong' ? 14 : 7;
    return (
      <svg className={`reaction reaction--scales is-${state}`} viewBox="0 0 120 80" aria-hidden="true">
        <rect x="57" y="18" width="6" height="52" rx="2" fill="#8a5a00" />
        <rect x="40" y="68" width="40" height="8" rx="3" fill="#6b4500" />
        <g style={{ transform: `rotate(${tilt}deg)`, transformOrigin: '60px 20px' }} className="beam">
          <rect x="14" y="17" width="92" height="5" rx="2" fill="#c08a1a" />
          <path d="M18 22 L8 44 H30 Z" fill="#e7b64a" /><path d="M102 22 L92 44 H114 Z" fill="#e7b64a" />
        </g>
        <circle cx="60" cy="18" r="5" fill={state === 'right' ? '#2dd4bf' : state === 'wrong' ? '#e05b4f' : '#f2b134'} />
      </svg>
    );
  }
  if (kind === 'coins') {
    const n = state === 'right' ? 9 : state === 'wrong' ? 2 : 5;
    return (
      <svg className={`reaction reaction--coins is-${state}`} viewBox="0 0 120 80" aria-hidden="true">
        <rect x="20" y="44" width="80" height="30" rx="6" fill="#6b4500" /><rect x="20" y="40" width="80" height="10" rx="4" fill="#8a5a00" />
        {Array.from({ length: n }, (_, i) => <ellipse key={i} className="coin" style={{ ['--i' as string]: i }} cx={36 + (i % 5) * 12} cy={38 - Math.floor(i / 5) * 7} rx="7" ry="3.5" fill="#f2b134" stroke="#8a5a00" />)}
      </svg>
    );
  }
  return (
    <svg className={`reaction reaction--crates is-${state}`} viewBox="0 0 120 80" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <g key={i} className="crate" style={{ ['--i' as string]: i }}>
          <rect x={14 + i * 32} y={state === 'right' && i === 1 ? 22 : 38} width="28" height="28" rx="3" fill={i === 1 ? '#c08a1a' : '#8a5a00'} stroke="#4a3000" />
          <path d={`M${14 + i * 32} ${(state === 'right' && i === 1 ? 22 : 38)} l28 28 M${42 + i * 32} ${(state === 'right' && i === 1 ? 22 : 38)} l-28 28`} stroke="#4a3000" />
        </g>
      ))}
    </svg>
  );
}

/** Wrapper for each game: mechanic banner + body. */
export function GameFrame({ mechanic, icon, children }: { mechanic: string; icon: string; children: ReactNode }) {
  return (
    <div className="game-frame">
      <p className="mechanic-banner"><span aria-hidden="true">{icon} </span>{mechanic}</p>
      {children}
    </div>
  );
}

/** Flip true briefly whenever `key` changes (for one-shot animations). */
export function usePulse(key: unknown, ms = 900): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return undefined; }
    setOn(true);
    const t = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(t);
  }, [key, ms]);
  return on;
}
