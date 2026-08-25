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

/**
 * WCAG 2.1 relative luminance (sRGB gamma-corrected).
 *
 * Deliberately not `isLightColor`'s weighted average: that approximation is
 * good enough for choosing black-or-white on a card, but it is not the formula
 * a contrast ratio is defined by, and this one is used to make a conformance
 * claim.
 */
function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1:1 to 21:1. Order does not matter. */
export function contrastRatio(hexA: string, hexB: string): number {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return 1;

  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The nearest readable version of a colour the user picked.
 *
 * Column titles are painted in the column's own colour, and the picker accepts
 * anything — the default emerald measured 3.76:1 against WCAG AA's 4.5:1 floor
 * (audit H42). Hard-coding darker defaults would have fixed the defaults only.
 *
 * The hue is kept and the colour is stepped toward black (or toward white, on a
 * dark background) until it clears the floor, so a facilitator's choice is
 * respected as far as it can be. A colour that already passes is returned
 * untouched.
 */
export function readableTextColor(hex: string, background = '#FFFFFF', minRatio = 4.5): string {
  const rgb = hexToRgb(hex);
  const backgroundRgb = hexToRgb(background);
  if (!rgb || !backgroundRgb) return hex;
  if (contrastRatio(hex, background) >= minRatio) return hex;

  // Toward black on a light background, toward white on a dark one.
  const target = relativeLuminance(backgroundRgb) > 0.5 ? 0 : 255;

  // 20 steps of 5%: fine enough that the result still reads as the chosen hue,
  // coarse enough to stay cheap in a render path.
  for (let step = 1; step <= 20; step += 1) {
    const mix = step / 20;
    const candidate = rgbToHex(
      rgb.r + (target - rgb.r) * mix,
      rgb.g + (target - rgb.g) * mix,
      rgb.b + (target - rgb.b) * mix
    );
    if (contrastRatio(candidate, background) >= minRatio) return candidate;
  }

  return target === 0 ? '#000000' : '#FFFFFF';
}

/** The two candidates for text painted on a coloured surface. */
const NEAR_BLACK = '#0F172A';
const WHITE = '#FFFFFF';

/**
 * Near-black or white on a given background, chosen by measured contrast.
 *
 * `isLightColor` decides this with a weighted brightness average, which is not
 * the formula a contrast ratio is defined by, and it got the default "Stop"
 * column wrong: rose `#F43F5E` was judged dark, so its ticket text went white
 * at 3.67:1 where near-black gives 4.86:1 (audit H42). `isLightColor` is left
 * alone — it has other callers where the question really is "is this light" —
 * and the *text* decision moves here.
 */
export function bestTextColorOn(background: string): string {
  if (!hexToRgb(background)) return NEAR_BLACK;
  return contrastRatio(WHITE, background) > contrastRatio(NEAR_BLACK, background) ? WHITE : NEAR_BLACK;
}
