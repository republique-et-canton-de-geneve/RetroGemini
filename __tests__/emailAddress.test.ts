import { describe, expect, it } from 'vitest';
import {
  EMAIL_MAX_LENGTH,
  INVALID_EMAIL_ERROR,
  INVALID_EMAIL_MESSAGE,
  cleanEmail,
  isValidEmail,
  parseEmailInput,
  sameEmail
} from '../utils/emailAddress.js';

/**
 * The shared email rule (`utils/emailAddress.js`).
 *
 * A recovery address was stored as `elisabeth.trolliet@etat.ge.ch;` — an
 * Outlook paste — and the password-reset route, comparing it with the address
 * its owner typed, never found a match and stayed silent by design. Every write
 * path had its own idea of an address, so these cases pin the one rule they now
 * share: what a paste leaves around an address is removed, anything that is
 * still not exactly one deliverable address is refused, and nothing ever picks
 * one address out of several.
 */

const INCIDENT_VALUE = 'elisabeth.trolliet@etat.ge.ch;';
const INCIDENT_ADDRESS = 'elisabeth.trolliet@etat.ge.ch';

describe('cleanEmail', () => {
  it.each([
    ['the incident value (an Outlook trailing semicolon)', INCIDENT_VALUE, INCIDENT_ADDRESS],
    ['an Outlook display name with a department', 'Trolliet Elisabeth (DIN) <elisabeth.trolliet@etat.ge.ch>;', INCIDENT_ADDRESS],
    ['a quoted display name', '"Trolliet, Elisabeth" <Elisabeth.Trolliet@etat.ge.ch>', INCIDENT_ADDRESS],
    ['a mailto link with a query', 'mailto:Lead@Example.ch?subject=Hello', 'lead@example.ch'],
    ['a mailto link inside angle brackets', '<MAILTO:lead@example.ch>', 'lead@example.ch'],
    ['surrounding whitespace and a no-break space', '\u00a0 lead@example.ch \u202f', 'lead@example.ch'],
    ['zero-width characters and a byte-order mark', '\ufefflead@exa\u200bmple.ch\u200d', 'lead@example.ch'],
    ['quotes and brackets', '("lead@example.ch")', 'lead@example.ch'],
    ['an address ending a sentence', 'lead@example.ch.', 'lead@example.ch'],
    ['a trailing comma and colon', 'lead@example.ch,:', 'lead@example.ch'],
    ['uppercase', 'LEAD@EXAMPLE.CH', 'lead@example.ch']
  ])('cleans %s', (_label, raw, expected) => {
    expect(cleanEmail(raw)).toBe(expected);
  });

  it('never chooses between two addresses', () => {
    // Two recipients stay two recipients — the result is then refused by the
    // validator rather than silently narrowed to the first one.
    expect(cleanEmail('a@x.ch; b@y.ch')).toBe('a@x.ch; b@y.ch');
    expect(cleanEmail('A <a@x.ch>, B <b@y.ch>')).toBe('a <a@x.ch>, b <b@y.ch');
  });

  it.each([undefined, null, 42, {}, ['a@x.ch']])('reads the non-string %j as empty', (value) => {
    expect(cleanEmail(value)).toBe('');
  });

  it('stays linear on a long run of decoration', () => {
    // The value is caller-controlled and unbounded when it reaches the cleaner;
    // an end-anchored repeated character class would backtrack quadratically.
    const started = Date.now();
    expect(cleanEmail(`${' '.repeat(200_000)}x${';'.repeat(200_000)}`)).toBe('x');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('isValidEmail', () => {
  it.each([
    INCIDENT_ADDRESS,
    'first.last+retro@example.co.uk',
    "o'brien@example.ie",
    'a@b.ch',
    'user@xn--bcher-kva.ch',
    'user@example.xn--p1ai',
    'user@sub-domain.example.museum',
    `${'a'.repeat(64)}@example.ch`
  ])('accepts %s', (value) => {
    expect(isValidEmail(value)).toBe(true);
  });

  it.each([
    ['no top-level domain', 'a@b'],
    ['a one-letter top-level domain', 'a@b.c'],
    ['a numeric top-level domain', 'a@corp.123'],
    ['two addresses', 'a@x.ch; b@y.ch'],
    ['two at signs', 'a@b@c.ch'],
    ['no at sign', 'not-an-email'],
    ['an inner space', 'lead @example.ch'],
    ['a doubled dot', 'a..b@x.ch'],
    ['a leading dot', '.a@x.ch'],
    ['a trailing dot in the local part', 'a.@x.ch'],
    ['an empty local part', '@x.ch'],
    ['an empty domain label', 'a@x..ch'],
    ['a hyphen at the start of a label', 'a@-x.ch'],
    ['a hyphen at the end of a label', 'a@x-.ch'],
    ['a non-ASCII character', 'élise@example.ch'],
    ['uppercase (the value must be cleaned first)', 'Lead@example.ch'],
    ['a local part over 64 characters', `${'a'.repeat(65)}@example.ch`],
    ['a domain label over 63 characters', `a@${'b'.repeat(64)}.ch`],
    ['an address over 254 characters', `a@${'b.'.repeat(126)}ch`],
    ['the empty string', '']
  ])('refuses %s', (_label, value) => {
    expect(isValidEmail(value)).toBe(false);
  });

  it('places the length limit at RFC 5321', () => {
    expect(EMAIL_MAX_LENGTH).toBe(254);
    const domain = `${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.ch`;
    const atLimit = `${'a'.repeat(EMAIL_MAX_LENGTH - domain.length - 1)}@${domain}`;
    expect(atLimit.length).toBe(EMAIL_MAX_LENGTH);
    expect(isValidEmail(atLimit)).toBe(true);
    expect(isValidEmail(`a${atLimit}`)).toBe(false);
  });

  it('refuses a non-string', () => {
    expect(isValidEmail(undefined)).toBe(false);
    expect(isValidEmail({ toString: () => 'a@b.ch' })).toBe(false);
  });
});

describe('parseEmailInput', () => {
  it('cleans the incident value into the address its owner types', () => {
    expect(parseEmailInput(INCIDENT_VALUE)).toEqual({ ok: true, email: INCIDENT_ADDRESS });
  });

  it.each([undefined, null, '', '   ', '\u00a0', '\u200b'])('reads %j as a clear', (value) => {
    // Emptying the field is how a facilitator removes the recovery address.
    expect(parseEmailInput(value)).toEqual({ ok: true, email: undefined });
  });

  it.each([
    ['a value that cleans to nothing', ';'],
    ['two addresses', 'a@x.ch; b@y.ch'],
    ['two display-name addresses', 'A <a@x.ch>, B <b@y.ch>'],
    ['no top-level domain', 'a@b'],
    ['an inner space', 'lead @example.ch']
  ])('refuses %s', (_label, value) => {
    expect(parseEmailInput(value)).toEqual({ ok: false });
  });

  it.each([42, true, {}, ['a@x.ch']])('refuses the non-string %j rather than storing it', (value) => {
    expect(parseEmailInput(value)).toEqual({ ok: false });
  });

  it('accepts sub-addressing and an apostrophe, lowercased', () => {
    expect(parseEmailInput("O'Brien+Retro@Example.IE")).toEqual({ ok: true, email: "o'brien+retro@example.ie" });
  });

  it('names the wire code and the client message', () => {
    expect(INVALID_EMAIL_ERROR).toBe('invalid_email');
    expect(INVALID_EMAIL_MESSAGE).toBe('Enter one valid email address');
  });
});

describe('sameEmail', () => {
  it('matches a stored incident value against the address its owner types', () => {
    expect(sameEmail(INCIDENT_VALUE, 'Elisabeth.Trolliet@etat.ge.ch')).toBe(true);
  });

  it('never matches a stored value holding two addresses', () => {
    // Otherwise a reset mail would go to whichever of the two the caller named.
    expect(sameEmail('a@x.ch; b@y.ch', 'a@x.ch')).toBe(false);
  });

  it('never matches two missing addresses', () => {
    expect(sameEmail(undefined, '')).toBe(false);
    expect(sameEmail(null, null)).toBe(false);
  });

  it('distinguishes two different addresses', () => {
    expect(sameEmail('a@x.ch', 'b@x.ch')).toBe(false);
  });
});
