import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import ProposalActionRow from '../components/session/ProposalActionRow';
import { ActionItem, User } from '../types';
import LanguageProvider from '../i18n/LanguageProvider';
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

// A vote button held an icon and, once someone voted, a count: nothing else.
// So its name was the icon's ligature, read out as a word: "thumb_up 2",
// "thumb_down", and for the neutral vote "remove", which says the opposite of
// what the button does. Each is now named in words, with the count it shows
// first (WCAG 2.5.3: the visible number is part of the name), and its icon is
// decoration.
describe('ProposalActionRow - what each vote button is called', () => {
  const bob: User = { id: 'p2', name: 'Bob', color: 'bg-emerald-500', role: 'participant' };
  const carol: User = { id: 'p3', name: 'Carol', color: 'bg-amber-500', role: 'participant' };

  const renderVotes = (proposalVotes: Record<string, 'up' | 'neutral' | 'down'>, language: 'en' | 'fr' = 'en') =>
    render(
      <LanguageProvider initialLanguage={language}>
        <ProposalActionRow
          proposal={{ ...proposal('up'), proposalVotes }}
          participants={[facilitator, alice, bob, carol]}
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
        />
      </LanguageProvider>,
    );

  const names = () => voteButtons().map((button) => button.getAttribute('aria-label'));

  it('names each vote in words while nobody has cast it', () => {
    renderVotes({});
    expect(names()).toEqual(['Vote for', 'Vote neutral', 'Vote against']);
    // The browser computes the name from the label: the ligature is not in it.
    expect(screen.getByRole('button', { name: 'Vote for' })).toBe(voteButtons()[0]);
    expect(screen.getByRole('button', { name: 'Vote neutral' })).toBe(voteButtons()[1]);
    expect(screen.getByRole('button', { name: 'Vote against' })).toBe(voteButtons()[2]);
    expect(screen.queryByRole('button', { name: /thumb_up|remove|thumb_down/ })).toBeNull();
  });

  it('starts the name with the count the button shows', () => {
    renderVotes({ p1: 'up', p2: 'up', p3: 'down' });
    expect(names()).toEqual(['2 votes for', 'Vote neutral', '1 vote against']);
    const [up, , down] = voteButtons();
    // The visible number is a word of the name.
    expect(up.textContent).toContain('2');
    expect(down.textContent).toContain('1');
    expect(up.getAttribute('aria-label')!.split(/\s+/)).toContain('2');
    expect(down.getAttribute('aria-label')!.split(/\s+/)).toContain('1');
  });

  it('says a neutral vote that was cast, never "remove"', () => {
    renderVotes({ p1: 'neutral', p2: 'neutral' });
    expect(names()).toEqual(['Vote for', '2 neutral votes', 'Vote against']);
  });

  it('names them in French', () => {
    renderVotes({ p1: 'up', p2: 'neutral', p3: 'neutral' }, 'fr');
    expect(names()).toEqual(['1 vote pour', '2 votes neutres', 'Voter contre']);
  });

  it('hides each icon from assistive technology and keeps the pressed state', () => {
    renderVotes({ p1: 'up' });
    for (const button of voteButtons()) {
      expect(button.querySelector('.material-symbols-outlined')!.getAttribute('aria-hidden')).toBe('true');
    }
    expect(voteButtons().map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
  });
});
