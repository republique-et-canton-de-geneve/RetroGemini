const EMAIL_PATTERN_SOURCE = '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';

export interface ParsedInvite {
  email: string;
  nameHint?: string;
}

/**
 * Parse a free-form invite field into a list of unique email addresses with an
 * optional display name.
 *
 * Entries are split on newlines, commas and semicolons (the Outlook paste
 * format). A single entry may still contain several space-separated bare
 * emails; in that case no name is inferred for them so one email is never
 * mistaken for another's name.
 */
export function parseInviteEmails(input: string): ParsedInvite[] {
  const entries = input
    .split(/\n|,|;/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const results: ParsedInvite[] = [];

  entries.forEach((entry) => {
    const matches = [...entry.matchAll(new RegExp(EMAIL_PATTERN_SOURCE, 'gi'))];
    if (matches.length === 0) return;

    // Strip every email from the entry so another address can never be used as
    // a display name (e.g. "alain@mail.com michel@mail.com").
    let nameCandidate = entry;
    matches.forEach((match) => {
      nameCandidate = nameCandidate.replace(match[0], '');
    });
    nameCandidate = nameCandidate
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // A name only makes sense when the entry holds a single email address.
    const nameHint = matches.length === 1 && nameCandidate ? nameCandidate : undefined;

    matches.forEach((match) => {
      const email = match[0].trim();
      const normalized = email.toLowerCase();
      if (seen.has(normalized)) return;
      seen.add(normalized);
      results.push({ email, nameHint });
    });
  });

  return results;
}
