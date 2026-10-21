import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdmin from '../components/SuperAdmin';
import LanguageProvider from '../i18n/LanguageProvider';
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

const MIB = 1024 * 1024;
const LIMITS = { maxArchiveBytes: 128 * MIB, maxUnpackedBytes: 512 * MIB };
const LIST_CONFIG = { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true };

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
  try {
    localStorage.clear();
  } catch {
    // Storage is optional.
  }
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
  const restoreFirstRow = async (
    status: number,
    body: unknown,
    { limits = LIMITS, rowGoneAfter = false, french = false }: { limits?: typeof LIMITS; rowGoneAfter?: boolean; french?: boolean } = {}
  ) => {
    // `rowGoneAfter`: another tab deleted the row, which the list says once
    // the restore has been answered.
    let answered = false;
    handlers['/api/super-admin/backups/list'] = () => json(200, {
      backups: rowGoneAfter && answered ? [] : [IMPORTED],
      config: LIST_CONFIG,
      limits
    });
    handlers['/api/super-admin/backups/restore'] = () => {
      answered = true;
      return json(status, body);
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const page = <SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />;
    render(french ? <LanguageProvider initialLanguage="fr">{page}</LanguageProvider> : page);
    fireEvent.click(screen.getByRole('button', { name: french ? /Sauvegardes$/ : /Backups$/ }));
    const restore = await screen.findByRole('button', { name: french ? 'Restaurer la sauvegarde' : 'Restore backup' });
    expect(listCalls()).toBe(1);
    fireEvent.click(restore);
  };

  // A 404 says the row is gone, so the list is read again; a 422 or a 413 is
  // about a row that is still there, and it stays listed.
  it.each([
    [404, { error: 'backup_not_found' }, 'This backup no longer exists.', 1],
    [422, { error: 'invalid_backup_data', reason: 'unreadable' }, 'This backup cannot be restored: its content is not a valid archive. Nothing was changed.', 0],
    [413, { error: 'restore_archive_too_large' }, 'Once unpacked, this archive is larger than the server accepts: 512 MB at most.', 0]
  ])('says what a %s means, and reads the list again only when the row is gone', async (status, body, message, reloads) => {
    await restoreFirstRow(status, body);
    expect(await screen.findByText(message)).toBeTruthy();
    await waitFor(() => expect(listCalls()).toBe(1 + reloads));
  });

  it('takes away the row a 404 calls gone, and keeps the message', async () => {
    await restoreFirstRow(404, { error: 'backup_not_found' }, { rowGoneAfter: true });

    expect(await screen.findByText('This backup no longer exists.')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore backup' })).toBeNull());
    expect(screen.getByText('This backup no longer exists.')).toBeTruthy();
  });

  it('quotes a fractional unpacked limit with the French decimal mark in the page banner', async () => {
    await restoreFirstRow(413, { error: 'restore_archive_too_large' }, {
      limits: { maxArchiveBytes: 128 * MIB, maxUnpackedBytes: MIB / 2 },
      french: true
    });

    // getByText normalises the no-break spaces; the text keeps them.
    const banner = await screen.findByText(
      'Une fois décompressée, cette archive dépasse la taille acceptée par le serveur : 0,5 Mo au plus.'
    );
    expect(banner.textContent).toContain('0,5 Mo');
  });
});

describe('the whole-store upload (Upload & Restore), as the console reports a 413', () => {
  const uploadAndRestore = async (answer: () => Response, { french = false } = {}) => {
    handlers['/api/super-admin/restore'] = answer;
    const page = <SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />;
    render(french ? <LanguageProvider initialLanguage="fr">{page}</LanguageProvider> : page);
    const input = screen.getByLabelText(french ? 'Fichier de sauvegarde à restaurer' : 'Backup file to restore');
    fireEvent.change(input, { target: { files: [new File(['gzip bytes'], 'all.json.gz', { type: 'application/gzip' })] } });
    fireEvent.click(screen.getByRole('button', { name: french ? /Importer et restaurer$/ : /Upload & Restore$/ }));
  };

  it('says a proxy refused the file when the 413 is a page, not the application\'s JSON', async () => {
    // ingress-nginx's own refusal on the base manifest (1 MiB default).
    await uploadAndRestore(() => new Response('<html><body>413 Request Entity Too Large</body></html>', {
      status: 413,
      headers: { 'content-type': 'text/html' }
    }));

    expect(await screen.findByText(
      'The network in front of the server refused a file this large before it reached the application. Ask your operator to raise the upload limit of the ingress or proxy.'
    )).toBeTruthy();
    expect(screen.queryByText('Failed to restore backup.')).toBeNull();
    expect(calls).toContain('/api/super-admin/restore');
  });

  it('quotes the application\'s own limit, with the French decimal mark in the page banner', async () => {
    await uploadAndRestore(() => json(413, { error: 'backup_file_too_large', maxBytes: MIB / 2 }), { french: true });

    const banner = await screen.findByText('Ce fichier dépasse la taille acceptée par le serveur : 0,5 Mo au plus.');
    expect(banner.textContent).toContain('0,5 Mo');
  });
});

describe('deleting a stored backup another tab has already deleted', () => {
  it('reads the list again on a 404, so the row leaves', async () => {
    let deleted = false;
    handlers['/api/super-admin/backups/list'] = () => json(200, {
      backups: deleted ? [] : [IMPORTED],
      config: { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true }
    });
    handlers['/api/super-admin/backups/delete'] = () => {
      deleted = true;
      return json(404, { error: 'backup_not_found' });
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Backups$/ }));

    fireEvent.click(await screen.findByRole('button', { name: 'Delete backup' }));

    await waitFor(() => expect(listCalls()).toBe(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete backup' })).toBeNull());
  });
});
