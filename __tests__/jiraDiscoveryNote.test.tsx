import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import JiraDiscoveryNote, { JIRA_NOTE_STORAGE_KEY } from '../components/jira/JiraDiscoveryNote';
import { statusWith } from './helpers/jiraClientFetch';

/**
 * The discovery note (spec §5, maintainer 2026-10-20: not everybody reads the
 * changelog): shown to everyone on a deployment with Jira, until each person
 * dismisses it, remembered per browser and user. Never on a deployment
 * without Jira, where it would advertise a feature that does not exist.
 */

const NOTE_TITLE = 'New: create your actions in Jira';
// Written out, not read from the component: a renamed key would show the note
// again to everyone who dismissed it, and nothing else would fail.
const STORAGE_KEY = 'retro-jira-note-seen';
const readSeen = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');

// Makes every read and write of localStorage throw. jsdom's storage is a
// `Storage` (patched on the prototype: assigning to an instance would store an
// item named "getItem"); the memory polyfill of newer Node runtimes is a plain
// object (patched in place).
const breakStorage = (): (() => void) => {
  const fail = () => { throw new Error('SecurityError'); };
  const storage = globalThis.localStorage as Storage;
  if (typeof Storage !== 'undefined' && storage instanceof Storage) {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
    return () => vi.restoreAllMocks();
  }
  const original = { getItem: storage.getItem, setItem: storage.setItem };
  storage.getItem = fail;
  storage.setItem = fail;
  return () => Object.assign(storage, original);
};

describe('JiraDiscoveryNote', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps dismissals under a key that does not change between releases', () => {
    expect(JIRA_NOTE_STORAGE_KEY).toBe(STORAGE_KEY);
  });

  it('is a named note that everyone sees on a deployment with Jira', () => {
    render(<JiraDiscoveryNote status={statusWith()} isFacilitator={false} userId="u2" />);
    expect(screen.getByRole('note', { name: NOTE_TITLE })).toBeInTheDocument();
  });

  it('never appears on a deployment without Jira', () => {
    const { container } = render(
      <JiraDiscoveryNote status={statusWith({ enabled: false })} isFacilitator userId="u1" />
    );
    expect(container).toBeEmptyDOMElement();
    const { container: none } = render(<JiraDiscoveryNote status={null} isFacilitator userId="u1" />);
    expect(none).toBeEmptyDOMElement();
  });

  it('ends with the sentence that fits who reads it and what the team has', () => {
    const { rerender } = render(<JiraDiscoveryNote status={statusWith()} isFacilitator={false} userId="u2" />);
    expect(screen.getByRole('note')).toHaveTextContent('Your facilitator can send the actions to Jira.');

    rerender(<JiraDiscoveryNote status={statusWith()} isFacilitator userId="u1" />);
    expect(screen.getByRole('note')).toHaveTextContent('The “Create in Jira” buttons are just below.');

    rerender(<JiraDiscoveryNote status={statusWith({ token: { configured: false, usable: false } })} isFacilitator userId="u1" />);
    expect(screen.getByRole('note')).toHaveTextContent('add the team’s Jira access token in Settings → Jira');

    // A token is there but something else is missing: no claim that a token is.
    rerender(<JiraDiscoveryNote status={statusWith({ target: null })} isFacilitator userId="u1" />);
    expect(screen.getByRole('note')).toHaveTextContent('finish setting up Jira in Settings → Jira');
    expect(screen.getByRole('note')).not.toHaveTextContent('access token');
  });

  it('is remembered for this user in this browser once dismissed', () => {
    const { unmount } = render(<JiraDiscoveryNote status={statusWith()} isFacilitator userId="u1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(readSeen()).toEqual(['u1']);
    unmount();

    render(<JiraDiscoveryNote status={statusWith()} isFacilitator userId="u1" />);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is still shown to another user of the same browser', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['u1']));
    render(<JiraDiscoveryNote status={statusWith()} isFacilitator={false} userId="u2" />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('keeps the 50 most recent users and survives what another tab left behind', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...Array.from({ length: 50 }, (_, i) => `u${i}`), 42]));
    render(<JiraDiscoveryNote status={statusWith()} isFacilitator={false} userId="new" />);
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));

    const seen = readSeen();
    expect(seen).toHaveLength(50);
    expect(seen[49]).toBe('new');
    expect(seen).not.toContain('u0');
    expect(seen.every((id: unknown) => typeof id === 'string')).toBe(true);
  });

  it('shows the note when the stored value is not a list', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    render(<JiraDiscoveryNote status={statusWith()} isFacilitator={false} userId="u2" />);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('shows the note and still dismisses it for this mount when storage throws', () => {
    // A private window, blocked site data: every read and write throws.
    const restore = breakStorage();
    try {
      render(<JiraDiscoveryNote status={statusWith()} isFacilitator={false} userId="u2" />);
      expect(screen.getByRole('note')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(screen.queryByRole('note')).toBeNull();
    } finally {
      restore();
    }
  });

  it('gives the keyboard to what follows the note once it is dismissed', () => {
    render(
      <div>
        <JiraDiscoveryNote status={statusWith()} isFacilitator userId="u1" />
        <button type="button">Next control</button>
      </div>
    );
    const dismiss = screen.getByRole('button', { name: 'Got it' });
    dismiss.focus();
    fireEvent.click(dismiss);
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
  });

  it('leaves the keyboard where it is when it was elsewhere', () => {
    // A pointer user typing a card clicks "Got it": the field keeps the keyboard.
    render(
      <div>
        <JiraDiscoveryNote status={statusWith()} isFacilitator userId="u1" />
        <button type="button">Next control</button>
        <textarea aria-label="Card" />
      </div>
    );
    const card = screen.getByRole('textbox', { name: 'Card' });
    card.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(card).toHaveFocus();
  });
});
