import React, { useState, useEffect } from 'react';
import { TeamFeedback as TeamFeedbackType, FeedbackComment } from '../types';

interface TeamFeedbackProps {
  teamId: string;
  teamName: string;
  teamPassword: string;
  currentUserId: string;
  currentUserName: string;
  feedbacks: TeamFeedbackType[];
  onSubmitFeedback: (feedback: Omit<TeamFeedbackType, 'id' | 'submittedAt' | 'isRead' | 'status' | 'comments'>) => void;
  onRefresh: () => void;
}

type FilterType = 'all' | 'mine' | 'bug' | 'feature';
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'resolved' | 'rejected';

const TeamFeedback: React.FC<TeamFeedbackProps> = ({
  teamId,
  teamName,
  teamPassword,
  currentUserId,
  currentUserName,
  feedbacks: localFeedbacks,
  onSubmitFeedback,
  onRefresh
}) => {
  const [showForm, setShowForm] = useState(false);
  const [type, setType] = useState<'bug' | 'feature'>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // All feedbacks from all teams
  const [allFeedbacks, setAllFeedbacks] = useState<TeamFeedbackType[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Comment state
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

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
        body: JSON.stringify({ teamId, password: teamPassword })
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

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    setUploading(true);
    const newImages: string[] = [];

    Array.from(files).forEach((file, index) => {
      if (images.length + newImages.length >= 5) {
        alert('Maximum 5 images allowed');
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        alert(`Image ${file.name} is too large. Maximum 2MB per image.`);
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          newImages.push(event.target.result as string);
          if (index === files.length - 1) {
            setImages([...images, ...newImages]);
            setUploading(false);
          }
        }
      };
      reader.onerror = () => {
        alert('Error reading file');
        setUploading(false);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !description.trim()) {
      alert('Please fill in all fields');
      return;
    }

    onSubmitFeedback({
      teamId,
      teamName,
      type,
      title: title.trim(),
      description: description.trim(),
      images: images.length > 0 ? images : undefined,
      submittedBy: currentUserId,
      submittedByName: currentUserName
    });

    // Reset form
    setTitle('');
    setDescription('');
    setImages([]);
    setShowForm(false);

    // Reload feedbacks after a short delay
    setTimeout(() => {
      loadAllFeedbacks();
      onRefresh();
    }, 500);
  };

  const handleAddComment = async (feedbackTeamId: string, feedbackId: string) => {
    if (!newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const response = await fetch('/api/feedbacks/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          password: teamPassword,
          feedbackTeamId,
          feedbackId,
          authorId: currentUserId,
          authorName: currentUserName,
          content: newComment.trim()
        })
      });
      if (response.ok) {
        setNewComment('');
        loadAllFeedbacks();
      }
    } catch (err) {
      console.error('Failed to add comment', err);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (feedbackTeamId: string, feedbackId: string, commentId: string) => {
    if (!confirm('Are you sure you want to delete this comment?')) return;

    try {
      const response = await fetch('/api/feedbacks/comment/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          password: teamPassword,
          feedbackTeamId,
          feedbackId,
          commentId
        })
      });
      if (response.ok) {
        loadAllFeedbacks();
      }
    } catch (err) {
      console.error('Failed to delete comment', err);
    }
  };

  const handleDeleteFeedback = async (feedbackId: string) => {
    if (!confirm('Are you sure you want to delete this feedback?')) return;

    try {
      const response = await fetch('/api/feedbacks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId,
          password: teamPassword,
          feedbackId
        })
      });
      if (response.ok) {
        loadAllFeedbacks();
        onRefresh();
      }
    } catch (err) {
      console.error('Failed to delete feedback', err);
    }
  };

  const formatDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getStatusBadge = (status: TeamFeedbackType['status']) => {
    const badges = {
      pending: { text: 'Pending', color: 'bg-yellow-100 text-yellow-800' },
      in_progress: { text: 'In Progress', color: 'bg-blue-100 text-blue-800' },
      resolved: { text: 'Resolved', color: 'bg-green-100 text-green-800' },
      rejected: { text: 'Rejected', color: 'bg-red-100 text-red-800' }
    };
    const badge = badges[status];
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${badge.color}`}>
        {badge.text}
      </span>
    );
  };

  const getTypeBadge = (feedbackType: 'bug' | 'feature') => {
    return feedbackType === 'bug' ? (
      <span className="px-2 py-1 text-xs rounded-full bg-red-100 text-red-800">
        <span className="material-symbols-outlined text-xs align-middle mr-1">bug_report</span>
        Bug
      </span>
    ) : (
      <span className="px-2 py-1 text-xs rounded-full bg-purple-100 text-purple-800">
        <span className="material-symbols-outlined text-xs align-middle mr-1">new_releases</span>
        Feature
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
          <h2 className="text-2xl font-bold text-slate-800">Feedback Hub</h2>
          <p className="text-sm text-slate-500 mt-1">
            Submit bugs and feature requests, and see what other teams have reported
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => loadAllFeedbacks()}
            className="px-3 py-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition flex items-center gap-1"
            title="Refresh"
          >
            <span className="material-symbols-outlined text-sm">refresh</span>
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            New Feedback
          </button>
        </div>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h3 className="text-lg font-semibold mb-4">Submit Feedback</h3>
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Type</label>
              <div className="flex gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="bug"
                    checked={type === 'bug'}
                    onChange={(e) => setType(e.target.value as 'bug' | 'feature')}
                    className="mr-2"
                  />
                  <span className="material-symbols-outlined text-red-600 mr-1">bug_report</span>
                  Bug
                </label>
                <label className="flex items-center cursor-pointer">
                  <input
                    type="radio"
                    value="feature"
                    checked={type === 'feature'}
                    onChange={(e) => setType(e.target.value as 'bug' | 'feature')}
                    className="mr-2"
                  />
                  <span className="material-symbols-outlined text-purple-600 mr-1">new_releases</span>
                  Feature Request
                </label>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Brief summary"
                maxLength={100}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="Describe the issue or feature request..."
                rows={5}
                maxLength={2000}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Images (max 5, 2MB per image)
              </label>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleImageUpload}
                disabled={uploading || images.length >= 5}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg"
              />
              {uploading && <p className="text-sm text-slate-500 mt-2">Uploading images...</p>}

              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {images.map((img, idx) => (
                    <div key={idx} className="relative">
                      <img src={img} alt={`Upload ${idx + 1}`} className="w-20 h-20 object-cover rounded-sm" />
                      <button
                        type="button"
                        onClick={() => handleRemoveImage(idx)}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition"
              >
                Submit
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setTitle('');
                  setDescription('');
                  setImages([]);
                }}
                className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300 transition"
              >
                Cancel
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
            All ({allFeedbacks.length})
          </button>
          <button
            onClick={() => setFilter('mine')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              filter === 'mine'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            My Team ({myFeedbacksCount})
          </button>
          <button
            onClick={() => setFilter('bug')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              filter === 'bug'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Bugs ({bugsCount})
          </button>
          <button
            onClick={() => setFilter('feature')}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              filter === 'feature'
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            Features ({featuresCount})
          </button>
        </div>

        {/* Status Filters */}
        <div className="flex gap-2 flex-wrap items-center">
          <span className="text-sm text-slate-500">Status:</span>
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
              {status === 'all' ? 'All' : status === 'in_progress' ? 'In Progress' : status.charAt(0).toUpperCase() + status.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-50 rounded-lg p-8 text-center text-slate-500">
          <span className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600 mr-2"></span>
          Loading feedbacks...
        </div>
      ) : (
        <div className="space-y-4">
          {filteredFeedbacks.length === 0 ? (
            <div className="bg-slate-50 rounded-lg p-8 text-center text-slate-500">
              No feedback matches the current filter
            </div>
          ) : (
            filteredFeedbacks.map((feedback) => (
              <div key={feedback.id} className={`bg-white rounded-lg shadow-md p-6 ${
                feedback.teamId === teamId ? 'border-l-4 border-l-indigo-500' : ''
              }`}>
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getTypeBadge(feedback.type)}
                    {getStatusBadge(feedback.status)}
                    {feedback.teamId === teamId && (
                      <span className="px-2 py-1 text-xs rounded-full bg-indigo-100 text-indigo-800">
                        My Team
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-slate-500">{formatDate(feedback.submittedAt)}</span>
                </div>

                <h3 className="text-lg font-semibold text-slate-800 mb-2">{feedback.title}</h3>
                <p className="text-slate-600 mb-3 whitespace-pre-wrap">{feedback.description}</p>

                {feedback.images && feedback.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {feedback.images.map((img, idx) => (
                      <img
                        key={idx}
                        src={img}
                        alt={`Feedback ${idx + 1}`}
                        className="w-32 h-32 object-cover rounded-sm cursor-pointer hover:opacity-80"
                        onClick={() => window.open(img, '_blank')}
                      />
                    ))}
                  </div>
                )}

                <div className="text-sm text-slate-500 mb-3">
                  <span className="material-symbols-outlined text-sm align-middle mr-1">groups</span>
                  Team: <span className="font-semibold">{feedback.teamName}</span>
                  {' · '}
                  Submitted by {feedback.submittedByName} on {formatDate(feedback.submittedAt).split(',')[0]}
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
                    Comments ({feedback.comments?.length || 0})
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
                                <span className={`font-medium ${comment.isAdmin ? 'text-amber-800' : 'text-slate-800'}`}>{comment.authorName}</span>
                                {!comment.isAdmin && (
                                  <>
                                    <span className="text-slate-400"> · </span>
                                    <span className="text-slate-500">{comment.teamName}</span>
                                  </>
                                )}
                                <span className="text-slate-400"> · </span>
                                <span className="text-slate-400">{formatDate(comment.createdAt)}</span>
                              </div>
                              {comment.teamId === teamId && !comment.isAdmin && (
                                <button
                                  onClick={() => handleDeleteComment(feedback.teamId, feedback.id, comment.id)}
                                  className="text-red-500 hover:text-red-700"
                                  title="Delete comment"
                                >
                                  <span className="material-symbols-outlined text-sm">delete</span>
                                </button>
                              )}
                            </div>
                            <p className={`text-sm mt-1 ${comment.isAdmin ? 'text-amber-700' : 'text-slate-700'}`}>{comment.content}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-400 italic">No comments yet</p>
                      )}

                      {/* Add comment form */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={expandedFeedback === feedback.id ? newComment : ''}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Add a comment..."
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
                          disabled={submittingComment || !newComment.trim()}
                          className="px-3 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                          {submittingComment ? '...' : 'Send'}
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
                      Delete feedback
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
