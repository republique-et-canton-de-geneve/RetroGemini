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

// A ticket longer than the 50 characters an action's context quotes.
const LONG_TICKET = 'The build takes forty minutes on every single push to main and nobody knows why.';

// A team whose only open actions come from a retro's card and a retro's group,
// so the batch's preview has a context to quote for each.
const teamWithContexts = (): Team => ({
  ...baseTeam(),
  retrospectives: [retro([
    action('r-card', 'Cache the dependencies', { linkedTicketId: 'tkt-long' }),
    action('r-group', 'Split the pipeline', { linkedTicketId: 'grp-1' })
  ], {
    tickets: [{ id: 'tkt-long', colId: 'col-1', text: LONG_TICKET, authorId: 'mem-1', groupId: null, votes: [] }],
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

  it('counts one action fewer in the batch once a row created its issue', async () => {
    installJiraFetch(routes());
    render(<Harness currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira, Write the runbook' }));
    expect(await screen.findByRole('link', { name: 'TEAM-40, open in Jira (new tab)' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Create in Jira (1)' })).toBeInTheDocument());
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
  it('previews a card-linked action as the server describes it: the card quoted, cut at 50 characters', async () => {
    mocks.cache = teamWithContexts();
    installJiraFetch(routes());
    render(<Harness currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create the actions in Jira' });
    expect(within(dialog).getByText(
      'Action from the retrospective Sprint 12 (2026-10-06) — Re: "The build takes forty minutes on every single push...". Requested in RetroGemini as Facilitator.'
    )).toBeInTheDocument();
    // The row shows the whole card; the issue never does.
    expect(within(dialog).queryByText(/nobody knows why/)).toBeNull();
  });

  it('previews a group-linked action in the retrospective’s language, not the reader’s', async () => {
    mocks.cache = teamWithContexts();
    installJiraFetch(routes());
    render(<LanguageProvider initialLanguage="fr"><Harness currentUser={facilitator} /></LanguageProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'Créer dans Jira (2)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Créer les actions dans Jira' });
    expect(within(dialog).getByText(
      'Action from the retrospective Sprint 12 (2026-10-06) — Re: Group "Deploys". Requested in RetroGemini as Facilitator.'
    )).toBeInTheDocument();
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
