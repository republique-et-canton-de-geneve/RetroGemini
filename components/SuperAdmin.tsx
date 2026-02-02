import React, { useState, useEffect, useRef } from 'react';
import { Team, TeamFeedback, ActiveSession, ServerLogEntry } from '../types';

interface Props {
  superAdminPassword: string;
  onExit: () => void;
}

type TabType = 'TEAMS' | 'FEEDBACKS' | 'LIVE' | 'LOGS';

const SuperAdmin: React.FC<Props> = ({ superAdminPassword, onExit }) => {
  const [tab, setTab] = useState<TabType>('TEAMS');
  const [teams, setTeams] = useState<Team[]>([]);
  const [feedbacks, setFeedbacks] = useState<TeamFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editingPasswordTeamId, setEditingPasswordTeamId] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editingNameTeamId, setEditingNameTeamId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedFeedback, setSelectedFeedback] = useState<TeamFeedback | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'unread' | 'bug' | 'feature'>('all');
  const [backupDownloading, setBackupDownloading] = useState(false);
  const [restoreUploading, setRestoreUploading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [infoMessageSaving, setInfoMessageSaving] = useState(false);

  // Admin email notification settings
  const [adminEmail, setAdminEmail] = useState('');
  const [adminEmailSaving, setAdminEmailSaving] = useState(false);

  // Live sessions monitoring
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const [liveLoading, setLiveLoading] = useState(false);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Server logs
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<{ level?: string; source?: string }>({});

  const getRateLimitMessage = async (response: Response) => {
    if (response.status !== 429) return null;
    const data = await response.json().catch(() => null);
    const retryAfter = data?.retryAfter ? ` Try again in ${data.retryAfter}.` : ' Try again later.';
    return `Too many attempts.${retryAfter}`;
  };

  useEffect(() => {
    loadTeams();
    loadFeedbacks();
    loadInfoMessage();
    loadAdminEmail();
  }, []);

  // Handle tab changes for live refresh
  useEffect(() => {
    if (tab === 'LIVE') {
      loadActiveSessions();
      // Set up polling for live sessions (every 5 seconds)
      liveIntervalRef.current = setInterval(loadActiveSessions, 5000);
    } else {
      // Clear interval when leaving LIVE tab
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    }

    if (tab === 'LOGS') {
      loadServerLogs();
    }

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
      }
    };
  }, [tab]);

  const loadInfoMessage = async () => {
    try {
      const response = await fetch('/api/info-message');
      if (response.ok) {
        const data = await response.json();
        setInfoMessage(data.infoMessage || '');
      }
    } catch (err) {
      console.error('Failed to load info message', err);
    }
  };

  const handleSaveInfoMessage = async () => {
    setError('');
    setSuccessMessage('');
    setInfoMessageSaving(true);

    try {
      const response = await fetch('/api/super-admin/info-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword, infoMessage })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to save info message');
      }

      setSuccessMessage('Info message updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save info message');
    } finally {
      setInfoMessageSaving(false);
    }
  };

  const loadAdminEmail = async () => {
    try {
      const response = await fetch('/api/super-admin/admin-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword })
      });
      if (response.ok) {
        const data = await response.json();
        setAdminEmail(data.adminEmail || '');
      }
    } catch (err) {
      console.error('Failed to load admin email', err);
    }
  };

  const handleSaveAdminEmail = async () => {
    setError('');
    setSuccessMessage('');
    setAdminEmailSaving(true);

    try {
      const response = await fetch('/api/super-admin/update-admin-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword, adminEmail })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to save admin email');
      }

      setSuccessMessage('Admin email updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to save admin email');
    } finally {
      setAdminEmailSaving(false);
    }
  };

  const loadActiveSessions = async () => {
    if (liveLoading) return;
    setLiveLoading(true);

    try {
      const response = await fetch('/api/super-admin/active-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword })
      });

      if (response.ok) {
        const data = await response.json();
        setActiveSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to load active sessions', err);
    } finally {
      setLiveLoading(false);
    }
  };

  const loadServerLogs = async () => {
    setLogsLoading(true);

    try {
      const response = await fetch('/api/super-admin/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword, filter: logFilter })
      });

      if (response.ok) {
        const data = await response.json();
        setServerLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to load server logs', err);
    } finally {
      setLogsLoading(false);
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('Are you sure you want to clear all server logs?')) return;

    try {
      const response = await fetch('/api/super-admin/clear-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword })
      });

      if (response.ok) {
        setServerLogs([]);
        setSuccessMessage('Server logs cleared');
        setTimeout(() => setSuccessMessage(''), 3000);
      }
    } catch (err) {
      console.error('Failed to clear logs', err);
    }
  };

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
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
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
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
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

  const handleUpdatePassword = async (teamId: string) => {
    setError('');
    setSuccessMessage('');

    if (editPassword.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    try {
      const response = await fetch('/api/super-admin/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: superAdminPassword,
          teamId,
          newPassword: editPassword
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to update password');
      }

      setSuccessMessage('Password updated successfully');
      setEditingPasswordTeamId(null);
      setEditPassword('');

      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update password');
    }
  };

  const handleRenameTeam = async (teamId: string) => {
    setError('');
    setSuccessMessage('');

    if (!editName.trim()) {
      setError('Team name cannot be empty');
      return;
    }

    try {
      const response = await fetch('/api/super-admin/rename-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: superAdminPassword,
          teamId,
          newName: editName.trim()
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        if (response.status === 409) {
          throw new Error('A team with this name already exists');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to rename team');
      }

      setSuccessMessage('Team renamed successfully');
      setEditingNameTeamId(null);
      setEditName('');

      // Reload teams to get updated data
      await loadTeams();

      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to rename team');
    }
  };

  const startEditEmail = (team: Team) => {
    setEditingTeamId(team.id);
    setEditEmail(team.facilitatorEmail || '');
    setEditingPasswordTeamId(null);
    setEditPassword('');
    setEditingNameTeamId(null);
    setEditName('');
  };

  const startEditPassword = (team: Team) => {
    setEditingPasswordTeamId(team.id);
    setEditPassword('');
    setEditingTeamId(null);
    setEditEmail('');
    setEditingNameTeamId(null);
    setEditName('');
  };

  const startEditName = (team: Team) => {
    setEditingNameTeamId(team.id);
    setEditName(team.name);
    setEditingTeamId(null);
    setEditEmail('');
    setEditingPasswordTeamId(null);
    setEditPassword('');
  };

  const cancelEdit = () => {
    setEditingTeamId(null);
    setEditEmail('');
    setEditingPasswordTeamId(null);
    setEditPassword('');
    setEditingNameTeamId(null);
    setEditName('');
    setError('');
  };

  const loadFeedbacks = async () => {
    try {
      const response = await fetch('/api/super-admin/feedbacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to load feedbacks');
      }

      const data = await response.json();
      setFeedbacks(data.feedbacks || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load feedbacks');
    }
  };

  const updateFeedback = async (feedback: TeamFeedback, updates: Partial<TeamFeedback>) => {
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/super-admin/feedbacks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: superAdminPassword,
          teamId: feedback.teamId,
          feedbackId: feedback.id,
          updates
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to update feedback');
      }

      await loadFeedbacks();
    } catch (err: any) {
      setError(err.message || 'Failed to update feedback');
    }
  };

  const deleteFeedback = async (feedback: TeamFeedback) => {
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch('/api/super-admin/feedbacks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password: superAdminPassword,
          teamId: feedback.teamId,
          feedbackId: feedback.id
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to delete feedback');
      }

      await loadFeedbacks();
      setSuccessMessage('Feedback deleted successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete feedback');
    }
  };

  const handleDeleteFeedback = (feedback: TeamFeedback) => {
    if (confirm(`Are you sure you want to delete this feedback from "${feedback.teamName}"?`)) {
      deleteFeedback(feedback);
    }
  };

  const handleMarkAsRead = (feedback: TeamFeedback) => {
    updateFeedback(feedback, { isRead: true });
  };

  const handleUpdateFeedbackStatus = (feedback: TeamFeedback, status: TeamFeedback['status']) => {
    updateFeedback(feedback, { status });
  };

  const handleUpdateAdminNotes = (feedback: TeamFeedback, notes: string) => {
    updateFeedback(feedback, { adminNotes: notes }).then(() => {
      setSelectedFeedback(null);
      setSuccessMessage('Notes updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    });
  };

  const extractFilenameFromHeader = (header: string | null) => {
    if (!header) return null;
    const match = /filename="(?<quoted>[^"]+)"|filename=(?<unquoted>[^;]+)/.exec(header);
    return match?.groups?.quoted || match?.groups?.unquoted || null;
  };

  const handleDownloadBackup = async () => {
    setError('');
    setSuccessMessage('');
    setBackupDownloading(true);

    try {
      const response = await fetch('/api/super-admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: superAdminPassword })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        if (response.status === 404) {
          throw new Error('Backup data directory not found.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to generate backup.');
      }

      const blob = await response.blob();
      const headerFilename = extractFilenameFromHeader(response.headers.get('Content-Disposition'));
      const fallbackFilename = `retrogemini-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`;
      const filename = headerFilename || fallbackFilename;

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      setSuccessMessage('Backup downloaded successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to download backup');
    } finally {
      setBackupDownloading(false);
    }
  };

  const handleRestoreBackup = async () => {
    setError('');
    setSuccessMessage('');

    if (!restoreFile) {
      setError('Please select a backup archive to upload.');
      return;
    }

    setRestoreUploading(true);

    try {
      const response = await fetch('/api/super-admin/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/gzip',
          'x-super-admin-password': superAdminPassword
        },
        body: restoreFile
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Super admin session expired. Please log in again.');
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new Error(rateLimitMessage);
        }
        throw new Error('Failed to restore backup.');
      }

      setSuccessMessage('Backup restored successfully. Refresh the page to load updated data.');
      setRestoreFile(null);
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err: any) {
      setError(err.message || 'Failed to restore backup.');
    } finally {
      setRestoreUploading(false);
    }
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

        {/* Info Message Configuration */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500">campaign</span>
                Info Message
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Display an important announcement visible on the team selection page and team dashboards.
                Leave empty to hide the message.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <textarea
                value={infoMessage}
                onChange={(e) => setInfoMessage(e.target.value)}
                placeholder="e.g., Scheduled maintenance on Sunday from 2-4 AM..."
                className="w-full border border-slate-300 rounded-lg p-3 text-sm resize-none h-24 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
              />
              {infoMessage && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-amber-700 mb-1">Preview:</p>
                  <div className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">info</span>
                    <p className="text-sm text-amber-800 whitespace-pre-wrap">{infoMessage}</p>
                  </div>
                </div>
              )}
              <div className="flex justify-end">
                <button
                  onClick={handleSaveInfoMessage}
                  disabled={infoMessageSaving}
                  className={`px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                    infoMessageSaving
                      ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">
                    {infoMessageSaving ? 'sync' : 'save'}
                  </span>
                  {infoMessageSaving ? 'Saving...' : 'Save Message'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Admin Email Notification Configuration */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="material-symbols-outlined text-green-600">mail</span>
                Feedback Notifications
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Configure email notifications when users submit feedback (bug reports or feature requests).
                Requires SMTP to be configured on the server.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-slate-700">Admin Email Address</label>
                <input
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="w-full md:w-96 border border-slate-300 rounded-lg px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none"
                />
                <p className="text-xs text-slate-400">
                  Leave empty to disable email notifications for new feedback.
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSaveAdminEmail}
                  disabled={adminEmailSaving}
                  className={`px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                    adminEmailSaving
                      ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      : 'bg-green-600 text-white hover:bg-green-700'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">
                    {adminEmailSaving ? 'sync' : 'save'}
                  </span>
                  {adminEmailSaving ? 'Saving...' : 'Save Email'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-600">cloud_download</span>
                Backup Data
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                Download a full archive of the <code className="text-slate-700">/data</code> folder for
                local recovery or migration.
              </p>
            </div>
            <button
              onClick={handleDownloadBackup}
              disabled={backupDownloading}
              className={`px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                backupDownloading
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              <span className="material-symbols-outlined text-base">
                {backupDownloading ? 'sync' : 'download'}
              </span>
              {backupDownloading ? 'Preparing Backup...' : 'Download Backup'}
            </button>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-500">warning</span>
                  Restore Data
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Upload a previously downloaded <code className="text-slate-700">.tar.gz</code> backup
                  archive to restore the <code className="text-slate-700">/data</code> folder.
                </p>
              </div>
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
                <strong>Warning:</strong> Restoring a backup will overwrite the current data. Download a
                backup first if you might need to roll back.
              </div>
              <div className="flex flex-col gap-3 md:flex-row md:items-center">
                <input
                  type="file"
                  accept=".tar.gz,application/gzip"
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setRestoreFile(file);
                  }}
                  className="flex-1 text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
                />
                <button
                  onClick={handleRestoreBackup}
                  disabled={restoreUploading || !restoreFile}
                  className={`px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                    restoreUploading || !restoreFile
                      ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      : 'bg-amber-500 text-white hover:bg-amber-600'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">
                    {restoreUploading ? 'sync' : 'upload'}
                  </span>
                  {restoreUploading ? 'Restoring...' : 'Upload & Restore'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 mb-6 flex-wrap">
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
          <button
            onClick={() => setTab('LIVE')}
            className={`px-6 py-3 font-bold text-sm flex items-center transition ${
              tab === 'LIVE'
                ? 'border-b-2 border-green-600 text-green-600'
                : 'text-slate-500 hover:text-green-600'
            }`}
          >
            <span className="material-symbols-outlined mr-2">stream</span>
            Live Sessions
            {activeSessions.length > 0 && (
              <span className="ml-2 bg-green-500 text-white text-xs rounded-full px-2 py-0.5 animate-pulse">
                {activeSessions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('LOGS')}
            className={`px-6 py-3 font-bold text-sm flex items-center transition ${
              tab === 'LOGS'
                ? 'border-b-2 border-orange-600 text-orange-600'
                : 'text-slate-500 hover:text-orange-600'
            }`}
          >
            <span className="material-symbols-outlined mr-2">terminal</span>
            Server Logs
            {serverLogs.filter(l => l.level === 'error').length > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                {serverLogs.filter(l => l.level === 'error').length}
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
                        {editingNameTeamId === team.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                              placeholder="Team name"
                              autoFocus
                            />
                            <button
                              onClick={() => handleRenameTeam(team.id)}
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
                          <>
                            <div className="font-bold text-slate-800">{team.name}</div>
                            <div className="text-xs text-slate-400">ID: {team.id}</div>
                          </>
                        )}
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
                        <div className="flex flex-col gap-2">
                          {editingPasswordTeamId === team.id ? (
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={editPassword}
                                onChange={(e) => setEditPassword(e.target.value)}
                                className="flex-1 border border-slate-300 rounded px-2 py-1 text-sm"
                                placeholder="New password (min 4 chars)"
                                autoFocus
                              />
                              <button
                                onClick={() => handleUpdatePassword(team.id)}
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
                          ) : editingTeamId !== team.id && editingNameTeamId !== team.id && (
                            <div className="flex justify-end gap-2 flex-wrap">
                              <button
                                onClick={() => startEditName(team)}
                                className="text-purple-600 hover:text-purple-800 px-3 py-1 rounded border border-purple-600 hover:bg-purple-50 text-sm font-medium"
                                title="Rename team"
                              >
                                Rename
                              </button>
                              <button
                                onClick={() => startEditPassword(team)}
                                className="text-amber-600 hover:text-amber-800 px-3 py-1 rounded border border-amber-600 hover:bg-amber-50 text-sm font-medium"
                                title="Change team password"
                              >
                                Change Password
                              </button>
                              <button
                                onClick={() => startEditEmail(team)}
                                className="text-indigo-600 hover:text-indigo-800 px-3 py-1 rounded border border-indigo-600 hover:bg-indigo-50 text-sm font-medium"
                                title="Edit recovery email"
                              >
                                Edit Email
                              </button>
                            </div>
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

        {/* Live Sessions Tab */}
        {tab === 'LIVE' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-slate-700">Active Sessions</h2>
                {liveLoading && (
                  <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-green-600"></span>
                )}
              </div>
              <button
                onClick={loadActiveSessions}
                className="px-3 py-1.5 bg-green-100 text-green-700 rounded text-sm font-medium hover:bg-green-200 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                Refresh
              </button>
            </div>

            {activeSessions.length === 0 ? (
              <div className="bg-white rounded-xl shadow p-12 text-center">
                <span className="material-symbols-outlined text-6xl mb-4 text-slate-300">cloud_off</span>
                <p className="text-slate-500 text-lg">No active sessions</p>
                <p className="text-slate-400 text-sm mt-2">
                  Sessions will appear here when users join a retrospective or health check.
                </p>
                <div className="mt-6 p-4 bg-green-50 rounded-lg text-sm text-green-700">
                  <span className="material-symbols-outlined text-base align-middle mr-1">check_circle</span>
                  Safe to deploy - no active sessions
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-amber-600 mt-0.5">warning</span>
                  <div>
                    <p className="text-amber-800 font-medium">Active sessions detected</p>
                    <p className="text-amber-700 text-sm mt-1">
                      {activeSessions.length} session(s) with {activeSessions.reduce((sum, s) => sum + s.connectedCount, 0)} connected user(s).
                      Consider waiting before deploying to avoid interrupting these sessions.
                    </p>
                  </div>
                </div>

                {activeSessions.map((session) => (
                  <div key={session.sessionId} className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`material-symbols-outlined text-lg ${
                            session.type === 'healthcheck' ? 'text-emerald-600' : 'text-indigo-600'
                          }`}>
                            {session.type === 'healthcheck' ? 'health_and_safety' : 'psychology'}
                          </span>
                          <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                            session.type === 'healthcheck'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}>
                            {session.type === 'healthcheck' ? 'Health Check' : 'Retrospective'}
                          </span>
                          <span className="flex items-center gap-1 text-green-600">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-xs font-medium">LIVE</span>
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">{session.sessionName}</h3>
                        <p className="text-sm text-slate-500">Team: {session.teamName}</p>
                      </div>
                      <div className="text-right">
                        <div className="bg-slate-100 rounded-lg px-3 py-2">
                          <p className="text-2xl font-bold text-slate-800">{session.connectedCount}</p>
                          <p className="text-xs text-slate-500">Connected</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-slate-400">flag</span>
                        <span className="text-sm text-slate-600">Phase: <span className="font-medium">{session.phase}</span></span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-slate-400">schedule</span>
                        <span className="text-sm text-slate-600">Status: <span className="font-medium">{session.status}</span></span>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                      <p className="text-xs text-slate-500 mb-2">Connected Participants:</p>
                      <div className="flex flex-wrap gap-2">
                        {session.participants.map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-1 px-2 py-1 bg-slate-100 rounded-full text-sm text-slate-700"
                          >
                            <span className="material-symbols-outlined text-sm">person</span>
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Server Logs Tab */}
        {tab === 'LOGS' && (
          <div>
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-slate-700">Server Logs</h2>
                {logsLoading && (
                  <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600"></span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={loadServerLogs}
                  className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded text-sm font-medium hover:bg-orange-200 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base">refresh</span>
                  Refresh
                </button>
                <button
                  onClick={handleClearLogs}
                  className="px-3 py-1.5 bg-red-100 text-red-700 rounded text-sm font-medium hover:bg-red-200 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                  Clear Logs
                </button>
              </div>
            </div>

            {/* Log Filters */}
            <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">Level:</label>
                <select
                  value={logFilter.level || ''}
                  onChange={(e) => {
                    setLogFilter({ ...logFilter, level: e.target.value || undefined });
                    setTimeout(loadServerLogs, 100);
                  }}
                  className="border border-slate-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">All Levels</option>
                  <option value="error">Errors</option>
                  <option value="warn">Warnings</option>
                  <option value="info">Info</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-slate-600">Source:</label>
                <select
                  value={logFilter.source || ''}
                  onChange={(e) => {
                    setLogFilter({ ...logFilter, source: e.target.value || undefined });
                    setTimeout(loadServerLogs, 100);
                  }}
                  className="border border-slate-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">All Sources</option>
                  <option value="postgres">PostgreSQL</option>
                  <option value="server">Server</option>
                  <option value="socket">Socket.IO</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="text-sm text-slate-500 ml-auto">
                {serverLogs.length} log entries
              </div>
            </div>

            {serverLogs.length === 0 ? (
              <div className="bg-white rounded-xl shadow p-12 text-center">
                <span className="material-symbols-outlined text-6xl mb-4 text-slate-300">article</span>
                <p className="text-slate-500 text-lg">No logs to display</p>
                <p className="text-slate-400 text-sm mt-2">
                  Server errors and warnings will appear here when they occur.
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left p-3 font-semibold text-slate-600 w-40">Timestamp</th>
                        <th className="text-left p-3 font-semibold text-slate-600 w-20">Level</th>
                        <th className="text-left p-3 font-semibold text-slate-600 w-24">Source</th>
                        <th className="text-left p-3 font-semibold text-slate-600">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {serverLogs.map((log) => (
                        <tr
                          key={log.id}
                          className={`border-b border-slate-100 hover:bg-slate-50 ${
                            log.level === 'error' ? 'bg-red-50' : log.level === 'warn' ? 'bg-amber-50' : ''
                          }`}
                        >
                          <td className="p-3 text-slate-500 font-mono text-xs whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              log.level === 'error'
                                ? 'bg-red-100 text-red-700'
                                : log.level === 'warn'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {log.level}
                            </span>
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                              log.source === 'postgres'
                                ? 'bg-indigo-100 text-indigo-700'
                                : log.source === 'socket'
                                ? 'bg-purple-100 text-purple-700'
                                : log.source === 'email'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                              {log.source}
                            </span>
                          </td>
                          <td className="p-3 text-slate-700 font-mono text-xs break-all">
                            {log.message}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
