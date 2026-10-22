import { MutableRefObject, useEffect, useRef, useSyncExternalStore } from 'react';
import { syncService } from '../../services/syncService';
import { isSessionRevoked, onSessionRevokedChange } from '../../services/sessionRevocation';

/**
 * Decision D3b — what both session screens do when the team's password is
 * changed under them: editing pauses like it does offline, and the connection
 * banner and the header chip say why (`JOIN_DENIED_REVOKED` in
 * `SessionConnectionStatus.tsx`) and offer "Log in again". Not an automatic
 * redirect: a participant halfway through a card can still copy its text
 * (the H12 rationale).
 *
 * Written once, here, for the retrospective and the health check alike
 * (`__tests__/sessionRevokedShared.test.ts` holds both to it). When another
 * tab of the same browser changed the password, its new token clears the
 * revocation a moment later and the session goes live again by itself.
 */

// Module-level so useSyncExternalStore keeps one subscription for the life of
// the component.
const subscribe = (onChange: () => void) => onSessionRevokedChange(() => onChange());

/**
 * Whether a session screen is live: connected, its join not denied, and its
 * team session not revoked. The connection handler of each screen asks this,
 * so a reconnect never makes a revoked session look live.
 */
export const isSessionLive = (connected: boolean, joinDeniedReason: string | null): boolean =>
  connected && joinDeniedReason === null && !isSessionRevoked();

interface LiveState {
  isLiveRef: MutableRefObject<boolean>;
  setIsLive: (live: boolean) => void;
  joinDeniedRef: MutableRefObject<string | null>;
}

export const useSessionRevoked = ({ isLiveRef, setIsLive, joinDeniedRef }: LiveState): boolean => {
  const revoked = useSyncExternalStore(subscribe, isSessionRevoked, isSessionRevoked);
  const wasRevoked = useRef(revoked);

  useEffect(() => {
    if (revoked) {
      isLiveRef.current = false;
      setIsLive(false);
    } else if (wasRevoked.current) {
      // Cleared by a new token: live again as soon as the rest allows.
      const live = isSessionLive(syncService.isConnected(), joinDeniedRef.current);
      isLiveRef.current = live;
      setIsLive(live);
    }
    wasRevoked.current = revoked;
  }, [revoked, isLiveRef, setIsLive, joinDeniedRef]);

  return revoked;
};
