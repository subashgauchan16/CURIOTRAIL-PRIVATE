import { useState } from 'react';
import { useGame } from '../../app/game';
import { navigate } from '../../app/router';
import { announce } from '../../app/a11y';
import { isGameQuest, levelFor, LEVELS, maxXp, restoreRun } from '../../engine/game-engine';
import { questRecord, totalStars, totalXp, withReplay, withSettings, type Settings } from '../../engine/progress-store';
import { destinationForQuest, moduleStatus, questStatus, type ModuleStatus } from '../../engine/progression';
import type { Quality } from '../../world/capabilities';
import type { WorldRenderer } from '../../world/WorldRenderer';
import type { StageStatus } from '../WorldStage';
import { StatusChip } from './MapScreen';
import { Stars } from '../Stars';
import { CopyrightNotice } from '../brand/BrandMark';
import { FieldNotes, Overview, PrivacyPanel, ProfileHeader } from '../profile/Profile';

interface Props {
  webgl: boolean;
  autoQuality: Quality;
  stageStatus: StageStatus;
  renderer: React.MutableRefObject<WorldRenderer | null>;
}

export function ProgressScreen({ webgl, autoQuality, stageStatus, renderer }: Props) {
  const { progress, quests, world, update, reset, storageAvailable, curriculum } = useGame();
  const [confirming, setConfirming] = useState(false);
  const [stats, setStats] = useState<ReturnType<WorldRenderer['stats']> | null>(null);
  const xp = totalXp(progress);
  const level = levelFor(xp);
  const max = [...quests.values()].reduce((s, q) => s + maxXp(q), 0);
  const ordered = [...quests.values()].sort((a, b) => a.number - b.number);
  const set = (change: Partial<Settings>) => update((p) => withSettings(p, change));

  const radio = <K extends keyof Settings>(key: K, value: Settings[K], label: string, hint?: string) => (
    <label className="option">
      <input type="radio" name={key} value={value} checked={progress.settings[key] === value} onChange={() => set({ [key]: value } as Partial<Settings>)} />
      <span className="option-text">{label}{hint && <span className="hint"> {hint}</span>}</span>
    </label>
  );

  return (
    <section className="progress-screen pf-page" aria-labelledby="progress-title">
      <ProfileHeader />
      <Overview />
      <FieldNotes />
      <PrivacyPanel />
      <div className="card-solid pf-atlas">
        <h2>Progress &amp; settings</h2>

        <dl className="stats">
          <div className="stat"><dt>Total XP</dt><dd>{xp} <span className="of">/ {max}</span></dd></div>
          <div className="stat"><dt>Level</dt><dd>{level.level} · {level.name}</dd></div>
          <div className="stat"><dt>Stars</dt><dd>{totalStars(progress)} <span className="of">/ {quests.size * 3}</span></dd></div>
          <div className="stat"><dt>Badges</dt><dd>{progress.achievements.length} <span className="of">/ {quests.size}</span></dd></div>
        </dl>
        <p className="hint">
          {level.next ? `${level.next.min - xp} XP until ${level.next.name}.` : 'You have reached the highest level.'} Levels: {LEVELS.map((l) => `${l.name} (${l.min})`).join(', ')}.
        </p>

        <h2>Learning path</h2>
        <p className="hint">Eight modules, from beginner to capstone. Modules marked “Planned” have no lessons yet: they show what’s coming, and nothing in them is playable.</p>
        <ol className="module-list">
          {curriculum.modules.map((m) => {
            const status = moduleStatus(m, world, quests, progress);
            const playable = m.quests.map((id) => quests.get(id)!).filter(Boolean);
            const lessons = playable.flatMap((q) => q.scenes.filter((sc) => sc.type === 'lesson').map((sc) => `${q.id}/${sc.id}`));
            const read = lessons.filter((k) => progress.lessons.includes(k)).length;
            return (
              <li key={m.id} className={`module module--${status}`}>
                <div className="module-head">
                  <span className="module-number" aria-hidden="true">{m.number}</span>
                  <div>
                    <h3>Module {m.number}: {m.title}</h3>
                    <p className="module-meta">{m.level} · {m.subject}</p>
                  </div>
                  <ModuleChip status={status} />
                </div>
                <p>{m.summary}</p>
                {playable.length > 0 && (
                  <>
                    <ul className="module-quests">
                      {playable.map((q) => {
                        const dest = destinationForQuest(world, q.id)!;
                        const st = questStatus(q, dest, progress);
                        return <li key={q.id}><StatusChip status={st} /> {q.title} <span className="hint">({q.subject})</span></li>;
                      })}
                    </ul>
                    <p className="hint">Lessons read: {read} of {lessons.length}</p>
                  </>
                )}
                {m.planned.length > 0 && (
                  <p className="module-planned"><span aria-hidden="true">✦</span> <strong>Planned{playable.length ? ' next' : ''}:</strong> {m.planned.join(' · ')}</p>
                )}
              </li>
            );
          })}
        </ol>

        <h2>Quests</h2>
        <div className="table-scroll" tabIndex={0} role="region" aria-label="Quest progress">
          <table className="progress-table">
            <thead>
              <tr><th scope="col">Quest</th><th scope="col">Status</th><th scope="col">Best XP</th><th scope="col">Rating</th><th scope="col">Times finished</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {ordered.map((q) => {
                const dest = destinationForQuest(world, q.id)!;
                const status = questStatus(q, dest, progress);
                const record = questRecord(progress, q.id);
                const run = record.run && !record.run.completed ? restoreRun(q, record.run) : null;
                return (
                  <tr key={q.id}>
                    <th scope="row"><span className="q-num">{String(q.number).padStart(2, '0')}</span> {q.title}<span className="q-sub">{q.subject} · {dest.name}</span></th>
                    <td><StatusChip status={status} />{run && <span className="q-sub">Step {run.sceneIndex + 1} of {q.scenes.length}</span>}</td>
                    <td>{record.bestXp} / {maxXp(q)}</td>
                    <td>{isGameQuest(q) ? <span className="q-medal">{{ gold: '🥇 Gold', silver: '🥈 Silver', bronze: '🥉 Bronze', none: record.completed ? 'No medal yet' : '—' }[record.bestMedal]}</span> : <Stars count={record.bestStars} />}</td>
                    <td>{record.completions}</td>
                    <td className="actions-cell">
                      {status === 'in-progress' && <a className="btn btn-sm btn-primary" href={`#/quest/${q.id}`}>Continue</a>}
                      {status === 'available' && <a className="btn btn-sm btn-primary" href={`#/quest/${q.id}`}>Start</a>}
                      {record.completed && (
                        <button type="button" className="btn btn-sm btn-ghost" onClick={() => { update((p) => withReplay(p, q.id)); navigate(`/quest/${q.id}`); }}>Replay<span className="sr-only"> {q.title}</span></button>
                      )}
                      {status === 'locked' && <span className="hint">Locked</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h2>Settings</h2>
        <div className="settings-grid">
          <fieldset className="field">
            <legend>Text size</legend>
            <div className="options options--compact">
              {radio('textSize', 'normal', 'Standard')}
              {radio('textSize', 'large', 'Larger text')}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Motion</legend>
            <div className="options options--compact">
              {radio('motion', 'system', 'Follow my device setting')}
              {radio('motion', 'reduce', 'Reduce motion', '(camera jumps, no animation)')}
              {radio('motion', 'full', 'Allow motion')}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>3D graphics</legend>
            <div className="options options--compact">
              {radio('graphics', 'auto', 'Automatic', `(this device: ${autoQuality === 'high' ? 'high detail' : 'light'})`)}
              {radio('graphics', 'high', 'High detail', '(about 1 million triangles)')}
              {radio('graphics', 'low', 'Light', '(faster, for phones and older computers)')}
              {radio('graphics', 'off', 'Off', '(2D map; every quest still works)')}
            </div>
            {!webgl && <p className="hint">This browser can’t show 3D graphics, so the 2D map is used.</p>}
          </fieldset>
        </div>

        <details className="perf">
          <summary>Graphics diagnostics</summary>
          <p className="hint">3D status: {stageStatus}.</p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setStats(renderer.current?.stats() ?? null)}>Measure now</button>
          {stats && (
            <ul className="plain-list">
              <li>Frames per second: {stats.fps}</li>
              <li>Draw calls: {stats.drawCalls} · Triangles drawn: {stats.triangles.toLocaleString()}</li>
              <li>Island detail level: {stats.lod} · Pixel ratio: {stats.pixelRatio}</li>
              <li>GPU geometries: {stats.geometries} · Textures: {stats.textures}</li>
            </ul>
          )}
          {!stats && renderer.current === null && <p className="hint">The 3D view is not running.</p>}
        </details>

        <h2>Your saved progress</h2>
        <p>{storageAvailable ? 'Progress is saved only in this browser. Clearing your browsing data also erases it.' : 'This browser is blocking storage, so progress won’t be kept after you leave.'}</p>
        <div className="reset-area">
          {!confirming ? (
            <button type="button" className="btn btn-danger-ghost" onClick={() => setConfirming(true)}>Reset all progress</button>
          ) : (
            <div className="confirm" role="group" aria-labelledby="confirm-text">
              <p id="confirm-text"><strong>Erase everything?</strong> Your identity, XP, stars, medals, badges, learning history, drafts and quest progress on this device will be deleted. This can’t be undone.</p>
              <div className="cta-row">
                <button type="button" className="btn btn-danger" onClick={() => { reset(); announce('All progress has been reset.'); navigate('/'); }}>Yes, reset everything</button>
                <button type="button" className="btn btn-ghost" autoFocus onClick={() => setConfirming(false)}>Keep my progress</button>
              </div>
            </div>
          )}
        </div>
        <CopyrightNotice />
      </div>
    </section>
  );
}

const MODULE_LABEL: Record<ModuleStatus, { icon: string; text: string }> = {
  planned: { icon: '✦', text: 'Planned' },
  locked: { icon: '🔒', text: 'Locked' },
  available: { icon: '●', text: 'Available' },
  'in-progress': { icon: '◐', text: 'In progress' },
  completed: { icon: '✓', text: 'Completed' },
};

function ModuleChip({ status }: { status: ModuleStatus }) {
  return <span className={`status status--${status}`}><span aria-hidden="true">{MODULE_LABEL[status].icon}</span> {MODULE_LABEL[status].text}</span>;
}
