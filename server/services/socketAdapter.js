import { createAdapter as createRedisAdapter } from '@socket.io/redis-adapter';
import { createAdapter as createPostgresAdapter } from '@socket.io/postgres-adapter';
import { createClient } from 'redis';

const SOCKET_ADAPTER_STRATEGIES = {
  REDIS: 'redis',
  POSTGRES: 'postgres',
  MEMORY: 'memory'
};

/**
 * Picks the cross-pod broadcast backend. Redis wins when configured, then
 * PostgreSQL when it is already the data store; otherwise the process keeps
 * Socket.IO's in-memory adapter, which is correct for a single pod only.
 */
const resolveSocketAdapterStrategy = ({ hasRedisConfig, usePostgres }) => {
  if (hasRedisConfig) {
    return SOCKET_ADAPTER_STRATEGIES.REDIS;
  }

  if (usePostgres) {
    return SOCKET_ADAPTER_STRATEGIES.POSTGRES;
  }

  return SOCKET_ADAPTER_STRATEGIES.MEMORY;
};

const buildRedisConfig = () => {
  if (process.env.REDIS_URL) {
    return { url: process.env.REDIS_URL };
  }

  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT || 6379);
  const password = process.env.REDIS_PASSWORD;

  if (host) {
    return {
      socket: { host, port },
      password: password || undefined
    };
  }

  return null;
};

/**
 * Best-effort release of a client that never finished connecting. node-redis
 * keeps its own reconnect loop alive after `connect()` rejects, so without this
 * the H50 retry below would stack one looping pair of clients per attempt — a
 * self-healing feature that leaks until the pod restarts. Every failure here is
 * swallowed: this runs on the error path, and a broken teardown must not
 * replace the error the caller is about to report.
 */
const releaseQuietly = (client) => {
  try {
    if (typeof client?.destroy === 'function') {
      client.destroy();
    } else if (typeof client?.disconnect === 'function') {
      client.disconnect();
    }
  } catch {
    // Nothing to do: the client was already unusable.
  }
};

const initRedisAdapter = async (io, redisConfig) => {
  let pubClient;
  let subClient;

  try {
    pubClient = createClient(redisConfig);
    subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createRedisAdapter(pubClient, subClient));
    console.info('[Server] Using Redis adapter for Socket IO (multi-pod ready)');
    return { active: true };
  } catch (err) {
    console.error('[Server] Failed to initialize Redis adapter', err);
    releaseQuietly(pubClient);
    releaseQuietly(subClient);
    return { active: false, error: err };
  }
};

const initPostgresAdapter = async (io, pgPool) => {
  if (!pgPool) {
    return { active: false, error: new Error('PostgreSQL pool unavailable') };
  }

  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS socket_io_attachments (
        id BIGSERIAL UNIQUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        payload BYTEA
      )
    `);

    io.adapter(createPostgresAdapter(pgPool));
    console.info('[Server] Using PostgreSQL adapter for Socket IO (multi-pod ready)');
    return { active: true };
  } catch (err) {
    console.error('[Server] Failed to initialize PostgreSQL adapter', err);
    return { active: false, error: err };
  }
};

/**
 * Attempts the wiring once and reports **what was asked for as well as what
 * happened** (audit H50).
 *
 * This used to return a bare boolean, and that is the whole finding: `false`
 * meant both "no shared adapter is configured, the in-memory one is correct"
 * and "a shared adapter is configured and failed to initialise", which are a
 * healthy single-pod deployment and a silent split-brain at `replicas: 2`.
 * Nothing downstream could tell them apart, so nothing downstream could report
 * the second one. `expected` is the field that separates them.
 */
const initSocketAdapter = async ({ io, dataStore }) => {
  const redisConfig = buildRedisConfig();
  const strategy = resolveSocketAdapterStrategy({
    hasRedisConfig: !!redisConfig,
    usePostgres: dataStore.usePostgres
  });

  if (strategy === SOCKET_ADAPTER_STRATEGIES.REDIS) {
    const { active, error } = await initRedisAdapter(io, redisConfig);
    return { strategy, expected: true, active, degraded: !active, error };
  }

  if (strategy === SOCKET_ADAPTER_STRATEGIES.POSTGRES) {
    const { active, error } = await initPostgresAdapter(io, dataStore.getPgPool());
    return { strategy, expected: true, active, degraded: !active, error };
  }

  console.info('[Server] Using in-memory Socket IO adapter (single-pod)');
  return { strategy, expected: false, active: false, degraded: false };
};

/**
 * Retry cadence for a shared adapter that failed to initialise.
 *
 * Bounded on purpose, and the bound is the interesting decision. The two
 * realistic failures pull in opposite directions: a Redis blip heals in
 * seconds (retrying is the whole point of option (c)), while
 * `CREATE TABLE socket_io_attachments` refused by a restricted grant never
 * heals without an operator. Retrying the second one forever would write an
 * error a minute into a 1 000-entry in-memory log ring — flushing the
 * super-admin log viewer in under a day and burying the very message that
 * explains the problem. So: back off to a minute, give up after roughly ten,
 * and leave the state visible on /health for as long as the pod runs. Giving
 * up on the *retry* is not giving up on the pod — it keeps serving, degraded
 * and reported, and a restart starts the sequence again.
 */
const SOCKET_ADAPTER_RETRY_BASE_MS = 5_000;
const SOCKET_ADAPTER_RETRY_MAX_MS = 60_000;
const SOCKET_ADAPTER_MAX_ATTEMPTS = 12;

/**
 * `unref` so a pending retry can never hold a shutting-down process open.
 * Returns nothing on purpose: the timer handle is never used, and a scheduler
 * typed as `=> void` is one a test can substitute without impersonating a Node
 * `Timeout`.
 */
const scheduleUnref = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
};

const logDegraded = (status) => {
  console.error(
    `[Server] Socket.IO adapter DEGRADED — the ${status.strategy} adapter is configured but not active `
      + `(attempt ${status.attempts}${status.gaveUp ? ', giving up' : ', retrying'}). `
      + 'This pod is serving with the in-memory adapter: at more than one replica, participants balanced '
      + 'onto different pods will not see each other\'s tickets, votes or phase changes.',
    status.error
  );
};

/**
 * Owns the adapter's lifecycle: initialise, publish the state on `runtime`,
 * shout if it is degraded, and retry in the background so a transient failure
 * heals itself (audit H50, options (a) + (c)).
 *
 * What it deliberately does **not** do is touch readiness — option (b). If both
 * pods fail to initialise at once, failing readiness on both empties the
 * Service and turns "collaboration is degraded" into "the application is down",
 * which is strictly worse; and readiness cannot express "some pods are
 * healthy". Visibility is the fix, not gating.
 */
const startSocketAdapter = async ({
  io,
  dataStore,
  runtime,
  schedule = scheduleUnref,
  retryBaseMs = SOCKET_ADAPTER_RETRY_BASE_MS,
  retryMaxMs = SOCKET_ADAPTER_RETRY_MAX_MS,
  maxAttempts = SOCKET_ADAPTER_MAX_ATTEMPTS
}) => {
  let attempts = 0;

  const publish = (status) => {
    runtime.socketAdapter = status;
    // Kept as a boolean for the callers that only ask "can I serverSideEmit?".
    runtime.multiPodAdapter = status.active;
    return status;
  };

  const attempt = async () => {
    attempts += 1;
    const result = await initSocketAdapter({ io, dataStore });
    return publish({
      ...result,
      attempts,
      gaveUp: result.degraded && attempts >= maxAttempts
    });
  };

  const scheduleRetry = () => {
    const delay = Math.min(retryBaseMs * 2 ** (attempts - 1), retryMaxMs);
    schedule(async () => {
      const status = await attempt();
      if (!status.degraded) {
        console.info(
          `[Server] Socket.IO ${status.strategy} adapter recovered after ${status.attempts} attempts `
            + '— cross-pod broadcasts are shared again'
        );
        return;
      }
      logDegraded(status);
      if (!status.gaveUp) scheduleRetry();
    }, delay);
  };

  const status = await attempt();
  if (status.degraded) {
    logDegraded(status);
    if (!status.gaveUp) scheduleRetry();
  }
  return status;
};

export {
  initSocketAdapter,
  startSocketAdapter,
  resolveSocketAdapterStrategy,
  SOCKET_ADAPTER_STRATEGIES
};
