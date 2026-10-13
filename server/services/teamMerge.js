import { createHash } from 'crypto';
import { parseEmailInput } from '../../utils/emailAddress.js';
import { valuesEqual } from './sessionGuard.js';

/**
 * Merging two teams into a new, third one — the super-admin operation behind
 * `/api/super-admin/merge-teams` (see `superAdminTeamMergeRoutes.js`).
 *
 * It exists because a facilitator who could not recover a password created a
 * second team rather than lose the session, and the team then lived in two
 * halves. The operation is built around three promises, and every rule below
 * serves one of them:
 *
 *  1. **The sources are never written.** The merge creates a record and touches
 *     nothing else, so undoing it is deleting the merged team, and checking it is
 *     comparing it with two teams that are still exactly as they were.
 *  2. **Nothing is lost.** Every retrospective, health check, action, member,
 *     archived member and template of both teams is in the result, and
 *     `assertMergeInvariants` refuses to return a team whose counts do not add
 *     up. Feedbacks are the one exception, on purpose: they *move* when a source
 *     is deleted (`teamDeletion.js`), because a copy would show twice on every
 *     board with the same id.
 *  3. **Nothing is overwritten.** Wherever the two teams collide — an id, a map
 *     key, a template name — both are kept and the collision is reported.
 *
 * This module is pure: no I/O, no clock, no randomness of its own (ids come from
 * the injected `generateId`). The route does the reading and writing, which is
 * what lets the preview and the merge run the very same plan.
 */

const asArray = (value) => (Array.isArray(value) ? value : []);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalizeName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const isMember = (member) => isPlainObject(member) && typeof member.id === 'string' && member.id !== '';

/** A member's email as an identity key: only an address that is valid once cleaned counts. */
const memberEmailKey = (member) => {
  const parsed = parseEmailInput(member?.email);
  return parsed.ok && parsed.email ? parsed.email : null;
};

/**
 * A retro or health check that has not reached Close. Mirrors
 * `utils/sessionStatus.ts`, which the server cannot import (TypeScript): a stored
 * `CLOSED` is final and a record at the Close phase reads as closed.
 */
const isInProgress = (entry) => entry?.status !== 'CLOSED' && entry?.phase !== 'CLOSE';

// ---------------------------------------------------------------------------
// Effective source: the team record, plus any live session copy that is ahead
// ---------------------------------------------------------------------------

/**
 * Every action of the team record by id. Later homes win, in the order the
 * client builds the same map (`Session.tsx`): backlog, retros, health checks.
 */
const recordActionsById = (team) => {
  const byId = new Map();
  const add = (list) => asArray(list).forEach((action) => {
    if (isPlainObject(action) && typeof action.id === 'string') byId.set(action.id, action);
  });
  add(team.globalActions);
  asArray(team.retrospectives).forEach((retro) => add(retro?.actions));
  asArray(team.healthChecks).forEach((check) => add(check?.actions));
  return byId;
};

// What the granular action routes write to the team record and never to a
// live session: closing and re-opening, the assignee and text edited on the
// Dashboard or in another retro, and the impact round's own fields.
const RECORD_OWNED_ACTION_FIELDS = ['done', 'assigneeId', 'text', 'closedAt', 'impactRatings', 'impactDeferredBy'];
// What the client takes from the record when it opens a session, for every
// action it shows (`Session.tsx`, "reconcile action states with team data").
const CLIENT_RECONCILED_ACTION_FIELDS = ['done', 'assigneeId', 'text'];

const withRecordFields = (action, record, fields) => {
  if (!isPlainObject(action) || !record) return action;
  const next = { ...action };
  for (const field of fields) {
    if (record[field] === undefined) delete next[field];
    else next[field] = record[field];
  }
  return next;
};

/**
 * The team-record copy of a retro lags its live `session:{id}` row: receivers
 * never persist, a tab closed instead of "Exit" never sends its last persist,
 * and a Dashboard rename advances the row alone. The merge takes the row when
 * it is ahead, so whatever the room wrote last is in the merged team.
 *
 * But the row is not the authority on actions. Closing, re-opening, editing an
 * action from the Dashboard or another retro and the impact round go through
 * granular routes that write the team record only, so a row ahead of the
 * record can still hold an older text, assignee or closed state. The client
 * knows it — on opening a session it takes those fields from the team data —
 * and so does this: every action the record holds keeps the record's
 * team-owned fields, and only the session-owned ones (proposal state and
 * votes) come from the row. An action only the row holds is kept: an
 * unpersisted creation, or a deletion that comes back, which is the safe way
 * to be wrong. The name is the record's too (the rename routes own it).
 *
 * A row only counts when it is bound to this team: a row another team owns is
 * that team's session, whatever id it shares. A row whose content then equals
 * the record's is ignored, so "freshened" in the report means the merged team
 * really holds something the record lacked.
 *
 * Deletion recomputes the same effective source to decide whether a merge
 * source changed since it was merged, which is why this is shared and pure.
 *
 * @param {object} team a source team record
 * @param {Map<string, object|null>} rowsById live session rows by retro / health-check id
 * @returns {{ team: object, freshened: Array<{ kind: string, id: string, name: string }> }}
 */
const applyFresherSessionRows = (team, rowsById) => {
  const freshened = [];
  const recordActions = recordActionsById(team);

  const pick = (kind) => (entry) => {
    if (!isPlainObject(entry) || typeof entry.id !== 'string') return entry;
    const row = rowsById?.get(entry.id);
    if (!isPlainObject(row) || row.teamId !== team.id) return entry;
    if (!(Number(row._rev) > Number(entry._rev ?? -1))) return entry;

    const ownActions = new Map(
      asArray(entry.actions).filter((action) => isPlainObject(action)).map((action) => [action.id, action])
    );
    const candidate = {
      ...row,
      id: entry.id,
      teamId: team.id,
      name: entry.name,
      actions: Array.isArray(row.actions)
        ? row.actions.map((action) => withRecordFields(action, ownActions.get(action?.id), RECORD_OWNED_ACTION_FIELDS))
        : row.actions
    };
    for (const snapshot of ['openActionsSnapshot', 'historyActionsSnapshot']) {
      if (Array.isArray(row[snapshot])) {
        candidate[snapshot] = row[snapshot].map((action) =>
          withRecordFields(action, recordActions.get(action?.id), CLIENT_RECONCILED_ACTION_FIELDS)
        );
      }
    }
    // Only work counts: a row that differs by who looked at it, or where the
    // facilitator left the phase bar, is not ahead of the record in anything
    // the merged team would miss — and every retro someone merely opened has
    // one, since receivers never persist.
    if (hash(workOf(candidate)) === hash(workOf(entry))) return entry;
    freshened.push({ kind, id: entry.id, name: typeof entry.name === 'string' ? entry.name : '' });
    return candidate;
  };

  return {
    team: {
      ...team,
      ...(Array.isArray(team.retrospectives) ? { retrospectives: team.retrospectives.map(pick('retrospective')) } : {}),
      ...(Array.isArray(team.healthChecks) ? { healthChecks: team.healthChecks.map(pick('healthCheck')) } : {})
    },
    freshened
  };
};

/** Every retro and health-check id whose live row the route should read. */
const sessionIdsOf = (team) => [
  ...asArray(team?.retrospectives),
  ...asArray(team?.healthChecks)
]
  .map((entry) => entry?.id)
  .filter((id) => typeof id === 'string' && id !== '');

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

const REVISION_KEYS = new Set(['_rev', '_updatedAt']);

// Written by merely opening or browsing a retro or health check, never by
// work: the viewer joins `participants` and leaves `leftUsers`, the facilitator
// walking back from "View Summary" moves `phase` and resets the timer in
// `settings`, a rolling update re-runs all of it for every open tab, and a
// rename belongs to the record anyway. Counting any of it made a merge source
// read as "changed since the merge" after the first look.
const NAVIGATION_KEYS = new Set([
  'participants',
  'leftUsers',
  'invitedUsers',
  'phase',
  'status',
  'settings',
  'name',
  'discussionFocusId',
  'discussionNextTopicVotes',
  'finishedUsers',
  'autoFinishedUsers'
]);

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item ?? null)).join(',')}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => !REVISION_KEYS.has(key) && value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const hash = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');

// The raw phase and status are navigation, but reaching Close is not: a
// stored `CLOSED` is final, and a session that closed in a source after the
// merge would otherwise stay IN PROGRESS for good in the merged team — where a
// participant landing on the dashboard is sent into it.
const workOf = (entry) =>
  isPlainObject(entry)
    ? { ...Object.fromEntries(Object.entries(entry).filter(([key]) => !NAVIGATION_KEYS.has(key))), closed: !isInProgress(entry) }
    : entry;

/**
 * What a merge source holds that the merged team was built from, as one hash
 * per part — each retro, each health check, the backlog, each template list —
 * and one over all of them.
 *
 * Deletion compares it with the digest the merge recorded, to tell "deleting
 * this loses work" from "deleting this loses nothing", and the parts let it say
 * *what* changed. Left out: revision stamps at every depth, everything opening
 * a session writes (`NAVIGATION_KEYS`), the roster (a join is not lost work:
 * the person joins the merged team), the feedbacks (they move with the
 * deletion), and the recovery email and last-connection date.
 *
 * @returns {{ fingerprint: string, parts: Record<string, string> }}
 */
const contentDigest = (team) => {
  const parts = {};
  const add = (key, value) => {
    // A legacy record may hold the same id twice: number the repeats.
    let unique = key;
    for (let n = 2; Object.hasOwn(parts, unique); n += 1) unique = `${key}#${n}`;
    parts[unique] = hash(value).slice(0, 16);
  };
  asArray(team?.retrospectives).forEach((entry) => add(`retro:${entry?.id}`, workOf(entry)));
  asArray(team?.healthChecks).forEach((entry) => add(`hc:${entry?.id}`, workOf(entry)));
  add('backlog', asArray(team?.globalActions));
  add('templates', asArray(team?.customTemplates));
  add('hcTemplates', asArray(team?.customHealthCheckTemplates));
  return { fingerprint: hash(parts), parts };
};

const fingerprintTeamContent = (team) => contentDigest(team).fingerprint;

/**
 * What the merge preview showed: the content, *and* the roster — who is
 * recognised as the same person is half of what the admin approves, and a
 * member who joins between the preview and the merge changes that.
 */
const fingerprintMergePlanInput = (team) =>
  hash({ content: contentDigest(team).fingerprint, members: team?.members ?? null, archived: team?.archivedMembers ?? null });

/**
 * What changed between the digest a merge recorded and the source as it is
 * now, in words the console can show: a retro or health check by name, or the
 * backlog and template lists.
 */
const describeContentChanges = (team, recordedParts) => {
  if (!isPlainObject(recordedParts)) return [{ kind: 'unknown', added: false }];
  const { parts } = contentDigest(team);
  const names = new Map();
  asArray(team?.retrospectives).forEach((entry) => names.set(`retro:${entry?.id}`, entry?.name));
  asArray(team?.healthChecks).forEach((entry) => names.set(`hc:${entry?.id}`, entry?.name));
  const changes = [];
  for (const [key, value] of Object.entries(parts)) {
    if (recordedParts[key] === value) continue;
    const kind = key.startsWith('retro:') ? 'retrospective' : key.startsWith('hc:') ? 'healthCheck' : key;
    const name = names.get(key.split('#')[0]);
    changes.push({ kind, ...(typeof name === 'string' ? { name } : {}), added: !Object.hasOwn(recordedParts, key) });
  }
  return changes;
};

// ---------------------------------------------------------------------------
// Id rewriting
// ---------------------------------------------------------------------------

/**
 * Rewrites the ids one source's records carry. Every map is keyed by an id of
 * *that* source, which is what makes it safe: a record comes from exactly one
 * team, so it never holds the other team's ids by design.
 *
 * Map keys are renamed through `Object.fromEntries` rather than assigned one by
 * one, so a stored `__proto__` key stays an ordinary own property. When the new
 * key is already taken in the same object, both values are kept — the source
 * key is left as it was — and the collision is reported instead of resolved by
 * overwriting someone's vote.
 */
const createRewriter = ({ userIds, actionIds, retroIds, templateIds, conflicts, label }) => {
  const mapWith = (map) => (id) => (typeof id === 'string' && map.has(id) ? map.get(id) : id);
  const user = mapWith(userIds);
  const action = mapWith(actionIds);
  const retro = mapWith(retroIds);
  const template = mapWith(templateIds);

  const userList = (list) => (Array.isArray(list) ? list.map(user) : list);

  const renameKeys = (object, map, where) => {
    if (!isPlainObject(object)) return object;
    const entries = Object.entries(object);
    if (!entries.some(([key]) => map.has(key))) return object;
    const taken = new Set(entries.filter(([key]) => !map.has(key)).map(([key]) => key));
    const renamed = entries.map(([key, value]) => {
      if (!map.has(key)) return [key, value];
      const target = map.get(key);
      if (taken.has(target)) {
        conflicts.push({ team: label, where, key, target });
        return [key, value];
      }
      taken.add(target);
      return [target, value];
    });
    return Object.fromEntries(renamed);
  };

  const userKeys = (object, where) => renameKeys(object, userIds, where);

  const rewriteAction = (item, where) => {
    if (!isPlainObject(item)) return item;
    const next = { ...item, id: action(item.id) };
    if ('assigneeId' in item) next.assigneeId = user(item.assigneeId);
    if (item.proposalVotes !== undefined) next.proposalVotes = userKeys(item.proposalVotes, `${where}.proposalVotes`);
    if (item.impactRatings !== undefined) next.impactRatings = userKeys(item.impactRatings, `${where}.impactRatings`);
    if (item.impactDeferredBy !== undefined) next.impactDeferredBy = retro(item.impactDeferredBy);
    return next;
  };
  const rewriteActions = (list, where) => (Array.isArray(list) ? list.map((item) => rewriteAction(item, where)) : list);

  const rewriteParticipant = (participant) =>
    isPlainObject(participant) ? { ...participant, id: user(participant.id) } : participant;
  const rewriteParticipants = (list) => (Array.isArray(list) ? list.map(rewriteParticipant) : list);

  const rewriteTicket = (ticket) => {
    if (!isPlainObject(ticket)) return ticket;
    const next = { ...ticket };
    if ('authorId' in ticket) next.authorId = user(ticket.authorId);
    // A multiset: one person may vote several times. Mapped element by element,
    // never de-duplicated.
    if (ticket.votes !== undefined) next.votes = userList(ticket.votes);
    if (isPlainObject(ticket.reactions)) {
      next.reactions = Object.fromEntries(
        Object.entries(ticket.reactions).map(([emoji, voters]) => [emoji, userList(voters)])
      );
    }
    if (Array.isArray(ticket.comments)) {
      next.comments = ticket.comments.map((comment) =>
        isPlainObject(comment) ? { ...comment, authorId: user(comment.authorId) } : comment
      );
    }
    return next;
  };

  const rewriteSessionCommon = (entry, where) => {
    const next = { ...entry };
    if (entry.participants !== undefined) next.participants = rewriteParticipants(entry.participants);
    if (entry.leftUsers !== undefined) next.leftUsers = userList(entry.leftUsers);
    if (entry.invitedUsers !== undefined) next.invitedUsers = rewriteParticipants(entry.invitedUsers);
    if (entry.actions !== undefined) next.actions = rewriteActions(entry.actions, `${where}.actions`);
    if (entry.roti !== undefined) next.roti = userKeys(entry.roti, `${where}.roti`);
    if (entry.finishedUsers !== undefined) next.finishedUsers = userList(entry.finishedUsers);
    return next;
  };

  const rewriteRetro = (entry, where) => {
    if (!isPlainObject(entry)) return entry;
    const next = rewriteSessionCommon(entry, where);
    if (isPlainObject(entry.discussionNextTopicVotes)) {
      next.discussionNextTopicVotes = Object.fromEntries(
        Object.entries(entry.discussionNextTopicVotes).map(([topic, voters]) => [topic, userList(voters)])
      );
    }
    if (Array.isArray(entry.tickets)) next.tickets = entry.tickets.map(rewriteTicket);
    if (Array.isArray(entry.groups)) {
      next.groups = entry.groups.map((group) =>
        isPlainObject(group) && group.votes !== undefined ? { ...group, votes: userList(group.votes) } : group
      );
    }
    for (const snapshot of ['openActionsSnapshot', 'historyActionsSnapshot', 'closedActionsSnapshot']) {
      if (entry[snapshot] !== undefined) next[snapshot] = rewriteActions(entry[snapshot], `${where}.${snapshot}`);
    }
    if (isPlainObject(entry.actionImpactVotes)) {
      const byAction = renameKeys(entry.actionImpactVotes, actionIds, `${where}.actionImpactVotes`);
      next.actionImpactVotes = Object.fromEntries(
        Object.entries(byAction).map(([actionId, votes]) => [
          actionId,
          userKeys(votes, `${where}.actionImpactVotes.${actionId}`)
        ])
      );
    }
    if (entry.happiness !== undefined) next.happiness = userKeys(entry.happiness, `${where}.happiness`);
    if (entry.autoFinishedUsers !== undefined) next.autoFinishedUsers = userList(entry.autoFinishedUsers);
    return next;
  };

  const rewriteHealthCheck = (entry, where) => {
    if (!isPlainObject(entry)) return entry;
    const next = rewriteSessionCommon(entry, where);
    if (entry.ratings !== undefined) next.ratings = userKeys(entry.ratings, `${where}.ratings`);
    if (typeof entry.templateId === 'string') next.templateId = template(entry.templateId);
    return next;
  };

  return { rewriteRetro, rewriteHealthCheck, rewriteActions };
};

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

/** Fill what only `other` knows about the same person; never overwrite. */
const completeMember = (target, other) => {
  if (!memberEmailKey(target) && memberEmailKey(other)) target.email = memberEmailKey(other);
  if (!target.inviteToken && other.inviteToken) target.inviteToken = other.inviteToken;
  if (other.joinedBefore) target.joinedBefore = true;
};

/**
 * One source's roster, as the merge can use it. `/members` stores whatever a
 * client sends, so a roster can hold the same id twice (one person, typically
 * active and archived at once) or an entry with no usable id. Neither is
 * dropped: a repeated id is one person, folded into its first record, and an
 * entry with no id is carried as it is, in the list it came from — the merged
 * team then behaves exactly as the source did with it.
 */
const readRoster = (team) => {
  const byId = new Map();
  let folded = 0;
  const take = (list) => {
    const kept = [];
    const malformed = [];
    for (const original of asArray(list)) {
      if (!isMember(original)) {
        malformed.push(structuredClone(original));
        continue;
      }
      const existing = byId.get(original.id);
      if (existing) {
        completeMember(existing, original);
        folded += 1;
        continue;
      }
      const member = structuredClone(original);
      byId.set(member.id, member);
      kept.push(member);
    }
    return { kept, malformed };
  };
  const active = take(team.members);
  const archived = take(team.archivedMembers);
  const facilitator =
    active.kept.find((member) => member.role === 'facilitator') ||
    archived.kept.find((member) => member.role === 'facilitator') ||
    null;
  return {
    active: active.kept,
    archived: archived.kept,
    malformedActive: active.malformed,
    malformedArchived: archived.malformed,
    all: [...active.kept, ...archived.kept],
    facilitator,
    folded,
    rawCount: asArray(team.members).length + asArray(team.archivedMembers).length
  };
};

/**
 * Which secondary members are the same person as a primary member.
 *
 * Unifying rewrites the secondary member's id to the primary one in every
 * secondary record, so a person's history reads as one person. It is done only
 * when the code can be sure, in this order:
 *  - the two facilitators, always: one password opens the merged team, so it has
 *    one facilitator, and password login always lands on `members[0]`;
 *  - the same valid email, held by one member on each side;
 *  - the same name (trimmed, case-insensitive), held by one participant on each
 *    side, and only when their emails do not contradict it.
 *
 * Two members of the *same* source are never unified — two people called Marie
 * in one team are two people (`sessionRoster.ts` keeps them apart for the same
 * reason) — and an ambiguous name is reported, not guessed.
 */
const planMembers = ({ primary, secondary, generateId, knownIds }) => {
  const a = readRoster(primary);
  const b = readRoster(secondary);
  const userIds = new Map();
  const targets = new Set();
  const unified = [];
  const keptSameName = [];
  const reminted = [];

  const unify = (from, into, reason) => {
    userIds.set(from.id, into.id);
    targets.add(into.id);
    unified.push({ fromId: from.id, fromName: from.name ?? '', intoId: into.id, intoName: into.name ?? '', reason });
  };

  if (a.facilitator && b.facilitator) unify(b.facilitator, a.facilitator, 'facilitator');

  const participantsOf = (roster) => roster.all.filter((member) => member.role !== 'facilitator');
  const aParticipants = participantsOf(a);
  const bParticipants = participantsOf(b);

  const countBy = (members, keyOf) => {
    const counts = new Map();
    for (const member of members) {
      const key = keyOf(member);
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  };

  const aEmails = countBy(aParticipants, memberEmailKey);
  const bEmails = countBy(bParticipants, memberEmailKey);
  for (const member of bParticipants) {
    const key = memberEmailKey(member);
    if (!key || aEmails.get(key) !== 1 || bEmails.get(key) !== 1) continue;
    const match = aParticipants.find((candidate) => memberEmailKey(candidate) === key);
    if (match && !targets.has(match.id)) unify(member, match, 'email');
  }

  const aNames = countBy(aParticipants, (member) => normalizeName(member.name));
  const bNames = countBy(bParticipants, (member) => normalizeName(member.name));
  for (const member of bParticipants) {
    if (userIds.has(member.id)) continue;
    const key = normalizeName(member.name);
    if (!key || !aNames.has(key)) continue;
    const keep = (reason) => keptSameName.push({ name: member.name, secondaryId: member.id, reason });
    if (aNames.get(key) !== 1 || bNames.get(key) !== 1) {
      keep('ambiguous');
      continue;
    }
    const match = aParticipants.find((candidate) => normalizeName(candidate.name) === key);
    if (targets.has(match.id)) {
      keep('already_unified');
      continue;
    }
    const emailA = memberEmailKey(match);
    const emailB = memberEmailKey(member);
    if (emailA && emailB && emailA !== emailB) {
      keep('email_conflict');
      continue;
    }
    unify(member, match, 'name');
  }

  // A secondary member who is someone else but carries an id the primary team
  // already uses gets a new id, rewritten in the secondary records only.
  const primaryIds = new Set(a.all.map((member) => member.id));
  const freshId = () => {
    let id;
    do {
      id = generateId();
    } while (knownIds.has(id));
    knownIds.add(id);
    return id;
  };
  for (const member of b.all) {
    if (userIds.has(member.id) || !primaryIds.has(member.id)) continue;
    const id = freshId();
    userIds.set(member.id, id);
    reminted.push({ name: member.name ?? '', fromId: member.id, toId: id });
  }

  // Build the merged roster. Records are keyed by their final id; a person who
  // is active on either side stays active.
  const records = new Map();
  const place = (member, active, from) => {
    const id = from === 'secondary' ? userIds.get(member.id) ?? member.id : member.id;
    const existing = records.get(id);
    if (!existing) {
      records.set(id, { member: { ...structuredClone(member), id }, active });
      return;
    }
    // A secondary member unified into a primary one: the primary record keeps
    // its name, colour and role, and is completed with what only the other side
    // knew.
    completeMember(existing.member, member);
    existing.active = existing.active || active;
  };
  a.active.forEach((member) => place(member, true, 'primary'));
  a.archived.forEach((member) => place(member, false, 'primary'));
  b.active.forEach((member) => place(member, true, 'secondary'));
  b.archived.forEach((member) => place(member, false, 'secondary'));

  let facilitatorId = a.facilitator?.id ?? (b.facilitator ? userIds.get(b.facilitator.id) ?? b.facilitator.id : null);
  let mintedFacilitator = null;
  if (!facilitatorId) {
    // Neither roster has a facilitator — a malformed record (`/members` stores
    // whatever it is sent). Password login lands on `members[0]`, so without
    // one nobody could open the merged team's Dashboard.
    mintedFacilitator = {
      id: `admin-${freshId()}`,
      name: 'Facilitator',
      color: 'bg-indigo-500',
      role: 'facilitator'
    };
    records.set(mintedFacilitator.id, { member: mintedFacilitator, active: true });
    facilitatorId = mintedFacilitator.id;
  }
  const facilitatorRecord = records.get(facilitatorId);
  facilitatorRecord.active = true;

  const members = [facilitatorRecord.member];
  const archivedMembers = [];
  for (const [id, record] of records) {
    if (id === facilitatorId) continue;
    (record.active ? members : archivedMembers).push(record.member);
  }
  members.push(...a.malformedActive, ...b.malformedActive);
  archivedMembers.push(...a.malformedArchived, ...b.malformedArchived);

  // Two people kept apart who share an address: the Dashboard refuses to edit
  // either while the other holds it, and an invitation to that address reaches
  // the first one only. Not resolvable here without guessing, so it is shown
  // to the admin, who fixes it on the merged team's Dashboard.
  const byEmail = new Map();
  for (const member of members) {
    const key = isMember(member) ? memberEmailKey(member) : null;
    if (!key) continue;
    byEmail.set(key, [...(byEmail.get(key) || []), member.name ?? '']);
  }
  const sharedEmails = [...byEmail.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([email, names]) => ({ email, names }));

  return {
    members,
    archivedMembers,
    userIds,
    report: {
      unified,
      keptSameName,
      reminted,
      mintedFacilitator: Boolean(mintedFacilitator),
      sharedEmails,
      malformed: a.malformedActive.length + a.malformedArchived.length + b.malformedActive.length + b.malformedArchived.length,
      folded: a.folded + b.folded
    },
    counts: { primary: a.rawCount, secondary: b.rawCount, folded: a.folded + b.folded }
  };
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const withSuffix = (entry, kept, suffix, renamed, kind) => {
  if (!isPlainObject(entry) || typeof entry.name !== 'string') return entry;
  const key = normalizeName(entry.name);
  if (!key || !kept.some((other) => isPlainObject(other) && normalizeName(other.name) === key)) return entry;
  const name = `${entry.name} (${suffix})`;
  renamed.push({ kind, from: entry.name, to: name });
  return { ...entry, name };
};

const planRetroTemplates = (primary, secondary, renamed) => {
  const kept = structuredClone(asArray(primary.customTemplates));
  let deduplicated = 0;
  for (const template of asArray(secondary.customTemplates)) {
    if (kept.some((other) => valuesEqual(other, template))) {
      deduplicated += 1;
      continue;
    }
    kept.push(withSuffix(structuredClone(template), kept, secondary.name, renamed, 'retro'));
  }
  return { templates: kept, deduplicated };
};

const planHealthCheckTemplates = (primary, secondary, generateId, renamed) => {
  const kept = structuredClone(asArray(primary.customHealthCheckTemplates));
  const templateIds = new Map();
  let deduplicated = 0;
  let reminted = 0;
  for (const original of asArray(secondary.customHealthCheckTemplates)) {
    let template = structuredClone(original);
    const sameId = isPlainObject(template) && typeof template.id === 'string'
      ? kept.find((other) => isPlainObject(other) && other.id === template.id)
      : undefined;
    if (sameId) {
      if (valuesEqual(sameId, template)) {
        deduplicated += 1;
        continue;
      }
      // Same id, different template: the health checks of the secondary team
      // must keep pointing at *their* template, so it gets a new id and they
      // follow it.
      let id;
      do {
        id = `custom_${generateId()}`;
      } while (kept.some((other) => other?.id === id));
      templateIds.set(template.id, id);
      template = { ...template, id };
      reminted += 1;
    }
    kept.push(withSuffix(template, kept, secondary.name, renamed, 'healthCheck'));
  }
  return { templates: kept, templateIds, deduplicated, reminted };
};

// ---------------------------------------------------------------------------
// Ordering and team-level fields
// ---------------------------------------------------------------------------

const timestampOf = (entry) => {
  const value = Date.parse(entry?._updatedAt);
  return Number.isFinite(value) ? value : null;
};

/**
 * Interleaves two newest-first lists without ever reordering either one. Array
 * position is the only reliable chronology a team has (`date` is a locale
 * string), and several features read it — `retrospectives[0]` seeds the next
 * retro, `closedActionsForRating.ts` walks the list in order — so each source's
 * own order is kept exactly, and only the interleaving is a judgement call.
 */
const zipperNewestFirst = (primaryList, secondaryList) => {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < primaryList.length && j < secondaryList.length) {
    const a = timestampOf(primaryList[i]);
    const b = timestampOf(secondaryList[j]);
    if (a === null || b === null || a >= b) out.push(primaryList[i++]);
    else out.push(secondaryList[j++]);
  }
  return out.concat(primaryList.slice(i), secondaryList.slice(j));
};

const KNOWN_TEAM_KEYS = new Set([
  'id',
  'name',
  'passwordHash',
  'facilitatorEmail',
  'members',
  'archivedMembers',
  'customTemplates',
  'retrospectives',
  'globalActions',
  'healthChecks',
  'customHealthCheckTemplates',
  'lastConnectionDate',
  'teamFeedbacks',
  'actionImpactRatingEnabled',
  'actionImpactNoticeDismissedAt',
  'inviteEpoch',
  'mergedFrom',
  '_rev',
  '_updatedAt'
]);

/** Top-level keys this code does not know about are carried, not dropped. */
const carryUnknownKeys = (primary, secondary) => {
  const entries = [];
  const conflicts = [];
  const seen = new Map();
  for (const [key, value] of Object.entries(primary)) {
    if (KNOWN_TEAM_KEYS.has(key)) continue;
    seen.set(key, value);
    entries.push([key, structuredClone(value)]);
  }
  for (const [key, value] of Object.entries(secondary)) {
    if (KNOWN_TEAM_KEYS.has(key)) continue;
    if (!seen.has(key)) {
      entries.push([key, structuredClone(value)]);
    } else if (!valuesEqual(seen.get(key), value)) {
      conflicts.push(key);
    }
  }
  return { extras: Object.fromEntries(entries), keys: entries.map(([key]) => key), conflicts };
};

const laterDate = (a, b) => {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? b : undefined;
  if (!Number.isFinite(tb)) return a;
  return tb > ta ? b : a;
};

const earlierDate = (a, b) => {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return undefined;
  return tb < ta ? b : a;
};

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

const canonicalActionIds = (team) => {
  const ids = new Set();
  const add = (list) => asArray(list).forEach((action) => {
    if (typeof action?.id === 'string') ids.add(action.id);
  });
  add(team.globalActions);
  asArray(team.retrospectives).forEach((retro) => add(retro?.actions));
  asArray(team.healthChecks).forEach((check) => add(check?.actions));
  return ids;
};

const countsOf = (team) => ({
  members: asArray(team.members).length,
  archivedMembers: asArray(team.archivedMembers).length,
  retrospectives: asArray(team.retrospectives).length,
  healthChecks: asArray(team.healthChecks).length,
  globalActions: asArray(team.globalActions).length,
  customTemplates: asArray(team.customTemplates).length,
  customHealthCheckTemplates: asArray(team.customHealthCheckTemplates).length,
  feedbacks: asArray(team.teamFeedbacks).length
});

/**
 * Give every retro or health check of one source a new id, by position: a
 * legacy record may hold the same id twice, and an id-keyed map would collapse
 * those two entries into one.
 */
const reidSessions = (list, newTeamId, mintId) => {
  const firstNewId = new Map();
  const ambiguous = new Set();
  const entries = asArray(list).map((entry) => {
    const id = mintId();
    const oldId = isPlainObject(entry) ? entry.id : undefined;
    if (typeof oldId === 'string') {
      if (firstNewId.has(oldId)) ambiguous.add(oldId);
      else firstNewId.set(oldId, id);
    }
    return isPlainObject(entry) ? { ...entry, id, teamId: newTeamId } : entry;
  });
  return { entries, idMap: firstNewId, ambiguous: [...ambiguous] };
};

const COLLECTION_FIELDS = [
  'members',
  'archivedMembers',
  'retrospectives',
  'healthChecks',
  'globalActions',
  'customTemplates',
  'customHealthCheckTemplates',
  'teamFeedbacks'
];

/**
 * A source whose collection is not a list at all cannot be carried into a list
 * without dropping it. The merge refuses rather than guess — the sources are
 * untouched, so refusing loses nothing.
 */
class MergeSourceError extends Error {
  constructor(anomalies) {
    super('a merge source needs repair before it can be merged');
    this.name = 'MergeSourceError';
    this.anomalies = anomalies;
  }
}

const shapeAnomalies = (team, role) =>
  COLLECTION_FIELDS
    .filter((field) => team[field] !== undefined && team[field] !== null && !Array.isArray(team[field]))
    .map((field) => ({ source: role, field }));

/**
 * Build the merged team.
 *
 * @param {object} params
 * @param {object} params.primary   effective primary source (see applyFresherSessionRows)
 * @param {object} params.secondary effective secondary source
 * @param {string} params.newTeamId
 * @param {string} params.name      the merged team's name, already validated by the route
 * @param {string} params.passwordHash
 * @param {string|undefined} params.facilitatorEmail already cleaned by the route
 * @param {string} params.mergedAt  ISO timestamp
 * @param {() => string} params.generateId fresh `[a-z0-9]` ids
 * @param {Array} [params.freshened] entries taken from live session rows, for the report
 * @param {{ primary: string, secondary: string }} [params.recordFingerprints] digests of the team records alone
 * @returns {{ team: object, report: object }}
 */
const planTeamMerge = ({
  primary,
  secondary,
  newTeamId,
  name,
  passwordHash,
  facilitatorEmail,
  mergedAt,
  generateId,
  freshened = [],
  recordFingerprints
}) => {
  if (!isPlainObject(primary) || !isPlainObject(secondary)) throw new Error('merge sources must be team records');
  if (primary.id === secondary.id) throw new Error('cannot merge a team with itself');
  const anomalies = [...shapeAnomalies(primary, 'primary'), ...shapeAnomalies(secondary, 'secondary')];
  if (anomalies.length > 0) throw new MergeSourceError(anomalies);

  // Every id either team uses, so a minted id can never land on an existing one.
  const knownIds = new Set();
  const collect = (value) => {
    if (Array.isArray(value)) value.forEach(collect);
    else if (isPlainObject(value)) {
      if (typeof value.id === 'string') knownIds.add(value.id);
      Object.values(value).forEach(collect);
    }
  };
  collect(primary);
  collect(secondary);
  const mintId = () => {
    let id;
    do {
      id = generateId();
    } while (knownIds.has(id));
    knownIds.add(id);
    return id;
  };

  const memberPlan = planMembers({ primary, secondary, generateId, knownIds });

  // Action ids must be unique across the backlog, the retros and the health
  // checks: every lookup and write takes the first match, so a second action
  // with the same id could never be closed or rated again.
  const primaryActionIds = canonicalActionIds(primary);
  const actionIds = new Map();
  for (const id of canonicalActionIds(secondary)) {
    if (primaryActionIds.has(id)) actionIds.set(id, mintId());
  }

  const templatesRenamed = [];
  const retroTemplates = planRetroTemplates(primary, secondary, templatesRenamed);
  const healthCheckTemplates = planHealthCheckTemplates(primary, secondary, mintId, templatesRenamed);

  const conflicts = [];
  const sources = [
    { role: 'primary', team: primary, userIds: new Map(), actionIds: new Map(), templateIds: new Map() },
    {
      role: 'secondary',
      team: secondary,
      userIds: memberPlan.userIds,
      actionIds,
      templateIds: healthCheckTemplates.templateIds
    }
  ].map((source) => {
    const retros = reidSessions(source.team.retrospectives, newTeamId, mintId);
    const checks = reidSessions(source.team.healthChecks, newTeamId, mintId);
    const rewriter = createRewriter({
      userIds: source.userIds,
      actionIds: source.actionIds,
      // `impactDeferredBy` names a retro of the same team.
      retroIds: retros.idMap,
      templateIds: source.templateIds,
      conflicts,
      label: source.role
    });
    return {
      ...source,
      retrospectives: retros.entries.map((entry, index) => rewriter.rewriteRetro(entry, `retrospectives[${index}]`)),
      healthChecks: checks.entries.map((entry, index) => rewriter.rewriteHealthCheck(entry, `healthChecks[${index}]`)),
      globalActions: rewriter.rewriteActions(structuredClone(asArray(source.team.globalActions)), 'globalActions'),
      ambiguousRetroIds: retros.ambiguous
    };
  });
  const [a, b] = sources;

  const unknown = carryUnknownKeys(primary, secondary);
  const lastConnectionDate = laterDate(primary.lastConnectionDate, secondary.lastConnectionDate);
  const noticeDismissedAt = earlierDate(primary.actionImpactNoticeDismissedAt, secondary.actionImpactNoticeDismissedAt);
  const ratingDisabled = primary.actionImpactRatingEnabled === false || secondary.actionImpactRatingEnabled === false;

  // What deletion compares against later (`mergeSources.js`). The digest of
  // the source as merged — live session copies included — and the digest of
  // its team record alone: a restore wipes every live session row, after which
  // a source that never changed reads as its record, and must still match.
  const provenance = (source) => {
    const digest = contentDigest(source.team);
    return {
      teamId: source.team.id,
      name: source.team.name,
      role: source.role,
      mergedAt,
      fingerprint: digest.fingerprint,
      recordFingerprint: recordFingerprints?.[source.role] ?? digest.fingerprint,
      parts: digest.parts,
      counts: countsOf(source.team)
    };
  };

  const team = structuredClone({
    ...unknown.extras,
    id: newTeamId,
    name,
    passwordHash,
    ...(facilitatorEmail ? { facilitatorEmail } : {}),
    members: memberPlan.members,
    archivedMembers: memberPlan.archivedMembers,
    customTemplates: retroTemplates.templates,
    customHealthCheckTemplates: healthCheckTemplates.templates,
    retrospectives: zipperNewestFirst(a.retrospectives, b.retrospectives),
    healthChecks: zipperNewestFirst(a.healthChecks, b.healthChecks),
    globalActions: [...a.globalActions, ...b.globalActions],
    teamFeedbacks: [],
    ...(lastConnectionDate ? { lastConnectionDate } : {}),
    ...(ratingDisabled ? { actionImpactRatingEnabled: false } : {}),
    ...(noticeDismissedAt ? { actionImpactNoticeDismissedAt: noticeDismissedAt } : {}),
    mergedFrom: [provenance(a), provenance(b)]
  });

  assertMergeInvariants({ team, primary, secondary, memberPlan });

  const inProgress = sources.flatMap((source) =>
    [...asArray(source.team.retrospectives), ...asArray(source.team.healthChecks)]
      .filter((entry) => isPlainObject(entry) && isInProgress(entry))
      .map((entry) => ({ source: source.role, name: typeof entry.name === 'string' ? entry.name : '' }))
  );

  const report = {
    sources: sources.map((source) => ({
      role: source.role,
      id: source.team.id,
      name: source.team.name,
      counts: countsOf(source.team)
    })),
    merged: countsOf(team),
    members: memberPlan.report,
    actions: { reminted: actionIds.size },
    templates: {
      renamed: templatesRenamed,
      deduplicated: retroTemplates.deduplicated + healthCheckTemplates.deduplicated,
      reminted: healthCheckTemplates.reminted
    },
    sessions: {
      inProgress,
      freshened,
      ambiguousRetroIds: [...a.ambiguousRetroIds, ...b.ambiguousRetroIds]
    },
    feedbacksToMoveOnDelete: {
      primary: asArray(primary.teamFeedbacks).length,
      secondary: asArray(secondary.teamFeedbacks).length
    },
    settings: {
      actionImpactRatingEnabled: !ratingDisabled,
      actionImpactNoticeDismissed: Boolean(noticeDismissedAt)
    },
    unknownKeys: { carried: unknown.keys, conflicting: unknown.conflicts },
    conflicts
  };

  return { team, report };
};

/**
 * The promises of the header, checked on the result rather than trusted. A
 * failure here is a bug in this module, so it throws and the route answers 500
 * having written nothing.
 */
const assertMergeInvariants = ({ team, primary, secondary, memberPlan }) => {
  const fail = (message) => {
    throw new Error(`team merge invariant violated: ${message}`);
  };
  const expectSum = (field) => {
    const expected = asArray(primary[field]).length + asArray(secondary[field]).length;
    if (team[field].length !== expected) fail(`${field}: ${team[field].length} instead of ${expected}`);
  };
  expectSum('retrospectives');
  expectSum('healthChecks');
  expectSum('globalActions');

  const roster = [...team.members, ...team.archivedMembers];
  const expectedRoster =
    memberPlan.counts.primary +
    memberPlan.counts.secondary -
    memberPlan.counts.folded -
    memberPlan.report.unified.length +
    (memberPlan.report.mintedFacilitator ? 1 : 0);
  if (roster.length !== expectedRoster) fail(`roster: ${roster.length} instead of ${expectedRoster}`);
  const ids = roster.filter(isMember).map((member) => member.id);
  if (new Set(ids).size !== ids.length) fail('duplicate member id');
  if (team.members[0]?.role !== 'facilitator') fail('members[0] is not the facilitator');

  const sourceIds = new Set([...asArray(primary.retrospectives), ...asArray(primary.healthChecks),
    ...asArray(secondary.retrospectives), ...asArray(secondary.healthChecks)]
    .map((entry) => entry?.id)
    .filter(Boolean));
  for (const entry of [...team.retrospectives, ...team.healthChecks]) {
    if (!isPlainObject(entry)) continue;
    if (entry.teamId !== team.id) fail('a session entry still names a source team');
    if (sourceIds.has(entry.id)) fail('a session entry kept a source id');
  }
};

export {
  MergeSourceError,
  planTeamMerge,
  applyFresherSessionRows,
  sessionIdsOf,
  contentDigest,
  describeContentChanges,
  fingerprintMergePlanInput,
  fingerprintTeamContent,
  zipperNewestFirst
};
