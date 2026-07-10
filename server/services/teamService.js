const createTeamService = ({ dataStore, tokenService = null }) => {
  const sanitizeTeamForClient = (team) => {
    if (!team) return null;
    const { passwordHash, ...safeTeam } = team;
    return safeTeam;
  };

  // Hardening stage 7a: a signed team session token is accepted as an
  // alternative credential to the plaintext password, so clients can stop
  // sending the password on every call (7b) before passwords are hashed at
  // rest (7c). Either valid credential grants access; the token must be
  // minted for the exact team being addressed.
  const authenticateTeam = async (teamId, password, sessionToken) => {
    const team = await dataStore.loadTeam(teamId);

    if (!team) {
      return { team: null, error: 'team_not_found' };
    }

    if (password && team.passwordHash === password) {
      return { team, error: null };
    }

    if (sessionToken && tokenService) {
      const claims = tokenService.validateSessionToken(sessionToken);
      if (claims && claims.teamId === teamId) {
        return { team, error: null };
      }
    }

    return { team: null, error: password ? 'invalid_password' : sessionToken ? 'invalid_token' : 'invalid_password' };
  };

  const atomicUpdateTeam = async (teamId, updater) => {
    return await dataStore.atomicTeamUpdate(teamId, updater);
  };

  return {
    sanitizeTeamForClient,
    authenticateTeam,
    atomicUpdateTeam
  };
};

export { createTeamService };
