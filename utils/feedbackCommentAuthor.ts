import type { FeedbackComment } from '../types';
import { enT, Translator } from '../i18n/translate';

// The author /api/super-admin/feedbacks/comment writes on every reply it stores
// (server/routes/superAdminRoutes.js). It is the server's word, not a name
// anyone typed, so the console and the team's feedback board both say it in the
// reader's language. The stored value is left as it is, so a client and a pod of
// different releases still agree during a rolling update.
export const ADMIN_COMMENT_AUTHOR = 'Super Admin';

// Recognised only on a reply flagged as the administrator's *and* carrying that
// exact text. `isAdmin` alone does not prove the server wrote the name — a team
// can send its own feedback list through /api/team/:teamId/update — so any
// other author stays exactly as stored.
export const commentAuthorName = (
  comment: Pick<FeedbackComment, 'authorName' | 'isAdmin'>,
  t: Translator = enT
): string =>
  comment.isAdmin === true && comment.authorName === ADMIN_COMMENT_AUTHOR
    ? t('feedback.comments.adminAuthor')
    : comment.authorName;
