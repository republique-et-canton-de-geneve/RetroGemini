import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ProposalActionRow from '../components/session/ProposalActionRow';
import { ActionItem, User } from '../types';

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'p1', name: 'Alice', color: 'bg-red-500', role: 'participant' };
const bob: User = { id: 'p2', name: 'Bob', color: 'bg-blue-500', role: 'participant' };

const buildProposal = (proposalVotes: ActionItem['proposalVotes']): ActionItem => ({
  id: 'a1',
  text: 'Fix the build',
  assigneeId: null,
  done: false,
  type: 'proposal',
  linkedTicketId: 't1',
  proposalVotes
});

const defaultProps = {
  participants: [facilitator, alice, bob],
  currentUserId: facilitator.id,
  isFacilitator: true,
  isEditing: false,
  editText: '',
  onEditTextChange: vi.fn(),
  onStartEdit: vi.fn(),
  onSaveEdit: vi.fn(),
  onCancelEdit: vi.fn(),
  onVote: vi.fn(),
  onAccept: vi.fn(),
  onDelete: vi.fn(),
  showVoteTypes: false
};

describe('ProposalActionRow - vote progress (facilitator excluded)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows voted count over expected voters, excluding the facilitator', () => {
    const { getByTestId } = render(
      <ProposalActionRow {...defaultProps} proposal={buildProposal({ p1: 'up' })} />
    );

    const badge = getByTestId('proposal-vote-progress');
    expect(badge.textContent).toContain('1/2 voted');
    expect(badge.getAttribute('data-vote-progress')).toBe('pending');
  });

  it('does not count the facilitator vote toward progress', () => {
    const { getByTestId } = render(
      <ProposalActionRow {...defaultProps} proposal={buildProposal({ 'fac-1': 'up', p1: 'up' })} />
    );

    const badge = getByTestId('proposal-vote-progress');
    expect(badge.textContent).toContain('1/2 voted');
  });

  it('switches to an all-voted state when every non-facilitator participant voted', () => {
    const { getByTestId } = render(
      <ProposalActionRow {...defaultProps} proposal={buildProposal({ p1: 'up', p2: 'down' })} />
    );

    const badge = getByTestId('proposal-vote-progress');
    expect(badge.textContent).toContain('2/2 voted');
    expect(badge.getAttribute('data-vote-progress')).toBe('complete');
  });

  it('never reports all-voted when there are no non-facilitator participants', () => {
    const { getByTestId } = render(
      <ProposalActionRow
        {...defaultProps}
        participants={[facilitator]}
        proposal={buildProposal({ 'fac-1': 'up' })}
      />
    );

    const badge = getByTestId('proposal-vote-progress');
    expect(badge.getAttribute('data-vote-progress')).toBe('pending');
  });

  it('excludes the facilitator from the not-voted tooltip list', async () => {
    const { getByTestId, container } = render(
      <ProposalActionRow {...defaultProps} proposal={buildProposal({ p1: 'up' })} />
    );

    fireEvent.mouseEnter(getByTestId('proposal-vote-progress').parentElement!);

    await waitFor(() => {
      expect(container.querySelector('.shadow-lg')).toBeTruthy();
    });

    const tooltipText = container.querySelector('.shadow-lg')?.textContent || '';
    expect(tooltipText).toContain('Voted (1)');
    expect(tooltipText).toContain('Not voted (1)');
    // The facilitator must not appear as a pending voter
    const pendingNames = Array.from(container.querySelectorAll('.shadow-lg ul')[1]?.querySelectorAll('li') || [])
      .map((item) => item.textContent || '');
    expect(pendingNames).toHaveLength(1);
    expect(pendingNames[0]).toContain('Bob');
    expect(pendingNames[0]).not.toContain('Facilitator');
  });

  it('labels the facilitator in the voted tooltip list when they voted', async () => {
    const { getByTestId, container } = render(
      <ProposalActionRow {...defaultProps} proposal={buildProposal({ 'fac-1': 'up', p1: 'up' })} />
    );

    fireEvent.mouseEnter(getByTestId('proposal-vote-progress').parentElement!);

    await waitFor(() => {
      expect(container.querySelector('.shadow-lg')).toBeTruthy();
    });

    const tooltipText = container.querySelector('.shadow-lg')?.textContent || '';
    expect(tooltipText).toContain('Voted (2)');
    expect(tooltipText).toContain('(facilitator)');
  });

  it('shows a reject button only when an onReject handler is provided', () => {
    const onReject = vi.fn();
    const { queryByTitle, rerender, getByTitle } = render(
      <ProposalActionRow {...defaultProps} proposal={buildProposal({})} />
    );

    expect(queryByTitle('Reject proposal (can be undone)')).toBeNull();

    rerender(
      <ProposalActionRow {...defaultProps} proposal={buildProposal({})} onReject={onReject} />
    );

    fireEvent.click(getByTitle('Reject proposal (can be undone)'));
    expect(onReject).toHaveBeenCalled();
  });
});
