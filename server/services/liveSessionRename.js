// Carries a Dashboard rename into the live session.
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

const DEFAULT_MAX_ATTEMPTS = 3;

// The registrars default to this so their test harnesses need no session
// store; `server.js` wires the real one, and a source assertion in
// `__tests__/liveSessionRename.test.ts` checks that it does.
const NO_OP_LIVE_SESSION_RENAME = async () => 'disabled';

const createLiveSessionRename = ({ dataStore, sessionCache, io, maxAttempts = DEFAULT_MAX_ATTEMPTS }) =>
  async ({ teamId, sessionId, name }) => {
    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const current = await dataStore.loadSessionState(sessionId);
        // Not being run (never started, or its session state is gone): the
        // team record is the only copy, and it already has the new name.
        if (!current) return 'no-session';
        // A session id is only ever renamed on behalf of the team that owns
        // it, the same rule `join-session` enforces (audit H1).
        if (current.teamId !== teamId) return 'other-team';
        if (current.name === name) return 'unchanged';

        const result = await dataStore.saveSessionState(sessionId, { ...current, name });
        if (result.success) {
          sessionCache.set(sessionId, result.data);
          io.to(sessionId).emit('session-update', result.data);
          return 'renamed';
        }
        // A socket write landed between the read and the save: read the newer
        // state and try again rather than overwrite it.
      }
      console.warn(`[Server] Rename of ${JSON.stringify(sessionId)} not carried into its live session: it kept changing (${maxAttempts} attempts)`);
      return 'conflict';
    } catch (err) {
      console.warn(`[Server] Rename of ${JSON.stringify(sessionId)} not carried into its live session`, err);
      return 'failed';
    }
  };

export { createLiveSessionRename, NO_OP_LIVE_SESSION_RENAME };
