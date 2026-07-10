const TEAM_SESSION_COOKIE_NAME = 'retro-team-session';

const cookieBaseOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
});

const cookieOptions = (maxAge) => ({
  ...cookieBaseOptions(),
  maxAge
});

const getTeamSessionTokenFromRequest = (req) => {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;

  for (const part of cookieHeader.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name !== TEAM_SESSION_COOKIE_NAME) continue;

    try {
      return decodeURIComponent(value.join('='));
    } catch {
      return null;
    }
  }

  return null;
};

const setTeamSessionCookie = (res, sessionToken, maxAge) => {
  res.cookie(TEAM_SESSION_COOKIE_NAME, sessionToken, cookieOptions(maxAge));
};

const clearTeamSessionCookie = (res) => {
  res.clearCookie(TEAM_SESSION_COOKIE_NAME, cookieBaseOptions());
};

export {
  clearTeamSessionCookie,
  getTeamSessionTokenFromRequest,
  setTeamSessionCookie
};
