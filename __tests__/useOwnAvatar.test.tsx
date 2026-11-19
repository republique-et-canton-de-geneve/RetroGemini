import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOwnAvatar } from '../components/session/useOwnAvatar';
import type { Team, User } from '../types';

/**
 * The own entry the viewer's client writes on entering a session (PLAN 18.1):
 * once per state that still shows an older entry, through the screen's own
 * write. A write the screen dropped (it went offline between the render and
 * the effect) is not a write: once the session can write again, it goes out.
 */

const me: User = { id: 'ada', name: 'Ada', color: 'bg-rose-500', role: 'participant' };
const team = { id: 't1', name: 'Team', members: [], memberAvatars: { ada: { id: 'fox', at: 100 } } } as unknown as Team;
// The re-join snapshot brings the same older entry back: same session, same key.
const session = { id: 's1', participants: [{ ...me, avatar: 'owl', avatarAt: 40 }] };

type Props = { canWrite: boolean };

describe('useOwnAvatar, the own entry', () => {
  it('writes the newer choice once, and not again for the same state', () => {
    const updateSession = vi.fn(() => session);
    const { rerender } = renderHook((props: Props) => useOwnAvatar({ session, team, currentUser: me, updateSession, canWrite: props.canWrite }), {
      initialProps: { canWrite: true },
    });
    expect(updateSession).toHaveBeenCalledTimes(1);
    rerender({ canWrite: true });
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  it('writes again after a reconnection when the write it tried was dropped', () => {
    // The screen's updateSession drops a write while offline (isLiveRef), even
    // when the render the effect belongs to still read the session as live.
    const updateSession = vi.fn<(updater: (s: typeof session) => void) => unknown>().mockReturnValueOnce(null);
    const { rerender } = renderHook((props: Props) => useOwnAvatar({ session, team, currentUser: me, updateSession, canWrite: props.canWrite }), {
      initialProps: { canWrite: true },
    });
    expect(updateSession).toHaveBeenCalledTimes(1);
    rerender({ canWrite: false });
    expect(updateSession).toHaveBeenCalledTimes(1);
    rerender({ canWrite: true });
    expect(updateSession).toHaveBeenCalledTimes(2);
    // And the write carries the team's newer choice onto the viewer's own entry.
    const draft = structuredClone(session);
    updateSession.mock.calls[1][0](draft);
    expect(draft.participants[0]).toMatchObject({ id: 'ada', avatar: 'fox', avatarAt: 100 });
  });
});
