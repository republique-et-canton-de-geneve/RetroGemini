import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { Translator } from '../../i18n/translate';
import { useSyncHealth } from './useSyncHealth';

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

/**
 * Decision D3b: the team's password was changed, so this client's session was
 * signed out (`useSessionRevoked`). Not a reason the server sends — the
 * session screens pass it in place of the denial's own reason.
 */
export const JOIN_DENIED_REVOKED = 'session_revoked';

const deniedCopy = (reason: string | null, t: Translator) => {
  if (reason === JOIN_DENIED_FORBIDDEN) return t('phases.sync.deniedForbidden');
  if (reason === JOIN_DENIED_REVOKED) return t('phases.sync.deniedRevoked');
  return t('phases.sync.deniedExpired');
};

// Every chip is a pill on a tint of its own hue. The breakpoints are the
// header's: below 400px every state steps aside, the label shows from md.
// Below md the label is out of sight, never out of the accessibility tree: the
// icon is aria-hidden, so the words are the chip's only name.
const CHIP_CLASS = 'hidden min-[400px]:flex items-center gap-1.5 h-8 px-2 md:px-2.5 rounded-full';
const CHIP_ICON_CLASS = 'material-symbols-outlined text-lg! leading-none';
const CHIP_LABEL_CLASS = 'text-xs font-semibold sr-only md:not-sr-only';

// The bands under the header: a light tint, a line of its hue below it, and the
// way out as a small white button rather than an underlined word. The
// Dashboard's "password changed" band is the same one (DashboardRevokedBanner).
export const BANNER_CLASS = 'border-b text-sm font-medium px-4 sm:px-6 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5';
/** The tint of a band that says nothing is saved any more. */
export const BANNER_ALERT_CLASS = 'bg-rose-50 border-rose-200 text-rose-900';
/** A band's icon: decoration, the sentence beside it says the state. */
export const BANNER_ICON_CLASS = 'material-symbols-outlined text-lg! leading-none';
export const BANNER_ACTION_CLASS =
  'rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-800 transition hover:bg-rose-100';

interface ChipProps {
  isLive: boolean;
  joinDeniedReason: string | null;
}

/**
 * Small header chip: live / not saving / reconnecting / expired.
 *
 * "Not saving" is the stalled sync health of `syncService` (incident ISS), read
 * here the same way the not-saved banner reads it, so the two cannot disagree
 * and neither header needs a prop for it. It once did disagree: the banner
 * said the participant's changes were not being saved while this chip, just
 * above it, pulsed a green "Live" (review finding G).
 *
 * Whether the chip steps aside on the narrowest phones is decided here too,
 * and below 400px every state does. The header has no room for it: the offline
 * chip overflowed the retro header by 33px at 320px in French, a gap that
 * predates the stalled chip and that the header-fit e2e now measures. Nothing
 * is lost by it, because every state but "Live" has a full-width banner under
 * the header saying the same thing (`SessionConnectionBanner`,
 * `SyncStalledBanner`), and on a phone that banner is what gets read.
 */
export const SessionSyncChip: React.FC<ChipProps> = ({ isLive, joinDeniedReason }) => {
  const { t } = useTranslation();
  const health = useSyncHealth();

  if (joinDeniedReason !== null) {
    return (
      <div
        className={`${CHIP_CLASS} text-rose-700 bg-rose-50`}
        title={joinDeniedReason === JOIN_DENIED_REVOKED ? t('phases.sync.signedOutRevokedTitle') : t('phases.sync.signedOutTitle')}
      >
        <span className={CHIP_ICON_CLASS} aria-hidden="true">lock</span>
        <span className={CHIP_LABEL_CLASS}>{t('phases.sync.signedOut')}</span>
      </div>
    );
  }

  if (!isLive) {
    return (
      <div
        className={`${CHIP_CLASS} text-amber-800 bg-amber-50`}
        title={t('phases.sync.reconnectingTitle')}
      >
        {/* The pulse says "working on it", for readers who allow motion. */}
        <span className={`${CHIP_ICON_CLASS} motion-safe:animate-pulse`} aria-hidden="true">cloud_off</span>
        <span className={CHIP_LABEL_CLASS}>{t('phases.sync.reconnecting')}</span>
      </div>
    );
  }

  // Connected, but the server is not taking this client's writes. The rose of
  // the signed-out chip, and no pulse: nothing here heals by waiting.
  if (health === 'stalled') {
    return (
      <div
        className={`${CHIP_CLASS} text-rose-700 bg-rose-50`}
        title={t('phases.sync.notSaved')}
      >
        <span className={CHIP_ICON_CLASS} aria-hidden="true">sync_problem</span>
        <span className={CHIP_LABEL_CLASS}>{t('phases.sync.notSaving')}</span>
      </div>
    );
  }

  return (
    <div
      className={`${CHIP_CLASS} text-emerald-800 bg-emerald-50`}
      title={t('phases.sync.liveTitle')}
    >
      {/* Still: "live" is the state in which nothing is happening, and a
          pulse that never stops would be the one thing moving at rest. */}
      <span className={CHIP_ICON_CLASS} aria-hidden="true">wifi</span>
      <span className={CHIP_LABEL_CLASS}>{t('phases.sync.live')}</span>
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
        className={`${BANNER_CLASS} ${BANNER_ALERT_CLASS}`}
      >
        <span className={BANNER_ICON_CLASS} aria-hidden="true">lock</span>
        <span>{deniedCopy(joinDeniedReason, t)}</span>
        <button
          type="button"
          onClick={onReturnToLogin}
          className={BANNER_ACTION_CLASS}
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
        className={`${BANNER_CLASS} bg-amber-50 border-amber-200 text-amber-900`}
      >
        <span className={`${BANNER_ICON_CLASS} motion-safe:animate-pulse`} aria-hidden="true">cloud_off</span>
        <span>{t('phases.sync.reconnectingBanner')}</span>
      </div>
    );
  }

  return null;
};
