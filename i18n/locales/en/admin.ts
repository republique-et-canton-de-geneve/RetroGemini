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
  'admin.notifications.emailInvalid': 'Enter one valid email address, or leave the field empty to turn notifications off',
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

  // Jira: the deployment's one Jira. Teams enter their own token in their
  // settings (`jira.settings.*`). The address is "Jira base URL", never
  // "API URL": it is the address people open Jira at, and the REST paths are
  // added by the server.
  'admin.jira.title': 'Jira',
  'admin.jira.description':
    'Connect this server to one Jira (Data Center, Server or Cloud) so that teams can create their actions as Jira issues. Each team then saves its own access token in its settings.',
  'admin.jira.disable': 'Disable Jira',
  'admin.jira.enable': 'Enable Jira',
  'admin.jira.baseUrlLabel': 'Jira base URL',
  'admin.jira.baseUrlPlaceholder': 'https://jira.example.org',
  'admin.jira.baseUrlHint':
    'The address people open Jira at, with its context path if it has one (https://example.org/jira). It must start with https://, except on localhost.',
  'admin.jira.selfSignedTitle': 'Allow self-signed certificates',
  'admin.jira.selfSignedDescription':
    'Turns off the certificate check on every call to Jira, and every team’s token travels on those calls. Prefer giving the server your internal certificate authority with NODE_EXTRA_CA_CERTS.',
  'admin.jira.selfSignedDisable': 'Check Jira’s certificate again',
  'admin.jira.selfSignedEnable': 'Allow a self-signed certificate for Jira',
  'admin.jira.testHint': 'The test calls Jira without any token and saves nothing.',
  'admin.jira.testing': 'Testing…',
  'admin.jira.test': 'Test',
  'admin.jira.save': 'Save the Jira settings',
  'admin.jira.saved': 'Jira settings saved',
  'admin.jira.saveFailed': 'Failed to save the Jira settings',
  // The stored settings could not be read: Save stays unavailable, since it
  // would write the form's defaults over settings nobody saw.
  'admin.jira.loadFailed': 'The Jira settings could not be read. Nothing was changed; try again.',
  'admin.jira.retry': 'Try again',
  'admin.jira.addressChangeWarning':
    'Changing the address makes every team enter its Jira token again: a token is only ever sent to the address it was checked against.',
  'admin.jira.addressChangeConfirm': 'Change the Jira address? Every team will have to enter its Jira token again.',
  'admin.jira.testSucceeded': 'Jira answered: version {version}, {deployment}.',
  'admin.jira.deployment.Cloud': 'Jira Cloud',
  'admin.jira.deployment.Server': 'Jira Data Center or Server',
  'admin.jira.testFailed': 'The test failed: {error}',
  'admin.jira.testStatus': 'Jira answered with HTTP status {status}.',
  // The test route itself failed (an older pod during a rollout, a gateway):
  // Jira may not have been called, so nothing here names it.
  'admin.jira.testUnavailable': 'The server could not run the test. Try again in a moment.',
  'admin.jira.testRedirect': 'Jira redirects to {location}: enter that address instead.',
  'admin.jira.testMessages': 'Jira’s message: {messages}',

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
