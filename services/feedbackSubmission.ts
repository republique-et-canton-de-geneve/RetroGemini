import type { TeamFeedback } from '../types';
import { randomId } from '../utils/randomId';
import { noteRevokedResponse } from './sessionRevocation';

/**
 * Sending a feedback from the board, and what its answer means for the draft.
 *
 * The form keeps what the user typed unless the server stored it, so each
 * result names something the user can act on: shrink the images, sign in
 * again, wait and retry, or check the connection. Every refusal used to read
 * as a connection problem, a 401 included, so a draft that could never be
 * stored was resent again and again.
 */

export type FeedbackSubmitResult = 'sent' | 'too_large' | 'session_expired' | 'not_saved' | 'offline';

// One per draft, so that the server can recognise the retry of a create whose
// answer was lost. 24 base36 characters: inside the server's
// /^[A-Za-z0-9_-]{8,64}$/, and far too many to collide between two drafts.
export const newFeedbackSubmissionId = (): string => randomId(24);

export interface FeedbackSubmission {
  teamId: string;
  password?: string | null;
  sessionToken?: string | null;
  feedback: Omit<TeamFeedback, 'id' | 'submittedAt' | 'isRead' | 'status' | 'comments'>;
}

const postJson = (fetchImpl: typeof fetch, url: string, body: unknown) =>
  fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

// Fire-and-forget: the feedback is stored whatever happens to the mail, so a
// failure here must neither change the result nor surface as an unhandled
// rejection, including from a fetch that throws instead of rejecting.
const notifyAdmin = (fetchImpl: typeof fetch, credential: Record<string, unknown>, feedback: unknown) => {
  try {
    Promise.resolve(postJson(fetchImpl, '/api/notify-new-feedback', { ...credential, feedback })).catch(() => {});
  } catch {
    // Nothing to report: see above.
  }
};

export const submitTeamFeedback = async (
  submission: FeedbackSubmission,
  fetchImpl: typeof fetch = fetch
): Promise<FeedbackSubmitResult> => {
  // Created through the API rather than the team record, to stay clear of the
  // record's sync. The notification below carries the same credential: the
  // route mails caller-supplied content through the deployment's SMTP
  // identity, so it is authenticated (H29).
  const credential = {
    teamId: submission.teamId,
    password: submission.password ?? undefined,
    sessionToken: submission.sessionToken ?? undefined
  };

  try {
    const response = await postJson(fetchImpl, '/api/feedbacks/create', { ...credential, feedback: submission.feedback });

    if (response.ok) {
      const data = await response.json();
      // The feedback as stored — its id, its trimmed text — and, on a retry
      // the server recognised (`duplicate: true`), the copy the first attempt
      // stored. That attempt's answer was lost, so it never notified either.
      notifyAdmin(fetchImpl, credential, data?.feedback);
      return 'sent';
    }
    // 413: the JSON body limit (server.js), which the images budget in
    // utils/feedbackImages.ts is meant to stay under.
    if (response.status === 413) return 'too_large';
    if (response.status === 401) {
      // Decision D3b: a token a password change revoked is reported, and the
      // Dashboard then signs out with the reason; the draft stays on the form.
      await noteRevokedResponse(response, submission.sessionToken);
      return 'session_expired';
    }
    return 'not_saved';
  } catch (err) {
    // No answer, or a 2xx that is not the route's JSON (a proxy answering in
    // its place): either way nothing says the feedback was stored.
    console.error('Failed to create feedback', err);
    return 'offline';
  }
};
