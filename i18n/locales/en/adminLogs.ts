// English messages for the "adminLogs" namespace (the super-admin Logs tab). Every key starts
// with "adminLogs.". English is the source language: keep this text identical to
// what the console rendered before it was translated.
//
// A log record's message is the server's own English text and is shown as it
// came (marked `lang="en"`); only the screen around it is translated.
const adminLogs = {
  'adminLogs.heading': 'Server Logs',
  'adminLogs.clear': 'Clear Logs',
  'adminLogs.confirmClear': 'Are you sure you want to clear all server logs?',
  'adminLogs.cleared': 'Server logs cleared',

  // Filters
  'adminLogs.levelLabel': 'Level:',
  'adminLogs.levelAll': 'All Levels',
  'adminLogs.levelFilter.error': 'Errors',
  'adminLogs.levelFilter.warn': 'Warnings',
  'adminLogs.levelFilter.info': 'Info',
  'adminLogs.sourceLabel': 'Source:',
  'adminLogs.sourceAll': 'All Sources',
  'adminLogs.sourceFilter.postgres': 'PostgreSQL',
  'adminLogs.sourceFilter.server': 'Server',
  'adminLogs.sourceFilter.socket': 'Socket.IO',
  'adminLogs.sourceFilter.email': 'Email',
  'adminLogs.entries_one': '{count} log entry',
  'adminLogs.entries_other': '{count} log entries',

  // Table
  'adminLogs.empty': 'No logs to display',
  'adminLogs.emptyHint': 'Server errors and warnings will appear here when they occur.',
  'adminLogs.column.timestamp': 'Timestamp',
  'adminLogs.column.level': 'Level',
  'adminLogs.column.source': 'Source',
  'adminLogs.column.message': 'Message',
  // A record's level and source badges: the stored codes, shown as they always
  // were in English (the badge upper-cases the level).
  'adminLogs.level.error': 'error',
  'adminLogs.level.warn': 'warn',
  'adminLogs.level.info': 'info',
  'adminLogs.source.postgres': 'postgres',
  'adminLogs.source.server': 'server',
  'adminLogs.source.socket': 'socket',
  'adminLogs.source.email': 'email',
};

export default adminLogs;
