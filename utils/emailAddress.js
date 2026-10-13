/**
 * What an email address is, written once for the server and the screens.
 *
 * ## Why this module exists
 *
 * A facilitator stored `elisabeth.trolliet@etat.ge.ch;` as her team's recovery
 * address — the trailing semicolon is what Outlook leaves behind when an
 * address is copied out of a recipient field. Nothing refused it: the Dashboard
 * field and the super-admin field sit outside any `<form>`, so the browser never
 * validated them, and every server write path stored whatever it received. The
 * password-reset route then compared `trim().toLowerCase()` of the stored value
 * with the typed one, the two never matched, and the route answered its
 * deliberately silent 204. She waited for a mail that could never come, and
 * created a second team.
 *
 * Each write path had its own idea of a valid address — a permissive regex in
 * two routes, none in the others, trim-and-lowercase on the client — which is
 * how a value one path accepts becomes a value another can never match. So the
 * rule lives here, in `utils/` like `passwordPolicy.js`, because it has the same
 * two consumers: the Express routes (ESM JavaScript) and the React forms
 * (TypeScript, bundled by Vite). `vitest.config.ts` measures `utils/**` on both
 * extensions, so it sits inside the coverage gate.
 *
 * ## Clean, then judge
 *
 * Two steps, kept apart on purpose:
 *
 *  - `cleanEmail` removes what a paste leaves around one address (a display
 *    name and its angle brackets, a `mailto:`, quotes, a trailing `;`, a
 *    no-break space) and lowercases it. It never *chooses*: a value holding two
 *    addresses stays two addresses, and is then refused.
 *  - `isValidEmail` judges the cleaned value strictly, so what gets stored is
 *    one address a mail server will accept.
 *
 * `parseEmailInput` chains them and is what every write path calls. Comparing
 * two addresses — the reset route matching a typed address against a stored one
 * — goes through `sameEmail`, which cleans *both* sides: a value stored before
 * this rule existed still matches the address its owner types today.
 *
 * Lowercasing is a choice, not RFC 5321 (which leaves the local part's case to
 * the receiving server). Every corporate mailbox this product mails is
 * case-insensitive, members were already stored lowercased, and two spellings of
 * one person must compare equal.
 */

/** RFC 5321's limit on a forward path, which is what a mail server enforces. */
export const EMAIL_MAX_LENGTH = 254;

/** The wire code every route answers a refused address with. */
export const INVALID_EMAIL_ERROR = 'invalid_email';

/**
 * The English sentence the data layer throws for a refused address. It stays
 * English like every `dataService` error and is translated where it is shown
 * (`i18n/errorMessages.ts`).
 */
export const INVALID_EMAIL_MESSAGE = 'Enter one valid email address';

const LOCAL_PART_MAX_LENGTH = 64;

// Characters a browser or a mail client pastes along with an address but that
// are not part of it: zero-width joiners and the byte-order mark, which no
// keyboard types and no screen shows.
const INVISIBLE_CHARACTERS = /[\u200b-\u200d\ufeff]/g;
// No-break spaces (French typography puts them everywhere) count as spaces.
const NO_BREAK_SPACES = /[\u00a0\u202f]/g;

// What may wrap an address on either side. Trailing `.` and `:` come from an
// address ending a sentence; `;` and `,` from a recipient list.
const LEADING_DECORATION = new Set(['"', '\'', '(', '[', '<']);
const TRAILING_DECORATION = new Set(['"', '\'', ')', ']', '>', ';', ',', '.', ':']);
const isWhitespace = (character) => character.trim() === '';

// The HTML specification's "valid e-mail address" alphabet for the local part,
// lowercase because the value is judged after cleaning. `+` (sub-addressing)
// and `'` (O'Brien) are real and accepted.
const LOCAL_PART = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
// A top-level domain is letters only, or an internationalised one in its
// ASCII (`xn--`) form. This is what refuses `a@b.c` and `a@corp.123`.
const TOP_LEVEL_DOMAIN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

const MAILTO = 'mailto:';

// Longer than anything a person pastes for one recipient — Outlook's
// `Last First (DEPT) <address>;` included — by an order of magnitude. Cleaning
// is linear per pass but peels one layer of decoration per pass, so an
// unbounded value from an anonymous route (`/api/team/create`, whose limiter
// counts only rejected credentials) could hold the event loop for most of a
// second. Refused before any cleaning.
export const EMAIL_INPUT_MAX_LENGTH = 1024;

// Strips decoration from both ends. A loop rather than a `/[…]+$/` pattern: the
// value is caller-controlled and unbounded here, and an end-anchored repeated
// class backtracks quadratically on a long run of the same character.
const stripDecoration = (text) => {
  let start = 0;
  let end = text.length;
  while (start < end && (LEADING_DECORATION.has(text[start]) || isWhitespace(text[start]))) start += 1;
  while (end > start && (TRAILING_DECORATION.has(text[end - 1]) || isWhitespace(text[end - 1]))) end -= 1;
  return text.slice(start, end);
};

/**
 * Removes what a paste leaves around one address, and lowercases it.
 *
 * Handles, in any combination: surrounding whitespace, no-break and zero-width
 * characters, Outlook's `Last First (DEPT) <address>;`, a `mailto:` link with
 * its `?subject=…` query, and quotes or brackets around the address.
 *
 * It never picks one address out of several, and never validates: the result
 * may still be anything, and `isValidEmail` decides. A non-string reads as `''`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const cleanEmail = (value) => {
  if (typeof value !== 'string' || value.length > EMAIL_INPUT_MAX_LENGTH) return '';

  let text = value.replace(INVISIBLE_CHARACTERS, '').replace(NO_BREAK_SPACES, ' ').trim();

  // `Name <address>` keeps the address — but only when there is exactly one
  // pair, and only when what surrounds it is a name. Two pairs are two
  // recipients, and so is `a@x.ch <b@y.ch>`: choosing the bracketed one would
  // send every password-reset mail to somebody the user never named.
  const open = text.indexOf('<');
  const close = text.indexOf('>');
  if (open !== -1 && close > open && open === text.lastIndexOf('<') && close === text.lastIndexOf('>')) {
    const outside = text.slice(0, open) + text.slice(close + 1);
    if (!outside.includes('@')) text = text.slice(open + 1, close);
  }

  // Decoration and a `mailto:` can nest either way round (`<mailto:…>`,
  // `"mailto:…";`), so they are peeled until nothing changes.
  let previous;
  do {
    previous = text;
    text = stripDecoration(text);
    if (text.slice(0, MAILTO.length).toLowerCase() === MAILTO) {
      text = text.slice(MAILTO.length);
      const query = text.indexOf('?');
      if (query !== -1) text = text.slice(0, query);
    }
  } while (text !== previous);

  return text.toLowerCase();
};

/**
 * True when `value` — already cleaned, so lowercase — is exactly one address a
 * mail server will accept.
 *
 * Deliberately stricter than the HTML specification's `type="email"`, which
 * accepts `a@b`: an address without a top-level domain cannot leave the
 * deployment's network, and storing one only postpones the failure to the day
 * the password is forgotten. ASCII only — an internationalised domain is
 * accepted in its `xn--` form, which is what a mail server needs anyway.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isValidEmail = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > EMAIL_MAX_LENGTH) return false;

  const at = value.indexOf('@');
  if (at === -1 || at !== value.lastIndexOf('@')) return false;

  const local = value.slice(0, at);
  if (local.length === 0 || local.length > LOCAL_PART_MAX_LENGTH || !LOCAL_PART.test(local)) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;

  const labels = value.slice(at + 1).split('.');
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  return TOP_LEVEL_DOMAIN.test(labels[labels.length - 1]);
};

/**
 * @typedef {{ ok: true, email: string | undefined } | { ok: false }} ParsedEmail
 */

/**
 * What every write path calls: the address to store, a clear, or a refusal.
 *
 *  - `undefined`, `null` or a blank string is a **clear** (`email: undefined`):
 *    the recovery address is optional, and emptying the field is how a user
 *    removes it.
 *  - Any other non-string is refused — a route must never store an object it
 *    would later call `.trim()` on.
 *  - A string that cleans to nothing (`";"`) is refused rather than read as a
 *    clear: the user typed something, and silently removing their address in
 *    answer would be the opposite of what they asked.
 *
 * @param {unknown} value
 * @returns {ParsedEmail}
 */
export const parseEmailInput = (value) => {
  if (value === undefined || value === null) return { ok: true, email: undefined };
  if (typeof value !== 'string' || value.length > EMAIL_INPUT_MAX_LENGTH) return { ok: false };
  if (value.replace(INVISIBLE_CHARACTERS, '').trim() === '') return { ok: true, email: undefined };

  const email = cleanEmail(value);
  if (!email || !isValidEmail(email)) return { ok: false };
  return { ok: true, email };
};

/**
 * True when `a` and `b` are the same one address once both are cleaned.
 *
 * Two missing addresses are not "the same": this answers whether a typed
 * address matches a stored one, and nothing matches an address nobody stored.
 * A stored value holding two addresses never matches either — the reset mail
 * would otherwise go to whichever one the caller named.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export const sameEmail = (a, b) => {
  const first = parseEmailInput(a);
  const second = parseEmailInput(b);
  return first.ok && second.ok && !!first.email && first.email === second.email;
};
