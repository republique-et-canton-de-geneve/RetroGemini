import { describe, it, expect } from 'vitest';
import { shouldRefreshLastConnection } from '../server/services/socketHandlers.js';

const FIVE_MIN = 5 * 60 * 1000;

describe('shouldRefreshLastConnection', () => {
  it('refreshes when there is no prior timestamp', () => {
    expect(shouldRefreshLastConnection(undefined, Date.now(), FIVE_MIN)).toBe(true);
    expect(shouldRefreshLastConnection(null, Date.now(), FIVE_MIN)).toBe(true);
  });

  it('refreshes when the prior timestamp is older than the interval', () => {
    const now = Date.now();
    const old = new Date(now - FIVE_MIN - 1000).toISOString();
    expect(shouldRefreshLastConnection(old, now, FIVE_MIN)).toBe(true);
  });

  it('skips when the prior timestamp is within the interval', () => {
    const now = Date.now();
    const recent = new Date(now - 1000).toISOString();
    expect(shouldRefreshLastConnection(recent, now, FIVE_MIN)).toBe(false);
  });

  it('refreshes when the prior timestamp is unparseable', () => {
    expect(shouldRefreshLastConnection('not-a-date', Date.now(), FIVE_MIN)).toBe(true);
  });
});
