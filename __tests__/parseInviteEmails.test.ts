import { describe, expect, it } from 'vitest';
import { parseInviteEmails } from '../utils/parseInviteEmails';

describe('parseInviteEmails', () => {
  it('parses two emails separated by a space without using the other email as a name', () => {
    const result = parseInviteEmails('alain@mail.com michel@mail.com');
    expect(result).toEqual([
      { email: 'alain@mail.com', nameHint: undefined },
      { email: 'michel@mail.com', nameHint: undefined },
    ]);
  });

  it('parses a single email with no name hint', () => {
    expect(parseInviteEmails('teammate@example.com')).toEqual([
      { email: 'teammate@example.com', nameHint: undefined },
    ]);
  });

  it('preserves names from an Outlook-style list separated by semicolons', () => {
    const input =
      'Galtier Fabien (DIN) <fabien.galtier@etat.ge.ch>; Abboute Amayas (DIN) <amayas.abboute@etat.ge.ch>; Blechet Antoine (DIN) <antoine.blechet@etat.ge.ch>';
    expect(parseInviteEmails(input)).toEqual([
      { email: 'fabien.galtier@etat.ge.ch', nameHint: 'Galtier Fabien (DIN)' },
      { email: 'amayas.abboute@etat.ge.ch', nameHint: 'Abboute Amayas (DIN)' },
      { email: 'antoine.blechet@etat.ge.ch', nameHint: 'Blechet Antoine (DIN)' },
    ]);
  });

  it('keeps a single name with angle brackets even when separated by spaces around it', () => {
    expect(parseInviteEmails('Leroux Benjamin (DIN) <Benjamin.Leroux@etat.ge.ch>')).toEqual([
      { email: 'Benjamin.Leroux@etat.ge.ch', nameHint: 'Leroux Benjamin (DIN)' },
    ]);
  });

  it('parses several space-separated bare emails without cross-assigning names', () => {
    const result = parseInviteEmails('a@x.com b@x.com c@x.com');
    expect(result).toEqual([
      { email: 'a@x.com', nameHint: undefined },
      { email: 'b@x.com', nameHint: undefined },
      { email: 'c@x.com', nameHint: undefined },
    ]);
  });

  it('handles comma and newline separators', () => {
    expect(parseInviteEmails('a@x.com,\nb@x.com')).toEqual([
      { email: 'a@x.com', nameHint: undefined },
      { email: 'b@x.com', nameHint: undefined },
    ]);
  });

  it('de-duplicates repeated emails (case-insensitive)', () => {
    expect(parseInviteEmails('a@x.com A@X.com')).toEqual([
      { email: 'a@x.com', nameHint: undefined },
    ]);
  });

  it('returns an empty array when there are no emails', () => {
    expect(parseInviteEmails('no emails here')).toEqual([]);
  });
});
