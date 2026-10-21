/**
 * How long a draining pod may take before it is forced out. Long enough for
 * the one Jira creation a request may be in when the signal arrives — one
 * call, up to `JIRA_CALL_DEADLINE_MS` (15 s), then the write of its key — to
 * finish and be answered: exiting in the middle of it leaves the browser a
 * 502, every action of that request "outcome unknown", and an issue Jira may
 * have created with its key never recorded. Short enough to end before
 * Kubernetes kills the container: `terminationGracePeriodSeconds` (30) counts
 * from the start of the 5 s `preStop` hook in `k8s/base/deployment.yaml`, and
 * SIGTERM arrives after it, so 25 s remain. `__tests__/shutdown.test.ts`
 * holds both bounds against the client's deadline and the manifest.
 */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 20000;

/**
 * @param {{
 *   io?: { close?: (callback?: (err?: Error) => void) => void },
 *   server?: { close?: (callback?: (err?: Error) => void) => void, listening?: boolean },
 *   dataStore?: { closeDatabase?: () => Promise<void> },
 *   backupService?: { stopScheduler?: () => void },
 *   logger?: Pick<Console, 'info' | 'warn' | 'error'>,
 *   timeoutMs?: number,
 *   exit?: (code: number) => void
 * }} options
 */
const createShutdownHandler = ({
  io,
  server,
  dataStore,
  backupService,
  logger = console,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  exit = process.exit
}) => {
  let shuttingDown = false;

  const closeServer = () => new Promise((resolve) => {
    if (!server?.close || server.listening === false) {
      resolve();
      return;
    }

    server.close((err) => {
      if (err) {
        logger.warn('[Server] HTTP server close completed with warning', err);
      }
      resolve();
    });
  });

  const closeSocketServer = () => new Promise((resolve) => {
    if (!io?.close) {
      resolve();
      return;
    }

    io.close((err) => {
      if (err) {
        logger.warn('[Server] Socket.IO close completed with warning', err);
      }
      resolve();
    });
  });

  const shutdown = async (signal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info(`[Server] Received ${signal}, shutting down gracefully`);

    const forceExitTimer = setTimeout(() => {
      logger.error(`[Server] Graceful shutdown timed out after ${timeoutMs}ms`);
      exit(1);
    }, timeoutMs);
    forceExitTimer.unref?.();

    try {
      backupService?.stopScheduler?.();
      await closeSocketServer();
      await closeServer();
      await dataStore?.closeDatabase?.();
      clearTimeout(forceExitTimer);
      logger.info('[Server] Graceful shutdown complete');
      exit(0);
    } catch (err) {
      clearTimeout(forceExitTimer);
      logger.error('[Server] Graceful shutdown failed', err);
      exit(1);
    }
  };

  // True from the moment a signal arrives. A request that runs a series of
  // outbound calls (the Jira batch creates one issue after another) checks it
  // between two of them and starts no new one on a draining pod: what was not
  // attempted is answered as such, for the next click to send to a pod that
  // stays.
  shutdown.isShuttingDown = () => shuttingDown;

  return shutdown;
};

export { createShutdownHandler };
