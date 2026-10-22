/**
 * Decision D3b — cutting the live-session sockets of a team whose password
 * changed, on every pod.
 *
 * HTTP needs nothing from here: every team route reads the team's session
 * epoch on every request (`dataStore.loadTeamAuthState`), so a revoked token
 * is refused the moment the rotation commits. A socket is different: it
 * authenticated once, at `join-session`, and stays in its room until it
 * disconnects. So the pod that rotated sweeps its own sockets, and tells the
 * others through the Socket.IO adapter to sweep theirs. The broadcast carries
 * a team id and nothing else, and it is only a hint: every pod decides by
 * reading the team's epoch again, so a forged, late or duplicated event can
 * never cut a socket whose token is still current. A pod that misses the
 * broadcast (a degraded adapter) still cuts within a minute, through the
 * periodic sweep of `socketHandlers.js`.
 *
 * The routes are registered before the socket handlers (the socket handlers
 * own `leaveCurrentSession`, which the sweep needs), so the sweeper is
 * attached afterwards. Built in `server.js` and handed to every registrar that
 * rotates; the registrars default to the no-op below so their test harnesses
 * need no change, which makes `server.js` the load-bearing wiring —
 * `__tests__/sessionRevocationWiring.test.ts` asserts it against that file.
 */

// The server-side event, payload `{ teamId: string }`. A 40.x/41.0 pod has no
// listener for it and ignores it.
export const TEAM_SESSIONS_REVOKED_EVENT = 'team-sessions-revoked';

export const NO_OP_SESSION_REVOCATION = Object.freeze({
  revokeTeamSessions: async () => undefined,
  sweepAllLocal: async () => undefined,
  attachLocalSweeper: () => undefined
});

export const createSessionRevocation = ({ io, serverRuntime }) => {
  let localSweep = null;

  // Never throws: the callers run after the answer has gone (the password
  // routes) or inside a restore whose outcome must not depend on it.
  const sweepLocal = async (teamId) => {
    if (typeof localSweep !== 'function') return;
    try {
      await localSweep(teamId);
    } catch (err) {
      console.warn('[Server] The session revocation sweep failed; the periodic sweep retries it', err);
    }
  };

  return {
    /** Cuts the team's stale sockets on this pod, then asks every other pod to. */
    revokeTeamSessions: async (teamId) => {
      await sweepLocal(teamId);
      // The guard `invalidateSessionCaches` uses: the in-memory adapter of a
      // single-pod deployment does not support serverSideEmit, and warns.
      if (serverRuntime?.multiPodAdapter && typeof io?.serverSideEmit === 'function') {
        try {
          io.serverSideEmit(TEAM_SESSIONS_REVOKED_EVENT, { teamId });
        } catch (err) {
          console.warn('[Server] Failed to broadcast a team session revocation to the other pods; their periodic sweep covers it', err);
        }
      }
    },
    /** Re-checks every socket on this pod (after a whole-store restore). */
    sweepAllLocal: () => sweepLocal(null),
    /** Called once by `registerSocketHandlers`. */
    attachLocalSweeper: (sweep) => {
      localSweep = sweep;
    }
  };
};
