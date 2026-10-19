import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionItem, Column, Team } from '../types';

/**
 * Incident ISS (2026-10-12), second path: a facilitator's second tab, left on
 * a Dashboard loaded before the retro started, deleted an old retro. The
 * delete persisted the tab's WHOLE cached `retrospectives` list through
 * `/api/team/:teamId/update`, which replaced the stored list wholesale with no
 * revision check — erasing the live retro from the team record. A participant
 * then joined through the invite link, the client made a local placeholder
 * named "Retrospective" AND persisted it with no `_rev`, which overwrote what
 * was left, and the session started refusing every write.
 *
 * What the client must therefore never do again: send a list it does not own
 * through `/update`, or persist a placeholder. Deletions name what they delete.
 */

const columns: Column[] = [
  { id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring-3' }
];

let mockTeamSequence = 0;

const createMockTeam = (overrides: Partial<Team> = {}): Team => ({
  id: `team-${++mockTeamSequence}`,
  name: 'GranularTeam',
  passwordHash: 'secret',
  members: [
    { id: 'admin-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }
  ],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  lastConnectionDate: new Date().toISOString(),
  ...overrides
});

const flushPersistQueue = () => new Promise(resolve => setTimeout(resolve, 50));

type FetchCall = { url: string; body: Record<string, unknown> };

describe('dataService granular writes (incident ISS)', () => {
  let dataService: typeof import('../services/dataService').dataService;
  let mockTeam: Team;
  let calls: FetchCall[];
  // Per-URL override of the response, for the 404 / failure cases. `html`
  // answers like Express's own 404 for a route the pod does not serve: a body
  // that is not JSON.
  let respond: (url: string) => { ok: boolean; status: number; body?: unknown; html?: boolean } | null;

  const callsTo = (pattern: RegExp) => calls.filter(c => pattern.test(c.url));

  beforeEach(async () => {
    vi.resetModules();
    mockTeam = createMockTeam();
    calls = [];
    respond = () => null;

    global.fetch = vi.fn().mockImplementation(async (url: string, options?: { body?: string }) => {
      const urlPath = url.toString();
      const body = JSON.parse(options?.body || '{}');
      calls.push({ url: urlPath, body });

      const override = respond(urlPath);
      if (override) {
        return {
          ok: override.ok,
          status: override.status,
          json: async () => {
            if (override.html) throw new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');
            return override.body;
          }
        };
      }

      if (urlPath === '/api/team/create') {
        mockTeam = createMockTeam({ name: body.name, passwordHash: body.password });
        return {
          ok: true,
          status: 201,
          json: async () => ({ team: structuredClone(mockTeam), sessionToken: `token-${mockTeam.id}` })
        };
      }

      // `/update` applies the fields it owns, like the server route.
      if (/\/update$/.test(urlPath) && body.updates) {
        const {
          retrospectives: _r,
          healthChecks: _h,
          globalActions: _g,
          customTemplates: _t,
          customHealthCheckTemplates: _hct,
          teamFeedbacks: _f,
          ...owned
        } = body.updates;
        Object.assign(mockTeam, owned);
      }

      // Every other route succeeds. `/update` answers like the server does,
      // with the stored team — a clone, so the client's cache and the "server"
      // never share an object.
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, team: structuredClone(mockTeam) })
      };
    }) as unknown as typeof fetch;

    dataService = (await import('../services/dataService')).dataService;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createTeam = async () => {
    const team = await dataService.createTeam('Alpha', 'secret-password', 'fac@example.com');
    await flushPersistQueue();
    calls = [];
    return team;
  };

  describe('deleting a retrospective', () => {
    it('names the retrospective on its own route and never sends the list through /update', async () => {
      const team = await createTeam();
      const retro = dataService.createSession(team.id, 'Sprint 1', columns);
      await flushPersistQueue();
      calls = [];

      dataService.deleteRetrospective(team.id, retro.id);
      await flushPersistQueue();

      const deletes = callsTo(new RegExp(`^/api/team/${team.id}/retrospective/${retro.id}/delete$`));
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body.sessionToken).toBe(`token-${team.id}`);
      expect(callsTo(/\/update$/)).toHaveLength(0);
    });

    it('still removes it locally and promotes its actions to the backlog', async () => {
      const team = await createTeam();
      const retro = dataService.createSession(team.id, 'Sprint 1', columns);
      const action: ActionItem = { id: 'a1', text: 'Follow up', assigneeId: null, done: false, type: 'new', proposalVotes: {} };
      dataService.getTeam(team.id)!.retrospectives[0].actions.push(action);

      dataService.deleteRetrospective(team.id, retro.id);

      const local = dataService.getTeam(team.id)!;
      expect(local.retrospectives).toHaveLength(0);
      expect(local.globalActions.map(a => a.id)).toEqual(['a1']);
    });
  });

  describe('deleting a health check', () => {
    it('names the health check on its own route and never sends the list through /update', async () => {
      const team = await createTeam();
      const hc = dataService.createHealthCheckSession(team.id, 'HC', 'team_health_en');
      await flushPersistQueue();
      calls = [];

      dataService.deleteHealthCheck(team.id, hc.id);
      await flushPersistQueue();

      expect(callsTo(new RegExp(`^/api/team/${team.id}/healthcheck/${hc.id}/delete$`))).toHaveLength(1);
      expect(callsTo(/\/update$/)).toHaveLength(0);
      expect(dataService.getTeam(team.id)!.healthChecks).toHaveLength(0);
    });
  });

  describe('deleting an action', () => {
    it('names the action on its own route and never sends the lists through /update', async () => {
      const team = await createTeam();
      const action = dataService.addGlobalAction(team.id, 'Task', null);
      await flushPersistQueue();
      calls = [];

      dataService.deleteAction(team.id, action.id);
      await flushPersistQueue();

      const deletes = callsTo(new RegExp(`^/api/team/${team.id}/action/delete$`));
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body.actionId).toBe(action.id);
      expect(callsTo(/\/update$/)).toHaveLength(0);
      expect(dataService.getTeam(team.id)!.globalActions).toHaveLength(0);
    });
  });

  describe('a delete the server answers 404', () => {
    it('is "already gone", not a failure', async () => {
      const team = await createTeam();
      const retro = dataService.createSession(team.id, 'Sprint 1', columns);
      await flushPersistQueue();
      respond = (url) => url.endsWith('/delete')
        ? { ok: false, status: 404, body: { error: 'retrospective_not_found' } }
        : null;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

      dataService.deleteRetrospective(team.id, retro.id);
      await flushPersistQueue();

      expect(callsTo(/\/retrospective\/[^/]+\/delete$/)).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });

    it('while any other error is still reported, once the rollout window is over', async () => {
      const team = await createTeam();
      const action = dataService.addGlobalAction(team.id, 'Task', null);
      await flushPersistQueue();
      respond = (url) => url.endsWith('/action/delete')
        ? { ok: false, status: 500, body: { error: 'internal_error' } }
        : null;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.useFakeTimers();

      dataService.deleteAction(team.id, action.id);
      await vi.advanceTimersByTimeAsync(5_000);
      // Still inside the retry window: nothing reported yet.
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Failed to delete'), expect.anything());

      await vi.advanceTimersByTimeAsync(5_000);
      expect(callsTo(/\/action\/delete$/)).toHaveLength(5);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to delete'), 'internal_error');
    });
  });

  // Review finding on the ISS branch. These routes are new, so during a
  // rolling update a browser on the new bundle can be routed to a pod that does
  // not serve them yet. Express answers that with its own HTML 404, which the
  // client reads as 'unknown_error'; the delete was logged and dropped while
  // the local cache already showed it gone, and the next load brought the
  // retro back. The impact-vote route has retried across the rollout window
  // since it was added; the deletes now share that retry.
  describe('a delete routed to a pod that does not serve the route yet', () => {
    const cases = [
      {
        name: 'a retrospective',
        route: /\/retrospective\/[^/]+\/delete$/,
        notFound: 'retrospective_not_found',
        remove: (teamId: string) => {
          const retro = dataService.createSession(teamId, 'Sprint 1', columns);
          return () => dataService.deleteRetrospective(teamId, retro.id);
        }
      },
      {
        name: 'a health check',
        route: /\/healthcheck\/[^/]+\/delete$/,
        notFound: 'healthcheck_not_found',
        remove: (teamId: string) => {
          const hc = dataService.createHealthCheckSession(teamId, 'HC', 'team_health_en');
          return () => dataService.deleteHealthCheck(teamId, hc.id);
        }
      },
      {
        name: 'an action',
        route: /\/action\/delete$/,
        notFound: 'action_not_found',
        remove: (teamId: string) => {
          const action = dataService.addGlobalAction(teamId, 'Task', null);
          return () => dataService.deleteAction(teamId, action.id);
        }
      }
    ];

    it.each(cases)('retries $name until a pod that serves the route answers', async ({ route, remove }) => {
      const team = await createTeam();
      const deleteIt = remove(team.id);
      await flushPersistQueue();
      let attempts = 0;
      respond = (url) => route.test(url) && attempts++ < 2
        ? { ok: false, status: 404, html: true }
        : null;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.useFakeTimers();

      deleteIt();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(callsTo(route)).toHaveLength(3);
      expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Failed to delete'), expect.anything());
    });

    it.each(cases)('does not retry $name when the route itself answers that it is already gone', async ({ route, notFound, remove }) => {
      const team = await createTeam();
      const deleteIt = remove(team.id);
      await flushPersistQueue();
      respond = (url) => route.test(url)
        ? { ok: false, status: 404, body: { error: notFound } }
        : null;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.useFakeTimers();

      deleteIt();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(callsTo(route)).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('saveTemplate', () => {
    it('adds the template locally and names it on its own route, never through /update', async () => {
      const team = await createTeam();

      dataService.saveTemplate(team.id, { name: 'Sailboat', cols: columns });
      await flushPersistQueue();

      expect(dataService.getTeam(team.id)!.customTemplates).toEqual([{ name: 'Sailboat', cols: columns }]);
      const saves = callsTo(new RegExp(`^/api/team/${team.id}/template/save$`));
      expect(saves).toHaveLength(1);
      expect(saves[0].body.template).toEqual({ name: 'Sailboat', cols: columns });
      expect(saves[0].body.sessionToken).toBe(`token-${team.id}`);
      expect(callsTo(/\/update$/)).toHaveLength(0);
    });

    it('keeps the name as the server stores it, so the same tab can delete it again', async () => {
      // The server trims the name; a cache holding the untrimmed one would
      // later ask to delete a template the server does not have.
      const team = await createTeam();

      dataService.saveTemplate(team.id, { name: '  Sailboat  ', cols: columns });
      dataService.deleteCustomTemplate(team.id, 0, 'Sailboat');
      await flushPersistQueue();

      expect(callsTo(/\/template\/save$/)[0].body.template).toEqual({ name: 'Sailboat', cols: columns });
      expect(callsTo(/\/template\/delete$/)[0].body.template).toEqual({ name: 'Sailboat', cols: columns });
    });

    it('neither shows nor sends a template the server would refuse', async () => {
      const team = await createTeam();

      dataService.saveTemplate(team.id, { name: '   ', cols: columns });
      dataService.saveTemplate(team.id, { name: 'No columns', cols: [] });
      await flushPersistQueue();

      expect(dataService.getTeam(team.id)!.customTemplates).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });

  describe('deleteCustomTemplate', () => {
    it('removes the template locally and names it by content on its own route', async () => {
      const team = await createTeam();
      dataService.saveTemplate(team.id, { name: 'Keep', cols: columns });
      dataService.saveTemplate(team.id, { name: 'Drop', cols: columns });
      await flushPersistQueue();
      calls = [];

      dataService.deleteCustomTemplate(team.id, 1, 'Drop');
      await flushPersistQueue();

      expect(dataService.getTeam(team.id)!.customTemplates.map(t => t.name)).toEqual(['Keep']);
      const deletes = callsTo(new RegExp(`^/api/team/${team.id}/template/delete$`));
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body.template).toEqual({ name: 'Drop', cols: columns });
      expect(callsTo(/\/update$/)).toHaveLength(0);
    });

    // Codex review on PR #507: templates carry no id and names are not unique,
    // so resolving the clicked row by name deleted the FIRST of two twins when
    // the facilitator clicked the second. The row's position decides; the
    // name only guards against a list that changed under the click.
    it('removes the twin that was clicked, not the first one with that name', async () => {
      const team = await createTeam();
      dataService.saveTemplate(team.id, { name: 'Twin', cols: columns });
      dataService.saveTemplate(team.id, { name: 'Twin', cols: columns.slice(0, 1) });

      dataService.deleteCustomTemplate(team.id, 1, 'Twin');

      const remaining = dataService.getTeam(team.id)!.customTemplates;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].cols).toHaveLength(columns.length);
    });

    it('sends the content of the twin that was clicked, so the server removes that one', async () => {
      const team = await createTeam();
      const second: Column[] = [{ ...columns[0], id: 'second', title: 'Second twin' }];
      dataService.saveTemplate(team.id, { name: 'Twin', cols: columns });
      dataService.saveTemplate(team.id, { name: 'Twin', cols: second });
      await flushPersistQueue();
      calls = [];

      dataService.deleteCustomTemplate(team.id, 1, 'Twin');
      await flushPersistQueue();

      const deletes = callsTo(/\/template\/delete$/);
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body.template).toEqual({ name: 'Twin', cols: second });
    });

    it('falls back to the first template with that name when the list moved under the click', async () => {
      const team = await createTeam();
      dataService.saveTemplate(team.id, { name: 'Keep', cols: columns });
      dataService.saveTemplate(team.id, { name: 'Drop', cols: columns });

      dataService.deleteCustomTemplate(team.id, 0, 'Drop');

      expect(dataService.getTeam(team.id)!.customTemplates.map(t => t.name)).toEqual(['Keep']);
    });

    it('sends nothing for a template it does not hold', async () => {
      const team = await createTeam();
      dataService.deleteCustomTemplate(team.id, 0, 'Missing');
      await flushPersistQueue();
      expect(calls).toHaveLength(0);
    });
  });

  describe('health-check templates', () => {
    it('saveHealthCheckTemplate upserts locally and names the template on its own route', async () => {
      const team = await createTeam();
      const template = { id: '', name: 'Squad health', dimensions: [] };

      dataService.saveHealthCheckTemplate(team.id, template);
      await flushPersistQueue();

      const local = dataService.getTeam(team.id)!.customHealthCheckTemplates!;
      expect(local).toHaveLength(1);
      expect(local[0].id).toMatch(/^custom_/);
      const saves = callsTo(new RegExp(`^/api/team/${team.id}/healthcheck-template/save$`));
      expect(saves).toHaveLength(1);
      expect(saves[0].body.template).toEqual({ id: local[0].id, name: 'Squad health', dimensions: [] });
      expect(callsTo(/\/update$/)).toHaveLength(0);
    });

    it('deleteHealthCheckTemplate removes it locally and names its id on its own route', async () => {
      const team = await createTeam();
      dataService.saveHealthCheckTemplate(team.id, { id: 'hc-1', name: 'Squad health', dimensions: [] });
      await flushPersistQueue();
      calls = [];

      dataService.deleteHealthCheckTemplate(team.id, 'hc-1');
      await flushPersistQueue();

      expect(dataService.getTeam(team.id)!.customHealthCheckTemplates).toEqual([]);
      const deletes = callsTo(new RegExp(`^/api/team/${team.id}/healthcheck-template/delete$`));
      expect(deletes).toHaveLength(1);
      expect(deletes[0].body.templateId).toBe('hc-1');
      expect(callsTo(/\/update$/)).toHaveLength(0);
    });
  });

  // Same review finding as the deletes above: the template routes are as new
  // as this change, so a browser on the new bundle can reach a pod that does
  // not serve them yet during a rolling update.
  describe('a template write routed to a pod that does not serve the route yet', () => {
    const cases = [
      {
        name: 'saving a retro template',
        route: /\/template\/save$/,
        refusal: 'invalid_template',
        prepare: (_teamId: string) => {},
        write: (teamId: string) => dataService.saveTemplate(teamId, { name: 'Sailboat', cols: columns })
      },
      {
        name: 'deleting a retro template',
        route: /\/template\/delete$/,
        refusal: 'template_not_found',
        prepare: (teamId: string) => dataService.saveTemplate(teamId, { name: 'Sailboat', cols: columns }),
        write: (teamId: string) => dataService.deleteCustomTemplate(teamId, 0, 'Sailboat')
      },
      {
        name: 'saving a health-check template',
        route: /\/healthcheck-template\/save$/,
        refusal: 'invalid_template',
        prepare: (_teamId: string) => {},
        write: (teamId: string) => dataService.saveHealthCheckTemplate(teamId, { id: 'hc-1', name: 'Squad health', dimensions: [] })
      },
      {
        name: 'deleting a health-check template',
        route: /\/healthcheck-template\/delete$/,
        refusal: 'healthcheck_template_not_found',
        prepare: (teamId: string) => dataService.saveHealthCheckTemplate(teamId, { id: 'hc-1', name: 'Squad health', dimensions: [] }),
        write: (teamId: string) => dataService.deleteHealthCheckTemplate(teamId, 'hc-1')
      }
    ];

    it.each(cases)('retries $name until a pod that serves the route answers', async ({ route, prepare, write }) => {
      const team = await createTeam();
      prepare(team.id);
      await flushPersistQueue();
      let attempts = 0;
      respond = (url) => route.test(url) && attempts++ < 2
        ? { ok: false, status: 404, html: true }
        : null;
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.useFakeTimers();

      write(team.id);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(callsTo(route)).toHaveLength(3);
      expect(warn).not.toHaveBeenCalled();
    });

    it.each(cases)('takes the route\'s own answer as final when $name', async ({ route, refusal, prepare, write }) => {
      const team = await createTeam();
      prepare(team.id);
      await flushPersistQueue();
      respond = (url) => route.test(url)
        ? { ok: false, status: refusal.endsWith('not_found') ? 404 : 400, body: { error: refusal } }
        : null;
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.useFakeTimers();

      write(team.id);
      await vi.advanceTimersByTimeAsync(10_000);

      expect(callsTo(route)).toHaveLength(1);
    });
  });

  describe('invite placeholders', () => {
    it('keeps a retrospective placeholder in the local cache only', async () => {
      const team = await createTeam();

      const placeholder = dataService.ensureSessionPlaceholder(team.id, 'live-retro');
      await flushPersistQueue();

      expect(placeholder?.id).toBe('live-retro');
      expect(dataService.getTeam(team.id)!.retrospectives.map(r => r.id)).toEqual(['live-retro']);
      // The join snapshot is the source of truth; a persisted placeholder has
      // no revision and overwrote the real retro in the team record.
      expect(callsTo(/\/retrospective\//)).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it('keeps a health-check placeholder in the local cache only', async () => {
      const team = await createTeam();

      const placeholder = dataService.ensureHealthCheckPlaceholder(team.id, 'live-hc');
      await flushPersistQueue();

      expect(placeholder?.id).toBe('live-hc');
      expect(dataService.getTeam(team.id)!.healthChecks?.map(h => h.id)).toEqual(['live-hc']);
      expect(calls).toHaveLength(0);
    });
  });
});
