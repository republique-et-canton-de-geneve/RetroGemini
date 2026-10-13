import type { User } from '../../types';

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

/** Fallback colours for a participant the team record does not know. */
export const PARTICIPANT_COLOR_POOL = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
  'bg-pink-500',
] as const;

export interface RosterEntry {
  id: string;
  name: string;
}

// Names are matched trimmed and case-insensitively, the same rule the screens'
// participant list deduplicates on — but only once the id has found nobody,
// and never between two known team members (see the loop below).
const nameKey = (name: string) => name.trim().toLowerCase();

/**
 * The participant list with the roster folded in, or `null` when the roster
 * changes nothing — the caller then must not write.
 *
 * A roster entry matching a listed participant (by id, or else by name) makes that
 * participant adopt the roster's id and name; one matching nobody is added with
 * the colour and role the team record gives them. Nobody is ever removed: the
 * roster is who is connected now, the participant list is who took part.
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
  let nextColorIndex = participants.length;

  const isTeamMember = (id: string) => teamMembers.some(m => m.id === id);

  for (const entry of roster) {
    const key = nameKey(entry.name);
    // The id decides. The name is only a fallback for one person who came back
    // under a new id (another device, a fresh invite link), never a way to merge
    // two known team members whose names only differ in case (Codex, PR #507).
    let index = next.findIndex(p => p.id === entry.id);
    if (index === -1) {
      index = next.findIndex(p =>
        nameKey(p.name) === key && !(isTeamMember(p.id) && isTeamMember(entry.id))
      );
    }

    if (index !== -1) {
      const known = next[index];
      if (known.id !== entry.id || known.name !== entry.name) {
        next[index] = { ...known, id: entry.id, name: entry.name };
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
