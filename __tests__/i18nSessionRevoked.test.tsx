import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import LanguageProvider from '../i18n/LanguageProvider';

/**
 * Decision D3b — a person signed out because the team's password was changed
 * lands on the login screen without having asked for it. The screen says why,
 * and what to do: the new password, or a new invitation link (the old one
 * stopped working with the rotation). On the team list and on the sign-in
 * form, in both languages, as a polite status (no focus is taken).
 */

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => [{ id: 'team-1', name: 'Alpha Team', memberCount: 1 }])
    }
  };
});

const NOTICE = { key: 'login.notice.sessionRevoked' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ infoMessage: '' }) })) as unknown as typeof fetch;
});

describe('the login screen after a password change signed the user out (decision D3b)', () => {
  it('says why on the team list and on the sign-in form', async () => {
    render(<TeamLogin onLogin={vi.fn()} signedOutNotice={NOTICE} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Alpha Team/ })).toBeTruthy());

    const sentence = 'The team password was changed, so you were signed out. Log in with the new password, or ask the facilitator for a new invitation link.';
    expect(screen.getByText(sentence).getAttribute('role')).toBe('status');

    fireEvent.click(screen.getByRole('button', { name: /Alpha Team/ }));
    expect(screen.getByText(sentence).getAttribute('role')).toBe('status');
  });

  it('says it in French', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} signedOutNotice={NOTICE} />
      </LanguageProvider>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Alpha Team/ })).toBeTruthy());

    expect(screen.getByText(
      'Le mot de passe de l’équipe a été changé et votre session a été fermée. Connectez-vous avec le nouveau mot de passe ou demandez un nouveau lien d’invitation au facilitateur.'
    ).getAttribute('role')).toBe('status');
  });

  it('shows nothing when the user signed out by choice', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Alpha Team/ })).toBeTruthy());

    expect(screen.queryByText(/password was changed/)).toBeNull();
  });
});
