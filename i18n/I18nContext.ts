import { createContext, createElement, Fragment, ReactNode, useContext } from 'react';
import { DEFAULT_LANGUAGE, intlLocaleFor, Language } from './languages';
import {
  createPluralTranslator,
  createTranslator,
  MessageKey,
  PluralTranslator,
  Translator,
} from './translate';

export type RichParams = Record<string, ReactNode>;

export interface I18nValue {
  /** The interface language on screen. */
  language: Language;
  setLanguage: (language: Language) => void;
  /** `t('dashboard.title')`, `t('session.votesLeft', { count: 3 })`. */
  t: Translator;
  /** `tp('session.vote', count)` picks the `_one` / `_other` form; `{count}` is filled in. */
  tp: PluralTranslator;
  /**
   * Same as `t`, but a placeholder may be a React node: `tRich('x', { name:
   * <strong>{name}</strong> })`. Use it only where the message genuinely wraps
   * markup — the word order differs between languages, so the markup must live
   * inside the translated sentence, never be concatenated around it.
   */
  tRich: (key: MessageKey, params: RichParams) => ReactNode;
  /** The locale for `toLocaleDateString` / `Intl` formatting (e.g. `fr-CH`). */
  locale: string;
}

const RICH_PLACEHOLDER = /\{(\w+)\}/g;

export const buildI18nValue = (
  language: Language,
  setLanguage: (language: Language) => void
): I18nValue => {
  const t = createTranslator(language);
  const tp = createPluralTranslator(language);
  const tRich = (key: MessageKey, params: RichParams): ReactNode => {
    // Translate with no params so every placeholder survives, then splice the
    // nodes in where the translated sentence puts them.
    const template = t(key);
    const parts: ReactNode[] = [];
    let last = 0;
    for (const match of template.matchAll(RICH_PLACEHOLDER)) {
      const [whole, name] = match;
      const index = match.index ?? 0;
      if (index > last) parts.push(template.slice(last, index));
      parts.push(
        Object.prototype.hasOwnProperty.call(params, name)
          ? createElement(Fragment, { key: `${name}-${index}` }, params[name])
          : whole
      );
      last = index + whole.length;
    }
    if (last < template.length) parts.push(template.slice(last));
    return createElement(Fragment, null, ...parts);
  };
  return { language, setLanguage, t, tp, tRich, locale: intlLocaleFor(language) };
};

/**
 * Without a provider (a component rendered on its own in a unit test) every
 * screen reads English and the switcher does nothing — the same text the
 * screens rendered before translation existed, so those tests stay valid.
 */
export const I18nContext = createContext<I18nValue>(
  buildI18nValue(DEFAULT_LANGUAGE, () => undefined)
);

export const useTranslation = (): I18nValue => useContext(I18nContext);
