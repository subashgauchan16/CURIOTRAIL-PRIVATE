// Practise one round of a finished quest. Answers are checked by the same
// engine and count towards concept mastery (retrieval practice), but give no
// XP and never change quest results, so replaying can't be used to grind.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../app/game';
import { announce, focusElement } from '../../app/a11y';
import * as engine from '../../engine/game-engine';
import { newSeed } from '../../engine/games/rng';
import { dayNumber, reviewWeight } from '../../engine/games/mastery';
import type { Answer, Outcome, Quest, Run } from '../../engine/types';
import type { Pose } from '../../world/characters';
import type { SceneProps } from '../quest/common';
import { ChoiceView } from '../quest/Scenes';
import { GambitView, MatchView, RepairView, RunewordView, SpotView, WheelView, WorkshopView } from '../games/GameViews';
import { CodexDialog, questConcepts } from '../games/Hud';
import { recordStep, type WorldEvent } from './QuestScreen';
import { withEvent, type Progress } from '../../engine/progress-store';
import { BrandMark } from '../brand/BrandMark';

interface Props {
  questId: string;
  sceneId: string;
  onPose: (p: { character?: string; pose: Pose }) => void;
  onWorld?: (event: WorldEvent) => void;
  reducedMotion?: boolean;
}

export function PracticeScreen({ questId, sceneId, onPose, onWorld, reducedMotion = false }: Props) {
  const game = useGame();
  const { quests, update, codex } = game;
  const full = quests.get(questId)!;
  // A one-step quest wrapping the chosen round, plus an ending.
  const quest: Quest = useMemo(() => ({
    ...full,
    scenes: [full.scenes.find((s) => s.id === sceneId)!, { id: 'practice-end', type: 'ending', title: 'Practice complete' }],
  }), [full, sceneId]);
  const [run, setRun] = useState<Run>(() => engine.createRun(quest, newSeed()));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const raw = quest.scenes[0];
  const scene = useMemo(() => engine.resolveScene(raw, run), [raw, run.seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = engine.resultFor(run, raw.id);

  useEffect(() => {
    onPose({ character: raw.speaker ?? Object.keys(full.characters)[0], pose: result.solved && !result.revealed ? 'celebrate' : outcome && !outcome.correct ? 'talk' : 'idle' });
  }, [raw, result.solved, result.revealed, outcome, onPose, full]);

  useEffect(() => { if (outcome) focusElement(stageRef.current?.querySelector('[data-feedback]')); }, [outcome]);

  if (!engine.isChallenge(raw)) return null;

  // A finished practice round is a concept revisit in the learning history (not an attempt).
  const practised = (p: Progress, done: Run) => {
    const r = engine.resultFor(done, raw.id);
    return withEvent(p, { k: 'practice', q: full.id, s: raw.id, ok: engine.isFirstTry(raw, r) && !r.revealed });
  };

  const onCheck = (answer: Answer) => {
    const { run: next, outcome: out } = engine.submitAnswer(quest, run, answer);
    if (!out.valid) { setInvalid(out.message ?? 'Please answer first.'); announce(out.message ?? ''); return; }
    setInvalid(null);
    setRun(next);
    setOutcome(out);
    if (engine.stepFinished(out)) update((p) => practised(recordStep(p, full, next, raw), next));
    onWorld?.(out.correct ? 'right' : 'wrong');
  };
  const onReveal = () => {
    const next = engine.revealAnswer(quest, run);
    setRun(next);
    setOutcome(null);
    update((p) => practised(recordStep(p, full, next, raw), next));
  };
  const onSpin = () => {
    const today = dayNumber();
    const weights = Object.fromEntries(questConcepts(full).map((c) => [c, reviewWeight(game.progress.concepts[c], today)]));
    setRun(engine.spinWheel(quest, run, weights));
  };
  const again = () => { setRun(engine.createRun(quest, newSeed())); setOutcome(null); setInvalid(null); };

  const props: SceneProps = {
    quest, scene, result, outcome, tried: [], inspected: [], onCheck, onReveal, invalid,
    onNext: again, onInspect: () => undefined, note: 'Practice round: no XP, but it counts towards remembering this skill.', practice: true,
  };
  const gp = { ...props, run, reducedMotion, onSpin };
  let body: React.ReactNode = null;
  switch (scene.type) {
    case 'choice': body = <ChoiceView key={run.seed} {...(props as SceneProps<typeof scene>)} />; break;
    case 'workshop': body = <WorkshopView key={run.seed} {...(gp as typeof gp & SceneProps<typeof scene>)} />; break;
    case 'repair': body = <RepairView key={run.seed} {...(gp as typeof gp & SceneProps<typeof scene>)} />; break;
    case 'runeword': body = <RunewordView key={run.seed} {...(gp as typeof gp & SceneProps<typeof scene>)} />; break;
    case 'wheel': body = <WheelView key={run.seed} {...(gp as typeof gp & SceneProps<typeof scene>)} />; break;
    case 'match': body = <MatchView key={run.seed} {...(gp as typeof gp & SceneProps<typeof scene>)} />; break;
    case 'gambit': body = <GambitView key={run.seed} {...(gp as typeof gp & SceneProps<typeof scene>)} />; break;
    case 'spot': body = <SpotView key={run.seed} {...(gp as typeof gp & SceneProps<typeof scene>)} />; break;
    default: body = <p>This round can be replayed by replaying the whole quest.</p>;
  }

  return (
    <section className="quest-screen" aria-labelledby="practice-title">
      <div className="quest-panel">
        <header className="quest-head">
          <a className="back-link" href={`#/complete/${full.id}`}>← Results: {full.title}</a>
          <p className="eyebrow">Practice round · no XP · counts towards mastery</p>
          <h1 id="practice-title" className="quest-title">{raw.title}</h1>
          <div className="hud-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={again}>↻ New attempt{('variants' in raw && raw.variants?.length) || raw.type === 'wheel' ? ' (new data)' : ''}</button>
            <button type="button" className="btn btn-secondary btn-sm codex-btn" onClick={() => setCodexOpen(true)}>📖 Codex</button>
          </div>
          <BrandMark className="brand-mark--end" />
        </header>
        <div ref={stageRef}>
          <article className={`scene scene--${scene.type} parchment`}>{body}</article>
        </div>
        <CodexDialog codex={codex} ids={questConcepts(full)} focusIds={engine.conceptsFor(raw, run)} open={codexOpen} onClose={() => setCodexOpen(false)} />
      </div>
    </section>
  );
}
