import { describe, expect, it } from 'vitest';
import {
  adjustLightness,
  getColumnColorStyles,
  getContrastText,
  hexToRgb,
  isLightColor,
  rgbToHex
} from '../utils/colorUtils';

/**
 * Pure colour helpers behind the retro column styling. They were entirely
 * uncovered, so a regression would only show up as an unreadable column in the
 * UI — exactly the kind of thing a unit test is cheap enough to guard.
 */

describe('hexToRgb', () => {
  it('parses a hex colour with and without the leading hash', () => {
    expect(hexToRgb('#3B82F6')).toEqual({ r: 0x3b, g: 0x82, b: 0xf6 });
    expect(hexToRgb('3b82f6')).toEqual({ r: 0x3b, g: 0x82, b: 0xf6 });
  });

  it.each(['', '#fff', 'not-a-colour', '#3b82f6ff', '#ghijkl'])(
    'returns null for %s',
    (value) => {
      expect(hexToRgb(value)).toBeNull();
    }
  );
});

describe('rgbToHex', () => {
  it('renders each channel as two lowercase hex digits', () => {
    expect(rgbToHex(59, 130, 246)).toBe('#3b82f6');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
  });

  it('pads single-digit channels', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });

  it('clamps out-of-range channels instead of producing invalid hex', () => {
    expect(rgbToHex(-40, 300, 128)).toBe('#00ff80');
  });

  it('rounds fractional channels', () => {
    expect(rgbToHex(0.6, 1.4, 2.5)).toBe('#010103');
  });
});

describe('adjustLightness', () => {
  it('lightens and darkens around the original colour', () => {
    const base = '#808080';

    const lighter = hexToRgb(adjustLightness(base, 20))!;
    const darker = hexToRgb(adjustLightness(base, -20))!;

    expect(lighter.r).toBeGreaterThan(0x80);
    expect(darker.r).toBeLessThan(0x80);
  });

  it('saturates at the ends of the range rather than wrapping', () => {
    expect(adjustLightness('#808080', 100)).toBe('#ffffff');
    expect(adjustLightness('#808080', -100)).toBe('#000000');
  });

  it('returns the input untouched when it is not a hex colour', () => {
    expect(adjustLightness('transparent', 40)).toBe('transparent');
  });
});

describe('getColumnColorStyles', () => {
  it('keeps the original colour for the border and derives the rest from it', () => {
    const styles = getColumnColorStyles('#3b82f6');

    expect(styles.border).toBe('#3b82f6');
    // Background and ring are lighter than the source, text is darker.
    expect(isLightColor(styles.background)).toBe(true);
    expect(hexToRgb(styles.text)!.r).toBeLessThan(0x3b);
    expect(hexToRgb(styles.hoverBg)!.r).toBeLessThan(hexToRgb(styles.background)!.r);
  });
});

describe('isLightColor / getContrastText', () => {
  it('picks black text on a light background and white on a dark one', () => {
    expect(isLightColor('#ffffff')).toBe(true);
    expect(getContrastText('#ffffff')).toBe('#000000');

    expect(isLightColor('#000000')).toBe(false);
    expect(getContrastText('#000000')).toBe('#FFFFFF');
  });

  it('weights the channels by perceived luminance, not raw value', () => {
    // Pure blue is far darker to the eye than pure green at the same channel
    // value, so a naive average would get this pair wrong.
    expect(isLightColor('#00ff00')).toBe(true);
    expect(isLightColor('#0000ff')).toBe(false);
  });

  it('treats an unparseable colour as light so text stays black', () => {
    expect(isLightColor('nonsense')).toBe(true);
    expect(getContrastText('nonsense')).toBe('#000000');
  });
});
