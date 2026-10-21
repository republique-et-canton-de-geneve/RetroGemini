import React, { useId, useMemo, useRef, useState } from 'react';
import type { JiraStatus } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import type { MessageKey } from '../../i18n/translate';
import { jiraAvailability } from './jiraAvailability';

/** Where each browser remembers who dismissed the note: a JSON array of user ids. */
export const JIRA_NOTE_STORAGE_KEY = 'retro-jira-note-seen';

// A browser shared by a whole team (a meeting-room laptop) keeps the people who
// dismissed it most recently; anyone pushed out simply sees the note once more.
const MAX_REMEMBERED_USERS = 50;

// Every read and write is guarded: storage can be missing or throw in a
// private window, with blocked site data, or when another tab left something
// that is not a list. The note is then shown, which is the safe way to be
// wrong: "at least once" is the promise (spec §5).
const readSeen = (): string[] => {
  try {
    const raw = window.localStorage.getItem(JIRA_NOTE_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const rememberSeen = (userId: string): void => {
  try {
    const seen = [...readSeen().filter(id => id !== userId), userId].slice(-MAX_REMEMBERED_USERS);
    window.localStorage.setItem(JIRA_NOTE_STORAGE_KEY, JSON.stringify(seen));
  } catch {
    // Dismissed for this mount only; see readSeen.
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

// The first control after the note in document order: where the keyboard goes
// when the note, and the button that dismissed it, disappear.
const nextFocusableAfter = (root: HTMLElement): HTMLElement | null =>
  Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).find(element =>
    !root.contains(element) && (root.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  ) ?? null;

interface Props {
  status: JiraStatus | null | undefined;
  isFacilitator: boolean;
  userId: string;
}

/**
 * The discovery note (spec §5; maintainer, 2026-10-20: not everybody reads the
 * changelog). Everyone on a deployment with Jira — participants and
 * facilitators, with or without a token — sees that actions can now be
 * created in Jira, until they press "Got it". It is remembered per browser and
 * per user, so a second browser shows it once more, which still keeps the
 * promise of "at least once". It never appears on a deployment without Jira,
 * where it would advertise a feature that does not exist there.
 *
 * Its last sentence follows who reads it and what the team has: a participant
 * learns the facilitator can do it; a facilitator learns where the buttons
 * are, or where to finish the setup (a token, or the rest of it).
 */
const JiraDiscoveryNote: React.FC<Props> = ({ status, isFacilitator, userId }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const alreadySeen = useMemo(() => readSeen().includes(userId), [userId]);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const availability = jiraAvailability(status);
  if (availability.state === 'off' || alreadySeen || dismissedFor === userId) return null;

  let lastSentence: MessageKey = 'jira.note.participant';
  if (isFacilitator) {
    if (availability.state === 'ready') lastSentence = 'jira.note.facilitatorReady';
    else if (availability.reason === 'noToken') lastSentence = 'jira.note.facilitatorNoToken';
    else lastSentence = 'jira.note.facilitatorSetUp';
  }

  const dismiss = () => {
    const root = rootRef.current;
    const active = document.activeElement;
    // Only when the keyboard was here: someone who clicked "Got it" without
    // focusing it (Safari) keeps wherever they were.
    const next = root && (root.contains(active) || active === document.body) ? nextFocusableAfter(root) : null;
    rememberSeen(userId);
    setDismissedFor(userId);
    next?.focus();
  };

  return (
    <div
      ref={rootRef}
      role="note"
      aria-labelledby={titleId}
      className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-slate-700"
    >
      <span className="material-symbols-outlined text-indigo-600" aria-hidden="true">new_releases</span>
      <div className="min-w-0 flex-1">
        <p id={titleId} className="font-semibold text-slate-800">{t('jira.note.title')}</p>
        <p className="mt-1">{t('jira.note.body')} {t(lastSentence)}</p>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-describedby={titleId}
        className="shrink-0 rounded-md border border-indigo-300 bg-white px-3 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
      >
        {t('jira.note.dismiss')}
      </button>
    </div>
  );
};

export default JiraDiscoveryNote;
