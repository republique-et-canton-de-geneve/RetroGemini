import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import ts from 'typescript';
import { tokenContrast } from './helpers/tailwindTheme';

/**
 * The edge of a text field, a select or a textarea is often the only thing
 * that shows where the control is, so it must clear 3:1 against the field's
 * own fill (WCAG 1.4.11). The look's field edge is slate-400 (3:1 on white);
 * the card hairline, slate-200 or -300, is not a control's edge. Every screen
 * of the port wrote its own fields, and this guard reads them all.
 *
 * It reads the source with the TypeScript parser (AGENTS.md: never a regular
 * expression over JSX), follows a class list through constants, template
 * literals, conditionals and the small class-building arrows the screens use,
 * across a relative import too, and measures every border colour the field can
 * take at rest against every fill it can take. A checkbox, a radio, a file
 * input and a range stay native and are not read; a field drawn borderless
 * (`border-transparent`, `border-none`) shows no edge to measure.
 *
 * The off track of a switch is the same rule: the track is the control.
 */

const ROOT = join(__dirname, '..');
const EDGE = 3;

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
};

const FILES = [...walk(join(ROOT, 'components')), join(ROOT, 'App.tsx')].filter((file) => file.endsWith('.tsx'));

const sources = new Map<string, ts.SourceFile>();
const sourceOf = (file: string): ts.SourceFile => {
  let source = sources.get(file);
  if (!source) {
    source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    sources.set(file, source);
  }
  return source;
};

/** The initializer of a top-level or local `const name = …` in a file, or of the export an import names. */
const declarationOf = (name: string, file: string, depth = 0): { expression: ts.Expression; file: string } | null => {
  if (depth > 4) return null;
  const source = sourceOf(file);
  let found: { expression: ts.Expression; file: string } | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = { expression: node.initializer, file };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found) return found;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const element = bindings.elements.find((e) => e.name.text === name);
    if (!element) continue;
    const base = resolve(dirname(file), specifier);
    const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find((candidate) => existsSync(candidate));
    if (target) return declarationOf(element.propertyName?.text ?? name, target, depth + 1);
  }
  return null;
};

/** Every class-list fragment an expression can produce, joined, so a token in any branch is seen. */
const classTextOf = (expression: ts.Node | undefined, file: string, depth = 0): string => {
  if (!expression || depth > 8) return '';
  const next = (node: ts.Node | undefined, inFile = file) => classTextOf(node, inFile, depth + 1);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) {
    return [expression.head.text, ...expression.templateSpans.flatMap((span) => [next(span.expression), span.literal.text])].join(' ');
  }
  if (ts.isJsxExpression(expression) || ts.isParenthesizedExpression(expression)) return next(expression.expression);
  if (ts.isConditionalExpression(expression)) return `${next(expression.whenTrue)} ${next(expression.whenFalse)}`;
  if (ts.isBinaryExpression(expression)) return `${next(expression.left)} ${next(expression.right)}`;
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.map((element) => next(element)).join(' ');
  if (ts.isCallExpression(expression)) {
    // `[…].join(' ')`, `[…].filter(Boolean).join(' ')`, or a local class-building arrow.
    if (ts.isPropertyAccessExpression(expression.expression)) return next(expression.expression.expression);
    if (ts.isIdentifier(expression.expression)) {
      const declared = declarationOf(expression.expression.text, file);
      if (declared && (ts.isArrowFunction(declared.expression) || ts.isFunctionExpression(declared.expression))) {
        return next(declared.expression.body, declared.file);
      }
    }
    return expression.arguments.map((argument) => next(argument)).join(' ');
  }
  if (ts.isIdentifier(expression)) {
    const declared = declarationOf(expression.text, file);
    return declared ? next(declared.expression, declared.file) : '';
  }
  if (ts.isBlock(expression)) {
    const returned: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isReturnStatement(node)) returned.push(next(node.expression));
      else ts.forEachChild(node, visit);
    };
    visit(expression);
    return returned.join(' ');
  }
  return '';
};

const NOT_A_COLOUR = new Set(['solid', 'dashed', 'dotted', 'double', 'hidden', 'none', 'collapse', 'separate', 'current', 'x', 'y', 't', 'b', 'l', 'r', 's', 'e']);
/** The base (no variant, no side) colours of a kind: `border-slate-400` → `slate-400`. */
const restingColours = (classText: string, kind: 'border' | 'bg'): string[] =>
  [...new Set(classText.split(/\s+/).flatMap((token) => {
    const match = new RegExp(`^${kind}-([a-z]+(?:-\\d+)?)$`).exec(token);
    if (!match || NOT_A_COLOUR.has(match[1]) || /^\d+$/.test(match[1])) return [];
    return [match[1]];
  }))];

const NATIVE_TYPES = /^(checkbox|radio|file|range|hidden|color|submit|button)$/;

interface Field { at: string; tag: string; classText: string }
/** The fields whose edge is measured: every one but the controls that stay native. */
const fields: Field[] = [];
/** Every input, select and textarea, the native ones included, with its `type`. */
const everyField: Array<Field & { type: string }> = [];
for (const file of FILES) {
  const source = sourceOf(file);
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        let type = '';
        let className: ts.Node | undefined;
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || !attribute.initializer) continue;
          const attributeName = attribute.name.getText(source);
          if (attributeName === 'type' && ts.isStringLiteral(attribute.initializer)) type = attribute.initializer.text;
          if (attributeName === 'className') className = attribute.initializer;
        }
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        const field = { at: `${relative(ROOT, file)}:${line}`, tag, classText: classTextOf(className, file) };
        everyField.push({ ...field, type });
        if (!NATIVE_TYPES.test(type)) fields.push(field);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

describe('the edge of every field clears 3:1 on its fill', () => {
  it('finds the fields of every screen', () => {
    // The login, the dashboard, the board, the phases, the console and Jira all draw fields.
    expect(fields.length).toBeGreaterThan(60);
    expect(fields.filter((field) => restingColours(field.classText, 'border').length > 0).length).toBeGreaterThan(40);
  });

  it('measures every border a field can take at rest against every fill it can take', () => {
    const failures: string[] = [];
    for (const field of fields) {
      const borders = restingColours(field.classText, 'border').filter((colour) => colour !== 'transparent');
      if (restingColours(field.classText, 'border').includes('transparent') && borders.length === 0) continue;
      const fills = restingColours(field.classText, 'bg').filter((colour) => colour !== 'transparent');
      for (const border of borders) {
        for (const fill of fills.length ? fills : ['white']) {
          const ratio = tokenContrast(border, fill);
          if (ratio < EDGE) failures.push(`${field.at} <${field.tag}> border-${border} on bg-${fill}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('reads a field whose classes come from a constant of another file', () => {
    // The guard must follow the recipes (dashboardLook's FIELD), or it measures nothing on those screens.
    const viaRecipe = fields.find((field) => field.at.startsWith('components/Dashboard.tsx') && field.classText.includes('focus:ring-indigo-600/15'));
    expect(viaRecipe?.classText).toContain('border-slate-400');
  });
});

/** The input types that take no text: the `readonly` attribute does not apply to them, and `:read-only` always matches them. */
const UNTYPED_INPUT_TYPES = /^(checkbox|radio|file|range|hidden|color|submit|button|image|reset)$/;
/** A class whose variant names the `:read-only` pseudo-class: `read-only:…`, `md:read-only:…`, `[&:read-only]:…`. */
const READ_ONLY_VARIANT = /(^|:)read-only:|:read-only\b/;

describe('a field that cannot be typed in is never styled as read-only', () => {
  // `:read-only` matches every element that cannot be typed in, so a select,
  // a file input or a checkbox always matches it, enabled or not: a class
  // under it draws the field at rest in the look of a field that was locked.
  // The dashboard's field recipe carried its grey under `read-only:`, and
  // seven selects and the feedback image field were drawn so. A fill for a
  // field made read-only keys on its `readonly` attribute, which only a field
  // that takes text can carry.
  const neverTypedIn = everyField.filter((field) => field.tag === 'select' || (field.tag === 'input' && UNTYPED_INPUT_TYPES.test(field.type)));

  it('finds the selects, the file input and the checkboxes of the screens', () => {
    expect(neverTypedIn.filter((field) => field.tag === 'select').length).toBeGreaterThan(10);
    expect(neverTypedIn.some((field) => field.type === 'file')).toBe(true);
    expect(neverTypedIn.some((field) => field.type === 'checkbox')).toBe(true);
    // Through the recipes too: the Actions tab's select takes dashboardLook's FIELD_BOX.
    expect(neverTypedIn.find((field) => field.at.startsWith('components/dashboard/DashboardActionsTab.tsx'))?.classText).toContain('border-slate-400');
  });

  it('gives none of them a read-only variant', () => {
    const styledAsReadOnly = neverTypedIn
      .filter((field) => field.classText.split(/\s+/).some((token) => READ_ONLY_VARIANT.test(token)))
      .map((field) => `${field.at} <${field.tag}${field.type ? ` type="${field.type}"` : ''}>`);
    expect(styledAsReadOnly).toEqual([]);
  });

  it('knows a read-only variant however it is written', () => {
    // Under a utility no theme has (`bg-locked`): Tailwind scans these files
    // too, and a real class written here would add a rule to the build.
    for (const token of ['read-only:bg-locked', 'md:read-only:bg-locked', '[&:read-only]:bg-locked', '[&:not(:read-only)]:bg-locked']) {
      expect(READ_ONLY_VARIANT.test(token), token).toBe(true);
    }
    // The attribute a field made read-only carries is not the pseudo-class.
    for (const token of ['[&[readonly]]:bg-locked', 'aria-readonly:bg-locked', 'bg-locked']) {
      expect(READ_ONLY_VARIANT.test(token), token).toBe(false);
    }
  });
});

describe('the off track of every switch clears 3:1 on white', () => {
  it.each(FILES.filter((file) => /role="switch"|w-11 h-6|h-6 w-11/.test(readFileSync(file, 'utf8'))).map((file) => relative(ROOT, file)))('%s', (file) => {
    const source = sourceOf(join(ROOT, file));
    const tracks: string[] = [];
    const visit = (node: ts.Node) => {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))) {
        const text = classTextOf(node, join(ROOT, file));
        if (/(^|\s)(w-11 h-6|h-6 w-11)(\s|$)/.test(text) && /rounded-full/.test(text)) tracks.push(text);
      }
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'className' && node.initializer) {
        const text = classTextOf(node.initializer, join(ROOT, file));
        if (/SWITCH_TRACK|(^|\s)(w-11 h-6|h-6 w-11)(\s|$)/.test(node.initializer.getText(source)) || /(^|\s)(w-11 h-6|h-6 w-11)(\s|$)/.test(text)) tracks.push(text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    const fills = [...new Set(tracks.flatMap((text) => restingColours(text, 'bg')))].filter((fill) => fill !== 'white');
    for (const fill of fills) expect(tokenContrast(fill, 'white'), `bg-${fill}`).toBeGreaterThanOrEqual(EDGE);
  });
});
