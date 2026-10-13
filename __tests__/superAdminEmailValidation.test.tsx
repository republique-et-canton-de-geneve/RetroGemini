import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SuperAdmin from '../components/SuperAdmin';
import LanguageProvider from '../i18n/LanguageProvider';

/**
 * The super-admin console's two address fields — a team's recovery address and
 * the admin address every notification goes to — follow the shared email rule
 * (`utils/emailAddress.js`). Neither sits in a form, so the browser never
 * validated them; the routes now refuse what does not parse, and the console
 * checks first so the operator reads why, and sends the cleaned address.
 */

const team = {
  id: 'team-1',
  name: 'Alpha Team',
  passwordHash: 'hash',
  facilitatorEmail: 'old@example.ch',
  members: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

let updateEmailAnswer: { status: number; body: Record<string, unknown> } = { status: 200, body: { success: true } };

beforeEach(() => {
  updateEmailAnswer = { status: 200, body: { success: true } };
  global.fetch = vi.fn(async (url: unknown) => {
    const href = String(url);
    if (href.includes('/api/super-admin/teams')) {
      return { ok: true, status: 200, json: async () => ({ teams: [team] }) } as unknown as Response;
    }
    if (href.includes('/api/super-admin/feedbacks')) {
      return { ok: true, status: 200, json: async () => ({ feedbacks: [] }) } as unknown as Response;
    }
    if (href.includes('/api/super-admin/update-email') || href.includes('/api/super-admin/update-admin-email')) {
      const { status, body } = updateEmailAnswer;
      return { ok: status < 400, status, headers: new Headers(), json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
});

const callsTo = (path: string) =>
  vi.mocked(global.fetch).mock.calls.filter(([url]) => String(url).endsWith(path));

const openTeamEmailEditor = async () => {
  render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Alpha Team')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Edit Email' }));
  return screen.getByDisplayValue('old@example.ch');
};

describe('super-admin console — a team recovery address', () => {
  it('refuses an address that is not one valid address without calling the API', async () => {
    const field = await openTeamEmailEditor();
    fireEvent.change(field, { target: { value: 'a@x.ch; b@y.ch' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter one valid email address, or leave the field empty')).toBeTruthy();
    expect(callsTo('/api/super-admin/update-email')).toHaveLength(0);
  });

  it('sends the cleaned form of a pasted address', async () => {
    const field = await openTeamEmailEditor();
    fireEvent.change(field, { target: { value: 'Trolliet Elisabeth (DIN) <Elisabeth.Trolliet@etat.ge.ch>;' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(callsTo('/api/super-admin/update-email')).toHaveLength(1));
    const body = JSON.parse(String(callsTo('/api/super-admin/update-email')[0][1]?.body));
    expect(body.facilitatorEmail).toBe('elisabeth.trolliet@etat.ge.ch');
  });

  it('explains a server refusal instead of a generic failure', async () => {
    // A newer server judging an address this console accepted.
    updateEmailAnswer = { status: 400, body: { error: 'invalid_email' } };
    const field = await openTeamEmailEditor();
    fireEvent.change(field, { target: { value: 'lead@example.ch' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter one valid email address, or leave the field empty')).toBeTruthy();
  });
});

describe('super-admin console — the admin address', () => {
  it('refuses an invalid admin address without calling the API', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);
    const field = await screen.findByLabelText('Admin Email Address');
    fireEvent.change(field, { target: { value: 'admin@corp' } });

    fireEvent.click(screen.getByRole('button', { name: /Save Email/ }));

    expect(
      await screen.findByText('Enter one valid email address, or leave the field empty to turn notifications off')
    ).toBeTruthy();
    expect(callsTo('/api/super-admin/update-admin-email')).toHaveLength(0);
  });

  it('sends the cleaned admin address', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);
    const field = await screen.findByLabelText('Admin Email Address');
    fireEvent.change(field, { target: { value: 'mailto:Admin@Example.ch' } });

    fireEvent.click(screen.getByRole('button', { name: /Save Email/ }));

    await waitFor(() => expect(callsTo('/api/super-admin/update-admin-email')).toHaveLength(1));
    const body = JSON.parse(String(callsTo('/api/super-admin/update-admin-email')[0][1]?.body));
    expect(body.adminEmail).toBe('admin@example.ch');
  });

  it('says it in French', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <SuperAdmin sessionToken="test-token" onExit={vi.fn()} />
      </LanguageProvider>
    );
    const field = await screen.findByLabelText('Adresse e-mail de l’administrateur');
    fireEvent.change(field, { target: { value: 'admin@corp' } });

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer l’e-mail/ }));

    expect(
      await screen.findByText('Saisissez une seule adresse e-mail valide, ou laissez le champ vide pour désactiver les notifications')
    ).toBeTruthy();
  });
});
