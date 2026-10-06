import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import HealthCheckSession from '../components/HealthCheckSession';
import LanguageProvider from '../i18n/LanguageProvider';
import { Language } from '../i18n/languages';
import { HealthCheckSession as HealthCheckSessionType, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

/**
 * The health check screen in French. Two things are pinned: the chrome
 * (headings, scale, counters, buttons, accessible names) follows the interface
 * language, and the dimensions — template DATA authored in one language and
 * stored on the session — are shown exactly as written, never translated.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn()
  }
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
    isConnected: vi.fn(() => true)
  }
}));

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'p1', name: 'Alice', color: 'bg-rose-500', role: 'participant' };
const bob: User = { id: 'p2', name: 'Bob', color: 'bg-cyan-500', role: 'participant' };

// Authored in English on purpose: a French interface must not touch it.
const DIMENSION_NAME = 'Communication';
const GOOD = 'People collaborate well';
const BAD = 'People work in silos';

const createSession = (phase: HealthCheckSessionType['phase']): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Team Health',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase,
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [
    { id: 'dim-1', name: DIMENSION_NAME, goodDescription: GOOD, badDescription: BAD },
    { id: 'dim-2', name: 'Fun', goodDescription: 'We enjoy it', badDescription: 'Boring' }
  ],
  participants: [facilitator, alice, bob],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: {
    p1: { 'dim-1': { rating: 4, comment: 'Strong alignment' } },
    p2: { 'dim-1': { rating: 3, comment: 'Needs more clarity' } }
  },
  actions: [],
  discussionFocusId: 'dim-1',
  roti: {},
  finishedUsers: []
});

const renderSession = (phase: HealthCheckSessionType['phase'], language: Language = 'fr') => {
  const session = createSession(phase);
  const team: Team = {
    id: 'team-1',
    name: 'Team',
    passwordHash: 'hash',
    members: [facilitator, alice, bob],
    customTemplates: [],
    retrospectives: [],
    globalActions: [],
    healthChecks: [session]
  };
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);

  return render(
    <LanguageProvider initialLanguage={language}>
      <HealthCheckSession team={team} currentUser={facilitator} sessionId={session.id} onExit={vi.fn()} />
    </LanguageProvider>
  );
};

describe('HealthCheckSession in French', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.lang = 'en';
  });

  it('translates the survey chrome and leaves the dimensions as authored', () => {
    renderSession('SURVEY');

    expect(screen.getByRole('heading', { name: 'Notez chaque dimension de santé' })).toBeTruthy();
    // One rating scale per dimension.
    expect(screen.getAllByText("Pas du tout d'accord")).toHaveLength(2);
    expect(screen.getAllByText("Tout à fait d'accord")).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Suivant : discussion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ÉVALUATION' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitter le bilan de santé' })).toBeTruthy();
    expect(screen.getAllByPlaceholderText('Commentaires supplémentaires (facultatif)…')).toHaveLength(2);
    expect(screen.getAllByText('Mauvais :')).toHaveLength(2);

    // Data: the dimension and its descriptions are not translated.
    expect(screen.getByRole('heading', { name: DIMENSION_NAME })).toBeTruthy();
    expect(screen.getByText(GOOD)).toBeTruthy();
    expect(screen.getByText(BAD)).toBeTruthy();

    // No English chrome left behind.
    expect(screen.queryByText('Rate each health dimension')).toBeNull();
    expect(screen.queryByText('Strongly Disagree')).toBeNull();
    expect(screen.queryByRole('button', { name: 'SURVEY' })).toBeNull();
  });

  it('uses French plurals, a French decimal mark and translated names in Discuss', () => {
    renderSession('DISCUSS');

    expect(screen.getByRole('heading', { name: "Discutez des résultats de l'évaluation et identifiez des actions" })).toBeTruthy();
    expect(screen.getByLabelText('Afficher les votes')).toBeTruthy();
    expect(screen.getByText('Répartition des votes')).toBeTruthy();
    // 2 ratings and 2 comments on the first dimension; French treats 0 as
    // singular, so the unrated dimension reads "0 note".
    expect(screen.getByText(/2 notes • 2 commentaires/)).toBeTruthy();
    expect(screen.getByText('0 note')).toBeTruthy();
    // (4 + 3) / 2 keeps its one-decimal rounding, with the fr-CH decimal comma.
    expect(screen.getAllByText('3,5').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Afficher ou masquer les détails de la dimension' })).toHaveLength(2);
    expect(screen.getByPlaceholderText('Proposer une action…')).toBeTruthy();

    expect(screen.getByRole('heading', { name: DIMENSION_NAME })).toBeTruthy();
    expect(screen.queryByText('Vote Distribution')).toBeNull();
    expect(screen.queryByText('3.5')).toBeNull();
  });

  it('translates the close screen and the participants panel', () => {
    renderSession('CLOSE');

    expect(screen.getByRole('heading', { name: 'Bilan de santé terminé' })).toBeTruthy();
    expect(screen.getByText('Merci pour votre contribution !')).toBeTruthy();
    expect(screen.getByText('0 / 3 membres ont voté')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Révéler les résultats' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retour au tableau de bord' })).toBeTruthy();

    // The facilitator's panel opens by default.
    expect(screen.getByText('Participants (3)')).toBeTruthy();
    expect(screen.getByText('facilitateur')).toBeTruthy();
    expect(screen.getByText('0 / 3 ont voté à la clôture')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Inviter l'équipe" })).toBeTruthy();
    expect(screen.queryByText('Health Check Complete')).toBeNull();
  });

  it('lets a guest switch language from the session header', () => {
    renderSession('SURVEY', 'en');

    expect(screen.getByRole('heading', { name: 'Rate each health dimension' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'SURVEY' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('language-option-fr'));

    expect(screen.getByRole('heading', { name: 'Notez chaque dimension de santé' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ÉVALUATION' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: DIMENSION_NAME })).toBeTruthy();
  });
});
