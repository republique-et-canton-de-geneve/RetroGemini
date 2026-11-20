import React, { useId, useRef } from 'react';
import type { User } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import Avatar from './Avatar';
import { avatarColorClasses } from '../../utils/participantColors';
import { AVATAR_IDS } from '../../utils/avatars.js';
import { PRIMARY_BUTTON } from '../dashboard/dashboardLook';
import { viewerInitials } from '../session/sessionAvatars';
import { nextFocusAfterDismiss } from './seenOnce';
import type { AvatarHint } from './useAvatarDiscoveryHint';

// The band, in the page flow right under the header: the session bands'
// shape on the Jira note's indigo tint. Its display comes from the opener's
// visibility class, so there is never a band without an opener.
const BAND_CLASS = 'shrink-0 border-b border-indigo-200 bg-indigo-50 px-4 sm:px-6 py-2 text-sm text-slate-700';
const ROW_CLASS = 'mx-auto flex w-full max-w-5xl flex-wrap sm:flex-nowrap items-center justify-center gap-x-3 gap-y-1.5';
const FOCUS_CLASS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
// The main action, at the size of a band's action.
const CHOOSE_CLASS = `${PRIMARY_BUTTON} px-2.5 py-1 text-xs ${FOCUS_CLASS}`;
// The Jira note's "Got it", at the same size.
const DISMISS_CLASS = `rounded-lg border border-indigo-300 bg-white px-2.5 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 ${FOCUS_CLASS}`;
const SAMPLE_CLASS = 'flex rounded-full ring-2 ring-white';
// The pictures and the sentence show from `lg`, where they fit beside the
// buttons; below it the band keeps its title and its two buttons, and the
// sentence is read, not shown. From `sm` they shared a row that cannot wrap
// with the buttons, which left the sentence about 250px: four or five lines,
// and a band of 117px at 640px against 43px at 639px (e2e/avatars.spec.ts).
const SAMPLES_CLASS = 'hidden lg:flex shrink-0';
const SENTENCE_CLASS = 'sr-only lg:not-sr-only';

/** Three of the pictures, one per family the eye knows at once: an animal, an object, the sky. */
const SAMPLE_AVATAR_IDS = ['fox', 'rocket', 'moon'] as const;

interface Props {
  /** The viewer: the samples are drawn in their own tone. */
  user: User;
  /** What `useAvatarDiscoveryHint` decided, its two gestures, and the opener. */
  hint: Pick<AvatarHint, 'shown' | 'choose' | 'dismiss' | 'openerRef'>;
  /** The opener's visibility class (a facilitator's, in a session: from 360px). */
  visibilityClass?: string;
}

/**
 * The one-time hint that the avatar can be changed (AGENTS.md, *Avatars*):
 * nothing else told people, and not everybody reads What's New. A note named
 * by its title, met in reading order right after the header: not a live
 * region (it is there with the screen, nothing is announced), it never takes
 * the focus and it does not move. From `sm` it shows three of the pictures in
 * the viewer's own tone and its sentence; on a phone the sentence is read but
 * not shown. "Choose my avatar" opens the picker from the opener, which it
 * focuses first so the picker gives the focus back there; "Got it" puts the
 * keyboard on what follows the band when it was the keyboard that pressed it.
 */
const AvatarDiscoveryHint: React.FC<Props> = ({ user, hint, visibilityClass = 'flex' }) => {
  const { t } = useTranslation();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  if (!hint.shown) return null;

  const dismiss = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Only when the keyboard pressed it: a pointer leaves the focus where the
    // browser put it, so a tap never lands in a field (a phone would open its
    // keyboard) and someone typing a card who clicks "Got it" keeps their place.
    // With no drawn control after the band (a participant's Icebreaker below
    // lg, where the participants panel is not drawn), the keyboard goes back
    // to the opener, which is drawn wherever the band was, rather than falling
    // to the page.
    const byKey = event.detail === 0;
    const next = nextFocusAfterDismiss(rootRef.current, event) ?? (byKey ? hint.openerRef.current : null);
    hint.dismiss();
    next?.focus();
  };

  const initials = viewerInitials(user);

  return (
    <div
      ref={rootRef}
      role="note"
      aria-labelledby={titleId}
      data-avatar-hint
      className={`${visibilityClass} ${BAND_CLASS}`}
    >
      <div className={ROW_CLASS}>
        <span aria-hidden="true" className={SAMPLES_CLASS}>
          {SAMPLE_AVATAR_IDS.map((avatarId, index) => (
            <span key={avatarId} className={index === 0 ? SAMPLE_CLASS : `-ml-1.5 ${SAMPLE_CLASS}`}>
              {/* The picker's tile size: smaller, the drawings blur into each other. */}
              <Avatar colorClasses={avatarColorClasses(user.color)} initials={initials} size={40} avatarId={avatarId} />
            </span>
          ))}
        </span>
        <div className="min-w-0 sm:flex-1">
          <p id={titleId} className="font-semibold text-slate-900">{t('avatars.hint.title')}</p>
          <p className={SENTENCE_CLASS}>{t('avatars.hint.body', { count: AVATAR_IDS.length })}</p>
        </div>
        <span className="flex shrink-0 gap-2">
          <button type="button" aria-haspopup="dialog" onClick={hint.choose} className={CHOOSE_CLASS}>
            {t('avatars.hint.choose')}
          </button>
          <button type="button" aria-describedby={titleId} onClick={dismiss} className={DISMISS_CLASS}>
            {t('avatars.hint.dismiss')}
          </button>
        </span>
      </div>
    </div>
  );
};

export default AvatarDiscoveryHint;
