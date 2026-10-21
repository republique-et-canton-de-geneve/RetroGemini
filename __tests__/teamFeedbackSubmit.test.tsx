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
    prepareFeedbackImage.mockResolvedValue({ status: 'too_large' });
    renderForm(async () => 'sent');
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));

    await user.upload(screen.getByLabelText(/^Images/), new File(['x'], 'huge.png', { type: 'image/png' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too large to send/i);
    expect(screen.queryByRole('img', { name: /Upload 1/ })).not.toBeInTheDocument();
  });

  it('attaches every image picked at once, in order', async () => {
    const user = userEvent.setup();
    prepareFeedbackImage.mockImplementation(async (file: File) => ({ status: 'ok', dataUrl: `data:image/webp;base64,${file.name}` }));
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

  it('shares what is left over the images picked at once', async () => {
    // Each image used to be offered min(300k, what is left), so the first
    // three of five photos took the whole budget and the last two were refused.
    const user = userEvent.setup();
    prepareFeedbackImage.mockImplementation(async () => ({ status: 'ok', dataUrl: 'x'.repeat(100_000) }));
    renderForm(async () => 'sent');
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));

    await user.upload(
      screen.getByLabelText(/^Images/),
      ['1', '2', '3', '4', '5'].map((n) => new File([n], `${n}.jpg`, { type: 'image/jpeg' }))
    );

    await waitFor(() => expect(screen.getAllByRole('img', { name: /Upload \d/ })).toHaveLength(5));
    expect(prepareFeedbackImage.mock.calls.map(([, allowance]) => allowance)).toEqual([
      { share: 160_000, available: 800_000 },
      { share: 175_000, available: 700_000 },
      { share: 200_000, available: 600_000 },
      { share: 250_000, available: 500_000 },
      { share: 300_000, available: 400_000 }
    ]);
  });

  it.each([
    ['reports it unreadable', () => prepareFeedbackImage.mockResolvedValueOnce({ status: 'unreadable' })],
    ['throws', () => prepareFeedbackImage.mockRejectedValueOnce(new Error('boom'))]
  ])('skips only the file that cannot be read when the reduction %s', async (_case, failFirst) => {
    const user = userEvent.setup();
    prepareFeedbackImage.mockImplementation(async (file: File) => ({ status: 'ok', dataUrl: `data:image/webp;base64,${file.name}` }));
    failFirst();
    renderForm(async () => 'sent');
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));

    await user.upload(screen.getByLabelText(/^Images/), [
      new File(['a'], 'broken.png', { type: 'image/png' }),
      new File(['b'], 'fine.png', { type: 'image/png' })
    ]);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Error reading file/);
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Upload \d/ })).toHaveLength(1));
    expect(screen.getByRole('img', { name: /Upload 1/ })).toHaveAttribute('src', 'data:image/webp;base64,fine.png');
  });
});
