import type { User } from '../../types';
import { PARTICIPANT_PALETTE } from '../../utils/participantColors';
import { withoutAvatar } from './sessionAvatars';

/**
 * Folding the server's live roster (`member-roster`) into a session's
 * participant list — one rule for the retrospective and the health check.
 *
 * Incident ISS (2026-10-12): both screens wrote the whole session on every
 * roster event, whether or not it named anyone new, and the retro's copy did so
 * by renaming the current state's participant objects in place. The server
 * rebroadcasts the roster on every join and leave, so a room reconnecting after
 * a rolling update sent one write of nothing per socket — each a revision bump,
 * a database write and a broadcast, and each a race the participants' real
 * writes then had to win. A roster that changes nothing now writes nothing.
 */

/** Fallback colours for a participant the team record does not know: the one palette. */
export const PARTICIPANT_COLOR_POOL = PARTICIPANT_PALETTE;

export interface RosterEntry {
  id: string;
  name: string;
}

// Names are matched trimmed and case-insensitively, the same rule the screens'
// participant list deduplicates on — but only once the id has found nobody,
// and never between two known team members (see the loop below).
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * Whether an entry of a participant list, or of a roster, stands for a
 * person: an object with a string id and a string name. Every client writes
 * the participant list and the server stores its entries as they come: an
 * entry that is anything else made both session screens throw for everyone in
 * the room. The server builds the roster from what each client sent when it
 * joined, keeping only an entry whose id and name are set, so a roster entry
 * is an object whose name may still be something other than a string, which
 * made the roster merge throw. Everything below ignores such an entry.
 */
const isPerson = (entry: unknown): boolean => {
  if (typeof entry !== 'object' || entry === null) return false;
  const { id, name } = entry as { id?: unknown; name?: unknown };
  return typeof id === 'string' && typeof name === 'string';
};

/**
 * The people a stored participant list holds: its entries that are people
 * (`isPerson`), in their order; a value that is not a list holds nobody.
 * Both session screens read every session they take in through it — the one
 * they open with, each one the server sends, and the copy each write starts
 * from — so nothing they draw or write reads an entry that is not a person,
 * and their next write leaves such an entry out of the stored list
 * (`__tests__/sessionParticipantsNotPeople.test.tsx`).
 */
export const listedPeople = (participants: unknown): User[] =>
  Array.isArray(participants) ? participants.filter(isPerson) : [];

/**
 * The people a session screen lists: the session's participants, the viewer
 * added when the session does not list them yet, each id once and each name
 * once (matched as above; the first one listed wins). Both session screens
 * list their people with it, as their `getParticipants`, and build the list
 * nowhere else (`__tests__/sessionParticipantsShared.test.ts`). The board
 * finds a card's author in it, and so does the Discuss topic the card becomes
 * (`utils/cardHue.ts`), so both paint the card alike. Every client writes the
 * participant list, so it reads that list through `listedPeople`: a value
 * that is not a list reads as nobody, and an entry that is not a person is
 * skipped. Never mutates what it was given.
 */
export const sessionParticipants = (participants: readonly User[] | undefined, viewer: User): User[] => {
  const listedNow = listedPeople(participants);
  const roster = listedNow.some(p => p.id === viewer.id) ? listedNow : [...listedNow, viewer];
  const listed: User[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const person of roster) {
    const key = nameKey(person.name);
    if (ids.has(person.id) || names.has(key)) continue;
    ids.add(person.id);
    names.add(key);
    listed.push(person);
  }
  return listed;
};

/**
 * The participant list with the roster folded in, or `null` when the roster
 * changes nothing — the caller then must not write.
 *
 * A roster entry matching a listed participant (by id, or else by name) makes that
 * participant adopt the roster's id and name (and, under a new id, lose the
 * avatar the row carried); one matching nobody is added with
 * the colour and role the team record gives them. Nobody is ever removed: the
 * roster is who is connected now, the participant list is who took part.
 * An entry of either list that is not a person (`isPerson`) is ignored: one
 * of the participant list stays where it is, matched against nobody, and one
 * of the roster adds nobody.
 *
 * Never mutates `participants` or its entries — they belong to the state React
 * is rendering. A changed entry is a new object; an unchanged one is reused.
 */
export const mergeRosterIntoParticipants = (
  participants: readonly User[],
  roster: readonly RosterEntry[],
  teamMembers: readonly User[]
): User[] | null => {
  const next = [...participants];
  let changed = false;
  let nextColorIndex = participants.filter(isPerson).length;

  const isTeamMember = (id: string) => teamMembers.some(m => m.id === id);

  for (const entry of roster) {
    if (!isPerson(entry)) continue;
    const key = nameKey(entry.name);
    // The id decides. The name is only a fallback for one person who came back
    // under a new id (another device, a fresh invite link), never a way to merge
    // two known team members whose names only differ in case (Codex, PR #507).
    let index = next.findIndex(p => isPerson(p) && p.id === entry.id);
    if (index === -1) {
      index = next.findIndex(p =>
        isPerson(p) && nameKey(p.name) === key && !(isTeamMember(p.id) && isTeamMember(entry.id))
      );
    }

    if (index !== -1) {
      const known = next[index];
      if (known.id !== entry.id || known.name !== entry.name) {
        // A row that passes to another id leaves its avatar behind: the
        // picture is the choice of the member whose id it was (the team's
        // map), and a row matched by name may be someone else's.
        const row = known.id !== entry.id ? withoutAvatar(known) : known;
        next[index] = { ...row, id: entry.id, name: entry.name };
        changed = true;
      }
      continue;
    }

    const member = teamMembers.find(m => m.id === entry.id) ?? teamMembers.find(m => nameKey(m.name) === key);
    next.push({
      id: entry.id,
      name: entry.name,
      color: member?.color || PARTICIPANT_COLOR_POOL[nextColorIndex % PARTICIPANT_COLOR_POOL.length],
      role: member?.role || 'participant',
    });
    nextColorIndex++;
    changed = true;
  }

  return changed ? next : null;
};

/** What a `member-joined` changes on the session; only the changed fields are set. */
export interface MemberJoinedChange {
  participants?: User[];
  leftUsers?: string[];
}

/**
 * What a `member-joined` changes, or `null` when it changes nothing — the
 * caller then must not write. The joiner is folded into the participant list
 * by the roster rule above (a roster of one), and loses their "has left" mark:
 * someone who reconnects is back, and the counters wait for them again. Both
 * changes go out as one write.
 *
 * Review finding D on the incident ISS branch: both screens subscribed to the
 * event once, at mount, and their handler read the session they were mounted
 * with. Anyone who joined after that looked missing for good, so every join
 * and every reconnect wrote the whole session again — the same write of
 * nothing the roster used to send. Callers pass the state being rendered now,
 * never one captured in a closure.
 *
 * Never mutates `state`.
 */
export const memberJoinedChange = (
  state: { participants?: readonly User[]; leftUsers?: readonly string[] } | null | undefined,
  joiner: RosterEntry,
  teamMembers: readonly User[]
): MemberJoinedChange | null => {
  const participants = mergeRosterIntoParticipants(state?.participants ?? [], [joiner], teamMembers);
  const leftUsers = state?.leftUsers?.includes(joiner.id)
    ? state.leftUsers.filter(id => id !== joiner.id)
    : null;
  if (!participants && !leftUsers) return null;

  const change: MemberJoinedChange = {};
  if (participants) change.participants = participants;
  if (leftUsers) change.leftUsers = leftUsers;
  return change;
};
