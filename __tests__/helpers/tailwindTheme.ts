import axe from 'axe-core';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

/**
 * What a Tailwind colour class *paints*, measured the way the e2e gate measures
 * it.
 *
 * Two copies of the truth are what this helper exists to avoid. The colours
 * come from `node_modules/tailwindcss/theme.css`, the file the build reads, so
 * a Tailwind bump that moves a colour moves the measurement with it. And the
 * contrast is computed by **axe-core's own colour engine** (`axe.commons.color`,
 * the copy `@axe-core/playwright` injects into the browser), which converts an
 * `oklch()` value to sRGB and clips it to gamut before measuring. A hand-written
 * OKLab converter, or a ratio taken from a rounded `#rrggbb`, can disagree with
 * the gate by about 0.02 — on exactly the pairs that sit at 4.51 or 4.58.
 *
 * Test-only: nothing in the product measures colour at runtime.
 */

const REPO_ROOT = join(__dirname, '..', '..');
const THEME_PATH = join(REPO_ROOT, 'node_modules', 'tailwindcss', 'theme.css');

let themeCache: Map<string, string> | null = null;

/** `--color-<token>: <value>;` of theme.css, keyed by `<token>`. */
const themeColors = (): Map<string, string> => {
  if (themeCache) return themeCache;
  const css = readFileSync(THEME_PATH, 'utf8');
  const colors = new Map<string, string>();
  for (const match of css.matchAll(/--color-([a-z]+(?:-\d+)?):\s*([^;]+);/g)) {
    colors.set(match[1], match[2].trim());
  }
  themeCache = colors;
  return colors;
};

/** The hues Tailwind's theme defines (`red`, `slate`, …), read from theme.css. */
export const TAILWIND_HUES: readonly string[] = [
  ...new Set([...themeColors().keys()].filter((key) => /-500$/.test(key)).map((key) => key.replace(/-500$/, ''))),
];

/**
 * A text or background *colour* class with no variant and no opacity modifier:
 * `text-white`, `bg-lime-500`. Sizes (`text-xs`, `text-[9px]`), alignment
 * (`text-center`), gradients and arbitrary values are not colours, and a
 * `hover:` or `/50` token is not what is painted at rest — so none of them is
 * matched. `__tests__/avatarColorSource.test.ts` imports the same pattern, so
 * the guard and the measurement cannot disagree on what a colour token is.
 */
export const COLOR_TOKEN_PATTERN = new RegExp(
  `^(text|bg)-(white|black|(?:${TAILWIND_HUES.join('|')})-(?:50|[1-9]00|950))$`,
);

/** The raw theme value of a token: `'lime-500'` → `oklch(…)`, `'white'` → `#fff`. */
export const themeValue = (token: string): string => {
  const value = themeColors().get(token);
  if (!value) throw new Error(`tailwindTheme: no --color-${token} in ${THEME_PATH}`);
  return value;
};

// axe types `commons` without its colour module; one narrow adapter keeps the
// cast in a single place.
interface AxeColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
  parseString(value: string): AxeColor;
  toHexString(): string;
}
interface AxeColorModule {
  Color: new () => AxeColor;
  getContrast(background: AxeColor, foreground: AxeColor): number;
}
const axeColor = (axe.commons as unknown as { color: AxeColorModule }).color;

/** The theme value parsed and clipped by axe's engine. */
export const parsedColor = (token: string): AxeColor => new axeColor.Color().parseString(themeValue(token));

/**
 * Which axe-core this helper measures with, and which one the e2e gate
 * injects. They must be the same file, or a unit test could pass on a pair the
 * gate measures differently.
 */
export const axeCopies = () => {
  const req = createRequire(join(REPO_ROOT, 'package.json'));
  return {
    measuredWith: req.resolve('axe-core'),
    injectedByGate: createRequire(req.resolve('@axe-core/playwright')).resolve('axe-core'),
  };
};

/** WCAG contrast of `text-<fg>` on `bg-<bg>`, both given as theme tokens. */
export const tokenContrast = (fgToken: string, bgToken: string): number =>
  axeColor.getContrast(parsedColor(bgToken), parsedColor(fgToken));

type ColorKind = 'text' | 'bg';

/** The class list as tokens, whatever the separators. */
const tokensOf = (className: string): string[] => className.split(/\s+/).filter(Boolean);

/**
 * The one colour token of a kind in a class list, without its prefix
 * (`'lime-500'`, `'white'`), or `null` when there is none. Two of a kind
 * throw: which one wins is decided by stylesheet order, not by class order, so
 * the measurement could not say what is painted.
 */
export const classColor = (className: string, kind: ColorKind): string | null => {
  const found = tokensOf(className)
    .map((token) => COLOR_TOKEN_PATTERN.exec(token))
    .filter((match): match is RegExpExecArray => !!match && match[1] === kind)
    .map((match) => match[2]);
  if (found.length > 1) {
    throw new Error(`tailwindTheme: "${className}" carries ${found.length} ${kind} colours (${found.join(', ')})`);
  }
  return found[0] ?? null;
};

/** The contrast of the text and background colours one class list carries. */
export const pairContrast = (className: string): number => {
  const fg = classColor(className, 'text');
  const bg = classColor(className, 'bg');
  if (!fg || !bg) throw new Error(`tailwindTheme: "${className}" needs both a text and a background colour`);
  return tokenContrast(fg, bg);
};

const isUnmeasurable = (token: string) => {
  if (token === 'grayscale') return true;
  const opacity = /^opacity-(\d+)$/.exec(token);
  return !!opacity && Number(opacity[1]) < 100;
};

/**
 * What an element's text is painted in, against what: the nearest text colour
 * on the element or an ancestor, over the nearest background colour on the
 * element or an ancestor (white, the app's card surface, when none is set).
 *
 * It refuses to measure an element under `opacity-*` or `grayscale`. Neither
 * can be modelled by a pair of tokens, and a muted look made by opacity is
 * exactly what an author believes passes when it does not.
 */
export const effectivePair = (element: Element): { fg: string; bg: string; ratio: number } => {
  let fg: string | null = null;
  let bg: string | null = null;
  for (let node: Element | null = element; node; node = node.parentElement) {
    const className = node.getAttribute('class') ?? '';
    const blocking = tokensOf(className).find(isUnmeasurable);
    if (blocking) {
      throw new Error(`tailwindTheme: <${node.tagName.toLowerCase()} class="${className}"> carries ${blocking}, which cannot be measured`);
    }
    fg ??= classColor(className, 'text');
    bg ??= classColor(className, 'bg');
  }
  if (!fg) throw new Error(`tailwindTheme: no text colour on <${element.tagName.toLowerCase()}> or its ancestors`);
  const background = bg ?? 'white';
  return { fg, bg: background, ratio: tokenContrast(fg, background) };
};
