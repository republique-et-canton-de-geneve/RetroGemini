import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parsedColor, themeBlocks, tokenContrast } from './helpers/tailwindTheme';

/**
 * The look (45.0) lives in the `@theme` block of index.css: the components keep
 * their Tailwind classes and that block gives the tokens their values. Each
 * token has a job, and this file states the job as a measured pair, with
 * axe-core's engine, so a value retuned by eye fails here rather than on the
 * one screen where it mattered. The dark pairs are the ones a light-screen
 * sweep breaks (AGENTS.md, "a contrast fix is directional").
 */

const CSS = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');
const TEXT = 4.5;
const EDGE = 3;

const luminance = (token: string): number => {
  const { red, green, blue } = parsedColor(token);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
};

const STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const PERSON_HUES = ['indigo', 'emerald', 'amber', 'rose', 'cyan', 'fuchsia', 'lime', 'pink', 'neutral'];

describe('the look defines its own neutral and brand scales', () => {
  it.each(['slate', 'indigo'])('%s: every step, defined in index.css, from light to dark', (hue) => {
    const declared = themeBlocks(CSS).join('\n');
    for (const step of STEPS) expect(declared, `--color-${hue}-${step}`).toMatch(new RegExp(`--color-${hue}-${step}:\\s*#[0-9a-f]{6};`));
    const lights = STEPS.map((step) => luminance(`${hue}-${step}`));
    for (let i = 1; i < lights.length; i += 1) expect(lights[i], `${hue}-${STEPS[i]} is darker than ${hue}-${STEPS[i - 1]}`).toBeLessThan(lights[i - 1]);
  });
});

describe('text on the light surfaces', () => {
  // Muted text is slate-500 on white cards, on the page (50), on panels (100)
  // and on the brand tint of the reader's own row (indigo-50 and -100).
  it.each(['white', 'slate-50', 'slate-100', 'indigo-50', 'indigo-100'])('slate-500 reads on %s', (surface) => {
    expect(tokenContrast('slate-500', surface)).toBeGreaterThanOrEqual(TEXT);
  });

  it.each(['slate-600', 'slate-700', 'slate-800', 'slate-900'])('%s reads on every light surface, lines included', (ink) => {
    for (const surface of ['white', 'slate-50', 'slate-100', 'slate-200', 'indigo-50', 'indigo-100']) {
      expect(tokenContrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it.each(['indigo-600', 'indigo-700', 'indigo-800'])('%s reads as text and links on white and on the brand tints', (ink) => {
    for (const surface of ['white', 'slate-50', 'slate-100', 'indigo-50', 'indigo-100']) {
      expect(tokenContrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(TEXT);
    }
  });
});

describe('text on filled and dark surfaces', () => {
  it.each(['indigo-500', 'indigo-600', 'indigo-700', 'indigo-800', 'slate-600', 'slate-700', 'slate-800', 'slate-900'])('white reads on %s', (surface) => {
    expect(tokenContrast('white', surface)).toBeGreaterThanOrEqual(TEXT);
  });

  // The Icebreaker and Close screens are dark: their muted text is slate-200 and -300.
  // (slate-400 has the opposite job, an edge on the light surfaces: no value does both.)
  it.each(['slate-200', 'slate-300'])('%s reads on the dark screens', (ink) => {
    for (const surface of ['slate-800', 'slate-900', 'slate-950']) {
      expect(tokenContrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('the light brand steps read on the dark screens', () => {
    for (const ink of ['indigo-200', 'indigo-300']) {
      for (const surface of ['slate-800', 'slate-900']) {
        expect(tokenContrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(TEXT);
      }
    }
  });
});

describe("what draws a control's edge or a state", () => {
  it('slate-400 draws an edge on white and on the page', () => {
    expect(tokenContrast('slate-400', 'white')).toBeGreaterThanOrEqual(EDGE);
    expect(tokenContrast('slate-400', 'slate-50')).toBeGreaterThanOrEqual(EDGE);
  });

  it('the brand draws a focus ring on every light surface', () => {
    for (const surface of ['white', 'slate-50', 'slate-100', 'indigo-100']) {
      expect(tokenContrast('indigo-600', surface), `indigo-600 on ${surface}`).toBeGreaterThanOrEqual(EDGE);
    }
  });
});

describe("a person's tone", () => {
  it.each(PERSON_HUES)('%s: initials read on the body, and the ink reads where dots and names are drawn', (hue) => {
    expect(tokenContrast(`person-${hue}-ink`, `person-${hue}`), 'initials').toBeGreaterThanOrEqual(TEXT);
    for (const surface of ['white', 'slate-50', 'indigo-100']) {
      expect(tokenContrast(`person-${hue}-ink`, surface), `ink on ${surface}`).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('gives each of the eight people a body the others do not have', () => {
    const bodies = PERSON_HUES.map((hue) => parsedColor(`person-${hue}`).toHexString());
    expect(new Set(bodies).size).toBe(PERSON_HUES.length);
  });
});

describe('one source for a colour', () => {
  // Until 45.0 index.css repeated Tailwind's indigo and slate as hex in its own
  // rules: remapping the tokens would have left two brand colours on screen.
  it('index.css names no colour of the old palette outside its tokens', () => {
    const outsideTheme = themeBlocks(CSS).reduce((css, block) => css.replace(block, ''), CSS);
    for (const old of ['#4f46e5', '#4338ca', '#6366f1', '#eef2ff', '#f8fafc', '#cbd5e1', '#0f172a']) {
      expect(outsideTheme.toLowerCase(), `index.css still paints ${old}`).not.toContain(old);
    }
  });

  // A copy of a token's value is a second source too, whatever it is written
  // in: `rgb(79 63 240 / 0.4)` under a primary button is the brand colour of
  // the day it was written, and stays so when the token is retuned. Outside the
  // tokens a colour is a `var(--color-…)`, mixed with `color-mix` when it must
  // be translucent; only pure white and pure black are written as they are.
  it('index.css writes no colour of its own outside its tokens', () => {
    const outsideTheme = themeBlocks(CSS).reduce((css, block) => css.replace(block, ''), CSS).replace(/\/\*[\s\S]*?\*\//g, '');
    const written = [
      ...outsideTheme.matchAll(/#[0-9a-fA-F]{3,8}\b/g),
      ...outsideTheme.matchAll(/rgba?\([^)]*\)/g),
      ...outsideTheme.matchAll(/hsla?\([^)]*\)/g),
    ].map((match) => match[0]);
    const pure = (colour: string) =>
      /^#(?:f{3,4}|f{6}(?:[0-9a-f]{2})?|0{3,4}|0{6}(?:[0-9a-f]{2})?)$/i.test(colour) ||
      /^rgba?\(\s*(?:255[\s,]+255[\s,]+255|0[\s,]+0[\s,]+0)\b/.test(colour);
    expect(written.filter((colour) => !pure(colour))).toEqual([]);
  });

  // The test above cannot see inside @theme: 45.0 kept five `retro-*` aliases
  // there as hex copies of slate and indigo, four painted by nothing and the
  // fifth by the body alone, so a retune of slate-50 would have left the body
  // (what shows before React draws, and past an overscroll) on the old page.
  it('paints the page from slate-50 itself, and keeps no retro-* copy of the palette', () => {
    expect(CSS).toMatch(/\bbody\s*\{[^}]*\bbackground-color:\s*var\(--color-slate-50\);/);
    expect(themeBlocks(CSS).join('\n')).not.toMatch(/--color-retro-/);
  });

  it('serves every font from this deployment', () => {
    const sources = [...CSS.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(source, source).toMatch(/^\/fonts\/[a-z0-9-]+\.woff2$/);
  });

  // The SIL Open Font License asks that its text travels with the fonts.
  it('ships the licence of the typefaces beside their files', () => {
    const fonts = join(__dirname, '..', 'public', 'fonts');
    const licence = readFileSync(join(fonts, 'OFL-Geist.txt'), 'utf8');
    expect(licence).toContain('SIL OPEN FONT LICENSE Version 1.1');
    expect(licence).toMatch(/Geist-Italic\[wght\]\.ttf/);
    expect(licence).toMatch(/GeistMono-Italic\[wght\]\.ttf/);
    const served = [...CSS.matchAll(/url\(\s*['"]?\/fonts\/([a-z0-9-]+\.woff2)/g)].map((match) => match[1]);
    for (const file of served) expect(readFileSync(join(fonts, file)).subarray(0, 4).toString('latin1'), file).toBe('wOF2');
  });

  // An effect that ends on a transform kept by its fill mode would make its
  // element the containing block of every fixed child for good (a dialog).
  it('keeps no transform after an effect has run', () => {
    const rules = [...CSS.matchAll(/\.fx-[a-z-]+\s*\{[^}]*\}/g)].map((match) => match[0]);
    expect(rules.length).toBeGreaterThan(5);
    for (const rule of rules) expect(rule, rule).not.toMatch(/animation:[^;]*\b(?:forwards|both)\b/);
  });

  it('declares every effect only for readers who did not ask for less motion', () => {
    const start = CSS.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(-1);
    const before = CSS.slice(0, start);
    expect(before).not.toMatch(/\.fx-(?!layer|token)[a-z-]+\s*(?:::?[a-z]+)?\s*\{/);
    expect(before).not.toMatch(/@keyframes fx-/);
  });
});

/**
 * A control that shrinks, grows or shifts while it is pressed moves its own
 * edge from under the pointer. Pressed on its outer pixel, the release lands
 * beside it, the browser sends the click to the ancestor both events share,
 * and the control does nothing: 45.0 was first written with
 * `active:scale-[0.97]` on every primary button, and a held press on the
 * outer pixel of "New Team" clicked the page behind it. A press answers with a
 * colour, never with its box.
 */
describe('a press never moves the control pressed', () => {
  const ROOT = join(__dirname, '..');
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(name)) out.push(path);
    }
    return out;
  };

  /** A class's variants and its utility: `motion-safe:active:scale-[0.97]` is two variants and `scale-[0.97]`. */
  const parts = (token: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of token) {
      if (char === '[') depth += 1;
      if (char === ']') depth = Math.max(0, depth - 1);
      if (char === ':' && depth === 0) {
        out.push(current);
        current = '';
      } else current += char;
    }
    out.push(current);
    return out;
  };

  /** Utilities that change where an element's edge is: a transform, a size, a spacing, an edge's width, the size of its words. */
  const movesBox = (utility: string): boolean =>
    /^-?(?:scale|translate|rotate|skew)(?:-|$)/.test(utility) ||
    /^-?(?:[whpm]|[pm][xytrblse]|size|min-[wh]|max-[wh]|inset(?:-[xy])?|top|right|bottom|left|gap(?:-[xy])?)-/.test(utility) ||
    /^border(?:-[xytrblse])?(?:-(?:\d|\[\d)|$)/.test(utility) ||
    /^(?:text-(?:xs|sm|base|lg|\d?xl|\[\d)|leading-|tracking-|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$)/.test(utility);

  const pressMoves = (text: string): string[] =>
    (text.match(/[^\s"'`]+/g) ?? []).filter((token) => {
      const split = parts(token);
      const utility = split[split.length - 1].replace(/!$/, '').replace(/^!/, '');
      return split.slice(0, -1).includes('active') && movesBox(utility);
    });

  /** Rules of a stylesheet that change a box while `:active` holds. */
  const pressRules = (css: string): string[] =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]*:active[^{}]*)\{([^{}]*)\}/g)]
      .filter((match) => /(?:^|[;\s])(?:transform|scale|translate|rotate|width|height|padding|margin|inset|top|right|bottom|left|font-size|font-weight|border-width)\s*:/.test(match[2]))
      .map((match) => match[1].trim());

  it('no class of the components moves a box on a press', () => {
    const files = [...walk(join(ROOT, 'components')), join(ROOT, 'App.tsx')];
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap((file) => pressMoves(readFileSync(file, 'utf8')).map((token) => `${relative(ROOT, file)}: ${token}`));
    expect(found).toEqual([]);
  });

  it('no rule of index.css moves a box on a press', () => {
    expect(pressRules(CSS)).toEqual([]);
  });

  it('reads a press that moves a box, whatever stands before it, and leaves a press that changes a colour', () => {
    expect(pressMoves('rounded-lg motion-safe:active:scale-[0.97] transition')).toEqual(['motion-safe:active:scale-[0.97]']);
    expect(pressMoves("'active:translate-y-px sm:active:-translate-y-0.5 active:scale-95'")).toHaveLength(3);
    expect(pressMoves('active:px-5 active:border-2 active:text-sm active:font-bold active:h-9 active:[&>span]:scale-90')).toHaveLength(6);
    expect(pressMoves('active:bg-indigo-800 active:text-slate-900 active:border-indigo-700 active:shadow-none active:opacity-90 active:ring-2')).toEqual([]);
    // Without the press, the same utilities are the element's ordinary box.
    expect(pressMoves('scale-95 hover:scale-105 px-5 border-2 group-active:scale-95')).toEqual([]);
    expect(pressRules('.a:active { transform: scale(0.97); } .b:active { background: var(--color-indigo-800); } .c { transform: none; }')).toEqual(['.a:active']);
  });
});
