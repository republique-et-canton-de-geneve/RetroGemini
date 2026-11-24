import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { parsedColor, parsedColorValue, themeBlocks, tokenContrast } from './helpers/tailwindTheme';

/**
 * The look (45.0) lives in the `@theme` block of index.css: the components keep
 * their Tailwind classes and that block gives the tokens their values. Each
 * token has a job, and this file states the job as a measured pair, with
 * axe-core's engine, so a value retuned by eye fails here rather than on the
 * one screen where it mattered. The dark pairs are the ones a light-screen
 * sweep breaks (AGENTS.md, "a contrast fix is directional").
 */

const ROOT = join(__dirname, '..');
const CSS = readFileSync(join(ROOT, 'index.css'), 'utf8');
const TEXT = 4.5;
const EDGE = 3;

/** Every file under `dir` whose name matches `pattern`. */
const walk = (dir: string, pattern: RegExp, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, pattern, out);
    else if (pattern.test(name)) out.push(path);
  }
  return out;
};

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
  /** Pure white and pure black, the only colours written as they are. */
  const pure = (colour: string) =>
    /^#(?:f{3,4}|f{6}(?:[0-9a-f]{2})?|0{3,4}|0{6}(?:[0-9a-f]{2})?)$/i.test(colour) ||
    /^rgba?\(\s*(?:255[\s,]+255[\s,]+255|0[\s,]+0[\s,]+0)\b/.test(colour);

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

  /** Every declaration of a stylesheet's @theme blocks, in order, comments left out. */
  const themeDeclarations = (css: string): Array<{ name: string; value: string }> =>
    themeBlocks(css).flatMap((block) =>
      [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;{}]+);/g)]
        .map(([, name, value]) => ({ name, value: value.trim().replace(/\s+/g, ' ') })));

  const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}(?![\w-])|(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)/g;
  /** A colour's channels, its alpha aside: `rgb(23 26 43 / 0.06)` is the colour of `#171a2b`, made translucent. */
  const channels = (colour: string): string => {
    const { red, green, blue } = parsedColorValue(colour);
    return [red, green, blue].map(Math.round).join(',');
  };

  /**
   * The values of the @theme blocks that copy another token's instead of
   * naming it: a value written whole as an earlier token's literal value
   * (`--radius: 0.375rem` beside `--radius-sm: 0.375rem`), and a colour drawn
   * in a value (a shadow's included) that an earlier colour token holds, its
   * alpha aside. A value that names a token (`var(--…)`) copies nothing.
   */
  const themeCopies = (css: string): string[] => {
    const seen: Array<{ name: string; value: string }> = [];
    const colourTokens = new Map<string, string>();
    const copies: string[] = [];
    for (const { name, value } of themeDeclarations(css)) {
      const named = /\bvar\(/.test(value);
      const whole = named ? undefined : seen.find((earlier) => earlier.value === value);
      if (whole) copies.push(`${name} copies ${whole.name} (${value})`);
      else {
        for (const [colour] of value.matchAll(COLOUR_LITERAL)) {
          const holder = colourTokens.get(channels(colour));
          if (holder && holder !== name) copies.push(`${name} draws ${holder} (${colour})`);
        }
      }
      if (!named) seen.push({ name, value });
      const own = !named && name.startsWith('--color-') && value.match(COLOUR_LITERAL)?.[0] === value ? channels(value) : null;
      if (own && !colourTokens.has(own)) colourTokens.set(own, name);
    }
    return copies;
  };

  // The tests above read index.css outside @theme. Inside it, 45.0 left a
  // copy of slate-700 and one of slate-400 as the neutral person's ink and
  // accent, and slate-900's channels in every shadow: a retune of those steps
  // would have left the departed participants' initials, their pictures and
  // every shadow of the look on the old values. A token names another,
  // `var(--…)`, mixed with `color-mix(…, transparent)` when it is translucent.
  it('writes each value of @theme once: no token copies another, nor draws a colour another holds', () => {
    expect(themeDeclarations(CSS).length).toBeGreaterThan(50);
    expect(themeCopies(CSS)).toEqual([]);
  });

  it('reads a copy of a token in @theme, whole or inside a value, and leaves a reference', () => {
    const css = [
      '@theme {',
      '  --color-ink: #171a2b;',
      '  --color-muted: #3c415a; /* a comment: #3c415a */',
      '  --color-person-ink: #3C415A;',
      '  --color-person-pop: var(--color-muted);',
      '  --shadow-sm: 0 1px 2px 0 rgb(23 26 43 / 0.06), 0 1px rgba(23, 26, 43, 0.1);',
      '  --shadow-md: 0 2px 4px color-mix(in srgb, var(--color-ink) 6%, transparent);',
      '  --radius-sm: 0.375rem;',
      '  --radius: 0.375rem;',
      '  --radius-md: var(--radius-sm);',
      '}',
    ].join('\n');
    expect(themeCopies(css)).toEqual([
      '--color-person-ink draws --color-muted (#3C415A)',
      '--shadow-sm draws --color-ink (rgb(23 26 43 / 0.06))',
      '--shadow-sm draws --color-ink (rgba(23, 26, 43, 0.1))',
      '--radius copies --radius-sm (0.375rem)',
    ]);
  });

  /**
   * The colours the screens' code writes: in a string, a template or JSX text
   * (comments are not read), as hex, `rgb()`, `rgba()`, `hsl()` or `hsla()`,
   * those inside a class's arbitrary value included. A template stops at its
   * first `${`, so a colour built around one is read up to there.
   */
  const colourLiterals = (file: string, text: string): string[] => {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node) || ts.isJsxText(node)) {
        const written = node.text.matchAll(
          /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|(?<![a-zA-Z])(?:rgba?|hsla?)\([^)]*\)?/g,
        );
        for (const match of written) found.push(match[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };

  /**
   * Where a colour is data, written as the screens store or read it: never a
   * colour of the look, so a retune leaves it as it is.
   */
  const COLOUR_DATA: Record<string, { colours: string[]; why: string }> = {
    'components/ColorPicker.tsx': {
      colours: [
        '#dc2626', '#e11d48', '#db2777', '#c026d3', '#9333ea', '#7c3aed', '#4f46e5', '#2563eb', '#0284c7',
        '#0891b2', '#0d9488', '#059669', '#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#475569', '#6366f1',
      ],
      why: "the colours a facilitator picks, stored on the column as `customColor` and read back by the board (`columnHue`), and the picker's start for a column with none",
    },
    'components/Dashboard.tsx': {
      colours: ['#10b981', '#f43f5e', '#64748b', '#6366f1', '#34d399', '#fbbf24', '#f97316', '#dc2626'],
      why: "a column's colour, written as `customColor` on a new template's columns or shown for a column with none; and the five steps of a health-check score's trend waves, a scale that encodes the votes",
    },
    'components/Session.tsx': {
      colours: ['#64748b'],
      why: 'the `customColor` of a column Edit Layout adds, written onto the session',
    },
  };

  // The same rule for the screens' code. A colour of the look is a class or a
  // `var(--color-…)`, mixed with `color-mix` when it must be translucent: the
  // proposal row's wash kept Tailwind 3's emerald, slate and red as `rgba()`
  // under a look whose slate-400 is its own.
  it('the screens write no colour of their own, but pure white and black and the data above', () => {
    const files = [...walk(join(ROOT, 'components'), /\.tsx?$/), join(ROOT, 'App.tsx')];
    expect(files.length).toBeGreaterThan(100);
    const written = files.flatMap((file) => {
      const at = relative(ROOT, file);
      const data = new Set(COLOUR_DATA[at]?.colours ?? []);
      return colourLiterals(file, readFileSync(file, 'utf8'))
        .filter((colour) => !pure(colour) && !data.has(colour.toLowerCase()))
        .map((colour) => `${at}: ${colour}`);
    });
    expect(written).toEqual([]);
  });

  it('keeps every colour listed as data where it is still written', () => {
    for (const [file, { colours, why }] of Object.entries(COLOUR_DATA)) {
      expect(why.length, file).toBeGreaterThan(20);
      const written = new Set(colourLiterals(file, readFileSync(join(ROOT, file), 'utf8')).map((colour) => colour.toLowerCase()));
      for (const colour of colours) expect(written.has(colour), `${file}: ${colour}`).toBe(true);
    }
  });

  it('reads a colour in a string, a template and JSX text, never in a comment or an entity', () => {
    const probe = [
      "// '#abcdef' in a comment",
      "const a = '#AbCdEf';",
      'const b = `x ${y} rgba(1, 2, 3, ${z}) z`;',
      'const c = <p style={{ color: "hsl(1 2% 3%)" }}>&#8212; #fff</p>;',
      "const d = 'drop-[0_1px_rgba(0,0,0,0.9)]';",
    ].join('\n');
    expect(colourLiterals('probe.tsx', probe)).toEqual(['#AbCdEf', 'rgba(1, 2, 3, ', 'hsl(1 2% 3%)', '#fff', 'rgba(0,0,0,0.9)']);
    expect(['#fff', 'rgba(0,0,0,0.9)', '#AbCdEf'].map(pure)).toEqual([true, true, false]);
  });

  /** The templates of a file whose text stops in a variable's name, just before a `${`. */
  const variablesBuiltFromParts = (file: string, text: string): string[] => {
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    const visit = (node: ts.Node) => {
      const head = ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? /--[\w-]*$/.exec(node.text) : null;
      if (head) found.push(`${head[0]}\${…}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  };

  // An inline style reads the theme by `var(--color-…)`, and Tailwind emits a
  // theme variable only where the sources name it: a name built from parts is
  // not found, and the style reads a variable the build never wrote.
  it('names every theme variable a screen reads whole, never built from parts', () => {
    const files = [...walk(join(ROOT, 'components'), /\.tsx?$/), join(ROOT, 'App.tsx')];
    const built = files.flatMap((file) =>
      variablesBuiltFromParts(file, readFileSync(file, 'utf8')).map((name) => `${relative(ROOT, file)}: ${name}`),
    );
    expect(built).toEqual([]);
    const probe = 'const a = `var(--color-${hue}) var(--radius-${size}) ${whole} --x`; const b = `var(${variable})`;';
    expect(variablesBuiltFromParts('probe.ts', probe)).toEqual(['--color-${…}', '--radius-${…}']);
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
 * A radius the look's steps do not name is written from them, never as its
 * result: an overlay inside a bordered box takes the box's radius less the
 * border. Written as a number of pixels, the group's drop overlay kept stock
 * Tailwind's 2xl (16px) less its 2px border after 45.0 had made 2xl 18px, so
 * its corners were squarer than the curve they sat in.
 */
describe('one source for a radius', () => {
  /** Every arbitrary radius class in a text, after a variant or not, on one side or all. */
  const arbitraryRadii = (text: string): string[] => text.match(/(?<![\w-])rounded(?:-[a-z]{1,2})?-\[[^\]\s]+\]/g) ?? [];
  const fromToken = (radius: string) => /var\(--radius-(?:xs|sm|md|lg|xl|2xl|3xl|4xl)\)/.test(radius);

  it("derives every arbitrary radius of the screens from the look's radius tokens", () => {
    const files = [...walk(join(ROOT, 'components'), /\.tsx?$/), join(ROOT, 'App.tsx')];
    const literal = files.flatMap((file) =>
      arbitraryRadii(readFileSync(file, 'utf8'))
        .filter((radius) => !fromToken(radius))
        .map((radius) => `${relative(ROOT, file)}: ${radius}`),
    );
    expect(literal).toEqual([]);
  });

  it('reads a radius after a variant and on one side, and knows one built from a token', () => {
    // Written whole: Tailwind does not scan the tests
    // (`__tests__/tailwindScanScope.test.ts`), so a probe adds no rule to the build.
    const literal = 'rounded-[14px]';
    const derived = 'rounded-t-[calc(var(--radius-xl)-1px)]';
    expect(arbitraryRadii(`rounded-xl md:${literal} ${derived} rounded-full`)).toEqual([literal, derived]);
    expect([literal, derived].map(fromToken)).toEqual([false, true]);
  });
});

/**
 * A rule whose class no screen applies is a look nobody sees, kept in step by
 * hand: 45.0 re-tokenised the colours of `.drag-over`, a scaled drop target no
 * element had carried for several releases (a drop target is ringed, never
 * scaled), and `.scrollbar-hide` was as dead.
 */
describe('what index.css styles', () => {
  /** The classes the selectors name; comments and at-rule preludes are left out. */
  const styledClasses = (css: string): string[] => {
    const names = new Set<string>();
    for (const match of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)) {
      const selector = match[1].trim();
      if (selector.startsWith('@')) continue;
      for (const name of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) names.add(name[1]);
    }
    return [...names];
  };

  it('styles no class that nothing applies', () => {
    const code = [
      ...walk(join(ROOT, 'components'), /\.tsx?$/),
      ...walk(join(ROOT, 'utils'), /\.[jt]sx?$/),
      ...walk(join(ROOT, 'services'), /\.tsx?$/),
      ...['App.tsx', 'index.tsx', 'index.html'].map((file) => join(ROOT, file)),
    ].map((file) => readFileSync(file, 'utf8')).join('\n');
    const styled = styledClasses(CSS);
    expect(styled.length).toBeGreaterThan(20);
    // Named as a whole word where a screen is drawn from. A class built from
    // parts at run time (`tone-${hue}`) would need its names written out.
    const unapplied = styled.filter((name) => !new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code));
    expect(unapplied).toEqual([]);
  });

  it('reads the classes of a selector, never the numbers of a declaration', () => {
    const css = '/* .gone {} */ .a:hover, .b .c::after { transition: opacity 0.5s; } @media (x) { .d { top: 0.5rem; } } @keyframes k { 0.5% { opacity: 0; } }';
    expect(styledClasses(css)).toEqual(['a', 'b', 'c', 'd']);
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
    const files = [...walk(join(ROOT, 'components'), /\.tsx?$/), join(ROOT, 'App.tsx')];
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
