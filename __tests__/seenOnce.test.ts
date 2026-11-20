import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_REMEMBERED_USERS,
  hasSeenUser,
  nextFocusAfterDismiss,
  nextFocusableAfter,
  readSeenUsers,
  rememberSeenUser,
} from '../components/common/seenOnce';
import { breakStorage } from './helpers/brokenStorage';

/**
 * The seen list of the one-time notes (the Jira discovery note, the avatar
 * hint): who dismissed a note in this browser, one JSON array of member ids
 * under each note's own key. One rule for both notes: per person, the fifty
 * most recent kept, and a storage that fails shows the note again rather than
 * hiding it, since "at least once" is the promise.
 */

const NOTE = 'test-note-seen';
const OTHER_NOTE = 'test-other-note-seen';
const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null');

describe('the seen list of a one-time note', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers a person under the note's own key, apart from every other note", () => {
    rememberSeenUser(NOTE, 'u1');
    expect(stored(NOTE)).toEqual(['u1']);
    expect(hasSeenUser(NOTE, 'u1')).toBe(true);
    // Dismissing one note never hides another.
    expect(hasSeenUser(OTHER_NOTE, 'u1')).toBe(false);
    expect(localStorage.getItem(OTHER_NOTE)).toBeNull();
  });

  it('is per person: another member of the same browser has not seen it', () => {
    rememberSeenUser(NOTE, 'u1');
    expect(hasSeenUser(NOTE, 'u2')).toBe(false);
    rememberSeenUser(NOTE, 'u2');
    expect(readSeenUsers(NOTE)).toEqual(['u1', 'u2']);
  });

  it('keeps the 50 most recent, a person seen again moving to the end', () => {
    localStorage.setItem(NOTE, JSON.stringify(Array.from({ length: 50 }, (_, i) => `u${i}`)));
    expect(MAX_REMEMBERED_USERS).toBe(50);

    // Seen again: moved to the end, and nobody is pushed out.
    rememberSeenUser(NOTE, 'u0');
    let seen = readSeenUsers(NOTE);
    expect(seen).toHaveLength(50);
    expect(seen[0]).toBe('u1');
    expect(seen[49]).toBe('u0');

    rememberSeenUser(NOTE, 'new');
    seen = readSeenUsers(NOTE);
    expect(seen).toHaveLength(MAX_REMEMBERED_USERS);
    expect(seen[49]).toBe('new');
    // The oldest goes, and sees the note once more.
    expect(seen).not.toContain('u1');
    expect(hasSeenUser(NOTE, 'u1')).toBe(false);
  });

  it('keeps only the ids of what another tab left behind', () => {
    localStorage.setItem(NOTE, JSON.stringify(['u1', 42, null, { id: 'u9' }, 'u2']));
    expect(readSeenUsers(NOTE)).toEqual(['u1', 'u2']);
    rememberSeenUser(NOTE, 'u3');
    expect(stored(NOTE)).toEqual(['u1', 'u2', 'u3']);
  });

  it('reads a value that is not a list as nobody', () => {
    for (const value of ['{not json', '{"u1":true}', '"u1"', 'null', '']) {
      localStorage.setItem(NOTE, value);
      expect(readSeenUsers(NOTE), value).toEqual([]);
      expect(hasSeenUser(NOTE, 'u1'), value).toBe(false);
    }
  });

  it('reads nobody, and writes nothing without throwing, when storage throws', () => {
    // A private window, blocked site data: every read and write throws.
    const restore = breakStorage();
    try {
      expect(readSeenUsers(NOTE)).toEqual([]);
      expect(hasSeenUser(NOTE, 'u1')).toBe(false);
      expect(() => rememberSeenUser(NOTE, 'u1')).not.toThrow();
    } finally {
      restore();
    }
    expect(localStorage.getItem(NOTE)).toBeNull();
  });
});

describe('where the keyboard goes when a note goes', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const page = () => {
    document.body.innerHTML = `
      <button id="before">Before</button>
      <div id="note"><button id="inside">Got it</button></div>
      <button disabled>Off</button>
      <input type="hidden" />
      <span tabindex="-1">Skipped</span>
      <a>No address</a>
      <a href="#next" id="next">Next</a>
      <button id="later">Later</button>
      <textarea id="field"></textarea>`;
    return document.getElementById('note') as HTMLElement;
  };

  it('finds the first control after the note, skipping what cannot take the focus', () => {
    const note = page();
    expect(nextFocusableAfter(note)?.id).toBe('next');
  });

  it('finds nothing when no control follows the note', () => {
    document.body.innerHTML = '<button id="before">Before</button><div id="note"><button>Got it</button></div>';
    expect(nextFocusableAfter(document.getElementById('note') as HTMLElement)).toBeNull();
  });

  // A control that is not drawn takes no focus: `focus()` does nothing, and
  // when the note went the keyboard fell to the page. A participant's
  // Icebreaker below lg met it, the participants panel's collapse toggle
  // (`hidden lg:flex`) being the first control after the avatar hint.
  it.each([
    ['under display: none', '<div style="display: none"><button id="skipped">Collapse the panel</button></div>'],
    ['with the hidden attribute', '<button id="skipped" hidden>Collapse the panel</button>'],
    ['under the hidden attribute', '<div hidden><button id="skipped">Collapse the panel</button></div>'],
    ['under visibility: hidden', '<div style="visibility: hidden"><a href="#panel" id="skipped">Panel</a></div>'],
  ])('skips a control %s, for the next one that is drawn', (_, undrawn) => {
    document.body.innerHTML = `
      <div id="note"><button>Got it</button></div>
      ${undrawn}
      <button id="drawn">Next</button>`;
    const note = document.getElementById('note') as HTMLElement;
    expect(document.getElementById('skipped')).not.toBeNull();
    expect(nextFocusableAfter(note)?.id).toBe('drawn');
    // A key's click hands the keyboard on to the same control.
    expect(nextFocusAfterDismiss(note, { detail: 0 })?.id).toBe('drawn');
  });

  it('finds nothing when every control after the note is undrawn', () => {
    document.body.innerHTML = `
      <button id="before">Before</button>
      <div id="note"><button>Got it</button></div>
      <aside style="display: none"><button>Collapse the panel</button></aside>`;
    expect(nextFocusableAfter(document.getElementById('note') as HTMLElement)).toBeNull();
  });

  it('moves the keyboard on only when the keyboard pressed the note, never after a pointer', () => {
    const note = page();
    const inside = document.getElementById('inside') as HTMLElement;
    // Enter or Space on the focused button: its click carries no count, and
    // the next control takes the keyboard.
    inside.focus();
    expect(nextFocusAfterDismiss(note, { detail: 0 })?.id).toBe('next');
    // A pointer's click counts. Chrome and Firefox focus the button they
    // press, and the focus still goes nowhere: moved on after a tap, it
    // landed in the next field and a phone opened its keyboard.
    expect(nextFocusAfterDismiss(note, { detail: 1 })).toBeNull();
    // Safari focuses nothing it clicks: the body keeps the focus, and nothing moves either.
    inside.blur();
    expect(document.activeElement).toBe(document.body);
    expect(nextFocusAfterDismiss(note, { detail: 1 })).toBeNull();
    // Someone typing elsewhere who clicks the note keeps their place.
    (document.getElementById('field') as HTMLElement).focus();
    expect(nextFocusAfterDismiss(note, { detail: 1 })).toBeNull();
    // A note already gone moves nothing.
    expect(nextFocusAfterDismiss(null, { detail: 0 })).toBeNull();
  });
});
