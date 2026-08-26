import React, { useEffect, useState } from 'react';

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
      <div className="bg-white rounded-lg p-3 text-sm border border-retro-primary ring-1 ring-indigo-100">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the edit button it replaces is unmounted by this very click
          autoFocus
          className="w-full bg-white border border-slate-200 rounded-lg p-2 text-slate-700 text-sm resize-none h-16 focus:outline-hidden focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
        />
        <div className="flex justify-end space-x-2 mt-2">
          <button
            onClick={() => { setDraft(comment); setIsEditing(false); }}
            className="px-3 py-1 rounded-sm text-xs font-bold text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!draft.trim()}
            className="px-3 py-1 rounded-sm text-xs font-bold bg-retro-primary text-white hover:bg-retro-primaryHover disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg p-3 text-sm text-slate-700 border border-slate-200 flex items-start">
      <div className="grow min-w-0 wrap-break-word">
        {label && <span className="text-slate-500 text-xs font-medium mr-2">{label}:</span>}
        {comment}
      </div>
      {isOwn && (
        <div className="ml-2 shrink-0">
          {!confirmingDelete ? (
            <div className="flex items-center space-x-1">
              <button
                onClick={() => setIsEditing(true)}
                className="text-slate-500 hover:text-retro-primary transition"
                title="Edit your comment"
                aria-label="Edit comment"
              >
                <span className="material-symbols-outlined text-sm">edit</span>
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                className="text-slate-500 hover:text-rose-500 transition"
                title="Delete your comment"
                aria-label="Delete comment"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2 text-xs bg-white border border-slate-200 rounded-sm px-2 py-1 shadow-xs">
              <span className="text-slate-500">Delete?</span>
              <button className="text-rose-700 font-bold" onClick={onDelete}>Yes</button>
              <button className="text-slate-500" onClick={() => setConfirmingDelete(false)}>No</button>
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
      <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Comments</h4>
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
        <p className="text-slate-500 text-sm mb-3">No comments yet.</p>
      )}

      {!hasOwnComment && (
        <div>
          <textarea
            placeholder="Add a comment..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg p-3 text-slate-700 text-sm resize-none h-16 focus:outline-hidden focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={handleAdd}
              disabled={!draft.trim()}
              className="px-4 py-1.5 rounded-sm text-sm font-bold bg-retro-primary text-white hover:bg-retro-primaryHover disabled:opacity-50 transition"
            >
              Comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default HealthCheckCommentsSection;
