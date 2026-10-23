import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PARTICIPANT_PALETTE,
  UNKNOWN_PARTICIPANT_COLOR,
  DEPARTED_AVATAR_CLASSES,
  avatarColorClasses,
  isParticipantColor,
  participantColorClass,
} from '../utils/participantColors';
import { HEALTH_RATING_BADGE } from '../utils/healthRatingColors';
import {
  axeCopies,
  classColor,
  pairContrast,
  parsedColor,
  themeValue,
  tokenContrast,
} from './helpers/tailwindTheme';

/**
 * A participant's colour is a Tailwind class, and white initials on it failed
 * WCAG 1.4.3 on seven of the eight palette colours (lime at 1.96:1). Only the
 * facilitator's indigo passed, which is why ten audited single-user screens
 * never saw it.
 *
 * Every pair below is measured from `node_modules/tailwindcss/theme.css` with
 * axe-core's own colour engine — the gate's numbers, not a copy of them — so a
 * Tailwind bump that moves a colour fails here, at build time, before the
 * e2e audit or a user finds it.
 */

const REPO_ROOT = join(__dirname, '..');
const FLOOR = 4.5;

describe('the measuring helper', () => {
  it('measures with the axe-core copy the e2e gate injects', () => {
    const { measuredWith, injectedByGate } = axeCopies();
    expect(measuredWith).toBe(injectedByGate);
  });

  it('reads the theme and measures as axe does (a pin on the file and the engine)', () => {
    expect(parsedColor('lime-500').toHexString()).toBe('#7ccf00');
    expect(tokenContrast('white', 'indigo-500')).toBeCloseTo(4.577, 3);
  });

  it('paints text-black and text-white as exactly #000 and #fff', () => {
    expect(themeValue('black')).toBe('#000');
    expect(themeValue('white')).toBe('#fff');
  });

  it('reads colour tokens only, and refuses two of a kind', () => {
    expect(classColor('w-8 text-xs text-white font-bold', 'text')).toBe('white');
    expect(classColor('text-[9px] text-center hover:text-black', 'text')).toBeNull();
    expect(classColor('bg-black/50 bg-linear-to-r', 'bg')).toBeNull();
    expect(() => classColor('text-white text-black', 'text')).toThrow(/2 text colours/);
  });
});

/** Rule A1: white when white clears the floor, otherwise the better of the two. */
const ruleA1 = (bgToken: string): 'text-white' | 'text-black' => {
  if (tokenContrast('white', bgToken) >= FLOOR) return 'text-white';
  return tokenContrast('black', bgToken) > tokenContrast('white', bgToken) ? 'text-black' : 'text-white';
};

const bgToken = (className: string) => {
  const token = classColor(className, 'bg');
  if (!token) throw new Error(`no background in "${className}"`);
  return token;
};

describe('participant avatars', () => {
  it.each(PARTICIPANT_PALETTE.map((color) => [color]))('%s: the initials clear 4.5:1', (color) => {
    expect(pairContrast(avatarColorClasses(color))).toBeGreaterThanOrEqual(FLOOR);
  });

  it.each(PARTICIPANT_PALETTE.map((color) => [color]))('%s: the initials colour follows the rule', (color) => {
    expect(classColor(avatarColorClasses(color), 'text')).toBe(ruleA1(bgToken(color)).replace(/^text-/, ''));
  });

  it('keeps white on the facilitator\'s indigo, the one colour where white passes', () => {
    expect(avatarColorClasses('bg-indigo-500')).toBe('bg-indigo-500 text-white');
  });

  it.each([[undefined], [null], [''], ['bg-sky-500'], ['fixed inset-0 z-50'], ['bg-lime-500 text-white']])(
    'renders %j as the neutral fallback, and nothing else',
    (value) => {
      const classes = avatarColorClasses(value as string | null | undefined);
      expect(classes).toBe(`${UNKNOWN_PARTICIPANT_COLOR} text-white`);
      expect(pairContrast(classes)).toBeGreaterThanOrEqual(FLOOR);
      expect(participantColorClass(value as string | null | undefined)).toBe(UNKNOWN_PARTICIPANT_COLOR);
      expect(isParticipantColor(value)).toBe(false);
    },
  );

  it('passes a palette colour through to the non-text dots unchanged', () => {
    for (const color of PARTICIPANT_PALETTE) expect(participantColorClass(color)).toBe(color);
  });

  it('draws a departed participant in a neutral pair that clears 4.5:1', () => {
    expect(pairContrast(DEPARTED_AVATAR_CLASSES)).toBeGreaterThanOrEqual(FLOOR);
    expect(DEPARTED_AVATAR_CLASSES).not.toMatch(/opacity|grayscale/);
  });

  it('is the palette the server hands the facilitator', () => {
    for (const file of ['server/routes/teamRoutes.js', 'server/services/teamMerge.js']) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      const literals = [...source.matchAll(/\bcolor:\s*'([^']*)'/g)].map((match) => match[1]);
      expect(literals.length, `${file} writes a colour`).toBeGreaterThan(0);
      for (const literal of literals) expect(PARTICIPANT_PALETTE as readonly string[], `${file}: ${literal}`).toContain(literal);
    }
  });
});

describe('the health-check score tooltip', () => {
  it.each(Object.entries(HEALTH_RATING_BADGE))('rating %s: the digit clears 4.5:1 with the better of black and white', (_rating, badge) => {
    const bg = bgToken(badge.bg);
    const text = classColor(badge.text, 'text');
    expect(text).not.toBeNull();
    expect(tokenContrast(text as string, bg)).toBeGreaterThanOrEqual(FLOOR);
    const better = tokenContrast('black', bg) >= tokenContrast('white', bg) ? 'black' : 'white';
    expect(text).toBe(better);
  });

  it('covers the five ratings', () => {
    expect(Object.keys(HEALTH_RATING_BADGE).sort()).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('what is measured is what is painted', () => {
  it('index.css redefines none of the measured tokens, so theme.css is what the build paints', () => {
    const css = readFileSync(join(REPO_ROOT, 'index.css'), 'utf8');
    const measured = new Set<string>(['white', 'black', 'slate-200', 'slate-600', 'slate-700']);
    for (const color of PARTICIPANT_PALETTE) measured.add(bgToken(color));
    for (const badge of Object.values(HEALTH_RATING_BADGE)) measured.add(bgToken(badge.bg));
    for (const token of measured) expect(css, `index.css redefines --color-${token}`).not.toContain(`--color-${token}:`);
  });
});
