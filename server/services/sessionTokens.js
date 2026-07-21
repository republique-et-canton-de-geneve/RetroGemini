import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

const SESSION_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_VERSION = 'rg1';
const TEAM_TOKEN_TYPE = 'team-session';
const SUPER_ADMIN_TOKEN_TYPE = 'super-admin';
const INVITE_TOKEN_TYPE = 'team-invite';

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

const resolveSigningSecret = ({ tokenSecret }) => {
  const stableSecret = tokenSecret || process.env.SESSION_TOKEN_SECRET;
  if (stableSecret) {
    return stableSecret;
  }

  console.warn('[Security] SESSION_TOKEN_SECRET is not configured; session tokens and newly minted invite links will not survive restarts or multi-pod routing. Set a stable SESSION_TOKEN_SECRET so invite links keep working until the team password is rotated.');
  return randomBytes(32).toString('base64url');
};

const createTokenService = ({ secureCompare, superAdminPassword, tokenSecret = undefined, now = () => Date.now() }) => {
  const signingSecret = resolveSigningSecret({ tokenSecret });

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

  // Invite credentials (hardening stage 7e) replace the plaintext team
  // password inside invite links. They are deliberately different from
  // session tokens:
  // - Deterministic: no iat/exp/nonce claims, so the same team + epoch always
  //   derives the same credential. It is never stored server-side — any
  //   authenticated session can re-derive it on demand, which is what lets
  //   the client stop holding the plaintext password for invite minting.
  // - Non-expiring: invite links historically embedded the password and lived
  //   until the team rotated it. Revocation is by epoch instead of time —
  //   rotating the team password bumps the team's inviteEpoch, which
  //   invalidates every outstanding invite link at once.
  const createInviteCredential = (teamId, inviteEpoch) => {
    const payload = {
      v: 1,
      type: INVITE_TOKEN_TYPE,
      teamId,
      epoch: inviteEpoch
    };
    const encodedPayload = encodePayload(payload);
    const signature = signPayload(encodedPayload, signingSecret);
    return `${TOKEN_VERSION}.${encodedPayload}.${signature}`;
  };

  const validateInviteCredential = (credential) => {
    if (!credential || typeof credential !== 'string') {
      return null;
    }

    const parts = credential.split('.');
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

    // The type claim keeps token families sealed off from each other: a
    // session token can never be replayed as an invite credential and an
    // invite credential can never authenticate as a session token.
    if (!payload || payload.type !== INVITE_TOKEN_TYPE) {
      return null;
    }

    if (typeof payload.teamId !== 'string' || !payload.teamId || typeof payload.epoch !== 'number') {
      return null;
    }

    return {
      teamId: payload.teamId,
      epoch: payload.epoch
    };
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
    createInviteCredential,
    validateInviteCredential,
    createSuperAdminToken,
    validateSuperAdminToken,
    validateSuperAdminAuth,
    sessionTokenExpiryMs: SESSION_TOKEN_EXPIRY_MS
  };
};

export { createTokenService };
