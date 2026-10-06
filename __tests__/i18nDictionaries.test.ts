import { describe, expect, it } from 'vitest';
import { en, fr, NAMESPACES } from '../i18n/messages';
import { ICEBREAKER_QUESTIONS } from '../i18n/content/icebreakers';

/**
 * What the type system cannot see about the dictionaries.
 *
 * `Record<keyof typeof en, string>` already makes a key missing from French a
 * compile error. It cannot tell that two namespaces define the same key — the
 * spread in i18n/messages.ts would let the later one silently win — nor that a
 * French sentence dropped a `{placeholder}` and will render without the value,
 * nor that a translation was left empty. Those are the failures checked here.
 */

const placeholdersOf = (message: string) =>
  [...message.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe('i18n dictionaries', () => {
  it('prefixes every key with its namespace, so no namespace can overwrite another', () => {
    for (const [namespace, [enMessages, frMessages]] of Object.entries(NAMESPACES)) {
      for (const key of [...Object.keys(enMessages), ...Object.keys(frMessages)]) {
        expect(key.startsWith(`${namespace}.`), `${key} is in the "${namespace}" namespace`).toBe(true);
      }
    }
  });

  it('defines exactly the same keys in both languages, namespace by namespace', () => {
    for (const [namespace, [enMessages, frMessages]] of Object.entries(NAMESPACES)) {
      expect(Object.keys(frMessages).sort(), namespace).toEqual(Object.keys(enMessages).sort());
    }
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it('uses the same placeholders in both languages', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(placeholdersOf(fr[key]), key).toEqual(placeholdersOf(en[key]));
    }
  });

  it('leaves no message empty', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(en[key].trim(), `en ${key}`).not.toBe('');
      expect(fr[key].trim(), `fr ${key}`).not.toBe('');
    }
  });

  it('keeps French punctuation attached to its word', () => {
    // French puts a space before ? ! : ; and inside « », and a breaking space
    // lets the mark wrap onto a line of its own ("commencer" / "!"). The
    // dictionaries use U+202F before ? ! ; and U+00A0 before : and inside « ».
    for (const key of Object.keys(fr) as Array<keyof typeof fr>) {
      expect(fr[key], key).not.toMatch(/ [?!:;»]|« /);
    }
    for (const question of ICEBREAKER_QUESTIONS.fr) {
      expect(question).not.toMatch(/ [?!:;»]|« /);
    }
  });

  it('defines plurals as complete _one / _other pairs', () => {
    const keys = new Set(Object.keys(en));
    for (const key of keys) {
      if (key.endsWith('_one')) expect(keys.has(key.replace(/_one$/, '_other')), key).toBe(true);
      if (key.endsWith('_other')) expect(keys.has(key.replace(/_other$/, '_one')), key).toBe(true);
    }
  });
});
