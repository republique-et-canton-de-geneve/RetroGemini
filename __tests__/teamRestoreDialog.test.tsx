import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import TeamRestoreDialog from '../components/admin/TeamRestoreDialog';
import LanguageProvider from '../i18n/LanguageProvider';

/**
 * The console dialog that restores one team from a stored backup. What it must
 * get right is what it *says*: which teams the backup holds and what became of
 * each, what comes back and what stays as it is, and — for a team deleted since
 * whose name another team took — that a new name is needed before anything is
 * sent.
 */

type Json = Record<string, any>;

const TEAMS = [
  { id: 't-here', name: 'Bravo', status: 'present', currentName: 'Bravo', nameTaken: false, lastConnectionDate: null, counts: { retrospectives: 3, healthChecks: 1, globalActions: 4, members: 5 } },
  { id: 't-renamed', name: 'Charlie', status: 'renamed', currentName: 'Charlie 2', nameTaken: false, lastConnectionDate: null, counts: { retrospectives: 1, healthChecks: 0, globalActions: 0, members: 2 } },
  { id: 't-gone', name: 'Delta', status: 'deleted', currentName: null, nameTaken: true, lastConnectionDate: null, counts: { retrospectives: 2, healthChecks: 0, globalActions: 1, members: 3 } }
];

let calls: { url: string; body: Json }[] = [];
let listedTeams: Json[] = [];
let restoreAnswer: { status: number; body: Json } = { status: 200, body: {} };

beforeEach(() => {
  calls = [];
  listedTeams = TEAMS;
  restoreAnswer = {
    status: 200,
    body: { success: true, team: { id: 't-here', name: 'Bravo' }, recreated: false, counts: {}, sessionsUpdated: 0, sessionsNotUpdated: [], feedbacksStillOrphaned: false, preRestoreSnapshot: 's' }
  };
  global.fetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    calls.push({ url, body });
    if (url === '/api/super-admin/backups/teams') {
      return { ok: true, status: 200, json: async () => ({ teams: listedTeams }) };
    }
    return { ok: restoreAnswer.status < 400, status: restoreAnswer.status, json: async () => restoreAnswer.body };
  }) as unknown as typeof fetch;
});

afterEach(() => cleanup());

const renderDialog = (language: 'en' | 'fr' = 'en') => {
  const onRestored = vi.fn();
  const onClose = vi.fn();
  render(
    <LanguageProvider initialLanguage={language}>
      <TeamRestoreDialog backupId="backup-1" backupName="Before the upgrade" sessionToken="admin-token" onClose={onClose} onRestored={onRestored} />
    </LanguageProvider>
  );
  return { onRestored, onClose };
};

describe('TeamRestoreDialog', () => {
  it('lists the teams of the backup with what became of each since', async () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Restore one team' })).toBeTruthy();
    expect(await screen.findByText('Bravo')).toBeTruthy();
    expect(calls[0]).toEqual({ url: '/api/super-admin/backups/teams', body: { sessionToken: 'admin-token', backupId: 'backup-1' } });
    expect(screen.getByText('Exists')).toBeTruthy();
    expect(screen.getByText('Renamed since: Charlie 2')).toBeTruthy();
    expect(screen.getByText('Deleted since')).toBeTruthy();
    expect(screen.getByText(/Retrospectives: 3 · Health checks: 1 · Backlog actions: 4 · Members: 5/)).toBeTruthy();
    // Each option is named by its team and described by its fate and size.
    expect(screen.getByRole('radio', { name: 'Delta' })).toHaveAccessibleDescription(
      'Deleted since Retrospectives: 2 · Health checks: 0 · Backlog actions: 1 · Members: 3'
    );
    // Nothing is restored before a team is chosen.
    expect(screen.getByRole('button', { name: 'Choose a team' })).toBeDisabled();
  });

  it('filters by name, the current name included', async () => {
    renderDialog();
    await screen.findByText('Bravo');
    fireEvent.change(screen.getByLabelText('Search for a team'), { target: { value: 'charlie 2' } });
    const group = screen.getByRole('group', { name: 'Teams in this backup' });
    expect(within(group).getAllByRole('radio')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search for a team'), { target: { value: 'zzz' } });
    expect(screen.getByText('No team matches this search.')).toBeTruthy();
  });

  it('restores a team that exists, saying its access stays as it is now', async () => {
    const { onRestored } = renderDialog();
    await screen.findByText('Bravo');
    fireEvent.click(screen.getByRole('radio', { name: /Bravo/ }));

    expect(screen.getByText(/Its name, password, recovery email and feedbacks stay as they are now/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore Bravo' }));

    await waitFor(() => expect(onRestored).toHaveBeenCalledWith({ key: 'adminBackups.teamRestore.restored', params: { name: 'Bravo' } }));
    expect(calls[1]).toEqual({
      url: '/api/super-admin/backups/restore-team',
      body: { sessionToken: 'admin-token', backupId: 'backup-1', teamId: 't-here', expected: 'existing' }
    });
  });

  it('asks for a new name when a deleted team’s name was taken since, and sends it', async () => {
    renderDialog();
    await screen.findByText('Delta');
    fireEvent.click(screen.getByRole('radio', { name: /Delta/ }));

    expect(screen.getByText(/It comes back with the password and recovery email it had then/)).toBeTruthy();
    const field = screen.getByLabelText('Name of the restored team');
    expect(field).toHaveValue('');
    expect(field).toHaveAccessibleDescription('Another team is now called "Delta": choose another name.');
    const confirm = screen.getByRole('button', { name: 'Restore Delta' });
    expect(confirm).toBeDisabled();

    fireEvent.change(field, { target: { value: '  Delta (restored) ' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].body).toEqual({ sessionToken: 'admin-token', backupId: 'backup-1', teamId: 't-gone', expected: 'deleted', name: 'Delta (restored)' });
  });

  it('says when open sessions could not be brought back, and shows a refusal in the dialog', async () => {
    restoreAnswer = { status: 200, body: { ...restoreAnswer.body, sessionsNotUpdated: ['r1'] } };
    const first = renderDialog();
    await screen.findByText('Bravo');
    fireEvent.click(screen.getByRole('radio', { name: /Bravo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Bravo' }));
    await waitFor(() => expect(first.onRestored).toHaveBeenCalledWith({ key: 'adminBackups.teamRestore.restoredSessionsBehind', params: { name: 'Bravo' } }));
    cleanup();

    restoreAnswer = { status: 409, body: { error: 'team_changed' } };
    const second = renderDialog();
    await screen.findByText('Bravo');
    fireEvent.click(screen.getByRole('radio', { name: /Bravo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Bravo' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The team was deleted or created again meanwhile. Nothing was changed: try again.');
    expect(second.onRestored).not.toHaveBeenCalled();
  });

  it.each([
    [{ sessionsNotUpdated: [], feedbacksStillOrphaned: true }, 'adminBackups.teamRestore.restoredFeedbacksTwice'],
    [{ sessionsNotUpdated: ['r1'], feedbacksStillOrphaned: true }, 'adminBackups.teamRestore.restoredWithWarnings']
  ])('says every partial outcome of a restore that happened (%j)', async (outcome, key) => {
    restoreAnswer = { status: 200, body: { ...restoreAnswer.body, ...outcome } };
    const { onRestored } = renderDialog();
    await screen.findByText('Bravo');
    fireEvent.click(screen.getByRole('radio', { name: /Bravo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Bravo' }));
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith({ key, params: { name: 'Bravo' } }));
  });

  it('reads the list again when the team changed since it was shown, and explains the new case', async () => {
    // Bravo was deleted while the dialog was open: restoring it now brings the
    // backup's password back, which is not what the dialog had said.
    restoreAnswer = { status: 409, body: { error: 'team_changed' } };
    renderDialog();
    await screen.findByText('Bravo');
    fireEvent.click(screen.getByRole('radio', { name: /Bravo/ }));
    expect(screen.getByText(/stay as they are now/)).toBeTruthy();

    listedTeams = TEAMS.map((team) => (team.id === 't-here' ? { ...team, status: 'deleted', currentName: null } : team));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Bravo' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/deleted or created again meanwhile/);
    await waitFor(() => expect(screen.getByText(/It comes back with the password and recovery email it had then/)).toBeTruthy());
    expect(screen.getByLabelText('Name of the restored team')).toHaveValue('Bravo');
    expect(calls.filter((call) => call.url === '/api/super-admin/backups/teams')).toHaveLength(2);
  });

  it('asks to wait while another restore runs', async () => {
    restoreAnswer = { status: 409, body: { error: 'restore_in_progress' } };
    renderDialog();
    await screen.findByText('Bravo');
    fireEvent.click(screen.getByRole('radio', { name: /Bravo/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Bravo' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Another restore is running. Wait for it to finish, then try again.');
  });

  it('speaks French', async () => {
    renderDialog('fr');
    expect(screen.getByRole('dialog', { name: 'Restaurer une équipe' })).toBeTruthy();
    await screen.findByText('Delta');
    expect(screen.getByText('Supprimée depuis')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Delta/ }));
    expect(screen.getByText(/Elle revient avec le mot de passe/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restaurer Delta' })).toBeTruthy();
  });
});
