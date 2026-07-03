// Thin HTTP client for the setup/teardown parts of the load test. Uses the
// same public REST endpoints as the real front-end (dataService).

const jsonRequest = async (baseUrl, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {})
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON error bodies (e.g. proxy errors) still surface via status below.
  }
  if (!response.ok) {
    const reason = payload?.error ?? `HTTP ${response.status}`;
    throw new Error(`${path} failed: ${reason}`);
  }
  return payload;
};

const createTeam = async (baseUrl, { name, password }) => {
  const { team } = await jsonRequest(baseUrl, '/api/team/create', { name, password });
  return team;
};

const setTeamMembers = async (baseUrl, teamId, password, members) => {
  const { team } = await jsonRequest(baseUrl, `/api/team/${teamId}/members`, { password, members });
  return team;
};

const persistRetrospective = async (baseUrl, teamId, password, retrospective) => {
  await jsonRequest(baseUrl, `/api/team/${teamId}/retrospective/${retrospective.id}`, {
    password,
    retrospective
  });
};

const loadTeam = async (baseUrl, teamId, password) => {
  const { team } = await jsonRequest(baseUrl, `/api/team/${teamId}`, { password });
  return team;
};

const deleteTeam = async (baseUrl, teamId, password) => {
  await jsonRequest(baseUrl, `/api/team/${teamId}/delete`, { password });
};

export { createTeam, setTeamMembers, persistRetrospective, loadTeam, deleteTeam };
