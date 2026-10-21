import { cleanEmail, parseEmailInput } from '../../utils/emailAddress.js';

/**
 * Cleans the email addresses already stored, so the rule in
 * `utils/emailAddress.js` holds for values written before it existed.
 *
 * The write paths now refuse an address that is not exactly one deliverable
 * address, and clean what a paste leaves around one. That protects every value
 * written from now on, and the reset route already compares both sides through
 * `sameEmail`, so a dirty stored value no longer blocks a reset. What is left is
 * the stored data itself: the super-admin console still lists
 * `elisabeth.trolliet@etat.ge.ch;`, the feedback mails still go to it, and two
 * spellings of one member's address still sit side by side. This pass rewrites
 * each one that cleans to a valid address, and leaves everything else as it was.
 *
 * Modelled on `passwordMigration.js`, for the same reasons:
 *
 *  - **It never throws.** Boot and a restore must not fail because an address
 *    could not be tidied. A value left dirty still works everywhere it is read.
 *  - **It decides again under the lock.** The scan only tells it which teams to
 *    look at; the rewrite is recomputed from the record `atomicTeamUpdate` hands
 *    the updater, so a facilitator's edit made between the scan and the write —
 *    or another pod booting at the same time — is never overwritten.
 *  - **It never logs an address.** JSON logs reach the cluster's aggregator and
 *    the super-admin log ring; a value it could not clean is reported by team id.
 *
 * It touches the team records and the admin address only. Retros, health checks
 * and `session:*` rows also carry participant and invitee emails, but those are
 * copies the client matches through `cleanEmail` on both sides, and rewriting a
 * live session row from a startup pass would race every client writing it.
 */

/**
 * Cleans the `email` of every member of a roster, by the rule both the heal pass
 * and `/api/team/:teamId/members` apply.
 *
 *  - A value that parses is replaced by its cleaned form; a blank one is removed.
 *  - A value that does not parse (two addresses, no top-level domain) is left as
 *    it is and counted. A roster write carries joins, so it is never refused
 *    over one member's address.
 *  - A value whose cleaned form is held by **another** member of the team is
 *    left as it is and counted as a conflict. The client treats a member's email
 *    as an identity, so cleaning one of two spellings into the other would make
 *    two people the same person — `updateMember` would then refuse every edit,
 *    and invitations would resolve to whichever came first.
 *
 * Never mutates its input. Lists that are not arrays, and entries that are not
 * objects, are returned untouched.
 *
 * @param {unknown} members
 * @param {unknown} archivedMembers
 * @returns {{ members: unknown, archivedMembers: unknown, changed: boolean, unparseable: number, conflicts: number }}
 */
const cleanRosterEmails = (members, archivedMembers) => {
  const lists = [members, archivedMembers];
  const entries = lists.flatMap((list) => (Array.isArray(list) ? list : []))
    .filter((member) => member && typeof member === 'object');

  // How many members answer to each identity, judged the way the client judges
  // it. A count above one is a conflict for whoever would be rewritten.
  const holders = new Map();
  for (const member of entries) {
    const identity = cleanEmail(member.email);
    if (identity) holders.set(identity, (holders.get(identity) || 0) + 1);
  }

  let changed = false;
  let unparseable = 0;
  let conflicts = 0;

  const cleanList = (list) => {
    if (!Array.isArray(list)) return list;
    return list.map((member) => {
      if (!member || typeof member !== 'object' || !Object.prototype.hasOwnProperty.call(member, 'email')) {
        return member;
      }
      const parsed = parseEmailInput(member.email);
      if (!parsed.ok) {
        unparseable += 1;
        return member;
      }
      if (parsed.email === member.email) return member;
      if (parsed.email && holders.get(parsed.email) > 1) {
        conflicts += 1;
        return member;
      }
      changed = true;
      if (parsed.email === undefined) {
        const { email: _blank, ...rest } = member;
        return rest;
      }
      return { ...member, email: parsed.email };
    });
  };

  const nextMembers = cleanList(members);
  const nextArchived = cleanList(archivedMembers);
  return { members: nextMembers, archivedMembers: nextArchived, changed, unparseable, conflicts };
};

/**
 * The cleaned form of one team record: its recovery address and the email of
 * every active and archived member. Pure — the caller decides whether to write.
 *
 * @param {Record<string, unknown>} team
 * @returns {{ changed: boolean, team: Record<string, unknown>, unparseable: number, conflicts: number }}
 */
const healTeamEmails = (team) => {
  const roster = cleanRosterEmails(team?.members, team?.archivedMembers);
  let changed = roster.changed;
  let unparseable = roster.unparseable;
  const next = { ...team };
  if (roster.changed) {
    next.members = roster.members;
    next.archivedMembers = roster.archivedMembers;
  }

  const recovery = parseEmailInput(team?.facilitatorEmail);
  if (!recovery.ok) {
    unparseable += 1;
  } else if (recovery.email !== team?.facilitatorEmail) {
    changed = true;
    if (recovery.email === undefined) {
      delete next.facilitatorEmail;
    } else {
      next.facilitatorEmail = recovery.email;
    }
  }

  return { changed, team: next, unparseable, conflicts: roster.conflicts };
};

// The admin address lives in `global-settings`, beside every other console
// setting. The scan reads it leniently — a read error answers `{}`, which holds
// no address and so heals nothing — and only finds out whether there is
// anything to do, so a clean store takes no lock. The write is decided again
// inside `updateGlobalSettings`, on the row as it stands under the lock: the
// address is changed only while it still holds the value scanned, and nothing
// else in the row is touched. A super admin saving any setting at the same
// instant therefore loses nothing, and a new address saved since the scan is
// left as it is. A failed strict read throws, which the caller counts. Only the
// first boot after a dirty address was stored can write at all.
const healAdminEmail = async (dataStore) => {
  const settings = await dataStore.loadGlobalSettings();
  const stored = settings?.adminEmail;
  if (typeof stored !== 'string') return { healed: false, unparseable: false };

  const parsed = parseEmailInput(stored);
  if (!parsed.ok) return { healed: false, unparseable: true };
  const cleaned = parsed.email ?? '';
  if (cleaned === stored) return { healed: false, unparseable: false };

  let healed = false;
  await dataStore.updateGlobalSettings((current) => {
    healed = false;
    if (current.adminEmail !== stored) return null;
    healed = true;
    return { ...current, adminEmail: cleaned };
  });
  return { healed, unparseable: false };
};

// Enough ids to find the records, without letting a store full of legacy
// values turn one summary line into a wall.
const MAX_LOGGED_TEAM_IDS = 20;

/**
 * Runs the heal over every team record and the admin address. Wired at startup
 * after the password migration, and after both restore routes (an archive
 * taken before this rule puts dirty values back).
 *
 * @param {{ dataStore: object }} options
 */
const healStoredEmails = async ({ dataStore }) => {
  // The projection, not the full records: this runs before every pod listens,
  // right after the password migration's own full scan, and only finds the
  // candidates — each write re-decides on the whole record under the lock.
  let teams;
  try {
    teams = await dataStore.loadTeamSummaries({ withArchivedMembers: true });
  } catch (err) {
    console.warn('[Server] Email address heal could not read the teams', err);
    return { scanned: 0, healed: 0, unparseable: 0, conflicts: 0, failed: 0, adminEmailHealed: false, error: true };
  }

  const scanned = (teams || []).length;
  let healed = 0;
  let unparseable = 0;
  let conflicts = 0;
  let failed = 0;
  const unparseableTeamIds = [];

  for (const team of teams || []) {
    const scan = healTeamEmails(team);
    unparseable += scan.unparseable;
    conflicts += scan.conflicts;
    if (scan.unparseable > 0) unparseableTeamIds.push(team?.id);
    if (!scan.changed) continue;

    try {
      let applied = false;
      const result = await dataStore.atomicTeamUpdate(team.id, (currentTeam) => {
        // Recomputed on the record under the lock, never applied from the
        // scan: the address may have been edited, or healed by another pod.
        applied = false;
        if (!currentTeam) return null;
        const current = healTeamEmails(currentTeam);
        if (!current.changed) return null;
        applied = true;
        return current.team;
      });
      if (!result?.success) {
        failed += 1;
      } else if (applied) {
        healed += 1;
      }
    } catch (err) {
      failed += 1;
      console.warn(`[Server] Failed to clean the stored email addresses of team ${team.id}`, err);
    }
  }

  let adminEmailHealed = false;
  let adminEmailUnparseable = false;
  try {
    const admin = await healAdminEmail(dataStore);
    adminEmailHealed = admin.healed;
    adminEmailUnparseable = admin.unparseable;
  } catch (err) {
    failed += 1;
    console.warn('[Server] Failed to clean the stored admin email address', err);
  }

  // One line on every run, clean or not, for the reason `passwordMigration.js`
  // gives: silence cannot be told apart from a pass that never ran.
  const loggedIds = unparseableTeamIds.slice(0, MAX_LOGGED_TEAM_IDS).join(', ');
  const moreIds = unparseableTeamIds.length > MAX_LOGGED_TEAM_IDS
    ? ` and ${unparseableTeamIds.length - MAX_LOGGED_TEAM_IDS} more`
    : '';
  console.info(
    `[Server] Email address heal: ${healed} team record(s) cleaned, ${failed} failed, ` +
    `${unparseable} value(s) left as they were because they are not one valid address` +
    (unparseableTeamIds.length > 0 ? ` (teams ${loggedIds}${moreIds})` : '') +
    `, ${conflicts} left because another member holds the cleaned address, ` +
    `admin address ${adminEmailHealed ? 'cleaned' : adminEmailUnparseable ? 'left as it was (not one valid address)' : 'unchanged'}, ` +
    `${scanned} team(s) scanned`
  );

  return { scanned, healed, unparseable, conflicts, failed, adminEmailHealed, error: false };
};

export { cleanRosterEmails, healTeamEmails, healStoredEmails };
