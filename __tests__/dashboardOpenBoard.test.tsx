import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import Dashboard from '../components/Dashboard';
import { dataService } from '../services/dataService';
import { getRetroTemplateColumns } from '../i18n/content/retroTemplates';
import type { Language } from '../i18n/languages';
import type { HealthCheckSession, RetroSession, Team, User } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The "Start New Retrospective" dialog chooses the board type: the guided
 * retrospective it always started, or an open board (utils/openBoard.ts) —
 * every card activity on one screen, kept open. The board is described as
 * anonymous, so choosing it turns anonymity on, and the facilitator can turn
 * it off again. The retro list then names a board rather than a status, since
 * a board is never closed.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    createSession: vi.fn(() => ({ id: 'new-retro' })),
    saveTemplate: vi.fn(),
    createHealthCheckSession: vi.fn(() => ({ id: 'new-hc' })),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token')
  }
}));

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const retro = (overrides: Partial<RetroSession>): RetroSession => ({
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: '6/1/2026',
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  icebreakerQuestion: '',
  columns: [],
  templateLanguage: 'en',
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const buildTeam = (retrospectives: RetroSession[] = []): Team => ({
  id: 'team-1',
  name: 'Coffee Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives,
  globalActions: []
});

const renderDashboard = (
  team: Team,
  language: Language = 'en',
  initialTab: 'ACTIONS' | 'RETROS' | 'HEALTH_CHECKS' = 'ACTIONS'
) =>
  render(
    <LanguageProvider initialLanguage={language}>
      <Dashboard
        team={team}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab={initialTab}
      />
    </LanguageProvider>
  );

const openDialog = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}$`) }));
  return screen.getByRole('dialog');
};

const anonymousToggle = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Toggle anonymous mode' });
const isOn = (toggle: HTMLElement) => toggle.className.includes('bg-indigo-600');

describe('Start New Retrospective — board type', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts the guided retrospective it always did', () => {
    renderDashboard(buildTeam());
    const dialog = openDialog('New Retrospective');

    const choice = within(dialog).getByRole('group', { name: 'Board type' });
    expect(within(choice).getByRole('button', { name: 'Guided retrospective' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(choice).getByRole('button', { name: 'Open board' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(dialog).getByTestId('retro-template-start_stop_continue'));

    // Exactly the options a guided retro was created with before.
    expect(vi.mocked(dataService.createSession).mock.calls[0][3]).toEqual({ isAnonymous: false, templateLanguage: 'en' });
  });

  it('starts an open board, anonymous unless the facilitator says otherwise', () => {
    renderDashboard(buildTeam());
    const dialog = openDialog('New Retrospective');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open board' }));
    expect(within(dialog).getByRole('button', { name: 'Open board' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText(/Ideal for a Lean Coffee/)).toBeInTheDocument();
    expect(isOn(anonymousToggle(dialog))).toBe(true);

    fireEvent.click(within(dialog).getByTestId('retro-template-lean_coffee'));

    expect(dataService.createSession).toHaveBeenCalledWith(
      'team-1',
      expect.any(String),
      getRetroTemplateColumns('lean_coffee', 'en'),
      { isAnonymous: true, templateLanguage: 'en', openBoard: true }
    );
  });

  it('lets the facilitator make an open board that names its authors', () => {
    renderDashboard(buildTeam());
    const dialog = openDialog('New Retrospective');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open board' }));
    fireEvent.click(anonymousToggle(dialog));
    fireEvent.click(within(dialog).getByTestId('retro-template-lean_coffee'));

    expect(vi.mocked(dataService.createSession).mock.calls[0][3]).toEqual({
      isAnonymous: false,
      templateLanguage: 'en',
      openBoard: true
    });
  });

  it('goes back to a named guided retro when the facilitator changes their mind', () => {
    renderDashboard(buildTeam());
    const dialog = openDialog('New Retrospective');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open board' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guided retrospective' }));

    expect(isOn(anonymousToggle(dialog))).toBe(false);
    expect(within(dialog).getByText(/Phase by phase/)).toBeInTheDocument();
  });

  it('keeps the choice for a custom template too', () => {
    renderDashboard(buildTeam());
    const dialog = openDialog('New Retrospective');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open board' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Create Custom Template/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start Retro' }));

    expect(vi.mocked(dataService.createSession).mock.calls[0][3]).toMatchObject({ openBoard: true });
  });

  it('opens on a guided retrospective every time', () => {
    renderDashboard(buildTeam());
    let dialog = openDialog('New Retrospective');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Open board' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close new retrospective dialog' }));

    dialog = openDialog('New Retrospective');

    expect(within(dialog).getByRole('button', { name: 'Guided retrospective' })).toHaveAttribute('aria-pressed', 'true');
    expect(isOn(anonymousToggle(dialog))).toBe(false);
  });

  it('reads in French for a French reader', () => {
    renderDashboard(buildTeam(), 'fr');
    const dialog = openDialog('Nouvelle rétrospective');

    const choice = within(dialog).getByRole('group', { name: 'Type de tableau' });
    expect(within(choice).getByRole('button', { name: 'Rétrospective guidée' })).toBeInTheDocument();
    fireEvent.click(within(choice).getByRole('button', { name: 'Tableau ouvert' }));
    expect(within(dialog).getByText(/Idéal pour un Lean Coffee/)).toBeInTheDocument();
  });
});

describe('Retrospectives list — open boards', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('names an open board instead of a status it can never leave', () => {
    renderDashboard(buildTeam([
      retro({ id: 'board', name: 'Lean Coffee', phase: 'OPEN_BOARD' }),
      retro({ id: 'guided', name: 'Sprint 12' })
    ]), 'en', 'RETROS');

    const boardRow = screen.getByText('Lean Coffee').closest('div.bg-white') as HTMLElement;
    const guidedRow = screen.getByText('Sprint 12').closest('div.bg-white') as HTMLElement;
    expect(within(boardRow).getByText('OPEN BOARD')).toBeInTheDocument();
    expect(within(boardRow).queryByText('IN PROGRESS')).toBeNull();
    expect(within(guidedRow).getByText('IN PROGRESS')).toBeInTheDocument();
  });
});

describe('Session lists — the status reads at 4.5:1', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // 12px text, so the AA floor is 4.5:1. The green the lists used (600)
  // measures 3.22:1 on their white rows; no e2e audit opens a list holding a
  // session in progress, so this is where the colour is measured.
  it('measures the retro list\u2019s OPEN BOARD and IN PROGRESS', () => {
    renderDashboard(buildTeam([
      retro({ id: 'board', name: 'Lean Coffee', phase: 'OPEN_BOARD' }),
      retro({ id: 'guided', name: 'Sprint 12' })
    ]), 'en', 'RETROS');

    for (const status of ['OPEN BOARD', 'IN PROGRESS']) {
      expect(effectivePair(screen.getByText(status)).ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('measures the health check list\u2019s IN PROGRESS', () => {
    const healthCheck: HealthCheckSession = {
      id: 'hc-1',
      teamId: 'team-1',
      name: 'Q4 health',
      date: '6/1/2026',
      status: 'IN_PROGRESS',
      phase: 'SURVEY',
      templateId: 'team_health_en',
      templateName: 'Team health',
      dimensions: [],
      settings: { isAnonymous: false, revealRoti: false },
      ratings: {},
      actions: [],
      roti: {},
      finishedUsers: []
    };
    renderDashboard({ ...buildTeam(), healthChecks: [healthCheck] }, 'en', 'HEALTH_CHECKS');

    expect(effectivePair(screen.getByText('IN PROGRESS')).ratio).toBeGreaterThanOrEqual(4.5);
  });
});
