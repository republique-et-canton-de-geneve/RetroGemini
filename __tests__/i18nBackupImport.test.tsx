import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import { useTranslation } from '../i18n/I18nContext';
import BackupImportCard from '../components/admin/BackupImportCard';

/**
 * The import card in French: its chrome, and a message on screen that follows
 * the language switcher — it is kept as what to say, never as the sentence,
 * and the size it quotes takes the reader's decimal mark when it is shown.
 * Role queries use the real no-break characters French typography needs.
 */

const LIMITS = { maxArchiveBytes: 128 * 1024 * 1024, maxUnpackedBytes: 512 * 1024 * 1024 };

const Switcher: React.FC = () => {
  const { setLanguage } = useTranslation();
  return <button type="button" onClick={() => setLanguage('en')}>to English</button>;
};

const renderInFrench = (limits: typeof LIMITS | null = LIMITS) =>
  render(
    <LanguageProvider initialLanguage="fr">
      <Switcher />
      <BackupImportCard sessionToken="admin-token" limits={limits} onImported={vi.fn()} onReloadList={vi.fn()} />
    </LanguageProvider>
  );

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    // Storage is optional.
  }
});

describe('the backup import card in French', () => {
  it('names its region, its field, its hint and its button in French', () => {
    renderInFrench();
    expect(screen.getByRole('region', { name: 'Importer un fichier de sauvegarde' })).toBeTruthy();
    const input = screen.getByLabelText('Fichier de sauvegarde');
    expect(input.getAttribute('type')).toBe('file');
    // getByText normalises the element's no-break spaces, so it is queried
    // with an ordinary one; the text itself carries the real character.
    const hint = screen.getByText('Un fichier .json.gz ou .json de 128 Mo au plus.');
    expect(hint.textContent).toBe('Un fichier .json.gz ou .json de 128\u00a0Mo au plus.');
    expect(input.getAttribute('aria-describedby')).toBe(hint.id);
    expect(screen.getByRole('button', { name: 'Importer le fichier' })).toBeTruthy();
    expect(screen.queryByText('Import the file')).toBeNull();
  });

  it('says why a file is refused in French, with French typography', () => {
    renderInFrench();
    fireEvent.click(screen.getByRole('button', { name: 'Importer le fichier' }));
    expect(screen.getByRole('alert').textContent).toBe('Choisissez d’abord un fichier de sauvegarde.');
  });

  it('quotes a fractional limit with the French decimal mark, and switches with the language', async () => {
    renderInFrench({ maxArchiveBytes: 512 * 1024, maxUnpackedBytes: 1024 * 1024 });
    const input = screen.getByLabelText('Fichier de sauvegarde');
    const big = new File(['x'], 'gros.json.gz');
    Object.defineProperty(big, 'size', { value: 600 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    fireEvent.click(screen.getByRole('button', { name: 'Importer le fichier' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent)
      .toBe('Ce fichier dépasse la taille acceptée par le serveur\u00a0: 0,5\u00a0Mo au plus.'));
    expect(global.fetch).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'to English' })); });
    expect(screen.getByRole('alert').textContent).toBe('This file is larger than the server accepts: 0.5 MB at most.');
  });
});
