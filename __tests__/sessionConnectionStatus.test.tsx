import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  SessionConnectionBanner,
  SessionSyncChip
} from '../components/session/SessionConnectionStatus';

/**
 * Audit H12. A refused `join-denied` used to reuse the offline affordance, so a
 * participant whose credential had expired sat in front of a frozen session
 * reading "Reconnecting…" — waiting for a reconnect that could never fix it.
 * These tests pin the two states apart and pin the way out.
 */
describe('SessionConnectionBanner', () => {
  const noop = () => undefined;

  it('renders nothing while the session is live', () => {
    const { container } = render(
      <SessionConnectionBanner isLive joinDeniedReason={null} onReturnToLogin={noop} />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the reconnecting wording for a genuine disconnection', () => {
    render(
      <SessionConnectionBanner isLive={false} joinDeniedReason={null} onReturnToLogin={noop} />
    );

    expect(screen.getByText(/Reconnecting/i)).toBeTruthy();
    expect(screen.getByText(/Nothing you already submitted is lost/i)).toBeTruthy();
    // A disconnection heals by itself: offering a login button here would push
    // users out of a session that is about to come back.
    expect(screen.queryByRole('button', { name: /log in again/i })).toBeNull();
  });

  it('reads differently from the offline banner when the join was denied', () => {
    const offline = render(
      <SessionConnectionBanner isLive={false} joinDeniedReason={null} onReturnToLogin={noop} />
    );
    const offlineText = offline.container.textContent ?? '';
    offline.unmount();

    const denied = render(
      <SessionConnectionBanner
        isLive={false}
        joinDeniedReason="unauthenticated"
        onReturnToLogin={noop}
      />
    );
    const deniedText = denied.container.textContent ?? '';

    expect(deniedText).not.toBe(offlineText);
    expect(deniedText).toMatch(/expired/i);
    expect(deniedText).not.toMatch(/Reconnecting/i);
  });

  it('offers a way back to the login screen when the join was denied', () => {
    const onReturnToLogin = vi.fn();
    render(
      <SessionConnectionBanner
        isLive={false}
        joinDeniedReason="unauthenticated"
        onReturnToLogin={onReturnToLogin}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /log in again/i }));

    expect(onReturnToLogin).toHaveBeenCalledTimes(1);
  });

  it('explains that the session belongs to another team when the token is foreign', () => {
    render(
      <SessionConnectionBanner
        isLive={false}
        joinDeniedReason="forbidden"
        onReturnToLogin={noop}
      />
    );

    expect(screen.getByText(/belongs to another team/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /log in again/i })).toBeTruthy();
  });

  it('shows the denied state even if the socket reports itself live', () => {
    // The socket really is connected when a join is refused — only the
    // credential failed. The denial must win over the connection state.
    render(
      <SessionConnectionBanner isLive joinDeniedReason="unauthenticated" onReturnToLogin={noop} />
    );

    expect(screen.getByRole('button', { name: /log in again/i })).toBeTruthy();
  });
});

describe('SessionSyncChip', () => {
  it('says Live while syncing', () => {
    render(<SessionSyncChip isLive joinDeniedReason={null} />);
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('says Reconnecting for a genuine disconnection', () => {
    render(<SessionSyncChip isLive={false} joinDeniedReason={null} />);
    expect(screen.getByText(/Reconnecting/i)).toBeTruthy();
  });

  it('does not claim to be reconnecting when the credential was refused', () => {
    render(<SessionSyncChip isLive={false} joinDeniedReason="unauthenticated" />);

    expect(screen.queryByText(/Reconnecting/i)).toBeNull();
    expect(screen.getByText(/Signed out/i)).toBeTruthy();
  });
});
