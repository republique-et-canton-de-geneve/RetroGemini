import { describe, expect, it } from 'vitest';
import { createTokenService } from '../server/services/sessionTokens.js';

const secureCompare = (a: string, b: string) => a === b;
const tokenSecret = 'stable-test-token-secret-with-enough-entropy';

const tamperPayload = (token: string, transform: (payload: any) => any) => {
  const [version, payloadPart, signature] = token.split('.');
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  const tamperedPayload = Buffer.from(JSON.stringify(transform(payload))).toString('base64url');
  return `${version}.${tamperedPayload}.${signature}`;
};

describe('session token service', () => {
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
});
