
import React, { useState, useRef, useEffect } from 'react';
import { Ticket, TicketComment, User } from '../../types';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';
import { avatarColorClasses } from '../../utils/participantColors';
import Avatar from '../common/Avatar';

interface Props {
  ticket: Ticket;
  currentUser: User;
  participants: User[];
  isFacilitator: boolean;
  onAddComment: (ticketId: string, text: string) => void;
  onEditComment: (ticketId: string, commentId: string, text: string) => void;
  onDeleteComment: (ticketId: string, commentId: string) => void;
  onClose: () => void;
  cardBgHex: string | null;
  cardTextColor: string;
  isAnonymous: boolean;
  /** The picture to draw for a person (`sessionAvatarOf`: none in an anonymous session). */
  avatarIdOf?: (memberId: string) => string | null;
}

const NO_AVATAR = () => null;

const TicketCommentsModal: React.FC<Props> = ({
  ticket,
  currentUser,
  participants,
  isFacilitator,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onClose,
  cardBgHex,
  cardTextColor,
  isAnonymous,
  avatarIdOf = NO_AVATAR,
}) => {
  const { t, locale } = useTranslation();
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape, the backdrop click and the focus trap belong to `ModalDialog`.

  const handleSubmit = () => {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    onAddComment(ticket.id, trimmed);
    setCommentText('');
  };

  const handleEditSubmit = (commentId: string) => {
    const trimmed = editingText.trim();
    if (!trimmed) return;
    onEditComment(ticket.id, commentId, trimmed);
    setEditingCommentId(null);
    setEditingText('');
  };

  const canSend = !!commentText.trim();
  const comments = ticket.comments || [];
  const author = participants.find(m => m.id === ticket.authorId);

  const getCommentAuthor = (comment: TicketComment) => {
    return participants.find(m => m.id === comment.authorId);
  };

  const formatTime = (isoDate: string) => {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t('session.comments.justNow');
    if (diffMin < 60) return t('session.comments.minutesAgo', { count: diffMin });
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return t('session.comments.hoursAgo', { count: diffHours });
    return date.toLocaleDateString(locale);
  };

  return (
    <ModalDialog
      label={t('session.comments.dialogLabel', { text: ticket.text })}
      onClose={onClose}
      overlayTestId="ticket-comments-modal"
      overlayClassName="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
    >
      <>
        {/* The card the comments are about, in its own colours: the board
            passes its background and the class of its words, whatever the
            card looks like (a light tint today), so nothing here assumes a
            saturated or a light background. */}
        <div
          className={`px-5 pt-4 pb-3 border-b border-slate-200 ${!cardBgHex ? 'bg-slate-50' : ''}`}
          style={cardBgHex ? { backgroundColor: cardBgHex } : undefined}
        >
          <div className="flex items-start justify-between gap-3">
            <div className={`text-sm leading-relaxed font-medium whitespace-pre-wrap wrap-break-word flex-1 min-w-0 pt-1 ${cardBgHex ? cardTextColor : 'text-slate-900'}`}>
              {ticket.text}
            </div>
            <button
              onClick={onClose}
              className={`-mr-1.5 w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-900/5 transition shrink-0 ${cardBgHex ? cardTextColor : 'text-slate-600'}`}
              title={t('session.comments.closeTitle')}
              aria-label={t('session.comments.closeAria')}
            >
              <span className="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
          {!isAnonymous && author && (
            // Not muted by opacity: 70% took the initials and the name to
            // about 2.9:1, and a faded look is what a measurement cannot see.
            <div className="mt-2 flex items-center gap-2 text-xs font-medium">
              <span className="flex shrink-0">
                <Avatar colorClasses={avatarColorClasses(author.color)} initials={author.name.substring(0, 2).toUpperCase()} size={24} avatarId={avatarIdOf(author.id)} />
              </span>
              <span className={cardBgHex ? cardTextColor : 'text-slate-600'}>{author.name}</span>
            </div>
          )}
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {comments.length === 0 && (
            <div className="text-center text-slate-500 text-sm py-6">
              {t('session.comments.empty')}
            </div>
          )}
          {comments.map(comment => {
            const commentAuthor = getCommentAuthor(comment);
            const isMine = comment.authorId === currentUser.id;
            const canModify = isMine || isFacilitator;
            const isEditing = editingCommentId === comment.id;

            return (
              <div key={comment.id} className="flex items-start gap-3 group" data-testid="ticket-comment">
                <span className="flex shrink-0">
                  <Avatar colorClasses={avatarColorClasses(commentAuthor?.color)} initials={(commentAuthor?.name || comment.authorName).substring(0, 2).toUpperCase()} size={28} avatarId={commentAuthor ? avatarIdOf(commentAuthor.id) : null} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {commentAuthor?.name || comment.authorName}
                    </span>
                    <span className="text-xs text-slate-500 tabular-nums">{formatTime(comment.createdAt)}</span>
                  </div>
                  {isEditing ? (
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        // eslint-disable-next-line jsx-a11y/no-autofocus -- the edit button it replaces is unmounted by this very click
                        autoFocus
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleEditSubmit(comment.id);
                          if (e.key === 'Escape') { setEditingCommentId(null); setEditingText(''); }
                        }}
                        className="flex-1 min-w-0 text-sm bg-white text-slate-900 border border-slate-400 rounded-lg px-2.5 py-1.5 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15"
                        data-testid="edit-comment-input"
                      />
                      <button
                        onClick={() => handleEditSubmit(comment.id)}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-indigo-600 hover:bg-indigo-50"
                        title={t('session.comments.saveTitle')}
                        aria-label={t('session.comments.saveAria')}
                      >
                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">check</span>
                      </button>
                      <button
                        onClick={() => { setEditingCommentId(null); setEditingText(''); }}
                        className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                        title={t('session.comments.cancelTitle')}
                        aria-label={t('session.comments.cancelAria')}
                      >
                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">close</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm leading-relaxed text-slate-700 mt-0.5 wrap-break-word" data-testid="comment-text">
                      {comment.text}
                    </div>
                  )}
                </div>
                {/* Hidden only where a pointer can hover, and shown on focus:
                    on a phone a bare opacity-0 left the Delete invisible yet
                    tapped, and a keyboard user tabbed onto controls nobody
                    could see (pass 15 of 42.1). Shown there, they take a
                    colour that can be seen on white. */}
                {canModify && !isEditing && (
                  <div className="flex items-center gap-0.5 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition shrink-0">
                    <button
                      onClick={() => { setEditingCommentId(comment.id); setEditingText(comment.text); }}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-indigo-700 hover:bg-slate-100"
                      title={t('session.comments.edit')}
                      data-testid="edit-comment-btn"
                      aria-label={t('session.comments.edit')}
                    >
                      <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">edit</span>
                    </button>
                    <button
                      onClick={() => onDeleteComment(ticket.id, comment.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-rose-700 hover:bg-rose-50"
                      title={t('session.comments.delete')}
                      data-testid="delete-comment-btn"
                      aria-label={t('session.comments.delete')}
                    >
                      <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">delete</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Comment input */}
        <div className="border-t border-slate-200 px-4 py-3 flex items-center gap-2 bg-slate-50">
          <Avatar colorClasses={avatarColorClasses(currentUser.color)} initials={currentUser.name.substring(0, 2).toUpperCase()} size={28} avatarId={avatarIdOf(currentUser.id)} />
          <input
            ref={inputRef}
            type="text"
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder={t('session.comments.placeholder')}
            className="flex-1 min-w-0 text-sm bg-white text-slate-900 placeholder:text-slate-500 border border-slate-400 rounded-lg px-3 py-2 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15"
            data-testid="add-comment-input"
          />
          {/* Its two states are stated as colours, never as an opacity: a
              faded icon is a pair no measurement can name (it read about
              1.3:1). The classes are chosen here rather than by `disabled:`
              variants, so a test measures the look each state paints. */}
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            className={`w-9 h-9 shrink-0 flex items-center justify-center rounded-full transition ${canSend ? 'bg-indigo-600 text-white hover:bg-indigo-700 motion-safe:active:scale-[0.97]' : 'bg-slate-200 text-slate-500 cursor-not-allowed'}`}
            title={t('session.comments.sendTitle')}
            data-testid="submit-comment-btn"
            aria-label={t('session.comments.sendAria')}
          >
            <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">send</span>
          </button>
        </div>
      </>
    </ModalDialog>
  );
};

export default TicketCommentsModal;
