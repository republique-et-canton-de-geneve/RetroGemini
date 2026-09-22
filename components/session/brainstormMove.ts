/**
 * Moving cards between columns during **Brainstorm** — the rules.
 *
 * `utils/brainstormColumnMove.ts` performs the move on a session; this decides
 * **who may move what**, what activating a target means, and what each target
 * announces. `Session.tsx` only performs what these functions resolve, exactly
 * as it does for `groupingKeyboard.ts` in the Group phase.
 *
 * Two rules carry the feature:
 *
 * - **You can only move a card you can read.** While "Reveal cards" is off
 *   every other author's card is blurred, so moving one would mean dragging a
 *   card whose content you cannot see into a column you chose for it — a
 *   change to someone else's idea, made blind. Turning the reveal on makes the
 *   board a shared artefact again and every card movable by everyone, which is
 *   the same line the phase already draws for reading.
 * - **A group moves whole, or not at all.** Grouping happens in the Group
 *   phase; coming back to Brainstorm afterwards must not become a second way to
 *   edit a group's composition. So a grouped card has no move control of its
 *   own, and the group carries all of its cards to the new column at once.
 *
 * Pointer users drag; everyone else uses the same select-then-move flow the
 * Group phase already has (pick a card up, then choose a column). Adding a drag
 * without the pointerless path is what made the Group phase unreachable for
 * keyboard users (audit H42) — the two ship together here.
 */

export type BrainstormMovableKind = 'ticket' | 'group';

/** What is currently held, by pointer, touch or keyboard. */
export interface BrainstormSelection {
  kind: BrainstormMovableKind;
  id: string;
}

export interface TicketMoveContext {
  /** The card being considered. */
  ticket: { authorId: string; groupId?: string | null };
  currentUserId: string;
  /** `settings.revealBrainstorm` — whether every card is readable by everyone. */
  revealBrainstorm: boolean;
}

/**
 * May this user move this single card? Only when it is not in a group (groups
 * move as a unit) and its content is readable — their own card always is.
 */
export const canMoveTicketInBrainstorm = ({
  ticket,
  currentUserId,
  revealBrainstorm
}: TicketMoveContext): boolean => {
  if (ticket.groupId) return false;
  return revealBrainstorm || ticket.authorId === currentUserId;
};

export interface GroupMoveContext {
  /** The cards inside the group. */
  members: { authorId: string }[];
  currentUserId: string;
  revealBrainstorm: boolean;
}

/**
 * May this user move this group? Same readability rule applied to the whole
 * group: while cards are hidden, only a group made entirely of this user's own
 * cards is theirs to move. An empty group is not movable — there is nothing to
 * move and nothing to read.
 */
export const canMoveGroupInBrainstorm = ({
  members,
  currentUserId,
  revealBrainstorm
}: GroupMoveContext): boolean => {
  if (members.length === 0) return false;
  if (revealBrainstorm) return true;
  return members.every((m) => m.authorId === currentUserId);
};

/** What activating a target means for the move flow. */
export type BrainstormMoveAction =
  /** Nothing to do. */
  | 'none'
  /** Pick this card (or group) up, so the next column chosen receives it. */
  | 'pick-up'
  /** Put the held item back down, changing nothing. */
  | 'cancel'
  /** Move the held item into this column. */
  | 'move';

export interface BrainstormMoveActivationContext {
  /** Cards are only moved this way in the Brainstorm phase. */
  isBrainstormPhase: boolean;
  /** A card or group is currently held. */
  hasSelection: boolean;
  /** This target is the held item itself. */
  isSelected: boolean;
  /** Cards and groups start a selection; columns only receive one. */
  target: 'item' | 'column';
  /** This user may move this item (see the two rules above). */
  canPickUp: boolean;
}

export const resolveBrainstormMoveActivation = ({
  isBrainstormPhase,
  hasSelection,
  isSelected,
  target,
  canPickUp
}: BrainstormMoveActivationContext): BrainstormMoveAction => {
  if (!isBrainstormPhase) return 'none';
  if (isSelected) return 'cancel';
  if (target === 'column') return hasSelection ? 'move' : 'none';
  // Only a column receives a held item: a card dropped on another card here
  // would be grouping, which is the Group phase's job, not this one's.
  if (hasSelection) return 'none';
  return canPickUp ? 'pick-up' : 'none';
};

export interface BrainstormMoveLabelContext {
  /** The card text, the group title, or the column title. */
  name: string;
  kind: BrainstormMovableKind | 'column';
  /** What is held right now, if anything. */
  heldKind: BrainstormMovableKind | null;
  /** This target is the held item itself. */
  isSelected: boolean;
}

const FALLBACK_NAME: Record<BrainstormMoveLabelContext['kind'], string> = {
  ticket: 'Untitled card',
  group: 'Untitled group',
  column: 'Untitled column'
};

const HELD_NOUN: Record<BrainstormMovableKind, string> = {
  ticket: 'card',
  group: 'group'
};

/**
 * What the target announces. Once something is held every column describes the
 * **pending move** rather than itself — the question being answered while
 * tabbing is "what happens if I confirm here", not "what is this".
 */
export const getBrainstormMoveAriaLabel = ({
  name,
  kind,
  heldKind,
  isSelected
}: BrainstormMoveLabelContext): string => {
  const label = name.trim() || FALLBACK_NAME[kind];

  if (isSelected) {
    return `Selected to move: ${label}. Activate or press Escape to cancel.`;
  }

  if (kind === 'column') {
    return `Move the selected ${HELD_NOUN[heldKind ?? 'ticket']} to ${label}.`;
  }

  return `Move the ${kind === 'group' ? 'group' : 'card'} ${label} to another column.`;
};

/** The few words shown on the control, kept beside the accessible name. */
export const getBrainstormMoveButtonText = ({
  target,
  isSelected
}: Pick<BrainstormMoveActivationContext, 'target' | 'isSelected'>): string => {
  if (isSelected) return 'Cancel';
  return target === 'column' ? 'Move here' : 'Move';
};
