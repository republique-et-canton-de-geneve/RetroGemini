import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import { DIALOG_OVERLAY_CLASS, DIALOG_PANEL_CLASS } from '../components/common/ModalDialog';

/**
 * One frame for every dialog of the product (the Clarté recipe): a veil of
 * slate-900 at 45% with no blur behind, a white panel with the 2xl radius and
 * a hairline edge. Each screen of the port passed its own classes to
 * ModalDialog, and the console's dialogs kept a black veil and another radius;
 * this reads every call site (with the TypeScript parser) so the next dialog
 * agrees too. The image gallery is the one stated exception: it shows a
 * picture on a darker veil, with no panel around it.
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

interface CallSite { at: string; overlay: string | null; panel: string | null }
const sites: CallSite[] = [];
for (const file of [...walk(join(ROOT, 'components')), join(ROOT, 'App.tsx')]) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'ModalDialog') {
      const literal = (name: string): string | null => {
        const attribute = node.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText(source) === name);
        if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer) return null;
        const init = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer;
        if (init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))) return init.text;
        if (init && ts.isTemplateExpression(init)) return [init.head.text, ...init.templateSpans.map((span) => span.literal.text)].join(' ');
        return null;
      };
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      sites.push({ at: `${relative(ROOT, file)}:${line}`, overlay: literal('overlayClassName'), panel: literal('panelClassName') });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

describe('every dialog takes the one frame', () => {
  it('finds the dialogs of the session, the dashboard and the console', () => {
    expect(sites.length).toBeGreaterThan(15);
  });

  it('the shared default is the recipe', () => {
    expect(tokens(DIALOG_OVERLAY_CLASS)).toContain('bg-slate-900/45');
    expect(tokens(DIALOG_PANEL_CLASS)).toEqual(expect.arrayContaining(['bg-white', 'rounded-2xl', 'border', 'border-slate-200']));
  });

  it('every veil a call site writes is slate-900 at 45%, with no blur', () => {
    const wrong = sites
      .filter((site) => site.overlay !== null && !site.at.startsWith(GALLERY))
      .filter((site) => !tokens(site.overlay!).includes('bg-slate-900/45') || /backdrop-blur/.test(site.overlay!))
      .map((site) => `${site.at}: ${site.overlay}`);
    expect(wrong).toEqual([]);
  });

  it('every white panel a call site writes has the 2xl radius and a hairline edge', () => {
    const wrong = sites
      .filter((site) => site.panel !== null && tokens(site.panel!).includes('bg-white'))
      .filter((site) => {
        const list = tokens(site.panel!);
        return !list.some((t) => /^(sm:)?rounded-2xl$/.test(t)) || !list.includes('border') || !list.includes('border-slate-200');
      })
      .map((site) => `${site.at}: ${site.panel}`);
    expect(wrong).toEqual([]);
  });
});
