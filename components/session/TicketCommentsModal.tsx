
import React, { useState, useRef, useEffect } from 'react';
import { Ticket, TicketComment, User } from '../../types';

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
}

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
}) => {
  const [commentText, setCommentText] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={handleOverlayClick}
      data-testid="ticket-comments-modal"
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
        {/* Ticket content header */}
        <div
          className={`p-4 border-b ${!cardBgHex ? 'bg-slate-50' : ''}`}
          style={cardBgHex ? { backgroundColor: cardBgHex } : undefined}
        >
          <div className="flex items-start justify-between">
            <div className={`text-sm whitespace-pre-wrap wrap-break-word flex-1 ${cardBgHex ? cardTextColor : 'text-slate-900'}`}>
              {ticket.text}
            </div>
            <button
              onClick={onClose}
              className={`ml-3 p-1 rounded-full hover:bg-black/10 transition shrink-0 ${cardBgHex ? cardTextColor : 'text-slate-400'}`}
              title="Close"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
          {!isAnonymous && author && (
            <div className="mt-2 flex items-center text-xs opacity-70">
              <div className={`w-5 h-5 rounded-full ${author.color} text-white flex items-center justify-center text-[9px] font-bold mr-1.5`}>
                {author.name.substring(0, 2).toUpperCase()}
              </div>
              <span className={cardBgHex ? cardTextColor : 'text-slate-500'}>{author.name}</span>
            </div>
          )}
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {comments.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-6">
              No comments yet. Be the first to comment!
            </div>
          )}
          {comments.map(comment => {
            const commentAuthor = getCommentAuthor(comment);
            const isMine = comment.authorId === currentUser.id;
            const canModify = isMine || isFacilitator;
            const isEditing = editingCommentId === comment.id;

            return (
              <div key={comment.id} className="flex items-start space-x-2 group" data-testid="ticket-comment">
                <div className={`w-7 h-7 rounded-full ${commentAuthor?.color || 'bg-slate-400'} text-white flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5`}>
                  {(commentAuthor?.name || comment.authorName).substring(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-slate-700">
                      {commentAuthor?.name || comment.authorName}
                    </span>
                    <span className="text-[10px] text-slate-400">{formatTime(comment.createdAt)}</span>
                  </div>
                  {isEditing ? (
                    <div className="mt-1 flex items-center space-x-1">
                      <input
                        autoFocus
                        value={editingText}
                        onChange={e => setEditingText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleEditSubmit(comment.id);
                          if (e.key === 'Escape') { setEditingCommentId(null); setEditingText(''); }
                        }}
                        className="flex-1 text-sm border border-indigo-300 rounded-sm px-2 py-1 outline-hidden focus:ring-1 focus:ring-indigo-400"
                        data-testid="edit-comment-input"
                      />
                      <button
                        onClick={() => handleEditSubmit(comment.id)}
                        className="text-indigo-600 hover:text-indigo-800 p-1"
                        title="Save"
                      >
                        <span className="material-symbols-outlined text-sm">check</span>
                      </button>
                      <button
                        onClick={() => { setEditingCommentId(null); setEditingText(''); }}
                        className="text-slate-400 hover:text-slate-600 p-1"
                        title="Cancel"
                      >
                        <span className="material-symbols-outlined text-sm">close</span>
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-slate-700 mt-0.5 wrap-break-word" data-testid="comment-text">
                      {comment.text}
                    </div>
                  )}
                </div>
                {canModify && !isEditing && (
                  <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                    <button
                      onClick={() => { setEditingCommentId(comment.id); setEditingText(comment.text); }}
                      className="text-slate-300 hover:text-indigo-500 p-0.5"
                      title="Edit comment"
                      data-testid="edit-comment-btn"
                    >
                      <span className="material-symbols-outlined text-sm">edit</span>
                    </button>
                    <button
                      onClick={() => onDeleteComment(ticket.id, comment.id)}
                      className="text-slate-300 hover:text-red-500 p-0.5"
                      title="Delete comment"
                      data-testid="delete-comment-btn"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Comment input */}
        <div className="border-t p-3 flex items-center space-x-2 bg-slate-50">
          <div className={`w-7 h-7 rounded-full ${currentUser.color} text-white flex items-center justify-center text-[9px] font-bold shrink-0`}>
            {currentUser.name.substring(0, 2).toUpperCase()}
          </div>
          <input
            ref={inputRef}
            type="text"
            value={commentText}
            onChange={e => setCommentText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
            placeholder="Add a comment..."
            className="flex-1 text-sm border border-slate-200 rounded-full px-4 py-2 outline-hidden focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
            data-testid="add-comment-input"
          />
          <button
            onClick={handleSubmit}
            disabled={!commentText.trim()}
            className="text-indigo-600 hover:text-indigo-800 disabled:opacity-30 p-1 transition"
            title="Send"
            data-testid="submit-comment-btn"
          >
            <span className="material-symbols-outlined text-xl">send</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default TicketCommentsModal;
