import { useEffect, useRef, useState } from 'react';
import type { CameraMode, DestinationView, LoadState, Quality, WorldRenderer as Renderer } from '../world/WorldRenderer';
import type { IslandConfig } from '../engine/types';
import { interactables, loadExplore } from '../app/explore-content';
import { NavGrid, fromBlender } from '../world/explore';

export type StageStatus = 'starting' | 'loading' | 'refining' | 'ready' | 'error' | 'fallback';

interface Props {
  enabled: boolean; // false when graphics are switched off or WebGL is unavailable
  quality: Quality;
  reducedMotion: boolean;
  mode: CameraMode;
  destinations: DestinationView[];
  onSelect?: (id: string) => void;
  onStatus?: (status: StageStatus, detail?: string) => void;
  rendererRef?: React.MutableRefObject<Renderer | null>;
  interactive: boolean; // whether labels are clickable (map screen)
  island?: IslandConfig; // defaults to the original island
}

const STATUS_TEXT: Record<DestinationView['status'], string> = {
  available: 'Available',
  'in-progress': 'In progress',
  completed: 'Completed',
  locked: 'Locked',
  planned: 'Planned',
};
const STATUS_ICON: Record<DestinationView['status'], string> = {
  available: '●',
  'in-progress': '◐',
  completed: '✓',
  locked: '🔒',
  planned: '✦',
};

export function WorldStage({ enabled, quality, reducedMotion, mode, destinations, onSelect, onStatus, rendererRef, interactive, island }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<Renderer | null>(null);
  const labels = useRef(new Map<string, HTMLElement>());
  const [load, setLoad] = useState<LoadState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  // The renderer is created asynchronously, so it must start from the latest
  // mode and destinations, not the values captured when loading began.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const destinationsRef = useRef(destinations);
  destinationsRef.current = destinations;

  // Create / dispose the renderer. Three.js is loaded on demand so the
  // learning content never waits for (or depends on) the 3D engine.
  useEffect(() => {
    if (!enabled || !canvasRef.current) {
      onStatusRef.current?.('fallback');
      return undefined;
    }
    let cancelled = false;
    let instance: Renderer | null = null;
    setFailed(null);
    onStatusRef.current?.('starting');
    import('../world/WorldRenderer')
      .then(({ WorldRenderer }) => {
        if (cancelled || !canvasRef.current) return;
        instance = new WorldRenderer(canvasRef.current, {
          quality,
          reducedMotion,
          modelBase: './models/',
          islandFiles: island?.files,
          scale: island?.scale,
          streamed: island?.streamed,
          characterScale: island?.characterScale,
          onSelect: (id) => onSelectRef.current?.(id),
          onLoad: (state) => {
            setLoad(state);
            if (state.phase !== 'loading' && state.phase !== 'error') performance.mark(`curio-island-${state.lod}`);
            onStatusRef.current?.(state.phase === 'loading' ? 'loading' : state.phase, state.error);
            if (state.phase === 'error') setFailed(state.error ?? 'The island could not be shown.');
          },
        });
        renderer.current = instance;
        if (rendererRef) rendererRef.current = instance;
        (window as unknown as { __curioWorld?: Renderer }).__curioWorld = instance;
        for (const [id, el] of labels.current) instance.setLabel(id, el);
        instance.setDestinations(destinationsRef.current);
        instance.setMode(modeRef.current);
        const created = instance;
        void instance.loadIsland().then(() => {
          // Islands with a walk grid get free exploration and persistent rigged NPCs.
          if (!island?.nav || cancelled) return undefined;
          return loadExplore(island.nav, island.placements).then(({ content, nav }) => {
            if (cancelled) return undefined;
            created.explore.setNav(new NavGrid(nav));
            created.explore.setInteractables(interactables(content, destinationsRef.current));
            return created.explore.load(content.player.model, content.npcs.map((n) => {
              const p = fromBlender(n.at[0], n.at[1]);
              return { id: n.id, model: n.model, x: p.x, z: p.z, rot: n.rot };
            }));
          });
        }).catch((error: unknown) => console.warn('Exploration could not start:', error));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : 'The 3D engine could not start.';
        setFailed(message);
        onStatusRef.current?.('error', message);
      });
    return () => {
      cancelled = true;
      instance?.dispose();
      renderer.current = null;
      if (rendererRef) rendererRef.current = null;
    };
    // Recreate only when the graphics configuration changes or on retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, quality, attempt]);

  useEffect(() => { renderer.current?.setDestinations(destinations); }, [destinations]);
  useEffect(() => { renderer.current?.setMode(mode); }, [mode]);
  useEffect(() => { renderer.current?.setReducedMotion(reducedMotion); }, [reducedMotion]);

  const showFallback = !enabled || Boolean(failed);
  const busy = enabled && !failed && (!load || load.phase === 'loading');

  return (
    <div className={`stage${showFallback ? ' stage--fallback' : ''}`} data-mode={mode.kind}>
      {enabled && !failed && (
        <canvas ref={canvasRef} className="stage-canvas" aria-label="3D view of the Viking island. Use the destination list for an accessible alternative." role="img" />
      )}
      {enabled && !failed && (
        <div className="stage-labels" aria-hidden={!interactive}>
          {destinations.map((d) => (
            <button
              key={d.id}
              type="button"
              tabIndex={interactive ? 0 : -1}
              className={`world-label world-label--${d.status}${mode.kind === 'map' && mode.selected === d.id ? ' is-selected' : ''}`}
              ref={(el) => {
                if (el) labels.current.set(d.id, el); else labels.current.delete(d.id);
                renderer.current?.setLabel(d.id, el);
              }}
              onClick={() => interactive && onSelect?.(d.id)}
              style={{ visibility: 'hidden' }}
            >
              <span className="world-label-name">{d.name}</span>
              <span className="world-label-status"><span aria-hidden="true">{STATUS_ICON[d.status]}</span> {STATUS_TEXT[d.status]}</span>
            </button>
          ))}
        </div>
      )}
      {showFallback && <FallbackMap destinations={destinations} interactive={interactive} onSelect={onSelect} selected={mode.kind === 'map' ? mode.selected ?? null : null} span={560 * (island?.scale ?? 1)} />}
      {busy && (
        <div className="stage-loading" role="status">
          <span className="spinner" aria-hidden="true" />
          Loading the island{load && load.progress > 0 ? ` (${Math.round(load.progress * 100)}%)` : '…'}
        </div>
      )}
      {enabled && !failed && load?.phase === 'refining' && (
        <div className="stage-refining" role="status">Adding detail… {Math.round(load.progress * 100)}%</div>
      )}
      {failed && enabled && (
        <div className="stage-error" role="alert">
          <p><strong>The 3D island couldn’t be shown.</strong> Every quest still works from the map list.</p>
          <p className="hint">{failed}</p>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => { setLoad(null); setAttempt((n) => n + 1); }}>Try again</button>
        </div>
      )}
    </div>
  );
}

/** Readable 2D map used when WebGL is unavailable, switched off or failed. */
function FallbackMap({ destinations, interactive, onSelect, selected, span }: { destinations: DestinationView[]; interactive: boolean; onSelect?: (id: string) => void; selected: string | null; span: number }) {
  // `span` is the island's width in world units (about 560 on the original island, 140 on island B).
  const toPct = (v: number) => 50 + (v / span) * 100;
  return (
    <div className="fallback-map">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="fallback-art">
        <defs>
          <radialGradient id="sea" cx="50%" cy="50%" r="70%">
            <stop offset="0" stopColor="#2bc4c9" />
            <stop offset="1" stopColor="#0b5f8a" />
          </radialGradient>
        </defs>
        <rect width="100" height="100" fill="url(#sea)" />
        <path d="M30 28 C38 18 60 20 68 30 C78 36 80 52 74 62 C70 74 58 86 48 84 C38 82 26 74 24 62 C20 50 22 36 30 28Z" fill="#e9d6a1" />
        <path d="M33 31 C40 23 58 24 65 32 C73 38 75 52 70 61 C66 71 56 80 48 79 C39 77 30 70 28 60 C25 50 27 38 33 31Z" fill="#4c9a4a" />
        <path d="M42 40 L52 30 L62 46 Z" fill="#8c8c8c" />
      </svg>
      <ul className="fallback-markers" aria-label={interactive ? undefined : 'Destinations'}>
        {destinations.map((d) => (
          <li key={d.id} style={{ left: `${toPct(d.position[0])}%`, top: `${toPct(d.position[1])}%` }}>
            <button
              type="button"
              className={`world-label world-label--${d.status}${selected === d.id ? ' is-selected' : ''}`}
              tabIndex={interactive ? 0 : -1}
              onClick={() => interactive && onSelect?.(d.id)}
            >
              <span className="world-label-name">{d.name}</span>
              <span className="world-label-status"><span aria-hidden="true">{STATUS_ICON[d.status]}</span> {STATUS_TEXT[d.status]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
