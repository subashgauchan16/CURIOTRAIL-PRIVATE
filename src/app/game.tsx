// Game state shared by every screen: content (quests + world) and saved
// progress. One source of truth drives the map, quests, HUD and 3D world.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Codex, Curriculum, Quest, World } from '../engine/types';
import * as store from '../engine/progress-store';
import type { Progress } from '../engine/progress-store';

export interface Content { world: World; quests: Map<string, Quest>; curriculum: Curriculum; codex: Codex }

export interface CompletionSummary {
  questId: string;
  runXp: number;
  totalBefore: number;
  totalAfter: number;
  stars: number;
  bestStarsBefore: number;
  firstCompletion: boolean;
  unlocked: string[]; // destination ids newly unlocked
  medal?: import('../engine/game-engine').Medal;
  bestMedalBefore?: import('../engine/game-engine').Medal;
  mastery?: number | null;
  mastered?: boolean;
}

interface GameValue extends Content {
  progress: Progress;
  storageAvailable: boolean;
  update: (fn: (p: Progress) => Progress) => void;
  reset: () => void;
  lastCompletion: CompletionSummary | null;
  setLastCompletion: (c: CompletionSummary | null) => void;
}

const GameContext = createContext<GameValue | null>(null);

export function GameProvider({ content, children }: { content: Content; children: ReactNode }) {
  const persistence = useRef(store.createProgressStore()).current;
  const [progress, setProgress] = useState<Progress>(() => store.reconcileStars(persistence.load(), content.quests));
  const [lastCompletion, setLastCompletion] = useState<CompletionSummary | null>(null);

  const update = useCallback((fn: (p: Progress) => Progress) => {
    setProgress((prev) => {
      const next = fn(prev);
      if (next !== prev) persistence.save(next);
      return next;
    });
  }, [persistence]);

  const reset = useCallback(() => {
    persistence.reset();
    // "Reset all progress" means everything this game keeps in the browser.
    for (const area of ['localStorage', 'sessionStorage'] as const) {
      try { store.clearOwnedKeys(globalThis[area]); } catch { /* storage blocked: nothing was kept */ }
    }
    setProgress(store.defaultProgress());
    setLastCompletion(null);
  }, [persistence]);

  const value = useMemo<GameValue>(() => ({
    ...content, progress, storageAvailable: persistence.available, update, reset, lastCompletion, setLastCompletion,
  }), [content, progress, persistence.available, update, reset, lastCompletion]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): GameValue {
  const value = useContext(GameContext);
  if (!value) throw new Error('useGame must be used inside GameProvider');
  return value;
}
