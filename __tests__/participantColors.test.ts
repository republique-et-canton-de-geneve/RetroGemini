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
  effectivePair,
  mergeThemeColors,
  pairContrast,
  parsedColor,
  themeBlocks,
  themeValue,
  tokenContrast,
  unmeasurableColor,
} from './helpers/tailwindTheme';

/**
 * A participant's colour is a Tailwind class, and white initials on it failed
 * WCAG 1.4.3 on seven of the eight palette colours (lime at 1.96:1). Only the
 * facilitator's indigo passed, which is why ten audited single-user screens
 * never saw it.
 *
 * Every pair below is measured from the files the build reads (Tailwind's
 * `theme.css`, then the `@theme` blocks of `index.css`) with axe-core's own
 * colour engine — the gate's numbers, not a copy of them — so a Tailwind bump
 * or a token redefined by the application fails here, at build time, before
 * the e2e audit or a user finds it.
 */

const REPO_ROOT = join(__dirname, '..');
const FLOOR = 4.5;

describe('the measuring helper', () => {
  it('measures with the axe-core copy the e2e gate injects', () => {
    const { measuredWith, injectedByGate } = axeCopies();
    expect(measuredWith).toBe(injectedByGate);
  });

  // Pinned on tokens the application does not redefine: Tailwind's own values.
  it('reads the theme and measures as axe does (a pin on the file and the engine)', () => {
    expect(parsedColor('lime-500').toHexString()).toBe('#7ccf00');
    expect(tokenContrast('white', 'rose-600')).toBeCloseTo(4.51, 3);
    expect(tokenContrast('black', 'lime-500')).toBeCloseTo(10.74, 3);
  });

  it('measures a token the application redefines at the application\'s value', () => {
    expect(parsedColor('indigo-600').toHexString()).toBe('#4f3ff0');
    expect(parsedColor('slate-900').toHexString()).toBe('#171a2b');
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

  it('knows the application\'s own tokens, not only Tailwind\'s', () => {
    expect(classColor('bg-retro-primary text-white', 'bg')).toBe('retro-primary');
  });

  // Until 45.0 the helper read Tailwind's file alone: a colour the application
  // redefined was painted by the browser and measured at its old value.
  describe('reading a theme', () => {
    const stock = '@theme default { --color-white: #fff; --color-slate-500: oklch(55.4% 0.046 257.417); --color-slate-600: #475569; --color-rose-500: #f00; }';

    it('lets a later @theme declaration win, as the build does', () => {
      const colors = mergeThemeColors(stock, '@theme { --color-slate-500: #676c85; }\n@theme inline { --color-slate-500: #111111; }');
      expect(colors.get('slate-500')).toBe('#111111');
      expect(colors.get('slate-600')).toBe('#475569');
    });

    it('adds the application\'s named tokens and follows a reference to another token', () => {
      const colors = mergeThemeColors(stock, '@theme { --color-brand: var(--color-slate-600); --color-person-indigo-ink: #3a2fc0; }');
      expect(colors.get('brand')).toBe('#475569');
      expect(colors.get('person-indigo-ink')).toBe('#3a2fc0');
    });

    it('removes what the application resets', () => {
      expect(mergeThemeColors(stock, '@theme { --color-slate-*: initial; }').has('slate-500')).toBe(false);
      expect([...mergeThemeColors(stock, '@theme { --color-*: initial; --color-ink: #171a2b; }').keys()]).toEqual(['ink']);
    });

    it('reads a declaration only inside an @theme block, keyframes inside it included', () => {
      const css = ':root { --color-slate-500: #000; }\n@theme {\n  --color-slate-500: #676c85;\n  @keyframes pop { 0% { transform: scale(0); } }\n  --color-rose-500: #e5484d;\n}\n.x { --color-rose-500: #000; }';
      expect(themeBlocks(css)).toHaveLength(1);
      const colors = mergeThemeColors(stock, css);
      expect(colors.get('slate-500')).toBe('#676c85');
      expect(colors.get('rose-500')).toBe('#e5484d');
    });

    it('refuses a reference it cannot follow', () => {
      expect(() => mergeThemeColors(stock, '@theme { --color-brand: var(--color-nowhere); }')).toThrow(/cannot resolve/);
    });
  });

  // A colour skipped is how a wrong pair passes: the text was then measured
  // against whatever lay further up, or against white.
  describe('a colour it cannot name', () => {
    it('is told apart from a size or an alignment', () => {
      expect(unmeasurableColor('text-[9px] text-center text-xs', 'text')).toBeNull();
      expect(unmeasurableColor('bg-black/10', 'bg')).toBeNull();
      expect(unmeasurableColor('text-slate-900/60', 'text')).toBe('text-slate-900/60');
      expect(unmeasurableColor('bg-[#4f3ff0]', 'bg')).toBe('bg-[#4f3ff0]');
      expect(unmeasurableColor('bg-(--card-tint)', 'bg')).toBe('bg-(--card-tint)');
      expect(unmeasurableColor('bg-linear-to-r from-indigo-600', 'bg')).toBe('bg-linear-to-r');
      expect(unmeasurableColor('text-transparent bg-clip-text', 'text')).toBe('text-transparent');
      expect(unmeasurableColor('hover:bg-black/10 bg-white', 'bg')).toBeNull();
    });

    const tree = (outer: string, inner: string) => {
      const parent = document.createElement('div');
      parent.className = outer;
      const child = document.createElement('span');
      child.className = inner;
      parent.append(child);
      return child;
    };

    it('stops the measurement where it is the nearest background', () => {
      expect(() => effectivePair(tree('bg-[#4f3ff0]', 'text-white'))).toThrow(/bg-\[#4f3ff0\], which cannot be measured/);
      expect(() => effectivePair(tree('bg-linear-to-r from-slate-50 to-white', 'text-slate-900'))).toThrow(/cannot be measured/);
      expect(() => effectivePair(tree('bg-white', 'text-slate-900/60'))).toThrow(/cannot be measured/);
    });

    // A done row is `bg-green-50/50`: skipped, its controls were measured on white.
    it('blends a translucent background over the one behind it', () => {
      const onWhite = effectivePair(tree('bg-white', 'text-slate-500'));
      const veiled = effectivePair(tree('bg-white', 'bg-black/10 text-slate-500'));
      expect(veiled.bg).toBe('black/10 over white');
      expect(veiled.ratio).toBeLessThan(onWhite.ratio);
      const half = effectivePair(tree('bg-slate-900', 'bg-white/50 text-black'));
      const full = effectivePair(tree('bg-slate-900', 'bg-white text-black'));
      expect(half.bg).toBe('white/50 over slate-900');
      expect(half.ratio).toBeLessThan(full.ratio);
      expect(half.ratio).toBeGreaterThan(1);
    });

    it('does not matter behind a background the text really sits on', () => {
      expect(effectivePair(tree('bg-linear-to-r from-slate-50 to-white', 'bg-white text-slate-900')).bg).toBe('white');
    });
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
  // The helper reads colour tokens from the `@theme` blocks of index.css. One
  // declared anywhere else in that file (a `:root` rule, a class) would be
  // painted by the browser and never measured.
  it('index.css declares colour tokens only inside its @theme blocks', () => {
    const css = readFileSync(join(REPO_ROOT, 'index.css'), 'utf8');
    const declared = (text: string) => [...text.matchAll(/--color-[A-Za-z0-9-]+\s*:/g)].length;
    const inTheme = themeBlocks(css).reduce((sum, block) => sum + declared(block), 0);
    expect(declared(css)).toBe(inTheme);
    expect(inTheme).toBeGreaterThan(0);
  });

  it('measures every token index.css defines at the value index.css gives it', () => {
    const css = readFileSync(join(REPO_ROOT, 'index.css'), 'utf8');
    const own = new Map<string, string>();
    for (const block of themeBlocks(css)) {
      for (const match of block.matchAll(/--color-([A-Za-z0-9-]+):\s*([^;]+);/g)) own.set(match[1], match[2].trim());
    }
    for (const [token, value] of own) {
      if (value.startsWith('var(')) continue;
      expect(themeValue(token), `--color-${token}`).toBe(value);
    }
  });
});
