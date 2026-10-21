import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BackupImportCard from '../components/admin/BackupImportCard';
import { importBackupFile, type ImportOutcome } from '../components/admin/backupImportApi';
import { megabytes, megabytesText } from '../components/admin/backupFormat';
import { noticeText } from '../i18n/notice';
import { enT } from '../i18n/translate';
import { intlLocaleFor } from '../i18n/languages';
import type { BackupEntry, BackupLimits } from '../types';

/**
 * The Backups tab's import card (`components/admin/BackupImportCard.tsx`) and
 * the call behind it (`backupImportApi.ts`). The server side of
 * `/api/super-admin/backups/import` is `superAdminBackupImportRoutes.test.ts`;
 * this pins what the admin is told for every answer it can give, and the
 * accessibility of the card: a visible label, the hint and the error tied to
 * the field, a status that is always mounted and visible, and a button that
 * stays focusable while busy (a `disabled` button drops focus to <body>, and
 * the dialog that opens next would return focus to nowhere).
 */

const LIMITS: BackupLimits = { maxArchiveBytes: 128 * 1024 * 1024, maxUnpackedBytes: 512 * 1024 * 1024 };

const backupEntry = (overrides: Partial<BackupEntry> = {}): BackupEntry => ({
  id: 'backup_imp',
  filename: 'retrogemini-import-2026-10-21T10-00-00-000Z.json.gz',
  type: 'imported',
  label: 'retro.json.gz',
  createdAt: '2026-10-21T10:00:00.000Z',
  sizeBytes: 2048,
  teamCount: 2,
  protected: false,
  ...overrides
});

const fileOf = (name = 'retro.json.gz', content = 'gzip bytes', size?: number) => {
  const file = new File([content], name, { type: 'application/gzip' });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
};

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const htmlResponse = (status: number) =>
  new Response('<html><body>nope</body></html>', { status, headers: { 'content-type': 'text/html' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const messageOf = (outcome: ImportOutcome) => (outcome.status === 'ok' ? null : noticeText(outcome.notice, enT));

describe('megabytes', () => {
  it('reads whole when whole, and with the reader’s decimal mark otherwise', () => {
    expect(megabytesText(128 * 1024 * 1024)).toBe('128');
    expect(megabytesText(512 * 1024)).toBe('0.5');
    expect(megabytes(128 * 1024 * 1024, 'en-US')).toBe('128');
    expect(megabytes(512 * 1024, 'en-US')).toBe('0.5');
    expect(megabytes(512 * 1024, intlLocaleFor('fr'))).toBe('0,5');
  });
});

describe('importBackupFile — what each answer says', () => {
  it('sends the file itself as octet-stream, with the session header and the encoded name', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, backup: backupEntry() }));
    const file = fileOf('Sauvegarde du 1er octobre.json.gz');

    const outcome = await importBackupFile('admin-token', file, LIMITS);

    expect(outcome).toEqual({ status: 'ok', backup: backupEntry() });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/super-admin/backups/import');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/octet-stream',
      'x-super-admin-session-token': 'admin-token',
      'x-backup-label': encodeURIComponent('Sauvegarde du 1er octobre.json.gz')
    });
    expect(init.body).toBe(file);
  });

  it('checks the file before sending anything', async () => {
    const empty = await importBackupFile('t', fileOf('empty.json', ''), LIMITS);
    expect(empty).toMatchObject({ status: 'failed', fileError: true });
    expect(messageOf(empty)).toBe('This file is empty.');

    const big = await importBackupFile('t', fileOf('big.json.gz', 'x', LIMITS.maxArchiveBytes + 1), LIMITS);
    expect(big).toMatchObject({ status: 'failed', fileError: true });
    expect(messageOf(big)).toBe('This file is larger than the server accepts: 128 MB at most.');
    expect(fetchMock).not.toHaveBeenCalled();

    // Without the limits (a pod from before 41.0), the server judges the size.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, backup: backupEntry() }));
    expect((await importBackupFile('t', fileOf('big.json.gz', 'x', LIMITS.maxArchiveBytes + 1), null)).status).toBe('ok');
  });

  const answers: [string, () => Response, string, boolean, ImportOutcome['status'], string | undefined][] = [
    ['400 missing_archive', () => jsonResponse(400, { error: 'missing_archive' }), 'This file is empty.', true, 'failed', undefined],
    ['413 backup_file_too_large', () => jsonResponse(413, { error: 'backup_file_too_large', maxBytes: 64 * 1024 * 1024 }), 'This file is larger than the server accepts: 64 MB at most.', true, 'failed', undefined],
    ['413 restore_archive_too_large', () => jsonResponse(413, { error: 'restore_archive_too_large', maxBytes: 512 * 1024 * 1024 }), 'Once unpacked, this archive is larger than the server accepts: 512 MB at most.', true, 'failed', undefined],
    ['an HTML 413 from a proxy', () => htmlResponse(413), 'The network in front of the server refused a file this large before it reached the application. Ask your operator to raise the upload limit of the ingress or proxy.', true, 'failed', undefined],
    ['400 invalid_backup_format', () => jsonResponse(400, { error: 'invalid_backup_format' }), 'This file is not a backup archive, or it is incomplete: it must hold JSON, compressed with gzip or not.', true, 'failed', undefined],
    ['400 team_malformed', () => jsonResponse(400, { error: 'invalid_backup_data', reason: 'team_malformed', count: 3, positions: [0, 1, 2] }), 'Some entries of this file are not teams (no id or no name): 3. Nothing was imported.', true, 'failed', undefined],
    ['400 team_id_duplicated', () => jsonResponse(400, { error: 'invalid_backup_data', reason: 'team_id_duplicated', ids: ['a', 'b'] }), 'This file holds the same team more than once (a, b). Nothing was imported.', true, 'failed', undefined],
    ['400 list_malformed', () => jsonResponse(400, { error: 'invalid_backup_data', reason: 'list_malformed', field: 'resetTokens' }), 'This file is damaged: "resetTokens" is not a list. Nothing was imported.', true, 'failed', undefined],
    ['400 teams_missing', () => jsonResponse(400, { error: 'invalid_backup_data', reason: 'teams_missing' }), 'This file holds no list of teams, so it is not a backup of this application.', true, 'failed', undefined],
    ['401', () => jsonResponse(401, { error: 'unauthorized' }), 'Super admin session expired. Please log in again.', false, 'failed', undefined],
    ['409 import_in_progress', () => jsonResponse(409, { error: 'import_in_progress' }), 'Another file is being imported. Wait for it to finish, then try again.', false, 'failed', undefined],
    ['429 with a retry time', () => jsonResponse(429, { error: 'too_many_attempts', retryAfter: '15 minutes' }), 'Too many attempts. Try again in 15 minutes.', false, 'failed', undefined],
    ['an HTML 404 from an older pod', () => htmlResponse(404), 'This server cannot import files yet, probably because an update is in progress. Try again in a few minutes.', false, 'failed', undefined],
    ['an HTML 504 from a gateway', () => htmlResponse(504), 'No answer came back from the server, but the file may still be imported: it can take a minute to appear in the list below. Check the list before importing the file again.', false, 'uncertain', 'now-and-later'],
    ['a JSON 500 import_failed', () => jsonResponse(500, { error: 'import_failed' }), 'The file could not be imported. Check the list below before trying again.', false, 'failed', 'now'],
    ['an unknown answer', () => jsonResponse(418, { error: 'teapot' }), 'The file could not be imported. Check the list below before trying again.', false, 'failed', 'now']
  ];

  it.each(answers)('%s', async (_label, response, message, fileError, status, reload) => {
    fetchMock.mockResolvedValueOnce(response());
    const outcome = await importBackupFile('t', fileOf(), LIMITS);
    expect(outcome.status).toBe(status);
    expect(messageOf(outcome)).toBe(message);
    if (outcome.status === 'failed') expect(outcome.fileError).toBe(fileError);
    expect(outcome.status === 'ok' ? undefined : outcome.reload).toBe(reload);
  });

  it('reads a 429 with no retry time', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(429, {}));
    expect(messageOf(await importBackupFile('t', fileOf(), LIMITS))).toBe('Too many attempts. Try again later.');
  });

  it('treats a network error as uncertain: the row may have landed', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const outcome = await importBackupFile('t', fileOf(), LIMITS);
    expect(outcome).toMatchObject({ status: 'uncertain', reload: 'now-and-later' });
  });
});

describe('BackupImportCard', () => {
  const renderCard = (overrides: Partial<React.ComponentProps<typeof BackupImportCard>> = {}) => {
    const onImported = vi.fn();
    const onReloadList = vi.fn();
    const view = render(
      <BackupImportCard sessionToken="admin-token" limits={LIMITS} onImported={onImported} onReloadList={onReloadList} {...overrides} />
    );
    const input = screen.getByLabelText('Backup file') as HTMLInputElement;
    const button = screen.getByRole('button', { name: 'Import the file' });
    return { ...view, onImported, onReloadList, input, button };
  };

  const pick = (input: HTMLInputElement, file: File) => fireEvent.change(input, { target: { files: [file] } });
  const describedBy = (element: HTMLElement) =>
    (element.getAttribute('aria-describedby') || '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent);

  it('is a named region with a labelled file input, its hint tied to it', () => {
    const { input } = renderCard();
    expect(screen.getByRole('region', { name: 'Import a backup file' })).toBeTruthy();
    expect(input.type).toBe('file');
    expect(input.accept).toBe('.gz,.json,application/gzip,application/json');
    expect(describedBy(input)).toEqual(['A .json.gz or .json file of 128 MB at most.']);
  });

  it('says only the formats when the server did not report its limits', () => {
    const { input } = renderCard({ limits: null });
    expect(describedBy(input)).toEqual(['A .json.gz or .json file.']);
  });

  it('explains a click with no file, on the field', () => {
    const { input, button } = renderCard();
    fireEvent.click(button);
    expect(screen.getByRole('alert').textContent).toBe('Choose a backup file first.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(input)).toContain('Choose a backup file first.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a file over the limit without sending it, tying the error to the field', () => {
    const { input, button, onReloadList } = renderCard();
    pick(input, fileOf('big.json.gz', 'x', LIMITS.maxArchiveBytes + 1));
    fireEvent.click(button);
    return waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe('This file is larger than the server accepts: 128 MB at most.');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(describedBy(input)).toContain('This file is larger than the server accepts: 128 MB at most.');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(onReloadList).not.toHaveBeenCalled();
    });
  });

  it('stays focused and focusable while it uploads, and a second click sends nothing', async () => {
    const user = userEvent.setup();
    let answer!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { answer = resolve; }));
    const { input, button, onImported } = renderCard();
    pick(input, fileOf('retro.json.gz', 'x'.repeat(2048)));

    await user.click(button);
    const busy = screen.getByRole('button', { name: 'Importing...' });
    expect(busy).toBe(button);
    expect(busy.getAttribute('aria-disabled')).toBe('true');
    expect(busy.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(busy);
    expect(screen.getByRole('status').textContent).toBe('Importing "retro.json.gz" (2.0 KB)...');

    await user.click(busy);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => answer(jsonResponse(200, { success: true, backup: backupEntry() })));
    expect(onImported).toHaveBeenCalledWith(backupEntry());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Import the file' }));
  });

  it('says on screen, and only there, that the file was imported, and clears the field', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, backup: backupEntry() }));
    const { input, button, onImported, onReloadList } = renderCard();
    pick(input, fileOf());
    fireEvent.click(button);

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('"retro.json.gz" was imported. Teams in this file: 2.');
    // Visible at every width: no sr-only, and a long file name wraps.
    expect(status.className).not.toContain('sr-only');
    expect(status.className).toContain('wrap-anywhere');
    expect((screen.getByLabelText('Backup file') as HTMLInputElement).files?.length ?? 0).toBe(0);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onReloadList).not.toHaveBeenCalled();
  });

  it('keeps the file after a refusal, so a retry is one click', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: 'invalid_backup_format' }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, backup: backupEntry() }));
    const { input, button, onImported } = renderCard();
    pick(input, fileOf());
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/not a backup archive/));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('');

    fireEvent.click(button);
    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
  });

  it('asks the page to reload the list now and later when the answer was lost, and now after a failure', async () => {
    const { input, button, onReloadList } = renderCard();
    pick(input, fileOf());

    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fireEvent.click(button);
    await waitFor(() => expect(onReloadList).toHaveBeenLastCalledWith('now-and-later'));
    // An uncertain outcome is not the file's fault.
    expect(input.hasAttribute('aria-invalid')).toBe(false);

    fetchMock.mockResolvedValueOnce(htmlResponse(504));
    fireEvent.click(button);
    await waitFor(() => expect(onReloadList).toHaveBeenCalledTimes(2));
    expect(onReloadList).toHaveBeenLastCalledWith('now-and-later');

    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'import_failed' }));
    fireEvent.click(button);
    await waitFor(() => expect(onReloadList).toHaveBeenCalledTimes(3));
    expect(onReloadList).toHaveBeenLastCalledWith('now');
  });
});
