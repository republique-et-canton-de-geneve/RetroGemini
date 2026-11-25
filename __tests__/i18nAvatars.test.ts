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
 * picker will show (a name per tile, a label per tab, a pitch under the tabs).
 */

const enT = createTranslator('en');
const frT = createTranslator('fr');

describe('the avatars namespace', () => {
  it('is registered, with the same keys in both languages', () => {
    const [enMessages, frMessages] = NAMESPACES.avatars;
    // A name per picture, a label and a pitch per family; the picker's own
    // strings (avatars.picker.*) and the one-time hint's (avatars.hint.*)
    // share the namespace.
    const ofThePictures = Object.keys(enMessages).filter(key => !key.startsWith('avatars.picker.') && !key.startsWith('avatars.hint.'));
    expect(ofThePictures).toHaveLength(AVATAR_ART_IDS.length + 2 * AVATAR_FAMILIES.length);
    expect(Object.keys(frMessages).sort()).toEqual(Object.keys(enMessages).sort());
  });

  it('names an avatar and a family in the reader’s language', () => {
    expect(enT(AVATAR_NAME_KEYS.fox)).toBe('Fox');
    expect(frT(AVATAR_NAME_KEYS.fox)).toBe('Renard');
    // The bird the picture draws: a "pingouin" is the razorbill, which flies.
    expect(frT(AVATAR_NAME_KEYS.penguin)).toBe('Manchot');
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

  // The one-time hint that the avatar can be changed (AGENTS.md, *Avatars*).
  it("says the hint in both languages, with the picker's own words", () => {
    expect(enT('avatars.hint.title')).toBe('New: choose your avatar');
    expect(frT('avatars.hint.title')).toBe('Nouveau\u00a0: choisissez votre avatar');
    expect(enT('avatars.hint.body', { count: 120 })).toBe(
      'Swap your initials for one of 120 drawings. You can change it at any time from your initials, at the top right.'
    );
    expect(frT('avatars.hint.body', { count: 120 })).toBe(
      'Remplacez vos initiales par l’un des 120 dessins. Vous pourrez le changer à tout moment depuis vos initiales, en haut à droite.'
    );
    // The button says what the picker it opens is called.
    expect(enT('avatars.hint.choose')).toBe(enT('avatars.picker.title'));
    expect(frT('avatars.hint.choose')).toBe(frT('avatars.picker.title'));
    // "Got it" is the Jira note's word for the same gesture.
    expect(enT('avatars.hint.dismiss')).toBe(enT('jira.note.dismiss'));
    expect(frT('avatars.hint.dismiss')).toBe(frT('jira.note.dismiss'));
    for (const key of ['avatars.hint.title', 'avatars.hint.body', 'avatars.hint.choose', 'avatars.hint.dismiss'] as const) {
      expect(frT(key), key).not.toBe(enT(key));
    }
  });
});
