import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from '../server/services/shutdown.js';

describe('createShutdownHandler', () => {
  it('stops schedulers, closes sockets, closes HTTP, closes data store, and exits cleanly', async () => {
    const calls: string[] = [];
    const shutdown = createShutdownHandler({
      backupService: { stopScheduler: vi.fn(() => calls.push('backup')) },
      io: { close: vi.fn((done: () => void) => { calls.push('io'); done(); }) },
      server: { close: vi.fn((done: () => void) => { calls.push('server'); done(); }) },
      dataStore: { closeDatabase: vi.fn(async () => { calls.push('dataStore'); }) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exit: vi.fn((code?: string | number) => { calls.push(`exit:${code}`); }) as unknown as typeof process.exit,
      timeoutMs: 1000
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['backup', 'io', 'server', 'dataStore', 'exit:0']);
  });

  it('ignores duplicate shutdown signals', async () => {
    const exit = vi.fn();
    const closeDatabase = vi.fn(async () => undefined);
    const shutdown = createShutdownHandler({
      dataStore: { closeDatabase },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exit: exit as unknown as typeof process.exit,
      timeoutMs: 1000
    });

    await shutdown('SIGTERM');
    await shutdown('SIGINT');

    expect(closeDatabase).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
