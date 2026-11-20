import React, { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AvatarDiscoveryHint from '../components/common/AvatarDiscoveryHint';
import { AVATAR_HINT_STORAGE_KEY, useAvatarDiscoveryHint } from '../components/common/useAvatarDiscoveryHint';
import ViewerAvatarButton from '../components/session/ViewerAvatarButton';
import LanguageProvider from '../i18n/LanguageProvider';
import { AVATAR_IDS } from '../utils/avatars.js';
import { avatarColorClasses } from '../utils/participantColors';
import type { User } from '../types';
import { breakStorage } from './helpers/brokenStorage';
import { effectivePair, tokenContrast } from './helpers/tailwindTheme';

/**
 * The one-time avatar hint (AGENTS.md, *Avatars*): nothing told people they
 * could change their avatar, so each person is shown, once, a band under the
 * header that says so, and the opener carries a dot while it shows.
 *
 * It shows only to someone who has never used the picker (no stored choice,
 * a cleared one counting as one), where a picture would be drawn (not in an
 * anonymous session) and could be saved (not with a revoked credential). It
 * is decided at the first render and, once gone, never comes back in the
 * same mount, so it never moves the board while people work. It is
 * remembered per member and browser through the one-time notes' seen list,
 * under its own key: by its two buttons, and whenever the picker opens.
 */

const HINT = 'New: choose your avatar';
// Written out, not read from the hook: a renamed key would show the hint
// again to everyone who has had it, and nothing else would fail.
const STORAGE_KEY = 'retro-avatar-hint-seen';
const seen = (): unknown => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

const ada: User = { id: 'ada', name: 'Ada Lovelace', color: 'bg-rose-500', role: 'participant' };
const bob: User = { id: 'bob', name: 'Bob Martin', color: 'bg-indigo-500', role: 'facilitator' };

interface HarnessProps {
  user?: User;
  hasChoice?: boolean;
  anonymous?: boolean;
  blocked?: boolean;
  visibilityClass?: string;
  /** Called when the picker opens, before its state changes. */
  onOpenPicker?: () => void;
}

/**
 * What a screen does with the hint: the opener in a header, the band under
 * it, and something after the band for the keyboard to land on.
 */
const Harness: React.FC<HarnessProps> = ({
  user = ada,
  hasChoice = false,
  anonymous = false,
  blocked = false,
  visibilityClass,
  onOpenPicker,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => {
    onOpenPicker?.();
    setPickerOpen(true);
  }, [onOpenPicker]);
  const hint = useAvatarDiscoveryHint({ userId: user.id, hasChoice, anonymous, blocked, pickerOpen, openPicker });
  return (
    <>
      <header>
        <ViewerAvatarButton user={user} avatarId={null} onClick={openPicker} marked={hint.shown} ref={hint.openerRef} />
      </header>
      <AvatarDiscoveryHint user={user} hint={hint} visibilityClass={visibilityClass} />
      <button type="button">Next control</button>
      <textarea aria-label="Card" />
      {pickerOpen && (
        <div role="dialog" aria-label="Picker">
          <button type="button" onClick={() => setPickerOpen(false)}>Close the picker</button>
        </div>
      )}
    </>
  );
};

const opener = () => document.querySelector('header [data-viewer-avatar]') as HTMLElement;
const dot = () => opener().querySelector('[data-avatar-hint-dot]');
// Read from the attribute: a picture's SVG elements carry no string className.
const tokens = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

describe('the avatar hint', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps who has had it under a key that does not change between releases', () => {
    expect(AVATAR_HINT_STORAGE_KEY).toBe(STORAGE_KEY);
  });

  it('is a note named by its title, saying how many drawings there are and where to change it', () => {
    render(<Harness />);
    const note = screen.getByRole('note', { name: HINT });
    expect(note).toHaveTextContent(
      `Swap your initials for one of ${AVATAR_IDS.length} drawings. You can change it at any time from your initials, at the top right.`
    );
    // The count is the list's: it never goes stale.
    expect(AVATAR_IDS.length).toBe(120);
    const choose = within(note).getByRole('button', { name: 'Choose my avatar' });
    expect(choose).toHaveAttribute('aria-haspopup', 'dialog');
    const gotIt = within(note).getByRole('button', { name: 'Got it' });
    // The Review step can show two "Got it" (the Jira note's): each says what it dismisses.
    expect(gotIt).toHaveAccessibleDescription(HINT);
  });

  it('speaks French to a French reader', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <Harness />
      </LanguageProvider>
    );
    // Role names keep the real no-break space before the colon.
    const note = screen.getByRole('note', { name: 'Nouveau\u00a0: choisissez votre avatar' });
    expect(note).toHaveTextContent('Remplacez vos initiales par l’un des 120 dessins. Vous pourrez le changer à tout moment depuis vos initiales, en haut à droite.');
    expect(within(note).getByRole('button', { name: 'Choisir mon avatar' })).toBeInTheDocument();
    expect(within(note).getByRole('button', { name: 'Compris' })).toBeInTheDocument();
  });

  it('is not shown to someone who already chose, nor where no picture is drawn or can be saved', () => {
    // A cleared choice is a choice too: `hasChoice` says so (sessionAvatars.test.ts).
    render(<Harness hasChoice />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(dot()).toBeNull();
    cleanup();
    render(<Harness anonymous />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(dot()).toBeNull();
    cleanup();
    render(<Harness blocked />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(dot()).toBeNull();
    // None of them is remembered: nobody was shown anything.
    expect(seen()).toBeNull();
  });

  it('marks the opener while it shows, with a dot hidden from assistive technology, and moves nothing', () => {
    render(<Harness />);
    const name = 'AD, Ada Lovelace, choose my avatar';
    expect(screen.getByRole('button', { name })).toBe(opener());
    const mark = dot();
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(tokens(opener())).toContain('relative');
    // No motion: a sign that stands still, on a band drawn with the screen.
    for (const element of [screen.getByRole('note'), mark!, ...screen.getByRole('note').querySelectorAll('*')]) {
      expect(tokens(element).filter((token) => token.startsWith('fx-') || token.startsWith('animate-'))).toEqual([]);
    }

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(dot()).toBeNull();
    // The opener keeps its name, its place and its classes.
    expect(screen.getByRole('button', { name })).toBe(opener());
    expect(tokens(opener())).toContain('relative');
  });

  it('is remembered for this person under its own key by "Got it"', () => {
    const { unmount } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(seen()).toEqual(['ada']);
    unmount();

    render(<Harness />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is remembered by "Choose my avatar", which gives the opener the focus before the picker opens', () => {
    // The picker gives the focus back to what had it when it opened: the
    // band is gone by then, so that must be the opener, not the band's button.
    let focusedWhenOpened: Element | null = null;
    render(<Harness onOpenPicker={() => { focusedWhenOpened = document.activeElement; }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Choose my avatar' }));
    expect(focusedWhenOpened).toBe(opener());
    expect(screen.getByRole('dialog', { name: 'Picker' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).toBeNull();
    expect(seen()).toEqual(['ada']);
  });

  it('is remembered, and gone, when the picker opens from the avatar itself', () => {
    render(<Harness />);
    fireEvent.click(opener());
    expect(screen.queryByRole('note')).toBeNull();
    expect(dot()).toBeNull();
    expect(seen()).toEqual(['ada']);
    // Closing the picker does not bring it back.
    fireEvent.click(screen.getByRole('button', { name: 'Close the picker' }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is still shown to another member of the same browser, and a Jira dismissal hides nothing', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['ada']));
    localStorage.setItem('retro-jira-note-seen', JSON.stringify(['bob']));
    render(<Harness user={bob} />);
    expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
    cleanup();
    render(<Harness user={ada} />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is decided per person: another member in the same mount is decided afresh', () => {
    const { rerender } = render(<Harness user={ada} />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    rerender(<Harness user={bob} />);
    expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
    rerender(<Harness user={ada} />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is shown, and dismissed for this mount, when storage throws', () => {
    // A private window, blocked site data: every read and write throws.
    const restore = breakStorage();
    try {
      render(<Harness />);
      expect(screen.getByRole('note', { name: HINT })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(screen.queryByRole('note')).toBeNull();
    } finally {
      restore();
    }
  });

  // Nothing that changes while people work moves the board: the band is drawn
  // with the screen or not at all, and once it has gone it stays gone.
  it('appears only with the screen, and never comes back in the same mount', () => {
    const { rerender } = render(<Harness />);
    expect(screen.getByRole('note')).toBeInTheDocument();
    // The session turns anonymous, then named again.
    rerender(<Harness anonymous />);
    expect(screen.queryByRole('note')).toBeNull();
    rerender(<Harness />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(dot()).toBeNull();
    cleanup();

    // Revoked, then live again.
    const blocked = render(<Harness />);
    blocked.rerender(<Harness blocked />);
    blocked.rerender(<Harness />);
    expect(screen.queryByRole('note')).toBeNull();
    cleanup();

    // Not shown at first (a choice), it does not appear when the choice is cleared elsewhere.
    const chosen = render(<Harness hasChoice />);
    chosen.rerender(<Harness hasChoice={false} />);
    expect(screen.queryByRole('note')).toBeNull();
    expect(dot()).toBeNull();
  });

  it('goes without being written when a choice arrives from elsewhere', () => {
    const { rerender } = render(<Harness />);
    rerender(<Harness hasChoice />);
    expect(screen.queryByRole('note')).toBeNull();
    // The choice is the server's, and stops it in every browser: nothing to write here.
    expect(seen()).toBeNull();
  });

  it('is a note met in reading order: not a live region, and it takes no focus', () => {
    render(<Harness />);
    const note = screen.getByRole('note', { name: HINT });
    expect(note).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    // Never a <header>: the header-fit e2e measures the page's first header.
    expect(note.closest('header')).toBeNull();
    expect(note.querySelector('header')).toBeNull();
  });

  it('gives the keyboard to what follows the band when dismissed from the keyboard', () => {
    render(<Harness />);
    const gotIt = screen.getByRole('button', { name: 'Got it' });
    gotIt.focus();
    fireEvent.click(gotIt);
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
  });

  it('leaves the keyboard where it is when dismissed with a pointer from elsewhere', () => {
    // A pointer user typing a card clicks "Got it": the field keeps the keyboard.
    render(<Harness />);
    const card = screen.getByRole('textbox', { name: 'Card' });
    card.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }), { detail: 1 });
    expect(screen.queryByRole('note')).toBeNull();
    expect(card).toHaveFocus();
  });

  it('puts the keyboard nowhere after a pointer, even on a button the browser focused', () => {
    // Chrome and Firefox focus the button they press. The band moved the
    // focus on from there to the next control, which in a retrospective's
    // Icebreaker is the facilitator's question: a phone opened its keyboard.
    render(<Harness />);
    const gotIt = screen.getByRole('button', { name: 'Got it' });
    gotIt.focus();
    fireEvent.click(gotIt, { detail: 1 });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next control' })).not.toHaveFocus();
    expect(screen.getByRole('textbox', { name: 'Card' })).not.toHaveFocus();
  });

  it("takes the opener's visibility: no band where there is no opener", () => {
    render(<Harness />);
    expect(tokens(screen.getByRole('note'))).toContain('flex');
    expect(tokens(screen.getByRole('note'))).not.toContain('hidden');
    cleanup();
    // A facilitator's opener shows from 360px in a session.
    render(<Harness user={bob} visibilityClass="hidden min-[360px]:flex" />);
    expect(tokens(screen.getByRole('note'))).toEqual(expect.arrayContaining(['hidden', 'min-[360px]:flex']));
    expect(tokens(screen.getByRole('note'))).not.toContain('flex');
  });

  it("draws three sample pictures in the viewer's own tone, hidden from assistive technology", () => {
    render(<Harness user={bob} />);
    const note = screen.getByRole('note');
    const samples = [...note.querySelectorAll('[data-avatar-art]')];
    expect(samples.map((sample) => sample.getAttribute('data-avatar-art'))).toEqual(['fox', 'rocket', 'moon']);
    const tone = avatarColorClasses(bob.color).split(/\s+/).find((token) => token.startsWith('tone-'));
    expect(tone).toBe('tone-indigo');
    for (const sample of samples) {
      expect(tokens(sample)).toContain(tone);
      expect(sample.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    // One wrapper hides the three, shown from sm: on a phone the band keeps
    // to its title and its buttons.
    const wrapper = samples[0].parentElement!.closest('[aria-hidden="true"]') as HTMLElement;
    expect(samples.every((sample) => wrapper.contains(sample))).toBe(true);
    expect(tokens(wrapper)).toEqual(expect.arrayContaining(['hidden', 'sm:flex']));
    // The sentence is read on a phone too, where it is not shown.
    const sentence = within(note).getByText(/Swap your initials/);
    expect(tokens(sentence)).toEqual(expect.arrayContaining(['sr-only', 'sm:not-sr-only']));
  });

  it('reads at AA: every word at 4.5:1, the dot at 3:1 on the header', () => {
    render(<Harness />);
    const note = screen.getByRole('note');
    const measured = [
      within(note).getByText(HINT),
      within(note).getByText(/Swap your initials/),
      within(note).getByRole('button', { name: 'Choose my avatar' }),
      within(note).getByRole('button', { name: 'Got it' }),
    ];
    for (const element of measured) {
      const pair = effectivePair(element);
      expect(pair.ratio, `${element.textContent}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(4.5);
    }
    // The dot is a sign, not text: the brand on the header's white, ringed in white.
    expect(tokens(dot()!)).toEqual(expect.arrayContaining(['bg-indigo-600', 'ring-white']));
    expect(tokenContrast('indigo-600', 'white')).toBeGreaterThanOrEqual(3);
  });
});
