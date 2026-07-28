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

    expect(result).toBe(true);
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
    // caller believing a cross-pod adapter is in place.
    expect(result).toBe(false);
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

    expect(result).toBe(true);
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

    expect(result).toBe(false);
    expect(io.adapter).not.toHaveBeenCalled();
  });

  it('reports failure without throwing when the table creation fails', async () => {
    const pgPool = { query: vi.fn().mockRejectedValue(new Error('permission denied')) };
    const io = makeIo();

    const result = await initSocketAdapter({
      io,
      dataStore: { usePostgres: true, getPgPool: () => pgPool }
    });

    expect(result).toBe(false);
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

    // `false` here means "no cross-pod adapter", not an error.
    expect(result).toBe(false);
    expect(io.adapter).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(createPostgresAdapter).not.toHaveBeenCalled();
  });
});
