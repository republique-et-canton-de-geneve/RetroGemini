import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { Translator } from '../../i18n/translate';

/**
 * Live-sync status affordances shared by the retrospective and health-check
 * sessions (audit H12).
 *
 * Two failure modes look identical from the socket's point of view but are the
 * opposite of each other for the user:
 *
 * - **Offline.** The socket dropped. Reconnection is automatic, editing is
 *   paused for a moment, nothing is lost. Waiting is the right thing to do.
 * - **Join denied.** The socket is *connected*, but the server refused the join
 *   because the team credential is missing, expired, or was minted for another
 *   team. No amount of reconnecting can fix that — only logging in again can.
 *
 * Before H12 both states reused the "Reconnecting…" affordance, which left a
 * participant waiting in front of a frozen session for a reconnect that could
 * never happen. They must read differently and the denied state must offer a
 * way back to the login screen.
 */

/** Reason strings the server sends with `join-denied`. */
export const JOIN_DENIED_FORBIDDEN = 'forbidden';

const deniedCopy = (reason: string | null, t: Translator) =>
  reason === JOIN_DENIED_FORBIDDEN ? t('phases.sync.deniedForbidden') : t('phases.sync.deniedExpired');

interface ChipProps {
  isLive: boolean;
  joinDeniedReason: string | null;
}

/**
 * Small header chip: live / reconnecting / expired.
 */
export const SessionSyncChip: React.FC<ChipProps> = ({ isLive, joinDeniedReason }) => {
  const { t } = useTranslation();

  if (joinDeniedReason !== null) {
    return (
      <div
        className="flex items-center text-rose-700 bg-rose-50 px-2 py-1 rounded-sm"
        title={t('phases.sync.signedOutTitle')}
      >
        <span className="material-symbols-outlined text-lg md:mr-1">lock</span>
        <span className="text-xs font-bold hidden md:inline">{t('phases.sync.signedOut')}</span>
      </div>
    );
  }

  if (!isLive) {
    return (
      <div
        className="flex items-center text-amber-700 bg-amber-50 px-2 py-1 rounded-sm"
        title={t('phases.sync.reconnectingTitle')}
      >
        <span className="material-symbols-outlined text-lg md:mr-1 animate-pulse">cloud_off</span>
        <span className="text-xs font-bold hidden md:inline">{t('phases.sync.reconnecting')}</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center text-emerald-700 bg-emerald-50 px-2 py-1 rounded-sm"
      title={t('phases.sync.liveTitle')}
    >
      <span className="material-symbols-outlined text-lg md:mr-1 animate-pulse">wifi</span>
      <span className="text-xs font-bold hidden md:inline">{t('phases.sync.live')}</span>
    </div>
  );
};

interface BannerProps {
  isLive: boolean;
  joinDeniedReason: string | null;
  onReturnToLogin: () => void;
}

/**
 * Full-width banner under the session header. Renders nothing while the session
 * is live.
 */
export const SessionConnectionBanner: React.FC<BannerProps> = ({
  isLive,
  joinDeniedReason,
  onReturnToLogin
}) => {
  const { t } = useTranslation();

  if (joinDeniedReason !== null) {
    return (
      <div
        role="alert"
        className="bg-rose-100 border-b border-rose-300 text-rose-900 text-sm px-6 py-2 flex flex-wrap items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-base">lock</span>
        <span>{deniedCopy(joinDeniedReason, t)}</span>
        <button
          type="button"
          onClick={onReturnToLogin}
          className="font-bold underline underline-offset-2 hover:text-rose-700"
        >
          {t('phases.sync.logInAgain')}
        </button>
      </div>
    );
  }

  if (!isLive) {
    return (
      <div
        role="status"
        className="bg-amber-100 border-b border-amber-300 text-amber-900 text-sm px-6 py-2 flex items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-base animate-pulse">cloud_off</span>
        <span>{t('phases.sync.reconnectingBanner')}</span>
      </div>
    );
  }

  return null;
};
