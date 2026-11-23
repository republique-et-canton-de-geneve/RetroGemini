import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import VoteBudget from '../components/session/VoteBudget';
import {
  MAX_VOTE_TOKENS,
  TOKEN_CAST_CLASSES,
  TOKEN_LEFT_CLASSES,
  VOTE_BUDGET_HOOKS,
  shakeVoteBudget,
  voteFlightHome,
  voteFlightStart,
} from '../components/session/voteControls';
import { effectivePair, tokenContrast } from './helpers/tailwindTheme';

/**
 * The Vote bar's budget: the sentence the tests and the e2e suite read, and a
 * row of tokens for the eye, hidden from assistive technology.
 */

/** A board past its quiet seconds (Session.tsx → budgetMotionQuiet): what the budget draws, it plays. */
const notQuiet = () => false;

const borderToken = (className: string) => /(?:^|\s)border-((?:slate|indigo)-\d+)(?:\s|$)/.exec(className)?.[1];
const tokens = (container: HTMLElement) => [...container.querySelectorAll('[data-vote-token]')];

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
  vi.useRealTimers();
});

describe('VoteBudget', () => {
  it('keeps the sentence exactly, as the only text of the chip', () => {
    const { container } = render(<VoteBudget left={4} cast={1} budget={5} unlimited={false} motionQuiet={notQuiet} />);
    const chip = screen.getByText('4 votes remaining');
    expect(chip.getAttribute('data-vote-budget')).toBe('');
    expect(chip.textContent).toBe('4 votes remaining');
    expect(container.querySelectorAll('*')).not.toHaveLength(0);
    render(<VoteBudget left={1} cast={4} budget={5} unlimited={false} motionQuiet={notQuiet} />);
    expect(screen.getByText('1 vote remaining')).toBeTruthy();
  });

  it('keeps the French sentence exactly', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <VoteBudget left={3} cast={2} budget={5} unlimited={false} motionQuiet={notQuiet} />
        <VoteBudget left={1} cast={4} budget={5} unlimited={false} motionQuiet={notQuiet} />
      </LanguageProvider>,
    );
    // The no-break space before the colon, as the dictionary writes it.
    expect([...document.querySelectorAll(VOTE_BUDGET_HOOKS.chip)].map((chip) => chip.textContent)).toEqual([
      'Votes restants\u00a0: 3',
      'Vote restant\u00a0: 1',
    ]);
  });

  it('never says a negative number', () => {
    render(<VoteBudget left={-2} cast={3} budget={3} unlimited={false} motionQuiet={notQuiet} />);
    expect(screen.getByText('0 votes remaining')).toBeTruthy();
  });

  it.each([1, 5, MAX_VOTE_TOKENS])('draws one token per vote for a budget of %i, filled while left', (budget) => {
    const left = Math.ceil(budget / 2);
    const { container } = render(<VoteBudget left={left} cast={budget - left} budget={budget} unlimited={false} motionQuiet={notQuiet} />);
    const all = tokens(container);
    expect(all).toHaveLength(budget);
    expect(all.filter((t) => t.getAttribute('data-vote-token') === 'left')).toHaveLength(left);
    // The filled ones come first, the next one to use is the last of them.
    expect(all.slice(0, left).every((t) => t.getAttribute('data-vote-token') === 'left')).toBe(true);
    expect(container.querySelector(VOTE_BUDGET_HOOKS.next)).toBe(all[left - 1]);
    const row = container.querySelector(VOTE_BUDGET_HOOKS.row)!;
    expect(row.getAttribute('aria-hidden')).toBe('true');
    expect(row.textContent).toBe('');
  });

  it('draws no token for a vote one vote per item leaves nowhere to place', () => {
    // Five votes, three items, none voted: three left, and nothing cast.
    const { container, rerender } = render(<VoteBudget left={3} cast={0} budget={5} unlimited={false} motionQuiet={notQuiet} />);
    expect(tokens(container).map((t) => t.getAttribute('data-vote-token'))).toEqual(['left', 'left', 'left']);
    // All three voted: three outlines, for the three votes given.
    rerender(<VoteBudget left={0} cast={3} budget={5} unlimited={false} motionQuiet={notQuiet} />);
    expect(tokens(container).map((t) => t.getAttribute('data-vote-token'))).toEqual(['cast', 'cast', 'cast']);
    expect(screen.getByText('0 votes remaining')).toBeTruthy();
  });

  it.each([
    ['above ten votes', { left: 3, cast: 0, budget: MAX_VOTE_TOKENS + 1, unlimited: false }],
  ])('draws no row %s, and keeps the sentence', (_case, props) => {
    const { container } = render(<VoteBudget {...props} motionQuiet={notQuiet} />);
    expect(container.querySelector(VOTE_BUDGET_HOOKS.row)).toBeNull();
    expect(screen.getByText('3 votes remaining')).toBeTruthy();
    // A flight then starts from the chip.
    expect(voteFlightStart(container)).toBe(container.querySelector(VOTE_BUDGET_HOOKS.chip));
  });

  it('draws nothing with unlimited votes', () => {
    const { container } = render(<VoteBudget left={3} cast={0} budget={5} unlimited motionQuiet={notQuiet} />);
    expect(container.innerHTML).toBe('');
  });

  it('points flights at the next token and home at the row', () => {
    const { container } = render(<VoteBudget left={0} cast={3} budget={3} unlimited={false} motionQuiet={notQuiet} />);
    // Nothing left: no next token, the chip is the start.
    expect(container.querySelector(VOTE_BUDGET_HOOKS.next)).toBeNull();
    expect(voteFlightStart(container)).toBe(container.querySelector(VOTE_BUDGET_HOOKS.chip));
    expect(voteFlightHome(container)).toBe(container.querySelector(VOTE_BUDGET_HOOKS.row));
  });

  it('measures the sentence and the tokens against the chip', () => {
    const { container } = render(<VoteBudget left={2} cast={2} budget={4} unlimited={false} motionQuiet={notQuiet} />);
    expect(effectivePair(screen.getByText('2 votes remaining')).ratio).toBeGreaterThanOrEqual(4.5);
    const chipBg = effectivePair(screen.getByText('2 votes remaining')).bg;
    const cast = container.querySelector('[data-vote-token="cast"]')!;
    expect(cast.className).toBe(TOKEN_CAST_CLASSES);
    // The outline is the token's only edge: 3:1 against the chip (1.4.11).
    expect(tokenContrast(borderToken(TOKEN_CAST_CLASSES)!, chipBg)).toBeGreaterThanOrEqual(3);
    expect(TOKEN_LEFT_CLASSES).toContain('bg-indigo-600');
    expect(tokenContrast('indigo-600', chipBg)).toBeGreaterThanOrEqual(3);
  });

  it('shakes the chip when a vote is refused, and only with motion allowed', () => {
    vi.useFakeTimers();
    const { container } = render(<VoteBudget left={0} cast={3} budget={3} unlimited={false} motionQuiet={notQuiet} />);
    const chip = container.querySelector(VOTE_BUDGET_HOOKS.chip)!;
    expect(shakeVoteBudget(container)).toBe(false);
    expect(chip.className).not.toContain('fx-nope');
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') })) as unknown as typeof window.matchMedia;
    expect(shakeVoteBudget(container)).toBe(true);
    expect(chip.classList.contains('fx-nope')).toBe(true);
    act(() => { vi.runAllTimers(); });
    expect(chip.classList.contains('fx-nope')).toBe(false);
  });

  // While the board is quiet (a number the server's first state or a
  // reconnection's snapshot brings back), the refilled token is drawn without
  // its spring; past the quiet, the next one springs in.
  it('springs no refilled token in while the board is quiet', () => {
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') })) as unknown as typeof window.matchMedia;
    const quiet = () => true;
    const { container, rerender } = render(<VoteBudget left={1} cast={2} budget={3} unlimited={false} motionQuiet={quiet} />);
    rerender(<VoteBudget left={2} cast={1} budget={3} unlimited={false} motionQuiet={quiet} />);
    expect(screen.getByText('2 votes remaining')).toBeTruthy();
    expect(container.querySelector('.fx-pop')).toBeNull();
    rerender(<VoteBudget left={3} cast={0} budget={3} unlimited={false} motionQuiet={notQuiet} />);
    expect(container.querySelector(VOTE_BUDGET_HOOKS.next)!.classList.contains('fx-pop')).toBe(true);
  });

  it('springs in the token a vote taken back refills, never on first draw', () => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({ matches: query.includes('no-preference') })) as unknown as typeof window.matchMedia;
    const { container, rerender } = render(<VoteBudget left={1} cast={2} budget={3} unlimited={false} motionQuiet={notQuiet} />);
    expect(container.querySelector('.fx-pop')).toBeNull();
    rerender(<VoteBudget left={2} cast={1} budget={3} unlimited={false} motionQuiet={notQuiet} />);
    expect(container.querySelector(VOTE_BUDGET_HOOKS.next)!.classList.contains('fx-pop')).toBe(true);
    act(() => { vi.runAllTimers(); });
    rerender(<VoteBudget left={1} cast={2} budget={3} unlimited={false} motionQuiet={notQuiet} />);
    expect(container.querySelector('.fx-pop')).toBeNull();
  });
});
