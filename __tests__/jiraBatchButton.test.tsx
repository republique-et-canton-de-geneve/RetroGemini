import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ActionItem, RetroSession, Team } from '../types';
import {
  deferred,
  installJiraFetch,
  ok,
  refused,
  statusWith,
  type RouteAnswer
} from './helpers/jiraClientFetch';

/**
 * "Create in Jira (N)" and its dialog: the target shown and changeable for
 * this one creation (finding U-2), a preview of each issue built by the same
 * shared builder the server uses (U-8), a dialog that cannot be dismissed
 * while it sends (U-4), and a result for every action, with Jira's own words
 * for a refusal. Driven against the real `jiraService` and a fetch answering
 * as `/jira/issues` does (contracts §3).
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

import LanguageProvider from '../i18n/LanguageProvider';
import JiraBatchButton from '../components/jira/JiraBatchButton';
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

const OPEN = [action('a1', 'Speed up the build'), action('a2', 'Write the runbook')];
const OTHERS = [
  action('linked', 'Already there', { jira: { key: 'TEAM-1', createdAt: 'x' } }),
  action('doubt', 'Maybe there', { jira: { uncertainSince: 'x' } }),
  action('closed', 'Done already', { done: true }),
  action('proposal', 'Just an idea', { type: 'proposal' })
];

const retro = {
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: '2026-10-06',
  templateLanguage: 'en',
  actions: [...OPEN, ...OTHERS],
  tickets: [],
  groups: []
} as unknown as RetroSession;

const team = {
  id: 'team-1',
  name: 'Alpha',
  members: [],
  retrospectives: [retro],
  healthChecks: [],
  globalActions: []
} as unknown as Team;

type Props = React.ComponentProps<typeof JiraBatchButton>;
const props = (overrides: Partial<Props> = {}): Props => ({
  actions: [...OPEN, ...OTHERS],
  status: statusWith(),
  teamId: 'team-1',
  isFacilitator: true,
  sessionId: 'retro-1',
  kind: 'retro',
  team,
  session: retro,
  requestedBy: 'Ann',
  ...overrides
});

const openDialog = () => {
  const button = screen.getByRole('button', { name: 'Create in Jira (2)' });
  button.focus();
  fireEvent.click(button);
  return screen.getByRole('dialog', { name: 'Create the actions in Jira' });
};

describe('JiraBatchButton', () => {
  beforeEach(() => {
    jiraInFlight.clear();
    mocks.dataService.applyJiraLinks = vi.fn();
  });

  afterEach(() => {
    jiraInFlight.clear();
    vi.restoreAllMocks();
  });

  describe('the button', () => {
    it('counts the open actions that are not in Jira, not in doubt and not being sent', () => {
      installJiraFetch({});
      const { rerender } = render(<JiraBatchButton {...props()} />);
      expect(screen.getByRole('button', { name: 'Create in Jira (2)' })).toBeInTheDocument();

      act(() => jiraInFlight.add(['a2']));
      rerender(<JiraBatchButton {...props()} />);
      expect(screen.getByRole('button', { name: 'Create in Jira (1)' })).toBeInTheDocument();
    });

    it('is not offered to a participant, on a deployment without Jira, or with nothing to send', () => {
      installJiraFetch({});
      const { container: participant } = render(<JiraBatchButton {...props({ isFacilitator: false })} />);
      expect(participant).toBeEmptyDOMElement();
      const { container: off } = render(<JiraBatchButton {...props({ status: null })} />);
      expect(off).toBeEmptyDOMElement();
      const { container: nothing } = render(<JiraBatchButton {...props({ actions: OTHERS })} />);
      expect(nothing).toBeEmptyDOMElement();
    });

    it('stays reachable but unavailable when creation is impossible, and says why', () => {
      installJiraFetch({});
      render(<JiraBatchButton {...props({ status: statusWith({ token: { configured: false, usable: false } }) })} />);

      const button = screen.getByRole('button', { name: 'Create in Jira (2)' });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).not.toBeDisabled();
      expect(button).toHaveAccessibleDescription(/Jira is not connected for this team: add an access token in Settings → Jira\./);

      fireEvent.click(button);
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  describe('the dialog', () => {
    it('shows the target and exactly what each issue will say', () => {
      installJiraFetch({});
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();

      expect(within(dialog).getByText('In the project TEAM')).toBeInTheDocument();
      expect(within(dialog).getByText('Labels: retrospective')).toBeInTheDocument();
      const preview = within(dialog).getByRole('list', { name: 'What will be sent to Jira' });
      const items = within(preview).getAllByRole('listitem');
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent('Speed up the build');
      // As Jira shows it: the wiki escapes the builder adds (`2026\-10\-06`) are
      // what make Jira render the characters themselves.
      expect(items[0]).toHaveTextContent('Action from the retrospective Sprint 12 (2026-10-06). Requested in RetroGemini as Ann.');
      expect(items[0]).not.toHaveTextContent('\\');
      expect(within(dialog).getByRole('button', { name: 'Create 2 issues' })).toBeInTheDocument();
    });

    // The server builds an issue from the session the request names
    // (`issueSource`); the preview must read the same one, or the dialog shows
    // one retro while Jira receives another.
    it('previews an action two retros hold from the session the request names', () => {
      installJiraFetch({});
      const earlier = { ...retro, id: 'retro-0', name: 'Sprint 10', date: '2026-09-08', actions: [...OPEN] } as unknown as RetroSession;
      const named = { ...retro, id: 'retro-2', name: 'Sprint 11', date: '2026-09-22', actions: [...OPEN] } as unknown as RetroSession;
      const twoHomes = { ...team, retrospectives: [earlier, named] } as unknown as Team;
      render(<JiraBatchButton {...props({ team: twoHomes, session: named, sessionId: 'retro-2', actions: [...OPEN] })} />);
      const dialog = openDialog();

      const items = within(within(dialog).getByRole('list', { name: 'What will be sent to Jira' })).getAllByRole('listitem');
      expect(items[0]).toHaveTextContent('Action from the retrospective Sprint 11 (2026-09-22). Requested in RetroGemini as Ann.');
      expect(items[0]).not.toHaveTextContent('Sprint 10');
    });

    // The cached team a screen was handed can be older than its live session:
    // a renamed retro, an action added since. The server reads the record once
    // the screen's writes landed, which holds the live session.
    it('previews from the live session, not from the cached team', () => {
      installJiraFetch({});
      const added = action('a3', 'Book the demo room');
      const live = { ...retro, name: 'Sprint 12 bis', actions: [...retro.actions, added] } as unknown as RetroSession;
      render(<JiraBatchButton {...props({ session: live, actions: [...OPEN, added] })} />);
      const button = screen.getByRole('button', { name: 'Create in Jira (3)' });
      fireEvent.click(button);
      const dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });

      const items = within(within(dialog).getByRole('list', { name: 'What will be sent to Jira' })).getAllByRole('listitem');
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent('Action from the retrospective Sprint 12 bis (2026-10-06).');
      expect(items[2]).toHaveTextContent('Book the demo room');
      expect(items[2]).toHaveTextContent('Action from the retrospective Sprint 12 bis (2026-10-06).');
      expect(items[2]).not.toHaveTextContent('team backlog');
    });

    it('cancels without sending anything, giving the keyboard back to the button', async () => {
      const routes = installJiraFetch({});
      render(<JiraBatchButton {...props()} />);
      openDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      // Nothing is created or saved. The only read is the stored target's
      // issue type, which the dialog names.
      expect(routes.calls.filter(call => !call.path.endsWith('/jira/issue-types'))).toHaveLength(0);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create in Jira (2)' })).toHaveFocus());
    });

    it('cannot be dismissed while it sends, holds the actions, and reports the results', async () => {
      const answer = deferred<RouteAnswer>();
      const routes = installJiraFetch({ '/jira/issues': () => answer.promise });
      const onDone = vi.fn();
      const onStatusStale = vi.fn();
      const { rerender } = render(<JiraBatchButton {...props({ onDone, onStatusStale })} />);
      const dialog = openDialog();
      // Mounted when the dialog opens, filled at the end.
      const region = within(dialog).getByRole('status');
      expect(region).toHaveTextContent('');

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled());
      expect(jiraInFlight.has('a1')).toBe(true);
      expect(jiraInFlight.has('a2')).toBe(true);
      expect(within(dialog).getByText('Creating: 0 of 2 sent…')).toBeInTheDocument();
      // Announced, not only shown: Escape and Cancel are off for the whole
      // request, and a screen-reader user would otherwise hear nothing until
      // Close takes the keyboard.
      expect(region).toHaveTextContent('Creating: 0 of 2 sent…');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // The confirm button only looks unavailable: a second click reaches it,
      // and must not send the same actions again.
      const sending = within(dialog).getByRole('button', { name: 'Creating…' });
      expect(sending).toHaveAttribute('aria-disabled', 'true');
      expect(sending).not.toBeDisabled();
      fireEvent.click(sending);

      await act(async () => {
        answer.resolve(ok({
          results: [
            { actionId: 'a1', status: 'created', key: 'TEAM-12' },
            { actionId: 'a2', status: 'created', key: 'TEAM-13' }
          ],
          remaining: []
        }));
      });

      expect(await within(dialog).findByText('2 issues created')).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: 'TEAM-12, open in Jira (new tab)' })).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: 'TEAM-13, open in Jira (new tab)' })).toBeInTheDocument();
      expect(region).toHaveTextContent('2 issues created');
      expect(jiraInFlight.has('a1')).toBe(false);
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ results: expect.any(Array) }));

      expect(routes.callsTo('/jira/issues')).toHaveLength(1);
      const [call] = routes.callsTo('/jira/issues');
      expect(call.body).toMatchObject({ actionIds: ['a1', 'a2'], sessionId: 'retro-1', requestedBy: 'Ann', language: 'en' });
      // The target the dialog showed, not whatever the team has stored by now.
      expect(call.body.target).toEqual(statusWith().target);
      // Nothing in this answer says the status the screen holds is out of date.
      expect(onStatusStale).not.toHaveBeenCalled();

      // The confirm button is gone: the keyboard goes to Close.
      const close = within(dialog).getByRole('button', { name: 'Close' });
      await waitFor(() => expect(close).toHaveFocus());

      // The screen refreshes with the links; the button stays for the focus to return to.
      const linked = OPEN.map((a, i) => ({ ...a, jira: { key: `TEAM-${12 + i}`, createdAt: 'x' } }));
      rerender(<JiraBatchButton {...props({ onDone, actions: [...linked, ...OTHERS] })} />);
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      const button = screen.getByRole('button', { name: 'Create in Jira (0)' });
      await waitFor(() => expect(button).toHaveFocus());
      expect(button).toHaveAttribute('aria-disabled', 'true');
    });

    it('lists every outcome: created, refused with Jira\'s words, in doubt, and not sent with the reason', async () => {
      const four = [...OPEN, action('a3', 'Fix the flaky test'), action('a4', 'Book the room')];
      installJiraFetch({
        '/jira/issues': () => ok({
          results: [
            { actionId: 'a1', status: 'created', key: 'TEAM-12' },
            { actionId: 'a2', status: 'refused', jiraMessages: ['Component/s is required.'] },
            { actionId: 'a3', status: 'uncertain' }
          ],
          remaining: ['a4'],
          stopped: 'jira_rate_limited',
          retryAfterSeconds: 30
        })
      });
      render(<JiraBatchButton {...props({ actions: four })} />);
      fireEvent.click(screen.getByRole('button', { name: 'Create in Jira (4)' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 4 issues' }));

      expect(await within(dialog).findByText('1 issue created')).toBeInTheDocument();
      expect(within(dialog).getByText('1 refused by Jira')).toBeInTheDocument();
      expect(within(dialog).getByText('Component/s is required.')).toBeInTheDocument();
      expect(within(dialog).getByText('1 may already be in Jira: check it before creating it again')).toBeInTheDocument();
      expect(within(dialog).getByText('1 not sent')).toBeInTheDocument();
      expect(within(dialog).getByText('Jira asks to wait 30 seconds before creating more issues.')).toBeInTheDocument();
      // The status region sums it up for a screen reader.
      expect(within(dialog).getByRole('status')).toHaveTextContent('1 issue created');
      expect(within(dialog).getByRole('status')).toHaveTextContent('1 refused by Jira');
    });

    // A refusal of a field the target sets stops the batch after one action
    // (jiraIssues.js): the dialog says why the others were not sent, and, for
    // labels a project does not accept, where to remove them (plan J-5).
    it('says the target was refused, where to fix it, and that the rest were not sent', async () => {
      const message = "Field 'labels' cannot be set. It is not on the appropriate screen, or unknown.";
      installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: [], projectKey: 'TEAM' }),
        '/jira/issues': () => ok({
          results: [{ actionId: 'a1', status: 'refused', jiraMessages: [message], jiraFields: ['labels'] }],
          remaining: ['a2'],
          stopped: 'jira_target_refused'
        })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      expect(await within(dialog).findByText('1 refused by Jira')).toBeInTheDocument();
      expect(within(dialog).getByText(message)).toBeInTheDocument();
      expect(within(dialog).getAllByText('Jira does not accept labels for this project: remove them in Settings → Jira, then try again.')).toHaveLength(1);
      expect(within(dialog).getByText('1 not sent')).toBeInTheDocument();
      expect(within(dialog).getByText(
        'Jira refused the target set in Settings → Jira, so the other actions were not sent: check its project, issue type and labels.'
      )).toBeInTheDocument();
    });

    it('says which actions have no text instead of reporting them refused by Jira', async () => {
      // The server refuses an action whose copy on the team record has no
      // text (a stale screen still shows the old one) with `no_text` and no
      // Jira message.
      installJiraFetch({
        '/jira/issues': () => ok({
          results: [
            { actionId: 'a1', status: 'refused', reason: 'no_text', jiraMessages: [] },
            { actionId: 'a2', status: 'created', key: 'TEAM-12' }
          ],
          remaining: []
        })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      const line = '1 action has no text, so it cannot be created in Jira';
      expect(await within(dialog).findByText(line)).toBeInTheDocument();
      expect(within(dialog).queryByText(/refused by Jira/)).toBeNull();
      expect(within(dialog).queryByText(/Jira refused/)).toBeNull();
      expect(within(dialog).getByRole('status')).toHaveTextContent(`${line}.`);
      expect(within(dialog).getByRole('status')).not.toHaveTextContent('refused');
    });

    // A gateway in front of Jira answers a 4xx with a page, or Jira a 4xx
    // with an empty `errors` object: Jira refused an action that has text,
    // without words. "Has no text" would be false and send nobody anywhere.
    it('reports a refusal Jira gave without words as refused by Jira, never as an action with no text', async () => {
      installJiraFetch({
        '/jira/issues': () => ok({
          results: [
            { actionId: 'a1', status: 'refused', jiraMessages: [] },
            { actionId: 'a2', status: 'created', key: 'TEAM-12' }
          ],
          remaining: []
        })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      expect(await within(dialog).findByText('1 refused by Jira')).toBeInTheDocument();
      expect(within(dialog).getByText(/Jira refused this issue\./)).toBeInTheDocument();
      expect(within(dialog).queryByText(/no text/)).toBeNull();
      expect(within(dialog).getByRole('status')).toHaveTextContent('1 refused by Jira');
      expect(within(dialog).getByRole('status')).not.toHaveTextContent('no text');
    });

    // The dialog names each no-text action by the text this screen shows. One
    // whose text is blank on screen too has nothing to name, and an empty
    // bullet would be read out as an empty item. Through the button this
    // cannot happen (it offers no action without text), so the dialog is
    // rendered on its own.
    it('names no action with no text when the screen shows none either', async () => {
      installJiraFetch({
        '/jira/issues': () => ok({ results: [{ actionId: 'blank', status: 'refused', reason: 'no_text', jiraMessages: [] }], remaining: [] })
      });
      const blank = action('blank', '   ');
      render(
        <JiraBatchDialog
          actions={[blank]}
          status={statusWith()}
          teamId="team-1"
          sessionId="retro-1"
          kind="retro"
          team={team}
          session={{ ...retro, actions: [blank] }}
          requestedBy="Ann"
          onClose={() => {}}
        />
      );
      const dialog = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 1 issue' }));

      const line = await within(dialog).findByText('1 action has no text, so it cannot be created in Jira');
      const group = line.closest('li') as HTMLElement;
      expect(group).not.toBeNull();
      expect(within(group).queryAllByRole('listitem')).toHaveLength(0);
      expect(within(group).queryByRole('list')).toBeNull();
    });

    it('says the outcome is unknown when the answer was lost, and sends nothing again', async () => {
      const routes = installJiraFetch({ '/jira/issues': () => ({ status: 502, html: '<html>Bad Gateway</html>' }) });
      const onDone = vi.fn();
      render(<JiraBatchButton {...props({ onDone })} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      expect(await within(dialog).findByText(/The answer from the server was lost/)).toBeInTheDocument();
      expect(within(dialog).getByText('2 outcomes unknown: check Jira before retrying')).toBeInTheDocument();
      expect(routes.callsTo('/jira/issues')).toHaveLength(1);
      // Some may exist now: the screen reads what landed (finding A-6).
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ stopped: 'outcome_unknown', unknown: ['a1', 'a2'] }));
    });

    it('shows a route\'s refusal in the reader\'s words, and asks for the status again', async () => {
      installJiraFetch({ '/jira/issues': () => refused(400, 'jira_target_missing') });
      const onStatusStale = vi.fn();
      const onDone = vi.fn();
      render(<JiraBatchButton {...props({ onStatusStale, onDone })} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      expect(await within(dialog).findByText('Choose where the issues are created in Settings → Jira first.')).toBeInTheDocument();
      expect(within(dialog).getByText('2 not sent')).toBeInTheDocument();
      // The reason line takes over once the screen has read the status again (finding U-1).
      expect(onStatusStale).toHaveBeenCalledTimes(1);
      // A refusal is an outcome too: the screen refreshes either way.
      expect(onDone).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ results: [], notSent: ['a1', 'a2'] }));
    });

    it('keeps what a first request created when the route refuses the next one', async () => {
      // Twelve actions go in two requests; between them the team's token
      // stopped decrypting (another tab replaced it, the address changed).
      const twelve = Array.from({ length: 12 }, (_, i) => action(`b${i + 1}`, `Action ${i + 1}`));
      let calls = 0;
      installJiraFetch({
        '/jira/issues': (body) => {
          calls += 1;
          if (calls > 1) return refused(409, 'jira_token_unusable');
          const ids = body.actionIds as string[];
          return ok({ results: ids.map((id, i) => ({ actionId: id, status: 'created', key: `TEAM-${i + 1}` })), remaining: [] });
        }
      });
      const onStatusStale = vi.fn();
      const onDone = vi.fn();
      render(<JiraBatchButton {...props({ actions: twelve, onStatusStale, onDone })} />);
      fireEvent.click(screen.getByRole('button', { name: 'Create in Jira (12)' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 12 issues' }));

      expect(await within(dialog).findByText('10 issues created')).toBeInTheDocument();
      expect(within(dialog).getAllByRole('link', { name: /^TEAM-\d+, open in Jira/ })).toHaveLength(10);
      expect(within(dialog).getByRole('link', { name: 'TEAM-10, open in Jira (new tab)' })).toBeInTheDocument();
      expect(within(dialog).getByText('2 not sent')).toBeInTheDocument();
      expect(within(dialog).getByText(/can no longer be used: enter it again in Settings → Jira/)).toBeInTheDocument();
      expect(within(dialog).getByRole('status')).toHaveTextContent('10 issues created');
      expect(onStatusStale).toHaveBeenCalledTimes(1);
      expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ notSent: ['b11', 'b12'] }));
    });

    it('asks for the status again when Jira refused the team\'s token mid-batch', async () => {
      installJiraFetch({ '/jira/issues': () => ok({ results: [], remaining: ['a1', 'a2'], stopped: 'token_refused' }) });
      const onStatusStale = vi.fn();
      render(<JiraBatchButton {...props({ onStatusStale })} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      expect(await within(dialog).findByText('2 not sent')).toBeInTheDocument();
      expect(within(dialog).getByText(/Jira refused the team’s token: replace it in Settings → Jira/)).toBeInTheDocument();
      expect(onStatusStale).toHaveBeenCalledTimes(1);
    });

    it('reports actions already in Jira and skipped ones apart from the issues created', async () => {
      installJiraFetch({
        '/jira/issues': () => ok({
          results: [
            { actionId: 'a1', status: 'already_linked', key: 'TEAM-4' },
            { actionId: 'a2', status: 'closed' }
          ],
          remaining: []
        })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      expect(await within(dialog).findByText('1 action was already in Jira')).toBeInTheDocument();
      expect(within(dialog).getByRole('link', { name: 'TEAM-4, open in Jira (new tab)' })).toBeInTheDocument();
      expect(within(dialog).getByText('1 skipped: closed, not saved yet or being created elsewhere')).toBeInTheDocument();
      expect(within(dialog).queryByText(/issues? created/)).toBeNull();
      expect(within(dialog).queryByText(/may already be in Jira/)).toBeNull();
    });

    it('says how many were sent as each request comes back', async () => {
      const twelve = Array.from({ length: 12 }, (_, i) => action(`b${i + 1}`, `Action ${i + 1}`));
      const second = deferred<RouteAnswer>();
      let calls = 0;
      const routes = installJiraFetch({
        '/jira/issues': (body) => {
          calls += 1;
          if (calls > 1) return second.promise;
          const ids = body.actionIds as string[];
          return ok({ results: ids.map((id, i) => ({ actionId: id, status: 'created', key: `TEAM-${i + 1}` })), remaining: [] });
        }
      });
      render(<JiraBatchButton {...props({ actions: twelve })} />);
      fireEvent.click(screen.getByRole('button', { name: 'Create in Jira (12)' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 12 issues' }));

      expect(await within(dialog).findByText('Creating: 10 of 12 sent…')).toBeInTheDocument();
      expect(within(dialog).getByRole('status')).toHaveTextContent('Creating: 10 of 12 sent…');
      expect(routes.callsTo('/jira/issues')[1].body.actionIds).toEqual(['b11', 'b12']);

      await act(async () => {
        second.resolve(ok({
          results: [
            { actionId: 'b11', status: 'created', key: 'TEAM-11' },
            { actionId: 'b12', status: 'created', key: 'TEAM-12' }
          ],
          remaining: []
        }));
      });
      expect(await within(dialog).findByText('12 issues created')).toBeInTheDocument();
    });

    it('sends no session for backlog actions', async () => {
      const routes = installJiraFetch({ '/jira/issues': () => ok({ results: [], remaining: [] }) });
      render(<JiraBatchButton {...props({ kind: 'backlog', sessionId: 'ignored', session: undefined })} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      expect(routes.callsTo('/jira/issues')[0].body).not.toHaveProperty('sessionId');
    });

    it('keeps its results on screen when Jira is turned off meanwhile, and gives the keyboard back', async () => {
      installJiraFetch({ '/jira/issues': () => refused(409, 'jira_not_configured') });
      const onStatusStale = vi.fn();
      const onDone = vi.fn();
      const { container, rerender } = render(<JiraBatchButton {...props({ onStatusStale, onDone })} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      const refusal = 'Jira is not set up on this server. Ask your administrator to turn it on.';
      expect(await within(dialog).findByText(refusal)).toBeInTheDocument();
      expect(onStatusStale).toHaveBeenCalled();
      expect(onDone).toHaveBeenCalledTimes(1);

      // The screen read the status again, as asked: Jira is off now.
      rerender(<JiraBatchButton {...props({ onStatusStale, onDone, status: statusWith({ enabled: false }) })} />);
      const still = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      expect(within(still).getByText(refusal)).toBeInTheDocument();
      expect(within(still).getByText('2 not sent')).toBeInTheDocument();

      fireEvent.click(within(still).getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('dialog')).toBeNull();
      const button = screen.getByRole('button', { name: 'Create in Jira (2)' });
      await waitFor(() => expect(button).toHaveFocus());
      expect(button).toHaveAttribute('aria-disabled', 'true');
      fireEvent.click(button);
      expect(screen.queryByRole('dialog')).toBeNull();

      // Once the keyboard moves on, nothing is left of Jira on this screen.
      act(() => button.blur());
      expect(container).toBeEmptyDOMElement();
    });

    it('leaves nothing behind once closed when the keyboard was not on the button', async () => {
      installJiraFetch({ '/jira/issues': () => refused(409, 'jira_not_configured') });
      const { container, rerender } = render(<JiraBatchButton {...props()} />);
      // A pointer click that focuses nothing (Safari): the dialog has no opener to return to.
      fireEvent.click(screen.getByRole('button', { name: 'Create in Jira (2)' }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      expect(await within(dialog).findByText('2 not sent')).toBeInTheDocument();

      rerender(<JiraBatchButton {...props({ status: statusWith({ enabled: false }) })} />);
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(container).toBeEmptyDOMElement());
    });

    it('keeps its results on screen when the facilitator role moves to someone else while it sends', async () => {
      const answer = deferred<RouteAnswer>();
      installJiraFetch({ '/jira/issues': () => answer.promise });
      const { rerender } = render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled());

      rerender(<JiraBatchButton {...props({ isFacilitator: false })} />);
      await act(async () => {
        answer.resolve(ok({
          results: [
            { actionId: 'a1', status: 'created', key: 'TEAM-12' },
            { actionId: 'a2', status: 'created', key: 'TEAM-13' }
          ],
          remaining: []
        }));
      });

      const still = screen.getByRole('dialog', { name: 'Create the actions in Jira' });
      expect(await within(still).findByText('2 issues created')).toBeInTheDocument();
      fireEvent.click(within(still).getByRole('button', { name: 'Close' }));
      await waitFor(() => expect(screen.getByRole('button', { name: /^Create in Jira/ })).toHaveFocus());
    });
  });

  describe('the one-time target', () => {
    const TYPES = [{ id: '10001', name: 'Task', subtask: false }, { id: '20001', name: 'Bug', subtask: false }];

    it('sends a changed target with this creation only, never saving it', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'OTHER' }),
        '/jira/issues': () => ok({ results: [], remaining: [] })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Change the target for this creation only' }));
      const key = within(dialog).getByLabelText('Project key');
      expect(key).toHaveValue('TEAM');
      fireEvent.change(key, { target: { value: 'OTHER' } });
      fireEvent.blur(key);
      await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Bug' })).toBeInTheDocument());
      fireEvent.change(within(dialog).getByLabelText('Issue type'), { target: { value: '20001' } });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      expect(routes.callsTo('/jira/issues')[0].body.target).toEqual({
        mode: 'project',
        projectKey: 'OTHER',
        issueTypeId: '20001',
        labels: ['retrospective']
      });
      expect(routes.callsTo('/jira/target')).toHaveLength(0);
    });

    it('sends the target the fields show when they still hold the stored one', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }),
        '/jira/issues': () => ok({ results: [], remaining: [] })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Change the target for this creation only' }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));

      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
      expect(routes.callsTo('/jira/issues')[0].body.target).toEqual(statusWith().target);
      expect(routes.callsTo('/jira/target')).toHaveLength(0);
    });

    // Any team session may edit Settings → Jira (decision D1). A teammate who
    // moves the stored target after this screen read the status must not have
    // the facilitator's confirmed issues created somewhere the dialog never
    // showed, and a batch longer than one request must not land in two places.
    it('sends the target it shows with every request, whatever is stored meanwhile', async () => {
      const eleven = Array.from({ length: 11 }, (_, i) => action(`c${i + 1}`, `Action ${i + 1}`));
      const routes = installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }),
        // Stands for a route whose stored target is OTHER-1 by now: a request
        // without a target would be created there.
        '/jira/issues': (body) => ok({
          results: (body.actionIds as string[]).map((id, i) => ({ actionId: id, status: 'created', key: `TEAM-${i + 1}` })),
          remaining: []
        })
      });
      render(<JiraBatchButton {...props({ actions: eleven })} />);
      fireEvent.click(screen.getByRole('button', { name: 'Create in Jira (11)' }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('In the project TEAM')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 11 issues' }));

      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(2));
      for (const call of routes.callsTo('/jira/issues')) expect(call.body.target).toEqual(statusWith().target);
    });

    // While it sends, the target is already in the request: a control that
    // says it is unavailable must not open the fields, read Jira, or take an
    // edit that nothing will use.
    it('opens nothing and reads nothing from the target toggle while it sends', async () => {
      const answer = deferred<RouteAnswer>();
      const routes = installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }),
        '/jira/issues': () => answer.promise
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      const toggle = within(dialog).getByRole('button', { name: 'Change the target for this creation only' });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled());
      await waitFor(() => expect(routes.callsTo('/jira/issue-types')).toHaveLength(1));

      expect(toggle).toHaveAttribute('aria-disabled', 'true');
      toggle.focus();
      // Enter or Space on a button is a click; `pointer-events: none` stops only the pointer.
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(within(dialog).queryByLabelText('Project key')).toBeNull();
      expect(routes.callsTo('/jira/issue-types')).toHaveLength(1);

      await act(async () => { answer.resolve(ok({ results: [], remaining: [] })); });
    });

    it('locks the open target fields while it sends', async () => {
      const answer = deferred<RouteAnswer>();
      installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }),
        '/jira/issues': () => answer.promise
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Change the target for this creation only' }));
      const key = within(dialog).getByLabelText('Project key');
      expect(key).not.toBeDisabled();

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled());
      expect(key).toBeDisabled();
      expect(within(dialog).getByLabelText('Issue type')).toBeDisabled();
      expect(within(dialog).getByLabelText('Labels')).toBeDisabled();

      await act(async () => { answer.resolve(ok({ results: [], remaining: [] })); });
    });

    it('refuses an incomplete target before sending', () => {
      const routes = installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'TEAM' }) });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      fireEvent.click(within(dialog).getByRole('button', { name: 'Change the target for this creation only' }));
      fireEvent.change(within(dialog).getByLabelText('Project key'), { target: { value: 'X' } });

      fireEvent.click(within(dialog).getByRole('button', { name: 'Create 2 issues' }));
      expect(within(dialog).getByText(/This Jira target is not valid/)).toBeInTheDocument();
      expect(routes.callsTo('/jira/issues')).toHaveLength(0);
    });
  });

  // The type is part of the stored target, possibly set by someone else: a
  // facilitator confirming ten issues must see whether they will be Tasks or
  // Bugs, since RetroGemini cannot undo them.
  describe('the stored target\'s issue type', () => {
    it('is named, read from Jira when the dialog opens', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: [{ id: '20001', name: 'Bug', subtask: false }, { id: '10001', name: 'Task', subtask: false }], projectKey: 'TEAM' })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();

      expect(await within(dialog).findByText('Issue type: Task')).toBeInTheDocument();
      expect(routes.callsTo('/jira/issue-types')).toHaveLength(1);
      expect(routes.callsTo('/jira/issue-types')[0].body).toMatchObject({ projectKey: 'TEAM' });
    });

    it('is read from the parent issue for sub-tasks', async () => {
      const routes = installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: [{ id: '30001', name: 'Sub-task', subtask: true }], projectKey: 'TEAM' })
      });
      const status = statusWith({ target: { mode: 'parent', parentKey: 'TEAM-7', issueTypeId: '30001', labels: [] } });
      render(<JiraBatchButton {...props({ status })} />);
      const dialog = openDialog();

      expect(await within(dialog).findByText('Issue type: Sub-task')).toBeInTheDocument();
      expect(routes.callsTo('/jira/issue-types')[0].body).toMatchObject({ parentKey: 'TEAM-7' });
      expect(routes.callsTo('/jira/issue-types')[0].body).not.toHaveProperty('projectKey');
    });

    it('is named by its id while Jira answers or when it cannot, and never holds the creation back', async () => {
      const read = deferred<RouteAnswer>();
      const routes = installJiraFetch({
        '/jira/issue-types': () => read.promise,
        '/jira/issues': () => ok({ results: [], remaining: [] })
      });
      render(<JiraBatchButton {...props()} />);
      const dialog = openDialog();
      expect(within(dialog).getByText('Issue type: 10001')).toBeInTheDocument();
      const create = within(dialog).getByRole('button', { name: 'Create 2 issues' });
      expect(create).not.toHaveAttribute('aria-disabled');

      await act(async () => { read.resolve(refused(502, 'jira_unavailable')); });
      expect(within(dialog).getByText('Issue type: 10001')).toBeInTheDocument();
      expect(within(dialog).queryByRole('alert')).toBeNull();

      fireEvent.click(create);
      await waitFor(() => expect(routes.callsTo('/jira/issues')).toHaveLength(1));
    });

    it('is named in French with the French typography', async () => {
      installJiraFetch({
        '/jira/issue-types': () => ok({ issueTypes: [{ id: '10001', name: 'Tâche', subtask: false }], projectKey: 'TEAM' })
      });
      render(<LanguageProvider initialLanguage="fr"><JiraBatchButton {...props()} /></LanguageProvider>);
      fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira (2)' }));
      const dialog = screen.getByRole('dialog');

      // `getByText` reads a no-break space as a space; the text itself keeps it.
      const line = await within(dialog).findByText('Type de ticket : Tâche');
      expect(line.textContent).toBe('Type de ticket\u00a0: Tâche');
    });
  });
});
