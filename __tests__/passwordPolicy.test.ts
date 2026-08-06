import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  isPasswordLongEnough
} from '../utils/passwordPolicy.js';

/**
 * Audit H39 — the team password minimum.
 *
 * The rule used to be the literal `length < 4`, repeated at four server write
 * paths and five client sites, with no single place to read it from. This
 * module is that single place; the tests below pin the rule itself, and
 * `passwordMinimumLength.test.ts` pins that every write path actually calls it.
 *
 * Why the rule lives in `utils/` rather than in `server/services/`: it has two
 * consumers with different toolchains — the Express routes (ESM JavaScript) and
 * the React forms (TypeScript, bundled by Vite) — and a mirrored literal is
 * exactly what H39 found. `utils/inviteLink.js` is the existing precedent for a
 * plain-JS module imported from both sides.
 */
describe('password policy (H39)', () => {
  it('sets the minimum at 12 characters', () => {
    // Pinned as a value, not as "whatever the module says": the number is the
    // finding. OWASP ASVS 2.1.1 asks for 12; lowering it silently is the
    // regression this case exists to catch.
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it('rejects a password one character below the minimum', () => {
    expect(isPasswordLongEnough('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe(false);
  });

  it('accepts a password exactly at the minimum', () => {
    expect(isPasswordLongEnough('a'.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
  });

  it('accepts a password above the minimum', () => {
    expect(isPasswordLongEnough('a'.repeat(PASSWORD_MIN_LENGTH + 40))).toBe(true);
  });

  it('rejects the empty string and every non-string value', () => {
    // The routes call this *before* hashing, and `hashPassword(undefined)`
    // would throw deep in scrypt rather than answering 400. Each of these
    // reaches a real route: a missing field, a JSON `null`, and the
    // `{ newPassword: 12345678901234 }` an API client sends by accident.
    expect(isPasswordLongEnough('')).toBe(false);
    expect(isPasswordLongEnough(undefined)).toBe(false);
    expect(isPasswordLongEnough(null)).toBe(false);
    expect(isPasswordLongEnough(12345678901234)).toBe(false);
    expect(isPasswordLongEnough({ length: 99 })).toBe(false);
    expect(isPasswordLongEnough('a'.repeat(PASSWORD_MIN_LENGTH).split(''))).toBe(false);
  });

  it('counts characters without trimming, so a padded password is honoured as typed', () => {
    // Deliberate: a password is an opaque secret, and trimming it would mean
    // the value verified is not the value typed. H39 asks for a length floor
    // and explicitly not for a complexity rule, so 12 spaces passes — the
    // point is that the *stored* secret is what the user entered.
    expect(isPasswordLongEnough(' '.repeat(PASSWORD_MIN_LENGTH))).toBe(true);
    expect(isPasswordLongEnough(`  ${'a'.repeat(PASSWORD_MIN_LENGTH - 2)}  `)).toBe(true);
  });

  it('states the rule in a message the forms can render before the user types', () => {
    // H39's acceptance: the message must say the rule *before* the submit, so
    // the same sentence is the form hint and the failure text. It therefore has
    // to carry the number rather than say "too short".
    expect(PASSWORD_POLICY_MESSAGE).toContain(String(PASSWORD_MIN_LENGTH));
    expect(PASSWORD_POLICY_MESSAGE).toMatch(/at least/i);
  });
});
