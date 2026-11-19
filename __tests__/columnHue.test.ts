import { describe, expect, it } from 'vitest';
import { COLUMN_CLASS_HUES, columnHue } from '../utils/columnHue';
import { cardTones } from '../utils/cardTones';

const column = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  title: 'Start',
  color: '',
  border: '',
  icon: 'play_arrow',
  text: '',
  ring: '',
  ...overrides,
});

describe('columnHue', () => {
  it('takes the stored colour when it is a six-digit hex, in any case', () => {
    expect(columnHue(column({ customColor: '#059669', color: 'bg-rose-50' }))).toBe('#059669');
    expect(columnHue(column({ customColor: '#10B981' }))).toBe('#10b981');
  });

  it('reads a short hex as the six-digit colour it stands for', () => {
    expect(columnHue(column({ customColor: '#0A5' }))).toBe('#00aa55');
    expect(columnHue(column({ customColor: '#fff' }))).toBe('#ffffff');
  });

  // Custom templates created by older releases hold classes only (decision D15).
  it.each(Object.entries(COLUMN_CLASS_HUES))('reads the %s hue from a column that holds classes only', (hue, hex) => {
    expect(columnHue(column({ color: `bg-${hue}-50`, border: `border-${hue}-400`, text: `text-${hue}-700` }))).toBe(hex);
    // Any of the three classes is enough, the background first.
    expect(columnHue(column({ text: `text-${hue}-700` }))).toBe(hex);
    expect(columnHue(column({ color: `bg-${hue}-100`, text: 'text-slate-700' }))).toBe(hex);
    // Every hue of the table gives a card its tones.
    expect(cardTones(hex)).not.toBeNull();
  });

  it('falls back to the classes when the stored colour is not a hex', () => {
    expect(columnHue(column({ customColor: 'red', color: 'bg-emerald-50' }))).toBe(COLUMN_CLASS_HUES.emerald);
    expect(columnHue(column({ customColor: '#12345', color: 'bg-rose-50' }))).toBe(COLUMN_CLASS_HUES.rose);
  });

  it('gives no hue for junk or nothing, so the card stays white', () => {
    expect(columnHue(column())).toBeNull();
    expect(columnHue(column({ customColor: 'url(x)', color: 'bg-white', text: 'text-black' }))).toBeNull();
    expect(columnHue(column({ color: 'bg-unicorn-50', text: 'fixed inset-0 z-50' }))).toBeNull();
    expect(columnHue(column({ color: 'xbg-rose-50' }))).toBeNull();
    expect(columnHue(null)).toBeNull();
    expect(columnHue(undefined)).toBeNull();
    // Data written by any client: a field of the wrong type is ignored, never thrown on.
    expect(columnHue(column({ customColor: 42, color: { x: 1 }, text: null }) as never)).toBeNull();
  });

  it('writes nothing back to the column', () => {
    const stored = column({ color: 'bg-amber-50' });
    const before = JSON.stringify(stored);
    columnHue(stored);
    expect(JSON.stringify(stored)).toBe(before);
  });
});
