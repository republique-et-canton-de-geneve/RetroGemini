import React from 'react';

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

const deniedCopy = (reason: string | null) =>
  reason === JOIN_DENIED_FORBIDDEN
    ? 'This session belongs to another team. Nothing you do here is being saved — log in with that team to join it.'
    : 'Your session has expired, so nothing you do here is being saved. Log in again to rejoin the session.';

interface ChipProps {
  isLive: boolean;
  joinDeniedReason: string | null;
}

/**
 * Small header chip: live / reconnecting / expired.
 */
export const SessionSyncChip: React.FC<ChipProps> = ({ isLive, joinDeniedReason }) => {
  if (joinDeniedReason !== null) {
    return (
      <div
        className="flex items-center text-rose-700 bg-rose-50 px-2 py-1 rounded-sm"
        title="Session expired — log in again to rejoin"
      >
        <span className="material-symbols-outlined text-lg mr-1">lock</span>
        <span className="text-xs font-bold hidden sm:inline">Signed out</span>
      </div>
    );
  }

  if (!isLive) {
    return (
      <div
        className="flex items-center text-amber-700 bg-amber-50 px-2 py-1 rounded-sm"
        title="Disconnected — reconnecting"
      >
        <span className="material-symbols-outlined text-lg mr-1 animate-pulse">cloud_off</span>
        <span className="text-xs font-bold hidden sm:inline">Reconnecting…</span>
      </div>
    );
  }

  return (
    <div
      className="flex items-center text-emerald-600 bg-emerald-50 px-2 py-1 rounded-sm"
      title="Real-time sync active"
    >
      <span className="material-symbols-outlined text-lg mr-1 animate-pulse">wifi</span>
      <span className="text-xs font-bold hidden sm:inline">Live</span>
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
  if (joinDeniedReason !== null) {
    return (
      <div
        role="alert"
        className="bg-rose-100 border-b border-rose-300 text-rose-900 text-sm px-6 py-2 flex flex-wrap items-center justify-center gap-2"
      >
        <span className="material-symbols-outlined text-base">lock</span>
        <span>{deniedCopy(joinDeniedReason)}</span>
        <button
          type="button"
          onClick={onReturnToLogin}
          className="font-bold underline underline-offset-2 hover:text-rose-700"
        >
          Log in again
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
        <span>Reconnecting… editing is paused until you&apos;re back online. Nothing you already submitted is lost.</span>
      </div>
    );
  }

  return null;
};
