import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ActionItem, JiraLink, RetroSession, Team, User } from '../types';
import { JIRA_NOTE_STORAGE_KEY } from '../components/jira/JiraDiscoveryNote';
import { installJiraFetch, ok, refused, statusWith, type RouteHandler } from './helpers/jiraClientFetch';

/**
 * The retrospective's Review step with Jira (findings A-5, A-6, U-1, U-9):
 * the discovery note for everyone, the batch button over the session's new
 * actions, a control on every open action — new and previous — and the link
 * of an action that has its issue, wherever that link is known. Driven against
 * the real `jiraService` and a fetch answering as the routes of contracts §3.
 */

const mocks = vi.hoisted(() => ({
  team: null as Team | null,
  applyJiraLinks: (() => {}) as (teamId: string, links: { actionId: string; jira: JiraLink }[]) => void
}));
vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => mocks.team),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    deleteAction: vi.fn(),
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null,
    whenPersisted: async () => {},
    applyJiraLinks: (teamId: string, links: { actionId: string; jira: JiraLink }[]) => mocks.applyJiraLinks(teamId, links),
    // What the real one does to the cache: the map is replaced.
    applyJiraParents: (_teamId: string, entries: { scope: string; jira: unknown }[]) => {
      if (!mocks.team) return;
      const next = { ...(mocks.team.jiraParents ?? {}) };
      for (const { scope, jira } of entries) next[scope] = jira as never;
      mocks.team.jiraParents = next;
    }
  }
}));

import ReviewPhase from '../components/session/ReviewPhase';
import { dataService } from '../services/dataService';
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
  ...overrides
});

const retro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-2',
  teamId: 'team-1',
  name: 'Sprint 13',
  date: '2026-10-20',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  participants: [facilitator, participant],
  discussionFocusId: null,
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
  tickets: [{ id: 'tkt-1', colId: 'col-1', text: 'The build is slow', authorId: 'fac-1', groupId: null, votes: [] }],
  groups: [],
  actions: [action('new-1', 'Fix the build', { linkedTicketId: 'tkt-1' })],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const previousRetro = (actions: ActionItem[]): RetroSession => retro({
  id: 'retro-1',
  name: 'Sprint 12',
  date: '2026-10-06',
  status: 'CLOSED',
  phase: 'CLOSE',
  tickets: [],
  actions
});

// The cache holds its own copy of the running retro, as dataService does: what
// the cache learns must not reach the session the screen shows by accident.
const teamWith = (current: RetroSession, previous: ActionItem[] = []): Team => ({
  id: 'team-1',
  name: 'Alpha',
  passwordHash: 'hash',
  members: [facilitator, participant],
  customTemplates: [],
  retrospectives: [structuredClone(current), previousRetro(previous)],
  globalActions: []
});

// What the real applyJiraLinks does to the cache, for the copies these tests hold.
const applyToCache = (links: { actionId: string; jira: JiraLink }[]) => {
  for (const r of mocks.team?.retrospectives ?? []) {
    r.actions = r.actions.map(a => {
      const link = links.find(l => l.actionId === a.id);
      return link ? { ...a, jira: link.jira } : a;
    });
  }
};

interface HarnessProps {
  session: RetroSession;
  team: Team;
  currentUser: User;
  historyActionIds?: string[];
  isLive?: boolean;
  onTick?: () => void;
}

// The parts of Session.tsx ReviewPhase leans on: the refresh tick that makes
// it read the cache again.
const Harness: React.FC<HarnessProps> = ({ session, team, currentUser, historyActionIds = [], isLive = true, onTick }) => {
  const [, setTick] = useState(0);
  const setRefreshTick: React.Dispatch<React.SetStateAction<number>> = (value) => {
    onTick?.();
    setTick(value);
  };
  return (
    <ReviewPhase
      session={session}
      team={team}
      currentUser={currentUser}
      isFacilitator={currentUser.role === 'facilitator'}
      historyActionIds={historyActionIds}
      setPhase={vi.fn()}
      updateSession={vi.fn()}
      applyActionUpdate={vi.fn()}
      buildActionContext={() => ''}
      assignableMembers={team.members}
      setRefreshTick={setRefreshTick}
      isLive={isLive}
    />
  );
};

const routes = (overrides: Record<string, RouteHandler> = {}): Record<string, RouteHandler> => ({
  'jira/status': () => ok(statusWith()),
  ...overrides
});

describe('ReviewPhase with Jira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem(JIRA_NOTE_STORAGE_KEY);
    mocks.applyJiraLinks = (_teamId, links) => applyToCache(links);
    jiraInFlight.clear();
  });

  it('shows the discovery note to a participant of a team without a token, and no control', async () => {
    installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ token: { configured: false, usable: false, connectedAs: null, setAt: null } })) }));
    const session = retro();
    mocks.team = teamWith(session);
    render(<Harness session={session} team={mocks.team} currentUser={participant} />);

    const note = await screen.findByRole('note', { name: 'New: create your actions in Jira' });
    expect(within(note).getByText(/Your facilitator can send the actions to Jira\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create in Jira/ })).toBeNull();
    // First in the step, above the summary: read before anything else.
    const summaryHeading = screen.getByRole('heading', { name: 'Retro Report Summary' });
    expect(note.compareDocumentPosition(summaryHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Remembered for the person who read it, in this browser.
    fireEvent.click(within(note).getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(JIRA_NOTE_STORAGE_KEY) ?? '[]')).toEqual([participant.id]);
  });

  it('shows nothing about Jira on a deployment without it', async () => {
    // Turned off, with its address still configured (contracts §2): the link
    // below appears only once that status is in, so the absences that follow
    // are what "off" shows, not a status still being read.
    installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ enabled: false })) }));
    const session = retro({
      actions: [
        action('new-1', 'Fix the build', { linkedTicketId: 'tkt-1' }),
        action('new-2', 'Cache the dependencies', { jira: { key: 'TEAM-7', createdAt: '2026-10-20T10:00:00.000Z' } })
      ]
    });
    mocks.team = teamWith(session);
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

    expect(await screen.findByRole('link', { name: 'TEAM-7, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: /Jira/ })).toBeNull();
    expect(screen.queryByText(/Settings → Jira/)).toBeNull();
  });

  it('gives a facilitator who can create the batch button and a control on every open action, previous ones included', async () => {
    installJiraFetch(routes());
    const session = retro();
    mocks.team = teamWith(session, [
      action('old-1', 'Write the runbook'),
      action('old-done', 'Already finished', { done: true })
    ]);
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} historyActionIds={['old-1', 'old-done']} />);

    expect(await screen.findByRole('button', { name: 'Create in Jira (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Jira, Fix the build' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create in Jira, Write the runbook' })).toBeInTheDocument();
    // A closed action is not offered.
    expect(screen.queryByRole('button', { name: 'Create in Jira, Already finished' })).toBeNull();
  });

  it('tells a facilitator of a team without a token why, beside an unavailable batch button', async () => {
    installJiraFetch(routes({ 'jira/status': () => ok(statusWith({ token: { configured: false, usable: false, connectedAs: null, setAt: null } })) }));
    const session = retro();
    mocks.team = teamWith(session);
    window.localStorage.setItem(JIRA_NOTE_STORAGE_KEY, JSON.stringify([facilitator.id]));
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

    const button = await screen.findByRole('button', { name: 'Create in Jira (1)' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(/Jira is not connected for this team: add an access token in Settings → Jira\./);
    expect(screen.queryByRole('button', { name: 'Create in Jira, Fix the build' })).toBeNull();
    // This facilitator dismissed the note already, in this browser.
    expect(screen.queryByRole('note', { name: 'New: create your actions in Jira' })).toBeNull();
  });

  it('shows the link of a previous action that only the session’s history snapshot knows', async () => {
    installJiraFetch(routes());
    const session = retro({
      historyActionsSnapshot: [action('old-1', 'Write the runbook', { jira: { key: 'TEAM-9', createdAt: '2026-10-20T10:00:00.000Z' } })]
    });
    // The participant's cache never learned the key: only the patched session row has it.
    mocks.team = teamWith(session, [action('old-1', 'Write the runbook')]);
    render(<Harness session={session} team={mocks.team} currentUser={participant} />);

    const link = await screen.findByRole('link', { name: 'TEAM-9, open in Jira (new tab)' });
    expect(link).toHaveAttribute('href', 'https://jira.example.org/browse/TEAM-9');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('never offers to create again a previous action whose link is in the history snapshot only', async () => {
    installJiraFetch(routes());
    const session = retro({
      historyActionsSnapshot: [action('old-1', 'Write the runbook', { jira: { key: 'TEAM-9', createdAt: '2026-10-20T10:00:00.000Z' } })]
    });
    mocks.team = teamWith(session, [action('old-1', 'Write the runbook')]);
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

    expect(await screen.findByRole('link', { name: 'TEAM-9, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Jira, Write the runbook' })).toBeNull();
  });

  it('shows the link of a previous action that only the team record knows', async () => {
    installJiraFetch(routes());
    // Created from the Dashboard after this session wrote its history
    // snapshot: the snapshot entry has no link, the cached record has.
    const session = retro({ historyActionsSnapshot: [action('old-1', 'Write the runbook')] });
    mocks.team = teamWith(session, [
      action('old-1', 'Write the runbook', { jira: { key: 'TEAM-9', createdAt: '2026-10-20T10:00:00.000Z' } })
    ]);
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} historyActionIds={['old-1']} />);

    expect(await screen.findByRole('link', { name: 'TEAM-9, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Jira, Write the runbook' })).toBeNull();
  });

  // A key planted on a session copy (session actions and their snapshots are
  // not protected fields) must not name the action's issue where the record
  // knows the real one (findings A-5, S-5): each row passes the record first.
  it('shows the record’s key over another one a new action’s session copy carries', async () => {
    installJiraFetch(routes());
    const session = retro({
      actions: [action('new-1', 'Fix the build', { linkedTicketId: 'tkt-1', jira: { key: 'EVIL-1', createdAt: '2026-10-20T10:00:00.000Z' } })]
    });
    mocks.team = teamWith(session);
    mocks.team.retrospectives[0].actions[0].jira = { key: 'TEAM-1', createdAt: '2026-10-20T09:00:00.000Z' };
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

    expect(await screen.findByRole('link', { name: 'TEAM-1, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /EVIL-1/ })).toBeNull();
  });

  it('shows the record’s key over another one the history snapshot carries', async () => {
    installJiraFetch(routes());
    const session = retro({
      historyActionsSnapshot: [action('old-1', 'Write the runbook', { jira: { key: 'EVIL-1', createdAt: '2026-10-20T10:00:00.000Z' } })]
    });
    mocks.team = teamWith(session, [
      action('old-1', 'Write the runbook', { jira: { key: 'TEAM-1', createdAt: '2026-10-20T09:00:00.000Z' } })
    ]);
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} historyActionIds={['old-1']} />);

    expect(await screen.findByRole('link', { name: 'TEAM-1, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /EVIL-1/ })).toBeNull();
  });

  it('keeps a link it only displays out of the action an edit sends to the team record', async () => {
    installJiraFetch(routes());
    const session = retro({
      historyActionsSnapshot: [action('old-1', 'Write the runbook', { jira: { key: 'TEAM-9', createdAt: '2026-10-20T10:00:00.000Z' } })]
    });
    mocks.team = teamWith(session, [action('old-1', 'Write the runbook')]);
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);
    await screen.findByRole('link', { name: 'TEAM-9, open in Jira (new tab)' });

    fireEvent.change(screen.getByRole('combobox', { name: 'Assignee for the action: Write the runbook' }), { target: { value: participant.id } });

    const sent = vi.mocked(dataService.updateGlobalAction).mock.calls.at(-1)![1];
    expect(sent).toMatchObject({ id: 'old-1', assigneeId: participant.id });
    // A link is written by the Jira route alone.
    expect(sent.jira).toBeUndefined();
  });

  it('shows the keys a batch created on the rows, from the refreshed cache, without a reload', async () => {
    const fetchCalls = installJiraFetch(routes({
      'jira/issues': (body) => ok({
        results: (body.actionIds as string[]).map((actionId, i) => ({ actionId, status: 'created', key: `TEAM-${10 + i}` })),
        remaining: []
      })
    }));
    const session = retro();
    mocks.team = teamWith(session);
    const onTick = vi.fn();
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} onTick={onTick} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira (1)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create the actions in Jira' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create 1 issue' }));
    await within(dialog).findByText(/1 issue created\./);

    // The request named this session, so the server patches its row too (A-5).
    expect(fetchCalls.callsTo('jira/issues')[0].body).toMatchObject({ actionIds: ['new-1'], sessionId: 'retro-2' });
    expect(onTick).toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    // The session itself has not received the server's patch yet: the row
    // shows the key from the cache `applyJiraLinks` wrote.
    expect(await screen.findByRole('link', { name: 'TEAM-10, open in Jira (new tab)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Jira, Fix the build' })).toBeNull();
    // Nor does the batch offer it again: it stays, for the keyboard, with
    // nothing left to send.
    expect(screen.getByRole('button', { name: 'Create in Jira (0)' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('button', { name: 'Create in Jira (1)' })).toBeNull();
  });

  // Each control is wired on its own: a creation refused because the token
  // can no longer be used means the status the step holds is stale.
  it.each([
    ['a row', 'Create in Jira, Fix the build'],
    ['the batch', 'Create in Jira (1)']
  ])('reads the status again when a creation from %s says the one it holds is out of date', async (_from, buttonName) => {
    const fetchCalls = installJiraFetch(routes({ 'jira/issues': () => refused(409, 'jira_token_unusable') }));
    const session = retro();
    mocks.team = teamWith(session);
    render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

    fireEvent.click(await screen.findByRole('button', { name: buttonName }));
    const dialog = screen.queryByRole('dialog', { name: 'Create the actions in Jira' });
    if (dialog) fireEvent.click(within(dialog).getByRole('button', { name: 'Create 1 issue' }));

    await waitFor(() => expect(fetchCalls.callsTo('jira/status')).toHaveLength(2));
  });

  describe('one parent issue per retrospective', () => {
    const SESSION_TARGET = { mode: 'sessionParent' as const, projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: [] };
    const sessionParentRoutes = () => routes({
      'jira/status': () => ok(statusWith({ target: SESSION_TARGET })),
      '/jira/issue-types': () => ok({ issueTypes: [{ id: '10001', name: 'Task', subtask: false }, { id: '10003', name: 'Sub-task', subtask: true }], projectKey: 'TEAM', subtasksIncluded: true })
    });

    it('shows the facilitator the retrospective\'s parent issue by its key', async () => {
      installJiraFetch(sessionParentRoutes());
      const session = retro();
      mocks.team = { ...teamWith(session), jiraParents: { 'retro:retro-2': { key: 'TEAM-90', createdAt: '2026-10-20T10:00:00.000Z' } } };
      render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

      const link = await screen.findByRole('link', { name: 'TEAM-90, open in Jira (new tab)' });
      expect(link.closest('p')).toHaveTextContent('Parent issue in Jira:');
      expect(link).toHaveAttribute('href', 'https://jira.example.org/browse/TEAM-90');
    });

    it('shows a parent issue in doubt, with a search for its title', async () => {
      installJiraFetch(sessionParentRoutes());
      const session = retro();
      mocks.team = { ...teamWith(session), jiraParents: { 'retro:retro-2': { uncertainSince: '2026-10-20T10:00:00.000Z' } } };
      render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

      const check = await screen.findByRole('link', { name: 'Check in Jira, parent issue (new tab)' });
      expect(check.closest('p')).toHaveTextContent('Parent issue in Jira:');
      expect(within(check.closest('p') as HTMLElement).getByText('May already be in Jira')).toBeInTheDocument();
      expect(decodeURIComponent(check.getAttribute('href') ?? '')).toContain('project = "TEAM" AND summary ~ "retrospective actions sprint 13 2026 10 20"');
    });

    it('shows a participant no parent issue line', async () => {
      installJiraFetch(sessionParentRoutes());
      const session = retro({ actions: [action('new-1', 'Fix the build', { jira: { key: 'TEAM-91', createdAt: 'x' } })] });
      mocks.team = { ...teamWith(session), jiraParents: { 'retro:retro-2': { key: 'TEAM-90', createdAt: 'x' } } };
      render(<Harness session={session} team={mocks.team} currentUser={participant} />);

      expect(await screen.findByRole('link', { name: 'TEAM-91, open in Jira (new tab)' })).toBeInTheDocument();
      expect(screen.queryByText('Parent issue in Jira:')).toBeNull();
      expect(screen.queryByRole('link', { name: /TEAM-90/ })).toBeNull();
    });

    it('opens the dialog from a row with the retrospective\'s new parent issue in it', async () => {
      installJiraFetch(sessionParentRoutes());
      const session = retro();
      mocks.team = teamWith(session);
      render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira…, Fix the build' }));
      const dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      const [row] = within(within(dialog).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('Retrospective Sprint 13');
      expect(row).toHaveTextContent('New parent issue: Retrospective actions: Sprint 13 (2026-10-20)');
    });

    // [review F2-3] Nothing about the action changed, its parent did: the
    // step must still read the cache again when the dialog closes.
    it('shows the doubt about the parent issue a row\'s dialog left, once it closes', async () => {
      installJiraFetch({
        ...sessionParentRoutes(),
        'jira/issues': () => ok({
          results: [{ actionId: 'new-1', status: 'parent_uncertain' }],
          remaining: [],
          stopped: 'jira_unreachable',
          parents: [{ scope: 'retro:retro-2', status: 'uncertain', uncertainSince: '2026-10-20T10:00:00.000Z' }]
        })
      });
      const session = retro();
      mocks.team = teamWith(session);
      render(<Harness session={session} team={mocks.team} currentUser={facilitator} />);

      fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira…, Fix the build' }));
      const dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Close' }));

      const check = await screen.findByRole('link', { name: 'Check in Jira, parent issue (new tab)' });
      expect(check.closest('p')).toHaveTextContent('Parent issue in Jira:');
      expect(within(check.closest('p') as HTMLElement).getByText('May already be in Jira')).toBeInTheDocument();
    });
  });

  it('reads the status again when the session reconnects', async () => {
    const fetchCalls = installJiraFetch(routes());
    const session = retro();
    mocks.team = teamWith(session);
    const view = render(<Harness session={session} team={mocks.team} currentUser={facilitator} isLive />);
    await waitFor(() => expect(fetchCalls.callsTo('jira/status')).toHaveLength(1));

    view.rerender(<Harness session={session} team={mocks.team} currentUser={facilitator} isLive={false} />);
    view.rerender(<Harness session={session} team={mocks.team} currentUser={facilitator} isLive />);
    await waitFor(() => expect(fetchCalls.callsTo('jira/status').length).toBeGreaterThanOrEqual(2));
  });
});
