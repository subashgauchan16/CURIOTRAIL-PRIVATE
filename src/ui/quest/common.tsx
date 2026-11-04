import type { ReactNode } from 'react';
import type { ChallengeResult, ChallengeScene, Evidence, Outcome, Quest, Scene } from '../../engine/types';
import { isFirstTry, sceneXp } from '../../engine/game-engine';

export interface SceneProps<S extends Scene = Scene> {
  quest: Quest;
  scene: S;
  result: ChallengeResult;
  outcome: Outcome | null;
  tried: string[];
  inspected: string[];
  onCheck: (answer: import('../../engine/types').Answer) => void;
  onReveal: () => void;
  onNext: () => void;
  onInspect: (id: string) => void;
  invalid: string | null;
  /** Extra line shown with the result (e.g. how a silver stake settled). */
  note?: ReactNode;
  /** A practice replay: no XP is awarded, so none is shown. */
  practice?: boolean;
}

const KIND_ICON: Record<string, string> = { source: '📜', ai: '🤖', message: '💬' };

export function Speech({ quest, scene }: { quest: Quest; scene: Scene }) {
  if (!scene.speaker) return null;
  const character = quest.characters[scene.speaker];
  const lines = scene.lines || (scene.context ? [scene.context] : []);
  return (
    <div className="speech">
      <div className="speaker">
        <span className={`portrait portrait--${scene.speaker}`} aria-hidden="true">{character.initial}</span>
        <p className="speaker-id"><span className="speaker-name">{character.name}</span><span className="speaker-role">{character.role}</span></p>
      </div>
      {lines.length > 0 && <div className="speech-bubble">{lines.map((line, i) => <p key={i}>{line}</p>)}</div>}
    </div>
  );
}

export function EvidenceCard({ item, collapsed = false, compact = false, onInspect }: { item: Evidence; collapsed?: boolean; compact?: boolean; onInspect?: () => void }) {
  const bodyId = `evidence-body-${item.id}${compact ? '-c' : ''}`;
  return (
    <article className={`evidence evidence--${item.kind}${compact ? ' evidence--compact' : ''}`} data-evidence={item.id}>
      <header className="evidence-head">
        <span className={`tag tag--${item.kind}`}><span aria-hidden="true">{KIND_ICON[item.kind] ?? '•'}</span> {item.kindLabel}</span>
        <h3 className="evidence-title">{item.title}</h3>
        <p className="evidence-from"><span className="label">From: </span>{item.from}</p>
      </header>
      <div className="evidence-body" id={bodyId} hidden={collapsed} tabIndex={-1}>
        {item.body.map((line, i) => <p key={i}>{line}</p>)}
      </div>
      {onInspect && (
        <button type="button" className="btn btn-secondary evidence-toggle" aria-expanded="false" aria-controls={bodyId} onClick={onInspect}>
          Inspect <span className="sr-only">{item.title}</span>
        </button>
      )}
    </article>
  );
}

export function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}

export function InvalidMessage({ text }: { text: string | null }) {
  return text ? <p className="form-message" role="alert">{text}</p> : null;
}

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  return (
    <figure className="code-block">
      {label && <figcaption>{label}</figcaption>}
      <pre tabIndex={0}><code>{code}</code></pre>
    </figure>
  );
}

/** Correct / retry / revealed feedback, grounded in the engine's outcome. */
export function Feedback({ quest, scene, result, outcome, onReveal, onNext, revealedAnswer, note }: {
  quest: Quest; scene: ChallengeScene; result: ChallengeResult; outcome: Outcome | null;
  onReveal: () => void; onNext: () => void; revealedAnswer?: ReactNode; note?: ReactNode;
}) {
  if (result.solved) {
    const xp = sceneXp(quest, scene, result);
    return (
      <div className={`feedback feedback--${result.revealed ? 'revealed' : 'correct'}`} tabIndex={-1} data-feedback>
        <p className="feedback-title"><span aria-hidden="true">{result.revealed ? '💡 ' : '✓ '}</span>{result.revealed ? 'Here’s the answer' : 'Correct!'}</p>
        {outcome?.correct && outcome.feedback && <p>{outcome.feedback}</p>}
        {outcome?.output && <Output text={outcome.output} />}
        {result.revealed && revealedAnswer}
        <div className="why"><p className="why-label">Why it matters</p><p>{scene.explanation}</p></div>
        {result.revealed ? (
          <p className="xp-note">No XP for this step, and your recap will show this skill as “reviewed with help”. You can replay later for the full reward.</p>
        ) : (
          <p className="xp-note">+{xp} XP{isFirstTry(scene, result) ? ' (includes first-try bonus)' : ` (solved on attempt ${result.attempts})`}</p>
        )}
        {note && <p className="xp-note wager-note">{note}</p>}
        <Actions><button type="button" className="btn btn-primary btn-lg" onClick={onNext}>Continue</button></Actions>
      </div>
    );
  }
  if (!outcome || outcome.correct) return null;
  return (
    <div className="feedback feedback--retry" tabIndex={-1} data-feedback>
      <p className="feedback-title"><span aria-hidden="true">↻ </span>Not quite. Try again</p>
      {note && <p className="xp-note wager-note">{note}</p>}
      <p>{outcome.feedback}</p>
      {outcome.output && <Output text={outcome.output} />}
      {outcome.issues && outcome.issues.length > 0 && (
        <ul className="issues">{outcome.issues.map((issue) => <li key={issue.id}><strong>{issue.label}: </strong>{issue.text}</li>)}</ul>
      )}
      {outcome.hint && <p className="hint-box"><strong>Hint {Math.min(outcome.attempts ?? 1, scene.hints.length)} of {scene.hints.length}: </strong>{outcome.hint}</p>}
      {outcome.canReveal && (
        <div className="reveal">
          <p>Stuck? You can see the answer with an explanation, then carry on.</p>
          <button type="button" className="btn btn-ghost" onClick={onReveal}>Show me the answer</button>
        </div>
      )}
    </div>
  );
}

export function Output({ text }: { text: string }) {
  return (
    <figure className="output">
      <figcaption>Output</figcaption>
      <pre><code>{text}</code></pre>
    </figure>
  );
}
