import React, { useCallback, useState } from 'react';
import type { User } from '../types';
import { useTranslation } from '../i18n/I18nContext';
import LanguageSwitcher from './common/LanguageSwitcher';
import AvatarPicker from './common/AvatarPicker';
import AvatarDiscoveryHint from './common/AvatarDiscoveryHint';
import { useAvatarDiscoveryHint } from './common/useAvatarDiscoveryHint';
import ViewerAvatarButton from './session/ViewerAvatarButton';
import { viewerInitials } from './session/sessionAvatars';
import { avatarColorClasses } from '../utils/participantColors';

interface Props {
  teamName: string;
  currentUser: User;
  /** The mark and the team name lead to the dashboard, for a facilitator. */
  onHome: () => void;
  /** Whether the version payload has arrived: "What's New" has nothing to show before. */
  announcementsAvailable: boolean;
  /** The number of unread release notes, or `null` when everything has been read. */
  unreadCount: number | null;
  onOpenAnnouncements: () => void;
  /** Absent where the screen offers its own way out. */
  onLogout?: () => void;
  /** The viewer's picture, `memberAvatarId(team, currentUser.id)`, or null for initials. */
  avatarId?: string | null;
  /** The stored choice the picker marks. */
  avatarChoice?: string | null;
  /** Stores a choice from the picker; rejects when it was not stored. */
  onPickAvatar?: (avatarId: string | null) => Promise<unknown>;
  /** True while a choice cannot be stored (the credential was revoked). */
  avatarPickerDisabled?: boolean;
  /**
   * Whether the viewer has a stored choice, a cleared one included
   * (`memberAvatar(team, id) !== null`). False shows the one-time avatar hint
   * under the bar; a bar drawn alone, which has no team to ask, shows none.
   */
  hasAvatarChoice?: boolean;
}

// Where no screen stores a choice (a test of the bar alone): nothing is stored.
const NOT_STORED = () => Promise.reject(new Error('The avatar could not be saved.'));

/**
 * The dashboard's top bar. `e2e/i18n.spec.ts` → *headers fit in both
 * languages* measures it from 320 to 1280px in English and French: nothing
 * may overflow it, and the language switcher and Logout (found by its
 * `logout` ligature) stay in view. On a phone the words step aside first (the
 * product and team name below `md`, "What's New" and the user's name below
 * `sm`); the viewer's avatar stays at every width.
 *
 * The one-time avatar hint is drawn right after the bar, as its sibling and
 * never inside the `<header>` the spec measures: the bar owns the picker it
 * opens.
 */
const AppHeader: React.FC<Props> = ({
  teamName,
  currentUser,
  onHome,
  announcementsAvailable,
  unreadCount,
  onOpenAnnouncements,
  onLogout,
  avatarId = null,
  avatarChoice = null,
  onPickAvatar = NOT_STORED,
  avatarPickerDisabled = false,
  hasAvatarChoice = true,
}) => {
  const { t } = useTranslation();
  const isParticipant = currentUser.role === 'participant';
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  // Outside a session: no anonymity to respect, and the picker is blocked only
  // by a revoked credential.
  const avatarHint = useAvatarDiscoveryHint({
    userId: currentUser.id,
    hasChoice: hasAvatarChoice,
    anonymous: false,
    blocked: avatarPickerDisabled,
    pickerOpen,
    openPicker,
  });

  return (
    <>
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between gap-3 px-4 md:px-6 shrink-0 z-50">
        <div
          className={`flex items-center min-w-0 ${isParticipant ? '' : 'cursor-pointer'}`}
          onClick={() => !isParticipant && onHome()}
        >
          <span
            aria-hidden="true"
            className="w-8 h-8 shrink-0 rounded-lg bg-indigo-600 text-white text-base font-bold flex items-center justify-center mr-3 btn-brand-glow"
          >
            R
          </span>
          <div className="hidden md:flex items-center gap-2 min-w-0 text-base">
            <span className="font-semibold tracking-tight text-slate-900">RetroGemini</span>
            <span aria-hidden="true" className="text-slate-500">/</span>
            <span className="font-medium text-slate-600 truncate">{teamName}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* Only for facilitators. Named by its words at every width: below
              `sm` they are visually hidden, never removed, so the icon's
              ligature is never what a screen reader announces. */}
          {currentUser.role === 'facilitator' && announcementsAvailable && (
            <button
              type="button"
              onClick={onOpenAnnouncements}
              className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title={t('app.whatsNew')}
            >
              <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
              <span className="sr-only sm:not-sr-only">{t('app.whatsNew')}</span>
              {unreadCount !== null && (
                <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-rose-600 text-white text-xs font-semibold tabular-nums rounded-full ring-2 ring-white flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
          )}

          <LanguageSwitcher />

          {/* On phones the name column yields to the language switcher; the
              avatar stays, so Logout never leaves the screen. */}
          <div className="flex items-center border-l pl-2 sm:pl-4 border-slate-200">
            <div className="hidden sm:flex flex-col items-end mr-2.5 leading-tight">
              <span className="text-xs font-medium text-slate-500">{t('app.user')}</span>
              <span className="text-sm font-semibold text-slate-900">{currentUser.name}</span>
            </div>
            {/* Opens the avatar picker; named by the person, since on a phone
                the name beside it is hidden. */}
            <ViewerAvatarButton
              user={currentUser}
              avatarId={avatarId}
              onClick={openPicker}
              marked={avatarHint.shown}
              ref={avatarHint.openerRef}
            />
          </div>
          {onLogout && (
            <button
              type="button"
              onClick={onLogout}
              className="-ml-1 sm:ml-0 p-1.5 rounded-lg text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
              title={t('app.logoutTeam')}
              aria-label={t('app.logoutTeam')}
            >
              <span className="material-symbols-outlined" aria-hidden="true">logout</span>
            </button>
          )}
        </div>
        <AvatarPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          colorClasses={avatarColorClasses(currentUser.color)}
          initials={viewerInitials(currentUser)}
          name={currentUser.name}
          currentAvatarId={avatarChoice}
          onPick={onPickAvatar}
          disabled={avatarPickerDisabled}
        />
      </header>
      <AvatarDiscoveryHint user={currentUser} hint={avatarHint} />
    </>
  );
};

export default AppHeader;
