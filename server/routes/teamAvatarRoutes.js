import rateLimit from 'express-rate-limit';
import { isValidRaterId } from '../../utils/actionImpact.js';
import { isAcceptedAvatarId, isAvatarTime, isMemberAvatarEntry, memberAvatar } from '../../utils/avatars.js';
import { NO_OP_LIVE_SESSION_PATCH } from '../services/liveSessionRename.js';

/**
 * One person's avatar (AGENTS.md, *Avatars*).
 *
 * The choice is `memberAvatars[memberId] = { id, at }` on the team record — a
 * top-level key, not a field of the member row, because `/members` replaces
 * the rows wholesale with whatever roster a client cached: a stale tab or two
 * overlapping joins would lose a value kept there, and no rule in that route
 * can keep the value of a row a post omits. This route is the only writer, and
 * `/update` ignores the key, as it ignores the Jira ones.
 *
 * `at` is this server's clock, and the newer `at` wins everywhere: a browser
 * holding an old copy of the team never pushes an old choice back, and two
 * browsers of one person write the same value, so the session copies need no
 * own-change ledger slice. A clear is stored as `{ id: null, at }` rather than
 * removed, so it too is newer than every copy of the choice it replaces.
 */

// Far more people than any team has: a bound on what one credential can make
// the record carry, not a roster rule.
const MEMBER_AVATARS_MAX = 500;

// A session id as the store keys it (`session:{id}`). Ignored, not refused,
// when it is anything else: the pick itself is still valid.
const SESSION_ID_MAX_LENGTH = 128;
const isSessionId = (value) => typeof value === 'string' && value.length > 0 && value.length <= SESSION_ID_MAX_LENGTH;

const rosterIdsOf = (team) => {
  const ids = new Set();
  for (const list of [team?.members, team?.archivedMembers]) {
    if (!Array.isArray(list)) continue;
    for (const member of list) if (member && typeof member.id === 'string') ids.add(member.id);
  }
  return ids;
};

// The stored map's valid entries, in their stored order. Built through a Map,
// so a caller-supplied key is data and never a property write; a key that is
// not a plausible member id (`__proto__` among them) or an entry that is not
// `{ id, at }` is dropped, which is how junk any path left heals.
const validEntriesOf = (team) => {
  const entries = new Map();
  const map = team?.memberAvatars;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return entries;
  for (const [memberId, entry] of Object.entries(map)) {
    if (isValidRaterId(memberId) && isMemberAvatarEntry(entry)) entries.set(memberId, { id: entry.id, at: entry.at });
  }
  return entries;
};

/**
 * The map after `memberId` chose `avatar` (an id, or `null` for none) at
 * `now`, or `null` when that is the stored choice already. Pure: it runs
 * inside the team's update, under the row lock.
 *
 * Bounded by `max`: past it, entries for ids on neither roster list go first,
 * then the oldest of the rest, never the one just written. An off-roster
 * entry is not dropped below the bound, because a member row can be missing
 * for a while (a stale roster post) and come back with its id.
 */
const nextMemberAvatars = (team, memberId, avatar, now, { max = MEMBER_AVATARS_MAX } = {}) => {
  const current = memberAvatar(team, memberId);
  if (current ? current.id === avatar : avatar === null) return null;

  const entries = validEntriesOf(team);
  entries.delete(memberId);
  // Never dated before the choice it replaces, whatever this pod's clock says
  // against the pod that wrote it. The largest date a number counts exactly
  // has no next one: the pick is then dated by this clock alone, and the
  // stamp below treats a copy of the old date as far ahead of it.
  const after = current ? current.at + 1 : now;
  const at = isAvatarTime(after) ? Math.max(now, after) : now;
  entries.set(memberId, { id: avatar, at });

  if (entries.size > max) {
    const roster = rosterIdsOf(team);
    const byAge = [...entries].filter(([id]) => id !== memberId).sort((a, b) => a[1].at - b[1].at);
    for (const [id] of byAge.filter(([candidate]) => !roster.has(candidate))) {
      if (entries.size <= max) break;
      entries.delete(id);
    }
    for (const [id] of byAge) {
      if (entries.size <= max) break;
      entries.delete(id);
    }
  }
  return Object.fromEntries(entries);
};

const toAnsweredMap = (team) => Object.fromEntries(validEntriesOf(team));

// How far ahead of this pod's clock a stamp another pod wrote can be: the
// difference between two pods' clocks, with room to spare.
const STAMP_CLOCK_SLACK_MS = 5 * 60 * 1000;

/**
 * The live session with `memberId`'s participant copy stamped with `entry`,
 * or `null` when there is nothing to change: no such participant (nobody is
 * added here), or a copy whose stamp is as new or newer. A new session and a
 * new entry object; the others are kept as they were. The team check is the
 * patch's own (`createLiveSessionPatch`).
 *
 * A participant entry is data: every client of the session writes it, its
 * avatar's time included. This route dates its stamps with the server's clock
 * (never before the choice they replace), so a stored stamp far ahead of both
 * `now` and the choice being stamped is not one it wrote, and does not
 * outrank it. Left to stand, such a stamp kept every later pick of that
 * person out of the session for as long as the session lived.
 */
const stampParticipantAvatar = (session, memberId, entry, now = Date.now()) => {
  if (!session || !Array.isArray(session.participants)) return null;
  const index = session.participants.findIndex((participant) => participant && participant.id === memberId);
  if (index === -1) return null;
  const participant = session.participants[index];
  const stampedAt = isAvatarTime(participant.avatarAt) ? participant.avatarAt : 0;
  const writtenHere = stampedAt <= Math.max(now, entry.at) + STAMP_CLOCK_SLACK_MS;
  if (writtenHere && stampedAt >= entry.at) return null;
  const participants = [...session.participants];
  participants[index] = { ...participant, avatar: entry.id, avatarAt: entry.at };
  return { ...session, participants };
};

const registerTeamAvatarRoutes = ({ app, authenticateTeam, atomicUpdateTeam, liveSessionPatch = NO_OP_LIVE_SESSION_PATCH }) => {
  // Created here, like every route module's own limiter (see the template
  // routes for why it is not passed in). Same budget as the team writes.
  const avatarWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/team/:teamId/member/avatar', avatarWriteLimiter, async (req, res) => {
    try {
      const { teamId } = req.params;
      const { password, sessionToken, memberId, avatar, sessionId } = req.body || {};

      // The credential first, so an anonymous caller learns nothing about
      // which ids or avatars exist.
      const { error } = await authenticateTeam(teamId, password, sessionToken, { needsTeam: false });
      if (error) {
        return res.status(401).json({ error });
      }

      // No check that the member row exists: a row can be missing for a while
      // (a stale roster post), and requiring it would refuse real members.
      if (!isValidRaterId(memberId)) {
        return res.status(400).json({ error: 'invalid_member' });
      }
      // Refused, never coerced: an id this pod does not know may be one a
      // later release offers, and writing it as "none" would erase a choice.
      // The accepted list may be wider than the offered one (two releases per
      // picture, utils/avatars.js → ACCEPTED_ONLY_AVATAR_IDS).
      if (avatar !== null && !isAcceptedAvatarId(avatar)) {
        return res.status(400).json({ error: 'invalid_avatar' });
      }

      let answered = null;
      let entry = null;
      const result = await atomicUpdateTeam(teamId, (currentTeam) => {
        const next = nextMemberAvatars(currentTeam, memberId, avatar, Date.now());
        if (!next) {
          answered = toAnsweredMap(currentTeam);
          entry = memberAvatar(currentTeam, memberId);
          return null;
        }
        answered = next;
        entry = next[memberId];
        return { ...currentTeam, memberAvatars: next };
      });

      if (!result.success) {
        return res.status(500).json({ error: result.error });
      }

      res.json({ success: true, memberAvatars: answered });

      // After the answer, best-effort, in its own catch (a handler must not
      // throw once it has answered): the session the pick came from learns it
      // now rather than when the person next enters it. Also when the choice
      // was stored already, which heals a session a lost patch left behind.
      if (isSessionId(sessionId) && entry) {
        const stamp = entry;
        Promise.resolve()
          .then(() => liveSessionPatch({
            teamId,
            sessionId,
            purpose: 'Avatar',
            mutate: (current) => stampParticipantAvatar(current, memberId, stamp)
          }))
          .catch((patchErr) => {
            console.warn('[Server] Failed to carry an avatar into the live session', patchErr);
          });
      }
    } catch (err) {
      console.error('[Server] Failed to save avatar', err);
      if (!res.headersSent) res.status(500).json({ error: 'failed_to_update' });
    }
  });
};

export { registerTeamAvatarRoutes, nextMemberAvatars, stampParticipantAvatar, MEMBER_AVATARS_MAX };
