import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EFFECT_LENGTH_MS } from '../components/common/motion/effects';
import { ARRIVAL_MS, POP_MS } from '../components/session/usePanelMotion';
import ModalDialog from '../components/common/ModalDialog';
import AvatarPicker from '../components/common/AvatarPicker';
import LanguageProvider from '../i18n/LanguageProvider';
import { avatarColorClasses } from '../utils/participantColors';
import { prefersMotion, restoreMotionPreference } from './helpers/motionPreference';

/**
 * The classes React puts on for one animation come off at its animationend,
 * or by a clock when none comes: the participants panel listens for none at
 * all, the avatar picker's swap and a dialog's entrance keep a clock as a net.
 * Each clock is read from `EFFECT_LENGTH_MS`, which motionEffects.test.ts holds
 * to index.css, so an animation lengthened in the stylesheet is never cut
 * short by a copy of its old length (review finding F34). These cases hold
 * each net past its animation, and at the length it has today.
 */

const longest = (...effects: string[]) => Math.max(...effects.map((effect) => EFFECT_LENGTH_MS[effect]));

afterEach(() => restoreMotionPreference());

describe('the nets of the classes React puts on', () => {
  it('lets the participants panel’s arrival and springs play whole, at today’s lengths', () => {
    expect(ARRIVAL_MS).toBe(longest('fx-person-in', 'fx-halo', 'fx-pop') + 100);
    expect(POP_MS).toBe(longest('fx-pop', 'fx-bump') + 50);
    expect([ARRIVAL_MS, POP_MS]).toEqual([2200, 500]);
  });

  it('takes a dialog’s entrance off a second after it opened when no animation ends, and never before its animation', () => {
    prefersMotion('no-preference');
    vi.useFakeTimers();
    const view = render(<ModalDialog label="Stuck" onClose={() => {}}><button type="button">One</button></ModalDialog>);
    try {
      const dialog = screen.getByRole('dialog');
      const entering = () => [dialog.classList.contains('fx-dialog-in'), (dialog.parentElement as HTMLElement).classList.contains('fx-veil-in')];
      act(() => { vi.advanceTimersByTime(longest('fx-dialog-in', 'fx-veil-in')); });
      expect(entering()).toEqual([true, true]);
      act(() => { vi.advanceTimersByTime(999 - longest('fx-dialog-in', 'fx-veil-in')); });
      expect(entering()).toEqual([true, true]);
      act(() => { vi.advanceTimersByTime(1); });
      expect(entering()).toEqual([false, false]);
    } finally {
      // The clock runs dry before the real one comes back (AGENTS.md → Testing).
      view.unmount();
      act(() => { vi.runOnlyPendingTimers(); });
      vi.useRealTimers();
    }
  });

  it('takes the avatar picker’s swap off 700 ms after it began when no animation ends, and never before its animation', async () => {
    prefersMotion('no-preference');
    vi.useFakeTimers();
    const view = render(
      <LanguageProvider initialLanguage="en">
        <AvatarPicker
          open
          onClose={() => {}}
          colorClasses={avatarColorClasses('bg-rose-500')}
          initials="LM"
          name="Léa Martin"
          currentAvatarId={null}
          onPick={async () => {}}
        />
      </LanguageProvider>
    );
    try {
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Bee' })); });
      const swapping = () => document.querySelector('.fx-swap') !== null;
      expect(swapping()).toBe(true);
      act(() => { vi.advanceTimersByTime(EFFECT_LENGTH_MS['fx-swap']); });
      expect(swapping()).toBe(true);
      act(() => { vi.advanceTimersByTime(699 - EFFECT_LENGTH_MS['fx-swap']); });
      expect(swapping()).toBe(true);
      act(() => { vi.advanceTimersByTime(1); });
      expect(swapping()).toBe(false);
    } finally {
      view.unmount();
      act(() => { vi.runOnlyPendingTimers(); });
      vi.useRealTimers();
    }
  });
});
