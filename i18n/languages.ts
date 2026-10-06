/**
 * The languages the interface can be displayed in, and how the first one is
 * chosen.
 *
 * Two languages, and two independent choices:
 *  - the **interface language** is per browser: detected from the browser's
 *    preferences on first visit, then whatever the user last picked with the
 *    switcher (kept in localStorage, never on the team record — two people in
 *    the same retro may read the screens in different languages);
 *  - the **template language** of a retrospective (column titles, default
 *    icebreaker) is chosen when the retro is created and stored on the
 *    session, because that text is shared content every participant sees.
 */

export type Language = 'en' | 'fr';

export const SUPPORTED_LANGUAGES: readonly Language[] = ['en', 'fr'];

export const DEFAULT_LANGUAGE: Language = 'en';

export const LANGUAGE_STORAGE_KEY = 'retro-language';

/** Each language's name written in that language, as a switcher shows it. */
export const LANGUAGE_NATIVE_NAMES: Record<Language, string> = {
  en: 'English',
  fr: 'Français',
};

export const isLanguage = (value: unknown): value is Language =>
  value === 'en' || value === 'fr';

const baseOf = (tag: string): string => tag.trim().toLowerCase().split(/[-_]/)[0];

/**
 * First supported language in the browser's preference order, so a Geneva
 * browser set to `['de-CH', 'fr-CH', 'en']` gets French, not the default.
 */
export const detectLanguage = (preferred: readonly string[] | undefined | null): Language => {
  for (const tag of preferred ?? []) {
    if (typeof tag !== 'string') continue;
    const base = baseOf(tag);
    if (isLanguage(base)) return base;
  }
  return DEFAULT_LANGUAGE;
};

export const browserLanguages = (): readonly string[] => {
  if (typeof navigator === 'undefined') return [];
  if (navigator.languages && navigator.languages.length > 0) return navigator.languages;
  return navigator.language ? [navigator.language] : [];
};

// Storage access can throw (private windows, blocked site data), and a
// language preference is a convenience: losing it must never break the page.
export const readStoredLanguage = (): Language | null => {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : null;
  } catch {
    return null;
  }
};

export const storeLanguage = (language: Language): void => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Keep the in-memory choice for this page life.
  }
};

/** An explicit choice wins; otherwise the browser decides. */
export const resolveInitialLanguage = (): Language =>
  readStoredLanguage() ?? detectLanguage(browserLanguages());

/**
 * The locale used for dates and numbers. Keeps the user's regional variant when
 * the browser offers one (`fr-CH` stays `fr-CH`, `en-GB` stays `en-GB`).
 */
export const intlLocaleFor = (
  language: Language,
  preferred: readonly string[] = browserLanguages()
): string => {
  const match = preferred.find(tag => typeof tag === 'string' && baseOf(tag) === language);
  if (match) return match;
  return language === 'fr' ? 'fr-CH' : 'en-US';
};

/**
 * The interface language currently on screen, for code that runs outside React
 * (e.g. dataService choosing the language of an invitation email). The
 * LanguageProvider keeps it in step with its state.
 */
let activeLanguage: Language = DEFAULT_LANGUAGE;

export const getActiveLanguage = (): Language => activeLanguage;

export const setActiveLanguage = (language: Language): void => {
  activeLanguage = language;
};
