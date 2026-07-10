import { describe, expect, it } from 'vitest';
import { randomId } from '../utils/randomId';

describe('randomId', () => {
  it('returns the default 9-character base36 id', () => {
    const id = randomId();
    expect(id).toMatch(/^[0-9a-z]{9}$/);
  });

  it('honours a custom length', () => {
    expect(randomId(8)).toMatch(/^[0-9a-z]{8}$/);
    expect(randomId(16)).toMatch(/^[0-9a-z]{16}$/);
  });

  it('does not repeat across calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId()));
    expect(ids.size).toBe(200);
  });
});
