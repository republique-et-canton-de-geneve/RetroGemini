import { describe, expect, it } from 'vitest';
import enSession from '../i18n/locales/en/session';
import frSession from '../i18n/locales/fr/session';
import { ROTI_FOLLOW_UP_LINK_ID as CLIENT_ROTI_FOLLOW_UP_LINK_ID } from '../components/session/retroConstants';
import {
  ROTI_FOLLOW_UP_LINK_ID,
  SUMMARY_MAX_LENGTH,
  REQUESTED_BY_MAX_LENGTH,
  actionContextText,
  issueContentLanguage,
  issueFields,
  issueSummary,
  wikiText
} from '../utils/jiraIssueContent.js';

/**
 * What an issue created from an action says (`utils/jiraIssueContent.js`).
 *
 * The server builds the issue and the confirmation dialog previews it with the
 * same function, so these cases are the content contract for both: a summary
 * Jira accepts, a description in the session's language that says where the
 * action comes from, and no way for text a participant typed to become Jira
 * markup — a mention, a link, an image, a macro — in somebody else's tracker.
 */

const repeat = (character: string, count: number) => character.repeat(count);

// The screens' own substitution, written without String.replace so a `$&` in
// the value cannot be read as a replacement pattern.
const fill = (template: string, name: string, value: string) => template.split(`{${name}}`).join(value);

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

// What `oneLine` must turn into a space besides CR, LF and TAB: the other
// control characters, NEL among them (a line terminator for Java, which Jira
// runs on), and the Unicode line and paragraph separators.
const OTHER_LINE_BREAKING: Array<[string, string]> = [
  ['NUL', '\u0000'],
  ['a vertical tab', '\u000b'],
  ['a form feed', '\u000c'],
  ['DEL', '\u007f'],
  ['NEL', '\u0085'],
  ['the C1 CSI', '\u009b'],
  ['the line separator', '\u2028'],
  ['the paragraph separator', '\u2029']
];

const SHORT_TICKET = 'Deploys are slow';
const LONG_TICKET = `${repeat('x', 50)} and then some more words`;

const makeTeam = () => ({
  id: 'team-1',
  name: 'Team',
  retrospectives: [
    {
      id: 'retro-13',
      name: 'Sprint 13',
      date: '2026-10-20',
      templateLanguage: 'fr',
      tickets: [{ id: 'ticket-fr', text: 'Les déploiements sont lents' }],
      groups: [{ id: 'group-fr', title: 'Outillage' }],
      actions: []
    },
    {
      id: 'retro-12',
      name: 'Sprint 12',
      date: '2026-10-06',
      templateLanguage: 'en',
      tickets: [
        { id: 'ticket-short', text: SHORT_TICKET },
        { id: 'ticket-long', text: LONG_TICKET },
        { id: 'ticket-50', text: repeat('y', 50) },
        { id: 'ticket-emoji', text: `${repeat('a', 49)}\u{1F600}tail` },
        { id: 'ticket-dollar', text: 'Costs $& and $1' }
      ],
      groups: [{ id: 'group-en', title: 'Tooling' }],
      actions: []
    }
  ],
  healthChecks: [],
  globalActions: []
});

describe('ROTI_FOLLOW_UP_LINK_ID', () => {
  it('is the id the client links ROTI follow-up actions with', () => {
    expect(ROTI_FOLLOW_UP_LINK_ID).toBe(CLIENT_ROTI_FOLLOW_UP_LINK_ID);
  });
});

describe('wikiText', () => {
  it.each([
    ['a user mention', '[~admin]', '\\[\\~admin\\]'],
    ['a labelled link', '[x|https://e]', '\\[x\\|https://e\\]'],
    ['an image', '!https://e/i.png!', '\\!https://e/i.png\\!'],
    ['a code macro', '{code}x{code}', '\\{code\\}x\\{code\\}'],
    ['strike-through', '-strike-', '\\-strike\\-'],
    ['a citation', '??cite??', '\\?\\?cite\\?\\?'],
    ['bold, italic, underline, super- and subscript', '*b* _i_ +u+ ^s^ ~s~', '\\*b\\* \\_i\\_ \\+u\\+ \\^s\\^ \\~s\\~'],
    ['a numbered list marker and a backtick', '# one `two`', '\\# one \\`two\\`'],
    ['a table', '||h||\n|c|', '\\|\\|h\\|\\| \\|c\\|']
  ])('escapes %s', (_label, input, expected) => {
    expect(wikiText(input)).toBe(expected);
  });

  it('turns a newline into a space, so h1. never starts a line', () => {
    expect(wikiText('intro\nh1. Owned')).toBe('intro h1. Owned');
    expect(wikiText('intro\r\nbq. quote')).toBe('intro bq. quote');
    expect(wikiText('intro\u2028h1. Owned')).toBe('intro h1. Owned');
    expect(wikiText('intro\u2029h1. Owned')).toBe('intro h1. Owned');
  });

  it.each(OTHER_LINE_BREAKING)('turns %s into a space too', (_label, character) => {
    expect(wikiText(`a${character}b`)).toBe('a b');
    expect(wikiText(`intro${character}h1. Owned`)).toBe('intro h1. Owned');
  });

  it('turns a typed backslash into a space, so no forced break or escape can be formed', () => {
    expect(wikiText('a\\b')).toBe('a b');
    // Two backslashes are Jira's forced line break.
    expect(wikiText('a\\\\b')).toBe('a b');
    // A backslash before a markup character would otherwise cancel our escape.
    expect(wikiText('\\[~admin]')).toBe('\\[\\~admin\\]');
    expect(wikiText('end\\')).toBe('end');
    expect(wikiText('a\\{code}')).toBe('a \\{code\\}');
  });

  it('turns tabs into one space and collapses runs of spaces', () => {
    expect(wikiText('a\tb')).toBe('a b');
    expect(wikiText('a\t\t b    c')).toBe('a b c');
  });

  it('removes the spaces left at either end', () => {
    expect(wikiText('  \n padded \t ')).toBe('padded');
  });

  it('keeps no-break spaces, which are French typography rather than layout', () => {
    expect(wikiText('Concerne\u00a0: «\u00a0x\u00a0»')).toBe('Concerne\u00a0: «\u00a0x\u00a0»');
    // Beside another space, where a rule collapsing any whitespace run would
    // swallow them: only runs of ordinary spaces collapse.
    expect(wikiText('Concerne\u00a0 : x')).toBe('Concerne\u00a0 : x');
    expect(wikiText('a\u00a0\u00a0b')).toBe('a\u00a0\u00a0b');
    expect(wikiText('a\u202f\u202fb')).toBe('a\u202f\u202fb');
    expect(wikiText('a \u202fb')).toBe('a \u202fb');
  });

  it('leaves ordinary text alone', () => {
    expect(wikiText('Sprint 12 (2026/10/06): déploiement, l’équipe.')).toBe('Sprint 12 (2026/10/06): déploiement, l’équipe.');
  });

  it.each([undefined, null, 12, {}, ['x']])('reads the non-string %s as empty', (value) => {
    expect(wikiText(value)).toBe('');
  });
});

describe('issueSummary', () => {
  it('pins the limit', () => {
    expect(SUMMARY_MAX_LENGTH).toBe(255);
  });

  it('keeps 254 and 255 characters and cuts 256 to 255', () => {
    expect(issueSummary(repeat('a', 254))).toBe(repeat('a', 254));
    expect(issueSummary(repeat('a', 255))).toBe(repeat('a', 255));
    expect(issueSummary(repeat('a', 256))).toBe(repeat('a', 255));
  });

  it('never splits a surrogate pair straddling the cut', () => {
    // 254 + 2 code units: the cut at 255 falls inside the emoji, which goes whole.
    const straddling = issueSummary(`${repeat('a', 254)}\u{1F600}`);
    expect(straddling).toBe(repeat('a', 254));
    expect(LONE_SURROGATE.test(straddling)).toBe(false);

    // 253 + 2 code units fit exactly: nothing is cut.
    expect(issueSummary(`${repeat('a', 253)}\u{1F600}`)).toBe(`${repeat('a', 253)}\u{1F600}`);

    const emojiOnly = issueSummary(repeat('\u{1F600}', 200));
    expect(LONE_SURROGATE.test(emojiOnly)).toBe(false);
    expect(emojiOnly).toBe(repeat('\u{1F600}', 127));
  });

  it('keeps a whole surrogate pair that ends exactly at the cut', () => {
    // 253 + 2 + 1 code units: the 255th unit closes the emoji, so nothing of it
    // is dropped; backing off one unit would leave its first half alone.
    const afterPair = issueSummary(`${repeat('a', 253)}\u{1F600}b`);
    expect(afterPair).toBe(`${repeat('a', 253)}\u{1F600}`);
    expect(LONE_SURROGATE.test(afterPair)).toBe(false);
  });

  it('stays within 255 code points and 255 code units', () => {
    // Three code units per repetition, so the cut at 255 lands right after the
    // 85th emoji.
    const result = issueSummary(repeat('é\u{1F600}', 300));
    expect(result).toBe(repeat('é\u{1F600}', 85));
    expect(LONE_SURROGATE.test(result)).toBe(false);
    expect(result.length).toBeLessThanOrEqual(255);
    expect([...result].length).toBeLessThanOrEqual(255);
  });

  it('is one line: newlines and tabs collapse into single spaces', () => {
    expect(issueSummary('Fix\n\nthe\r\nbuild\tscript')).toBe('Fix the build script');
  });

  it.each(OTHER_LINE_BREAKING)('turns %s into a space too', (_label, character) => {
    expect(issueSummary(`a${character}b`)).toBe('a b');
  });

  it('is trimmed, including a space left by the cut', () => {
    expect(issueSummary('   Fix the build   ')).toBe('Fix the build');
    expect(issueSummary(`${repeat('a', 254)} tail`)).toBe(repeat('a', 254));
  });

  it('does not escape markup: Jira shows a summary as plain text', () => {
    expect(issueSummary('Fix *the* [build]')).toBe('Fix *the* [build]');
  });

  it.each(['', '  \n\t ', undefined, null, 3])('answers an empty string for %s', (value) => {
    expect(issueSummary(value)).toBe('');
  });
});

describe('issueContentLanguage', () => {
  const team = makeTeam();
  const [frenchRetro, englishRetro] = team.retrospectives;

  it.each([
    ['a French retro', { ...englishRetro, templateLanguage: 'fr' }, 'en', 'fr'],
    ['an English retro, even when the latest retro and the clicker are French', englishRetro, 'fr', 'en'],
    ['a retro with no language, which predates the feature and was English', { ...frenchRetro, templateLanguage: undefined }, 'fr', 'en'],
    ['a retro with a language this build does not know', { ...frenchRetro, templateLanguage: 'de' }, 'fr', 'en']
  ])('reads %s', (_label, session, fallbackLanguage, expected) => {
    expect(issueContentLanguage({ session, sessionKind: 'retro', team, fallbackLanguage })).toBe(expected);
  });

  it('reads a built-in health check from its template', () => {
    const englishTeam = { ...team, retrospectives: [englishRetro] };
    expect(issueContentLanguage({
      session: { id: 'hc', templateId: 'team_health_fr' }, sessionKind: 'healthcheck', team: englishTeam, fallbackLanguage: 'en'
    })).toBe('fr');
    expect(issueContentLanguage({
      session: { id: 'hc', templateId: 'team_health_en' }, sessionKind: 'healthcheck', team, fallbackLanguage: 'fr'
    })).toBe('en');
  });

  it('reads a custom health check from the team\'s latest retro', () => {
    const custom = { id: 'hc', templateId: 'custom-123' };
    expect(issueContentLanguage({ session: custom, sessionKind: 'healthcheck', team, fallbackLanguage: 'en' })).toBe('fr');
    const englishFirst = { ...team, retrospectives: [englishRetro, frenchRetro] };
    expect(issueContentLanguage({ session: custom, sessionKind: 'healthcheck', team: englishFirst, fallbackLanguage: 'fr' })).toBe('en');
  });

  it('reads a session\'s own language only when the session is of that kind', () => {
    // A server lane may pass the request's session beside a backlog action:
    // neither a built-in template nor a template language decides then.
    const englishFirst = { ...team, retrospectives: [englishRetro, frenchRetro] };
    const builtInFrench = { id: 'hc', templateId: 'team_health_fr' };
    for (const sessionKind of ['backlog', 'retro', undefined] as const) {
      expect(issueContentLanguage({ session: builtInFrench, sessionKind, team: englishFirst, fallbackLanguage: 'fr' })).toBe('en');
    }
    for (const sessionKind of ['backlog', 'healthcheck', undefined] as const) {
      expect(issueContentLanguage({ session: frenchRetro, sessionKind, team: englishFirst, fallbackLanguage: 'fr' })).toBe('en');
    }
  });

  it('reads a latest retro with no or an unknown language as English, not as the clicker\'s', () => {
    for (const templateLanguage of [undefined, 'de']) {
      const legacy = { ...team, retrospectives: [{ ...englishRetro, templateLanguage }] };
      expect(issueContentLanguage({ session: null, sessionKind: 'backlog', team: legacy, fallbackLanguage: 'fr' })).toBe('en');
    }
  });

  it('reads a backlog action from the team\'s latest retro before the clicker\'s language', () => {
    expect(issueContentLanguage({ session: null, sessionKind: 'backlog', team, fallbackLanguage: 'en' })).toBe('fr');
  });

  it('falls back to the clicker\'s language when the team has no retro', () => {
    const noRetros = { ...team, retrospectives: [] };
    expect(issueContentLanguage({ session: null, sessionKind: 'backlog', team: noRetros, fallbackLanguage: 'fr' })).toBe('fr');
    expect(issueContentLanguage({ session: null, sessionKind: 'backlog', team: noRetros, fallbackLanguage: 'en' })).toBe('en');
    expect(issueContentLanguage({ session: null, sessionKind: 'backlog', team: null, fallbackLanguage: 'fr' })).toBe('fr');
  });

  it('falls back to English for an unknown or missing fallback', () => {
    const noRetros = { ...team, retrospectives: [] };
    expect(issueContentLanguage({ session: null, sessionKind: 'backlog', team: noRetros, fallbackLanguage: 'de' })).toBe('en');
    expect(issueContentLanguage({ session: null, sessionKind: 'backlog', team: noRetros })).toBe('en');
    expect(issueContentLanguage({})).toBe('en');
  });
});

describe('actionContextText', () => {
  const team = makeTeam();
  const action = (fields: Record<string, unknown>) => ({ id: 'a1', text: 'Act', ...fields });

  it('keeps a stored context, whatever the language', () => {
    expect(actionContextText({
      action: action({ contextText: 'Re: stored', linkedTicketId: 'ticket-short' }), team, language: 'fr'
    })).toBe('Re: stored');
  });

  it('quotes a short ticket in full, exactly as the screens do', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', SHORT_TICKET));
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team, language: 'fr' }))
      .toBe(fill(frSession['session.actionContext.ticket'], 'text', SHORT_TICKET));
  });

  it('cuts a long ticket at 50 characters and marks the cut', () => {
    const quoted = `${LONG_TICKET.substring(0, 50)}...`;
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-long' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', quoted));
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-long' }), team, language: 'fr' }))
      .toBe(fill(frSession['session.actionContext.ticket'], 'text', quoted));
  });

  it('does not mark a ticket of exactly 50 characters as cut', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-50' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', repeat('y', 50)));
  });

  it('does not split an emoji at the 50-character cut', () => {
    const text = actionContextText({ action: action({ linkedTicketId: 'ticket-emoji' }), team, language: 'en' });
    expect(text).toBe(fill(enSession['session.actionContext.ticket'], 'text', `${repeat('a', 49)}...`));
    expect(LONE_SURROGATE.test(text)).toBe(false);
  });

  it('keeps a `$&` in the ticket literally', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-dollar' }), team, language: 'en' }))
      .toBe('Re: "Costs $& and $1"');
  });

  it('finds a ticket in any retro, not only the latest', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-fr' }), team, language: 'fr' }))
      .toBe(fill(frSession['session.actionContext.ticket'], 'text', 'Les déploiements sont lents'));
  });

  it('names a group', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'group-en' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.group'], 'title', 'Tooling'));
    expect(actionContextText({ action: action({ linkedTicketId: 'group-en' }), team, language: 'fr' }))
      .toBe(fill(frSession['session.actionContext.group'], 'title', 'Tooling'));
  });

  it('names a ROTI follow-up, even for a team with no retro', () => {
    const rotiAction = action({ linkedTicketId: ROTI_FOLLOW_UP_LINK_ID });
    expect(actionContextText({ action: rotiAction, team, language: 'en' })).toBe(enSession['session.actionContext.rotiFollowUp']);
    expect(actionContextText({ action: rotiAction, team, language: 'fr' })).toBe(frSession['session.actionContext.rotiFollowUp']);
    expect(actionContextText({ action: rotiAction, team: null, language: 'fr' })).toBe(frSession['session.actionContext.rotiFollowUp']);
  });

  it('answers an empty context for a linked card when there is no team to look in', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team: null, language: 'en' })).toBe('');
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team: undefined, language: 'en' })).toBe('');
  });

  it('writes the context in English for an unknown language', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'group-en' }), team, language: 'de' }))
      .toBe(fill(enSession['session.actionContext.group'], 'title', 'Tooling'));
  });

  it('reads an empty stored context as none and quotes the linked card, as the screens do', () => {
    expect(actionContextText({ action: action({ contextText: '', linkedTicketId: 'ticket-short' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', SHORT_TICKET));
  });

  // The order of `buildActionContext` in `components/Session.tsx`: the retros
  // in the team's order, one at a time, a card before a group within each.
  // Ids rarely repeat, but the preview and the server must name the same one
  // the screen does when they do.
  it('quotes the card of the first retro, in the team\'s order, when two hold the id', () => {
    const duplicated = {
      retrospectives: [
        { tickets: [{ id: 'dup', text: 'newest' }], groups: [] },
        { tickets: [{ id: 'dup', text: 'older' }], groups: [] }
      ]
    };
    expect(actionContextText({ action: action({ linkedTicketId: 'dup' }), team: duplicated, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', 'newest'));
  });

  it('quotes a card rather than a group that shares its id in the same retro', () => {
    const shared = {
      retrospectives: [{ tickets: [{ id: 'same', text: 'A card' }], groups: [{ id: 'same', title: 'A group' }] }]
    };
    expect(actionContextText({ action: action({ linkedTicketId: 'same' }), team: shared, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', 'A card'));
  });

  it('finishes one retro before the next, so a group in a newer retro wins over a card in an older one', () => {
    const spread = {
      retrospectives: [
        { tickets: [], groups: [{ id: 'same', title: 'Newer group' }] },
        { tickets: [{ id: 'same', text: 'Older card' }], groups: [] }
      ]
    };
    expect(actionContextText({ action: action({ linkedTicketId: 'same' }), team: spread, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.group'], 'title', 'Newer group'));
  });

  it.each([
    ['no link', action({})],
    ['a link to nothing the team holds', action({ linkedTicketId: 'gone' })],
    ['a health-check dimension link', action({ linkedTicketId: 'dimension-1' })],
    ['no action', undefined]
  ])('answers an empty context for %s', (_label, value) => {
    expect(actionContextText({ action: value, team, language: 'en' })).toBe('');
  });

  it('survives a malformed team record', () => {
    const broken = {
      retrospectives: [null, { tickets: 'x', groups: [null, { id: 'untitled' }] }, { tickets: [{ id: 'ticket-short' }] }]
    };
    expect(actionContextText({ action: action({ linkedTicketId: 'nope' }), team: broken, language: 'en' })).toBe('');
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team: broken, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', ''));
    // A group with no title is named as empty, never as "undefined".
    expect(actionContextText({ action: action({ linkedTicketId: 'untitled' }), team: broken, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.group'], 'title', ''));
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team: { retrospectives: 'x' }, language: 'en' }))
      .toBe('');
  });
});

describe('issueFields', () => {
  const team = makeTeam();
  const [frenchRetro, englishRetro] = team.retrospectives;
  const ticketAction = { id: 'a1', text: 'Speed up\nthe deploys', linkedTicketId: 'ticket-short', assigneeId: null, done: false };
  const rotiAction = { id: 'a2', text: 'Shorter sessions', linkedTicketId: ROTI_FOLLOW_UP_LINK_ID };
  const plainAction = { id: 'a3', text: 'Write the runbook' };

  it('describes a retro action in English', () => {
    expect(issueFields({
      action: ticketAction, session: englishRetro, kind: 'retro', team, requestedBy: 'Ann', language: 'fr'
    })).toEqual({
      summary: 'Speed up the deploys',
      description: 'Action from the retrospective Sprint 12 (2026\\-10\\-06) — Re: "Deploys are slow". Requested in RetroGemini as Ann.',
      language: 'en'
    });
  });

  it('describes a retro action in French', () => {
    expect(issueFields({
      action: { ...ticketAction, linkedTicketId: 'group-fr' }, session: frenchRetro, kind: 'retro', team, requestedBy: 'Zoé', language: 'en'
    })).toEqual({
      summary: 'Speed up the deploys',
      description:
        'Action de la rétrospective Sprint 13 (2026\\-10\\-20) — Concerne\u00a0: groupe «\u00a0Outillage\u00a0». Demandée dans RetroGemini par Zoé.',
      language: 'fr'
    });
  });

  it('describes a health-check action in English and in French', () => {
    const englishCheck = { id: 'hc-1', name: 'Q3 health', date: '2026-09-30', templateId: 'team_health_en' };
    const frenchCheck = { ...englishCheck, name: 'Santé T3', templateId: 'team_health_fr' };

    expect(issueFields({ action: rotiAction, session: englishCheck, kind: 'healthcheck', team, requestedBy: 'Ann', language: 'fr' }))
      .toEqual({
        summary: 'Shorter sessions',
        description: 'Action from the health check Q3 health (2026\\-09\\-30) — Re: ROTI follow\\-up. Requested in RetroGemini as Ann.',
        language: 'en'
      });
    expect(issueFields({ action: rotiAction, session: frenchCheck, kind: 'healthcheck', team, requestedBy: 'Ann', language: 'en' }))
      .toEqual({
        summary: 'Shorter sessions',
        description:
          'Action du bilan de santé Santé T3 (2026\\-09\\-30) — Concerne\u00a0: suivi du ROTI. Demandée dans RetroGemini par Ann.',
        language: 'fr'
      });
  });

  it('describes a backlog action in English and in French', () => {
    const noRetros = { ...team, retrospectives: [] };
    expect(issueFields({ action: plainAction, session: null, kind: 'backlog', team: noRetros, requestedBy: 'Ann', language: 'en' }))
      .toEqual({
        summary: 'Write the runbook',
        description: 'Action from the team backlog. Requested in RetroGemini as Ann.',
        language: 'en'
      });
    expect(issueFields({ action: plainAction, session: null, kind: 'backlog', team: noRetros, requestedBy: 'Ann', language: 'fr' }))
      .toEqual({
        summary: 'Write the runbook',
        description: 'Action du backlog de l’équipe. Demandée dans RetroGemini par Ann.',
        language: 'fr'
      });
  });

  it('omits the context part when there is none', () => {
    expect(issueFields({ action: plainAction, session: englishRetro, kind: 'retro', team, requestedBy: 'Ann', language: 'en' }).description)
      .toBe('Action from the retrospective Sprint 12 (2026\\-10\\-06). Requested in RetroGemini as Ann.');
  });

  it.each([
    ['an empty name', ''],
    ['only spaces and control characters', ' \n\t\u0007 '],
    ['no name', undefined],
    ['a non-string', 42]
  ])('says the issue was created from RetroGemini for %s', (_label, requestedBy) => {
    expect(issueFields({ action: plainAction, session: englishRetro, kind: 'retro', team, requestedBy, language: 'en' }).description)
      .toBe('Action from the retrospective Sprint 12 (2026\\-10\\-06). Created from RetroGemini.');
    expect(issueFields({ action: plainAction, session: frenchRetro, kind: 'retro', team, requestedBy, language: 'en' }).description)
      .toBe('Action de la rétrospective Sprint 13 (2026\\-10\\-20). Créée depuis RetroGemini.');
  });

  it('escapes every interpolated value and none of the template words', () => {
    const session = { ...englishRetro, name: 'Sprint *12* [~admin]', date: '{code}' };
    const action = { id: 'a4', text: 'Do it', contextText: 'Re: !https://e/i.png!' };
    const { description } = issueFields({ action, session, kind: 'retro', team, requestedBy: '[x|https://e]', language: 'en' });

    expect(description).toBe(
      'Action from the retrospective Sprint \\*12\\* \\[\\~admin\\] (\\{code\\}) — Re: \\!https://e/i.png\\!. '
      + 'Requested in RetroGemini as \\[x\\|https://e\\].'
    );
  });

  it('cannot start a heading or a forced break from any interpolated value', () => {
    const session = { ...englishRetro, name: 'Retro\nh1. Owned' };
    const { description } = issueFields({ action: plainAction, session, kind: 'retro', team, requestedBy: 'Ann\\\\', language: 'en' });
    expect(description).not.toMatch(/\n/);
    expect(description).not.toContain('\\\\');
    expect(description).toBe('Action from the retrospective Retro h1. Owned (2026\\-10\\-06). Requested in RetroGemini as Ann.');
  });

  it('pins the requester limit', () => {
    expect(REQUESTED_BY_MAX_LENGTH).toBe(80);
  });

  it('trims the requester, strips control characters and keeps at most 80 characters', () => {
    const describe80 = (requestedBy: unknown) =>
      issueFields({ action: plainAction, session: null, kind: 'backlog', team: { retrospectives: [] }, requestedBy, language: 'en' }).description;

    expect(describe80('  Ann\u0000 Smith\u0007\u009b  ')).toBe('Action from the team backlog. Requested in RetroGemini as Ann Smith.');
    expect(describe80('Ann\nSmith')).toBe('Action from the team backlog. Requested in RetroGemini as AnnSmith.');
    expect(describe80(repeat('b', 100))).toBe(`Action from the team backlog. Requested in RetroGemini as ${repeat('b', 80)}.`);
    expect(describe80(`${repeat('b', 79)}\u{1F600}`)).toBe(`Action from the team backlog. Requested in RetroGemini as ${repeat('b', 79)}.`);
    // Trimmed before the cut: leading spaces do not take any of the 80 places.
    expect(describe80(`   ${repeat('b', 80)}`)).toBe(`Action from the team backlog. Requested in RetroGemini as ${repeat('b', 80)}.`);
  });

  it('removes the requester\'s control characters rather than spacing them, before the 80-character cut', () => {
    const describe80 = (requestedBy: unknown) =>
      issueFields({ action: plainAction, session: null, kind: 'backlog', team: { retrospectives: [] }, requestedBy, language: 'en' }).description;

    // Inside a word, where removing and spacing differ.
    expect(describe80('Ann\u0007Sm\u009bith\u0000')).toBe('Action from the team backlog. Requested in RetroGemini as AnnSmith.');
    // Counted after the removal: the bell does not take the 80th place.
    expect(describe80(`${repeat('b', 79)}\u0007cc`)).toBe(`Action from the team backlog. Requested in RetroGemini as ${repeat('b', 79)}c.`);
  });

  it('builds the summary from the action text alone', () => {
    // A stored context and a linked card sit beside the text, and neither
    // reaches the summary: the context belongs to the description.
    const { summary } = issueFields({
      action: { ...plainAction, text: `  ${repeat('s', 300)}  `, contextText: 'Re: stored', linkedTicketId: 'ticket-short' },
      session: null,
      kind: 'backlog',
      team,
      requestedBy: 'Ann',
      language: 'en'
    });
    expect(summary).toBe(repeat('s', 255));
  });

  it('answers an empty summary, for the caller to refuse, when no action is given', () => {
    expect(issueFields({ action: undefined, session: null, kind: 'backlog', team: null, requestedBy: '', language: 'en' }))
      .toEqual({ summary: '', description: 'Action from the team backlog. Created from RetroGemini.', language: 'en' });
  });

  it('does not name a session it was not given', () => {
    expect(issueFields({ action: plainAction, session: null, kind: 'retro', team: { retrospectives: [] }, requestedBy: 'Ann', language: 'en' }).description)
      .toBe('Action from the team backlog. Requested in RetroGemini as Ann.');
  });

  it.each<[string, 'backlog' | undefined]>([
    ['a backlog action', 'backlog'],
    ['an action of no known kind', undefined]
  ])('does not name the session passed beside %s', (_label, kind) => {
    // The kind decides, not the presence of a session: a caller that hands the
    // request's session over with a backlog action still describes the backlog.
    expect(issueFields({ action: plainAction, session: englishRetro, kind, team: { retrospectives: [] }, requestedBy: 'Ann', language: 'en' }).description)
      .toBe('Action from the team backlog. Requested in RetroGemini as Ann.');
  });

  it('leaves out a missing date rather than printing empty brackets', () => {
    const session = { ...englishRetro, date: '' };
    expect(issueFields({ action: plainAction, session, kind: 'retro', team, requestedBy: 'Ann', language: 'en' }).description)
      .toBe('Action from the retrospective Sprint 12. Requested in RetroGemini as Ann.');
  });

  it.each([
    ['an empty name', ''],
    ['no name', undefined]
  ])('leaves out %s rather than printing a double space', (_label, name) => {
    const session = { ...englishRetro, name };
    expect(issueFields({ action: plainAction, session, kind: 'retro', team, requestedBy: 'Ann', language: 'en' }).description)
      .toBe('Action from the retrospective (2026\\-10\\-06). Requested in RetroGemini as Ann.');
  });
});
