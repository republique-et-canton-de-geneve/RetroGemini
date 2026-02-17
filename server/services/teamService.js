const createTeamService = ({ dataStore }) => {
  const sanitizeTeamForClient = (team) => {
    if (!team) return null;
    const { passwordHash, ...safeTeam } = team;
    return safeTeam;
  };

  const authenticateTeam = async (teamId, password) => {
    const currentData = await dataStore.loadPersistedData();
    const team = currentData.teams.find((t) => t.id === teamId);

    if (!team) {
      return { team: null, error: 'team_not_found' };
    }

    if (!password || team.passwordHash !== password) {
      return { team: null, error: 'invalid_password' };
    }

    return { team, error: null, currentData };
  };

  const atomicUpdateTeam = async (teamId, updater) => {
    const MAX_RETRIES = 5;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const currentData = await dataStore.loadPersistedData();
      const teamIndex = currentData.teams.findIndex((t) => t.id === teamId);

      if (teamIndex === -1) {
        return { success: false, error: 'team_not_found' };
      }

      const updatedTeam = updater(currentData.teams[teamIndex]);
      if (!updatedTeam) {
        return { success: true, team: currentData.teams[teamIndex] };
      }

      currentData.teams[teamIndex] = updatedTeam;
      const revision = Number(currentData.meta?.revision ?? 0);
      const result = await dataStore.atomicSavePersistedData(currentData, revision);

      if (result.success) {
        dataStore.setPersistedData(result.data);
        return { success: true, team: updatedTeam };
      }

      console.warn(`[Server] Team update conflict, retry ${attempt + 1}/${MAX_RETRIES}`);
    }

    return { success: false, error: 'max_retries_exceeded' };
  };

  return {
    sanitizeTeamForClient,
    authenticateTeam,
    atomicUpdateTeam
  };
};

export { createTeamService };
