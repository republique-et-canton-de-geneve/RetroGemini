import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import { createTranslator } from '../i18n/translate';
import SessionHeader from '../components/session/SessionHeader';
import IcebreakerPhase from '../components/session/IcebreakerPhase';
import ClosePhase from '../components/session/ClosePhase';
import ParticipantsPanel from '../components/session/ParticipantsPanel';
import { SessionConnectionBanner } from '../components/session/SessionConnectionStatus';
import {
  getRetroPhaseDefaultTimerSeconds,
  getRetroPhaseTip,
  RETRO_PHASE_TIPS
} from '../components/session/retroTips';
import { RetroSession, Ticket, User } from '../types';

/**
 * The retrospective session chrome and phase screens in French ("phases"
 * namespace). English rendering is pinned by each component's own suite, which
 * renders without a provider; these cases prove the French side is wired, and
 * that what is session *content* (the icebreaker question) is left alone.
 */

const PHASES = ['ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'BRAINSTORM', 'GROUP', 'VOTE', 'DISCUSS', 'REVIEW', 'CLOSE'];

const facilitator: User = { id: 'fac', name: 'Fran', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'a', name: 'Alice', color: 'bg-rose-500', role: 'participant' };

const makeSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 's1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [facilitator, alice],
  icebreakerQuestion: 'What was the highlight of your week?',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const inFrench = (ui: React.ReactElement) =>
  render(<LanguageProvider initialLanguage="fr">{ui}</LanguageProvider>);

const renderHeader = (session: RetroSession) =>
  inFrench(
    <SessionHeader
      session={session}
      phases={PHASES}
      isFacilitator
      handleExit={vi.fn()}
      setPhase={vi.fn()}
      updateSession={vi.fn()}
      localParticipantsPanelCollapsed={false}
      setLocalParticipantsPanelCollapsed={vi.fn()}
      participantsCount={2}
      currentUser={facilitator}
      onInvite={vi.fn()}
      isRetroTipsOpen={false}
      onToggleRetroTips={vi.fn()}
    />
  );

describe('Session header in French', () => {
  it('names the phases in French and offers the language switcher in the session', () => {
    renderHeader(makeSession());

    expect(screen.getByRole('button', { name: 'BRISE-GLACE' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'ACTIONS' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'ICEBREAKER' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'OPEN ACTIONS' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Démarrer le minuteur' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitter la rétrospective' })).toBeTruthy();

    // A guest who opened an invite link can change language without leaving.
    const switcher = screen.getByRole('group', { name: 'Langue' });
    expect(within(switcher).getByRole('button', { name: 'Français' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(switcher).getByRole('button', { name: 'English' }));
    expect(screen.getByRole('button', { name: 'OPEN ACTIONS' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeTruthy();
  });

  it('brings the current phase back into view after a resize and a language switch', () => {
    // The phase bar scrolls when it is narrower than its phases. Turning a
    // tablet (the bar appears from lg) or switching to the longer French
    // labels moves the phases without changing the current one, so a
    // phase-change trigger alone left it off-screen.
    const scrolled: Element[] = [];
    const original = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: Element) { scrolled.push(this); }
    });
    try {
      renderHeader(makeSession({ phase: 'REVIEW' }));
      const active = screen.getByRole('button', { name: 'REVUE' });

      scrolled.length = 0;
      fireEvent(window, new Event('resize'));
      expect(scrolled).toContain(active);

      scrolled.length = 0;
      fireEvent.click(within(screen.getByRole('group', { name: 'Langue' })).getByRole('button', { name: 'English' }));
      expect(scrolled).toContain(screen.getByRole('button', { name: 'REVIEW' }));
    } finally {
      if (original) Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', original);
      else delete (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});

describe('Icebreaker phase in French', () => {
  it('translates the chrome around the question, never the question itself', () => {
    inFrench(
      <IcebreakerPhase
        session={makeSession({ phase: 'ICEBREAKER' })}
        isFacilitator
        localIcebreakerQuestion={null}
        onQuestionChange={vi.fn()}
        onRandom={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Brise-glace' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Aléatoire/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Démarrer la session' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Saisissez ou générez une question…')).toBeTruthy();
    expect(screen.queryByText('Start Session')).toBeNull();
    expect((screen.getByTestId('icebreaker-question-input') as HTMLTextAreaElement).value).toBe(
      'What was the highlight of your week?'
    );
  });

  it('tells a participant, in French, that the facilitator has not started yet', () => {
    inFrench(
      <IcebreakerPhase
        session={makeSession({ phase: 'ICEBREAKER' })}
        isFacilitator={false}
        localIcebreakerQuestion={null}
        onQuestionChange={vi.fn()}
        onRandom={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(screen.getByText('En attente du démarrage par le facilitateur…')).toBeTruthy();
  });
});

describe('Retro tips in French', () => {
  it('reads a tip in the translator’s language and keeps the timer default it pairs with', () => {
    const tip = getRetroPhaseTip('DISCUSS', createTranslator('fr'));
    expect(tip.label).toBe('Discussion');
    expect(tip.suggestedTimebox).toBe('8 min par sujet');
    expect(tip.purpose).toMatch(/^Parcourez les sujets/);
    expect(tip.defaultTimerSeconds).toBe(getRetroPhaseDefaultTimerSeconds('DISCUSS'));

    // Without a translator, the public API is the English it always was.
    expect(getRetroPhaseTip('DISCUSS').label).toBe('Discuss');
    expect(getRetroPhaseTip('DISCUSS').suggestedTimebox).toBe('8 min per topic');
    expect(RETRO_PHASE_TIPS.find((entry) => entry.phase === 'ICEBREAKER')?.suggestedTimebox).toBe('5 min');
  });
});

describe('Close phase in French', () => {
  it('translates the close-out and writes the ROTI average with a decimal comma', () => {
    inFrench(
      <ClosePhase
        session={makeSession({
          phase: 'CLOSE',
          status: 'CLOSED',
          roti: { fac: 5, a: 2 },
          settings: { ...makeSession().settings, revealRoti: true }
        })}
        currentUser={alice}
        participantsCount={2}
        isFacilitator={false}
        updateSession={vi.fn()}
        assignableMembers={[facilitator, alice]}
        handleVoteProposal={vi.fn()}
        handleAcceptProposal={vi.fn()}
        handleDeleteProposal={vi.fn()}
        handleAddProposal={vi.fn()}
        handleDirectAddAction={vi.fn()}
        handleAssignAction={vi.fn()}
        closeProposalText=""
        setCloseProposalText={vi.fn()}
        handleExit={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: 'Session clôturée' })).toBeTruthy();
    expect(screen.getByText('3,5 / 5')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quitter la rétrospective' })).toBeTruthy();
    expect(screen.queryByText('Session Closed')).toBeNull();
  });
});

describe('Participants panel in French', () => {
  const ticket = (authorId: string): Ticket => ({
    id: `t-${authorId}`,
    colId: 'col-1',
    text: 'idea',
    authorId,
    groupId: null,
    votes: []
  });

  const renderPanel = (session: RetroSession) =>
    inFrench(
      <ParticipantsPanel
        session={session}
        participants={[facilitator, alice]}
        connectedUsers={new Set(['fac', 'a'])}
        currentUser={facilitator}
        isFacilitator
        isCollapsed={false}
        activityUsers={{}}
        onToggleCollapse={vi.fn()}
        onInvite={vi.fn()}
        getMemberDisplay={(member) => ({ displayName: member.name, initials: member.name.slice(0, 2) })}
      />
    );

  it('uses the French plural rule, where zero and one are singular', () => {
    const { unmount } = renderPanel(makeSession({ tickets: [] }));
    expect(screen.getByText("0 carte ajoutée jusqu'ici")).toBeTruthy();
    unmount();

    renderPanel(makeSession({ tickets: [ticket('a'), ticket('fac')] }));
    expect(screen.getByText("2 cartes ajoutées jusqu'ici")).toBeTruthy();
    expect(screen.getByText('Participants (2)')).toBeTruthy();
    expect(screen.getByText('(vous)')).toBeTruthy();
    expect(screen.getByRole('button', { name: "Inviter l'équipe" })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réduire le panneau' })).toBeTruthy();
  });
});

describe('Connection banner in French', () => {
  it('explains a refused join in French and offers to log in again', () => {
    inFrench(
      <SessionConnectionBanner isLive joinDeniedReason="forbidden" onReturnToLogin={vi.fn()} />
    );

    expect(screen.getByRole('alert').textContent).toContain('Cette session appartient à une autre équipe.');
    expect(screen.getByRole('button', { name: 'Se reconnecter' })).toBeTruthy();
    expect(screen.queryByText('Log in again')).toBeNull();
  });
});
