import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import Dashboard from '../components/Dashboard';
import { dataService } from '../services/dataService';
import { getRetroTemplateColumns } from '../i18n/content/retroTemplates';
import type { Language } from '../i18n/languages';
import { createTranslator } from '../i18n/translate';
import type { HealthCheckTemplate, RetroSession, Team, User } from '../types';

/**
 * The template language of a retro is chosen in the "Start New Retrospective"
 * dialog and is independent of the interface language: a French screen can
 * start an English retro and the reverse. What is created is what the cards
 * showed, and the language is stored on the session.
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

const previousRetro = (templateLanguage?: Language): RetroSession => ({
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: '6/1/2026',
  status: 'CLOSED',
  phase: 'CLOSE',
  icebreakerQuestion: '',
  columns: [],
  ...(templateLanguage ? { templateLanguage } : {}),
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
  finishedUsers: []
});

const buildTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Polyglots',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

const renderDashboard = (team: Team, language: Language, initialTab: 'ACTIONS' | 'HEALTH_CHECKS' = 'ACTIONS') => {
  const onOpenSession = vi.fn();
  render(
    <LanguageProvider initialLanguage={language}>
      <Dashboard
        team={team}
        currentUser={facilitator}
        onOpenSession={onOpenSession}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab={initialTab}
      />
    </LanguageProvider>
  );
  return { onOpenSession };
};

// The button's name carries its icon ligature ("add New Retrospective"), a
// known gap recorded in ACCESSIBILITY.md, so match on the label's end.
const openNewRetroDialog = (label: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}$`) }));
  return screen.getByRole('dialog');
};

const sessionNameInput = () => document.getElementById('new-retro-name') as HTMLInputElement;

describe('Start New Retrospective — template language', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts an English retro from a French screen', () => {
    const { onOpenSession } = renderDashboard(buildTeam(), 'fr');
    const dialog = openNewRetroDialog('Nouvelle rétrospective');

    // A team with no retro yet opens on the interface language...
    expect(within(dialog).getByTestId('template-language-fr')).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByTestId('retro-template-start_stop_continue')).toHaveTextContent('Commencer, Arrêter, Continuer');
    expect(sessionNameInput().value).toMatch(/^Rétrospective /);

    // ...and the facilitator picks English for the content.
    fireEvent.click(within(dialog).getByTestId('template-language-en'));

    expect(within(dialog).getByTestId('template-language-en')).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByTestId('retro-template-start_stop_continue')).toHaveTextContent('Start, Stop, Continue');
    expect(within(dialog).getByTestId('retro-template-start_stop_continue').closest('[lang]')).toHaveAttribute('lang', 'en');
    // The untouched proposed name follows the content language; the dialog itself stays French.
    expect(sessionNameInput().value).toMatch(/^Retrospective /);
    expect(within(dialog).getByText('Langue du modèle')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByTestId('retro-template-start_stop_continue'));

    expect(dataService.createSession).toHaveBeenCalledWith(
      'team-1',
      expect.stringMatching(/^Retrospective /),
      getRetroTemplateColumns('start_stop_continue', 'en'),
      { isAnonymous: false, templateLanguage: 'en' }
    );
    expect(onOpenSession).toHaveBeenCalledWith('new-retro');
  });

  it("opens on the team's previous template language, even on an English screen", () => {
    renderDashboard(buildTeam({ retrospectives: [previousRetro('fr')] }), 'en');
    const dialog = openNewRetroDialog('New Retrospective');

    expect(within(dialog).getByRole('heading', { name: 'Start New Retrospective' })).toBeInTheDocument();
    expect(within(dialog).getByTestId('template-language-fr')).toHaveAttribute('aria-pressed', 'true');
    // A numbered name is continued whatever the language, and never reworded.
    expect(sessionNameInput().value).toBe('Sprint 13');

    fireEvent.click(within(dialog).getByTestId('retro-template-sailboat'));

    expect(dataService.createSession).toHaveBeenCalledWith(
      'team-1',
      'Sprint 13',
      getRetroTemplateColumns('sailboat', 'fr'),
      { isAnonymous: false, templateLanguage: 'fr' }
    );
  });

  it('keeps a name the facilitator typed when the template language changes', () => {
    renderDashboard(buildTeam(), 'en');
    const dialog = openNewRetroDialog('New Retrospective');

    fireEvent.change(sessionNameInput(), { target: { value: 'Q4 kickoff' } });
    fireEvent.click(within(dialog).getByTestId('template-language-fr'));

    expect(sessionNameInput().value).toBe('Q4 kickoff');
  });

  it('rewords the untouched custom-template starter columns, and stores the language for a custom retro too', () => {
    renderDashboard(buildTeam(), 'en');
    const dialog = openNewRetroDialog('New Retrospective');

    fireEvent.click(within(dialog).getByTestId('template-language-fr'));
    fireEvent.click(within(dialog).getByRole('button', { name: /Create Custom Template/ }));

    const titles = within(dialog).getAllByRole('textbox').map(input => (input as HTMLInputElement).value);
    expect(titles).toEqual(expect.arrayContaining(['Commencer', 'Arrêter']));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Start Retro' }));
    expect(vi.mocked(dataService.createSession).mock.calls[0][3]).toEqual({ isAnonymous: false, templateLanguage: 'fr' });
  });
});

describe('Start Health Check — default template', () => {
  const template = (id: string, name: string): HealthCheckTemplate => ({
    id,
    name,
    isDefault: true,
    dimensions: [{ id: 'd', name: 'D', goodDescription: 'g', badDescription: 'b' }]
  });

  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
    vi.mocked(dataService.getHealthCheckTemplates).mockReturnValue([
      template('team_health_en', 'Team Health Check'),
      template('team_health_fr', 'Bilan de santé (FR)')
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(dataService.getHealthCheckTemplates).mockReturnValue([]);
  });

  it.each([
    ['en' as const, 'team_health_en', createTranslator('en')('dashboard.healthChecks.start')],
    ['fr' as const, 'team_health_fr', createTranslator('fr')('dashboard.healthChecks.start')]
  ])('offers the built-in health check in the %s interface language first', (language, expected, label) => {
    renderDashboard(buildTeam(), language, 'HEALTH_CHECKS');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`${label}$`) }));
    expect((document.getElementById('healthcheck-template') as HTMLSelectElement).value).toBe(expected);
  });
});
