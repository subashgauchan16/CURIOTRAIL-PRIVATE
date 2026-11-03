import { describe, expect, it } from 'vitest';
import { GAIT, locomotionFor, playbackRate } from '../src/world/character-model';

describe('character locomotion', () => {
  it('stands still below the walk threshold', () => {
    expect(locomotionFor(0)).toBe('Idle');
    expect(locomotionFor(GAIT.startWalk - 0.01)).toBe('Idle');
  });

  it('walks between the thresholds and runs above the run threshold', () => {
    expect(locomotionFor(GAIT.startWalk)).toBe('Walk');
    expect(locomotionFor(GAIT.walkSpeed)).toBe('Walk');
    expect(locomotionFor(GAIT.startRun - 0.01)).toBe('Walk');
    expect(locomotionFor(GAIT.startRun)).toBe('Run');
    expect(locomotionFor(10)).toBe('Run');
  });

  it('plays clips at authored speed when moving at the authored speed', () => {
    expect(playbackRate('Walk', GAIT.walkSpeed)).toBeCloseTo(1);
    expect(playbackRate('Run', GAIT.runSpeed)).toBeCloseTo(1);
    expect(playbackRate('Idle', 0)).toBe(1);
  });

  it('clamps playback so slow or fast movement never looks broken', () => {
    expect(playbackRate('Walk', 0.2)).toBe(0.6);
    expect(playbackRate('Walk', 5)).toBe(1.5);
    expect(playbackRate('Run', 100)).toBe(1.4);
  });
});
