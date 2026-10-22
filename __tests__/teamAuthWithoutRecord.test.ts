import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createDataStore } from '../server/services/dataStore.js';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';
import { hashPassword } from '../server/services/passwordHashing.js';

/**
 * A live session persists the whole retro to the team record on every gesture.
 * Authenticating that write used to load the team record — parse its whole
 * history — only to check a session token that needs nothing but the team's
 * id, after which the write parsed the record again. At about 60 ms per MB on
 * PostgreSQL, a third of every persist went to a parse whose result was
 * thrown away.
 *
 * A caller that only needs the verdict says so (`needsTeam: false`), and a
 * valid token is then checked against the record's existence alone. The
 * answers must not change: a deleted team is still `team_not_found`, a
 * password is still verified against the stored hash.
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

const PASSWORD = 'correct-horse-battery';

// `session-<team>` reads as a token from before decision D3b (no epoch claim,
// no issue time), `epoch.<team>.<epoch>` as one minted under that epoch (an
// epoch is base64url, which has `-` and `_` but never `.`).
const tokenService = {
  createSessionToken: (teamId: string) => `session-${teamId}`,
  validateSessionToken: (token: string) => {
    if (token?.startsWith('epoch.')) {
      const [, teamId, sessionEpoch] = token.split('.');
      return { teamId, sessionEpoch, createdAt: Date.now() };
    }
    return token?.startsWith('session-') ? { teamId: token.slice('session-'.length) } : null;
  },
  invalidateSessionToken: () => {},
  createInviteCredential: () => 'invite',
  validateInviteCredential: () => null,
  validateSuperAdminAuth: () => false
};

describe('authenticating a write without loading the team record', () => {
  let dir: string;
  let dataStore: ReturnType<typeof createDataStore>;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of PG_ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    dir = mkdtempSync(join(tmpdir(), 'retro-auth-'));
    process.env.DATA_STORE_PATH = join(dir, 'data.sqlite');
    dataStore = createDataStore({ rootDir: dir });
    await dataStore.initDatabase();
    await dataStore.saveTeam('t1', { id: 't1', name: 'Alpha', passwordHash: await hashPassword(PASSWORD), retrospectives: [] });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await dataStore.closeDatabase();
    rmSync(dir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('teamService.authenticateTeam', () => {
    it('accepts a valid token without reading the record', async () => {
      const { authenticateTeam } = createTeamService({ dataStore, tokenService });
      const loadTeam = vi.spyOn(dataStore, 'loadTeam');

      expect(await authenticateTeam('t1', undefined, 'session-t1', { needsTeam: false }))
        .toEqual({ team: null, error: null, via: 'session-token' });
      expect(loadTeam).not.toHaveBeenCalled();
    });

    it('still answers team_not_found for a valid token whose team is gone', async () => {
      const { authenticateTeam } = createTeamService({ dataStore, tokenService });
      await dataStore.deleteTeamRecord('t1');

      expect(await authenticateTeam('t1', undefined, 'session-t1', { needsTeam: false }))
        .toEqual({ team: null, error: 'team_not_found' });
    });

    it('still verifies a password against the stored hash', async () => {
      const { authenticateTeam } = createTeamService({ dataStore, tokenService });

      expect((await authenticateTeam('t1', PASSWORD, undefined, { needsTeam: false })).error).toBeNull();
      expect((await authenticateTeam('t1', 'wrong-password-here', undefined, { needsTeam: false })).error).toBe('invalid_password');
      // A token minted for another team is no credential here.
      expect((await authenticateTeam('t1', undefined, 'session-t2', { needsTeam: false })).error).toBe('invalid_token');
    });

    it('returns the team to a caller that did not opt out', async () => {
      const { authenticateTeam } = createTeamService({ dataStore, tokenService });

      const result = await authenticateTeam('t1', undefined, 'session-t1');
      expect(result.error).toBeNull();
      expect(result.team).toMatchObject({ id: 't1', name: 'Alpha' });
    });
  });

  describe('the persist routes of a live session', () => {
    let baseUrl: string;
    let close: () => Promise<void>;

    beforeEach(async () => {
      const app = express();
      app.use(express.json({ limit: '10mb' }));
      registerTeamRoutes({
        app,
        dataStore,
        teamService: createTeamService({ dataStore, tokenService }),
        tokenService,
        mailerService: { smtpEnabled: false, mailer: null },
        logService: { addServerLog: () => {} },
        escapeHtml: (s: string) => s
      });
      await new Promise<void>((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => {
          baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
          close = () => new Promise((res) => server.close(() => res()));
          resolve();
        });
      });
    });

    afterEach(async () => {
      await close();
    });

    const post = (path: string, body: unknown) =>
      fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    it.each([
      ['a retrospective', '/api/team/t1/retrospective/r1', { retrospective: { id: 'r1', name: 'Sprint 1', _rev: 1 } }, 'retrospectives'],
      ['a health check', '/api/team/t1/healthcheck/h1', { healthCheck: { id: 'h1', name: 'Health 1', _rev: 1 } }, 'healthChecks']
    ])('persist %s with a token, reading the record only to write it', async (_label, path, body, collection) => {
      const loadTeam = vi.spyOn(dataStore, 'loadTeam');

      const res = await post(path, { sessionToken: 'session-t1', ...body });

      expect(res.status).toBe(200);
      expect(loadTeam).not.toHaveBeenCalled();
      const stored = await dataStore.loadTeamRaw('t1');
      expect(stored[collection]).toHaveLength(1);
    });

    it('refuses a token whose team is gone with the same answer as before', async () => {
      await dataStore.deleteTeamRecord('t1');

      const res = await post('/api/team/t1/retrospective/r1', { sessionToken: 'session-t1', retrospective: { id: 'r1', _rev: 1 } });

      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'team_not_found' });
    });

    // Decision D3b: the epoch check reads the team's small auth row, never
    // the record, so a rotation brings back no parse on the hot path.
    describe('after a password rotation (decision D3b)', () => {
      let currentEpoch: string;

      beforeEach(async () => {
        currentEpoch = (await dataStore.rotateTeamSessionEpoch('t1')).sessionEpoch;
      });

      it('refuses a token minted under the old epoch without reading the record', async () => {
        const loadTeam = vi.spyOn(dataStore, 'loadTeam');

        const res = await post('/api/team/t1/retrospective/r1', { sessionToken: 'epoch.t1.old', retrospective: { id: 'r1', _rev: 1 } });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'session_revoked' });
        expect(loadTeam).not.toHaveBeenCalled();
      });

      it('accepts the current epoch with one auth read and no record read', async () => {
        const loadTeam = vi.spyOn(dataStore, 'loadTeam');
        const loadTeamAuthState = vi.spyOn(dataStore, 'loadTeamAuthState');

        const res = await post('/api/team/t1/retrospective/r1', { sessionToken: `epoch.t1.${currentEpoch}`, retrospective: { id: 'r1', _rev: 1 } });

        expect(res.status).toBe(200);
        expect(loadTeam).not.toHaveBeenCalled();
        expect(loadTeamAuthState).toHaveBeenCalledTimes(1);
      });

      it('answers a revoked token sent alone on a route that needs the team before parsing the record', async () => {
        // Right after a rotation every invite-link participant's in-flight
        // write arrives with a revoked token and no password: each of them
        // used to fall through to a full parse of the team's history only to
        // be refused.
        const loadTeam = vi.spyOn(dataStore, 'loadTeam');

        const res = await post('/api/team/t1', { sessionToken: 'epoch.t1.old' });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'session_revoked' });
        expect(loadTeam).not.toHaveBeenCalled();
      });

      it('answers session_revoked, after one record read, for a revoked token beside the old password', async () => {
        const rotatedHash = await hashPassword('the-new-team-password');
        await dataStore.atomicTeamUpdate('t1', (team: Record<string, unknown>) => ({ ...team, passwordHash: rotatedHash }));
        const loadTeam = vi.spyOn(dataStore, 'loadTeam');

        const res = await post('/api/team/t1', { sessionToken: 'epoch.t1.old', password: PASSWORD });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'session_revoked' });
        expect(loadTeam).toHaveBeenCalledTimes(1);
      });

      it('still refuses a token from before the release once the team has rotated after it', async () => {
        // The double's legacy token has no issue time: it predates everything.
        const res = await post('/api/team/t1/retrospective/r1', { sessionToken: 'session-t1', retrospective: { id: 'r1', _rev: 1 } });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'session_revoked' });
      });
    });
  });
});
