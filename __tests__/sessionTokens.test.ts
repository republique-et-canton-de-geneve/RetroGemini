import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTokenService } from '../server/services/sessionTokens.js';

const secureCompare = (a: string, b: string) => a === b;
const tokenSecret = 'stable-test-token-secret-with-enough-entropy';
const originalSessionTokenSecret = process.env.SESSION_TOKEN_SECRET;
type TokenPayload = Record<string, unknown>;

const tamperPayload = (token: string, transform: (payload: TokenPayload) => TokenPayload) => {
  const [version, payloadPart, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as TokenPayload;
  const tamperedPayload = Buffer.from(JSON.stringify(transform(payload))).toString('base64url');
  return `${version}.${tamperedPayload}.${signature}`;
};

describe('session token service', () => {
  beforeEach(() => {
    delete process.env.SESSION_TOKEN_SECRET;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSessionTokenSecret === undefined) {
      delete process.env.SESSION_TOKEN_SECRET;
    } else {
      process.env.SESSION_TOKEN_SECRET = originalSessionTokenSecret;
    }
    vi.restoreAllMocks();
  });

  it('validates team session tokens across service instances with the same signing secret', () => {
    const issuer = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });
    const verifier = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });

    const token = issuer.createSessionToken('team-1', 'visitor-1');

    expect(verifier.validateSessionToken(token)).toMatchObject({
      teamId: 'team-1',
      visitorId: 'visitor-1'
    });
  });

  it('rejects team session tokens signed with a different secret', () => {
    const issuer = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });
    const verifier = createTokenService({
      secureCompare,
      superAdminPassword: 'admin',
      tokenSecret: 'different-stable-test-token-secret'
    });

    const token = issuer.createSessionToken('team-1', null);

    expect(verifier.validateSessionToken(token)).toBeNull();
  });

  it('rejects tampered team session token payloads', () => {
    const service = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });
    const token = service.createSessionToken('team-1', null);

    const tampered = tamperPayload(token, (payload) => ({ ...payload, teamId: 'team-2' }));

    expect(service.validateSessionToken(tampered)).toBeNull();
  });

  it('rejects expired team session tokens', () => {
    let now = 1000;
    const service = createTokenService({
      secureCompare,
      superAdminPassword: 'admin',
      tokenSecret,
      now: () => now
    });

    const token = service.createSessionToken('team-1', null);
    now += service.sessionTokenExpiryMs + 1;

    expect(service.validateSessionToken(token)).toBeNull();
  });

  it('uses SESSION_TOKEN_SECRET from the environment when no explicit signing secret is passed', () => {
    process.env.SESSION_TOKEN_SECRET = tokenSecret;
    const issuer = createTokenService({ secureCompare, superAdminPassword: 'admin' });
    const verifier = createTokenService({ secureCompare, superAdminPassword: 'admin' });

    const token = issuer.createSessionToken('team-1', 'visitor-1');

    expect(verifier.validateSessionToken(token)).toMatchObject({
      teamId: 'team-1',
      visitorId: 'visitor-1'
    });
  });

  it('does not use the super-admin password as a session signing secret', () => {
    const issuer = createTokenService({ secureCompare, superAdminPassword: 'admin' });
    const verifier = createTokenService({ secureCompare, superAdminPassword: 'admin' });

    const token = issuer.createSessionToken('team-1', null);

    expect(verifier.validateSessionToken(token)).toBeNull();
  });

  it('validates super-admin tokens across service instances with the same signing secret', () => {
    const issuer = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });
    const verifier = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });

    const token = issuer.createSuperAdminToken();

    expect(verifier.validateSuperAdminToken(token)).toBe(true);
    expect(verifier.validateSuperAdminAuth({ sessionToken: token })).toBe(true);
  });

  it('accepts the configured super-admin password without requiring a token', () => {
    const service = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });

    expect(service.validateSuperAdminAuth({ password: 'admin' })).toBe(true);
    expect(service.validateSuperAdminAuth({ password: 'wrong' })).toBe(false);
  });

  describe('invite credentials (stage 7e)', () => {
    it('validates invite credentials across service instances with the same signing secret', () => {
      const issuer = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });
      const verifier = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });

      const credential = issuer.createInviteCredential('team-1', 3);

      expect(verifier.validateInviteCredential(credential)).toEqual({ teamId: 'team-1', epoch: 3 });
    });

    it('is deterministic so the credential can be re-derived on demand', () => {
      const service = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });

      expect(service.createInviteCredential('team-1', 0)).toBe(service.createInviteCredential('team-1', 0));
      expect(service.createInviteCredential('team-1', 0)).not.toBe(service.createInviteCredential('team-1', 1));
      expect(service.createInviteCredential('team-1', 0)).not.toBe(service.createInviteCredential('team-2', 0));
    });

    it('does not time-expire (revocation is by epoch, matching invite-link semantics)', () => {
      let clock = Date.now();
      const service = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret, now: () => clock });

      const credential = service.createInviteCredential('team-1', 0);
      clock += 400 * 24 * 60 * 60 * 1000;

      expect(service.validateInviteCredential(credential)).toEqual({ teamId: 'team-1', epoch: 0 });
    });

    it('rejects credentials signed with a different secret and tampered payloads', () => {
      const issuer = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });
      const rogue = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret: 'other-secret' });

      expect(issuer.validateInviteCredential(rogue.createInviteCredential('team-1', 0))).toBeNull();

      const tampered = tamperPayload(issuer.createInviteCredential('team-1', 0), (payload) => ({
        ...payload,
        epoch: 99
      }));
      expect(issuer.validateInviteCredential(tampered)).toBeNull();
    });

    it('keeps token families sealed: session tokens and invite credentials never cross-validate', () => {
      const service = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });

      expect(service.validateInviteCredential(service.createSessionToken('team-1', null))).toBeNull();
      expect(service.validateInviteCredential(service.createSuperAdminToken())).toBeNull();
      expect(service.validateSessionToken(service.createInviteCredential('team-1', 0))).toBeNull();
      expect(service.validateSuperAdminToken(service.createInviteCredential('team-1', 0))).toBe(false);
    });

    it('rejects malformed credentials', () => {
      const service = createTokenService({ secureCompare, superAdminPassword: 'admin', tokenSecret });

      expect(service.validateInviteCredential(null)).toBeNull();
      expect(service.validateInviteCredential('')).toBeNull();
      expect(service.validateInviteCredential('not-a-credential')).toBeNull();
      expect(service.validateInviteCredential('rg1.only-two-parts')).toBeNull();
    });
  });
});
