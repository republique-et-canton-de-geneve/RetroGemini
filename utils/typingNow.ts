import type { ParticipantActivity } from '../types';
import { OPEN_BOARD_PHASE } from './openBoard';
import { toParticipantActivity } from './participantActivity.js';

/**
 * Who the participants panel says is typing, so that a long list need not be
 * scrolled to see it. "Typing" is what `participant-activity` says: a focused
 * field holding a draft (a card in Brainstorm and on an open board, a proposal in
 * Discuss). The signal comes from other clients, so every rule here reads it as data.
 */

/** Cards in Brainstorm and on an open board, proposals in Discuss, `null` everywhere else:
 *  a cue left over from the phase before (the receiver keeps one up to 4 s) is never drawn. */
export const typingKindForPhase = (phase: string | undefined): ParticipantActivity | null => {
  if (phase === 'BRAINSTORM' || phase === OPEN_BOARD_PHASE) return 'brainstorm';
  if (phase === 'DISCUSS') return 'proposal';
  return null;
};

/** The signal `userId` is sending: the map's own entry only, and only a kind this release draws. */
export const activityOf = (
  activityUsers: Readonly<Record<string, unknown>> | undefined,
  userId: string,
): ParticipantActivity | null =>
  activityUsers && Object.prototype.hasOwnProperty.call(activityUsers, userId)
    ? toParticipantActivity(activityUsers[userId])
    : null;

/**
 * The people the panel lists who are typing `kind`, in the list's order (never
 * the order the signals came in), never the reader, never anyone marked as having
 * left. The rows draw their cue for exactly these people, so the line's count and
 * the rows cannot disagree.
 */
export const typingMembers = <T extends { id: string }>(
  participants: readonly T[],
  activityUsers: Readonly<Record<string, unknown>> | undefined,
  options: { kind: ParticipantActivity | null; currentUserId: string; leftUserIds?: readonly string[] },
): T[] => {
  const { kind, currentUserId, leftUserIds = [] } = options;
  if (kind === null) return [];
  return participants.filter((member) =>
    member.id !== currentUserId
    && !leftUserIds.includes(member.id)
    && activityOf(activityUsers, member.id) === kind);
};

/** How many names the line gives before it counts the rest. */
export const TYPING_NAMES_SHOWN = 3;

/** Every name up to `max`; past it, the first `max - 1` and how many others, so the
 *  line never says "and 1 other" where that one name would fit. */
export const splitTypingNames = (
  names: readonly string[],
  max = TYPING_NAMES_SHOWN,
): { shown: string[]; others: number } =>
  names.length <= max
    ? { shown: [...names], others: 0 }
    : { shown: names.slice(0, max - 1), others: names.length - (max - 1) };

/** `items` joined the reader's way ("Alice, Bob, and 2 others" in en-US, "Alice, Bob
 *  et 2 autres" in French); commas on a locale Intl refuses, since a throw while
 *  rendering blanks the screen (there is no error boundary). */
export const joinNames = (items: readonly string[], locale: string): string => {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
};
