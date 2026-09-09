import { describe, expect, it } from 'vitest';
import { ROTI_MAX, retroRotiSummary } from '../components/dashboard/retroRoti';
import { RetroSession } from '../types';

const retro = (roti: Record<string, number>) => ({ roti }) as unknown as RetroSession;

describe('retroRotiSummary', () => {
  it('averages the scores people gave', () => {
    expect(retroRotiSummary(retro({ a: 5, b: 4 }))).toEqual({ average: 4.5, count: 2 });
  });

  it('rounds to one decimal, like the impact rollup', () => {
    expect(retroRotiSummary(retro({ a: 5, b: 4, c: 4 }))?.average).toBe(4.3);
  });

  // Same rule as the action rollup, same reason: a "0/5" on a card reads as a
  // damning verdict when the truth is that the session ended before anyone was
  // asked.
  it('reports nothing rather than a zero when nobody answered', () => {
    expect(retroRotiSummary(retro({}))).toBeNull();
    expect(retroRotiSummary(undefined)).toBeNull();
    expect(retroRotiSummary({} as RetroSession)).toBeNull();
  });

  it('ignores a non-numeric score rather than poisoning the mean with NaN', () => {
    const poisoned = { a: 4, b: undefined, c: 'x', d: NaN } as unknown as Record<string, number>;

    expect(retroRotiSummary(retro(poisoned))).toEqual({ average: 4, count: 1 });
  });

  it('is scored out of five, unlike the action impact scale of three', () => {
    expect(ROTI_MAX).toBe(5);
  });
});
