import { describe, it, expect } from 'vitest';
import { createKeyedQueue } from '../server/services/keyedQueue.js';

/**
 * The queue `atomicTeamUpdate` runs each team's writes through: one at a time
 * per team, in the order they arrived, while other teams' writes go ahead. It
 * replaced a compare-and-swap loop that, with every writer of a team racing at
 * once, let one of them win per round and failed the rest after five rounds.
 */

const deferred = () => {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createKeyedQueue', () => {
  it('runs the tasks of one key one at a time, in the order they were queued', async () => {
    const queue = createKeyedQueue();
    const log: string[] = [];
    const first = deferred();

    const a = queue.run('team-1', async () => {
      log.push('a:start');
      await first.promise;
      log.push('a:end');
    });
    const b = queue.run('team-1', async () => {
      log.push('b:start');
    });
    await settle();
    expect(log).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(log).toEqual(['a:start', 'a:end', 'b:start']);
  });

  it('lets the tasks of another key run meanwhile', async () => {
    const queue = createKeyedQueue();
    const held = deferred();
    const log: string[] = [];

    const slow = queue.run('team-1', () => held.promise);
    await queue.run('team-2', async () => {
      log.push('team-2 ran');
    });
    expect(log).toEqual(['team-2 ran']);

    held.resolve();
    await slow;
  });

  it('gives each caller its own result, and its own failure', async () => {
    const queue = createKeyedQueue();
    const results = await Promise.allSettled([
      queue.run('team-1', async () => 'first'),
      queue.run('team-1', async () => {
        throw new Error('second failed');
      }),
      queue.run('team-1', () => {
        throw new Error('third threw synchronously');
      }),
      queue.run('team-1', async () => 'fourth')
    ]);

    expect(results.map((r) => (r.status === 'fulfilled' ? r.value : (r.reason as Error).message))).toEqual([
      'first',
      'second failed',
      'third threw synchronously',
      'fourth'
    ]);
  });

  it('forgets a key once its last task has settled', async () => {
    const queue = createKeyedQueue();
    await Promise.allSettled([
      queue.run('team-1', async () => undefined),
      queue.run('team-2', async () => {
        throw new Error('boom');
      })
    ]);
    await settle();
    expect(queue.size()).toBe(0);
  });

  it('keeps a key while a task is still waiting behind one that settled', async () => {
    const queue = createKeyedQueue();
    const held = deferred();
    await queue.run('team-1', async () => undefined);
    const waiting = queue.run('team-1', () => held.promise);
    await settle();
    expect(queue.size()).toBe(1);

    held.resolve();
    await waiting;
    await settle();
    expect(queue.size()).toBe(0);
  });
});
