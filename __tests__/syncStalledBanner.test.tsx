import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import SyncStalledBanner from '../components/session/SyncStalledBanner';
import { syncService, type SyncHealth } from '../services/syncService';

/**
 * Incident ISS (2026-10-12). For a whole retrospective the server refused every
 * write of one participant, and nothing on that participant's screen said so:
 * the board looked live, the "Live" chip was green, and the cards they wrote
 * stayed on their own screen for a minute before vanishing one by one. The
 * banner is the one place the client admits it is not being heard, and the one
 * thing that reliably clears the state — a reload, which rejoins with a fresh
 * snapshot.
 *
 * The real `syncService` singleton is used, with only its health spied on: the
 * banner's whole job is to read that service, so a module mock would test the
 * mock.
 */

let notify: ((health: SyncHealth) => void) | null = null;
const unsubscribe = vi.fn();
const originalLocation = window.location;

const useHealth = (initial: SyncHealth) => {
  vi.spyOn(syncService, 'getSyncHealth').mockReturnValue(initial);
  vi.spyOn(syncService, 'onSyncHealth').mockImplementation((callback) => {
    notify = (health) => {
      vi.mocked(syncService.getSyncHealth).mockReturnValue(health);
      callback(health);
    };
    return unsubscribe;
  });
};

describe('SyncStalledBanner', () => {
  beforeEach(() => {
    notify = null;
    unsubscribe.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  });

  it('renders nothing while sync is healthy', () => {
    useHealth('ok');
    const { container } = render(<SyncStalledBanner />);

    expect(container).toBeEmptyDOMElement();
  });

  it('announces that changes are not saved when the session mounts on a stalled sync', () => {
    useHealth('stalled');
    render(<SyncStalledBanner />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Your changes are not being saved.');
    expect(screen.getByRole('button', { name: 'Reload the page' })).toBeTruthy();
  });

  it('appears when sync stalls and goes away when a write is accepted again', () => {
    useHealth('ok');
    render(<SyncStalledBanner />);
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => notify?.('stalled'));
    expect(screen.getByRole('alert')).toBeTruthy();

    act(() => notify?.('ok'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reloads the page from its button', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    });
    useHealth('stalled');
    render(<SyncStalledBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload the page' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops listening when the session screen goes away', () => {
    useHealth('ok');
    const { unmount } = render(<SyncStalledBanner />);

    unmount();

    expect(unsubscribe).toHaveBeenCalled();
  });
});
