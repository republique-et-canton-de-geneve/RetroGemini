import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { buildI18nValue, I18nContext } from './I18nContext';
import {
  isLanguage,
  Language,
  LANGUAGE_STORAGE_KEY,
  resolveInitialLanguage,
  setActiveLanguage,
  storeLanguage,
} from './languages';

interface Props {
  children: React.ReactNode;
  /** Forces the starting language (tests); otherwise stored choice, then browser. */
  initialLanguage?: Language;
}

const LanguageProvider: React.FC<Props> = ({ children, initialLanguage }) => {
  const [language, setLanguageState] = useState<Language>(
    () => initialLanguage ?? resolveInitialLanguage()
  );

  // Kept in step during render, not in an effect, so code outside React that
  // runs in the same tick as a switch (an invite email sent right after) sees
  // the language the user is looking at.
  setActiveLanguage(language);

  useEffect(() => {
    // WCAG 3.1.1: the page must declare its language, or a screen reader reads
    // French with English pronunciation rules.
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    // A switch in another tab of the same app follows here, so two tabs of one
    // facilitator never disagree about the language they picked.
    const onStorage = (event: StorageEvent) => {
      if (event.key === LANGUAGE_STORAGE_KEY && isLanguage(event.newValue)) {
        setLanguageState(event.newValue);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    storeLanguage(next);
    setLanguageState(next);
  }, []);

  const value = useMemo(() => buildI18nValue(language, setLanguage), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export default LanguageProvider;
