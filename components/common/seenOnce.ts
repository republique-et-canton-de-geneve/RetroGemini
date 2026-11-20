/**
 * The seen list of a one-time note: which people dismissed it in this
 * browser, kept as a JSON array of member ids under the note's own key. The
 * Jira discovery note and the avatar hint share it, so both keep one rule
 * (AGENTS.md, *Jira* and *Avatars*): per person and per browser, the most
 * recent fifty, and a storage that fails shows the note rather than hiding
 * it.
 */

/**
 * A browser shared by a whole team (a meeting-room laptop) keeps the people who
 * dismissed a note most recently; anyone pushed out simply sees it once more.
 */
export const MAX_REMEMBERED_USERS = 50;

// Every read and write is guarded: storage can be missing or throw in a
// private window, with blocked site data, or when another tab left something
// that is not a list. The note is then shown, which is the safe way to be
// wrong: "at least once" is the promise.
export const readSeenUsers = (storageKey: string): string[] => {
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

/** Whether `userId` dismissed the note kept under `storageKey`, in this browser. */
export const hasSeenUser = (storageKey: string, userId: string): boolean =>
  readSeenUsers(storageKey).includes(userId);

/** Remembers that `userId` has seen the note: last of the list, so the most recent are kept. */
export const rememberSeenUser = (storageKey: string, userId: string): void => {
  try {
    const seen = [...readSeenUsers(storageKey).filter(id => id !== userId), userId].slice(-MAX_REMEMBERED_USERS);
    window.localStorage.setItem(storageKey, JSON.stringify(seen));
  } catch {
    // Dismissed for this mount only; see readSeenUsers.
  }
};

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * The first control after `root` in document order: where the keyboard goes
 * when a note, and the button that dismissed it, disappear.
 */
export const nextFocusableAfter = (root: HTMLElement): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).find(element =>
    !root.contains(element) && (root.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  ) ?? null;

/**
 * Where to put the keyboard once the note `root` is dismissed by `click`: the
 * next control when the keyboard pressed the note's button, or nowhere. The
 * click says which: one a key sends (Enter or Space) carries no `detail`, a
 * pointer's carries its count. Where the browser left the focus says nothing:
 * Chrome and Firefox focus the button they press, Safari does not, and moved
 * on after a tap the focus landed in the next field, where a phone opened its
 * keyboard (the facilitator's Icebreaker question, under the avatar hint).
 */
export const nextFocusAfterDismiss = (
  root: HTMLElement | null,
  click: Pick<MouseEvent, 'detail'>
): HTMLElement | null => (root && click.detail === 0 ? nextFocusableAfter(root) : null);
