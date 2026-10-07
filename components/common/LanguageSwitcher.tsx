import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { LANGUAGE_NATIVE_NAMES, SUPPORTED_LANGUAGES } from '../../i18n/languages';

interface Props {
  className?: string;
}

/**
 * The interface-language toggle. Each option is named in its own language and
 * marked with `lang`, so a French speaker stuck on an English screen finds
 * "Français" (and a screen reader pronounces it correctly) without first having
 * to understand the screen they want to leave.
 */
const LanguageSwitcher: React.FC<Props> = ({ className = '' }) => {
  const { language, setLanguage, t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t('common.language.label')}
      className={`inline-flex items-center rounded-lg border border-slate-300 bg-white p-0.5 text-xs font-bold ${className}`}
      data-testid="language-switcher"
    >
      {SUPPORTED_LANGUAGES.map(option => {
        const active = option === language;
        const nativeName = LANGUAGE_NATIVE_NAMES[option];
        return (
          <button
            key={option}
            type="button"
            lang={option}
            aria-pressed={active}
            aria-label={nativeName}
            title={t('common.language.switchTo', { language: nativeName })}
            onClick={() => {
              if (!active) setLanguage(option);
            }}
            className={`rounded-md px-2 py-1 uppercase transition ${
              active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
            data-testid={`language-option-${option}`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
};

export default LanguageSwitcher;
