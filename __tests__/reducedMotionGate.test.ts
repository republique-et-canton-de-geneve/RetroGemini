import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';

/**
 * A reader whose system asks for reduced motion gets the interface still. The
 * effects of 45.0 are classes of index.css declared under
 * `prefers-reduced-motion: no-preference` (lookTokens.test.ts holds them).
 * Tailwind's own `animate-*` utilities carry no media query at all: each one
 * is written behind `motion-safe:`, or it turns for everyone. Five did: the
 * spinners of "Suggest groups with AI", of a group title's suggestion and of
 * the Review step's summary, and the invite dialog's two QR placeholders,
 * while every state they showed is said in words (`aria-busy`, a
 * placeholder, "Generating…").
 *
 * So is a transition that moves or resizes a box: the participants panel's
 * width, which reflowed the whole board for 200 ms at each collapse, the
 * score bars' heights and widths, the switches' knobs and the reaction
 * picker's grow on hover. A transition of colours, a shadow or an opacity is
 * no motion and stays for everyone.
 *
 * So is a smooth scroll, which glides the page for as long as it lasts, and
 * which no media query stops: `behavior: 'smooth'` moves for every reader.
 * Three did, to the topic of Discuss in both session types and to the result
 * of a release analysis. Each one asks the reader first.
 *
 * The classes are read from the string literals of every component, through
 * the TypeScript parser: a comment that names a utility is not a class.
 */

const ROOT = join(__dirname, '..');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(?:tsx?|js)$/.test(name)) out.push(path);
  }
  return out;
};

const SOURCES = [...walk(join(ROOT, 'components')), join(ROOT, 'App.tsx')];
/**
 * Every file of the application that could scroll a page: the components, and
 * the code they call, the `.js` rules of `utils/` (shared with the server)
 * included.
 */
const APP_SOURCES = [...SOURCES, join(ROOT, 'index.tsx'), ...walk(join(ROOT, 'utils')), ...walk(join(ROOT, 'services'))];
const CSS = readFileSync(join(ROOT, 'index.css'), 'utf8');

const scriptKind = (file: string): ts.ScriptKind =>
  file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS;

/**
 * Each file is parsed once for the whole suite: four scans read the same
 * sources, and parsing them again in each made the scans the slowest tests of
 * the file (one passed 5 s under CI's coverage run, its default timeout). The
 * visitors only read the tree, so a parsed file is shared safely.
 */
const parsed = new Map<string, { text: string; source: ts.SourceFile }>();
const parse = (file: string, text: string): ts.SourceFile => {
  const known = parsed.get(file);
  if (known && known.text === text) return known.source;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file));
  parsed.set(file, { text, source });
  return source;
};

/** What a scan of every source may take on a loaded runner: it parses about three hundred files. */
const SCAN_TIMEOUT_MS = 30_000;

const isText = (node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);

/** Every string a file writes: a JSX attribute, a quoted string, each fixed part of a template. */
const literals = (file: string, text: string): string[] => {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (isText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  return out;
};

/** The class recipes the components name: each `const NAME = '…'` of the files read, a recipe being written in capitals. */
const recipesOf = (files: Array<{ file: string; text: string }>): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const { file, text } of files) {
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /^[A-Z][A-Z0-9_]*$/.test(node.name.text) && node.initializer && isText(node.initializer)) {
        out.set(node.name.text, [...(out.get(node.name.text) ?? []), node.initializer.text]);
      }
      ts.forEachChild(node, visit);
    };
    visit(parse(file, text));
  }
  return out;
};

/**
 * The class lists a file writes, each whole: a string, or a template with every
 * string of its branches and every recipe it names (`${SWITCH_KNOB} ${on ?
 * 'translate-x-5' : ''}` is one element's classes, written in two files).
 */
const classLists = (file: string, text: string, recipes: Map<string, string[]> = new Map()): string[] => {
  const out: string[] = [];
  const visit = (node: ts.Node, inTemplate: boolean) => {
    if (ts.isTemplateExpression(node)) {
      const parts: string[] = [node.head.text];
      const gather = (child: ts.Node) => {
        if (isText(child) || ts.isTemplateHead(child) || ts.isTemplateMiddle(child) || ts.isTemplateTail(child)) parts.push(child.text);
        else if (ts.isIdentifier(child)) parts.push(...(recipes.get(child.text) ?? []));
        ts.forEachChild(child, gather);
      };
      node.templateSpans.forEach(gather);
      out.push(parts.join(' '));
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    if (isText(node) && !inTemplate) out.push(node.text);
    ts.forEachChild(node, (child) => visit(child, inTemplate));
  };
  visit(parse(file, text), false);
  return out;
};

/** A class's variants and its utility: `hover:motion-safe:animate-spin` is two variants and `animate-spin`. */
const parts = (token: string): { variants: string[]; utility: string } => {
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
  return { variants: out, utility: current.replace(/!$/, '').replace(/^!/, '') };
};

const tokens = (text: string): string[] => text.match(/[^\s"'`]+/g) ?? [];

const gated = (variants: string[]): boolean => variants.includes('motion-safe');

/** The animation utilities of a class list that no reader's setting stops. */
const ungatedAnimations = (text: string): string[] =>
  tokens(text).filter((token) => {
    const { variants, utility } = parts(token);
    return /^animate-/.test(utility) && utility !== 'animate-none' && !gated(variants);
  });

/**
 * Whether a `'smooth'` is the first branch of the one question every smooth
 * scroll asks, `motionAllowed() ? 'smooth' : 'auto'`
 * (components/common/motion/effects.ts): a reader who asked for less motion,
 * or whose browser cannot say, is then taken there at once. Parentheses
 * aside, no other shape is read as asking.
 */
const asksMotionFirst = (literal: ts.Node): boolean => {
  let branch: ts.Node = literal;
  while (branch.parent && ts.isParenthesizedExpression(branch.parent)) branch = branch.parent;
  const question = branch.parent;
  if (!question || !ts.isConditionalExpression(question) || question.whenTrue !== branch) return false;
  let condition: ts.Expression = question.condition;
  while (ts.isParenthesizedExpression(condition)) condition = condition.expression;
  return ts.isCallExpression(condition)
    && ts.isIdentifier(condition.expression)
    && condition.expression.text === 'motionAllowed'
    && condition.arguments.length === 0;
};

/** The lines of a file that write `'smooth'` without asking the reader first, whatever it is given to. */
const unaskedSmoothScrolls = (file: string, text: string): number[] => {
  const source = parse(file, text);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (isText(node) && node.text === 'smooth' && !asksMotionFirst(node)) {
      lines.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
};

/**
 * The classes that set `scroll-behavior: smooth`: Tailwind's utility, and the
 * same property written as an arbitrary one. Written whole, as the probes
 * below are: Tailwind does not scan the tests
 * (`__tests__/tailwindScanScope.test.ts`), so naming them adds no rule to the
 * build.
 */
const SMOOTH_SCROLL_UTILITIES = ['scroll-smooth', '[scroll-behavior:smooth]'];

/** The classes of a list that scroll smoothly when no reader's setting stops them. */
const ungatedSmoothScrollClasses = (text: string): string[] =>
  tokens(text).filter((token) => {
    const { variants, utility } = parts(token);
    return SMOOTH_SCROLL_UTILITIES.includes(utility) && !gated(variants);
  });

// Tailwind 4's property lists (node_modules/tailwindcss/dist/lib.js).
const COLOURS = ['color', 'background-color', 'border-color', 'outline-color', 'text-decoration-color', 'fill', 'stroke', '--tw-gradient-from', '--tw-gradient-via', '--tw-gradient-to'];
const TRANSFORMS = ['transform', 'translate', 'scale', 'rotate'];

/** The properties a transition utility animates, or null for a class that is none. */
const transitionProperties = (utility: string): string[] | null => {
  const named: Record<string, string[]> = {
    transition: [...COLOURS, 'opacity', 'box-shadow', ...TRANSFORMS, 'filter', '-webkit-backdrop-filter', 'backdrop-filter', 'display', 'content-visibility', 'overlay', 'pointer-events'],
    'transition-all': ['all'],
    'transition-colors': COLOURS,
    'transition-opacity': ['opacity'],
    'transition-shadow': ['box-shadow'],
    'transition-transform': TRANSFORMS,
    'transition-none': []
  };
  if (named[utility]) return named[utility];
  const arbitrary = /^transition-\[(.+)\]$/.exec(utility);
  return arbitrary ? arbitrary[1].split(',').map((property) => property.trim()) : null;
};

/** A property whose transition moves or resizes a box, or draws a line that moves (the timer's ring). */
const moves = (property: string): boolean =>
  /^(?:all|width|height|(?:min|max)-(?:width|height)|(?:inline|block)-size|inset(?:-.+)?|top|right|bottom|left|margin(?:-.+)?|padding(?:-.+)?|flex(?:-.+)?|grid(?:-.+)?|gap|transform|translate|scale|rotate|stroke-dash.+)$/.test(property);

/** A utility that places a box anywhere but where it lies: a scale, a translation, a rotation, a skew. */
const isTransform = (utility: string): boolean => /^-?(?:scale|translate|rotate|skew)(?:-|$)/.test(utility);

/**
 * The transitions of a class list that move or resize a box for every reader:
 * one whose own list names a size, a position or a transform (`transition-all`
 * names everything), and a plain `transition`, which animates the transforms,
 * beside a class that transforms the box. It cannot tell a transform that
 * changes from one that never does (a tooltip centred with `-translate-x-1/2`):
 * such a list names the properties it fades instead (`transition-colors`).
 */
const ungatedMovingTransitions = (text: string): string[] => {
  const all = tokens(text).map((token) => ({ token, ...parts(token) }));
  const transforms = all.some(({ utility }) => isTransform(utility));
  return all
    .filter(({ variants, utility }) => {
      if (gated(variants)) return false;
      const properties = transitionProperties(utility);
      if (!properties) return false;
      return utility === 'transition' ? transforms : properties.some(moves);
    })
    .map(({ token }) => token);
};

/**
 * A duration or a delay with no transition of its own beside it, for a reader
 * who asked for less motion. `transition-property` starts as `all`, so a
 * `duration-200` alone animates every change of the box, its width included:
 * the gate goes on the duration with the transition, or the gate makes it worse.
 */
const loneDurations = (text: string): string[] => {
  const all = tokens(text).map((token) => ({ token, ...parts(token) }));
  const ownTransition = all.some(({ variants, utility }) => !gated(variants) && transitionProperties(utility) !== null);
  if (ownTransition) return [];
  return all.filter(({ variants, utility }) => !gated(variants) && /^(?:duration|delay)-/.test(utility)).map(({ token }) => token);
};

/** The rules of a stylesheet, each with the at-rules it sits in (comments, keyframes, fonts and the theme left out). */
const cssRules = (css: string): Array<{ selector: string; body: string; within: string[] }> => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ selector: string; body: string; within: string[] }> = [];
  const walkCss = (from: number, to: number, within: string[]) => {
    let start = from;
    for (let i = from; i < to; i += 1) {
      if (text[i] === ';') start = i + 1;
      if (text[i] !== '{') continue;
      let depth = 1;
      let end = i + 1;
      for (; end < to && depth > 0; end += 1) {
        if (text[end] === '{') depth += 1;
        else if (text[end] === '}') depth -= 1;
      }
      const prelude = text.slice(start, i).trim();
      if (/^@(?:media|supports|layer|container)\b/.test(prelude)) walkCss(i + 1, end - 1, [...within, prelude]);
      else if (!prelude.startsWith('@')) out.push({ selector: prelude, body: text.slice(i + 1, end - 1), within });
      i = end - 1;
      start = end;
    }
  };
  walkCss(0, text.length, []);
  return out;
};

const forReaders = (within: string[], preference: 'no-preference' | 'reduce') =>
  within.some((rule) => new RegExp(`prefers-reduced-motion:\\s*${preference}`).test(rule));

/** The properties a `transition` or `transition-property` declaration animates (`transition: 0.3s` is all of them). */
const declaredTransitions = (body: string): string[] =>
  [...body.matchAll(/(?:^|;)\s*transition(-property)?\s*:\s*([^;]+)/g)].flatMap(([, longhand, value]) => {
    const items: string[] = [];
    let depth = 0;
    let current = '';
    for (const char of value) {
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      if (char === ',' && depth === 0) {
        items.push(current.trim());
        current = '';
      } else current += char;
    }
    items.push(current.trim());
    // A shorthand that starts with its time or its easing names no property: all of them.
    const unnamed = /^(?:-?[\d.]+m?s|ease(?:-in|-out|-in-out)?|linear|step-start|step-end|(?:steps|cubic-bezier|linear)\(.*)$/;
    return items.map((item) => {
      const first = item.split(/\s+/)[0];
      return longhand || !unnamed.test(first) ? first : 'all';
    });
  });

/** The rules of a stylesheet that move or resize a box for a reader who asked for less motion. */
const movingCssTransitions = (css: string): string[] =>
  cssRules(css)
    .filter(({ body, within }) => !forReaders(within, 'no-preference') && declaredTransitions(body).some(moves))
    .map(({ selector }) => selector);

/** The rules of a stylesheet that animate for a reader who asked for less motion: declared outside `no-preference` and not stopped under `reduce`. */
const unstoppedCssAnimations = (css: string): string[] => {
  const rules = cssRules(css);
  const animates = (body: string) => [...body.matchAll(/(?:^|;)\s*animation(?:-name)?\s*:\s*([^;]+)/g)].some(([, value]) => value.trim() !== 'none');
  const stopped = new Set(
    rules
      .filter(({ body, within }) => forReaders(within, 'reduce') && /(?:^|;)\s*animation(?:-name)?\s*:\s*none\s*(?:;|$)/.test(body.trim()))
      .map(({ selector }) => selector)
  );
  return rules
    .filter(({ selector, body, within }) => !forReaders(within, 'no-preference') && !forReaders(within, 'reduce') && animates(body) && !stopped.has(selector))
    .map(({ selector }) => selector);
};

/** The rules of a stylesheet that scroll smoothly for a reader who asked for less motion. */
const smoothScrollRules = (css: string): string[] =>
  cssRules(css)
    .filter(({ body, within }) => !forReaders(within, 'no-preference') && /(?:^|;)\s*scroll-behavior\s*:\s*smooth\b/.test(body))
    .map(({ selector }) => selector);

describe('nothing animates for a reader who asked for less motion', () => {
  it('declares every animate-* utility of the components for readers who allow motion', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    const found = SOURCES.flatMap((file) =>
      literals(file, readFileSync(file, 'utf8')).flatMap((text) => ungatedAnimations(text).map((token) => `${relative(ROOT, file)}: ${token}`))
    );
    expect(found).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('reads an animation that turns for everyone, whatever stands before it, and leaves one behind motion-safe', () => {
    expect(ungatedAnimations('w-4 h-4 animate-spin')).toEqual(['animate-spin']);
    expect(ungatedAnimations('hover:animate-ping motion-reduce:animate-pulse animate-bounce! animate-[wiggle_1s_ease-in-out]')).toHaveLength(4);
    expect(ungatedAnimations('motion-safe:animate-spin hover:motion-safe:animate-pulse motion-safe:md:animate-bounce')).toEqual([]);
    expect(ungatedAnimations('animate-none motion-reduce:animate-none text-sm')).toEqual([]);
  });

  it('declares every transition that moves or resizes a box for readers who allow motion', () => {
    const files = SOURCES.map((file) => ({ file, text: readFileSync(file, 'utf8') }));
    const recipes = recipesOf(files);
    const found = files.flatMap(({ file, text }) =>
      classLists(file, text, recipes).flatMap((list) =>
        [...ungatedMovingTransitions(list), ...loneDurations(list)].map((token) => `${relative(ROOT, file)}: ${token}`)
      )
    );
    expect(found).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('declares every transition of index.css that moves or resizes a box, and stops every animation, for a reader who asked for less motion', () => {
    expect(cssRules(CSS).length).toBeGreaterThan(20);
    expect(movingCssTransitions(CSS)).toEqual([]);
    expect(unstoppedCssAnimations(CSS)).toEqual([]);
  });

  it('reads a transition that moves a box, and leaves one of colours, a shadow or an opacity', () => {
    expect(ungatedMovingTransitions('w-12 transition-[width] duration-200')).toEqual(['transition-[width]']);
    expect(ungatedMovingTransitions('h-full transition-all')).toEqual(['transition-all']);
    expect(ungatedMovingTransitions('rounded-full transition-transform translate-x-6')).toEqual(['transition-transform']);
    expect(ungatedMovingTransitions('p-1.5 transition hover:scale-125')).toEqual(['transition']);
    expect(ungatedMovingTransitions('transition-[margin-left,opacity] sm:transition-[height]')).toHaveLength(2);
    expect(ungatedMovingTransitions('motion-safe:transition-[width] motion-safe:transition-all motion-safe:transition hover:scale-125')).toEqual([]);
    expect(ungatedMovingTransitions('transition transition-colors transition-shadow transition-opacity transition-[border-color,box-shadow] hover:bg-slate-100')).toEqual([]);
    expect(ungatedMovingTransitions('transition-none translate-x-1')).toEqual([]);
  });

  it('reads a duration that would animate every property under the gate', () => {
    expect(loneDurations('motion-safe:transition-[width] duration-200')).toEqual(['duration-200']);
    expect(loneDurations('delay-150 w-12')).toEqual(['delay-150']);
    expect(loneDurations('motion-safe:transition-[width] motion-safe:duration-200')).toEqual([]);
    expect(loneDurations('transition-shadow duration-500')).toEqual([]);
  });

  it('reads one element’s classes across a template, its branches and the recipes it names', () => {
    const recipes = recipesOf([{ file: 'look.ts', text: "export const KNOB = 'absolute w-4 h-4 transition';\nconst knob = 'translate-x-9';" }]);
    expect([...recipes.keys()]).toEqual(['KNOB']);
    const text = "const a = <span className={`${KNOB} ${on ? 'translate-x-5' : ''}`} />;\nconst b = 'transition text-sm';";
    expect(classLists('Probe.tsx', text, recipes).flatMap(ungatedMovingTransitions)).toEqual(['transition']);
    expect(classLists('Probe.tsx', text).flatMap(ungatedMovingTransitions)).toEqual([]);
  });

  it('reads the transitions and animations of a stylesheet, inside or outside the gate', () => {
    const css = [
      '.bar { transition: height 0.5s cubic-bezier(0.4, 0, 0.2, 1); }',
      '.fade { transition: color 0.2s, background-color 0.2s; }',
      '.any { transition: 0.3s ease; }',
      '.eased { transition: ease-in-out 0.3s; }',
      '.knob { transition-property: transform; }',
      '@media (prefers-reduced-motion: no-preference) { @layer components { .ok { transition: width 1s; animation: spin 1s; } } }',
      '.dot { animation: blink 1s infinite; }',
      '@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }',
      '.blink { animation: blink 1s infinite; }',
      '@keyframes blink { 50% { transform: translateY(-2px); } }'
    ].join('\n');
    expect(movingCssTransitions(css)).toEqual(['.bar', '.any', '.eased', '.knob']);
    expect(unstoppedCssAnimations(css)).toEqual(['.blink']);
  });

  it('asks the reader before every smooth scroll, in the code, the classes and index.css', () => {
    expect(APP_SOURCES.length).toBeGreaterThan(SOURCES.length);
    const found = APP_SOURCES.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return [
        ...unaskedSmoothScrolls(file, text).map((line) => `${relative(ROOT, file)}:${line}`),
        ...literals(file, text).flatMap((list) => ungatedSmoothScrollClasses(list).map((token) => `${relative(ROOT, file)}: ${token}`)),
      ];
    });
    expect(found).toEqual([]);
    expect(smoothScrollRules(CSS)).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('reads every module of the screens and of the code they call, the .js rules included', () => {
    const everyFile = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? everyFile(path) : [path];
      });
    const modules = ['components', 'utils', 'services']
      .flatMap((dir) => everyFile(join(ROOT, dir)))
      .filter((file) => /\.[cm]?[jt]sx?$/.test(file));
    expect(modules.some((file) => file.endsWith('.js'))).toBe(true);
    expect(modules.filter((file) => !APP_SOURCES.includes(file)).map((file) => relative(ROOT, file))).toEqual([]);
  });

  it('reads a smooth scroll that does not ask the reader, whatever it is given to, and leaves one that does', () => {
    const asking = [
      "el.scrollIntoView({ behavior: motionAllowed() ? 'smooth' : 'auto', block: 'center' });",
      "el.scrollTo({ left, behavior: (motionAllowed()) ? ('smooth') : 'auto' });",
    ].join('\n');
    expect(unaskedSmoothScrolls('Probe.tsx', asking)).toEqual([]);
    const unasked = [
      "el.scrollIntoView({ behavior: 'smooth', block: 'center' });",
      "el.scrollTo({ left, behavior: reduced() ? 'auto' : 'smooth' });",
      'const behavior = `smooth`; el.scrollBy({ top: 10, behavior });',
      "const list = <div style={{ scrollBehavior: 'smooth' }} />;",
      "el.scrollIntoView({ behavior: motionAllowed ? 'smooth' : 'auto' });",
      "el.scrollIntoView({ behavior: !motionAllowed() ? 'auto' : 'smooth' });",
      "el.scrollIntoView({ behavior: motionAllowed() ? 'smooth' : 'smooth' });",
      "// 'smooth', in a comment",
    ].join('\n');
    expect(unaskedSmoothScrolls('Probe.tsx', unasked)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const smooth = 'scroll-smooth';
    const instant = 'scroll-auto';
    const arbitrary = '[scroll-behavior:smooth]';
    expect(ungatedSmoothScrollClasses(`overflow-y-auto ${smooth} md:${smooth} md:${arbitrary}`)).toEqual([smooth, `md:${smooth}`, `md:${arbitrary}`]);
    expect(ungatedSmoothScrollClasses(`motion-safe:${smooth} motion-safe:${arbitrary} ${instant}`)).toEqual([]);
    const css = [
      'html { scroll-behavior: smooth; }',
      '@media (prefers-reduced-motion: no-preference) { .list { scroll-behavior: smooth; } }',
      '.x { color: red; scroll-behavior: auto; }',
    ].join('\n');
    expect(smoothScrollRules(css)).toEqual(['html']);
  });

  it('reads the classes a component writes and not the words of its comments', () => {
    const file = 'Probe.tsx';
    const text = [
      '// animate-spin, in a comment',
      'const A = () => <span className="animate-spin">x</span>;',
      "const b = `p-2 ${busy ? 'animate-pulse' : ''} motion-safe:animate-bounce`;"
    ].join('\n');
    expect(literals(file, text).flatMap(ungatedAnimations)).toEqual(['animate-spin', 'animate-pulse']);
  });
});
