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
 * The classes are read from the string literals of every component, through
 * the TypeScript parser: a comment that names a utility is not a class.
 */

const ROOT = join(__dirname, '..');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
};

const SOURCES = [...walk(join(ROOT, 'components')), join(ROOT, 'App.tsx')];

/** Every string a file writes: a JSX attribute, a quoted string, each fixed part of a template. */
const literals = (file: string, text: string): string[] => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      out.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
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

describe('nothing animates for a reader who asked for less motion', () => {
  it('declares every animate-* utility of the components for readers who allow motion', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    const found = SOURCES.flatMap((file) =>
      literals(file, readFileSync(file, 'utf8')).flatMap((text) => ungatedAnimations(text).map((token) => `${relative(ROOT, file)}: ${token}`))
    );
    expect(found).toEqual([]);
  });

  it('reads an animation that turns for everyone, whatever stands before it, and leaves one behind motion-safe', () => {
    expect(ungatedAnimations('w-4 h-4 animate-spin')).toEqual(['animate-spin']);
    expect(ungatedAnimations('hover:animate-ping motion-reduce:animate-pulse animate-bounce! animate-[wiggle_1s_ease-in-out]')).toHaveLength(4);
    expect(ungatedAnimations('motion-safe:animate-spin hover:motion-safe:animate-pulse motion-safe:md:animate-bounce')).toEqual([]);
    expect(ungatedAnimations('animate-none motion-reduce:animate-none text-sm')).toEqual([]);
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
