import { useCallback, useSyncExternalStore } from 'react';

/**
 * The actions an issue is being created for right now, in this browser.
 *
 * Shared by every Jira control on the page: the batch button counts only the
 * actions it would really send, and an action's own button is unavailable
 * while a batch holds it, and the other way round. Two controls with their own
 * notion of "sending" would let one click on each send the same action twice;
 * the server would answer the second `in_progress` or `already_linked`, but
 * the screen would have offered a creation it could not honour.
 *
 * Counted per id, so an action stays held until every request that added it
 * has removed it. Module state on purpose: the controls of a Review step and
 * of the Dashboard never need to agree with another tab, the server's claims
 * cover that (findings A-3, U-3).
 */

type Listener = () => void;

const counts = new Map<string, number>();
const listeners = new Set<Listener>();
// Replaced on every change and only then: useSyncExternalStore compares
// snapshots by identity, and a new one on every read re-renders forever.
let current: ReadonlySet<string> = new Set();

const publish = () => {
  current = new Set(counts.keys());
  listeners.forEach(listener => listener());
};

export const jiraInFlight = {
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },

  add: (actionIds: Iterable<string>): void => {
    let changed = false;
    for (const id of actionIds) {
      const count = counts.get(id) ?? 0;
      counts.set(id, count + 1);
      if (count === 0) changed = true;
    }
    if (changed) publish();
  },

  remove: (actionIds: Iterable<string>): void => {
    let changed = false;
    for (const id of actionIds) {
      const count = counts.get(id);
      if (count === undefined) continue;
      if (count > 1) {
        counts.set(id, count - 1);
      } else {
        counts.delete(id);
        changed = true;
      }
    }
    if (changed) publish();
  },

  has: (actionId: string): boolean => counts.has(actionId),

  snapshot: (): ReadonlySet<string> => current,

  /** Forget every action, as on a logout; also what keeps tests independent. */
  clear: (): void => {
    if (counts.size === 0) return;
    counts.clear();
    publish();
  }
};

/** The actions being created, re-rendering the component when the set changes. */
export const useJiraInFlight = (): ReadonlySet<string> =>
  useSyncExternalStore(jiraInFlight.subscribe, jiraInFlight.snapshot);

/** Whether an issue is being created for this one action. */
export const useJiraActionInFlight = (actionId: string): boolean => {
  const isInFlight = useCallback(() => jiraInFlight.has(actionId), [actionId]);
  return useSyncExternalStore(jiraInFlight.subscribe, isInFlight);
};
