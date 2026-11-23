import React, { useState } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import GuidedVoteControl from '../components/session/GuidedVoteControl';
import { GUIDED_VOTE_CLASSES, MAX_VOTE_DOTS } from '../components/session/voteControls';
import { cardTones } from '../utils/cardTones';
import { contrastRatio } from '../utils/colorUtils';
import { effectivePair, themeValue } from './helpers/tailwindTheme';

/**
 * The guided Vote phase's control of a card or group: markup only, the
 * handlers come from the session screen. What it promises: the names, the
 * focus kept at both limits (`aria-disabled`, never `disabled`, the minus never
 * hidden), the ligatures the e2e suite finds, and colours measured on white
 * and on a card's tint.
 */

/** Stored column colours, from light to the darkest a facilitator can pick. */
const COLUMN_COLOURS = ['#10b981', '#ef4444', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#64748b', '#000000', '#ffffff'];

/** A board past its quiet seconds (Session.tsx → motionQuiet): what the control draws, it plays. */
const notQuiet = () => false;

const Harness: React.FC<{ kind?: 'ticket' | 'group'; start?: number; budget?: number }> = ({ kind = 'ticket', start = 0, budget = 2 }) => {
  const [mine, setMine] = useState(start);
  return (
    <GuidedVoteControl
      kind={kind}
      mine={mine}
      canAdd={mine < budget}
      onAdd={() => setMine((n) => n + 1)}
      onRemove={() => setMine((n) => n - 1)}
      motionQuiet={notQuiet}
    />
  );
};

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
});

describe('GuidedVoteControl', () => {
  it.each([
    ['ticket', 'Add a vote to this ticket', 'Remove a vote from this ticket'],
    ['group', 'Add a vote to this group', 'Remove a vote from this group'],
  ] as const)('names its buttons on a %s and keeps their ligatures', (kind, add, remove) => {
    render(<Harness kind={kind} start={1} />);
    const plus = screen.getByRole('button', { name: add });
    const minus = screen.getByRole('button', { name: remove });
    // e2e/retro-full-flow and retro-discuss-my-votes find the plus by its ligature.
    expect(within(plus).getByText('add').className).toContain('material-symbols-outlined');
    expect(within(minus).getByText('remove').getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('guided-vote-control')).toBeTruthy();
  });

  it('says the viewer’s votes in words and hides the dots', () => {
    const { rerender } = render(<GuidedVoteControl kind="ticket" mine={2} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    const dots = screen.getByTestId('my-guided-votes');
    expect(dots.getAttribute('aria-hidden')).toBe('true');
    expect(dots.children).toHaveLength(2);
    expect(dots.hasAttribute('data-vote-count')).toBe(true);
    expect(screen.getByText('You gave it 2 votes').className).toContain('sr-only');
    rerender(<GuidedVoteControl kind="ticket" mine={MAX_VOTE_DOTS + 2} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    expect(screen.getByTestId('my-guided-votes').textContent).toBe(String(MAX_VOTE_DOTS + 2));
    rerender(<GuidedVoteControl kind="ticket" mine={0} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    expect(screen.getByTestId('my-guided-votes').children).toHaveLength(0);
    expect(screen.getByText('You gave it 0 votes')).toBeTruthy();
  });

  it('speaks French with the French names', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <GuidedVoteControl kind="group" mine={1} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />
      </LanguageProvider>,
    );
    expect(screen.getByRole('button', { name: 'Ajouter un vote à ce groupe' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirer un vote de ce groupe' })).toBeTruthy();
  });

  it('keeps the keyboard on the plus that the last vote turns off, and on the minus at zero', async () => {
    const user = userEvent.setup();
    render(<Harness start={1} budget={2} />);
    const plus = screen.getByRole('button', { name: 'Add a vote to this ticket' });
    plus.focus();
    await user.keyboard(' ');
    expect(plus.getAttribute('aria-disabled')).toBe('true');
    expect((plus as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(plus);
    await user.keyboard(' ');
    expect(screen.getByTestId('my-guided-votes').children).toHaveLength(2);

    const minus = screen.getByRole('button', { name: 'Remove a vote from this ticket' });
    minus.focus();
    await user.keyboard(' ');
    await user.keyboard(' ');
    expect(screen.getByTestId('my-guided-votes').children).toHaveLength(0);
    // Never hidden, never disabled: the focus stays where it was.
    expect(minus.isConnected).toBe(true);
    expect(minus.getAttribute('aria-disabled')).toBe('true');
    expect((minus as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(minus);
    await user.keyboard(' ');
    expect(screen.getByTestId('my-guided-votes').children).toHaveLength(0);
  });

  it('measures every state on white: the icons at 3:1, the dots at 3:1', () => {
    const { rerender } = render(<GuidedVoteControl kind="ticket" mine={1} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    const icon = (name: string) => screen.getByText(name);
    expect(effectivePair(icon('add')).ratio).toBeGreaterThanOrEqual(4.5);
    expect(effectivePair(icon('remove')).ratio).toBeGreaterThanOrEqual(4.5);
    rerender(<GuidedVoteControl kind="ticket" mine={0} canAdd={false} onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    // Off, but still told apart from the pill (1.4.11 asks nothing of an
    // inactive control; it is measured anyway).
    expect(effectivePair(icon('add')).ratio).toBeGreaterThanOrEqual(3);
    expect(effectivePair(icon('remove')).ratio).toBeGreaterThanOrEqual(3);
    // The dots, and the brand disc of the plus, stand out from the white pill.
    expect(GUIDED_VOTE_CLASSES.dot).toContain('bg-indigo-600');
    expect(GUIDED_VOTE_CLASSES.plusOn).toContain('bg-indigo-600');
    expect(contrastRatio(themeValue('indigo-600'), '#ffffff')).toBeGreaterThanOrEqual(3);
  });

  it('draws the pill’s edge at 3:1 on every card tint and on white', () => {
    const edge = /(?:^|\s)border-(slate-\d+)(?:\s|$)/.exec(GUIDED_VOTE_CLASSES.pill)?.[1];
    expect(edge).toBeTruthy();
    const edgeHex = themeValue(edge!);
    expect(contrastRatio(edgeHex, '#ffffff')).toBeGreaterThanOrEqual(3);
    for (const colour of COLUMN_COLOURS) {
      const tones = cardTones(colour)!;
      expect(contrastRatio(edgeHex, tones.tint), colour).toBeGreaterThanOrEqual(3);
    }
    render(<GuidedVoteControl kind="ticket" mine={0} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    expect(screen.getByTestId('guided-vote-control').className).toBe(GUIDED_VOTE_CLASSES.pill);
  });

  it('gives each button a 24px target, grown on a touch screen without the two covering each other', () => {
    for (const state of [GUIDED_VOTE_CLASSES.minusOn, GUIDED_VOTE_CLASSES.minusOff, GUIDED_VOTE_CLASSES.plusOn, GUIDED_VOTE_CLASSES.plusOff]) {
      expect(state).toContain('w-6 h-6');
      expect(state).toContain('pointer-coarse:after:-inset-y-2.5');
      expect(state).toContain('relative');
    }
    // 2px each way, inside the 4px gap between the buttons.
    expect(GUIDED_VOTE_CLASSES.pill).toContain('gap-1');
    expect(GUIDED_VOTE_CLASSES.plusOn).toContain('pointer-coarse:after:-inset-x-0.5');
  });

  it('springs in the dot a vote adds and leaves no class behind, never on first draw', () => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') })) as unknown as typeof window.matchMedia;
    const { rerender } = render(<GuidedVoteControl kind="ticket" mine={1} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    expect(document.querySelector('.fx-pop')).toBeNull();
    rerender(<GuidedVoteControl kind="ticket" mine={2} canAdd onAdd={vi.fn()} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    expect(screen.getByTestId('my-guided-votes').lastElementChild!.classList.contains('fx-pop')).toBe(true);
    act(() => { vi.runAllTimers(); });
    expect(document.querySelector('[class*="fx-"]')).toBeNull();
  });

  it('answers a press of the plus, and only when it adds', () => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') })) as unknown as typeof window.matchMedia;
    const onAdd = vi.fn();
    const { rerender } = render(<GuidedVoteControl kind="ticket" mine={0} canAdd={false} onAdd={onAdd} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    const plus = screen.getByRole('button', { name: 'Add a vote to this ticket' });
    act(() => { plus.click(); });
    expect(onAdd).not.toHaveBeenCalled();
    expect(plus.classList.contains('fx-press')).toBe(false);
    rerender(<GuidedVoteControl kind="ticket" mine={0} canAdd onAdd={onAdd} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    act(() => { plus.click(); });
    expect(onAdd).toHaveBeenCalledTimes(1);
    // It answers once the vote is drawn: the class that vote writes on the
    // button (the last one turns the plus off) would wipe an effect put on
    // during the click.
    rerender(<GuidedVoteControl kind="ticket" mine={1} canAdd={false} onAdd={onAdd} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    expect(plus.classList.contains('fx-press')).toBe(true);
    act(() => { vi.runAllTimers(); });
    // A vote that comes from elsewhere (another browser of the viewer's) is no press.
    rerender(<GuidedVoteControl kind="ticket" mine={2} canAdd={false} onAdd={onAdd} onRemove={vi.fn()} motionQuiet={notQuiet} />);
    expect(plus.classList.contains('fx-press')).toBe(false);
  });

  // While the board is quiet (the server's first state after the cached seed,
  // the snapshot a reconnection brings back), a count that rises is drawn
  // without its spring; a press of the plus still answers.
  it('springs nothing in while the board is quiet, unless its own plus was just pressed', () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') })) as unknown as typeof window.matchMedia;
    const quiet = () => true;
    const onAdd = vi.fn();
    const { rerender } = render(<GuidedVoteControl kind="ticket" mine={1} canAdd onAdd={onAdd} onRemove={vi.fn()} motionQuiet={quiet} />);
    rerender(<GuidedVoteControl kind="ticket" mine={2} canAdd onAdd={onAdd} onRemove={vi.fn()} motionQuiet={quiet} />);
    expect(screen.getByTestId('my-guided-votes').children).toHaveLength(2);
    expect(document.querySelector('[class*="fx-"]')).toBeNull();
    const plus = screen.getByRole('button', { name: 'Add a vote to this ticket' });
    act(() => { plus.click(); });
    rerender(<GuidedVoteControl kind="ticket" mine={3} canAdd onAdd={onAdd} onRemove={vi.fn()} motionQuiet={quiet} />);
    expect(screen.getByTestId('my-guided-votes').lastElementChild!.classList.contains('fx-pop')).toBe(true);
    expect(plus.classList.contains('fx-press')).toBe(true);
  });

  it('tells the screen of a plus pressed while it cannot add, and adds nothing', async () => {
    const onAdd = vi.fn();
    const onRefused = vi.fn();
    const { rerender } = render(<GuidedVoteControl kind="ticket" mine={0} canAdd={false} onAdd={onAdd} onRemove={vi.fn()} onRefused={onRefused} motionQuiet={notQuiet} />);
    const plus = screen.getByRole('button', { name: 'Add a vote to this ticket' });
    await userEvent.click(plus);
    expect(onRefused).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
    // The keyboard path is the same click.
    plus.focus();
    await userEvent.keyboard('{Enter}');
    expect(onRefused).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(plus);
    rerender(<GuidedVoteControl kind="ticket" mine={0} canAdd onAdd={onAdd} onRemove={vi.fn()} onRefused={onRefused} motionQuiet={notQuiet} />);
    await userEvent.click(plus);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onRefused).toHaveBeenCalledTimes(2);
  });
});
