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
  'adminBackups.size.bytes': '{size} B',
  'adminBackups.size.kilobytes': '{size} KB',
  'adminBackups.size.megabytes': '{size} MB',
  'adminBackups.protected.on': 'Protected from auto-cleanup',
  'adminBackups.protected.off': 'Click to protect from auto-cleanup',
  'adminBackups.download': 'Download',
  'adminBackups.downloadLabel': 'Download backup',
  'adminBackups.restore': 'Restore',
  'adminBackups.restoreLabel': 'Restore backup',
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
  'adminBackups.notice.deleted': 'Backup deleted',
  'adminBackups.notice.deleteFailed': 'Failed to delete backup',
  'adminBackups.notice.updateFailed': 'Failed to update backup',
};

export default adminBackups;
