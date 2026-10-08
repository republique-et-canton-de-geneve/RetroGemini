/**
 * Server-side hiding of other participants' ticket text during BRAINSTORM.
 *
 * ## Why this exists
 *
 * The product already hides other people's cards while the team is writing —
 * that is what `settings.revealBrainstorm` is for, and the whole point is that
 * nobody anchors their own thinking on what a colleague just typed. But the
 * hiding was `.ticket-blur` in `index.css`, which is `color: transparent` plus
 * a text-shadow. The text is in the DOM. One devtools inspection, or a single
 * `$$('[data-ticket]').map(e => e.textContent)`, reads the whole board.
 *
 * So the guarantee the UI appears to make was never actually made. This module
 * makes it: while brainstorm is hidden, the text of a ticket you did not write
 * never leaves the server.
 *
 * ## Why gibberish rather than an empty string
 *
 * The client keeps rendering `.ticket-blur` over whatever it receives, and that
 * blur is a *shape* — a transparent glyph with a shadow. Empty strings would
 * collapse every foreign card to an empty box, which reads as "broken" rather
 * than "hidden" and changes the column layout the moment the facilitator
 * reveals. Substituting a string of the same shape keeps the rendered board
 * pixel-identical to today's behaviour, so this is a security change with no
 * visual redesign attached.
 *
 * The substitution preserves whitespace and length per character. That does
 * leak the *silhouette* of a card: a reader can tell a one-word note from a
 * three-line rant. That is the same thing the blur already leaked, it is
 * visible on screen by design, and it is not the thing the hiding protects.
 * Anything that hides length would change the layout on reveal.
 *
 * ## Why it is deterministic
 *
 * Seeded from the ticket id, so the same ticket produces the same filler on
 * every emit. A fresh random draw per broadcast would make every foreign card
 * visibly shimmer on each keystroke anyone made — `SOCKET_UPDATE_RATE` is 0 by
 * default (H11), so that is one re-render per update, per card, for everyone.
 *
 * ## The inbound half is the dangerous half
 *
 * Read `restoreForeignTicketText` before changing anything here. Clients sync
 * the *whole session blob* back over `update-session`, so a client holding
 * redacted text will hand that redacted text back to the server as if it were
 * real. Redacting outbound without restoring inbound destroys the board.
 */

/** Fields redacted here. Kept as a list so the restore half cannot drift. */
const REDACTED_TICKET_FIELDS = ['text'];

/**
 * True when the session is in the phase whose entire purpose is that people
 * write without seeing each other.
 *
 * Note this is evaluated against a *session*, and every caller must be
 * deliberate about which one. Outbound: the state being sent. Inbound: the
 * **authoritative** (pre-update) state, never the client's blob — the write
 * that flips `revealBrainstorm` to true arrives from a client that still holds
 * redacted text, and judging that write by its own payload would conclude
 * "reveal is on, nothing to restore" and persist the filler over the real
 * board. That is the one mistake in this file that silently loses data.
 */
export const isBrainstormHidden = (session) =>
  !!session &&
  session.phase === 'BRAINSTORM' &&
  session.settings?.revealBrainstorm !== true;

/**
 * FNV-1a over the ticket id. Any stable hash would do; this one is three lines
 * and has no dependency.
 */
const seedFrom = (id) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < String(id).length; i++) {
    hash ^= String(id).charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash || 0x811c9dc5;
};

/** xorshift32. Deterministic given the seed, which is the whole requirement. */
const nextRandom = (state) => {
  let x = state;
  x ^= x << 13; x >>>= 0;
  x ^= x >> 17;
  x ^= x << 5;  x >>>= 0;
  return x || 1;
};

const LOWER = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Replace every letter and digit with a stable pseudorandom lowercase letter,
 * leaving whitespace and punctuation in place.
 *
 * Whitespace survives so word and line structure — and therefore the wrapped
 * height of the card — is unchanged. Punctuation survives for the same reason
 * and carries no content on its own.
 */
export const gibberishFor = (text, id) => {
  if (typeof text !== 'string' || text.length === 0) return text;

  let state = seedFrom(id);
  let out = '';

  for (const char of text) {
    if (/\s/.test(char) || !/[\p{L}\p{N}]/u.test(char)) {
      out += char;
      continue;
    }
    state = nextRandom(state);
    out += LOWER[state % LOWER.length];
  }

  return out;
};

/**
 * A copy of `session` in which tickets written by somebody other than
 * `viewerId` carry filler instead of their text.
 *
 * Returns the session unchanged (same reference) when there is nothing to do,
 * so the common path — every phase that is not a hidden brainstorm — costs one
 * comparison and no allocation.
 *
 * Only `tickets[].text` is redacted. Ticket comments are deliberately not
 * touched: they are written in DISCUSS, by which point brainstorm is long
 * revealed, so redacting them would add a second field to keep in sync across
 * both halves of this module for a case the product cannot currently reach. If
 * commenting ever becomes possible during BRAINSTORM, this decision has to be
 * revisited in both `redactSessionFor` and `restoreForeignTicketText`.
 */
export const redactSessionFor = (session, viewerId) => {
  if (!isBrainstormHidden(session)) return session;
  if (!Array.isArray(session.tickets) || session.tickets.length === 0) return session;

  let changed = false;
  const tickets = session.tickets.map((ticket) => {
    if (!ticket || ticket.authorId === viewerId) return ticket;

    let redacted = ticket;
    for (const field of REDACTED_TICKET_FIELDS) {
      if (typeof ticket[field] !== 'string' || ticket[field].length === 0) continue;
      if (redacted === ticket) redacted = { ...ticket };
      redacted[field] = gibberishFor(ticket[field], ticket.id);
      changed = true;
    }
    return redacted;
  });

  return changed ? { ...session, tickets } : session;
};

/**
 * Put the real text back on every ticket in `incoming` that `senderId` did not
 * write, taking it from `authoritative`.
 *
 * This is what makes the outbound redaction safe. Every client holds the whole
 * session and writes the whole session back, so a participant who adds one card
 * of their own also re-submits the filler it was given for everyone else's. Left
 * alone, the first write after redaction starts would overwrite the entire board
 * with gibberish and the CAS would happily accept it — the revision is current,
 * the shape is valid, and nothing else in the pipeline compares text.
 *
 * Restoring unconditionally (rather than comparing against the expected filler)
 * is deliberate: it means a client *cannot* alter text it was never shown, no
 * matter what it sends. The invariant is "you may only change the text of a
 * ticket you wrote", and while brainstorm is hidden that holds for the
 * facilitator too — who cannot read those cards either, so has nothing
 * meaningful to edit.
 *
 * Tickets absent from `authoritative` keep whatever they arrived with: a ticket
 * the server has never seen has no real text to restore, and it is the sender's
 * own new card in every path that reaches here.
 */
export const restoreForeignTicketText = (incoming, authoritative, senderId) => {
  if (!isBrainstormHidden(authoritative)) return incoming;
  if (!incoming || !Array.isArray(incoming.tickets)) return incoming;

  const authoritativeById = new Map(
    (authoritative.tickets ?? []).map((ticket) => [ticket?.id, ticket])
  );

  let changed = false;
  const tickets = incoming.tickets.map((ticket) => {
    if (!ticket || ticket.authorId === senderId) return ticket;

    const original = authoritativeById.get(ticket.id);
    if (!original) return ticket;

    let restored = ticket;
    for (const field of REDACTED_TICKET_FIELDS) {
      if (ticket[field] === original[field]) continue;
      if (restored === ticket) restored = { ...ticket };
      restored[field] = original[field];
      changed = true;
    }
    return restored;
  });

  return changed ? { ...incoming, tickets } : incoming;
};
