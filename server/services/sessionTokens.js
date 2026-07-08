import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SESSION_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_VERSION = 'rg1';
const TEAM_TOKEN_TYPE = 'team-session';
const SUPER_ADMIN_TOKEN_TYPE = 'super-admin';

const encodePayload = (payload) => {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

const decodePayload = (encoded) => {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
};

const signPayload = (encodedPayload, signingSecret) => {
  return createHmac('sha256', signingSecret).update(encodedPayload).digest('base64url');
};

const secureTokenCompare = (a, b) => {
  const left = Buffer.from(a || '', 'utf8');
  const right = Buffer.from(b || '', 'utf8');
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

const resolveSigningSecret = ({ tokenSecret, superAdminPassword }) => {
  const stableSecret = tokenSecret || process.env.SESSION_TOKEN_SECRET || superAdminPassword || process.env.SUPER_ADMIN_PASSWORD;
  if (stableSecret) {
    return stableSecret;
  }

  console.warn('[Security] SESSION_TOKEN_SECRET is not configured; session tokens will not survive restarts or multi-pod routing.');
  return randomBytes(32).toString('base64url');
};

const createTokenService = ({ secureCompare, superAdminPassword, tokenSecret, now = () => Date.now() }) => {
  const signingSecret = resolveSigningSecret({ tokenSecret, superAdminPassword });

  const createSignedToken = (type, claims) => {
    const issuedAt = now();
    const payload = {
      v: 1,
      type,
      iat: issuedAt,
      exp: issuedAt + SESSION_TOKEN_EXPIRY_MS,
      nonce: randomBytes(16).toString('base64url'),
      ...claims
    };
    const encodedPayload = encodePayload(payload);
    const signature = signPayload(encodedPayload, signingSecret);
    return `${TOKEN_VERSION}.${encodedPayload}.${signature}`;
  };

  const validateSignedToken = (token, expectedType) => {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
      return null;
    }

    const [, encodedPayload, signature] = parts;
    const expectedSignature = signPayload(encodedPayload, signingSecret);
    if (!secureTokenCompare(signature, expectedSignature)) {
      return null;
    }

    let payload;
    try {
      payload = decodePayload(encodedPayload);
    } catch {
      return null;
    }

    if (!payload || payload.type !== expectedType) {
      return null;
    }

    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || now() > payload.exp) {
      return null;
    }

    return payload;
  };

  const createSessionToken = (teamId, visitorId) => {
    return createSignedToken(TEAM_TOKEN_TYPE, {
      teamId,
      visitorId: visitorId ?? null
    });
  };

  const validateSessionToken = (token) => {
    const payload = validateSignedToken(token, TEAM_TOKEN_TYPE);
    if (!payload || typeof payload.teamId !== 'string' || !payload.teamId) {
      return null;
    }

    return {
      teamId: payload.teamId,
      visitorId: typeof payload.visitorId === 'string' ? payload.visitorId : null,
      createdAt: payload.iat
    };
  };

  const invalidateSessionToken = () => {
    // Signed stateless tokens cannot be revoked locally. Callers must still
    // validate that the referenced team exists before restoring a session.
    return undefined;
  };

  const createSuperAdminToken = () => {
    return createSignedToken(SUPER_ADMIN_TOKEN_TYPE, {});
  };

  const validateSuperAdminToken = (token) => {
    return !!validateSignedToken(token, SUPER_ADMIN_TOKEN_TYPE);
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
