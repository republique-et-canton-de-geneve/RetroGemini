import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import {
  JOIN_DENIED_REVOKED,
  SessionConnectionBanner,
  SessionSyncChip
} from '../components/session/SessionConnectionStatus';
import LanguageProvider from '../i18n/LanguageProvider';
import { syncService, type SyncHealth } from '../services/syncService';

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

/**
 * Decision D3b — the team's password was changed under the session. Not an
 * expiry: the person must use the new password, or a new invitation link, so
 * the banner and the chip say that, in both languages.
 */
describe('a session signed out by a password change', () => {
  it('says the password was changed, and offers the login screen', () => {
    const onReturnToLogin = vi.fn();
    render(<SessionConnectionBanner isLive={false} joinDeniedReason={JOIN_DENIED_REVOKED} onReturnToLogin={onReturnToLogin} />);

    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('The team password was changed, so nothing you do here is being saved any more.');
    expect(banner.textContent).not.toMatch(/expired/i);
    fireEvent.click(screen.getByRole('button', { name: 'Log in again' }));
    expect(onReturnToLogin).toHaveBeenCalledTimes(1);
  });

  it('titles the chip with the reason', () => {
    render(<SessionSyncChip isLive={false} joinDeniedReason={JOIN_DENIED_REVOKED} />);

    expect(screen.getByTitle('Password changed — log in again to rejoin')).toBeTruthy();
  });

  it('says so in French', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <SessionConnectionBanner isLive={false} joinDeniedReason={JOIN_DENIED_REVOKED} onReturnToLogin={() => undefined} />
        <SessionSyncChip isLive={false} joinDeniedReason={JOIN_DENIED_REVOKED} />
      </LanguageProvider>
    );

    expect(screen.getByRole('alert').textContent).toContain('Le mot de passe de l\'équipe a été changé\u00a0: rien de ce que vous faites ici n\'est plus enregistré.');
    expect(screen.getByTitle('Mot de passe changé — reconnectez-vous pour rejoindre la session')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Se reconnecter' })).toBeTruthy();
  });

  // The chip's visible label is the same for every denial. It read "Session
  // expirée" beside a banner saying the password was changed: two different
  // explanations, and the visible one was wrong.
  it('labels the French chip with a word that says nothing expired', () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <SessionSyncChip isLive={false} joinDeniedReason={JOIN_DENIED_REVOKED} />
      </LanguageProvider>
    );

    const chip = screen.getByTitle('Mot de passe changé — reconnectez-vous pour rejoindre la session');
    expect(chip.textContent).toContain('Déconnexion');
    expect(document.body.textContent).not.toContain('Session expirée');
  });
});

/**
 * Review finding G on the incident ISS branch. The not-saved banner said the
 * participant's changes were not being saved while the header chip, a few
 * pixels above it, kept pulsing a green "Live" — "Real-time sync active". Two
 * answers to the same question, and the reassuring one is what a glance
 * reads. The chip reads the same health the banner does, from the service, so
 * neither header can show it on a different rule.
 *
 * The real `syncService` singleton is used with only its health spied on, as
 * in syncStalledBanner.test.tsx.
 */
describe('SessionSyncChip while sync is stalled', () => {
  let notify: ((health: SyncHealth) => void) | null = null;

  const useHealth = (initial: SyncHealth) => {
    vi.spyOn(syncService, 'getSyncHealth').mockReturnValue(initial);
    vi.spyOn(syncService, 'onSyncHealth').mockImplementation((callback) => {
      notify = (health) => {
        vi.mocked(syncService.getSyncHealth).mockReturnValue(health);
        callback(health);
      };
      return () => {};
    });
  };

  const classesOf = (element: HTMLElement) => element.className.split(/\s+/);

  afterEach(() => {
    notify = null;
    vi.restoreAllMocks();
  });

  it('stops saying Live and says the changes are not being saved', () => {
    useHealth('stalled');
    render(<SessionSyncChip isLive joinDeniedReason={null} />);

    expect(screen.queryByText('Live')).toBeNull();
    const chip = screen.getByTitle('Your changes are not being saved.');
    expect(chip.textContent).toContain('Not saving');
    expect(chip.textContent).toContain('sync_problem');
    expect(chip.className).toContain('text-rose-700');
    // The icon does not pulse: nothing here is about to heal by itself.
    expect(chip.querySelector('.animate-pulse')).toBeNull();
  });

  it('says so in French', () => {
    useHealth('stalled');
    render(
      <LanguageProvider initialLanguage="fr">
        <SessionSyncChip isLive joinDeniedReason={null} />
      </LanguageProvider>
    );

    const chip = screen.getByTitle('Vos modifications ne sont pas enregistrées.');
    expect(screen.getByText('Non enregistré')).toBeTruthy();
    expect(chip.textContent).not.toContain('En\u00a0direct');
  });

  it('goes back to Live once a write is accepted again', () => {
    useHealth('stalled');
    render(<SessionSyncChip isLive joinDeniedReason={null} />);
    expect(screen.getByText('Not saving')).toBeTruthy();

    act(() => notify?.('ok'));

    expect(screen.queryByText('Not saving')).toBeNull();
    expect(screen.getByText('Live')).toBeTruthy();
  });

  // The headers used to decide this themselves, from isLive and the join
  // alone, so a stalled chip stepped aside on a phone exactly like the
  // reassuring one. The rule now lives in the chip: only "Live" steps aside.
  // Below 400px the header has no room for any chip (the offline one overflowed
  // the retro header by 33px at 320px in French; e2e/i18n.spec.ts measures it),
  // and every state but Live has a full-width banner under the header saying
  // the same thing. So every state steps aside there, not only Live.
  it('steps aside on the narrowest phones in every state, where a banner says it instead', () => {
    const narrowOnly = expect.arrayContaining(['hidden', 'min-[400px]:flex']);

    useHealth('ok');
    const live = render(<SessionSyncChip isLive joinDeniedReason={null} />);
    expect(classesOf(screen.getByTitle('Real-time sync active'))).toEqual(narrowOnly);
    live.unmount();

    useHealth('stalled');
    const stalled = render(<SessionSyncChip isLive joinDeniedReason={null} />);
    expect(classesOf(screen.getByTitle('Your changes are not being saved.'))).toEqual(narrowOnly);
    stalled.unmount();

    useHealth('ok');
    const offline = render(<SessionSyncChip isLive={false} joinDeniedReason={null} />);
    expect(classesOf(screen.getByTitle('Disconnected — reconnecting'))).toEqual(narrowOnly);
    offline.unmount();

    render(<SessionSyncChip isLive joinDeniedReason="unauthenticated" />);
    expect(classesOf(screen.getByText('lock').parentElement!)).toEqual(narrowOnly);
  });

  it('leaves the offline and signed-out states to say what they say', () => {
    useHealth('stalled');
    const offline = render(<SessionSyncChip isLive={false} joinDeniedReason={null} />);
    expect(screen.getByText(/Reconnecting/i)).toBeTruthy();
    offline.unmount();

    render(<SessionSyncChip isLive joinDeniedReason="unauthenticated" />);
    expect(screen.getByText(/Signed out/i)).toBeTruthy();
    expect(screen.queryByText('Not saving')).toBeNull();
  });
});
