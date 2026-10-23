import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { createShutdownHandler, DEFAULT_SHUTDOWN_TIMEOUT_MS } from '../server/services/shutdown.js';
import { JIRA_CALL_DEADLINE_MS } from '../server/services/jiraClient.js';
import { JIRA_CLAIM_TTL_MS } from '../utils/jira.js';

// A draining pod finishes the Jira creation it is in (one call, up to the
// client's deadline) and writes the key; exiting in the middle of it leaves
// the browser a 502, every action of the request "outcome unknown", and an
// issue Jira may have created with its key never recorded. The forced exit
// must therefore wait one Jira call plus the key's write, and still come
// before Kubernetes kills the container: `terminationGracePeriodSeconds`
// counts from the start of the `preStop` hook, and SIGTERM arrives after it.
//
// A session's parent issue (`sessionParent` mode) changes none of this: it is
// one Jira call like any other, its key is written by one write, and the
// batch reads the drain flag again after that write, so a SIGTERM during it
// starts no sub-task (`jiraIssues.test.ts` → "starts no sub-task when the pod
// starts draining during the parent’s write"). At most one call and its write
// still run after SIGTERM.
describe('the shutdown budget', () => {
  const manifest = readFileSync(join(__dirname, '..', 'k8s/base/deployment.yaml'), 'utf8');
  const seconds = (pattern: RegExp, what: string) => {
    const match = pattern.exec(manifest);
    expect(match, what).not.toBeNull();
    return Number((match as RegExpExecArray)[1]) * 1000;
  };
  const graceMs = seconds(/^\s*terminationGracePeriodSeconds:\s*(\d+)\s*$/m, 'terminationGracePeriodSeconds');
  const preStopMs = seconds(/preStop:[\s\S]*?sleep (\d+)/, 'the preStop sleep');
  // The key's write after a 201 (two retries of a team write) and the live
  // session's patch: a few seconds on a loaded database.
  const LINK_WRITE_MARGIN_MS = 5000;

  it('outlasts one Jira call and the write of its key', () => {
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(JIRA_CALL_DEADLINE_MS + LINK_WRITE_MARGIN_MS);
  });

  // Each claim — an action's or a session parent's — spans exactly one Jira
  // call and the write that follows it. A claim that expired while its own
  // request still worked would be read as a request that died, and its
  // action or parent marked "may already be in Jira" for nothing.
  it('lets a claim outlive the one Jira call and the write it spans', () => {
    expect(JIRA_CLAIM_TTL_MS).toBeGreaterThanOrEqual(JIRA_CALL_DEADLINE_MS + LINK_WRITE_MARGIN_MS);
  });

  it('ends before Kubernetes kills the container', () => {
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBeLessThan(graceMs - preStopMs);
  });

  it('is the handler\'s default', async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
      // A data store that never finishes closing: only the forced exit ends it.
      const shutdown = createShutdownHandler({ dataStore: { closeDatabase: () => new Promise<void>(() => {}) }, logger, exit });
      void shutdown('SIGTERM');
      await vi.advanceTimersByTimeAsync(DEFAULT_SHUTDOWN_TIMEOUT_MS - 1);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

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
