// Restoring **one** team from a stored backup, leaving every other team as it is.
//
// The whole-store restore (`/api/super-admin/backups/restore`) is a faithful
// replace: right when everything went wrong, wrong when one team lost a
// retrospective, because it also rolls every other team back to the backup.
// This is the narrow version. It reads one team out of an archive and writes
// that team's record, and nothing else a team owns elsewhere.
//
// Pure: no I/O, no clock. The route (`superAdminTeamRestoreRoutes.js`) reads,
// snapshots, writes and broadcasts; this module decides what the restored record
// is. Rules, each of which a test pins:
//
//  - **The team's work comes back as it was in the backup**: retrospectives,
//    health checks, the backlog, members, archived members, templates and team
//    settings.
//  - **How people get in does not.** When the team still exists, its password,
//    invite-link epoch, recovery address and name stay as they are now: the
//    restore answers "give us back our data", and rolling the password back to
//    one the team may have changed for a reason would lock out everyone who
//    knows the current one. A team deleted since the backup has no current
//    value, so the archive's are used — that is the only way it can be opened.
//  - **Feedbacks are never rolled back.** They are a board shared with the super
//    admin, not the team's retrospective data: the team keeps the ones it has
//    now, and a deleted team gets back the ones its deletion moved to
//    `orphanedFeedbacks` (with every reply posted since), never the archive's
//    copies — those may since have moved into a merged team.
//  - **Every restored retro and health check lands above every live copy.**
//    A full-blob persist (`/retrospective/:id`) is dropped only when its `_rev`
//    is strictly older than the stored one, and the live session row is ahead
//    of the record. So each entry gets `max(archived, stored, live row) + 1`:
//    a client still holding pre-restore state is refused and healed, instead of
//    persisting it over the restore a second later.
//  - **An action created in Jira stays linked.** The team's Jira token is not on
//    the record (`team-secret:{id}`), so a restore never rolls it back, and an
//    action restored without the link it has now would be created in Jira a
//    second time on the next click. The current links are carried onto the
//    archived actions (`carryJiraLinks`); an archived key is never replaced,
//    and an archived "may already be in Jira" marker gives way to a key the
//    action has now.

import { carryJiraLinks } from '../../utils/actionImpact.js';

/**
 * Fields of the live record a restore never rolls back while the team exists.
 * `lastConnectionDate` is when the team was last *used*, and `mergedFrom` is
 * signed provenance written once by a merge: neither is part of the work.
 * `jiraTarget` goes with the team's Jira token, which a restore never touches:
 * an archived target could name a project the current token cannot reach.
 * `jiraClaims` records the issues being created right now; rolled back, an
 * issue in flight could be created a second time.
 */
const KEPT_FROM_CURRENT = Object.freeze([
  'name',
  'passwordHash',
  'inviteEpoch',
  'facilitatorEmail',
  'teamFeedbacks',
  'mergedFrom',
  'lastConnectionDate',
  'jiraTarget',
  'jiraClaims'
]);

/** The two lists whose entries are also `session:{id}` rows. */
const SESSION_LISTS = Object.freeze(['retrospectives', 'healthChecks']);

/** Every list a team record holds: present but not an array is not restorable. */
const TEAM_LISTS = Object.freeze([
  'retrospectives',
  'healthChecks',
  'globalActions',
  'members',
  'archivedMembers',
  'customTemplates',
  'customHealthCheckTemplates',
  'teamFeedbacks'
]);

class TeamRestoreError extends Error {
  constructor(code, status, details = {}) {
    super(code);
    this.name = 'TeamRestoreError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const revOf = (entry) => {
  const rev = Number(entry?._rev);
  return Number.isFinite(rev) ? rev : 0;
};

const countOf = (list) => (Array.isArray(list) ? list.length : 0);

const isTeamShape = (team) =>
  !!team && typeof team === 'object' && typeof team.id === 'string' && team.id !== '' && typeof team.name === 'string';

/** The teams an archive holds, ignoring entries no team record could be. */
const archivedTeams = (archive) => (Array.isArray(archive?.teams) ? archive.teams.filter(isTeamShape) : []);

const findArchivedTeam = (archive, teamId) => archivedTeams(archive).find((team) => team.id === teamId) ?? null;

/**
 * What the console lists for one backup: each team it holds, how much work is
 * in it, and what became of it since — still there, renamed, or deleted (and
 * then whether its name has been taken by another team since).
 *
 * @param {unknown} archive a parsed backup
 * @param {{ id: string, name: string }[]} currentSummaries `loadTeamSummaries()`
 */
const listRestorableTeams = (archive, currentSummaries) => {
  const currentById = new Map();
  const namesInUse = new Map();
  for (const summary of currentSummaries || []) {
    if (!summary || typeof summary.id !== 'string') continue;
    currentById.set(summary.id, summary);
    if (typeof summary.name === 'string') namesInUse.set(summary.name.trim().toLowerCase(), summary.id);
  }

  return archivedTeams(archive)
    .map((team) => {
      const current = currentById.get(team.id);
      const status = !current ? 'deleted' : current.name === team.name ? 'present' : 'renamed';
      const holder = namesInUse.get(team.name.trim().toLowerCase());
      return {
        id: team.id,
        name: team.name,
        status,
        currentName: current ? current.name : null,
        // Only a deleted team has to claim a name back; one that exists keeps its own.
        nameTaken: status === 'deleted' && holder !== undefined && holder !== team.id,
        lastConnectionDate: typeof team.lastConnectionDate === 'string' ? team.lastConnectionDate : null,
        counts: {
          retrospectives: countOf(team.retrospectives),
          healthChecks: countOf(team.healthChecks),
          globalActions: countOf(team.globalActions),
          members: countOf(team.members)
        }
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * The lists of an archived team that are present but not lists. Restoring one
 * would put a value no screen can read into the live record, so the route
 * refuses (422) and names them instead.
 */
const malformedLists = (team) => TEAM_LISTS.filter((key) => team[key] !== undefined && !Array.isArray(team[key]));

/**
 * Builds the record a restore writes.
 *
 * @param {object} input
 * @param {object} input.archived the team as the backup holds it
 * @param {object|null} input.current the live record without `_rev`, or `null` when deleted
 * @param {object[]} input.orphanedFeedbacks `retro-meta.orphanedFeedbacks`
 * @param {Map<string, number>} input.sessionRevs revision of each live `session:{id}` row bound to this team
 * @param {string} [input.name] the name a deleted team comes back under (defaults to its archived one)
 * @returns {{ team: object, targets: Map<string, number>, unorphanedFeedbacks: object[], counts: object }}
 */
const planTeamRestore = ({ archived, current, orphanedFeedbacks, sessionRevs, name }) => {
  if (!isTeamShape(archived)) throw new TeamRestoreError('archived_team_malformed', 422, { fields: ['id'] });
  const malformed = malformedLists(archived);
  if (malformed.length > 0) throw new TeamRestoreError('archived_team_malformed', 422, { fields: malformed });

  // `carryJiraLinks` shares unchanged parts with the archive; the clone below
  // is what keeps the plan from aliasing either input.
  const team = structuredClone(current ? carryJiraLinks(archived, current) : archived);
  delete team._rev;
  delete team._updatedAt;
  team.id = archived.id;

  if (current) {
    for (const key of KEPT_FROM_CURRENT) {
      if (current[key] === undefined) delete team[key];
      else team[key] = structuredClone(current[key]);
    }
  } else {
    team.name = typeof name === 'string' && name.trim() ? name.trim() : archived.name.trim();
    // The archive's feedbacks are never brought back (see the header); the
    // orphaned copies below are the live ones.
    team.teamFeedbacks = [];
  }

  const live = sessionRevs instanceof Map ? sessionRevs : new Map();
  const storedRev = (list, id) => revOf((Array.isArray(current?.[list]) ? current[list] : []).find((entry) => entry?.id === id));
  const targets = new Map();
  for (const list of SESSION_LISTS) {
    if (!Array.isArray(team[list])) continue;
    for (const entry of team[list]) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
      const target = Math.max(revOf(entry), storedRev(list, entry.id), live.get(entry.id) ?? 0) + 1;
      entry._rev = target;
      entry.teamId = team.id;
      targets.set(entry.id, target);
    }
  }

  const ownFeedbacks = Array.isArray(team.teamFeedbacks) ? team.teamFeedbacks : [];
  const ownIds = new Set(ownFeedbacks.map((feedback) => feedback?.id));
  const orphaned = (Array.isArray(orphanedFeedbacks) ? orphanedFeedbacks : [])
    .filter((feedback) => feedback && feedback.teamId === team.id && typeof feedback.id === 'string');
  // Stamped with the restored team's name: the board shows a feedback's own
  // `teamName` first, and a deleted team can come back under a new name while
  // its old one now belongs to another team.
  const recovered = orphaned
    .filter((feedback) => !ownIds.has(feedback.id))
    .map((feedback) => ({ ...structuredClone(feedback), teamName: team.name }));
  if (Array.isArray(team.teamFeedbacks) || recovered.length > 0) {
    team.teamFeedbacks = [...ownFeedbacks, ...recovered];
  }

  return {
    team,
    targets,
    // Every orphan of this team is in the restored record now, the ones it
    // already held included: leaving those in `orphanedFeedbacks` would show
    // them twice on the board. Returned as read, so the route takes off the
    // shared list only the copies nobody has replied to since.
    unorphanedFeedbacks: orphaned,
    counts: {
      retrospectives: countOf(team.retrospectives),
      healthChecks: countOf(team.healthChecks),
      globalActions: countOf(team.globalActions),
      members: countOf(team.members),
      feedbacksRecovered: recovered.length
    }
  };
};

/** The restored entry for a session id, from the record `planTeamRestore` built. */
const restoredSessionEntry = (team, sessionId) => {
  for (const list of SESSION_LISTS) {
    const entry = (Array.isArray(team[list]) ? team[list] : []).find((candidate) => candidate?.id === sessionId);
    if (entry) return entry;
  }
  return null;
};

/** Every retro and health-check id of an archived team, in record order. */
const sessionIdsOf = (team) =>
  SESSION_LISTS.flatMap((list) =>
    (Array.isArray(team?.[list]) ? team[list] : [])
      .filter((entry) => entry && typeof entry.id === 'string')
      .map((entry) => entry.id)
  );

export {
  KEPT_FROM_CURRENT,
  TeamRestoreError,
  findArchivedTeam,
  listRestorableTeams,
  malformedLists,
  planTeamRestore,
  restoredSessionEntry,
  sessionIdsOf
};
