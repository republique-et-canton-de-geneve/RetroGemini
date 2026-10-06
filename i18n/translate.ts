import { Language } from './languages';
import { en, fr, MessageKey, Messages } from './messages';

export type { MessageKey } from './messages';

export type TranslationParams = Record<string, string | number>;

/** A key that exists as a `_one` / `_other` pair, named without the suffix. */
export type PluralKey = MessageKey extends infer K
  ? K extends `${infer Base}_one`
    ? `${Base}_other` extends MessageKey
      ? Base
      : never
    : never
  : never;

export type Translator = (key: MessageKey, params?: TranslationParams) => string;
export type PluralTranslator = (key: PluralKey, count: number, params?: TranslationParams) => string;

const DICTIONARIES: Record<Language, Messages> = { en, fr };

const PLACEHOLDER = /\{(\w+)\}/g;

/** Replaces `{name}` placeholders; an unknown placeholder is left visible. */
export const interpolate = (template: string, params?: TranslationParams): string => {
  if (!params) return template;
  return template.replace(PLACEHOLDER, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  );
};

const lookup = (language: Language, key: MessageKey): string => {
  const message = DICTIONARIES[language][key] ?? DICTIONARIES.en[key];
  // The type system makes a missing key impossible at compile time; a key that
  // still arrives at runtime (a cast, a stale bundle) shows itself rather than
  // rendering an empty control.
  return message ?? key;
};

export const createTranslator = (language: Language): Translator =>
  (key, params) => interpolate(lookup(language, key), params);

/**
 * Plural rule per language: French treats 0 and 1 as singular ("0 vote"),
 * English only 1. `Intl.PluralRules` knows both; anything that is not `one`
 * (including French `many` for millions) reads the `_other` form.
 */
export const createPluralTranslator = (language: Language): PluralTranslator => {
  const rules = new Intl.PluralRules(language);
  return (key, count, params) => {
    const form = rules.select(count) === 'one' ? 'one' : 'other';
    const fullKey = `${key}_${form}` as MessageKey;
    return interpolate(lookup(language, fullKey), { count, ...params });
  };
};

/** English translators for pure helpers that default to English when called without one. */
export const enT: Translator = createTranslator('en');
export const enTp: PluralTranslator = createPluralTranslator('en');
