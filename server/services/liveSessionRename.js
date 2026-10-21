// Carries a team-record write into the live session.
//
// `/api/team/:teamId/retrospective/:id/name` (and its health-check twin) write
// the team record only. A retro being run at that moment also lives in
// `session:{id}` — the blob every participant's client syncs over the socket —
// and nothing ever told it. That divergence is where incident ISS began
// (2026-10-12): participants' clients kept the old name, the session kept it
// too, and the team record had the new one, so the title on screen depended on
// which copy a client had read last, and a client that "corrected" the session
// from its cached team record was writing a facilitator-only field.
//
// So after a rename lands, the live session is renamed through the same
// compare-and-swap every socket write goes through (`saveSessionState`, which
// bumps `_rev`), this pod's cache is updated, and the room is sent the saved
// state. It is best-effort by design: the team-record rename is what the
// facilitator asked for and has already succeeded, so a failure here is logged
// and never turns that answer into an error. The team-record `_rev` is still
// not touched (audit H35); the *session* revision has to move, because that is
// how every connected client learns the name changed.
//
// The rename is one use of a general patch (`createLiveSessionPatch`): any
// team-record write the live session must learn — a Jira issue key stamped on
// an action is the second — goes through the same loop, so the team check, the
// retries and the broadcast are written once.

const DEFAULT_MAX_ATTEMPTS = 3;

// The registrars default to these so their test harnesses need no session
// store; `server.js` wires the real ones, and a source assertion in
// `__tests__/liveSessionRename.test.ts` checks that it does.
const NO_OP_LIVE_SESSION_RENAME = async () => 'disabled';
const NO_OP_LIVE_SESSION_PATCH = async () => 'disabled';

/**
 * Builds the patch: `({ teamId, sessionId, mutate, purpose })` reads the live
 * session, shows it to `mutate`, and saves what `mutate` returns through the
 * session compare-and-swap. `mutate(current)` returns the new session, or
 * `null` when it has nothing to change; it runs again on the newer state when a
 * socket write lands between the read and the save, so it must be a pure
 * function of what it is shown. `purpose` names the write in the log lines.
 *
 * Answers `'patched'`, `'no-session'` (not being run), `'other-team'`,
 * `'unchanged'` (`mutate` returned null), `'conflict'` (still changing after
 * `maxAttempts`) or `'failed'` (a store error, or `mutate` threw). Never throws.
 */
const createLiveSessionPatch = ({ dataStore, sessionCache, io, maxAttempts = DEFAULT_MAX_ATTEMPTS }) =>
  async ({ teamId, sessionId, mutate, purpose = 'Patch' }) => {
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const current = await dataStore.loadSessionState(sessionId);
        // Not being run (never started, or its session state is gone): the
        // team record is the only copy, and it already has the write.
        if (!current) return 'no-session';
        // A session is only ever patched on behalf of the team that owns it,
        // the same rule `join-session` enforces (audit H1). `mutate` is not
        // even shown another team's session.
        if (current.teamId !== teamId) return 'other-team';

        const next = mutate(current);
        if (!next) return 'unchanged';

        // Built on the revision read above, whatever `mutate` put on its
        // answer: a dropped `_rev` would read as stale on every attempt, and a
        // raised one would overwrite a socket write that landed meanwhile.
        const result = await dataStore.saveSessionState(sessionId, { ...next, _rev: current._rev });
        if (result.success) {
          sessionCache.set(sessionId, result.data);
          io.to(sessionId).emit('session-update', result.data);
          return 'patched';
        }
        // A socket write landed between the read and the save: read the newer
        // state and try again rather than overwrite it.
      }
      console.warn(`[Server] ${purpose} of ${JSON.stringify(sessionId)} not carried into its live session: it kept changing (${maxAttempts} attempts)`);
      return 'conflict';
    } catch (err) {
      console.warn(`[Server] ${purpose} of ${JSON.stringify(sessionId)} not carried into its live session`, err);
      return 'failed';
    }
  };

const createLiveSessionRename = ({ dataStore, sessionCache, io, maxAttempts = DEFAULT_MAX_ATTEMPTS }) => {
  const patch = createLiveSessionPatch({ dataStore, sessionCache, io, maxAttempts });
  return async ({ teamId, sessionId, name }) => {
    const outcome = await patch({
      teamId,
      sessionId,
      purpose: 'Rename',
      mutate: (current) => (current.name === name ? null : { ...current, name })
    });
    return outcome === 'patched' ? 'renamed' : outcome;
  };
};

export { createLiveSessionPatch, createLiveSessionRename, NO_OP_LIVE_SESSION_PATCH, NO_OP_LIVE_SESSION_RENAME };
