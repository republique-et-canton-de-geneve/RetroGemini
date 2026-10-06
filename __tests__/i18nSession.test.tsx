import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import Session from '../components/Session';
import LanguageProvider from '../i18n/LanguageProvider';
import { createTranslator } from '../i18n/translate';
import {
  getGroupingAriaLabel,
  getGroupingButtonText
} from '../components/session/groupingKeyboard';
import {
  getBrainstormMoveAriaLabel,
  getBrainstormMoveButtonText
} from '../components/session/brainstormMove';
import TicketCommentsModal from '../components/session/TicketCommentsModal';
import AiGroupSuggestionsModal from '../components/session/AiGroupSuggestionsModal';
import TicketOriginBadge from '../components/session/TicketOriginBadge';
import { Column, RetroSession, Team, Ticket, User } from '../types';

/**
 * The retro board (Brainstorm / Group / Vote) and its helpers in French.
 *
 * English stays the source language and is guarded by every existing Session
 * test, which renders without a provider. These cases check the other half:
 * inside the French provider the board chrome reads French and none of the
 * English it replaced leaks through — including the strings built by the pure
 * helpers, which only translate when the component hands them its translator.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(() => null),
    updateSession: vi.fn(),
    persistParticipants: vi.fn(),
  },
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    leaveSession: vi.fn(),
    updateSession: vi.fn(),
    getCurrentSessionId: vi.fn(() => 'session-1'),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    isConnected: vi.fn(() => true),
  },
}));

type BoardPhase = 'BRAINSTORM' | 'GROUP' | 'VOTE';

const facilitator: User = { id: 'facilitator-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const column: Column = {
  id: 'col-1',
  title: 'What Went Well',
  color: 'bg-emerald-500',
  border: 'border-emerald-500',
  icon: 'sentiment_satisfied',
  text: 'text-emerald-700',
  ring: 'ring-emerald-300',
};

const createSession = (phase: BoardPhase): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Test Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase,
  participants: [facilitator],
  icebreakerQuestion: '',
  columns: [column],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  tickets: [
    { id: 't1', colId: 'col-1', text: 'Deploys are scary', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
    { id: 't2', colId: 'col-1', text: 'Releases are slow', authorId: 'facilitator-1', groupId: 'g1', votes: [] },
    { id: 't3', colId: 'col-1', text: 'Great pairing', authorId: 'facilitator-1', groupId: null, votes: [] },
  ],
  groups: [{ id: 'g1', title: '', colId: 'col-1', votes: [] }],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
});

const renderBoardInFrench = (phase: BoardPhase) => {
  const session = createSession(phase);
  const team: Team = {
    id: 'team-1',
    name: 'Test Team',
    passwordHash: 'hash',
    members: [facilitator],
    customTemplates: [],
    retrospectives: [session],
    globalActions: [],
  };
  return render(
    <LanguageProvider initialLanguage="fr">
      <Session team={team} sessionId={session.id} currentUser={facilitator} onExit={() => {}} />
    </LanguageProvider>
  );
};

const fr = createTranslator('fr');

describe('Session board — French interface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('renders the Brainstorm board chrome in French', async () => {
    renderBoardInFrench('BRAINSTORM');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Brainstorming' })).toBeTruthy();
    });
    expect(screen.getByText('Révéler les cartes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Phase suivante' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'J’ai terminé' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Ajouter une idée…')).toBeTruthy();
    expect(screen.getByText('Appuyez sur Entrée pour ajouter')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajouter l’idée' })).toBeTruthy();
    // The pointerless move control on a card the facilitator may move.
    expect(
      screen.getByRole('button', { name: 'Déplacer la carte Great pairing vers une autre colonne.' })
    ).toBeTruthy();

    for (const english of ['Reveal cards', 'Next Phase', "I'm Finished", 'Press Enter to add', 'Edit Layout']) {
      expect(screen.queryByText(english)).toBeNull();
    }
    expect(screen.queryByPlaceholderText('Add an idea...')).toBeNull();
  });

  it('renders the Group board in French, with the group placeholder and controls', async () => {
    renderBoardInFrench('GROUP');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Regrouper les idées' })).toBeTruthy();
    });
    expect(screen.getByPlaceholderText('Nommer ce groupe…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Supprimer le groupe' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Prendre la carte Great pairing pour la regrouper.' })
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Group Ideas' })).toBeNull();
    expect(screen.queryByPlaceholderText('Name this group...')).toBeNull();
  });

  it('renders the Vote board in French', async () => {
    renderBoardInFrench('VOTE');

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Vote' })).toBeTruthy();
    });
    expect(screen.getByText('Votes restants : 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajouter un vote à cette carte' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ajouter un vote à ce groupe' })).toBeTruthy();
    expect(screen.getByText('Groupe sans titre')).toBeTruthy();
    expect(screen.queryByText('5 votes remaining')).toBeNull();
    expect(screen.queryByText('Untitled Group')).toBeNull();
  });
});

describe('Session helpers — French translator', () => {
  it('announces the grouping targets in French', () => {
    expect(getGroupingAriaLabel({ name: 'CI flaky', kind: 'ticket', hasSelection: false, isSelected: false }, fr))
      .toBe('Prendre la carte CI flaky pour la regrouper.');
    expect(getGroupingAriaLabel({ name: 'Tooling', kind: 'group', hasSelection: true, isSelected: false }, fr))
      .toBe('Ajouter la carte sélectionnée au groupe Tooling.');
    expect(getGroupingAriaLabel({ name: '  ', kind: 'column', hasSelection: true, isSelected: false }, fr))
      .toBe('Sortir la carte sélectionnée de son groupe et la placer dans Colonne sans titre.');
    expect(getGroupingButtonText({ hasSelection: true, isSelected: false }, fr)).toBe('Regrouper ici');
  });

  it('announces the Brainstorm move targets in French, with the right gender per held kind', () => {
    expect(getBrainstormMoveAriaLabel({ name: 'Later', kind: 'column', heldKind: 'group', isSelected: false }, fr))
      .toBe('Déplacer le groupe sélectionné vers Later.');
    expect(getBrainstormMoveAriaLabel({ name: 'Later', kind: 'column', heldKind: 'ticket', isSelected: false }, fr))
      .toBe('Déplacer la carte sélectionnée vers Later.');
    expect(getBrainstormMoveButtonText({ target: 'column', isSelected: false }, fr)).toBe('Déplacer ici');
  });

  it('keeps the English output when called without a translator', () => {
    expect(getGroupingAriaLabel({ name: '', kind: 'ticket', hasSelection: false, isSelected: true }))
      .toBe('Selected for grouping: Untitled ticket. Activate or press Escape to cancel.');
    expect(getBrainstormMoveAriaLabel({ name: 'Ops', kind: 'group', heldKind: null, isSelected: false }))
      .toBe('Move the group Ops to another column.');
  });
});

describe('Session dialogs and chips — French interface', () => {
  const ticket: Ticket = {
    id: 't1',
    colId: 'col-1',
    text: 'Deploys are scary',
    authorId: 'facilitator-1',
    groupId: null,
    votes: [],
    comments: [
      {
        id: 'c1',
        authorId: 'facilitator-1',
        authorName: 'Facilitator',
        text: 'Agreed',
        createdAt: new Date().toISOString(),
      },
    ],
  };

  it('renders the comments dialog in French', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TicketCommentsModal
          ticket={ticket}
          currentUser={facilitator}
          participants={[facilitator]}
          isFacilitator
          onAddComment={() => {}}
          onEditComment={() => {}}
          onDeleteComment={() => {}}
          onClose={() => {}}
          cardBgHex={null}
          cardTextColor="text-slate-900"
          isAnonymous={false}
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('dialog', { name: 'Commentaires sur la carte : Deploys are scary' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Ajouter un commentaire…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Envoyer le commentaire' })).toBeTruthy();
    expect(screen.getByText('à l’instant')).toBeTruthy();
    expect(screen.queryByText('just now')).toBeNull();
  });

  it('renders the AI suggestions dialog in French, keeping the 0-and-1-singular count', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <AiGroupSuggestionsModal
          isOpen
          loading={false}
          error={null}
          suggestions={[{ title: 'Delivery', ticketIds: ['t1', 't2'] }]}
          tickets={[ticket, { ...ticket, id: 't2', text: 'Releases are slow', comments: [] }]}
          columns={[column]}
          onAccept={() => {}}
          onAcceptAll={() => {}}
          onRegenerate={() => {}}
          onClose={() => {}}
        />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'Suggestions de groupes par l’IA' })).toBeTruthy();
    expect(screen.getByText('(2 cartes)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accepter' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Inclure « Deploys are scary » dans ce groupe' })).toBeTruthy();
    expect(screen.queryByText('Accept')).toBeNull();
  });

  it('names the origin column of a moved card in French', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TicketOriginBadge column={column} />
      </LanguageProvider>
    );

    const badge = screen.getByTestId('ticket-origin-badge');
    expect(badge.textContent).toContain('Origine : What Went Well');
    expect(badge.getAttribute('title')).toBe('Cette carte a été rédigée à l’origine dans « What Went Well »');
  });
});
