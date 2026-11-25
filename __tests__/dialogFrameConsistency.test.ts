import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, normalize, relative } from 'path';
import ts from 'typescript';
import * as modalDialog from '../components/common/ModalDialog';
import * as dashboardLook from '../components/dashboard/dashboardLook';

/**
 * One frame for every dialog of the product (the Clarté recipe): a veil of
 * slate-900 at 45% with no blur behind, a white panel with the 2xl radius and
 * a hairline edge. Each screen of the port passed its own classes to
 * ModalDialog, and the console's dialogs kept a black veil and another radius;
 * this reads every call site (with the TypeScript parser) so the next dialog
 * agrees too. The image gallery is the one stated exception: it shows a
 * picture on a darker veil, with no panel around it.
 *
 * A call site writes its classes out, or names a recipe of one of the two
 * modules below (`overlayClassName={DIALOG_OVERLAY}`, a template that starts
 * from `DIALOG_PANEL`). Both are read: a named recipe is followed through the
 * file's own import to its value. Classes this cannot read fail the suite
 * rather than pass unread, which is how nine dialogs went unchecked while the
 * guard only read string literals.
 */

const ROOT = join(__dirname, '..');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.tsx')) out.push(path);
  }
  return out;
};

const GALLERY = 'components/common/ImageGallery.tsx';

/** The modules whose exported class strings a call site may name, by their path from the repository root. */
const RECIPE_MODULES: ReadonlyArray<{ path: string; exports: Record<string, unknown> }> = [
  { path: 'components/dashboard/dashboardLook', exports: dashboardLook },
  { path: 'components/common/ModalDialog', exports: modalDialog },
];

/** Classes that are written, but in a way this guard cannot follow. */
const UNREADABLE = Symbol('unreadable');
type Classes = string | null | typeof UNREADABLE;

interface CallSite { at: string; overlay: Classes; panel: Classes }

/** What each local name stands for, when the file (at `path`, from the repository root) imports it from a recipe module. */
const importedRecipes = (path: string, source: ts.SourceFile): Map<string, string> => {
  const named = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text.replace(/\.(ts|tsx|js)$/, '');
    if (!specifier.startsWith('.')) continue;
    const from = normalize(join(dirname(path), specifier)).split('\\').join('/');
    const recipes = RECIPE_MODULES.find((m) => m.path === from);
    const bindings = statement.importClause?.namedBindings;
    if (!recipes || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const value = recipes.exports[(element.propertyName ?? element.name).text];
      if (typeof value === 'string') named.set(element.name.text, value);
    }
  }
  return named;
};

const readSites = (path: string, text: string): CallSite[] => {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const recipes = importedRecipes(path, source);
  const found: CallSite[] = [];

  const classesOf = (expression: ts.Expression | undefined): string | typeof UNREADABLE => {
    if (!expression) return UNREADABLE;
    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
    if (ts.isIdentifier(expression)) return recipes.get(expression.text) ?? UNREADABLE;
    if (ts.isTemplateExpression(expression)) {
      const parts: string[] = [expression.head.text];
      for (const span of expression.templateSpans) {
        const value = classesOf(span.expression);
        if (value === UNREADABLE) return UNREADABLE;
        parts.push(value, span.literal.text);
      }
      return parts.join('');
    }
    return UNREADABLE;
  };

  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'ModalDialog') {
      const attributeClasses = (name: string): Classes => {
        const attribute = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(source) === name);
        // Absent: the dialog takes ModalDialog's own default, which is the recipe.
        if (!attribute || !ts.isJsxAttribute(attribute)) return null;
        if (!attribute.initializer) return UNREADABLE;
        return classesOf(ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer);
      };
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      found.push({ at: `${path}:${line}`, overlay: attributeClasses('overlayClassName'), panel: attributeClasses('panelClassName') });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
};

const sites: CallSite[] = [...walk(join(ROOT, 'components')), join(ROOT, 'App.tsx')]
  .flatMap((file) => readSites(relative(ROOT, file), readFileSync(file, 'utf8')));

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);
const written = (classes: Classes): classes is string => typeof classes === 'string';

const wrongVeils = (list: CallSite[]): string[] =>
  list
    .filter((site) => written(site.overlay) && !site.at.startsWith(GALLERY))
    .filter((site) => !tokens(site.overlay as string).includes('bg-slate-900/45') || /backdrop-blur/.test(site.overlay as string))
    .map((site) => `${site.at}: ${site.overlay as string}`);

const wrongPanels = (list: CallSite[]): string[] =>
  list
    .filter((site) => written(site.panel) && tokens(site.panel).includes('bg-white'))
    .filter((site) => {
      const classes = tokens(site.panel as string);
      return !classes.some((t) => /^(sm:)?rounded-2xl$/.test(t)) || !classes.includes('border') || !classes.includes('border-slate-200');
    })
    .map((site) => `${site.at}: ${site.panel as string}`);

const unreadable = (list: CallSite[]): string[] =>
  list.filter((site) => site.overlay === UNREADABLE || site.panel === UNREADABLE).map((site) => site.at);

describe('every dialog takes the one frame', () => {
  it('finds the dialogs of the session, the dashboard and the console', () => {
    expect(sites.length).toBeGreaterThan(15);
  });

  it('the shared defaults are the recipe', () => {
    expect(tokens(modalDialog.DIALOG_OVERLAY_CLASS)).toContain('bg-slate-900/45');
    expect(tokens(modalDialog.DIALOG_PANEL_CLASS)).toEqual(expect.arrayContaining(['bg-white', 'rounded-2xl', 'border', 'border-slate-200']));
    expect(tokens(dashboardLook.DIALOG_OVERLAY)).toContain('bg-slate-900/45');
    expect(tokens(dashboardLook.DIALOG_PANEL)).toEqual(expect.arrayContaining(['bg-white', 'rounded-2xl', 'border', 'border-slate-200']));
  });

  it('reads the classes of every call site, written out or named', () => {
    expect(unreadable(sites)).toEqual([]);
    // The dialogs that name a recipe are read too: they are the dashboard's and the console's.
    const named = sites.filter((site) => written(site.overlay) && site.overlay === dashboardLook.DIALOG_OVERLAY);
    expect(named.length).toBeGreaterThanOrEqual(9);
  });

  it('every veil a call site writes is slate-900 at 45%, with no blur', () => {
    expect(wrongVeils(sites)).toEqual([]);
  });

  it('every white panel a call site writes has the 2xl radius and a hairline edge', () => {
    expect(wrongPanels(sites)).toEqual([]);
  });
});

describe('the reading itself', () => {
  const read = (body: string, imports = "import { DIALOG_OVERLAY, DIALOG_PANEL } from '../dashboard/dashboardLook';") =>
    readSites('components/admin/Example.tsx', `${imports}\nexport const Example = () => (${body});\n`);

  it('follows a named recipe to its value, alone and at the start of a template', () => {
    const [site] = read('<ModalDialog overlayClassName={DIALOG_OVERLAY} panelClassName={`${DIALOG_PANEL} p-6 max-w-md`} />');
    expect(site.overlay).toBe(dashboardLook.DIALOG_OVERLAY);
    expect(site.panel).toBe(`${dashboardLook.DIALOG_PANEL} p-6 max-w-md`);
    expect(wrongVeils([site])).toEqual([]);
    expect(wrongPanels([site])).toEqual([]);
  });

  it('follows a renamed import and the dialog module’s own constants', () => {
    const [site] = read(
      '<ModalDialog overlayClassName={VEIL} panelClassName={DIALOG_PANEL_CLASS} />',
      "import { DIALOG_OVERLAY as VEIL } from '../dashboard/dashboardLook';\nimport ModalDialog, { DIALOG_PANEL_CLASS } from '../common/ModalDialog';",
    );
    expect(site.overlay).toBe(dashboardLook.DIALOG_OVERLAY);
    expect(site.panel).toBe(modalDialog.DIALOG_PANEL_CLASS);
  });

  it('reports a wrong frame written after a named recipe', () => {
    const [site] = read('<ModalDialog overlayClassName={`${DIALOG_OVERLAY} backdrop-blur-sm`} panelClassName="bg-white rounded-lg p-6" />');
    expect(wrongVeils([site])).toHaveLength(1);
    expect(wrongPanels([site])).toHaveLength(1);
  });

  it('refuses classes it cannot follow instead of passing them unread', () => {
    const local = read('<ModalDialog overlayClassName={veil} />', "const veil = 'fixed inset-0 bg-black/50';");
    expect(unreadable(local)).toEqual(['components/admin/Example.tsx:2']);
    // A name that is not imported from a recipe module is not a recipe, whatever it is called.
    const homonym = read('<ModalDialog panelClassName={DIALOG_PANEL} />', "const DIALOG_PANEL = 'bg-white rounded-lg';");
    expect(unreadable(homonym)).toHaveLength(1);
    const elsewhere = read('<ModalDialog panelClassName={DIALOG_PANEL} />', "import { DIALOG_PANEL } from './dashboardLook';");
    expect(unreadable(elsewhere)).toHaveLength(1);
    const chosen = read('<ModalDialog panelClassName={wide ? "bg-white" : "bg-white rounded-2xl"} />', '');
    expect(unreadable(chosen)).toHaveLength(1);
  });

  it('leaves a dialog with no classes of its own to the default', () => {
    const [site] = read('<ModalDialog onClose={close} />', '');
    expect(site).toMatchObject({ overlay: null, panel: null });
    expect(unreadable([site])).toEqual([]);
  });
});
