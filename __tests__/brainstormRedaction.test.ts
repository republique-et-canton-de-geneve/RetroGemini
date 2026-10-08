import { describe, it, expect } from 'vitest';
import {
  isBrainstormHidden,
  gibberishFor,
  redactSessionFor,
  restoreForeignTicketText
} from '../server/services/brainstormRedaction.js';

const ALICE = 'user-alice';
const BOB = 'user-bob';

const session = (overrides = {}) => ({
  id: 'session-1',
  phase: 'BRAINSTORM',
  settings: { revealBrainstorm: false },
  tickets: [
    { id: 't1', colId: 'c1', text: 'Too many meetings', authorId: ALICE, groupId: null, votes: [] },
    { id: 't2', colId: 'c1', text: 'Deploys are slow', authorId: BOB, groupId: null, votes: [] }
  ],
  ...overrides
});

const textOf = (s: any, id: string) => s.tickets.find((t: any) => t.id === id).text;

describe('isBrainstormHidden', () => {
  it('is true only while BRAINSTORM is unrevealed', () => {
    expect(isBrainstormHidden(session())).toBe(true);
    expect(isBrainstormHidden(session({ settings: { revealBrainstorm: true } }))).toBe(false);
    expect(isBrainstormHidden(session({ phase: 'GROUP' }))).toBe(false);
    expect(isBrainstormHidden(null)).toBe(false);
  });

  it('treats a missing reveal flag as hidden, so a malformed blob fails closed', () => {
    expect(isBrainstormHidden(session({ settings: {} }))).toBe(true);
    expect(isBrainstormHidden({ phase: 'BRAINSTORM' })).toBe(true);
  });
});

describe('gibberishFor', () => {
  it('is deterministic, so cards do not shimmer on every re-emit', () => {
    expect(gibberishFor('Too many meetings', 't1')).toBe(gibberishFor('Too many meetings', 't1'));
  });

  it('differs per ticket, so equal text is not recognisably equal', () => {
    expect(gibberishFor('same text', 't1')).not.toBe(gibberishFor('same text', 't2'));
  });

  it('preserves length and whitespace so the blurred layout is unchanged', () => {
    const filler = gibberishFor('Too many meetings\nand slow deploys', 't1');
    expect(filler).toHaveLength('Too many meetings\nand slow deploys'.length);
    expect(filler.split(/\s/).map(w => w.length)).toEqual(
      'Too many meetings\nand slow deploys'.split(/\s/).map(w => w.length)
    );
    expect(filler).toContain('\n');
  });

  it('leaks none of the original letters', () => {
    expect(gibberishFor('Too many meetings', 't1')).not.toMatch(/meetings/i);
  });
});

describe('redactSessionFor', () => {
  it("replaces other people's ticket text and keeps your own", () => {
    const redacted = redactSessionFor(session(), ALICE);
    expect(textOf(redacted, 't1')).toBe('Too many meetings');
    expect(textOf(redacted, 't2')).not.toBe('Deploys are slow');
    expect(textOf(redacted, 't2')).toHaveLength('Deploys are slow'.length);
  });

  it('redacts the other direction for the other participant', () => {
    const redacted = redactSessionFor(session(), BOB);
    expect(textOf(redacted, 't1')).not.toBe('Too many meetings');
    expect(textOf(redacted, 't2')).toBe('Deploys are slow');
  });

  it('leaves everything alone once revealed, or past BRAINSTORM', () => {
    const revealed = session({ settings: { revealBrainstorm: true } });
    expect(redactSessionFor(revealed, ALICE)).toBe(revealed);

    const grouping = session({ phase: 'GROUP' });
    expect(redactSessionFor(grouping, ALICE)).toBe(grouping);
  });

  it('does not mutate the session it was given', () => {
    const original = session();
    redactSessionFor(original, ALICE);
    expect(textOf(original, 't2')).toBe('Deploys are slow');
  });

  it('redacts every ticket for a viewer with no id rather than failing open', () => {
    const redacted = redactSessionFor(session(), undefined);
    expect(textOf(redacted, 't1')).not.toBe('Too many meetings');
    expect(textOf(redacted, 't2')).not.toBe('Deploys are slow');
  });
});

describe('restoreForeignTicketText', () => {
  it("restores text the sender was never shown, keeping the sender's own edit", () => {
    const authoritative = session();
    // What Alice's client sends back: her own new wording, plus the filler it
    // was served for Bob's card.
    const incoming = session({
      tickets: [
        { ...authoritative.tickets[0], text: 'Too many meetings, badly run' },
        { ...authoritative.tickets[1], text: gibberishFor('Deploys are slow', 't2') }
      ]
    });

    const guarded = restoreForeignTicketText(incoming, authoritative, ALICE);
    expect(textOf(guarded, 't1')).toBe('Too many meetings, badly run');
    expect(textOf(guarded, 't2')).toBe('Deploys are slow');
  });

  it('survives the reveal write, which carries reveal:true and stale filler', () => {
    // The regression this module exists to prevent: the facilitator flips the
    // toggle from a client that still holds gibberish. Judged by its own
    // payload the write looks revealed, so nothing would be restored.
    const authoritative = session();
    const incoming = {
      ...session({ settings: { revealBrainstorm: true } }),
      tickets: [
        { ...authoritative.tickets[0], text: gibberishFor('Too many meetings', 't1') },
        { ...authoritative.tickets[1], text: 'Deploys are slow' }
      ]
    };

    const guarded = restoreForeignTicketText(incoming, authoritative, BOB);
    expect(textOf(guarded, 't1')).toBe('Too many meetings');
    expect(textOf(guarded, 't2')).toBe('Deploys are slow');
    expect(guarded.settings.revealBrainstorm).toBe(true);
  });

  it('refuses a rewrite of a ticket the sender does not own', () => {
    const authoritative = session();
    const incoming = session({
      tickets: [
        authoritative.tickets[0],
        { ...authoritative.tickets[1], text: 'I decided Bob meant something else' }
      ]
    });

    expect(textOf(restoreForeignTicketText(incoming, authoritative, ALICE), 't2'))
      .toBe('Deploys are slow');
  });

  it('keeps a brand new ticket the server has not seen', () => {
    const authoritative = session();
    const incoming = session({
      tickets: [
        ...authoritative.tickets,
        { id: 't3', colId: 'c1', text: 'Fresh idea', authorId: ALICE, groupId: null, votes: [] }
      ]
    });

    expect(textOf(restoreForeignTicketText(incoming, authoritative, ALICE), 't3')).toBe('Fresh idea');
  });

  it('allows deletion, which is structural rather than a text change', () => {
    const authoritative = session();
    const incoming = session({ tickets: [authoritative.tickets[0]] });
    expect(restoreForeignTicketText(incoming, authoritative, ALICE).tickets).toHaveLength(1);
  });

  it('does nothing once the board is already revealed', () => {
    const authoritative = session({ settings: { revealBrainstorm: true } });
    const incoming = session({
      settings: { revealBrainstorm: true },
      tickets: [
        authoritative.tickets[0],
        { ...authoritative.tickets[1], text: 'edited after reveal' }
      ]
    });

    expect(textOf(restoreForeignTicketText(incoming, authoritative, ALICE), 't2'))
      .toBe('edited after reveal');
  });
});

describe('the round trip that loses the board if either half is missing', () => {
  it('survives every participant writing while hidden', () => {
    let server = session({ tickets: [] });

    // Alice writes. Her client held nothing, so nothing to restore.
    const alicesView = redactSessionFor(server, ALICE);
    server = restoreForeignTicketText(
      { ...alicesView, tickets: [{ id: 't1', text: 'Too many meetings', authorId: ALICE }] },
      server,
      ALICE
    );

    // Bob receives a redacted board, then writes his own card and syncs the
    // whole blob back — filler for Alice's card included.
    const bobsView = redactSessionFor(server, BOB);
    expect(bobsView.tickets[0].text).not.toBe('Too many meetings');

    server = restoreForeignTicketText(
      { ...bobsView, tickets: [...bobsView.tickets, { id: 't2', text: 'Deploys are slow', authorId: BOB }] },
      server,
      BOB
    );

    // Facilitator reveals, from a client that also held filler.
    const revealWrite = { ...redactSessionFor(server, ALICE), settings: { revealBrainstorm: true } };
    server = restoreForeignTicketText(revealWrite, server, ALICE);

    expect(textOf(server, 't1')).toBe('Too many meetings');
    expect(textOf(server, 't2')).toBe('Deploys are slow');
  });
});
