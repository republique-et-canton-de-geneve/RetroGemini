import React, { useState, useEffect, useRef } from 'react';
import { TeamFeedback as TeamFeedbackType, FeedbackComment } from '../types';
import { useTranslation } from '../i18n/I18nContext';
import type { MessageKey } from '../i18n/translate';
import { commentAuthorName } from '../utils/feedbackCommentAuthor';
import ImageGallery from './common/ImageGallery';
import { noticeText, type Notice } from '../i18n/notice';
import {
  MAX_SOURCE_IMAGE_BYTES,
  imageShare,
  prepareFeedbackImage,
  remainingImageBudget,
  type PreparedFeedbackImage
} from '../utils/feedbackImages';
import { newFeedbackSubmissionId, type FeedbackSubmitResult } from '../services/feedbackSubmission';

// How a submission ended, as the board needs to know it: a feedback the server
// did not store must keep its draft on screen.
export type { FeedbackSubmitResult } from '../services/feedbackSubmission';

const MAX_IMAGES = 5;

// What each unsent result tells the user to do about it.
const SUBMIT_NOTICE_KEYS: Record<Exclude<FeedbackSubmitResult, 'sent'>, MessageKey> = {
  too_large: 'feedback.submit.tooLarge',
  session_expired: 'feedback.submit.sessionExpired',
  not_saved: 'feedback.submit.notSaved',
  offline: 'feedback.submit.failed'
};

// Why an image was not attached. Each message names its file: a pick of
// several files used to be told "This image…" about one of them.
const IMAGE_REFUSAL_KEYS: Record<Exclude<PreparedFeedbackImage['status'], 'ok'>, MessageKey> = {
  too_large: 'feedback.alert.imagesTooLargeTotal',
  animated_too_large: 'feedback.alert.animatedTooLarge',
  unreadable: 'feedback.alert.readError'
};

// Ties the image notices to the file input they are about.
const IMAGE_NOTICES_ID = 'feedback-image-notices';

type FormNotice = Exclude<Notice, null>;

// What a submission carried, to tell a resend of the same draft from an edit.
interface DraftAttempt {
  submissionId: string;
  type: 'bug' | 'feature';
  title: string;
  description: string;
  images: string[];
}

const sameDraft = (attempt: DraftAttempt, draft: Omit<DraftAttempt, 'submissionId'>) =>
  attempt.type === draft.type
  && attempt.title === draft.title
  && attempt.description === draft.description
  && attempt.images.length === draft.images.length
  && attempt.images.every((image, i) => image === draft.images[i]);

interface TeamFeedbackProps {
  teamId: string;
  teamName: string;
  teamPassword: string;
  sessionToken?: string | null;
  currentUserId: string;
  currentUserName: string;
  feedbacks: TeamFeedbackType[];
  onSubmitFeedback: (feedback: Omit<TeamFeedbackType, 'id' | 'submittedAt' | 'isRead' | 'status' | 'comments'>) => Promise<FeedbackSubmitResult>;
  onRefresh: () => void;
}

type FilterType = 'all' | 'mine' | 'bug' | 'feature';
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'resolved' | 'rejected';

// The same label names a status on a card's badge and in the status filter.
const STATUS_LABEL_KEYS: Record<TeamFeedbackType['status'], MessageKey> = {
  pending: 'feedback.status.pending',
  in_progress: 'feedback.status.inProgress',
  resolved: 'feedback.status.resolved',
  rejected: 'feedback.status.rejected'
};

const TeamFeedback: React.FC<TeamFeedbackProps> = ({
  teamId,
  teamName,
  teamPassword,
  sessionToken,
  currentUserId,
  currentUserName,
  feedbacks: localFeedbacks,
  onSubmitFeedback,
  onRefresh
}) => {
  const { t, tRich, locale } = useTranslation();
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<'bug' | 'feature'>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Why images of the last pick were not attached, one notice per file.
  const [imageNotices, setImageNotices] = useState<FormNotice[]>([]);
  // Why the last submission did not go through.
  const [submitNotice, setSubmitNotice] = useState<Notice>(null);
  // The last attempt that came back unsent, and the id it was sent under.
  const unsentAttemptRef = useRef<DraftAttempt | null>(null);
  // Bumped when a draft is discarded or sent. A photo takes seconds to reduce
  // on a phone, and one still being reduced when its draft was cancelled was
  // appended to the next, unrelated one.
  const draftGenerationRef = useRef(0);
  // What a send or a reduction finishes after the board was closed has nothing
  // left to update, and must not schedule anything that would outlive it.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // All feedbacks from all teams
  const [allFeedbacks, setAllFeedbacks] = useState<TeamFeedbackType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Comment state. Drafts are keyed by feedback id: a single shared string was
  // rendered in whichever card happened to be expanded, so text typed on one
  // feedback showed up in another's composer and `handleAddComment` would post
  // it there — the wrong target, silently (Codex review, PR #404).
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [submittingComment, setSubmittingComment] = useState(false);

  const setCommentDraft = (feedbackId: string, value: string) => {
    setCommentDrafts((prev) => ({ ...prev, [feedbackId]: value }));
  };

  const clearCommentDraft = (feedbackId: string) => {
    setCommentDrafts((prev) => {
      const next = { ...prev };
      delete next[feedbackId];
      return next;
    });
  };

  // Load all feedbacks on mount
  useEffect(() => {
    loadAllFeedbacks();
  }, []);

  const loadAllFeedbacks = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/feedbacks/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, password: teamPassword, sessionToken: sessionToken ?? undefined })
      });
      if (response.ok) {
        const data = await response.json();
        setAllFeedbacks(data.feedbacks || []);
      }
    } catch (err) {
      console.error('Failed to load feedbacks', err);
    } finally {
      setLoading(false);
    }
  };

  // Each image is reduced to fit what the feedback can still carry (see
  // utils/feedbackImages.ts), one after the other, in the order picked.
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const files = Array.from(input.files ?? []);
    // Emptied so the same file can be picked again after it was removed.
    input.value = '';
    if (files.length === 0) return;

    const generation = draftGenerationRef.current;
    // Every refusal of the pick is kept: one notice slot showed only the last.
    const refusals: FormNotice[] = [];
    const refuse = (notice: FormNotice) => {
      refusals.push(notice);
      setImageNotices([...refusals]);
    };
    setImageNotices([]);
    setSubmitNotice(null);
    setUploading(true);
    const added: string[] = [];
    for (const [index, file] of files.entries()) {
      if (images.length + added.length >= MAX_IMAGES) {
        refuse({ key: 'feedback.alert.maxImages', params: { names: files.slice(index).map((f) => f.name).join(', ') } });
        break;
      }
      if (file.size > MAX_SOURCE_IMAGE_BYTES) {
        refuse({ key: 'feedback.alert.imageTooLarge', params: { name: file.name } });
        continue;
      }
      // What is left is shared by the images still to attach: offered all of
      // it, the first photos of a pick took what the last ones needed.
      const available = remainingImageBudget([...images, ...added]);
      const share = imageShare(available, Math.min(files.length - index, MAX_IMAGES - images.length - added.length));
      let prepared: PreparedFeedbackImage;
      // Inside the loop, so one file that fails skips itself, not the rest.
      try {
        prepared = await prepareFeedbackImage(file, { share, available });
      } catch {
        prepared = { status: 'unreadable' };
      }
      // The draft this pick was for is gone (Cancel, which also reset
      // `uploading` for the next draft) or the board is: nothing on screen
      // belongs to it any more.
      if (!mountedRef.current || draftGenerationRef.current !== generation) return;
      if (prepared.status === 'ok') added.push(prepared.dataUrl);
      else refuse({ key: IMAGE_REFUSAL_KEYS[prepared.status], params: { name: file.name } });
    }
    if (added.length > 0) setImages((current) => [...current, ...added]);
    setUploading(false);
  };

  const handleRemoveImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
    // Left on screen, the notices kept telling the user to remove an image
    // they had just removed.
    setImageNotices([]);
  };

  const discardDraft = () => {
    draftGenerationRef.current += 1;
    setShowForm(false);
    setTitle('');
    setDescription('');
    setImages([]);
    setUploading(false);
    setImageNotices([]);
    setSubmitNotice(null);
    unsentAttemptRef.current = null;
  };

  // The reload a submission schedules must not outlive the board: left behind,
  // it fetched and set state after unmount.
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!title.trim() || !description.trim()) {
      alert(t('feedback.alert.fillAllFields'));
      return;
    }

    setImageNotices([]);
    setSubmitNotice(null);
    setSubmitting(true);
    const draft = { type, title: title.trim(), description: description.trim(), images };
    // An unsent attempt may still have landed, its answer lost. Its id is
    // reused only for exactly the same draft, so the server recognises the
    // resend. After an edit, reusing it would have the server answer with the
    // old content and the edit would vanish silently; a new id costs at worst
    // a visible duplicate.
    const previous = unsentAttemptRef.current;
    const submissionId = previous && sameDraft(previous, draft) ? previous.submissionId : newFeedbackSubmissionId();
    let result: FeedbackSubmitResult;
    try {
      result = await onSubmitFeedback({
        teamId,
        teamName,
        type: draft.type,
        title: draft.title,
        description: draft.description,
        images: images.length > 0 ? images : undefined,
        submittedBy: currentUserId,
        submittedByName: currentUserName,
        submissionId
      });
    } catch {
      result = 'offline';
    }
    // Closed while the send was on its way: the reload scheduled below would
    // fetch and refresh after the board is gone.
    if (!mountedRef.current) return;
    setSubmitting(false);

    // Kept on screen until the server has stored it: the form used to clear
    // before the answer, so a refused feedback vanished with what was typed.
    // The draft is locked while it is sent, so what is on screen now is what
    // was sent.
    if (result !== 'sent') {
      unsentAttemptRef.current = { ...draft, submissionId };
      setSubmitNotice({ key: SUBMIT_NOTICE_KEYS[result] });
      return;
    }

    draftGenerationRef.current += 1;
    unsentAttemptRef.current = null;
    setTitle('');
    setDescription('');
    setImages([]);
    setShowForm(false);

    // Reload feedbacks after a short delay — unless the board is closed by then.
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      loadAllFeedbacks();
      onRefresh();
    }, 500);
  };

  const handleAddComment = async (feedbackTeamId: string, feedbackId: string) => {
    // Read the draft belonging to *this* feedback, never "whatever is in the
    // composer" — that is what let one feedback's text be posted to another.
    const content = (commentDrafts[feedbackId] ?? '').trim();
    if (!content) return;

    setSubmittingComment(true);
    try {
      const response = await fetch('/api/feedbacks/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          password: teamPassword,
          sessionToken: sessionToken ?? undefined,
          feedbackTeamId,
          feedbackId,
          authorId: currentUserId,
          authorName: currentUserName,
          content
        })
      });
      if (response.ok) {
        clearCommentDraft(feedbackId);
        loadAllFeedbacks();
      } else if (response.status === 404) {
        // Audit H22: the feedback was deleted while this comment was being
        // written, so there is nowhere left to post it. Drop the draft with its
        // feedback — keeping it would leave invisible state behind, since the
        // composer belongs to an entry that is about to disappear — and reload
        // so the entry that no longer exists stops being offered.
        clearCommentDraft(feedbackId);
        loadAllFeedbacks();
      }
    } catch (err) {
      console.error('Failed to add comment', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (feedbackTeamId: string, feedbackId: string, commentId: string) => {
    if (!confirm(t('feedback.confirm.deleteComment'))) return;

    try {
      const response = await fetch('/api/feedbacks/comment/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          password: teamPassword,
          sessionToken: sessionToken ?? undefined,
          feedbackTeamId,
          feedbackId,
          commentId
        })
      });
      // A 404 means the write found no target — the comment or its feedback is
      // already gone. Reload on both outcomes so the board stops showing an
      // entry that is not there; before the server distinguished them, this
      // path answered `ok` either way and the comment just came back.
      if (response.ok || response.status === 404) {
        loadAllFeedbacks();
      }
    } catch (err) {
      console.error('Failed to delete comment', err);
    }
  };

  const handleDeleteFeedback = async (feedbackId: string) => {
    if (!confirm(t('feedback.confirm.deleteFeedback'))) return;

    try {
      const response = await fetch('/api/feedbacks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          password: teamPassword,
          sessionToken: sessionToken ?? undefined,
          feedbackId
        })
      });
      // A 404 means the write found no target — the feedback is already gone,
      // or it was never this team's to delete. Reload on both outcomes so the
      // board stops showing an entry the server refused to remove; before the
      // server distinguished them, this path answered `ok` either way.
      if (response.ok || response.status === 404) {
        loadAllFeedbacks();
        onRefresh();
      }
    } catch (err) {
      console.error('Failed to delete feedback', err);
    }
  };

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString(locale, {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // The date alone, for "Submitted by … on <date>". This used to be
  // `formatDate(...).split(',')[0]`, which only works where the locale puts a
  // comma between date and time: French does not, so the time leaked into the
  // sentence. Like every date on screen it follows the reader's regional
  // format (`locale`), so en-US reads 10/06/2026 and en-GB 06/10/2026.
  const formatDay = (isoDate: string) =>
    new Date(isoDate).toLocaleDateString(locale, {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric'
    });

  const getStatusBadge = (status: TeamFeedbackType['status']) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      resolved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800'
    };
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${colors[status]}`}>
        {t(STATUS_LABEL_KEYS[status])}
      </span>
    );
  };

  const getTypeBadge = (feedbackType: 'bug' | 'feature') => {
    return feedbackType === 'bug' ? (
      <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
        <span className="material-symbols-outlined text-xs align-middle mr-1">bug_report</span>
        {t('feedback.type.bug')}
      </span>
    ) : (
      <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800">
        <span className="material-symbols-outlined text-xs align-middle mr-1">new_releases</span>
        {t('feedback.type.featureBadge')}
      </span>
    );
  };

  // Filter feedbacks
  const getFilteredFeedbacks = () => {
    let filtered = allFeedbacks;

    // Type filter
    if (filter === 'mine') {
      filtered = filtered.filter(f => f.teamId === teamId);
    } else if (filter === 'bug') {
      filtered = filtered.filter(f => f.type === 'bug');
    } else if (filter === 'feature') {
      filtered = filtered.filter(f => f.type === 'feature');
    }

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(f => f.status === statusFilter);
    }

    return filtered;
  };

  const filteredFeedbacks = getFilteredFeedbacks();
  const myFeedbacksCount = allFeedbacks.filter(f => f.teamId === teamId).length;
  const bugsCount = allFeedbacks.filter(f => f.type === 'bug').length;
  const featuresCount = allFeedbacks.filter(f => f.type === 'feature').length;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">{t('feedback.header.title')}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {t('feedback.header.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadAllFeedbacks()}
            className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition flex items-center gap-1"
            title={t('feedback.header.refreshTitle')}
            aria-label={t('feedback.header.refreshLabel')}
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            disabled={submitting}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            {t('feedback.header.newFeedback')}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">{t('feedback.form.heading')}</h3>
          {/* While a send is on its way the draft is locked, as it was sent:
              edits made meanwhile were erased by the "sent" answer, and a
              Cancel did not withdraw a feedback that was then posted. The
              text fields are read-only rather than disabled, so they keep
              focus and stay readable. */}
          <form onSubmit={handleSubmit} aria-busy={submitting || uploading}>
            <div className="mb-4">
              {/* The heading names the *group*, so it is a group and not a
                  label — there is no single control for a label to point at.
                  The `name` on the two radios below is the other half: without
                  it they are not one radio group to the browser, so they are
                  **two tab stops** instead of one entered at the selected
                  option, and a screen reader loses the "1 of 2" position.
                  Measured, after claiming something else: the arrow keys work
                  either way here, because Chromium checks the next radio
                  regardless and React's controlled `checked` unchecks the
                  other. Tab order is the only thing the attribute changes, and
                  `e2e/feedback-radio-keyboard.spec.ts` proves it — jsdom
                  implements neither behaviour. */}
              <span id="feedback-type-label" className="block text-sm font-medium text-slate-700 mb-2">{t('feedback.form.typeLabel')}</span>
              <div role="radiogroup" aria-labelledby="feedback-type-label" className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    name="feedback-type"
                    value="bug"
                    checked={type === 'bug'}
                    onChange={(e) => setType(e.target.value as 'bug' | 'feature')}
                    disabled={submitting}
                    className="mr-2"
                  />
                  <span className="material-symbols-outlined text-red-600 mr-1">bug_report</span>
                  {t('feedback.type.bug')}
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    name="feedback-type"
                    value="feature"
                    checked={type === 'feature'}
                    onChange={(e) => setType(e.target.value as 'bug' | 'feature')}
                    disabled={submitting}
                    className="mr-2"
                  />
                  <span className="material-symbols-outlined text-purple-600 mr-1">new_releases</span>
                  {t('feedback.type.featureRequest')}
                </label>
              </div>
            </div>

            <div className="mb-4">
              <label htmlFor="feedback-title" className="block text-sm font-medium text-slate-700 mb-2">{t('feedback.form.titleLabel')}</label>
              <input
                id="feedback-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                readOnly={submitting}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent read-only:bg-slate-50"
                placeholder={t('feedback.form.titlePlaceholder')}
                maxLength={100}
              />
            </div>

            <div className="mb-4">
              <label htmlFor="feedback-description" className="block text-sm font-medium text-slate-700 mb-2">{t('feedback.form.descriptionLabel')}</label>
              <textarea
                id="feedback-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                readOnly={submitting}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent read-only:bg-slate-50"
                placeholder={t('feedback.form.descriptionPlaceholder')}
                rows={5}
                maxLength={2000}
              />
            </div>

            <div className="mb-4">
              <label htmlFor="feedback-images" className="block text-sm font-medium text-slate-700 mb-2">
                {t('feedback.form.imagesLabel')}
              </label>
              <input
                id="feedback-images"
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                disabled={uploading || submitting || images.length >= MAX_IMAGES}
                aria-describedby={imageNotices.length > 0 ? IMAGE_NOTICES_ID : undefined}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              {uploading && <p className="text-sm text-slate-500 mt-2">{t('feedback.form.uploading')}</p>}

              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={img} alt={t('feedback.form.uploadAlt', { number: idx + 1 })} className="w-20 h-20 object-cover rounded-sm" />
                      {/* A bare "×" was announced as "times", not as which
                          image it removes. */}
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        disabled={submitting}
                        aria-label={t('feedback.form.removeImage', { number: idx + 1 })}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <span aria-hidden="true">×</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {(imageNotices.length > 0 || submitNotice) && (
              <div role="alert" className="mb-4 text-sm text-red-700">
                {imageNotices.length === 1 && <p id={IMAGE_NOTICES_ID}>{noticeText(imageNotices[0], t)}</p>}
                {imageNotices.length > 1 && (
                  <ul id={IMAGE_NOTICES_ID} className="list-disc pl-5 space-y-1">
                    {imageNotices.map((notice, i) => (
                      <li key={i}>{noticeText(notice, t)}</li>
                    ))}
                  </ul>
                )}
                {submitNotice && <p>{noticeText(submitNotice, t)}</p>}
              </div>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={submitting || uploading}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? t('feedback.form.sending') : t('feedback.form.submit')}
              </button>
              <button
                type="button"
                onClick={discardDraft}
                disabled={submitting}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {t('common.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="mb-6 space-y-3">
        {/* Type Filters */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              filter === 'all'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t('feedback.filter.all', { count: allFeedbacks.length })}
          </button>
          <button
            onClick={() => setFilter('mine')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              filter === 'mine'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t('feedback.filter.myTeam', { count: myFeedbacksCount })}
          </button>
          <button
            onClick={() => setFilter('bug')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              filter === 'bug'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t('feedback.filter.bugs', { count: bugsCount })}
          </button>
          <button
            onClick={() => setFilter('feature')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              filter === 'feature'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t('feedback.filter.features', { count: featuresCount })}
          </button>
        </div>

        {/* Status Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-slate-500">{t('feedback.filter.statusLabel')}</span>
          {(['all', 'pending', 'in_progress', 'resolved', 'rejected'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-1 rounded-lg font-medium text-xs ${
                statusFilter === status
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {status === 'all' ? t('feedback.filter.statusAll') : t(STATUS_LABEL_KEYS[status])}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-50 rounded-lg p-8 text-center text-slate-500">
          <span className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mr-2"></span>
          {t('feedback.list.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFeedbacks.length === 0 ? (
            <div className="bg-slate-50 rounded-lg p-8 text-center text-slate-500">
              {t('feedback.list.empty')}
            </div>
          ) : (
            filteredFeedbacks.map((feedback) => (
              <div key={feedback.id} data-feedback-id={feedback.id} className={`bg-white rounded-lg shadow-md p-6 ${
                feedback.teamId === teamId ? 'border-l-4 border-l-indigo-500' : ''
              }`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getTypeBadge(feedback.type)}
                    {getStatusBadge(feedback.status)}
                    {feedback.teamId === teamId && (
                      <span className="px-2 py-1 text-xs rounded-full bg-indigo-100 text-indigo-800">
                        {t('feedback.card.myTeam')}
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-slate-500">{formatDate(feedback.submittedAt)}</span>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 mb-2">{feedback.title}</h3>
                <p className="text-slate-600 mb-3 whitespace-pre-wrap">{feedback.description}</p>

                {feedback.images && feedback.images.length > 0 && (
                  <ImageGallery
                    images={feedback.images}
                    altFor={(number) => t('feedback.card.imageAlt', { number })}
                  />
                )}

                <div className="text-sm text-slate-500 mb-3">
                  <span className="material-symbols-outlined text-sm align-middle mr-1">groups</span>
                  {tRich('feedback.card.meta', {
                    team: <span className="font-semibold">{feedback.teamName}</span>,
                    name: feedback.submittedByName,
                    date: formatDay(feedback.submittedAt)
                  })}
                </div>

                {/* Comments Section */}
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <button
                    onClick={() => setExpandedFeedback(expandedFeedback === feedback.id ? null : feedback.id)}
                    className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-800"
                  >
                    <span className="material-symbols-outlined text-sm">
                      {expandedFeedback === feedback.id ? 'expand_less' : 'expand_more'}
                    </span>
                    <span className="material-symbols-outlined text-sm">chat</span>
                    {t('feedback.comments.toggle', { count: feedback.comments?.length || 0 })}
                  </button>

                  {expandedFeedback === feedback.id && (
                    <div className="mt-3 space-y-3">
                      {/* Existing comments */}
                      {feedback.comments && feedback.comments.length > 0 ? (
                        feedback.comments.map((comment) => (
                          <div key={comment.id} className={`rounded-sm p-3 ${comment.isAdmin ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                            <div className="flex justify-between items-start">
                              <div className="text-sm">
                                {comment.isAdmin && (
                                  <span className="material-symbols-outlined text-xs align-middle mr-1 text-amber-600">admin_panel_settings</span>
                                )}
                                <span className={`font-medium ${comment.isAdmin ? 'text-amber-800' : 'text-slate-800'}`}>{commentAuthorName(comment, t)}</span>
                                {!comment.isAdmin && (
                                  <>
                                    <span className="text-slate-500"> · </span>
                                    <span className="text-slate-500">{comment.teamName}</span>
                                  </>
                                )}
                                <span className="text-slate-500"> · </span>
                                <span className="text-slate-500">{formatDate(comment.createdAt)}</span>
                              </div>
                              {comment.teamId === teamId && !comment.isAdmin && (
                                <button
                                  onClick={() => handleDeleteComment(feedback.teamId, feedback.id, comment.id)}
                                  className="text-red-500 hover:text-red-700"
                                  title={t('feedback.comments.delete')}
                                  aria-label={t('feedback.comments.delete')}
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              )}
                            </div>
                            <p className={`text-sm mt-1 ${comment.isAdmin ? 'text-amber-700' : 'text-slate-700'}`}>{comment.content}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500 italic">{t('feedback.comments.empty')}</p>
                      )}

                      {/* Add comment form */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={commentDrafts[feedback.id] ?? ''}
                          onChange={(e) => setCommentDraft(feedback.id, e.target.value)}
                          placeholder={t('feedback.comments.placeholder')}
                          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                          maxLength={1000}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleAddComment(feedback.teamId, feedback.id);
                            }
                          }}
                        />
                        <button
                          onClick={() => handleAddComment(feedback.teamId, feedback.id)}
                          disabled={submittingComment || !(commentDrafts[feedback.id] ?? '').trim()}
                          className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                          {submittingComment ? '...' : t('feedback.comments.send')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Delete button - only for own team's feedbacks and only if not read or rejected */}
                {feedback.teamId === teamId && (!feedback.isRead || feedback.status === 'rejected') && (
                  <div className="mt-3 pt-3 border-t border-slate-200">
                    <button
                      onClick={() => handleDeleteFeedback(feedback.id)}
                      className="text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                      {t('feedback.card.delete')}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default TeamFeedback;
