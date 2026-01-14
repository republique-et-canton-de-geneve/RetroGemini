import React from 'react';
import { useLanguage, Language } from '../i18n';

interface Props {
  className?: string;
}

const LanguageSelector: React.FC<Props> = ({ className = '' }) => {
  const { language, setLanguage, languageNames } = useLanguage();

  const languages: Language[] = ['en', 'fr'];

  return (
    <div className={`flex items-center ${className}`}>
      <span className="material-symbols-outlined text-slate-400 mr-1.5 text-lg">language</span>
      <select
        value={language}
        onChange={(e) => setLanguage(e.target.value as Language)}
        className="bg-transparent border border-slate-200 rounded-lg px-2 py-1 text-sm text-slate-600 hover:border-indigo-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 outline-none cursor-pointer transition"
        aria-label="Select language"
      >
        {languages.map((lang) => (
          <option key={lang} value={lang}>
            {languageNames[lang]}
          </option>
        ))}
      </select>
    </div>
  );
};

export default LanguageSelector;
