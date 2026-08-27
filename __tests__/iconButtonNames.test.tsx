import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import ts from 'typescript';
import TicketCommentsModal from '../components/session/TicketCommentsModal';
import type { Ticket, User } from '../types';

/**
 * Audit H52 — **an icon-only button is named by the icon font's ligature.**
 *
 * `<button title="Delete Team"><span className="material-symbols-outlined">
 * delete</span></button>` is announced as **"delete"**, not as "Delete Team".
 * In the accessible-name algorithm a button's own content wins over its
 * `title`, and no icon span in this repository carried `aria-hidden`, so the
 * ligature *is* the content. The `title` is never reached.
 *
 * **No gate in this repository could report it.** axe passes every one of them,
 * because a name exists — it is simply the wrong one, and no rule can know that
 * "delete" was meant to be a picture rather than a word. `jsx-a11y` passes for
 * the same reason. That is why the guard below is a *source* check: it encodes
 * the one thing the automated rules cannot, which is that a Material Symbols
 * ligature is not a name.
 *
 * **Why the scan is an AST walk and not a regular expression.** The two earlier
 * measurements of this finding (8, then H52's own recorded 17) were both wrong,
 * and identically so: each matched a button's opening tag with `<button[^>]*>`,
 * which stops at the first `>` — and nearly every button here has
 * `onClick={() => …}`, whose arrow contains one. The attributes then leaked into
 * what the script believed was the button's *content*, so a button was read as
 * "has text" because its class names have letters in them. The real number is
 * **72**. A regex over JSX also silently lost three buttons entirely. The
 * TypeScript parser is already a dependency; there is no reason to guess.
 */

const REPO_ROOT = join(__dirname, '..');

/** Every `.tsx` under a directory, repo-relative. */
const tsxFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFilesUnder(full);
    return entry.name.endsWith('.tsx') ? [relative(REPO_ROOT, full)] : [];
  });

interface IconButton {
  file: string;
  line: number;
  /** `ligature`: named by the icon font. `nameless`: no accessible name at all. */
  reason: 'ligature' | 'nameless';
}

const attributeOf = (node: ts.JsxElement | ts.JsxSelfClosingElement, name: string) => {
  const attributes = ts.isJsxSelfClosingElement(node) ? node.attributes : node.openingElement.attributes;
  return attributes.properties.find(
    (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === name,
  );
};

const tagNameOf = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
  (ts.isJsxSelfClosingElement(node) ? node.tagName : node.openingElement.tagName).getText();

/** A Material Symbols span — the element whose text content is a ligature. */
const isIconSpan = (node: ts.Node): boolean => {
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return false;
  if (tagNameOf(node) !== 'span') return false;
  const className = attributeOf(node, 'className');
  return !!className?.initializer?.getText().includes('material-symbols-outlined');
};

/**
 * Does this node render anything a screen reader would announce, other than an
 * icon ligature? Icon spans are skipped whole — their ligature is exactly what
 * must not count as a name.
 */
const rendersNonIconContent = (node: ts.Node): boolean => {
  if (isIconSpan(node)) return false;
  if (ts.isJsxText(node)) return node.text.trim().length > 0;
  if (ts.isJsxElement(node)) return node.children.some(rendersNonIconContent);
  if (ts.isJsxFragment(node)) return node.children.some(rendersNonIconContent);
  // A component or a void element (<Badge />, <img />) renders something.
  if (ts.isJsxSelfClosingElement(node)) return true;
  if (ts.isJsxExpression(node)) return !!node.expression && expressionRendersNonIcon(node.expression);
  return false;
};

/** Look through the JSX-in-expression shapes this codebase uses. */
const expressionRendersNonIcon = (expr: ts.Expression): boolean => {
  if (ts.isParenthesizedExpression(expr)) return expressionRendersNonIcon(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    return expressionRendersNonIcon(expr.whenTrue) || expressionRendersNonIcon(expr.whenFalse);
  }
  if (ts.isBinaryExpression(expr)) {
    // `{ready && <X/>}` renders only the right side; `{a || b}` may render either.
    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return expressionRendersNonIcon(expr.right);
    }
    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return expressionRendersNonIcon(expr.left) || expressionRendersNonIcon(expr.right);
    }
    return true;
  }
  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr) || ts.isJsxFragment(expr)) {
    return rendersNonIconContent(expr);
  }
  // An identifier, a call, a template string: it renders text.
  return true;
};

/**
 * Walks every `<button>` in the product and returns the ones a screen reader
 * cannot announce usefully, in two families:
 *
 *  - **`ligature`** — the button's only content is icon spans, so its
 *    accessible name is the ligature. `title` does not help: content wins.
 *  - **`nameless`** — the button renders nothing at all (a toggle switch whose
 *    only child is a knob `<span>`) and carries no `aria-label`, no
 *    `aria-labelledby` and no `title`, so it has **no** accessible name. Here
 *    `title` *is* accepted, because with no content it is the last resort the
 *    accessible-name algorithm actually reaches — the same rule that condemns
 *    the family above is what rescues this one.
 */
const findUnnamedButtons = (): IconButton[] => {
  const files = ['App.tsx', ...tsxFilesUnder(join(REPO_ROOT, 'components'))].sort();

  const found: IconButton[] = [];
  for (const file of files) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    if (!source.includes('<button')) continue;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visit = (node: ts.Node) => {
      if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && tagNameOf(node) === 'button') {
        const named = !!(attributeOf(node, 'aria-label') || attributeOf(node, 'aria-labelledby'));
        const children = ts.isJsxElement(node) ? node.children : [];
        const hasIcon = children.some(hasIconSpan);
        const hasOtherContent = children.some(rendersNonIconContent);
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

        if (!named && hasIcon && !hasOtherContent) {
          found.push({ file, line, reason: 'ligature' });
        } else if (!named && !hasIcon && !hasOtherContent && !attributeOf(node, 'title')) {
          found.push({ file, line, reason: 'nameless' });
        }
      }
      node.forEachChild(visit);
    };
    visit(sourceFile);
  }
  return found;
};

/** Is there an icon span anywhere under this node? */
const hasIconSpan = (node: ts.Node): boolean => {
  if (isIconSpan(node)) return true;
  let found = false;
  node.forEachChild(child => {
    if (!found && hasIconSpan(child)) found = true;
  });
  return found;
};

describe('H52 — icon-only buttons must not be named by their ligature', () => {
  it('leaves no button whose accessible name is a Material Symbols ligature', () => {
    const offenders = findUnnamedButtons().filter(o => o.reason === 'ligature');
    const report = offenders.map(o => `${o.file}:${o.line}`).join('\n');
    expect(report, `Icon-only buttons with no aria-label:\n${report}`).toBe('');
  });

  it('leaves no button with no accessible name at all', () => {
    // Found while measuring the family above: the health check's "Anonymous
    // mode" switch renders only its knob `<span>` and had no `title` either,
    // so it announced as "button" and nothing else. Its twin on the New
    // Retrospective dialog, 250 lines up, has carried an `aria-label` all
    // along. axe would report this one — it never saw it, because that dialog
    // is not among the nine screens `e2e/accessibility-audit.spec.ts` walks.
    const offenders = findUnnamedButtons().filter(o => o.reason === 'nameless');
    const report = offenders.map(o => `${o.file}:${o.line}`).join('\n');
    expect(report, `Buttons with no accessible name:\n${report}`).toBe('');
  });

  it('is not vacuous — the scan does find buttons to check', () => {
    // If a refactor ever stops the walker from seeing buttons at all, the guard
    // above would pass by finding nothing. Pin that it is looking at something.
    const source = readFileSync(join(REPO_ROOT, 'components/Dashboard.tsx'), 'utf8');
    const sourceFile = ts.createSourceFile('d.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let buttons = 0;
    const visit = (node: ts.Node) => {
      if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && tagNameOf(node) === 'button') buttons++;
      node.forEachChild(visit);
    };
    visit(sourceFile);
    expect(buttons).toBeGreaterThan(50);
  });
});

/**
 * The source guard proves the attribute is present. These prove the *browser*
 * then computes the name from it — the assertion H52 was found by, which a
 * `title` cannot satisfy.
 */
describe('H52 — the computed accessible name, in a rendered component', () => {
  const currentUser: User = { id: 'u1', name: 'Ada', color: '#6366F1', role: 'facilitator' };
  const other: User = { id: 'u2', name: 'Grace', color: '#10B981', role: 'participant' };
  const ticket: Ticket = {
    id: 't1',
    colId: 'c1',
    text: 'Deploys are slow',
    authorId: 'u1',
    groupId: null,
    votes: [],
    comments: [
      {
        id: 'c-1',
        authorId: 'u1',
        authorName: 'Ada',
        text: 'Agreed',
        createdAt: '2026-08-27T09:00:00.000Z',
      },
    ],
  };

  const renderModal = () =>
    render(
      <TicketCommentsModal
        ticket={ticket}
        currentUser={currentUser}
        participants={[currentUser, other]}
        isFacilitator
        onAddComment={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
        onClose={vi.fn()}
        cardBgHex={null}
        cardTextColor="#0f172a"
        isAnonymous={false}
      />,
    );

  it.each([
    ['close', /close/i],
    ['send', /send|post|add comment/i],
    ['edit comment', /edit comment/i],
    ['delete comment', /delete comment/i],
  ])('names the %s control by what it does, not by its ligature', (_label, name) => {
    renderModal();
    expect(screen.getByRole('button', { name })).toBeTruthy();
  });

  it('announces no button as a bare ligature', () => {
    renderModal();
    const ligatures = ['close', 'send', 'edit', 'delete', 'check', 'cancel'];
    for (const button of screen.getAllByRole('button')) {
      const name = (button.textContent || '').trim();
      // The visible content may still be the ligature (the icon font renders
      // it as a glyph); what must not happen is that content *being* the name.
      const accessibleName = button.getAttribute('aria-label') || name;
      expect(ligatures).not.toContain(accessibleName.toLowerCase());
    }
  });
});
