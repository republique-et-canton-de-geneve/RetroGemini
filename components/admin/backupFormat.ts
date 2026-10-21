import type { Notice } from '../../i18n/notice';
import type { Translator } from '../../i18n/translate';
import { localizeDecimal } from '../../i18n/formatNumber';

/**
 * Sizes as the Backups tab shows them, shared by the backups table and the
 * import card so a file reads the same size in both.
 */

const MEBIBYTE = 1024 * 1024;

/** A stored or uploaded size: bytes, then KB, then MB, with the reader's decimal mark. */
export const formatBackupSize = (bytes: number, t: Translator, locale: string): string => {
  if (bytes < 1024) return t('adminBackups.size.bytes', { size: bytes });
  if (bytes < MEBIBYTE) {
    return t('adminBackups.size.kilobytes', { size: localizeDecimal((bytes / 1024).toFixed(1), locale) });
  }
  return t('adminBackups.size.megabytes', { size: localizeDecimal((bytes / MEBIBYTE).toFixed(1), locale) });
};

/**
 * A limit in mebibytes, with an English decimal mark: whole when it is whole
 * (128), else one decimal (0.5), or two significant digits under 0.1 — so
 * `RESTORE_MAX_BODY_MB=0.5` never reads "1 MB". This is the form a `Notice`
 * keeps in its params; `megabytes` and `withLocalizedMax` give it the reader's
 * mark when it is shown.
 */
export const megabytesText = (bytes: number): string => {
  const value = bytes / MEBIBYTE;
  if (Number.isInteger(value)) return String(value);
  return value >= 0.1 ? value.toFixed(1) : value.toPrecision(2);
};

/** The same, with the reader's decimal mark. */
export const megabytes = (bytes: number, locale: string): string => localizeDecimal(megabytesText(bytes), locale);

/**
 * A notice whose `max` param is a `megabytesText`, given the reader's decimal
 * mark at render time. The notice itself stays language-neutral, so the
 * message follows the language switcher while it is on screen.
 */
export const withLocalizedMax = (notice: Notice, locale: string): Notice => {
  if (!notice || 'raw' in notice || typeof notice.params?.max !== 'string') return notice;
  return { ...notice, params: { ...notice.params, max: localizeDecimal(notice.params.max, locale) } };
};
