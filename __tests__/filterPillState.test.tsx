import React from 'react';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import ts from 'typescript';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardActionsTab from '../components/dashboard/DashboardActionsTab';
import TeamFeedback from '../components/TeamFeedback';
import SuperAdmin from '../components/SuperAdmin';
import type { Team, TeamFeedback as TeamFeedbackType, User } from '../types';

/**
 * A filter pill says which filter is on as a state, not only as a colour
 * (WCAG 4.1.2; AGENTS.md, *Accessibility*: a button that selects one option
 * among several carries `aria-pressed`). The pills of the Dashboard's Actions
 * tab, of the Feedback Hub and of the console's feedback tab were drawn chosen
 * by their look alone, so a screen reader heard "All (12), button" and could
 * not tell which list was shown.
 *
 * The guard reads every element whose classes choose the look's chosen pill,
 * `FILTER_PILL_ON` (components/dashboard/dashboardLook.ts), with the
 * TypeScript parser, through constants and class-building arrows and under
 * an alias too, and requires `aria-pressed` of it. The status pills of the
 * Hub and the console are drawn in classes of their own, so they are held by
 * the renders below.
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

const FILES = [...walk(join(ROOT, 'components')), join(ROOT, 'App.tsx')];

const sources = new Map<string, ts.SourceFile>();
const sourceOf = (file: string): ts.SourceFile => {
  let source = sources.get(file);
  if (!source) {
    source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    sources.set(file, source);
  }
  return source;
};

/** The initializer of a `const name = …` in a file, or of the export a relative import names. */
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

const PILL_ON = declarationOf('FILTER_PILL_ON', join(ROOT, 'components/dashboard/dashboardLook.ts'))!.expression;

/** Whether a class expression reaches FILTER_PILL_ON's declaration: by its name, an alias, a constant or a local arrow. */
const choosesPillOn = (node: ts.Node, file: string, depth = 0): boolean => {
  if (depth > 12) return false;
  if (ts.isIdentifier(node)) {
    const declared = declarationOf(node.text, file);
    if (!declared) return false;
    if (declared.expression === PILL_ON) return true;
    const { expression } = declared;
    const body = ts.isArrowFunction(expression) || ts.isFunctionExpression(expression) ? expression.body : expression;
    return choosesPillOn(body, declared.file, depth + 1);
  }
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && choosesPillOn(child, file, depth + 1)) found = true;
  });
  return found;
};

const pills: Array<{ at: string; pressed: boolean }> = [];
for (const file of FILES) {
  const source = sourceOf(file);
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attribute = (name: string) =>
        node.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(source) === name);
      const className = attribute('className');
      if (className?.initializer && choosesPillOn(className.initializer, file)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        pills.push({ at: `${relative(ROOT, file)}:${line}`, pressed: !!attribute('aria-pressed') });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

describe('a filter pill drawn with FILTER_PILL_ON', () => {
  it('is found on the three screens that filter a list', () => {
    const files = new Set(pills.map((pill) => pill.at.replace(/:\d+$/, '')));
    expect([...files].sort()).toEqual(['components/SuperAdmin.tsx', 'components/TeamFeedback.tsx', 'components/dashboard/DashboardActionsTab.tsx']);
    // The Actions tab's three are one mapped element; the Hub and the console write four each.
    expect(pills.length).toBeGreaterThanOrEqual(9);
  });

  it('carries aria-pressed', () => {
    expect(pills.filter((pill) => !pill.pressed).map((pill) => pill.at)).toEqual([]);
  });
});

/** The pressed state of each button of a row, by its name. */
const pressedIn = (row: HTMLElement) =>
  Object.fromEntries(within(row).getAllByRole('button').map((button) => [button.textContent?.trim(), button.getAttribute('aria-pressed')]));

describe("the Dashboard's Actions tab", () => {
  const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
  const team: Team = { id: 'team-1', name: 'Team', passwordHash: 'hash', members: [facilitator], customTemplates: [], retrospectives: [], globalActions: [] };

  it('presses the filter that is on, and only it', () => {
    render(
      <DashboardActionsTab
        team={team}
        knownMembers={[facilitator]}
        actionFilter="CLOSED"
        onActionFilterChange={vi.fn()}
        newActionText=""
        onNewActionTextChange={vi.fn()}
        newActionAssignee=""
        onNewActionAssigneeChange={vi.fn()}
        onCreateAction={vi.fn()}
        onToggleAction={vi.fn()}
        onUpdateActionText={vi.fn()}
        onUpdateAssignee={vi.fn()}
        filteredActions={[]}
      />
    );
    const row = screen.getByRole('button', { name: 'Closed' }).parentElement as HTMLElement;
    expect(pressedIn(row)).toEqual({ Open: 'false', Closed: 'true', All: 'false' });
  });
});

const feedback = (id: string, type: TeamFeedbackType['type'], status: TeamFeedbackType['status'], teamId: string): TeamFeedbackType => ({
  id,
  teamId,
  teamName: teamId === 'team-1' ? 'Team One' : 'Team Two',
  type,
  title: `Feedback ${id}`,
  description: 'Something to say.',
  submittedBy: 'user-1',
  submittedByName: 'User One',
  submittedAt: '2026-11-01T10:00:00.000Z',
  isRead: id !== 'f1',
  status,
  comments: []
});

const FEEDBACKS: TeamFeedbackType[] = [
  feedback('f1', 'bug', 'pending', 'team-1'),
  feedback('f2', 'feature', 'in_progress', 'team-2'),
  feedback('f3', 'bug', 'resolved', 'team-1'),
  feedback('f4', 'feature', 'rejected', 'team-2')
];

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('the Feedback Hub', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ feedbacks: FEEDBACKS }) })) as never;
  });

  it('presses the type and the status that are on, and moves the press with a click', async () => {
    render(
      <TeamFeedback
        teamId="team-1"
        teamName="Team One"
        teamPassword="pw"
        sessionToken="token"
        currentUserId="user-1"
        currentUserName="User One"
        onSubmitFeedback={vi.fn()}
        onRefresh={vi.fn()}
      />
    );
    await screen.findByText('Feedback f1');
    const statusRow = screen.getByText('Status:').parentElement as HTMLElement;
    const typeRow = statusRow.previousElementSibling as HTMLElement;

    expect(pressedIn(typeRow)).toEqual({ 'All (4)': 'true', 'My Team (2)': 'false', 'Bugs (2)': 'false', 'Features (2)': 'false' });
    expect(pressedIn(statusRow)).toEqual({ All: 'true', Pending: 'false', 'In Progress': 'false', Resolved: 'false', Rejected: 'false' });

    fireEvent.click(within(typeRow).getByRole('button', { name: 'Bugs (2)' }));
    fireEvent.click(within(statusRow).getByRole('button', { name: 'Resolved' }));
    expect(pressedIn(typeRow)).toEqual({ 'All (4)': 'false', 'My Team (2)': 'false', 'Bugs (2)': 'true', 'Features (2)': 'false' });
    expect(pressedIn(statusRow)).toEqual({ All: 'false', Pending: 'false', 'In Progress': 'false', Resolved: 'true', Rejected: 'false' });
  });
});

describe("the console's feedback tab", () => {
  beforeEach(() => {
    const replies: Record<string, unknown> = {
      '/api/super-admin/teams': { teams: [] },
      '/api/super-admin/feedbacks': { feedbacks: FEEDBACKS },
    };
    globalThis.fetch = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => replies[url] ?? {} })) as never;
  });

  it('presses the type and the status that are on, and moves the press with a click', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Feedback \(4\)/ }));
    await screen.findByText('Feedback f1');
    const statusRow = screen.getByText('Status:').parentElement as HTMLElement;
    const typeRow = statusRow.previousElementSibling as HTMLElement;

    expect(pressedIn(typeRow)).toEqual({ 'All (4)': 'true', 'Unread (1)': 'false', 'Bugs (2)': 'false', 'Features (2)': 'false' });
    expect(pressedIn(statusRow)).toEqual({ 'All (4)': 'true', 'Pending (1)': 'false', 'In Progress (1)': 'false', 'Resolved (1)': 'false', 'Rejected (1)': 'false' });

    fireEvent.click(within(typeRow).getByRole('button', { name: 'Unread (1)' }));
    fireEvent.click(within(statusRow).getByRole('button', { name: 'Pending (1)' }));
    expect(pressedIn(typeRow)).toEqual({ 'All (4)': 'false', 'Unread (1)': 'true', 'Bugs (2)': 'false', 'Features (2)': 'false' });
    expect(pressedIn(statusRow)).toEqual({ 'All (4)': 'false', 'Pending (1)': 'true', 'In Progress (1)': 'false', 'Resolved (1)': 'false', 'Rejected (1)': 'false' });
  });
});
