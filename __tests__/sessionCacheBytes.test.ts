// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createBoundedCache, jsonLength } from '../server/services/boundedCache.js';
import { registerSocketHandlers } from '../server/services/socketHandlers.js';
import { createTestTokenService } from './helpers/socketAuth';

/**
 * The session cache's byte cap must cost nothing on the hot paths. A join is
 * the reconnect-stampede path, and it already pays one parse of the session;
 * measuring the blob there with a second `JSON.stringify` per joiner would put
 * the cap's price exactly where a rolling update hurts most. The store
 * remembers the text length of every session it parsed or wrote, and the cache
 * asks it — so across a join, an accepted write and a stale refusal, the
 * cache's own measuring function is never called, and the total it keeps is
 * the length of the stored row.
 */

const tokenService = createTestTokenService();
const teamToken = tokenService.createSessionToken('teamC', null);

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

type Json = Record<string, unknown>;
const SESSION_ID = 'bytes-session';

const once = <T = unknown>(socket: Socket, event: string, timeout = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

describe('session cache sizes on the hot paths (integration)', () => {
  let dataStore: ReturnType<typeof createDataStore>;
  let httpServer: HttpServer;
  let io: Server;
  let port: number;
  let dir: string;
  let sessionCache: ReturnType<typeof createBoundedCache>;
  const sizeOf = vi.fn(jsonLength);
  const savedEnv: Record<string, string | undefined> = {};
  const clients: Socket[] = [];

  beforeAll(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-cache-bytes-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    await dataStore.saveTeam('teamC', {
      id: 'teamC',
      name: 'Team C',
      passwordHash: 'x',
      members: [
        { id: 'fac1', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' },
        { id: 'par1', name: 'Paul', color: 'bg-rose-500', role: 'participant' }
      ],
      retrospectives: [],
      healthChecks: [],
      globalActions: []
    });
    await dataStore.saveSessionState(SESSION_ID, {
      id: SESSION_ID,
      teamId: 'teamC',
      name: 'Rétro «C»',
      phase: 'BRAINSTORM',
      columns: [{ id: 'c1', title: 'Went well' }],
      settings: { isAnonymous: false, maxVotes: 3, revealBrainstorm: false, timerInitial: 300, timerRunning: false },
      tickets: [],
      groups: [],
      actions: []
    });

    sessionCache = createBoundedCache({ max: 100, maxBytes: 64 * 2 ** 20, sizeHint: dataStore.sessionTextLength, sizeOf });
    httpServer = createServer();
    io = new Server(httpServer, { path: '/socket.io' });
    registerSocketHandlers({ io, dataStore, sessionCache, tokenService });
    await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
    port = (httpServer.address() as { port: number }).port;
  });

  afterAll(async () => {
    clients.forEach((c) => c.close());
    io.close();
    await new Promise<void>((res) => httpServer.close(() => res()));
    await dataStore.closeDatabase();
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
    const socket = ioClient(`http://127.0.0.1:${port}`, { path: '/socket.io', transports: ['websocket'], reconnection: false });
    clients.push(socket);
    await once(socket, 'connect');
    return socket;
  };

  it('never serializes a session to size it across a join, an accepted write and a stale refusal', async () => {
    const storedLength = (): number =>
      dataStore.getSqliteDb()!.prepare('SELECT value FROM kv_store WHERE key = ?').get(`session:${SESSION_ID}`).value.length;

    const paul = await connect();
    paul.emit('join-session', { sessionId: SESSION_ID, userId: 'par1', userName: 'Paul', sessionToken: teamToken });
    const initial = await once<Json>(paul, 'session-update');
    expect(sessionCache.bytes).toBe(storedLength());

    paul.emit('update-session', { ...structuredClone(initial), tickets: [{ id: 't1', colId: 'c1', text: 'Café', authorId: 'par1', groupId: null, votes: [] }] });
    await once(paul, 'session-ack');
    expect(sessionCache.bytes).toBe(storedLength());

    // Built on the revision before the one just accepted.
    paul.emit('update-session', { ...structuredClone(initial), tickets: [] });
    await once(paul, 'session-update-refused');
    expect(sessionCache.bytes).toBe(storedLength());

    expect(sizeOf).not.toHaveBeenCalled();
  }, 20000);
});
