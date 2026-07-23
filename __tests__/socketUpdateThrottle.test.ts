// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createBoundedCache } from '../server/services/boundedCache.js';
import {
  registerSocketHandlers,
  validateSessionUpdateShape,
  consumeUpdateToken,
  parseUpdateThrottleConfig
} from '../server/services/socketHandlers.js';

// Audit PR-12: per-socket `update-session` flood protection + cheap top-level
// shape validation. The shape check also closes a revision-poisoning gap:
// saveSessionState coerces `_rev` with Number(), so a crafted non-finite `_rev`
// ("abc", 1e999) would store NaN/Infinity as the session revision and disrupt
// the optimistic-concurrency CAS. The throttle is disabled by default (rate 0)
// and, when enabled, heals a throttled sender from cache instead of dropping.

describe('validateSessionUpdateShape (unit)', () => {
  it('accepts a well-formed blob with a finite numeric _rev', () => {
    expect(validateSessionUpdateShape({ _rev: 5, phase: 'BRAINSTORM' }, 's1')).toBeNull();
  });

  it('accepts a blob with no _rev (treated as 0 downstream)', () => {
    expect(validateSessionUpdateShape({ phase: 'BRAINSTORM' }, 's1')).toBeNull();
    expect(validateSessionUpdateShape({ _rev: null }, 's1')).toBeNull();
    expect(validateSessionUpdateShape({ _rev: undefined }, 's1')).toBeNull();
  });

  it('accepts a matching blob id', () => {
    expect(validateSessionUpdateShape({ id: 's1', _rev: 1 }, 's1')).toBeNull();
  });

  it('rejects non-object payloads', () => {
    expect(validateSessionUpdateShape(null, 's1')).toBeTruthy();
    expect(validateSessionUpdateShape(42 as unknown as object, 's1')).toBeTruthy();
    expect(validateSessionUpdateShape('str' as unknown as object, 's1')).toBeTruthy();
    expect(validateSessionUpdateShape([1, 2, 3] as unknown as object, 's1')).toBeTruthy();
  });

  it('rejects a blob claiming a different session id', () => {
    expect(validateSessionUpdateShape({ id: 'other', _rev: 1 }, 's1')).toContain('does not match');
  });

  it('rejects a non-finite _rev that would poison the CAS counter', () => {
    expect(validateSessionUpdateShape({ _rev: 'abc' }, 's1')).toBe('non-finite _rev');
    expect(validateSessionUpdateShape({ _rev: Infinity }, 's1')).toBe('non-finite _rev');
    expect(validateSessionUpdateShape({ _rev: NaN }, 's1')).toBe('non-finite _rev');
    expect(validateSessionUpdateShape({ _rev: {} }, 's1')).toBe('non-finite _rev');
    expect(validateSessionUpdateShape({ _rev: [1] }, 's1')).toBe('non-finite _rev');
  });
});

describe('parseUpdateThrottleConfig (unit)', () => {
  it('is disabled by default (rate 0)', () => {
    expect(parseUpdateThrottleConfig({})).toEqual({ rate: 0, burst: 1 });
  });

  it('reads a positive rate and derives a burst of 2x when unset', () => {
    expect(parseUpdateThrottleConfig({ SOCKET_UPDATE_RATE: '20' })).toEqual({ rate: 20, burst: 40 });
  });

  it('honors an explicit burst', () => {
    expect(parseUpdateThrottleConfig({ SOCKET_UPDATE_RATE: '10', SOCKET_UPDATE_BURST: '15' }))
      .toEqual({ rate: 10, burst: 15 });
  });

  it('treats invalid or non-positive rates as disabled', () => {
    expect(parseUpdateThrottleConfig({ SOCKET_UPDATE_RATE: '0' }).rate).toBe(0);
    expect(parseUpdateThrottleConfig({ SOCKET_UPDATE_RATE: '-5' }).rate).toBe(0);
    expect(parseUpdateThrottleConfig({ SOCKET_UPDATE_RATE: 'nope' }).rate).toBe(0);
  });
});

describe('consumeUpdateToken (unit)', () => {
  it('always allows when rate is 0 (disabled) and never touches the bucket', () => {
    const bucket: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      expect(consumeUpdateToken(bucket, { rate: 0, burst: 5 }, 1000)).toBe(true);
    }
    expect(bucket.tokens).toBeUndefined();
  });

  it('allows up to the burst, then throttles until tokens refill', () => {
    const bucket: Record<string, number> = {};
    const config = { rate: 1, burst: 3 };
    // First three at the same instant succeed (bucket starts full at burst).
    expect(consumeUpdateToken(bucket, config, 1000)).toBe(true);
    expect(consumeUpdateToken(bucket, config, 1000)).toBe(true);
    expect(consumeUpdateToken(bucket, config, 1000)).toBe(true);
    // Fourth in the same instant is throttled.
    expect(consumeUpdateToken(bucket, config, 1000)).toBe(false);
    // After 1 second, one token has refilled (rate = 1/s).
    expect(consumeUpdateToken(bucket, config, 2000)).toBe(true);
    expect(consumeUpdateToken(bucket, config, 2000)).toBe(false);
  });

  it('never accumulates beyond the burst ceiling', () => {
    const bucket: Record<string, number> = {};
    const config = { rate: 5, burst: 5 };
    // Prime, then idle a long time: tokens cap at burst, not rate*elapsed.
    consumeUpdateToken(bucket, config, 0);
    consumeUpdateToken(bucket, config, 1_000_000); // huge gap
    expect(bucket.tokens).toBeLessThanOrEqual(5);
  });
});

const PG_ENV_KEYS = [
  'DATABASE_URL',
  'POSTGRES_HOST',
  'POSTGRESQL_SERVICE_HOST',
  'POSTGRES_USER',
  'POSTGRESQL_USER',
  'POSTGRES_PASSWORD',
  'POSTGRESQL_PASSWORD',
  'POSTGRES_DB',
  'POSTGRESQL_DATABASE',
  'DATA_STORE_PATH'
];

type SessionBlob = Record<string, unknown>;

const once = <T = unknown>(socket: Socket, event: string, timeout = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms = 350) => new Promise((r) => setTimeout(r, ms));

const baseSession = (id: string, overrides: SessionBlob = {}): SessionBlob => ({
  id,
  teamId: 'teamA',
  name: 'Sprint Retro',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  columns: [{ id: 'c1', title: 'Went well' }],
  settings: { maxVotes: 3, timerRunning: false },
  tickets: [],
  actions: [],
  happiness: {},
  finishedUsers: [],
  _rev: 0,
  ...overrides
});

describe('update-session throttle + shape (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedEnv.SOCKET_UPDATE_RATE = process.env.SOCKET_UPDATE_RATE;
    savedEnv.SOCKET_UPDATE_BURST = process.env.SOCKET_UPDATE_BURST;
    // Rate ~0 so no tokens refill during the test window: deterministically
    // exactly `burst` writes get through, the rest are throttled.
    process.env.SOCKET_UPDATE_RATE = '0.0001';
    process.env.SOCKET_UPDATE_BURST = '3';

    dir = mkdtempSync(join(tmpdir(), 'retro-throttle-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');

    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();

    await dataStore.saveTeam('teamA', {
      id: 'teamA',
      name: 'Team A',
      passwordHash: 'x',
      members: [{ id: 'fac1', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' }],
      customTemplates: [],
      retrospectives: [],
      healthChecks: [],
      globalActions: [],
      teamFeedbacks: []
    });

    httpServer = createServer();
    io = new Server(httpServer, { path: '/socket.io' });
    registerSocketHandlers({ io, dataStore, sessionCache: createBoundedCache({ max: 100 }) });
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
    port = (httpServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    io.close();
    await new Promise<void>((res) => httpServer.close(() => res()));
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const connect = async (): Promise<Socket> => {
    const socket = ioClient(`http://127.0.0.1:${port}`, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false
    });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  };

  const joinSession = async (socket: Socket, sessionId: string, userId: string, userName: string) => {
    socket.emit('join-session', { sessionId, userId, userName });
    await once(socket, 'member-roster');
  };

  it('throttles a rapid flood past the burst and heals the sender from cache instead of dropping', async () => {
    const fiona = await connect();
    await joinSession(fiona, 'throttle-flood', 'fac1', 'Fiona');

    // Establish the session first so the cache is populated (the realistic
    // steady state where a throttled write can be healed). This consumes one
    // of the burst=3 tokens, leaving 2 for the flood below.
    fiona.emit('update-session', baseSession('throttle-flood', { _rev: 1 }));
    await once(fiona, 'session-ack');

    let acks = 0;
    let heals = 0;
    fiona.on('session-ack', () => { acks += 1; });
    fiona.on('session-update', () => { heals += 1; });

    // Five valid writes fired back-to-back with monotonically increasing revs
    // (so none is stale — throttling is the only thing that can reject them).
    for (let i = 0; i < 5; i++) {
      fiona.emit('update-session', baseSession('throttle-flood', {
        _rev: 100 + i,
        tickets: [{ id: `t${i}`, colId: 'c1', text: `idea ${i}`, authorId: 'fac1', groupId: null, votes: [] }]
      }));
    }

    await settle();

    // 2 remaining tokens → exactly two flood writes accepted (acked), three
    // throttled and healed with the cached authoritative state (never dropped).
    expect(acks).toBe(2);
    expect(heals).toBe(3);

    // The database advanced only for the accepted writes; the flood never hit
    // it beyond the budget (establish rev 2, then two accepted flood writes).
    const stored = await dataStore.loadSessionState('throttle-flood') as SessionBlob;
    expect(Number(stored._rev)).toBe(102);
  }, 20000);

  it('ignores a crafted non-finite _rev so it cannot poison the revision counter', async () => {
    const fiona = await connect();
    await joinSession(fiona, 'throttle-rev', 'fac1', 'Fiona');

    // First, a legitimate write establishes a numeric revision.
    fiona.emit('update-session', baseSession('throttle-rev', { _rev: 1 }));
    const firstAck = await once<{ rev: number }>(fiona, 'session-ack');
    expect(Number.isFinite(firstAck.rev)).toBe(true);

    let acksAfter = 0;
    fiona.on('session-ack', () => { acksAfter += 1; });

    // Crafted blobs whose _rev would coerce to NaN are dropped before the CAS.
    fiona.emit('update-session', baseSession('throttle-rev', { _rev: 'abc' as unknown as number }));
    fiona.emit('update-session', baseSession('throttle-rev', { _rev: {} as unknown as number }));
    await settle();

    expect(acksAfter).toBe(0); // neither crafted write was accepted

    // The stored revision is still a finite number, and a normal write still works.
    const stored = await dataStore.loadSessionState('throttle-rev') as SessionBlob;
    expect(Number.isFinite(Number(stored._rev))).toBe(true);
    expect(Number.isNaN(Number(stored._rev))).toBe(false);
  }, 20000);
});
