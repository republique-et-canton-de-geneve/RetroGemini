// Server-side authorization for live session updates. Clients send full
// session blobs over `update-session`; the UI only hides the facilitator
// controls, so the server must be the one to refuse a non-facilitator blob
// that alters facilitator-only state (phase navigation, reveal toggles, vote
// allocation, column/template structure...). A rejected sender is healed with
// the authoritative state, exactly like a stale write.

// Top-level session fields only the facilitator may change. Covers both retro
// and health check sessions; fields absent from a session type simply never
// differ.
const PROTECTED_SESSION_FIELDS = [
  'phase',
  'status',
  'name',
  'date',
  'columns',
  'icebreakerQuestion',
  'discussionFocusId',
  'reviewSummary',
  'templateId',
  'templateName',
  'dimensions'
];

// settings.* keys reserved to the facilitator. The timer runtime fields
// (timerRunning, timerSeconds, timerStartedAt, timerAcknowledged) and
// participantsPanelCollapsed are intentionally NOT protected: every client
// legitimately writes them (timer-expiry sync, alarm acknowledgement, panel
// toggle in health checks).
const PROTECTED_SETTINGS_FIELDS = [
  'isAnonymous',
  'maxVotes',
  'oneVotePerTicket',
  'revealBrainstorm',
  'revealHappiness',
  'revealRoti',
  'colorBy',
  'showParticipantVotes',
  'timerInitial'
];

// Deep structural equality, insensitive to object key order, with null and
// undefined treated as equivalent (clients round-trip blobs through JSON and
// optional fields flip between the two).
const valuesEqual = (a, b) => {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => valuesEqual(item, b[index]));
  }

  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!valuesEqual(a[key], b[key])) return false;
  }
  return true;
};

// Returns the list of facilitator-only field paths the incoming blob would
// change relative to the authoritative state (empty array = authorized for
// anyone). Pure and side-effect free so it can be unit-tested directly.
const findProtectedFieldViolations = (incoming, authoritative) => {
  const violations = [];
  if (!incoming || !authoritative) return violations;

  for (const field of PROTECTED_SESSION_FIELDS) {
    if (!valuesEqual(incoming[field], authoritative[field])) {
      violations.push(field);
    }
  }

  const incomingSettings = incoming.settings ?? {};
  const authoritativeSettings = authoritative.settings ?? {};
  for (const field of PROTECTED_SETTINGS_FIELDS) {
    if (!valuesEqual(incomingSettings[field], authoritativeSettings[field])) {
      violations.push(`settings.${field}`);
    }
  }

  return violations;
};

export { findProtectedFieldViolations, PROTECTED_SESSION_FIELDS, PROTECTED_SETTINGS_FIELDS };
