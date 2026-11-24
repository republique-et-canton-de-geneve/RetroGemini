import axe from 'axe-core';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { join } from 'path';

/**
 * What a Tailwind colour class *paints*, measured the way the e2e gate measures
 * it.
 *
 * Two copies of the truth are what this helper exists to avoid. The colours
 * come from the files the build reads: `node_modules/tailwindcss/theme.css`,
 * then the `@theme` blocks of the application's own `index.css`, where a later
 * declaration wins as it does in the build. So a Tailwind bump that moves a
 * colour moves the measurement with it, and so does a token the application
 * redefines (the neutral and brand scales of the 45.0 look) or adds (the
 * person tones). Until 45.0 only the stock file was read: a colour redefined
 * in `index.css` was painted by the browser and measured at its old value, and
 * a token of the application's own (`retro-primary`) was not seen at all.
 *
 * The contrast is computed by **axe-core's own colour engine**
 * (`axe.commons.color`, the copy `@axe-core/playwright` injects into the
 * browser), which converts an `oklch()` value to sRGB and clips it to gamut
 * before measuring. A hand-written OKLab converter, or a ratio taken from a
 * rounded `#rrggbb`, can disagree with the gate by about 0.02 — on exactly the
 * pairs that sit at 4.51 or 4.58.
 *
 * Test-only: nothing in the product measures colour at runtime.
 */

const REPO_ROOT = join(__dirname, '..', '..');
const THEME_PATH = join(REPO_ROOT, 'node_modules', 'tailwindcss', 'theme.css');
const APP_CSS_PATH = join(REPO_ROOT, 'index.css');

const COLOR_DECLARATION = /--color-([A-Za-z0-9-]*\*|[A-Za-z0-9-]+):\s*([^;]+);/g;

/** The body of every `@theme … { … }` block of a stylesheet, braces matched. */
export const themeBlocks = (css: string): string[] => {
  const blocks: string[] = [];
  for (const match of css.matchAll(/@theme\b[^{;]*\{/g)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') depth -= 1;
      end += 1;
    }
    blocks.push(css.slice(start, end - 1));
  }
  return blocks;
};

/**
 * The colour tokens a build paints: Tailwind's theme, then the application's
 * `@theme` blocks in order. `initial` removes (`--color-*` every colour,
 * `--color-slate-*` one hue), and a `var(--color-x)` value is followed to the
 * token it names.
 */
export const mergeThemeColors = (stockCss: string, appCss: string): Map<string, string> => {
  const colors = new Map<string, string>();
  const apply = (css: string) => {
    for (const match of css.matchAll(COLOR_DECLARATION)) {
      const [, token, raw] = match;
      const value = raw.trim();
      if (value === 'initial') {
        const prefix = token.replace(/\*$/, '');
        for (const key of [...colors.keys()]) if (key.startsWith(prefix)) colors.delete(key);
      } else if (!token.endsWith('*')) {
        colors.set(token, value);
      }
    }
  };
  apply(stockCss);
  for (const block of themeBlocks(appCss)) apply(block);

  const resolve = (value: string, depth = 0): string => {
    const reference = /^var\(\s*--color-([A-Za-z0-9-]+)\s*(?:,[^)]*)?\)$/.exec(value);
    if (!reference) return value;
    const target = colors.get(reference[1]);
    if (!target || depth > 10) throw new Error(`tailwindTheme: cannot resolve ${value}`);
    return resolve(target, depth + 1);
  };
  for (const [token, value] of colors) colors.set(token, resolve(value));
  return colors;
};

let themeCache: Map<string, string> | null = null;

/** `--color-<token>: <value>;` as the build paints it, keyed by `<token>`. */
const themeColors = (): Map<string, string> => {
  themeCache ??= mergeThemeColors(readFileSync(THEME_PATH, 'utf8'), readFileSync(APP_CSS_PATH, 'utf8'));
  return themeCache;
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every colour token the build knows, longest first so a prefix never wins. */
const KNOWN_TOKENS = [...themeColors().keys()].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');

/**
 * A text or background *colour* class with no variant and no opacity modifier:
 * `text-white`, `bg-lime-500`, `bg-person-indigo`. Sizes (`text-xs`,
 * `text-[9px]`), alignment (`text-center`), gradients and arbitrary values are
 * not colours it can name, and a `hover:` or `/50` token is not what is painted
 * at rest — so none of them is matched. `__tests__/avatarColorSource.test.ts`
 * imports the same pattern, so the guard and the measurement cannot disagree on
 * what a colour token is.
 */
export const COLOR_TOKEN_PATTERN = new RegExp(`^(text|bg)-(${KNOWN_TOKENS})$`);

/** The raw theme value of a token: `'lime-500'` → `oklch(…)`, `'white'` → `#fff`. */
export const themeValue = (token: string): string => {
  const value = themeColors().get(token);
  if (!value) throw new Error(`tailwindTheme: no --color-${token} in ${THEME_PATH} or ${APP_CSS_PATH}`);
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
  /** `source` (with its alpha) painted over `backdrop`. */
  flattenColors(source: AxeColor, backdrop: AxeColor): AxeColor;
}
const axeColor = (axe.commons as unknown as { color: AxeColorModule }).color;

/** A colour as CSS writes it (hex, `rgb()`, `hsl()`, `oklch()`…), parsed and clipped by axe's engine. */
export const parsedColorValue = (value: string): AxeColor => new axeColor.Color().parseString(value);

/** The theme value parsed and clipped by axe's engine. */
export const parsedColor = (token: string): AxeColor => parsedColorValue(themeValue(token));

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
 * A known background token under an opacity modifier: `bg-green-50/50`. It is
 * measured as what it paints, blended over the background behind it.
 */
const TRANSLUCENT_BACKGROUND = new RegExp(`^bg-(${KNOWN_TOKENS})/(\\d+)$`);

/**
 * A colour this helper cannot turn into one value: an arbitrary colour
 * (`bg-[#4f3ff0]`, `text-(--ink)`), a gradient, `text-transparent`, a text
 * colour under an opacity modifier. Sizes and alignment (`text-[9px]`,
 * `text-center`) are not colours and are not matched, and a translucent
 * background of a known token is measured, not refused.
 */
const UNMEASURABLE_COLOR = new RegExp(
  `^(?:(text)-(?:${KNOWN_TOKENS})/.+|(text|bg)-(?:\\[(?:#|rgb|hsl|oklch|oklab|color|var\\().*|\\(--.*)|(bg)-(?:linear|radial|conic|gradient)-.*)$`,
);

/** The first token of a kind in a class list that paints a colour the helper cannot measure, or `null`. */
export const unmeasurableColor = (className: string, kind: ColorKind): string | null =>
  tokensOf(className).find((token) => {
    if (kind === 'text' && token === 'text-transparent') return true;
    const match = UNMEASURABLE_COLOR.exec(token);
    return !!match && (match[1] ?? match[2] ?? match[3]) === kind;
  }) ?? null;

/**
 * What an element's text is painted in, against what: the nearest text colour
 * on the element or an ancestor, over the nearest background colour on the
 * element or an ancestor (white, the app's card surface, when none is set).
 * A translucent background on the way (`bg-green-50/50`, a done row) is
 * blended over the one behind it, as the browser paints it; `bg` then reads
 * `green-50/50 over white`.
 *
 * It refuses to measure an element under `opacity-*` or `grayscale`. Neither
 * can be modelled by a pair of tokens, and a muted look made by opacity is
 * exactly what an author believes passes when it does not. It refuses, for the
 * same reason, a nearest colour it cannot name (an arbitrary value, a
 * gradient): skipping it measured the text against whatever lay further up, or
 * against white, and passed.
 */
export const effectivePair = (element: Element): { fg: string; bg: string; ratio: number } => {
  let fg: string | null = null;
  let bg: string | null = null;
  const veils: Array<{ token: string; alpha: number }> = [];
  for (let node: Element | null = element; node; node = node.parentElement) {
    const className = node.getAttribute('class') ?? '';
    const blocking = tokensOf(className).find(isUnmeasurable);
    if (blocking) {
      throw new Error(`tailwindTheme: <${node.tagName.toLowerCase()} class="${className}"> carries ${blocking}, which cannot be measured`);
    }
    for (const kind of ['text', 'bg'] as const) {
      if ((kind === 'text' ? fg : bg) !== null) continue;
      const unnamed = unmeasurableColor(className, kind);
      if (unnamed) {
        throw new Error(`tailwindTheme: <${node.tagName.toLowerCase()} class="${className}"> paints ${unnamed}, which cannot be measured`);
      }
    }
    fg ??= classColor(className, 'text');
    if (bg === null) {
      for (const token of tokensOf(className)) {
        const veil = TRANSLUCENT_BACKGROUND.exec(token);
        if (veil) veils.push({ token: veil[1], alpha: Number(veil[2]) / 100 });
      }
      bg = classColor(className, 'bg');
    }
  }
  if (!fg) throw new Error(`tailwindTheme: no text colour on <${element.tagName.toLowerCase()}> or its ancestors`);
  const base = bg ?? 'white';
  // Painted from the back: the opaque background, then each veil towards the text.
  let painted = parsedColor(base);
  for (const veil of [...veils].reverse()) {
    const layer = parsedColor(veil.token);
    layer.alpha = veil.alpha;
    painted = axeColor.flattenColors(layer, painted);
  }
  const label = veils.length ? `${veils.map((veil) => `${veil.token}/${Math.round(veil.alpha * 100)}`).join(' over ')} over ${base}` : base;
  return { fg, bg: label, ratio: axeColor.getContrast(painted, parsedColor(fg)) };
};
