import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTokenService } from '../server/services/sessionTokens.js';

/**
 * Decision D3b adds a `sessionEpoch` claim to team session tokens, and the
 * rolling update that ships it runs 41.0 pods beside this release's: a token
 * minted here reaches an old pod, and a token an old pod minted reaches this
 * one. Both must keep working, or the deploy (and any rollback) is a mass
 * logout.
 *
 * Below is a frozen copy of 41.0's minter and validator (copied from a868f45,
 * `server/services/sessionTokens.js`), never to be edited to match a change:
 * it is the old pod. This test fails if anyone bumps the `rg1` prefix or the
 * `v` claim, or moves an existing claim.
 */

const SECRET = 'compatibility-test-signing-secret';

const frozen41 = (signingSecret: string, now = () => Date.now()) => {
  const TOKEN_VERSION = 'rg1';
  const TEAM_TOKEN_TYPE = 'team-session';
  const SESSION_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
  const encodePayload = (payload: unknown) => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const decodePayload = (encoded: string) => JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const signPayload = (encodedPayload: string, secret: string) =>
    createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  const secureTokenCompare = (a: string, b: string) => {
    const left = Buffer.from(a || '', 'utf8');
    const right = Buffer.from(b || '', 'utf8');
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  };
  const createSignedToken = (type: string, claims: Record<string, unknown>) => {
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
  const validateSignedToken = (token: unknown, expectedType: string) => {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
    const [, encodedPayload, signature] = parts;
    const expectedSignature = signPayload(encodedPayload, signingSecret);
    if (!secureTokenCompare(signature, expectedSignature)) return null;
    let payload;
    try {
      payload = decodePayload(encodedPayload);
    } catch {
      return null;
    }
    if (!payload || payload.type !== expectedType) return null;
    if (typeof payload.iat !== 'number' || typeof payload.exp !== 'number' || now() > payload.exp) return null;
    return payload;
  };
  return {
    createSessionToken: (teamId: string, visitorId: string | null) =>
      createSignedToken(TEAM_TOKEN_TYPE, { teamId, visitorId: visitorId ?? null }),
    validateSessionToken: (token: unknown) => {
      const payload = validateSignedToken(token, TEAM_TOKEN_TYPE);
      if (!payload || typeof payload.teamId !== 'string' || !payload.teamId) return null;
      return {
        teamId: payload.teamId,
        visitorId: typeof payload.visitorId === 'string' ? payload.visitorId : null,
        createdAt: payload.iat
      };
    }
  };
};

describe('session tokens across the 41.0 rolling update', () => {
  afterEach(() => vi.restoreAllMocks());

  it("a token minted by this release is accepted by a 41.0 pod, with the same team and issue time", () => {
    const current = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: null, tokenSecret: SECRET });
    const old = frozen41(SECRET);
    const token = current.createSessionToken('team-1', null, { sessionEpoch: 'kq3V0b7tZ2mN8xQe1Lw4pA' });

    const mine = current.validateSessionToken(token);
    expect(old.validateSessionToken(token)).toEqual({ teamId: 'team-1', visitorId: null, createdAt: mine?.createdAt });
  });

  it('a token minted by a 41.0 pod is accepted here as a legacy token', () => {
    const current = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: null, tokenSecret: SECRET });
    const old = frozen41(SECRET);
    const token = old.createSessionToken('team-1', null);

    expect(current.validateSessionToken(token)).toMatchObject({
      teamId: 'team-1',
      visitorId: null,
      createdAt: old.validateSessionToken(token)?.createdAt,
      sessionEpoch: null
    });
  });
});
