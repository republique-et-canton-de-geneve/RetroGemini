import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamFeedback from '../components/TeamFeedback';
import { clearSessionRevoked, registerRevocationResolver } from '../services/sessionRevocation';

/**
 * Decision D3b — another tab of the browser changed the team password. This
 * tab's board still holds the token from before, handed down as a prop, and
 * the server refuses it as revoked; the client then adopts the other tab's
 * newer token (the resolver's 'retry'). The board used to ignore that answer:
 * the list stayed empty, a comment or a deletion failed with nothing on
 * screen, though the tab was still signed in with a valid token. Each request
 * now reads the token the client holds when it is sent, and is sent once more
 * after a 'retry' — once, never in a loop.
 */

const feedback = {
  id: 'feedback-a',
  teamId: 'team-1',
  teamName: 'Team One',
  type: 'bug',
  title: 'Alpha report',
  description: 'The first feedback',
  submittedBy: 'user-1',
  submittedByName: 'User One',
  submittedAt: '2026-08-01T10:00:00.000Z',
  isRead: false,
  status: 'pending',
  comments: []
};

const OLD = 'rg1.old-token';
const NEW = 'rg1.adopted-token';

type Call = { url: string; sessionToken: unknown };
let calls: Call[] = [];
// The token the client holds; the prop keeps the old one, as a render that has
// not happened yet would.
let held = OLD;
let refuse: (call: Call) => boolean = () => false;

const json = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, clone() { return this; } }) as unknown as Response;

const renderBoard = () =>
  render(
    <TeamFeedback
      teamId="team-1"
      teamName="Team One"
      teamPassword=""
      sessionToken={OLD}
      getSessionToken={() => held}
      currentUserId="user-1"
      currentUserName="User One"
      onSubmitFeedback={vi.fn()}
      onRefresh={vi.fn()}
    />
  );

const posts = (path: string) => calls.filter((call) => call.url === path);

describe('the feedback board after a password change in another tab', () => {
  beforeEach(() => {
    calls = [];
    held = OLD;
    refuse = (call) => call.sessionToken === OLD;
    clearSessionRevoked();
    // What dataService answers once it adopted the other tab's token.
    registerRevocationResolver(async () => {
      held = NEW;
      return 'retry';
    });
    globalThis.fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      const call = { url: String(url), sessionToken: JSON.parse(String(init?.body ?? '{}')).sessionToken };
      calls.push(call);
      if (refuse(call)) return json(401, { error: 'session_revoked' });
      if (call.url === '/api/feedbacks/all') return json(200, { feedbacks: [feedback] });
      return json(200, { success: true });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    clearSessionRevoked();
    vi.restoreAllMocks();
  });

  it('loads the board again with the token held now', async () => {
    renderBoard();

    expect(await screen.findByText('Alpha report')).toBeTruthy();
    expect(posts('/api/feedbacks/all').map((call) => call.sessionToken)).toEqual([OLD, NEW]);
  });

  it('loads it at most twice when the token held now is refused too', async () => {
    refuse = () => true;
    renderBoard();

    await waitFor(() => expect(posts('/api/feedbacks/all')).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts('/api/feedbacks/all')).toHaveLength(2);
  });

  it('posts a comment again with the token held now, and clears its draft once stored', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Alpha report');
    // The board loaded with the new token: from here only a comment sent with
    // the old one is refused, as from a render still holding it.
    held = OLD;
    const card = screen.getByText('Alpha report').closest('div[class*="bg-white"]') as HTMLElement;
    await user.click(within(card).getByRole('button', { name: /Comments/ }));
    await user.type(within(card).getByPlaceholderText('Add a comment...'), 'Seen it too');
    await user.click(within(card).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(posts('/api/feedbacks/comment').map((call) => call.sessionToken)).toEqual([OLD, NEW]));
    await waitFor(() => expect((within(card).getByPlaceholderText('Add a comment...') as HTMLInputElement).value).toBe(''));
  });
});
