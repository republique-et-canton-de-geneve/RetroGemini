import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Covers `server/services/socketAdapter.js` — the multi-pod Socket.IO wiring.
 *
 * Two things this file fixes at once (audit H8.2 / H8.3 / R22):
 *  - it used to import the *root* `socketAdapter.js`, a second module holding
 *    only the strategy resolver, so the name promised coverage of the real
 *    adapter while the implementation measured 0%;
 *  - the resolver now lives in the implementation module, so there is one
 *    `socketAdapter.js` and one test file for it.
 *
 * The external adapters and the Redis client are mocked: the contract under
 * test is "which adapter gets wired, and what happens when wiring fails" —
 * never `false` by accident, and never a throw that would take the server down.
 */

const createRedisAdapter = vi.fn((..._args: unknown[]) => 'redis-adapter');
const createPostgresAdapter = vi.fn((..._args: unknown[]) => 'postgres-adapter');
const createClient = vi.fn();

vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: (...args: unknown[]) => createRedisAdapter(...args)
}));

vi.mock('@socket.io/postgres-adapter', () => ({
  createAdapter: (...args: unknown[]) => createPostgresAdapter(...args)
}));

vi.mock('redis', () => ({
  createClient: (...args: unknown[]) => createClient(...args)
}));

let initSocketAdapter: typeof import('../server/services/socketAdapter.js').initSocketAdapter;
let startSocketAdapter: typeof import('../server/services/socketAdapter.js').startSocketAdapter;
let resolveSocketAdapterStrategy: typeof import('../server/services/socketAdapter.js').resolveSocketAdapterStrategy;
let SOCKET_ADAPTER_STRATEGIES: typeof import('../server/services/socketAdapter.js').SOCKET_ADAPTER_STRATEGIES;

const REDIS_ENV_KEYS = ['REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'];
const savedEnv: Record<string, string | undefined> = {};

const makeRedisClient = (connect = vi.fn().mockResolvedValue(undefined)) => {
  const sub = { connect };
  const pub = { connect, duplicate: vi.fn(() => sub) };
  return { pub, sub };
};

const makeIo = () => ({ adapter: vi.fn() });

beforeEach(async () => {
  REDIS_ENV_KEYS.forEach((key) => {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  });

  vi.clearAllMocks();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});

  const mod = await import('../server/services/socketAdapter.js');
  initSocketAdapter = mod.initSocketAdapter;
  startSocketAdapter = mod.startSocketAdapter;
  resolveSocketAdapterStrategy = mod.resolveSocketAdapterStrategy;
  SOCKET_ADAPTER_STRATEGIES = mod.SOCKET_ADAPTER_STRATEGIES;
});

afterEach(() => {
  REDIS_ENV_KEYS.forEach((key) => {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  });
  vi.restoreAllMocks();
});

describe('resolveSocketAdapterStrategy', () => {
  it('prefers Redis when a Redis config is available', () => {
    const strategy = resolveSocketAdapterStrategy({
      hasRedisConfig: true,
      usePostgres: true
    });

    expect(strategy).toBe(SOCKET_ADAPTER_STRATEGIES.REDIS);
  });

  it('uses PostgreSQL when Redis is unavailable and Postgres is enabled', () => {
    const strategy = resolveSocketAdapterStrategy({
      hasRedisConfig: false,
      usePostgres: true
    });

    expect(strategy).toBe(SOCKET_ADAPTER_STRATEGIES.POSTGRES);
  });

  it('falls back to in-memory adapter when no shared backend exists', () => {
    const strategy = resolveSocketAdapterStrategy({
      hasRedisConfig: false,
      usePostgres: false
    });

    expect(strategy).toBe(SOCKET_ADAPTER_STRATEGIES.MEMORY);
  });
});

describe('initSocketAdapter — Redis', () => {
  it('wires the Redis adapter from REDIS_URL with a duplicated sub client', async () => {
    process.env.REDIS_URL = 'redis://cache:6379';
    const { pub, sub } = makeRedisClient();
    createClient.mockReturnValue(pub);
    const io = makeIo();

    const result = await initSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => ({}) }
    });

    expect(result).toMatchObject({ active: true, expected: true, degraded: false });
    expect(createClient).toHaveBeenCalledWith({ url: 'redis://cache:6379' });
    // Redis wins even when Postgres is also available.
    expect(createPostgresAdapter).not.toHaveBeenCalled();
    expect(createRedisAdapter).toHaveBeenCalledWith(pub, sub);
    expect(io.adapter).toHaveBeenCalledWith('redis-adapter');
  });

  it('builds a host/port/password config when REDIS_URL is unset', async () => {
    process.env.REDIS_HOST = 'redis.internal';
    process.env.REDIS_PORT = '6380';
    process.env.REDIS_PASSWORD = 'secret';
    const { pub } = makeRedisClient();
    createClient.mockReturnValue(pub);

    await initSocketAdapter({
      io: makeIo(),
      dataStore: { usePostgres: false, getPgPool: () => null }
    });

    expect(createClient).toHaveBeenCalledWith({
      socket: { host: 'redis.internal', port: 6380 },
      password: 'secret'
    });
  });

  it('defaults the port and omits an empty password', async () => {
    process.env.REDIS_HOST = 'redis.internal';
    const { pub } = makeRedisClient();
    createClient.mockReturnValue(pub);

    await initSocketAdapter({
      io: makeIo(),
      dataStore: { usePostgres: false, getPgPool: () => null }
    });

    expect(createClient).toHaveBeenCalledWith({
      socket: { host: 'redis.internal', port: 6379 },
      password: undefined
    });
  });

  it('reports failure without throwing when Redis cannot connect', async () => {
    process.env.REDIS_URL = 'redis://cache:6379';
    const { pub } = makeRedisClient(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    createClient.mockReturnValue(pub);
    const io = makeIo();

    const result = await initSocketAdapter({
      io,
      dataStore: { usePostgres: false, getPgPool: () => null }
    });

    // A dead Redis must not take the server down, and must not leave the
    // caller believing a cross-pod adapter is in place. `expected: true` is
    // what makes this distinguishable from the single-pod case below (H50).
    expect(result).toMatchObject({ active: false, expected: true, degraded: true });
    expect(io.adapter).not.toHaveBeenCalled();
  });
});

describe('initSocketAdapter — PostgreSQL', () => {
  it('creates the attachments table before wiring the Postgres adapter', async () => {
    const pgPool = { query: vi.fn().mockResolvedValue(undefined) };
    const io = makeIo();

    const result = await initSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => pgPool }
    });

    expect(result).toMatchObject({ active: true, expected: true, degraded: false });
    expect(pgPool.query).toHaveBeenCalledTimes(1);
    expect(pgPool.query.mock.calls[0][0]).toContain('socket_io_attachments');
    expect(createPostgresAdapter).toHaveBeenCalledWith(pgPool);
    expect(io.adapter).toHaveBeenCalledWith('postgres-adapter');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('reports failure when Postgres is selected but no pool exists', async () => {
    const io = makeIo();

    const result = await initSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => null }
    });

    expect(result).toMatchObject({ active: false, expected: true, degraded: true });
    expect(io.adapter).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when the table creation fails', async () => {
    const pgPool = { query: vi.fn().mockRejectedValue(new Error('permission denied')) };
    const io = makeIo();

    const result = await initSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => pgPool }
    });

    expect(result).toMatchObject({ active: false, expected: true, degraded: true });
    expect(io.adapter).not.toHaveBeenCalled();
  });
});

describe('initSocketAdapter — in-memory fallback', () => {
  it('leaves the default adapter in place for a single-pod deployment', async () => {
    const io = makeIo();

    const result = await initSocketAdapter({
      io,
      dataStore: { usePostgres: false, getPgPool: () => null }
    });

    // Not an error: the in-memory adapter is the right answer here, which is
    // exactly what `expected: false` and `degraded: false` record (H50).
    expect(result).toMatchObject({ active: false, expected: false, degraded: false });
    expect(io.adapter).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(createPostgresAdapter).not.toHaveBeenCalled();
  });
});

/**
 * Audit H50 — a pod that lost its cross-pod adapter still reports ready.
 *
 * The defect was not the failure, it was that the failure looked exactly like
 * the healthy single-pod case: `initSocketAdapter` returned `false` both when
 * no shared adapter was *configured* and when a configured one *failed*, so
 * nothing downstream could tell "this deployment does not need Redis" from
 * "this deployment needs Redis and does not have it". At `replicas: 2` the
 * second case means two pods stop sharing broadcasts while every probe stays
 * green and each participant sees only their own tickets.
 *
 * These tests pin the two halves of the fix that the tracker chose (option (a)
 * plus option (c), deliberately not (b)): the state is *distinguishable and
 * reported*, and a transient failure *heals itself*. Nothing here may make a
 * pod refuse traffic — that is option (b), and it turns degraded collaboration
 * into a total outage when both pods fail at once.
 */
describe('startSocketAdapter — degraded state (audit H50)', () => {
  type Runtime = { multiPodAdapter: boolean; socketAdapter?: { strategy: string; expected: boolean; active: boolean; degraded: boolean; attempts: number; gaveUp: boolean } };
  const makeRuntime = (): Runtime => ({ multiPodAdapter: false });

  /** Collects what would have been scheduled, so the retry runs on demand. */
  const makeSchedule = () => {
    const calls: { run: () => void; delayMs: number }[] = [];
    const schedule = (run: () => void, delayMs: number) => {
      calls.push({ run, delayMs });
      return { unref: vi.fn() };
    };
    return { calls, schedule };
  };

  it('does not call a single-pod deployment degraded', async () => {
    // No Redis config and no PostgreSQL: the in-memory adapter is the correct
    // answer, not a failure. This is the case that the old boolean conflated
    // with a real outage, so it is the one worth pinning first.
    const runtime = makeRuntime();
    const { calls, schedule } = makeSchedule();

    const status = await startSocketAdapter({
      io: makeIo(),
      dataStore: { usePostgres: false, getPgPool: () => null },
      runtime,
      schedule,
    });

    expect(status.strategy).toBe(SOCKET_ADAPTER_STRATEGIES.MEMORY);
    expect(status.expected).toBe(false);
    expect(status.degraded).toBe(false);
    expect(runtime.multiPodAdapter).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('marks a configured adapter that failed as degraded, and says so loudly', async () => {
    process.env.REDIS_URL = 'redis://cache:6379';
    const { pub } = makeRedisClient(vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    createClient.mockReturnValue(pub);
    const runtime = makeRuntime();
    const { schedule } = makeSchedule();

    const status = await startSocketAdapter({
      io: makeIo(),
      dataStore: { usePostgres: false, getPgPool: () => null },
      runtime,
      schedule,
    });

    expect(status.strategy).toBe(SOCKET_ADAPTER_STRATEGIES.REDIS);
    expect(status.expected).toBe(true);
    expect(status.active).toBe(false);
    expect(status.degraded).toBe(true);
    expect(runtime.multiPodAdapter).toBe(false);
    // Loud, because a pod log nobody greps is the whole failure mode here.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('DEGRADED'),
      expect.anything(),
    );
  });

  it('retries in the background and heals when the adapter comes back', async () => {
    const pgPool = {
      query: vi.fn()
        .mockRejectedValueOnce(new Error('permission denied for schema public'))
        .mockResolvedValueOnce(undefined),
    };
    const runtime = makeRuntime();
    const { calls, schedule } = makeSchedule();
    const io = makeIo();

    const first = await startSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => pgPool },
      runtime,
      schedule,
    });

    expect(first.degraded).toBe(true);
    expect(runtime.multiPodAdapter).toBe(false);
    expect(calls).toHaveLength(1);

    await calls[0].run();

    expect(runtime.socketAdapter.active).toBe(true);
    expect(runtime.socketAdapter.degraded).toBe(false);
    expect(runtime.multiPodAdapter).toBe(true);
    expect(io.adapter).toHaveBeenCalledWith('postgres-adapter');
    // Healed: nothing further scheduled.
    expect(calls).toHaveLength(1);
  });

  it('backs off between attempts and stops before it can flood the log ring', async () => {
    const pgPool = { query: vi.fn().mockRejectedValue(new Error('permission denied')) };
    const runtime = makeRuntime();
    const { calls, schedule } = makeSchedule();

    await startSocketAdapter({
      io: makeIo(),
      dataStore: { usePostgres: true, getPgPool: () => pgPool },
      runtime,
      schedule,
      retryBaseMs: 1000,
      retryMaxMs: 4000,
      maxAttempts: 4,
    });

    // Drain every retry the supervisor schedules.
    for (let index = 0; index < calls.length; index += 1) {
      await calls[index].run();
    }

    expect(calls.map((call) => call.delayMs)).toEqual([1000, 2000, 4000]);
    expect(runtime.socketAdapter.attempts).toBe(4);
    expect(runtime.socketAdapter.gaveUp).toBe(true);
    // Still degraded, still serving: giving up on the *retry* must never be
    // confused with giving up on the pod.
    expect(runtime.socketAdapter.degraded).toBe(true);
    expect(runtime.multiPodAdapter).toBe(false);
  });

  it('re-joins live sockets to their rooms when a retry swaps the adapter in', async () => {
    // `io.adapter()` replaces the adapter instance on every namespace, and the
    // replacement starts with empty room bookkeeping. At startup nothing is
    // connected, so it does not matter; on a *retry* every socket that joined a
    // session during the degraded window keeps its connection and silently
    // stops receiving broadcasts. That is H50's own failure mode reintroduced
    // by H50's fix, which is why the membership is carried across the swap.
    const pgPool = {
      query: vi.fn()
        .mockRejectedValueOnce(new Error('permission denied for schema public'))
        .mockResolvedValueOnce(undefined),
    };
    const join = vi.fn();
    const live = { id: 'sock-1', connected: true, rooms: new Set(['sock-1', 'session-42']), join };
    const io = { ...makeIo(), sockets: { sockets: new Map([['sock-1', live]]) } };
    const { calls, schedule } = makeSchedule();

    await startSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => pgPool },
      runtime: makeRuntime(),
      schedule,
    });

    expect(join).not.toHaveBeenCalled();

    await calls[0].run();

    // Its own id room included: Socket.IO joins that on connect and routes
    // `io.to(socketId)` through it, so a faithful restore keeps it.
    expect(join).toHaveBeenCalledWith(['sock-1', 'session-42']);
  });

  it('does not fail the recovery when a socket dropped during the swap', async () => {
    const pgPool = {
      query: vi.fn()
        .mockRejectedValueOnce(new Error('permission denied'))
        .mockResolvedValueOnce(undefined),
    };
    const goneJoin = vi.fn(() => { throw new Error('socket closed'); });
    const liveJoin = vi.fn();
    const io = {
      ...makeIo(),
      sockets: {
        sockets: new Map<string, unknown>([
          ['gone', { id: 'gone', connected: true, rooms: new Set(['gone']), join: goneJoin }],
          ['live', { id: 'live', connected: true, rooms: new Set(['live', 'session-7']), join: liveJoin }],
        ]),
      },
    };
    const runtime = makeRuntime();
    const { calls, schedule } = makeSchedule();

    await startSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => pgPool },
      runtime,
      schedule,
    });
    await calls[0].run();

    // One socket throwing must not cost the rest of the room its membership,
    // and must not turn a successful recovery into a failed one.
    expect(liveJoin).toHaveBeenCalledWith(['live', 'session-7']);
    expect(runtime.socketAdapter.active).toBe(true);
    expect(runtime.socketAdapter.degraded).toBe(false);
  });

  it('releases the half-open Redis clients it failed to connect', async () => {
    // node-redis keeps its own reconnect loop alive after a rejected connect(),
    // so a retry that simply built new clients would stack a looping pair per
    // attempt — a self-healing feature that leaks until the pod restarts.
    process.env.REDIS_URL = 'redis://cache:6379';
    const destroy = vi.fn();
    const connect = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const sub = { connect, destroy };
    const pub = { connect, duplicate: vi.fn(() => sub), destroy };
    createClient.mockReturnValue(pub);

    await startSocketAdapter({
      io: makeIo(),
      dataStore: { usePostgres: false, getPgPool: () => null },
      runtime: makeRuntime(),
      schedule: makeSchedule().schedule,
    });

    expect(destroy).toHaveBeenCalledTimes(2);
  });
});
