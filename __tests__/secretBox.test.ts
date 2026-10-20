import { randomBytes } from 'crypto';
import { describe, expect, it } from 'vitest';
import { openTeamSecret, sealTeamSecret } from '../server/services/secretBox.js';

/**
 * Each team's Jira token is sealed with AES-256-GCM before it reaches the
 * store (`team-secret:{teamId}`). Three properties are what the envelope is
 * for, and each has its own test below:
 *
 *  - a dump of the database alone does not hand over the token (the key is
 *    derived from SESSION_TOKEN_SECRET and never stored);
 *  - a changed byte anywhere — ciphertext, tag, IV — opens to nothing, never to
 *    a different token;
 *  - the token opens only for the team and the Jira address it was checked
 *    against: the additional authenticated data binds both, so a row copied
 *    under another team's key, or a token kept after the super admin changed
 *    the address, fails to open instead of being sent somewhere new.
 *
 * `openTeamSecret` answers `null` for every failure, on purpose: the route
 * reports "enter the token again", and a throw there would become a 500.
 */

type Envelope = { v: number; iv: string; tag: string; ct: string };

const key = randomBytes(32);
const teamId = 'team-a1b2c3';
const baseUrl = 'https://jira.example.org/jira';
const plaintext = JSON.stringify({ token: 'pat-0123456789abcdef', email: 'bot@example.org' });

const seal = (overrides: Record<string, unknown> = {}) =>
  sealTeamSecret({ key, teamId, baseUrl, plaintext, ...overrides }) as Envelope;

const open = (envelope: unknown, overrides: Record<string, unknown> = {}) =>
  openTeamSecret({ key, teamId, baseUrl, envelope, ...overrides });

// Flips one bit of a base64url field, so the field keeps its length and
// encoding and only its content changes.
const flipBit = (value: string) => {
  const bytes = Buffer.from(value, 'base64url');
  bytes[bytes.length - 1] ^= 0x01;
  return bytes.toString('base64url');
};

describe('secretBox — sealing a team secret', () => {
  it('round-trips the plaintext', () => {
    expect(open(seal())).toBe(plaintext);
  });

  it('writes a versioned envelope of base64url fields: a 12-byte IV, a 16-byte tag, and no plaintext', () => {
    const envelope = seal();

    expect(Object.keys(envelope).sort()).toEqual(['ct', 'iv', 'tag', 'v']);
    expect(envelope.v).toBe(1);
    for (const field of [envelope.iv, envelope.tag, envelope.ct]) {
      expect(field).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    expect(Buffer.from(envelope.iv, 'base64url')).toHaveLength(12);
    expect(Buffer.from(envelope.tag, 'base64url')).toHaveLength(16);
    expect(JSON.stringify(envelope)).not.toContain('pat-0123456789abcdef');
    expect(JSON.stringify(envelope)).not.toContain('bot@example.org');
  });

  it('draws a fresh IV for every seal, so the same token never seals the same way twice', () => {
    const first = seal();
    const second = seal();

    expect(first.iv).not.toBe(second.iv);
    expect(first.ct).not.toBe(second.ct);
  });

  // The binding compares canonical addresses: a harmless re-save of the
  // console form with another spelling must not make every team re-enter its
  // token.
  it('binds the canonical address, so another spelling of the same Jira still opens', () => {
    const envelope = seal({ baseUrl: 'HTTPS://Jira.Example.org:443/jira/' });

    expect(open(envelope)).toBe(plaintext);
    // Both directions: sealed under the canonical form, opened under another
    // spelling — the open side canonicalises too.
    expect(open(seal(), { baseUrl: 'HTTPS://Jira.Example.org:443/jira/' })).toBe(plaintext);
  });

  it('refuses to seal under an address that is not a Jira base URL, or with a bad key or plaintext', () => {
    expect(() => seal({ baseUrl: 'ftp://jira.example.org' })).toThrow(TypeError);
    expect(() => seal({ baseUrl: 'https://user:pw@jira.example.org' })).toThrow(TypeError);
    expect(() => seal({ key: randomBytes(16) })).toThrow(TypeError);
    expect(() => seal({ key: 'not-a-buffer' })).toThrow(TypeError);
    expect(() => seal({ teamId: '' })).toThrow(TypeError);
    expect(() => seal({ plaintext: { token: 'x' } })).toThrow(TypeError);
  });
});

describe('secretBox — opening refuses anything but the envelope it sealed', () => {
  it('opens to nothing when the ciphertext, the tag or the IV changed', () => {
    const envelope = seal();

    expect(open({ ...envelope, ct: flipBit(envelope.ct) })).toBeNull();
    expect(open({ ...envelope, tag: flipBit(envelope.tag) })).toBeNull();
    expect(open({ ...envelope, iv: flipBit(envelope.iv) })).toBeNull();
  });

  // A row copied under another team's key would otherwise hand that team the
  // first team's Jira access.
  it('opens to nothing for another team', () => {
    expect(open(seal(), { teamId: 'team-other' })).toBeNull();
  });

  // The super admin changed the address: the token was checked against the
  // old Jira and must never travel to the new one.
  it('opens to nothing for another Jira address', () => {
    expect(open(seal(), { baseUrl: 'https://jira.example.org' })).toBeNull();
    expect(open(seal(), { baseUrl: 'https://other-jira.example.org/jira' })).toBeNull();
    expect(open(seal(), { baseUrl: 'not a url' })).toBeNull();
  });

  it('opens to nothing under another key (SESSION_TOKEN_SECRET rotated or unset)', () => {
    expect(open(seal(), { key: randomBytes(32) })).toBeNull();
    expect(open(seal(), { key: randomBytes(16) })).toBeNull();
    expect(open(seal(), { key: undefined })).toBeNull();
  });

  // GCM accepts a truncated tag unless told otherwise, and a 4-byte tag is
  // forgeable by brute force. The length is pinned on the decipher and checked
  // before it, so a short tag is refused rather than verified.
  it('refuses a tag shorter than 16 bytes, even one that is a prefix of the real tag', () => {
    const envelope = seal();
    const realTag = Buffer.from(envelope.tag, 'base64url');

    expect(open({ ...envelope, tag: realTag.subarray(0, 4).toString('base64url') })).toBeNull();
    expect(open({ ...envelope, tag: realTag.subarray(0, 12).toString('base64url') })).toBeNull();
    expect(open({ ...envelope, tag: Buffer.concat([realTag, Buffer.from([0])]).toString('base64url') })).toBeNull();
  });

  it('refuses an envelope of another version or of the wrong shape, without throwing', () => {
    const envelope = seal();

    expect(open({ ...envelope, v: 2 })).toBeNull();
    expect(open({ ...envelope, v: '1' })).toBeNull();
    expect(open({ ...envelope, iv: Buffer.alloc(16).toString('base64url') })).toBeNull();
    expect(open({ ...envelope, ct: 'not base64url!' })).toBeNull();
    expect(open({ ...envelope, ct: 42 })).toBeNull();
    expect(open({ iv: envelope.iv, tag: envelope.tag, v: 1 })).toBeNull();
    expect(open(null)).toBeNull();
    expect(open('a string')).toBeNull();
    expect(open([envelope])).toBeNull();
  });
});
