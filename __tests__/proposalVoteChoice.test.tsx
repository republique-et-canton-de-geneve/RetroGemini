import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import ProposalActionRow from '../components/session/ProposalActionRow';
import { ActionItem, User } from '../types';
import { classColor, effectivePair, tokenContrast } from './helpers/tailwindTheme';

// A person's own vote on a proposal is the state of a control: it is said to a
// screen reader (aria-pressed) and seen apart from the box and from a hovered
// button (WCAG 4.1.2, 1.4.11). The chosen "neutral" once painted white inside a
// slate-100 box, the very white an unchosen button takes on hover.

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'p1', name: 'Alice', color: 'bg-red-500', role: 'participant' };

const proposal = (vote: 'up' | 'neutral' | 'down'): ActionItem => ({
  id: 'a1',
  text: 'Fix the build',
  assigneeId: null,
  done: false,
  type: 'proposal',
  linkedTicketId: 't1',
  proposalVotes: { p1: vote },
});

const renderRow = (vote: 'up' | 'neutral' | 'down') =>
  render(
    <ProposalActionRow
      proposal={proposal(vote)}
      participants={[facilitator, alice]}
      currentUserId={alice.id}
      isFacilitator={false}
      isEditing={false}
      editText=""
      onEditTextChange={vi.fn()}
      onStartEdit={vi.fn()}
      onSaveEdit={vi.fn()}
      onCancelEdit={vi.fn()}
      onVote={vi.fn()}
      onAccept={vi.fn()}
      onDelete={vi.fn()}
      showVoteTypes={false}
    />,
  );

/** The three vote buttons, in their order: up, neutral, down. */
const voteButtons = () => {
  const icons = ['thumb_up', 'remove', 'thumb_down'];
  return icons.map((icon) => {
    const glyph = screen.getAllByText(icon).find((el) => el.closest('button'));
    if (!glyph) throw new Error(`no vote button for ${icon}`);
    return glyph.closest('button') as HTMLButtonElement;
  });
};

/** The resting background a class list paints, never a hover: variant. */
const restingFill = (button: HTMLElement): string => {
  const fill = classColor(button.className, 'bg');
  if (!fill) throw new Error(`no resting fill on "${button.className}"`);
  return fill;
};

/** The fill an unchosen button takes on hover, read from its own class list. */
const hoverFill = (button: HTMLElement): string => {
  const token = button.className.split(/\s+/).find((c) => c.startsWith('hover:bg-'));
  if (!token) throw new Error(`no hover fill on "${button.className}"`);
  return token.slice('hover:bg-'.length);
};

describe('ProposalActionRow - the viewer\'s own vote', () => {
  it.each([
    ['up', 0],
    ['neutral', 1],
    ['down', 2],
  ] as const)('says that %s is the chosen vote, and only that one', (vote, index) => {
    renderRow(vote);
    voteButtons().forEach((button, i) => {
      expect(button).toHaveAttribute('aria-pressed', i === index ? 'true' : 'false');
    });
  });

  it('paints the chosen neutral apart from its box and from a hovered button, at 3:1', () => {
    renderRow('neutral');
    const [up, neutral] = voteButtons();
    const box = neutral.parentElement as HTMLElement;
    const boxFill = restingFill(box);
    const chosen = restingFill(neutral);
    expect(tokenContrast(chosen, boxFill)).toBeGreaterThanOrEqual(3);
    expect(tokenContrast(chosen, hoverFill(up))).toBeGreaterThanOrEqual(3);
    // Its count and icon still read on that fill.
    const count = within(neutral).getByText('1');
    expect(effectivePair(count).ratio).toBeGreaterThanOrEqual(4.5);
  });
});
