import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import { createTeamService } from '../server/services/teamService.js';
import { registerTeamRoutes } from '../server/routes/teamRoutes.js';

/**
 * Incident ISS (2026-10-12), the same class closed for the remaining lists.
 *
 * `/api/team/:teamId/update` replaced whatever list a caller sent wholesale,
 * with no revision to check against. After the retrospectives, health checks
 * and actions, three lists were still written that way: the custom retro
 * templates, the custom health-check templates and the team feedbacks. A tab
 * left open on an old Dashboard that added or deleted a template therefore
 * erased every template added elsewhere since it loaded.
 *
 * Templates are now added and removed one at a time on their own routes, and
 * `/update` no longer replaces any of the three lists: it ignores the
 * feedbacks (owned by `/api/feedbacks/*`) and merges the two template lists
 * add-only, because the previous release — still open in tabs through a
 * rolling update — saves a template only that way. A retro template has no id
 * and its name is not unique, so it is deleted by content: a caller can only
 * delete a template it has actually seen.
 */

type Team = Record<string, unknown> & { id: string; name: string; passwordHash: string };
type Column = Record<string, unknown> & { id: string; title: string };
type RetroTemplate = { name: string; cols: Column[] };
type HcTemplate = { id: string; name: string; dimensions: unknown[]; isDefault?: boolean };

const createMockDataStore = () => {
  const teams = new Map<string, Team>();
  const indexMap = new Map<string, string>();
  const control = { failNextUpdates: 0 };

  const atomicTeamUpdate = async (teamId: string, updater: (team: Team) => Team | null) => {
    if (control.failNextUpdates > 0) {
      control.failNextUpdates -= 1;
      return { success: false, error: 'max_retries_exceeded' };
    }
    const existing = teams.get(teamId);
    if (!existing) return { success: false, error: 'team_not_found' };
    const updated = updater(structuredClone(existing));
    if (!updated) return { success: true, team: existing };
    teams.set(teamId, structuredClone(updated));
    return { success: true, team: updated };
  };

  return {
    control,
    loadTeam: async (teamId: string) => teams.get(teamId) || null,
    saveTeam: async (teamId: string, teamData: Team) => {
      teams.set(teamId, { ...teamData });
    },
    deleteTeamRecord: async (teamId: string) => {
      teams.delete(teamId);
    },
    atomicTeamUpdate,
    loadTeamIndex: async () => new Map(indexMap),
    atomicTeamIndexUpdate: async (updater: (index: Map<string, string>) => Map<string, string> | null) => {
      const next = updater(new Map(indexMap));
      if (!next) return new Map(indexMap);
      indexMap.clear();
      for (const [k, v] of next) indexMap.set(k, v);
      return new Map(indexMap);
    },
    loadGlobalSettings: async () => ({}),
    _teams: teams
  };
};

const createMockTokenService = () => ({
  createSessionToken: (teamId: string) => `session-${teamId}`,
  validateSessionToken: (token: string) => {
    if (!token?.startsWith('session-')) return null;
    return { teamId: token.slice('session-'.length), visitorId: null };
  },
  invalidateSessionToken: () => {},
  createInviteCredential: (teamId: string, epoch: number) => `invite-${teamId}-${epoch}`,
  validateInviteCredential: () => null,
  validateSuperAdminAuth: () => false
});

const listen = async (app: express.Express) =>
  new Promise<{ baseUrl: string; close: () => Promise<void> }>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res()))
      });
    });
  });

const col = (id: string, title: string): Column => ({
  id, title, color: 'bg-emerald-50', border: 'border-emerald-400', icon: 'add', text: 'text-emerald-700', ring: 'ring-emerald-400'
});

const sailboat: RetroTemplate = { name: 'Sailboat', cols: [col('wind', 'Wind'), col('anchor', 'Anchors')] };
const ssc: RetroTemplate = { name: 'Start Stop Continue', cols: [col('start', 'Start'), col('stop', 'Stop')] };

const dimension = (id: string) => ({ id, name: `Dimension ${id}`, goodDescription: 'Good', badDescription: 'Bad' });
const hcTemplate = (id: string, name: string): HcTemplate => ({ id, name, dimensions: [dimension(`${id}-d1`)] });

describe('template lists are owned by granular routes (incident ISS)', () => {
  let baseUrl: string;
  let dataStore: ReturnType<typeof createMockDataStore>;
  let teamId: string;
  let sessionToken: string;

  const post = async (path: string, body: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

  const stored = () => dataStore._teams.get(teamId) as unknown as {
    customTemplates: RetroTemplate[];
    customHealthCheckTemplates: HcTemplate[];
    teamFeedbacks: { id: string; title: string }[];
    facilitatorEmail?: string;
  };

  beforeEach(async () => {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    dataStore = createMockDataStore();
    const tokenService = createMockTokenService();
    registerTeamRoutes({
      app,
      dataStore,
      teamService: createTeamService({ dataStore, tokenService }),
      tokenService,
      mailerService: { smtpEnabled: false, mailer: null },
      logService: { addServerLog: () => {} },
      escapeHtml: (s: string) => s
    });
    const server = await listen(app);
    baseUrl = server.baseUrl;

    const res = await post('/api/team/create', { name: 'Templates', password: 'password123456' });
    const created = await res.json();
    teamId = created.team.id;
    sessionToken = created.sessionToken;

    const team = dataStore._teams.get(teamId) as Team;
    team.customTemplates = structuredClone([sailboat, ssc]);
    team.customHealthCheckTemplates = [hcTemplate('hc-a', 'Squad health'), hcTemplate('hc-b', 'Delivery health')];
    team.teamFeedbacks = [{ id: 'fb-1', title: 'Timer drifts', type: 'bug', status: 'pending' }];

    return async () => {
      await server.close();
    };
  });

  describe('POST /api/team/:teamId/template/save', () => {
    it('appends one template, with its name trimmed, and keeps the others', async () => {
      const res = await post(`/api/team/${teamId}/template/save`, {
        sessionToken,
        template: { name: '  Mad Sad Glad  ', cols: [col('mad', 'Mad')] }
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(stored().customTemplates).toEqual([sailboat, ssc, { name: 'Mad Sad Glad', cols: [col('mad', 'Mad')] }]);
    });

    it('accepts the team password as the credential, like its siblings', async () => {
      const res = await post(`/api/team/${teamId}/template/save`, {
        password: 'password123456',
        template: { name: 'Four Ls', cols: [col('liked', 'Liked')] }
      });

      expect(res.status).toBe(200);
      expect(stored().customTemplates.map((t) => t.name)).toEqual(['Sailboat', 'Start Stop Continue', 'Four Ls']);
    });

    it('creates the list on a team record that has none', async () => {
      delete (dataStore._teams.get(teamId) as Team).customTemplates;

      const res = await post(`/api/team/${teamId}/template/save`, { sessionToken, template: sailboat });

      expect(res.status).toBe(200);
      expect(stored().customTemplates).toEqual([sailboat]);
    });

    it.each([
      ['no template', undefined],
      ['a template that is not an object', 'Sailboat'],
      ['a name that is not a string', { name: 42, cols: sailboat.cols }],
      ['a blank name', { name: '   ', cols: sailboat.cols }],
      ['columns that are not an array', { name: 'Sailboat', cols: 'wind' }],
      ['no columns', { name: 'Sailboat', cols: [] }]
    ])('refuses %s with 400 and writes nothing', async (_label, template) => {
      const before = structuredClone(stored());
      const res = await post(`/api/team/${teamId}/template/save`, { sessionToken, template });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_template' });
      expect(stored()).toEqual(before);
    });

    it('answers 500 when the store loses the write', async () => {
      dataStore.control.failNextUpdates = 1;
      const res = await post(`/api/team/${teamId}/template/save`, { sessionToken, template: sailboat });

      expect(res.status).toBe(500);
      expect(stored().customTemplates).toHaveLength(2);
    });
  });

  describe('POST /api/team/:teamId/template/delete', () => {
    it('removes the template with that content and nothing else', async () => {
      const res = await post(`/api/team/${teamId}/template/delete`, { sessionToken, template: sailboat });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(stored().customTemplates).toEqual([ssc]);
    });

    it('matches the content regardless of key order', async () => {
      // A JSON round trip through another client does not promise key order.
      const reordered = {
        cols: sailboat.cols.map((c) => Object.fromEntries(Object.entries(c).reverse())),
        name: 'Sailboat'
      };

      const res = await post(`/api/team/${teamId}/template/delete`, { sessionToken, template: reordered });

      expect(res.status).toBe(200);
      expect(stored().customTemplates).toEqual([ssc]);
    });

    it('removes the twin whose columns were sent, not the first one with that name', async () => {
      const twinA = { name: 'Twin', cols: [col('a', 'A')] };
      const twinB = { name: 'Twin', cols: [col('b', 'B')] };
      (dataStore._teams.get(teamId) as Team).customTemplates = [twinA, twinB];

      const res = await post(`/api/team/${teamId}/template/delete`, { sessionToken, template: twinB });

      expect(res.status).toBe(200);
      expect(stored().customTemplates).toEqual([twinA]);
    });

    it('removes one copy only when two templates are identical', async () => {
      (dataStore._teams.get(teamId) as Team).customTemplates = structuredClone([sailboat, sailboat, ssc]);

      await post(`/api/team/${teamId}/template/delete`, { sessionToken, template: sailboat });

      expect(stored().customTemplates).toEqual([sailboat, ssc]);
    });

    it('answers 404 when no stored template has that content, and writes nothing', async () => {
      // Same name, different columns: an edit made elsewhere since this caller
      // loaded. Deleting "the Sailboat" anyway would delete something the
      // caller never saw.
      const before = structuredClone(stored());
      const res = await post(`/api/team/${teamId}/template/delete`, {
        sessionToken,
        template: { name: 'Sailboat', cols: [col('wind', 'Wind')] }
      });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'template_not_found' });
      expect(stored()).toEqual(before);
    });

    it('still deletes a stored template whose name is blank', async () => {
      // A template saved before names were validated may carry a blank name;
      // deleting it must remain possible, so only the shape is checked here.
      const legacy = { name: '  ', cols: [col('x', 'X')] };
      (dataStore._teams.get(teamId) as Team).customTemplates = [legacy, sailboat];

      const res = await post(`/api/team/${teamId}/template/delete`, { sessionToken, template: legacy });

      expect(res.status).toBe(200);
      expect(stored().customTemplates).toEqual([sailboat]);
    });

    it.each([
      ['no template', undefined],
      ['a name that is not a string', { name: null, cols: sailboat.cols }],
      ['columns that are not an array', { name: 'Sailboat' }]
    ])('refuses %s with 400', async (_label, template) => {
      const res = await post(`/api/team/${teamId}/template/delete`, { sessionToken, template });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_template' });
      expect(stored().customTemplates).toHaveLength(2);
    });
  });

  describe('a stale caller', () => {
    it('cannot erase a template it never saw by deleting another one', async () => {
      // The tab loaded [Sailboat, SSC]; another tab has saved "Retro Bingo" since.
      await post(`/api/team/${teamId}/template/save`, {
        sessionToken,
        template: { name: 'Retro Bingo', cols: [col('bingo', 'Bingo')] }
      });

      const res = await post(`/api/team/${teamId}/template/delete`, { sessionToken, template: sailboat });

      expect(res.status).toBe(200);
      expect(stored().customTemplates.map((t) => t.name)).toEqual(['Start Stop Continue', 'Retro Bingo']);
    });

    it('cannot erase one by adding a template either', async () => {
      await post(`/api/team/${teamId}/template/save`, {
        sessionToken,
        template: { name: 'Retro Bingo', cols: [col('bingo', 'Bingo')] }
      });

      await post(`/api/team/${teamId}/template/save`, {
        sessionToken,
        template: { name: 'From the stale tab', cols: [col('stale', 'Stale')] }
      });

      expect(stored().customTemplates.map((t) => t.name))
        .toEqual(['Sailboat', 'Start Stop Continue', 'Retro Bingo', 'From the stale tab']);
    });
  });

  describe('POST /api/team/:teamId/healthcheck-template/save', () => {
    it('adds a template with a new id', async () => {
      const res = await post(`/api/team/${teamId}/healthcheck-template/save`, {
        sessionToken,
        template: hcTemplate('hc-c', 'Onboarding health')
      });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(stored().customHealthCheckTemplates.map((t) => t.id)).toEqual(['hc-a', 'hc-b', 'hc-c']);
    });

    it('replaces the template with the same id in place, with its name trimmed', async () => {
      const edited = { ...hcTemplate('hc-a', '  Squad health v2 '), dimensions: [dimension('new')] };

      const res = await post(`/api/team/${teamId}/healthcheck-template/save`, { sessionToken, template: edited });

      expect(res.status).toBe(200);
      expect(stored().customHealthCheckTemplates).toEqual([
        { id: 'hc-a', name: 'Squad health v2', dimensions: [dimension('new')] },
        hcTemplate('hc-b', 'Delivery health')
      ]);
    });

    it('creates the list on a team record that has none', async () => {
      delete (dataStore._teams.get(teamId) as Team).customHealthCheckTemplates;

      await post(`/api/team/${teamId}/healthcheck-template/save`, { sessionToken, template: hcTemplate('hc-c', 'C') });

      expect(stored().customHealthCheckTemplates.map((t) => t.id)).toEqual(['hc-c']);
    });

    it.each([
      ['no template', undefined],
      ['no id', { name: 'Health', dimensions: [] }],
      ['a blank id', { id: '', name: 'Health', dimensions: [] }],
      ['a blank name', { id: 'hc-z', name: ' ', dimensions: [] }],
      ['dimensions that are not an array', { id: 'hc-z', name: 'Health', dimensions: {} }]
    ])('refuses %s with 400 and writes nothing', async (_label, template) => {
      const before = structuredClone(stored());
      const res = await post(`/api/team/${teamId}/healthcheck-template/save`, { sessionToken, template });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_template' });
      expect(stored()).toEqual(before);
    });
  });

  describe('POST /api/team/:teamId/healthcheck-template/delete', () => {
    it('removes only the template with that id', async () => {
      const res = await post(`/api/team/${teamId}/healthcheck-template/delete`, { sessionToken, templateId: 'hc-a' });

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ success: true });
      expect(stored().customHealthCheckTemplates.map((t) => t.id)).toEqual(['hc-b']);
    });

    it('answers 404 for an id that is not there, and writes nothing', async () => {
      const before = structuredClone(stored());
      const res = await post(`/api/team/${teamId}/healthcheck-template/delete`, { sessionToken, templateId: 'nope' });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'healthcheck_template_not_found' });
      expect(stored()).toEqual(before);
    });

    it('answers 400 without a template id', async () => {
      const res = await post(`/api/team/${teamId}/healthcheck-template/delete`, { sessionToken });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'missing_template' });
      expect(stored().customHealthCheckTemplates).toHaveLength(2);
    });
  });

  describe('the template routes refuse anyone who is not this team', () => {
    const routes = [
      { name: 'template/save', path: () => `/api/team/${teamId}/template/save`, body: { template: { name: 'X', cols: [col('x', 'X')] } } },
      { name: 'template/delete', path: () => `/api/team/${teamId}/template/delete`, body: { template: sailboat } },
      { name: 'healthcheck-template/save', path: () => `/api/team/${teamId}/healthcheck-template/save`, body: { template: hcTemplate('hc-x', 'X') } },
      { name: 'healthcheck-template/delete', path: () => `/api/team/${teamId}/healthcheck-template/delete`, body: { templateId: 'hc-a' } }
    ];

    let otherTeamToken: string;
    beforeEach(async () => {
      const res = await post('/api/team/create', { name: 'Strangers', password: 'password654321' });
      const created = await res.json();
      otherTeamToken = created.sessionToken;
      expect(created.team.id).not.toBe(teamId);
    });

    for (const route of routes) {
      it(`${route.name} answers 401 without a credential and changes nothing`, async () => {
        const before = structuredClone(stored());
        const res = await post(route.path(), route.body);

        expect(res.status).toBe(401);
        expect(stored()).toEqual(before);
      });

      it(`${route.name} answers 401 to a valid session token of another team and changes nothing`, async () => {
        const before = structuredClone(stored());
        const res = await post(route.path(), { ...route.body, sessionToken: otherTeamToken });

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'invalid_token' });
        expect(stored()).toEqual(before);
      });
    }
  });

  describe('POST /api/team/:teamId/update', () => {
    it('no longer replaces the template lists or the feedbacks: it merges the templates and ignores the feedbacks', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const before = structuredClone(stored());

      const res = await post(`/api/team/${teamId}/update`, {
        sessionToken,
        updates: {
          facilitatorEmail: 'still-applied@example.com',
          customTemplates: [],
          customHealthCheckTemplates: [hcTemplate('hc-a', 'Squad health')],
          teamFeedbacks: []
        }
      });

      expect(res.status).toBe(200);
      expect(stored().customTemplates).toEqual(before.customTemplates);
      expect(stored().customHealthCheckTemplates).toEqual(before.customHealthCheckTemplates);
      expect(stored().teamFeedbacks).toEqual(before.teamFeedbacks);
      expect(stored().facilitatorEmail).toBe('still-applied@example.com');
      const lines = warn.mock.calls.map((args) => args.map(String).join(' ')).filter((l) => l.includes('/update'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('ignored teamFeedbacks');
      expect(lines[0]).toContain('merged customTemplates, customHealthCheckTemplates add-only');
      warn.mockRestore();
    });
  });

  // A rolling update leaves the previous release's Dashboard open in browser
  // tabs, and nothing makes them reload. That client (34.1) saves a template
  // only by sending its whole cached list through `/update`, and adopts the
  // team the answer carries. Stripping the lists there silently discarded
  // every template created or edited from such a tab — and the 200 answer then
  // wiped it from the tab's own cache too. The lists are merged instead, never
  // shrunk: a stale tab still cannot erase anything, its deletes simply do not
  // stick.
  describe('POST /api/team/:teamId/update from a client before the template routes', () => {
    const legacyUpdate = async (updates: Record<string, unknown>) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const res = await post(`/api/team/${teamId}/update`, { sessionToken, updates });
        return { status: res.status, body: await res.json() };
      } finally {
        warn.mockRestore();
      }
    };

    const madSadGlad: RetroTemplate = { name: 'Mad Sad Glad', cols: [col('mad', 'Mad'), col('sad', 'Sad')] };

    // The whole stored record, less the invite epoch `/update` writes back as
    // it reads it (0 on a record that never had one).
    const record = () => {
      const { inviteEpoch: _epoch, ...rest } = dataStore._teams.get(teamId) as Team;
      return structuredClone(rest);
    };

    it('keeps a retro template the old tab added, and answers with it', async () => {
      const { status, body } = await legacyUpdate({ customTemplates: [sailboat, ssc, madSadGlad] });

      expect(status).toBe(200);
      expect(stored().customTemplates).toEqual([sailboat, ssc, madSadGlad]);
      // The old client replaces its cache with the answer's team: an answer
      // without the template is what wiped it from the tab as well.
      expect(body.team.customTemplates).toEqual([sailboat, ssc, madSadGlad]);
    });

    it('keeps a health-check template the old tab added, and answers with it', async () => {
      const added = hcTemplate('hc-c', 'Onboarding health');
      const { status, body } = await legacyUpdate({
        customHealthCheckTemplates: [hcTemplate('hc-a', 'Squad health'), hcTemplate('hc-b', 'Delivery health'), added]
      });

      expect(status).toBe(200);
      expect(stored().customHealthCheckTemplates.map((t) => t.id)).toEqual(['hc-a', 'hc-b', 'hc-c']);
      expect(stored().customHealthCheckTemplates[2]).toEqual(added);
      expect(body.team.customHealthCheckTemplates.map((t: HcTemplate) => t.id)).toEqual(['hc-a', 'hc-b', 'hc-c']);
    });

    it('lands an old tab’s health-check template edit by id, in place', async () => {
      // saveHealthCheckTemplate has always been an upsert by id.
      const edited = { ...hcTemplate('hc-a', 'Squad health v2'), dimensions: [dimension('new')] };
      const { status } = await legacyUpdate({
        customHealthCheckTemplates: [edited, hcTemplate('hc-b', 'Delivery health')]
      });

      expect(status).toBe(200);
      expect(stored().customHealthCheckTemplates).toEqual([edited, hcTemplate('hc-b', 'Delivery health')]);
    });

    it('removes nothing when the old tab’s lists are missing templates', async () => {
      // An old tab deleting a template sends the list without it. The server
      // cannot tell that from a tab that never saw the template, so neither
      // removes anything; the answer gives the tab its templates back.
      const before = structuredClone(stored());
      const { status, body } = await legacyUpdate({
        customTemplates: [ssc],
        customHealthCheckTemplates: [hcTemplate('hc-b', 'Delivery health')]
      });

      expect(status).toBe(200);
      expect(stored().customTemplates).toEqual(before.customTemplates);
      expect(stored().customHealthCheckTemplates).toEqual(before.customHealthCheckTemplates);
      expect(body.team.customTemplates).toEqual(before.customTemplates);
      expect(body.team.customHealthCheckTemplates).toEqual(before.customHealthCheckTemplates);
    });

    it('cannot erase a template saved elsewhere since the stale tab loaded', async () => {
      // Another tab, on the current release, saves through the template routes…
      const bingo = { name: 'Retro Bingo', cols: [col('bingo', 'Bingo')] };
      await post(`/api/team/${teamId}/template/save`, { sessionToken, template: bingo });
      await post(`/api/team/${teamId}/healthcheck-template/save`, { sessionToken, template: hcTemplate('hc-c', 'C') });

      // …and the stale tab, which loaded before both, saves one of its own.
      const fromStaleTab = { name: 'From the stale tab', cols: [col('stale', 'Stale')] };
      const { status } = await legacyUpdate({
        customTemplates: [sailboat, ssc, fromStaleTab],
        customHealthCheckTemplates: [hcTemplate('hc-a', 'Squad health'), hcTemplate('hc-b', 'Delivery health'), hcTemplate('hc-d', 'D')]
      });

      expect(status).toBe(200);
      expect(stored().customTemplates).toEqual([sailboat, ssc, bingo, fromStaleTab]);
      expect(stored().customHealthCheckTemplates.map((t) => t.id)).toEqual(['hc-a', 'hc-b', 'hc-c', 'hc-d']);
    });

    it('matches a retro template by content, so re-sending a stored one never duplicates it', async () => {
      // Stored before names were validated: untrimmed, and blank. The old tab
      // holds the same entries and sends them back on every save.
      const untrimmed = { name: '  Legacy  ', cols: [col('l', 'L')] };
      const blank = { name: '', cols: [col('b', 'B')] };
      (dataStore._teams.get(teamId) as Team).customTemplates = structuredClone([untrimmed, blank, sailboat]);
      const reordered = {
        cols: sailboat.cols.map((c) => Object.fromEntries(Object.entries(c).reverse())),
        name: 'Sailboat'
      };

      const { status } = await legacyUpdate({ customTemplates: [untrimmed, blank, reordered, madSadGlad, madSadGlad] });

      expect(status).toBe(200);
      expect(stored().customTemplates).toEqual([untrimmed, blank, sailboat, madSadGlad]);
    });

    it('ignores malformed entries and a list that is not a list', async () => {
      const before = record();

      const { status } = await legacyUpdate({
        customTemplates: [
          'Sailboat',
          null,
          { name: 42, cols: [col('x', 'X')] },
          { name: '   ', cols: [col('x', 'X')] },
          { name: 'No columns', cols: [] },
          { name: 'Columns not a list', cols: 'wind' }
        ],
        customHealthCheckTemplates: [
          null,
          { name: 'No id', dimensions: [] },
          { id: '', name: 'Blank id', dimensions: [] },
          { id: 'hc-z', name: ' ', dimensions: [] },
          // A malformed entry never replaces a stored one either.
          { id: 'hc-a', name: 'Squad health', dimensions: 'none' }
        ]
      });
      expect(status).toBe(200);
      expect(record()).toEqual(before);

      const notALists = await legacyUpdate({ customTemplates: 'Sailboat', customHealthCheckTemplates: { id: 'hc-z' } });
      expect(notALists.status).toBe(200);
      expect(record()).toEqual(before);
    });

    it('trims the name of a template it adds, as the template routes do', async () => {
      const { status } = await legacyUpdate({
        customTemplates: [sailboat, ssc, { name: '  Four Ls ', cols: [col('liked', 'Liked')] }],
        customHealthCheckTemplates: [hcTemplate('hc-a', 'Squad health'), hcTemplate('hc-b', 'Delivery health'), hcTemplate('hc-c', ' Padded ')]
      });

      expect(status).toBe(200);
      expect(stored().customTemplates[2]).toEqual({ name: 'Four Ls', cols: [col('liked', 'Liked')] });
      expect(stored().customHealthCheckTemplates[2].name).toBe('Padded');
    });

    it('creates the lists on a team record that has none', async () => {
      delete (dataStore._teams.get(teamId) as Team).customTemplates;
      delete (dataStore._teams.get(teamId) as Team).customHealthCheckTemplates;

      const { status } = await legacyUpdate({
        customTemplates: [sailboat],
        customHealthCheckTemplates: [hcTemplate('hc-a', 'Squad health')]
      });

      expect(status).toBe(200);
      expect(stored().customTemplates).toEqual([sailboat]);
      expect(stored().customHealthCheckTemplates).toEqual([hcTemplate('hc-a', 'Squad health')]);
    });

    it('merges on the stored record, inside the team compare-and-swap', async () => {
      // A template saved after this request authenticated, but before its
      // write, is still there: the merge reads the record it writes.
      const original = dataStore.atomicTeamUpdate;
      const bingo = { name: 'Retro Bingo', cols: [col('bingo', 'Bingo')] };
      dataStore.atomicTeamUpdate = async (id, updater) => {
        // A new record, as another request's write leaves it: the copy this
        // request authenticated with must not see it.
        const current = dataStore._teams.get(id) as Team;
        dataStore._teams.set(id, { ...structuredClone(current), customTemplates: structuredClone([sailboat, ssc, bingo]) });
        dataStore.atomicTeamUpdate = original;
        return original(id, updater);
      };

      const { status } = await legacyUpdate({ customTemplates: [sailboat, ssc, madSadGlad] });

      expect(status).toBe(200);
      expect(stored().customTemplates).toEqual([sailboat, ssc, bingo, madSadGlad]);
    });

    it('still ignores the session lists and the feedbacks an old client sends alongside', async () => {
      // 34.1's template delete is `updateTeam({ ...team, customTemplates })`:
      // the whole cached team, every list included.
      const before = record();
      const { status } = await legacyUpdate({
        customTemplates: [ssc],
        retrospectives: [],
        healthChecks: [],
        globalActions: [],
        teamFeedbacks: []
      });

      expect(status).toBe(200);
      expect(record()).toEqual(before);
    });
  });

  // CodeQL js/missing-rate-limiting (PR #507): these routes are write paths a
  // team credential can drive, so each one carries its own limiter, created in
  // the module like every other route module's. Pinned per route: a limiter a
  // later refactor drops would otherwise leave every other test green.
  describe('each template route is rate limited', () => {
    it.each([
      ['/template/save', { template: { name: '', cols: [] } }],
      ['/template/delete', { template: { name: 'Nobody', cols: [] } }],
      ['/healthcheck-template/save', { template: { id: '', name: '', dimensions: [] } }],
      ['/healthcheck-template/delete', { templateId: 'nobody' }],
    ])('refuses the 301st write within a minute on %s', async (route, body) => {
      const statuses: number[] = [];
      for (let i = 0; i < 301; i++) {
        const res = await post(`/api/team/${teamId}${route}`, { sessionToken, ...body });
        statuses.push(res.status);
      }

      expect(statuses.slice(0, 300)).not.toContain(429);
      expect(statuses[300]).toBe(429);
    }, 30_000);
  });
});
