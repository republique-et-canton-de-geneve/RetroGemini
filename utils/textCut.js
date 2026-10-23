/**
 * Cutting text that is stored, without ever halving an emoji.
 *
 * `text.slice(0, n)` and `substring` count UTF-16 code units, so a cut can
 * keep the first half of a surrogate pair. Text cut that way and stored in a
 * team record — an action's context quote, a feedback's title, description or
 * comment, an AI-suggested group title — ends in a lone surrogate, which
 * Node's `JSON.stringify` writes as the escape `\ud83d`: text PostgreSQL's
 * `::jsonb` refuses. Every read that projects the record there then failed —
 * the login picker for every team, and the summary a socket join reads the
 * joiner's role from. Plain JS because the browser and the server both use it.
 */

/** The longest quote of a card, in UTF-16 code units. */
export const TICKET_QUOTE_MAX_LENGTH = 50;

/**
 * The first `max` UTF-16 code units of `text`, one fewer when the cut would
 * fall inside a surrogate pair: an emoji is dropped whole, never halved.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export const cutCodeUnits = (text, max) => {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? max - 1 : max);
};

/**
 * A card's text as the session screens quote it in an action's context
 * ("Re: …"): cut at `TICKET_QUOTE_MAX_LENGTH`, marked `...` when it was
 * longer. The Jira description does not use it: an issue quotes the card whole
 * (`utils/jiraIssueContent.js`, maintainer decision 2026-10-22).
 *
 * @param {string} text
 * @returns {string}
 */
export const ticketQuote = (text) =>
  `${cutCodeUnits(text, TICKET_QUOTE_MAX_LENGTH)}${text.length > TICKET_QUOTE_MAX_LENGTH ? '...' : ''}`;
