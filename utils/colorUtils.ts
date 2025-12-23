/**
 * Color utility functions for generating color shades from hex values
 */

/**
 * Convert hex color to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => {
    const hex = Math.round(Math.max(0, Math.min(255, n))).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Adjust color lightness
 * @param hex - The hex color
 * @param percent - Positive to lighten, negative to darken (-100 to 100)
 */
export function adjustLightness(hex: string, percent: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const amount = Math.round(2.55 * percent);
  return rgbToHex(
    rgb.r + amount,
    rgb.g + amount,
    rgb.b + amount
  );
}

/**
 * Get column color styles for a given hex color
 * Returns inline style objects for background, border, text, and focus ring
 */
export function getColumnColorStyles(hex: string) {
  return {
    background: adjustLightness(hex, 45),     // Very light background
    border: hex,                               // Original color for border
    text: adjustLightness(hex, -30),           // Darker for text
    ring: adjustLightness(hex, 35),            // Light for focus ring
    hoverBg: adjustLightness(hex, 40),         // Slightly darker than background for hover
  };
}

/**
 * Check if color is light or dark (for text contrast)
 */
export function isLightColor(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;

  // Calculate relative luminance
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5;
}

/**
 * Get contrasting text color (black or white) for a background
 */
export function getContrastText(hex: string): string {
  return isLightColor(hex) ? '#000000' : '#FFFFFF';
}
