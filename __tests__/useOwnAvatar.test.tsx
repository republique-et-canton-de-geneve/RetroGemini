import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { dataService } from '../services/dataService';
import { SERVER_STAMP_WAIT_MS, useOwnAvatar } from '../components/session/useOwnAvatar';
import { nextMemberAvatars } from '../server/routes/teamAvatarRoutes.js';
import type { MemberAvatarChoice, Team, User } from '../types';

/**
 * The own entry the viewer's client writes on entering a session (AGENTS.md, *Avatars*):
 * once per state that still shows an older entry, through the screen's own
 * write. A write the screen dropped (it went offline between the render and
 * the effect) is not a write: once the session can write again, it goes out.
 */

const me: User = { id: 'ada', name: 'Ada', color: 'bg-rose-500', role: 'participant' };
const team = { id: 't1', name: 'Team', members: [], memberAvatars: { ada: { id: 'fox', at: 100 } } } as unknown as Team;
// The re-join snapshot brings the same older entry back: same session, same key.
const session = { id: 's1', participants: [{ ...me, avatar: 'owl', avatarAt: 40 }] };

type Props = { canWrite: boolean };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// A pick answered by the route's own rule (server/routes/teamAvatarRoutes.js):
// the map it stores at `at`, or the stored one when it writes nothing.
const answerAsTheRoute = (stored: Team, at: number) =>
  async (memberId: string, avatar: string | null): Promise<Record<string, MemberAvatarChoice>> =>
    nextMemberAvatars(stored, memberId, avatar, at) ?? { ...(stored.memberAvatars ?? {}) };

// Whether the viewer has ever used the picker, for the one-time avatar hint
// (hasOwnAvatarChoice): the screens read it here, never off an entry.
describe('useOwnAvatar, whether the viewer has a choice', () => {
  const none = { ...team, memberAvatars: {} } as unknown as Team;
  const plain = { id: 's1', participants: [{ ...me }] };

  // "My initials" picked by someone who never chose is stored like any
  // choice, so every browser of the person reads it, and none shows the hint
  // again: it is decided at the screen's first render.
  it("turns true once a pick's answered map reaches the team, a first clear included, and is true in another browser", async () => {
    vi.spyOn(dataService, 'setMemberAvatar').mockImplementation(answerAsTheRoute(none, 300));
    let answered: Record<string, MemberAvatarChoice> = {};
    const view = renderHook((props: { team: Team }) => useOwnAvatar({
      session: plain, team: props.team, currentUser: me, updateSession: vi.fn(), canWrite: true,
      onTeamAvatars: (_teamId, map) => { answered = map; },
    }), { initialProps: { team: none } });
    expect(view.result.current.hasChoice).toBe(false);
    await act(async () => { await view.result.current.pick(null); });
    // App's part: the answered map on a new team object.
    view.rerender({ team: { ...none, memberAvatars: answered } as unknown as Team });
    expect(view.result.current.hasChoice).toBe(true);
    view.unmount();

    const elsewhere = renderHook(() => useOwnAvatar({
      session: plain, team: { ...none, memberAvatars: answered } as unknown as Team, currentUser: me, updateSession: vi.fn(), canWrite: true,
    }));
    expect(elsewhere.result.current.hasChoice).toBe(true);
    elsewhere.unmount();
  });

  it("is true for a pick made in another browser that reached the session's entry first", () => {
    const stamped = { id: 's1', participants: [{ ...me, avatar: 'cat', avatarAt: 300 }] };
    const { result } = renderHook(() => useOwnAvatar({
      session: stamped, team: none, currentUser: me, updateSession: vi.fn(), canWrite: true,
    }));
    expect(result.current.hasChoice).toBe(true);
  });
});

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

  // No own-change ledger slice guards the entry: the hook converges because a
  // state that brings the older entry back (the write lost its race and the
  // server's state healed it away) is written again.
  it('writes again when a heal brings the older entry back after it had agreed', () => {
    const updateSession = vi.fn(() => session);
    const agreed = { id: 's1', participants: [{ ...me, avatar: 'fox', avatarAt: 100 }] };
    const { rerender } = renderHook((props: { shown: typeof session }) => useOwnAvatar({ session: props.shown, team, currentUser: me, updateSession, canWrite: true }), {
      initialProps: { shown: session },
    });
    expect(updateSession).toHaveBeenCalledTimes(1);
    rerender({ shown: agreed });
    expect(updateSession).toHaveBeenCalledTimes(1);
    rerender({ shown: session });
    expect(updateSession).toHaveBeenCalledTimes(2);
    rerender({ shown: session });
    expect(updateSession).toHaveBeenCalledTimes(2);
  });

  // A screen that sends a write on entering whatever the session holds (the
  // retrospective's presence write) carries the entry in it: the hook leaves
  // the entry to that write, and writes it itself only afterwards.
  it('leaves the entry to the write the screen sends on entering, and writes once that write is behind', () => {
    const updateSession = vi.fn(() => session);
    let entering = true;
    const { rerender } = renderHook((props: { shown: typeof session }) => useOwnAvatar({
      session: props.shown, team, currentUser: me, updateSession, canWrite: true, entersWithAWrite: () => entering,
    }), { initialProps: { shown: session } });
    expect(updateSession).not.toHaveBeenCalled();

    // The entering write went out and the entry agrees: nothing was ever written here.
    entering = false;
    rerender({ shown: { id: 's1', participants: [{ ...me, avatar: 'fox', avatarAt: 100 }] } });
    expect(updateSession).not.toHaveBeenCalled();

    // That write lost its race: the older entry is back, and the hook writes it.
    rerender({ shown: session });
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  // The entering write was to carry the entry, and was dropped: the session
  // went offline between the render and that write. Back online, with that
  // write behind, the entry is this hook's to send.
  it('writes the entry once live again when the entering write it was left to never went out', () => {
    const updateSession = vi.fn(() => session);
    let entering = true;
    const { rerender } = renderHook((props: Props) => useOwnAvatar({
      session, team, currentUser: me, updateSession, canWrite: props.canWrite, entersWithAWrite: () => entering,
    }), { initialProps: { canWrite: true } });
    expect(updateSession).not.toHaveBeenCalled();
    // The screen's entering effect ran, and its write was dropped offline.
    entering = false;
    rerender({ canWrite: false });
    expect(updateSession).not.toHaveBeenCalled();
    rerender({ canWrite: true });
    expect(updateSession).toHaveBeenCalledTimes(1);
    rerender({ canWrite: true });
    expect(updateSession).toHaveBeenCalledTimes(1);
  });

  // A pick made in the session is stamped on it by the server right after the
  // route answers. The hook waits for that stamp; only if it has not come does
  // it write the entry itself.
  describe('after a pick made in the session', () => {
    const picked = { ada: { id: 'cat' as const, at: 300 } };
    const teamAfter = { ...team, memberAvatars: picked } as unknown as Team;

    const pickInSession = async () => {
      vi.useFakeTimers();
      vi.spyOn(dataService, 'setMemberAvatar').mockResolvedValue(picked);
      const updateSession = vi.fn(() => session);
      const current = { id: 's1', participants: [{ ...me, avatar: 'fox', avatarAt: 100 }] };
      const view = renderHook((props: { team: Team }) => useOwnAvatar({ session: current, team: props.team, currentUser: me, updateSession, canWrite: true }), {
        initialProps: { team },
      });
      expect(updateSession).not.toHaveBeenCalled();
      await act(async () => { await view.result.current.pick('cat'); });
      expect(dataService.setMemberAvatar).toHaveBeenCalledWith('ada', 'cat', 's1');
      // App's part: the answered map on a new team object.
      view.rerender({ team: teamAfter });
      return { ...view, updateSession };
    };

    it("waits for the server's stamp, and writes the entry itself once the wait is over", async () => {
      const { updateSession } = await pickInSession();
      expect(updateSession).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS - 1); });
      expect(updateSession).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(updateSession).toHaveBeenCalledTimes(1);
    });

    it('waits for the newest pick only: an older choice that the entry lacks is written at once', async () => {
      const { rerender, updateSession } = await pickInSession();
      // Another choice reaches this browser's copy of the team (a pick made elsewhere).
      rerender({ team: { ...team, memberAvatars: { ada: { id: 'owl', at: 900 } } } as unknown as Team });
      expect(updateSession).toHaveBeenCalledTimes(1);
    });

    // The connection drops while the stamp is waited for, and the stamp never
    // comes: the wait ends offline, where nothing is written, and the entry
    // goes out once, when the session is live again.
    it('writes the entry once, back online, when the wait ended while offline', async () => {
      vi.useFakeTimers();
      vi.spyOn(dataService, 'setMemberAvatar').mockResolvedValue(picked);
      const updateSession = vi.fn(() => session);
      const current = { id: 's1', participants: [{ ...me, avatar: 'fox', avatarAt: 100 }] };
      const view = renderHook((props: { team: Team; canWrite: boolean }) => useOwnAvatar({
        session: current, team: props.team, currentUser: me, updateSession, canWrite: props.canWrite,
      }), { initialProps: { team, canWrite: true } });
      await act(async () => { await view.result.current.pick('cat'); });
      view.rerender({ team: teamAfter, canWrite: true });
      expect(updateSession).not.toHaveBeenCalled();

      view.rerender({ team: teamAfter, canWrite: false });
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS * 2); });
      expect(updateSession).not.toHaveBeenCalled();

      view.rerender({ team: teamAfter, canWrite: true });
      expect(updateSession).toHaveBeenCalledTimes(1);
      view.rerender({ team: teamAfter, canWrite: true });
      expect(updateSession).toHaveBeenCalledTimes(1);
    });

    // Back online before the wait is over, the stamp is still on its way: the
    // hook goes on waiting, and writes only if it has not come.
    it('goes on waiting for the stamp after a reconnection inside the wait', async () => {
      vi.useFakeTimers();
      vi.spyOn(dataService, 'setMemberAvatar').mockResolvedValue(picked);
      const updateSession = vi.fn(() => session);
      const current = { id: 's1', participants: [{ ...me, avatar: 'fox', avatarAt: 100 }] };
      const view = renderHook((props: { team: Team; canWrite: boolean }) => useOwnAvatar({
        session: current, team: props.team, currentUser: me, updateSession, canWrite: props.canWrite,
      }), { initialProps: { team, canWrite: true } });
      await act(async () => { await view.result.current.pick('cat'); });
      view.rerender({ team: teamAfter, canWrite: false });
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS / 2); });
      view.rerender({ team: teamAfter, canWrite: true });
      expect(updateSession).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS / 2); });
      expect(updateSession).toHaveBeenCalledTimes(1);
    });

    it('leaves no timer behind when the screen goes during the wait', async () => {
      const { unmount, updateSession } = await pickInSession();
      unmount();
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS * 3); });
      expect(updateSession).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  // A participant entry is data every client of the session writes: another
  // client can plant a picture on the viewer's own entry before the viewer
  // ever chose. "My initials" then has to replace it like any choice, here
  // at once (drawn, and marked in the picker) and for the room through the
  // server's stamp, which is waited for. Read by the route as "nothing to
  // change", the clear stored nothing: the planted picture stayed drawn and
  // marked, and nothing was ever written over it.
  describe('after a first clear made in the session', () => {
    it('draws and marks the initials over a picture planted on the entry, and writes the entry once the wait is over', async () => {
      vi.useFakeTimers();
      const none = { ...team, memberAvatars: {} } as unknown as Team;
      const planted = { id: 's1', participants: [{ ...me, avatar: 'owl', avatarAt: 50 }] };
      vi.spyOn(dataService, 'setMemberAvatar').mockImplementation(answerAsTheRoute(none, 300));
      const updateSession = vi.fn<(updater: (s: typeof planted) => void) => unknown>(() => planted);
      let answered: Record<string, MemberAvatarChoice> = {};
      const view = renderHook((props: { team: Team }) => useOwnAvatar({
        session: planted, team: props.team, currentUser: me, updateSession, canWrite: true,
        onTeamAvatars: (_teamId, map) => { answered = map; },
      }), { initialProps: { team: none } });
      expect(view.result.current.avatarIdOf('ada')).toBe('owl');
      expect(view.result.current.currentChoice).toBe('owl');

      await act(async () => { await view.result.current.pick(null); });
      expect(dataService.setMemberAvatar).toHaveBeenCalledWith('ada', null, 's1');
      view.rerender({ team: { ...none, memberAvatars: answered } as unknown as Team });

      expect(view.result.current.avatarIdOf('ada')).toBeNull();
      expect(view.result.current.currentChoice).toBeNull();
      // The server stamps the session the clear was made in: its stamp is waited for.
      expect(updateSession).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(SERVER_STAMP_WAIT_MS); });
      expect(updateSession).toHaveBeenCalledTimes(1);
      const draft = structuredClone(planted);
      updateSession.mock.calls[0][0](draft);
      expect(draft.participants[0]).toMatchObject({ id: 'ada', avatar: null, avatarAt: 300 });

      view.unmount();
      act(() => { vi.runOnlyPendingTimers(); });
    });
  });
});
