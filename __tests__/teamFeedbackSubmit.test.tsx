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

  // Each refusal says what the user can do about it: a 401 read "Check your
  // connection" too, and the user kept resending a draft that could never be
  // stored that way.
  it.each([
    ['too_large', /not sent: its images are too large/i],
    ['session_expired', /not sent: your session has expired/i],
    ['not_saved', /could not be saved\. Try again in a moment/i],
    ['offline', /not sent\. Check your connection/i]
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

  // An animation is only ever sent as it is, so one that does not fit is too
  // large too, not unreadable.
  it.each(['too_large', 'animated_too_large'] as const)('refuses an image that no longer fits, and says so (%s)', async (status) => {
    const user = userEvent.setup();
    prepareFeedbackImage.mockImplementation(async (file: File) => ({ status: 'ok', dataUrl: `data:image/webp;base64,${file.name}` }));
    prepareFeedbackImage.mockResolvedValueOnce({ status });
    renderForm(async () => 'sent');
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));

    await user.upload(screen.getByLabelText(/^Images/), [
      new File(['x'], 'huge.gif', { type: 'image/gif' }),
      new File(['y'], 'fine.png', { type: 'image/png' })
    ]);

    expect(await screen.findByRole('alert')).toHaveTextContent(/too large to send/i);
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Upload \d/ })).toHaveLength(1));
    expect(screen.getByRole('img', { name: /Upload 1/ })).toHaveAttribute('src', 'data:image/webp;base64,fine.png');
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

  it('counts the images an earlier pick attached, in what is left and in the slots', async () => {
    // A second pick that ignored the images already attached offered each new
    // one a share of the whole 800k, and the feedback outgrew the server's
    // limit; one that ignored the slots already taken split what is left over
    // files that will never be attached, and degraded the first for nothing.
    const user = userEvent.setup();
    prepareFeedbackImage.mockImplementation(async () => ({ status: 'ok', dataUrl: 'x'.repeat(100_000) }));
    renderForm(async () => 'sent');
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));
    const pick = (names: string[]) =>
      user.upload(screen.getByLabelText(/^Images/), names.map((n) => new File([n], `${n}.jpg`, { type: 'image/jpeg' })));

    await pick(['1', '2', '3']);
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Upload \d/ })).toHaveLength(3));
    prepareFeedbackImage.mockClear();
    await pick(['4', '5', '6', '7']);

    await waitFor(() => expect(screen.getAllByRole('img', { name: /Upload \d/ })).toHaveLength(5));
    expect(prepareFeedbackImage.mock.calls.map(([, allowance]) => allowance)).toEqual([
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

/**
 * A create whose answer was lost reads as "not sent", although the server may
 * have stored it. The draft carries a submissionId the server recognises, so a
 * resend of the same draft is not stored twice — and an edited draft gets a
 * new id, because the server answers a known id with what it already holds.
 */
describe('the submissionId a draft is sent with', () => {
  type Sent = { submissionId?: string; title: string; images?: string[] };

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ feedbacks: [] }) })) as unknown as typeof fetch;
    prepareFeedbackImage.mockReset();
    prepareFeedbackImage.mockImplementation(async (file: File) => `data:image/webp;base64,${file.name}`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Answers each submission in turn with the next result, recording what was sent.
  const answering = (...results: FeedbackSubmitResult[]) => {
    const sent: Sent[] = [];
    const onSubmit = vi.fn(async (feedback: unknown) => {
      sent.push(feedback as Sent);
      return results[sent.length - 1] ?? 'sent';
    });
    return { onSubmit, sent };
  };

  const resend = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'Submit' }));
  };

  it('resends an unchanged draft with the id of the attempt that came back unsent', async () => {
    const user = userEvent.setup();
    const { onSubmit, sent } = answering('offline', 'sent');
    renderForm(onSubmit);

    await fillAndSend(user);
    await screen.findByRole('alert');
    await resend(user);

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0].submissionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(sent[1].submissionId).toBe(sent[0].submissionId);
  });

  it('gives an edited draft a new id', async () => {
    const user = userEvent.setup();
    const { onSubmit, sent } = answering('offline', 'sent');
    renderForm(onSubmit);

    await fillAndSend(user);
    await screen.findByRole('alert');
    await user.type(screen.getByLabelText('Title'), ' again');
    await resend(user);

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].title).toBe('Broken export again');
    expect(sent[1].submissionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(sent[1].submissionId).not.toBe(sent[0].submissionId);
  });

  it('gives a draft a new id when one of its images was removed', async () => {
    const user = userEvent.setup();
    const { onSubmit, sent } = answering('offline', 'sent');
    renderForm(onSubmit);
    await user.click(screen.getByRole('button', { name: /New Feedback/ }));
    await user.upload(screen.getByLabelText(/^Images/), [
      new File(['a'], 'first.png', { type: 'image/png' }),
      new File(['b'], 'second.png', { type: 'image/png' })
    ]);
    await waitFor(() => expect(screen.getAllByRole('img', { name: /Upload \d/ })).toHaveLength(2));
    await user.type(screen.getByLabelText('Title'), 'Broken export');
    await user.type(screen.getByLabelText('Description'), 'The export button does nothing.');
    await resend(user);
    await screen.findByRole('alert');

    await user.click(screen.getAllByRole('button', { name: '×' })[1]);
    await resend(user);

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0].images).toHaveLength(2);
    expect(sent[1].images).toEqual(['data:image/webp;base64,first.png']);
    expect(sent[1].submissionId).not.toBe(sent[0].submissionId);
  });

  it('gives the next draft a new id once the previous one was sent', async () => {
    const user = userEvent.setup();
    const { onSubmit, sent } = answering('sent', 'sent');
    renderForm(onSubmit);

    await fillAndSend(user);
    await waitFor(() => expect(screen.queryByLabelText('Title')).not.toBeInTheDocument());
    await fillAndSend(user);

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].submissionId).not.toBe(sent[0].submissionId);
  });

  it('forgets the unsent attempt when the form is cancelled', async () => {
    const user = userEvent.setup();
    const { onSubmit, sent } = answering('offline', 'sent');
    renderForm(onSubmit);

    await fillAndSend(user);
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await fillAndSend(user);

    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].title).toBe(sent[0].title);
    expect(sent[1].submissionId).not.toBe(sent[0].submissionId);
  });
});
