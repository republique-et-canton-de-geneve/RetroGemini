// `hashPassword` and `isHashedPassword` are no longer imported here: with the
// dual-verify fallback gone (H23), this module neither derives a hash nor asks
// whether a stored value is one. Hashing on password change lives in
// `teamRoutes.js`, and converting a legacy record lives in
// `passwordMigration.js` — the authentication path does no writes at all now.
import { verifyPassword } from './passwordHashing.js';
import { sessionVerdict } from './sessionEpoch.js';

// The per-team invite epoch (hardening stage 7e) is the revocation counter for
// invite credentials: every password rotation bumps it, invalidating all
// outstanding invite links. Legacy records have no inviteEpoch field — they
// read as epoch 0 until their first rotation.
const getTeamInviteEpoch = (team) => (
  Number.isInteger(team?.inviteEpoch) ? team.inviteEpoch : 0
);

const createTeamService = ({ dataStore, tokenService = null }) => {
  const sanitizeTeamForClient = (team) => {
    if (!team) return null;
    // inviteEpoch is stripped alongside passwordHash so no client code path
    // can ever round-trip it back into an update: restoring an older epoch
    // would re-validate invite links that a password rotation revoked.
    // mergedFrom (the super-admin merge's provenance) is server-only: no
    // screen reads it, and `/update` refuses it anyway.
    // jiraClaims too: the Jira route's record of the issues being created
    // right now, which no screen reads and `/update` ignores, and
    // jiraParentClaims, its twin for the parent issues of `sessionParent`
    // mode. `jiraTarget` stays: it is a team setting the screens show; so does
    // `jiraParents`, the keys of each session's parent issue, which the batch
    // dialog and the Review step read.
    // teamFeedbacks stays on the record and leaves every team answer: the
    // Feedback Hub reads `/api/feedbacks/*`, no client version ever read the
    // field from a team, and the images it carries were the largest part of
    // the answer (300 KB of the 1 MB the largest team sent on every login,
    // restore and Dashboard refresh).
    const {
      passwordHash,
      inviteEpoch,
      mergedFrom: _mergedFrom,
      jiraClaims: _jiraClaims,
      jiraParentClaims: _jiraParentClaims,
      teamFeedbacks: _teamFeedbacks,
      ...safeTeam
    } = team;
    return safeTeam;
  };

  // Passwords verify through scrypt, and only through scrypt (decision D1's
  // final step, H23). The rehash-on-auth upgrade that used to live here — hash
  // a legacy record in place the first time its plaintext verified — went with
  // the dual-verify fallback it depended on: with `verifyPassword` refusing
  // every non-hashed stored value, a legacy record can no longer reach this
  // point at all, so the upgrade could never run. It was the one call site
  // where ignoring an `atomicTeamUpdate` result was correct (audit H2); that
  // exception no longer exists, and nothing in this file may reintroduce it.
  //
  // Legacy records are converted by `migrateLegacyPasswords` instead: at
  // startup, and after either restore route, which is what stops a rolled-back
  // archive from stranding a team.
  const verifyTeamPassword = async (team, password) => {
    if (!password || !team) {
      return false;
    }

    return await verifyPassword(password, team.passwordHash);
  };

  // Decision D3b: a session token is good only while the team's session epoch
  // is the one it carries (`sessionEpoch.js`). The verdict for a token on its
  // own — `/api/team/restore-session`, the AI routes — read from the team's
  // small auth row, never from its record. Answers `{ claims, state, error }`
  // with `error` one of null, 'invalid_token', 'team_not_found' and
  // 'session_revoked'. `teamId` binds the token to one team when given.
  const verifySessionToken = async (sessionToken, { teamId = null } = {}) => {
    const claims = tokenService ? tokenService.validateSessionToken(sessionToken) : null;
    if (!claims || (teamId !== null && claims.teamId !== teamId)) {
      return { claims: null, state: null, error: 'invalid_token' };
    }
    const state = await dataStore.loadTeamAuthState(claims.teamId);
    const verdict = sessionVerdict(claims, state);
    if (verdict === 'current') return { claims, state, error: null };
    return { claims, state, error: verdict === 'revoked' ? 'session_revoked' : 'team_not_found' };
  };

  // Hardening stage 7a: a signed team session token is accepted as an
  // alternative credential to the plaintext password. Either valid credential
  // grants access; the token must be minted for the exact team being
  // addressed. Since stage 7c the token is checked first: 7b clients send
  // both credentials on every call, the HMAC check is cheap, and password
  // verification is deliberately expensive now that records are hashed. The
  // outcome is identical to the old password-first order for every
  // credential combination.
  //
  // `needsTeam: false` is for a caller that only needs the verdict: most are
  // writes that then go through atomicUpdateTeam, which reads the record itself.
  // A valid token is then checked against the team's auth row alone
  // (`dataStore.loadTeamAuthState`: whether the record exists and the team's
  // session epoch, one statement, the record's value never read). Loading the
  // record parses the team's whole history (about 60 ms per MB on PostgreSQL),
  // which the write parses again right after, on every persist of a live
  // session. The answer is the same either way, `team` aside, which is then
  // null. A password still loads the record, to verify the hash.
  //
  // Decision D3b: a token whose epoch a password rotation replaced is refused
  // with `session_revoked` — on its own, and beside the old password a client
  // that logged in by password still sends — so the client has one code to
  // react to. Beside the *current* password it authenticates through the
  // password, as any stale token always did. A revoked token sent with no
  // password is answered from the auth row alone, before the record is read:
  // right after a rotation every invite-link participant's in-flight write
  // arrives exactly so, and each one used to cost a full parse only to be
  // refused. The codes stay string literals in this function
  // (`__tests__/jiraErrorCodes.test.ts` reads them from its source).
  const authenticateTeam = async (teamId, password, sessionToken, { needsTeam = true } = {}) => {
    // Decided once, so the paths below cannot disagree on what a valid token
    // is: null (no token for this team), 'current' or 'revoked'.
    const claims = sessionToken && tokenService ? tokenService.validateSessionToken(sessionToken) : null;
    let token = null;
    if (claims && claims.teamId === teamId) {
      const verdict = sessionVerdict(claims, await dataStore.loadTeamAuthState(teamId));
      if (verdict === 'team_not_found') {
        return { team: null, error: 'team_not_found' };
      }
      token = verdict;
      if (token === 'current' && !needsTeam) {
        return { team: null, error: null, via: 'session-token' };
      }
      // Nothing else could authenticate this request.
      if (token === 'revoked' && !password) {
        return { team: null, error: 'session_revoked' };
      }
    }

    const team = await dataStore.loadTeam(teamId);

    if (!team) {
      return { team: null, error: 'team_not_found' };
    }

    // The opportunistic legacy upgrade that stood here went with
    // rehash-on-auth (H23): it existed to catch a record whose team only ever
    // authenticates by token, and it worked by calling `verifyTeamPassword`
    // purely for its side effect — which no longer has one.
    // `migrateLegacyPasswords` covers that record now, at startup and after a
    // restore, without an authentication path doing hidden writes.
    if (token === 'current') {
      return { team, error: null, via: 'session-token' };
    }

    // `via` says which credential actually authenticated, for an audit row:
    // what the body *contained* says nothing, since a valid token wins over
    // any password sent beside it.
    if (password && (await verifyTeamPassword(team, password))) {
      return { team, error: null, via: 'team-password' };
    }

    if (token === 'revoked') {
      return { team: null, error: 'session_revoked' };
    }

    return { team: null, error: password ? 'invalid_password' : sessionToken ? 'invalid_token' : 'invalid_password' };
  };

  // `options` reach `dataStore.atomicTeamUpdate` as they are: the password
  // route passes `{ rotateSessionEpoch: true }` (decision D3b).
  const atomicUpdateTeam = async (teamId, updater, options) => {
    return await dataStore.atomicTeamUpdate(teamId, updater, options);
  };

  return {
    sanitizeTeamForClient,
    authenticateTeam,
    verifySessionToken,
    atomicUpdateTeam,
    verifyTeamPassword
  };
};

export { createTeamService, getTeamInviteEpoch };
