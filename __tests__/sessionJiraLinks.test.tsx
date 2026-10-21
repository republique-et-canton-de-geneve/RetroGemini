import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionItem, JiraLink, RetroSession, Team, User } from '../types';
import { JIRA_NOTE_STORAGE_KEY } from '../components/jira/JiraDiscoveryNote';
import { statusWith } from './helpers/jiraClientFetch';

/**
 * Session.tsx rebuilds the session's action copies from the team record in
 * four places: when the retro opens, on the first state the server sends, and
 * when the facilitator enters Open Actions or Review. The record is the
 * authority for `done`, the assignee and the text, but not for a Jira link:
 * the server patches the live session row with the key, and a participant's
 * cache never learns it (finding A-5). Each rebuild must therefore carry the
 * link from whichever copy knows it — and never write a snapshot that has
 * lost one, since that snapshot is where everyone else reads it.
 */

const mocks = vi.hoisted(() => ({
  cache: null as Team | null,
  deliver: null as ((session: unknown) => void) | null,
  // Every connection-change subscriber, so a test can drop and restore the socket.
  connection: [] as ((connected: boolean) => void)[],
  issues: [] as { actionIds: string[]; sessionId?: string }[]
}));

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => mocks.cache),
    updateSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteSession: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    deleteAction: vi.fn(),
    resetActionImpactRatings: vi.fn(),
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null,
    whenPersisted: async () => {},
    // What the real one does to the cache, for the copies these tests hold.
    applyJiraLinks: (_teamId: string, links: { actionId: string; jira: JiraLink }[]) => {
      const team = mocks.cache;
      if (!team) return;
      const apply = (actions: ActionItem[]) => actions.map(a => {
        const link = links.find(l => l.actionId === a.id);
        return link ? { ...a, jira: link.jira } : a;
      });
      team.globalActions = apply(team.globalActions);
      team.retrospectives.forEach(r => { r.actions = apply(r.actions); });
    }
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(() => 'retro-2'),
    onSessionUpdate: vi.fn((callback: (session: unknown) => void) => {
      mocks.deliver = callback;
      return () => {};
    }),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn((callback: (connected: boolean) => void) => {
      mocks.connection.push(callback);
      return () => {};
    }),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true)
  }
}));

import Session from '../components/Session';
import { syncService } from '../services/syncService';

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const TEAM_9: JiraLink = { key: 'TEAM-9', createdAt: '2026-10-20T10:00:00.000Z' };
const TEAM_10: JiraLink = { key: 'TEAM-10', createdAt: '2026-10-20T10:00:00.000Z' };

const action = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const retro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-2',
  teamId: 'team-1',
  name: retroName,
  date: '2026-10-20',
  status: 'IN_PROGRESS',
  phase: 'REVIEW',
  participants: [facilitator],
  discussionFocusId: null,
  icebreakerQuestion: '',
  templateLanguage: 'en',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [action('new-1', 'Fix the build')],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: 3,
  ...overrides
});

const previousRetro = (actions: ActionItem[]): RetroSession => retro({
  id: 'retro-1',
  name: 'Sprint 12',
  date: '2026-10-06',
  status: 'CLOSED',
  phase: 'CLOSE',
  actions
});

const teamWith = (current: RetroSession, previous: ActionItem[]): Team => ({
  id: 'team-1',
  name: 'Alpha',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [current, previousRetro(previous)],
  globalActions: [],
  // The closed-action round is not what these tests are about.
  actionImpactRatingEnabled: false
});

const installFetch = () => {
  global.fetch = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = JSON.parse(init?.body || '{}') as { actionIds?: string[]; sessionId?: string };
    let json: unknown = { enabled: false };
    if (url.endsWith('/jira/status')) json = statusWith();
    if (url.endsWith('/jira/issues')) {
      mocks.issues.push({ actionIds: body.actionIds ?? [], sessionId: body.sessionId });
      json = { results: (body.actionIds ?? []).map(actionId => ({ actionId, status: 'created', key: 'TEAM-9' })), remaining: [] };
    }
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }) as unknown as typeof fetch;
};

// Each test names its retro, and only that retro's writes count: a facilitator
// re-sends the session half a second after opening it (Session.tsx), a timer
// that outlives the test that started it.
let retroName = '';
let testCount = 0;

const writes = (): RetroSession[] =>
  vi.mocked(syncService.updateSession).mock.calls
    .map(([blob]) => blob as RetroSession)
    .filter(blob => blob.name === retroName);

const lastWrite = (): RetroSession | undefined => writes().at(-1);

const statusReads = () =>
  vi.mocked(global.fetch).mock.calls.filter(([input]) => String(input).endsWith('/jira/status')).length;

// `cache` is what dataService holds; `team` what App passed when the session
// opened, the same unless a test says otherwise.
const renderSession = (session: RetroSession, cache: Team, team: Team = structuredClone(cache)) => {
  mocks.cache = cache;
  return render(
    <Session team={team} sessionId={session.id} currentUser={facilitator} onExit={() => {}} />
  );
};

describe('Session.tsx keeps every Jira link a copy of the action knows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.issues = [];
    mocks.deliver = null;
    mocks.connection = [];
    testCount += 1;
    retroName = `Sprint ${testCount}`;
    // The facilitator has already read the note.
    window.localStorage.setItem(JIRA_NOTE_STORAGE_KEY, JSON.stringify([facilitator.id]));
    installFetch();
  });

  it('keeps the link the history snapshot holds when the Review rebuild finds none in the cache', async () => {
    const session = retro({ historyActionsSnapshot: [action('old-1', 'Write the runbook', { jira: TEAM_9 })] });
    // The cache never learned the key, and holds one more open action.
    const cache = teamWith(session, [action('old-1', 'Write the runbook'), action('old-2', 'Pair on deploys')]);
    renderSession(session, cache);

    await waitFor(() => expect(lastWrite()?.historyActionsSnapshot?.map(a => a.id)).toEqual(['old-1', 'old-2']));
    expect(lastWrite()!.historyActionsSnapshot![0].jira).toEqual(TEAM_9);
  });

  it('keeps the link the Open Actions snapshot holds when the rebuild finds none in the cache', async () => {
    const session = retro({
      phase: 'OPEN_ACTIONS',
      openActionsSnapshot: [action('old-1', 'Write the runbook', { jira: TEAM_9 })]
    });
    const cache = teamWith(session, [action('old-1', 'Write the runbook')]);
    renderSession(session, cache);

    await waitFor(() => expect(lastWrite()?.openActionsSnapshot?.length).toBe(1));
    expect(lastWrite()!.openActionsSnapshot![0].jira).toEqual(TEAM_9);
  });

  it('brings the cache’s link onto the session’s own copy when the retro opens', async () => {
    const session = retro({ actions: [action('new-1', 'Fix the build')] });
    const team = teamWith(session, []);
    // This browser created the issue since App last read the team, and the
    // live row has not been patched yet: only the cache knows the key.
    const cache = structuredClone(team);
    cache.retrospectives[0].actions = [action('new-1', 'Fix the build', { jira: TEAM_10 })];
    renderSession(session, cache, team);

    fireEvent.change(await screen.findByPlaceholderText(/summary/i), { target: { value: 'We shipped.' } });
    expect(lastWrite()?.reviewSummary).toBe('We shipped.');
    expect(lastWrite()!.actions[0].jira).toEqual(TEAM_10);
  });

  it('brings the cache’s link onto the first state the server sends', async () => {
    const session = retro({
      actions: [action('new-1', 'Fix the build')],
      historyActionsSnapshot: [action('old-1', 'Write the runbook')]
    });
    const team = teamWith(session, [action('old-1', 'Write the runbook')]);
    const cache = teamWith(session, [action('old-1', 'Write the runbook', { jira: TEAM_9 })]);
    cache.retrospectives[0] = { ...cache.retrospectives[0], actions: [action('new-1', 'Fix the build', { jira: TEAM_10 })] };
    renderSession(session, cache, team);
    await waitFor(() => expect(mocks.deliver).not.toBeNull());

    // The server's row, without either link.
    act(() => {
      mocks.deliver!(retro({
        actions: [action('new-1', 'Fix the build')],
        historyActionsSnapshot: [action('old-1', 'Write the runbook')],
        _rev: 4
      }));
    });
    fireEvent.change(await screen.findByPlaceholderText(/summary/i), { target: { value: 'We shipped.' } });

    const written = lastWrite()!;
    expect(written.reviewSummary).toBe('We shipped.');
    expect(written.actions[0].jira).toEqual(TEAM_10);
    expect(written.historyActionsSnapshot?.find(a => a.id === 'old-1')?.jira).toEqual(TEAM_9);
  });

  it('keeps the links the first state the server sends carries, when the cache never learned them', async () => {
    // A participant's case: the server patched the live row, this cache was
    // not told (only the browser that clicked learns the keys).
    const session = retro({
      actions: [action('new-1', 'Fix the build')],
      historyActionsSnapshot: [action('old-1', 'Write the runbook')]
    });
    const cache = teamWith(session, [action('old-1', 'Write the runbook')]);
    renderSession(session, cache);
    await waitFor(() => expect(mocks.deliver).not.toBeNull());

    act(() => {
      mocks.deliver!(retro({
        actions: [action('new-1', 'Fix the build', { jira: TEAM_10 })],
        historyActionsSnapshot: [action('old-1', 'Write the runbook', { jira: TEAM_9 })],
        _rev: 4
      }));
    });
    fireEvent.change(await screen.findByPlaceholderText(/summary/i), { target: { value: 'We shipped.' } });

    // The next write carries both links: written without them, it would
    // erase them from the shared row for everyone.
    const written = lastWrite()!;
    expect(written.reviewSummary).toBe('We shipped.');
    expect(written.actions[0].jira).toEqual(TEAM_10);
    expect(written.historyActionsSnapshot?.find(a => a.id === 'old-1')?.jira).toEqual(TEAM_9);
    expect(screen.queryByRole('button', { name: 'Create in Jira, Fix the build' })).toBeNull();
  });

  it('has the Review step read the Jira status again when the session reconnects', async () => {
    const session = retro();
    renderSession(session, teamWith(session, []));
    await waitFor(() => expect(statusReads()).toBe(1));

    act(() => mocks.connection.forEach(callback => callback(false)));
    act(() => mocks.connection.forEach(callback => callback(true)));

    await waitFor(() => expect(statusReads()).toBeGreaterThan(1));
  });

  it('writes the history snapshot again when a creation only added a link, so participants see it', async () => {
    const session = retro({ historyActionsSnapshot: [action('old-1', 'Write the runbook')] });
    const cache = teamWith(session, [action('old-1', 'Write the runbook')]);
    renderSession(session, cache);

    fireEvent.click(await screen.findByRole('button', { name: 'Create in Jira, Write the runbook' }));
    expect(await screen.findByRole('link', { name: 'TEAM-9, open in Jira (new tab)' })).toBeInTheDocument();
    expect(mocks.issues).toEqual([{ actionIds: ['old-1'], sessionId: 'retro-2' }]);

    // The ids did not change; only the link did, and the rebuild counts it.
    // Any write, not the last: the facilitator's re-send of the session as it
    // was opened (Session.tsx, 500 ms after mount) can land after this one.
    const keyOf = (link: JiraLink | undefined) => (link && 'key' in link ? link.key : undefined);
    await waitFor(() => expect(writes().some(w => keyOf(w.historyActionsSnapshot?.[0]?.jira) === 'TEAM-9')).toBe(true));
  });
});
