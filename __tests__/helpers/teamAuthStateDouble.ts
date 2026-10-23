/**
 * Decision D3b — the session-epoch half of a data-store double.
 *
 * Every team route now reads the team's session epoch on each token check
 * (`dataStore.loadTeamAuthState`), so a double used for token auth needs it.
 * This one *models rotation*: a password route that rotates through the
 * double's `atomicTeamUpdate` (the `rotateSessionEpoch` option) or a restore
 * that calls `rotateTeamSessionEpoch` gives the team a new epoch, and every
 * token minted before reads as revoked. A double that answered `'0'` forever
 * would keep every suite green while it stopped describing the server.
 *
 * `has(teamId)` says whether the team record exists, from the double's own
 * storage.
 */

type AtomicResult = { success: boolean; team?: unknown; error?: string; [key: string]: unknown };
type Updater<T> = (team: T) => T | null;

export const createTeamAuthStateDouble = (has: (teamId: string) => boolean) => {
  const epochs = new Map<string, { sessionEpoch: string; revokedAt: number }>();
  let counter = 0;

  const rotate = (teamId: string) => {
    counter += 1;
    const state = { sessionEpoch: `double-epoch-${counter}`, revokedAt: Date.now() };
    epochs.set(teamId, state);
    return state;
  };

  return {
    loadTeamAuthState: async (teamId: string) => {
      const state = epochs.get(teamId);
      return { exists: has(teamId), sessionEpoch: state?.sessionEpoch ?? '0', revokedAt: state?.revokedAt ?? null };
    },
    rotateTeamSessionEpoch: async (teamId: string) => rotate(teamId),
    sweepOrphanedTeamAuthRows: async () => 0,
    /**
     * Wraps a double's `atomicTeamUpdate(teamId, updater)` so the
     * `{ rotateSessionEpoch: true }` option rotates when — and only when —
     * the updater wrote the team, and the result carries the new epoch.
     */
    withRotation: <T>(atomicTeamUpdate: (teamId: string, updater: Updater<T>) => Promise<AtomicResult>) =>
      async (teamId: string, updater: Updater<T>, options: { rotateSessionEpoch?: boolean } = {}): Promise<AtomicResult> => {
        let wrote = false;
        const result = await atomicTeamUpdate(teamId, (team: T) => {
          const next = updater(team);
          wrote = Boolean(next);
          return next;
        });
        if (!options.rotateSessionEpoch || !result?.success || !wrote) return result;
        return { ...result, ...rotate(teamId) };
      }
  };
};
