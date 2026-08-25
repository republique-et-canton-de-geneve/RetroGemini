/**
 * Keyboard access to the Group phase.
 *
 * The Group phase used to be pointer-only (H42, WCAG 2.1.1) — a core phase of
 * the product that a keyboard or switch user simply could not perform. The card
 * was a `div` with `draggable="true"`, `tabIndex: -1`, no role and no key
 * handler, so a tab walk never reached it.
 *
 * **This does not invent a second interaction model.** `Session.tsx` already
 * carries a pointerless one for touch: tap a card to pick it up, tap a second
 * card, a group or a column to drop it there. The keyboard reuses that exact
 * state machine (`draggedTicket` + `isTouchDragging`), so there is one flow to
 * reason about, one set of on-screen affordances, and no new way for the two to
 * disagree. Extracted from `Session.tsx` because these rules are easy to break
 * by accident and a 2 600-line component is not where they can be asserted.
 */

/** What a key press means for the grouping flow. */
export type GroupingKeyAction =
  /** Not our key, or nothing to do — let the event through. */
  | 'none'
  /** Pick this card up, so the next confirmed target groups it. */
  | 'pick-up'
  /** Put the held card back down, changing nothing. */
  | 'cancel'
  /** Group the held card into this target. */
  | 'drop';

export interface GroupingKeyContext {
  /** `KeyboardEvent.key`. */
  key: string;
  /** Cards are only regrouped in the Group phase. */
  isGroupPhase: boolean;
  /** A card is currently held, by touch or by keyboard. */
  hasSelection: boolean;
  /** This element is the held card itself. */
  isSelected: boolean;
  /** Ticket cards can start a selection; groups and columns only receive one. */
  canPickUp: boolean;
  /**
   * The key reached the card itself rather than a control inside it. The card
   * holds an edit textarea, an emoji button and a delete button, and Enter in
   * any of those belongs to that control.
   */
  isEventOnSelf: boolean;
}

/** `' '` is the modern spelling; `'Spacebar'` is what older engines send. */
const CONFIRM_KEYS = new Set(['Enter', ' ', 'Spacebar']);

export const resolveGroupingKey = ({
  key,
  isGroupPhase,
  hasSelection,
  isSelected,
  canPickUp,
  isEventOnSelf
}: GroupingKeyContext): GroupingKeyAction => {
  if (!isGroupPhase || !isEventOnSelf) return 'none';

  if (key === 'Escape') {
    // Only claim Escape when there is something to cancel: swallowing it
    // otherwise would stop an enclosing dialog from closing.
    return hasSelection ? 'cancel' : 'none';
  }

  if (!CONFIRM_KEYS.has(key)) return 'none';

  if (isSelected) return 'cancel';
  if (hasSelection) return 'drop';
  return canPickUp ? 'pick-up' : 'none';
};

export interface GroupingLabelContext {
  /** The ticket text, the group title, or the column title. */
  name: string;
  kind: 'ticket' | 'group' | 'column';
  /** A card is currently held. */
  hasSelection: boolean;
  /** This element is the held card itself. */
  isSelected: boolean;
}

const FALLBACK_NAME: Record<GroupingLabelContext['kind'], string> = {
  ticket: 'Untitled ticket',
  group: 'Untitled group',
  column: 'Untitled column'
};

/**
 * What the target announces. Once a card is held every target describes the
 * **pending action** rather than itself, because that is the question the user
 * is answering while tabbing: not "what is this", but "what happens if I
 * confirm here".
 */
export const getGroupingAriaLabel = ({
  name,
  kind,
  hasSelection,
  isSelected
}: GroupingLabelContext): string => {
  const label = name.trim() || FALLBACK_NAME[kind];

  if (isSelected) {
    return `Selected for grouping: ${label}. Press Enter or Escape to cancel.`;
  }

  if (hasSelection) {
    switch (kind) {
      case 'ticket':
        return `Group the selected ticket with ${label}. Press Enter to confirm.`;
      case 'group':
        return `Add the selected ticket to the group ${label}. Press Enter to confirm.`;
      case 'column':
        return `Move the selected ticket out of its group, into ${label}. Press Enter to confirm.`;
    }
  }

  return `Ticket: ${label}. Press Enter to pick it up for grouping.`;
};
