import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import OpenActionsPhase from '../components/session/OpenActionsPhase';
import Dashboard from '../components/Dashboard';
import { dataService } from '../services/dataService';
import type { Language } from '../i18n/languages';
import type { ActionItem, RetroSession, Team, User } from '../types';

/**
 * Two rules the pre-landing review (Codex) caught being broken on screens the
 * first round did not cover:
 *  - the "Re: …" line of an action is content: every participant reads it in
 *    the retro's template language, not in their own interface language;
 *  - a message on screen follows the language switcher while it is visible,
 *    so it is stored as what to say, never as the translated sentence.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    getHealthCheckTemplates: vi.fn(() => []),
    changeTeamPassword: vi.fn(),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token')
  }
}));

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const action: ActionItem = {
  id: 'act-1',
  text: 'Cache the build',
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  linkedTicketId: 't1'
};

const session = (templateLanguage: Language): RetroSession => ({
  id: 'retro-2',
  teamId: 'team-1',
  name: 'Retro',
  date: '6/10/2026',
  status: 'IN_PROGRESS',
  phase: 'OPEN_ACTIONS',
  participants: [facilitator],
  icebreakerQuestion: '',
  columns: [],
  templateLanguage,
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

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [
    { ...session('en'), id: 'retro-1', status: 'CLOSED', tickets: [{ id: 't1', colId: 'c', text: 'Slow builds', authorId: 'fac-1', groupId: null, votes: [] }] }
  ],
  globalActions: [action]
};

const renderOpenActions = (templateLanguage: Language, interfaceLanguage: Language) =>
  render(
    <LanguageProvider initialLanguage={interfaceLanguage}>
      <OpenActionsPhase
        team={team}
        session={session(templateLanguage)}
        currentUser={facilitator}
        participants={team.members}
        isFacilitator
        reviewActionIds={['act-1']}
        setPhase={vi.fn()}
        applyActionUpdate={vi.fn()}
        assignableMembers={team.members}
        buildActionContext={vi.fn(() => '')}
        setRefreshTick={vi.fn()}
        ratingEnabled={false}
        showRatingNotice={false}
        onRateAction={vi.fn()}
        onToggleDeferRating={vi.fn()}
        onRateNow={vi.fn()}
        onToggleImpactReveal={vi.fn()}
        onDismissRatingNotice={vi.fn()}
      />
    </LanguageProvider>
  );

beforeEach(() => {
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('the action context line is content', () => {
  it('reads in the retro language on a French screen running an English retro', () => {
    renderOpenActions('en', 'fr');
    expect(screen.getByText('Re: "Slow builds"')).toBeInTheDocument();
    expect(screen.queryByText(/Concerne/)).toBeNull();
  });

  it('reads in the retro language on an English screen running a French retro', () => {
    renderOpenActions('fr', 'en');
    expect(screen.getByText('Concerne : « Slow builds »')).toBeInTheDocument();
    expect(screen.queryByText(/^Re:/)).toBeNull();
  });
});

describe('a settings message follows the language switcher', () => {
  it('re-reads a visible password error in the language just chosen', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <LanguageSwitcher />
        <Dashboard
          team={{ ...team, retrospectives: [], globalActions: [] }}
          currentUser={facilitator}
          onOpenSession={vi.fn()}
          onOpenHealthCheck={vi.fn()}
          onRefresh={vi.fn()}
          initialTab="SETTINGS"
        />
      </LanguageProvider>
    );

    fireEvent.change(screen.getByPlaceholderText(/Nouveau mot de passe/), { target: { value: 'abcdefgh1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirmer le nouveau mot de passe'), { target: { value: 'different1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Changer le mot de passe' }));
    expect(screen.getByText('Les mots de passe ne correspondent pas')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('language-option-en'));

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(screen.queryByText('Les mots de passe ne correspondent pas')).toBeNull();
  });
});
