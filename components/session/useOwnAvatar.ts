import { useCallback, useEffect, useRef, useState } from 'react';
import type { MemberAvatarChoice, Team, User } from '../../types';
import { dataService } from '../../services/dataService';
import { ownAvatarChoice, ownAvatarEntry, sessionAvatarOf, type AvatarSessionView } from './sessionAvatars';

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
}

/**
 * The avatar half both session screens share (PLAN 18.1):
 *
 * - `avatarIdOf(memberId)`: what to draw for a person, `sessionAvatarOf`,
 *   which answers null in an anonymous session.
 * - The own entry: on entering a session, and whenever the team's choice or
 *   the entry changes while in it, the viewer's client writes a copy of its
 *   own entry carrying the team's newer choice, once, through the screen's
 *   normal write, and only when `ownAvatarEntry` says the entry is older. No
 *   own-change ledger slice: the newer `at` wins everywhere, so two browsers
 *   of one person write the same value and a lost race is written again by
 *   the next state that still shows the older entry.
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
}: Options<S>) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const me = currentUser.id;

  const updateRef = useRef(updateSession);
  updateRef.current = updateSession;
  const teamRef = useRef(team);
  teamRef.current = team;

  // What the own entry is missing, as a key: the effect runs when it changes,
  // and the key goes back to null once the entry agrees, so a state that
  // brings the older entry back (a lost race healed) writes it again.
  const pending = ownAvatarEntry(session, team, me);
  const pendingKey = pending && session
    ? `${session.id}:${JSON.stringify(pending)}`
    : null;
  // StrictMode runs an effect twice with the same key: the second must not
  // write an empty session update behind the first.
  const writtenKey = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingKey) {
      writtenKey.current = null;
      return;
    }
    if (!canWrite || writtenKey.current === pendingKey) return;
    writtenKey.current = pendingKey;
    updateRef.current((draft) => {
      const entry = ownAvatarEntry(draft, teamRef.current, me);
      const participants = draft.participants as User[] | undefined;
      if (!entry || !participants) return;
      const index = participants.findIndex((participant) => participant?.id === me);
      // A copy replaces the entry: the cached member row it may share with
      // never gains an avatar field.
      if (index >= 0) participants[index] = entry;
    });
  }, [pendingKey, canWrite, me]);

  const sessionId = session?.id;
  const pick = useCallback(async (avatarId: string | null) => {
    const teamId = teamRef.current.id;
    const map = await dataService.setMemberAvatar(me, avatarId, sessionId);
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
