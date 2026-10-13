import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import RecoveryEmailSetting from '../components/dashboard/RecoveryEmailSetting';
import { dataService } from '../services/dataService';
import { parseEmailInput, INVALID_EMAIL_MESSAGE } from '../utils/emailAddress.js';
import type { Team } from '../types';

/**
 * The Dashboard's recovery-address field.
 *
 * It used to call `updateFacilitatorEmail` on **every keystroke**, outside any
 * form, with no validation and no feedback — which is how a pasted
 * `elisabeth.trolliet@etat.ge.ch;` was stored as typed and made password reset
 * impossible for its team. It also could never be emptied: the clear was sent as
 * `undefined` and vanished in JSON. The field now keeps a draft and commits it on
 * blur or Enter, says what it did, and points at its error when it refuses.
 */

vi.mock('../services/dataService', () => ({
  RECOVERY_EMAIL_NOT_SAVED: 'The recovery email could not be saved. Please try again.',
  dataService: {
    // The real rule, and asynchronous like the real save, which answers only
    // once the server has the address.
    updateFacilitatorEmail: vi.fn(async (_teamId: string, email: string) => {
      const parsed = parseEmailInput(email);
      if (!parsed.ok) throw new Error(INVALID_EMAIL_MESSAGE);
      return parsed.email;
    })
  }
}));

const team = (facilitatorEmail?: string): Team => ({
  id: 'team-1',
  name: 'Platform',
  members: [],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...(facilitatorEmail ? { facilitatorEmail } : {})
} as Team);

const field = () => screen.getByRole('textbox', { name: 'Recovery Email' });

describe('RecoveryEmailSetting', () => {
  beforeEach(() => {
    vi.mocked(dataService.updateFacilitatorEmail).mockClear();
  });

  it('writes nothing while the user types', () => {
    render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={vi.fn()} />);

    fireEvent.change(field(), { target: { value: 'n' } });
    fireEvent.change(field(), { target: { value: 'new@exa' } });

    expect(dataService.updateFacilitatorEmail).not.toHaveBeenCalled();
    // No error either: a half-typed address is not a mistake yet.
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it('commits the cleaned address on blur and says it was saved', async () => {
    const onRefresh = vi.fn();
    render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={onRefresh} />);

    fireEvent.change(field(), { target: { value: 'elisabeth.trolliet@etat.ge.ch;' } });
    fireEvent.blur(field());

    expect(dataService.updateFacilitatorEmail).toHaveBeenCalledTimes(1);
    expect(dataService.updateFacilitatorEmail).toHaveBeenCalledWith('team-1', 'elisabeth.trolliet@etat.ge.ch;');
    expect(await screen.findByRole('status')).toHaveTextContent('Recovery email saved');
    expect(field()).toHaveValue('elisabeth.trolliet@etat.ge.ch');
    expect(onRefresh).toHaveBeenCalled();
  });

  it('sends one write when Enter is followed by the blur, while the save is in flight', async () => {
    let finish: (value: string) => void = () => {};
    vi.mocked(dataService.updateFacilitatorEmail).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={vi.fn()} />);

    fireEvent.change(field(), { target: { value: 'new@example.ch' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    fireEvent.blur(field());
    finish('new@example.ch');

    expect(await screen.findByRole('status')).toHaveTextContent('Recovery email saved');
    expect(dataService.updateFacilitatorEmail).toHaveBeenCalledTimes(1);
  });

  it('never says "saved" for an address the server did not store', async () => {
    vi.mocked(dataService.updateFacilitatorEmail).mockRejectedValueOnce(
      new Error('The recovery email could not be saved. Please try again.')
    );
    const onRefresh = vi.fn();
    render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={onRefresh} />);

    fireEvent.change(field(), { target: { value: 'new@example.ch' } });
    fireEvent.blur(field());

    expect(await screen.findByRole('alert')).toHaveTextContent('The recovery email could not be saved');
    expect(screen.queryByRole('status')).toBeNull();
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('commits on Enter', () => {
    render(<RecoveryEmailSetting team={team()} onRefresh={vi.fn()} />);

    fireEvent.change(field(), { target: { value: 'lead@example.ch' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(dataService.updateFacilitatorEmail).toHaveBeenCalledWith('team-1', 'lead@example.ch');
  });

  it('shows an error tied to the field, and keeps what the user typed', async () => {
    render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={vi.fn()} />);

    fireEvent.change(field(), { target: { value: 'a@x.ch; b@y.ch' } });
    fireEvent.blur(field());

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('Enter one valid email address');
    expect(field()).toHaveAttribute('aria-invalid', 'true');
    expect(field().getAttribute('aria-describedby')).toContain(error.id);
    expect(field()).toHaveValue('a@x.ch; b@y.ch');
    expect(screen.queryByRole('status')).toBeNull();

    // Typing again clears the complaint until the next commit.
    fireEvent.change(field(), { target: { value: 'a@x.ch' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field()).not.toHaveAttribute('aria-invalid');
  });

  it('clears the address when the field is emptied', async () => {
    render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={vi.fn()} />);

    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.blur(field());

    expect(dataService.updateFacilitatorEmail).toHaveBeenCalledWith('team-1', '');
    expect(await screen.findByRole('status')).toHaveTextContent('Recovery email removed');
  });

  it('writes nothing when a blur changes nothing', () => {
    render(<RecoveryEmailSetting team={team('lead@example.ch')} onRefresh={vi.fn()} />);

    fireEvent.focus(field());
    fireEvent.blur(field());
    fireEvent.change(field(), { target: { value: ' LEAD@example.ch ' } });
    fireEvent.blur(field());

    expect(dataService.updateFacilitatorEmail).not.toHaveBeenCalled();
    expect(field()).toHaveValue('lead@example.ch');
  });

  it('follows a change made elsewhere while the field is not being edited', () => {
    const { rerender } = render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={vi.fn()} />);

    rerender(<RecoveryEmailSetting team={team('new@example.ch')} onRefresh={vi.fn()} />);

    expect(field()).toHaveValue('new@example.ch');
  });

  it('never overwrites what the user is typing with a refreshed value', () => {
    const { rerender } = render(<RecoveryEmailSetting team={team('old@example.ch')} onRefresh={vi.fn()} />);

    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: 'typing@exa' } });
    rerender(<RecoveryEmailSetting team={team('new@example.ch')} onRefresh={vi.fn()} />);

    expect(field()).toHaveValue('typing@exa');
  });

  it('speaks French, error and confirmation included', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <RecoveryEmailSetting team={team()} onRefresh={vi.fn()} />
      </LanguageProvider>
    );
    const frenchField = screen.getByRole('textbox', { name: 'E-mail de récupération' });

    fireEvent.change(frenchField, { target: { value: 'lead@corp' } });
    fireEvent.blur(frenchField);
    expect(await screen.findByRole('alert')).toHaveTextContent('Saisissez une seule adresse e-mail valide');

    fireEvent.change(frenchField, { target: { value: 'lead@corp.ch' } });
    fireEvent.blur(frenchField);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('E-mail de récupération enregistré'));
  });
});
