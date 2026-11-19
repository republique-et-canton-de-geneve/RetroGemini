import { describe, expect, it } from 'vitest';
import { NAMESPACES } from '../i18n/messages';
import { createTranslator } from '../i18n/translate';
import {
  AVATAR_ART_IDS,
  AVATAR_FAMILIES,
  AVATAR_FAMILY_LABEL_KEYS,
  AVATAR_FAMILY_PITCH_KEYS,
  AVATAR_NAME_KEYS,
} from '../components/common/avatars/avatarArt';

/**
 * The "avatars" namespace: the names a picker reads out and the family labels.
 * i18nDictionaries.test.ts checks the namespace's shape with every other one;
 * this suite checks that it is registered and that each language says what the
 * picker will show.
 */

const enT = createTranslator('en');
const frT = createTranslator('fr');

describe('the avatars namespace', () => {
  it('is registered, with the same keys in both languages', () => {
    const [enMessages, frMessages] = NAMESPACES.avatars;
    expect(Object.keys(enMessages)).toHaveLength(AVATAR_ART_IDS.length + 2 * AVATAR_FAMILIES.length);
    expect(Object.keys(frMessages).sort()).toEqual(Object.keys(enMessages).sort());
  });

  it('names an avatar and a family in the reader’s language', () => {
    expect(enT(AVATAR_NAME_KEYS.fox)).toBe('Fox');
    expect(frT(AVATAR_NAME_KEYS.fox)).toBe('Renard');
    expect(enT(AVATAR_FAMILY_LABEL_KEYS.monsters)).toBe('Little monsters');
    expect(frT(AVATAR_FAMILY_LABEL_KEYS.monsters)).toBe('Petits monstres');
  });

  it('translates every name and family, never leaving the English in French', () => {
    const sameInBoth = AVATAR_ART_IDS.filter(id => enT(AVATAR_NAME_KEYS[id]) === frT(AVATAR_NAME_KEYS[id]));
    // A few names are the same word in both languages (Koala); most are not.
    expect(sameInBoth.length).toBeLessThan(AVATAR_ART_IDS.length / 4);
    for (const family of AVATAR_FAMILIES) {
      expect(frT(AVATAR_FAMILY_PITCH_KEYS[family.id]), family.id).not.toBe(enT(AVATAR_FAMILY_PITCH_KEYS[family.id]));
    }
  });

  it('writes French punctuation with its no-break space', () => {
    const pitch = frT(AVATAR_FAMILY_PITCH_KEYS.monsters);
    expect(pitch).toContain(' :');
    expect(pitch).not.toMatch(/ [?!:;»]|« /);
  });
});
