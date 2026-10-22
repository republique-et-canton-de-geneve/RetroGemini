import { randomBytes } from 'crypto';

/**
 * Decision D3b — a password rotation revokes the team's open sessions.
 *
 * Every team session token carries the team's *session epoch* (the
 * `sessionEpoch` claim, see `sessionTokens.js`), and a token is valid only
 * while its epoch is the team's current one. The epoch lives in a row of its
 * own, `team-auth:{teamId}` (see `dataStore.loadTeamAuthState`), which every
 * rotation rewrites in the same transaction as the password: the three
 * password-changing routes, and the restores that change which password opens
 * a team.
 *
 * This module is the rule, pure: no store, no clock, no request. Every caller
 * that decides whether a token is still good — `teamService.authenticateTeam`,
 * `teamService.verifySessionToken`, the socket join and the socket sweep —
 * goes through `sessionVerdict`, so the HTTP and the socket rules cannot drift
 * apart.
 */

// The epoch of a team that has never rotated: no `team-auth:` row exists for
// it. Every team is in this state the day this release is deployed, which is
// what keeps the deploy from signing anybody out.
export const DEFAULT_SESSION_EPOCH = '0';

// The error code a revoked token is answered with, on every team route and in
// the socket's `join-denied` cause.
export const SESSION_REVOKED_ERROR = 'session_revoked';

// A random opaque value, never a counter. A counter that a restore or a
// database rollback takes down and a later rotation takes up again repeats an
// earlier value, and that revives every token minted under the password of
// that time. 128 random bits never repeat. Never `'0'` either: 22 base64url
// characters.
export const newSessionEpoch = () => randomBytes(16).toString('base64url');

/**
 * A team's auth row that cannot be read as one. Distinct from a query error,
 * because the socket treats the two differently: a query error during an
 * outage is accepted on the token's signature (and re-checked by the periodic
 * sweep), but a corrupt row is permanent, and accepting on it would let every
 * token of that team join — revoked ones included — for as long as the row
 * stays corrupt, while every HTTP route refuses them. Carries the team id,
 * never the stored text.
 */
export class TeamAuthRowCorruptError extends Error {
  constructor(teamId) {
    super(`The session epoch row of team ${JSON.stringify(String(teamId))} cannot be read; a password change repairs it`);
    this.name = 'TeamAuthRowCorruptError';
    this.teamId = teamId;
  }
}

/**
 * The stored text of a `team-auth:` row, read strictly. Only what the rule
 * reads is checked — `sessionEpoch` a non-empty string, `revokedAt` a finite
 * number — and every other field (`v` included) is ignored: a later release
 * may add one, and a pod of this release must keep reading that row during a
 * rollback.
 */
export const parseTeamAuthRow = (text, teamId) => {
  let row;
  try {
    row = JSON.parse(text);
  } catch {
    throw new TeamAuthRowCorruptError(teamId);
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TeamAuthRowCorruptError(teamId);
  const { sessionEpoch, revokedAt } = row;
  if (typeof sessionEpoch !== 'string' || sessionEpoch === '') throw new TeamAuthRowCorruptError(teamId);
  if (typeof revokedAt !== 'number' || !Number.isFinite(revokedAt)) throw new TeamAuthRowCorruptError(teamId);
  return { sessionEpoch, revokedAt };
};

/**
 * Whether a token is still current for its team.
 *
 * `claims` is what `tokenService.validateSessionToken` returned
 * (`{ sessionEpoch, createdAt }`); `state` is `dataStore.loadTeamAuthState`'s
 * answer (`{ sessionEpoch, revokedAt }`).
 *
 * A token that carries the claim matches only the current epoch, by strict
 * equality: an epoch-bearing token minted under any other value is refused,
 * "newer" ones included — those can only come from a database rollback, and
 * refusing them is the safe direction.
 *
 * A token without the claim was minted before this release, or by an older pod
 * during the rollout. It outlives no rotation made after it was issued
 * (`createdAt >= revokedAt`); with no rotation ever made it is current, which
 * is why deploying signs nobody out.
 */
export const isSessionCurrent = (claims, state) => {
  if (typeof claims?.sessionEpoch === 'string') return claims.sessionEpoch === state.sessionEpoch;
  if (state.revokedAt === null || state.revokedAt === undefined) return true;
  return typeof claims?.createdAt === 'number' && claims.createdAt >= state.revokedAt;
};

/**
 * The one verdict every caller uses: `'current'`, `'revoked'` or
 * `'team_not_found'`. Callers turn it into their own answer (an HTTP code, a
 * `join-denied` cause, a cut socket).
 */
export const sessionVerdict = (claims, state) => {
  if (!state?.exists) return 'team_not_found';
  return isSessionCurrent(claims, state) ? 'current' : 'revoked';
};
