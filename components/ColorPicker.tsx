import React from 'react';
import { useTranslation } from '../i18n/I18nContext';

interface ColorPickerProps {
  initialColor?: string;
  onChange: (color: string) => void;
  onClose?: () => void;
}

// Simplified color palette - one color per hue, all work well with white text
const COLORS = [
  '#dc2626', // red-600
  '#e11d48', // rose-600
  '#db2777', // pink-600
  '#c026d3', // fuchsia-600
  '#9333ea', // purple-600
  '#7c3aed', // violet-600
  '#4f46e5', // indigo-600
  '#2563eb', // blue-600
  '#0284c7', // sky-600
  '#0891b2', // cyan-600
  '#0d9488', // teal-600
  '#059669', // emerald-600
  '#16a34a', // green-600
  '#65a30d', // lime-600
  '#ca8a04', // yellow-600
  '#ea580c', // orange-600
  '#475569', // slate-600
];

export const ColorPicker: React.FC<ColorPickerProps> = ({ initialColor = '#6366F1', onChange, onClose }) => {
  const { t } = useTranslation();
  const [selectedColor, setSelectedColor] = React.useState(initialColor);

  const handleColorSelect = (color: string) => {
    setSelectedColor(color);
    onChange(color);
    // Auto-close after selection
    if (onClose) {
      setTimeout(() => onClose(), 150);
    }
  };

  return (
    // The picker's own chrome follows the look (slate and the brand); the
    // seventeen colours above are data offered to the facilitator and stay
    // as they are.
    <div className="absolute z-50 bg-white rounded-xl shadow-xl border border-slate-200 p-4 w-64">
      <div className="flex justify-between items-center mb-3">
        <span className="font-semibold text-slate-900">{t('shared.colorPicker.title')}</span>
        {onClose && (
          <button
            onClick={onClose}
            aria-label={t('shared.colorPicker.close')}
            className="inline-flex items-center justify-center w-8 h-8 -mr-1.5 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
          >
            <span className="material-symbols-outlined text-xl" aria-hidden="true">close</span>
          </button>
        )}
      </div>

      {/* Preview */}
      <div className="mb-4 flex items-center gap-3 pb-3 border-b border-slate-200">
        <div
          className="w-11 h-11 rounded-lg border border-slate-400 shadow-xs"
          style={{ backgroundColor: selectedColor }}
        />
        <div className="flex-1">
          <div className="text-xs text-slate-600 mb-0.5">{t('shared.colorPicker.selected')}</div>
          <div className="text-sm font-mono font-semibold text-slate-900">{selectedColor.toUpperCase()}</div>
        </div>
      </div>

      {/* Color Palette Grid. The chosen swatch carries a brand ring with a
          white gap, so it reads on every colour of the palette. */}
      <div className="grid grid-cols-6 gap-1.5">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => handleColorSelect(color)}
            className={`w-8 h-8 rounded-lg transition-shadow ${
              selectedColor === color
                ? 'ring-2 ring-indigo-600 ring-offset-2 ring-offset-white'
                : 'hover:ring-2 hover:ring-slate-400 hover:ring-offset-2 hover:ring-offset-white'
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
    </div>
  );
};
