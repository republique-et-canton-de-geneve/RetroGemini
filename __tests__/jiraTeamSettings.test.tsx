import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JiraStatus, Team } from '../types';
import {
  deferred,
  installJiraFetch,
  ok,
  refused,
  statusWith,
  type RouteAnswer,
  type RouteHandler
} from './helpers/jiraClientFetch';
import { orphanLabels } from './helpers/formLabels';

/**
 * The Jira card of the Dashboard settings (spec §2-§3): the team's one token,
 * write-only and committed on Save only (the RecoveryEmailSetting lesson: a
 * field that saves per keystroke stores whatever was half-typed), its state in
 * words, and where the team's issues go. Driven against the routes of
 * contracts §3.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null
  }
}));

import JiraTeamSettings from '../components/jira/JiraTeamSettings';

const team = { id: 'team-1', name: 'Alpha', members: [], retrospectives: [], healthChecks: [], globalActions: [] } as unknown as Team;

const NO_TOKEN = statusWith({
  target: null,
  token: { configured: false, usable: false, connectedAs: null, deploymentType: null, setAt: null }
});
const TYPES = [{ id: '10001', name: 'Task', subtask: false }];

const setup = (status: JiraStatus | null, routes: Record<string, RouteHandler> = {}) => {
  const fetch = installJiraFetch({
    '/jira/status': () => (status ? ok(status) : refused(401, 'invalid_token')),
    '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }),
    ...routes
  });
  const view = render(<JiraTeamSettings team={team} />);
  return { ...fetch, ...view };
};

const describedBy = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ');

const setAtText = new Date('2026-10-20T08:00:00.000Z').toLocaleDateString('en-US');

describe('JiraTeamSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // A deployment without Jira: the card would advertise a feature that does
  // not exist for this organisation, like the discovery note it never shows.
  it('renders nothing on a server without Jira when the team has no token', async () => {
    const { container, callsTo } = setup(statusWith({ enabled: false, token: { configured: false, usable: false, connectedAs: null, setAt: null } }));
    await waitFor(() => expect(callsTo('/jira/status')).toHaveLength(1));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole('region', { name: 'Jira' })).toBeNull();
  });

  // Nothing while the status is read either: a "Jira" section that appears
  // and then vanishes, every time Settings opens on such a deployment, would
  // advertise the feature for a moment and make the page jump.
  it('renders nothing while the status is read, so a server without Jira never shows the card', async () => {
    const answer = deferred<RouteAnswer>();
    installJiraFetch({ '/jira/status': () => answer.promise });
    const { container } = render(<JiraTeamSettings team={team} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('region', { name: 'Jira' })).toBeNull();

    await act(async () => {
      answer.resolve(ok(statusWith({ enabled: false, token: { configured: false, usable: false, connectedAs: null, setAt: null } })));
    });
    expect(container).toBeEmptyDOMElement();
  });

  // Jira was turned off with a token still stored for the team: the card is
  // the only place it can be removed from.
  it('keeps the card on a server where Jira was turned off while the team still has a token, to remove it', async () => {
    const routes = setup(statusWith({ enabled: false }), {
      '/jira/token/delete': () => ok(statusWith({ enabled: false, token: { configured: false, usable: false, connectedAs: null, setAt: null } }))
    });
    const card = await screen.findByRole('region', { name: 'Jira' });
    expect(screen.getByText(/Jira is not turned on for this server/)).toBeInTheDocument();
    expect(screen.getByText('A Jira token is still stored for this team.')).toBeInTheDocument();
    // Nothing to fill in: the token can only be checked against a Jira that is on.
    expect(screen.queryByLabelText('Jira access token')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Replace the token' })).toBeNull();
    expect(screen.queryByText('Where issues are created')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove the token' }));
    const confirm = screen.getByRole('button', { name: 'Remove the token' });
    await waitFor(() => expect(confirm).toHaveFocus());
    fireEvent.click(confirm);

    // Said, and kept on screen until the card is left: removing it at once
    // would take the confirmation and the keyboard with it.
    expect(await screen.findByText('Token removed')).toBeInTheDocument();
    // The card stays for the confirmation, but no longer says a token is stored.
    expect(screen.queryByText('A Jira token is still stored for this team.')).toBeNull();
    expect(routes.callsTo('/jira/token/delete')).toHaveLength(1);
    expect(card).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Jira' })).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Remove the token' })).toBeNull();
  });

  // The Dashboard's separator is given to the card itself, so that a card
  // rendering nothing leaves no empty frame (see the test above): it must
  // land on the card's own element, in every state the card has.
  it('puts the classes it is given on its own element', async () => {
    let reads = 0;
    installJiraFetch({ '/jira/status': () => (++reads === 1 ? refused(401, 'invalid_token') : ok(NO_TOKEN)) });
    render(<JiraTeamSettings team={team} className="sep" />);
    // A status that could not be read, then the card.
    await screen.findByRole('button', { name: 'Try again' });
    expect(screen.getByRole('region', { name: 'Jira' })).toHaveClass('sep', 'mb-4');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Jira access token');
    expect(screen.getByRole('region', { name: 'Jira' })).toHaveClass('sep', 'mb-4');
  });

  it('puts the classes it is given on the card a server without Jira keeps for a stored token', async () => {
    installJiraFetch({ '/jira/status': () => ok(statusWith({ enabled: false })) });
    render(<JiraTeamSettings team={team} className="sep" />);
    expect(await screen.findByRole('region', { name: 'Jira' })).toHaveClass('sep', 'mb-4');
  });

  it('shows a stored token on a server without Jira as a state alone outside the facilitator’s view', async () => {
    installJiraFetch({ '/jira/status': () => ok(statusWith({ enabled: false })) });
    render(<JiraTeamSettings team={team} isFacilitatorView={false} />);
    expect(await screen.findByText('A Jira token is still stored for this team.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove the token' })).toBeNull();
  });

  it('says the settings could not be read, never that Jira is off, and reads them again on request', async () => {
    // An expired session, the network, a rollout outlasting its retries: the
    // administrator has nothing to do with any of them.
    let reads = 0;
    installJiraFetch({ '/jira/status': () => (++reads === 1 ? refused(401, 'invalid_token') : ok(NO_TOKEN)) });
    render(<JiraTeamSettings team={team} />);

    expect(await screen.findByText('The team’s Jira settings could not be read. Try again in a moment.')).toBeInTheDocument();
    expect(screen.queryByText(/Jira is not turned on for this server/)).toBeNull();

    const retry = screen.getByRole('button', { name: 'Try again' });
    retry.focus();
    fireEvent.click(retry);
    expect(await screen.findByLabelText('Jira access token')).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/)).toBeNull();
    expect(reads).toBe(2);
    // The button the keyboard was on is gone: the keyboard goes to the card.
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Jira' })).toHaveFocus());
  });

  it('keeps the keyboard on Try again while a second read fails too', async () => {
    const routes = installJiraFetch({ '/jira/status': () => ({ networkError: true }) });
    render(<JiraTeamSettings team={team} />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    retry.focus();
    fireEvent.click(retry);

    await waitFor(() => expect(routes.callsTo('/jira/status')).toHaveLength(2));
    await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled'));
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
    expect(retry).toHaveFocus();
  });

  it('names every field of the token form, which hides what is typed', async () => {
    const { container } = setup(NO_TOKEN);
    const token = await screen.findByLabelText('Jira access token');
    expect(screen.getByText('No token saved yet.')).toBeInTheDocument();
    expect(token).toHaveAttribute('type', 'password');
    expect(token).toHaveAttribute('autocomplete', 'off');
    expect(screen.getByLabelText('Email (Jira Cloud only)')).toHaveAttribute('type', 'email');
    expect(orphanLabels(container)).toEqual([]);
  });

  it('saves the token on Save only, then says who it connects as and forgets the field', async () => {
    const saved = statusWith({ target: null });
    const routes = setup(NO_TOKEN, { '/jira/token': () => ok(saved) });
    const token = await screen.findByLabelText('Jira access token');

    fireEvent.change(token, { target: { value: 'pat-123' } });
    fireEvent.blur(token);
    fireEvent.change(screen.getByLabelText('Email (Jira Cloud only)'), { target: { value: 'bot@example.org' } });
    expect(routes.callsTo('/jira/token')).toHaveLength(0);

    const save = screen.getByRole('button', { name: 'Save the token' });
    save.focus();
    fireEvent.click(save);
    expect(await screen.findByText(`Connected to Jira as Retro Bot, set on ${setAtText}`)).toBeInTheDocument();
    expect(screen.getByText('Token saved')).toBeInTheDocument();
    expect(routes.callsTo('/jira/token')[0].body).toMatchObject({ token: 'pat-123', email: 'bot@example.org', sessionToken: 'token-1' });
    // Write-only: the field is gone with its value.
    expect(screen.queryByLabelText('Jira access token')).toBeNull();
    expect(document.body.innerHTML).not.toContain('pat-123');
    // The form and its button are gone: the keyboard goes to what replaced them.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replace the token' })).toHaveFocus());

    // Opened again, the form starts empty: nothing of the saved token stayed behind.
    fireEvent.click(screen.getByRole('button', { name: 'Replace the token' }));
    expect(screen.getByLabelText('Jira access token')).toHaveValue('');
    expect(screen.getByLabelText('Email (Jira Cloud only)')).toHaveValue('');
    expect(document.body.innerHTML).not.toContain('pat-123');
    expect(document.body.innerHTML).not.toContain('bot@example.org');
  });

  it('sends the token once while Jira checks it, and keeps the button focusable', async () => {
    const answer = deferred<RouteAnswer>();
    const routes = setup(NO_TOKEN, { '/jira/token': () => answer.promise });
    fireEvent.change(await screen.findByLabelText('Jira access token'), { target: { value: 'pat-123' } });

    const save = screen.getByRole('button', { name: 'Save the token' });
    fireEvent.click(save);
    const checking = screen.getByRole('button', { name: 'Checking with Jira…' });
    expect(checking).toBe(save);
    expect(checking).toHaveAttribute('aria-disabled', 'true');
    expect(checking).not.toBeDisabled();
    fireEvent.click(checking);

    await act(async () => {
      answer.resolve(ok(statusWith()));
    });
    expect(await screen.findByText(/Connected to Jira as Retro Bot/)).toBeInTheDocument();
    expect(routes.callsTo('/jira/token')).toHaveLength(1);
  });

  it('asks for a token before sending, and checks the email with the shared rule', async () => {
    const routes = setup(NO_TOKEN);
    await screen.findByLabelText('Jira access token');

    fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));
    const token = screen.getByLabelText('Jira access token');
    expect(token).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(token)).toContain('Enter the token first.');

    fireEvent.change(token, { target: { value: 'pat-123' } });
    fireEvent.change(screen.getByLabelText('Email (Jira Cloud only)'), { target: { value: 'not an address' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));
    expect(screen.getByLabelText('Email (Jira Cloud only)')).toHaveAttribute('aria-invalid', 'true');
    expect(routes.callsTo('/jira/token')).toHaveLength(0);
  });

  it('ties Jira\'s refusal of the token to the field, in the reader\'s words', async () => {
    setup(NO_TOKEN, { '/jira/token': () => refused(400, 'jira_auth_failed') });
    const token = await screen.findByLabelText('Jira access token');
    fireEvent.change(token, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));

    await waitFor(() => expect(token).toHaveAttribute('aria-invalid', 'true'));
    expect(describedBy(token)).toContain('Jira refused this token. Check it, then try again.');
  });

  // A 404 from serverInfo or myself: the configured address does not reach
  // Jira's REST API (a missing context path, most often). No project or issue
  // is involved, and nobody in the team can fix it: the administrator can.
  it('says a token refused with jira_not_found is the server’s address to check, not a project or issue', async () => {
    setup(NO_TOKEN, { '/jira/token': () => refused(404, 'jira_not_found') });
    const token = await screen.findByLabelText('Jira access token');
    fireEvent.change(token, { target: { value: 'pat-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));

    await waitFor(() => expect(token).toHaveAttribute('aria-invalid', 'true'));
    expect(describedBy(token)).toContain(
      'Jira did not answer at the address this server is configured with. Ask your administrator to check the Jira base URL.'
    );
    expect(describedBy(token)).not.toContain('project or issue');
  });

  it('ties the server\'s refusal of the email to the email field, not to the token', async () => {
    setup(NO_TOKEN, { '/jira/token': () => refused(400, 'invalid_email') });
    const token = await screen.findByLabelText('Jira access token');
    fireEvent.change(token, { target: { value: 'pat-123' } });
    const email = screen.getByLabelText('Email (Jira Cloud only)');
    fireEvent.change(email, { target: { value: 'bot@example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));

    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
    expect(describedBy(email)).toContain('Enter one valid email address');
    expect(token).not.toHaveAttribute('aria-invalid');
    expect(describedBy(token)).not.toContain('Enter one valid email address');
  });

  it('shows a working token with Replace and Remove, and no field until Replace', async () => {
    setup(statusWith());
    expect(await screen.findByText(`Connected to Jira as Retro Bot, set on ${setAtText}`)).toBeInTheDocument();
    expect(screen.queryByLabelText('Jira access token')).toBeNull();

    const replace = screen.getByRole('button', { name: 'Replace the token' });
    replace.focus();
    fireEvent.click(replace);
    const field = screen.getByLabelText('Jira access token');
    expect(field).toHaveValue('');
    await waitFor(() => expect(field).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Jira access token')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replace the token' })).toHaveFocus());
  });

  it('opens the form at once for a token that must be entered again', async () => {
    setup(statusWith({ token: { refusedAt: '2026-10-19T12:00:00.000Z' } }));
    const date = new Date('2026-10-19T12:00:00.000Z').toLocaleDateString('en-US');
    expect(await screen.findByText(`Jira refused this token on ${date}. Replace it.`)).toBeInTheDocument();
    expect(screen.getByLabelText('Jira access token')).toBeInTheDocument();
  });

  it('says why a stored token can no longer be used', async () => {
    setup(statusWith({ token: { usable: false, reason: 'address_changed' } }));
    expect(await screen.findByText('The Jira address changed after this token was saved. Enter the token again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Jira access token')).toBeInTheDocument();
  });

  it.each([
    ['it no longer decrypts', statusWith({ token: { usable: false, reason: 'unreadable' } })],
    ['the server gives no reason', statusWith({ token: { usable: false } })]
  ])('asks for the token again when %s, never saying it is connected', async (_, status) => {
    setup(status);
    expect(await screen.findByText('This server can no longer read the saved token. Enter it again.')).toBeInTheDocument();
    expect(screen.getByLabelText('Jira access token')).toBeInTheDocument();
    expect(screen.queryByText(/Connected to Jira/)).toBeNull();
  });

  it('removes the token only once confirmed', async () => {
    const routes = setup(statusWith(), { '/jira/token/delete': () => ok(NO_TOKEN) });
    await screen.findByText(/Connected to Jira as Retro Bot/);

    const remove = screen.getByRole('button', { name: 'Remove the token' });
    remove.focus();
    fireEvent.click(remove);
    expect(routes.callsTo('/jira/token/delete')).toHaveLength(0);
    const confirm = screen.getByRole('button', { name: 'Remove the token' });
    expect(confirm).toHaveAccessibleDescription(/Remove the team’s Jira token\?/);
    await waitFor(() => expect(confirm).toHaveFocus());

    fireEvent.click(confirm);
    expect(await screen.findByText('Token removed')).toBeInTheDocument();
    expect(screen.getByText('No token saved yet.')).toBeInTheDocument();
    expect(routes.callsTo('/jira/token/delete')).toHaveLength(1);
    // The confirmation is gone: the keyboard goes to the field a new token is typed in.
    await waitFor(() => expect(screen.getByLabelText('Jira access token')).toHaveFocus());
  });

  it('removes the token once however often the confirmation is pressed', async () => {
    const answer = deferred<RouteAnswer>();
    const routes = setup(statusWith(), { '/jira/token/delete': () => answer.promise });
    await screen.findByText(/Connected to Jira as Retro Bot/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the token' }));

    const confirm = screen.getByRole('button', { name: 'Remove the token' });
    fireEvent.click(confirm);
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(confirm);
    await act(async () => {
      answer.resolve(ok(NO_TOKEN));
    });
    expect(await screen.findByText('Token removed')).toBeInTheDocument();
    expect(routes.callsTo('/jira/token/delete')).toHaveLength(1);
  });

  it.each([
    ['refused by the server', refused(500, 'unknown_error')],
    ['lost on the network', { networkError: true } as RouteAnswer]
  ])('says so beside the confirmation when a removal is %s', async (_, failure) => {
    let attempts = 0;
    const routes = setup(statusWith(), { '/jira/token/delete': () => (++attempts === 1 ? failure : ok(NO_TOKEN)) });
    await screen.findByText(/Connected to Jira as Retro Bot/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the token' }));
    const confirm = screen.getByRole('button', { name: 'Remove the token' });
    fireEvent.click(confirm);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong. Please try again.');
    expect(confirm).toHaveAccessibleDescription(/Remove the team’s Jira token\?.*Something went wrong\. Please try again\./);
    // Nothing changed: the token is still the team's, the question still open.
    expect(screen.getByText(/Connected to Jira as Retro Bot/)).toBeInTheDocument();
    expect(routes.callsTo('/jira/token/delete')).toHaveLength(1);

    // Cancel takes the message away with the question, and Replace does not inherit it.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Replace the token' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByLabelText('Jira access token')).not.toHaveAttribute('aria-invalid');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // Asked again, the question comes without the old answer; the new attempt succeeds.
    fireEvent.click(screen.getByRole('button', { name: 'Remove the token' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove the token' })).not.toHaveAccessibleDescription(/Something went wrong/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove the token' }));
    expect(await screen.findByText('Token removed')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('the target', () => {
    it('saves the target the fields describe', async () => {
      const saved = statusWith();
      const routes = setup(statusWith({ target: null }), { '/jira/target': () => ok(saved) });
      expect(await screen.findByText('No target chosen yet.')).toBeInTheDocument();

      // The fields appear a commit after the line above: wait on them, not on it.
      const key = await screen.findByLabelText('Project key');
      fireEvent.change(key, { target: { value: 'TEAM' } });
      fireEvent.blur(key);
      await waitFor(() => expect(screen.getByRole('option', { name: 'Task' })).toBeInTheDocument());
      fireEvent.change(screen.getByLabelText('Issue type'), { target: { value: '10001' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save the target' }));

      expect(await screen.findByText('Target saved')).toBeInTheDocument();
      expect(routes.callsTo('/jira/target')[0].body.target).toEqual({
        mode: 'project',
        projectKey: 'TEAM',
        issueTypeId: '10001',
        labels: ['retrospective']
      });
    });

    it.each([
      ['Save the target', 'Target saved'],
      ['Clear the target', 'Target cleared']
    ])('sends the target once however often %s is pressed', async (name, done) => {
      const answer = deferred<RouteAnswer>();
      const routes = setup(statusWith(), { '/jira/target': () => answer.promise });
      await waitFor(() => expect(screen.getByLabelText('Issue type')).toHaveValue('10001'));

      const button = screen.getByRole('button', { name });
      fireEvent.click(button);
      expect(button).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(button);
      await act(async () => {
        answer.resolve(ok(statusWith()));
      });
      expect(await screen.findByText(done)).toBeInTheDocument();
      expect(routes.callsTo('/jira/target')).toHaveLength(1);
    });

    it('keeps what is being typed when a stored target arrives meanwhile', async () => {
      // A token saved meanwhile answers with the stored target, which another
      // tab changed: the facilitator's draft is not replaced under their hands.
      const elsewhere = { mode: 'project' as const, projectKey: 'NEW', issueTypeId: '10001', labels: [] };
      setup(statusWith(), { '/jira/token': () => ok(statusWith({ target: elsewhere })) });
      const key = await screen.findByLabelText('Project key');
      await waitFor(() => expect(key).toHaveValue('TEAM'));
      fireEvent.change(key, { target: { value: 'OTHER' } });

      fireEvent.click(screen.getByRole('button', { name: 'Replace the token' }));
      fireEvent.change(screen.getByLabelText('Jira access token'), { target: { value: 'pat-456' } });
      fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));
      expect(await screen.findByText('Token saved')).toBeInTheDocument();
      // The draft would be rebuilt by an effect of that commit: let it run
      // before looking, or the check passes before it could fail.
      await act(async () => {
        await Promise.resolve();
      });

      expect(screen.getByLabelText('Project key')).toHaveValue('OTHER');
    });

    it('refuses an incomplete target without asking the server', async () => {
      const routes = setup(statusWith({ target: null }));
      await screen.findByText('No target chosen yet.');
      fireEvent.click(screen.getByRole('button', { name: 'Save the target' }));

      expect(screen.getByText(/This Jira target is not valid/)).toBeInTheDocument();
      expect(routes.callsTo('/jira/target')).toHaveLength(0);
    });

    it('clears the target', async () => {
      const routes = setup(statusWith(), { '/jira/target': () => ok(statusWith({ target: null })) });
      await screen.findByLabelText('Project key');
      expect(screen.getByLabelText('Project key')).toHaveValue('TEAM');

      fireEvent.click(screen.getByRole('button', { name: 'Clear the target' }));
      expect(await screen.findByText('Target cleared')).toBeInTheDocument();
      expect(routes.callsTo('/jira/target')[0].body).toHaveProperty('target', null);
      expect(screen.getByLabelText('Project key')).toHaveValue('');
    });

    // "Clear the target" goes with the target it cleared: the keyboard must
    // land on the form, not drop to the top of the page.
    it('gives the keyboard to the form once the cleared target takes its button away', async () => {
      setup(statusWith(), { '/jira/target': () => ok(statusWith({ target: null })) });
      await screen.findByLabelText('Project key');

      const clear = screen.getByRole('button', { name: 'Clear the target' });
      clear.focus();
      fireEvent.click(clear);
      expect(await screen.findByText('Target cleared')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Clear the target' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Save the target' })).toHaveFocus();
    });

    it('leaves the keyboard on Clear when the clear is refused', async () => {
      setup(statusWith(), { '/jira/target': () => refused(500, 'failed_to_save') });
      await screen.findByLabelText('Project key');

      const clear = screen.getByRole('button', { name: 'Clear the target' });
      clear.focus();
      fireEvent.click(clear);
      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(clear).toHaveFocus();
    });

    it('is not offered before the team has a working token', async () => {
      setup(NO_TOKEN);
      await screen.findByLabelText('Jira access token');
      expect(screen.queryByLabelText('Project key')).toBeNull();
    });
  });

  it('shows the state alone outside the facilitator\'s view', async () => {
    installJiraFetch({ '/jira/status': () => ok(statusWith()) });
    render(<JiraTeamSettings team={team} isFacilitatorView={false} />);
    expect(await screen.findByText(/Connected to Jira as Retro Bot/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
