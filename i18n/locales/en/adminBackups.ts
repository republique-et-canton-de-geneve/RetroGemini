// English messages for the "adminBackups" namespace (the super-admin Backups tab). Every key starts
// with "adminBackups.". English is the source language: keep this text identical to
// what the console rendered before it was translated.
const adminBackups = {
  // Configuration summary
  'adminBackups.config.title': 'Configuration',
  'adminBackups.config.auto': 'Auto backups: {value}',
  'adminBackups.config.enabled': 'Enabled',
  'adminBackups.config.disabled': 'Disabled',
  'adminBackups.config.interval': 'Interval: {value}',
  'adminBackups.config.hours': '{hours}h',
  'adminBackups.config.maxCount': 'Max kept: {value}',
  'adminBackups.config.onStartup': 'Startup backup: {value}',
  'adminBackups.config.directory': 'Directory: {value}',

  // Checkpoint
  'adminBackups.checkpoint.create': 'Create Checkpoint',
  'adminBackups.checkpoint.placeholder': 'Optional label (e.g. Before v10 upgrade)',
  'adminBackups.checkpoint.creating': 'Creating...',

  // List
  'adminBackups.loading': 'Loading backups...',
  'adminBackups.empty': 'No backups yet',
  'adminBackups.emptyHint':
    'Backups will appear here after the first scheduled backup or when you create a checkpoint.',
  'adminBackups.column.type': 'Type',
  'adminBackups.column.label': 'Label / Date',
  'adminBackups.column.teams': 'Teams',
  'adminBackups.column.size': 'Size',
  'adminBackups.column.protected': 'Protected',
  // The stored kind, shown as it always was in English (the badge upper-cases it).
  'adminBackups.type.auto': 'auto',
  'adminBackups.type.manual': 'manual',
  'adminBackups.type.startup': 'startup',
  // The two labels the server writes itself. A manual checkpoint's label is
  // whatever the operator typed and is never translated.
  'adminBackups.label.startup': 'Server startup',
  'adminBackups.label.preRestore': 'Pre-restore snapshot',
  'adminBackups.label.preDelete': 'Pre-delete snapshot',
  'adminBackups.size.bytes': '{size} B',
  'adminBackups.size.kilobytes': '{size} KB',
  'adminBackups.size.megabytes': '{size} MB',
  'adminBackups.protected.on': 'Protected from auto-cleanup',
  'adminBackups.protected.off': 'Click to protect from auto-cleanup',
  'adminBackups.download': 'Download',
  'adminBackups.downloadLabel': 'Download backup',
  'adminBackups.restore': 'Restore',
  'adminBackups.restoreLabel': 'Restore backup',
  'adminBackups.restoreTeam': 'Restore a team',
  'adminBackups.restoreTeamLabel': 'Restore one team from this backup',
  'adminBackups.delete': 'Delete',
  'adminBackups.deleteLabel': 'Delete backup',
  'adminBackups.confirm.restore':
    'Restore data from backup "{name}"?\n\nA pre-restore snapshot will be created automatically before restoring.',
  'adminBackups.confirm.delete': 'Delete backup "{name}"?',

  // Notices
  'adminBackups.notice.inProgress': 'A backup is already in progress. Please wait.',
  'adminBackups.notice.createFailed': 'Failed to create checkpoint',
  'adminBackups.notice.created': 'Checkpoint created successfully',
  'adminBackups.notice.restoreFailed': 'Failed to restore backup',
  'adminBackups.notice.restored': 'Data restored successfully',
  'adminBackups.notice.restoreInProgress': 'Another restore is running. Wait for it to finish, then try again.',
  'adminBackups.notice.deleted': 'Backup deleted',
  'adminBackups.notice.deleteFailed': 'Failed to delete backup',
  'adminBackups.notice.updateFailed': 'Failed to update backup',

  // Restoring one team
  'adminBackups.teamRestore.title': 'Restore one team',
  'adminBackups.teamRestore.subtitle': 'From the backup "{name}". The other teams are not changed.',
  'adminBackups.teamRestore.loading': 'Reading the backup...',
  'adminBackups.teamRestore.empty': 'This backup holds no team.',
  'adminBackups.teamRestore.search': 'Search for a team',
  'adminBackups.teamRestore.listLabel': 'Teams in this backup',
  'adminBackups.teamRestore.noResult': 'No team matches this search.',
  'adminBackups.teamRestore.status.present': 'Exists',
  'adminBackups.teamRestore.status.renamed': 'Renamed since: {name}',
  'adminBackups.teamRestore.status.deleted': 'Deleted since',
  'adminBackups.teamRestore.counts':
    'Retrospectives: {retrospectives} · Health checks: {healthChecks} · Backlog actions: {actions} · Members: {members}',
  'adminBackups.teamRestore.explainExisting':
    'Its retrospectives, health checks, backlog, members and templates go back to this backup. Its name, password, recovery email and feedbacks stay as they are now.',
  'adminBackups.teamRestore.explainDeleted':
    'This team was deleted after this backup. It comes back with the password and recovery email it had then, and with the feedbacks kept since its deletion.',
  'adminBackups.teamRestore.explainDeletedJira':
    'If the team used Jira, it comes back without its Jira token, and actions it sent to Jira after this backup show as not in Jira: check Jira before creating them again.',
  'adminBackups.teamRestore.explainLive':
    'Anyone in one of its sessions right now sees it go back too. A snapshot of all data is taken first.',
  'adminBackups.teamRestore.nameLabel': 'Name of the restored team',
  'adminBackups.teamRestore.nameTaken': 'Another team is now called "{name}": choose another name.',
  'adminBackups.teamRestore.pick': 'Choose a team',
  'adminBackups.teamRestore.confirm': 'Restore {name}',
  'adminBackups.teamRestore.restoring': 'Restoring...',
  'adminBackups.teamRestore.restored': '{name} was restored from the backup',
  'adminBackups.teamRestore.restoredFeedbacksTwice':
    '{name} was restored from the backup, but some of its feedbacks now appear twice: delete the extra copy in the Feedback tab.',
  'adminBackups.teamRestore.restoredWithWarnings':
    '{name} was restored from the backup, but some of its open sessions could not be updated (ask the people in them to reload the page) and some of its feedbacks now appear twice (delete the extra copy in the Feedback tab).',
  'adminBackups.teamRestore.restoredSessionsBehind':
    '{name} was restored from the backup, but some of its open sessions could not be updated: ask the people in them to reload the page.',
  'adminBackups.teamRestore.error.listFailed': 'Could not read the teams of this backup',
  'adminBackups.teamRestore.error.failed': 'Failed to restore the team',
  'adminBackups.teamRestore.error.backupNotFound': 'This backup no longer exists.',
  'adminBackups.teamRestore.error.notInBackup': 'This team is not in this backup.',
  'adminBackups.teamRestore.error.malformed':
    'The data of this team in the backup cannot be restored ({fields}). Nothing was changed.',
  'adminBackups.teamRestore.error.teamChanged':
    'The team was deleted or created again meanwhile. Nothing was changed: try again.',
  'adminBackups.teamRestore.error.snapshotFailed': 'The safety snapshot could not be created, so nothing was restored.',
  'adminBackups.teamRestore.error.sessionReadFailed':
    'A session of this team could not be read. Nothing was changed: try again in a moment.',
  'adminBackups.teamRestore.error.secretDeleteFailed':
    'The Jira token this deleted team left behind could not be removed, so nothing was restored. Try again in a moment.',
};

export default adminBackups;
