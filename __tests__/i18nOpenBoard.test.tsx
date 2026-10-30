import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import Session from '../components/Session';
import LanguageProvider from '../i18n/LanguageProvider';
import { RetroSession, Team, User } from '../types';

/**
 * The open board in French (utils/openBoard.ts): its bar, its vote totals,
 * its participants panel, the dialog asked before showing the authors again,
 * and the switch on the Icebreaker screen. `sessionOpenBoard.test.tsx` pins
 * the behaviour in English.
 */

let rosterListener: ((roster: { id: string; name: string }[]) => void) | null = null;

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
    onRoster: vi.fn((listener: (roster: { id: string; name: string }[]) => void) => {
      rosterListener = listener;
      return () => {};
    }),
    onActivity: vi.fn(() => () => {}),
    sendActivity: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true),
  },
}));

const facilitator: User = { id: 'fac', name: 'Fiona', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'alice', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

const board = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'session-1',
  teamId: 'team-1',
  name: 'Lean Coffee',
  date: '2026-10-28',
  status: 'IN_PROGRESS',
  phase: 'OPEN_BOARD',
  participants: [facilitator, alice],
  icebreakerQuestion: '',
  columns: [{ id: 'todo', title: 'À discuter', color: 'bg-slate-50', border: 'border-slate-400', icon: 'pending', text: 'text-slate-700', ring: 'focus:ring-slate-200' }],
  templateLanguage: 'fr',
  settings: {
    isAnonymous: true,
    maxVotes: 3,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300,
  },
  tickets: [
    { id: 't1', colId: 'todo', text: 'Déploiements', authorId: 'alice', groupId: null, votes: ['alice'] },
  ],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides,
});

const renderInFrench = (session: RetroSession) =>
  render(
    <LanguageProvider initialLanguage="fr">
      <Session
        team={{ id: 'team-1', name: 'Équipe', passwordHash: 'h', members: [facilitator, alice], customTemplates: [], retrospectives: [session], globalActions: [] } as Team}
        sessionId="session-1"
        currentUser={facilitator}
        onExit={() => {}}
      />
    </LanguageProvider>
  );

describe('Open board — in French', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rosterListener = null;
    global.fetch = vi.fn(() =>
      Promise.resolve({ json: () => Promise.resolve({ enabled: false }) }),
    ) as unknown as typeof fetch;
  });

  it('names the board, its controls and its settings in French', async () => {
    const user = userEvent.setup();
    renderInFrench(board());

    expect(await screen.findByRole('heading', { level: 2, name: 'Tableau ouvert' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 vote, ajouter un vote à cette carte' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Passer en rétrospective guidée' })).toBeTruthy();
    // getByText normalises the no-break space before the colon to a space.
    expect(screen.getByText('Votes restants : 3')).toBeTruthy();

    // The search and the sort, everyone's.
    const sort = screen.getByRole('combobox', { name: 'Trier les cartes' });
    expect(within(sort).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Plus récentes d’abord', 'Plus anciennes d’abord', 'Plus votées d’abord']);
    await user.type(screen.getByRole('searchbox', { name: 'Rechercher dans les cartes' }), 'deploiement');
    expect(await screen.findByText('1 résultat')).toBeTruthy();

    // The facilitator's settings.
    await user.click(screen.getByRole('button', { name: 'Paramètres' }));
    const settings = within(await screen.findByRole('dialog', { name: 'Paramètres du tableau' }));
    for (const name of [
      'Anonyme',
      'Masquer les cartes',
      'Désactiver le vote',
      'Masquer le nombre de votes',
      'Votes illimités',
      'Un vote par carte ou par groupe',
    ]) {
      expect(settings.getByRole('checkbox', { name }), name).toBeTruthy();
    }
    expect(settings.getByRole('textbox', { name: 'Votes par personne' })).toBeTruthy();
    expect(settings.getByRole('button', { name: 'Fermer' })).toBeTruthy();
  });

  it('titles the participants panel by who is connected', async () => {
    renderInFrench(board());
    await screen.findByText('Déploiements');

    act(() => rosterListener?.([{ id: 'fac', name: 'Fiona' }]));

    expect(await screen.findByText('Connectés en ce moment (1)')).toBeTruthy();
    expect(screen.getByText('Seules les personnes connectées en ce moment sont affichées.')).toBeTruthy();
  });

  it('asks in French before showing the authors again', async () => {
    const user = userEvent.setup();
    renderInFrench(board());
    await screen.findByText('Déploiements');

    await user.click(screen.getByRole('button', { name: 'Paramètres' }));
    const settings = within(await screen.findByRole('dialog', { name: 'Paramètres du tableau' }));
    await user.click(settings.getByRole('checkbox', { name: 'Anonyme' }));

    const dialog = await screen.findByRole('dialog', { name: 'Afficher qui a écrit chaque carte\u202f?' });
    expect(within(dialog).getByRole('button', { name: 'Rester anonyme' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Afficher les auteurs' })).toBeTruthy();
  });

  it('offers the open board from the Icebreaker in French', async () => {
    renderInFrench(board({ phase: 'ICEBREAKER' }));

    expect(await screen.findByRole('button', { name: /Passer en tableau ouvert/ })).toBeTruthy();
  });
});
