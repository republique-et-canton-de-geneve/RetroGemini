import { contrastRatio, hexToRgb, rgbToHex } from './colorUtils';

/**
 * The colours a card takes from its column (or, with "Colour by author", from
 * its author).
 *
 * A column's colour is **data**: a hex the facilitator picked, stored on the
 * column of every retrospective and template, and nothing rewrites it. Until
 * 45.0 a card was painted in that saturated colour with black or white text.
 * It now takes a light tint of it with the look's dark ink, so the same stored
 * colour gives a readable card whatever was picked: every pair below is
 * measured for any hex by `__tests__/cardTones.test.ts`.
 */
export interface CardTones {
  /** The card's background. */
  tint: string;
  /** A stronger tint of the same hue: the tile behind a column's icon. */
  tintStrong: string;
  /** The card's border. */
  line: string;
  /** The hue darkened until it reads as text on both tints: counts, small icons. */
  ink: string;
}

/** The look's ink (slate-900 in `index.css`): a card's words, on every tint. */
export const CARD_INK = '#171a2b';

const WHITE = { r: 255, g: 255, b: 255 };

/** How much of the hue each tone holds; the rest is white. */
const TINT_SHARE = 0.12;
const TINT_STRONG_SHARE = 0.22;
const LINE_SHARE = 0.36;

/**
 * What the coloured ink must reach on the stronger tint. Above the 4.5:1 floor
 * on purpose: it writes the smallest text of a card.
 */
const INK_TARGET = 5.5;

type Rgb = { r: number; g: number; b: number };

const mix = (a: Rgb, b: Rgb, shareOfA: number): string =>
  rgbToHex(
    a.r * shareOfA + b.r * (1 - shareOfA),
    a.g * shareOfA + b.g * (1 - shareOfA),
    a.b * shareOfA + b.b * (1 - shareOfA),
  );

const HEX_COLOUR = /^#?[0-9a-f]{6}$/i;

/**
 * The answers already computed, by colour as it was asked. Every card asks at
 * every draw, and an answer searches up to a hundred candidate inks: on a
 * board of a thousand cards that was about 50 ms of each draw. A session
 * shows a handful of colours (its columns, or the eight people), so the same
 * few answers are handed out again; any hex can be picked, so the memory is
 * bounded and emptied when it is full.
 */
const KNOWN_TONES = new Map<string, Readonly<CardTones>>();
const KNOWN_TONES_MAX = 256;

/**
 * The tones of a card for one stored colour, or `null` for a value that is not
 * a six-digit hex: the caller then draws the default white card. The answer is
 * shared and frozen: read it, never edit it.
 */
export function cardTones(colour: string | null | undefined): Readonly<CardTones> | null {
  if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) return null;
  const known = KNOWN_TONES.get(colour);
  if (known) return known;
  const tones = computeTones(colour);
  if (!tones) return null;
  if (KNOWN_TONES.size >= KNOWN_TONES_MAX) KNOWN_TONES.clear();
  KNOWN_TONES.set(colour, tones);
  return tones;
}

function computeTones(colour: string): Readonly<CardTones> | null {
  const hue = hexToRgb(colour);
  if (!hue) return null;

  const tint = mix(hue, WHITE, TINT_SHARE);
  const tintStrong = mix(hue, WHITE, TINT_STRONG_SHARE);
  const line = mix(hue, WHITE, LINE_SHARE);

  // As much of the hue as still reads on the stronger tint (the darker of the
  // two, so the lighter one follows). At no hue at all it is the neutral ink,
  // which reads on any tint, so the search always ends.
  const neutral = hexToRgb(CARD_INK) as Rgb;
  let ink = CARD_INK;
  for (let percent = 100; percent >= 0; percent -= 1) {
    const candidate = mix(hue, neutral, percent / 100);
    if (contrastRatio(candidate, tintStrong) >= INK_TARGET) {
      ink = candidate;
      break;
    }
  }

  return Object.freeze({ tint, tintStrong, line, ink });
}
