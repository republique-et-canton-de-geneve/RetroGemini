import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import type { ActionItem, HealthCheckSession as HealthCheckSessionType, Team, User } from '../types';
import { JIRA_NOTE_STORAGE_KEY } from '../components/jira/JiraDiscoveryNote';
import { statusWith } from './helpers/jiraClientFetch';

/**
 * Finding A-10, against the real data layer. The health check's Review wrote
 * the done toggle and the assignee to the session alone, and every session
 * persist then put the team record's own (stale) values back over them
 * (`dataService.updateHealthCheckSession`). The Dashboard reads the team
 * record, so it kept listing a ticked action as open — and its "Create in
 * Jira" batch offered to send a closed action to Jira. Both now go through
 * the granular action routes first, as the retrospective's Review does.
 */

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(() => 'hc-1'),
    leaveSession: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true)
  }
}));

import { dataService } from '../services/dataService';
import HealthCheckSession from '../components/HealthCheckSession';
import Dashboard from '../components/Dashboard';

const facilitator: User = { id: 'fac', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };

const action = (id: string, text: string): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  linkedTicketId: 'd1'
});

const healthCheck: HealthCheckSessionType = {
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Health Check R2610',
  date: '2026-10-20',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  templateId: 'team_health_en',
  templateName: 'Team health (EN)',
  dimensions: [{ id: 'd1', name: 'Autonomy', goodDescription: 'Good', badDescription: 'Bad' }],
  participants: [facilitator],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: {},
  actions: [action('hc-a1', 'Talk to ops'), action('hc-a2', 'Pair on deploys')],
  discussionFocusId: null,
  roti: {},
  finishedUsers: []
};

const storedTeam: Team = {
  id: 'team-1',
  name: 'Alpha',
  passwordHash: '',
  members: [facilitator],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [healthCheck]
};

// Every request the data layer and the screens send, in order.
let requests: { url: string; body: Record<string, unknown> }[] = [];

const installFetch = () => {
  global.fetch = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = JSON.parse(init?.body || '{}') as Record<string, unknown>;
    requests.push({ url, body });
    let json: unknown = { success: true };
    if (url === '/api/team/restore-session') json = { team: structuredClone(storedTeam) };
    if (url.endsWith('/jira/status')) json = statusWith();
    if (url === '/api/info-message') json = { message: '' };
    if (url === '/api/ai-status') json = { enabled: false };
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }) as unknown as typeof fetch;
};

const cachedAction = (id: string) =>
  dataService.getTeam('team-1')!.healthChecks!.flatMap(h => h.actions).find(a => a.id === id)!;

describe('a done toggle in the health check Review reaches the team record', () => {
  beforeEach(async () => {
    requests = [];
    installFetch();
    window.localStorage.setItem(JIRA_NOTE_STORAGE_KEY, JSON.stringify([facilitator.id]));
    await dataService.restoreSession('token-1');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('is done in the cached team, sent through the action route, and not offered by the Dashboard’s Jira batch', async () => {
    render(
      <HealthCheckSession
        team={structuredClone(dataService.getTeam('team-1')!)}
        currentUser={facilitator}
        sessionId="hc-1"
        onExit={() => {}}
      />
    );
    const row = (await screen.findByText('Talk to ops')).closest('[data-action-id]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Mark action as done' }));

    expect(cachedAction('hc-a1').done).toBe(true);
    expect(cachedAction('hc-a1').closedAt).toEqual(expect.any(String));
    expect(cachedAction('hc-a2').done).toBe(false);

    await dataService.whenPersisted();
    const actionWrite = requests.findIndex(r => r.url === '/api/team/team-1/action' && (r.body.action as ActionItem)?.id === 'hc-a1');
    expect(actionWrite).toBeGreaterThanOrEqual(0);
    expect((requests[actionWrite].body.action as ActionItem).done).toBe(true);
    // The session persist carries the same value, not the old one. That it is
    // sent after the action write here says nothing of the handler's order
    // (see the source test at the end of this file).
    const sessionWrite = requests.findIndex(r => r.url === '/api/team/team-1/healthcheck/hc-1');
    expect(sessionWrite).toBeGreaterThan(actionWrite);
    const persisted = requests[sessionWrite].body.healthCheck as HealthCheckSessionType;
    expect(persisted.actions.find(a => a.id === 'hc-a1')?.done).toBe(true);

    cleanup();
    render(
      <Dashboard
        team={structuredClone(dataService.getTeam('team-1')!)}
        currentUser={facilitator}
        onOpenSession={() => {}}
        onOpenHealthCheck={() => {}}
        onRefresh={() => {}}
      />
    );
    // Only the action still open is offered; the one ticked in Review is not.
    expect(await screen.findByRole('button', { name: 'Create in Jira (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create in Jira, Talk to ops' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Create in Jira, Pair on deploys' })).toBeInTheDocument();
  });

  it('keeps an assignee chosen in Review in the cached team', async () => {
    render(
      <HealthCheckSession
        team={structuredClone(dataService.getTeam('team-1')!)}
        currentUser={facilitator}
        sessionId="hc-1"
        onExit={() => {}}
      />
    );
    fireEvent.change(await screen.findByRole('combobox', { name: 'Assignee for the action: Talk to ops' }), { target: { value: 'fac' } });

    expect(cachedAction('hc-a1').assigneeId).toBe('fac');
    await waitFor(() => expect(requests.some(r => r.url === '/api/team/team-1/action' && (r.body.action as ActionItem)?.assigneeId === 'fac')).toBe(true));
  });

  // The health check never reconciles its session actions with the team
  // record, so an action closed from the Dashboard still shows open here. An
  // assignee change built from that session copy was a whole-action write
  // saying `done: false`: it reopened the action in the record and dropped its
  // closing date for good, and the Dashboard's Jira batch offered it again.
  it('never reopens, with an assignee change, an action the team record has closed', async () => {
    const closedAt = '2026-10-19T09:00:00.000Z';
    const sessionCopy = structuredClone(dataService.getTeam('team-1')!);
    // Closed from the Dashboard: the record knows, the session copy does not.
    Object.assign(cachedAction('hc-a1'), { done: true, closedAt });
    render(<HealthCheckSession team={sessionCopy} currentUser={facilitator} sessionId="hc-1" onExit={() => {}} />);

    fireEvent.change(await screen.findByRole('combobox', { name: 'Assignee for the action: Talk to ops' }), { target: { value: 'fac' } });

    expect(cachedAction('hc-a1')).toMatchObject({ done: true, closedAt, assigneeId: 'fac' });
    await dataService.whenPersisted();
    const actionWrites = requests.filter(r => r.url === '/api/team/team-1/action' && (r.body.action as ActionItem)?.id === 'hc-a1');
    expect(actionWrites).toHaveLength(1);
    expect(actionWrites[0].body.action).toMatchObject({ done: true, closedAt, assigneeId: 'fac' });
  });
});

// Finding A-10's other half: the assignee reaches every browser's cache. A
// participant's cache took each action from the first state that carried it
// and then copied its assignee back over every state received, so their next
// own write (a ROTI vote) persisted the stale assignee over the facilitator's.
describe('a participant’s write keeps the assignee the facilitator chose in Review', () => {
  beforeEach(async () => {
    requests = [];
    installFetch();
    await dataService.restoreSession('token-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists the assignee the last state received carried', async () => {
    const received = structuredClone(healthCheck);
    received.actions = received.actions.map(a => (a.id === 'hc-a1' ? { ...a, assigneeId: 'fac' } : a));
    dataService.applyRemoteHealthCheckSession('team-1', received);
    expect(cachedAction('hc-a1').assigneeId).toBe('fac');

    // The participant's own write, built on that state.
    dataService.updateHealthCheckSession('team-1', { ...structuredClone(received), roti: { 'mem-1': 4 } });
    await dataService.whenPersisted();

    const persists = requests.filter(r => r.url === '/api/team/team-1/healthcheck/hc-1');
    expect(persists.length).toBeGreaterThan(0);
    const persisted = persists.at(-1)!.body.healthCheck as HealthCheckSessionType;
    expect(persisted.actions.find(a => a.id === 'hc-a1')?.assigneeId).toBe('fac');
  });
});

// The step asks for the record to be written before the session (A-10), and
// no screen test can see that order: the session persist runs inside the
// `setSession` updater, which React calls after the handler under jsdom
// whichever of the two calls comes first in it. In production React may run
// that updater inside `setSession` itself, and the persist would then read a
// cache the granular write has not reached yet. So the order is pinned in the
// source, walked with the TypeScript parser (AGENTS.md: never a regular
// expression over JSX); a comment cannot trip it.
describe('the health check Review writes the team record before the session', () => {
  const file = join(__dirname, '..', 'components', 'HealthCheckSession.tsx');
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // The body of `const <name> = (…) => { … }`, wherever it is declared.
  const handlerBody = (name: string): ts.Block | undefined => {
    let body: ts.Block | undefined;
    const visit = (node: ts.Node) => {
      if (body) return;
      if (
        ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
        && node.initializer && ts.isArrowFunction(node.initializer) && ts.isBlock(node.initializer.body)
      ) {
        body = node.initializer.body;
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return body;
  };

  // The index of the first statement of `body` that calls `callee`, or -1.
  const firstStatementCalling = (body: ts.Block, callee: string): number =>
    body.statements.findIndex((statement) => {
      let found = false;
      const visit = (node: ts.Node) => {
        if (found) return;
        if (ts.isCallExpression(node) && node.expression.getText(source) === callee) {
          found = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(statement);
      return found;
    });

  it.each([
    ['setReviewActionDone', 'dataService.toggleGlobalAction'],
    ['setReviewActionAssignee', 'dataService.updateGlobalAction']
  ])('%s calls %s before updateSession', (handler, granularWrite) => {
    const body = handlerBody(handler);
    expect(body, `${handler} not found in HealthCheckSession.tsx`).toBeDefined();
    const recordWrite = firstStatementCalling(body!, granularWrite);
    const sessionWrite = firstStatementCalling(body!, 'updateSession');
    expect(recordWrite).toBeGreaterThanOrEqual(0);
    expect(sessionWrite).toBeGreaterThanOrEqual(0);
    expect(recordWrite).toBeLessThan(sessionWrite);
  });
});
