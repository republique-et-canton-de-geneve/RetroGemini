import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler } from '../server/services/shutdown.js';

describe('createShutdownHandler', () => {
  it('stops schedulers, closes sockets, closes HTTP, closes data store, and exits cleanly', async () => {
    const calls: string[] = [];
    const shutdown = createShutdownHandler({
      backupService: { stopScheduler: vi.fn(() => calls.push('backup')) },
      io: { close: vi.fn((done: () => void) => { calls.push('io'); done(); }) },
      server: { listening: true, close: vi.fn((done: () => void) => { calls.push('server'); done(); }) },
      dataStore: { closeDatabase: vi.fn(async () => { calls.push('dataStore'); }) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exit: vi.fn((code?: string | number) => { calls.push(`exit:${code}`); }) as unknown as typeof process.exit,
      timeoutMs: 1000
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['backup', 'io', 'server', 'dataStore', 'exit:0']);
  });


  it('does not close the HTTP server twice if Socket.IO already stopped it', async () => {
    const calls: string[] = [];
    const server = {
      listening: true,
      close: vi.fn((done: () => void) => { calls.push('server'); done(); })
    };
    const shutdown = createShutdownHandler({
      io: { close: vi.fn((done: () => void) => { calls.push('io'); server.listening = false; done(); }) },
      server,
      dataStore: { closeDatabase: vi.fn(async () => { calls.push('dataStore'); }) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exit: vi.fn((code?: string | number) => { calls.push(`exit:${code}`); }) as unknown as typeof process.exit,
      timeoutMs: 1000
    });

    await shutdown('SIGTERM');

    expect(server.close).not.toHaveBeenCalled();
    expect(calls).toEqual(['io', 'dataStore', 'exit:0']);
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

  // A long request (the Jira batch creates one issue after another) asks this
  // between two steps and stops starting new ones once the pod is draining:
  // the answer must flip the moment the signal arrives, not once the
  // sockets have closed.
  it('says it is shutting down from the moment the signal arrives', async () => {
    let finishSocketClose: () => void = () => undefined;
    const shutdown = createShutdownHandler({
      io: { close: vi.fn((done: () => void) => { finishSocketClose = done; }) },
      dataStore: { closeDatabase: vi.fn(async () => undefined) },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      exit: vi.fn() as unknown as typeof process.exit,
      timeoutMs: 1000
    });

    expect(shutdown.isShuttingDown()).toBe(false);

    const running = shutdown('SIGTERM');
    expect(shutdown.isShuttingDown()).toBe(true);

    finishSocketClose();
    await running;
    expect(shutdown.isShuttingDown()).toBe(true);
  });
});
