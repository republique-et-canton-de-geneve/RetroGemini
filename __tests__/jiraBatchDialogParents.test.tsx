import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ActionItem, JiraTarget, RetroSession, Team } from '../types';
import { installJiraFetch, ok, refused, statusWith, type RouteAnswer } from './helpers/jiraClientFetch';

/**
 * The batch dialog in the sub-task modes (design F2 §4, §6.4): the parent
 * issue each session's actions go under, created once per retrospective or
 * health check and reused (`sessionParent`), and a parent issue the
 * facilitator may name for one send in both sub-task modes. Driven against the
 * real `jiraService` and a fetch answering as the routes do.
 */

const mocks = vi.hoisted(() => ({
  dataService: {
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null,
    whenPersisted: async () => {},
    applyJiraLinks: (() => {}) as (teamId: string, links: unknown[]) => void,
    applyJiraParents: (() => {}) as (teamId: string, entries: unknown[]) => void
  }
}));
vi.mock('../services/dataService', () => ({ dataService: mocks.dataService }));

import JiraBatchDialog from '../components/jira/JiraBatchDialog';
import { jiraInFlight } from '../components/jira/jiraInFlight';

const action = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const SESSION_TARGET: JiraTarget = { mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: ['retrospective'] };
const PARENT_TARGET: JiraTarget = { mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '10003', labels: [] };

// A project's every type, as a pod of this release answers it.
const PROJECT_TYPES = [
  { id: '10001', name: 'Task', subtask: false },
  { id: '10003', name: 'Sub-task', subtask: true }
];
// OPS's sub-task types: not the target's.
const OPS_SUBTASKS = [{ id: '10006', name: 'Technical sub-task', subtask: true }];

const retro = (id: string, name: string, actions: ActionItem[]) => ({
  id,
  teamId: 'team-1',
  name,
  date: '2026-10-21',
  templateLanguage: 'en',
  actions,
  tickets: [],
  groups: []
} as unknown as RetroSession);

const A1 = action('a1', 'Speed up the build');
const A2 = action('a2', 'Write the runbook');
const B1 = action('b1', 'Tidy the board');
const sprint12 = retro('r1', 'Sprint 12', [A1, A2]);
const sprint11 = retro('r0', 'Sprint 11', [action('old', 'Old one')]);

const teamWith = (jiraParents: Team['jiraParents'] = {}) => ({
  id: 'team-1',
  name: 'Platform',
  members: [],
  retrospectives: [sprint12, sprint11],
  healthChecks: [],
  globalActions: [B1],
  jiraParents
} as unknown as Team);

type Props = React.ComponentProps<typeof JiraBatchDialog>;
const props = (overrides: Partial<Props> = {}): Props => ({
  actions: [A1, A2],
  status: statusWith({ target: SESSION_TARGET }),
  teamId: 'team-1',
  sessionId: 'r1',
  kind: 'retro',
  team: teamWith(),
  session: sprint12,
  requestedBy: 'Ann',
  onClose: vi.fn(),
  ...overrides
});

const issueTypes = (body: Record<string, unknown>): RouteAnswer => {
  if (body.parentKey === 'OPS-1') return ok({ issueTypes: OPS_SUBTASKS, projectKey: 'OPS' });
  if (body.parentKey === 'TEAM-5') return ok({ issueTypes: [PROJECT_TYPES[1]], projectKey: 'TEAM' });
  if (body.parentKey === 'TEAM-9') return refused(400, 'jira_parent_invalid');
  return ok({ issueTypes: PROJECT_TYPES, projectKey: 'TEAM', subtasksIncluded: true });
};

const dialog = () => screen.getByRole('dialog', { name: 'Create the actions in Jira' });
const parentInput = () => screen.getByLabelText('Parent issue (optional)');
const describedBy = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ');

const nameParent = async (key: string) => {
  fireEvent.change(parentInput(), { target: { value: key.toLowerCase() } });
  fireEvent.blur(parentInput());
  await waitFor(() => expect(describedBy(parentInput())).not.toContain('Checking'));
};

describe('JiraBatchDialog with parent issues', () => {
  beforeEach(() => {
    jiraInFlight.clear();
    mocks.dataService.applyJiraLinks = vi.fn();
    mocks.dataService.applyJiraParents = vi.fn();
  });

  afterEach(() => {
    jiraInFlight.clear();
    vi.restoreAllMocks();
  });

  describe('one parent issue per session', () => {
    it('names the target, previews a new parent issue with its title, and counts it in the button', async () => {
      installJiraFetch({ '/jira/issue-types': issueTypes });
      render(<JiraBatchDialog {...props()} />);

      expect(within(dialog()).getByText('As sub-tasks of one issue per retrospective or health check, in the project TEAM')).toBeInTheDocument();
      // The types by name once Jira answered, by id until then.
      await waitFor(() => expect(within(dialog()).getByText('Parent issue type: Task')).toBeInTheDocument());
      expect(within(dialog()).getByText('Sub-task type: Sub-task')).toBeInTheDocument();

      const parents = within(dialog()).getByRole('list', { name: 'Parent issues' });
      const [row] = within(parents).getAllByRole('listitem');
      expect(row).toHaveTextContent('Retrospective Sprint 12');
      expect(row).toHaveTextContent('New parent issue: Retrospective actions: Sprint 12 (2026-10-21)');
      // The title is content: it carries its own language.
      expect(within(row).getByText('Retrospective actions: Sprint 12 (2026-10-21)')).toHaveAttribute('lang', 'en');
      // [R3] Created here, it stays the session's parent.
      expect(within(dialog()).getByText('A parent issue created here stays the parent issue of its retrospective or health check for its later actions.')).toBeInTheDocument();
      // [R9] Two actions and one parent issue.
      expect(within(dialog()).getByRole('button', { name: 'Create 3 issues' })).toBeInTheDocument();
    });

    it('shows the existing parent issue by its key, and counts only the actions', () => {
      installJiraFetch({ '/jira/issue-types': issueTypes });
      render(<JiraBatchDialog {...props({ team: teamWith({ 'retro:r1': { key: 'TEAM-90', createdAt: 'x' } }) })} />);

      const [row] = within(within(dialog()).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('Existing parent issue');
      expect(within(row).getByRole('link', { name: 'TEAM-90, open in Jira (new tab)' })).toHaveAttribute('href', 'https://jira.example.org/browse/TEAM-90');
      expect(within(dialog()).queryByText(/stays the parent issue/)).toBeNull();
      expect(within(dialog()).getByRole('button', { name: 'Create 2 issues' })).toBeInTheDocument();
    });

    it('says a parent issue may already be in Jira, links a search for its title, and offers to create one anyway', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({ results: [{ actionId: 'a1', status: 'created', key: 'TEAM-92', parentKey: 'TEAM-91' }, { actionId: 'a2', status: 'created', key: 'TEAM-93', parentKey: 'TEAM-91' }], remaining: [], parents: [{ scope: 'retro:r1', status: 'created', key: 'TEAM-91' }] })
      });
      render(<JiraBatchDialog {...props({ team: teamWith({ 'retro:r1': { uncertainSince: '2026-10-21T09:00:00.000Z' } }) })} />);

      const [row] = within(within(dialog()).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('A parent issue may already be in Jira: check it, then create a new one anyway');
      expect(row).toHaveTextContent('Its actions are not sent until then: enter the parent issue above, or create a new one.');
      const check = within(row).getByRole('link', { name: 'Check in Jira, parent issue: Retrospective Sprint 12 (new tab)' });
      expect(check).toHaveAttribute('target', '_blank');
      expect(decodeURIComponent(check.getAttribute('href') ?? '')).toContain('project = "TEAM" AND summary ~ "retrospective actions sprint 12 2026 10 21"');
      expect(within(dialog()).getByRole('button', { name: 'Create 2 issues' })).toBeInTheDocument();

      fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'Create a new parent issue anyway' }));
      expect(within(dialog()).getByRole('button', { name: 'Create 3 issues' })).toBeInTheDocument();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 3 issues' }));
      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      expect(routes.callsTo('/jira/issues')[0].body).toMatchObject({ target: SESSION_TARGET, forceParent: true });
      expect(routes.callsTo('/jira/issues')[0].body).not.toHaveProperty('adoptParent');
    });

    it('lists each session once, and the team dashboard after its title', () => {
      installJiraFetch({ '/jira/issue-types': issueTypes });
      render(<JiraBatchDialog {...props({ actions: [B1, A1, A2], kind: 'backlog', sessionId: undefined, session: undefined })} />);

      const rows = within(within(dialog()).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(rows.map(row => row.firstChild?.textContent)).toEqual(['Team dashboard', 'Retrospective Sprint 12']);
      expect(rows[0]).toHaveTextContent('New parent issue: Team actions: Platform');
      // Three actions and two parent issues.
      expect(within(dialog()).getByRole('button', { name: 'Create 5 issues' })).toBeInTheDocument();
    });

    it('reports what became of each parent issue, and the actions its parent held back', async () => {
      installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({
          results: [
            { actionId: 'b1', status: 'created', key: 'TEAM-2', parentKey: 'TEAM-1' },
            { actionId: 'a1', status: 'parent_refused', jiraMessages: ['Field labels cannot be set.'], jiraFields: ['labels'] }
          ],
          remaining: ['a2'],
          stopped: 'jira_parent_refused',
          parents: [
            { scope: 'backlog', status: 'created', key: 'TEAM-1' },
            { scope: 'retro:r1', status: 'refused', jiraMessages: ['Field labels cannot be set.'], jiraFields: ['labels'] }
          ]
        })
      });
      render(<JiraBatchDialog {...props({ actions: [B1, A1, A2], kind: 'backlog', sessionId: undefined, session: undefined })} />);

      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 5 issues' }));
      const close = await within(dialog()).findByRole('button', { name: 'Close' });
      expect(close).toHaveFocus();

      expect(within(dialog()).getByText('1 not sent: Jira refused its parent issue')).toBeInTheDocument();
      const created = within(dialog()).getByText('Parent issue created:').closest('li') as HTMLElement;
      expect(created).toHaveTextContent('Team dashboard');
      expect(within(created).getByRole('link', { name: 'TEAM-1, open in Jira (new tab)' })).toBeInTheDocument();
      const refusedRow = within(dialog()).getByText('Jira refused its parent issue:').closest('li') as HTMLElement;
      expect(refusedRow).toHaveTextContent('Retrospective Sprint 12');
      expect(refusedRow).toHaveTextContent('Field labels cannot be set.');
      expect(refusedRow).toHaveTextContent('Jira does not accept labels for this project: remove them in Settings → Jira, then try again.');
      // The stop, and the action never attempted.
      expect(within(dialog()).getByText(/Jira refused to create a parent issue, so the other actions were not sent/)).toBeInTheDocument();
      // Said too, beside the list: the parent issue's line counted.
      const summary = within(dialog()).getAllByRole('status').map(region => region.textContent).join(' ');
      expect(summary).toContain('1 parent issue created.');
      expect(summary).toContain('1 not sent: Jira refused its parent issue.');
      // The action held back by its parent is never "may already be in Jira".
      expect(within(dialog()).queryByText(/may already be in Jira: check it before creating/)).toBeNull();
    });

    it('reports a parent issue in doubt, being created elsewhere, adopted or not saved here', async () => {
      installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({
          results: [{ actionId: 'a1', status: 'parent_uncertain' }],
          remaining: ['a2', 'b1'],
          stopped: 'jira_unavailable',
          parents: [
            { scope: 'retro:r1', status: 'uncertain', uncertainSince: '2026-10-21T10:00:00.000Z' },
            { scope: 'retro:r0', status: 'in_progress' },
            { scope: 'healthcheck:gone', status: 'adopted', key: 'OPS-1' },
            { scope: 'backlog', status: 'not_saved', key: 'TEAM-77' }
          ]
        })
      });
      render(<JiraBatchDialog {...props({ actions: [A1, A2, B1] })} />);

      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 5 issues' }));
      await within(dialog()).findByRole('button', { name: 'Close' });

      expect(within(dialog()).getByText('1 not sent: its parent issue may already be in Jira')).toBeInTheDocument();
      const doubt = within(dialog()).getByText('Its parent issue may already be in Jira: check it before sending its actions again.').closest('li') as HTMLElement;
      expect(within(doubt).getByRole('link', { name: 'Check in Jira, parent issue: Retrospective Sprint 12 (new tab)' })).toBeInTheDocument();
      expect(within(dialog()).getByText('Its parent issue is being created from another window: send its actions again in a moment.').closest('li'))
        .toHaveTextContent('Retrospective Sprint 11');
      // A scope this browser does not hold still gets a label.
      expect(within(dialog()).getByText('OPS-1 is now its parent issue.').closest('li')).toHaveTextContent('Health check');
      expect(within(dialog()).getByText(/TEAM-77 was created as its parent issue, but could not be saved here/).closest('li'))
        .toHaveTextContent('Team dashboard');
    });

    // [R3] "Change the target for this creation only" offers the third mode
    // too, and the parent such a change creates is stored for its session.
    it('says a parent issue created through a one-time change stays the session\'s parent', async () => {
      installJiraFetch({ '/jira/issue-types': issueTypes });
      render(<JiraBatchDialog {...props({ status: statusWith() })} />);
      expect(within(dialog()).queryByRole('list', { name: 'Parent issues' })).toBeNull();
      expect(within(dialog()).queryByLabelText('Parent issue (optional)')).toBeNull();

      fireEvent.click(within(dialog()).getByRole('button', { name: 'Change the target for this creation only' }));
      fireEvent.click(within(dialog()).getByRole('radio', { name: 'Sub-tasks of a new issue per retrospective or health check' }));
      expect(within(dialog()).getByText('A parent issue created here stays the parent issue of its retrospective or health check for its later actions.')).toBeInTheDocument();
      expect(within(dialog()).getByLabelText('Parent issue (optional)')).toBeInTheDocument();
      expect(within(dialog()).getByRole('button', { name: 'Create 3 issues' })).toBeInTheDocument();
    });
  });

  describe('naming the parent issue for this send', () => {
    it('checks the key with Jira, asks for a sub-task type its project offers, and sends it as the parent with adoptParent', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({ results: [{ actionId: 'a1', status: 'created', key: 'OPS-2', parentKey: 'OPS-1' }, { actionId: 'a2', status: 'created', key: 'OPS-3', parentKey: 'OPS-1' }], remaining: [], parents: [{ scope: 'retro:r1', status: 'adopted', key: 'OPS-1' }] })
      });
      render(<JiraBatchDialog {...props()} />);

      const input = parentInput();
      expect(describedBy(input)).toContain('Leave empty to use each retrospective’s or health check’s own parent issue');
      await nameParent('ops-1');
      expect(input).toHaveValue('OPS-1');
      expect(describedBy(input)).toContain('OPS-1 is in the project OPS.');
      expect(routes.callsTo('/jira/issue-types').at(-1)?.body).toMatchObject({ parentKey: 'OPS-1' });

      // The target's type is not OPS's: the one OPS offers is chosen.
      const type = within(dialog()).getByLabelText('Sub-task type in OPS');
      expect(type).toBeRequired();
      expect(type).toHaveValue('10006');

      const [row] = within(within(dialog()).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('Goes under OPS-1, which becomes its parent issue');
      // No parent issue is created: the actions alone.
      expect(within(dialog()).getByRole('button', { name: 'Create 2 issues' })).toBeInTheDocument();
      expect(within(dialog()).queryByText(/stays the parent issue/)).toBeNull();

      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 2 issues' }));
      await within(dialog()).findByRole('button', { name: 'Close' });
      const { body } = routes.callsTo('/jira/issues')[0];
      expect(body).toMatchObject({
        actionIds: ['a1', 'a2'],
        target: { mode: 'parent', parentKey: 'OPS-1', issueTypeId: '10006', labels: ['retrospective'] },
        adoptParent: true,
        sessionId: 'r1'
      });
      expect(body).not.toHaveProperty('replaceParents');
      expect(body).not.toHaveProperty('forceParent');
      expect(within(dialog()).getByText('OPS-1 is now its parent issue.')).toBeInTheDocument();
    });

    it('keeps the target\'s sub-task type when the parent\'s project offers it', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({ results: [], remaining: [] })
      });
      render(<JiraBatchDialog {...props({ actions: [A1] })} />);

      await nameParent('TEAM-5');
      expect(within(dialog()).queryByLabelText(/Sub-task type in/)).toBeNull();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 1 issue' }));
      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      expect(routes.callsTo('/jira/issues')[0].body.target).toEqual({ mode: 'parent', parentKey: 'TEAM-5', issueTypeId: '10003', labels: ['retrospective'] });
    });

    it('refuses a malformed key on the field, and sends nothing for a key Jira refused or not yet checked', async () => {
      const routes = installJiraFetch({ '/jira/issue-types': issueTypes });
      render(<JiraBatchDialog {...props()} />);

      fireEvent.change(parentInput(), { target: { value: 'OPS' } });
      fireEvent.blur(parentInput());
      expect(parentInput()).toHaveAttribute('aria-invalid', 'true');
      expect(describedBy(parentInput())).toContain('Enter an issue key such as TEAM-123.');

      await nameParent('TEAM-9');
      expect(describedBy(parentInput())).toContain('This issue cannot hold sub-tasks: choose an issue that is neither a sub-task nor an epic.');

      // Typed, never checked: Create says why on the field and moves there.
      fireEvent.change(parentInput(), { target: { value: 'OPS-1' } });
      const create = within(dialog()).getByRole('button', { name: 'Create 2 issues' });
      create.focus();
      fireEvent.click(create);
      expect(parentInput()).toHaveFocus();
      expect(parentInput()).toHaveAttribute('aria-invalid', 'true');
      expect(describedBy(parentInput())).toContain('Check the parent issue first: leave the field or press Enter.');
      expect(routes.callsTo('/jira/issues')).toHaveLength(0);
    });

    it('asks for the sub-task type on the list when none is chosen', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': (body) => (body.parentKey === 'OPS-1'
          ? ok({ issueTypes: [...OPS_SUBTASKS, { id: '10007', name: 'Review', subtask: true }], projectKey: 'OPS' })
          : issueTypes(body))
      });
      render(<JiraBatchDialog {...props()} />);
      await nameParent('OPS-1');

      const type = within(dialog()).getByLabelText('Sub-task type in OPS');
      expect(type).toHaveValue('');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 2 issues' }));
      expect(type).toHaveFocus();
      expect(type).toHaveAttribute('aria-invalid', 'true');
      expect(describedBy(type)).toContain('Choose the sub-task type in OPS first.');
      expect(routes.callsTo('/jira/issues')).toHaveLength(0);
    });

    it('offers to replace the parent issue a session already has, listing it, and sends replaceParents', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({ results: [], remaining: [] })
      });
      render(<JiraBatchDialog {...props({ team: teamWith({ 'retro:r1': { key: 'TEAM-90', createdAt: 'x' } }) })} />);
      // Nothing to replace until a parent is named.
      expect(within(dialog()).queryByRole('checkbox', { name: /Also use/ })).toBeNull();

      await nameParent('OPS-1');
      const [row] = within(within(dialog()).getByRole('list', { name: 'Parent issues' })).getAllByRole('listitem');
      expect(row).toHaveTextContent('Goes under OPS-1; keeps TEAM-90 for its other actions');
      const replace = within(dialog()).getByRole('checkbox', { name: 'Also use OPS-1 for their later actions, instead of their current parent issue' });
      expect(replace).not.toBeChecked();
      expect(replace).toHaveAccessibleDescription(/Retrospective Sprint 12/);

      fireEvent.click(replace);
      expect(row).toHaveTextContent('Goes under OPS-1, which replaces TEAM-90');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 2 issues' }));
      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      expect(routes.callsTo('/jira/issues')[0].body).toMatchObject({ adoptParent: true, replaceParents: true });
    });

    it('in parent mode, uses the issue named for this creation only, and stores nothing', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({ results: [], remaining: [] })
      });
      render(<JiraBatchDialog {...props({ status: statusWith({ target: PARENT_TARGET }) })} />);

      expect(within(dialog()).queryByRole('list', { name: 'Parent issues' })).toBeNull();
      expect(describedBy(parentInput())).toContain('Leave empty to use TEAM-7. An issue entered here is used for this creation only.');
      await nameParent('OPS-1');
      expect(within(dialog()).queryByRole('checkbox', { name: /Also use/ })).toBeNull();
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 2 issues' }));
      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      const { body } = routes.callsTo('/jira/issues')[0];
      expect(body.target).toEqual({ mode: 'parent', parentKey: 'OPS-1', issueTypeId: '10006', labels: [] });
      expect(body).not.toHaveProperty('adoptParent');
    });

    it('sends the stored target when the field is left empty', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => ok({ results: [], remaining: [] })
      });
      render(<JiraBatchDialog {...props({ status: statusWith({ target: PARENT_TARGET }) })} />);
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 2 issues' }));
      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      expect(routes.callsTo('/jira/issues')[0].body.target).toEqual(PARENT_TARGET);
    });

    it('is off while the batch is sent', async () => {
      let answer!: (value: RouteAnswer) => void;
      installJiraFetch({
        '/jira/issue-types': issueTypes,
        '/jira/issues': () => new Promise<RouteAnswer>((resolve) => { answer = resolve; })
      });
      render(<JiraBatchDialog {...props()} />);
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Create 3 issues' }));

      await waitFor(() => expect(parentInput()).toBeDisabled());
      await act(async () => { answer(ok({ results: [], remaining: [] })); });
    });
  });

  // "Create anyway" on one action that may already be in Jira opens this
  // dialog in the sub-task modes, so the parent can still be named.
  it('warns before creating an action that may already be in Jira, and sends force', async () => {
    const routes = installJiraFetch({
      '/jira/issue-types': issueTypes,
      '/jira/issues': () => ok({ results: [{ actionId: 'a1', status: 'created', key: 'TEAM-95', parentKey: 'TEAM-90' }], remaining: [] })
    });
    const doubt = { ...A1, jira: { uncertainSince: '2026-10-21T08:00:00.000Z' } };
    render(<JiraBatchDialog {...props({ actions: [doubt], force: true, team: teamWith({ 'retro:r1': { key: 'TEAM-90', createdAt: 'x' } }) })} />);

    expect(within(dialog()).getByText('This action may already be in Jira. Create another issue only if Jira has none for it.')).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Create anyway' }));
    await within(dialog()).findByRole('button', { name: 'Close' });
    expect(routes.callsTo('/jira/issues')[0].body).toMatchObject({ actionIds: ['a1'], force: true, target: SESSION_TARGET });
  });

  it('shows no parent field in project mode', () => {
    installJiraFetch({ '/jira/issue-types': issueTypes });
    render(<JiraBatchDialog {...props({ status: statusWith() })} />);
    expect(screen.queryByLabelText('Parent issue (optional)')).toBeNull();
    expect(within(dialog()).getByRole('button', { name: 'Create 2 issues' })).toBeInTheDocument();
  });
});
