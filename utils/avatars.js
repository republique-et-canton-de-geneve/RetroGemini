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

const family = (id, avatars) => Object.freeze({ id, avatars: Object.freeze(avatars) });

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
// than erase it. It is never drawn unless the families have it.
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
  if (!team || typeof team !== 'object' || typeof memberId !== 'string') return null;
  const map = team.memberAvatars;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  if (!Object.prototype.hasOwnProperty.call(map, memberId)) return null;
  const entry = map[memberId];
  return isMemberAvatarEntry(entry) ? { id: entry.id, at: entry.at } : null;
};

/**
 * The avatar a member chose that this release can draw, or `null`.
 *
 * @param {unknown} team
 * @param {unknown} memberId
 * @returns {string | null}
 */
export const memberAvatarId = (team, memberId) => toAvatarId(memberAvatar(team, memberId)?.id);
