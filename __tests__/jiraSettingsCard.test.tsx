import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import JiraSettingsCard from '../components/admin/JiraSettingsCard';
import { deferred, installJiraFetch, ok, refused, type RouteAnswer, type RouteHandler } from './helpers/jiraClientFetch';
import { orphanLabels } from './helpers/formLabels';

/**
 * The console's Jira card (spec §1, plan v2): one Jira for the deployment,
 * tested without saving, and saved in its canonical spelling. Changing the
 * address voids every team's token (a token is only ever sent to the address
 * it was checked against), so the card warns beside the field and asks before
 * saving (finding U-7). Driven against the super-admin routes of contracts §3.
 */

const STORED = { enabled: true, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false };

const setup = (routes: Record<string, RouteHandler> = {}, stored: unknown = STORED) => {
  const fetch = installJiraFetch({
    '/api/super-admin/jira-settings': () => ok(stored),
    ...routes
  });
  const view = render(<JiraSettingsCard sessionToken="admin-token" />);
  return { ...fetch, ...view };
};

const describedBy = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map(id => document.getElementById(id)?.textContent ?? '')
    .join(' ');

const baseUrlField = () => screen.getByLabelText('Jira base URL');
const saveButton = () => screen.getByRole('button', { name: 'Save the Jira settings' });
// Save stays unavailable until the stored settings are in.
const loaded = () => waitFor(() => expect(saveButton()).not.toHaveAttribute('aria-disabled'));
const LOAD_FAILED = 'The Jira settings could not be read. Nothing was changed; try again.';

describe('JiraSettingsCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads the stored settings with the console\'s credential', async () => {
    const { callsTo, container } = setup();
    await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));

    expect(callsTo('/api/super-admin/jira-settings')[0].body).toEqual({ sessionToken: 'admin-token' });
    expect(screen.getByRole('switch', { name: 'Enable Jira' })).toHaveAttribute('aria-checked', 'true');
    const selfSigned = screen.getByRole('switch', { name: 'Allow self-signed certificates' });
    expect(selfSigned).toHaveAttribute('aria-checked', 'false');
    // The warning travels with the toggle (finding S-2).
    expect(selfSigned).toHaveAccessibleDescription(/NODE_EXTRA_CA_CERTS/);
    expect(orphanLabels(container)).toEqual([]);
  });

  it('saves the address in its canonical spelling and shows what the server stored', async () => {
    const routes = setup(
      { '/api/super-admin/update-jira-settings': () => ok({ enabled: true, baseUrl: 'https://intranet.example.org/jira', allowSelfSignedCerts: true }) },
      { enabled: false, baseUrl: null, allowSelfSignedCerts: false }
    );
    await loaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Jira' }));
    fireEvent.change(baseUrlField(), { target: { value: ' HTTPS://Intranet.Example.org/jira/ ' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Allow self-signed certificates' }));
    // A first address voids no token: nothing to warn about.
    expect(screen.queryByText(/Changing the address makes every team/)).toBeNull();
    const confirm = vi.spyOn(window, 'confirm');

    fireEvent.click(screen.getByRole('button', { name: 'Save the Jira settings' }));
    expect(await screen.findByText('Jira settings saved')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(routes.callsTo('/update-jira-settings')[0].body).toEqual({
      sessionToken: 'admin-token',
      enabled: true,
      baseUrl: 'https://intranet.example.org/jira',
      allowSelfSignedCerts: true
    });
    expect(baseUrlField()).toHaveValue('https://intranet.example.org/jira');
  });

  it('warns beside the field and asks before saving a new address', async () => {
    const routes = setup({ '/api/super-admin/update-jira-settings': (body) => ok({ ...STORED, baseUrl: body.baseUrl }) });
    await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));

    fireEvent.change(baseUrlField(), { target: { value: 'https://jira2.example.org' } });
    expect(describedBy(baseUrlField())).toContain('Changing the address makes every team enter its Jira token again');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save the Jira settings' }));
    expect(confirm).toHaveBeenCalledWith('Change the Jira address? Every team will have to enter its Jira token again.');
    expect(routes.callsTo('/update-jira-settings')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Save the Jira settings' }));
    expect(await screen.findByText('Jira settings saved')).toBeInTheDocument();
    expect(routes.callsTo('/update-jira-settings')).toHaveLength(1);
    // Saved: the address is the stored one now, so the warning goes.
    expect(describedBy(baseUrlField())).not.toContain('Changing the address');
  });

  it('does not take another spelling of the same address for a change', async () => {
    setup({ '/api/super-admin/update-jira-settings': () => ok(STORED) });
    await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
    const confirm = vi.spyOn(window, 'confirm');

    fireEvent.change(baseUrlField(), { target: { value: 'HTTPS://Jira.Example.org/' } });
    expect(screen.queryByText(/Changing the address makes every team/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save the Jira settings' }));
    expect(await screen.findByText('Jira settings saved')).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps what the admin typed when the stored settings arrive after it', async () => {
    const stored = deferred<RouteAnswer>();
    installJiraFetch({ '/api/super-admin/jira-settings': () => stored.promise });
    render(<JiraSettingsCard sessionToken="admin-token" />);

    fireEvent.change(baseUrlField(), { target: { value: 'https://new.example.org' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Enable Jira' }));
    await act(async () => {
      stored.resolve(ok({ enabled: false, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false }));
    });

    expect(baseUrlField()).toHaveValue('https://new.example.org');
    expect(screen.getByRole('switch', { name: 'Enable Jira' })).toHaveAttribute('aria-checked', 'true');
    // The stored address is still known, so the change is still said.
    expect(describedBy(baseUrlField())).toContain('Changing the address makes every team');
  });

  it('refuses an address the shared rule refuses, before asking the server', async () => {
    const routes = setup();
    await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.change(baseUrlField(), { target: { value: 'http://jira.example.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the Jira settings' }));

    expect(baseUrlField()).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(baseUrlField())).toContain('starting with https://');
    expect(routes.callsTo('/update-jira-settings')).toHaveLength(0);
  });

  it('refuses to turn Jira on without an address, before asking the server', async () => {
    const routes = setup({}, { enabled: false, baseUrl: null, allowSelfSignedCerts: false });
    await loaded();

    fireEvent.click(screen.getByRole('switch', { name: 'Enable Jira' }));
    fireEvent.click(saveButton());

    expect(baseUrlField()).toHaveAttribute('aria-invalid', 'true');
    expect(describedBy(baseUrlField())).toContain('Enter the address Jira opens at');
    expect(routes.callsTo('/update-jira-settings')).toHaveLength(0);
  });

  describe('when the stored settings cannot be read', () => {
    // Saving the form's defaults over settings nobody saw would turn Jira off,
    // erase its address and void every team's token (plan v2, failure modes:
    // "console error, nothing erased").
    it.each([
      ['the server fails', refused(500, 'failed_to_load')],
      ['a pod without the route answers', { status: 404, html: '<pre>Cannot POST /api/super-admin/jira-settings</pre>' }],
      ['the network fails', { networkError: true }]
    ] as [string, RouteAnswer][])('says so, and Save sends nothing, when %s', async (_, failure) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const routes = installJiraFetch({
        '/api/super-admin/jira-settings': () => failure,
        '/api/super-admin/update-jira-settings': () => ok(STORED)
      });
      render(<JiraSettingsCard sessionToken="admin-token" />);

      const region = screen.getByRole('status');
      await waitFor(() => expect(region).toHaveTextContent(LOAD_FAILED));
      fireEvent.click(screen.getByRole('switch', { name: 'Allow self-signed certificates' }));
      const save = saveButton();
      expect(save).toHaveAttribute('aria-disabled', 'true');
      expect(save).not.toBeDisabled();
      expect(save).toHaveAccessibleDescription(LOAD_FAILED);
      fireEvent.click(save);
      expect(routes.callsTo('/update-jira-settings')).toHaveLength(0);
    });

    it('says the console session expired', async () => {
      const routes = installJiraFetch({ '/api/super-admin/jira-settings': () => refused(401, 'unauthorized') });
      render(<JiraSettingsCard sessionToken="admin-token" />);
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Super admin session expired. Please log in again.'));
      fireEvent.click(saveButton());
      expect(routes.callsTo('/update-jira-settings')).toHaveLength(0);
    });

    it('keeps the failure on screen when a test result comes in', async () => {
      installJiraFetch({
        '/api/super-admin/jira-settings': () => refused(500, 'failed_to_load'),
        '/api/super-admin/test-jira': () => ok({ ok: true, version: '10.3.1', deploymentType: 'Server' })
      });
      render(<JiraSettingsCard sessionToken="admin-token" />);
      const region = screen.getByRole('status');
      await waitFor(() => expect(region).toHaveTextContent(LOAD_FAILED));

      fireEvent.change(baseUrlField(), { target: { value: 'https://jira.example.org' } });
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      await waitFor(() => expect(region).toHaveTextContent('Jira answered: version 10.3.1'));
      expect(region).toHaveTextContent(LOAD_FAILED);
    });

    it('reads them again on request, then saves', async () => {
      let reads = 0;
      const routes = installJiraFetch({
        '/api/super-admin/jira-settings': () => (++reads === 1 ? refused(500, 'failed_to_load') : ok(STORED)),
        '/api/super-admin/update-jira-settings': () => ok(STORED)
      });
      render(<JiraSettingsCard sessionToken="admin-token" />);
      const retry = await screen.findByRole('button', { name: 'Try again' });
      retry.focus();
      fireEvent.click(retry);

      await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
      expect(screen.getByRole('status')).not.toHaveTextContent(LOAD_FAILED);
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      // The button the keyboard was on is gone: the keyboard goes to the form.
      await waitFor(() => expect(baseUrlField()).toHaveFocus());

      fireEvent.click(saveButton());
      expect(await screen.findByText('Jira settings saved')).toBeInTheDocument();
      expect(routes.callsTo('/update-jira-settings')).toHaveLength(1);
    });

    it('keeps the keyboard on Try again while the second read fails too', async () => {
      const routes = installJiraFetch({ '/api/super-admin/jira-settings': () => refused(500, 'failed_to_load') });
      render(<JiraSettingsCard sessionToken="admin-token" />);
      const retry = await screen.findByRole('button', { name: 'Try again' });
      retry.focus();
      fireEvent.click(retry);

      await waitFor(() => expect(routes.callsTo('/jira-settings')).toHaveLength(2));
      await waitFor(() => expect(retry).not.toHaveAttribute('aria-disabled'));
      expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
      expect(retry).toHaveFocus();
      expect(screen.getByRole('status')).toHaveTextContent(LOAD_FAILED);
    });
  });

  it('ties the server\'s refusal of the address to the field, not to the status line', async () => {
    // A pod with a stricter rule during a rollout can refuse an address this
    // client accepts.
    setup({ '/api/super-admin/update-jira-settings': () => refused(400, 'invalid_jira_base_url') });
    await loaded();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.change(baseUrlField(), { target: { value: 'https://jira.internal.example.org' } });
    fireEvent.click(saveButton());

    await waitFor(() => expect(baseUrlField()).toHaveAttribute('aria-invalid', 'true'));
    expect(describedBy(baseUrlField())).toContain('Enter the address Jira opens at');
    expect(screen.getByRole('status')).not.toHaveTextContent('Enter the address Jira opens at');
  });

  it('saves once, asking once, however often Save is pressed while it saves', async () => {
    const answer = deferred<RouteAnswer>();
    const routes = setup({ '/api/super-admin/update-jira-settings': () => answer.promise });
    await loaded();
    fireEvent.change(baseUrlField(), { target: { value: 'https://jira2.example.org' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const save = saveButton();
    fireEvent.click(save);
    fireEvent.click(save);
    await act(async () => {
      answer.resolve(ok({ ...STORED, baseUrl: 'https://jira2.example.org' }));
    });
    expect(await screen.findByText('Jira settings saved')).toBeInTheDocument();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(routes.callsTo('/update-jira-settings')).toHaveLength(1);
  });

  it('shows the server\'s refusal of a save in the reader\'s words', async () => {
    setup({ '/api/super-admin/update-jira-settings': () => refused(500, 'failed_to_save') });
    await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
    fireEvent.click(screen.getByRole('button', { name: 'Save the Jira settings' }));
    expect(await screen.findByText('Failed to save the Jira settings')).toBeInTheDocument();
  });

  it('says the console session expired', async () => {
    setup({ '/api/super-admin/update-jira-settings': () => refused(401, 'unauthorized') });
    await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
    fireEvent.click(screen.getByRole('button', { name: 'Save the Jira settings' }));
    expect(await screen.findByText('Super admin session expired. Please log in again.')).toBeInTheDocument();
  });

  describe('Test', () => {
    it('tests the address in the field without saving it, and says what answered', async () => {
      const routes = setup({ '/api/super-admin/test-jira': () => ok({ ok: true, version: '10.3.1', deploymentType: 'Server' }) });
      await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
      fireEvent.change(baseUrlField(), { target: { value: 'https://jira2.example.org' } });

      const region = screen.getByRole('status');
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      await waitFor(() => expect(region).toHaveTextContent('Jira answered: version 10.3.1, Jira Data Center or Server.'));
      expect(routes.callsTo('/test-jira')[0].body).toEqual({
        sessionToken: 'admin-token',
        baseUrl: 'https://jira2.example.org',
        allowSelfSignedCerts: false
      });
      expect(routes.callsTo('/update-jira-settings')).toHaveLength(0);
    });

    it('names Jira Cloud', async () => {
      setup({ '/api/super-admin/test-jira': () => ok({ ok: true, version: '1001.0.0', deploymentType: 'Cloud' }) });
      await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Jira answered: version 1001.0.0, Jira Cloud.'));
    });

    it('shows the failure, the status, the redirect and Jira\'s own words', async () => {
      setup({
        '/api/super-admin/test-jira': () => ok({
          ok: false,
          error: 'jira_unavailable',
          status: 302,
          location: 'https://sso.example.org/login',
          messages: ['Login required']
        })
      });
      await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));

      const region = screen.getByRole('status');
      await waitFor(() => expect(region).toHaveTextContent('The test failed: Jira is not available right now.'));
      expect(region).toHaveTextContent('Jira answered with HTTP status 302.');
      expect(region).toHaveTextContent('Jira redirects to https://sso.example.org/login: enter that address instead.');
      expect(region).toHaveTextContent('Jira’s message: Login required');
    });

    // The test is an anonymous serverInfo against the address in the field.
    // The shared sentences of these codes speak of the team's token, or of a
    // project or issue: none is involved here, and the admin reads them right
    // under "The test calls Jira without any token".
    it.each([
      [404, 'jira_not_found', 'No Jira REST API answers at this address. Check its context path (for example /jira).'],
      [401, 'jira_auth_failed', 'This address asks for a sign-in before it answers, so the test, which sends no token, cannot tell whether Jira is there. Each team’s token is checked when it is saved.'],
      [403, 'jira_forbidden', 'This address refuses requests that carry no sign-in, so the test, which sends no token, cannot tell whether Jira is there. Each team’s token is checked when it is saved.']
    ])('says what a %s means for the address tested, never for a team’s token', async (status, error, sentence) => {
      setup({ '/api/super-admin/test-jira': () => ok({ ok: false, error, status }) });
      await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));

      const region = screen.getByRole('status');
      await waitFor(() => expect(region).toHaveTextContent(`The test failed: ${sentence}`));
      expect(region).toHaveTextContent(`Jira answered with HTTP status ${status}.`);
      expect(region).not.toHaveTextContent('team’s token is not allowed');
      expect(region).not.toHaveTextContent('project or issue');
      expect(region).not.toHaveTextContent('Jira refused this token');
    });

    it('calls Jira once however often Test is pressed while it runs', async () => {
      const answer = deferred<RouteAnswer>();
      const routes = setup({ '/api/super-admin/test-jira': () => answer.promise });
      await loaded();

      const test = screen.getByRole('button', { name: 'Test' });
      fireEvent.click(test);
      fireEvent.click(test);
      await act(async () => {
        answer.resolve(ok({ ok: true, version: '10.3.1', deploymentType: 'Server' }));
      });
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Jira answered: version 10.3.1'));
      expect(routes.callsTo('/test-jira')).toHaveLength(1);
    });

    it.each([
      ['a pod without the route', { status: 404, html: '<pre>Cannot POST /api/super-admin/test-jira</pre>' }],
      ['a gateway', { status: 502, html: '<html>Bad Gateway</html>' }],
      ['a server error without a code', { status: 500, json: {} }]
    ] as [string, RouteAnswer][])('never says Jira answered when %s fails the test itself', async (_, failure) => {
      // The route failed before it could call Jira, or without saying what
      // Jira did: its HTTP status is the deployment's, not Jira's.
      setup({ '/api/super-admin/test-jira': () => failure });
      await loaded();
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));

      const region = screen.getByRole('status');
      await waitFor(() => expect(region).toHaveTextContent('The server could not run the test. Try again in a moment.'));
      expect(region).not.toHaveTextContent('Jira answered with HTTP status');
      expect(region).not.toHaveTextContent('The test failed');
    });

    it('shows the route\'s refusal of the address', async () => {
      setup({ '/api/super-admin/test-jira': () => refused(400, 'invalid_jira_base_url') });
      await waitFor(() => expect(baseUrlField()).toHaveValue('https://jira.example.org'));
      fireEvent.click(screen.getByRole('button', { name: 'Test' }));
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/The test failed: Enter the address Jira opens at/));
    });
  });
});
