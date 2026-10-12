import { useEffect } from 'react';
import { syncService } from '../../services/syncService';
import { holdOwnStateWhileRefused, type OwnChangeLedger, type PendingCreation } from './mergeRemoteSession';

/**
 * Keep a session screen's unconfirmed work (cards, proposals, own-change
 * claims) from expiring while sync is stalled. One rule for the retrospective
 * and the health check.
 *
 * Holds at two moments:
 *
 * - **When the stall starts.** A stall takes ten seconds of re-sends, so
 *   anything written before it began still has most of its 60 s TTL left. The
 *   stall itself is where it is caught, and no refusal has to arrive first.
 * - **On every refusal while the stall lasts**, so nothing can expire until it
 *   ends. The TTL runs again from the last hold once it does.
 *
 * A refusal while sync is healthy holds nothing. On its own a refusal is an
 * ordinary lost race: every client writes the timer expiry and the leftUsers
 * clear at the same instant, and all but one are refused. Holding on each one,
 * as this code first did, kept every claim of a busy room alive for as long as
 * the room stayed busy. The own-change ledger relies on that TTL to end a
 * disagreement between two browsers of one participant, so it has to keep
 * running whenever this client is heard. See holdOwnStateWhileRefused.
 */
export const useHoldOwnStateWhileStalled = (
  sessionId: string,
  pendingCreations: { readonly current: Map<string, PendingCreation> },
  ownChanges: { readonly current: OwnChangeLedger }
): void => {
  useEffect(() => {
    const holdForThisSession = () => {
      if (syncService.getCurrentSessionId() !== sessionId) return;
      holdOwnStateWhileRefused(pendingCreations.current, ownChanges.current);
    };

    // onSyncHealth fires on changes only, so 'stalled' here is the transition.
    const unsubHealth = syncService.onSyncHealth((health) => {
      if (health === 'stalled') holdForThisSession();
    });

    // syncService updates the health before it calls refusal subscribers, so a
    // refusal that completes a stall already reads 'stalled' here.
    const unsubRefused = syncService.onUpdateRefused(() => {
      if (syncService.getSyncHealth() === 'stalled') holdForThisSession();
    });

    return () => {
      unsubHealth();
      unsubRefused();
    };
  }, [sessionId, pendingCreations, ownChanges]);
};
