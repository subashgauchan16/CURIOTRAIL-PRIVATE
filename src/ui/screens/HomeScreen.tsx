import { useGame } from '../../app/game';
import { levelFor } from '../../engine/game-engine';
import { destinationForQuest, isQuestCompleted, questStatus } from '../../engine/progression';
import { restoreRun } from '../../engine/game-engine';
import { questRecord, totalXp } from '../../engine/progress-store';
import { BrandMark, CopyrightNotice } from '../brand/BrandMark';

// Arrival screen. The island stays visible edge to edge; the text sits in an open
// left column over a scrim, with the first quest's own opening line as the voice
// from the shore and a status line along the bottom (see the UI audit, screen 1).
export function HomeScreen({ feedbackUrl }: { feedbackUrl: string }) {
  const { progress, quests, world, storageAvailable } = useGame();
  const first = quests.get('missing-signal')!;
  const firstDest = destinationForQuest(world, first.id)!;
  const record = questRecord(progress, first.id);
  const canExplore = Boolean(world.island?.nav);

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

  // The voice from the shore is the first quest's real opening line, not new copy.
  const opening = first.scenes[0];
  const voice = opening?.type === 'dialogue' && opening.lines?.[0] ? { speaker: first.characters[opening.speaker ?? '']?.name ?? 'Mira', line: opening.lines[0] } : null;

  const done = [...quests.values()].filter((q) => isQuestCompleted(progress, q.id)).length;
  const level = levelFor(totalXp(progress));
  const statusLine = !progress.player
    ? 'Arrival · The Atlas awaits its first piece of practical knowledge'
    : done === 0
      ? `${progress.player.name} · Level ${level.level} · ${level.name} · The Atlas awaits its first entry`
      : `${progress.player.name} · Level ${level.level} · ${level.name} · ${done} of ${quests.size} quests complete`;

  const explore = canExplore ? { href: '#/explore', label: 'Explore the island' } : { href: '#/map', label: 'Open the map' };
  let primary: { href: string; label: string };
  let secondary: { href: string; label: string };
  if (resume) {
    primary = { href: `#/quest/${resume.id}`, label: `Continue “${resume.title}”` };
    secondary = explore;
  } else if (firstDone) {
    primary = explore;
    secondary = { href: '#/map', label: 'Open the map' };
  } else {
    primary = { href: startHref, label: 'Start Your First Quest' };
    secondary = progress.player ? explore : { href: '#/map', label: 'Look at the island' };
  }

  return (
    <section className="home arrival" aria-labelledby="hero-title">
      <div className="arrival-column panel-left">
        <p className="eyebrow">The living Viking island</p>
        <h1 id="hero-title" className="hero-title">Find your way through the digital world.</h1>
        <p className="lede">
          CurioTrail is a story-driven game where you become a Pathfinder on a Viking island, solving everyday problems with digital skills: checking AI answers, querying data, fixing code and building spreadsheets.
        </p>
        <div className="cta-row">
          <a className="btn btn-primary btn-lg" href={primary.href}>{primary.label}<span aria-hidden="true"> →</span></a>
          <a className="btn btn-ghost btn-lg" href={secondary.href}>{secondary.label}</a>
        </div>
        <p className="arrival-note">
          {resume
            ? `Step ${resume.step} of ${resume.total}. Your progress is kept on this device.`
            : firstDone
              ? 'The Market is open. Errands and the next quests wait on the island.'
              : progress.player
                ? `Next: “${first.title}” at ${firstDest.name}. No forced map.`
                : 'Next: what should Mira call you? An optional nickname and an emblem, then the first quest begins. No forced map.'}
        </p>
        {status === 'in-progress' && !resume && <p className="hint">You have a quest in progress.</p>}
      </div>

      {voice && (
        <aside className="arrival-voice" aria-label={`A line from ${voice.speaker}`}>
          <p className="eyebrow">A voice from the noticeboard</p>
          <blockquote className="arrival-quote">“{voice.line}”</blockquote>
        </aside>
      )}

      <footer className="arrival-footer">
        <p className="arrival-status">{statusLine}</p>
        <ul className="hero-facts">
          <li>Free, no account, no ads</li>
          <li>Quests take 5–10 minutes</li>
          <li>Mistakes unlock hints, never penalties</li>
        </ul>
        <details className="about arrival-about">
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
        <BrandMark className="arrival-brand" />
      </footer>
    </section>
  );
}
