import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemberAvatarChoice, Team, User } from '../../types';
import { dataService } from '../../services/dataService';
import {
  avatarChoiceTime,
  ownAvatarChoice,
  ownAvatarEntry,
  ownAvatarEntryTime,
  sessionAvatarOf,
  stampOwnAvatarEntry,
  type AvatarSessionView,
} from './sessionAvatars';

/**
 * How long a pick made in a session leaves the viewer's own entry to the
 * server (ms), which stamps it right after it answers the pick.
 */
export const SERVER_STAMP_WAIT_MS = 2000;

/** What both session screens hand the hook: the parts of their state the avatar rule reads. */
type AvatarSession = AvatarSessionView & { readonly id: string };

interface Options<S extends AvatarSession> {
  session: S | null;
  team: Team;
  currentUser: User;
  /** The screen's own write: an update goes out like any other change of the session. */
  updateSession: (updater: (session: S) => void) => unknown;
  /** False while the session reconnects or its credential was revoked: nothing is written then. */
  canWrite: boolean;
  /** Shows the map the server answered after a pick (App puts it on a new team object). */
  onTeamAvatars?: (teamId: string, memberAvatars: Record<string, MemberAvatarChoice>) => void;
  /**
   * True while the screen has yet to send the write it sends on entering
   * whatever the session holds (the retrospective's presence write). That
   * write carries the entry (the screen stamps every write), so the entry is
   * not written on its own beside it.
   */
  entersWithAWrite?: () => boolean;
}

/**
 * The avatar half both session screens share (AGENTS.md, *Avatars*):
 *
 * - `avatarIdOf(memberId)`: what to draw for a person, `sessionAvatarOf`,
 *   which answers null in an anonymous session.
 * - The own entry: the viewer's entry carries the team's newer choice. Each
 *   screen stamps it in its one write function (`stampOwnAvatarEntry`), so the
 *   write that enters a session carries it; where no write is on its way (the
 *   team's choice changed while in the session, a lost race healed back, a
 *   health check entered by someone it already lists) this hook sends one,
 *   through the screen's normal write, and only when `ownAvatarEntry` says the
 *   entry is older. No own-change ledger slice: the newer `at` wins
 *   everywhere, so two browsers of one person write the same value and a lost
 *   race is written again by the next state that still shows the older entry.
 *   A pick made here is left to the server, which stamps this session's entry
 *   right after answering: written at once, the entry left from the revision
 *   that stamp was about to move, and one of the two was refused on every
 *   pick. It is written here only if the stamp has not come in
 *   `SERVER_STAMP_WAIT_MS` (the server's is best effort).
 * - The picker: its open state, the choice it marks, and the pick, stored by
 *   `dataService.setMemberAvatar` with the session's id, so the server also
 *   stamps the live session's entry for the room.
 *
 * Nothing of it outlives the screen: the session unmounts on a sign-out, and
 * App applies the answered map only to the team still open.
 */
export function useOwnAvatar<S extends AvatarSession>({
  session,
  team,
  currentUser,
  updateSession,
  canWrite,
  onTeamAvatars,
  entersWithAWrite,
}: Options<S>) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const me = currentUser.id;

  const updateRef = useRef(updateSession);
  updateRef.current = updateSession;
  const teamRef = useRef(team);
  teamRef.current = team;
  const entersWithAWriteRef = useRef(entersWithAWrite);
  entersWithAWriteRef.current = entersWithAWrite;

  // The choice the server was asked to stamp on this session, while its stamp
  // is waited for. The wait ends with its timer, never by comparing clocks.
  const serverStamp = useRef<{ at: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [stampWaits, setStampWaits] = useState(0);
  useEffect(() => () => {
    if (serverStamp.current) clearTimeout(serverStamp.current.timer);
    serverStamp.current = null;
  }, []);

  // What the own entry is missing, as a key: the effect runs when it changes,
  // and the key goes back to null once the entry agrees, so a state that
  // brings the older entry back (a lost race healed) writes it again.
  const pending = ownAvatarEntry(session, team, me);
  const pendingKey = pending && session
    ? `${session.id}:${JSON.stringify(pending)}`
    : null;
  const pendingAt = ownAvatarEntryTime(session, team, me);
  // StrictMode runs an effect twice with the same key: the second must not
  // write an empty session update behind the first.
  const writtenKey = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingKey) {
      writtenKey.current = null;
      return;
    }
    // Offline, nothing is written, and a write tried just before is forgotten:
    // the screen may have dropped it (it reads its own live flag, which goes
    // false before this render's canWrite), so it goes out again once live.
    if (!canWrite) {
      writtenKey.current = null;
      return;
    }
    if (writtenKey.current === pendingKey) return;
    // The write the screen sends on entering is still to come, and carries it.
    if (entersWithAWriteRef.current?.()) return;
    // The server stamps a pick made here: its stamp is waited for (see above).
    if (serverStamp.current?.at === pendingAt) return;
    writtenKey.current = pendingKey;
    updateRef.current((draft) => {
      stampOwnAvatarEntry(draft, teamRef.current, me);
    });
    // `stampWaits` is not read: it runs this again when the wait for the
    // server's stamp ends.
  }, [pendingKey, pendingAt, canWrite, me, stampWaits]);

  const sessionId = session?.id;
  const pick = useCallback(async (avatarId: string | null) => {
    const teamId = teamRef.current.id;
    const map = await dataService.setMemberAvatar(me, avatarId, sessionId);
    const at = avatarChoiceTime(map, me);
    if (sessionId && at !== null) {
      if (serverStamp.current) clearTimeout(serverStamp.current.timer);
      const timer = setTimeout(() => {
        serverStamp.current = null;
        setStampWaits((count) => count + 1);
      }, SERVER_STAMP_WAIT_MS);
      serverStamp.current = { at, timer };
    }
    onTeamAvatars?.(teamId, map);
  }, [me, sessionId, onTeamAvatars]);

  const avatarIdOf = (memberId: string) => sessionAvatarOf(session, team, memberId);

  return {
    avatarIdOf,
    pickerOpen,
    openPicker: useCallback(() => setPickerOpen(true), []),
    closePicker: useCallback(() => setPickerOpen(false), []),
    /** The stored choice the picker marks (an id the release may not draw included). */
    currentChoice: ownAvatarChoice(session, team, me),
    pick,
  };
}
