import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ActionItem } from '../types';
import {
  deferred,
  installJiraFetch,
  ok,
  refused,
  statusWith,
  type RouteAnswer
} from './helpers/jiraClientFetch';

/**
 * One action's Jira control (finding U-3): idle, sending, created, refused and
 * uncertain, driven against the real `jiraService` and a fetch that answers as
 * `/api/team/:teamId/jira/issues` does (contracts §3).
 *
 *  - Sending keeps the button focusable (`aria-disabled`, never `disabled`): a
 *    disabled button drops the keyboard on the page in the commit it turns off.
 *  - Created moves focus to the new link, since the button it replaces is gone,
 *    and says so in a status region that exists before anything changes.
 *  - Refused keeps the button and ties Jira's own words to it.
 *  - Uncertain never re-creates on its own: "Create anyway" asks first, then
 *    sends `force: true`.
 */

const mocks = vi.hoisted(() => ({
  dataService: {
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null,
    whenPersisted: async () => {},
    applyJiraLinks: (() => {}) as (teamId: string, links: unknown[]) => void
  }
}));
vi.mock('../services/dataService', () => ({ dataService: mocks.dataService }));

import JiraActionControl from '../components/jira/JiraActionControl';
import { jiraInFlight } from '../components/jira/jiraInFlight';
import { jiraService } from '../services/jiraService';

const action = (overrides: Partial<ActionItem> = {}): ActionItem => ({
  id: 'a1',
  text: 'Speed up the build',
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const issuesAnswer = (results: unknown[], extra: Record<string, unknown> = {}): RouteAnswer =>
  ok({ results, remaining: [], ...extra });

const renderControl = (props: Partial<React.ComponentProps<typeof JiraActionControl>> = {}) =>
  render(
    <JiraActionControl
      action={action()}
      status={statusWith()}
      teamId="team-1"
      isFacilitator
      sessionId="retro-1"
      kind="retro"
      requestedBy="Ann"
      {...props}
    />
  );

const createButton = () => screen.getByRole('button', { name: 'Create in Jira, Speed up the build' });

// Lets the promises a click started run: `createIssues` waits for the persist
// queue before it sends anything, so a check made in the same tick as the
// click would find no request whatever the control did.
const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

// A screen that reads the status again when the control asks, as the Review
// step and the Dashboard do through `useJiraStatus().refresh`.
const RefreshingScreen: React.FC<{ next: ReturnType<typeof statusWith> }> = ({ next }) => {
  const [status, setStatus] = useState(statusWith());
  return (
    <div>
      <JiraActionControl
        action={action()}
        status={status}
        teamId="team-1"
        isFacilitator
        kind="retro"
        requestedBy="Ann"
        onStatusStale={() => setStatus(next)}
      />
      <button type="button">Elsewhere</button>
    </div>
  );
};

describe('JiraActionControl', () => {
  beforeEach(() => {
    jiraInFlight.clear();
    mocks.dataService.applyJiraLinks = vi.fn();
  });

  afterEach(() => {
    jiraInFlight.clear();
    vi.restoreAllMocks();
  });

  describe('what it offers', () => {
    it('offers a facilitator to create an open, unlinked action, named after it', () => {
      renderControl();
      const button = createButton();
      // The visible text first, then the action (WCAG 2.5.3).
      expect(button).toHaveTextContent('Create in Jira');
    });

    it('shows a participant only the link, never a button', () => {
      const { container, rerender } = renderControl({ isFacilitator: false });
      expect(container).toBeEmptyDOMElement();

      rerender(
        <JiraActionControl
          action={action({ jira: { key: 'TEAM-3', createdAt: 'x' } })}
          status={statusWith()}
          teamId="team-1"
          isFacilitator={false}
          kind="retro"
          requestedBy="Bob"
        />
      );
      expect(screen.getByRole('link', { name: 'TEAM-3, open in Jira (new tab)' })).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('shows the link instead of a button once the action has its issue', () => {
      renderControl({ action: action({ jira: { key: 'TEAM-3', createdAt: 'x' } }) });
      expect(screen.getByRole('link', { name: /^TEAM-3/ })).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('offers nothing for a closed action or a proposal', () => {
      const { container } = renderControl({ action: action({ done: true }) });
      expect(container).toBeEmptyDOMElement();
      const { container: proposal } = renderControl({ action: action({ type: 'proposal' }) });
      expect(proposal).toBeEmptyDOMElement();
    });

    it('offers nothing while the token or the target is missing, or Jira is off', () => {
      const { container: noToken } = renderControl({ status: statusWith({ token: { configured: false, usable: false } }) });
      expect(noToken).toBeEmptyDOMElement();
      const { container: noTarget } = renderControl({ status: statusWith({ target: null }) });
      expect(noTarget).toBeEmptyDOMElement();
      const { container: off } = renderControl({ status: null });
      expect(off).toBeEmptyDOMElement();
    });
  });

  describe('sending', () => {
    it('stays focusable and named while sending, and ignores more clicks', async () => {
      const answer = deferred<RouteAnswer>();
      const routes = installJiraFetch({ '/jira/issues': () => answer.promise });
      renderControl();

      const button = createButton();
      fireEvent.click(button);

      const sending = await screen.findByRole('button', { name: 'Creating…, Speed up the build' });
      expect(sending).toBe(button);
      expect(sending).toHaveAttribute('aria-disabled', 'true');
      expect(sending).not.toBeDisabled();
      expect(sending).toHaveTextContent('Creating…');

      fireEvent.click(sending);
      fireEvent.click(sending);
      await act(async () => {
        answer.resolve(issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }]));
      });
      await screen.findByRole('link', { name: /^TEAM-12/ });
      expect(routes.callsTo('/jira/issues')).toHaveLength(1);
    });

    it('sends the one action with the session, the clicker and the interface language', async () => {
      const routes = installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }])
      });
      renderControl();
      fireEvent.click(createButton());
      await screen.findByRole('link', { name: /^TEAM-12/ });

      const [call] = routes.callsTo('/jira/issues');
      expect(call.url).toBe('/api/team/team-1/jira/issues');
      expect(call.body).toMatchObject({
        sessionToken: 'token-1',
        actionIds: ['a1'],
        sessionId: 'retro-1',
        requestedBy: 'Ann',
        language: 'en'
      });
      expect(call.body).not.toHaveProperty('force');
      expect(call.body).not.toHaveProperty('target');
    });

    it('sends no session for a backlog action', async () => {
      const routes = installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }])
      });
      renderControl({ kind: 'backlog', sessionId: 'ignored' });
      fireEvent.click(createButton());
      await screen.findByRole('link', { name: /^TEAM-12/ });
      expect(routes.callsTo('/jira/issues')[0].body).not.toHaveProperty('sessionId');
    });

    it('shows the action as sending while a batch holds it, and sends nothing itself', async () => {
      const routes = installJiraFetch({});
      const createIssues = vi.spyOn(jiraService, 'createIssues');
      jiraInFlight.add(['a1']);
      renderControl();

      const button = screen.getByRole('button', { name: 'Creating…, Speed up the build' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(button);
      await flush();
      expect(createIssues).not.toHaveBeenCalled();
      expect(routes.calls).toHaveLength(0);
    });
  });

  describe('created', () => {
    it('moves focus to the new link and announces it through a region that was already there', async () => {
      installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }])
      });
      const onCreated = vi.fn();
      renderControl({ onCreated });

      // Mounted empty with the control, so the announcement is a change.
      const region = screen.getByRole('status');
      expect(region).toHaveTextContent('');

      const button = createButton();
      button.focus();
      fireEvent.click(button);

      const link = await screen.findByRole('link', { name: 'TEAM-12, open in Jira (new tab)' });
      await waitFor(() => expect(link).toHaveFocus());
      expect(screen.getByRole('status')).toBe(region);
      expect(region).toHaveTextContent('TEAM-12 created');
      expect(onCreated).toHaveBeenCalledWith([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }]);
      expect(mocks.dataService.applyJiraLinks).toHaveBeenCalledWith('team-1', [
        { actionId: 'a1', jira: { key: 'TEAM-12', createdAt: expect.any(String) } }
      ]);
    });

    it('moves focus to the new link after a click that focused nothing', async () => {
      // A mouse click in Safari leaves the keyboard on the page, not on the button.
      installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }])
      });
      renderControl();
      expect(document.activeElement).toBe(document.body);
      fireEvent.click(createButton());

      await waitFor(() => expect(screen.getByRole('link', { name: /^TEAM-12/ })).toHaveFocus());
    });

    it('does not take the keyboard from someone who moved on while it was sending', async () => {
      const answer = deferred<RouteAnswer>();
      installJiraFetch({ '/jira/issues': () => answer.promise });
      render(
        <div>
          <JiraActionControl action={action()} status={statusWith()} teamId="team-1" isFacilitator kind="retro" requestedBy="Ann" />
          <button type="button">Elsewhere</button>
        </div>
      );
      const button = createButton();
      button.focus();
      fireEvent.click(button);
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
      elsewhere.focus();

      await act(async () => {
        answer.resolve(issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }]));
      });
      await screen.findByRole('link', { name: /^TEAM-12/ });
      expect(elsewhere).toHaveFocus();
    });

    it('shows the key of an action another window had already linked', async () => {
      installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'already_linked', key: 'TEAM-4' }])
      });
      renderControl();
      fireEvent.click(createButton());
      await screen.findByRole('link', { name: /^TEAM-4/ });
      expect(screen.getByRole('status')).toHaveTextContent('Already in Jira as TEAM-4');
    });

    it('shows the key and warns when the link could not be saved here', async () => {
      installJiraFetch({
        '/jira/issues': () => issuesAnswer(
          [{ actionId: 'a1', status: 'created_not_saved', key: 'TEAM-5' }],
          { stopped: 'link_not_saved' }
        )
      });
      renderControl();
      fireEvent.click(createButton());
      await screen.findByRole('link', { name: /^TEAM-5/ });
      expect(screen.getByText('TEAM-5 was created in Jira, but its link could not be saved here.')).toBeInTheDocument();
    });
  });

  describe('refused', () => {
    it('keeps the button and ties Jira\'s own words to it', async () => {
      installJiraFetch({
        '/jira/issues': () => issuesAnswer([
          { actionId: 'a1', status: 'refused', jiraMessages: ['Component/s is required.', 'Sprint: <b>closed</b>'] }
        ])
      });
      // Nothing changed on the action: the screen has nothing to refresh.
      const onCreated = vi.fn();
      renderControl({ onCreated });
      fireEvent.click(createButton());

      await waitFor(() => expect(createButton()).toHaveAttribute('aria-describedby'));
      const button = createButton();
      expect(button).not.toHaveAttribute('aria-disabled', 'true');
      const description = document.getElementById(button.getAttribute('aria-describedby') as string);
      expect(description).toHaveTextContent('Jira refused this issue:');
      expect(description).toHaveTextContent('Component/s is required.');
      // Raw: shown as Jira wrote it, as text.
      expect(description).toHaveTextContent('Sprint: <b>closed</b>');
      expect(screen.getByRole('status')).toHaveTextContent('Jira refused this issue:');
      expect(onCreated).not.toHaveBeenCalled();
    });

    // The server answers `refused` with `reason: 'no_text'` for an action
    // whose summary comes out empty (its copy on the team record has no
    // text), and sends nothing to Jira. "Jira refused this issue." would send
    // the facilitator to Jira for a reason Jira never gave.
    it.each([
      ['no message at all', undefined],
      ['an empty list', []],
      ['only blank messages', ['', '   ']]
    ])('says the action has no text when the server refused it for that, with %s', async (_, jiraMessages) => {
      installJiraFetch({
        '/jira/issues': () => issuesAnswer([
          { actionId: 'a1', status: 'refused', reason: 'no_text', ...(jiraMessages ? { jiraMessages } : {}) }
        ])
      });
      renderControl();
      fireEvent.click(createButton());

      const sentence = 'This action has no text, so it cannot be created in Jira.';
      await waitFor(() => expect(createButton()).toHaveAccessibleDescription(sentence));
      expect(screen.getByRole('status')).toHaveTextContent(sentence);
      expect(screen.getByRole('status')).not.toHaveTextContent('Jira refused');
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });

    // Jira refused with no words: a gateway's page, an empty `errors` object.
    // The action has text; saying it has none would be false.
    it.each([
      ['no message at all', undefined],
      ['an empty list', []],
      ['only blank messages', ['', '   ']]
    ])('says Jira refused it in a sentence of its own when Jira gave %s', async (_, jiraMessages) => {
      installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'refused', ...(jiraMessages ? { jiraMessages } : {}) }])
      });
      renderControl();
      fireEvent.click(createButton());

      await waitFor(() => expect(createButton()).toHaveAccessibleDescription('Jira refused this issue.'));
      expect(screen.getByRole('status')).toHaveTextContent('Jira refused this issue.');
      expect(screen.getByRole('status')).not.toHaveTextContent('no text');
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    });

    it('says why when the server skipped the action', async () => {
      installJiraFetch({ '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'in_progress' }]) });
      const onCreated = vi.fn();
      renderControl({ onCreated });
      fireEvent.click(createButton());
      expect(await screen.findByText('This issue is being created from another window right now.')).toBeInTheDocument();
      expect(createButton()).toBeInTheDocument();
      expect(onCreated).not.toHaveBeenCalled();
    });

    it('names a stop and asks the screen to read the status again when the token was refused', async () => {
      installJiraFetch({
        '/jira/issues': () => ok({ results: [], remaining: ['a1'], stopped: 'token_refused' })
      });
      const onStatusStale = vi.fn();
      renderControl({ onStatusStale });
      fireEvent.click(createButton());

      expect(await screen.findByText(/Jira refused the team’s token: replace it in Settings → Jira/)).toBeInTheDocument();
      expect(onStatusStale).toHaveBeenCalled();
    });

    it('translates a route\'s refusal and asks for the status again', async () => {
      installJiraFetch({ '/jira/issues': () => refused(409, 'jira_token_unusable') });
      const onStatusStale = vi.fn();
      renderControl({ onStatusStale });
      fireEvent.click(createButton());

      expect(await screen.findByText(/can no longer be used: enter it again in Settings → Jira/)).toBeInTheDocument();
      expect(onStatusStale).toHaveBeenCalled();
      expect(createButton()).toBeInTheDocument();
    });
  });

  describe('when the status read again turns creation off', () => {
    // The control asked the screen to read the status again; the answer says
    // the team cannot create any more. The button the keyboard is on must not
    // vanish in that commit, taking the keyboard to the page and the message
    // with it: it stays, unavailable and still explained, until the keyboard
    // leaves it (the rule JiraBatchButton follows for its dialog).
    it.each([
      [
        'a route refusal',
        refused(409, 'jira_token_unusable'),
        statusWith({ token: { usable: false } }),
        /can no longer be used: enter it again in Settings → Jira/
      ],
      [
        'a stop of the batch',
        ok({ results: [], remaining: ['a1'], stopped: 'token_refused' }),
        statusWith({ token: { refusedAt: '2026-10-20T09:00:00.000Z' } }),
        /Jira refused the team’s token: replace it in Settings → Jira/
      ]
    ] as [string, RouteAnswer, ReturnType<typeof statusWith>, RegExp][])(
      'keeps the button, the keyboard and the message after %s',
      async (_, answer, next, message) => {
        const routes = installJiraFetch({ '/jira/issues': () => answer });
        render(<RefreshingScreen next={next} />);
        const button = createButton();
        button.focus();
        fireEvent.click(button);

        await waitFor(() => expect(createButton()).toHaveAccessibleDescription(message));
        const kept = createButton();
        expect(kept).toBe(button);
        expect(kept).toHaveFocus();
        expect(kept).toHaveAttribute('aria-disabled', 'true');
        expect(kept).not.toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent(message);

        // Unavailable means unavailable: another click sends nothing.
        fireEvent.click(kept);
        await flush();
        expect(routes.callsTo('/jira/issues')).toHaveLength(1);

        // Once the keyboard moves on, the control follows the status.
        act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus());
        expect(screen.queryByRole('button', { name: /Speed up the build/ })).toBeNull();
      }
    );

    it('keeps the button the keyboard is on when the status turns creation off while it sends', async () => {
      const answer = deferred<RouteAnswer>();
      installJiraFetch({ '/jira/issues': () => answer.promise });
      const { rerender } = renderControl();
      const button = createButton();
      button.focus();
      fireEvent.click(button);
      await screen.findByRole('button', { name: 'Creating…, Speed up the build' });

      // A reconnect read the status meanwhile: the token went.
      rerender(
        <JiraActionControl
          action={action()}
          status={statusWith({ token: { configured: false, usable: false } })}
          teamId="team-1"
          isFacilitator
          sessionId="retro-1"
          kind="retro"
          requestedBy="Ann"
        />
      );
      const sending = screen.getByRole('button', { name: 'Creating…, Speed up the build' });
      expect(sending).toBe(button);
      expect(sending).toHaveFocus();

      // The request ran anyway: its issue is shown, and the keyboard goes to it.
      await act(async () => {
        answer.resolve(issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-12' }]));
      });
      await waitFor(() => expect(screen.getByRole('link', { name: /^TEAM-12/ })).toHaveFocus());
    });

    it('keeps the button the keyboard is on when the facilitator role moves while it sends', async () => {
      const answer = deferred<RouteAnswer>();
      installJiraFetch({ '/jira/issues': () => answer.promise });
      const { rerender } = renderControl();
      const button = createButton();
      button.focus();
      fireEvent.click(button);
      await screen.findByRole('button', { name: 'Creating…, Speed up the build' });

      rerender(
        <JiraActionControl action={action()} status={statusWith()} teamId="team-1" isFacilitator={false} kind="retro" requestedBy="Ann" />
      );
      expect(screen.getByRole('button', { name: 'Creating…, Speed up the build' })).toHaveFocus();

      // A refusal now leaves the button inert and explained, for as long as the keyboard stays.
      await act(async () => {
        answer.resolve(issuesAnswer([{ actionId: 'a1', status: 'refused', jiraMessages: ['Component/s is required.'] }]));
      });
      const kept = createButton();
      expect(kept).toHaveFocus();
      expect(kept).toHaveAttribute('aria-disabled', 'true');
      expect(kept).toHaveAccessibleDescription(/Component\/s is required\./);

      act(() => kept.blur());
      expect(screen.queryByRole('button')).toBeNull();
    });

    it('lets the control go at once when the keyboard was not on it', async () => {
      installJiraFetch({ '/jira/issues': () => refused(409, 'jira_token_unusable') });
      render(<RefreshingScreen next={statusWith({ token: { usable: false } })} />);
      const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
      fireEvent.click(createButton());
      elsewhere.focus();

      await waitFor(() => expect(screen.queryByRole('button', { name: /Speed up the build/ })).toBeNull());
      expect(elsewhere).toHaveFocus();
    });
  });

  describe('uncertain', () => {
    it('never re-sends a request whose answer was lost, and marks the action as possibly created', async () => {
      const routes = installJiraFetch({
        '/jira/issues': () => ({ status: 504, html: '<html>Gateway Timeout</html>' })
      });
      // The action may have an issue now: the screen re-reads what landed.
      const onCreated = vi.fn();
      renderControl({ onCreated });
      const button = createButton();
      button.focus();
      fireEvent.click(button);

      expect(await screen.findByText('May already be in Jira')).toBeInTheDocument();
      expect(screen.getByText(/The answer from the server was lost/)).toBeInTheDocument();
      expect(routes.callsTo('/jira/issues')).toHaveLength(1);
      expect(onCreated).toHaveBeenCalledTimes(1);
      // The button it replaced is gone; the keyboard lands on what replaced it.
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create anyway, Speed up the build' })).toHaveFocus());
      // The message is the description of the button that replaced it.
      expect(screen.getByRole('button', { name: 'Create anyway, Speed up the build' }))
        .toHaveAccessibleDescription(/The answer from the server was lost/);
    });

    it('never offers a plain creation again for an action the server marked as possibly created', async () => {
      // After a Jira 5xx the server marks the action and stops the batch.
      installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'uncertain' }], { stopped: 'jira_unavailable' })
      });
      const onCreated = vi.fn();
      renderControl({ onCreated });
      fireEvent.click(createButton());

      expect(await screen.findByText('May already be in Jira')).toBeInTheDocument();
      expect(screen.getByText('May already be in Jira: check it, then create anyway')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Create anyway, Speed up the build' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Create in Jira, Speed up the build' })).toBeNull();
      expect(onCreated).toHaveBeenCalledTimes(1);
    });

    it('offers a search of the target for an action stored as uncertain', () => {
      installJiraFetch({});
      renderControl({ action: action({ jira: { uncertainSince: '2026-10-20T09:00:00.000Z' } }) });

      expect(screen.getByText('May already be in Jira')).toBeInTheDocument();
      const check = screen.getByRole('link', { name: 'Check in Jira, Speed up the build (new tab)' });
      expect(check).toHaveAttribute('target', '_blank');
      expect(check).toHaveAttribute('rel', 'noopener noreferrer');
      expect(check.getAttribute('href')).toMatch(/^https:\/\/jira\.example\.org\/issues\/\?jql=/);
    });

    it('creates anyway only after a confirmation, with force', async () => {
      const routes = installJiraFetch({
        '/jira/issues': () => issuesAnswer([{ actionId: 'a1', status: 'created', key: 'TEAM-20' }])
      });
      renderControl({ action: action({ jira: { uncertainSince: '2026-10-20T09:00:00.000Z' } }) });

      const anyway = screen.getByRole('button', { name: 'Create anyway, Speed up the build' });
      anyway.focus();
      fireEvent.click(anyway);
      expect(routes.calls).toHaveLength(0);

      const confirm = screen.getByRole('button', { name: 'Yes, create it, Speed up the build' });
      await waitFor(() => expect(confirm).toHaveFocus());
      expect(confirm).toHaveAccessibleDescription(/Create another issue for this action\?/);

      // Cancel goes back to where it was, keyboard included.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create anyway, Speed up the build' })).toHaveFocus());
      expect(routes.calls).toHaveLength(0);

      fireEvent.click(screen.getByRole('button', { name: 'Create anyway, Speed up the build' }));
      fireEvent.click(screen.getByRole('button', { name: 'Yes, create it, Speed up the build' }));
      await screen.findByRole('link', { name: /^TEAM-20/ });
      expect(routes.callsTo('/jira/issues')[0].body).toMatchObject({ actionIds: ['a1'], force: true });
    });

    it('shows a participant the doubt, without the controls', () => {
      renderControl({
        isFacilitator: false,
        action: action({ jira: { uncertainSince: '2026-10-20T09:00:00.000Z' } })
      });
      expect(screen.getByText('May already be in Jira')).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
    });
  });
});
