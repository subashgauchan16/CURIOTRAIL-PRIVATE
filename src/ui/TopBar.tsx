import { useEffect, useRef } from 'react';
import { useGame } from '../app/game';
import type { Route } from '../app/router';
import { levelFor } from '../engine/game-engine';
import { totalStars, totalXp } from '../engine/progress-store';
import { EMBLEM_INFO } from './emblems';

export function TopBar({ route }: { route: Route }) {
  const { progress, quests } = useGame();
  const xp = totalXp(progress);
  const level = levelFor(xp);
  const stars = totalStars(progress);
  const maxStars = quests.size * 3;
  const span = level.next ? level.next.min - level.min : 1;
  const into = level.next ? xp - level.min : 1;
  const player = progress.player;
  const current = (name: Route['name']) => (route.name === name ? 'page' : undefined);
  // Pinned panels (the quest HUD on phones) sit just below the bar, whatever its height.
  const bar = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = bar.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const set = () => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header className="topbar" ref={bar}>
      <div className="topbar-inner">
        <a className="brand" href="#/" aria-label="CurioTrail home">
          <img src="./favicon.svg" alt="" width="32" height="32" />
          <span>CurioTrail</span>
        </a>
        <nav className="topnav" aria-label="Main">
          <a href="#/explore" aria-current={current('explore')}><span aria-hidden="true">🧭</span> Explore</a>
          <a href="#/map" aria-current={current('map')}><span aria-hidden="true">🗺️</span> Map</a>
          <a href="#/progress" aria-current={current('progress')}><span aria-hidden="true">⚙️</span> Progress<span className="hide-narrow">&nbsp;&amp; settings</span></a>
        </nav>
        {player && (
          <div className="hud" aria-label="Your progress">
            <span className="hud-emblem" aria-hidden="true">{EMBLEM_INFO[player.emblem].symbol}</span>
            <span className="hud-text">
              <span className="hud-name">{player.name}</span>
              <span className="hud-level">Level {level.level} · {level.name}</span>
            </span>
            <span className="hud-stat" title="Experience points">
              <span className="hud-value">{xp}</span> <span className="hud-unit">XP</span>
              <progress
                className="hud-xp"
                max={span}
                value={into}
                aria-label={level.next ? `${level.next.min - xp} XP until ${level.next.name}` : 'Highest level reached'}
              />
            </span>
            <span className="hud-stat" aria-label={`${stars} of ${maxStars} stars`}>
              <span aria-hidden="true" className="star">★</span> <span className="hud-value">{stars}</span><span className="hud-unit">/{maxStars}</span>
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
