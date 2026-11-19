import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import AvatarPicker from '../components/common/AvatarPicker';
import { AVATAR_FAMILIES, AVATAR_FAMILY_LABEL_KEYS, AVATAR_NAME_KEYS } from '../components/common/avatars/avatarArt';
import { avatarColorClasses } from '../utils/participantColors';
import { en, fr } from '../i18n/messages';
import { classColor, effectivePair, tokenContrast } from './helpers/tailwindTheme';

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
      expect(within(panel).getByRole('button', { name: messages['avatars.picker.initials'] })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'My initials' }).getAttribute('aria-pressed')).toBe('false');
    // The person's name and the picture's, beside the big avatar.
    expect(screen.getByText('Léa Martin')).toBeTruthy();
    expect(screen.getAllByText('Hourglass').length).toBeGreaterThan(0);
  });

  it('exposes "My initials" as the choice when there is none, or one this release does not draw', () => {
    for (const currentAvatarId of [null, 'space-whale']) {
      const { unmount } = renderPicker({ currentAvatarId });
      expect(screen.getByRole('tab', { selected: true }).textContent).toBe(en['avatars.family.animals']);
      expect(screen.getByRole('button', { name: 'My initials' }).getAttribute('aria-pressed')).toBe('true');
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

  it('writes once per click, and nothing for the choice already held', async () => {
    const { onPick } = renderPicker({ currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'Fox' }));
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Owl' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith('owl');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Owl' }).getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByRole('button', { name: 'Fox' }).getAttribute('aria-pressed')).toBe('false');
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

  it('swaps the big avatar once on success and stays open until Done', async () => {
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

  it('writes null for "My initials"', async () => {
    const { onPick } = renderPicker({ currentAvatarId: 'fox' });
    fireEvent.click(screen.getByRole('button', { name: 'My initials' }));
    expect(onPick).toHaveBeenCalledWith(null);
    await waitFor(() => expect(screen.getByRole('button', { name: 'My initials' }).getAttribute('aria-pressed')).toBe('true'));
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
      within(screen.getByRole('button', { name: 'My initials' })).getByText('LM'),
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
    // Every control shows where the keyboard is.
    for (const control of within(dialog).getAllByRole('button').concat(screen.getAllByRole('tab'))) {
      expect(control.className, control.textContent ?? '').toMatch(/focus-visible:ring/);
    }
    await act(async () => { first.resolve(); });
  });

  it('lays the pictures out four to a row at least on a phone, each a 44px target', () => {
    renderPicker();
    const grid = screen.getByRole('tabpanel').querySelector('[data-avatar-grid]') as HTMLElement;
    // 3.5rem tiles: four fit the 272px a 320px screen leaves the grid.
    expect(grid.className).toContain('grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))]');
    for (const tile of within(grid).getAllByRole('button')) expect(tile.className).toContain('min-h-11');
  });
});
