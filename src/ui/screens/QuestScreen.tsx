import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../app/game';
import { navigate } from '../../app/router';
import { announce, focusElement } from '../../app/a11y';
import * as engine from '../../engine/game-engine';
import { questRecord, totalXp, withCompletion, withConcepts, withEvent, withLessonRead, withRun, type Progress } from '../../engine/progress-store';
import { runScore } from '../../engine/learning-analytics';
import { destinationForQuest, moduleForQuest, newlyUnlocked } from '../../engine/progression';
import type { Answer, Outcome, Quest, Run, Scene } from '../../engine/types';
import type { Pose } from '../../world/characters';
import { newSeed } from '../../engine/games/rng';
import { dayNumber, recordConcepts, reviewWeight } from '../../engine/games/mastery';
import { EvidenceCard, Speech, type SceneProps } from '../quest/common';
import { AssembleView, ChoiceView, DialogueView, EndingView, EvidenceView, ExcelView, KpiView, PythonView, SqlView } from '../quest/Scenes';
import { LessonCard } from '../quest/LessonCard';
import { SchemaLabView } from '../quest/SchemaLab';
import { GambitView, MatchView, RepairView, RunewordView, SpotView, WheelView, WorkshopView } from '../games/GameViews';
import { WagerPanel } from '../games/parts';
import { CodexDialog, PotMeter, RoundTrack, questConcepts } from '../games/Hud';
import { BrandMark } from '../brand/BrandMark';

export type WorldEvent = 'right' | 'wrong';

/** Record concept practice for a step that has just been finished (solved or revealed). */
export function recordStep(progress: Progress, quest: import('../../engine/types').Quest, run: Run, scene: Scene): Progress {
  if (!engine.isChallenge(scene)) return progress;
  const r = engine.resultFor(run, scene.id);
  if (!r.solved) return progress;
  const seg = scene.type === 'wheel' ? engine.landedSegment(scene, run) : null;
  const context = `${quest.id}/${seg ? `${scene.id}-${seg.id}` : scene.id}`.slice(0, 129);
  const concepts = recordConcepts(progress.concepts, engine.conceptsFor(scene, run), {
    firstTry: engine.isFirstTry(scene, r), revealed: r.revealed, wrongAttempts: Math.max(0, r.attempts - engine.parFor(scene)), context, day: dayNumber(),
  });
  return withConcepts(progress, concepts);
}

/**
 * Learning-history events for one checked answer: the answer, a hint if the
 * game showed one, and a reveal if the player ran out of picks. Kept on this
 * device only, and skipped when the player has paused the history.
 */
export function recordAnswer(progress: Progress, questId: string, sceneId: string, run: Run, outcome: Outcome): Progress {
  const base = { q: questId, s: sceneId, r: run.seed ?? 0 };
  let p = withEvent(progress, { ...base, k: 'answer', ok: Boolean(outcome.correct) });
  if (outcome.hint) p = withEvent(p, { ...base, k: 'hint' });
  if (outcome.locked) p = withEvent(p, { ...base, k: 'reveal' });
  return p;
}

/** In game quests a step is a round (or a stage of the boss), not a course phase. */
function GameBadge({ quest, scene }: { quest: Quest; scene: Scene }) {
  const label = engine.roundLabel(quest, scene.id);
  if (!label) return null;
  return <p className={`phase-badge phase-badge--${label.kind === 'boss' ? 'assessment' : 'round'}`}><span aria-hidden="true">{label.kind === 'boss' ? '⚔️ ' : 'ᚱ '}</span>{label.text}</p>;
}

/** Where a step sits in the learning cycle, shown as a badge. */
export function phaseOf(scene: Scene): { id: string; label: string; icon: string } {
  if (scene.type === 'lesson') return { id: 'learn', label: 'Learn', icon: '💡' };
  if (scene.type === 'dialogue') return { id: 'story', label: 'Story', icon: '📜' };
  if (scene.type === 'evidence') return { id: 'story', label: 'Investigate', icon: '🔍' };
  if (scene.type === 'ending') return { id: 'mastery', label: 'Wrap-up', icon: '🏁' };
  const phase = engine.isChallenge(scene) ? scene.phase ?? 'practice' : 'practice';
  if (phase === 'guided') return { id: 'guided', label: 'Guided exercise', icon: '🧩' };
  if (phase === 'assessment') return { id: 'assessment', label: 'Check your understanding', icon: '🎯' };
  return { id: 'practice', label: scene.type === 'schema' ? 'Lab: independent practice' : 'Practice', icon: '🛠️' };
}

interface Props {
  questId: string;
  onPose: (p: { character?: string; pose: Pose }) => void;
  onWorld?: (event: WorldEvent) => void;
  reducedMotion?: boolean;
}

export function QuestScreen({ questId, onPose, onWorld, reducedMotion = false }: Props) {
  const game = useGame();
  const { quests, world, curriculum, update, setLastCompletion, codex } = game;
  const quest = quests.get(questId)!;
  const destination = destinationForQuest(world, questId)!;
  const [run, setRun] = useState<Run>(() => {
    const record = questRecord(game.progress, questId);
    // Each fresh run gets its own seed: boss data and wheel spins differ between runs.
    return record.run && !record.run.completed ? engine.restoreRun(quest, record.run) : engine.createRun(quest, newSeed());
  });
  const [codexOpen, setCodexOpen] = useState(false);
  const [view, setView] = useState<{ sceneId: string; outcome: Outcome | null; tried: string[]; invalid: string | null }>(
    { sceneId: '', outcome: null, tried: [], invalid: null },
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const focusTarget = useRef<'scene' | 'feedback' | null>(null);
  const progressRef = useRef(game.progress);
  progressRef.current = game.progress;

  const rawScene = engine.currentScene(quest, run);
  // The step as this run sees it (data variants substituted).
  const scene = useMemo(() => engine.resolveScene(rawScene, run), [rawScene, run.seed]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = view.sceneId === scene.id ? view : { sceneId: scene.id, outcome: null, tried: [], invalid: null };
  const result = engine.resultFor(run, scene.id);

  // Character pose in the 3D world follows the story.
  useEffect(() => {
    let pose: Pose = 'idle';
    if (scene.type === 'dialogue' || scene.type === 'lesson') pose = 'talk';
    else if (scene.type === 'evidence') pose = 'point';
    else if (scene.type === 'ending') pose = 'wave';
    else if (result.solved && !result.revealed) pose = 'celebrate';
    else if (v.outcome && !v.outcome.correct) pose = 'talk';
    onPose({ character: scene.speaker ?? Object.keys(quest.characters)[0], pose });
  }, [scene, result.solved, result.revealed, v.outcome, onPose, quest]);

  // Focus management after each render that changed the step or feedback.
  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target === 'scene') focusElement(stageRef.current?.querySelector('.scene-title'));
    if (target === 'feedback') focusElement(stageRef.current?.querySelector('[data-feedback]'));
  });

  // Learning history: note when a challenge step is opened with no answer yet
  // in this run (once per run and step, so reloading doesn't repeat it).
  useEffect(() => {
    if (!engine.isChallenge(rawScene) || result.attempts > 0 || result.solved) return;
    const r = run.seed ?? 0;
    if (progressRef.current.events.some((e) => e.k === 'start' && e.q === quest.id && e.s === rawScene.id && (e.r ?? 0) === r)) return;
    update((p) => withEvent(p, { k: 'start', q: quest.id, s: rawScene.id, r }));
  }, [rawScene.id, run.seed]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (next: Run, focus: 'scene' | 'feedback' | null) => {
    setRun(next);
    focusTarget.current = focus;
    update((p) => withRun(p, next, engine.computeXp(quest, next)));
  };

  const onCheck = (answer: Answer) => {
    const { run: next, outcome } = engine.submitAnswer(quest, run, answer);
    if (!outcome.valid) {
      setView({ ...v, invalid: outcome.message ?? 'Please answer first.' });
      announce(outcome.message ?? '');
      return;
    }
    const tried = scene.type === 'choice' && !outcome.correct && typeof answer === 'string' && !v.tried.includes(answer) ? [...v.tried, answer] : v.tried;
    setView({ sceneId: scene.id, outcome, tried, invalid: null });
    commit(next, 'feedback');
    update((p) => recordAnswer(p, quest.id, rawScene.id, next, outcome));
    // A right answer, or running out of picks (recorded as revealed), finishes the step.
    if (engine.stepFinished(outcome)) update((p) => recordStep(p, quest, next, rawScene));
    onWorld?.(outcome.correct ? 'right' : 'wrong');
  };

  const onReveal = () => {
    setView({ ...v, outcome: null, invalid: null });
    const next = engine.revealAnswer(quest, run);
    commit(next, 'feedback');
    update((p) => withEvent(recordStep(p, quest, next, rawScene), { k: 'reveal', q: quest.id, s: rawScene.id, r: next.seed ?? 0 }));
  };

  const onSpin = () => {
    const today = dayNumber();
    const weights = Object.fromEntries(questConcepts(quest).map((c) => [c, reviewWeight(game.progress.concepts[c], today)]));
    const next = engine.spinWheel(quest, run, weights);
    commit(next, null);
    const seg = rawScene.type === 'wheel' ? engine.landedSegment(rawScene, next) : null;
    if (seg) window.setTimeout(() => announce(`The wheel landed on ${seg.label}.`), reducedMotion ? 0 : 2600);
  };

  const onStake = (amount: number) => commit(engine.placeWager(quest, run, amount), null);

  const onInspect = (id: string) => {
    const next = engine.inspectEvidence(quest, run, id);
    commit(next, null);
    const item = quest.evidence.find((e) => e.id === id)!;
    const remaining = scene.type === 'evidence' ? scene.evidence.filter((e) => !next.inspected.includes(e)).length : 0;
    announce(remaining ? `${item.title} opened. ${remaining} left to inspect.` : `${item.title} opened. All evidence inspected.`);
    window.setTimeout(() => focusElement(stageRef.current?.querySelector(`[data-evidence="${id}"] .evidence-body`)), 30);
  };

  const onNext = () => {
    // Remember lessons the player has read (no XP; it only shortens replays).
    if (scene.type === 'lesson') update((p) => withEvent(withLessonRead(p, engine.lessonKey(quest, scene)), { k: 'lesson', q: quest.id, s: scene.id, r: run.seed ?? 0 }));
    const after = engine.advance(quest, run);
    if (after === run) return;
    if (!after.completed) {
      commit(after, 'scene');
      return;
    }
    // Quest finished: the engine computes XP and stars; the store keeps the
    // best result so replays never stack rewards.
    const before = progressRef.current;
    const xp = engine.computeXp(quest, after);
    const stars = engine.computeStars(quest, after);
    const record = questRecord(before, quest.id);
    const mastered = engine.isMastered(quest, after);
    const mastery = engine.bossScore(quest, after);
    const medal = engine.computeMedal(quest, after);
    // The badge is earned on mastery, not on simply reaching the end.
    const silver = engine.computeSilver(quest, after);
    // The finished run's mastery score also goes into the learning history.
    const nextProgress = withEvent(withCompletion(before, after, xp, stars, mastered ? quest.badge?.id : undefined, { mastered, mastery, medal, silver }),
      { k: 'finish', q: quest.id, r: after.seed ?? 0, score: runScore(quest, after) });
    // XP shows live during a run, so measure the gain against the total as it
    // stood before this run: other quests plus this quest's previous best.
    const baseline = totalXp(before) - Math.max(record.bestXp, record.runXp) + record.bestXp;
    setLastCompletion({
      questId: quest.id,
      runXp: xp,
      totalBefore: baseline,
      totalAfter: totalXp(nextProgress),
      stars,
      bestStarsBefore: record.bestStars,
      firstCompletion: !record.completed,
      unlocked: newlyUnlocked(world, before, nextProgress).map((d) => d.id),
      medal, bestMedalBefore: record.bestMedal, mastery, mastered,
    });
    setRun(after);
    update(() => nextProgress);
    navigate(`/complete/${quest.id}`);
  };

  const stake = run.wagers?.[scene.id] ?? 0;
  const settled = engine.wagerResult(rawScene, run);
  const note = stake && result.solved ? (settled > 0 ? `🪙 Stake won: +${settled} silver` : `🪙 Stake lost: ${settled} silver (${engine.parFor(rawScene) > 1 ? `not solved within ${engine.parFor(rawScene)} guesses` : 'not right first time'})`)
    : stake && result.attempts >= engine.parFor(rawScene) ? `🪙 Your ${stake}-silver stake is lost. Solving this still earns its XP.`
    : stake && result.attempts > 0 ? `🪙 Your ${stake}-silver stake is still in play: solve within ${engine.parFor(rawScene)} guesses to win it.` : undefined;
  const props: SceneProps = { quest, scene, result, outcome: v.outcome, tried: v.tried, inspected: run.inspected, onCheck, onReveal, onNext, onInspect, invalid: v.invalid, note };
  const gameProps = { ...props, run, reducedMotion, onSpin };
  const focusConcepts = engine.isChallenge(rawScene) ? engine.conceptsFor(rawScene, run) : [];
  const { step, total } = engine.progressSummary(quest, run);
  const phase = phaseOf(scene);
  const module = moduleForQuest(curriculum.modules, quest.id);
  const collected = quest.evidence.filter((e) => run.inspected.includes(e.id));
  const showDrawer = collected.length > 0 && engine.isChallenge(scene);
  // Quests built from the game mechanics get the game HUD.
  const gameQuest = quest.scenes.some((sc) => engine.isChallenge(sc) && Boolean(sc.mechanic));

  let body: React.ReactNode;
  switch (scene.type) {
    case 'dialogue': body = <DialogueView {...(props as SceneProps<typeof scene>)} />; break;
    case 'evidence': body = <EvidenceView {...(props as SceneProps<typeof scene>)} />; break;
    case 'choice': body = <ChoiceView key={scene.id} {...(props as SceneProps<typeof scene>)} />; break;
    case 'assemble': body = <AssembleView key={scene.id} {...(props as SceneProps<typeof scene>)} />; break;
    case 'sql': body = <SqlView key={scene.id} {...(props as SceneProps<typeof scene>)} />; break;
    case 'python': body = <PythonView key={scene.id} {...(props as SceneProps<typeof scene>)} />; break;
    case 'excel': body = <ExcelView key={scene.id} {...(props as SceneProps<typeof scene>)} />; break;
    case 'kpi': body = <KpiView key={scene.id} {...(props as SceneProps<typeof scene>)} />; break;
    case 'schema': body = <SchemaLabView key={scene.id} {...(props as SceneProps<typeof scene>)} draftKey={engine.lessonKey(quest, scene)} />; break;
    case 'workshop': body = <WorkshopView key={scene.id} {...(gameProps as typeof gameProps & SceneProps<typeof scene>)} />; break;
    case 'repair': body = <RepairView key={scene.id} {...(gameProps as typeof gameProps & SceneProps<typeof scene>)} />; break;
    case 'runeword': body = <RunewordView key={scene.id} {...(gameProps as typeof gameProps & SceneProps<typeof scene>)} />; break;
    case 'wheel': body = <WheelView key={scene.id} {...(gameProps as typeof gameProps & SceneProps<typeof scene>)} />; break;
    case 'match': body = <MatchView key={scene.id} {...(gameProps as typeof gameProps & SceneProps<typeof scene>)} />; break;
    case 'gambit': body = <GambitView key={scene.id} {...(gameProps as typeof gameProps & SceneProps<typeof scene>)} />; break;
    case 'spot': body = <SpotView key={scene.id} {...(gameProps as typeof gameProps & SceneProps<typeof scene>)} />; break;
    case 'lesson': body = (
      <>
        <Speech quest={quest} scene={{ ...scene, lines: undefined }} />
        <LessonCard lesson={scene.lesson} seenBefore={game.progress.lessons.includes(engine.lessonKey(quest, scene))} action={scene.action || 'Start the exercise'} onContinue={onNext} />
      </>
    ); break;
    case 'ending': body = <EndingView {...(props as SceneProps<typeof scene>)} scene={engine.endingFor(quest, run, scene)} run={run} />; break;
    default: body = null;
  }

  return (
    <section className="quest-screen" aria-labelledby="quest-title">
      <div className={`quest-panel${scene.type === 'schema' ? ' quest-panel--wide' : ''}`}>
        <header className="quest-head">
          <a className="back-link" href={`#/map/${destination.id}`}>← {destination.name}</a>
          {world.island?.nav && <a className="back-link back-link--island" href="#/explore">Return to the island</a>}
          <p className="eyebrow">Quest {String(quest.number).padStart(2, '0')} · {quest.subject}{module ? ` · Module ${module.number}: ${module.title}` : ''}</p>
          <h1 id="quest-title" className="quest-title">{quest.title}</h1>
          {!gameQuest && (
            <div className="quest-progress">
              <span id="quest-progress-label">Step {step} of {total}</span>
              <progress max={total} value={step} aria-labelledby="quest-progress-label" />
            </div>
          )}
          <BrandMark className="brand-mark--end" />
        </header>
        {gameQuest && (
          // Outside the header so it can stay pinned for the whole round.
          <div className="quest-hud quest-hud--pinned">
            <RoundTrack quest={quest} run={run} />
            <div className="hud-row">
              <PotMeter quest={quest} run={run} />
              <button type="button" className="btn btn-secondary btn-sm codex-btn" onClick={() => setCodexOpen(true)}>📖 Codex</button>
            </div>
            <p className="sr-only" id="quest-progress-label">Step {step} of {total}</p>
          </div>
        )}
        <div ref={stageRef}>
          <article key={scene.id} className={`scene scene--${scene.type} scene--phase-${phase.id}${engine.isChallenge(scene) && scene.boss ? ' scene--boss' : ''} parchment`}>
            {gameQuest ? <GameBadge quest={quest} scene={scene} /> : (
              <p className={`phase-badge phase-badge--${phase.id}`}><span aria-hidden="true">{engine.isChallenge(scene) && scene.boss ? '⚔️ ' : `${phase.icon} `}</span>{engine.isChallenge(scene) && scene.boss ? 'Boss · the audit' : phase.label}</p>
            )}
            <h2 className="scene-title" tabIndex={-1}>{scene.type === 'ending' ? engine.endingFor(quest, run, scene).title : scene.title}</h2>
            {engine.isChallenge(scene) && scene.wager && (
              <WagerPanel
                max={engine.maxStake(quest, run)} stake={stake} locked={result.attempts > 0 || result.solved}
                onStake={onStake} firstTryRule={engine.parFor(rawScene) > 1 ? `within ${engine.parFor(rawScene)} guesses` : 'first time'}
              />
            )}
            {body}
          </article>
        </div>
        {gameQuest && <CodexDialog codex={codex} ids={questConcepts(quest)} focusIds={focusConcepts} open={codexOpen} onClose={() => setCodexOpen(false)} />}
        {showDrawer && (
          <details className="evidence-drawer">
            <summary>Evidence ({collected.length})</summary>
            <div className="evidence-stack">{collected.map((item) => <EvidenceCard key={item.id} item={item} compact />)}</div>
          </details>
        )}
      </div>
    </section>
  );
}
