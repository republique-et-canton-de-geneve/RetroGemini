import React, { useState, useEffect, useRef } from 'react';
import {
  PASSWORD_MIN_LENGTH,
  isPasswordLongEnough
} from '../utils/passwordPolicy.js';
import { Team, TeamFeedback, ActiveSession, ServerLogEntry, BackupEntry, AiSettings } from '../types';
import ModalDialog from './common/ModalDialog';
import LanguageSwitcher from './common/LanguageSwitcher';
import { useTranslation } from '../i18n/I18nContext';
import { Notice, NoticeError, noticeFromError, noticeText } from '../i18n/notice';
import { localizeDecimal } from '../i18n/formatNumber';
import type { MessageKey } from '../i18n/translate';

// Codes the server stores and the console shows: named in the reader's
// language, and shown as they came when this build does not know them.
const LOG_LEVEL_KEYS: Record<string, MessageKey> = {
  error: 'adminLogs.level.error',
  warn: 'adminLogs.level.warn',
  info: 'adminLogs.level.info'
};
const LOG_SOURCE_KEYS: Record<string, MessageKey> = {
  postgres: 'adminLogs.source.postgres',
  server: 'adminLogs.source.server',
  socket: 'adminLogs.source.socket',
  email: 'adminLogs.source.email'
};
const BACKUP_TYPE_KEYS: Record<string, MessageKey> = {
  auto: 'adminBackups.type.auto',
  manual: 'adminBackups.type.manual',
  startup: 'adminBackups.type.startup'
};
const SESSION_STATUS_KEYS: Record<string, MessageKey> = {
  IN_PROGRESS: 'adminLive.statusValue.IN_PROGRESS',
  CLOSED: 'adminLive.statusValue.CLOSED'
};
const PHASE_KEYS: Record<string, MessageKey> = {
  ICEBREAKER: 'common.phase.ICEBREAKER',
  WELCOME: 'common.phase.WELCOME',
  OPEN_ACTIONS: 'common.phase.OPEN_ACTIONS',
  BRAINSTORM: 'common.phase.BRAINSTORM',
  GROUP: 'common.phase.GROUP',
  VOTE: 'common.phase.VOTE',
  DISCUSS: 'common.phase.DISCUSS',
  REVIEW: 'common.phase.REVIEW',
  CLOSE: 'common.phase.CLOSE',
  SURVEY: 'common.phase.SURVEY'
};
const FEEDBACK_STATUS_KEYS: Record<TeamFeedback['status'], MessageKey> = {
  pending: 'feedback.status.pending',
  in_progress: 'feedback.status.inProgress',
  resolved: 'feedback.status.resolved',
  rejected: 'feedback.status.rejected'
};
// The labels the server writes on the backups it makes itself, keyed by the
// kind it gives them. A manual checkpoint's label is the operator's text.
const SERVER_BACKUP_LABEL_KEYS: Record<string, Record<string, MessageKey>> = {
  startup: { 'Server startup': 'adminBackups.label.startup' },
  auto: { 'Pre-restore snapshot': 'adminBackups.label.preRestore' }
};

const keyFor = (keys: Record<string, MessageKey>, code: string): MessageKey | null =>
  Object.prototype.hasOwnProperty.call(keys, code) ? keys[code] : null;

interface Props {
  sessionToken: string;
  onExit: () => void;
}

type TabType = 'TEAMS' | 'FEEDBACKS' | 'LIVE' | 'LOGS' | 'BACKUPS';

const SuperAdmin: React.FC<Props> = ({ sessionToken, onExit }) => {
  const { t, tp, tRich, locale } = useTranslation();
  const [tab, setTab] = useState<TabType>('TEAMS');
  const [teams, setTeams] = useState<Team[]>([]);
  const [feedbacks, setFeedbacks] = useState<TeamFeedback[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Notice>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState('');
  const [editingPasswordTeamId, setEditingPasswordTeamId] = useState<string | null>(null);
  const [editPassword, setEditPassword] = useState('');
  const [editingNameTeamId, setEditingNameTeamId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [successMessage, setSuccessMessage] = useState<Notice>(null);
  const [selectedFeedback, setSelectedFeedback] = useState<TeamFeedback | null>(null);
  const [feedbackFilter, setFeedbackFilter] = useState<'all' | 'unread' | 'bug' | 'feature'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'resolved' | 'rejected'>('all');
  const [backupDownloading, setBackupDownloading] = useState(false);
  const [restoreUploading, setRestoreUploading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [infoMessageSaving, setInfoMessageSaving] = useState(false);

  // Team sorting
  type TeamSortColumn = 'name' | 'members' | 'lastActive';
  type SortDirection = 'asc' | 'desc';
  const [teamSortColumn, setTeamSortColumn] = useState<TeamSortColumn | null>(null);
  const [teamSortDirection, setTeamSortDirection] = useState<SortDirection>('asc');

  // Admin email notification settings
  const [adminEmail, setAdminEmail] = useState('');
  const [adminEmailSaving, setAdminEmailSaving] = useState(false);

  // New team notification toggle
  const [notifyNewTeam, setNotifyNewTeam] = useState(false);
  const [notifyNewTeamSaving, setNotifyNewTeamSaving] = useState(false);

  // AI / LLM settings
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiApiUrl, setAiApiUrl] = useState('');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiAllowSelfSignedCerts, setAiAllowSelfSignedCerts] = useState(false);
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ success: boolean; notice: Notice } | null>(null);

  // Live sessions monitoring
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);
  const liveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveLoadingRef = useRef(false);
  const sessionTokenRef = useRef(sessionToken);
  sessionTokenRef.current = sessionToken;

  // Server logs
  const [serverLogs, setServerLogs] = useState<ServerLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logFilter, setLogFilter] = useState<{ level?: string; source?: string }>({});

  // Backups
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupConfig, setBackupConfig] = useState<{
    enabled: boolean; intervalHours: number; maxCount: number; backupDir: string; onStartup: boolean;
  } | null>(null);
  const [checkpointLabel, setCheckpointLabel] = useState('');
  const [backupCreating, setBackupCreating] = useState(false);
  const [backupRestoring, setBackupRestoring] = useState<string | null>(null);

  const getRateLimitMessage = async (response: Response): Promise<Notice> => {
    if (response.status !== 429) return null;
    const data = await response.json().catch(() => null);
    return data?.retryAfter
      ? { key: 'login.superAdmin.tooManyAttemptsRetryIn', params: { retryAfter: String(data.retryAfter) } }
      : { key: 'login.superAdmin.tooManyAttemptsLater' };
  };

  useEffect(() => {
    loadTeams();
    loadFeedbacks();
    loadInfoMessage();
    loadAdminEmail();
    loadAiSettings();
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

    if (tab === 'BACKUPS') {
      loadBackups();
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
    setError(null);
    setSuccessMessage(null);
    setInfoMessageSaving(true);

    try {
      const response = await fetch('/api/super-admin/info-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, infoMessage })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'admin.info.saveFailed' });
      }

      setSuccessMessage({ key: 'admin.info.saved' });
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'admin.info.saveFailed' }));
    } finally {
      setInfoMessageSaving(false);
    }
  };

  const loadAdminEmail = async () => {
    try {
      const response = await fetch('/api/super-admin/admin-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });
      if (response.ok) {
        const data = await response.json();
        setAdminEmail(data.adminEmail || '');
        setNotifyNewTeam(!!data.notifyNewTeam);
      }
    } catch (err) {
      console.error('Failed to load admin email', err);
    }
  };

  const handleSaveAdminEmail = async () => {
    setError(null);
    setSuccessMessage(null);
    setAdminEmailSaving(true);

    try {
      const response = await fetch('/api/super-admin/update-admin-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, adminEmail })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'admin.notifications.saveEmailFailed' });
      }

      setSuccessMessage({ key: 'admin.notifications.emailSaved' });
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'admin.notifications.saveEmailFailed' }));
    } finally {
      setAdminEmailSaving(false);
    }
  };

  const handleToggleNotifyNewTeam = async () => {
    setNotifyNewTeamSaving(true);
    setError(null);
    setSuccessMessage(null);

    const newValue = !notifyNewTeam;

    try {
      const response = await fetch('/api/super-admin/update-notify-new-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, notifyNewTeam: newValue })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'admin.notifications.newTeamFailed' });
      }

      setNotifyNewTeam(newValue);
      setSuccessMessage({ key: newValue ? 'admin.notifications.newTeamEnabled' : 'admin.notifications.newTeamDisabled' });
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'admin.notifications.newTeamFailed' }));
    } finally {
      setNotifyNewTeamSaving(false);
    }
  };

  const loadAiSettings = async () => {
    try {
      const response = await fetch('/api/super-admin/ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });
      if (response.ok) {
        const data = await response.json();
        const ai: AiSettings = data.ai || { enabled: false, apiUrl: '' };
        setAiEnabled(ai.enabled);
        setAiApiUrl(ai.apiUrl || '');
        setAiApiKey(ai.apiKey || '');
        setAiModel(ai.model || '');
        setAiAllowSelfSignedCerts(!!ai.allowSelfSignedCerts);
      }
    } catch (err) {
      console.error('Failed to load AI settings', err);
    }
  };

  const handleSaveAiSettings = async () => {
    setError(null);
    setSuccessMessage(null);
    setAiSaving(true);
    setAiTestResult(null);

    try {
      const response = await fetch('/api/super-admin/update-ai-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, enabled: aiEnabled, apiUrl: aiApiUrl, apiKey: aiApiKey, model: aiModel, allowSelfSignedCerts: aiAllowSelfSignedCerts })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'admin.ai.saveFailed' });
      }

      setSuccessMessage({ key: 'admin.ai.saved' });
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'admin.ai.saveFailed' }));
    } finally {
      setAiSaving(false);
    }
  };

  const handleTestAi = async () => {
    setAiTesting(true);
    setAiTestResult(null);

    try {
      const response = await fetch('/api/super-admin/test-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          apiUrl: aiApiUrl,
          apiKey: aiApiKey,
          model: aiModel,
          allowSelfSignedCerts: aiAllowSelfSignedCerts
        })
      });

      const data = await response.json();

      if (response.ok) {
        setAiTestResult({ success: true, notice: { key: 'admin.ai.testSucceeded', params: { response: String(data.response) } } });
      } else {
        // The server's own detail (an upstream error) is shown as it came.
        setAiTestResult({ success: false, notice: data.message ? { raw: data.message } : { key: 'errors.connectionFailed' } });
      }
    } catch (err) {
      setAiTestResult({ success: false, notice: noticeFromError(err, { key: 'errors.connectionFailed' }) });
    } finally {
      setAiTesting(false);
    }
  };

  const loadActiveSessions = async () => {
    if (liveLoadingRef.current) return;
    liveLoadingRef.current = true;

    try {
      const response = await fetch('/api/super-admin/active-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: sessionTokenRef.current })
      });

      if (response.ok) {
        const data = await response.json();
        setActiveSessions(data.sessions || []);
      }
    } catch (err) {
      console.error('Failed to load active sessions', err);
    } finally {
      liveLoadingRef.current = false;
    }
  };

  const loadServerLogs = async () => {
    setLogsLoading(true);

    try {
      const response = await fetch('/api/super-admin/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, filter: logFilter })
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
    if (!confirm(t('adminLogs.confirmClear'))) return;

    try {
      const response = await fetch('/api/super-admin/clear-logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });

      if (response.ok) {
        setServerLogs([]);
        setSuccessMessage({ key: 'adminLogs.cleared' });
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      console.error('Failed to clear logs', err);
    }
  };

  const loadBackups = async () => {
    setBackupsLoading(true);
    try {
      const response = await fetch('/api/super-admin/backups/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });
      if (response.ok) {
        const data = await response.json();
        setBackups(data.backups || []);
        setBackupConfig(data.config || null);
      }
    } catch (err) {
      console.error('Failed to load backups', err);
    } finally {
      setBackupsLoading(false);
    }
  };

  const handleCreateCheckpoint = async () => {
    setBackupCreating(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/super-admin/backups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, label: checkpointLabel.trim() || undefined })
      });
      if (!response.ok) {
        if (response.status === 401) throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        if (response.status === 409) throw new NoticeError({ key: 'adminBackups.notice.inProgress' });
        throw new NoticeError({ key: 'adminBackups.notice.createFailed' });
      }
      setCheckpointLabel('');
      setSuccessMessage({ key: 'adminBackups.notice.created' });
      setTimeout(() => setSuccessMessage(null), 3000);
      loadBackups();
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminBackups.notice.createFailed' }));
    } finally {
      setBackupCreating(false);
    }
  };

  const handleDownloadServerBackup = async (backupId: string) => {
    try {
      const response = await fetch('/api/super-admin/backups/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, backupId })
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const header = response.headers.get('Content-Disposition');
      const match = header ? /filename="([^"]+)"/.exec(header) : null;
      const filename = match?.[1] || 'backup.json.gz';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError({ key: 'admin.notice.downloadBackupFailed' });
    }
  };

  const handleRestoreServerBackup = async (backup: BackupEntry) => {
    if (!confirm(t('adminBackups.confirm.restore', { name: backupLabel(backup) || new Date(backup.createdAt).toLocaleString(locale) }))) {
      return;
    }
    setBackupRestoring(backup.id);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/super-admin/backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, backupId: backup.id })
      });
      if (!response.ok) {
        if (response.status === 401) throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        throw new NoticeError({ key: 'adminBackups.notice.restoreFailed' });
      }
      setSuccessMessage({ key: 'adminBackups.notice.restored' });
      setTimeout(() => setSuccessMessage(null), 5000);
      loadBackups();
      loadTeams();
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminBackups.notice.restoreFailed' }));
    } finally {
      setBackupRestoring(null);
    }
  };

  const handleDeleteServerBackup = async (backup: BackupEntry) => {
    if (!confirm(t('adminBackups.confirm.delete', { name: backupLabel(backup) || backup.filename }))) return;
    try {
      const response = await fetch('/api/super-admin/backups/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, backupId: backup.id })
      });
      if (response.ok) {
        setSuccessMessage({ key: 'adminBackups.notice.deleted' });
        setTimeout(() => setSuccessMessage(null), 3000);
        loadBackups();
      }
    } catch (err) {
      setError({ key: 'adminBackups.notice.deleteFailed' });
    }
  };

  const handleToggleProtected = async (backup: BackupEntry) => {
    try {
      const response = await fetch('/api/super-admin/backups/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken, backupId: backup.id, protected: !backup.protected })
      });
      if (response.ok) {
        loadBackups();
      }
    } catch (err) {
      setError({ key: 'adminBackups.notice.updateFailed' });
    }
  };

  const formatBackupSize = (bytes: number) => {
    if (bytes < 1024) return t('adminBackups.size.bytes', { size: bytes });
    if (bytes < 1024 * 1024) {
      return t('adminBackups.size.kilobytes', { size: localizeDecimal((bytes / 1024).toFixed(1), locale) });
    }
    return t('adminBackups.size.megabytes', { size: localizeDecimal((bytes / (1024 * 1024)).toFixed(1), locale) });
  };

  // A label the server wrote reads in the interface language; one the operator
  // typed is shown exactly as typed.
  const backupLabel = (backup: BackupEntry): string | undefined => {
    if (!backup.label) return backup.label;
    const serverLabels = Object.prototype.hasOwnProperty.call(SERVER_BACKUP_LABEL_KEYS, backup.type)
      ? SERVER_BACKUP_LABEL_KEYS[backup.type]
      : null;
    const key = serverLabels ? keyFor(serverLabels, backup.label) : null;
    return key ? t(key) : backup.label;
  };

  const loadTeams = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/super-admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });
      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'adminTeams.notice.loadFailed' });
      }
      const data = await response.json();
      setTeams(data.teams || []);
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminTeams.notice.loadFailed' }));
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateEmail = async (teamId: string) => {
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/super-admin/update-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          teamId,
          facilitatorEmail: editEmail
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'adminTeams.notice.emailFailed' });
      }

      setSuccessMessage({ key: 'adminTeams.notice.emailSaved' });
      setEditingTeamId(null);
      setEditEmail('');

      // Reload teams to get updated data
      await loadTeams();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminTeams.notice.emailFailed' }));
    }
  };

  const handleUpdatePassword = async (teamId: string) => {
    setError(null);
    setSuccessMessage(null);

    // Audit H39 — one rule, read from the module the server routes read too.
    if (!isPasswordLongEnough(editPassword)) {
      setError({ key: 'errors.passwordTooShort', params: { min: PASSWORD_MIN_LENGTH } });
      return;
    }

    try {
      const response = await fetch('/api/super-admin/update-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          teamId,
          newPassword: editPassword
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'adminTeams.notice.passwordFailed' });
      }

      setSuccessMessage({ key: 'adminTeams.notice.passwordSaved' });
      setEditingPasswordTeamId(null);
      setEditPassword('');

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminTeams.notice.passwordFailed' }));
    }
  };

  const handleRenameTeam = async (teamId: string) => {
    setError(null);
    setSuccessMessage(null);

    if (!editName.trim()) {
      setError({ key: 'errors.teamNameEmpty' });
      return;
    }

    try {
      const response = await fetch('/api/super-admin/rename-team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          teamId,
          newName: editName.trim()
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        if (response.status === 409) {
          throw new NoticeError({ key: 'errors.teamNameTaken' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'adminTeams.notice.renameFailed' });
      }

      setSuccessMessage({ key: 'adminTeams.notice.renamed' });
      setEditingNameTeamId(null);
      setEditName('');

      // Reload teams to get updated data
      await loadTeams();

      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminTeams.notice.renameFailed' }));
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
    setError(null);
  };

  const loadFeedbacks = async () => {
    try {
      const response = await fetch('/api/super-admin/feedbacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'adminFeedbacks.notice.loadFailed' });
      }

      const data = await response.json();
      setFeedbacks(data.feedbacks || []);
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminFeedbacks.notice.loadFailed' }));
    }
  };

  const updateFeedback = async (feedback: TeamFeedback, updates: Partial<TeamFeedback>) => {
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/super-admin/feedbacks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          teamId: feedback.teamId,
          feedbackId: feedback.id,
          updates
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        if (response.status === 404) {
          // The team deleted it while the dashboard was open. Reload so the
          // row that no longer exists stops being offered, and say why rather
          // than showing a generic failure the admin would retry forever.
          await loadFeedbacks();
          throw new NoticeError({ key: 'adminFeedbacks.notice.gone' });
        }
        throw new NoticeError({ key: 'adminFeedbacks.notice.updateFailed' });
      }

      await loadFeedbacks();
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminFeedbacks.notice.updateFailed' }));
    }
  };

  const deleteFeedback = async (feedback: TeamFeedback) => {
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/super-admin/feedbacks/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          teamId: feedback.teamId,
          feedbackId: feedback.id
        })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'adminFeedbacks.notice.deleteFailed' });
      }

      await loadFeedbacks();
      setSuccessMessage({ key: 'adminFeedbacks.notice.deleted' });
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'adminFeedbacks.notice.deleteFailed' }));
    }
  };

  const handleDeleteFeedback = (feedback: TeamFeedback) => {
    if (confirm(t('adminFeedbacks.confirm.delete', { team: feedback.teamName }))) {
      deleteFeedback(feedback);
    }
  };

  const handleMarkAsRead = (feedback: TeamFeedback) => {
    updateFeedback(feedback, { isRead: true });
  };

  const handleUpdateFeedbackStatus = (feedback: TeamFeedback, status: TeamFeedback['status']) => {
    updateFeedback(feedback, { status });
  };

  const handleAddAdminComment = async (feedback: TeamFeedback, content: string) => {
    if (!content.trim()) return;

    try {
      const response = await fetch('/api/super-admin/feedbacks/comment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken,
          teamId: feedback.teamId,
          feedbackId: feedback.id,
          content: content.trim()
        })
      });

      if (response.ok) {
        setSelectedFeedback(null);
        setSuccessMessage({ key: 'adminFeedbacks.notice.commentAdded' });
        setTimeout(() => setSuccessMessage(null), 3000);
        loadFeedbacks(); // Reload to show new comment
      } else if (response.status === 404) {
        // Audit H22: the feedback was deleted by its team while this reply was
        // being written, so there is nowhere left to post it. Close the
        // composer with the entry it belonged to and reload — the same
        // treatment `TeamFeedback.tsx` gives a vanished target — but say so,
        // because the previous behaviour was to report success and drop the
        // reply silently.
        setSelectedFeedback(null);
        setError({ key: 'adminFeedbacks.notice.commentLost' });
        loadFeedbacks();
      } else {
        setError({ key: 'adminFeedbacks.notice.commentFailed' });
      }
    } catch (err) {
      setError({ key: 'adminFeedbacks.notice.commentFailed' });
    }
  };

  const extractFilenameFromHeader = (header: string | null) => {
    if (!header) return null;
    const match = /filename="(?<quoted>[^"]+)"|filename=(?<unquoted>[^;]+)/.exec(header);
    return match?.groups?.quoted || match?.groups?.unquoted || null;
  };

  const handleDownloadBackup = async () => {
    setError(null);
    setSuccessMessage(null);
    setBackupDownloading(true);

    try {
      const response = await fetch('/api/super-admin/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        if (response.status === 404) {
          throw new NoticeError({ key: 'admin.data.directoryNotFound' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'admin.data.generateFailed' });
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

      setSuccessMessage({ key: 'admin.data.downloaded' });
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'admin.notice.downloadBackupFailed' }));
    } finally {
      setBackupDownloading(false);
    }
  };

  const handleRestoreBackup = async () => {
    setError(null);
    setSuccessMessage(null);

    if (!restoreFile) {
      setError({ key: 'admin.data.selectArchive' });
      return;
    }

    setRestoreUploading(true);

    try {
      const response = await fetch('/api/super-admin/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/gzip',
          'x-super-admin-session-token': sessionToken
        },
        body: restoreFile
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new NoticeError({ key: 'admin.notice.sessionExpired' });
        }
        const rateLimitMessage = await getRateLimitMessage(response);
        if (rateLimitMessage) {
          throw new NoticeError(rateLimitMessage);
        }
        throw new NoticeError({ key: 'admin.data.restoreFailed' });
      }

      setSuccessMessage({ key: 'admin.data.restored' });
      setRestoreFile(null);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(noticeFromError(err, { key: 'admin.data.restoreFailed' }));
    } finally {
      setRestoreUploading(false);
    }
  };

  const getFilteredFeedbacks = () => {
    return feedbacks.filter(f => {
      // Type filter
      let matchesType = true;
      if (feedbackFilter === 'unread') matchesType = !f.isRead;
      else if (feedbackFilter === 'bug') matchesType = f.type === 'bug';
      else if (feedbackFilter === 'feature') matchesType = f.type === 'feature';

      // Status filter
      let matchesStatus = true;
      if (statusFilter !== 'all') matchesStatus = f.status === statusFilter;

      return matchesType && matchesStatus;
    });
  };

  const unreadCount = feedbacks.filter(f => !f.isRead).length;

  const handleTeamSort = (column: TeamSortColumn) => {
    if (teamSortColumn === column) {
      setTeamSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setTeamSortColumn(column);
      setTeamSortDirection('asc');
    }
  };

  const sortedTeams = (() => {
    if (!teamSortColumn) return teams;
    const sorted = [...teams].sort((a, b) => {
      if (teamSortColumn === 'name') {
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      }
      if (teamSortColumn === 'members') {
        return a.members.length - b.members.length;
      }
      // lastActive — teams with no date go last regardless of direction
      const dateA = a.lastConnectionDate ? new Date(a.lastConnectionDate).getTime() : null;
      const dateB = b.lastConnectionDate ? new Date(b.lastConnectionDate).getTime() : null;
      if (dateA === null && dateB === null) return 0;
      if (dateA === null) return 1;
      if (dateB === null) return -1;
      return dateA - dateB;
    });
    if (teamSortDirection === 'desc') {
      // Reverse only elements that have a value (keep nulls at end for date sort)
      if (teamSortColumn === 'lastActive') {
        const withDate = sorted.filter((t) => t.lastConnectionDate);
        const withoutDate = sorted.filter((t) => !t.lastConnectionDate);
        return [...withDate.reverse(), ...withoutDate];
      }
      sorted.reverse();
    }
    return sorted;
  })();

  const sortIcon = (column: TeamSortColumn) => {
    if (teamSortColumn !== column) return 'unfold_more';
    return teamSortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward';
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

  const getStatusBadge = (status: TeamFeedback['status']) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      resolved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800'
    };
    return (
      <span className={`px-2 py-1 text-xs rounded-full ${colors[status]}`}>
        {t(FEEDBACK_STATUS_KEYS[status])}
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

  // A stored code in the reader's language, or as it came when unknown.
  const codeLabel = (keys: Record<string, MessageKey>, code: string) => {
    const key = keyFor(keys, code);
    return key ? t(key) : code;
  };

  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-slate-800 flex items-center">
              <span className="material-symbols-outlined mr-3 text-red-600">shield_person</span>
              {t('admin.header.title')}
            </h1>
            <p className="text-slate-500 text-sm mt-1">{t('admin.header.subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <LanguageSwitcher className="shrink-0" />
            <button
              onClick={onExit}
              className="bg-slate-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-slate-700 flex items-center"
            >
              <span className="material-symbols-outlined mr-2">logout</span>
              {t('admin.header.exit')}
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-lg mb-4 flex items-center">
            <span className="material-symbols-outlined mr-2">error</span>
            {noticeText(error, t)}
          </div>
        )}

        {successMessage && (
          <div className="bg-green-50 text-green-700 p-4 rounded-lg mb-4 flex items-center">
            <span className="material-symbols-outlined mr-2">check_circle</span>
            {noticeText(successMessage, t)}
          </div>
        )}

        {/* Info Message Configuration */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-500">campaign</span>
                {t('admin.info.title')}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {t('admin.info.description')}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <textarea
                value={infoMessage}
                onChange={(e) => setInfoMessage(e.target.value)}
                placeholder={t('admin.info.placeholder')}
                className="w-full border border-slate-300 rounded-lg p-3 text-sm resize-none h-24 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-hidden"
              />
              {infoMessage && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-bold text-amber-700 mb-1">{t('admin.info.preview')}</p>
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
                  {infoMessageSaving ? t('admin.saving') : t('admin.info.save')}
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
                {t('admin.notifications.title')}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {t('admin.notifications.description')}
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="admin-email-address" className="text-sm font-medium text-slate-700">{t('admin.notifications.emailLabel')}</label>
                <input
                  id="admin-email-address"
                  type="email"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  placeholder={t('admin.notifications.emailPlaceholder')}
                  className="w-full md:w-96 border border-slate-300 rounded-lg px-4 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-hidden"
                />
                <p className="text-xs text-slate-500">
                  {t('admin.notifications.emailHint')}
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
                  {adminEmailSaving ? t('admin.saving') : t('admin.notifications.saveEmail')}
                </button>
              </div>

              {/* New Team Creation Notification Toggle */}
              <div className="border-t border-slate-200 pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-green-600">group_add</span>
                      {t('admin.notifications.newTeamTitle')}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {t('admin.notifications.newTeamDescription')}
                    </p>
                  </div>
                  <button
                    onClick={handleToggleNotifyNewTeam}
                    disabled={notifyNewTeamSaving || !adminEmail}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                      notifyNewTeamSaving || !adminEmail
                        ? 'cursor-not-allowed opacity-50'
                        : 'cursor-pointer'
                    } ${notifyNewTeam ? 'bg-green-600' : 'bg-slate-300'}`}
                    title={!adminEmail ? t('admin.notifications.newTeamNeedsEmail') : notifyNewTeam ? t('admin.notifications.newTeamDisable') : t('admin.notifications.newTeamEnable')}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        notifyNewTeam ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* AI / LLM Configuration */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-violet-600">smart_toy</span>
                  {t('admin.ai.title')}
                </h2>
                <p className="text-sm text-slate-500 mt-1">
                  {t('admin.ai.description')}
                </p>
              </div>
              <button
                onClick={async () => {
                  const newEnabled = !aiEnabled;
                  setAiEnabled(newEnabled);
                  if (!newEnabled) {
                    try {
                      await fetch('/api/super-admin/update-ai-settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessionToken, enabled: false, apiUrl: aiApiUrl, apiKey: aiApiKey, model: aiModel, allowSelfSignedCerts: aiAllowSelfSignedCerts })
                      });
                    } catch { /* ignore */ }
                  }
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 cursor-pointer ${aiEnabled ? 'bg-violet-600' : 'bg-slate-300'}`}
                title={aiEnabled ? t('admin.ai.disable') : t('admin.ai.enable')}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {aiEnabled && (
              <div className="flex flex-col gap-3 border-t border-slate-200 pt-4">
                <div className="flex flex-col gap-2">
                  <label htmlFor="ai-api-url" className="text-sm font-medium text-slate-700">{t('admin.ai.apiUrlLabel')} <span className="text-red-400">*</span></label>
                  <input
                    id="ai-api-url"
                    type="url"
                    value={aiApiUrl}
                    onChange={(e) => setAiApiUrl(e.target.value)}
                    placeholder={t('admin.ai.apiUrlPlaceholder')}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-hidden"
                  />
                  <p className="text-xs text-slate-500">
                    {t('admin.ai.apiUrlHint')}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="ai-api-key" className="text-sm font-medium text-slate-700">{t('admin.ai.apiKeyLabel')}</label>
                  <input
                    id="ai-api-key"
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder={t('admin.ai.apiKeyPlaceholder')}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-hidden"
                  />
                  <p className="text-xs text-slate-500">
                    {t('admin.ai.apiKeyHint')}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label htmlFor="ai-model" className="text-sm font-medium text-slate-700">{t('admin.ai.modelLabel')}</label>
                  <input
                    id="ai-model"
                    type="text"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                    placeholder={t('admin.ai.modelPlaceholder')}
                    className="w-full border border-slate-300 rounded-lg px-4 py-2 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-hidden"
                  />
                  <p className="text-xs text-slate-500">
                    {t('admin.ai.modelHint')}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-violet-600">verified_user</span>
                      {t('admin.ai.selfSignedTitle')}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                      {t('admin.ai.selfSignedDescription')}
                    </p>
                  </div>
                  <button
                    onClick={() => setAiAllowSelfSignedCerts(!aiAllowSelfSignedCerts)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-hidden focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 cursor-pointer ${aiAllowSelfSignedCerts ? 'bg-violet-600' : 'bg-slate-300'}`}
                    title={aiAllowSelfSignedCerts ? t('admin.ai.selfSignedDisable') : t('admin.ai.selfSignedEnable')}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiAllowSelfSignedCerts ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={handleTestAi}
                    disabled={aiTesting || !aiApiUrl}
                    className={`px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                      aiTesting || !aiApiUrl
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-300'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">
                      {aiTesting ? 'sync' : 'science'}
                    </span>
                    {aiTesting ? t('admin.ai.testing') : t('admin.ai.test')}
                  </button>
                  <button
                    onClick={handleSaveAiSettings}
                    disabled={aiSaving || !aiApiUrl}
                    className={`px-4 py-2 rounded-lg font-semibold flex items-center justify-center gap-2 ${
                      aiSaving || !aiApiUrl
                        ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                        : 'bg-violet-600 text-white hover:bg-violet-700'
                    }`}
                  >
                    <span className="material-symbols-outlined text-base">
                      {aiSaving ? 'sync' : 'save'}
                    </span>
                    {aiSaving ? t('admin.saving') : t('admin.ai.save')}
                  </button>
                </div>

                {aiTestResult && (
                  <div className={`p-3 rounded-lg text-sm ${aiTestResult.success ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                    <span className="material-symbols-outlined text-base mr-1 align-middle">
                      {aiTestResult.success ? 'check_circle' : 'error'}
                    </span>
                    {noticeText(aiTestResult.notice, t)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-lg p-6 mb-6 space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <span className="material-symbols-outlined text-indigo-600">cloud_download</span>
                {t('admin.data.title')}
              </h2>
              <p className="text-sm text-slate-500 mt-1">
                {tRich('admin.data.description', { folder: <code className="text-slate-700">/data</code> })}
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
              {backupDownloading ? t('admin.data.preparing') : t('admin.data.download')}
            </button>
          </div>

          <div className="border-t border-slate-200 pt-6">
            <div className="flex flex-col gap-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                  <span className="material-symbols-outlined text-amber-500">warning</span>
                  {t('admin.data.restoreTitle')}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {tRich('admin.data.restoreDescription', {
                    extension: <code className="text-slate-700">.tar.gz</code>,
                    folder: <code className="text-slate-700">/data</code>
                  })}
                </p>
              </div>
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-4 text-sm">
                {tRich('admin.data.restoreWarning', { warning: <strong>{t('admin.data.restoreWarningLabel')}</strong> })}
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
                  {restoreUploading ? t('admin.data.restoring') : t('admin.data.upload')}
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
            {t('admin.tabs.teams', { count: teams.length })}
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
            {t('admin.tabs.feedbacks', { count: feedbacks.length })}
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
            {t('admin.tabs.live')}
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
            {t('admin.tabs.logs')}
            {serverLogs.filter(l => l.level === 'error').length > 0 && (
              <span className="ml-2 bg-red-500 text-white text-xs rounded-full px-2 py-0.5">
                {serverLogs.filter(l => l.level === 'error').length}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab('BACKUPS')}
            className={`px-6 py-3 font-bold text-sm flex items-center transition ${
              tab === 'BACKUPS'
                ? 'border-b-2 border-teal-600 text-teal-600'
                : 'text-slate-500 hover:text-teal-600'
            }`}
          >
            <span className="material-symbols-outlined mr-2">backup</span>
            {t('admin.tabs.backups')}
            {backups.length > 0 && (
              <span className="ml-2 bg-teal-100 text-teal-700 text-xs rounded-full px-2 py-0.5">
                {backups.length}
              </span>
            )}
          </button>
        </div>

        {loading && tab === 'TEAMS' ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
            <p className="text-slate-500 mt-4">{t('adminTeams.loading')}</p>
          </div>
        ) : tab === 'TEAMS' ? (
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-linear-to-r from-indigo-600 to-purple-700 text-white p-4">
              <h2 className="text-xl font-bold">{t('adminTeams.heading', { count: teams.length })}</h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left p-4 font-bold text-slate-700">
                      <button
                        onClick={() => handleTeamSort('name')}
                        className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                      >
                        {t('adminTeams.column.name')}
                        <span className="material-symbols-outlined text-base">{sortIcon('name')}</span>
                      </button>
                    </th>
                    <th className="text-left p-4 font-bold text-slate-700">
                      <button
                        onClick={() => handleTeamSort('members')}
                        className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                      >
                        {t('adminTeams.column.members')}
                        <span className="material-symbols-outlined text-base">{sortIcon('members')}</span>
                      </button>
                    </th>
                    <th className="text-left p-4 font-bold text-slate-700">{t('adminTeams.column.email')}</th>
                    <th className="text-left p-4 font-bold text-slate-700">
                      <button
                        onClick={() => handleTeamSort('lastActive')}
                        className="inline-flex items-center gap-1 hover:text-indigo-600 transition-colors cursor-pointer"
                      >
                        {t('adminTeams.column.lastActive')}
                        <span className="material-symbols-outlined text-base">{sortIcon('lastActive')}</span>
                      </button>
                    </th>
                    <th className="text-right p-4 font-bold text-slate-700">{t('admin.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTeams.map((team) => (
                    <tr key={team.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="p-4">
                        {editingNameTeamId === team.id ? (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="flex-1 border border-slate-300 rounded-sm px-2 py-1 text-sm"
                              placeholder={t('adminTeams.namePlaceholder')}
                              // eslint-disable-next-line jsx-a11y/no-autofocus -- the rename button it replaces is unmounted by this very click
                              autoFocus
                            />
                            <button
                              onClick={() => handleRenameTeam(team.id)}
                              className="bg-green-600 text-white px-3 py-1 rounded-sm text-sm hover:bg-green-700"
                            >
                              {t('common.save')}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="bg-slate-400 text-white px-3 py-1 rounded-sm text-sm hover:bg-slate-500"
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="font-bold text-slate-800">{team.name}</div>
                            <div className="text-xs text-slate-500">{t('adminTeams.id', { id: team.id })}</div>
                          </>
                        )}
                      </td>
                      <td className="p-4 text-slate-600">
                        {tp('adminTeams.memberCount', team.members.length)}
                      </td>
                      <td className="p-4">
                        {editingTeamId === team.id ? (
                          <div className="flex gap-2">
                            <input
                              type="email"
                              value={editEmail}
                              onChange={(e) => setEditEmail(e.target.value)}
                              className="flex-1 border border-slate-300 rounded-sm px-2 py-1 text-sm"
                              placeholder={t('adminTeams.emailPlaceholder')}
                              // eslint-disable-next-line jsx-a11y/no-autofocus -- the edit button it replaces is unmounted by this very click
                              autoFocus
                            />
                            <button
                              onClick={() => handleUpdateEmail(team.id)}
                              className="bg-green-600 text-white px-3 py-1 rounded-sm text-sm hover:bg-green-700"
                            >
                              {t('common.save')}
                            </button>
                            <button
                              onClick={cancelEdit}
                              className="bg-slate-400 text-white px-3 py-1 rounded-sm text-sm hover:bg-slate-500"
                            >
                              {t('common.cancel')}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            {team.facilitatorEmail ? (
                              <span className="text-slate-700">{team.facilitatorEmail}</span>
                            ) : (
                              <span className="text-slate-500 italic">{t('adminTeams.emailNotConfigured')}</span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-slate-600 text-sm">
                        {team.lastConnectionDate
                          ? new Date(team.lastConnectionDate).toLocaleDateString(locale)
                          : t('adminTeams.never')}
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-2">
                          {editingPasswordTeamId === team.id ? (
                            <div className="flex gap-2">
                              <input
                                type="password"
                                value={editPassword}
                                onChange={(e) => setEditPassword(e.target.value)}
                                className="flex-1 border border-slate-300 rounded-sm px-2 py-1 text-sm"
                                placeholder={t('adminTeams.passwordPlaceholder', { min: PASSWORD_MIN_LENGTH })}
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the change-password button it replaces is unmounted by this very click
                                autoFocus
                              />
                              <button
                                onClick={() => handleUpdatePassword(team.id)}
                                className="bg-green-600 text-white px-3 py-1 rounded-sm text-sm hover:bg-green-700"
                              >
                                {t('common.save')}
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="bg-slate-400 text-white px-3 py-1 rounded-sm text-sm hover:bg-slate-500"
                              >
                                {t('common.cancel')}
                              </button>
                            </div>
                          ) : editingTeamId !== team.id && editingNameTeamId !== team.id && (
                            <div className="flex justify-end gap-2 flex-wrap">
                              <button
                                onClick={() => startEditName(team)}
                                className="text-purple-600 hover:text-purple-800 px-3 py-1 rounded-sm border border-purple-600 hover:bg-purple-50 text-sm font-medium"
                                title={t('adminTeams.renameTitle')}
                              >
                                {t('adminTeams.rename')}
                              </button>
                              <button
                                onClick={() => startEditPassword(team)}
                                className="text-amber-600 hover:text-amber-800 px-3 py-1 rounded-sm border border-amber-600 hover:bg-amber-50 text-sm font-medium"
                                title={t('adminTeams.changePasswordTitle')}
                              >
                                {t('adminTeams.changePassword')}
                              </button>
                              <button
                                onClick={() => startEditEmail(team)}
                                className="text-indigo-600 hover:text-indigo-800 px-3 py-1 rounded-sm border border-indigo-600 hover:bg-indigo-50 text-sm font-medium"
                                title={t('adminTeams.editEmailTitle')}
                              >
                                {t('adminTeams.editEmail')}
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
                <div className="text-center py-12 text-slate-500">
                  <span className="material-symbols-outlined text-6xl mb-4 opacity-50">groups_off</span>
                  <p>{t('adminTeams.empty')}</p>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* Feedbacks Tab */}
        {tab === 'FEEDBACKS' && (
          <div>
            {/* Type Filters */}
            <div className="mb-4 flex gap-2 flex-wrap">
              <button
                onClick={() => setFeedbackFilter('all')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'all'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('adminFeedbacks.filter.all', { count: feedbacks.length })}
              </button>
              <button
                onClick={() => setFeedbackFilter('unread')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'unread'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('adminFeedbacks.filter.unread', { count: unreadCount })}
              </button>
              <button
                onClick={() => setFeedbackFilter('bug')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'bug'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('adminFeedbacks.filter.bugs', { count: feedbacks.filter(f => f.type === 'bug').length })}
              </button>
              <button
                onClick={() => setFeedbackFilter('feature')}
                className={`px-4 py-2 rounded-lg font-medium text-sm ${
                  feedbackFilter === 'feature'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t('adminFeedbacks.filter.features', { count: feedbacks.filter(f => f.type === 'feature').length })}
              </button>
            </div>

            {/* Status Filters */}
            <div className="mb-6 flex gap-2 flex-wrap items-center">
              <span className="text-sm text-slate-500 mr-2">{t('adminFeedbacks.filter.statusLabel')}</span>
              {(['all', 'pending', 'in_progress', 'resolved', 'rejected'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg font-medium text-xs ${
                    statusFilter === status
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {status === 'all' ? t('adminFeedbacks.filter.statusAll') : t(FEEDBACK_STATUS_KEYS[status])}
                  {' '}({feedbacks.filter(f => status === 'all' || f.status === status).length})
                </button>
              ))}
            </div>

            {/* Feedbacks List */}
            <div className="space-y-4">
              {getFilteredFeedbacks().length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm p-12 text-center text-slate-500">
                  <span className="material-symbols-outlined text-6xl mb-4 opacity-50">feedback</span>
                  <p>{t('adminFeedbacks.empty')}</p>
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
                            {t('adminFeedbacks.card.new')}
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
                            alt={t('adminFeedbacks.card.imageAlt', { number: idx + 1 })}
                            className="w-32 h-32 object-cover rounded-sm cursor-pointer hover:opacity-80"
                            onClick={() => window.open(img, '_blank')}
                          />
                        ))}
                      </div>
                    )}

                    <div className="text-sm text-slate-500 mb-3">
                      {tRich('adminFeedbacks.card.team', { team: <span className="font-semibold">{feedback.teamName}</span> })}
                    </div>

                    {/* Comments Section */}
                    {feedback.comments && feedback.comments.length > 0 && (
                      <div className="mb-3 space-y-2">
                        <p className="text-sm font-medium text-slate-600">{t('adminFeedbacks.card.comments', { count: feedback.comments.length })}</p>
                        {feedback.comments.map((comment) => (
                          <div key={comment.id} className={`p-3 rounded-sm ${comment.isAdmin ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50'}`}>
                            <div className="text-sm">
                              {comment.isAdmin && (
                                <span className="material-symbols-outlined text-xs align-middle mr-1 text-amber-600">admin_panel_settings</span>
                              )}
                              <span className={`font-medium ${comment.isAdmin ? 'text-amber-800' : 'text-slate-800'}`}>{comment.authorName}</span>
                              {!comment.isAdmin && (
                                <>
                                  <span className="text-slate-500"> · </span>
                                  <span className="text-slate-500">{comment.teamName}</span>
                                </>
                              )}
                              <span className="text-slate-500"> · </span>
                              <span className="text-slate-500">{formatDate(comment.createdAt)}</span>
                            </div>
                            <p className={`text-sm mt-1 ${comment.isAdmin ? 'text-amber-700' : 'text-slate-700'}`}>{comment.content}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      {!feedback.isRead && (
                        <button
                          onClick={() => handleMarkAsRead(feedback)}
                          className="px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-sm text-sm font-medium hover:bg-indigo-200"
                        >
                          {t('adminFeedbacks.card.markRead')}
                        </button>
                      )}

                      <select
                        aria-label={t('adminFeedbacks.card.statusLabel', { title: feedback.title })}
                        value={feedback.status}
                        onChange={(e) =>
                          handleUpdateFeedbackStatus(feedback, e.target.value as TeamFeedback['status'])
                        }
                        className="px-3 py-1.5 bg-white border border-slate-300 rounded-sm text-sm"
                      >
                        <option value="pending">{t('feedback.status.pending')}</option>
                        <option value="in_progress">{t('feedback.status.inProgress')}</option>
                        <option value="resolved">{t('feedback.status.resolved')}</option>
                        <option value="rejected">{t('feedback.status.rejected')}</option>
                      </select>

                      <button
                        onClick={() => setSelectedFeedback(feedback)}
                        className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-sm text-sm font-medium hover:bg-blue-200"
                      >
                        {t('adminFeedbacks.addComment')}
                      </button>

                      <button
                        onClick={() => handleDeleteFeedback(feedback)}
                        className="px-3 py-1.5 bg-red-100 text-red-700 rounded-sm text-sm font-medium hover:bg-red-200"
                      >
                        {t('common.delete')}
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
                <h2 className="text-lg font-bold text-slate-700">{t('adminLive.heading')}</h2>
              </div>
              <button
                onClick={loadActiveSessions}
                className="px-3 py-1.5 bg-green-100 text-green-700 rounded-sm text-sm font-medium hover:bg-green-200 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                {t('admin.refresh')}
              </button>
            </div>

            {activeSessions.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                <span className="material-symbols-outlined text-6xl mb-4 text-slate-300">cloud_off</span>
                <p className="text-slate-500 text-lg">{t('adminLive.empty')}</p>
                <p className="text-slate-500 text-sm mt-2">
                  {t('adminLive.emptyHint')}
                </p>
                <div className="mt-6 p-4 bg-green-50 rounded-lg text-sm text-green-700">
                  <span className="material-symbols-outlined text-base align-middle mr-1">check_circle</span>
                  {t('adminLive.safeToDeploy')}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
                  <span className="material-symbols-outlined text-amber-600 mt-0.5">warning</span>
                  <div>
                    <p className="text-amber-800 font-medium">{t('adminLive.warningTitle')}</p>
                    <p className="text-amber-700 text-sm mt-1">
                      {t('adminLive.warning', {
                        sessions: activeSessions.length,
                        users: activeSessions.reduce((sum, s) => sum + s.connectedCount, 0)
                      })}
                    </p>
                  </div>
                </div>

                {activeSessions.map((session) => (
                  <div key={session.sessionId} className="bg-white rounded-xl shadow-md p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`material-symbols-outlined text-lg ${
                            session.type === 'healthcheck' ? 'text-emerald-700' : 'text-indigo-600'
                          }`}>
                            {session.type === 'healthcheck' ? 'health_and_safety' : 'psychology'}
                          </span>
                          <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${
                            session.type === 'healthcheck'
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-indigo-100 text-indigo-700'
                          }`}>
                            {session.type === 'healthcheck' ? t('adminLive.type.healthcheck') : t('adminLive.type.retrospective')}
                          </span>
                          <span className="flex items-center gap-1 text-green-600">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            <span className="text-xs font-medium">{t('adminLive.live')}</span>
                          </span>
                        </div>
                        <h3 className="text-lg font-bold text-slate-800">{session.sessionName}</h3>
                        <p className="text-sm text-slate-500">{t('adminLive.team', { team: session.teamName })}</p>
                      </div>
                      <div className="text-right">
                        <div className="bg-slate-100 rounded-lg px-3 py-2">
                          <p className="text-2xl font-bold text-slate-800">{session.connectedCount}</p>
                          <p className="text-xs text-slate-500">{t('adminLive.connected')}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-slate-500">flag</span>
                        <span className="text-sm text-slate-600">
                          {tRich('adminLive.phaseLine', { phase: <span className="font-medium">{codeLabel(PHASE_KEYS, session.phase)}</span> })}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-slate-500">schedule</span>
                        <span className="text-sm text-slate-600">
                          {tRich('adminLive.statusLine', { status: <span className="font-medium">{codeLabel(SESSION_STATUS_KEYS, session.status)}</span> })}
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-slate-100 pt-4">
                      <p className="text-xs text-slate-500 mb-2">{t('adminLive.participants')}</p>
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
                <h2 className="text-lg font-bold text-slate-700">{t('adminLogs.heading')}</h2>
                {logsLoading && (
                  <span className="inline-block animate-spin rounded-full h-4 w-4 border-b-2 border-orange-600"></span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={loadServerLogs}
                  className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-sm text-sm font-medium hover:bg-orange-200 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base">refresh</span>
                  {t('admin.refresh')}
                </button>
                <button
                  onClick={handleClearLogs}
                  className="px-3 py-1.5 bg-red-100 text-red-700 rounded-sm text-sm font-medium hover:bg-red-200 flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-base">delete</span>
                  {t('adminLogs.clear')}
                </button>
              </div>
            </div>

            {/* Log Filters */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex flex-wrap gap-4">
              <div className="flex items-center gap-2">
                <label htmlFor="log-filter-level" className="text-sm font-medium text-slate-600">{t('adminLogs.levelLabel')}</label>
                <select
                  id="log-filter-level"
                  value={logFilter.level || ''}
                  onChange={(e) => {
                    setLogFilter({ ...logFilter, level: e.target.value || undefined });
                    setTimeout(loadServerLogs, 100);
                  }}
                  className="border border-slate-300 rounded-sm px-2 py-1 text-sm"
                >
                  <option value="">{t('adminLogs.levelAll')}</option>
                  <option value="error">{t('adminLogs.levelFilter.error')}</option>
                  <option value="warn">{t('adminLogs.levelFilter.warn')}</option>
                  <option value="info">{t('adminLogs.levelFilter.info')}</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="log-filter-source" className="text-sm font-medium text-slate-600">{t('adminLogs.sourceLabel')}</label>
                <select
                  id="log-filter-source"
                  value={logFilter.source || ''}
                  onChange={(e) => {
                    setLogFilter({ ...logFilter, source: e.target.value || undefined });
                    setTimeout(loadServerLogs, 100);
                  }}
                  className="border border-slate-300 rounded-sm px-2 py-1 text-sm"
                >
                  <option value="">{t('adminLogs.sourceAll')}</option>
                  <option value="postgres">{t('adminLogs.sourceFilter.postgres')}</option>
                  <option value="server">{t('adminLogs.sourceFilter.server')}</option>
                  <option value="socket">{t('adminLogs.sourceFilter.socket')}</option>
                  <option value="email">{t('adminLogs.sourceFilter.email')}</option>
                </select>
              </div>
              <div className="text-sm text-slate-500 ml-auto">
                {tp('adminLogs.entries', serverLogs.length)}
              </div>
            </div>

            {serverLogs.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                <span className="material-symbols-outlined text-6xl mb-4 text-slate-300">article</span>
                <p className="text-slate-500 text-lg">{t('adminLogs.empty')}</p>
                <p className="text-slate-500 text-sm mt-2">
                  {t('adminLogs.emptyHint')}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left p-3 font-semibold text-slate-600 w-40">{t('adminLogs.column.timestamp')}</th>
                        <th className="text-left p-3 font-semibold text-slate-600 w-20">{t('adminLogs.column.level')}</th>
                        <th className="text-left p-3 font-semibold text-slate-600 w-24">{t('adminLogs.column.source')}</th>
                        <th className="text-left p-3 font-semibold text-slate-600">{t('adminLogs.column.message')}</th>
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
                            {new Date(log.timestamp).toLocaleString(locale)}
                          </td>
                          <td className="p-3">
                            <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              log.level === 'error'
                                ? 'bg-red-100 text-red-700'
                                : log.level === 'warn'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {codeLabel(LOG_LEVEL_KEYS, log.level)}
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
                              {codeLabel(LOG_SOURCE_KEYS, log.source)}
                            </span>
                          </td>
                          {/* The server's own English text, read with English pronunciation (WCAG 3.1.2). */}
                          <td lang="en" className="p-3 text-slate-700 font-mono text-xs break-all">
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

        {/* Backups Tab */}
        {tab === 'BACKUPS' && (
          <div>
            {/* Backup Configuration Summary */}
            {backupConfig && (
              <div className="bg-white rounded-lg shadow-sm p-4 mb-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <span className="material-symbols-outlined text-base text-teal-600">settings</span>
                  {t('adminBackups.config.title')}
                </h3>
                <div className="flex flex-wrap gap-4 text-sm text-slate-600">
                  <span>{tRich('adminBackups.config.auto', { value: <span className={`font-medium ${backupConfig.enabled ? 'text-green-600' : 'text-red-600'}`}>{backupConfig.enabled ? t('adminBackups.config.enabled') : t('adminBackups.config.disabled')}</span> })}</span>
                  <span>{tRich('adminBackups.config.interval', { value: <span className="font-medium">{t('adminBackups.config.hours', { hours: backupConfig.intervalHours })}</span> })}</span>
                  <span>{tRich('adminBackups.config.maxCount', { value: <span className="font-medium">{backupConfig.maxCount}</span> })}</span>
                  <span>{tRich('adminBackups.config.onStartup', { value: <span className={`font-medium ${backupConfig.onStartup ? 'text-green-600' : 'text-slate-500'}`}>{backupConfig.onStartup ? t('common.yes') : t('common.no')}</span> })}</span>
                  <span>{tRich('adminBackups.config.directory', { value: <code className="text-xs bg-slate-100 px-1 rounded-sm">{backupConfig.backupDir}</code> })}</span>
                </div>
              </div>
            )}

            {/* Create Checkpoint */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <span className="material-symbols-outlined text-base text-teal-600">add_circle</span>
                {t('adminBackups.checkpoint.create')}
              </h3>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={checkpointLabel}
                  onChange={(e) => setCheckpointLabel(e.target.value)}
                  placeholder={t('adminBackups.checkpoint.placeholder')}
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                  maxLength={100}
                />
                <button
                  onClick={handleCreateCheckpoint}
                  disabled={backupCreating}
                  className={`px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 ${
                    backupCreating
                      ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                      : 'bg-teal-600 text-white hover:bg-teal-700'
                  }`}
                >
                  <span className="material-symbols-outlined text-base">
                    {backupCreating ? 'sync' : 'save'}
                  </span>
                  {backupCreating ? t('adminBackups.checkpoint.creating') : t('adminBackups.checkpoint.create')}
                </button>
              </div>
            </div>

            {/* Backups List */}
            {backupsLoading ? (
              <div className="text-center py-12">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
                <p className="text-slate-500 mt-4">{t('adminBackups.loading')}</p>
              </div>
            ) : backups.length === 0 ? (
              <div className="bg-white rounded-xl shadow-sm p-12 text-center">
                <span className="material-symbols-outlined text-6xl mb-4 text-slate-300">cloud_off</span>
                <p className="text-slate-500 text-lg">{t('adminBackups.empty')}</p>
                <p className="text-slate-500 text-sm mt-2">
                  {t('adminBackups.emptyHint')}
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200">
                      <tr>
                        <th className="text-left p-3 font-semibold text-slate-600">{t('adminBackups.column.type')}</th>
                        <th className="text-left p-3 font-semibold text-slate-600">{t('adminBackups.column.label')}</th>
                        <th className="text-left p-3 font-semibold text-slate-600">{t('adminBackups.column.teams')}</th>
                        <th className="text-left p-3 font-semibold text-slate-600">{t('adminBackups.column.size')}</th>
                        <th className="text-center p-3 font-semibold text-slate-600">{t('adminBackups.column.protected')}</th>
                        <th className="text-right p-3 font-semibold text-slate-600">{t('admin.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {backups.map((backup) => (
                        <tr key={backup.id} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="p-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold uppercase ${
                              backup.type === 'manual'
                                ? 'bg-teal-100 text-teal-700'
                                : backup.type === 'startup'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}>
                              <span className="material-symbols-outlined text-xs">
                                {backup.type === 'manual' ? 'flag' : backup.type === 'startup' ? 'rocket_launch' : 'schedule'}
                              </span>
                              {codeLabel(BACKUP_TYPE_KEYS, backup.type)}
                            </span>
                          </td>
                          <td className="p-3">
                            {backup.label && (
                              <div className="font-medium text-slate-800">{backupLabel(backup)}</div>
                            )}
                            <div className="text-xs text-slate-500">
                              {new Date(backup.createdAt).toLocaleString(locale)}
                            </div>
                          </td>
                          <td className="p-3 text-slate-600">{backup.teamCount}</td>
                          <td className="p-3 text-slate-600 font-mono text-xs">{formatBackupSize(backup.sizeBytes)}</td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleToggleProtected(backup)}
                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition ${
                                backup.protected
                                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                              }`}
                              title={backup.protected ? t('adminBackups.protected.on') : t('adminBackups.protected.off')}
                            >
                              <span className="material-symbols-outlined text-xs">
                                {backup.protected ? 'lock' : 'lock_open'}
                              </span>
                              {backup.protected ? t('common.yes') : t('common.no')}
                            </button>
                          </td>
                          <td className="p-3">
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => handleDownloadServerBackup(backup.id)}
                                className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-sm"
                                title={t('adminBackups.download')}
                                aria-label={t('adminBackups.downloadLabel')}
                              >
                                <span className="material-symbols-outlined text-base">download</span>
                              </button>
                              <button
                                onClick={() => handleRestoreServerBackup(backup)}
                                disabled={backupRestoring === backup.id}
                                className={`p-1.5 rounded ${
                                  backupRestoring === backup.id
                                    ? 'text-slate-300 cursor-not-allowed'
                                    : 'text-slate-500 hover:text-amber-600 hover:bg-amber-50'
                                }`}
                                title={t('adminBackups.restore')}
                                aria-label={t('adminBackups.restoreLabel')}
                              >
                                <span className="material-symbols-outlined text-base">
                                  {backupRestoring === backup.id ? 'sync' : 'restore'}
                                </span>
                              </button>
                              <button
                                onClick={() => handleDeleteServerBackup(backup)}
                                className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-sm"
                                title={t('adminBackups.delete')}
                                aria-label={t('adminBackups.deleteLabel')}
                              >
                                <span className="material-symbols-outlined text-base">delete</span>
                              </button>
                            </div>
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

        {/* Add Comment Modal */}
        {selectedFeedback && (
          <ModalDialog
            labelledBy="admin-comment-title"
            onClose={() => setSelectedFeedback(null)}
            // The comment is unsaved text: a stray backdrop click must not throw
            // it away. Escape is the deliberate way out.
            closeOnBackdropClick={false}
            overlayClassName="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            panelClassName="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6"
          >
            <>
              <h3 id="admin-comment-title" className="text-xl font-bold text-slate-800 mb-4">{t('adminFeedbacks.addComment')}</h3>
              <p className="text-sm text-slate-600 mb-4">
                {tRich('adminFeedbacks.comment.feedback', { title: <span className="font-semibold">{selectedFeedback.title}</span> })}
              </p>
              <textarea
                placeholder={t('adminFeedbacks.comment.placeholder')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                rows={4}
                id="admin-comment-input"
                maxLength={1000}
              />
              <p className="text-xs text-slate-500 mt-1">{t('adminFeedbacks.comment.maxLength')}</p>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => {
                    const input = document.getElementById('admin-comment-input') as HTMLTextAreaElement;
                    handleAddAdminComment(selectedFeedback, input.value);
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                >
                  {t('adminFeedbacks.addComment')}
                </button>
                <button
                  onClick={() => setSelectedFeedback(null)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg hover:bg-slate-300"
                >
                  {t('common.cancel')}
                </button>
              </div>
            </>
          </ModalDialog>
        )}
      </div>
    </div>
  );
};

export default SuperAdmin;
