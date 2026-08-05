import { describe, it, expect } from 'vitest';
import {
  claimTeamNameKey,
  releaseTeamNameKey,
  releaseAllTeamNameKeys
} from '../server/services/teamNameIndex.js';

/**
 * The ownership rules the two rename paths and the delete path now share.
 *
 * `__tests__/teamIndexIntegrity.test.ts` and `__tests__/superAdminRoutes.test.ts`
 * prove the routes behave, over real HTTP, with a store that can be made to
 * fail. This suite pins the rules themselves on the unit that carries them, so a
 * future caller reusing these helpers inherits the reasoning rather than
 * rediscovering it: **a compensating write may only remove a mapping it added
 * itself, and no index write ever takes a name away from another team.**
 */

const createStore = (entries: [string, string][] = []) => {
  const indexMap = new Map(entries);
  return {
    indexMap,
    calls: [] as string[],
    atomicTeamIndexUpdate(updater: (index: Map<string, string>) => Map<string, string> | null) {
      this.calls.push('atomicTeamIndexUpdate');
      const next = updater(new Map(indexMap));
      if (!next) return Promise.resolve(new Map(indexMap));
      indexMap.clear();
      for (const [key, value] of next) indexMap.set(key, value);
      return Promise.resolve(new Map(indexMap));
    }
  };
};

describe('claimTeamNameKey', () => {
  it('claims a free name without disturbing the team’s current one', async () => {
    const store = createStore([['alpha', 'team-1']]);

    expect(await claimTeamNameKey(store, 'team-1', 'beta')).toBe(true);

    // Both keys, deliberately: the old name stays claimed until the record
    // carries the new one, so no window exists in which it is free for someone
    // else to take and then be evicted from.
    expect([...store.indexMap.entries()].sort()).toEqual([['alpha', 'team-1'], ['beta', 'team-1']]);
  });

  it('refuses a name another team holds, and writes nothing', async () => {
    const store = createStore([['alpha', 'team-1'], ['beta', 'team-2']]);

    expect(await claimTeamNameKey(store, 'team-1', 'beta')).toBe(false);

    expect(store.indexMap.get('beta')).toBe('team-2');
    expect([...store.indexMap.entries()].sort()).toEqual([['alpha', 'team-1'], ['beta', 'team-2']]);
  });

  it('follows the last attempt when the store replays the updater', async () => {
    // `atomicTeamIndexUpdate` re-runs its updater on a lost compare-and-swap, so
    // the answer must come from the state the *last* attempt saw. A conflict
    // recorded as a one-way flag would outlive the collision that caused it and
    // refuse a name that had since been freed.
    const indexMap = new Map([['beta', 'team-2']]);
    let attempt = 0;
    const replayingStore = {
      atomicTeamIndexUpdate(updater: (index: Map<string, string>) => Map<string, string> | null) {
        attempt += 1;
        // First attempt: team-2 still holds the name and the write is lost.
        updater(new Map(indexMap));
        // Retry: team-2 has released it in the meantime.
        indexMap.delete('beta');
        const next = updater(new Map(indexMap));
        if (next) {
          indexMap.clear();
          for (const [key, value] of next) indexMap.set(key, value);
        }
        return Promise.resolve(new Map(indexMap));
      }
    };

    expect(await claimTeamNameKey(replayingStore, 'team-1', 'beta')).toBe(true);
    expect(attempt).toBe(1);
    expect(indexMap.get('beta')).toBe('team-1');
  });

  it('is a no-op when the team already holds the name', async () => {
    const store = createStore([['alpha', 'team-1']]);

    expect(await claimTeamNameKey(store, 'team-1', 'alpha')).toBe(true);

    expect([...store.indexMap.entries()]).toEqual([['alpha', 'team-1']]);
  });
});

describe('releaseTeamNameKey', () => {
  it('drops the team’s own mapping', async () => {
    const store = createStore([['alpha', 'team-1'], ['beta', 'team-1']]);

    await releaseTeamNameKey(store, 'team-1', 'alpha');

    expect([...store.indexMap.entries()]).toEqual([['beta', 'team-1']]);
  });

  it('never evicts a mapping another team took in the meantime', async () => {
    // The whole point of the ownership check: this is the compensating write of
    // a rename that failed, running after a concurrent creation legitimately
    // claimed the same name.
    const store = createStore([['alpha', 'team-2']]);

    await releaseTeamNameKey(store, 'team-1', 'alpha');

    expect(store.indexMap.get('alpha')).toBe('team-2');
  });

  it('does nothing when the name is already gone', async () => {
    const store = createStore([['beta', 'team-1']]);

    await releaseTeamNameKey(store, 'team-1', 'alpha');

    expect([...store.indexMap.entries()]).toEqual([['beta', 'team-1']]);
  });
});

describe('releaseAllTeamNameKeys', () => {
  it('clears every key pointing at the team, not just the first', async () => {
    const store = createStore([['alpha', 'team-1'], ['beta', 'team-1'], ['gamma', 'team-2']]);

    await releaseAllTeamNameKeys(store, 'team-1');

    expect([...store.indexMap.entries()]).toEqual([['gamma', 'team-2']]);
  });

  it('leaves other teams alone and writes nothing when there is nothing to remove', async () => {
    const store = createStore([['gamma', 'team-2']]);

    await releaseAllTeamNameKeys(store, 'team-1');

    expect([...store.indexMap.entries()]).toEqual([['gamma', 'team-2']]);
  });
});
