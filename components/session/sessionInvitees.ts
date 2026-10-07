import { SessionInvitee, User } from '../../types';

/**
 * Teammates invited by email from a session — a retrospective or a health
 * check, which share the invite modal and the participants panel. They are
 * stored on the session so every participant's panel can list who is still
 * expected, until each one actually connects.
 */

/**
 * The session's invitee list after an invite round. Additive on purpose: an
 * invitee already listed keeps their first invitation date, and nobody is ever
 * removed — the merge relies on that (see `restoreLostInvitees`).
 */
export const recordInvitees = (
  existing: SessionInvitee[] | undefined,
  invitees: { id: string; name: string; email: string }[],
  invitedAt: string
): SessionInvitee[] => {
  const known = new Map((existing ?? []).map(u => [u.id, u]));
  invitees.forEach(u => {
    if (!known.has(u.id)) {
      known.set(u.id, { ...u, invitedAt });
    }
  });
  return [...known.values()];
};

/**
 * Invitees who have not joined yet, matched by id, name or email against the
 * participants: an invite upserts the team member, but someone may still join
 * through the generic link under a fresh id.
 */
export const pendingInvitees = (
  participants: User[],
  invitedUsers: SessionInvitee[] | undefined
): SessionInvitee[] => {
  const joinedKeys = new Set<string>();
  participants.forEach((p) => {
    joinedKeys.add(p.id);
    joinedKeys.add(p.name.trim().toLowerCase());
    if (p.email) joinedKeys.add(p.email.trim().toLowerCase());
  });
  return (invitedUsers ?? []).filter(
    (invitee) =>
      !joinedKeys.has(invitee.id) &&
      !joinedKeys.has(invitee.name.trim().toLowerCase()) &&
      !(invitee.email && joinedKeys.has(invitee.email.trim().toLowerCase()))
  );
};

/**
 * Like the action snapshots, `invitedUsers` is only ever added to during a
 * session, so an entry present locally but missing from the incoming state was
 * lost to a healed write race — the invite write losing the CAS against a
 * concurrent roster sync. Returns the list with the lost entries re-added, or
 * `null` when nothing was lost. Incoming values win for invitees the server
 * knows (invites upsert the team member, so a rename is authoritative).
 */
export const restoreLostInvitees = (
  incoming: SessionInvitee[] | undefined,
  prev: SessionInvitee[] | undefined
): SessionInvitee[] | null => {
  if (!prev?.length) return null;
  const known = new Set((incoming ?? []).map(u => u.id));
  const lost = prev.filter(u => !known.has(u.id));
  return lost.length > 0 ? [...(incoming ?? []), ...lost] : null;
};
