import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem, HealthCheckSession, RetroSession, Team } from '../types';

/**
 * The two pieces of `dataService` the Jira batch leans on.
 *
 * `whenPersisted()`: the server creates an issue only for an action it finds in
 * the team record, and an action typed a second ago may still be waiting in the
 * persist queue. The batch therefore waits for every write queued before the
 * click — and must not, in doing so, add anything to the queue: a write queued
 * there closes the window in which the next save of a session replaces the one
 * still waiting, and the facilitator typing the review summary would then send
 * one save per keystroke.
 *
 * `applyJiraLinks()`: the keys the server answered with reach every cached copy
 * of the action, so the Dashboard stops offering "Create in Jira" for an action
 * that already has its issue (finding A-6). It queues no persist: the server
 * wrote the link, and only it may (types.ts, `JiraLink`).
 */

const action = (id: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text: `Action ${id}`,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const retro = (id: string, actions: ActionItem[]): RetroSession => ({
  id,
  teamId: 'team-1',
  name: `Retro ${id}`,
  date: '2026-10-20',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  participants: [],
  discussionFocusId: null,
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions,
  openActionsSnapshot: [],
  historyActionsSnapshot: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  autoFinishedUsers: []
} as RetroSession);

const healthCheck = (id: string, actions: ActionItem[]): HealthCheckSession => ({
  id,
  teamId: 'team-1',
  templateId: 'team_health_en',
  templateName: 'Team health',
  name: `Health check ${id}`,
  date: '2026-10-20',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  dimensions: [],
  participants: [],
  ratings: {},
  actions,
  settings: { isAnonymous: false }
} as unknown as HealthCheckSession);

const baseTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Alpha',
  passwordHash: '',
  members: [{ id: 'fac', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: [],
  lastConnectionDate: '2026-10-20T00:00:00.000Z',
  ...overrides
});

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
};

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('dataService for the Jira batch', () => {
  let dataService: typeof import('../services/dataService').dataService;
  let fetchMock: ReturnType<typeof vi.fn>;
  let restoredTeam: Team;
  // Persist calls in the order they reached the network, with their bodies.
  let persists: { url: string; body: Record<string, unknown> }[];
  // When set, every persist waits on the next gate before answering.
  let gates: Deferred[] | null;

  const restore = async (team: Team) => {
    restoredTeam = team;
    await dataService.restoreSession('token-1');
    return dataService.getTeam(team.id)!;
  };

  beforeEach(async () => {
    vi.resetModules();
    persists = [];
    gates = null;
    fetchMock = vi.fn(async (url: string, options?: { body?: string }) => {
      const body = JSON.parse(options?.body || '{}');
      if (url === '/api/team/restore-session') {
        return { ok: true, status: 200, json: async () => ({ team: structuredClone(restoredTeam) }) };
      }
      persists.push({ url, body });
      const gate = gates?.shift();
      if (gate) await gate.promise;
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    dataService = (await import('../services/dataService')).dataService;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('whenPersisted', () => {
    it('resolves at once when nothing is queued', async () => {
      await restore(baseTeam());
      await expect(dataService.whenPersisted()).resolves.toBeUndefined();
    });

    it('waits for a save queued before the call', async () => {
      const team = await restore(baseTeam({ retrospectives: [retro('r1', [])] }));
      const gate = deferred();
      gates = [gate];

      dataService.updateSession(team.id, { ...team.retrospectives[0], name: 'Edited' });
      let done = false;
      const waiting = dataService.whenPersisted().then(() => { done = true; });

      await settle();
      expect(persists).toHaveLength(1);
      expect(done).toBe(false);

      gate.resolve();
      await waiting;
      expect(done).toBe(true);
    });

    it('waits for every write queued before the call, whatever their kind', async () => {
      const team = await restore(baseTeam({ retrospectives: [retro('r1', [])] }));
      const first = deferred();
      const second = deferred();
      gates = [first, second];

      dataService.updateSession(team.id, { ...team.retrospectives[0], name: 'Edited' });
      dataService.addGlobalAction(team.id, 'Typed a second ago', null);
      let done = false;
      const waiting = dataService.whenPersisted().then(() => { done = true; });

      first.resolve();
      await settle();
      await settle();
      expect(persists.map(p => p.url)).toEqual([
        '/api/team/team-1/retrospective/r1',
        '/api/team/team-1/action'
      ]);
      expect(done).toBe(false);

      second.resolve();
      await waiting;
      expect(done).toBe(true);
    });

    it('does not wait for a write queued after the call', async () => {
      const team = await restore(baseTeam());
      const gate = deferred();
      gates = [gate];

      const waiting = dataService.whenPersisted();
      dataService.addGlobalAction(team.id, 'Queued after the click', null);

      // Settles while the later write is still held at its gate.
      await expect(waiting).resolves.toBeUndefined();
      await settle();
      // And the later write was sent, not held back. That the call adds nothing
      // to the queue is the coalescing test's to show, below: a no-op queued
      // here would settle at once and pass this test too.
      expect(persists.map(p => p.url)).toEqual(['/api/team/team-1/action']);
      gate.resolve();
    });

    it('waits for a queued write that fails, then resolves', async () => {
      const team = await restore(baseTeam());
      const gate = deferred();
      fetchMock.mockImplementationOnce(async () => {
        await gate.promise;
        throw new TypeError('Failed to fetch');
      });
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      dataService.addGlobalAction(team.id, 'Will fail', null);
      let done = false;
      const waiting = dataService.whenPersisted().then(() => { done = true; });

      await settle();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(done).toBe(false);

      gate.resolve();
      await expect(waiting).resolves.toBeUndefined();
      expect(done).toBe(true);
    });

    it('adds nothing to the queue, so a later save of the same session still replaces the waiting one', async () => {
      // Save 1 is in flight; save 2 waits behind it. A newer save of the same
      // session replaces save 2 there. If whenPersisted queued anything, save 3
      // would queue on its own and the server would get one save per keystroke.
      const team = await restore(baseTeam({ retrospectives: [retro('r1', [])] }));
      const gate = deferred();
      gates = [gate];
      const session = team.retrospectives[0];

      dataService.updateSession(team.id, { ...session, name: 'One' });
      await settle();
      dataService.updateSession(team.id, { ...session, name: 'Two' });
      const waiting = dataService.whenPersisted();
      dataService.updateSession(team.id, { ...session, name: 'Three' });

      gate.resolve();
      await waiting;
      await settle();

      const names = persists.map(p => (p.body.retrospective as RetroSession).name);
      expect(names).toEqual(['One', 'Three']);
    });
  });

  describe('applyJiraLinks', () => {
    const NOW = '2026-10-20T10:00:00.000Z';

    it('sets the link on every cached copy: the backlog, retrospectives and health checks', async () => {
      const team = await restore(baseTeam({
        globalActions: [action('a1')],
        retrospectives: [retro('r1', [action('a1'), action('a2')])],
        healthChecks: [healthCheck('h1', [action('a3')])]
      }));

      dataService.applyJiraLinks(team.id, [
        { actionId: 'a1', jira: { key: 'TEAM-1', createdAt: NOW } },
        { actionId: 'a2', jira: { key: 'TEAM-2', createdAt: NOW } },
        { actionId: 'a3', jira: { uncertainSince: NOW } }
      ]);

      const cached = dataService.getTeam(team.id)!;
      expect(cached.globalActions[0].jira).toEqual({ key: 'TEAM-1', createdAt: NOW });
      expect(cached.retrospectives[0].actions[0].jira).toEqual({ key: 'TEAM-1', createdAt: NOW });
      expect(cached.retrospectives[0].actions[1].jira).toEqual({ key: 'TEAM-2', createdAt: NOW });
      expect(cached.healthChecks![0].actions[0].jira).toEqual({ uncertainSince: NOW });
    });

    it('queues no persist: only the server writes a link', async () => {
      const team = await restore(baseTeam({ globalActions: [action('a1')] }));

      dataService.applyJiraLinks(team.id, [{ actionId: 'a1', jira: { key: 'TEAM-1', createdAt: NOW } }]);
      await dataService.whenPersisted();
      await settle();

      expect(persists).toEqual([]);
    });

    it('never replaces a key with another key', async () => {
      const existing = { key: 'OLD-7', createdAt: '2026-10-01T00:00:00.000Z' };
      const team = await restore(baseTeam({ globalActions: [action('a1', { jira: existing })] }));

      dataService.applyJiraLinks(team.id, [{ actionId: 'a1', jira: { key: 'NEW-1', createdAt: NOW } }]);

      expect(dataService.getTeam(team.id)!.globalActions[0].jira).toEqual(existing);
    });

    it('never replaces a key with an uncertain marker', async () => {
      const existing = { key: 'OLD-7', createdAt: '2026-10-01T00:00:00.000Z' };
      const team = await restore(baseTeam({ globalActions: [action('a1', { jira: existing })] }));

      dataService.applyJiraLinks(team.id, [{ actionId: 'a1', jira: { uncertainSince: NOW } }]);

      expect(dataService.getTeam(team.id)!.globalActions[0].jira).toEqual(existing);
    });

    it('replaces an uncertain marker with a key', async () => {
      const team = await restore(baseTeam({
        globalActions: [action('a1', { jira: { uncertainSince: '2026-10-19T00:00:00.000Z' } })]
      }));

      dataService.applyJiraLinks(team.id, [{ actionId: 'a1', jira: { key: 'TEAM-3', createdAt: NOW } }]);

      expect(dataService.getTeam(team.id)!.globalActions[0].jira).toEqual({ key: 'TEAM-3', createdAt: NOW });
    });

    it('keeps the first uncertain marker: the doubt started then', async () => {
      const first = { uncertainSince: '2026-10-19T00:00:00.000Z' };
      const team = await restore(baseTeam({ globalActions: [action('a1', { jira: first })] }));

      dataService.applyJiraLinks(team.id, [{ actionId: 'a1', jira: { uncertainSince: NOW } }]);

      expect(dataService.getTeam(team.id)!.globalActions[0].jira).toEqual(first);
    });

    it('treats a stored value that is not a valid key as no link', async () => {
      const team = await restore(baseTeam({
        globalActions: [action('a1', { jira: { key: 'https://evil.example/x', createdAt: NOW } })]
      }));

      dataService.applyJiraLinks(team.id, [{ actionId: 'a1', jira: { key: 'TEAM-4', createdAt: NOW } }]);

      expect(dataService.getTeam(team.id)!.globalActions[0].jira).toEqual({ key: 'TEAM-4', createdAt: NOW });
    });

    it('ignores a link that is not one, so nothing but a key or a marker reaches the cache', async () => {
      const team = await restore(baseTeam({ globalActions: [action('a1'), action('a2'), action('a3')] }));

      dataService.applyJiraLinks(team.id, [
        { actionId: 'a1', jira: { key: 'not a key', createdAt: NOW } },
        { actionId: 'a2', jira: {} as never },
        { actionId: 'a3', jira: null as never }
      ]);

      const cached = dataService.getTeam(team.id)!;
      expect(cached.globalActions.map(a => a.jira)).toEqual([undefined, undefined, undefined]);
    });

    it('replaces the action object, so a screen holding the old one sees a change', async () => {
      const team = await restore(baseTeam({ globalActions: [action('a1')] }));
      const before = team.globalActions[0];

      dataService.applyJiraLinks(team.id, [{ actionId: 'a1', jira: { key: 'TEAM-1', createdAt: NOW } }]);

      expect(dataService.getTeam(team.id)!.globalActions[0]).not.toBe(before);
      expect(before.jira).toBeUndefined();
    });

    it('touches nothing for another team or an unknown action', async () => {
      const team = await restore(baseTeam({ globalActions: [action('a1')] }));

      dataService.applyJiraLinks('team-2', [{ actionId: 'a1', jira: { key: 'TEAM-1', createdAt: NOW } }]);
      dataService.applyJiraLinks(team.id, [{ actionId: 'ghost', jira: { key: 'TEAM-1', createdAt: NOW } }]);

      expect(dataService.getTeam(team.id)!.globalActions[0].jira).toBeUndefined();
    });
  });

  // The parent issue of each retrospective, health check and of the team
  // dashboard (`sessionParent` mode). Unlike an action's issue, a scope's
  // parent can legitimately change ("Also use … for their later actions"),
  // and a key reaches this function only from the server's answer or its
  // record, which both say what the server stores: a key replaces whatever
  // the scope holds [R7].
  describe('applyJiraParents', () => {
    const NOW = '2026-10-20T10:00:00.000Z';
    const EARLIER = '2026-10-19T00:00:00.000Z';

    it('caches each scope\'s key and mark, and queues no persist', async () => {
      const team = await restore(baseTeam());

      dataService.applyJiraParents(team.id, [
        { scope: 'retro:r1', jira: { key: 'TEAM-90', createdAt: NOW } },
        { scope: 'healthcheck:h1', jira: { uncertainSince: NOW } },
        { scope: 'backlog', jira: { key: 'TEAM-91', createdAt: NOW, subtaskTypeId: '10003' } }
      ]);
      await dataService.whenPersisted();
      await settle();

      expect(dataService.getTeam(team.id)!.jiraParents).toEqual({
        'retro:r1': { key: 'TEAM-90', createdAt: NOW },
        'healthcheck:h1': { uncertainSince: NOW },
        backlog: { key: 'TEAM-91', createdAt: NOW, subtaskTypeId: '10003' }
      });
      expect(persists).toEqual([]);
    });

    it('lets a reported key replace a cached key or mark', async () => {
      const team = await restore(baseTeam({
        jiraParents: {
          'retro:r1': { key: 'OLD-1', createdAt: EARLIER },
          'retro:r2': { uncertainSince: EARLIER }
        }
      }));

      dataService.applyJiraParents(team.id, [
        { scope: 'retro:r1', jira: { key: 'OPS-5', createdAt: NOW } },
        { scope: 'retro:r2', jira: { key: 'TEAM-92', createdAt: NOW } }
      ]);

      expect(dataService.getTeam(team.id)!.jiraParents).toEqual({
        'retro:r1': { key: 'OPS-5', createdAt: NOW },
        'retro:r2': { key: 'TEAM-92', createdAt: NOW }
      });
    });

    it('never lets a mark replace a key, nor an earlier mark', async () => {
      const team = await restore(baseTeam({
        jiraParents: {
          'retro:r1': { key: 'TEAM-90', createdAt: EARLIER },
          'retro:r2': { uncertainSince: EARLIER }
        }
      }));

      dataService.applyJiraParents(team.id, [
        { scope: 'retro:r1', jira: { uncertainSince: NOW } },
        { scope: 'retro:r2', jira: { uncertainSince: NOW } }
      ]);

      expect(dataService.getTeam(team.id)!.jiraParents).toEqual({
        'retro:r1': { key: 'TEAM-90', createdAt: EARLIER },
        'retro:r2': { uncertainSince: EARLIER }
      });
    });

    it('ignores what is not a scope, a key or a mark, and another team', async () => {
      const team = await restore(baseTeam());

      dataService.applyJiraParents(team.id, [
        { scope: 'not a scope', jira: { key: 'TEAM-1', createdAt: NOW } },
        { scope: 'retro:r1', jira: { key: 'https://evil.example/x', createdAt: NOW } },
        { scope: 'retro:r2', jira: {} as never },
        { scope: 'retro:r3', jira: null as never }
      ]);
      dataService.applyJiraParents('team-2', [{ scope: 'backlog', jira: { key: 'TEAM-1', createdAt: NOW } }]);

      expect(dataService.getTeam(team.id)!.jiraParents ?? {}).toEqual({});
    });

    it('replaces the map, so a screen holding the old one sees a change', async () => {
      const team = await restore(baseTeam({ jiraParents: { backlog: { uncertainSince: EARLIER } } }));
      const before = dataService.getTeam(team.id)!.jiraParents;

      dataService.applyJiraParents(team.id, [{ scope: 'backlog', jira: { key: 'TEAM-1', createdAt: NOW } }]);

      expect(dataService.getTeam(team.id)!.jiraParents).not.toBe(before);
      expect(before).toEqual({ backlog: { uncertainSince: EARLIER } });
    });
  });

  // A whole-action edit (a text or an assignee, from the Dashboard or a Review
  // step) is built from whatever copy the screen holds, a live session's
  // included. Only the Jira route writes a link, so the edit keeps the cached
  // one and never takes one from its caller.
  describe('updateGlobalAction and the Jira link', () => {
    const KEY = { key: 'TEAM-1', createdAt: '2026-10-20T10:00:00.000Z' };

    it('keeps the cached link when the edited copy has none', async () => {
      const team = await restore(baseTeam({ globalActions: [action('a1', { jira: KEY })] }));

      dataService.updateGlobalAction(team.id, { ...action('a1'), text: 'Edited' });
      await dataService.whenPersisted();

      const cached = dataService.getTeam(team.id)!.globalActions[0];
      expect(cached.text).toBe('Edited');
      expect(cached.jira).toEqual(KEY);
      const sent = persists.find(p => p.url === '/api/team/team-1/action')!.body.action as ActionItem;
      expect(sent.jira).toEqual(KEY);
    });

    it('takes no link from the caller, for an action of a retrospective or a health check', async () => {
      const team = await restore(baseTeam({
        retrospectives: [retro('r1', [action('r-a')])],
        healthChecks: [healthCheck('h1', [action('h-a', { jira: KEY })])]
      }));
      const planted = { key: 'EVIL-1', createdAt: '2026-10-20T10:00:00.000Z' };

      dataService.updateGlobalAction(team.id, { ...action('r-a'), assigneeId: 'fac', jira: planted });
      dataService.updateGlobalAction(team.id, { ...action('h-a'), assigneeId: 'fac', jira: { uncertainSince: 'x' } });
      await dataService.whenPersisted();

      const cached = dataService.getTeam(team.id)!;
      expect(cached.retrospectives[0].actions[0]).toMatchObject({ assigneeId: 'fac' });
      expect(cached.retrospectives[0].actions[0].jira).toBeUndefined();
      expect('jira' in cached.retrospectives[0].actions[0]).toBe(false);
      expect(cached.healthChecks![0].actions[0].jira).toEqual(KEY);
      const sent = persists.filter(p => p.url === '/api/team/team-1/action').map(p => p.body.action as ActionItem);
      expect(sent.map(a => a.jira)).toEqual([undefined, KEY]);
    });
  });
});
