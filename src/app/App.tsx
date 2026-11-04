import { useEffect, useMemo, useRef, useState } from 'react';
import { GameProvider, useGame, type Content } from './game';
import { navigate, useRoute, type Route } from './router';
import { applySettings, focusMainHeading, prefersReducedMotion } from './a11y';
import { validateCurriculum, validateQuest, validateRequirements, validateWorld } from '../engine/quest-validation';
import type { Curriculum, IslandOverlay, Quest, World } from '../engine/types';
import { applyIslandOverlay, chooseIslandVariant } from './island-variant';
import { destinationStatus, destinationForQuest, questStatus } from '../engine/progression';
import { createProgressStore, questRecord } from '../engine/progress-store';
import { detectQuality, softwareRenderer, webglAvailable } from '../world/capabilities';
import type { CameraMode, DestinationView, WorldRenderer } from '../world/WorldRenderer';
import type { Pose } from '../world/characters';
import { WorldStage, type StageStatus } from '../ui/WorldStage';
import { TopBar } from '../ui/TopBar';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { HomeScreen } from '../ui/screens/HomeScreen';
import { StartScreen } from '../ui/screens/StartScreen';
import { MapScreen } from '../ui/screens/MapScreen';
import { QuestScreen } from '../ui/screens/QuestScreen';
import { CompleteScreen } from '../ui/screens/CompleteScreen';
import { ProgressScreen } from '../ui/screens/ProgressScreen';
import { ExploreScreen } from '../ui/screens/ExploreScreen';

export const FEEDBACK_URL =
  'https://github.com/denilthaks/CURIO/issues/new?title=CurioTrail%20feedback&body=What%20felt%20confusing%3F%0A%0AWhat%20did%20you%20learn%3F%0A%0AWould%20you%20try%20another%20quest%3F';

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
  return response.json() as Promise<T>;
}

async function loadContent(): Promise<Content> {
  let world = await fetchJson<World>('data/world.json');
  // Island variant: ?island=<name> when given; otherwise light-graphics devices get the island's light variant
  // (the streamed realistic island is too heavy for phones and CPU-only WebGL). Decided once per page load.
  const graphics = createProgressStore().load().settings.graphics;
  const device = detectQuality() === 'low' || softwareRenderer() ? 'low' : 'high';
  const variant = chooseIslandVariant(location.search, world, graphics, device);
  if (variant) world = applyIslandOverlay(world, await fetchJson<IslandOverlay>(`data/islands/${variant}.json`));
  const ids = world.destinations.flatMap((d) => d.quests);
  const quests = await Promise.all(ids.map((id) => fetchJson<Quest>(`data/quests/${id}.json`)));
  for (const q of quests) {
    const errors = validateQuest(q);
    if (errors.length) throw new Error(`Quest "${q.id}" is invalid: ${errors[0]}`);
  }
  const worldErrors = validateWorld(world, ids);
  if (worldErrors.length) throw new Error(`World data is invalid: ${worldErrors[0]}`);
  const requirementErrors = validateRequirements(quests);
  if (requirementErrors.length) throw new Error(requirementErrors[0]);
  const curriculum = await fetchJson<Curriculum>('data/curriculum.json');
  const curriculumErrors = validateCurriculum(curriculum, ids);
  if (curriculumErrors.length) throw new Error(`Curriculum data is invalid: ${curriculumErrors[0]}`);
  return { world, quests: new Map(quests.map((q) => [q.id, q])), curriculum };
}

export function App() {
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadContent().then(setContent).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  if (error) return <LoadError message={error} />;
  if (!content) {
    return (
      <main id="main" className="page narrow loading" aria-busy="true">
        <h1>Loading CurioTrail…</h1>
      </main>
    );
  }
  return (
    <GameProvider content={content}>
      <Game />
    </GameProvider>
  );
}

function LoadError({ message }: { message: string }) {
  const fileProtocol = location.protocol === 'file:';
  return (
    <main id="main" className="page narrow error-state">
      <h1>The trail is blocked</h1>
      <p>CurioTrail couldn’t load its quest data.</p>
      <p>{fileProtocol ? 'This page was opened directly from a file, which browsers block. Run a local server instead (see the README), or use the hosted version.' : 'Please check your connection and reload the page.'}</p>
      <p className="hint">Details: {message}</p>
      <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Reload</button>
    </main>
  );
}

function Game() {
  const game = useGame();
  const { progress, world, quests } = game;
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const rendererRef = useRef<WorldRenderer | null>(null);
  const [pose, setPose] = useState<{ character?: string; pose: Pose }>({ pose: 'idle' });
  const [stageStatus, setStageStatus] = useState<StageStatus>('starting');
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 899px)').matches);
  const webgl = useMemo(() => webglAvailable(), []);
  const autoQuality = useMemo(() => detectQuality(), []);

  useEffect(() => applySettings(progress.settings), [progress.settings]);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 899px)');
    const handle = () => setNarrow(mq.matches);
    mq.addEventListener('change', handle);
    return () => mq.removeEventListener('change', handle);
  }, []);

  const reducedMotion = prefersReducedMotion(progress.settings);
  const graphics = progress.settings.graphics;
  const enabled = webgl && graphics !== 'off';
  const quality = graphics === 'high' ? 'high' : graphics === 'low' ? 'low' : autoQuality;

  // Guard routes that need an identity or unlocked content.
  const guarded = guardRoute(route, game);
  useEffect(() => {
    if (guarded) navigate(guarded, { replace: true });
  }, [guarded]);

  // Move focus to the new screen's heading on navigation.
  const routeKey = JSON.stringify(route);
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false; // on first load, leave focus where the browser put it
      return undefined;
    }
    const id = window.setTimeout(() => focusMainHeading(mainRef.current), 30);
    window.scrollTo({ top: 0 });
    return () => window.clearTimeout(id);
  }, [routeKey]);

  const destinations: DestinationView[] = useMemo(() => world.destinations.map((d) => ({
    id: d.id, name: d.name, position: d.position, status: destinationStatus(d, quests, progress),
  })), [world, quests, progress]);

  const mode: CameraMode = useMemo(() => {
    if (route.name === 'explore') return { kind: 'explore', view: 'third' };
    if (route.name === 'map') return { kind: 'map', selected: route.id, panel: narrow ? 'bottom' : 'right' };
    if (route.name === 'quest') {
      const dest = destinationForQuest(world, route.id);
      return dest ? { kind: 'focus', destination: dest.id, character: pose.character, pose: pose.pose, panel: narrow ? 'bottom' : 'right' } : { kind: 'overview' };
    }
    if (route.name === 'complete') {
      const dest = destinationForQuest(world, route.id);
      const quest = quests.get(route.id);
      const character = quest ? Object.keys(quest.characters)[0] : undefined;
      return dest ? { kind: 'celebrate', destination: dest.id, character } : { kind: 'overview' };
    }
    return { kind: 'overview', panel: route.name === 'home' && !narrow ? 'left' : undefined };
  }, [route, world, quests, pose, narrow]);

  const titles: Record<Route['name'], string> = { home: '', start: 'Choose your identity', map: 'The Unmapped World', quest: '', complete: 'Quest complete', progress: 'Progress & settings', explore: 'Explore the island' };
  const questTitle = route.name === 'quest' || route.name === 'complete' ? quests.get(route.id)?.title : '';
  useEffect(() => {
    const t = questTitle || titles[route.name];
    document.title = t ? `${t} · CurioTrail` : 'CurioTrail: Find your way through the digital world';
  });

  if (guarded) return null;

  let screen: React.ReactNode = null;
  switch (route.name) {
    case 'start': screen = <StartScreen />; break;
    case 'map': screen = <MapScreen selected={route.id} renderer={rendererRef} stageStatus={stageStatus} webgl={enabled} />; break;
    case 'quest': screen = <QuestScreen key={route.id} questId={route.id} onPose={setPose} />; break;
    case 'complete': screen = <CompleteScreen questId={route.id} feedbackUrl={FEEDBACK_URL} />; break;
    case 'explore': screen = <ExploreScreen renderer={rendererRef} stageStatus={stageStatus} webgl={enabled} />; break;
    case 'progress': screen = <ProgressScreen webgl={webgl} autoQuality={autoQuality} stageStatus={stageStatus} renderer={rendererRef} />; break;
    default: screen = <HomeScreen feedbackUrl={FEEDBACK_URL} />;
  }

  return (
    <div className={`app app--${route.name}`}>
      <a className="skip-link" href="#main" onClick={(e) => { e.preventDefault(); focusMainHeading(mainRef.current); }}>Skip to main content</a>
      <WorldStage
        enabled={enabled}
        quality={quality}
        reducedMotion={reducedMotion}
        mode={mode}
        destinations={destinations}
        interactive={route.name === 'map'}
        onSelect={(id) => navigate(`/map/${id}`)}
        onStatus={setStageStatus}
        rendererRef={rendererRef}
        island={world.island}
      />
      <TopBar route={route} />
      <main id="main" ref={mainRef} className="screen" tabIndex={-1}>
        <ErrorBoundary resetKey={routeKey}>{screen}</ErrorBoundary>
      </main>
      <div id="announcer" className="sr-only" aria-live="polite" aria-atomic="true" />
    </div>
  );
}

/** Returns a path to redirect to, or null when the route is allowed. */
function guardRoute(route: Route, game: ReturnType<typeof useGame>): string | null {
  const { progress, world, quests } = game;
  if (route.name === 'quest' || route.name === 'complete') {
    const quest = quests.get(route.id);
    if (!quest) return '/map';
    if (!progress.player) return '/start';
    const dest = destinationForQuest(world, quest.id);
    if (!dest) return '/map';
    if (route.name === 'complete' && !questRecord(progress, quest.id).completed) return `/quest/${quest.id}`;
    if (route.name === 'quest') {
      const status = destinationStatus(dest, quests, progress);
      if (status === 'locked' || status === 'planned') return `/map/${dest.id}`;
      // Order within the destination and quest prerequisites.
      if (questStatus(quest, dest, progress) === 'locked') return `/map/${dest.id}`;
    }
  }
  if (route.name === 'map' && route.id && !world.destinations.some((d) => d.id === route.id)) return '/map';
  if (route.name === 'explore') {
    if (!world.island?.nav) return '/map';
    if (!progress.player) return '/start';
  }
  return null;
}
