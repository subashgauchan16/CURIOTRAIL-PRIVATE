import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AssembleScene, ChoiceScene, DialogueScene, EndingScene, EvidenceScene, ExcelScene, KpiScene, PythonScene, SqlScene, SqlResult,
} from '../../engine/types';
import { computeXp, correctAnswer } from '../../engine/game-engine';
import { evaluatePython, str as pyStr } from '../../engine/python-lite';
import { colName, evaluateFormula, makeSheet, splitRef } from '../../engine/excel-lite';
import { runQuery } from '../../runtime/sql-runner';
import { Actions, CodeBlock, EvidenceCard, Feedback, InvalidMessage, Output, Speech, type SceneProps } from './common';
import { GameFrame, LedgerGrid } from '../games/parts';

// ---- Story scenes ----

export function DialogueView({ quest, scene, onNext }: SceneProps<DialogueScene>) {
  return (
    <>
      <Speech quest={quest} scene={scene} />
      <Actions><button type="button" className="btn btn-primary btn-lg" onClick={onNext}>{scene.action || 'Continue'}</button></Actions>
    </>
  );
}

export function EvidenceView({ quest, scene, inspected, onInspect, onNext }: SceneProps<EvidenceScene>) {
  const items = scene.evidence.map((id) => quest.evidence.find((e) => e.id === id)!);
  const done = items.filter((e) => inspected.includes(e.id)).length;
  return (
    <>
      <Speech quest={quest} scene={scene} />
      <div className="evidence-grid">
        {items.map((item) => {
          const open = inspected.includes(item.id);
          return <EvidenceCard key={item.id} item={item} collapsed={!open} onInspect={open ? undefined : () => onInspect(item.id)} />;
        })}
      </div>
      {done === items.length ? (
        <Actions><button type="button" className="btn btn-primary btn-lg" onClick={onNext}>{scene.action || 'Continue'}</button></Actions>
      ) : (
        <p className="gate-note" aria-live="polite">Inspect every item to continue ({done} of {items.length} inspected).</p>
      )}
    </>
  );
}

export function EndingView({ quest, scene, run, onNext }: SceneProps<EndingScene> & { run: import('../../engine/types').Run }) {
  const xp = computeXp(quest, { ...run, completed: true });
  return (
    <>
      <Speech quest={quest} scene={scene} />
      <p className="xp-total"><span aria-hidden="true">✨ </span>You earned {xp} XP on this run.</p>
      <Actions><button type="button" className="btn btn-primary btn-lg" onClick={onNext}>{scene.action || 'Finish'}</button></Actions>
    </>
  );
}

// ---- Multiple choice (including the prompt-writing challenge) ----

export function ChoiceView(props: SceneProps<ChoiceScene>) {
  const { quest, scene, result, tried, onCheck, invalid } = props;
  const [answer, setAnswer] = useState<string | null>(null);
  const solved = result.solved;
  const selected = solved ? scene.correct : answer;
  const body = (
    <>
      <Speech quest={quest} scene={scene} />
      {scene.code && <CodeBlock code={scene.code} />}
      {scene.sheet && <LedgerGrid columns={scene.sheet.columns} rows={scene.sheet.rows} label="Ledger" />}
      <form className="challenge" noValidate onSubmit={(e) => { e.preventDefault(); onCheck(answer ?? ''); }}>
        <fieldset>
          <legend className="prompt">{scene.prompt}</legend>
          <div className="options">
            {scene.options.map((option) => {
              const wasTried = tried.includes(option.id);
              const isCorrect = solved && option.id === scene.correct;
              return (
                <label key={option.id} className={`option${wasTried && !isCorrect ? ' option--tried' : ''}${isCorrect ? ' option--correct' : ''}`}>
                  <input type="radio" name={`answer-${scene.id}`} value={option.id} checked={selected === option.id} disabled={solved} onChange={() => setAnswer(option.id)} />
                  <span className="option-text">
                    {option.text}
                    {wasTried && !isCorrect && <span className="option-note"> · tried</span>}
                    {isCorrect && <span className="option-note"> · correct answer</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <InvalidMessage text={invalid} />
        {!solved && <Actions><button type="submit" className="btn btn-primary btn-lg">Check answer</button></Actions>}
      </form>
      <Feedback {...props} />
    </>
  );
  // Game-first quests name the mechanic on a banner; older quests keep their look.
  return scene.mechanic ? <GameFrame mechanic={scene.mechanic} icon={scene.boss ? '⚔️' : '🔍'}>{body}</GameFrame> : body;
}

// ---- Assemble the announcement (Missing Signal) ----

export function AssembleView(props: SceneProps<AssembleScene>) {
  const { quest, scene, result, onCheck, invalid } = props;
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<string[]>([]);
  const solved = result.solved;
  const answer = solved ? (correctAnswer(scene) as { slots: Record<string, string>; extras: string[] }) : { slots, extras };
  return (
    <>
      <Speech quest={quest} scene={scene} />
      <form className="challenge assemble" noValidate onSubmit={(e) => { e.preventDefault(); onCheck({ slots: { ...slots }, extras: [...extras] }); }}>
        <p className="prompt">{scene.prompt}</p>
        <div className="assemble-grid">
          <div>
            {scene.slots.map((slot) => (
              <fieldset className="slot" key={slot.id}>
                <legend>{slot.label}</legend>
                <div className="options options--compact">
                  {slot.options.map((o) => (
                    <label key={o.id} className={`option${solved && o.correct ? ' option--correct' : ''}`}>
                      <input type="radio" name={`slot-${slot.id}`} checked={answer.slots[slot.id] === o.id} disabled={solved} onChange={() => setSlots((s) => ({ ...s, [slot.id]: o.id }))} />
                      <span className="option-text">{o.text}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            {scene.extras && (
              <fieldset className="slot">
                <legend>Extra details <span className="hint">(optional: tick any the notice supports)</span></legend>
                <div className="options options--compact">
                  {scene.extras.map((x) => (
                    <label key={x.id} className="option option--check">
                      <input
                        type="checkbox"
                        checked={answer.extras.includes(x.id)}
                        disabled={solved}
                        onChange={(e) => setExtras((list) => scene.extras!.map((i) => i.id).filter((id) => (id === x.id ? e.target.checked : list.includes(id))))}
                      />
                      <span className="option-text">{x.text}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
          <div className="notice-preview" role="region" aria-label="Live preview of your announcement">
            <p className="notice-kicker">{solved ? 'Published' : 'Draft preview'}</p>
            <h3>{scene.heading}</h3>
            {(scene.fixedLines || []).map((l) => <p key={l}>{l}</p>)}
            <ul>
              {scene.slots.map((slot) => {
                const o = slot.options.find((x) => x.id === answer.slots[slot.id]);
                return <li key={slot.id} className={o ? '' : 'placeholder'}>{o ? o.text : `[${slot.label}]`}</li>;
              })}
              {(scene.extras || []).filter((x) => answer.extras.includes(x.id)).map((x) => <li key={x.id}>{x.text}</li>)}
            </ul>
          </div>
        </div>
        <InvalidMessage text={invalid} />
        {!solved && <Actions><button type="submit" className="btn btn-primary btn-lg">Check announcement</button></Actions>}
      </form>
      <Feedback {...props} />
    </>
  );
}

// ---- SQL ----

function TableView({ table }: { table: { name?: string; columns: string[]; rows: (string | number | null)[][] } }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={table.name ? `Table ${table.name}` : 'Query result'}>
      <table className="data-table">
        {table.name && <caption>{table.name}</caption>}
        <thead><tr>{table.columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v === null ? 'NULL' : String(v)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function SqlView(props: SceneProps<SqlScene>) {
  const { quest, scene, result, onCheck, invalid } = props;
  const [query, setQuery] = useState(scene.starter);
  const [preview, setPreview] = useState<{ result?: SqlResult; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const solved = result.solved;

  const run = async (submit: boolean) => {
    if (!query.trim()) { onCheck({ query }); return; }
    setBusy(true);
    const outcome = await runQuery(scene.setup, query);
    setBusy(false);
    if (submit) onCheck({ query, ...outcome });
    else setPreview(outcome);
  };

  return (
    <>
      <Speech quest={quest} scene={scene} />
      {scene.tables.map((t) => <TableView key={t.name} table={t} />)}
      <form className="challenge code-challenge" noValidate onSubmit={(e) => { e.preventDefault(); void run(true); }}>
        <label className="prompt" htmlFor={`sql-${scene.id}`}>{scene.prompt}</label>
        <textarea
          id={`sql-${scene.id}`}
          className="code-input"
          value={solved ? scene.solution : query}
          onChange={(e) => setQuery(e.target.value)}
          readOnly={solved}
          rows={Math.max(4, query.split('\n').length + 1)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void run(true); }
          }}
        />
        <p className="hint">Runs on a real SQLite database in your browser. Ctrl+Enter checks your answer.</p>
        <InvalidMessage text={invalid} />
        {!solved && (
          <Actions>
            <button type="button" className="btn btn-secondary" onClick={() => void run(false)} disabled={busy}>Run query</button>
            <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>{busy ? 'Running…' : 'Check answer'}</button>
          </Actions>
        )}
        {preview && !solved && (
          <div className="preview" aria-live="polite">
            {preview.error ? <Output text={`Error: ${preview.error}`} /> : preview.result && (preview.result.columns.length ? <TableView table={preview.result} /> : <Output text="(The query ran but returned no table.)" />)}
            <p className="hint">This preview doesn’t count as an attempt.</p>
          </div>
        )}
      </form>
      <Feedback {...props} revealedAnswer={<CodeBlock code={scene.solution} label="One correct query" />} />
    </>
  );
}

// ---- Python ----

export function PythonView(props: SceneProps<PythonScene>) {
  const { quest, scene, result, onCheck, invalid } = props;
  const [expression, setExpression] = useState(scene.starter ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const solved = result.solved;
  const blankLine = scene.code.findIndex((l) => l.includes('___'));
  const before = scene.code[blankLine].split('___')[0];
  const after = scene.code[blankLine].split('___')[1] ?? '';
  const runPreview = () => {
    const r = evaluatePython(expression, scene.variables);
    setPreview(r.ok ? pyStr(r.value) : r.error);
  };
  return (
    <>
      <Speech quest={quest} scene={scene} />
      <form className="challenge code-challenge" noValidate onSubmit={(e) => { e.preventDefault(); onCheck({ expression }); }}>
        <p className="prompt" id={`py-prompt-${scene.id}`}>{scene.prompt}</p>
        <div className="program" aria-label="Python program">
          {scene.code.map((line, i) => (
            <div className="program-line" key={i}>
              <span className="line-no" aria-hidden="true">{i + 1}</span>
              {i === blankLine ? (
                <span className="line-code">
                  <span>{before}</span>
                  <input
                    className="code-inline"
                    aria-labelledby={`py-prompt-${scene.id}`}
                    aria-describedby={`py-hint-${scene.id}`}
                    value={solved ? scene.solution : expression}
                    onChange={(e) => setExpression(e.target.value)}
                    readOnly={solved}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    size={Math.max(18, expression.length + 2)}
                  />
                  <span>{after}</span>
                </span>
              ) : (
                <code className="line-code">{line}</code>
              )}
            </div>
          ))}
        </div>
        <p className="hint" id={`py-hint-${scene.id}`}>A practice Python sandbox: expressions, numbers, text, lists and built-ins such as sum, len, round and str.</p>
        <InvalidMessage text={invalid} />
        {!solved && (
          <Actions>
            <button type="button" className="btn btn-secondary" onClick={runPreview}>Run</button>
            <button type="submit" className="btn btn-primary btn-lg">Check answer</button>
          </Actions>
        )}
        {preview !== null && !solved && (
          <div className="preview" aria-live="polite"><Output text={preview} /><p className="hint">Running doesn’t count as an attempt.</p></div>
        )}
      </form>
      <Feedback {...props} revealedAnswer={<CodeBlock code={scene.code[blankLine].replace('___', scene.solution)} label="Corrected line" />} />
    </>
  );
}

// ---- Excel ----

export function ExcelView(props: SceneProps<ExcelScene>) {
  const { quest, scene, result, onCheck, invalid } = props;
  const [formula, setFormula] = useState(scene.starter ?? '=');
  const solved = result.solved;
  const target = splitRef(scene.target);
  const fillEnd = scene.fillDownTo ? splitRef(scene.fillDownTo).row : target.row;
  const shown = solved ? scene.solution : formula;

  // Live preview of what the target cell would show (not an attempt).
  const preview = useMemo(() => {
    if (!shown.trim().startsWith('=') || shown.trim() === '=') return null;
    const r = evaluateFormula(shown, makeSheet(scene.columns, scene.rows), scene.target);
    return r.ok ? String(Math.round(r.value! * 100) / 100) : r.error?.startsWith('#') ? r.error : '…';
  }, [shown, scene]);

  const rows = scene.rows;
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Speech quest={quest} scene={scene} />
      <form className="challenge code-challenge" noValidate onSubmit={(e) => { e.preventDefault(); onCheck({ formula }); }}>
        <p className="prompt" id={`xl-prompt-${scene.id}`}>{scene.prompt}</p>
        <div className="formula-bar">
          <span className="cell-name" aria-hidden="true">{scene.target}</span>
          <span className="fx" aria-hidden="true">fx</span>
          <input
            ref={inputRef}
            className="formula-input"
            aria-labelledby={`xl-prompt-${scene.id}`}
            value={shown}
            readOnly={solved}
            onChange={(e) => setFormula(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Spreadsheet">
          <table className="sheet">
            <thead>
              <tr><th aria-hidden="true" />{scene.columns.map((_, c) => <th key={c} scope="col">{colName(c)}</th>)}</tr>
            </thead>
            <tbody>
              <tr><th scope="row">1</th>{scene.columns.map((label) => <td key={label} className="sheet-header">{label}</td>)}</tr>
              {rows.map((r, i) => {
                const rowNo = i + 2;
                return (
                  <tr key={rowNo}>
                    <th scope="row">{rowNo}</th>
                    {scene.columns.map((_, c) => {
                      const ref = `${colName(c)}${rowNo}`;
                      const isTarget = colName(c) === target.col && rowNo === target.row;
                      const isFill = colName(c) === target.col && rowNo > target.row && rowNo <= fillEnd;
                      const value = r[c];
                      return (
                        <td key={ref} className={`${isTarget ? 'is-target' : ''}${isFill ? ' is-fill' : ''}${typeof value === 'number' ? ' num' : ''}`}>
                          {isTarget ? (preview ?? <span className="placeholder">your formula</span>) : isFill ? <span className="placeholder">↓ filled</span> : value ?? ''}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {scene.fillDownTo && <p className="hint">Your formula in {scene.target} is filled down to {scene.fillDownTo}, like dragging Excel’s fill handle.</p>}
        <InvalidMessage text={invalid} />
        {!solved && <Actions><button type="submit" className="btn btn-primary btn-lg">Check formula</button></Actions>}
      </form>
      <Feedback {...props} revealedAnswer={<CodeBlock code={scene.solution} label="One correct formula" />} />
    </>
  );
}

// ---- KPI dashboard sorting (drag and drop, with a select fallback) ----

export function KpiView(props: SceneProps<KpiScene>) {
  const { quest, scene, result, onCheck, invalid } = props;
  const [placement, setPlacement] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const solved = result.solved;
  const shown = solved ? (correctAnswer(scene) as { placement: Record<string, string> }).placement : placement;

  // While dragging near the top or bottom edge, scroll the page so every
  // drop zone is reachable on small screens.
  const pointerY = useRef<number | null>(null);
  useEffect(() => {
    if (!drag) return undefined;
    let frame = 0;
    const tick = () => {
      const y = pointerY.current;
      if (y !== null) {
        const edge = 70;
        if (y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((y - (window.innerHeight - edge)) / 4));
        else if (y < edge + 60) window.scrollBy(0, -Math.ceil((edge + 60 - y) / 4));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const move = (card: string, category: string) => setPlacement((p) => {
    const next = { ...p };
    if (category) next[card] = category; else delete next[card];
    return next;
  });

  const zoneAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest('[data-zone]') as HTMLElement | null;
    return el?.dataset.zone ?? null;
  };

  const card = (c: KpiScene['cards'][number]) => (
    <li
      key={c.id}
      className={`kpi-card${drag?.id === c.id ? ' is-dragging' : ''}`}
      onPointerDown={(e) => {
        if (solved || (e.target as HTMLElement).closest('select')) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setDrag({ id: c.id, x: e.clientX, y: e.clientY });
      }}
      onPointerMove={(e) => {
        if (drag?.id !== c.id) return;
        pointerY.current = e.clientY;
        setDrag({ id: c.id, x: e.clientX, y: e.clientY });
        setOver(zoneAt(e.clientX, e.clientY));
      }}
      onPointerUp={(e) => {
        if (drag?.id !== c.id) return;
        const zone = zoneAt(e.clientX, e.clientY);
        if (zone) move(c.id, zone === 'pool' ? '' : zone);
        pointerY.current = null;
        setDrag(null);
        setOver(null);
      }}
      onPointerCancel={() => { setDrag(null); setOver(null); }}
    >
      <span className="kpi-grip" aria-hidden="true">⠿</span>
      <span className="kpi-text"><span className="kpi-label">{c.label}</span><span className="kpi-detail">{c.detail}</span></span>
      <label className="kpi-move">
        <span className="sr-only">Place “{c.label}” in</span>
        <select value={shown[c.id] ?? ''} disabled={solved} onChange={(e) => move(c.id, e.target.value)}>
          <option value="">Not placed</option>
          {scene.categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}
        </select>
      </label>
    </li>
  );

  const unplaced = scene.cards.filter((c) => !shown[c.id]);
  const dragged = drag ? scene.cards.find((c) => c.id === drag.id) : null;
  return (
    <>
      {dragged && drag && (
        // A ghost follows the pointer; the real card stays put so nothing
        // shifts under the player's finger while dragging.
        <div className="kpi-card kpi-ghost" aria-hidden="true" style={{ left: drag.x, top: drag.y }}>
          <span className="kpi-grip">⠿</span>
          <span className="kpi-text"><span className="kpi-label">{dragged.label}</span><span className="kpi-detail">{dragged.detail}</span></span>
        </div>
      )}
      <Speech quest={quest} scene={scene} />
      <form className="challenge" noValidate onSubmit={(e) => { e.preventDefault(); onCheck({ placement: { ...placement } }); }}>
        <p className="prompt">{scene.prompt}</p>
        <p className="hint">Drag each card into a section, or use its menu to choose a section.</p>
        <div className={`kpi-pool${over === 'pool' ? ' is-over' : ''}`} data-zone="pool">
          <p className="kpi-zone-title">Unsorted cards ({unplaced.length})</p>
          <ul className="kpi-cards">{unplaced.map(card)}</ul>
        </div>
        <div className="kpi-board">
          {scene.categories.map((cat) => {
            const cards = scene.cards.filter((c) => shown[c.id] === cat.id);
            return (
              <section key={cat.id} className={`kpi-zone${over === cat.id ? ' is-over' : ''}`} data-zone={cat.id} aria-labelledby={`zone-${cat.id}`}>
                <h3 id={`zone-${cat.id}`} className="kpi-zone-title">{cat.label} <span className="count">({cards.length})</span></h3>
                <p className="kpi-zone-desc">{cat.description}</p>
                <ul className="kpi-cards">{cards.map(card)}</ul>
              </section>
            );
          })}
        </div>
        <InvalidMessage text={invalid} />
        {!solved && <Actions><button type="submit" className="btn btn-primary btn-lg">Check dashboard</button></Actions>}
      </form>
      <Feedback {...props} />
    </>
  );
}

