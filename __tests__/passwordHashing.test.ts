import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, isHashedPassword } from '../server/services/passwordHashing.js';

/**
 * Hardening stage 7c (audit PR-7): team passwords are hashed at rest with
 * Node's built-in scrypt. Verification must dual-verify: hashed records go
 * through scrypt, legacy plaintext records fall back to a constant-time
 * string comparison so pre-hashing teams keep logging in.
 */

describe('passwordHashing', () => {
  describe('hashPassword / verifyPassword round trip', () => {
    it('verifies the original password against its hash', async () => {
      const hash = await hashPassword('correct horse battery staple');
      expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    });

    it('rejects a wrong password against a hash', async () => {
      const hash = await hashPassword('right-password');
      expect(await verifyPassword('wrong-password', hash)).toBe(false);
    });

    it('produces a different hash for the same password (unique salt)', async () => {
      const first = await hashPassword('same-password');
      const second = await hashPassword('same-password');
      expect(first).not.toBe(second);
      expect(await verifyPassword('same-password', first)).toBe(true);
      expect(await verifyPassword('same-password', second)).toBe(true);
    });

    it('handles unicode passwords', async () => {
      const hash = await hashPassword('pässwörd-héhé-日本語');
      expect(await verifyPassword('pässwörd-héhé-日本語', hash)).toBe(true);
      expect(await verifyPassword('pässwörd-héhé-日本语', hash)).toBe(false);
    });

    it('verifies repeatedly (cache path returns the same result)', async () => {
      const hash = await hashPassword('cached-password');
      expect(await verifyPassword('cached-password', hash)).toBe(true);
      // Second call hits the positive-verify cache; must still be correct.
      expect(await verifyPassword('cached-password', hash)).toBe(true);
      // A wrong password must never be rescued by the cache.
      expect(await verifyPassword('cached-Password', hash)).toBe(false);
    });
  });

  describe('legacy plaintext records (dual-verify)', () => {
    it('verifies a matching plaintext record', async () => {
      expect(await verifyPassword('legacy-secret', 'legacy-secret')).toBe(true);
    });

    it('rejects a non-matching plaintext record', async () => {
      expect(await verifyPassword('legacy-secret', 'other-secret')).toBe(false);
    });

    it('rejects empty or missing credentials', async () => {
      expect(await verifyPassword('', 'anything')).toBe(false);
      expect(await verifyPassword('anything', '')).toBe(false);
      expect(await verifyPassword(undefined as unknown as string, 'anything')).toBe(false);
      expect(await verifyPassword('anything', undefined as unknown as string)).toBe(false);
    });
  });

  describe('isHashedPassword', () => {
    it('detects hashed records', async () => {
      expect(isHashedPassword(await hashPassword('x'))).toBe(true);
    });

    it('does not detect plaintext as hashed', () => {
      expect(isHashedPassword('plain-password')).toBe(false);
      expect(isHashedPassword('with$dollar$signs')).toBe(false);
      expect(isHashedPassword('')).toBe(false);
      expect(isHashedPassword(undefined as unknown as string)).toBe(false);
    });

    it('rejects records with out-of-range parameters (crafted restores must not become CPU bombs)', () => {
      const salt = 'AAAAAAAAAAAAAAAAAAAAAA';
      const hash = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      expect(isHashedPassword(`scrypt$1048576$8$1$${salt}$${hash}`)).toBe(false); // N too large
      expect(isHashedPassword(`scrypt$16384$16$1$${salt}$${hash}`)).toBe(false); // r above the derive budget
      expect(isHashedPassword(`scrypt$16384$8$4$${salt}$${hash}`)).toBe(false); // p above the derive budget
      expect(isHashedPassword(`scrypt$16383$8$1$${salt}$${hash}`)).toBe(false); // N not a power of two
      expect(isHashedPassword(`scrypt$16384$8$1$$${hash}`)).toBe(false); // empty salt
      expect(isHashedPassword(`scrypt$16384$8$1$${salt}$`)).toBe(false); // empty hash
    });
  });

  describe('tampered hashes', () => {
    it('fails verification when the hash part is modified', async () => {
      const hash = await hashPassword('secret');
      const parts = hash.split('$');
      const flipped = parts[5][0] === 'A' ? 'B' : 'A';
      parts[5] = flipped + parts[5].slice(1);
      expect(await verifyPassword('secret', parts.join('$'))).toBe(false);
    });

    it('fails verification when the salt is modified', async () => {
      const hash = await hashPassword('secret');
      const parts = hash.split('$');
      const flipped = parts[4][0] === 'A' ? 'B' : 'A';
      parts[4] = flipped + parts[4].slice(1);
      expect(await verifyPassword('secret', parts.join('$'))).toBe(false);
    });
  });
});
