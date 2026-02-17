const createTeamService = ({ dataStore }) => {
  const sanitizeTeamForClient = (team) => {
    if (!team) return null;
    const { passwordHash, ...safeTeam } = team;
    return safeTeam;
  };

  const authenticateTeam = async (teamId, password) => {
    const team = await dataStore.loadTeam(teamId);

    if (!team) {
      return { team: null, error: 'team_not_found' };
    }

    if (!password || team.passwordHash !== password) {
      return { team: null, error: 'invalid_password' };
    }

    return { team, error: null };
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
