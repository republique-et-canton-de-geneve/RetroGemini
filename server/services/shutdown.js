/**
 * @param {{
 *   io?: { close?: (callback?: (err?: Error) => void) => void },
 *   server?: { close?: (callback?: (err?: Error) => void) => void },
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
  timeoutMs = 10000,
  exit = process.exit
}) => {
  let shuttingDown = false;

  const closeServer = () => new Promise((resolve) => {
    if (!server?.close) {
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

  return async (signal) => {
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
};

export { createShutdownHandler };
