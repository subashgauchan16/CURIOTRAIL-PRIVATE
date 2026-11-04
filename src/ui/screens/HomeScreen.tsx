import { useGame } from '../../app/game';
import { destinationForQuest, questStatus } from '../../engine/progression';
import { restoreRun } from '../../engine/game-engine';
import { questRecord } from '../../engine/progress-store';
import { BrandMark, CopyrightNotice } from '../brand/BrandMark';

export function HomeScreen({ feedbackUrl }: { feedbackUrl: string }) {
  const { progress, quests, world, storageAvailable } = useGame();
  const first = quests.get('missing-signal')!;
  const firstDest = destinationForQuest(world, first.id)!;
  const record = questRecord(progress, first.id);

  // Resume whichever quest is in progress, if any.
  let resume: { id: string; title: string; step: number; total: number } | null = null;
  for (const quest of quests.values()) {
    const r = questRecord(progress, quest.id);
    if (r.run && !r.run.completed) {
      const run = restoreRun(quest, r.run);
      resume = { id: quest.id, title: quest.title, step: run.sceneIndex + 1, total: quest.scenes.length };
      break;
    }
  }
  const firstDone = record.completed;
  const startHref = !progress.player ? '#/start' : `#/quest/${first.id}`;
  const status = questStatus(first, firstDest, progress);

  return (
    <section className="home panel-left" aria-labelledby="hero-title">
      <div className="hero-card">
        <p className="eyebrow">A free learning adventure</p>
        <h1 id="hero-title" className="hero-title">Find your way through the digital world.</h1>
        <p className="lede">
          CurioTrail is a story-driven game where you become a Pathfinder on a Viking island, solving everyday problems with digital skills: checking AI answers, querying data, fixing code and building spreadsheets.
        </p>
        <div className="cta-row">
          {resume ? (
            <a className="btn btn-primary btn-lg" href={`#/quest/${resume.id}`}>Continue “{resume.title}” (step {resume.step} of {resume.total})</a>
          ) : firstDone ? (
            <>
              {world.island?.nav && <a className="btn btn-primary btn-lg" href="#/explore">Explore the island</a>}
              <a className={`btn ${world.island?.nav ? 'btn-ghost' : 'btn-primary'} btn-lg`} href="#/map">Open the map</a>
            </>
          ) : (
            <a className="btn btn-primary btn-lg" href={startHref}>Start Your First Quest</a>
          )}
          {progress.player && (resume || !firstDone) && world.island?.nav && <a className="btn btn-ghost btn-lg" href="#/explore">Explore the island</a>}
          {progress.player && (resume || !firstDone) && <a className="btn btn-ghost btn-lg" href="#/map">Open the map</a>}
        </div>
        <ul className="hero-facts">
          <li><span aria-hidden="true">🆓</span> Free, no account, no ads</li>
          <li><span aria-hidden="true">⏱️</span> Quests take 5–10 minutes</li>
          <li><span aria-hidden="true">💡</span> Mistakes unlock hints, never penalties</li>
        </ul>
        {status === 'in-progress' && !resume && <p className="hint">You have a quest in progress.</p>}
        <BrandMark className="brand-mark--end" />
      </div>

      <details className="about card-quiet">
        <summary>About this prototype</summary>
        <ul className="plain-list">
          <li>Six playable quests with theory cards: AI literacy, SQL, Python, Excel, business analytics and a hands-on data-modelling lab. They’re organised into a learning path of eight modules; modules without content yet are marked as planned.</li>
          <li>{storageAvailable ? 'Progress is saved only in this browser. Clearing browsing data erases it.' : 'Your browser is blocking storage, so progress will not be saved between visits.'}</li>
          <li>No personal data is collected. There are no streaks, timers or leaderboards.</li>
          <li>The island is “Viking Island – Minecraft” by cubical.xyz (CC-BY-4.0), optimised for the web. See the README for full credits.</li>
        </ul>
        <p><a href={feedbackUrl} target="_blank" rel="noopener">Share feedback on GitHub<span className="sr-only"> (opens in a new tab)</span></a></p>
        <CopyrightNotice />
      </details>
    </section>
  );
}
