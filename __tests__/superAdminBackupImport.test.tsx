import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdmin from '../components/SuperAdmin';
import type { BackupEntry } from '../types';

/**
 * The import card inside the console: what the page does around it. After an
 * import the list is read again and the team-restore dialog opens on the new
 * row — the point of importing a file is to restore a team from it — and
 * closing that dialog gives focus back to the import button. The import's
 * success is said once, by the card, never by a page banner as well. After an
 * answer that was lost, the list is read at once and once more 20 s later,
 * because behind a gateway the import may still be landing.
 */

const IMPORTED: BackupEntry = {
  id: 'backup_imported',
  filename: 'retrogemini-import-2026-10-21T10-00-00-000Z.json.gz',
  type: 'imported',
  label: 'retro.json.gz',
  createdAt: '2026-10-21T10:00:00.000Z',
  sizeBytes: 2048,
  teamCount: 2,
  protected: false
};

type Handler = (init?: Parameters<typeof fetch>[1]) => Response | Promise<Response>;
let handlers: Record<string, Handler>;
let calls: string[];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const installFetch = () => {
  calls = [];
  global.fetch = vi.fn(async (input: unknown, init?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    calls.push(url);
    const handler = handlers[url];
    return handler ? handler(init) : json(200, {});
  }) as unknown as typeof fetch;
};

const listCalls = () => calls.filter((url) => url === '/api/super-admin/backups/list').length;

const openBackupsTab = async () => {
  render(<SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /Backups$/ }));
  const card = await screen.findByRole('region', { name: 'Import a backup file' });
  await waitFor(() => expect(listCalls()).toBe(1));
  const input = within(card).getByLabelText('Backup file') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['gzip bytes'], 'retro.json.gz', { type: 'application/gzip' })] } });
  return { card, button: within(card).getByRole('button', { name: 'Import the file' }) };
};

beforeEach(() => {
  let imported = false;
  handlers = {
    '/api/super-admin/teams': () => json(200, { teams: [] }),
    '/api/super-admin/feedbacks': () => json(200, { feedbacks: [] }),
    '/api/super-admin/backups/list': () => json(200, {
      backups: imported ? [IMPORTED] : [],
      config: { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true },
      limits: { maxArchiveBytes: 128 * 1024 * 1024, maxUnpackedBytes: 512 * 1024 * 1024 }
    }),
    '/api/super-admin/backups/import': () => {
      imported = true;
      return json(200, { success: true, backup: IMPORTED });
    },
    '/api/super-admin/backups/teams': () => json(200, { teams: [] })
  };
  installFetch();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('importing a backup file from the console', () => {
  it('reads the list again and opens the team-restore dialog on the new row; closing it returns to the import button', async () => {
    const user = userEvent.setup();
    const { card, button } = await openBackupsTab();

    await user.click(button);

    const dialog = await screen.findByRole('dialog', { name: 'Restore one team' });
    expect(within(dialog).getByText('From the backup "retro.json.gz". The other teams are not changed.')).toBeTruthy();
    await waitFor(() => expect(listCalls()).toBe(2));
    expect(calls).toContain('/api/super-admin/backups/teams');

    // Said once, next to the control used: no page banner.
    const confirmations = screen.getAllByText('"retro.json.gz" was imported. Teams in this file: 2.');
    expect(confirmations).toHaveLength(1);
    expect(card.contains(confirmations[0])).toBe(true);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(within(card).getByRole('button', { name: 'Import the file' }));
  });

  it('opens no dialog for a file that holds no team', async () => {
    handlers['/api/super-admin/backups/import'] = () => json(200, { success: true, backup: { ...IMPORTED, teamCount: 0 } });
    const { button } = await openBackupsTab();

    fireEvent.click(button);

    expect(await screen.findByText('"retro.json.gz" was imported. Teams in this file: 0.')).toBeTruthy();
    await waitFor(() => expect(listCalls()).toBe(2));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reads the list at once and 20 s later after a lost answer, and never stacks a second delayed read', async () => {
    handlers['/api/super-admin/backups/import'] = () => Promise.reject(new TypeError('Failed to fetch'));
    const { button } = await openBackupsTab();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    fireEvent.click(button);
    await vi.waitFor(() => expect(listCalls()).toBe(2));
    expect(screen.getByRole('alert').textContent).toMatch(/may still be imported/);

    await act(async () => { await vi.advanceTimersByTimeAsync(18_000); });
    expect(listCalls()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(listCalls()).toBe(3);

    // Two more lost answers in a row: each reads the list at once, and the
    // second replaces the first's delayed read rather than adding one.
    fireEvent.click(screen.getByRole('button', { name: 'Import the file' }));
    await vi.waitFor(() => expect(listCalls()).toBe(4));
    fireEvent.click(screen.getByRole('button', { name: 'Import the file' }));
    await vi.waitFor(() => expect(listCalls()).toBe(5));
    await act(async () => { await vi.advanceTimersByTimeAsync(21_000); });
    expect(listCalls()).toBe(6);
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(listCalls()).toBe(6);
  });

  it('reads the list once after a failure the server reported', async () => {
    handlers['/api/super-admin/backups/import'] = () => json(500, { error: 'import_failed' });
    const { button } = await openBackupsTab();

    fireEvent.click(button);

    expect(await screen.findByText('The file could not be imported. Check the list below before trying again.')).toBeTruthy();
    await waitFor(() => expect(listCalls()).toBe(2));
  });

  it('marks an imported row with its own badge and the file name as its label', async () => {
    handlers['/api/super-admin/backups/list'] = () => json(200, {
      backups: [IMPORTED],
      config: { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true }
    });
    render(<SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Backups$/ }));

    const row = (await screen.findByText('retro.json.gz')).closest('tr')!;
    const badge = within(row).getByText('imported');
    expect(badge.className).toContain('bg-violet-100');
    expect(badge.className).toContain('text-violet-700');
    // Without limits (a pod before 41.0) the card names the formats only.
    expect(screen.getByText('A .json.gz or .json file.')).toBeTruthy();
  });
});

describe('the stored-backup restore, as the console reports it', () => {
  const restoreFirstRow = async (status: number, body: unknown) => {
    handlers['/api/super-admin/backups/list'] = () => json(200, {
      backups: [IMPORTED],
      config: { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true },
      limits: { maxArchiveBytes: 128 * 1024 * 1024, maxUnpackedBytes: 512 * 1024 * 1024 }
    });
    handlers['/api/super-admin/backups/restore'] = () => json(status, body);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Backups$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore backup' }));
  };

  it.each([
    [404, { error: 'backup_not_found' }, 'This backup no longer exists.'],
    [422, { error: 'invalid_backup_data', reason: 'unreadable' }, 'This backup cannot be restored: its content is not a valid archive. Nothing was changed.'],
    [413, { error: 'restore_archive_too_large' }, 'Once unpacked, this archive is larger than the server accepts: 512 MB at most.']
  ])('says what a %s means', async (status, body, message) => {
    await restoreFirstRow(status, body);
    expect(await screen.findByText(message)).toBeTruthy();
  });
});
