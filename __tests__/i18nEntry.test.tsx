import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import InviteModal from '../components/InviteModal';
import LanguageProvider from '../i18n/LanguageProvider';
import { LANGUAGE_STORAGE_KEY } from '../i18n/languages';
import { PASSWORD_MIN_LENGTH } from '../utils/passwordPolicy.js';
import type { Team, TeamSummary } from '../types';

/**
 * The entry screens are the first thing a French-speaking guest sees — often
 * on a phone, through an invite link, before they have any account. These pin
 * that they read in French, that the language switcher is reachable on them
 * before anyone logs in, and that switching back to English works and sticks.
 */

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,stub') }
}));

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  const AutoJoinError = actual.InviteAutoJoinError as new (message: string) => Error;
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async (): Promise<TeamSummary[]> => [
        { id: 'team-1', name: 'Alpha Team', memberCount: 1 } as TeamSummary
      ]),
      verifyResetToken: vi.fn(async () => ({ valid: true })),
      resetPassword: vi.fn(),
      importTeam: vi.fn(async () => ({ ...guestTeam })),
      autoJoinFromInvite: vi.fn(() => {
        throw new AutoJoinError('Invitation could not be verified. Please join manually.');
      }),
      createSessionInvite: vi.fn(async () => ({ inviteLink: 'https://retro.example/?join=stub' })),
      createMemberInvite: vi.fn(async (_teamId: string, email: string) => ({
        user: { id: 'u2', name: 'Bob', email },
        inviteLink: 'https://retro.example/?join=member'
      })),
      sendInviteEmail: vi.fn(async () => {
        throw new Error('email_not_configured');
      }),
      getAuthenticatedPassword: vi.fn(() => 'team-password'),
      getSessionToken: vi.fn(() => 'rg1.team-session-token')
    }
  };
});

const guestTeam = {
  id: 'team-1',
  name: 'Alpha Team',
  passwordHash: 'hash',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' },
    { id: 'u2', name: 'Bob', color: 'bg-teal-500', role: 'participant' }
  ],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: []
} as unknown as Team;

const inviteTeam: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-rose-500', role: 'facilitator', email: 'alice@example.com' },
    { id: 'u2', name: 'Bob', color: 'bg-emerald-500', role: 'participant', email: 'bob@example.com' }
  ],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  // The info banner and the Wi-Fi lookup are the only direct fetches.
  globalThis.fetch = vi.fn(async (input: unknown) => {
    if (String(input) === '/api/wifi-config') {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ infoMessage: '' }) } as unknown as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('TeamLogin in French', () => {
  it('shows the team picker in French, with the language switcher', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} />
      </LanguageProvider>
    );

    expect(await screen.findByText('Vos équipes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Nouvelle équipe' })).toBeInTheDocument();
    // A one-member team reads singular (English printed "1 members" before).
    expect(await screen.findByText('1 membre')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Ajouter Alpha Team aux favoris' })).toBeInTheDocument();
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    expect(screen.queryByText('Your Teams')).toBeNull();
    expect(screen.queryByText('+ New Team')).toBeNull();
  });

  it('counts a one-member team in the singular in English too', async () => {
    // The picker printed "1 members" until its strings moved into the dictionary.
    render(<TeamLogin onLogin={vi.fn()} />);
    expect(await screen.findByText('1 member')).toBeInTheDocument();
    expect(screen.queryByText('1 members')).toBeNull();
  });

  it('switches to English from the switcher and remembers the choice', async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr');
    render(
      <LanguageProvider>
        <TeamLogin onLogin={vi.fn()} />
      </LanguageProvider>
    );

    expect(await screen.findByText('Vos équipes')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('language-option-en'));

    expect(await screen.findByText('Your Teams')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ New Team' })).toBeInTheDocument();
    expect(screen.queryByText('Vos équipes')).toBeNull();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(screen.getByTestId('language-option-en')).toHaveAttribute('aria-pressed', 'true');
  });

  it('greets a guest arriving on an invite link in French, with the switcher', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={{ id: 'team-1', name: 'Alpha Team' }} />
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Rejoindre Alpha Team' })).toBeInTheDocument();
    expect(screen.getByText('+ Je ne suis pas dans la liste')).toBeInTheDocument();
    expect(screen.getByText('Vous rejoindrez la session en tant que participant')).toBeInTheDocument();
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    expect(screen.queryByText(/I'm not in the list/)).toBeNull();
  });

  it('offers the switcher on the reset screen and states the password rule in French', async () => {
    window.history.replaceState({}, '', `/?reset=${'a'.repeat(64)}`);
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} />
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Réinitialiser le mot de passe' })).toBeInTheDocument();
    expect(
      screen.getByText(`Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`)
    ).toBeInTheDocument();
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
  });

  it('re-translates an error already on screen when the language is switched', async () => {
    // A malformed reset link drops the user on the team list with an error.
    window.history.replaceState({}, '', '/?reset=not-a-token');
    render(
      <LanguageProvider initialLanguage="en">
        <TeamLogin onLogin={vi.fn()} />
      </LanguageProvider>
    );

    expect(await screen.findByText('The reset link is invalid or has expired')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('language-option-fr'));

    expect(await screen.findByText('Le lien de réinitialisation est invalide ou a expiré')).toBeInTheDocument();
    expect(screen.queryByText('The reset link is invalid or has expired')).toBeNull();
  });
});

describe('InviteModal in French', () => {
  it('shows the modal chrome in French', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <InviteModal team={inviteTeam} onClose={vi.fn()} />
      </LanguageProvider>
    );

    expect(await screen.findByRole('heading', { name: 'Inviter des membres à rejoindre Rocket Squad' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'E-MAIL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CODE ET LIEN' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Terminé' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Envoyer les invitations' })).toBeInTheDocument();
    expect(screen.queryByText('Send invites')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
  });

  it('translates a server error code returned by the invitation email', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <InviteModal team={inviteTeam} onClose={vi.fn()} />
      </LanguageProvider>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Envoyer les invitations' }));

    await waitFor(() =>
      expect(screen.getByText(/bob@example\.com : Le service d’e-mail n’est pas configuré/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/email_not_configured/)).toBeNull();
    expect(screen.queryByText(/Email service not configured/)).toBeNull();
  });
});
