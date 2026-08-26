import { describe, it, expect } from 'vitest';
import { bestTextColorOn, contrastRatio, readableTextColor } from '../utils/colorUtils';

/**
 * Column colours are chosen by the facilitator, and the column title is painted
 * in the chosen colour (H42).
 *
 * The default emerald measured 3.76:1 against a 4.5:1 floor — but hard-coding a
 * darker default only fixes the defaults, and the picker accepts any colour.
 * So the fix is a function: keep the hue the user picked, darken it until it is
 * readable, and stop.
 */

describe('contrastRatio', () => {
  it('matches the WCAG values at the extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('does not care which colour is given first', () => {
    expect(contrastRatio('#059669', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#059669'), 5);
  });

  it('reports the emerald that failed the audit', () => {
    // The number in the axe report, which is what made this function necessary.
    expect(contrastRatio('#059669', '#FFFFFF')).toBeCloseTo(3.76, 1);
  });
});

describe('readableTextColor', () => {
  it('leaves a colour that already reads well exactly as it is', () => {
    // Never repaint what passes: the facilitator picked this hue on purpose.
    expect(readableTextColor('#1E3A8A', '#FFFFFF')).toBe('#1E3A8A');
  });

  it('darkens a too-light colour until it clears the floor', () => {
    const readable = readableTextColor('#059669', '#FFFFFF');

    expect(readable).not.toBe('#059669');
    expect(contrastRatio(readable, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('lightens instead when the background is dark', () => {
    const readable = readableTextColor('#1E3A8A', '#0F172A');

    expect(contrastRatio(readable, '#0F172A')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the hue recognisable rather than collapsing to black', () => {
    const readable = readableTextColor('#F43F5E', '#FFFFFF');

    expect(readable).not.toBe('#000000');
    // Still visibly red: the red channel stays the dominant one.
    const [r, g, b] = [1, 3, 5].map(i => parseInt(readable.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('clears the floor for every colour the picker offers, on white', () => {
    const PICKER_COLOURS = [
      '#059669', '#10B981', '#F43F5E', '#EF4444', '#F59E0B', '#EAB308',
      '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899', '#64748B', '#0EA5E9'
    ];

    for (const colour of PICKER_COLOURS) {
      const readable = readableTextColor(colour, '#FFFFFF');
      expect(
        contrastRatio(readable, '#FFFFFF'),
        `${colour} → ${readable}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('falls back to the input when handed something that is not a colour', () => {
    expect(readableTextColor('not-a-colour', '#FFFFFF')).toBe('not-a-colour');
  });

  it('honours a stricter floor when asked for one', () => {
    const readable = readableTextColor('#3B82F6', '#FFFFFF', 7);
    expect(contrastRatio(readable, '#FFFFFF')).toBeGreaterThanOrEqual(7);
  });
});

describe('bestTextColorOn — the text painted on a card', () => {
  /**
   * A ticket card is painted in its column's colour and the text on it is
   * either near-black or white. That choice was made by a *naive* brightness
   * average, which is not the formula a contrast ratio is defined by — and it
   * got the default "Stop" column wrong: rose #F43F5E was called dark, so the
   * text went white at 3.67:1 when near-black would have given 4.86:1.
   */
  it('picks whichever of the two actually reads better', () => {
    for (const background of ['#10B981', '#F43F5E', '#059669', '#64748B', '#FFFFFF', '#000000']) {
      const chosen = bestTextColorOn(background);
      const other = chosen === '#FFFFFF' ? '#000000' : '#FFFFFF';

      expect(
        contrastRatio(chosen, background),
        `${background} chose ${chosen}`
      ).toBeGreaterThanOrEqual(contrastRatio(other, background));
    }
  });

  it('clears WCAG AA on every colour the picker offers', () => {
    // sky-600 is the one that made "the better of two" insufficient: near-black
    // gave 4.36:1 against white's 4.10:1, so the better of the pair still
    // failed. Black clears it at 5.13:1 (Codex, PR #436).
    const PICKER_COLOURS = [
      '#dc2626', '#e11d48', '#db2777', '#c026d3', '#9333ea', '#7c3aed',
      '#4f46e5', '#2563eb', '#0284c7', '#0891b2', '#0d9488', '#059669',
      '#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#475569'
    ];

    for (const background of [...PICKER_COLOURS, '#10B981', '#F43F5E', '#64748B']) {
      expect(
        contrastRatio(bestTextColorOn(background), background),
        `${background} → ${bestTextColorOn(background)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('clears the floor for **every** colour, not only the ones we listed', () => {
    // The guarantee, stated as a property rather than as examples: black clears
    // 4.5:1 above luminance 0.175 and white below 0.183, and those ranges
    // overlap — so one of the two always works. A sweep of the whole cube is
    // what proves the claim `ACCESSIBILITY.md` makes.
    const worst: { background: string; ratio: number }[] = [];
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const background = `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
          const ratio = contrastRatio(bestTextColorOn(background), background);
          if (ratio < 4.5) worst.push({ background, ratio });
        }
      }
    }

    expect(worst).toEqual([]);
  });

  it('falls back to black when handed something that is not a colour', () => {
    expect(bestTextColorOn('not-a-colour')).toBe('#000000');
  });
});
