// Which avatar a session shows for a person, and what the viewer's own client
// writes on entering a session. The one place in components/ that reads an
// avatar off a participant entry or a team: __tests__/avatarSource.test.ts
// refuses a read anywhere else, so an anonymous session can never leak one.
//
// The truth is the team's `memberAvatars` (`{ id, at }`, the server's time of
// the choice); each session copy carries the person's entry `avatar` and
// `avatarAt`, written by their own client only. The newer `at` wins, so a
// browser holding an old copy of the team never puts an older choice back.
// Values are copied as stored and passed through `toAvatarId` only to draw:
// a tab that does not know an id a newer release stored must not erase it.

import type { Team, User } from '../../types';
import { memberAvatar, memberAvatarId, toAvatarId } from '../../utils/avatars.js';

/** What the rule reads of a session: the same fields on a retrospective and a health check. */
export interface AvatarSessionView {
  readonly isAnonymous?: boolean;
  readonly participants?: readonly User[];
}

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

/**
 * The avatar id to draw for `memberId` in `session`, or null for initials.
 * An anonymous session shows none: a picture beside a card says who wrote it.
 * An entry that states an avatar (`null` included) wins over the team's
 * choice; without one, the team's. Outside a session, read `memberAvatarId`.
 */
export const sessionAvatarOf = (session: MaybeSession, team: MaybeTeam, memberId: string): string | null => {
  if (session?.isAnonymous) return null;
  const entry = entryOf(session, memberId);
  if (entry && Object.prototype.hasOwnProperty.call(entry, 'avatar')) return toAvatarId(entry.avatar);
  return memberAvatarId(team, memberId);
};

/** An entry's `avatarAt`, or 0 when it never stated one (or stored something that is not a time). */
const entryTime = (entry: User): number => {
  const at: unknown = entry.avatarAt;
  return typeof at === 'number' && Number.isFinite(at) ? at : 0;
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
