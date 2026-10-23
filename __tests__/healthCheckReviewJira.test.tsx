import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ActionItem, HealthCheckSession as HealthCheckSessionType, JiraLink, Team, User } from '../types';
import { JIRA_NOTE_STORAGE_KEY } from '../components/jira/JiraDiscoveryNote';
import { installJiraFetch, ok, refused, statusWith, type RouteHandler } from './helpers/jiraClientFetch';

/**
 * The health check's Review step with Jira: the same note, reason line, batch
 * button and per-action control as the retrospective's, and the done toggle
 * and assignee going to the team record first (finding A-10). Driven against
 * the real `jiraService` and a fetch answering as the routes of contracts §3.
 */

const mocks = vi.hoisted(() => ({
  cache: null as Team | null,
  // What the screen subscribed to, so a test can deliver a server state or a
  // connection change.
  deliver: [] as ((session: unknown) => void)[],
  connection: [] as ((connected: boolean) => void)[]
}));

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => mocks.cache),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null,
    whenPersisted: async () => {},
    applyJiraParents: (_teamId: string, entries: { scope: string; jira: unknown }[]) => {
      if (!mocks.cache) return;
      const next = { ...(mocks.cache.jiraParents ?? {}) };
      for (const { scope, jira } of entries) next[scope] = jira as never;
      mocks.cache.jiraParents = next;
    },
    applyJiraLinks: (_teamId: string, links: { actionId: string; jira: JiraLink }[]) => {
      for (const hc of mocks.cache?.healthChecks ?? []) {
        hc.actions = hc.actions.map(a => {
          const link = links.find(l => l.actionId === a.id);
          return link ? { ...a, jira: link.jira } : a;
        });
      }
    }
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn((callback: (session: unknown) => void) => {
      mocks.deliver.push(callback);
      return () => {};
    }),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(() => 'hc-1'),
    leaveSession: vi.fn(),
    onConnectionChange: vi.fn((callback: (connected: boolean) => void) => {
      mocks.connection.push(callback);
      return () => {};
    }),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true)
  }
}));

import HealthCheckSession from '../components/HealthCheckSession';
import { dataService } from '../services/dataService';
import { jiraInFlight } from '../components/jira/jiraInFlight';

const facilitator: User = { id: 'fac', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'a', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

const action = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  linkedTicketId: 'd1',
  ...overrides
});

const healthCheck = (overrides: Partial<HealthCheckSessionType> = {}): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Health Check R2610',
  date: '2026-10-20',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  templateId: 'team_health_en',
  templateName: 'Team health (EN)',
  dimensions: [{ id: 'd1', name: 'Autonomy', goodDescription: 'Good', badDescription: 'Bad' }],
  participants: [facilitator, alice],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: {},
  actions: [
    action('hc-a1', 'Talk to ops'),
    action('hc-a2', 'Pair on deploys'),
    action('hc-done', 'Already done', { done: true })
  ],
  discussionFocusId: null,
  roti: {},
  finishedUsers: [],
  ...overrides
});

const teamWith = (session: HealthCheckSessionType): Team => ({
  id: 'team-1',
  name: 'Alpha',
  passwordHash: 'hash',
  members: [facilitator, alice],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [session]
});

const routes = (overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> => ({
  'jira/status': () => ok(statusWith()),
  ...overrides
});

const renderHealthCheck = (session: HealthCheckSessionType, currentUser: User, extra: Partial<Team> = {}) => {
  // dataService holds its own copy, as the real one does.
  mocks.cache = { ...teamWith(structuredClone(session)), ...structuredClone(extra) };
  return render(
    <HealthCheckSession team={{ ...teamWith(session), ...extra }} currentUser={currentUser} sessionId={session.id} onExit={() => {}} />
  );
};

const rowOf = (text: string) => screen.getByText(text).closest('[data-action-id]') as HTMLElement;

describe('HealthCheckSession Review with Jira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(JIRA_NOTE_STORAGE_KEY);
    jiraInFlight.clear();
    mocks.deliver = [];
    mocks.connection = [];
  });

  it('shows the discovery note to a participant of a team without a token', async () => {
    installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ token: { configured: false, usable: false, connectedAs: null, setAt: null } })) }));
    renderHealthCheck(healthCheck(), alice);

    const note = await screen.findByRole('note', { name: 'New: create your actions in Jira' });
    expect(within(note).getByText(/Your facilitator can send the actions to Jira\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create in Jira/ })).toBeNull();

    // Remembered for the person who read it, in this browser.
    fireEvent.click(within(note).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(JIRA_NOTE_STORAGE_KEY) ?? '[]')).toEqual([alice.id]);
  });

  it('shows nothing about Jira on a deployment without it', async () => {
    // Turned off, with its address still configured (contracts §2): the link
    // below appears only once that status is in, so the absences that follow
    // are what "off" shows, not a status still being read.
    installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ enabled: false })) }));
    renderHealthCheck(healthCheck({
      actions: [
        action('hc-a1', 'Talk to ops', { jira: { key: 'TEAM-6', createdAt: '2026-10-20T10:00:00.000Z' } }),
        action('hc-a2', 'Pair on deploys')
      ]
    }), facilitator);

    expect(await screen.findByRole('link', { name: 'TEAM-6, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: /Jira/ })).toBeNull();
    expect(screen.queryByText(/Settings → Jira/)).toBeNull();
  });

  it('gives a facilitator who can create the batch button and a control on each open action', async () => {
    installJiraFetch(routes());
    renderHealthCheck(healthCheck(), facilitator);

    expect(await screen.findByRole('button', { name: 'Create in Jira (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Jira, Talk to ops' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Jira, Pair on deploys' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Jira, Already done' })).toBeNull();
  });

  it('tells a facilitator whose token Jira refused why, beside an unavailable batch button', async () => {
    installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ token: { usable: false, refusedAt: '2026-10-19T08:00:00.000Z' } })) }));
    window.localStorage.setItem(JIRA_NOTE_STORAGE_KEY, JSON.stringify([facilitator.id]));
    renderHealthCheck(healthCheck(), facilitator);

    const button = await screen.findByRole('button', { name: 'Create in Jira (2)' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/Jira refused the team’s token on .*: replace it in Settings → Jira\./);
    // The same layout as the retrospective's step and the Dashboard: the note
    // right under the button, docked with it to the right edge.
    const note = screen.getByText(/Jira refused the team’s token on/).closest('p')!;
    expect(button.nextElementSibling).toBe(note);
    expect(button.parentElement).toHaveClass('sm:ml-auto', 'sm:items-end');
    // This facilitator dismissed the note already, in this browser.
    expect(screen.queryByRole('note', { name: 'New: create your actions in Jira' })).toBeNull();
  });

  it('names this health check in the request and shows every key a batch created on its rows', async () => {
    const fetchCalls = installJiraFetch(routes({
      'jira/issues': (body) => ok({
        results: (body.actionIds as string[]).map((actionId, i) => ({ actionId, status: 'created', key: `TEAM-${20 + i}` })),
        remaining: []
      })
    }));
    renderHealthCheck(healthCheck(), facilitator);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create the actions in Jira' });
    // The preview is the health check's own wording.
    expect(within(dialog).getAllByText(/Action from the health check Health Check R2610/).length).toBe(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
    await within(dialog).findByText(/2 issues created\./);
    expect(fetchCalls.callsTo('jira/issues')[0].body).toMatchObject({ actionIds: ['hc-a1', 'hc-a2'], sessionId: 'hc-1' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    // No patched session has arrived: the rows read the keys the cache learned.
    expect(await screen.findByRole('link', { name: 'TEAM-20, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TEAM-21, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Create in Jira, / })).toBeNull();
  });

  describe('one parent issue per health check', () => {
    const SESSION_TARGET = { mode: 'sessionParent' as const, projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: [] };
    const sessionParentRoutes = (overrides: Record<string, RouteHandler> = {}) => routes({
      'jira/status': () => ok(statusWith({ target: SESSION_TARGET })),
      '/jira/issue-types': () => ok({ issueTypes: [{ id: '10001', name: 'Task', subtask: false }, { id: '10003', name: 'Sub-task', subtask: true }], projectKey: 'TEAM', subtasksIncluded: true }),
      ...overrides
    });

    it('shows the facilitator its parent issue by its key, and a participant nothing', async () => {
      installJiraFetch(sessionParentRoutes());
      const parents = { jiraParents: { 'healthcheck:hc-1': { key: 'TEAM-90', createdAt: 'x' } } };
      const { unmount } = renderHealthCheck(healthCheck(), facilitator, parents);
      const link = await screen.findByRole('link', { name: 'TEAM-90, open in Jira (new tab)' });
      expect(link.closest('p')).toHaveTextContent('Parent issue in Jira:');
      unmount();

      renderHealthCheck(healthCheck({ actions: [action('hc-a1', 'Talk to ops', { jira: { key: 'TEAM-5', createdAt: 'x' } })] }), alice, parents);
      expect(await screen.findByRole('link', { name: 'TEAM-5, open in Jira (new tab)' })).toBeInTheDocument();
      expect(screen.queryByText('Parent issue in Jira:')).toBeNull();
    });

    it('shows a parent issue in doubt with a search for its title', async () => {
      installJiraFetch(sessionParentRoutes());
      renderHealthCheck(healthCheck(), facilitator, { jiraParents: { 'healthcheck:hc-1': { uncertainSince: '2026-10-20T09:00:00.000Z' } } });

      const check = await screen.findByRole('link', { name: 'Check in Jira, parent issue (new tab)' });
      expect(decodeURIComponent(check.getAttribute('href') ?? '')).toContain('summary ~ "health check actions health check r2610 2026 10 20"');
    });

    it('opens the dialog from a row, and shows the parent issue the batch created once it closes', async () => {
      installJiraFetch(sessionParentRoutes({
        'jira/issues': () => ok({
          results: [{ actionId: 'hc-a1', status: 'created', key: 'TEAM-41', parentKey: 'TEAM-40' }],
          remaining: [],
          parents: [{ scope: 'healthcheck:hc-1', status: 'created', key: 'TEAM-40' }]
        })
      }));
      renderHealthCheck(healthCheck(), facilitator);

      fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira…, Talk to ops' }));
      const dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      const [row] = within(within(dialog).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('Health check Health Check R2610');
      expect(row).toHaveTextContent('New parent issue: Health check actions: Health Check R2610 (2026-10-20)');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Close' }));
      const parentLink = await screen.findByRole('link', { name: 'TEAM-40, open in Jira (new tab)' });
      expect(parentLink.closest('p')).toHaveTextContent('Parent issue in Jira:');
    });

    // [review F2-3] The parent changed and the action did not: the screen
    // must still read the record again.
    it('shows the parent issue the row created once its dialog closes, even when Jira refused the action itself', async () => {
      installJiraFetch(sessionParentRoutes({
        'jira/issues': () => ok({
          results: [{ actionId: 'hc-a1', status: 'refused', jiraMessages: ['The summary is too long.'] }],
          remaining: [],
          parents: [{ scope: 'healthcheck:hc-1', status: 'created', key: 'TEAM-40' }]
        })
      }));
      renderHealthCheck(healthCheck(), facilitator);

      fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira…, Talk to ops' }));
      const dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      await within(dialog).findByText('The summary is too long.');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

      const parentLink = await screen.findByRole('link', { name: 'TEAM-40, open in Jira (new tab)' });
      expect(parentLink.closest('p')).toHaveTextContent('Parent issue in Jira:');
    });
  });

  it('shows a participant the link the live session carries', async () => {
    installJiraFetch(routes());
    renderHealthCheck(healthCheck({
      actions: [action('hc-a1', 'Talk to ops', { jira: { key: 'TEAM-5', createdAt: '2026-10-20T10:00:00.000Z' } })]
    }), alice);

    const link = await screen.findByRole('link', { name: 'TEAM-5, open in Jira (new tab)' });
    expect(link).toHaveAttribute('href', 'https://jira.example.org/browse/TEAM-5');
  });

  it('counts one action fewer in the batch once a row created its issue', async () => {
    const fetchCalls = installJiraFetch(routes({
      'jira/issues': (body) => ok({
        results: (body.actionIds as string[]).map(actionId => ({ actionId, status: 'created', key: 'TEAM-30' })),
        remaining: []
      })
    }));
    renderHealthCheck(healthCheck(), facilitator);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira, Talk to ops' }));
    expect(await screen.findByRole('link', { name: 'TEAM-30, open in Jira (new tab)' })).toBeInTheDocument();
    // The row's request names this health check too, so the server patches its row (A-5).
    expect(fetchCalls.callsTo('jira/issues')[0].body).toMatchObject({ actionIds: ['hc-a1'], sessionId: 'hc-1' });
    // Read from the cache the creation wrote: no patched session has arrived.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create in Jira (1)' })).toBeInTheDocument());
  });

  describe('reads the status again when it may have changed (U-9)', () => {
    const statusCalls = (fetchCalls: ReturnType<typeof installJiraFetch>) => fetchCalls.callsTo('jira/status').length;

    it('on a reconnection during Review', async () => {
      const fetchCalls = installJiraFetch(routes());
      renderHealthCheck(healthCheck(), facilitator);
      await screen.findByRole('button', { name: 'Create in Jira (2)' });
      const before = statusCalls(fetchCalls);

      act(() => mocks.connection.forEach(callback => callback(false)));
      act(() => mocks.connection.forEach(callback => callback(true)));

      await waitFor(() => expect(statusCalls(fetchCalls)).toBeGreaterThan(before));
    });

    it('on entering Review', async () => {
      const fetchCalls = installJiraFetch(routes());
      renderHealthCheck(healthCheck({ phase: 'DISCUSS' }), facilitator);
      await waitFor(() => expect(statusCalls(fetchCalls)).toBe(1));

      // The facilitator moves the session on; this screen learns it from the server.
      act(() => mocks.deliver.forEach(callback => callback(healthCheck({ phase: 'REVIEW' }))));

      expect(await screen.findByRole('button', { name: 'Create in Jira (2)' })).toBeInTheDocument();
      await waitFor(() => expect(statusCalls(fetchCalls)).toBe(2));
    });

    // Each control is wired on its own: a creation refused because the
    // token can no longer be used means the status the screen holds is stale.
    it.each([
      ['a row', 'Create in Jira, Talk to ops'],
      ['the batch', 'Create in Jira (2)']
    ])('when a creation from %s says the status it holds is out of date', async (_from, buttonName) => {
      const fetchCalls = installJiraFetch(routes({ 'jira/issues': () => refused(409, 'jira_token_unusable') }));
      renderHealthCheck(healthCheck(), facilitator);

      fireEvent.click(await screen.findByRole('button', { name: buttonName }));
      const dialog = screen.queryByRole('dialog', { name: 'Create the actions in Jira' });
      if (dialog) fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      await waitFor(() => expect(statusCalls(fetchCalls)).toBe(2));
    });
  });

  // What these pin is the end state: the granular route is called, and the
  // session write carries the same value. The handler also calls the route
  // before `updateSession`, so the persist reads the new value from the
  // cache, but that order cannot be observed here: the persist runs inside
  // the `setSession` updater, which React runs after the handler returns,
  // whichever of the two calls comes first in it. The order is pinned in the
  // source, and the end state against the real data layer, by
  // healthCheckReviewTeamRecord.test.tsx.
  describe('the done toggle and the assignee reach the team record (A-10)', () => {
    it('closes the action in the team record as well as in the session', async () => {
      installJiraFetch(routes());
      renderHealthCheck(healthCheck(), facilitator);
      await screen.findByRole('button', { name: 'Create in Jira (2)' });

      fireEvent.click(within(rowOf('Talk to ops')).getByRole('button', { name: 'Mark action as done' }));

      expect(dataService.toggleGlobalAction).toHaveBeenCalledWith('team-1', 'hc-a1');
      const written = vi.mocked(dataService.updateHealthCheckSession).mock.calls.at(-1)![1];
      expect(written.actions.find(a => a.id === 'hc-a1')?.done).toBe(true);
    });

    it('never flips the record the wrong way when it disagrees with the screen', async () => {
      installJiraFetch(routes());
      // Left by the bug this fixes: the session says done, the record still open.
      const session = healthCheck({ actions: [action('hc-a1', 'Talk to ops', { done: true })] });
      renderHealthCheck(session, facilitator);
      mocks.cache!.healthChecks![0].actions[0].done = false;

      fireEvent.click(await screen.findByRole('button', { name: 'Mark action as not done' }));

      // The record already says open: flipping it would close it.
      expect(dataService.toggleGlobalAction).not.toHaveBeenCalled();
      const written = vi.mocked(dataService.updateHealthCheckSession).mock.calls.at(-1)![1];
      expect(written.actions[0].done).toBe(false);
    });

    it('sends an assignee change to the team record as well as to the session', async () => {
      installJiraFetch(routes());
      renderHealthCheck(healthCheck(), facilitator);
      await screen.findByRole('button', { name: 'Create in Jira (2)' });

      fireEvent.change(screen.getByRole('combobox', { name: 'Assignee for the action: Talk to ops' }), { target: { value: 'a' } });

      expect(dataService.updateGlobalAction).toHaveBeenCalledWith('team-1', expect.objectContaining({ id: 'hc-a1', assigneeId: 'a' }));
      const written = vi.mocked(dataService.updateHealthCheckSession).mock.calls.at(-1)![1];
      expect(written.actions.find(a => a.id === 'hc-a1')?.assigneeId).toBe('a');
    });

    it('lets a participant change neither', async () => {
      installJiraFetch(routes());
      renderHealthCheck(healthCheck(), alice);
      await screen.findByText('Review Actions');
      const sessionWrites = vi.mocked(dataService.updateHealthCheckSession).mock.calls.length;

      fireEvent.click(within(rowOf('Talk to ops')).getByRole('button', { name: 'Mark action as done' }));
      // The select is disabled for a participant; the handler refuses too.
      fireEvent.change(screen.getByRole('combobox', { name: 'Assignee for the action: Talk to ops' }), { target: { value: 'a' } });

      expect(dataService.toggleGlobalAction).not.toHaveBeenCalled();
      expect(dataService.updateGlobalAction).not.toHaveBeenCalled();
      expect(vi.mocked(dataService.updateHealthCheckSession).mock.calls.length).toBe(sessionWrites);
    });
  });
});
