import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import LanguageProvider from '../i18n/LanguageProvider';
import { dataService } from '../services/dataService';
import type { Team } from '../types';

/**
 * The two email fields of the login screen: the recovery address a team must be
 * created with, and the address a forgotten password is sent to.
 *
 * Both are `type="email"` inside a form, so the browser already refuses a
 * trailing `;` — but it accepts `lead@corp`, which the shared rule
 * (`utils/emailAddress.js`) and every server route now refuse. The screen checks
 * first so the user reads a sentence tied to the field, and phones stop
 * capitalising the first letter of an address.
 */

const fullTeam = {
  id: 'team-1',
  name: 'Alpha Team',
  members: [{ id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' }],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: []
} as unknown as Team;

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => [{ id: 'team-1', name: 'Alpha Team', memberCount: 1 }]),
      createTeam: vi.fn(async () => fullTeam),
      requestPasswordReset: vi.fn(async () => ({
        success: true,
        message: 'If the team and email match, a reset link has been sent.'
      }))
    }
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ infoMessage: '' }) })) as unknown as typeof fetch;
});

const openCreate = async () => {
  render(<TeamLogin onLogin={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: /Alpha Team/ })).toBeTruthy());
  fireEvent.click(screen.getByText('+ New Team'));
};

const openForgot = async (wrap: (node: React.ReactElement) => React.ReactElement = (node) => node) => {
  render(wrap(<TeamLogin onLogin={vi.fn()} />));
  await waitFor(() => expect(screen.getByRole('button', { name: /Alpha Team/ })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /Alpha Team/ }));
  fireEvent.click(screen.getAllByRole('button').find((button) => /forgot|oubli/i.test(button.textContent || ''))!);
};

describe('TeamLogin — creating a team', () => {
  const fill = (email: string) => {
    fireEvent.change(screen.getByLabelText('Team Name'), { target: { value: 'Platform' } });
    fireEvent.change(screen.getByLabelText('Create Password'), { target: { value: 'password123456' } });
    fireEvent.change(screen.getByLabelText(/Recovery Email/), { target: { value: email } });
  };

  it('refuses an address the browser accepts but the server would not, and points the field at the error', async () => {
    await openCreate();
    fill('lead@corp');

    fireEvent.click(screen.getByRole('button', { name: 'Create & Join' }));

    const error = await screen.findByText('Enter one valid email address');
    expect(dataService.createTeam).not.toHaveBeenCalled();
    const field = screen.getByLabelText(/Recovery Email/);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain(error.id);

    // Editing the address withdraws the complaint from the field.
    fireEvent.change(field, { target: { value: 'lead@corp.ch' } });
    expect(field).not.toHaveAttribute('aria-invalid');
  });

  it('creates the team with a valid address', async () => {
    await openCreate();
    fill('lead@corp.ch');

    fireEvent.click(screen.getByRole('button', { name: 'Create & Join' }));

    await waitFor(() => expect(dataService.createTeam).toHaveBeenCalledWith('Platform', 'password123456', 'lead@corp.ch'));
  });

  // Mandatory: a team with no recovery address has no way back from a
  // forgotten password, which is how a facilitator ended up running her team
  // as two teams. The browser stops an empty submit (`required`); a value it
  // lets through blank is refused with a sentence tied to the field.
  it('requires a recovery address, in the browser and in the form', async () => {
    await openCreate();
    const field = screen.getByLabelText('Recovery Email');
    expect(field).toBeRequired();
    expect(screen.queryByText(/optional/i)).toBeNull();

    fill('   ');
    fireEvent.submit(field.closest('form')!);

    const error = await screen.findByText(/^Enter a recovery email/);
    expect(dataService.createTeam).not.toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('says it is required in French too', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} />
      </LanguageProvider>
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Alpha Team/ })).toBeTruthy());
    fireEvent.click(screen.getByText(/Nouvelle équipe/));
    const field = screen.getByLabelText('E-mail de récupération');
    expect(field).toBeRequired();
    expect(screen.queryByText(/facultatif/i)).toBeNull();
    expect(screen.getByText(/^Obligatoire/)).toBeTruthy();
  });

  it('keeps a phone keyboard from capitalising or correcting the address', async () => {
    await openCreate();
    const field = screen.getByLabelText(/Recovery Email/);

    expect(field).toHaveAttribute('autocomplete', 'email');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    expect(field).toHaveAttribute('spellcheck', 'false');
  });
});

describe('TeamLogin — forgotten password', () => {
  it('refuses an invalid address without asking the server', async () => {
    await openForgot();
    fireEvent.change(screen.getByLabelText('Recovery Email'), { target: { value: 'lead@corp' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    expect(await screen.findByText('Enter one valid email address')).toBeTruthy();
    expect(dataService.requestPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Recovery Email')).toHaveAttribute('aria-invalid', 'true');
    // What the user typed stays, so it can be corrected rather than retyped.
    expect(screen.getByLabelText('Recovery Email')).toHaveValue('lead@corp');
  });

  it('sends a valid address and shows the opaque confirmation', async () => {
    await openForgot();
    const field = screen.getByLabelText('Recovery Email');
    expect(field).toHaveAttribute('autocapitalize', 'none');
    fireEvent.change(field, { target: { value: 'lead@corp.ch' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    expect(await screen.findByText('If the team and email match, a reset link has been sent.')).toBeTruthy();
    expect(dataService.requestPasswordReset).toHaveBeenCalledWith('Alpha Team', 'lead@corp.ch');
  });

  it('shows a refusal from the data layer as an error and keeps the address', async () => {
    vi.mocked(dataService.requestPasswordReset).mockResolvedValueOnce({
      success: false,
      message: 'Password reset by email is not available on this server. Please contact your administrator.'
    });
    await openForgot();
    fireEvent.change(screen.getByLabelText('Recovery Email'), { target: { value: 'lead@corp.ch' } });

    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }));

    const message = await screen.findByText(/not available on this server/);
    expect(message.className).toContain('red');
    expect(screen.getByLabelText('Recovery Email')).toHaveValue('lead@corp.ch');
  });

  it('says it in French', async () => {
    await openForgot((node) => <LanguageProvider initialLanguage="fr">{node}</LanguageProvider>);
    fireEvent.change(screen.getByLabelText('E-mail de récupération'), { target: { value: 'lead@corp' } });

    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien de réinitialisation' }));

    expect(await screen.findByText('Saisissez une seule adresse e-mail valide')).toBeTruthy();
  });
});
