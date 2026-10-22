// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { io as ioClient, Socket } from 'socket.io-client';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createBoundedCache } from '../server/services/boundedCache.js';
import { registerSocketHandlers } from '../server/services/socketHandlers.js';
import { createTestTokenService } from './helpers/socketAuth';

/**
 * A live session on a team whose record PostgreSQL's jsonb refuses.
 *
 * The team record is stored as text and every writer goes through Node, whose
 * `JSON.stringify` writes a lone UTF-16 surrogate as the escape `\ud83d` and a
 * NUL as `\u0000`. `JSON.parse` reads both back; `value::jsonb` refuses both
 * ("Unicode low surrogate must follow a high surrogate", "\u0000 cannot be
 * converted to text"). Such a row is not exotic: an action's context is a
 * ticket excerpt, and an excerpt cut through an emoji ends in half of it.
 *
 * The socket reads the joiner's role from the team summary, a `::jsonb`
 * projection on PostgreSQL. On such a row it throws, and the role used to be
 * 'unknown' on every join and every write: the facilitator could change
 * neither the phase nor the reveal, nor anything else facilitator-only, in any
 * session of the team, until someone repaired the row by hand. The roster now
 * falls back to the full record, which Node parses.
 *
 * SQLite always runs (its `json_extract` accepts both escapes, so this is the
 * ordinary path there). The case that matters runs against a real PostgreSQL
 * when `TEST_DATABASE_URL` is set, e.g.
 * `TEST_DATABASE_URL=postgres://user:pass@localhost/db npx vitest run --no-file-parallelism __tests__/socketJoinUnreadableSummary.test.ts`.
 */

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

const once = <T = unknown>(socket: Socket, event: string, timeout = 5000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeout);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

const engines: { name: string; enabled: boolean; setup: () => string }[] = [
  {
    name: 'SQLite',
    enabled: true,
    setup: () => {
      const dir = mkdtempSync(join(tmpdir(), 'retro-unreadable-summary-'));
      process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
      return dir;
    }
  },
  {
    name: 'PostgreSQL',
    enabled: !!process.env.TEST_DATABASE_URL,
    setup: () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      return mkdtempSync(join(tmpdir(), 'retro-unreadable-summary-pg-'));
    }
  }
];

for (const engine of engines) {
  describe.skipIf(!engine.enabled)(`a join on a team record jsonb refuses (${engine.name})`, () => {
    const isPg = engine.name === 'PostgreSQL';
    const prefix = `us${Date.now().toString(36)}`;
    const teamId = `${prefix}-team`;
    const sessionId = `${prefix}-session`;
    const tokenService = createTestTokenService();
    const teamToken = tokenService.createSessionToken(teamId, null);
    const savedEnv: Record<string, string | undefined> = {};
    const clients: Socket[] = [];
    let store: ReturnType<typeof createDataStore>;
    let dir: string;
    let httpServer: HttpServer;
    let io: Server;
    let port: number;

    const session = (overrides: Json = {}): Json => ({
      id: sessionId,
      teamId,
      name: 'Sprint 13 Retro',
      date: '2026-10-22',
      status: 'IN_PROGRESS',
      phase: 'BRAINSTORM',
      columns: [{ id: 'c1', title: 'Went well' }],
      settings: { isAnonymous: false, maxVotes: 3, revealBrainstorm: false, timerInitial: 300, timerRunning: false },
      tickets: [],
      groups: [],
      actions: [],
      happiness: {},
      finishedUsers: [],
      ...overrides
    });

    beforeAll(async () => {
      for (const key of PG_ENV_KEYS) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
      dir = engine.setup();
      store = createDataStore({ rootDir: dir });
      await store.initDatabase();
      await store.saveTeam(teamId, {
        id: teamId,
        name: `Team ${prefix}`,
        passwordHash: 'x',
        members: [
          { id: 'fac1', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' },
          { id: 'par1', name: 'Paul', color: 'bg-rose-500', role: 'participant' }
        ],
        retrospectives: [
          {
            id: `${prefix}-r1`,
            name: 'Sprint 12 Retro',
            tickets: [{ id: 'k1', colId: 'c1', text: `${'a'.repeat(49)}😀 and more`, authorId: 'par1', votes: [] }],
            groups: [],
            // What a 40.x or 41.0 client stored: the excerpt cut by UTF-16
            // unit, keeping the high half of the emoji, and a NUL pasted in.
            openActionsSnapshot: [{ id: 'a1', text: 'Fix it', contextText: `Re: ${'a'.repeat(49)}\ud83d...` }],
            actions: [{ id: 'a2', text: 'nul\u0000byte' }]
          }
        ],
        healthChecks: [],
        globalActions: [],
        teamFeedbacks: []
      });
      await store.saveSessionState(sessionId, session());

      if (isPg) {
        // The precondition, proved rather than assumed: the stored text is one
        // the cast refuses, and the summary read throws on it.
        await expect(
          store.getPgPool().query('SELECT value::jsonb FROM kv_store WHERE key = $1', [`team:${teamId}`])
        ).rejects.toMatchObject({ code: expect.stringMatching(/^22P0[25]$/) });
        await expect(store.loadTeamSummary(teamId)).rejects.toBeTruthy();
      }

      httpServer = createServer();
      io = new Server(httpServer, { path: '/socket.io' });
      registerSocketHandlers({ io, dataStore: store, sessionCache: createBoundedCache({ max: 100 }), tokenService });
      await new Promise<void>((res) => httpServer.listen(0, '127.0.0.1', () => res()));
      port = (httpServer.address() as { port: number }).port;
    });

    afterAll(async () => {
      clients.forEach((c) => c.close());
      io?.close();
      if (httpServer) await new Promise<void>((res) => httpServer.close(() => res()));
      if (store) {
        await store.deleteTeamRecord(teamId).catch(() => {});
        if (isPg) await store.getPgPool().query('DELETE FROM kv_store WHERE key = $1', [`session:${sessionId}`]).catch(() => {});
        await store.closeDatabase();
      }
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

    it('still knows who the facilitator is', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const fiona = await connect();
        const paul = await connect();
        const fionaInitial = once<Json>(fiona, 'session-update');
        const paulInitial = once<Json>(paul, 'session-update');
        fiona.emit('join-session', { sessionId, userId: 'fac1', userName: 'Fiona', sessionToken: teamToken });
        paul.emit('join-session', { sessionId, userId: 'par1', userName: 'Paul', sessionToken: teamToken });
        const state = await fionaInitial;
        await paulInitial;
        await settle();

        // A participant is still a participant: the phase is put back, the
        // card lands.
        paul.emit('update-session', {
          ...structuredClone(state),
          phase: 'GROUP',
          tickets: [{ id: 't1', colId: 'c1', text: 'Card', authorId: 'par1', groupId: null, votes: [] }]
        });
        const paulAck = await once<{ rev: number }>(paul, 'session-ack');
        const afterParticipant = (await store.loadSessionState(sessionId)) as Json;
        expect(afterParticipant).toMatchObject({ phase: 'BRAINSTORM', _rev: paulAck.rev });
        expect(afterParticipant.tickets).toHaveLength(1);

        // The facilitator's phase change lands whole.
        fiona.emit('update-session', { ...structuredClone(afterParticipant), phase: 'GROUP' });
        const fionaAck = await once<{ rev: number }>(fiona, 'session-ack');
        expect(await store.loadSessionState(sessionId)).toMatchObject({ phase: 'GROUP', _rev: fionaAck.rev });
      } finally {
        warn.mockRestore();
      }
    }, 30000);
  });
}
