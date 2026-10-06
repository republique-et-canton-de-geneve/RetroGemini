// English messages for the "adminLive" namespace (the super-admin Live sessions tab). Every key starts
// with "adminLive.". English is the source language: keep this text identical to
// what the console rendered before it was translated.
//
// A session's phase is named through `common.phase.*`, the phase bar's own
// names, so the operator reads the phase the participants see.
const adminLive = {
  'adminLive.heading': 'Active Sessions',
  'adminLive.empty': 'No active sessions',
  'adminLive.emptyHint': 'Sessions will appear here when users join a retrospective or health check.',
  'adminLive.safeToDeploy': 'Safe to deploy - no active sessions',
  'adminLive.warningTitle': 'Active sessions detected',
  'adminLive.warning':
    '{sessions} session(s) with {users} connected user(s). Consider waiting before deploying to avoid interrupting these sessions.',

  // Session cards
  'adminLive.type.healthcheck': 'Health Check',
  'adminLive.type.retrospective': 'Retrospective',
  'adminLive.live': 'LIVE',
  'adminLive.team': 'Team: {team}',
  'adminLive.connected': 'Connected',
  'adminLive.phaseLine': 'Phase: {phase}',
  'adminLive.statusLine': 'Status: {status}',
  // The stored codes, shown as they always were in English.
  'adminLive.statusValue.IN_PROGRESS': 'IN_PROGRESS',
  'adminLive.statusValue.CLOSED': 'CLOSED',
  'adminLive.participants': 'Connected Participants:',
};

export default adminLive;
