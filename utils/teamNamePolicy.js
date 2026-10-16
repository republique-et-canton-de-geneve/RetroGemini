/**
 * The longest team name a write path accepts, written once for the server and
 * the screens (like `passwordPolicy.js`).
 *
 * `/api/send-password-reset` refuses a longer name, so a team named beyond it
 * could never receive a reset mail. The merge enforces it on the name it gives
 * the merged team, and the merge dialog states it.
 */
export const TEAM_NAME_MAX_LENGTH = 200;
