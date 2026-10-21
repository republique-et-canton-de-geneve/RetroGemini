import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  jiraInFlight,
  useJiraActionInFlight,
  useJiraInFlight
} from '../components/jira/jiraInFlight';

/**
 * The actions an issue is being created for, shared by every Jira control on
 * the page. The batch button counts the actions it would send and each action
 * has its own button; while one of them is creating an issue for an action,
 * the other must neither count it nor offer it, or one click on each would
 * send the same action twice.
 */

describe('jiraInFlight', () => {
  afterEach(() => {
    jiraInFlight.clear();
  });

  it('knows the actions being created', () => {
    jiraInFlight.add(['a1', 'a2']);

    expect(jiraInFlight.has('a1')).toBe(true);
    expect(jiraInFlight.has('a2')).toBe(true);
    expect(jiraInFlight.has('a3')).toBe(false);

    jiraInFlight.remove(['a1']);
    expect(jiraInFlight.has('a1')).toBe(false);
    expect(jiraInFlight.has('a2')).toBe(true);
  });

  it('keeps an action until every request that added it has removed it', () => {
    jiraInFlight.add(['a1']);
    jiraInFlight.add(['a1']);

    jiraInFlight.remove(['a1']);
    expect(jiraInFlight.has('a1')).toBe(true);

    jiraInFlight.remove(['a1']);
    expect(jiraInFlight.has('a1')).toBe(false);
  });

  it('ignores a removal of an action it does not hold', () => {
    jiraInFlight.remove(['ghost']);
    jiraInFlight.add(['a1']);
    jiraInFlight.remove(['ghost']);

    expect(jiraInFlight.has('a1')).toBe(true);
    expect(jiraInFlight.has('ghost')).toBe(false);
  });

  it('tells its subscribers when the set changes, and only then', () => {
    const listener = vi.fn();
    const unsubscribe = jiraInFlight.subscribe(listener);

    jiraInFlight.add(['a1']);
    expect(listener).toHaveBeenCalledTimes(1);
    jiraInFlight.add(['a1']);
    expect(listener).toHaveBeenCalledTimes(1);
    jiraInFlight.remove(['a1']);
    expect(listener).toHaveBeenCalledTimes(1);
    jiraInFlight.remove(['a1']);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    jiraInFlight.add(['a2']);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('hands out the same snapshot until the set changes', () => {
    // useSyncExternalStore re-renders forever on a snapshot that is new on
    // every read.
    const first = jiraInFlight.snapshot();
    expect(jiraInFlight.snapshot()).toBe(first);

    jiraInFlight.add(['a1']);
    const second = jiraInFlight.snapshot();
    expect(second).not.toBe(first);
    expect([...second]).toEqual(['a1']);
    expect(jiraInFlight.snapshot()).toBe(second);
  });

  it('re-renders a component reading the set when it changes', () => {
    const { result } = renderHook(() => useJiraInFlight());
    expect(result.current.size).toBe(0);

    act(() => { jiraInFlight.add(['a1', 'a2']); });
    expect([...result.current].sort()).toEqual(['a1', 'a2']);

    act(() => { jiraInFlight.remove(['a1', 'a2']); });
    expect(result.current.size).toBe(0);
  });

  it('tells one action\'s control whether that action is being created', () => {
    const { result } = renderHook(() => useJiraActionInFlight('a1'));
    expect(result.current).toBe(false);

    act(() => { jiraInFlight.add(['a2']); });
    expect(result.current).toBe(false);

    act(() => { jiraInFlight.add(['a1']); });
    expect(result.current).toBe(true);

    act(() => { jiraInFlight.remove(['a1']); });
    expect(result.current).toBe(false);
  });
});
