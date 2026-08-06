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

  /**
   * Decision D1, final step (H23). The dual-verify fallback — a stored value
   * that is not a scrypt record compared byte-for-byte against the submitted
   * password — is **gone**. `verifyPassword` no longer has a branch where a
   * stored string is compared directly to a password.
   *
   * It was kept deliberately after the eager startup migration shipped, because
   * removing both at once meant that a migration silently failing (a store
   * outage at boot) would turn a cosmetic problem into a team that cannot log
   * in at all. The prerequisite was evidence that no legacy record is left:
   * production reported `0 record(s) hashed, 0 failed, 33 team(s) scanned` on
   * 2026-08-05 — a statement about the shared store, not about one pod.
   *
   * The safety net that stays: `restorePasswordMigration.test.ts` pins that a
   * restore of a pre-hashing archive re-hashes those records, so a rollback
   * cannot put back credentials that would now be unable to authenticate.
   */
  describe('a non-hashed stored value never authenticates', () => {
    it('refuses a plaintext record even when the password matches it exactly', async () => {
      expect(await verifyPassword('legacy-secret', 'legacy-secret')).toBe(false);
    });

    it('refuses a non-matching plaintext record', async () => {
      expect(await verifyPassword('legacy-secret', 'other-secret')).toBe(false);
    });

    it('refuses anything that merely looks like a hash', async () => {
      // The grammar is what decides, so a near-miss record is not a hash and
      // must not be rescued by a comparison either.
      expect(await verifyPassword('scrypt$16384$8$1$abc$def', 'scrypt$16384$8$1$abc$def')).toBe(false);
      expect(await verifyPassword('with$dollar$signs', 'with$dollar$signs')).toBe(false);
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
