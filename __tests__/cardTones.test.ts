import { describe, expect, it } from 'vitest';
import { CARD_INK, cardTones } from '../utils/cardTones';
import { contrastRatio, hexToRgb } from '../utils/colorUtils';

// Every colour the product hands to a column: the picker's seventeen
// (components/ColorPicker.tsx), the templates' eight and the two of the default
// Start/Stop pair (i18n/content/retroTemplates.ts), and the default of a column
// added by hand.
const COLUMN_COLOURS = [
  '#dc2626', '#e11d48', '#db2777', '#c026d3', '#9333ea', '#7c3aed', '#4f46e5', '#2563eb', '#0284c7',
  '#0891b2', '#0d9488', '#059669', '#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#475569',
  '#d97706', '#10B981', '#F43F5E', '#64748B', '#6366F1',
];

// A column colour is data: an older release, or a participant's write, can hold
// any hex. A fixed sequence, so a failure names a colour that can be replayed.
const anyColours = (count: number): string[] => {
  let seed = 20261119;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed;
  };
  return Array.from({ length: count }, () => `#${(next() % 0x1000000).toString(16).padStart(6, '0')}`);
};

const luminance = (hex: string): number => {
  const rgb = hexToRgb(hex)!;
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
};

describe('cardTones', () => {
  it('gives no tones for a value that is not a colour, so the card stays white', () => {
    for (const value of [undefined, null, '', 'red', '#12', '#12345', '#gggggg', 'rgb(0,0,0)', 'bg-indigo-500', '#1234567', 'url(x)', ' #059669 ']) {
      expect(cardTones(value as string | null | undefined)).toBeNull();
    }
  });

  it('reads a colour whatever its case, with or without the hash', () => {
    expect(cardTones('#10B981')).toEqual(cardTones('#10b981'));
    expect(cardTones('10b981')).toEqual(cardTones('#10b981'));
  });

  it('answers lower-case six-digit colours', () => {
    const tones = cardTones('#059669')!;
    for (const value of Object.values(tones)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
  });

  // The look's own example: the green of the mockup's first column.
  it('keeps the tints of the look for its reference green', () => {
    expect(cardTones('#12a36d')).toEqual({ tint: '#e3f4ed', tintStrong: '#cbebdf', line: '#aadeca', ink: '#14644f' });
  });

  it.each([...COLUMN_COLOURS, ...anyColours(400), '#000000', '#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#808080'])(
    'keeps text and marks readable on a %s card',
    (colour) => {
      const tones = cardTones(colour)!;
      // The card's words, on the card and on the stronger tint behind a column's icon.
      expect(contrastRatio(CARD_INK, tones.tint)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(CARD_INK, tones.tintStrong)).toBeGreaterThanOrEqual(7);
      // The coloured ink of its small marks (comment count, icons): text on both.
      expect(contrastRatio(tones.ink, tones.tint)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tones.ink, tones.tintStrong)).toBeGreaterThanOrEqual(4.5);
      // One family, lightest first.
      expect(luminance(tones.tint)).toBeGreaterThanOrEqual(luminance(tones.tintStrong));
      expect(luminance(tones.tintStrong)).toBeGreaterThanOrEqual(luminance(tones.line));
    },
  );

  it('keeps the hue: a green column gives a green ink, not the neutral one', () => {
    const ink = hexToRgb(cardTones('#059669')!.ink)!;
    expect(ink.g).toBeGreaterThan(ink.r);
    expect(ink.g).toBeGreaterThan(ink.b);
  });

  it('falls back to the neutral ink for a colour too light to carry text', () => {
    // Pure yellow never reaches 4.5:1 on its own tint until it is almost the ink.
    const tones = cardTones('#ffff00')!;
    expect(contrastRatio(tones.ink, tones.tintStrong)).toBeGreaterThanOrEqual(4.5);
  });
});
