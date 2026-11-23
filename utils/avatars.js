/**
 * The avatars a person may choose, and the readers of the team's choices.
 *
 * A choice is stored on the team record as `memberAvatars[memberId] =
 * { id, at }`: the avatar id, or `null` for "my initials", and the server's
 * time of the choice in milliseconds, which is what lets the newer choice win
 * over a stale copy anywhere. It is written by one route
 * (`server/routes/teamAvatarRoutes.js`) and read here, on both sides — plain JS
 * for the reason `passwordPolicy.js` is.
 *
 * Every value read here is data any holder of a team credential can write, so
 * it is compared against a closed list, never used as a key of a plain object,
 * a class, a URL part or a message key.
 */

import { isValidRaterId } from './actionImpact.js';

const family =(id, avatars) => Object.freeze({ id, avatars: Object.freeze(avatars) });

/** The six families in the order the picker shows them, twenty avatars each. */
export const AVATAR_FAMILIES = Object.freeze([
  family('animals', [
    'fox', 'owl', 'cat', 'whale', 'frog', 'bee', 'bear', 'penguin', 'rabbit', 'turtle',
    'octopus', 'hedgehog', 'koala', 'snail', 'ladybug', 'fish', 'duck', 'crab', 'butterfly', 'bat'
  ]),
  family('monsters', [
    'bubble', 'cobble', 'pointy', 'spinner', 'eureka', 'puddle', 'quirky', 'zigzag', 'gizmo', 'periscope',
    'long-ears', 'comma', 'tickles', 'tandem', 'wide-angle', 'pompom', 'tuft', 'leggy', 'toffee', 'little-bridge'
  ]),
  family('objects', [
    'sticky-note', 'mug', 'light-bulb', 'rocket', 'cactus', 'pencil', 'cloud', 'star', 'book', 'alarm-clock',
    'seedling', 'paper-plane', 'magnet', 'key', 'umbrella', 'balloon', 'flask', 'kite', 'puzzle-piece', 'lightning'
  ]),
  family('shapes', [
    'sun', 'arch', 'waves', 'grid', 'spiral', 'peaks', 'petals', 'cube', 'drop', 'hourglass',
    'orbit', 'stairs', 'leaf', 'diamond', 'loop', 'cairn', 'fan', 'overlap', 'seesaw', 'lifebuoy'
  ]),
  family('nature', [
    'moon', 'comet', 'snowflake', 'tornado', 'snowman', 'thermometer', 'volcano', 'campfire', 'crystal', 'fir-tree',
    'mushroom', 'acorn', 'log', 'tulip', 'water-lily', 'cherries', 'island', 'seashell', 'sailboat', 'lighthouse'
  ]),
  family('games', [
    'dice', 'pawn', 'domino', 'knight', 'rook', 'brick', 'gamepad', 'joystick', 'bowling-pin', 'paddle',
    'shuttlecock', 'boomerang', 'basketball-hoop', 'curling-stone', 'whistle', 'medal', 'trophy', 'jersey',
    'jack-in-the-box', 'roller-skate'
  ])
]);

/** Every avatar id, family by family. */
export const AVATAR_IDS = Object.freeze(AVATAR_FAMILIES.flatMap((entry) => entry.avatars));

// A Set, so `has` compares strings: no key of Object.prototype can match.
const AVATAR_ID_SET = new Set(AVATAR_IDS);

/**
 * Ids this release accepts from the route but neither offers nor draws.
 * Adding a picture takes two releases, because during a rolling update a new
 * tab's pick can reach an older pod: first, a release puts its id here only
 * (every pod then accepts it); next, a release moves it into its family, with
 * its art and its names in both languages, and the picker offers it.
 */
export const ACCEPTED_ONLY_AVATAR_IDS = Object.freeze([]);

/** Every id the route accepts: the offered ones, then the accepted-only ones. */
export const ACCEPTED_AVATAR_IDS = Object.freeze([...AVATAR_IDS, ...ACCEPTED_ONLY_AVATAR_IDS]);

const ACCEPTED_AVATAR_ID_SET = new Set(ACCEPTED_AVATAR_IDS);

// The shape of an id some release may store. Wider than the lists on purpose:
// a tab or pod that does not know a newer id must keep it as stored rather
// than erase it. It is never drawn unless the families have it. Frozen: every
// release from 45.0 on drops an entry of any other shape, so a new id must
// fit this one; widened here, it would not reach the pods already running
// (__tests__/avatars.test.ts holds the shape).
const STORED_AVATAR_ID = /^[a-z]+(-[a-z]+)*$/;
const STORED_AVATAR_ID_MAX_LENGTH = 64;

/**
 * True when `value` is an avatar of this release's list.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isAvatarId = (value) => typeof value === 'string' && AVATAR_ID_SET.has(value);

/**
 * True when the route may store `value`: an offered id, or one this release
 * accepts before a later one offers it (`ACCEPTED_ONLY_AVATAR_IDS`).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isAcceptedAvatarId = (value) => typeof value === 'string' && ACCEPTED_AVATAR_ID_SET.has(value);

/**
 * The avatar id `value` names, or `null` for anything this release cannot
 * draw. Applied where an avatar is drawn, never where one is copied.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export const toAvatarId = (value) => (isAvatarId(value) ? value : null);

/**
 * True when `value` is a date a choice can carry: whole milliseconds that a
 * number counts exactly, not negative. The newer date wins everywhere, and
 * the route dates a pick one millisecond after the choice it replaces at the
 * least, so a number with no next one is not a date: nothing could be dated
 * after a stored 1e300 (1e300 + 1 is 1e300), and it outranked every later
 * choice for good. The map can hold what the route never wrote (the update
 * route of a pod from before 45.0 spreads unknown keys, an archive is a
 * file), and a participant entry is written by every client.
 *
 * @param {unknown} value
 * @returns {value is number}
 */
export const isAvatarTime = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * True when `value` is a stored choice: `{ id, at }` with `id` null or an id
 * of the stored shape, and `at` a date (`isAvatarTime`). Extra fields are
 * ignored, so a later release may add one.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export const isMemberAvatarEntry = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { id, at } = value;
  if (!isAvatarTime(at)) return false;
  if (id === null) return true;
  return typeof id === 'string' && id.length <= STORED_AVATAR_ID_MAX_LENGTH && STORED_AVATAR_ID.test(id);
};

// The team's `memberAvatars` when it is a map (an object that is not an
// array), or null: what every reader below starts from.
const avatarMapOf = (team) => {
  if (!team || typeof team !== 'object') return null;
  const map = team.memberAvatars;
  return map && typeof map === 'object' && !Array.isArray(map) ? map : null;
};

/**
 * A member's stored choice, `{ id, at }` (a copy), or `null` when there is
 * none or what is stored is not one. Read as an own property of a plain
 * object, so an inherited key never answers.
 *
 * @param {unknown} team
 * @param {unknown} memberId
 * @returns {{ id: string | null, at: number } | null}
 */
export const memberAvatar = (team, memberId) => {
  if (typeof memberId !== 'string') return null;
  const map = avatarMapOf(team);
  if (!map || !Object.prototype.hasOwnProperty.call(map, memberId)) return null;
  const entry = map[memberId];
  return isMemberAvatarEntry(entry) ? { id: entry.id, at: entry.at } : null;
};

/**
 * Every valid choice of the team's map, as `[memberId, { id, at }]` pairs
 * (copies) in stored order: a key that is not a plausible member id
 * (`isValidRaterId`, which refuses `__proto__` and its kin) or an entry that
 * is not a stored choice (`isMemberAvatarEntry`) is left out. The one reader
 * of the whole map: the avatar route rebuilds the map from it on every pick,
 * which is how junk heals, and a merge of two teams carries what it answers,
 * so neither keeps what the other drops. Pairs, not an object: a key is data,
 * never a property write (build a `Map` or use `Object.fromEntries`).
 *
 * @param {unknown} team
 * @returns {Array<[string, { id: string | null, at: number }]>}
 */
export const memberAvatarEntries = (team) => {
  const map = avatarMapOf(team);
  if (!map) return [];
  const entries = [];
  for (const [memberId, entry] of Object.entries(map)) {
    if (isValidRaterId(memberId) && isMemberAvatarEntry(entry)) entries.push([memberId, { id: entry.id, at: entry.at }]);
  }
  return entries;
};

// A choice's date when two copies of one member's choice are compared: the
// date itself, but the largest a number counts exactly ranks below every
// other. It has no next one, so the route dates the pick that replaces it by
// its clock alone, and the copy that carries that pick is the newer word.
const choiceRank = (at) => (isAvatarTime(at + 1) ? at : -1);

/**
 * The team's map with `answered`, a map the avatar route answered, merged
 * into it member by member: for each member the newer of the two valid
 * entries (`memberAvatarEntries`), the answered one on a tie, and a member
 * only one side holds is kept. The answer is the map as the route stored it
 * at that pick's write, while the team may have been read later (a refresh
 * answered first) and hold a later choice of another member: taken whole,
 * the answer put that member back to their older choice until the next
 * refresh. A new object; the team and its map are left as they were.
 *
 * @param {unknown} team
 * @param {unknown} answered
 * @returns {Record<string, { id: string | null, at: number }>}
 */
export const mergeMemberAvatars = (team, answered) => {
  const merged = new Map(memberAvatarEntries(team));
  for (const [memberId, entry] of memberAvatarEntries({ memberAvatars: answered })) {
    const kept = merged.get(memberId);
    if (!kept || choiceRank(entry.at) >= choiceRank(kept.at)) merged.set(memberId, entry);
  }
  return Object.fromEntries(merged);
};

/**
 * The ids on the team's two roster lists, `members` and `archivedMembers`: an
 * id held by a row that is an object (not an array) with a string `id`. What
 * "on the roster" means wherever the avatar map is bounded or re-keyed: past
 * the route's cap an entry for an id on neither list goes first, and a merge
 * never carries such an entry onto the other team's member of that id.
 *
 * @param {unknown} team
 * @returns {Set<string>}
 */
export const rosterIds = (team) => {
  const ids = new Set();
  if (!team || typeof team !== 'object') return ids;
  for (const list of [team.members, team.archivedMembers]) {
    if (!Array.isArray(list)) continue;
    for (const member of list) {
      if (member && typeof member === 'object' && !Array.isArray(member) && typeof member.id === 'string') ids.add(member.id);
    }
  }
  return ids;
};

/**
 * The avatar a member chose that this release can draw, or `null`.
 *
 * @param {unknown} team
 * @param {unknown} memberId
 * @returns {string | null}
 */
export const memberAvatarId = (team, memberId) => toAvatarId(memberAvatar(team, memberId)?.id);
