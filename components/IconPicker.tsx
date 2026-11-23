import React, { useState, useMemo } from 'react';
import { useReturnFocus } from './common/useReturnFocus';
import { useTranslation } from '../i18n/I18nContext';
import { ICON_PICKER_ICONS, columnIconName } from './iconPickerIcons';

interface IconPickerProps {
  initialIcon?: string;
  onChange: (icon: string) => void;
  onClose?: () => void;
}

export const IconPicker: React.FC<IconPickerProps> = ({ initialIcon = 'star', onChange, onClose }) => {
  const { t, tp } = useTranslation();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIcon, setSelectedIcon] = useState(() => columnIconName(initialIcon));

  const filteredIcons = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return ICON_PICKER_ICONS;

    return ICON_PICKER_ICONS.filter(icon =>
      icon.name.toLowerCase().includes(term) ||
      icon.keywords.toLowerCase().includes(term)
    );
  }, [searchTerm]);

  // The picker autofocuses its search box, and both call sites close it by
  // unmounting it — on the close button, and 150 ms after an icon is chosen.
  // Whichever control had focus goes with it, so without this the keyboard
  // user lands on `<body>` instead of back on the button they opened it from
  // (Codex, PR #437). It is not a `ModalDialog`: this is a popover beside its
  // trigger, not a modal, so it takes the focus half and none of the rest.
  useReturnFocus();

  const handleIconSelect = (iconName: string) => {
    setSelectedIcon(iconName);
    onChange(iconName);
    // Auto-close after selection
    if (onClose) {
      setTimeout(() => onClose(), 150);
    }
  };

  // Anchored to its column's row (the call site's `relative`), never wider
  // than it: a fixed 600px ran past a phone's dialog, which then scrolled
  // sideways with the close button out of view (e2e/template-pickers.spec.ts).
  return (
    <div className="absolute z-50 left-0 w-full max-w-[600px] bg-white rounded-lg shadow-2xl border border-slate-200 p-4 max-h-[600px] flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <span className="font-medium text-slate-700">{t('shared.iconPicker.title')}</span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={t('shared.iconPicker.close')}
            className="text-slate-500 hover:text-slate-700 transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="mb-4">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xl">
            search
          </span>
          <input
            type="text"
            placeholder={t('shared.iconPicker.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-slate-400 rounded-lg focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-hidden"
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the picker opens on demand and searching is what it is for
            autoFocus
          />
        </div>
        {searchTerm && (
          <div className="mt-2 text-sm text-slate-500">
            {tp('shared.iconPicker.found', filteredIcons.length)}
          </div>
        )}
      </div>

      {/* Selected Icon Preview */}
      <div className="mb-4 pb-4 border-b border-slate-200 flex items-center gap-3">
        <span className="material-symbols-outlined text-4xl text-indigo-600">{selectedIcon}</span>
        <div>
          <div className="text-sm font-medium text-slate-700">{t('shared.iconPicker.selected')}</div>
          <div className="text-xs text-slate-500 font-mono">{selectedIcon}</div>
        </div>
      </div>

      {/* Icon Grid */}
      <div className="flex-1 overflow-y-auto">
        {/* As many 3rem columns as fit: ten on a computer, fewer on a phone. */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(3rem,1fr))] gap-2">
          {filteredIcons.map((icon) => (
            <button
              key={icon.name}
              type="button"
              onClick={() => handleIconSelect(icon.name)}
              // The chosen icon says so as a state, not only by its border.
              aria-pressed={selectedIcon === icon.name}
              className={`
                p-3 rounded-lg transition hover:bg-indigo-50 border-2
                ${selectedIcon === icon.name
                  ? 'border-indigo-500 bg-indigo-50 shadow-md'
                  : 'border-transparent hover:border-indigo-200'
                }
              `}
              title={icon.name}
              aria-label={t('shared.iconPicker.choose', { name: icon.name })}
            >
              <span className="material-symbols-outlined text-2xl text-slate-700">
                {icon.name}
              </span>
            </button>
          ))}
        </div>

        {filteredIcons.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <span className="material-symbols-outlined text-5xl mb-3 block">search_off</span>
            <p>{t('shared.iconPicker.emptyTitle')}</p>
            <p className="text-sm mt-1">{t('shared.iconPicker.emptyHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
