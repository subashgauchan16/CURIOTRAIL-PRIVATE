import { useEffect, useRef } from 'react';
import { useGame } from '../../app/game';
import { navigate } from '../../app/router';
import { announce, focusElement } from '../../app/a11y';
import { destinationStatus, moduleForQuest, questRequirement, questStatus, unlockRequirement, nextQuestAt, type DestinationStatus, type QuestStatus } from '../../engine/progression';
import { questRecord, withReplay } from '../../engine/progress-store';
import { isGameQuest, levelFor, restoreRun } from '../../engine/game-engine';
import { totalXp, totalStars } from '../../engine/progress-store';
import type { WorldRenderer } from '../../world/WorldRenderer';
import type { StageStatus } from '../WorldStage';
import { Stars } from '../Stars';
import { BrandMark } from '../brand/BrandMark';

export const STATUS_LABEL: Record<DestinationStatus | QuestStatus, { icon: string; text: string }> = {
  available: { icon: '●', text: 'Available' },
  'in-progress': { icon: '◐', text: 'In progress' },
  completed: { icon: '✓', text: 'Completed' },
  locked: { icon: '🔒', text: 'Locked' },
  planned: { icon: '✦', text: 'Planned' },
};

export function StatusChip({ status }: { status: DestinationStatus | QuestStatus }) {
  return <span className={`status status--${status}`}><span aria-hidden="true">{STATUS_LABEL[status].icon}</span> {STATUS_LABEL[status].text}</span>;
}

interface Props {
  selected: string | null;
  renderer: React.MutableRefObject<WorldRenderer | null>;
  stageStatus: StageStatus;
  webgl: boolean;
}

// Destinations already revealed this session (so the reveal plays once).
const revealed = new Set<string>();

const MEDAL_ICON: Record<string, string> = { gold: '🥇', silver: '🥈', bronze: '🥉' };

export function MapScreen({ selected, renderer, stageStatus, webgl }: Props) {
  const { world, quests, progress, update, curriculum, lastCompletion } = useGame();
  const detailRef = useRef<HTMLDivElement>(null);
  const xp = totalXp(progress);
  const level = levelFor(xp);
  const destination = selected ? world.destinations.find((d) => d.id === selected) ?? null : null;

  useEffect(() => {
    if (destination) {
      announce(`${destination.name} selected.`);
      const id = window.setTimeout(() => focusElement(detailRef.current?.querySelector('h2')), 60);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [destination]);

  // A destination unlocked by the quest just finished rises out of the island.
  useEffect(() => {
    const ids = (lastCompletion?.unlocked ?? []).filter((id) => !revealed.has(id));
    if (!ids.length) return undefined;
    const t = window.setTimeout(() => {
      ids.forEach((id) => { revealed.add(id); renderer.current?.revealUnlock(id); });
      announce(`New destination unlocked: ${ids.map((id) => world.destinations.find((d) => d.id === id)?.name ?? id).join(', ')}.`);
    }, 900);
    return () => window.clearTimeout(t);
  }, [lastCompletion, renderer, world]);

  // Keyboard camera controls while the map is open (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
      const r = renderer.current;
      if (!r) return;
      const actions: Record<string, () => void> = {
        q: () => r.orbit(0.25, 0), e: () => r.orbit(-0.25, 0),
        '+': () => r.zoom(0.8), '=': () => r.zoom(0.8), '-': () => r.zoom(1.25),
        r: () => r.resetView(),
      };
      const action = actions[e.key.toLowerCase()];
      if (action) { e.preventDefault(); action(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [renderer]);

  const show3dControls = webgl && stageStatus !== 'error' && stageStatus !== 'fallback';

  return (
    <section className="map-screen" aria-labelledby="map-title">
      <div className="map-panel">
        <header className="map-head">
          <p className="eyebrow">The Unmapped World</p>
          <h1 id="map-title">The Viking Island</h1>
          <p className="map-summary">Level {level.level} · {level.name} · {xp} XP · <span aria-hidden="true">★</span> {totalStars(progress)} stars</p>
          <BrandMark />
        </header>

        {destination ? (
          <div className="destination-detail" ref={detailRef}>
            <button type="button" className="btn btn-ghost btn-sm back" onClick={() => navigate('/map')}>← All destinations</button>
            <h2 tabIndex={-1}><span aria-hidden="true">{destination.icon}</span> {destination.name}</h2>
            <p className="dest-theme">{destination.theme}</p>
            <StatusChip status={destinationStatus(destination, quests, progress)} />
            <p className="dest-landmark">{destination.landmark}</p>
            {destination.unlockedBy === 'planned' ? (
              <p className="locked-note">{destination.teaser} {unlockRequirement(destination, quests, progress)}</p>
            ) : (
              <>
                {unlockRequirement(destination, quests, progress) && (
                  <p className="locked-note"><span aria-hidden="true">🔒</span> {unlockRequirement(destination, quests, progress)}</p>
                )}
                <ul className="quest-list">
                  {destination.quests.map((id) => {
                    const quest = quests.get(id)!;
                    const status = questStatus(quest, destination, progress);
                    const record = questRecord(progress, id);
                    const run = record.run ? restoreRun(quest, record.run) : null;
                    return (
                      <li key={id} className={`quest-item quest-item--${status}`}>
                        <div className="quest-item-head">
                          <h3>Quest {String(quest.number).padStart(2, '0')}: {quest.title}</h3>
                          <StatusChip status={status} />
                        </div>
                        <p className="quest-subject"><strong>{quest.subject}</strong> · about {quest.estimatedMinutes} min</p>
                        {moduleForQuest(curriculum.modules, id) && (
                          <p className="module-tag">Module {moduleForQuest(curriculum.modules, id)!.number}: {moduleForQuest(curriculum.modules, id)!.title} · {moduleForQuest(curriculum.modules, id)!.level}</p>
                        )}
                        <p>{quest.intro}</p>
                        {record.completed && (
                          <p className="meta">
                            Best: {record.bestXp} XP{!isGameQuest(quest) && <> · <Stars count={record.bestStars} /></>}
                            {MEDAL_ICON[record.bestMedal] && <> · <span aria-hidden="true">{MEDAL_ICON[record.bestMedal]}</span> {record.bestMedal} medal</>}
                            {!record.mastered && <> · <span className="warn-text">final challenge not yet passed</span></>}
                          </p>
                        )}
                        <div className="cta-row">
                          {status === 'available' && <a className="btn btn-primary" href={`#/quest/${id}`}>Enter quest</a>}
                          {status === 'in-progress' && run && <a className="btn btn-primary" href={`#/quest/${id}`}>Continue (step {run.sceneIndex + 1} of {quest.scenes.length})</a>}
                          {status === 'completed' && (
                            <>
                              <a className="btn btn-secondary" href={`#/complete/${id}`}>View results</a>
                              <button type="button" className="btn btn-ghost" onClick={() => { update((p) => withReplay(p, id)); navigate(`/quest/${id}`); }}>Replay</button>
                            </>
                          )}
                          {status === 'locked' && <p className="hint"><span aria-hidden="true">🔒</span> {questRequirement(quest, destination, quests, progress)}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        ) : (
          <nav aria-label="Destinations">
            <p className="hint map-instructions">
              {show3dControls ? 'Select a destination below or on the island. Drag to rotate, scroll or pinch to zoom.' : 'Select a destination to see its quests.'}
            </p>
            <ul className="destination-list">
              {world.destinations.map((d) => {
                const status = destinationStatus(d, quests, progress);
                const next = nextQuestAt(d, quests, progress);
                return (
                  <li key={d.id}>
                    <a
                      className={`destination-card destination-card--${status}`} href={`#/map/${d.id}`}
                      onMouseEnter={() => renderer.current?.highlight(d.id)} onMouseLeave={() => renderer.current?.highlight(null)}
                      onFocus={() => renderer.current?.highlight(d.id)} onBlur={() => renderer.current?.highlight(null)}
                    >
                      <span className="dest-icon" aria-hidden="true">{d.icon}</span>
                      <span className="dest-body">
                        <span className="dest-name">{d.name}</span>
                        <span className="dest-theme">{d.theme}</span>
                        {next && <span className="dest-next">Next: {next.title}</span>}
                      </span>
                      <StatusChip status={status} />
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}
      </div>

      {show3dControls && (
        <div className="camera-controls" role="group" aria-label="Camera controls">
          <button type="button" className="btn btn-icon" onClick={() => renderer.current?.orbit(0.3, 0)} aria-label="Rotate left (Q)">⟲</button>
          <button type="button" className="btn btn-icon" onClick={() => renderer.current?.orbit(-0.3, 0)} aria-label="Rotate right (E)">⟳</button>
          <button type="button" className="btn btn-icon" onClick={() => renderer.current?.orbit(0, -0.12)} aria-label="Tilt up">⤒</button>
          <button type="button" className="btn btn-icon" onClick={() => renderer.current?.orbit(0, 0.12)} aria-label="Tilt down">⤓</button>
          <button type="button" className="btn btn-icon" onClick={() => renderer.current?.zoom(0.8)} aria-label="Zoom in (+)">+</button>
          <button type="button" className="btn btn-icon" onClick={() => renderer.current?.zoom(1.25)} aria-label="Zoom out (−)">−</button>
          <button type="button" className="btn btn-icon" onClick={() => navigate('/map')} aria-label="Reset view (R)">⌂</button>
        </div>
      )}
    </section>
  );
}
