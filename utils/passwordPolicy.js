/**
 * The team password policy — audit H39.
 *
 * ## Why this module exists
 *
 * The minimum used to be the literal `4`, written out at four server write
 * paths (`/api/team/create`, `/api/team/:teamId/password`,
 * `/api/password-reset/confirm`, `/api/super-admin/update-password`) and five
 * client sites, with nothing tying them together. That is how a policy drifts:
 * raising it meant finding nine places and getting all nine right, and there
 * was no single thing a reviewer could read to learn what the rule *is*.
 *
 * It lives in `utils/` rather than in `server/services/` because it has two
 * consumers with different toolchains — the Express routes (ESM JavaScript) and
 * the React forms (TypeScript, bundled by Vite). `utils/inviteLink.js` is the
 * existing precedent for a plain-JS module imported from both sides, and
 * `vitest.config.ts` already includes `utils/**\/*.{ts,js}` in the coverage
 * gate, so this file is measured rather than sitting outside it.
 *
 * ## What the rule is, and what it deliberately is not
 *
 * Twelve characters, and nothing else. That is OWASP ASVS 2.1.1's floor; NIST
 * SP 800-63B asks for eight plus a breached-password check. H39's acceptance
 * asks for a length minimum and explicitly not for a complexity rule, so there
 * is no character-class requirement here — those push users towards
 * `Password1!` and are no longer recommended by either baseline.
 *
 * ## The rule binds on write, never on verify
 *
 * Nothing in this module may ever be called from an authentication path. A team
 * password is a *shared* secret that predates this rule for every team already
 * using the product, and refusing to verify a short one would lock those teams
 * out of their entire history — turning a hardening change into an outage for
 * the whole existing user base. That is the H20 lesson, which this codebase has
 * now paid for twice: **an availability cost is a security property too.**
 * Teams below the minimum keep working and become compliant the next time they
 * change their password (decision D18, option (a)).
 *
 * For the same reason `server/services/passwordMigration.js` must never consult
 * this module: it re-hashes the plaintext a legacy record already contains, and
 * that plaintext is exactly the short kind. A minimum applied there would leave
 * those records unconvertible and, after H23 removed the plaintext-compare
 * fallback, unable to authenticate at all.
 */

/**
 * The minimum number of characters in a team password.
 *
 * Raising this is safe; every write path reads it from here and the boundary
 * tests are written as `PASSWORD_MIN_LENGTH ± 1`. Lowering it is a policy
 * change and `__tests__/passwordPolicy.test.ts` pins the value on purpose.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * The single sentence every form shows *before* the user types and every
 * failure re-states afterwards.
 *
 * H39's acceptance is explicit that the rule has to be visible up front rather
 * than discovered on submit, so this carries the number instead of saying
 * "too short".
 */
export const PASSWORD_POLICY_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;

/**
 * The wire error code the write paths answer a refusal with.
 *
 * Unchanged from before H39 — the code is part of the routes' contract and
 * `services/dataService.ts` maps it to `PASSWORD_POLICY_MESSAGE` so the user
 * reads a sentence rather than a raw identifier.
 */
export const PASSWORD_TOO_SHORT_ERROR = 'password_too_short';

/**
 * True when `password` is a string long enough to be accepted on a write path.
 *
 * Non-strings are refused rather than coerced: the routes call this *before*
 * `hashPassword`, and a `null` or a number would otherwise throw inside scrypt
 * and answer 500 where the honest answer is 400. The value is not trimmed — a
 * password is an opaque secret, and the value stored must be the value typed.
 *
 * `length` counts UTF-16 code units, not grapheme clusters, so a password of
 * six emoji measures 12 and passes. That is deliberate rather than overlooked:
 * the alternative (`[...password].length`) would be stricter on exactly the
 * inputs that already carry the most entropy per character, and the browsers'
 * own `minLength` attribute — which the forms set from this same constant —
 * counts code units too. Keeping the two in agreement matters more than the
 * edge case, or the client would accept a value the server then refuses.
 *
 * @param {unknown} password
 * @returns {boolean}
 */
export const isPasswordLongEnough = (password) =>
  typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH;
