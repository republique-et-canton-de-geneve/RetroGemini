import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { cutCodeUnits, ticketQuote, TICKET_QUOTE_MAX_LENGTH } from '../utils/textCut.js';
import { actionContextText } from '../utils/jiraIssueContent.js';

/**
 * An action's context quotes the card it was written against ("Re: …"), cut
 * at 50 characters. The cut was `text.substring(0, 50)`: an emoji whose first
 * half sits at index 49 left that half alone at the end of the quote. The
 * context is stored on the action and in the session snapshots, so the half
 * reached the team record, where Node writes it as the escape `\ud83d` — text
 * PostgreSQL's `::jsonb` refuses, which broke every read that projects the
 * record there: the login picker, and the summary a socket join reads the
 * joiner's role from.
 */

// A lone surrogate: in `u` mode a paired one is one code point, not `Cs`.
const LONE_SURROGATE = /\p{Cs}/u;

describe('ticketQuote', () => {
  it('never ends in half of an emoji', () => {
    const text = `${'a'.repeat(49)}😀 and more`;
    const quote = ticketQuote(text);
    expect(LONE_SURROGATE.test(quote)).toBe(false);
    expect(quote).toBe(`${'a'.repeat(49)}...`);
    // What the old cut produced, for the record.
    expect(LONE_SURROGATE.test(text.substring(0, 50))).toBe(true);
  });

  it('keeps an emoji the cut does not split, and counts it as two characters', () => {
    expect(ticketQuote(`${'a'.repeat(48)}😀 and more`)).toBe(`${'a'.repeat(48)}😀...`);
  });

  it('leaves a card of at most 50 characters as it is', () => {
    expect(ticketQuote('Short card')).toBe('Short card');
    expect(ticketQuote('b'.repeat(TICKET_QUOTE_MAX_LENGTH))).toBe('b'.repeat(TICKET_QUOTE_MAX_LENGTH));
    expect(ticketQuote(`${'b'.repeat(TICKET_QUOTE_MAX_LENGTH)}c`)).toBe(`${'b'.repeat(TICKET_QUOTE_MAX_LENGTH)}...`);
  });

  it('cuts by UTF-16 unit and drops a pair the cut would split', () => {
    expect(cutCodeUnits('abc', 5)).toBe('abc');
    expect(cutCodeUnits('ab😀', 3)).toBe('ab');
    expect(cutCodeUnits('ab😀', 4)).toBe('ab😀');
  });

  // The screens' "Re: …" line is cut; the Jira description quotes the card
  // whole, never through this cut (maintainer decision 2026-10-22, "never
  // abbreviate"), so no emoji can be halved there either.
  it('is not the quote the Jira description writes: the issue quotes the card whole', () => {
    const text = `${'a'.repeat(49)}😀 and more`;
    const team = { retrospectives: [{ id: 'r1', tickets: [{ id: 'k1', text }], groups: [] }] };
    expect(ticketQuote(text)).not.toBe(text);
    expect(actionContextText({ action: { linkedTicketId: 'k1' }, team, language: 'en' })).toBe(`Re: "${text}"`);
  });

  // The three screens that write a card's quote onto an action. A quote
  // written there is stored, so one cut back to `substring` would put the
  // broken text in the team record again.
  it.each([
    'components/Session.tsx',
    'components/session/ReviewPhase.tsx',
    'components/session/OpenActionsPhase.tsx'
  ])('%s quotes a card through ticketQuote', (file) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(source).toMatch(/import \{[^}]*\bticketQuote\b[^}]*\} from '[./]+\/utils\/textCut(\.js)?'/);
    expect(source).not.toMatch(/\.text\.substring\(0,\s*50\)/);
  });
});
