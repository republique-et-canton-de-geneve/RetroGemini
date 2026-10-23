import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { deferred, installJiraFetch, ok, refused, type RouteAnswer } from './helpers/jiraClientFetch';
import { orphanLabels } from './helpers/formLabels';

/**
 * Where issues are created (finding U-2): one form, used by the Settings card
 * and by the batch dialog's one-time override. The issue types come from Jira
 * through `/jira/issue-types` (contracts §3) for the key typed, and every state
 * of that list — loading, empty, refused — is tied to the select it explains.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null
  }
}));

import JiraTargetFields from '../components/jira/JiraTargetFields';
import { draftFromTarget, targetFromDraft, type JiraTargetDraft } from '../components/jira/jiraTargetDraft';

const TYPES = [
  { id: '10001', name: 'Task', subtask: false },
  { id: '10002', name: 'Story', subtask: false },
  { id: '10003', name: 'Sub-task', subtask: true }
];

const Harness: React.FC<{ initial?: JiraTargetDraft; onDraft?: (draft: JiraTargetDraft) => void }> = ({
  initial = draftFromTarget(null),
  onDraft
}) => {
  const [draft, setDraft] = useState(initial);
  return (
    <JiraTargetFields
      teamId="team-1"
      value={draft}
      onChange={(next) => {
        setDraft(next);
        onDraft?.(next);
      }}
      idPrefix="target"
    />
  );
};

const describedBy = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('JiraTargetFields', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names every field and the mode group', () => {
    installJiraFetch({});
    const { container } = render(<Harness />);

    expect(orphanLabels(container)).toEqual([]);
    const group = screen.getByRole('radiogroup', { name: 'Create as' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Project' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Sub-tasks of an issue' })).not.toBeChecked();
    expect(screen.getByLabelText('Project key')).toBeInTheDocument();
    expect(screen.getByLabelText('Issue type')).toBeInTheDocument();
    expect(screen.getByLabelText('Labels')).toHaveValue('retrospective');
  });

  it('loads the project\'s issue types when the key is left, and lists the ones a project takes', async () => {
    const routes = installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }) });
    render(<Harness />);

    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'team' } });
    // Typed in capitals, as Jira writes keys.
    expect(key).toHaveValue('TEAM');
    fireEvent.blur(key);

    const select = screen.getByLabelText('Issue type');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Task' })).toBeInTheDocument());
    expect(screen.getByRole('option', { name: 'Story' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Sub-task' })).toBeNull();
    expect(routes.callsTo('/jira/issue-types')[0].body).toMatchObject({ projectKey: 'TEAM', sessionToken: 'token-1' });
    expect(routes.callsTo('/jira/issue-types')[0].body).not.toHaveProperty('parentKey');

    fireEvent.change(select, { target: { value: '10002' } });
    expect(select).toHaveValue('10002');
  });

  it('ties the loading state to the select while Jira answers', async () => {
    const answer = deferred<RouteAnswer>();
    installJiraFetch({ '/jira/issue-types': () => answer.promise });
    render(<Harness />);

    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'TEAM' } });
    fireEvent.blur(key);

    const select = screen.getByLabelText('Issue type');
    await waitFor(() => expect(describedBy(select)).toContain('Loading the issue types…'));
    await act(async () => {
      answer.resolve(ok({ issueTypes: TYPES, projectKey: 'TEAM' }));
    });
    expect(describedBy(select)).not.toContain('Loading');
  });

  it('reads the sub-task types of the parent issue in parent mode', async () => {
    const routes = installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }) });
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Sub-tasks of an issue' }));
    expect(screen.queryByLabelText('Project key')).toBeNull();
    const parent = screen.getByLabelText('Parent issue key');
    fireEvent.change(parent, { target: { value: 'team-7' } });
    fireEvent.blur(parent);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Sub-task' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: 'Task' })).toBeNull();
    expect(routes.callsTo('/jira/issue-types')[0].body).toMatchObject({ parentKey: 'TEAM-7' });
    // The only sub-task type is chosen for the facilitator.
    expect(screen.getByLabelText('Issue type')).toHaveValue('10003');
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '10003' }));
  });

  it('says so when Jira offers no type', async () => {
    installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: [], projectKey: 'TEAM' }) });
    render(<Harness />);
    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'TEAM' } });
    fireEvent.blur(key);

    await waitFor(() => expect(describedBy(screen.getByLabelText('Issue type'))).toContain('Jira offers no issue type here.'));
  });

  it('shows the route\'s refusal in the reader\'s words, and loads again on request', async () => {
    let calls = 0;
    installJiraFetch({
      '/jira/issue-types': () => (++calls === 1 ? refused(404, 'jira_not_found') : ok({ issueTypes: TYPES, projectKey: 'TEAM' }))
    });
    render(<Harness />);
    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'TEAM' } });
    fireEvent.blur(key);

    const select = screen.getByLabelText('Issue type');
    await waitFor(() => expect(describedBy(select)).toContain('Jira found no such project or issue'));

    fireEvent.click(screen.getByRole('button', { name: 'Load the issue types' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Task' })).toBeInTheDocument());
    expect(describedBy(select)).not.toContain('Jira found no such project');
  });

  // The button goes the moment it is pressed (the list is loading) and does
  // not come back when the list arrives. It is mostly pressed after a failed
  // read, by keyboard: the keyboard must land on the list it was asking for,
  // whose status line says what happens.
  it('gives the keyboard to the issue types when "Load the issue types" goes away', async () => {
    const second = deferred<RouteAnswer>();
    let calls = 0;
    installJiraFetch({
      '/jira/issue-types': () => (++calls === 1 ? refused(503, 'jira_unavailable') : second.promise)
    });
    render(<Harness />);
    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'TEAM' } });
    fireEvent.blur(key);
    const select = screen.getByLabelText('Issue type');
    const load = await screen.findByRole('button', { name: 'Load the issue types' });

    load.focus();
    fireEvent.click(load);
    expect(screen.queryByRole('button', { name: 'Load the issue types' })).toBeNull();
    expect(select).toHaveFocus();
    expect(describedBy(select)).toContain('Loading the issue types…');

    await act(async () => { second.resolve(ok({ issueTypes: TYPES, projectKey: 'TEAM' })); });
    expect(screen.getByRole('option', { name: 'Task' })).toBeInTheDocument();
    expect(select).toHaveFocus();
  });

  it('keeps the keyboard on the issue types when the second read fails too, with the button back beside it', async () => {
    let calls = 0;
    installJiraFetch({ '/jira/issue-types': () => { calls += 1; return refused(503, 'jira_unavailable'); } });
    render(<Harness />);
    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'TEAM' } });
    fireEvent.blur(key);
    const select = screen.getByLabelText('Issue type');
    const load = await screen.findByRole('button', { name: 'Load the issue types' });

    load.focus();
    fireEvent.click(load);
    expect(await screen.findByRole('button', { name: 'Load the issue types' })).toBeInTheDocument();
    expect(calls).toBe(2);
    expect(select).toHaveFocus();
  });

  it('refuses a malformed key without asking Jira', () => {
    const routes = installJiraFetch({});
    render(<Harness />);
    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'T' } });
    fireEvent.blur(key);

    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(key)).toContain('Enter a project key in capital letters, such as TEAM.');
    expect(routes.calls).toHaveLength(0);
  });

  it('refuses a malformed parent key with the parent\'s own hint, without asking Jira', () => {
    const routes = installJiraFetch({});
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: 'Sub-tasks of an issue' }));
    const parent = screen.getByLabelText('Parent issue key');
    // A project key is not an issue key.
    fireEvent.change(parent, { target: { value: 'TEAM' } });
    fireEvent.blur(parent);

    expect(parent).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(parent)).toContain('Enter an issue key such as TEAM-123.');
    expect(describedBy(parent)).not.toContain('project key');
    expect(routes.callsTo('/jira/issue-types')).toHaveLength(0);
  });

  it('keeps the labels as typed and checks them with the shared rule', () => {
    installJiraFetch({});
    const onDraft = vi.fn();
    render(<Harness onDraft={onDraft} />);
    const labels = screen.getByLabelText('Labels');

    fireEvent.change(labels, { target: { value: 'retro, q4' } });
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ labels: 'retro, q4' }));
    fireEvent.blur(labels);
    expect(labels).not.toHaveAttribute('aria-invalid');

    fireEvent.change(labels, { target: { value: 'x'.repeat(256) } });
    fireEvent.blur(labels);
    expect(labels).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(labels)).toContain('Labels cannot be longer than 255 characters');
  });

  it('loads the types of a stored target at once, keeping its type chosen', async () => {
    const routes = installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }) });
    render(<Harness initial={draftFromTarget({ mode: 'project', projectKey: 'TEAM', issueTypeId: '10002', labels: [] })} />);

    const select = screen.getByLabelText('Issue type');
    expect(select).toHaveValue('10002');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Story' })).toBeInTheDocument());
    expect(select).toHaveValue('10002');
    expect(routes.callsTo('/jira/issue-types')).toHaveLength(1);
  });

  describe('a type belongs to the key it was read for', () => {
    // A type id is valid in one project (or under one parent) only. Kept across
    // a change of key, it would be saved, or sent, for a project that never
    // offered it: a Save clicked straight after typing runs before the new
    // key's list arrives.
    const STORED = draftFromTarget({ mode: 'project', projectKey: 'TEAM', issueTypeId: '10001', labels: [] });
    const lastDraft = (onDraft: ReturnType<typeof vi.fn>) => onDraft.mock.calls.at(-1)?.[0] as JiraTargetDraft;

    it('forgets the type when the project key changes', async () => {
      installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }) });
      const onDraft = vi.fn();
      render(<Harness initial={STORED} onDraft={onDraft} />);
      await waitFor(() => expect(screen.getByRole('option', { name: 'Task' })).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'OPS' } });
      expect(lastDraft(onDraft)).toMatchObject({ projectKey: 'OPS', issueTypeId: '' });
      expect(screen.getByLabelText('Issue type')).toHaveValue('');
      expect(screen.queryByRole('option', { name: '10001' })).toBeNull();
      // Nothing can be saved or sent until a type of OPS is chosen.
      expect(targetFromDraft(lastDraft(onDraft))).toEqual({ ok: false, error: 'invalid_jira_target' });
    });

    it('keeps the type when the key is typed again the same way', async () => {
      installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }) });
      const onDraft = vi.fn();
      render(<Harness initial={STORED} onDraft={onDraft} />);
      await waitFor(() => expect(screen.getByRole('option', { name: 'Task' })).toBeInTheDocument());

      // Lower case and a trailing space are still TEAM.
      fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'team ' } });
      expect(lastDraft(onDraft)).toMatchObject({ projectKey: 'TEAM ', issueTypeId: '10001' });
      expect(screen.getByLabelText('Issue type')).toHaveValue('10001');
    });

    it('chooses the only type again when the key comes back to one already read', async () => {
      installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: [TYPES[0]], projectKey: 'TEAM' }) });
      const onDraft = vi.fn();
      render(<Harness initial={STORED} onDraft={onDraft} />);
      await waitFor(() => expect(screen.getByRole('option', { name: 'Task' })).toBeInTheDocument());

      const key = screen.getByLabelText('Project key');
      fireEvent.change(key, { target: { value: 'TEA' } });
      fireEvent.change(key, { target: { value: 'TEAM' } });
      expect(lastDraft(onDraft)).toMatchObject({ projectKey: 'TEAM', issueTypeId: '' });
      fireEvent.blur(key);
      expect(lastDraft(onDraft)).toMatchObject({ projectKey: 'TEAM', issueTypeId: '10001' });
      expect(screen.getByLabelText('Issue type')).toHaveValue('10001');
    });

    it('forgets the type when the mode changes', () => {
      installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }) });
      const onDraft = vi.fn();
      render(<Harness initial={STORED} onDraft={onDraft} />);

      fireEvent.click(screen.getByRole('radio', { name: 'Sub-tasks of an issue' }));
      expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'parent', issueTypeId: '' }));
      expect(screen.getByLabelText('Issue type')).toHaveValue('');
    });
  });

  describe('one parent issue per retrospective or health check', () => {
    // What a 41 pod answers for `{ projectKey }`: every type, sub-task types
    // included, with Cloud's hierarchy level when Jira gave one.
    const ALL_TYPES = [
      { id: '10001', name: 'Task', subtask: false, hierarchyLevel: 0 },
      { id: '10002', name: 'Story', subtask: false },
      { id: '10009', name: 'Epic', subtask: false, hierarchyLevel: 1 },
      { id: '10003', name: 'Sub-task', subtask: true, hierarchyLevel: -1 }
    ];
    const answerAll = () => ok({ issueTypes: ALL_TYPES, projectKey: 'TEAM', subtasksIncluded: true });
    const chooseMode = () => fireEvent.click(screen.getByRole('radio', { name: 'Sub-tasks of a new issue per retrospective or health check' }));
    const lastDraft = (onDraft: ReturnType<typeof vi.fn>) => onDraft.mock.calls.at(-1)?.[0] as JiraTargetDraft;

    it('offers a third mode, its hint tied to it only while it is chosen', () => {
      installJiraFetch({});
      render(<Harness />);
      const radio = screen.getByRole('radio', { name: 'Sub-tasks of a new issue per retrospective or health check' });
      expect(radio).not.toBeChecked();
      expect(radio).not.toHaveAttribute('aria-describedby');
      expect(screen.queryByText(/RetroGemini creates one issue in this project/)).toBeNull();

      chooseMode();
      expect(radio).toBeChecked();
      expect(radio).toHaveAccessibleDescription(/RetroGemini creates one issue in this project for each retrospective or health check/);
      // The group keeps its name; the project key is asked, not a parent key.
      expect(screen.getByRole('radiogroup', { name: 'Create as' })).toBeInTheDocument();
      expect(screen.getByLabelText('Project key')).toBeInTheDocument();
      expect(screen.queryByLabelText('Parent issue key')).toBeNull();
    });

    it('fills both lists from one read of the project, keeping epics out of the parent issue\'s types', async () => {
      const routes = installJiraFetch({ '/jira/issue-types': answerAll });
      const onDraft = vi.fn();
      const { container } = render(<Harness onDraft={onDraft} />);
      chooseMode();
      const key = screen.getByLabelText('Project key');
      fireEvent.change(key, { target: { value: 'TEAM' } });
      fireEvent.blur(key);

      const parentType = screen.getByLabelText('Type of the parent issue');
      const subtaskType = screen.getByLabelText('Sub-task type');
      await waitFor(() => expect(within(subtaskType).getByRole('option', { name: 'Sub-task' })).toBeInTheDocument());
      expect(routes.callsTo('/jira/issue-types')).toHaveLength(1);
      expect(routes.callsTo('/jira/issue-types')[0].body).toMatchObject({ projectKey: 'TEAM' });

      expect(within(parentType).getByRole('option', { name: 'Task' })).toBeInTheDocument();
      expect(within(parentType).getByRole('option', { name: 'Story' })).toBeInTheDocument();
      // Cloud puts no sub-task under an epic: a session would keep a parent it cannot use.
      expect(within(parentType).queryByRole('option', { name: 'Epic' })).toBeNull();
      expect(within(parentType).queryByRole('option', { name: 'Sub-task' })).toBeNull();
      expect(within(subtaskType).queryByRole('option', { name: 'Task' })).toBeNull();
      // The only sub-task type is chosen; two parent types leave the choice open.
      expect(subtaskType).toHaveValue('10003');
      expect(parentType).toHaveValue('');
      fireEvent.change(parentType, { target: { value: '10001' } });
      expect(lastDraft(onDraft)).toMatchObject({ mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003' });
      expect(targetFromDraft(lastDraft(onDraft))).toEqual({
        ok: true,
        target: { mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: ['retrospective'] }
      });

      // Each select has its own label and hint, and the shared status line.
      expect(orphanLabels(container)).toEqual([]);
      expect(describedBy(parentType)).toContain('Created once per retrospective or health check.');
      expect(describedBy(subtaskType)).toContain('One sub-task per action.');
      expect(parentType.getAttribute('aria-describedby')).toContain('target-issue-type-status');
      expect(subtaskType.getAttribute('aria-describedby')).toContain('target-issue-type-status');
    });

    it('keeps a stored target\'s two types, each by its id until the list is read', async () => {
      const answer = deferred<RouteAnswer>();
      installJiraFetch({ '/jira/issue-types': () => answer.promise });
      render(<Harness initial={draftFromTarget({ mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10002', issueTypeId: '10003', labels: [] })} />);

      expect(screen.getByLabelText('Type of the parent issue')).toHaveValue('10002');
      expect(screen.getByLabelText('Sub-task type')).toHaveValue('10003');
      await act(async () => { answer.resolve(answerAll()); });
      expect(screen.getByLabelText('Type of the parent issue')).toHaveValue('10002');
      expect(within(screen.getByLabelText('Type of the parent issue')).getByRole('option', { name: 'Story' })).toBeInTheDocument();
      expect(screen.getByLabelText('Sub-task type')).toHaveValue('10003');
    });

    it('forgets both types when the key or the mode changes', async () => {
      installJiraFetch({ '/jira/issue-types': answerAll });
      const onDraft = vi.fn();
      render(<Harness initial={draftFromTarget({ mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: [] })} onDraft={onDraft} />);
      await waitFor(() => expect(within(screen.getByLabelText('Sub-task type')).getByRole('option', { name: 'Sub-task' })).toBeInTheDocument());

      fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'OPS' } });
      expect(lastDraft(onDraft)).toMatchObject({ projectKey: 'OPS', issueTypeId: '', parentIssueTypeId: '' });

      fireEvent.change(screen.getByLabelText('Project key'), { target: { value: 'TEAM' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Project' }));
      expect(lastDraft(onDraft)).toMatchObject({ mode: 'project', issueTypeId: '', parentIssueTypeId: '' });
      expect(screen.queryByLabelText('Type of the parent issue')).toBeNull();
    });

    it('says the sub-task types cannot be read yet when a pod of an older release answers', async () => {
      let calls = 0;
      installJiraFetch({
        // A 40.x pod: standard types only, no `subtasksIncluded`.
        '/jira/issue-types': () => (++calls === 1
          ? ok({ issueTypes: TYPES.filter(type => !type.subtask), projectKey: 'TEAM' })
          : answerAll())
      });
      render(<Harness />);
      chooseMode();
      const key = screen.getByLabelText('Project key');
      fireEvent.change(key, { target: { value: 'TEAM' } });
      fireEvent.blur(key);

      const subtaskType = screen.getByLabelText('Sub-task type');
      await waitFor(() => expect(describedBy(subtaskType)).toContain('The sub-task types could not be read yet: the server is being updated.'));
      // The parent issue's types are right in that answer; the sub-task list is not.
      expect(within(screen.getByLabelText('Type of the parent issue')).getByRole('option', { name: 'Task' })).toBeInTheDocument();
      expect(within(subtaskType).queryByRole('option', { name: 'Task' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Load the issue types' }));
      await waitFor(() => expect(within(subtaskType).getByRole('option', { name: 'Sub-task' })).toBeInTheDocument());
      expect(describedBy(subtaskType)).not.toContain('could not be read yet');
    });

    // An older pod's answer holds no sub-task type at all: a stored one must
    // not be forgotten because that list is empty.
    it('keeps a stored sub-task type when a pod of an older release answers', async () => {
      installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES.filter(type => !type.subtask), projectKey: 'TEAM' }) });
      const onDraft = vi.fn();
      render(<Harness initial={draftFromTarget({ mode: 'sessionParent', projectKey: 'TEAM', parentIssueTypeId: '10001', issueTypeId: '10003', labels: [] })} onDraft={onDraft} />);

      await waitFor(() => expect(describedBy(screen.getByLabelText('Sub-task type'))).toContain('could not be read yet'));
      expect(screen.getByLabelText('Sub-task type')).toHaveValue('10003');
      expect(onDraft.mock.calls.every(([draft]) => (draft as JiraTargetDraft).issueTypeId === '10003')).toBe(true);
    });

    it('says so when the project offers no sub-task type', async () => {
      installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: ALL_TYPES.filter(type => !type.subtask), projectKey: 'TEAM', subtasksIncluded: true })
      });
      render(<Harness />);
      chooseMode();
      const key = screen.getByLabelText('Project key');
      fireEvent.change(key, { target: { value: 'TEAM' } });
      fireEvent.blur(key);

      await waitFor(() => expect(describedBy(screen.getByLabelText('Sub-task type'))).toContain('This project offers no sub-task type.'));
    });

    // [R5] The route now answers every type of a project, sub-task types
    // included. A project-mode form, here and on a 40.x screen alike, must
    // still offer only the types a project takes.
    it('offers a project-mode form no sub-task type from that answer, and keeps a stored standard type', async () => {
      installJiraFetch({ '/jira/issue-types': answerAll });
      render(<Harness initial={draftFromTarget({ mode: 'project', projectKey: 'TEAM', issueTypeId: '10002', labels: [] })} />);

      const select = screen.getByLabelText('Issue type');
      await waitFor(() => expect(within(select).getByRole('option', { name: 'Story' })).toBeInTheDocument());
      expect(within(select).queryByRole('option', { name: 'Sub-task' })).toBeNull();
      // Project mode may create epics: only sub-task types are left out.
      expect(within(select).getByRole('option', { name: 'Epic' })).toBeInTheDocument();
      expect(select).toHaveValue('10002');
    });
  });

  it('drops an answer for a key that is no longer typed', async () => {
    const first = deferred<RouteAnswer>();
    let calls = 0;
    installJiraFetch({
      '/jira/issue-types': () => (++calls === 1
        ? first.promise
        : ok({ issueTypes: [{ id: '20001', name: 'Bug', subtask: false }], projectKey: 'OTHER' }))
    });
    render(<Harness />);
    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'TEAM' } });
    fireEvent.blur(key);
    fireEvent.change(key, { target: { value: 'OTHER' } });
    fireEvent.blur(key);

    await waitFor(() => expect(screen.getByRole('option', { name: 'Bug' })).toBeInTheDocument());
    await act(async () => {
      first.resolve(ok({ issueTypes: TYPES, projectKey: 'TEAM' }));
    });
    expect(screen.queryByRole('option', { name: 'Task' })).toBeNull();
    // The list of the key now typed survives the late answer.
    expect(screen.getByRole('option', { name: 'Bug' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load the issue types' })).toBeNull();
  });
});
