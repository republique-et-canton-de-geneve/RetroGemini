import { ActionItem } from '../../types';

/**
 * An action enriched with the date of the session it originates from. Used as a
 * fallback ordering signal for legacy actions that predate the `createdAt`
 * field. Dashboard-created actions have no origin session, so `originDate` is
 * left undefined for them.
 */
export interface SortableAction extends ActionItem {
  originDate?: string;
}

/**
 * Parse a date string that may either be an ISO timestamp (modern actions) or a
 * locale-formatted day produced by `Date.toLocaleDateString()` (legacy session
 * dates, e.g. "6/19/2026" in en-US or "19/06/2026" in fr-FR). Returns epoch
 * milliseconds, or null when the value cannot be interpreted.
 */
const parseDate = (value: string): number | null => {
  // ISO timestamps and en-US style "M/D/YYYY" are handled natively.
  const native = Date.parse(value);
  if (!Number.isNaN(native)) return native;

  // Fall back to a locale-tolerant parse for day-first formats that the native
  // parser rejects (e.g. "19/06/2026", "19.06.2026", "19-06-2026").
  const numbers = value.match(/\d+/g)?.map(Number);
  if (!numbers || numbers.length < 3) return null;

  // The year is the 4-digit group when present, otherwise assume it comes last.
  let yearIndex = numbers.findIndex((n) => n >= 1000);
  if (yearIndex === -1) yearIndex = 2;
  const year = numbers[yearIndex];
  const [first, second] = numbers.filter((_, i) => i !== yearIndex);

  // Disambiguate day vs month: a value above 12 can only be the day. When both
  // are ambiguous, assume day-first since en-US (month-first) is already parsed
  // natively above.
  let day: number;
  let month: number;
  if (first > 12) {
    day = first;
    month = second;
  } else if (second > 12) {
    month = first;
    day = second;
  } else {
    day = first;
    month = second;
  }

  const timestamp = new Date(year, (month || 1) - 1, day || 1).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

/**
 * Compute a sortable creation timestamp for an action, preferring its precise
 * `createdAt` field and falling back to the originating session's date for
 * legacy actions. Actions with no usable date sort last (timestamp 0).
 */
export const getActionTimestamp = (action: SortableAction): number => {
  if (action.createdAt) {
    const fromCreatedAt = parseDate(action.createdAt);
    if (fromCreatedAt != null) return fromCreatedAt;
  }
  if (action.originDate) {
    const fromOrigin = parseDate(action.originDate);
    if (fromOrigin != null) return fromOrigin;
  }
  return 0;
};

/**
 * Return a new array of actions sorted by creation date, most recent first.
 * The sort is stable, so actions sharing the same timestamp keep their original
 * relative order.
 */
export const sortActionsByRecency = <T extends SortableAction>(actions: T[]): T[] =>
  actions
    .map((action, index) => ({ action, index }))
    .sort((a, b) => {
      const diff = getActionTimestamp(b.action) - getActionTimestamp(a.action);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map((entry) => entry.action);
