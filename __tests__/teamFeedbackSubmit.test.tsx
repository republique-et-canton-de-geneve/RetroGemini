import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TeamFeedback, { type FeedbackSubmitResult } from '../components/TeamFeedback';

const prepareFeedbackImage = vi.fn();
vi.mock('../utils/feedbackImages', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/feedbackImages')>()),
  prepareFeedbackImage: (...args: unknown[]) => prepareFeedbackImage(...args)
}));

/**
 * The form cleared its title, description and images the moment it was
 * submitted, before the server had answered, and nothing read the answer. A
 * feedback the server refused — every one carrying an ordinary screenshot,
 * which the JSON body limit turned away with a 413 — simply vanished: the form
 * closed as if it had been sent, and what the user had typed was gone.
 */

const renderForm = (onSubmitFeedback: (f: unknown) => Promise<FeedbackSubmitResult>) =>
  render(
    <TeamFeedback
      teamId="team-1"
      teamName="Team One"
      teamPassword="pw"
      sessionToken="token"
      currentUserId="user-1"
      currentUserName="User One"
      feedbacks={[]}
      onSubmitFeedback={onSubmitFeedback}
      onRefresh={vi.fn()}
    />
  );

const fillAndSend = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /New Feedback/ }));
  await user.type(screen.getByLabelText('Title'), 'Broken export');
  await user.type(screen.getByLabelText('Description'), 'The export button does nothing.');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
};

describe('submitting a feedback', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ feedbacks: [] }) })) as unknown as typeof fetch;
    prepareFeedbackImage.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['too_large', /not sent: its images are too large/i],
    ['failed', /not sent\. Check your connection/i]
  ] as const)('keeps the draft and says why when the server refuses it (%s)', async (result, message) => {
    const user = userEvent.setup();
    renderForm(async () => result);

    await fillAndSend(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByLabelText('Title')).toHaveValue('Broken export');
    expect(screen.getByLabelText('Description')).toHaveValue('The export button does nothing.');
  });

  it('clears and closes the form once the feedback is stored', async () => {
    const user = userEvent.setup();
    renderForm(async () => 'sent');

    await fillAndSend(user);

    await waitFor(() => expect(screen.queryByLabelText('Title')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('cannot be sent twice while the first send is on its way', async () => {
    const user = userEvent.setup();
    let answer!: (result: FeedbackSubmitResult) => void;
    const onSubmit = vi.fn(() => new Promise<FeedbackSubmitResult>((resolve) => { answer = resolve; }));
    renderForm(onSubmit);

    await fillAndSend(user);

    const sending = screen.getByRole('button', { name: 'Sending...' });
    expect(sending).toBeDisabled();
    await user.click(sending);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    answer('sent');
    await waitFor(() => expect(screen.queryByLabelText('Title')).not.toBeInTheDocument());
  });

  it('refuses an image that no longer fits, and says so', async () => {
    const user = userEvent.setup();
    prepareFeedbackImage.mockResolvedValue(null);
    renderForm(async () => 'sent');
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));

    await user.upload(screen.getByLabelText(/^Images/), new File(['x'], 'huge.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too large to send/i);
    expect(screen.queryByRole('img', { name: /Upload 1/ })).not.toBeInTheDocument();
  });

  it('attaches every image picked at once, in order', async () => {
    const user = userEvent.setup();
    prepareFeedbackImage.mockImplementation(async (file: File) => `data:image/webp;base64,${file.name}`);
    renderForm(async () => 'sent');
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));

    await user.upload(screen.getByLabelText(/^Images/), [
      new File(['a'], 'first.png', { type: 'image/png' }),
      new File(['b'], 'second.png', { type: 'image/png' })
    ]);

    await waitFor(() => expect(screen.getAllByRole('img', { name: /Upload \d/ })).toHaveLength(2));
    expect(screen.getAllByRole('img', { name: /Upload \d/ }).map((img) => img.getAttribute('src'))).toEqual([
      'data:image/webp;base64,first.png',
      'data:image/webp;base64,second.png'
    ]);
  });
});
