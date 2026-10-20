import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JiraStatus } from '../types';

/**
 * The status every Jira control reads: whether the deployment has a Jira, and
 * whether the team's token and target let it create. Off (`null`) is the
 * default and the answer to every failure, so a deployment without Jira — or a
 * pod from before the feature — shows nothing at all.
 *
 * The hook never reads `dataService` while rendering (finding T-49): the token
 * is read inside `jiraService`'s async call. The dataService mock below has no
 * `getSessionToken` at all, so a render-time read would throw out of
 * `renderHook` instead of leaving the status off.
 */

const mocks = vi.hoisted(() => ({
  dataService: {
    getAuthenticatedPassword: () => null
  }
}));
vi.mock('../services/dataService', () => ({ dataService: mocks.dataService }));

import { jiraService } from '../services/jiraService';
import { useJiraStatus } from '../components/jira/useJiraStatus';

const status = (connectedAs: string): JiraStatus => ({
  enabled: true,
  baseUrl: 'https://jira.example.org',
  target: null,
  token: {
    configured: true,
    usable: true,
    reason: null,
    connectedAs,
    deploymentType: 'Server',
    setAt: '2026-10-20T08:00:00.000Z',
    refusedAt: null
  }
});

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

describe('useJiraStatus', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays off when the status cannot be read, without throwing while rendering', async () => {
    // The real service, with a dataService that cannot hand out a token.
    const { result } = renderHook(() => useJiraStatus('team-1'));

    expect(result.current.status).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.status).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reads the status of the team when it mounts', async () => {
    const getStatus = vi.spyOn(jiraService, 'getStatus').mockResolvedValue(status('Bot'));
    const seen: boolean[] = [];

    const { result } = renderHook(() => {
      const current = useJiraStatus('team-1');
      seen.push(current.loading);
      return current;
    });

    // The very first render already reads as loading, before the effect runs:
    // a screen that explains why Jira is off when `!loading && !status` must
    // not flash that sentence on every mount.
    expect(seen[0]).toBe(true);
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.status).toEqual(status('Bot')));
    expect(result.current.loading).toBe(false);
    expect(getStatus).toHaveBeenCalledWith('team-1');
  });

  it('reads nothing without a team', async () => {
    const getStatus = vi.spyOn(jiraService, 'getStatus').mockResolvedValue(status('Bot'));

    const { result } = renderHook(() => useJiraStatus(null));

    expect(result.current).toMatchObject({ status: null, loading: false });
    await act(async () => { await result.current.refresh(); });
    expect(getStatus).not.toHaveBeenCalled();
  });

  it('stops loading when the team goes away while a read is pending', async () => {
    // A logout, or the team unloading: the pending answer is stale and will
    // not end the loading state, so the switch to no team must.
    const pending = deferred<JiraStatus>();
    vi.spyOn(jiraService, 'getStatus').mockReturnValueOnce(pending.promise);

    const { result, rerender } = renderHook(({ teamId }: { teamId: string | null }) => useJiraStatus(teamId), {
      initialProps: { teamId: 'team-1' as string | null }
    });
    expect(result.current.loading).toBe(true);

    rerender({ teamId: null });
    expect(result.current).toMatchObject({ status: null, loading: false });

    await act(async () => { pending.resolve(status('Bot')); await pending.promise; });
    expect(result.current).toMatchObject({ status: null, loading: false });
  });

  it('reads it again when the refresh key changes, and only then', async () => {
    // The screens pass what should trigger a new read: entering Review, a
    // reconnection, a saved setting (finding U-9).
    const second = deferred<JiraStatus>();
    const getStatus = vi.spyOn(jiraService, 'getStatus')
      .mockResolvedValueOnce(status('First'))
      .mockReturnValueOnce(second.promise);

    const { result, rerender } = renderHook(({ refreshKey }) => useJiraStatus('team-1', { refreshKey }), {
      initialProps: { refreshKey: 'DISCUSS:1' }
    });
    await waitFor(() => expect(result.current.status?.token.connectedAs).toBe('First'));

    rerender({ refreshKey: 'DISCUSS:1' });
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);

    rerender({ refreshKey: 'REVIEW:1' });
    expect(getStatus).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(true);

    await act(async () => { second.resolve(status('Second')); await second.promise; });
    expect(result.current.status?.token.connectedAs).toBe('Second');
    expect(result.current.loading).toBe(false);
  });

  it('reads it again on refresh(), which settles once the new status is in', async () => {
    const after = deferred<JiraStatus>();
    vi.spyOn(jiraService, 'getStatus')
      .mockResolvedValueOnce(status('Before'))
      .mockReturnValueOnce(after.promise);

    const { result } = renderHook(() => useJiraStatus('team-1'));
    await waitFor(() => expect(result.current.status?.token.connectedAs).toBe('Before'));

    let refreshed!: Promise<void>;
    act(() => { refreshed = result.current.refresh(); });
    // A settings card waiting on a save shows it is still reading.
    expect(result.current.loading).toBe(true);
    expect(result.current.status?.token.connectedAs).toBe('Before');

    await act(async () => { after.resolve(status('After')); await refreshed; });
    expect(result.current.status?.token.connectedAs).toBe('After');
    expect(result.current.loading).toBe(false);
  });

  it('keeps the last status it read when a later read fails', async () => {
    // A reconnection during a rollout may land on a pod that cannot answer; the
    // controls must not vanish mid-session for that.
    vi.spyOn(jiraService, 'getStatus')
      .mockResolvedValueOnce(status('Bot'))
      .mockRejectedValueOnce(new Error('unknown_error'));

    const { result } = renderHook(() => useJiraStatus('team-1'));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(async () => { await result.current.refresh(); });
    expect(result.current.status?.token.connectedAs).toBe('Bot');
    expect(result.current.loading).toBe(false);
  });

  it('never lets an older answer replace a newer one', async () => {
    const slow = deferred<JiraStatus>();
    const fast = deferred<JiraStatus>();
    vi.spyOn(jiraService, 'getStatus')
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise);

    const { result } = renderHook(() => useJiraStatus('team-1'));
    let refreshed!: Promise<void>;
    act(() => { refreshed = result.current.refresh(); });

    await act(async () => {
      fast.resolve(status('Newer'));
      await refreshed;
    });
    await act(async () => { slow.resolve(status('Older')); await slow.promise; });

    expect(result.current.status?.token.connectedAs).toBe('Newer');
    expect(result.current.loading).toBe(false);
  });

  it('keeps loading when an older read settles while a newer one is still pending', async () => {
    const older = deferred<JiraStatus>();
    const newer = deferred<JiraStatus>();
    vi.spyOn(jiraService, 'getStatus')
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);

    const { result } = renderHook(() => useJiraStatus('team-1'));
    let refreshed!: Promise<void>;
    act(() => { refreshed = result.current.refresh(); });

    await act(async () => { older.resolve(status('Older')); await older.promise; });
    expect(result.current.loading).toBe(true);
    expect(result.current.status).toBeNull();

    await act(async () => { newer.resolve(status('Newer')); await refreshed; });
    expect(result.current.loading).toBe(false);
    expect(result.current.status?.token.connectedAs).toBe('Newer');
  });

  it('shows nothing of the previous team after a switch', async () => {
    const next = deferred<JiraStatus>();
    vi.spyOn(jiraService, 'getStatus')
      .mockResolvedValueOnce(status('Team one'))
      .mockReturnValueOnce(next.promise);

    const { result, rerender } = renderHook(({ teamId }) => useJiraStatus(teamId), {
      initialProps: { teamId: 'team-1' }
    });
    await waitFor(() => expect(result.current.status?.token.connectedAs).toBe('Team one'));

    rerender({ teamId: 'team-2' });
    expect(result.current.status).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => { next.resolve(status('Team two')); await next.promise; });
    expect(result.current.status?.token.connectedAs).toBe('Team two');
    expect(result.current.loading).toBe(false);
  });
});
