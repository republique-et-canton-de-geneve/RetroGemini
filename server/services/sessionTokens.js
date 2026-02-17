import { randomBytes } from 'crypto';

const SESSION_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const createTokenService = ({ secureCompare, superAdminPassword }) => {
  const sessionTokens = new Map();
  const superAdminTokens = new Map();

  const generateSessionToken = () => randomBytes(32).toString('hex');

  const createSessionToken = (teamId, visitorId) => {
    const token = generateSessionToken();
    sessionTokens.set(token, {
      teamId,
      visitorId,
      createdAt: Date.now()
    });
    return token;
  };

  const validateSessionToken = (token) => {
    const session = sessionTokens.get(token);
    if (!session) return null;

    if (Date.now() - session.createdAt > SESSION_TOKEN_EXPIRY_MS) {
      sessionTokens.delete(token);
      return null;
    }

    return session;
  };

  const invalidateSessionToken = (token) => {
    sessionTokens.delete(token);
  };

  const createSuperAdminToken = () => {
    const token = generateSessionToken();
    superAdminTokens.set(token, { createdAt: Date.now() });
    return token;
  };

  const validateSuperAdminToken = (token) => {
    const session = superAdminTokens.get(token);
    if (!session) return false;

    if (Date.now() - session.createdAt > SESSION_TOKEN_EXPIRY_MS) {
      superAdminTokens.delete(token);
      return false;
    }

    return true;
  };

  const validateSuperAdminAuth = (body) => {
    if (!superAdminPassword) return false;

    const { password, sessionToken } = body || {};

    if (password && secureCompare(password, superAdminPassword)) {
      return true;
    }

    if (sessionToken && validateSuperAdminToken(sessionToken)) {
      return true;
    }

    return false;
  };

  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessionTokens.entries()) {
      if (now - session.createdAt > SESSION_TOKEN_EXPIRY_MS) {
        sessionTokens.delete(token);
      }
    }
    for (const [token, session] of superAdminTokens.entries()) {
      if (now - session.createdAt > SESSION_TOKEN_EXPIRY_MS) {
        superAdminTokens.delete(token);
      }
    }
  }, 60 * 60 * 1000);

  return {
    createSessionToken,
    validateSessionToken,
    invalidateSessionToken,
    createSuperAdminToken,
    validateSuperAdminToken,
    validateSuperAdminAuth,
    sessionTokenExpiryMs: SESSION_TOKEN_EXPIRY_MS
  };
};

export { createTokenService };
