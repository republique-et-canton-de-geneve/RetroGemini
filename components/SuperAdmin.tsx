import React, { useState, useEffect } from 'react';
import { Team, TeamFeedback } from '../types';
import { dataService } from '../services/dataService';

interface Props {
  superAdminPassword: string;
  onExit: () => void;
  onAccessTeam: (team: Team) => void;
}

const SuperAdmin: React.FC<Props> = ({ superAdminPassword, onExit, onAccessTeam }) => {
  const [tab, setTab] = useState<'TEAMS' | 'FEEDBACKS'>('TEAMS');
  const [teams, setTeams] = useState<Team[]>([]);
  const [feedbacks, setFeedbacks] = useState<TeamFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedFeedback, setSelectedFeedback] = useState<TeamFeedback | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'unread' | 'bug' | 'feature'>('all');

  useEffect(() => {
    loadTeams();
    loadFeedbacks();
  }, []);

  const loadTeams = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/super-admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword })
      });
      if (!response.ok) {
        throw new Error('Failed to load teams');
      }
      const data = await response.json();
      setTeams(data.teams || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load teams');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateEmail = async (teamId: string) => {
    setError('');
    setSuccessMessage('');
    try {
      const response = await fetch('/api/super-admin/update-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: superAdminPassword,
          teamId,
          facilitatorEmail: editEmail
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update email');
      }

      setSuccessMessage('Email updated successfully');
      setEditingTeamId(null);
      setEditEmail('');

      // Reload teams to get updated data
      await loadTeams();

      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update email');
    }
  };

  const startEditEmail = (team: Team) => {
    setEditingTeamId(team.id);
    setEditEmail(team.facilitatorEmail || '');
  };

  const cancelEdit = () => {
    setEditingTeamId(null);
    setEditEmail('');
    setError('');
  };

  const loadFeedbacks = () => {
    const allFeedbacks = dataService.getAllFeedbacks();
    setFeedbacks(allFeedbacks);
  };

  const handleDeleteFeedback = (feedback: TeamFeedback) => {
    if (confirm(`Are you sure you want to delete this feedback from "${feedback.teamName}"?`)) {
      dataService.deleteTeamFeedback(feedback.teamId, feedback.id);
      loadFeedbacks();
      setSuccessMessage('Feedback deleted successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  };

  const handleMarkAsRead = (feedback: TeamFeedback) => {
    dataService.markFeedbackAsRead(feedback.teamId, feedback.id);
    loadFeedbacks();
  };

  const handleUpdateFeedbackStatus = (feedback: TeamFeedback, status: TeamFeedback['status']) => {
    dataService.updateTeamFeedback(feedback.teamId, feedback.id, { status });
    loadFeedbacks();
  };

  const handleUpdateAdminNotes = (feedback: TeamFeedback, notes: string) => {
    dataService.updateTeamFeedback(feedback.teamId, feedback.id, { adminNotes: notes });
    loadFeedbacks();
    setSelectedFeedback(null);
    setSuccessMessage('Notes updated successfully');
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const getFilteredFeedbacks = () => {
    return feedbacks.filter(f => {
      if (feedbackFilter === 'unread') return !f.isRead;
      if (feedbackFilter === 'bug') return f.type === 'bug';
      if (feedbackFilter === 'feature') return f.type === 'feature';
      return true;
    });
  };

  const unreadCount = feedbacks.filter(f => !f.isRead).length;

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

  const getStatusBadge = (status: TeamFeedback['status']) => {
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

  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center">
              <span className="material-symbols-outlined mr-3 text-red-600">shield_person</span>
              Super Admin Dashboard
            </h1>
            <p className="text-slate-500 text-sm mt-1">Manage all teams and recovery emails</p>
          </div>
          <button
            onClick={onExit}
            className="bg-slate-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-slate-700 flex items-center"
          >
            <span className="material-symbols-outlined mr-2">logout</span>
            Exit Admin Mode
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4 flex items-center">
            <span className="material-symbols-outlined mr-2">error</span>
            {error}
          </div>
        )}

        {successMessage && (
          <div className="bg-green-50 text-green-700 p-4 rounded-lg mb-4 flex items-center">
            <span className="material-symbols-outlined mr-2">check_circle</span>
            {successMessage}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-slate-200 mb-6">
          <button
            onClick={() => setTab('TEAMS')}
            className={`px-6 py-3 font-bold text-sm flex items-center transition ${
              tab === 'TEAMS'
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-slate-500 hover:text-indigo-600'
            }`}
          >
            <span className="material-symbols-outlined mr-2">groups</span>
            Teams ({teams.length})
          </button>
          <button
            onClick={() => setTab('FEEDBACKS')}
            className={`px-6 py-3 font-bold text-sm flex items-center transition relative ${
              tab === 'FEEDBACKS'
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-slate-500 hover:text-indigo-600'
            }`}
          >
            <span className="material-symbols-outlined mr-2">feedback</span>
            Feedback ({feedbacks.length})
            {unreadCount > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        {loading && tab === 'TEAMS' ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="text-slate-500 mt-4">Loading teams...</p>
          </div>
        ) : tab === 'TEAMS' ? (
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white p-4">
              <h2 className="text-xl font-bold">Teams ({teams.length})</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-4 font-bold text-slate-700">Team Name</th>
                    <th className="text-left p-4 font-bold text-slate-700">Members</th>
                    <th className="text-left p-4 font-bold text-slate-700">Recovery Email</th>
                    <th className="text-left p-4 font-bold text-slate-700">Last Active</th>
                    <th className="text-right p-4 font-bold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-4">
                        <div className="font-bold text-slate-800">{team.name}</div>
                        <div className="text-xs text-slate-400">ID: {team.id}</div>
                      </td>
                      <td className="p-4 text-slate-600">
                        {team.members.length} member{team.members.length !== 1 ? 's' : ''}
                      </td>
                      <td className="p-4">
                        {editingTeamId === team.id ? (
                          <div className="flex gap-2">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                              placeholder="email@example.com"
                              autoFocus
                            />
                            <button
                              onClick={() => handleUpdateEmail(team.id)}
                              className="bg-green-600 text-white px-3 py-1 rounded text-sm hover:bg-green-700"
                            >
                              Save
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="bg-slate-400 text-white px-3 py-1 rounded text-sm hover:bg-slate-500"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {team.facilitatorEmail ? (
                              <span className="text-slate-700">{team.facilitatorEmail}</span>
                            ) : (
                              <span className="text-slate-400 italic">Not configured</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-slate-600 text-sm">
                        {team.lastConnectionDate
                          ? new Date(team.lastConnectionDate).toLocaleDateString()
                          : 'Never'}
                      </td>
                      <td className="p-4">
                        <div className="flex justify-end gap-2">
                          {editingTeamId !== team.id && (
                            <>
                              <button
                                onClick={() => startEditEmail(team)}
                                className="text-indigo-600 hover:text-indigo-800 px-3 py-1 rounded border border-indigo-600 hover:bg-indigo-50 text-sm font-medium"
                                title="Edit recovery email"
                              >
                                Edit Email
                              </button>
                              <button
                                onClick={() => onAccessTeam(team)}
                                className="bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 text-sm font-medium"
                                title="Access team dashboard"
                              >
                                Access Team
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {teams.length === 0 && (
                <div className="text-center py-12 text-slate-400">
                  <span className="material-symbols-outlined text-6xl mb-4 opacity-50">groups_off</span>
                  <p>No teams found</p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Feedbacks Tab */}
        {tab === 'FEEDBACKS' && (
          <div>
            {/* Filters */}
            <div className="mb-6 flex gap-2">
              <button
                onClick={() => setFeedbackFilter('all')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                All ({feedbacks.length})
              </button>
              <button
                onClick={() => setFeedbackFilter('unread')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'unread'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Unread ({unreadCount})
              </button>
              <button
                onClick={() => setFeedbackFilter('bug')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'bug'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Bugs ({feedbacks.filter(f => f.type === 'bug').length})
              </button>
              <button
                onClick={() => setFeedbackFilter('feature')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'feature'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                Features ({feedbacks.filter(f => f.type === 'feature').length})
              </button>
            </div>

            {/* Feedbacks List */}
            <div className="space-y-4">
              {getFilteredFeedbacks().length === 0 ? (
                <div className="bg-white rounded-xl shadow p-12 text-center text-slate-400">
                  <span className="material-symbols-outlined text-6xl mb-4 opacity-50">feedback</span>
                  <p>No feedback to display</p>
                </div>
              ) : (
                getFilteredFeedbacks().map((feedback) => (
                  <div
                    key={feedback.id}
                    className={`bg-white rounded-xl shadow-md p-6 ${
                      !feedback.isRead ? 'border-l-4 border-l-indigo-600' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        {getTypeBadge(feedback.type)}
                        {getStatusBadge(feedback.status)}
                        {!feedback.isRead && (
                          <span className="px-2 py-1 text-xs rounded-full bg-indigo-100 text-indigo-800">
                            New
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
                            className="w-32 h-32 object-cover rounded cursor-pointer hover:opacity-80"
                            onClick={() => window.open(img, '_blank')}
                          />
                        ))}
                      </div>
                    )}

                    <div className="text-sm text-slate-500 mb-3">
                      Team: <span className="font-semibold">{feedback.teamName}</span>
                    </div>

                    {feedback.adminNotes && (
                      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded">
                        <p className="text-sm font-medium text-amber-800 mb-1">Your notes:</p>
                        <p className="text-sm text-amber-700">{feedback.adminNotes}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      {!feedback.isRead && (
                        <button
                          onClick={() => handleMarkAsRead(feedback)}
                          className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded text-sm font-medium hover:bg-indigo-200"
                        >
                          Mark as Read
                        </button>
                      )}

                      <select
                        value={feedback.status}
                        onChange={(e) =>
                          handleUpdateFeedbackStatus(feedback, e.target.value as TeamFeedback['status'])
                        }
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded text-sm"
                      >
                        <option value="pending">Pending</option>
                        <option value="in_progress">In Progress</option>
                        <option value="resolved">Resolved</option>
                        <option value="rejected">Rejected</option>
                      </select>

                      <button
                        onClick={() => setSelectedFeedback(feedback)}
                        className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded text-sm font-medium hover:bg-blue-200"
                      >
                        Add/Edit Notes
                      </button>

                      <button
                        onClick={() => handleDeleteFeedback(feedback)}
                        className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Admin Notes Modal */}
        {selectedFeedback && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6">
              <h3 className="text-xl font-bold text-slate-800 mb-4">Admin Notes</h3>
              <p className="text-sm text-slate-600 mb-4">
                Feedback: <span className="font-semibold">{selectedFeedback.title}</span>
              </p>
              <textarea
                defaultValue={selectedFeedback.adminNotes || ''}
                placeholder="Add your notes here..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                rows={6}
                id="admin-notes-input"
              />
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    const input = document.getElementById('admin-notes-input') as HTMLTextAreaElement;
                    handleUpdateAdminNotes(selectedFeedback, input.value);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  Save
                </button>
                <button
                  onClick={() => setSelectedFeedback(null)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperAdmin;
