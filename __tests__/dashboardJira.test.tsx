import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ActionItem, JiraLink, RetroSession, Team, User } from '../types';
import LanguageProvider from '../i18n/LanguageProvider';
import { installJiraFetch, ok, refused, statusWith, type RouteHandler } from './helpers/jiraClientFetch';

/**
 * The Dashboard with Jira: a control on each open action of the list, "Create
 * in Jira (N)" over the open actions listed, and the team's Jira card in the
 * settings. After a creation the list re-reads the team (`onRefresh`), so a
 * row stops offering a creation it already has without a reload (finding
 * A-6). Driven against the real `jiraService` and a fetch answering as the
 * routes of contracts §3.
 */

const mocks = vi.hoisted(() => ({
  cache: null as Team | null
}));

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    addGlobalAction: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    setActionImpactRatingEnabled: vi.fn(),
    getTeam: vi.fn(() => mocks.cache),
    getAuthenticatedPassword: vi.fn(() => null),
    getSessionToken: () => 'token-1',
    whenPersisted: async () => {},
    // What the real one does to the cache, for the copies these tests hold.
    applyJiraLinks: (_teamId: string, links: { actionId: string; jira: JiraLink }[]) => {
      const team = mocks.cache;
      if (!team) return;
      const apply = (actions: ActionItem[]) => actions.map(a => {
        const link = links.find(l => l.actionId === a.id);
        return link ? { ...a, jira: link.jira } : a;
      });
      team.globalActions = apply(team.globalActions);
      team.retrospectives.forEach(r => { r.actions = apply(r.actions); });
    },
    applyJiraParents: (_teamId: string, entries: { scope: string; jira: unknown }[]) => {
      const team = mocks.cache;
      if (!team) return;
      const next = { ...(team.jiraParents ?? {}) };
      for (const { scope, jira } of entries) next[scope] = jira as never;
      team.jiraParents = next;
    }
  }
}));

import Dashboard from '../components/Dashboard';
import DashboardActionsTab from '../components/dashboard/DashboardActionsTab';
import { jiraInFlight } from '../components/jira/jiraInFlight';

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const participant: User = { id: 'mem-1', name: 'Alice', color: 'bg-blue-500', role: 'participant' };

const action = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  createdAt: '2026-10-20T08:00:00.000Z',
  ...overrides
});

const retro = (actions: ActionItem[], overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: '2026-10-06',
  status: 'CLOSED',
  phase: 'CLOSE',
  participants: [],
  icebreakerQuestion: '',
  templateLanguage: 'en',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions,
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
} as RetroSession);

const baseTeam = (): Team => ({
  id: 'team-1',
  name: 'Alpha',
  passwordHash: 'hash',
  members: [facilitator, participant],
  customTemplates: [],
  retrospectives: [retro([
    action('r-1', 'Speed up the build'),
    action('r-linked', 'Already in Jira', { jira: { key: 'TEAM-3', createdAt: '2026-10-10T08:00:00.000Z' } }),
    action('r-done', 'Finished one', { done: true })
  ])],
  globalActions: [action('g-1', 'Write the runbook')]
});

// What App does: `onRefresh` reads the cache again and passes a fresh copy.
const Harness: React.FC<{ currentUser: User; initialTab?: 'ACTIONS' | 'SETTINGS' }> = ({ currentUser, initialTab }) => {
  const [team, setTeam] = useState<Team>(() => structuredClone(mocks.cache!));
  return (
    <Dashboard
      team={team}
      currentUser={currentUser}
      onOpenSession={() => {}}
      onOpenHealthCheck={() => {}}
      onRefresh={() => setTeam(structuredClone(mocks.cache!))}
      initialTab={initialTab}
    />
  );
};

// Longer than every limit the builder has (the summary's 255, the 50 the
// screens cut a quote at), plain words only, with an end marker a cut at any
// length would lose (review R3).
const HUGE_CARD = `The build takes forty minutes ${'on every single push to main and nobody knows why '.repeat(24)}END OF THE CARD`;

// A team whose only open actions come from a retro's card and a retro's group,
// so the batch's preview has a context to quote for each.
const teamWithContexts = (): Team => ({
  ...baseTeam(),
  retrospectives: [retro([
    action('r-card', 'Cache the dependencies', { linkedTicketId: 'tkt-long' }),
    action('r-group', 'Split the pipeline', { linkedTicketId: 'grp-1' })
  ], {
    tickets: [
      { id: 'tkt-long', colId: 'col-1', text: HUGE_CARD, authorId: 'mem-1', groupId: null, votes: [] },
      { id: 'tkt-g2', colId: 'col-1', text: 'Rollbacks need a ticket?', authorId: 'mem-1', groupId: 'grp-1', votes: [] },
      { id: 'tkt-g1', colId: 'col-1', text: 'Deploys wait for a manual approval', authorId: 'fac-1', groupId: 'grp-1', votes: [] }
    ],
    groups: [{ id: 'grp-1', title: 'Deploys', colId: 'col-1', votes: [] }]
  })],
  globalActions: []
});

// A tab's button: its icon's ligature is part of its text.
const tabButton = (label: string) => screen.getByRole('button', { name: new RegExp(`${label}$`) });

const routes = (overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> => ({
  'jira/status': () => ok(statusWith()),
  '/api/info-message': () => ok({ message: '' }),
  '/api/ai-status': () => ok({ enabled: false }),
  'jira/issues': (body) => ok({
    results: (body.actionIds as string[]).map((actionId, i) => ({ actionId, status: 'created', key: `TEAM-${40 + i}` })),
    remaining: []
  }),
  ...overrides
});

describe('Dashboard with Jira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jiraInFlight.clear();
    mocks.cache = baseTeam();
  });

  it('offers a facilitator one control per open action and a batch over the open ones listed', async () => {
    installJiraFetch(routes());
    render(<Harness currentUser={facilitator} />);

    expect(await screen.findByRole('button', { name: 'Create in Jira (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Jira, Speed up the build' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Jira, Write the runbook' })).toBeInTheDocument();
    // An action with its issue shows it instead.
    expect(screen.getByRole('link', { name: 'TEAM-3, open in Jira (new tab)' })).toHaveAttribute('href', 'https://jira.example.org/browse/TEAM-3');
    expect(screen.queryByRole('button', { name: 'Create in Jira, Already in Jira' })).toBeNull();
  });

  it('loses the buttons of the rows a batch created, without a reload', async () => {
    const fetchCalls = installJiraFetch(routes());
    render(<Harness currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create the actions in Jira' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
    await within(dialog).findByText(/2 issues created\./);
    // No live session from the Dashboard: the server patches the actions' own.
    expect(fetchCalls.callsTo('jira/issues')[0].body.sessionId).toBeUndefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('link', { name: 'TEAM-40, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'TEAM-41, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Create in Jira, / })).toBeNull();
  });

  // A gateway gave up on the request (a 504 at the router's 30 s) after the
  // server had created and linked the first action. The Dashboard re-renders
  // from the cache, so the service reads the team once: the row shows its
  // key, and only the other action is left to check in Jira.
  it('shows what landed when the answer of a batch was lost', async () => {
    const fetchCalls = installJiraFetch(routes({
      'jira/issues': () => ({ status: 504, html: '<html>Gateway Timeout</html>' }),
      '/api/team/team-1': () => {
        const record = structuredClone(mocks.cache!);
        record.retrospectives[0].actions = record.retrospectives[0].actions.map(a => (
          a.id === 'r-1' ? { ...a, jira: { key: 'TEAM-50', createdAt: '2026-10-20T08:00:30.000Z' } } : a
        ));
        return ok({ team: record });
      }
    }));
    render(<Harness currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create the actions in Jira' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

    expect(await within(dialog).findByText('1 action was already in Jira')).toBeInTheDocument();
    expect(within(dialog).getByText('1 outcome unknown: check Jira before retrying')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'TEAM-50, open in Jira (new tab)' })).toBeInTheDocument();
    expect(fetchCalls.callsTo('jira/issues')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(await screen.findByRole('link', { name: 'TEAM-50, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Jira, Speed up the build' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create in Jira (1)' })).toBeInTheDocument();
  });

  it('counts one action fewer in the batch once a row created its issue', async () => {
    installJiraFetch(routes());
    render(<Harness currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira, Write the runbook' }));
    expect(await screen.findByRole('link', { name: 'TEAM-40, open in Jira (new tab)' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create in Jira (1)' })).toBeInTheDocument());
  });

  // A row's dialog previews from the team the tab was handed: each action
  // goes under the parent issue of the session that holds it, and an action
  // added on the dashboard under the team's own.
  describe('one parent issue per session', () => {
    const SESSION_TARGET = { mode: 'sessionParent' as const, projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: [] };
    const sessionParentRoutes = (overrides: Record<string, RouteHandler> = {}) => routes({
      'jira/status': () => ok(statusWith({ target: SESSION_TARGET })),
      '/jira/issue-types': () => ok({ issueTypes: [{ id: '10001', name: 'Task', subtask: false }, { id: '10003', name: 'Sub-task', subtask: true }], projectKey: 'TEAM', subtasksIncluded: true }),
      ...overrides
    });

    it('opens a backlog action\'s dialog under the team\'s parent issue, and reuses it once created', async () => {
      const fetchCalls = installJiraFetch(sessionParentRoutes({
        'jira/issues': () => ok({
          results: [{ actionId: 'g-1', status: 'created', key: 'TEAM-41', parentKey: 'TEAM-40' }],
          remaining: [],
          parents: [{ scope: 'backlog', status: 'created', key: 'TEAM-40' }]
        })
      }));
      mocks.cache!.globalActions.push(action('g-2', 'Book the room'));
      render(<Harness currentUser={facilitator} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira…, Write the runbook' }));
      let dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      let [row] = within(within(dialog).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('Team dashboard');
      expect(row).toHaveTextContent('New parent issue: Team actions: Alpha');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Close' }));
      expect(fetchCalls.callsTo('jira/issues')[0].body).not.toHaveProperty('sessionId');

      // The next one goes under the parent issue the first created: the tab
      // read the team again after the creation (`onRefresh`).
      fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira…, Book the room' }));
      dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      [row] = within(within(dialog).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('Existing parent issue');
      expect(within(row).getByRole('link', { name: 'TEAM-40, open in Jira (new tab)' })).toBeInTheDocument();
    });

    it('lists the parent issue of each session the batch touches', async () => {
      installJiraFetch(sessionParentRoutes());
      render(<Harness currentUser={facilitator} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira (2)' }));
      const dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      const rows = within(within(dialog).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(rows.map(row => row.firstChild?.textContent).sort()).toEqual(['Retrospective Sprint 12', 'Team dashboard']);
      expect(within(dialog).getByRole('button', { name: 'Create 4 issues' })).toBeInTheDocument();
    });
  });

  it('shows a participant the links and nothing to press', async () => {
    installJiraFetch(routes());
    render(<Harness currentUser={participant} />);

    expect(await screen.findByRole('link', { name: 'TEAM-3, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create in Jira/ })).toBeNull();
  });

  it('offers nothing to press on a deployment without Jira', async () => {
    const fetchCalls = installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ enabled: false, baseUrl: null, target: null })) }));
    render(<Harness currentUser={facilitator} />);

    await waitFor(() => expect(fetchCalls.callsTo('jira/status')).toHaveLength(1));
    // With no address to link to, a stored key is plain text.
    expect(await screen.findByText('Jira: TEAM-3')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /TEAM-3/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Create in Jira/ })).toBeNull();
  });

  it('leaves no Jira card in the settings of a server without Jira', async () => {
    const fetchCalls = installJiraFetch(routes({
      'jira/status': () => ok(statusWith({ enabled: false, token: { configured: false, usable: false, connectedAs: null, setAt: null } }))
    }));
    const { container } = render(<Harness currentUser={facilitator} initialTab="SETTINGS" />);

    await waitFor(() => expect(fetchCalls.callsTo('jira/status').length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Jira' })).toBeNull());
    // Nor its frame: the separator belongs to the card's own element, so a
    // card that renders nothing leaves no empty bordered, padded box behind.
    const emptyFrames = [...container.querySelectorAll('.border-t')]
      .filter((element) => element.childElementCount === 0 && (element.textContent ?? '').trim() === '');
    expect(emptyFrames).toEqual([]);
  });

  it('holds the team’s Jira card in the facilitator’s settings', async () => {
    installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ token: { configured: false, usable: false, connectedAs: null, setAt: null } })) }));
    render(<Harness currentUser={facilitator} initialTab="SETTINGS" />);

    const card = await screen.findByRole('region', { name: 'Jira' });
    expect(await within(card).findByLabelText('Jira access token')).toBeInTheDocument();
  });

  // The list's rows carry a context of their own (the whole card, "Group: …"
  // in the reader's language), made for the screen. The preview must be built
  // from the team record's copy, which is what the server builds the issue
  // from (finding U-8: the preview is exactly what Jira receives).
  // Maintainer, 2026-10-22: "Il ne faut pas abréger sinon on sait plus".
  it('previews a card-linked action as the server describes it: the card quoted in full', async () => {
    mocks.cache = teamWithContexts();
    installJiraFetch(routes());
    render(<Harness currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create the actions in Jira' });
    expect(within(dialog).getByText(
      `Action from the retrospective Sprint 12 (2026-10-06) — Re: "${HUGE_CARD}". Requested in RetroGemini as Facilitator.`
    )).toBeInTheDocument();
    expect(within(dialog).queryByText(/push\.\.\./)).toBeNull();
  });

  // The group's cards follow on their own lines, in board order, as Jira
  // will show them: the description element keeps its line breaks.
  it('previews a group-linked action in the retrospective’s language, its cards on their own lines', async () => {
    mocks.cache = teamWithContexts();
    installJiraFetch(routes());
    render(<LanguageProvider initialLanguage="fr"><Harness currentUser={facilitator} /></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Créer dans Jira (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Créer les actions dans Jira' });
    const items = within(within(dialog).getByRole('list', { name: 'Ce qui sera envoyé dans Jira' })).getAllByRole('listitem');
    const description = items[1].querySelector('dd[lang]');
    // `textContent`, not `getByText`: the latter folds the line breaks away.
    expect(description?.textContent).toBe(
      'Action from the retrospective Sprint 12 (2026-10-06) — Re: Group "Deploys". Requested in RetroGemini as Facilitator.\n'
      + '\n'
      + 'Cards in the group:\n'
      + '• Rollbacks need a ticket?\n'
      + '• Deploys wait for a manual approval'
    );
    expect(description).toHaveAttribute('lang', 'en');
    expect(description).toHaveClass('whitespace-pre-wrap');
    expect(within(dialog).queryByText(/Groupe\s*: Deploys/)).toBeNull();
  });

  it('counts and sends only the actions the list shows', async () => {
    const fetchCalls = installJiraFetch(routes());
    const team = mocks.cache!;
    // Two open actions in the team (r-1, g-1); the list shows one.
    const listed = team.retrospectives[0].actions
      .filter(a => a.id === 'r-1')
      .map(a => ({ ...a, originRetro: 'Sprint 12', contextText: '' }));
    render(
      <DashboardActionsTab
        team={team}
        knownMembers={team.members}
        actionFilter="OPEN"
        onActionFilterChange={() => {}}
        newActionText=""
        onNewActionTextChange={() => {}}
        newActionAssignee=""
        onNewActionAssigneeChange={() => {}}
        onCreateAction={() => {}}
        filteredActions={listed}
        onToggleAction={() => {}}
        onUpdateActionText={() => {}}
        onUpdateAssignee={() => {}}
        jiraStatus={statusWith()}
        isFacilitator
        requestedBy="Facilitator"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create in Jira (1)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create the actions in Jira' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 1 issue' }));
    await within(dialog).findByText(/1 issue created\./);
    expect(fetchCalls.callsTo('jira/issues').map(call => call.body.actionIds)).toEqual([['r-1']]);
  });

  it('reads the status again each time the Actions tab opens, so a token saved in Settings reaches its buttons', async () => {
    let tokenSaved = false;
    installJiraFetch(routes({
      'jira/status': () => ok(tokenSaved
        ? statusWith()
        : statusWith({ token: { configured: false, usable: false, connectedAs: null, setAt: null } }))
    }));
    render(<Harness currentUser={facilitator} />);

    expect(await screen.findByRole('button', { name: 'Create in Jira (2)' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(tabButton('Settings'));
    await screen.findByRole('region', { name: 'Jira' });
    // Saved there; the Actions tab has not been told.
    tokenSaved = true;
    fireEvent.click(tabButton('Actions'));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create in Jira (2)' })).not.toHaveAttribute('aria-disabled'));
  });

  // Each control is wired on its own: a creation refused because the token
  // can no longer be used means the status the list holds is stale.
  it.each([
    ['a row', 'Create in Jira, Write the runbook'],
    ['the batch', 'Create in Jira (2)']
  ])('reads the status again when a creation from %s says the one it holds is out of date', async (_from, buttonName) => {
    const fetchCalls = installJiraFetch(routes({ 'jira/issues': () => refused(409, 'jira_token_unusable') }));
    render(<Harness currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: buttonName }));
    const dialog = screen.queryByRole('dialog', { name: 'Create the actions in Jira' });
    if (dialog) fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

    await waitFor(() => expect(fetchCalls.callsTo('jira/status')).toHaveLength(2));
  });
});
