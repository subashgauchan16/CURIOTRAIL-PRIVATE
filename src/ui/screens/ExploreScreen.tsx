import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGame } from '../../app/game';
import { navigate } from '../../app/router';
import { announce, focusElement } from '../../app/a11y';
import { loadExplore, type ExploreContent, type ExploreNpc, type ExploreObject } from '../../app/explore-content';
import { destinationStatus, nextQuestAt, unlockRequirement } from '../../engine/progression';
import { fromBlender, type NavData, type Targeting } from '../../world/explore';
import type { WorldRenderer } from '../../world/WorldRenderer';
import type { ExploreView } from '../../world/explore-runtime';
import type { StageStatus } from '../WorldStage';
import { StatusChip } from './MapScreen';

/** Where the Pathfinder was, so leaving for a quest and coming back resumes on the same spot (this tab only). */
export const PLAYER_KEY = 'curiotrail.explore.player';
/** One saved spot per walk grid, so a position on one island never lands the player in another island's sea. Island B keeps the original key. */
export function playerKey(nav?: string) { return !nav || nav === 'nav-island-b.json' ? PLAYER_KEY : `${PLAYER_KEY}:${nav}`; }
const CONTROLS_KEY = 'curiotrail.explore.controls-seen';

type Panel =
  | { kind: 'dialogue'; npc: ExploreNpc; line: number }
  | { kind: 'inspect'; object: ExploreObject }
  | { kind: 'map' }
  | { kind: 'controls' }
  | null;

interface Props {
  renderer: React.MutableRefObject<WorldRenderer | null>;
  stageStatus: StageStatus;
  webgl: boolean;
}

function readSaved(key: string): { x: number; z: number; heading: number } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    return v && Number.isFinite(v.x) && Number.isFinite(v.z) ? v : null;
  } catch { return null; }
}

function store(key: string, value: string | null, area: Storage | null = null) {
  try {
    const s = area ?? sessionStorage;
    if (value === null) s.removeItem(key); else s.setItem(key, value);
  } catch { /* storage blocked: exploration still works, it just won't remember */ }
}

export function ExploreScreen({ renderer, stageStatus, webgl }: Props) {
  const { world, quests, progress } = useGame();
  const [data, setData] = useState<{ content: ExploreContent; nav: NavData } | null>(null);
  const [ready, setReady] = useState(false);
  const [target, setTarget] = useState<Targeting>({ target: null, nearby: null, distance: Infinity });
  const [panel, setPanel] = useState<Panel>(() => {
    try { return localStorage.getItem(CONTROLS_KEY) ? null : { kind: 'controls' }; } catch { return null; }
  });
  const [view, setView] = useState<ExploreView>('third');
  const [message, setMessage] = useState('');
  const [zone, setZone] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const messageTimer = useRef(0);
  const failed = !webgl || stageStatus === 'error' || stageStatus === 'fallback';

  const say = useCallback((text: string) => {
    setMessage(text);
    announce(text);
    window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(''), 3200);
  }, []);

  useEffect(() => {
    if (!world.island?.nav) return;
    loadExplore(world.island.nav, world.island.placements).then(setData).catch(() => say('The island’s paths could not be loaded. Use the map instead.'));
  }, [world.island?.nav, say]);

  // Wait for the 3D world, the Pathfinder and the walk grid, then place the player.
  useEffect(() => {
    if (failed || !data) return undefined;
    let cancelled = false;
    const id = window.setInterval(() => {
      const r = renderer.current;
      if (!r || !r.explore.ready || cancelled) return;
      window.clearInterval(id);
      const saved = readSaved(playerKey(world.island?.nav));
      if (saved) r.explore.place(saved.x, saved.z, saved.heading);
      else {
        const s = fromBlender(data.nav.spawn.x, data.nav.spawn.y);
        r.explore.place(s.x, s.z, Math.PI);
        r.explore.yaw = Math.PI;
      }
      r.explore.onTarget = setTarget;
      r.explore.enter(view);
      setReady(true);
    }, 100);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      const r = renderer.current;
      if (r?.explore.state) {
        const { x, z, heading } = r.explore.state;
        store(playerKey(world.island?.nav), JSON.stringify({ x, z, heading }));
      }
      if (r) r.explore.onTarget = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed, data, renderer]);

  // Movement keys are ignored while a panel is open.
  useEffect(() => {
    const r = renderer.current;
    if (r) r.explore.inputEnabled = panel === null || panel.kind === 'controls';
  }, [panel, renderer, ready]);

  // Location name: the nearest island zone.
  useEffect(() => {
    if (!ready || !data?.nav.zones) return undefined;
    const id = window.setInterval(() => {
      const s = renderer.current?.explore.state;
      if (!s) return;
      let best = '';
      let bestD = Infinity;
      for (const z of Object.values(data.nav.zones!)) {
        const p = fromBlender(z.x, z.y);
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d < bestD) { bestD = d; best = z.name; }
      }
      setZone((prev) => (prev === best ? prev : best));
    }, 500);
    return () => window.clearInterval(id);
  }, [ready, data, renderer]);

  useEffect(() => {
    if (panel && panel.kind !== 'controls') {
      const id = window.setTimeout(() => focusElement(panelRef.current?.querySelector('button')), 30);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [panel]);

  const objective = useMemo(() => {
    for (const d of world.destinations) {
      const status = destinationStatus(d, quests, progress);
      if (status === 'available' || status === 'in-progress') {
        const q = nextQuestAt(d, quests, progress);
        if (q) return { place: d.name, text: `Find ${d.name}: “${q.title}”` };
      }
    }
    return { place: 'The Viking Island', text: 'Explore the island and talk to the villagers.' };
  }, [world, quests, progress]);

  const toggleView = useCallback(() => {
    const next = view === 'third' ? 'first' : 'third';
    setView(next);
    renderer.current?.explore.setView(next);
    say(next === 'first' ? 'First-person view' : 'Third-person view');
  }, [view, renderer, say]);

  const closePanel = useCallback(() => {
    if (panel?.kind === 'controls') store(CONTROLS_KEY, '1', localStorage);
    setPanel(null);
  }, [panel]);

  const travel = useCallback((x: number, z: number, name: string) => {
    renderer.current?.explore.place(x + 1.5, z + 1.5);
    setPanel(null);
    say(`You travel to ${name}.`);
  }, [renderer, say]);

  const interact = useCallback(() => {
    const t = target.target;
    if (!t) {
      say(target.nearby ? `Move closer to ${target.nearby.name}.` : 'There is nothing to interact with here.');
      return;
    }
    if (t.kind === 'npc') {
      const npc = data?.content.npcs.find((n) => n.id === t.id);
      if (npc) { setPanel({ kind: 'dialogue', npc, line: 0 }); renderer.current?.explore.npcs.get(npc.id)?.model.gesture('Talk'); }
      return;
    }
    if (t.kind === 'object') {
      const object = data?.content.objects.find((o) => o.id === t.id);
      if (object) { setPanel({ kind: 'inspect', object }); renderer.current?.explore.player?.gesture('Interact'); }
      return;
    }
    const dest = world.destinations.find((d) => d.id === t.id);
    if (!dest) return;
    const status = destinationStatus(dest, quests, progress);
    if (status === 'planned') { say(`${dest.name} is planned. It isn’t playable yet.`); return; }
    if (status === 'locked') { say(`${dest.name} is locked. ${unlockRequirement(dest, quests, progress)}`); return; }
    const quest = nextQuestAt(dest, quests, progress);
    if (!quest) { say(`You’ve completed every quest at ${dest.name}. Replay them from the map.`); return; }
    const s = renderer.current?.explore.state;
    if (s) store(playerKey(world.island?.nav), JSON.stringify({ x: s.x, z: s.z, heading: s.heading }));
    navigate(`/quest/${quest.id}`);
  }, [target, data, world, quests, progress, renderer, say]);

  // E/F interact, V camera, M map, Escape closes. Enter/Space on buttons work natively.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key === 'escape' && panel) { e.preventDefault(); closePanel(); return; }
      if (panel && panel.kind !== 'controls') return;
      if (key === 'e' || key === 'f') { e.preventDefault(); interact(); }
      else if (key === 'v') { e.preventDefault(); toggleView(); }
      else if (key === 'm') { e.preventDefault(); setPanel({ kind: 'map' }); }
      else if (key === 'h' || key === '?') { e.preventDefault(); setPanel(panel?.kind === 'controls' ? null : { kind: 'controls' }); }
      else if (key === '[' || key === ']') { e.preventDefault(); renderer.current?.explore.rotate(key === '[' ? 0.25 : -0.25, 0); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panel, interact, toggleView, closePanel, renderer]);

  if (failed) {
    return (
      <section className="explore-fallback" aria-labelledby="explore-title">
        <h1 id="explore-title">Explore the island</h1>
        <p>Walking around the island needs 3D graphics, which aren’t available here. Every quest still works from the map.</p>
        <a className="btn btn-primary" href="#/map">Open the map</a>
      </section>
    );
  }

  const verb = target.target?.kind === 'npc' ? 'Talk to' : target.target?.kind === 'object' ? 'Inspect' : 'Enter';
  const destStatus = target.target?.kind === 'destination'
    ? destinationStatus(world.destinations.find((d) => d.id === target.target!.id)!, quests, progress) : null;

  return (
    <section className="explore" aria-labelledby="explore-title">
      <header className="explore-hud-top">
        <p className="explore-location">{zone || 'The Viking Island'}</p>
        <p className="eyebrow">Objective</p>
        <h1 id="explore-title" className="explore-objective">{objective.text}</h1>
      </header>

      <div className="explore-actions" role="toolbar" aria-label="Exploration">
        <button type="button" className="btn btn-sm" onClick={toggleView} aria-pressed={view === 'first'}>
          <kbd>V</kbd> {view === 'third' ? 'First person' : 'Third person'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setPanel({ kind: 'map' })}><kbd>M</kbd> Map</button>
        <button type="button" className="btn btn-sm" onClick={() => setPanel({ kind: 'controls' })}><kbd>H</kbd> Controls</button>
      </div>

      {!ready && <p className="explore-loading" role="status">Getting the Pathfinder ready…</p>}

      {ready && !panel && (target.target || target.nearby) && (
        <div className="explore-prompt">
          {target.target ? (
            <button type="button" className="explore-prompt-button" onClick={interact}>
              <kbd>E</kbd> {verb} {target.target.name}
              {destStatus && destStatus !== 'available' && destStatus !== 'in-progress' && <StatusChip status={destStatus} />}
            </button>
          ) : (
            <p className="explore-prompt-far">{target.nearby!.name} · move closer ({Math.round(target.distance)} m)</p>
          )}
        </div>
      )}

      <p className={`explore-message${message ? ' is-visible' : ''}`} role="status" aria-live="polite">{message}</p>

      {panel?.kind === 'dialogue' && (
        <div className="explore-panel explore-dialogue" ref={panelRef} role="dialog" aria-label={`Conversation with ${panel.npc.name}`}>
          <p className="explore-speaker">{panel.npc.name} <span>· {panel.npc.role}</span></p>
          <p className="explore-line">“{panel.npc.lines[panel.line]}”</p>
          <div className="explore-buttons">
            {panel.line < panel.npc.lines.length - 1 ? (
              <button type="button" className="btn btn-primary" onClick={() => { setPanel({ ...panel, line: panel.line + 1 }); renderer.current?.explore.npcs.get(panel.npc.id)?.model.gesture('Talk'); }}>Continue →</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={closePanel}>Done</button>
            )}
            <button type="button" className="btn btn-ghost" onClick={closePanel}>Leave conversation</button>
          </div>
        </div>
      )}

      {panel?.kind === 'inspect' && (
        <div className="explore-panel" ref={panelRef} role="dialog" aria-label={panel.object.name}>
          <h2 className="explore-panel-title">{panel.object.name}</h2>
          <p>{panel.object.text}</p>
          <button type="button" className="btn btn-primary" onClick={closePanel}>Return to exploration</button>
        </div>
      )}

      {panel?.kind === 'map' && (
        <div className="explore-panel explore-map" ref={panelRef} role="dialog" aria-label="Island map">
          <h2 className="explore-panel-title">The Viking Island</h2>
          <ul className="explore-map-list">
            {world.destinations.map((d) => (
              <li key={d.id}>
                <span>{d.name}</span> <StatusChip status={destinationStatus(d, quests, progress)} />
                <button type="button" className="btn btn-sm" onClick={() => travel(d.position[0], d.position[1], d.name)}>Travel here<span className="sr-only"> to {d.name}</span></button>
              </li>
            ))}
          </ul>
          <div className="explore-buttons">
            <button type="button" className="btn btn-ghost" onClick={closePanel}>Close map</button>
            <a className="btn btn-ghost" href="#/map">Open the full map</a>
          </div>
        </div>
      )}

      {panel?.kind === 'controls' && (
        <div className="explore-panel explore-controls" ref={panelRef} role="dialog" aria-label="Exploration controls">
          <h2 className="explore-panel-title">Exploration controls</h2>
          <ul>
            <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrow keys: walk</li>
            <li><kbd>Shift</kbd>: run</li>
            <li>Drag with the mouse, or <kbd>[</kbd> <kbd>]</kbd>: turn the camera</li>
            <li><kbd>E</kbd> or <kbd>F</kbd>: talk, inspect or enter</li>
            <li><kbd>V</kbd>: first or third person</li>
            <li><kbd>M</kbd>: map and travel</li>
            <li><kbd>Esc</kbd>: close a panel</li>
          </ul>
          <button type="button" className="btn btn-primary" onClick={closePanel}>Start exploring</button>
        </div>
      )}
    </section>
  );
}
