import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tailwind 4 builds the shipped stylesheet from every class name it finds in
 * the files it scans, and by default it scans every file git does not ignore:
 * the documents, the tests, the end-to-end specs and the CI workflows too.
 * Those name classes the application never draws, often on purpose (a guard's
 * counter-example such as `opacity-40`, an ungated `animate-spin`, a `read-only:`
 * variant the field guard refuses, `text-[#555]` in AGENTS.md), and each one
 * became a rule of the shipped CSS: 103 utility classes, about 13 kB of 110 kB,
 * measured by building with and without these exclusions. None of them was drawn,
 * because the application writes its classes whole in its own sources
 * (AGENTS.md → The look: a recipe is a full class string), and a column's
 * stored classes are read as data (`utils/columnHue.ts`), never applied.
 *
 * So `index.css` tells Tailwind not to read what is not the application. A
 * directory of the application must never be excluded: its classes would draw
 * nothing.
 */
const css = readFileSync(resolve(__dirname, '..', 'index.css'), 'utf8');

const excluded = [...css.matchAll(/^@source\s+not\s+'([^']+)';/gm)].map((match) => match[1]);

describe("Tailwind's scan reads the application only", () => {
  it.each([
    './**/*.{md,yml,yaml}',
    './__tests__',
    './e2e',
    './e2e-prod',
    './scripts',
    './loadtest',
    './k8s',
    './.github',
    './.claude',
    './.gstack',
    './.husky',
  ])('does not read %s', (path) => {
    expect(excluded).toContain(path);
  });

  it('excludes no directory or file of the application', () => {
    const app = ['./components', './utils', './services', './i18n', './App.tsx', './index.tsx', './index.html', './types.ts', './server', './public'];
    for (const path of excluded) {
      for (const source of app) {
        expect(path === source || path.startsWith(`${source}/`) || source.startsWith(`${path}/`), `${path} reaches ${source}`).toBe(false);
      }
      expect(path, 'a glob over every file would reach the application').not.toMatch(/^\.\/\*\*\/\*\.\{?[^}]*\b(tsx?|jsx?|html|css)\b/);
    }
  });

  it('puts the exclusions right after the import, before anything else reads the scan', () => {
    const importAt = css.indexOf("@import 'tailwindcss';");
    expect(importAt).toBeGreaterThanOrEqual(0);
    const firstExclusion = css.search(/^@source\s+not\s/m);
    expect(firstExclusion).toBeGreaterThan(importAt);
    expect(css.slice(importAt, firstExclusion).trim()).toBe("@import 'tailwindcss';");
  });
});
