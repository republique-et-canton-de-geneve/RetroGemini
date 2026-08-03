import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamFeedback from '../components/TeamFeedback';

/**
 * Raised by the Codex reviewer on PR #404. The comment composer used a single
 * component-wide `newComment` string, rendered in whichever feedback card
 * happened to be expanded. Typing on one feedback and then opening another
 * therefore showed the first one's text in the second one's composer, and
 * `handleAddComment` posted exactly that string — so a draft could be sent to
 * the wrong feedback, silently, with the user having only the pre-filled box as
 * a cue. Drafts are now keyed by feedback id and the submit handler reads the
 * key it is posting to, never "whatever is in the composer".
 *
 * This is the cheapest level that catches it: the bug is entirely in component
 * state, so a Playwright run would add minutes and prove nothing extra.
 */

const feedbacks = [
  {
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
  },
  {
    id: 'feedback-b',
    teamId: 'team-1',
    teamName: 'Team One',
    type: 'feature',
    title: 'Beta request',
    description: 'The second feedback',
    submittedBy: 'user-1',
    submittedByName: 'User One',
    submittedAt: '2026-08-02T10:00:00.000Z',
    isRead: false,
    status: 'pending',
    comments: []
  }
];

const postedBodies: Record<string, unknown>[] = [];

const renderBoard = () =>
  render(
    <TeamFeedback
      teamId="team-1"
      teamName="Team One"
      teamPassword="pw"
      sessionToken="token"
      currentUserId="user-1"
      currentUserName="User One"
      feedbacks={[]}
      onSubmitFeedback={vi.fn()}
      onRefresh={vi.fn()}
    />
  );

const expandComments = async (user: ReturnType<typeof userEvent.setup>, title: string) => {
  const card = screen.getByText(title).closest('div[class*="bg-white"]') as HTMLElement;
  await user.click(within(card).getByRole('button', { name: /Comments/ }));
  return card;
};

describe('TeamFeedback comment drafts are scoped to their feedback', () => {
  beforeEach(() => {
    postedBodies.length = 0;
    globalThis.fetch = vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).includes('/api/feedbacks/all')) {
        return { ok: true, status: 200, json: async () => ({ feedbacks }) } as unknown as Response;
      }
      if (String(url).includes('/api/feedbacks/comment')) {
        postedBodies.push(JSON.parse(String(init?.body ?? '{}')));
        return { ok: true, status: 200, json: async () => ({ success: true }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not carry one feedback’s draft into another’s composer', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Alpha report');

    const alpha = await expandComments(user, 'Alpha report');
    await user.type(within(alpha).getByPlaceholderText('Add a comment...'), 'meant for Alpha');
    expect((within(alpha).getByPlaceholderText('Add a comment...') as HTMLInputElement).value).toBe(
      'meant for Alpha'
    );

    // Collapse Alpha and open Beta: its composer must start empty.
    await user.click(within(alpha).getByRole('button', { name: /Comments/ }));
    const beta = await expandComments(user, 'Beta request');

    expect((within(beta).getByPlaceholderText('Add a comment...') as HTMLInputElement).value).toBe('');
  });

  it('posts each draft to the feedback it was written on', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Alpha report');

    const alpha = await expandComments(user, 'Alpha report');
    await user.type(within(alpha).getByPlaceholderText('Add a comment...'), 'meant for Alpha');
    await user.click(within(alpha).getByRole('button', { name: /Comments/ }));

    const beta = await expandComments(user, 'Beta request');
    await user.type(within(beta).getByPlaceholderText('Add a comment...'), 'meant for Beta');
    await user.click(within(beta).getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(postedBodies).toHaveLength(1));
    expect(postedBodies[0].feedbackId).toBe('feedback-b');
    expect(postedBodies[0].content).toBe('meant for Beta');
  });

  it('keeps the other draft intact after one is sent', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Alpha report');

    const alpha = await expandComments(user, 'Alpha report');
    await user.type(within(alpha).getByPlaceholderText('Add a comment...'), 'still writing this');
    await user.click(within(alpha).getByRole('button', { name: /Comments/ }));

    const beta = await expandComments(user, 'Beta request');
    await user.type(within(beta).getByPlaceholderText('Add a comment...'), 'sent now');
    await user.click(within(beta).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(postedBodies).toHaveLength(1));

    await user.click(within(beta).getByRole('button', { name: /Comments/ }));
    const alphaAgain = await expandComments(user, 'Alpha report');
    expect(
      (within(alphaAgain).getByPlaceholderText('Add a comment...') as HTMLInputElement).value
    ).toBe('still writing this');
  });
});
