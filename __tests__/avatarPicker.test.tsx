import React, { useLayoutEffect, useState } from 'react';
import { describe, it, expect, vi, onTestFinished } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import { LANGUAGE_STORAGE_KEY } from '../i18n/languages';
import AvatarPicker from '../components/common/AvatarPicker';
import { AVATAR_FAMILIES, AVATAR_FAMILY_LABEL_KEYS, AVATAR_FAMILY_PITCH_KEYS, AVATAR_NAME_KEYS } from '../components/common/avatars/avatarArt';
import { avatarColorClasses } from '../utils/participantColors';
import { en, fr } from '../i18n/messages';
import { classColor, effectivePair, tokenContrast } from './helpers/tailwindTheme';
import { prefersMotion, restoreMotionPreference } from './helpers/motionPreference';

/**
 * The avatar picker: a dialog of six family tabs, twenty named pictures each
 * and "My initials". One write per choice, the error kept on screen in words,
 * the previous choice kept selected when a write fails, and nothing a reader
 * sees under 4.5:1.
 */

// What dataService.setMemberAvatar throws (AVATAR_NOT_SAVED), translated where it is shown.
const AVATAR_NOT_SAVED = 'The avatar could not be saved.';

type PickerProps = Partial<React.ComponentProps<typeof AvatarPicker>>;

const renderPicker = (props: PickerProps = {}, language: 'en' | 'fr' = 'en') => {
  const onPick = props.onPick ?? vi.fn(async () => {});
  const onClose = props.onClose ?? vi.fn();
  const utils = render(
    <LanguageProvider initialLanguage={language}>
      <AvatarPicker
        open
        onClose={onClose}
        colorClasses={avatarColorClasses('bg-rose-500')}
        initials="LM"
        name="Léa Martin"
        currentAvatarId={null}
        onPick={onPick}
        {...props}
      />
    </LanguageProvider>
  );
  return { ...utils, onPick, onClose };
};

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('AvatarPicker', () => {
  it('renders nothing when closed', () => {
    renderPicker({ open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['en', en],
    ['fr', fr],
  ] as const)('is a dialog named by its title, with six named tabs and twenty named pictures each (%s)', async (language, messages) => {
    renderPicker({}, language);
    const dialog = screen.getByRole('dialog', { name: messages['avatars.picker.title'] });
    const tabs = within(dialog).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(AVATAR_FAMILIES.map((family) => messages[AVATAR_FAMILY_LABEL_KEYS[family.id]]));
    expect(within(dialog).getByRole('tablist').getAttribute('aria-label')).toBe(messages['avatars.picker.families']);

    const seen = new Set<string>();
    for (const [index, family] of AVATAR_FAMILIES.entries()) {
      fireEvent.click(tabs[index]);
      const panel = within(dialog).getByRole('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(tabs[index].id);
      for (const id of family.avatars) {
        const name = messages[AVATAR_NAME_KEYS[id]];
        const button = within(panel).getByRole('button', { name });
        expect(button.getAttribute('aria-pressed')).toBe('false');
        seen.add(name);
      }
      // Led by the initials it shows (WCAG 2.5.3: the visible text is part of the name).
      expect(within(panel).getByRole('button', { name: `LM, ${messages['avatars.picker.initials']}` })).toBeTruthy();
    }
    expect(seen.size).toBe(120);
    expect(within(dialog).getByRole('button', { name: messages['avatars.picker.done'] })).toBeTruthy();
    expect(within(dialog).getByText(messages['avatars.picker.hint'])).toBeTruthy();
  });

  it('opens on the family of the current choice, and exposes it', () => {
    renderPicker({ currentAvatarId: 'hourglass' });
    const selected = screen.getByRole('tab', { selected: true });
    expect(selected.textContent).toBe(en['avatars.family.shapes']);
    expect(screen.getByRole('button', { name: 'Hourglass' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /, My initials$/ }).getAttribute('aria-pressed')).toBe('false');
    // The person's name and the picture's, beside the big avatar.
    expect(screen.getByText('Léa Martin')).toBeTruthy();
    expect(screen.getAllByText('Hourglass').length).toBeGreaterThan(0);
  });

  it('exposes "My initials" as the choice when there is none, or one this release does not draw', () => {
    for (const currentAvatarId of [null, 'space-whale']) {
      const { unmount } = renderPicker({ currentAvatarId });
      expect(screen.getByRole('tab', { selected: true }).textContent).toBe(en['avatars.family.animals']);
      expect(screen.getByRole('button', { name: /, My initials$/ }).getAttribute('aria-pressed')).toBe('true');
      unmount();
    }
  });

  it('moves between tabs with the arrow keys, Home and End, one tab in the tab order', () => {
    renderPicker();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Bubble' })).toBeTruthy();
    fireEvent.keyDown(tabs[1], { key: 'ArrowLeft' });
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[5]);
    fireEvent.keyDown(tabs[5], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0], { key: 'End' });
    expect(document.activeElement).toBe(tabs[5]);
    fireEvent.keyDown(tabs[5], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
    expect(screen.getAllByRole('tab').map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);
  });

  it('writes once per click', async () => {
    const { onPick } = renderPicker({ currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('owl');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('false');
  });

  // The mark is this browser's copy of the choice, and can be older than the
  // server's: picked since in another browser, from the dashboard, the choice
  // reached no session this one is in. A click on the marked picture is the
  // person's latest word, so it is written (the server dates it again, like
  // any pick). Skipped as "already chosen", it left the other browser's pick
  // in place for good.
  it('writes a click on the picture already marked: the mark may be older than what the server holds', async () => {
    const { onPick } = renderPicker({ currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Fox' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('fox');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']));
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('true');
  });

  // A double click is two clicks on one picture: the second waits for the
  // first, and is the choice just stored by then.
  it('writes a double click on one picture once', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('marks the grid busy while a write runs, and makes a second pick wait for it', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    const panel = screen.getByRole('tabpanel');
    expect(panel.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saving']);
    fireEvent.click(screen.getByRole('button', { name: 'Cat' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick).toHaveBeenLastCalledWith('cat');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cat' }).getAttribute('aria-pressed')).toBe('true'));
    expect(panel.querySelector('[aria-busy="true"]')).toBeNull();
  });

  // A pick that waits is written when the write before it settles, through
  // an `onPick` that names no team: dataService writes to the team signed in
  // when the write runs. Its person signed out meanwhile (a sign-out unmounts
  // every opener) and another team signed in before the first write was
  // answered (the ~7 s retry of a rolling update): the pick went to that team,
  // under the old member's id. Once the picker is gone, the pick that waited
  // is not written; the write already on its way ends where it was sent.
  it.each([
    ['answered', (write: ReturnType<typeof deferred>) => write.resolve()],
    ['refused', (write: ReturnType<typeof deferred>) => write.reject(new Error(AVATAR_NOT_SAVED))],
  ])('writes no pick that waited once it is unmounted, the write before it %s', async (_how, settle) => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const { unmount } = renderPicker({ onPick });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cat' }));
    unmount();

    await act(async () => {
      settle(first);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('owl');
  });

  it.each([
    ['en', en, 'The avatar could not be saved.'],
    ['fr', fr, fr['errors.avatarNotSaved']],
  ] as const)('keeps a failure on screen in words and the previous choice selected (%s)', async (language, messages, sentence) => {
    const onPick = vi.fn(async () => { throw new Error(AVATAR_NOT_SAVED); });
    renderPicker({ onPick, currentAvatarId: 'fox' }, language);
    fireEvent.click(screen.getByRole('button', { name: messages['avatars.name.owl'] }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(sentence);
    expect(screen.getByRole('button', { name: messages['avatars.name.fox'] }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: messages['avatars.name.owl'] }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('dialog')).toBeTruthy();
    const pair = effectivePair(alert);
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
  });

  // A message on screen is stored as what to say, never as the sentence
  // (AGENTS.md, *Internationalisation*). The dialog is modal, so the language
  // reaches it from another tab of the app, which the provider follows: a
  // sentence kept in state stayed in the old language under the new screen.
  it.each([
    ['fr', 'en', en['errors.avatarNotSaved'], fr['errors.avatarNotSaved']],
    ['en', 'fr', fr['errors.avatarNotSaved'], en['errors.avatarNotSaved']],
  ] as const)('says a failure in the language the reader switches to while it shows (%s to %s)', async (from, to, sentence, previous) => {
    const onPick = vi.fn(async () => { throw new Error(AVATAR_NOT_SAVED); });
    renderPicker({ onPick, currentAvatarId: 'fox' }, from);
    fireEvent.click(screen.getByRole('button', { name: (from === 'fr' ? fr : en)['avatars.name.owl'] }));
    expect((await screen.findByRole('alert')).textContent).toBe(previous);

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_STORAGE_KEY, newValue: to }));
    });

    expect(screen.getByRole('dialog', { name: (to === 'fr' ? fr : en)['avatars.picker.title'] })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(sentence);
  });

  it('swaps the big avatar once on success and stays open until Done', async () => {
    prefersMotion('no-preference');
    onTestFinished(restoreMotionPreference);
    const { container, onClose } = renderPicker({ currentAvatarId: null });
    expect(container.ownerDocument.querySelector('.fx-swap')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Bee' }));
    await waitFor(() => expect(document.querySelector('.fx-swap [data-avatar-art="bee"]')).not.toBeNull());
    // The class comes off when the swap's own animation ends, so it plays once
    // and never again on a re-render (a timer takes it off where none runs).
    const swapping = document.querySelector('.fx-swap')!;
    // An animation of something inside (the picture) is not the swap's end.
    swapping.querySelector('svg')!.dispatchEvent(new Event('animationend', { bubbles: true }));
    expect(document.querySelector('.fx-swap')).not.toBeNull();
    act(() => { swapping.dispatchEvent(new Event('animationend', { bubbles: true })); });
    expect(document.querySelector('.fx-swap')).toBeNull();
    expect(document.querySelector('[data-avatar-art="bee"]')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('listens for the swap’s end in the commit that puts its class on', async () => {
    // The class and the listener that takes it off must arrive in one commit.
    // A parent's layout effect runs in that very commit, after its children's
    // effects, and sends the animation's end there. Listened for in a passive
    // effect, which runs after the commit (later still when React's scheduler
    // yields, as on a loaded CI runner), that end was lost and the class stayed
    // until the fallback timer: CI run 44646041824 failed the test above so.
    prefersMotion('no-preference');
    onTestFinished(restoreMotionPreference);
    let endsSent = 0;
    const EndInTheSameCommit: React.FC<{ tick: number; children: React.ReactNode }> = ({ children }) => {
      useLayoutEffect(() => {
        const swap = document.querySelector('.fx-swap');
        if (!swap) return;
        endsSent += 1;
        swap.dispatchEvent(new Event('animationend', { bubbles: true }));
      });
      return <>{children}</>;
    };
    const Harness: React.FC = () => {
      const [tick, setTick] = useState(0);
      // The write answers from a timer, and the parent renders again in the
      // same batch as the picker's answer, so both land in one commit.
      const onPick = () => new Promise<void>((resolve) => {
        setTimeout(() => { setTick((value) => value + 1); resolve(); }, 0);
      });
      return (
        <LanguageProvider initialLanguage="en">
          <EndInTheSameCommit tick={tick}>
            <AvatarPicker
              open
              onClose={() => {}}
              colorClasses={avatarColorClasses('bg-rose-500')}
              initials="LM"
              name="Léa Martin"
              currentAvatarId={null}
              onPick={onPick}
            />
          </EndInTheSameCommit>
        </LanguageProvider>
      );
    };
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Bee' }));
    await waitFor(() => expect(endsSent).toBeGreaterThan(0));
    // Heard in its own commit, the end takes the class off at once, long
    // before the fallback timer (700 ms) would.
    await waitFor(() => expect(document.querySelector('.fx-swap')).toBeNull(), { timeout: 400 });
    expect(document.querySelector('[data-avatar-art="bee"]')).not.toBeNull();
  });

  it('shows the choice with no swap for a reader who asked for less motion', async () => {
    prefersMotion('reduce');
    onTestFinished(restoreMotionPreference);
    renderPicker({ currentAvatarId: null });
    fireEvent.click(screen.getByRole('button', { name: 'Bee' }));
    await waitFor(() => expect(document.querySelector('[data-avatar-art="bee"]')).not.toBeNull());
    expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']);
    expect(document.querySelector('.fx-swap')).toBeNull();
  });

  it('writes null for "My initials"', async () => {
    const { onPick } = renderPicker({ currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: /, My initials$/ }));
    expect(onPick).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.getByRole('button', { name: /, My initials$/ }).getAttribute('aria-pressed')).toBe('true'));
  });

  // A pick made while a write runs waits for it. It is dropped only when it is
  // the choice that write just stored (a double click); after a refusal
  // nothing was stored, so the waiting pick is written whatever it is, the
  // marked picture included: the mark went back to this browser's copy of the
  // choice, which can be older than what the server holds.
  it('writes the marked picture picked during a write that is then refused', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fox' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    await act(async () => { first.reject(new Error(AVATAR_NOT_SAVED)); });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick).toHaveBeenLastCalledWith('fox');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']));
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('writes another picture picked during a write that is then refused', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cat' }));
    await act(async () => { first.reject(new Error(AVATAR_NOT_SAVED)); });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick).toHaveBeenLastCalledWith('cat');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cat' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('writes the marked picture picked during a write that lands: the person went back to it', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Fox' }));
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick).toHaveBeenLastCalledWith('fox');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('false');
  });

  // "My initials" is a choice like any picture: refused, the picture stored
  // stays marked; picked while a write runs, it is written after it.
  it('keeps the picture marked when a clear is refused, and says why', async () => {
    const onPick = vi.fn(async () => { throw new Error(AVATAR_NOT_SAVED); });
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: /My initials/ }));
    expect((await screen.findByRole('alert')).textContent).toBe(en['errors.avatarNotSaved']);
    expect(onPick).toHaveBeenCalledWith(null);
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /My initials/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('writes a clear picked during a write once that write has settled', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: /My initials/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(screen.getByRole('button', { name: /My initials/ }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('writes a clear picked during a write that is then refused, and leaves no error once it is stored', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: /, My initials$/ }));
    expect(onPick).toHaveBeenCalledTimes(1);
    await act(async () => { first.reject(new Error(AVATAR_NOT_SAVED)); });
    await waitFor(() => expect(onPick).toHaveBeenCalledTimes(2));
    expect(onPick).toHaveBeenLastCalledWith(null);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']));
    expect(screen.getByRole('button', { name: /, My initials$/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // The second click of a double click waits for the first. Refused, the
  // first stored nothing, so the second is no repeat of a stored choice: it
  // is written, a retry of the refused one, and the refusal is no longer said
  // while that retry runs.
  it('writes a double click again when its first write is refused, and says nothing of the refusal while the retry runs', async () => {
    const first = deferred();
    const retry = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    await act(async () => { first.reject(new Error(AVATAR_NOT_SAVED)); });
    expect(onPick.mock.calls.map(([choice]) => choice)).toEqual(['owl', 'owl']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saving']);
    // Until the retry lands, the choice stored is the one marked.
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('true');

    await act(async () => { retry.resolve(); });
    expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']);
    expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onPick).toHaveBeenCalledTimes(2);
  });

  // Only the latest pick made during a write waits for it: a later pick
  // replaces the one waiting, whatever that one was. The first write runs
  // once, and only the latest pick is written after it.
  it.each([
    ['the second click of a double click', 'Owl'],
    ['the marked picture', 'Fox'],
    ['another picture', 'Cat'],
    ['"My initials"', /, My initials$/],
  ] as const)('never writes %s, picked during a write, when a later pick replaces it', async (_kind, replaced) => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    renderPicker({ onPick, currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    fireEvent.click(screen.getByRole('button', { name: replaced }));
    fireEvent.click(screen.getByRole('button', { name: 'Whale' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']));
    expect(onPick.mock.calls.map(([choice]) => choice)).toEqual(['owl', 'whale']);
    expect(screen.getByRole('button', { name: 'Whale' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('follows a new current choice from its opener', () => {
    const { rerender, onPick, onClose } = renderPicker({ currentAvatarId: 'fox' });
    rerender(
      <LanguageProvider initialLanguage="en">
        <AvatarPicker open onClose={onClose} colorClasses={avatarColorClasses('bg-rose-500')} initials="LM" name="Léa Martin" currentAvatarId="cat" onPick={onPick} />
      </LanguageProvider>
    );
    expect(screen.getByRole('button', { name: 'Cat' }).getAttribute('aria-pressed')).toBe('true');
  });

  // A change of the stored choice that came while a write ran (a pick made in
  // another browser) is the stored one once that write fails: kept aside, the
  // dialog marked the old choice, and a click on it went nowhere.
  it('marks the stored choice after a failed write, a change made meanwhile included', async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const props = { open: true, onClose: vi.fn(), colorClasses: avatarColorClasses('bg-rose-500'), initials: 'LM', name: 'Léa Martin', onPick };
    const { rerender } = render(
      <LanguageProvider initialLanguage="en"><AvatarPicker {...props} currentAvatarId="owl" /></LanguageProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fox' }));
    rerender(<LanguageProvider initialLanguage="en"><AvatarPicker {...props} currentAvatarId="cat" /></LanguageProvider>);
    await act(async () => { first.reject(new Error(AVATAR_NOT_SAVED)); });
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: 'Cat' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('false');
    // Going back to the previous choice is a write again.
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(onPick).toHaveBeenLastCalledWith('owl');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('true'));
  });

  // Two browsers of one person (or two people on the facilitator's seat)
  // pick within one round trip: the other's newer choice reaches the opener
  // while this write runs (stamped on the session's entry), and is still the
  // opener's word once this write has landed. The picker follows that word
  // then, as it does after a failed write: kept on the choice this write
  // stored, it marked a picture neither the session nor the server held any
  // more, reopened included.
  it("marks the opener's word after a write during which the opener reported another choice", async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const props = { onClose: vi.fn(), colorClasses: avatarColorClasses('bg-rose-500'), initials: 'LM', name: 'Léa Martin', onPick };
    const picker = (open: boolean, currentAvatarId: string) => (
      <LanguageProvider initialLanguage="en"><AvatarPicker {...props} open={open} currentAvatarId={currentAvatarId} /></LanguageProvider>
    );
    const { rerender } = render(picker(true, 'fox'));
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    rerender(picker(true, 'bat'));
    await act(async () => { first.resolve(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Bat' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('false');

    rerender(picker(false, 'bat'));
    rerender(picker(true, 'bat'));
    expect(screen.getByRole('button', { name: 'Bat' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('false');
  });

  // The same race the other way round: the other browser's pick was written
  // first, so this write's answer is the newer, and the opener's word turns
  // to this write's choice once that answer is drawn.
  it("marks this write's choice when the opener's word turns to it once the write has landed", async () => {
    const first = deferred();
    const onPick = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    const props = { onClose: vi.fn(), colorClasses: avatarColorClasses('bg-rose-500'), initials: 'LM', name: 'Léa Martin', onPick };
    const picker = (currentAvatarId: string) => (
      <LanguageProvider initialLanguage="en"><AvatarPicker {...props} open currentAvatarId={currentAvatarId} /></LanguageProvider>
    );
    const { rerender } = render(picker('fox'));
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    rerender(picker('bat'));
    await act(async () => { first.resolve(); });
    rerender(picker('owl'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Bat' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe(en['avatars.picker.saved']);
  });

  it('writes nothing while the choice cannot be saved, and says why', () => {
    const { onPick } = renderPicker({ disabled: true });
    const owl = screen.getByRole('button', { name: 'Owl' });
    expect(owl.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(owl);
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByText(en['avatars.picker.unavailable'])).toBeTruthy();
  });

  it('closes on Escape and on the close button, and gives the focus back to its opener', async () => {
    const Opener = () => {
      const [open, setOpen] = useState(false);
      return (
        <LanguageProvider initialLanguage="en">
          <button onClick={() => setOpen(true)}>Open picker</button>
          <AvatarPicker open={open} onClose={() => setOpen(false)} colorClasses={avatarColorClasses('bg-rose-500')} initials="LM" name="Léa" currentAvatarId={null} onPick={async () => {}} />
        </LanguageProvider>
      );
    };
    render(<Opener />);
    const opener = screen.getByRole('button', { name: 'Open picker' });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));

    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('paints every text it shows at 4.5:1 at least, and the selection edge at 3:1', async () => {
    const first = deferred();
    renderPicker({ currentAvatarId: 'fox', onPick: vi.fn(() => first.promise), disabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    const dialog = screen.getByRole('dialog');
    const texts = [
      screen.getByRole('heading', { name: 'Choose my avatar' }),
      screen.getByText('Léa Martin'),
      screen.getByText(en['avatars.picker.hint']),
      screen.getByRole('status'),
      ...screen.getAllByRole('tab'),
      screen.getByRole('button', { name: 'Done' }),
      within(screen.getByRole('button', { name: /, My initials$/ })).getByText('LM'),
    ];
    for (const element of texts) {
      const pair = effectivePair(element);
      expect(pair.ratio, `${element.textContent}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
    }
    // The picture's name under the person's name.
    const pictureName = within(dialog).getAllByText('Fox').find((node) => !node.closest('button'))!;
    expect(effectivePair(pictureName).ratio).toBeGreaterThanOrEqual(4.5);
    // The chosen tile says so with its edge: the brand line on its tint and on the panel.
    const chosen = screen.getByRole('button', { name: 'Fox' });
    expect(chosen.className.split(/\s+/)).toContain('border-indigo-600');
    // One background per tile, or stylesheet order would decide which one shows
    // (classColor throws on two): the chosen tile is the brand tint, the others white.
    expect(classColor(chosen.className, 'bg')).toBe('indigo-50');
    expect(classColor(screen.getByRole('button', { name: 'Cat' }).className, 'bg')).toBe('white');
    expect(tokenContrast('indigo-600', 'indigo-50')).toBeGreaterThanOrEqual(3);
    expect(tokenContrast('indigo-600', 'white')).toBeGreaterThanOrEqual(3);
    // Every control shows where the keyboard is with a solid outline, as the
    // phase bar does: a translucent ring measured 1.6:1, and forced colours
    // drop a ring (a box-shadow) while they keep an outline.
    for (const control of within(dialog).getAllByRole('button').concat(screen.getAllByRole('tab'))) {
      const classes = control.className.split(/\s+/);
      expect(classes, control.textContent ?? '').toEqual(expect.arrayContaining([
        'focus-visible:outline-2', 'focus-visible:outline-offset-2', 'focus-visible:outline-indigo-600',
      ]));
      expect(classes.filter((token) => /outline-(none|hidden)|focus-visible:ring/.test(token)), control.textContent ?? '').toEqual([]);
    }
    // Offset by 2px, the outline lies on the dialog's white surface; the brand
    // line clears 3:1 there and on the brand tint of a chosen tile.
    expect(tokenContrast('indigo-600', 'white')).toBeGreaterThanOrEqual(3);
    expect(tokenContrast('indigo-600', 'indigo-50')).toBeGreaterThanOrEqual(3);
    await act(async () => { first.resolve(); });
  });

  // The selected tab is told apart by more than its hue (WCAG 1.4.1): its
  // words are underlined, the others' are not.
  it('marks the selected family with an underline, not colour alone', () => {
    renderPicker();
    const tabs = screen.getAllByRole('tab');
    for (const [index, tab] of tabs.entries()) {
      fireEvent.click(tabs[index]);
      for (const other of screen.getAllByRole('tab')) {
        const underlined = other.className.split(/\s+/).includes('underline');
        expect(underlined, `${other.textContent} while ${tab.textContent} is selected`).toBe(other === tab);
      }
    }
  });

  it.each([
    ['en', en],
    ['fr', fr],
  ] as const)("says what the selected family holds, in the panel it describes (%s)", (language, messages) => {
    renderPicker({}, language);
    const tabs = screen.getAllByRole('tab');
    for (const [index, family] of AVATAR_FAMILIES.entries()) {
      fireEvent.click(tabs[index]);
      const panel = screen.getByRole('tabpanel');
      // Matched on the raw text: getByText normalises the French no-break spaces in the element only.
      const sentence = messages[AVATAR_FAMILY_PITCH_KEYS[family.id]];
      const pitch = within(panel).getByText((_content, element) => element?.tagName === 'P' && element.textContent === sentence);
      // Read with the panel: a screen reader entering it hears the pitch.
      expect(panel.getAttribute('aria-describedby')).toBe(pitch.id);
      const pair = effectivePair(pitch);
      expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('lays the pictures out four to a row at least on a phone, each a 44px target', () => {
    renderPicker();
    const grid = screen.getByRole('tabpanel').querySelector('[data-avatar-grid]') as HTMLElement;
    // 3.5rem tiles: four fit the 272px a 320px screen leaves the grid.
    expect(grid.className).toContain('grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))]');
    for (const tile of within(grid).getAllByRole('button')) expect(tile.className).toContain('min-h-11');
  });
});
