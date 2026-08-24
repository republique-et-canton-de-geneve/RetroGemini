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

const initRedisAdapter = async (io, redisConfig, connectTimeoutMs = REDIS_CONNECT_TIMEOUT_MS) => {
  let pubClient;
  let subClient;

  try {
    pubClient = createClient(redisConfig);
    subClient = pubClient.duplicate();

    await connectWithinTimeout([pubClient, subClient], connectTimeoutMs);
    swapAdapter(io, createRedisAdapter(pubClient, subClient));
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

    swapAdapter(io, createPostgresAdapter(pgPool));
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
const initSocketAdapter = async ({ io, dataStore, connectTimeoutMs = REDIS_CONNECT_TIMEOUT_MS }) => {
  const redisConfig = buildRedisConfig();
  const strategy = resolveSocketAdapterStrategy({
    hasRedisConfig: !!redisConfig,
    usePostgres: dataStore.usePostgres
  });

  if (strategy === SOCKET_ADAPTER_STRATEGIES.REDIS) {
    const { active, error } = await initRedisAdapter(io, redisConfig, connectTimeoutMs);
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
 * Socket.IO's `io.adapter()` does not *attach* an adapter, it **replaces** the
 * instance on every namespace (`Server#adapter` → `Namespace#_initAdapter`), and
 * the replacement starts with empty room bookkeeping. At startup that is
 * harmless — nothing is connected until `server.listen`. On a **retry** it is
 * not: every socket that joined a session during the degraded window keeps its
 * connection and silently loses its rooms, so from the next broadcast on it
 * receives nothing. That is the same invisible failure H50 exists to remove,
 * reintroduced by H50's own self-healing. So the membership is captured before
 * the swap and re-applied after it.
 *
 * Captured unfiltered, including the socket's own id room: Socket.IO joins that
 * on connect and uses it for `io.to(socketId)`, so restoring the previous state
 * faithfully means restoring that too.
 *
 * **The capture has to sit next to the swap, not before the work that precedes
 * it** (Codex, PR #434). The first version snapshotted membership and then
 * awaited the connection work — dialling Redis, running `CREATE TABLE` — which
 * on a live pod is a window of seconds. A client that joined inside it was
 * missing from the snapshot and lost every room; one that left was re-added to
 * a session it had quit. `swapAdapter` below closes that by doing capture,
 * swap and restore with no `await` between them: on a single-threaded runtime
 * no socket event can interleave, so the window is exactly zero.
 */
const captureRoomMembership = (io) => {
  const sockets = io?.sockets?.sockets;
  if (!sockets || typeof sockets.forEach !== 'function') return [];

  const captured = [];
  sockets.forEach((socket) => {
    const rooms = socket?.rooms ? [...socket.rooms] : [];
    if (rooms.length > 0) captured.push({ socket, rooms });
  });
  return captured;
};

const restoreRoomMembership = (membership) => {
  let restored = 0;
  for (const { socket, rooms } of membership) {
    try {
      // A socket that dropped during the swap is not a reason to abandon the
      // rest of the room: the recovery must be best-effort per socket.
      if (socket?.connected === false) continue;
      socket.join(rooms);
      restored += 1;
    } catch (err) {
      console.warn('[Server] Could not restore room membership after adapter recovery', err);
    }
  }
  return restored;
};

/**
 * Installs an adapter and carries the rooms across. Synchronous by contract —
 * do not make this async, and do not `await` anything inside it: the guarantee
 * it provides is that nothing runs between reading the membership and putting
 * it back.
 */
const swapAdapter = (io, adapter) => {
  const membership = captureRoomMembership(io);
  io.adapter(adapter);
  if (membership.length === 0) return;

  const restored = restoreRoomMembership(membership);
  console.info(`[Server] Re-joined ${restored} live socket(s) to their rooms after the adapter swap`);
};

/**
 * How long the *first* connection attempt may take before the supervisor takes
 * over. node-redis's default reconnect strategy answers every connection
 * refusal with a backoff number and its socket loops `while (isOpen &&
 * !isReady)`, so `connect()` against an unreachable Redis never rejects — it
 * stays pending for ever (verified in `@redis/client`'s `socket.js`). That is
 * not a slow adapter, it is a pod that never calls `server.listen`: with Redis
 * down the deployment would fail its startup probe in a loop instead of serving
 * degraded, which is the exact outcome this module exists to prevent.
 *
 * Bounded with a race rather than by disabling the client's reconnects: the
 * strategy also governs an *established* connection, and turning it off would
 * leave a healthy client unable to recover from a blip. The supervisor owns the
 * retry; the client keeps owning its own reconnections.
 */
const REDIS_CONNECT_TIMEOUT_MS = 10_000;

const connectWithinTimeout = async (clients, timeoutMs) => {
  let timer;
  const connecting = Promise.all(clients.map((client) => client.connect()));
  // The losing side of the race can still reject later — on the `destroy()`
  // below, which makes the pending `connect()` throw. Unhandled, that is fatal
  // to the process on current Node.
  connecting.catch(() => {});

  try {
    await Promise.race([
      connecting,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Redis connection did not settle within ${timeoutMs}ms`)),
          timeoutMs
        );
        if (typeof timer?.unref === 'function') timer.unref();
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

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
  connectTimeoutMs = REDIS_CONNECT_TIMEOUT_MS,
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
    // Room membership is carried across by `swapAdapter`, at the moment of the
    // swap — never captured out here, where the connection work sits between
    // the snapshot and the swap it is meant to describe.
    const result = await initSocketAdapter({ io, dataStore, connectTimeoutMs });

    return publish({
      ...result,
      attempts,
      gaveUp: result.degraded && attempts >= maxAttempts
    });
  };

  const scheduleRetry = () => {
    const delay = Math.min(retryBaseMs * 2 ** (attempts - 1), retryMaxMs);
    schedule(async () => {
      // Wrapped because this runs detached from any caller: an unhandled
      // rejection here is fatal to the process on current Node, and a pod dying
      // while it heals a degraded adapter is a far worse outcome than one that
      // stays degraded and says so.
      try {
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
      } catch (err) {
        console.error('[Server] Socket.IO adapter retry failed unexpectedly; staying degraded', err);
      }
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
