// English messages for the "admin" namespace (the super-admin console shell: header, info message, settings, tab bar, shared notices). Every key starts
// with "admin.". English is the source language: keep this text identical to
// what the console rendered before it was translated.
//
// The console's rate-limit notice reuses `login.superAdmin.tooManyAttempts*`:
// it is the same sentence for the same limiter family, and a second copy could
// only drift.
const admin = {
  // Header
  'admin.header.title': 'Super Admin Dashboard',
  'admin.header.subtitle': 'Manage all teams and recovery emails',
  'admin.header.exit': 'Exit Admin Mode',

  // Shared by several blocks and tabs
  'admin.saving': 'Saving...',
  'admin.refresh': 'Refresh',
  'admin.actions': 'Actions',
  'admin.notice.sessionExpired': 'Super admin session expired. Please log in again.',
  'admin.notice.downloadBackupFailed': 'Failed to download backup',

  // Info message
  'admin.info.title': 'Info Message',
  'admin.info.description':
    'Display an important announcement visible on the team selection page and team dashboards. Leave empty to hide the message.',
  'admin.info.placeholder': 'e.g., Scheduled maintenance on Sunday from 2-4 AM...',
  'admin.info.preview': 'Preview:',
  'admin.info.save': 'Save Message',
  'admin.info.saveFailed': 'Failed to save info message',
  'admin.info.saved': 'Info message updated successfully',

  // Feedback notifications
  'admin.notifications.title': 'Feedback Notifications',
  'admin.notifications.description':
    'Configure email notifications when users submit feedback (bug reports or feature requests). Requires SMTP to be configured on the server.',
  'admin.notifications.emailLabel': 'Admin Email Address',
  'admin.notifications.emailPlaceholder': 'admin@example.com',
  'admin.notifications.emailHint': 'Leave empty to disable email notifications for new feedback.',
  'admin.notifications.saveEmail': 'Save Email',
  'admin.notifications.saveEmailFailed': 'Failed to save admin email',
  'admin.notifications.emailSaved': 'Admin email updated successfully',
  'admin.notifications.newTeamTitle': 'New Team Notification',
  'admin.notifications.newTeamDescription':
    'Receive an email when a new team is created. Requires an admin email and SMTP to be configured.',
  'admin.notifications.newTeamNeedsEmail': 'Set an admin email first',
  'admin.notifications.newTeamDisable': 'Disable new team notifications',
  'admin.notifications.newTeamEnable': 'Enable new team notifications',
  'admin.notifications.newTeamEnabled': 'New team notifications enabled',
  'admin.notifications.newTeamDisabled': 'New team notifications disabled',
  'admin.notifications.newTeamFailed': 'Failed to update notification setting',

  // AI assistant
  'admin.ai.title': 'AI Assistant',
  'admin.ai.description':
    'Connect an OpenAI-compatible LLM to enable automatic group title suggestions and retrospective summary generation.',
  'admin.ai.disable': 'Disable AI features',
  'admin.ai.enable': 'Enable AI features',
  'admin.ai.apiUrlLabel': 'API URL',
  'admin.ai.apiUrlPlaceholder': 'https://api.openai.com/v1',
  'admin.ai.apiUrlHint': 'Base URL of the OpenAI-compatible API (e.g. https://api.openai.com/v1)',
  'admin.ai.apiKeyLabel': 'API Key',
  'admin.ai.apiKeyPlaceholder': 'sk-... (leave empty if not required)',
  'admin.ai.apiKeyHint':
    'Optional. Required for services like OpenAI. Leave empty if your LLM does not require authentication.',
  'admin.ai.modelLabel': 'Model',
  'admin.ai.modelPlaceholder': 'e.g. gpt-4o-mini (optional)',
  'admin.ai.modelHint': 'Optional model name. Some endpoints require it, others auto-select.',
  'admin.ai.selfSignedTitle': 'Allow Self-Signed Certificates',
  'admin.ai.selfSignedDescription':
    'Enable this for internal servers with self-signed or corporate TLS certificates.',
  'admin.ai.selfSignedDisable': 'Disable self-signed cert support',
  'admin.ai.selfSignedEnable': 'Allow self-signed certificates',
  'admin.ai.testing': 'Testing...',
  'admin.ai.test': 'Test Connection',
  'admin.ai.save': 'Save Settings',
  'admin.ai.saveFailed': 'Failed to save AI settings',
  'admin.ai.saved': 'AI settings updated successfully',
  'admin.ai.testSucceeded': 'Connection successful. Response: "{response}"',

  // Full data archive (download and upload)
  'admin.data.title': 'Backup Data',
  'admin.data.description': 'Download a full archive of the {folder} folder for local recovery or migration.',
  'admin.data.preparing': 'Preparing Backup...',
  'admin.data.download': 'Download Backup',
  'admin.data.directoryNotFound': 'Backup data directory not found.',
  'admin.data.generateFailed': 'Failed to generate backup.',
  'admin.data.downloaded': 'Backup downloaded successfully',
  'admin.data.restoreTitle': 'Restore Data',
  'admin.data.restoreDescription':
    'Upload a previously downloaded {extension} backup archive to restore the {folder} folder.',
  'admin.data.restoreWarningLabel': 'Warning:',
  'admin.data.restoreWarning':
    '{warning} Restoring a backup will overwrite the current data. Download a backup first if you might need to roll back.',
  'admin.data.restoring': 'Restoring...',
  'admin.data.upload': 'Upload & Restore',
  'admin.data.selectArchive': 'Please select a backup archive to upload.',
  'admin.data.restoreFailed': 'Failed to restore backup.',
  'admin.data.restored': 'Backup restored successfully. Refresh the page to load updated data.',

  // Tab bar
  'admin.tabs.teams': 'Teams ({count})',
  'admin.tabs.feedbacks': 'Feedback ({count})',
  'admin.tabs.live': 'Live Sessions',
  'admin.tabs.logs': 'Server Logs',
  'admin.tabs.backups': 'Backups',
};

export default admin;
