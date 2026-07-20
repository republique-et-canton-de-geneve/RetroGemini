import { hashPassword, verifyPassword, isHashedPassword } from './passwordHashing.js';

const createTeamService = ({ dataStore, tokenService = null }) => {
  const sanitizeTeamForClient = (team) => {
    if (!team) return null;
    const { passwordHash, ...safeTeam } = team;
    return safeTeam;
  };

  // Hardening stage 7c: dual-verify. Hashed records verify through scrypt,
  // legacy plaintext records through a constant-time compare. A legacy record
  // that successfully verifies is upgraded to a hash in place (rehash-on-auth);
  // the guarded updater plus the store's CAS retry make the two-pod upgrade
  // race harmless, and an upgrade failure never fails the authentication.
  const verifyTeamPassword = async (team, password) => {
    if (!password || !team || !(await verifyPassword(password, team.passwordHash))) {
      return false;
    }

    if (!isHashedPassword(team.passwordHash)) {
      try {
        const upgraded = await hashPassword(password);
        await dataStore.atomicTeamUpdate(team.id, (currentTeam) => {
          if (isHashedPassword(currentTeam.passwordHash) || currentTeam.passwordHash !== password) {
            return null;
          }
          return { ...currentTeam, passwordHash: upgraded };
        });
      } catch (err) {
        console.warn(`[Server] Failed to upgrade password record for team ${team.id}`, err);
      }
    }

    return true;
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
        // Opportunistic legacy upgrade: a restored pre-hashing session
        // authenticates via its token but still sends the echoed plaintext
        // password on every call. Without this, such a record would stay in
        // clear text until token expiry or the next fresh login.
        if (password && !isHashedPassword(team.passwordHash)) {
          await verifyTeamPassword(team, password);
        }
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

export { createTeamService };
