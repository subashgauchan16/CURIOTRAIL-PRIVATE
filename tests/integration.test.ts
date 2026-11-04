// Behaviour added when CURIO's progression, modules and privacy controls were
// integrated into this repository, checked against the world the target ships.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseHash } from '../src/app/router';
import * as engine from '../src/engine/game-engine';
import * as progression from '../src/engine/progression';
import * as store from '../src/engine/progress-store';
import { validateCodex, validateCurriculum } from '../src/engine/quest-validation';
import type { Codex, Curriculum, EndingScene, Run } from '../src/engine/types';
import { loadAllQuests, loadQuest, loadWorld, memoryStorage, readJson } from './helpers';

const quests = loadAllQuests();
const world = loadWorld();
const curriculum = readJson<Curriculum>('public/data/curriculum.json');
const market = loadQuest('market-ledger');
const moduleById = (id: string) => curriculum.modules.find((m) => m.id === id)!;
const load = (data: unknown) => store.createProgressStore(memoryStorage({ [store.STORAGE_KEY]: JSON.stringify(data) })).load();
const finished = (id: string) => ({ questId: id, sceneIndex: 0, sceneId: 'ending', inspected: [], results: {}, completed: true }) as Run;
const finish = (p: store.Progress, id: string, mastered = true) => store.withCompletion(p, finished(id), 50, 2, undefined, { mastered });

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('the target world keeps its island', () => {
  test('island B, walk grid and destination positions survive the integration', () => {
    expect(world.island?.files.low).toBe('island-b/VikingIsland_Scene.glb');
    expect(world.island?.nav).toBe('nav-island-b.json');
    expect(world.destinations.find((d) => d.id === 'signal-woods')!.position).toEqual([10, -24]);
    expect(world.destinations.find((d) => d.id === 'trading-market')!.position).toEqual([14, 30]);
  });
});

describe('content data', () => {
  test('the codex and curriculum validate against the shipped quests', () => {
    expect(validateCodex(readJson<Codex>('public/data/codex.json'), [...quests.values()])).toEqual([]);
    expect(validateCurriculum(curriculum, [...quests.keys()])).toEqual([]);
  });

  test('eight modules in order; only modules with quests are playable, the rest stay planned', () => {
    expect(curriculum.modules.map((m) => m.number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const p = store.defaultProgress();
    const statuses = Object.fromEntries(curriculum.modules.map((m) => [m.id, progression.moduleStatus(m, world, quests, p)]));
    expect(statuses['digital-foundations']).toBe('available');
    expect(statuses['sql-essentials']).toBe('locked');
    expect(statuses['data-modelling']).toBe('locked');
    for (const id of ['power-bi-fundamentals', 'dax-core', 'advanced-dax', 'advanced-power-bi', 'analytics-projects']) expect(statuses[id]).toBe('planned');
  });
});

describe('modules follow the progression engine', () => {
  test('a failed boss leaves its module unfinished and the Great Hall locked', () => {
    let p = finish(store.defaultProgress(), 'missing-signal');
    p = finish(p, 'broken-tally');
    p = finish(p, 'market-ledger', false);
    const hall = world.destinations.find((d) => d.id === 'great-hall')!;
    expect(progression.destinationStatus(hall, quests, p)).toBe('locked');
    expect(progression.unlockRequirement(hall, quests, p)).toContain('Pass the final challenge of');
    expect(progression.moduleStatus(moduleById('digital-foundations'), world, quests, p)).toBe('in-progress');
  });

  test('a module completes only when every one of its quests is finished and passed', () => {
    let p = store.defaultProgress();
    for (const id of ['missing-signal', 'broken-tally', 'market-ledger', 'great-hall-dashboard']) p = finish(p, id);
    expect(progression.moduleStatus(moduleById('digital-foundations'), world, quests, p)).toBe('completed');
  });

  test('legacy completions keep module progress after migrating to v5', () => {
    const record = { run: null, runXp: 0, lastRun: null, lastXp: 60, bestXp: 60, bestStars: 3, completed: true, completions: 1 };
    const p = load({ version: 3, player: { name: 'Asha', emblem: 'owl' }, quests: { 'missing-signal': record, 'market-ledger': record }, achievements: [], lessons: [], settings: {} });
    expect(p.version).toBe(5);
    expect(p.quests['market-ledger'].mastered).toBe(true);
    expect(store.totalXp(p)).toBe(120);
    expect(progression.destinationStatus(world.destinations.find((d) => d.id === 'great-hall')!, quests, p)).toBe('available');
  });
});

describe('the ending matches the result', () => {
  const ending = market.scenes.find((s) => s.type === 'ending') as EndingScene;
  const perfect = Object.fromEntries(engine.bossScenes(market).map((s) => [s.id, { attempts: 1, solved: true, revealed: false }]));

  test('a passed audit keeps the victory ending', () => {
    const run = { ...engine.createRun(market, 3), results: perfect };
    expect(engine.endingFor(market, run, ending).title).toBe('The audit is passed');
  });

  test('a failed audit never says it passed', () => {
    const failed = Object.fromEntries(Object.keys(perfect).map((id) => [id, { attempts: 3, solved: true, revealed: true }]));
    const shown = engine.endingFor(market, { ...engine.createRun(market, 3), results: failed }, ending);
    expect(shown.title).not.toContain('is passed');
    expect(shown.lines?.join(' ')).toContain('Great Hall stays closed');
  });

  test('quests without a boss are unchanged', () => {
    const q = loadQuest('missing-signal');
    const end = q.scenes.find((s) => s.type === 'ending') as EndingScene;
    expect(engine.endingFor(q, engine.createRun(q), end)).toBe(end);
  });
});

describe('practice rounds', () => {
  test('the route parses, and an unknown shape falls back to home', () => {
    expect(parseHash('#/practice/market-ledger/rune-max')).toEqual({ name: 'practice', id: 'market-ledger', scene: 'rune-max' });
    expect(parseHash('#/practice/market-ledger')).toEqual({ name: 'home' });
    expect(parseHash('#/explore')).toEqual({ name: 'explore' });
  });
});

describe('XP is not affected by the side-game', () => {
  test('a stake never changes XP', () => {
    const run = engine.createRun(market, 7);
    expect(engine.computeXp(market, { ...run, wagers: { 'rune-max': 10 } })).toBe(engine.computeXp(market, run));
  });
});

describe('privacy: no cookies, nothing leaves the browser', () => {
  const files = sourceFiles('src').filter((f) => /\.(ts|tsx)$/.test(f));

  test('no source file touches cookies or sends data out', () => {
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(/document\.cookie/.test(text), `${f} touches cookies`).toBe(false);
      expect(/navigator\.sendBeacon|XMLHttpRequest|WebSocket/.test(text), `${f} sends data`).toBe(false);
    }
  });

  test('every fetch in the app is for the game’s own relative files', () => {
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/fetch\((['"`])([^'"`]*)/g)) expect(m[2].startsWith('./') || m[2].startsWith('data/') || m[2] === '${', `${f}: ${m[2]}`).toBe(true);
    }
  });

  test('the learning history stops while paused, and deleting it keeps quests and XP', () => {
    let p = finish(store.defaultProgress(), 'missing-signal');
    p = store.withEvent(p, { k: 'lesson', q: 'missing-signal', s: 'arrive' });
    expect(p.events).toHaveLength(1);
    const paused = store.withRecordEvents(p, false);
    expect(store.withEvent(paused, { k: 'lesson', q: 'missing-signal', s: 'arrive' }).events).toHaveLength(1);
    const cleared = store.withEventsCleared(paused);
    expect(cleared.events).toHaveLength(0);
    expect(store.totalXp(cleared)).toBe(store.totalXp(p));
  });

  test('reset clears every CurioTrail key and nothing else on the origin', () => {
    const data = new Map([['curiotrail.progress', '{}'], ['curiotrail.lab-draft.a/b', '{}'], ['curiotrail.explore.controls-seen', '1'], ['someone-else', 'keep']]);
    store.clearOwnedKeys({
      get length() { return data.size; },
      key: (i) => [...data.keys()][i] ?? null,
      removeItem: (k) => { data.delete(k); },
    });
    expect([...data.keys()]).toEqual(['someone-else']);
  });
});
