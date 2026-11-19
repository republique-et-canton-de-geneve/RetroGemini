import type { Column } from '../types';

/**
 * The hue of a column: what its cards, its icon tile and its add field are
 * tinted with (`utils/cardTones.ts`).
 *
 * A column's colour is data. Columns written since custom colours exist carry
 * a hex in `customColor`; custom templates saved by older releases carry only
 * Tailwind classes (`bg-emerald-50`, `text-emerald-700`), and they would draw
 * white cards if only the hex were read (decision D15). Their hue is read here,
 * at render time, through a fixed table; nothing is written back.
 */

/**
 * One colour per Tailwind hue: the 600 step of the stock palette, the step the
 * column colour picker offers. Fixed here rather than read from the theme: the
 * look redefines slate and indigo, and a stored class must keep naming the hue
 * it was written with.
 */
export const COLUMN_CLASS_HUES: Readonly<Record<string, string>> = {
  red: '#dc2626',
  orange: '#ea580c',
  amber: '#d97706',
  yellow: '#ca8a04',
  lime: '#65a30d',
  green: '#16a34a',
  emerald: '#059669',
  teal: '#0d9488',
  cyan: '#0891b2',
  sky: '#0284c7',
  blue: '#2563eb',
  indigo: '#4f46e5',
  violet: '#7c3aed',
  purple: '#9333ea',
  fuchsia: '#c026d3',
  pink: '#db2777',
  rose: '#e11d48',
  slate: '#475569',
  gray: '#4b5563',
  zinc: '#52525b',
  neutral: '#525252',
  stone: '#57534e',
};

const LONG_HEX = /^#([0-9a-f]{6})$/i;
const SHORT_HEX = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HUE_CLASS = /^(?:bg|text|border)-([a-z]+)-\d{2,3}$/;

const hexOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const long = LONG_HEX.exec(value);
  if (long) return `#${long[1].toLowerCase()}`;
  const short = SHORT_HEX.exec(value);
  if (short) return `#${short.slice(1).map((digit) => digit + digit).join('')}`.toLowerCase();
  return null;
};

const hueOfClasses = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  for (const token of value.split(/\s+/)) {
    const match = HUE_CLASS.exec(token);
    if (match && Object.prototype.hasOwnProperty.call(COLUMN_CLASS_HUES, match[1])) return COLUMN_CLASS_HUES[match[1]];
  }
  return null;
};

/**
 * The column's hue as a lower-case `#rrggbb`: its stored hex, else the hue its
 * classes name (the background first, then the border, then the text), else
 * `null` for a white card.
 */
export function columnHue(column: Pick<Column, 'customColor' | 'color' | 'border' | 'text'> | null | undefined): string | null {
  if (!column) return null;
  return hexOf(column.customColor)
    ?? hueOfClasses(column.color)
    ?? hueOfClasses(column.border)
    ?? hueOfClasses(column.text);
}
