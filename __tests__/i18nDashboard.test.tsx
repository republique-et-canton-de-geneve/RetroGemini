import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import Dashboard from '../components/Dashboard';
import ReleaseAnalysisModal from '../components/dashboard/ReleaseAnalysisModal';
import { localizeDecimal } from '../i18n/formatNumber';
import { dataService } from '../services/dataService';
import { PASSWORD_MIN_LENGTH } from '../utils/passwordPolicy.js';
import { ActionItem, HealthCheckSession, RetroSession, Team, User } from '../types';

/**
 * The French dashboard. The English text is pinned by the dashboard's own
 * suites, which render without a provider; these cases render under
 * `initialLanguage="fr"` and check that the chrome switches while content —
 * team, retro and health check names, ticket and action text — stays exactly
 * as it was typed.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    addGlobalAction: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    setActionImpactRatingEnabled: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn(),
    updateSessionName: vi.fn(),
    updateHealthCheckName: vi.fn(),
    createSession: vi.fn(),
    saveTemplate: vi.fn(),
    deleteTeam: vi.fn(),
    deleteRetrospective: vi.fn(),
    createHealthCheckSession: vi.fn(),
    deleteHealthCheck: vi.fn(),
    saveHealthCheckTemplate: vi.fn(),
    deleteHealthCheckTemplate: vi.fn(),
    changeTeamPassword: vi.fn(),
    renameTeam: vi.fn(),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token')
  }
}));

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const action = (overrides: Partial<ActionItem>): ActionItem => ({
  id: 'a',
  text: 'Action',
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const retro = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 169',
  date: '6/1/2026',
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
  finishedUsers: [],
  ...overrides
});

const healthCheck = (overrides: Partial<HealthCheckSession> = {}): HealthCheckSession => ({
  id: 'hc1',
  teamId: 'team-1',
  name: 'Q2 pulse',
  date: '6/2/2026',
  templateId: 'custom-1',
  templateName: 'Team pulse',
  dimensions: [{ id: 'd1', name: 'Speed', goodDescription: 'Fast', badDescription: 'Slow' }],
  status: 'CLOSED',
  phase: 'CLOSE',
  settings: { isAnonymous: false, revealRatings: true },
  ratings: { u1: { d1: { rating: 4 } } },
  actions: [],
  ...overrides
} as unknown as HealthCheckSession);

const buildTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Test Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

const renderDashboardInFrench = (
  team: Team,
  initialTab: 'ACTIONS' | 'RETROS' | 'HEALTH_CHECKS' | 'SETTINGS' = 'ACTIONS'
) =>
  render(
    <LanguageProvider initialLanguage="fr">
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

describe('Dashboard in French', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ enabled: false })
    }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
    vi.mocked(dataService.getHealthCheckTemplates).mockReturnValue([]);
  });

  it('translates the header, the tabs and the actions list, but not what the team typed', async () => {
    const team = buildTeam({
      retrospectives: [
        retro({
          id: 'r1',
          name: 'Sprint 169',
          groups: [{ id: 'g1', title: 'Tooling', colId: 'c1', votes: [] }],
          actions: [action({ id: 'from-group', text: 'Fix the build', linkedTicketId: 'g1' })]
        })
      ],
      globalActions: [
        action({
          id: 'rated',
          text: 'Automate the release notes',
          done: true,
          closedAt: '2026-06-01T00:00:00.000Z',
          impactRatings: { u1: 3, u2: 2 }
        })
      ]
    });

    renderDashboardInFrench(team, 'ACTIONS');

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tableau de bord · Test Team');
    expect(screen.getByText('Gérez les actions et suivez la progression de l\'équipe.')).toBeInTheDocument();
    for (const tab of ['Rétrospectives', 'Bilans de santé', 'Membres', 'Paramètres', 'Espace retours']) {
      expect(screen.getByRole('button', { name: new RegExp(tab) })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Supprimer l\'équipe' })).toBeInTheDocument();

    // The group a retro action came from: the label is chrome, the title is content.
    expect(screen.getByText('Concerne : Groupe : Tooling')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fix the build')).toBeInTheDocument();
    expect(screen.getByLabelText('Responsable de l\'action : Fix the build')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clôturées' }));
    const pill = await screen.findByTestId('action-impact-score');
    // French decimal comma, French plural.
    expect(pill.textContent).toContain('2,5/3');
    expect(pill.getAttribute('aria-label')).toBe('Impact 2,5 sur 3, sur la base de 2 évaluations');

    expect(screen.queryByText(/Dashboard/)).not.toBeInTheDocument();
    expect(screen.queryByText('Retrospectives')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Action')).not.toBeInTheDocument();
  });

  it('opens "Start New Retrospective" with French dialog chrome', () => {
    renderDashboardInFrench(buildTeam({ customTemplates: [{ name: 'Our format', cols: [] }] }));

    fireEvent.click(screen.getByRole('button', { name: /Nouvelle rétrospective/ }));

    const dialog = screen.getByRole('dialog', { name: 'Démarrer une nouvelle rétrospective' });
    expect(within(dialog).getByLabelText('Nom de la session')).toBeInTheDocument();
    expect(within(dialog).getByText('Mode anonyme')).toBeInTheDocument();
    expect(within(dialog).getByText('Masquer le nom des auteurs sur les cartes de cette rétro.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Activer ou désactiver le mode anonyme' })).toBeInTheDocument();
    expect(within(dialog).getByText('Modèles enregistrés')).toBeInTheDocument();
    // A saved template's name is content.
    expect(within(dialog).getByRole('button', { name: 'Our format' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Fermer la fenêtre de nouvelle rétrospective' })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText(/Créer un modèle personnalisé/));
    expect(within(dialog).getByLabelText('Nom du modèle (facultatif, pour l\'enregistrer)')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Colonnes' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Choisir l\'icône de la colonne 1' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Ajouter une colonne/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Retour' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Démarrer la rétro' })).toBeInTheDocument();

    expect(screen.queryByText('Start New Retrospective')).not.toBeInTheDocument();
    expect(screen.queryByText('Session Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Start Retro')).not.toBeInTheDocument();
  });

  it('translates the retrospective and health check cards, keeping their names as typed', () => {
    const team = buildTeam({
      retrospectives: [retro({ id: 'r1', name: 'Sprint 169', status: 'CLOSED', roti: { u1: 5, u2: 4 } })],
      healthChecks: [healthCheck()]
    });

    const { unmount } = renderDashboardInFrench(team, 'RETROS');
    expect(screen.getByText('Sprint 169')).toBeInTheDocument();
    expect(screen.getByText('CLÔTURÉE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voir le résumé' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Renommer la rétrospective' })).toBeInTheDocument();
    expect(screen.getByTestId('retro-roti-summary').getAttribute('aria-label')).toBe(
      'ROTI, déroulement de la session\u00a0: 4,5 sur 5, sur la base de 2 réponses'
    );
    expect(screen.queryByText('CLOSED')).not.toBeInTheDocument();
    unmount();

    renderDashboardInFrench(team, 'HEALTH_CHECKS');
    expect(screen.getByRole('button', { name: /DÉMARRER UN BILAN DE SANTÉ/ })).toBeInTheDocument();
    // Name, template name and dimension are data, never translated.
    expect(screen.getAllByText('Q2 pulse').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Team pulse').length).toBeGreaterThan(0);
    expect(screen.getByTitle('Speed')).toBeInTheDocument();
    // Masculine "bilan", and the French singular for one participant.
    expect(screen.getByText('CLÔTURÉ')).toBeInTheDocument();
    expect(screen.getByText('1 participant')).toBeInTheDocument();
    expect(screen.getByText('1 session')).toBeInTheDocument();
    // The trend cell keeps its one-decimal rounding; only the mark is French.
    expect(screen.getByText('4,0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voir les résultats' })).toBeInTheDocument();
    expect(screen.queryByText('View Results')).not.toBeInTheDocument();
  });

  it('proposes a French default name for a new health check', () => {
    vi.mocked(dataService.getHealthCheckTemplates).mockReturnValue([
      { id: 'team_health_fr', name: 'Bilan de santé d\'équipe', dimensions: [], isDefault: true }
    ]);

    renderDashboardInFrench(buildTeam(), 'HEALTH_CHECKS');
    fireEvent.click(screen.getByRole('button', { name: /DÉMARRER UN BILAN DE SANTÉ/ }));

    const dialog = screen.getByRole('dialog', { name: 'Démarrer un bilan de santé' });
    const name = within(dialog).getByLabelText('Nom de la session') as HTMLInputElement;
    expect(name.value).toMatch(/^Bilan de santé /);
    expect(within(dialog).getByLabelText('Modèle')).toBeInTheDocument();
  });

  it('shows settings validation and data-layer errors in French', async () => {
    vi.mocked(dataService.renameTeam).mockRejectedValueOnce(new Error('Team name already exists'));

    renderDashboardInFrench(buildTeam(), 'SETTINGS');

    expect(screen.getByText('Paramètres de l\'équipe')).toBeInTheDocument();
    expect(screen.getByText(/Nom actuel de l'équipe :/)).toBeInTheDocument();

    // The password rule, from the module the server reads too.
    fireEvent.change(screen.getByPlaceholderText(`Nouveau mot de passe (${PASSWORD_MIN_LENGTH} caractères minimum)`), {
      target: { value: 'short' }
    });
    fireEvent.change(screen.getByPlaceholderText('Confirmer le nouveau mot de passe'), {
      target: { value: 'short' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(
      await screen.findByText(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`)
    ).toBeInTheDocument();

    // An English message thrown by dataService is shown translated.
    fireEvent.change(screen.getByPlaceholderText('Saisissez le nouveau nom de l\'équipe'), {
      target: { value: 'Other Team' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Renommer l\'équipe' }));
    await waitFor(() => expect(screen.getByText('Ce nom d\'équipe existe déjà')).toBeInTheDocument());
    expect(screen.queryByText('Team name already exists')).not.toBeInTheDocument();
  });
});

describe('ReleaseAnalysisModal in French', () => {
  it('translates the dialog and agrees French plurals, with 0 singular', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <ReleaseAnalysisModal
          retrospectives={[retro({ id: 'r1', name: 'AFC 2606-Sprint 169', status: 'IN_PROGRESS' })]}
          onClose={vi.fn()}
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('dialog', { name: 'Analyse de release' })).toBeInTheDocument();
    expect(screen.getByText('Analyse des rétrospectives de la release')).toBeInTheDocument();
    expect(screen.getByText('0 sélectionnée')).toBeInTheDocument();
    expect(screen.getByLabelText('Inclure ou exclure AFC 2606-Sprint 169')).toBeInTheDocument();
    expect(screen.getByText(/EN COURS/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Générer l'analyse/ })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('release-analysis-keyword'), { target: { value: '2606' } });
    expect(screen.getByText('1 rétrospective correspond à ce mot-clé.')).toBeInTheDocument();
    expect(screen.getByText('1 sélectionnée')).toBeInTheDocument();

    expect(screen.queryByText('Release retrospective analysis')).not.toBeInTheDocument();
    expect(screen.queryByText(/selected$/)).not.toBeInTheDocument();
  });
});

describe('localizeDecimal', () => {
  it('leaves English digits byte-identical and swaps only the decimal mark for French', () => {
    expect(localizeDecimal('3.5', 'en-US')).toBe('3.5');
    expect(localizeDecimal('4', 'en-US')).toBe('4');
    expect(localizeDecimal((3).toFixed(1), 'en-US')).toBe('3.0');
    expect(localizeDecimal('3.5', 'fr-CH')).toBe('3,5');
    expect(localizeDecimal('4', 'fr-CH')).toBe('4');
  });
});
