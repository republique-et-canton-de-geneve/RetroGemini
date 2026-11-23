import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import DashboardTabs, { type DashboardTab } from '../components/dashboard/DashboardTabs';
import SessionHeader from '../components/session/SessionHeader';
import SuperAdmin from '../components/SuperAdmin';
import HealthCheckSession from '../components/HealthCheckSession';
import LanguageProvider from '../i18n/LanguageProvider';
import { HealthCheckSession as HealthCheckSessionType, RetroSession, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

/**
 * The current item of a set says so as a state, not only by its look
 * (AGENTS.md → Accessibility, "a choice that stays chosen says so as a
 * state"): the Dashboard's tab and the console's carry `aria-current="page"`,
 * the phase a session is in carries `aria-current="step"`, in the
 * retrospective's header and the health check's alike. Each was marked by its
 * `active` class alone, so a screen reader heard every tab and every phase as
 * the same button. No role and no name changes: every query by role and name
 * of the screens, and of the e2e suite, reads them as before.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
    getSessionToken: vi.fn(() => null),
    getAuthenticatedPassword: vi.fn(() => null),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(),
    leaveSession: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true),
  },
}));

const facilitator: User = { id: 'fac', name: 'Claire', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'a', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

/** A button's words as a screen reader reads them: its text, less what is hidden from it (an icon's ligature). */
const nameOf = (button: HTMLElement): string => {
  const copy = button.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden) => hidden.remove());
  return copy.textContent?.replace(/\s+/g, ' ').trim() ?? '';
};

/** What each button of a set says it is: its name, and its `aria-current`. */
const marks = (buttons: HTMLElement[]) => buttons.map((button) => [nameOf(button), button.getAttribute('aria-current')]);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => cleanup());

describe('the Dashboard’s tabs', () => {
  const Tabs: React.FC<{ first: DashboardTab }> = ({ first }) => {
    const [tab, setTab] = useState<DashboardTab>(first);
    return <DashboardTabs activeTab={tab} onChange={setTab} />;
  };

  it.each(['en', 'fr'] as const)('mark the current tab as the current page, and move the mark with it (%s)', (language) => {
    render(<LanguageProvider initialLanguage={language}><Tabs first="RETROS" /></LanguageProvider>);
    const tabs = screen.getAllByRole('button');
    const retros = language === 'en' ? 'Retrospectives' : 'Rétrospectives';
    const members = language === 'en' ? 'Members' : 'Membres';
    const only = (name: string) => tabs.map((tab) => [nameOf(tab), nameOf(tab) === name ? 'page' : null]);
    expect(tabs.map(nameOf)).toHaveLength(6);
    expect(tabs.map(nameOf)).toContain(retros);
    expect(marks(tabs)).toEqual(only(retros));
    expect(screen.getByRole('button', { name: retros })).toHaveClass('active');

    fireEvent.click(screen.getByRole('button', { name: members }));
    expect(marks(tabs)).toEqual(only(members));
    expect(marks(tabs).filter(([, current]) => current === 'page')).toEqual([[members, 'page']]);
    expect(screen.getByRole('button', { name: members })).toHaveClass('active');
  });
});

describe('the console’s tabs', () => {
  beforeEach(() => {
    const replies: Record<string, unknown> = {
      '/api/super-admin/teams': { teams: [] },
      '/api/super-admin/feedbacks': { feedbacks: [] },
      '/api/super-admin/logs': { logs: [] },
      '/api/super-admin/active-sessions': { sessions: [] },
      '/api/super-admin/backups/list': { backups: [], config: { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true } },
    };
    global.fetch = vi.fn((url: string) =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(replies[url] ?? {}) })
    ) as unknown as typeof fetch;
  });

  it('mark the tab shown as the current page, and move the mark with it', async () => {
    render(<SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />);
    const teams = await screen.findByRole('button', { name: /^Teams \(0\)/ });
    const strip = teams.parentElement as HTMLElement;
    const tabs = within(strip).getAllByRole('button');
    expect(tabs).toHaveLength(5);
    expect(marks(tabs)).toEqual([
      ['Teams (0)', 'page'],
      ['Feedback (0)', null],
      ['Live Sessions', null],
      ['Server Logs', null],
      ['Backups', null],
    ]);

    fireEvent.click(within(strip).getByRole('button', { name: /^Server Logs/ }));
    expect(marks(tabs)).toEqual([
      ['Teams (0)', null],
      ['Feedback (0)', null],
      ['Live Sessions', null],
      ['Server Logs', 'page'],
      ['Backups', null],
    ]);
    expect(within(strip).getByRole('button', { name: /^Server Logs/ })).toHaveClass('active');
  });
});

describe('the phase bars of both session headers', () => {
  const retro = (phase: string) => ({
    id: 'r-1', teamId: 'team-1', name: 'Retro', date: '', status: 'IN_PROGRESS', phase,
    participants: [facilitator, alice], columns: [], tickets: [], groups: [], actions: [],
    settings: { isAnonymous: false, maxVotes: 5, oneVotePerTicket: false, revealBrainstorm: true },
    leftUsers: [], finishedUsers: [],
  }) as unknown as RetroSession;

  const retroHeader = (phase: string, user: User) =>
    render(
      <SessionHeader
        session={retro(phase)}
        phases={['BRAINSTORM', 'GROUP', 'VOTE']}
        isFacilitator={user.role === 'facilitator'}
        handleExit={vi.fn()}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        localParticipantsPanelCollapsed
        participantsCount={2}
        currentUser={user}
        onInvite={vi.fn()}
        isRetroTipsOpen={false}
        onToggleRetroTips={vi.fn()}
      />
    );

  const phaseButtons = () => [...document.querySelectorAll<HTMLElement>('header .phase-nav-btn')];

  it.each([['the facilitator', facilitator], ['a participant', alice]] as const)('mark the retrospective’s phase as the current step, for %s', (_who, user) => {
    const view = retroHeader('GROUP', user);
    expect(marks(phaseButtons())).toEqual([['BRAINSTORM', null], ['GROUP', 'step'], ['VOTE', null]]);
    // The name is the dictionary's, as before: the state is said apart from it.
    expect(screen.getByRole('button', { name: 'GROUP' })).toHaveAttribute('aria-current', 'step');

    view.rerender(
      <SessionHeader
        session={retro('VOTE')}
        phases={['BRAINSTORM', 'GROUP', 'VOTE']}
        isFacilitator={user.role === 'facilitator'}
        handleExit={vi.fn()}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        localParticipantsPanelCollapsed
        participantsCount={2}
        currentUser={user}
        onInvite={vi.fn()}
        isRetroTipsOpen={false}
        onToggleRetroTips={vi.fn()}
      />
    );
    expect(marks(phaseButtons())).toEqual([['BRAINSTORM', null], ['GROUP', null], ['VOTE', 'step']]);
  });

  const healthCheck = (phase: string): HealthCheckSessionType => ({
    id: 'hc-1',
    teamId: 'team-1',
    name: 'Team Health',
    date: new Date().toISOString(),
    status: 'IN_PROGRESS',
    phase,
    templateId: 'template-1',
    templateName: 'Team Health',
    dimensions: [{ id: 'd-fun', name: 'Fun', goodDescription: 'We enjoy it', badDescription: 'Boring' }],
    participants: [facilitator, alice],
    settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
    ratings: {},
    actions: [],
    roti: {},
    finishedUsers: [],
  });

  it.each([['the facilitator', facilitator], ['a participant', alice]] as const)('mark the health check’s phase the same way, for %s', (_who, user) => {
    const session = healthCheck('DISCUSS');
    const team: Team = {
      id: 'team-1', name: 'Team', passwordHash: 'hash', members: [facilitator, alice],
      customTemplates: [], retrospectives: [], globalActions: [], healthChecks: [session],
    };
    global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false }) })) as unknown as typeof fetch;
    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
    vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
    render(<HealthCheckSession team={team} currentUser={user} sessionId={session.id} onExit={vi.fn()} />);

    const marked = marks(phaseButtons());
    expect(marked.filter(([, current]) => current !== null)).toEqual([['DISCUSS', 'step']]);
    expect(marked.length).toBeGreaterThan(3);
    expect(screen.getByRole('button', { name: 'DISCUSS' })).toHaveAttribute('aria-current', 'step');
  });
});
