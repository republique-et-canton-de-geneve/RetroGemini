import { describe, expect, it } from 'vitest';
import { BACKUP_LABEL_MAX_LENGTH, cleanBackupLabel, labelFromHeader } from '../server/services/backupLabel.js';

/**
 * The label an imported backup row carries: the file name the console sends,
 * percent-encoded, in `x-backup-label`. It is shown in the backups table as
 * typed, so it must not be able to reorder the row (bidi overrides), break it
 * (line feeds) or grow without bound.
 */

describe('labelFromHeader', () => {
  it('decodes a percent-encoded file name', () => {
    expect(labelFromHeader('%E2%82%AC.json.gz')).toBe('€.json.gz');
    expect(labelFromHeader(encodeURIComponent('Sauvegarde du 1er octobre.json.gz'))).toBe('Sauvegarde du 1er octobre.json.gz');
  });

  it('gives null for a value that does not decode, is absent or is too long to read', () => {
    expect(labelFromHeader('%')).toBeNull();
    expect(labelFromHeader('%E2%82')).toBeNull();
    expect(labelFromHeader(undefined)).toBeNull();
    expect(labelFromHeader('')).toBeNull();
    expect(labelFromHeader(42 as unknown as string)).toBeNull();
    expect(labelFromHeader('a'.repeat(1025))).toBeNull();
    expect(labelFromHeader('a'.repeat(1024))).toBe('a'.repeat(BACKUP_LABEL_MAX_LENGTH));
  });
});

describe('cleanBackupLabel', () => {
  it('turns control and format characters into spaces, then collapses and trims', () => {
    expect(cleanBackupLabel('one\r\ntwo')).toBe('one two');
    expect(cleanBackupLabel('‮evil.json.gz')).toBe('evil.json.gz');
    expect(cleanBackupLabel('zero​width')).toBe('zero width');
    expect(cleanBackupLabel('  a \t\t b  ')).toBe('a b');
  });

  it('cuts at 100 code points, never inside a surrogate pair', () => {
    expect(Array.from(cleanBackupLabel('é'.repeat(150))!)).toHaveLength(100);
    const withEmoji = `${'a'.repeat(99)}😀tail`;
    const cut = cleanBackupLabel(withEmoji)!;
    expect(cut).toBe(`${'a'.repeat(99)}😀`);
    expect(Array.from(cut)).toHaveLength(100);
    // No lone surrogate left at the end.
    expect(/[\ud800-\udbff]$/.test(cut)).toBe(false);
  });

  it('gives null for whitespace only, or for what is not a string', () => {
    expect(cleanBackupLabel('   \n\t ')).toBeNull();
    expect(cleanBackupLabel('​‮')).toBeNull();
    expect(cleanBackupLabel(null as unknown as string)).toBeNull();
  });

  it('stores a decomposed accent composed (NFC)', () => {
    const decomposed = 'été.json.gz';
    expect(cleanBackupLabel(decomposed)).toBe('été.json.gz');
  });
});
