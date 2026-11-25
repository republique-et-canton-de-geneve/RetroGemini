import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import ts from 'typescript';

/**
 * A source file of the repository parsed once, and the `const` declaration a
 * guard follows a class list through, looked up once per file and name. Two
 * guards carried copies of both (`fieldEdgeContrast.test.ts`,
 * `filterPillState.test.tsx`), which walked a file's whole tree on every
 * lookup: the field-edge guard resolves the same recipes for every field of
 * every screen, and its slowest case took 3.9 s of its 5 s in CI's coverage
 * run (`__tests__/sourceDeclarations.test.ts`).
 */

const sources = new Map<string, ts.SourceFile>();

/** The file parsed with the TypeScript parser (TSX for a `.tsx`), once. */
export const sourceOf = (file: string): ts.SourceFile => {
  let source = sources.get(file);
  if (!source) {
    source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    sources.set(file, source);
  }
  return source;
};

export interface Declaration {
  expression: ts.Expression;
  file: string;
}

/** What each walk found, by file and name: a declaration, or `null` for none. */
const declarations = new Map<string, Declaration | null>();

/**
 * The initializer of the first `const name = …` of a file, at any depth of its
 * tree, walked for once per file and name. The walk does not depend on how far
 * an import chain reached the file, so `declarationOf`'s depth keeps its
 * meaning: it bounds the imports followed, never a lookup.
 */
const localDeclarationOf = (name: string, file: string): Declaration | null => {
  const key = `${file}\u0000${name}`;
  const known = declarations.get(key);
  if (known !== undefined) return known;
  let found: Declaration | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer) {
      found = { expression: node.initializer, file };
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceOf(file));
  declarations.set(key, found);
  return found;
};

/** The initializer of a top-level or local `const name = …` in a file, or of the export an import names. */
export const declarationOf = (name: string, file: string, depth = 0): Declaration | null => {
  if (depth > 4) return null;
  const found = localDeclarationOf(name, file);
  if (found) return found;
  for (const statement of sourceOf(file).statements) {
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
