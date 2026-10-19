import { ActionItem } from '../../types';

/**
 * The number each action proposal of one discussed topic is shown with, so a
 * participant can say "about proposal 5" instead of reading the text aloud.
 *
 * Shared by the retro and the health check Discuss phases. The number is
 * derived, never stored: it is the position among the topic's proposals in
 * `session.actions` order, which every client holds identically, so two people
 * proposing at the same moment cannot claim the same number the way a stored
 * counter would.
 *
 * Accepted (`type: 'new'`) and rejected rows keep their place in the count, so
 * deciding on proposal 2 never renumbers proposals 3 to 7 while the room is
 * talking about them. Deleting one does shift the ones after it; that is the
 * cost of not storing the number, and a facilitator-only action.
 */
export const numberTopicProposals = (
  actions: ActionItem[],
  belongsToTopic: (linkedTicketId: string) => boolean
): Map<string, number> => {
  const numbers = new Map<string, number>();
  for (const action of actions) {
    if (action.linkedTicketId == null || !belongsToTopic(action.linkedTicketId)) continue;
    if (action.type !== 'proposal' && action.type !== 'new') continue;
    numbers.set(action.id, numbers.size + 1);
  }
  return numbers;
};
