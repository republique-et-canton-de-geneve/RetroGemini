import React, { useState } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BoardVoteControl from '../components/session/BoardVoteControl';
import { BOARD_VOTE_CLASSES } from '../components/session/voteControls';
import { cardTones } from '../utils/cardTones';
import { contrastRatio } from '../utils/colorUtils';
import { effectivePair, themeValue } from './helpers/tailwindTheme';
import { prefersMotion, restoreMotionPreference } from './helpers/motionPreference';

/**
 * The open board's one-button vote control, restyled in place: its names,
 * test ids, focus handover and `aria-disabled` are behaviour, its colours are
 * measured on white and on a card's tint.
 */

const COLUMN_COLOURS = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b', '#000000', '#ffffff'];

type Props = React.ComponentProps<typeof BoardVoteControl>;
/** A board past its quiet seconds (Session.tsx → motionQuiet): what the control draws, it plays. */
const notQuiet = () => false;
const props = (over: Partial<Props> = {}): Props => ({
  kind: 'ticket', total: 2, mine: 0, canAdd: true, readOnly: false, countHidden: false, disabled: false,
  onAdd: vi.fn(), onRemove: vi.fn(), motionQuiet: notQuiet, ...over,
});

const Harness: React.FC<{ budget: number; takeBackOnly?: boolean; start?: number }> = ({ budget, takeBackOnly, start = 0 }) => {
  const [mine, setMine] = useState(start);
  return (
    <div data-vote-focus-host="" tabIndex={-1} data-testid="host">
      <BoardVoteControl
        {...props({ total: mine + 1, mine, canAdd: mine < budget, takeBackOnly })}
        onAdd={() => setMine((n) => n + 1)}
        onRemove={() => setMine((n) => n - 1)}
      />
    </div>
  );
};

// A case that wants an effect states the reader's preference with the helper,
// whose two queries answer consistently; jsdom has no matchMedia at all.
// What was drawn goes, and the clock runs dry, before the real clock comes
// back (AGENTS.md → Testing Requirements): jsdom starts its rendering
// interval on whatever clock is installed, and one left on a clock that is
// gone never fires again for the rest of the file.
afterEach(() => {
  cleanup();
  if (vi.isFakeTimers()) act(() => { vi.runOnlyPendingTimers(); });
  vi.useRealTimers();
  restoreMotionPreference();
});

describe('BoardVoteControl', () => {
  it('keeps its names, test ids and ligatures', () => {
    render(<BoardVoteControl {...props({ mine: 1, total: 3 })} />);
    const add = screen.getByRole('button', { name: '3 votes, add a vote to this ticket' });
    expect(add.getAttribute('data-testid')).toBe('vote-add');
    expect(within(add).getByTestId('vote-total').textContent).toBe('3');
    // sessionOpenBoard clicks the thumb's own element: it stays a child of its own.
    expect(within(add).getByText('thumb_up').className).toContain('material-symbols-outlined');
    expect(screen.getByTestId('board-vote-control')).toBeTruthy();
    expect(screen.getByTestId('my-votes').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('You gave it 1 vote').className).toContain('sr-only');
    const cross = screen.getByRole('button', { name: 'Take back one of your votes on this ticket' });
    expect(within(cross).getByText('close')).toBeTruthy();
  });

  it('names a group’s and a hidden count’s buttons', () => {
    const { rerender } = render(<BoardVoteControl {...props({ kind: 'group', mine: 1 })} />);
    expect(screen.getByRole('button', { name: '2 votes, add a vote to this group' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take back one of your votes on this group' })).toBeTruthy();
    rerender(<BoardVoteControl {...props({ countHidden: true })} />);
    expect(screen.getByRole('button', { name: 'Add a vote to this ticket' })).toBeTruthy();
    expect(screen.queryByTestId('vote-total')).toBeNull();
  });

  it('shows the total alone, as a plain chip, with voting off', () => {
    render(<BoardVoteControl {...props({ readOnly: true, total: 4 })} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('vote-total').textContent).toContain('4');
    expect(screen.getByText('4 votes in total').className).toContain('sr-only');
  });

  it('keeps the keyboard on the thumb the last vote turns off', async () => {
    const user = userEvent.setup();
    render(<Harness budget={1} />);
    const add = screen.getByTestId('vote-add');
    add.focus();
    await user.keyboard(' ');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect((add as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(add);
    await user.keyboard(' ');
    expect(screen.getByTestId('my-votes').children).toHaveLength(1);
  });

  it('hands the focus to the thumb before the cross of one’s last vote goes', async () => {
    const user = userEvent.setup();
    render(<Harness budget={2} start={1} />);
    screen.getByRole('button', { name: 'Take back one of your votes on this ticket' }).focus();
    await user.keyboard(' ');
    expect(screen.queryByRole('button', { name: 'Take back one of your votes on this ticket' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('vote-add'));
  });

  it('hands it to the card itself on an item that takes no vote', async () => {
    const user = userEvent.setup();
    render(<Harness budget={2} start={1} takeBackOnly />);
    screen.getByRole('button', { name: 'Take back one of your votes on this ticket' }).focus();
    await user.keyboard(' ');
    expect(document.activeElement).toBe(screen.getByTestId('host'));
  });

  it('turns the cross off while reconnecting and offers no vote', () => {
    const onAdd = vi.fn();
    render(<BoardVoteControl {...props({ mine: 1, disabled: true, onAdd })} />);
    expect((screen.getByRole('button', { name: 'Take back one of your votes on this ticket' }) as HTMLButtonElement).disabled).toBe(true);
    const add = screen.getByTestId('vote-add');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    act(() => { add.click(); });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it.each([
    ['not voted, addable', { mine: 0, canAdd: true }],
    ['not voted, blocked', { mine: 0, canAdd: false }],
    ['voted, addable', { mine: 1, canAdd: true }],
    ['voted, blocked', { mine: 2, canAdd: false }],
  ])('measures the thumb %s at 4.5:1', (_case, over) => {
    render(<BoardVoteControl {...props(over)} />);
    const add = screen.getByTestId('vote-add');
    expect(effectivePair(within(add).getByTestId('vote-total')).ratio).toBeGreaterThanOrEqual(4.5);
    expect(effectivePair(within(add).getByText('thumb_up')).ratio).toBeGreaterThanOrEqual(3);
  });

  it('measures the cross, the dots and the total chip', () => {
    const { rerender } = render(<BoardVoteControl {...props({ mine: 1 })} />);
    expect(effectivePair(screen.getByText('close')).ratio).toBeGreaterThanOrEqual(3);
    expect(BOARD_VOTE_CLASSES.dot).toContain('bg-indigo-600');
    expect(contrastRatio(themeValue('indigo-600'), '#ffffff')).toBeGreaterThanOrEqual(3);
    rerender(<BoardVoteControl {...props({ readOnly: true })} />);
    expect(effectivePair(screen.getByTestId('vote-total').querySelector('[data-vote-count]')!).ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('draws the pill’s edge at 3:1 on every card tint and on white', () => {
    const edge = /(?:^|\s)border-(slate-\d+)(?:\s|$)/.exec(BOARD_VOTE_CLASSES.pill)?.[1];
    const edgeHex = themeValue(edge!);
    expect(contrastRatio(edgeHex, '#ffffff')).toBeGreaterThanOrEqual(3);
    for (const colour of COLUMN_COLOURS) {
      expect(contrastRatio(edgeHex, cardTones(colour)!.tint), colour).toBeGreaterThanOrEqual(3);
    }
    render(<BoardVoteControl {...props()} />);
    expect(screen.getByTestId('board-vote-control').className).toBe(BOARD_VOTE_CLASSES.pill);
  });

  it('keeps no text under 12px', () => {
    render(<BoardVoteControl {...props({ mine: 5 })} />);
    expect(screen.getByTestId('my-votes').className).not.toMatch(/text-\[(?:\d|1[01])px\]/);
    expect(screen.getByTestId('my-votes').textContent).toBe('5');
  });

  it('springs in the dot a vote adds, answers the press, and leaves no class behind', () => {
    vi.useFakeTimers();
    prefersMotion('no-preference');
    const onAdd = vi.fn();
    const { rerender } = render(<BoardVoteControl {...props({ mine: 1, onAdd })} />);
    expect(document.querySelector('[class*="fx-"]')).toBeNull();
    act(() => { screen.getByTestId('vote-add').click(); });
    expect(onAdd).toHaveBeenCalledTimes(1);
    rerender(<BoardVoteControl {...props({ mine: 2, onAdd })} />);
    // The press is answered once the vote is drawn: the class a first vote
    // gives the thumb would wipe an effect put on during the click.
    expect(screen.getByTestId('vote-add').classList.contains('fx-press')).toBe(true);
    expect(screen.getByTestId('my-votes').lastElementChild!.classList.contains('fx-pop')).toBe(true);
    act(() => { vi.runAllTimers(); });
    expect(document.querySelector('[class*="fx-"]')).toBeNull();
  });

  // While the board is quiet (the server's first state after the cached seed,
  // the snapshot a reconnection brings back), a count that rises is drawn
  // without its spring; a press of the thumb still answers.
  it('springs nothing in while the board is quiet, unless its own thumb was just pressed', () => {
    prefersMotion('no-preference');
    const quiet = () => true;
    const onAdd = vi.fn();
    const { rerender } = render(<BoardVoteControl {...props({ mine: 1, onAdd, motionQuiet: quiet })} />);
    rerender(<BoardVoteControl {...props({ mine: 2, onAdd, motionQuiet: quiet })} />);
    expect(screen.getByTestId('my-votes').children).toHaveLength(2);
    expect(document.querySelector('[class*="fx-"]')).toBeNull();
    act(() => { screen.getByTestId('vote-add').click(); });
    rerender(<BoardVoteControl {...props({ mine: 3, onAdd, motionQuiet: quiet })} />);
    expect(screen.getByTestId('vote-add').classList.contains('fx-press')).toBe(true);
    expect(screen.getByTestId('my-votes').lastElementChild!.classList.contains('fx-pop')).toBe(true);
  });

  it('tells the screen of a thumb pressed while it cannot add, never while reconnecting', async () => {
    const onAdd = vi.fn();
    const onRefused = vi.fn();
    const { rerender } = render(<BoardVoteControl {...props({ canAdd: false, onAdd, onRefused })} />);
    await userEvent.click(screen.getByTestId('vote-add'));
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
    // Offline, nothing is refused for lack of votes: the vote is paused.
    rerender(<BoardVoteControl {...props({ canAdd: true, disabled: true, onAdd, onRefused })} />);
    await userEvent.click(screen.getByTestId('vote-add'));
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
