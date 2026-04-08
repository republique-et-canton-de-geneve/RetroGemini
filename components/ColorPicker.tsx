import React from 'react';

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
          className="w-12 h-12 rounded-lg border-2 border-gray-300 shadow-xs"
          style={{ backgroundColor: selectedColor }}
        />
        <div className="flex-1">
          <div className="text-xs text-gray-500 mb-1">Selected</div>
          <div className="text-sm font-mono font-bold text-gray-700">{selectedColor.toUpperCase()}</div>
        </div>
      </div>

      {/* Color Palette Grid */}
      <div className="grid grid-cols-6 gap-2">
        {COLORS.map((color) => (
          <button
            key={color}
            onClick={() => handleColorSelect(color)}
            className={`w-10 h-10 rounded-md transition-all hover:scale-110 border-2 ${
              selectedColor === color
                ? 'border-gray-800 ring-2 ring-gray-300'
                : 'border-gray-200 hover:border-gray-400'
            }`}
            style={{ backgroundColor: color }}
            title={color}
          />
        ))}
      </div>
    </div>
  );
};
