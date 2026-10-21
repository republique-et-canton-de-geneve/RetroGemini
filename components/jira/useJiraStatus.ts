import { useCallback, useEffect, useRef, useState } from 'react';
import type { JiraStatus } from '../../types';
import { jiraService } from '../../services/jiraService';

/**
 * The team's Jira status (`/api/team/:teamId/jira/status`), for the controls
 * that depend on it: the discovery note, the reason line, the create buttons.
 *
 * `null` means off, and is both the default and the answer to a status that
 * cannot be read: a deployment without Jira, a pod from before the feature,
 * a lost session. Nothing Jira-related shows then, which is what a deployment
 * without Jira must look like (the spec: the note "never appears on a
 * deployment without Jira"). A later read that fails keeps the status the hook
 * already had, so a reconnection that lands on a pod that cannot answer does
 * not make the controls vanish mid-session; the server refuses a creation the
 * status no longer allows anyway.
 *
 * Nothing is read from `dataService` while rendering (finding T-49):
 * `jiraService` reads the credential inside its async call.
 *
 * The status is read when the component mounts, when `teamId` or `refreshKey`
 * changes, and on `refresh()` (finding U-9). The screens pass as `refreshKey`
 * what should trigger a new read: the phase (entering Review), the sync
 * connection count (a reconnection). `refresh()` settles once the new status
 * is in, which is what a settings save waits on.
 *
 * `failed` says the latest read that settled was a failure, so the one screen
 * that must tell "could not be read" from "Jira is off" — the Settings card,
 * which would otherwise send the facilitator to the administrator over an
 * expired session — can. It stays true while a new read runs, so a retry
 * control does not vanish under the keyboard, and only a success clears it.
 * The controls ignore it: for them, unknown is off.
 */
export interface UseJiraStatus {
  status: JiraStatus | null;
  loading: boolean;
  failed: boolean;
  refresh: () => Promise<void>;
}

export const useJiraStatus = (
  teamId: string | null | undefined,
  { refreshKey }: { refreshKey?: unknown } = {}
): UseJiraStatus => {
  // The status is kept with the team it belongs to, so a team switch shows
  // nothing of the previous team while the new status loads.
  const [state, setState] = useState<{ teamId: string; status: JiraStatus } | null>(null);
  const [loading, setLoading] = useState(Boolean(teamId));
  // The team whose latest read failed, so a failure is never reported for
  // another team after a switch.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  // Only the latest read may write: an answer to an earlier one is stale.
  const latestRead = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const read = ++latestRead.current;
    if (!teamId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const status = await jiraService.getStatus(teamId);
      if (mounted.current && read === latestRead.current) {
        setState({ teamId, status });
        setFailedFor(null);
      }
    } catch {
      // Off, or the last status read: see above.
      if (mounted.current && read === latestRead.current) setFailedFor(teamId);
    } finally {
      if (mounted.current && read === latestRead.current) setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  return {
    status: state && state.teamId === teamId ? state.status : null,
    loading,
    failed: !!teamId && failedFor === teamId,
    refresh
  };
};
