import React, { useId, useMemo, useRef, useState } from 'react';
import type { JiraStatus } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import type { MessageKey } from '../../i18n/translate';
import { hasSeenUser, nextFocusAfterDismiss, rememberSeenUser } from '../common/seenOnce';
import { jiraAvailability } from './jiraAvailability';

/**
 * Where each browser remembers who dismissed the note: a JSON array of user
 * ids, read and written through the one-time notes' shared seen list
 * (`components/common/seenOnce.ts`: the fifty most recent, and a storage that
 * fails shows the note).
 */
export const JIRA_NOTE_STORAGE_KEY = 'retro-jira-note-seen';

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
  const alreadySeen = useMemo(() => hasSeenUser(JIRA_NOTE_STORAGE_KEY, userId), [userId]);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const availability = jiraAvailability(status);
  if (availability.state === 'off' || alreadySeen || dismissedFor === userId) return null;

  let lastSentence: MessageKey = 'jira.note.participant';
  if (isFacilitator) {
    if (availability.state === 'ready') lastSentence = 'jira.note.facilitatorReady';
    else if (availability.reason === 'noToken') lastSentence = 'jira.note.facilitatorNoToken';
    else lastSentence = 'jira.note.facilitatorSetUp';
  }

  const dismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Only when the keyboard pressed it: a pointer leaves the focus where the
    // browser put it, and someone typing elsewhere who clicks "Got it" keeps
    // their place.
    const next = nextFocusAfterDismiss(rootRef.current, event);
    rememberSeenUser(JIRA_NOTE_STORAGE_KEY, userId);
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
