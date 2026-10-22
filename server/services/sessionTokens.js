import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';
import { DEFAULT_SESSION_EPOCH } from './sessionEpoch.js';

const SESSION_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
// Fixed on purpose: a key derived under another salt cannot open what this one
// sealed, so changing it makes every stored team secret unreadable.
const KEY_DERIVATION_SALT = 'retrogemini';
const DERIVED_KEY_LENGTH = 32;
const TOKEN_VERSION = 'rg1';
const TEAM_TOKEN_TYPE = 'team-session';
const SUPER_ADMIN_TOKEN_TYPE = 'super-admin';
const INVITE_TOKEN_TYPE = 'team-invite';
const MERGE_PROVENANCE_TYPE = 'merge-provenance';

// The values the secret templates ship as SESSION_TOKEN_SECRET
// (k8s/secrets-templates, the k8s README, .env.example). They are published,
// so a key derived from one is no key at all: anyone holding a database dump
// could open every team's Jira token with it, and sign a session or
// super-admin token. Sealing refuses them (`canSealSecrets`); sessions keep
// working as before, and the startup log says why that is not safe either.
const TEMPLATE_SECRETS = new Set(['change-me-to-a-long-random-secret', 'change-me']);

const encodePayload = (payload) => {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
};

const decodePayload = (encoded) => {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
};

// Key order is not stable across a store round trip (PostgreSQL's jsonb sorts
// keys), so a signature over stored JSON signs it in one canonical form.
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
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

  // Since audit H1 the socket channel authenticates with these tokens too, so
  // an unstable secret no longer only breaks invite links and session restore:
  // after a restart or a non-sticky route, a live participant's automatic
  // re-join is refused and they drop out of an in-progress retrospective. That
  // makes a stable secret a zero-downtime requirement, not just a convenience.
  console.warn('[Security] SESSION_TOKEN_SECRET is not configured; session tokens and newly minted invite links will not survive restarts or multi-pod routing. Live participants will also be dropped from their session after a pod restart, because join-session authenticates with the same token. Set a stable SESSION_TOKEN_SECRET on every pod.');
  return randomBytes(32).toString('base64url');
};

const createTokenService = ({ secureCompare, superAdminPassword, tokenSecret = undefined, now = () => Date.now() }) => {
  // Read with the same expression `resolveSigningSecret` uses, so the two can
  // never disagree about which secret is in force.
  const hasStableSecret = Boolean(tokenSecret || process.env.SESSION_TOKEN_SECRET);
  const signingSecret = resolveSigningSecret({ tokenSecret });
  const isTemplateSecret = hasStableSecret && TEMPLATE_SECRETS.has(signingSecret);
  if (isTemplateSecret) {
    // The value is never logged: the line names the variable, and the fix.
    console.warn('[Security] SESSION_TOKEN_SECRET is the example value of the deployment templates, which anyone can read: session, invite and super-admin tokens signed with it can be forged, and teams cannot store a Jira token. Set a long random value, the same on every pod.');
  }

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

  // Decision D3b: a team session token carries the team's session epoch, and
  // is valid only while that epoch is the team's current one (see
  // `sessionEpoch.js`). The claim is *additive*: `rg1`, `v: 1` and every
  // claim before it stay as they were, because a 41.0 pod validates with
  // exactly those and ignores a claim it does not know — change any of them
  // and every token this release mints is refused by an old pod, which is a
  // mass logout on a rollback or whenever a request lands on one during the
  // rollout (`__tests__/sessionTokenCompatibility.test.ts` holds that).
  //
  // The epoch defaults to `'0'`, the epoch of a team that never rotated, so a
  // forgotten argument fails closed for any team that has: its token is
  // refused. Every call under `server/` passes it explicitly
  // (`__tests__/sessionTokenMint.test.ts`).
  const createSessionToken = (teamId, visitorId, { sessionEpoch = DEFAULT_SESSION_EPOCH } = {}) => {
    return createSignedToken(TEAM_TOKEN_TYPE, {
      teamId,
      visitorId: visitorId ?? null,
      sessionEpoch
    });
  };

  // `sessionEpoch` is the claim when it is a non-empty string, else null: a
  // token minted before this release, or by an older pod during the rollout,
  // which the epoch rule judges by its issue time (`createdAt`) instead.
  const validateSessionToken = (token) => {
    const payload = validateSignedToken(token, TEAM_TOKEN_TYPE);
    if (!payload || typeof payload.teamId !== 'string' || !payload.teamId) {
      return null;
    }

    return {
      teamId: payload.teamId,
      visitorId: typeof payload.visitorId === 'string' ? payload.visitorId : null,
      createdAt: payload.iat,
      sessionEpoch: typeof payload.sessionEpoch === 'string' && payload.sessionEpoch !== '' ? payload.sessionEpoch : null
    };
  };

  const invalidateSessionToken = () => {
    // Nothing to do per token: a token is revoked for its whole team, by the
    // team's session epoch (decision D3b) — a password rotation gives the team
    // a new one, and every token minted before stops validating on every route
    // and on the socket (`sessionEpoch.js`, `dataStore.loadTeamAuthState`).
    // Callers must still check that the referenced team exists.
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

  // The super-admin merge records which teams a merged team was built from
  // (`mergedFrom`), and that record decides where a source's feedbacks go when
  // the source is deleted. Before this release `/api/team/:teamId/update`
  // stored any field a team sent, `mergedFrom` included, and a pod of that
  // release still does during a rolling update — so a team could name any
  // other team as its "source" and receive its feedbacks. Each entry is
  // therefore signed by the merge, and an entry that does not verify is not
  // provenance at all. The signature covers the merged team's id and every
  // field of the entry — the digests the deletion compares included — so an
  // entry can neither be copied onto another team nor edited in place to make
  // a changed source read as unchanged.
  const provenancePayload = (mergedTeamId, entry) => {
    const { signature: _signature, ...fields } = entry;
    return encodePayload({ v: 2, type: MERGE_PROVENANCE_TYPE, mergedTeamId, entry: canonicalJson(fields) });
  };

  const signMergeProvenance = (mergedTeamId, entry) => signPayload(provenancePayload(mergedTeamId, entry), signingSecret);

  const verifyMergeProvenance = (mergedTeamId, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.signature !== 'string') return false;
    if (typeof mergedTeamId !== 'string' || typeof entry.teamId !== 'string') return false;
    return secureTokenCompare(entry.signature, signMergeProvenance(mergedTeamId, entry));
  };

  // A key for one purpose (`'jira-token/v1'` seals each team's Jira token),
  // derived from the signing secret with HKDF-SHA256 rather than stored
  // anywhere: every pod holding the same SESSION_TOKEN_SECRET derives the same
  // key, and a dump of the database alone holds none. The purpose is HKDF's
  // `info`, so each purpose gets an independent key and a key can never be
  // replayed as the HMAC secret above. Without a stable secret the key dies
  // with the process and differs per pod, and under a template's example
  // secret it is public — check `canSealSecrets` before sealing anything that
  // must be read again and stay secret.
  const deriveKey = (purpose) => {
    if (typeof purpose !== 'string' || purpose === '') {
      throw new TypeError('deriveKey: the purpose must be a non-empty string');
    }
    return Buffer.from(hkdfSync('sha256', signingSecret, KEY_DERIVATION_SALT, purpose, DERIVED_KEY_LENGTH));
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
    signMergeProvenance,
    verifyMergeProvenance,
    deriveKey,
    // True only when the signing secret was configured, never for the random
    // per-process fallback: what a key derived from it seals survives a
    // restart and opens on every pod.
    hasStableSecret,
    // True when a key derived from the secret may seal something meant to stay
    // secret at rest: a stable secret that is not one the templates publish.
    // Checked before sealing a team's Jira token (`503 jira_secret_unavailable`).
    canSealSecrets: hasStableSecret && !isTemplateSecret,
    sessionTokenExpiryMs: SESSION_TOKEN_EXPIRY_MS
  };
};

export { createTokenService };
