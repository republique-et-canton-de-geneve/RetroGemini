import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import { useTranslation } from '../i18n/I18nContext';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import {
  LANGUAGE_STORAGE_KEY,
  detectLanguage,
  getActiveLanguage,
  intlLocaleFor,
  readStoredLanguage,
  resolveInitialLanguage,
  storeLanguage
} from '../i18n/languages';
import { createPluralTranslator, createTranslator, interpolate, MessageKey, PluralKey } from '../i18n/translate';
import { en } from '../i18n/messages';
import { translateErrorMessage } from '../i18n/errorMessages';
import { PASSWORD_POLICY_MESSAGE } from '../utils/passwordPolicy.js';

/**
 * The interface language is per browser: detected from the browser on the
 * first visit, then whatever the user last chose with the switcher. These
 * tests pin that order, the translation primitives every screen relies on, and
 * the page-level `lang` attribute a screen reader needs (WCAG 3.1.1).
 */

const setBrowserLanguages = (languages: string[]) => {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.lang = 'en';
});

describe('language detection', () => {
  it('picks the first supported language in the browser preference order', () => {
    expect(detectLanguage(['fr-CH', 'en'])).toBe('fr');
    expect(detectLanguage(['de-CH', 'fr-CH', 'en'])).toBe('fr');
    expect(detectLanguage(['en-GB', 'fr'])).toBe('en');
    expect(detectLanguage(['FR_ch'])).toBe('fr');
  });

  it('falls back to English when the browser offers nothing supported', () => {
    expect(detectLanguage(['de-DE', 'it'])).toBe('en');
    expect(detectLanguage([])).toBe('en');
    expect(detectLanguage(undefined)).toBe('en');
  });

  it('lets a stored choice win over the browser', () => {
    setBrowserLanguages(['fr-CH']);
    expect(resolveInitialLanguage()).toBe('fr');
    storeLanguage('en');
    expect(readStoredLanguage()).toBe('en');
    expect(resolveInitialLanguage()).toBe('en');
  });

  it('ignores a stored value that is not a supported language', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'klingon');
    expect(readStoredLanguage()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readStoredLanguage()).toBeNull();
    expect(() => storeLanguage('fr')).not.toThrow();
  });

  it('keeps the regional variant the browser offers for dates', () => {
    expect(intlLocaleFor('fr', ['fr-CH', 'en-US'])).toBe('fr-CH');
    expect(intlLocaleFor('en', ['fr-CH', 'en-GB'])).toBe('en-GB');
    expect(intlLocaleFor('fr', ['en-US'])).toBe('fr-CH');
    expect(intlLocaleFor('en', ['fr-CH'])).toBe('en-US');
  });
});

describe('translation primitives', () => {
  it('fills placeholders and leaves an unknown one visible', () => {
    expect(interpolate('Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
    expect(interpolate('Hello {name}', {})).toBe('Hello {name}');
    expect(interpolate('{n} of {n}', { n: 3 })).toBe('3 of 3');
  });

  it('translates in the requested language', () => {
    expect(createTranslator('en')('common.cancel')).toBe('Cancel');
    expect(createTranslator('fr')('common.cancel')).toBe('Annuler');
    expect(createTranslator('fr')('errors.passwordTooShort', { min: 8 })).toBe(
      'Le mot de passe doit contenir au moins 8 caractères'
    );
  });

  it('shows the key rather than an empty control for a key that does not exist', () => {
    expect(createTranslator('fr')('nope.missing' as MessageKey)).toBe('nope.missing');
  });

  it('applies each language’s plural rule', () => {
    // Any real pair will do: the rule is Intl's, the choice of form is ours.
    const oneKey = (Object.keys(en) as MessageKey[]).find(key => key.endsWith('_one'));
    expect(oneKey, 'at least one plural pair exists').toBeDefined();
    const base = oneKey!.replace(/_one$/, '') as PluralKey;
    const otherKey = `${base}_other` as MessageKey;
    const params = { count: 0, name: 'N', average: 'A', max: 'M' };

    const enTp = createPluralTranslator('en');
    const frTp = createPluralTranslator('fr');
    expect(enTp(base, 1, params)).toBe(createTranslator('en')(oneKey!, { ...params, count: 1 }));
    expect(enTp(base, 0, params)).toBe(createTranslator('en')(otherKey, params));
    expect(enTp(base, 2, params)).toBe(createTranslator('en')(otherKey, { ...params, count: 2 }));
    // French reads 0 and 1 as singular.
    expect(frTp(base, 0, params)).toBe(createTranslator('fr')(oneKey!, params));
    expect(frTp(base, 1, params)).toBe(createTranslator('fr')(oneKey!, { ...params, count: 1 }));
    expect(frTp(base, 2, params)).toBe(createTranslator('fr')(otherKey, { ...params, count: 2 }));
  });

  it('translates the errors the data layer raises, and passes unknown ones through', () => {
    const fr = createTranslator('fr');
    expect(translateErrorMessage('Invalid password', fr)).toBe('Mot de passe incorrect');
    expect(translateErrorMessage(PASSWORD_POLICY_MESSAGE, fr)).toBe(
      'Le mot de passe doit contenir au moins 8 caractères'
    );
    expect(translateErrorMessage(PASSWORD_POLICY_MESSAGE, createTranslator('en'))).toBe(PASSWORD_POLICY_MESSAGE);
    expect(translateErrorMessage('too_many_attempts', fr)).toBe(
      'Trop de tentatives. Patientez quelques minutes puis réessayez.'
    );
    expect(translateErrorMessage('Failed to fetch', fr)).toBe('Failed to fetch');
    expect(translateErrorMessage(undefined, fr)).toBe("Une erreur s'est produite. Veuillez réessayer.");
  });
});

const Probe: React.FC = () => {
  const { t, tRich, language, locale } = useTranslation();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="locale">{locale}</span>
      <span data-testid="cancel">{t('common.cancel')}</span>
      <span data-testid="rich">{tRich('common.language.switchTo', { language: <strong>X</strong> })}</span>
    </div>
  );
};

describe('LanguageProvider', () => {
  it('renders English without a provider, so components tested alone keep their text', () => {
    render(<Probe />);
    expect(screen.getByTestId('cancel')).toHaveTextContent('Cancel');
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('detects French from the browser and declares it on the page', () => {
    setBrowserLanguages(['fr-CH', 'en']);
    render(<LanguageProvider><Probe /></LanguageProvider>);
    expect(screen.getByTestId('cancel')).toHaveTextContent('Annuler');
    expect(screen.getByTestId('locale')).toHaveTextContent('fr-CH');
    expect(document.documentElement.lang).toBe('fr');
    expect(getActiveLanguage()).toBe('fr');
  });

  it('splices React nodes into the translated sentence where the language puts them', () => {
    render(<LanguageProvider initialLanguage="fr"><Probe /></LanguageProvider>);
    const rich = screen.getByTestId('rich');
    expect(rich).toHaveTextContent("Afficher l'interface en X");
    expect(rich.querySelector('strong')).toHaveTextContent('X');
  });

  it('switches with the switcher, remembers the choice and updates the page language', () => {
    setBrowserLanguages(['en-US']);
    render(
      <LanguageProvider>
        <LanguageSwitcher />
        <Probe />
      </LanguageProvider>
    );
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Français' }));

    expect(screen.getByTestId('cancel')).toHaveTextContent('Annuler');
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('group', { name: 'Langue' })).toBeInTheDocument();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(getActiveLanguage()).toBe('fr');
  });

  it('names each option in its own language, marked with lang for screen readers', () => {
    render(<LanguageProvider initialLanguage="en"><LanguageSwitcher /></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Français' })).toHaveAttribute('lang', 'fr');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('lang', 'en');
  });

  it('follows a switch made in another tab', () => {
    render(<LanguageProvider initialLanguage="en"><Probe /></LanguageProvider>);
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY, newValue: 'fr' }));
    });
    expect(screen.getByTestId('cancel')).toHaveTextContent('Annuler');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'en' }));
    });
    expect(screen.getByTestId('cancel')).toHaveTextContent('Annuler');
  });
});
