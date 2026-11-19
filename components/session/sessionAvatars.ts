// Which avatar a session shows for a person, and what the viewer's own client
// writes on entering a session. The one place in components/ that reads an
// avatar off a participant entry or a team: __tests__/avatarSource.test.ts
// refuses a read anywhere else, so an anonymous session can never leak one.
//
// The truth is the team's `memberAvatars` (`{ id, at }`, the server's time of
// the choice); each session copy carries the person's entry `avatar` and
// `avatarAt`, written by their own client and by the avatar route's stamp of
// the session a pick was made in. The newer `at` wins, so a browser holding
// an old copy of the team never puts an older choice back. (The participant
// list is data every client of the session can write: what an entry says is
// drawn only through `toAvatarId`, and never reaches the team's map.)
// Values are copied as stored and passed through `toAvatarId` only to draw:
// a tab that does not know an id a newer release stored must not erase it.

import type { Team, User } from '../../types';
import { memberAvatar, memberAvatarId, toAvatarId } from '../../utils/avatars.js';

/** What the rule reads of a session: the same fields on a retrospective and a health check. */
export interface AvatarSessionView {
  readonly isAnonymous?: boolean;
  /** Where both stored session types keep the flag. */
  readonly settings?: { readonly isAnonymous?: boolean } | null;
  readonly participants?: readonly User[];
}

/** Anonymous by either spelling: the stored sessions say it under `settings`. */
const isAnonymousSession = (session: MaybeSession): boolean =>
  !!session && (session.isAnonymous === true || session.settings?.isAnonymous === true);

type MaybeSession = AvatarSessionView | null | undefined;
type MaybeTeam = Pick<Team, 'memberAvatars'> | null | undefined;

/** The person's own participant entry, or null. Participants are data any client writes. */
const entryOf = (session: MaybeSession, memberId: string): User | null => {
  const participants: unknown = session?.participants;
  if (!Array.isArray(participants)) return null;
  const entry: unknown = participants.find(
    (candidate: unknown) => !!candidate && typeof candidate === 'object' && (candidate as User).id === memberId
  );
  return (entry as User | undefined) ?? null;
};

/** An entry's `avatarAt`, or 0 when it never stated one (or stored something that is not a time). */
const entryTime = (entry: User): number => {
  const at: unknown = entry.avatarAt;
  return typeof at === 'number' && Number.isFinite(at) ? at : 0;
};

/**
 * The avatar id to draw for `memberId` in `session`, or null for initials.
 * An anonymous session shows none: a picture beside a card says who wrote it.
 * An entry that states an avatar (`null` included) wins over the team's
 * choice when it is at least as new; otherwise, or without one, the team's: a
 * pick made outside the session stamps no entry, and a viewer whose copy of
 * the team holds it must not draw the older picture. Outside a session, read
 * `memberAvatarId`.
 */
export const sessionAvatarOf = (session: MaybeSession, team: MaybeTeam, memberId: string): string | null => {
  if (isAnonymousSession(session)) return null;
  const entry = entryOf(session, memberId);
  if (
    entry &&
    Object.prototype.hasOwnProperty.call(entry, 'avatar') &&
    entryTime(entry) >= (memberAvatar(team, memberId)?.at ?? 0)
  ) {
    return toAvatarId(entry.avatar);
  }
  return memberAvatarId(team, memberId);
};

/**
 * What the viewer's client writes for itself on entering `session`: a copy of
 * its own entry carrying the team's newer choice, or null when its entry is as
 * new (or there is no entry, or no choice). It never builds another person's
 * entry and never mutates what it is given. Written in an anonymous session
 * too, where `sessionAvatarOf` hides it: the choice is there when the session
 * names its authors again.
 */
export const ownAvatarEntry = (session: MaybeSession, team: MaybeTeam, memberId: string): User | null => {
  const choice = memberAvatar(team, memberId);
  if (!choice) return null;
  const entry = entryOf(session, memberId);
  if (!entry || entryTime(entry) >= choice.at) return null;
  return { ...entry, avatar: choice.id, avatarAt: choice.at };
};

/**
 * Puts the viewer's own entry of `draft`, a state about to be written, on the
 * team's newer choice, and answers whether it changed anything. Both session
 * screens call it in their one write function, so the write that adds a person
 * to a session already carries their avatar: sent in a write of its own right
 * behind, the avatar left from the same revision as that write, and the server
 * refused one of the two. A copy takes the entry's place, so an object the
 * entry shares with the screen (the viewer's own user, a cached member row)
 * never gains an avatar.
 */
export const stampOwnAvatarEntry = (draft: MaybeSession, team: MaybeTeam, memberId: string): boolean => {
  const entry = ownAvatarEntry(draft, team, memberId);
  const participants: unknown = draft?.participants;
  if (!entry || !Array.isArray(participants)) return false;
  const index = participants.findIndex(
    (candidate: unknown) => !!candidate && typeof candidate === 'object' && (candidate as User).id === memberId
  );
  if (index < 0) return false;
  // The draft is the caller's own copy, about to be sent: its list is written in place.
  (participants as User[])[index] = entry;
  return true;
};

/** When `memberId`'s choice in `memberAvatars` (a map the server answered) was made, or null without one. */
export const avatarChoiceTime = (
  memberAvatars: Team['memberAvatars'] | null | undefined,
  memberId: string
): number | null => memberAvatar({ memberAvatars: memberAvatars ?? undefined }, memberId)?.at ?? null;

/** What `stampOwnAvatarEntry` would write for the viewer: the time of the choice their entry lacks, or null. */
export const ownAvatarEntryTime = (session: MaybeSession, team: MaybeTeam, memberId: string): number | null => {
  const entry = ownAvatarEntry(session, team, memberId);
  return entry ? entryTime(entry) : null;
};

/**
 * `entry` without an avatar of its own, for a participant entry that passes to
 * another id (someone back under a new id, matched by name): an avatar is a
 * member's choice, kept under their id, and the person who takes the entry
 * over may be someone else of the same name.
 */
export const withoutAvatar = (entry: User): User => {
  if (!Object.prototype.hasOwnProperty.call(entry, 'avatar') && !Object.prototype.hasOwnProperty.call(entry, 'avatarAt')) return entry;
  const copy: User = { ...entry };
  delete copy.avatar;
  delete copy.avatarAt;
  return copy;
};

/**
 * The viewer's own choice as it is stored (an id, or null for initials), for
 * the picker to mark: the newer of the team's map and the viewer's own entry
 * in `session`, which a pick made in another browser reaches first (the
 * server stamps the entry of the session it was made in). Not hidden in an
 * anonymous session: it is the viewer's own, shown to the viewer only.
 */
export const ownAvatarChoice = (session: MaybeSession, team: MaybeTeam, memberId: string): string | null => {
  const choice = memberAvatar(team, memberId);
  const entry = entryOf(session, memberId);
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'avatar') && entryTime(entry) > (choice?.at ?? 0)) {
    return typeof entry.avatar === 'string' ? entry.avatar : null;
  }
  return choice?.id ?? null;
};

/** The initials every screen draws for the viewer's own avatar. */
export const viewerInitials = (user: Pick<User, 'name'>): string => user.name.substring(0, 2).toUpperCase();
