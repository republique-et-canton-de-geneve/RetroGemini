import React, { useState, useRef, useEffect } from 'react';

interface ColorPickerProps {
  initialColor?: string;
  onChange: (color: string) => void;
  onClose?: () => void;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ initialColor = '#6366F1', onChange, onClose }) => {
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(70);
  const [lightness, setLightness] = useState(60);
  const pickerRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    // Parse initial color to HSL
    const hex = initialColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }

    setHue(Math.round(h * 360));
    setSaturation(Math.round(s * 100));
    setLightness(Math.round(l * 100));
  }, [initialColor]);

  const hslToHex = (h: number, s: number, l: number): string => {
    h = h / 360;
    s = s / 100;
    l = l / 100;

    let r, g, b;

    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p: number, q: number, t: number) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };

      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }

    const toHex = (x: number) => {
      const hex = Math.round(x * 255).toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    };

    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  };

  const currentColor = hslToHex(hue, saturation, lightness);

  useEffect(() => {
    onChange(currentColor);
  }, [hue, saturation, lightness]);

  const handleSatLightClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newSat = Math.round((x / rect.width) * 100);
    const newLight = Math.round(100 - (y / rect.height) * 100);

    setSaturation(Math.max(0, Math.min(100, newSat)));
    setLightness(Math.max(0, Math.min(100, newLight)));
  };

  const handleSatLightDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    handleSatLightClick(e);
  };

  return (
    <div className="absolute z-50 bg-white rounded-lg shadow-2xl border border-gray-200 p-4 w-72" ref={pickerRef}>
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

      {/* Saturation/Lightness Picker */}
      <div
        className="relative w-full h-48 rounded-lg mb-4 cursor-crosshair select-none"
        style={{
          background: `linear-gradient(to top, black, transparent), linear-gradient(to right, white, hsl(${hue}, 100%, 50%))`
        }}
        onMouseDown={(e) => {
          isDraggingRef.current = true;
          handleSatLightClick(e);
        }}
        onMouseMove={handleSatLightDrag}
        onMouseUp={() => isDraggingRef.current = false}
        onMouseLeave={() => isDraggingRef.current = false}
      >
        <div
          className="absolute w-4 h-4 rounded-full border-2 border-white shadow-lg pointer-events-none"
          style={{
            left: `${saturation}%`,
            top: `${100 - lightness}%`,
            transform: 'translate(-50%, -50%)',
            backgroundColor: currentColor
          }}
        />
      </div>

      {/* Hue Slider */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-600 mb-2">Hue</label>
        <input
          type="range"
          min="0"
          max="360"
          value={hue}
          onChange={(e) => setHue(parseInt(e.target.value))}
          className="w-full h-3 rounded-lg appearance-none cursor-pointer"
          style={{
            background: 'linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)'
          }}
        />
      </div>

      {/* Preview and Hex Value */}
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-lg border-2 border-gray-300 shadow-inner"
          style={{ backgroundColor: currentColor }}
        />
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-600 mb-1">Hex</label>
          <input
            type="text"
            value={currentColor.toUpperCase()}
            onChange={(e) => {
              const hex = e.target.value;
              if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
                onChange(hex);
              }
            }}
            className="w-full px-3 py-1.5 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 outline-none"
          />
        </div>
      </div>

      {/* Preset Colors */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <label className="block text-sm font-medium text-gray-600 mb-2">Quick Colors</label>
        <div className="grid grid-cols-8 gap-2">
          {['#EF4444', '#F97316', '#F59E0B', '#84CC16', '#10B981', '#06B6D4', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#64748B', '#1F2937'].map((color) => (
            <button
              key={color}
              className="w-7 h-7 rounded border-2 border-gray-300 hover:scale-110 transition-transform"
              style={{ backgroundColor: color }}
              onClick={() => onChange(color)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
