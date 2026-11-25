import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { declarationOf, sourceOf } from './helpers/sourceDeclarations';
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

/** The edge colours a field hovers to: `hover:border-slate-500` → `slate-500`. */
const hoverEdges = (classText: string): string[] =>
  [...new Set(classText.split(/\s+/).flatMap((token) => {
    const match = /^hover:border-([a-z]+-\d+)$/.exec(token);
    return match ? [match[1]] : [];
  }))];

describe("a field's hover moves its edge", () => {
  // The port raised the resting edge of the open board's search and sort and
  // of "Colour by" to slate-400, the colour they hovered to, and kept the
  // hover: hovering them changed nothing. The recipe's fields rest on
  // slate-400 and hover one step darker (FIELD_BOX, `hover:border-slate-500`).
  it('finds the fields that hover', () => {
    expect(fields.filter((field) => hoverEdges(field.classText).length > 0).length).toBeGreaterThan(20);
  });

  it('never hovers a field to an edge it rests on', () => {
    const still = fields.flatMap((field) =>
      hoverEdges(field.classText)
        .filter((hover) => restingColours(field.classText, 'border').includes(hover))
        .map((hover) => `${field.at} <${field.tag}> rests on and hovers to border-${hover}`),
    );
    expect(still).toEqual([]);
  });
});

/** The edge colours a field takes at focus: `focus:border-indigo-600` → `indigo-600`. */
const focusEdges = (classText: string): string[] =>
  [...new Set(classText.split(/\s+/).flatMap((token) => {
    const match = /^focus(?:-visible)?:border-([a-z]+-\d+)$/.exec(token);
    return match ? [match[1]] : [];
  }))];

describe("the icon picker's search field keeps a 3:1 edge on white, at rest and at focus", () => {
  // It rested on slate-400 (3.41:1 on white) and took indigo-400 at focus,
  // 2.79:1: the edge went lighter at the moment it shows where typing goes,
  // under a ring of indigo-200 (1.37:1) that does not make up for it. It takes
  // the recipe's indigo-600 now (FIELD_BOX). The dark phases' fields keep
  // indigo-400, the light edge their slate-900 fill needs. The field has no
  // fill of its own: it shows the picker's white panel.
  const search = fields.find((field) => field.at.startsWith('components/IconPicker.tsx') && field.tag === 'input');

  it('is found, with no fill of its own', () => {
    expect(search).toBeDefined();
    expect(restingColours(search?.classText ?? '', 'bg')).toEqual([]);
  });

  it('rests on an edge that clears 3:1 on white', () => {
    const edges = restingColours(search?.classText ?? '', 'border');
    expect(edges).toEqual(['slate-400']);
    for (const edge of edges) expect(tokenContrast(edge, 'white'), `border-${edge}`).toBeGreaterThanOrEqual(EDGE);
  });

  it('takes an edge at focus that clears 3:1 on white', () => {
    const edges = focusEdges(search?.classText ?? '');
    expect(edges).toHaveLength(1);
    for (const edge of edges) expect(tokenContrast(edge, 'white'), `focus:border-${edge}`).toBeGreaterThanOrEqual(EDGE);
  });
});

/** The input types that take no text: the `readonly` attribute does not apply to them, and `:read-only` always matches them. */
const UNTYPED_INPUT_TYPES = /^(checkbox|radio|file|range|hidden|color|submit|button|image|reset)$/;
/**
 * A class whose variant names the field's own `:read-only` pseudo-class:
 * `read-only:…` or `not-read-only:…`, after a variant or not, and `:read-only`
 * inside an arbitrary variant (`[&:read-only]:…`, `[&:not(:read-only)]:…`).
 * `group-read-only:` and `peer-read-only:` read another element's.
 */
const READ_ONLY_VARIANT = /(^|:)(not-)?read-only:|:read-only\b/;

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

  it('knows read-only: and not-read-only:, after a variant or not, and :read-only in an arbitrary variant', () => {
    // Under a utility no theme has (`bg-locked`): the rule reads the variant,
    // whatever the utility after it.
    // `not-read-only:` is Tailwind's own spelling of `[&:not(:read-only)]:`:
    // a select never matches it, so `bg-slate-50 not-read-only:bg-white`
    // leaves every select grey at rest.
    for (const token of [
      'read-only:bg-locked',
      'md:read-only:bg-locked',
      '[&:read-only]:bg-locked',
      '[&:not(:read-only)]:bg-locked',
      'not-read-only:bg-locked',
      'md:not-read-only:bg-locked',
    ]) {
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

describe('every native checkbox and radio takes the brand accent', () => {
  // A checkbox and a radio stay native, drawn by the browser in the accent
  // their class gives them: the brand's, `accent-indigo-600` (AGENTS.md, *The
  // look*). Nothing sets `accent-color` for the whole page, so each control
  // carries the class, and one written without it draws the browser's blue
  // beside the brand: the Jira target form's mode radios and the batch
  // dialog's two checkboxes did. Read through constants, conditionals and
  // recipes, as the edges above are.
  const native = everyField.filter((field) => field.tag === 'input' && /^(checkbox|radio)$/.test(field.type));

  it('finds the checkboxes and the radios of the screens', () => {
    expect(native.filter((field) => field.type === 'checkbox').length).toBeGreaterThanOrEqual(10);
    expect(native.filter((field) => field.type === 'radio').length).toBeGreaterThanOrEqual(4);
  });

  /** The keys an attribute spread writes, read through a constant; null when they cannot be read. */
  const spreadKeys = (expression: ts.Expression, file: string): string[] | null => {
    let object: ts.Expression = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
    let inFile = file;
    if (ts.isIdentifier(object)) {
      const declared = declarationOf(object.text, file);
      if (!declared) return null;
      object = declared.expression;
      inFile = declared.file;
    }
    if (!ts.isObjectLiteralExpression(object)) return null;
    const keys: string[] = [];
    for (const property of object.properties) {
      const name = ts.isSpreadAssignment(property) ? undefined : property.name;
      if (!name) return null;
      if (ts.isIdentifier(name) || ts.isStringLiteral(name)) {
        keys.push(name.text);
        continue;
      }
      if (!ts.isComputedPropertyName(name)) return null;
      const key = ts.isIdentifier(name.expression) ? declarationOf(name.expression.text, inFile)?.expression : name.expression;
      if (!key || !(ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key))) return null;
      keys.push(key.text);
    }
    return keys;
  };

  it('reads the type of every input as written, so none hides a checkbox from the guard', () => {
    const unread: string[] = [];
    for (const file of FILES) {
      const source = sourceOf(file);
      const visit = (node: ts.Node) => {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'input') {
          const at = `${relative(ROOT, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
          for (const attribute of node.attributes.properties) {
            if (ts.isJsxSpreadAttribute(attribute)) {
              const keys = spreadKeys(attribute.expression, file);
              if (!keys || keys.includes('type')) unread.push(`${at} spreads ${attribute.expression.getText(source)}`);
            } else if (attribute.name.getText(source) === 'type' && !(attribute.initializer && ts.isStringLiteral(attribute.initializer))) {
              unread.push(`${at} type={…}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(unread).toEqual([]);
  });

  it('gives each of them accent-indigo-600', () => {
    const missing = native
      .filter((field) => !field.classText.split(/\s+/).includes('accent-indigo-600'))
      .map((field) => `${field.at} <input type="${field.type}">`);
    expect(missing).toEqual([]);
  });
});
