// `hashPassword` and `isHashedPassword` are no longer imported here: with the
// dual-verify fallback gone (H23), this module neither derives a hash nor asks
// whether a stored value is one. Hashing on password change lives in
// `teamRoutes.js`, and converting a legacy record lives in
// `passwordMigration.js` — the authentication path does no writes at all now.
import { verifyPassword } from './passwordHashing.js';

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
    const { passwordHash, inviteEpoch, ...safeTeam } = team;
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

  // Hardening stage 7a: a signed team session token is accepted as an
  // alternative credential to the plaintext password. Either valid credential
  // grants access; the token must be minted for the exact team being
  // addressed. Since stage 7c the token is checked first: 7b clients send
  // both credentials on every call, the HMAC check is cheap, and password
  // verification is deliberately expensive now that records are hashed. The
  // outcome is identical to the old password-first order for every
  // credential combination.
  const authenticateTeam = async (teamId, password, sessionToken) => {
    const team = await dataStore.loadTeam(teamId);

    if (!team) {
      return { team: null, error: 'team_not_found' };
    }

    if (sessionToken && tokenService) {
      const claims = tokenService.validateSessionToken(sessionToken);
      if (claims && claims.teamId === teamId) {
        // The opportunistic legacy upgrade that stood here went with
        // rehash-on-auth (H23): it existed to catch a record whose team only
        // ever authenticates by token, and it worked by calling
        // `verifyTeamPassword` purely for its side effect — which no longer has
        // one. `migrateLegacyPasswords` covers that record now, at startup and
        // after a restore, without an authentication path doing hidden writes.
        return { team, error: null };
      }
    }

    if (password && (await verifyTeamPassword(team, password))) {
      return { team, error: null };
    }

    return { team: null, error: password ? 'invalid_password' : sessionToken ? 'invalid_token' : 'invalid_password' };
  };

  const atomicUpdateTeam = async (teamId, updater) => {
    return await dataStore.atomicTeamUpdate(teamId, updater);
  };

  return {
    sanitizeTeamForClient,
    authenticateTeam,
    atomicUpdateTeam,
    verifyTeamPassword
  };
};

export { createTeamService, getTeamInviteEpoch };
