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
  'adminBackups.type.imported': 'imported',
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
  'adminBackups.notice.restoreInvalid':
    'This backup cannot be restored: its content is not a valid archive. Nothing was changed.',

  // Importing a backup file
  'adminBackups.import.title': 'Import a backup file',
  'adminBackups.import.description':
    'Add a backup file downloaded from this console (.json.gz), or a JSON archive, to the list below. Importing restores nothing: afterwards, restore one or more teams from it, or all data. An imported file is never removed automatically, and neither is the snapshot each restore takes first: delete them when you no longer need them.',
  'adminBackups.import.fileLabel': 'Backup file',
  'adminBackups.import.hint': 'A .json.gz or .json file of {max} MB at most.',
  'adminBackups.import.hintNoLimit': 'A .json.gz or .json file.',
  'adminBackups.import.submit': 'Import the file',
  'adminBackups.import.importing': 'Importing...',
  'adminBackups.import.status.importing': 'Importing "{name}" ({size})...',
  'adminBackups.import.imported': '"{name}" was imported. Teams in this file: {count}.',
  'adminBackups.import.error.noFile': 'Choose a backup file first.',
  'adminBackups.import.error.emptyFile': 'This file is empty.',
  'adminBackups.import.error.tooLarge': 'This file is larger than the server accepts: {max} MB at most.',
  'adminBackups.import.error.tooLargeUnpacked':
    'Once unpacked, this archive is larger than the server accepts: {max} MB at most.',
  'adminBackups.import.error.proxyTooLarge':
    'The network in front of the server refused a file this large before it reached the application. Ask your operator to raise the upload limit of the ingress or proxy.',
  'adminBackups.import.error.invalidFormat':
    'This file is not a backup archive, or it is incomplete: it must hold JSON, compressed with gzip or not.',
  'adminBackups.import.error.invalidData': 'This file holds no list of teams, so it is not a backup of this application.',
  'adminBackups.import.error.teamMalformed':
    'Some entries of this file are not teams (no id or no name): {count}. Nothing was imported.',
  'adminBackups.import.error.duplicateTeams': 'This file holds the same team more than once ({ids}). Nothing was imported.',
  'adminBackups.import.error.listMalformed': 'This file is damaged: "{field}" is not a list. Nothing was imported.',
  'adminBackups.import.error.inProgress': 'Another file is being imported. Wait for it to finish, then try again.',
  'adminBackups.import.error.unavailable':
    'This server cannot import files yet, probably because an update is in progress. Try again in a few minutes.',
  'adminBackups.import.error.uncertain':
    'No answer came back from the server, but the file may still be imported: it can take a minute to appear in the list below. Check the list before importing the file again.',
  'adminBackups.import.error.failed': 'The file could not be imported. Check the list below before trying again.',

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
