import { test, expect, type Page, type Route } from '@playwright/test';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';
import ts from 'typescript';
import { RETRO_TEMPLATES } from '../i18n/content/retroTemplates';
import { ICON_PICKER_ICONS } from '../components/iconPickerIcons';

/**
 * Every icon the application can draw is a Material Symbols ligature: a name
 * the font turns into one glyph. A name the font does not have is drawn as its
 * own letters, several glyphs wide, with nothing reporting it — `groups_off`
 * showed as the groups glyph and "_OFF", and `clarity` as the word "CLARITY",
 * from the first release until 45.0. Column icons are data (stored by name), so
 * the picker's list and the built-in templates are measured too.
 *
 * Measured in the built application served by `server.js`, under its CSP,
 * because that is where the font file and its `@font-face` really meet.
 */

// The package is an ES module: no __dirname.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ICON_CLASS = 'material-symbols-outlined';
const LIGATURE = /^[a-z0-9_]+$/;

const sourceOf = (file: string) =>
  ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

const sourceFiles = (): string[] => {
  const files = [join(ROOT, 'App.tsx')];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(join(ROOT, 'components'));
  return files;
};

/** The literals an expression can evaluate to: both branches of a choice, either side of a fallback. */
const valuesOf = (node: ts.Node | undefined): string[] => {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isJsxExpression(node)) return valuesOf(node.expression);
  if (ts.isConditionalExpression(node)) return [...valuesOf(node.whenTrue), ...valuesOf(node.whenFalse)];
  if (ts.isBinaryExpression(node)
    && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
    return node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? valuesOf(node.right) : [...valuesOf(node.left), ...valuesOf(node.right)];
  }
  return [];
};

const classNameOf = (attributes: ts.JsxAttributes, file: ts.SourceFile): string => {
  for (const attribute of attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'className') return attribute.initializer?.getText(file) ?? '';
  }
  return '';
};

/**
 * The names written in the components, read with the TypeScript parser (a
 * regular expression stops at the first `>` of an arrow function, AGENTS.md →
 * Accessibility): the children of every element carrying the icon class, and
 * for the icons a component reads from a table or a helper (`tab.icon`,
 * `sortIconOf(…)`, `activityIcon(…)`), the string values of every `icon`,
 * `previous` and `next` property and what each function named like an icon
 * returns.
 */
const namesInComponents = (): Map<string, string> => {
  const found = new Map<string, string>();
  const add = (name: string, where: string) => {
    if (LIGATURE.test(name) && !found.has(name)) found.set(name, where);
  };
  for (const path of sourceFiles()) {
    const file = sourceOf(path);
    const where = (node: ts.Node) => `${relative(ROOT, path)}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && classNameOf(node.openingElement.attributes, file).includes(ICON_CLASS)) {
        for (const child of node.children) {
          if (ts.isJsxText(child)) add(child.text.trim(), where(child));
          else for (const value of valuesOf(child)) add(value, where(child));
        }
      }
      if (ts.isPropertyAssignment(node) && ['icon', 'previous', 'next'].includes(node.name.getText(file))) {
        for (const value of valuesOf(node.initializer)) add(value, where(node));
      }
      const fnName = ts.isFunctionDeclaration(node) ? node.name?.text
        : ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.name.getText(file)
          : undefined;
      if (fnName && /icon/i.test(fnName)) {
        const body = ts.isFunctionDeclaration(node) ? node.body : (node as ts.VariableDeclaration).initializer;
        const scan = (inner: ts.Node) => {
          if (ts.isReturnStatement(inner)) for (const value of valuesOf(inner.expression)) add(value, where(inner));
          else if (ts.isArrowFunction(inner) && inner.parent === body && !ts.isBlock(inner.body)) for (const value of valuesOf(inner.body)) add(value, where(inner));
          ts.forEachChild(inner, scan);
        };
        if (body) scan(body);
        if (body && ts.isArrowFunction(body) && !ts.isBlock(body.body)) for (const value of valuesOf(body.body)) add(value, where(body));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
};

const pickerNames = (): string[] => ICON_PICKER_ICONS.map((icon) => icon.name);

const templateNames = (): string[] => RETRO_TEMPLATES.flatMap((template) => template.columns.map((column) => column.icon));

const allNames = (): Map<string, string> => {
  const names = namesInComponents();
  for (const name of pickerNames()) if (!names.has(name)) names.set(name, 'components/iconPickerIcons.ts');
  for (const name of templateNames()) if (!names.has(name)) names.set(name, 'i18n/content/retroTemplates.ts');
  return names;
};

/** Each name drawn in its own span at the default size, and the width each one takes. */
const measure = async (page: Page, names: string[]) =>
  page.evaluate(
    async ({ names, iconClass }) => {
      await document.fonts.ready;
      const host = document.createElement('div');
      host.setAttribute('aria-hidden', 'true');
      host.style.cssText = 'position:absolute;left:0;top:0;width:100000px;';
      document.body.appendChild(host);
      const spans = names.map((name) => {
        const span = document.createElement('span');
        span.className = iconClass;
        span.textContent = name;
        host.appendChild(span);
        return span;
      });
      // A face is fetched when text first needs it: wait until it has loaded.
      await document.fonts.load(`24px "Material Symbols Rounded"`, names.join(' '));
      const boxes = spans.map((span, index) => {
        const box = span.getBoundingClientRect();
        return { name: names[index], width: box.width, height: box.height };
      });
      host.remove();
      return boxes;
    },
    { names, iconClass: ICON_CLASS },
  );

/** A ligature is one 24px glyph (24.02 measured); a missing one is a word, 120px for `groups_off`. */
const tooWide = (boxes: Array<{ name: string; width: number; height: number }>) =>
  boxes.filter((box) => box.width > 25 || box.width < 23 || Math.round(box.height) !== 24);

const openApp = async (page: Page) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
};

test('the source holds the icon names this spec measures', () => {
  const names = allNames();
  // The scan reads the code: if it found next to nothing, it measures nothing.
  expect(names.size).toBeGreaterThan(200);
  expect(pickerNames().length).toBeGreaterThan(100);
  expect(templateNames().length).toBeGreaterThan(30);
  for (const known of ['arrow_back', 'qr_code_2', 'unfold_more', 'group_off', 'light_mode', 'play_arrow']) {
    expect(names.has(known), known).toBe(true);
  }
});

test('the icon font is served from this deployment', async ({ request }) => {
  const response = await request.get('/fonts/material-symbols-rounded.woff2');
  expect(response.status()).toBe(200);
  expect((await response.body()).subarray(0, 4).toString('latin1')).toBe('wOF2');
});

test('every icon name the application can draw is one glyph of the font', async ({ page }) => {
  await openApp(page);
  const names = allNames();
  const wrong = tooWide(await measure(page, [...names.keys()]));
  expect(
    wrong.map((box) => `${box.name} (${Math.round(box.width)}×${Math.round(box.height)}px, ${names.get(box.name)})`),
    'these names are drawn as words: the font has no such ligature',
  ).toEqual([]);
});

// What a page of this release meets when a pod of 44.x answers during a
// rolling update: that pod has no Rounded file. The second `src` of the
// @font-face is the Outlined cut it does have. Two ways the first source can
// fail, and both must fall through: the request dies, or (what such a pod
// really does for a file it does not know outside /assets) it answers the
// single-page application's HTML with a 200, which is not a font.
const UNREACHABLE: ReadonlyArray<[string, (route: Route) => Promise<void>]> = [
  ['refused', (route) => route.abort()],
  [
    'answered with the page of a pod that does not have it',
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        headers: { 'Cache-Control': 'no-cache' },
        body: '<!doctype html><html><head><title>RetroGemini</title></head><body><div id="root"></div></body></html>',
      }),
  ],
];

for (const [how, answer] of UNREACHABLE) {
  test(`with the Rounded file ${how}, the icons come from the previous cut, never as words`, async ({ page }) => {
    await page.route('**/fonts/material-symbols-rounded.woff2', answer);
    const fallback = page.waitForResponse((response) => response.url().endsWith('/fonts/material-symbols-outlined.woff2'));
    await openApp(page);
    const names = allNames();
    const boxes = await measure(page, [...names.keys()]);
    expect((await fallback).status()).toBe(200);
    expect(tooWide(boxes).map((box) => `${box.name} (${Math.round(box.width)}px, ${names.get(box.name)})`)).toEqual([]);
  });
}
