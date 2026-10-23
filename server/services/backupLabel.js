/**
 * The label a backup row shows in the console's table, for a row the super
 * admin imported (`/api/super-admin/backups/import`): the original file name,
 * which the console sends percent-encoded in the `x-backup-label` header — a
 * header rather than the query string, because query strings land in access
 * logs. It is displayed as typed, so it is cleaned first:
 *
 * - NFC, so one name is one string;
 * - control, format and lone-surrogate characters (`\p{Cc}\p{Cf}\p{Cs}`: CR/LF,
 *   bidi overrides, zero-width characters) become spaces, so a label can
 *   neither break the row nor visually reorder it. That also removes the
 *   zero-width joiner inside emoji sequences, which is acceptable for a file
 *   name;
 * - whitespace collapsed and trimmed;
 * - at most 100 code points (the checkpoint field's `maxLength`), cut with
 *   `Array.from`, never inside a surrogate pair.
 *
 * The label never reaches a file name or a header: the row's `filename` is
 * built by the server.
 */

export const BACKUP_LABEL_MAX_LENGTH = 100;
// Anything longer is ignored before decoding: a header can be kilobytes, and
// the label keeps a hundred characters of it at most.
const ENCODED_MAX = 1024;

/** NFC, control and format characters to spaces, collapsed, trimmed, cut at 100 code points. `null` when nothing is left. */
export const cleanBackupLabel = (value) => {
  if (typeof value !== 'string') return null;
  const spaced = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const cleaned = Array.from(spaced).slice(0, BACKUP_LABEL_MAX_LENGTH).join('').trim();
  return cleaned || null;
};

/** The label an imported row carries, from the `x-backup-label` header. `null` when absent or unusable. */
export const labelFromHeader = (raw) => {
  if (typeof raw !== 'string' || raw === '' || raw.length > ENCODED_MAX) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // A bare '%' (or a truncated sequence) throws URIError.
    return null;
  }
  return cleanBackupLabel(decoded);
};
