import React from 'react';

interface ColorPickerProps {
  initialColor?: string;
  onChange: (color: string) => void;
  onClose?: () => void;
}

// Palette de couleurs prédéfinies organisée par teinte
const COLOR_PALETTE = [
  // Rouges
  ['#EF4444', '#DC2626', '#B91C1C', '#991B1B', '#7F1D1D'],
  // Roses
  ['#EC4899', '#DB2777', '#BE185D', '#9D174D', '#831843'],
  // Violets
  ['#A855F7', '#9333EA', '#7E22CE', '#6B21A8', '#581C87'],
  // Indigo
  ['#6366F1', '#4F46E5', '#4338CA', '#3730A3', '#312E81'],
  // Bleus
  ['#3B82F6', '#2563EB', '#1D4ED8', '#1E40AF', '#1E3A8A'],
  // Cyan
  ['#06B6D4', '#0891B2', '#0E7490', '#155E75', '#164E63'],
  // Turquoise
  ['#14B8A6', '#0D9488', '#0F766E', '#115E59', '#134E4A'],
  // Verts
  ['#10B981', '#059669', '#047857', '#065F46', '#064E3B'],
  // Lime
  ['#84CC16', '#65A30D', '#4D7C0F', '#3F6212', '#365314'],
  // Jaunes
  ['#EAB308', '#CA8A04', '#A16207', '#854D0E', '#713F12'],
  // Orange
  ['#F97316', '#EA580C', '#C2410C', '#9A3412', '#7C2D12'],
  // Marrons
  ['#A16207', '#92400E', '#78350F', '#78350F', '#451A03'],
  // Gris
  ['#64748B', '#475569', '#334155', '#1E293B', '#0F172A'],
  // Gris neutre
  ['#737373', '#525252', '#404040', '#262626', '#171717'],
];

export const ColorPicker: React.FC<ColorPickerProps> = ({ initialColor = '#6366F1', onChange, onClose }) => {
  const [selectedColor, setSelectedColor] = React.useState(initialColor);

  const handleColorSelect = (color: string) => {
    setSelectedColor(color);
    onChange(color);
    // Auto-close après sélection
    if (onClose) {
      setTimeout(() => onClose(), 150);
    }
  };

  return (
    <div className="absolute z-50 bg-white rounded-lg shadow-2xl border border-gray-200 p-4 w-64">
      <div className="flex justify-between items-center mb-3">
        <span className="font-medium text-gray-700">Pick a color</span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        )}
      </div>

      {/* Preview */}
      <div className="mb-4 flex items-center gap-3 pb-3 border-b border-gray-200">
        <div
          className="w-12 h-12 rounded-lg border-2 border-gray-300 shadow-sm"
          style={{ backgroundColor: selectedColor }}
        />
        <div className="flex-1">
          <div className="text-xs text-gray-500 mb-1">Selected</div>
          <div className="text-sm font-mono font-bold text-gray-700">{selectedColor.toUpperCase()}</div>
        </div>
      </div>

      {/* Color Palette Grid */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {COLOR_PALETTE.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-2">
            {row.map((color) => (
              <button
                key={color}
                onClick={() => handleColorSelect(color)}
                className={`w-9 h-9 rounded-md transition-all hover:scale-110 border-2 ${
                  selectedColor === color
                    ? 'border-gray-800 ring-2 ring-gray-300'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
