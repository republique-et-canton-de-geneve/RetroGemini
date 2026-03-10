import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ClosePhase from '../components/session/ClosePhase';
import { RetroSession, User } from '../types';
import { ROTI_FOLLOW_UP_LINK_ID } from '../components/session/retroConstants';

const facilitator: User = {
  id: 'fac-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const participant: User = {
  id: 'member-1',
  name: 'Member',
  color: 'bg-emerald-500',
  role: 'participant'
};

const createSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'CLOSED',
  phase: 'CLOSE',
  participants: [facilitator, participant],
  discussionFocusId: null,
  discussionNextTopicVotes: {},
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {
    'fac-1': 5,
    'member-1': 2
  },
  finishedUsers: [],
  ...overrides
});

describe('ClosePhase ROTI follow-up actions', () => {
  it('lets users propose follow-up actions after ROTI reveal', () => {
    const handleAddProposal = vi.fn();
    const setCloseProposalText = vi.fn();

    render(
      <ClosePhase
        session={createSession()}
        currentUser={participant}
        participantsCount={2}
        isFacilitator={false}
        updateSession={vi.fn()}
        assignableMembers={[facilitator, participant]}
        handleVoteProposal={vi.fn()}
        handleAcceptProposal={vi.fn()}
        handleDeleteProposal={vi.fn()}
        handleAddProposal={handleAddProposal}
        handleDirectAddAction={vi.fn()}
        handleAssignAction={vi.fn()}
        closeProposalText="Add more pairing"
        setCloseProposalText={setCloseProposalText}
        handleExit={vi.fn()}
      />
    );

    expect(screen.getByText('ROTI Follow-up Actions')).toBeTruthy();
    expect(screen.getByText('Low score voices (<= 3): Member')).toBeTruthy();

    const input = screen.getByPlaceholderText('Propose a follow-up action from ROTI feedback...');
    fireEvent.change(input, { target: { value: 'Add weekly pairing slot' } });
    expect(setCloseProposalText).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Propose'));
    expect(handleAddProposal).toHaveBeenCalledWith(ROTI_FOLLOW_UP_LINK_ID, 'Add more pairing');
  });

  it('lets facilitator assign accepted ROTI follow-up actions', () => {
    const handleAssignAction = vi.fn();
    const session = createSession({
      actions: [
        {
          id: 'roti-action-1',
          text: 'Add an incident review checkpoint',
          assigneeId: null,
          done: false,
          type: 'new',
          linkedTicketId: ROTI_FOLLOW_UP_LINK_ID,
          proposalVotes: {}
        }
      ]
    });

    render(
      <ClosePhase
        session={session}
        currentUser={facilitator}
        participantsCount={2}
        isFacilitator
        updateSession={vi.fn()}
        assignableMembers={[facilitator, participant]}
        handleVoteProposal={vi.fn()}
        handleAcceptProposal={vi.fn()}
        handleDeleteProposal={vi.fn()}
        handleAddProposal={vi.fn()}
        handleDirectAddAction={vi.fn()}
        handleAssignAction={handleAssignAction}
        closeProposalText=""
        setCloseProposalText={vi.fn()}
        handleExit={vi.fn()}
      />
    );

    const select = screen.getByDisplayValue('Unassigned');
    fireEvent.change(select, { target: { value: 'member-1' } });
    expect(handleAssignAction).toHaveBeenCalledWith('roti-action-1', 'member-1');
  });
});
