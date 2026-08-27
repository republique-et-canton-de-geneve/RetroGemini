import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import Dashboard from '../components/Dashboard';
import type { Team, User, RetroSession } from '../types';

/**
 * Audit H42, remaining gap (lot L23) — **the 17 `autoFocus` attributes, judged.**
 *
 * `jsx-a11y/no-autofocus` warns about focus moving without the user asking for
 * it: a page loads, focus jumps, and someone using a screen reader has lost
 * their place. Every one of the seventeen in this product is the *opposite*
 * case — the user clicked something, and the thing they clicked stopped
 * existing:
 *
 *  1. **An inline editor replacing its own trigger** (rename a retrospective or
 *     a health check, edit a ticket, a comment, an action, a team name, an
 *     email, a password — eleven sites). The "edit" button unmounts as the
 *     field appears. Remove `autoFocus` and focus falls back to `<body>`:
 *     the keyboard user is dropped at the top of the document and has to tab
 *     back through the whole page. That is WCAG 2.4.3, so the attribute is
 *     fixing an accessibility defect rather than causing one.
 *  2. **A view swapped in by a click** (TeamLogin's create / login / join /
 *     super-admin screens — four sites). Same shape: the button that navigated
 *     is gone with the view it was on.
 *  3. **A panel that has just opened** (the delete-team confirmation, the icon
 *     picker — two sites). `ModalDialog` already moves focus into the panel;
 *     `autoFocus` only decides *which* control, which its own comment says is
 *     the better-informed choice.
 *
 * So all seventeen stay, each with the reason written at the site. This suite
 * is what makes that defensible: it pins the **behaviour** (focus lands on the
 * field), not the attribute — so replacing `autoFocus` with a ref and a
 * `.focus()` call still passes, while deleting it to please the linter fails.
 *
 * It also guards the mistake made while writing those comments: a
 * `// eslint-disable-next-line` placed before a single-line JSX element is not
 * a comment at all, it is text, and React renders it on the page. Two of them
 * were. Nothing else in the suite would have noticed.
 */

const retro = {
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 169',
  date: '2026-02-17',
  status: 'CLOSED',
  phase: 'CLOSE',
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: []
} as unknown as RetroSession;

const team = {
  id: 'team-1',
  name: 'Alpha Team',
  passwordHash: 'hash',
  members: [{ id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' }],
  customTemplates: [],
  retrospectives: [retro],
  healthChecks: [],
  globalActions: []
} as unknown as Team;

const facilitator: User = { id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' };

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => [
        { id: 'team-1', name: 'Alpha Team', memberCount: 1, lastConnectionDate: null }
      ]),
      getTeamMembers: vi.fn(async () => team.members),
      loadTeam: vi.fn(async () => team),
      getAuthenticatedTeamId: vi.fn(() => 'team-1'),
      getAuthenticatedPassword: vi.fn(() => 'existing-password'),
      getSessionToken: vi.fn(() => 'session-token'),
      getPresets: vi.fn(() => []),
      getHealthCheckTemplates: vi.fn(() => []),
      hasStoredPassword: vi.fn(() => true)
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(
    async () => ({ ok: true, json: async () => ({ infoMessage: '', feedbacks: [] }) }) as unknown as Response
  ) as unknown as typeof fetch;
});

const renderDashboard = (initialTab: 'ACTIONS' | 'RETROS') =>
  render(
    <Dashboard
      team={team}
      currentUser={facilitator}
      onOpenSession={vi.fn()}
      onOpenHealthCheck={vi.fn()}
      onRefresh={vi.fn()}
      onDeleteTeam={vi.fn()}
      initialTab={initialTab}
    />
  );

describe('L23 — focus follows the control the user destroyed', () => {
  it('puts focus in the rename field, because the rename button is gone', async () => {
    renderDashboard('RETROS');

    fireEvent.click(screen.getByTitle('Rename retrospective'));

    const field = await screen.findByDisplayValue('Sprint 169');
    // Without the attribute this is <body>, and the keyboard user is at the
    // top of the document with the field they asked for out of reach.
    expect(document.activeElement).toBe(field);
  });

  it('puts focus in the team-creation field, because the button that opened it is gone', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('+ New Team')).toBeTruthy());

    fireEvent.click(screen.getByText('+ New Team'));

    expect(document.activeElement).toBe(screen.getByLabelText('Team Name'));
  });

  it('lets a dialog choose its own field rather than taking ModalDialog default', async () => {
    renderDashboard('ACTIONS');

    fireEvent.click(screen.getByTitle('Delete Team'));

    // ModalDialog focuses the first focusable control in the panel unless the
    // content claimed focus itself. Here that is the confirmation box, which
    // is the only thing the user can usefully do next.
    const confirm = await screen.findByPlaceholderText('Type team name here');
    await waitFor(() => expect(document.activeElement).toBe(confirm));
  });
});

describe('L23 — a lint directive is never rendered to the user', () => {
  it('keeps the justification comments out of the page', async () => {
    const { container } = render(<TeamLogin onLogin={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('+ New Team')).toBeTruthy());

    fireEvent.click(screen.getByText('+ New Team'));
    expect(container.textContent).not.toContain('eslint-disable');

    fireEvent.click(screen.getByText('Back'));
    fireEvent.click(await screen.findByRole('button', { name: /Alpha Team/ }));
    expect(container.textContent).not.toContain('eslint-disable');
  });
});
