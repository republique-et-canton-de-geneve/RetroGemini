import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/I18nContext';

export interface DimensionComment {
  userId: string;
  comment: string;
}

interface Props {
  comments: DimensionComment[];
  currentUserId: string;
  /** Returns the label to display for a comment's author, or null to hide it (e.g. anonymous). */
  getAuthorLabel: (userId: string) => string | null;
  onAddComment: (text: string) => void;
  onUpdateComment: (text: string) => void;
  onDeleteComment: () => void;
}

// The primary button, and its disabled look in measured colours: a fade
// (half the opacity) left the label under 4.5:1 and cannot be measured.
const PRIMARY_BUTTON = 'bg-indigo-600 text-white hover:bg-indigo-700 btn-brand-glow disabled:bg-slate-100 disabled:text-slate-600 disabled:shadow-none disabled:cursor-not-allowed';

/**
 * A single comment card. The current user's own comment is editable in place
 * (classic "submit then edit" pattern), so a participant only ever sees their
 * comment once instead of duplicated in a separate always-editable field.
 */
const CommentCard: React.FC<{
  comment: string;
  label: string | null;
  isOwn: boolean;
  onUpdate: (text: string) => void;
  onDelete: () => void;
}> = ({ comment, label, isOwn, onUpdate, onDelete }) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(comment);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setDraft(comment);
    setIsEditing(false);
    setConfirmingDelete(false);
  }, [comment]);

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (trimmed !== comment) onUpdate(trimmed);
    setIsEditing(false);
  };

  if (isOwn && isEditing) {
    return (
      <div className="bg-white rounded-xl p-3 text-sm border border-indigo-600 ring-4 ring-indigo-600/15">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the edit button it replaces is unmounted by this very click
          autoFocus
          className="w-full bg-white border border-slate-400 rounded-lg px-2.5 py-2 text-slate-900 text-sm resize-none h-16 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 transition"
        />
        <div className="flex justify-end space-x-2 mt-2">
          <button
            onClick={() => { setDraft(comment); setIsEditing(false); }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={!draft.trim()}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${PRIMARY_BUTTON}`}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl px-3 py-2.5 text-sm text-slate-900 border border-slate-200 shadow-xs flex items-start gap-2">
      <div className="grow min-w-0 wrap-break-word">
        {label && (
          <span className="text-slate-500 text-xs font-semibold mr-2">
            {t('phases.comments.authorLabel', { name: label })}
          </span>
        )}
        {comment}
      </div>
      {isOwn && (
        <div className="shrink-0">
          {!confirmingDelete ? (
            <div className="flex items-center gap-0.5 -my-1">
              <button
                onClick={() => setIsEditing(true)}
                className="grid place-items-center w-7 h-7 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-indigo-700 transition"
                title={t('phases.comments.editTitle')}
                aria-label={t('phases.comments.edit')}
              >
                <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">edit</span>
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="grid place-items-center w-7 h-7 rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 transition"
                title={t('phases.comments.deleteTitle')}
                aria-label={t('phases.comments.delete')}
              >
                <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">delete</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1 shadow-xs">
              <span className="text-slate-600">{t('phases.comments.confirmDelete')}</span>
              <button className="text-rose-700 font-semibold rounded-md px-1.5 py-0.5 hover:bg-rose-50" onClick={onDelete}>{t('common.yes')}</button>
              <button className="text-slate-600 font-semibold rounded-md px-1.5 py-0.5 hover:bg-slate-100" onClick={() => setConfirmingDelete(false)}>{t('common.no')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Comments block shown for a dimension during the Discuss phase. Lists every
 * participant's comment and lets the current user add a single comment (then
 * edit or delete it), instead of an always-on editable field that confusingly
 * mirrored their comment in the list.
 */
const HealthCheckCommentsSection: React.FC<Props> = ({
  comments,
  currentUserId,
  getAuthorLabel,
  onAddComment,
  onUpdateComment,
  onDeleteComment
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const hasOwnComment = comments.some((c) => c.userId === currentUserId);

  const handleAdd = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onAddComment(trimmed);
    setDraft('');
  };

  return (
    <div className="mb-4">
      <h4 className="text-sm font-semibold text-slate-700 mb-2">{t('phases.comments.title')}</h4>
      {comments.length > 0 ? (
        <div className="space-y-2 mb-3">
          {comments.map((c) => (
            <CommentCard
              key={c.userId}
              comment={c.comment}
              label={getAuthorLabel(c.userId)}
              isOwn={c.userId === currentUserId}
              onUpdate={onUpdateComment}
              onDelete={onDeleteComment}
            />
          ))}
        </div>
      ) : (
        // On the Discuss panel's grey: slate-600, the muted ink of a tinted surface.
        <p className="text-slate-600 text-sm mb-3">{t('phases.comments.empty')}</p>
      )}

      {!hasOwnComment && (
        <div>
          <textarea
            placeholder={t('phases.comments.placeholder')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2.5 text-slate-900 text-sm placeholder:text-slate-500 resize-none h-16 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 transition"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={handleAdd}
              disabled={!draft.trim()}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition ${PRIMARY_BUTTON}`}
            >
              {t('phases.comments.submit')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HealthCheckCommentsSection;
