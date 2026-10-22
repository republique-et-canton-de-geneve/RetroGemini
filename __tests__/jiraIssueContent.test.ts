import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import enSession from '../i18n/locales/en/session';
import frSession from '../i18n/locales/fr/session';
import { ROTI_FOLLOW_UP_LINK_ID as CLIENT_ROTI_FOLLOW_UP_LINK_ID } from '../components/session/retroConstants';
import {
  DESCRIPTION_MAX_LENGTH,
  ROTI_FOLLOW_UP_LINK_ID,
  SUMMARY_MAX_LENGTH,
  REQUESTED_BY_MAX_LENGTH,
  actionContextText,
  actionGroupCards,
  issueContentLanguage,
  issueFields,
  issueSource,
  issueSummary,
  jiraParentScope,
  parentIssueFields,
  wikiText
} from '../utils/jiraIssueContent.js';
import { jiraIssuePreview } from '../components/jira/jiraIssuePreview';

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
// Longer than every limit the module has (the summary's 255, the requester's
// 80, the 50 the screens cut a quote at), plain words only so escaping leaves
// it as it is, with an end marker a cut at any length would lose (review R3).
const HUGE_CARD = `The release checklist ${'keeps growing and nobody owns it '.repeat(32)}END OF THE CARD`;

// What Jira may count: each line break as CR LF.
const counted = (text: string) => text.length + (text.split('\n').length - 1);

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
        { id: 'ticket-huge', text: HUGE_CARD },
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

  // Maintainer decision 2026-10-22, "Il ne faut pas abréger sinon on sait
  // plus": Jira has nothing else to show, so the card is quoted whole.
  it('quotes a card in full, never cut nor marked', () => {
    for (const [language, dictionary] of [['en', enSession], ['fr', frSession]] as const) {
      const text = actionContextText({ action: action({ linkedTicketId: 'ticket-huge' }), team, language });
      expect(text).toBe(fill(dictionary['session.actionContext.ticket'], 'text', HUGE_CARD));
      expect(text).toContain('END OF THE CARD');
      expect(text).not.toContain('...');
    }
  });

  it('quotes a card with an emoji whole', () => {
    const text = actionContextText({ action: action({ linkedTicketId: 'ticket-emoji' }), team, language: 'en' });
    expect(text).toBe(fill(enSession['session.actionContext.ticket'], 'text', `${repeat('a', 49)}\u{1F600}tail`));
    expect(LONE_SURROGATE.test(text)).toBe(false);
  });

  // A stored context is what a screen wrote: the session's "Re: …" line cut
  // at 50 characters, or a Dashboard display string. While the card is still
  // on the record, the card is what is quoted.
  it('quotes the card from the record over a stored context a screen cut', () => {
    const cut = `Re: "${HUGE_CARD.substring(0, 50)}..."`;
    expect(actionContextText({ action: action({ contextText: cut, linkedTicketId: 'ticket-huge' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', HUGE_CARD));
  });

  it('quotes the card over a Dashboard display context, in the content language', () => {
    expect(actionContextText({ action: action({ contextText: SHORT_TICKET, linkedTicketId: 'ticket-short' }), team, language: 'fr' }))
      .toBe(fill(frSession['session.actionContext.ticket'], 'text', SHORT_TICKET));
  });

  it('derives a group from the record over a stored context', () => {
    expect(actionContextText({ action: action({ contextText: 'Group: Tooling', linkedTicketId: 'group-en' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.group'], 'title', 'Tooling'));
  });

  // The residual the docs state (review R4): a card that is gone (its
  // retrospective was deleted) leaves only what a screen stored, cut or not.
  it.each([
    ['the card is gone', 'gone-ticket'],
    ['the action has no link', undefined]
  ])('keeps the stored context, as stored, only when %s', (_label, linkedTicketId) => {
    const stored = 'Re: "The release checklist keeps growing and nob..."';
    expect(actionContextText({ action: action({ contextText: stored, linkedTicketId }), team, language: 'fr' })).toBe(stored);
  });

  it('names a ROTI follow-up in the content language, even over a stored context', () => {
    expect(actionContextText({ action: action({ contextText: 'Re: ROTI follow-up', linkedTicketId: ROTI_FOLLOW_UP_LINK_ID }), team, language: 'fr' }))
      .toBe(frSession['session.actionContext.rotiFollowUp']);
  });

  it('quotes a short ticket in full, exactly as the screens do', () => {
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team, language: 'en' }))
      .toBe(fill(enSession['session.actionContext.ticket'], 'text', SHORT_TICKET));
    expect(actionContextText({ action: action({ linkedTicketId: 'ticket-short' }), team, language: 'fr' }))
      .toBe(fill(frSession['session.actionContext.ticket'], 'text', SHORT_TICKET));
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

/**
 * A group's cards in the description (maintainer, 2026-10-22: "ajouter dans
 * la description le texte des tickets dans les groupes aussi. Ne rien
 * abréger"). The cards of a group are its retro's tickets with that
 * `groupId`, in board order (`retro.tickets` order), each one whole and
 * escaped, never with its author.
 */
describe('actionGroupCards', () => {
  const groupRetro = (tickets: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => ({
    id: 'retro-g',
    name: 'Sprint 12',
    date: '2026-10-06',
    templateLanguage: 'en',
    tickets,
    groups: [{ id: 'grp', title: 'Deploys' }, { id: 'grp-other', title: 'Other' }],
    actions: [],
    ...extra
  });
  const linked = (linkedTicketId: unknown) => ({ id: 'a1', text: 'Act', linkedTicketId });

  it('lists the group’s cards in board order, from the retro that holds the group only', () => {
    const team = {
      retrospectives: [
        // A newer retro holding a card that names the same group id: not this group's card.
        { id: 'retro-new', tickets: [{ id: 'elsewhere', text: 'Another retro', groupId: 'grp' }], groups: [] },
        groupRetro([
          { id: 't3', text: 'Third on the board? No: first', groupId: 'grp', authorId: 'mem-1' },
          { id: 't-other', text: 'In another group', groupId: 'grp-other' },
          { id: 't-loose', text: 'In no group', groupId: null },
          { id: 't1', text: 'Second on the board', groupId: 'grp', authorId: 'mem-2' }
        ])
      ]
    };
    expect(actionGroupCards({ action: linked('grp'), team })).toEqual([
      wikiText('Third on the board? No: first'),
      'Second on the board'
    ]);
  });

  it('gives the escaped text of each card, whole', () => {
    const team = { retrospectives: [groupRetro([
      { id: 't1', text: HUGE_CARD, groupId: 'grp' },
      { id: 't2', text: '[~admin] {html}', groupId: 'grp' }
    ])] };
    expect(actionGroupCards({ action: linked('grp'), team })).toEqual([HUGE_CARD, '\\[\\~admin\\] \\{html\\}']);
  });

  it.each([
    ['spaces only', '   '],
    ['control characters only', '\n\t\u0007'],
    ['backslashes only', '\\\\\\'],
    ['a zero-width space only', '\u200b'],
    ['an empty text', ''],
    ['no text at all', undefined]
  ])('leaves out a card of %s, so no item is ever empty', (_label, text) => {
    const team = { retrospectives: [groupRetro([
      { id: 't1', text: 'Kept', groupId: 'grp' },
      { id: 't2', text, groupId: 'grp' }
    ])] };
    const cards = actionGroupCards({ action: linked('grp'), team });
    expect(cards).toEqual(['Kept']);
    expect(cards).not.toContain('');
  });

  // Decision R9: the action was written against that card; the group it was
  // put in later is the Review step's display, not what the action is about.
  it('lists nothing for an action linked to a card, even a card in a group', () => {
    const team = { retrospectives: [groupRetro([{ id: 't1', text: 'Grouped card', groupId: 'grp' }])] };
    expect(actionGroupCards({ action: linked('t1'), team })).toEqual([]);
  });

  it.each([
    ['a ROTI follow-up', linked(ROTI_FOLLOW_UP_LINK_ID)],
    ['no link', linked(undefined)],
    ['a link to nothing the team holds', linked('gone')],
    ['no action', undefined]
  ])('lists nothing for %s', (_label, action) => {
    const team = { retrospectives: [groupRetro([{ id: 't1', text: 'Grouped card', groupId: 'grp' }])] };
    expect(actionGroupCards({ action, team })).toEqual([]);
  });

  it('survives a malformed team record', () => {
    expect(actionGroupCards({ action: linked('grp'), team: null })).toEqual([]);
    expect(actionGroupCards({ action: linked('grp'), team: { retrospectives: 'x' } })).toEqual([]);
    expect(actionGroupCards({
      action: linked('grp'),
      team: { retrospectives: [null, { tickets: 'x', groups: [{ id: 'grp' }] }] }
    })).toEqual([]);
    expect(actionGroupCards({
      action: linked('grp'),
      team: { retrospectives: [{ tickets: [null, 7, { id: 't', text: 'Kept', groupId: 'grp' }], groups: [null, { id: 'grp' }] }] }
    })).toEqual(['Kept']);
  });
});

describe('issueFields with a group’s cards', () => {
  const englishRetro = {
    id: 'retro-12',
    name: 'Sprint 12',
    date: '2026-10-06',
    templateLanguage: 'en',
    tickets: [
      { id: 'c1', text: 'Have an environment where we can change the F5 and WAM configs ourselves, to be autonomous', groupId: 'grp-en' },
      { id: 'loose', text: 'Not in the group', groupId: null },
      { id: 'c2', text: 'Clarify the dev/integration scope so our tools and our assignments stay consistent', groupId: 'grp-en' },
      { id: 'c3', text: 'Who decides what goes into the sprint?', groupId: 'grp-en' }
    ],
    groups: [{ id: 'grp-en', title: 'Autonomy and consistency of assignments' }, { id: 'grp-empty', title: 'Nothing inside' }],
    actions: []
  };
  // The maintainer's own retro, as the screenshots show it.
  const frenchRetro = {
    id: 'retro-186',
    name: 'AFC R&S 19/10 2611-Sprint 186',
    date: '13.10.2026',
    templateLanguage: 'fr',
    tickets: [
      { id: 'f1', text: 'Avoir un environnement où on peut toucher les confs F5 et WAM pour pouvoir être autonome', groupId: 'grp-fr' },
      { id: 'f2', text: 'Essayer de clarifier le périmètre dev/intégration afin d’avoir une cohérence entre nos outils et nos missions', groupId: 'grp-fr' },
      { id: 'f3', text: 'Qui décide de ce qui entre dans le sprint ?', groupId: 'grp-fr' },
      { id: 'f-laurent', text: 'Acter la proposition de Laurent : pas de colonne Sprint pour atelier', groupId: null }
    ],
    groups: [{ id: 'grp-fr', title: 'Autonomie et cohérence des missions' }],
    actions: []
  };
  const team = { retrospectives: [frenchRetro, englishRetro], healthChecks: [], globalActions: [] };
  const describeAction = (linkedTicketId: string, session: Record<string, unknown>, requestedBy = 'Facilitator') =>
    issueFields({ action: { id: 'a', text: 'Act', linkedTicketId }, session, kind: 'retro', team, requestedBy, language: 'en' }).description;

  it('lists the cards of an English group after the first paragraph', () => {
    expect(describeAction('grp-en', englishRetro)).toBe(
      'Action from the retrospective Sprint 12 (2026\\-10\\-06) — Re: Group "Autonomy and consistency of assignments". Requested in RetroGemini as Facilitator.\n'
      + '\n'
      + 'Cards in the group:\n'
      + '* Have an environment where we can change the F5 and WAM configs ourselves, to be autonomous\n'
      + '* Clarify the dev/integration scope so our tools and our assignments stay consistent\n'
      + '* Who decides what goes into the sprint\\?'
    );
  });

  it('lists the cards of a French group, with the French typography', () => {
    expect(describeAction('grp-fr', frenchRetro)).toBe(
      'Action de la rétrospective AFC R&S 19/10 2611\\-Sprint 186 (13.10.2026) — Concerne\u00a0: groupe «\u00a0Autonomie et cohérence des missions\u00a0». Demandée dans RetroGemini par Facilitator.\n'
      + '\n'
      + 'Cartes du groupe\u00a0:\n'
      + '* Avoir un environnement où on peut toucher les confs F5 et WAM pour pouvoir être autonome\n'
      + '* Essayer de clarifier le périmètre dev/intégration afin d’avoir une cohérence entre nos outils et nos missions\n'
      + '* Qui décide de ce qui entre dans le sprint \\?'
    );
  });

  // The maintainer's card-linked sub-task, quoted whole (screenshot 3).
  it('quotes the maintainer’s card whole, on one line', () => {
    const description = describeAction('f-laurent', frenchRetro);
    expect(description).toBe(
      'Action de la rétrospective AFC R&S 19/10 2611\\-Sprint 186 (13.10.2026) — Concerne\u00a0: «\u00a0Acter la proposition de Laurent : pas de colonne Sprint pour atelier\u00a0». Demandée dans RetroGemini par Facilitator.'
    );
    expect(description).not.toContain('\n');
  });

  it('quotes a huge card whole, in the description too', () => {
    const hugeTeam = { retrospectives: [{ ...englishRetro, tickets: [{ id: 'huge', text: HUGE_CARD }] }] };
    const { description } = issueFields({
      action: { id: 'a', text: 'Act', linkedTicketId: 'huge' }, session: hugeTeam.retrospectives[0], kind: 'retro', team: hugeTeam, requestedBy: 'Ann', language: 'en'
    });
    expect(description).toContain(`Re: "${HUGE_CARD}"`);
    expect(description).not.toContain('\n');
  });

  it('adds nothing for a group with no card, or only blank ones', () => {
    expect(describeAction('grp-empty', englishRetro))
      .toBe('Action from the retrospective Sprint 12 (2026\\-10\\-06) — Re: Group "Nothing inside". Requested in RetroGemini as Facilitator.');
    const blankTeam = { retrospectives: [{ ...englishRetro, tickets: [{ id: 'b1', text: ' \\\\ ', groupId: 'grp-en' }, { id: 'b2', text: '\u200b', groupId: 'grp-en' }] }] };
    const { description } = issueFields({
      action: { id: 'a', text: 'Act', linkedTicketId: 'grp-en' }, session: blankTeam.retrospectives[0], kind: 'retro', team: blankTeam, requestedBy: 'Ann', language: 'en'
    });
    expect(description).not.toContain('\n');
  });

  it('keeps every other description on one line', () => {
    expect(describeAction('c1', englishRetro)).not.toContain('\n');
    expect(describeAction(ROTI_FOLLOW_UP_LINK_ID, englishRetro)).not.toContain('\n');
  });

  it('makes a multi-line card one whole item', () => {
    const multiTeam = { retrospectives: [{ ...englishRetro, tickets: [{ id: 'm', text: 'Too many meetings\n- standup runs long\r\n- retro too', groupId: 'grp-en' }] }] };
    const { description } = issueFields({
      action: { id: 'a', text: 'Act', linkedTicketId: 'grp-en' }, session: multiTeam.retrospectives[0], kind: 'retro', team: multiTeam, requestedBy: 'Ann', language: 'en'
    });
    expect(description.split('\n').slice(2)).toEqual(['Cards in the group:', '* Too many meetings \\- standup runs long \\- retro too']);
  });

  // The template writes one construct on purpose, the list; nothing a
  // participant typed can start a line, end its item or open another one.
  it('escapes each card, and no card can start a line or a construct of its own', () => {
    const hostile = ['[~admin]', '{html}<b>x</b>{html}', '!https://e/i.png!', '*bold*', '# x', 'a\nh1. b', 'x \\\\ y', '- a', '|| a ||', 'bq. quote', '----', '&#123;'];
    const hostileTeam = { retrospectives: [{ ...englishRetro, tickets: hostile.map((text, i) => ({ id: `h${i}`, text, groupId: 'grp-en' })) }] };
    const { description } = issueFields({
      action: { id: 'a', text: 'Act', linkedTicketId: 'grp-en' }, session: hostileTeam.retrospectives[0], kind: 'retro', team: hostileTeam, requestedBy: 'Ann', language: 'en'
    });
    const lines = description.split('\n');
    expect(lines.slice(3)).toEqual(hostile.map((text) => `* ${wikiText(text)}`));
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('Cards in the group:');
    for (const line of lines) {
      // Only the template starts a line: the first paragraph, the blank line,
      // the heading, or an item.
      expect(line).not.toMatch(/^(h\d\.|bq\.|#|\{|\|\||-|\\\\)/);
    }
    for (const line of lines.slice(3)) {
      expect(line.startsWith('* ')).toBe(true);
      expect(line).not.toBe('* ');
      // `h1.` or `bq.` after the bullet is mid-line, and harmless; a markup
      // character right after it is escaped, so it cannot nest a list.
      expect(line.slice(2)).not.toMatch(/^[*#\-{|![]/);
    }
    expect(description).not.toContain('\\\\');
  });

  it('never names an author, in anonymous sessions too', () => {
    const anonymous = { ...englishRetro, settings: { isAnonymous: true }, tickets: englishRetro.tickets.map((ticket) => ({ ...ticket, authorId: 'mem-secret' })) };
    const anonymousTeam = { ...team, retrospectives: [anonymous], members: [{ id: 'mem-secret', name: 'Secret Sam' }] };
    const { description } = issueFields({
      action: { id: 'a', text: 'Act', linkedTicketId: 'grp-en' }, session: anonymous, kind: 'retro', team: anonymousTeam, requestedBy: '', language: 'en'
    });
    expect(description).toContain('* Who decides what goes into the sprint\\?');
    expect(description).not.toMatch(/mem-secret|Secret Sam/);
  });
});

/**
 * Jira's own limit is the only cut (`DESCRIPTION_MAX_LENGTH`, 32,767 on Data
 * Center by default, line breaks counted twice in case Jira counts CR LF): as
 * many whole cards as fit, in board order, then a line saying how many more
 * are in RetroGemini — never a card cut, never a silent drop (review R2).
 */
describe('the description length guard', () => {
  const retroWith = (cards: string[], title = 'Deploys', extra: Array<Record<string, unknown>> = []) => ({
    id: 'r',
    name: 'Sprint 12',
    date: '2026-10-06',
    templateLanguage: 'en',
    tickets: [...cards.map((text, i) => ({ id: `c${i}`, text, groupId: 'g' })), ...extra],
    groups: [{ id: 'g', title }],
    actions: []
  });
  const describeGroup = (cards: string[], { title = 'Deploys', language = 'en', linkedTicketId = 'g', extra = [] as Array<Record<string, unknown>> } = {}) => {
    const retro = { ...retroWith(cards, title, extra), templateLanguage: language };
    const team = { retrospectives: [retro] };
    return issueFields({ action: { id: 'a', text: 'Act', linkedTicketId }, session: retro, kind: 'retro', team, requestedBy: 'Ann', language }).description;
  };
  // The first paragraph and the list heading, as the guard counts them.
  const listHead = (language = 'en') => {
    const head = describeGroup([], { language });
    return `${head}\n\n${language === 'fr' ? 'Cartes du groupe\u00a0:' : 'Cards in the group:'}`;
  };
  // A card that makes a list of `before` plus it land on exactly `total` counted.
  const filler = (before: string[], total: number, language = 'en') => {
    const used = counted(listHead(language)) + before.reduce((sum, card) => sum + 4 + card.length, 0);
    return repeat('x', total - used - 4);
  };

  it('pins Jira’s limit', () => {
    expect(DESCRIPTION_MAX_LENGTH).toBe(32767);
  });

  it('lists every card when the description lands exactly on the limit', () => {
    const cards = ['First card', 'Second card'];
    const last = filler(cards, DESCRIPTION_MAX_LENGTH);
    const description = describeGroup([...cards, last]);
    expect(counted(description)).toBe(DESCRIPTION_MAX_LENGTH);
    expect(description.endsWith(`* ${last}`)).toBe(true);
    expect(description).not.toContain('RetroGemini: Jira limits');
  });

  it('drops the last card whole, and says so, one character over', () => {
    const cards = ['First card', 'Second card'];
    const last = `${filler(cards, DESCRIPTION_MAX_LENGTH)}x`;
    const description = describeGroup([...cards, last]);
    expect(counted(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    expect(description.endsWith(
      '* First card\n* Second card\n\nAnd 1 more card in RetroGemini: Jira limits the length of a description.'
    )).toBe(true);
    expect(description).not.toContain('xxx');
  });

  it('counts the cards left out, in board order, and lists none after the first that does not fit', () => {
    const big = repeat('x', DESCRIPTION_MAX_LENGTH);
    const description = describeGroup(['First card', 'Second card', big, 'Small after', 'Another small']);
    const lines = description.split('\n');
    expect(lines.filter((line) => line.startsWith('* '))).toEqual(['* First card', '* Second card']);
    expect(lines[lines.length - 1]).toBe('And 3 more cards in RetroGemini: Jira limits the length of a description.');
    expect(lines[lines.length - 2]).toBe('');
    expect(counted(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
  });

  it('says it in French too, with the French typography', () => {
    const one = describeGroup(['Première carte', `${filler(['Première carte'], DESCRIPTION_MAX_LENGTH, 'fr')}x`], { language: 'fr' });
    const oneLine = one.split('\n').pop();
    expect(oneLine).toBe('Et 1 autre carte dans RetroGemini\u00a0: Jira limite la longueur d’une description.');
    const three = describeGroup(['Première carte', repeat('x', DESCRIPTION_MAX_LENGTH), 'b', 'c'], { language: 'fr' });
    const threeLine = three.split('\n').pop();
    expect(threeLine).toBe('Et 3 autres cartes dans RetroGemini\u00a0: Jira limite la longueur d’une description.');
    for (const line of [oneLine, threeLine]) {
      expect(line).toContain('\u00a0:');
      expect(line).not.toContain(' :');
    }
  });

  it('counts the escaped length, which is what Jira receives', () => {
    // Raw, these dashes fit with room to spare; escaped, each one is two
    // characters and the card does not fit.
    const room = DESCRIPTION_MAX_LENGTH - counted(listHead()) - 4;
    const dashes = repeat('-', Math.floor(room / 2) + 1);
    const description = describeGroup([dashes]);
    expect(description).not.toContain('\\-\\-\\-');
    expect(counted(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    // One dash fewer fits exactly when the room is even, or with one to spare.
    expect(describeGroup([repeat('-', Math.floor(room / 2))])).toContain(`* ${repeat('\\-', Math.floor(room / 2))}`);
  });

  it('says where the cards are when not even the first one fits, in English and in French', () => {
    const tooBig = repeat('x', DESCRIPTION_MAX_LENGTH);
    expect(describeGroup([tooBig]).split('\n').slice(1)).toEqual([
      '', 'The group’s card is in RetroGemini: Jira limits the length of a description.'
    ]);
    expect(describeGroup([tooBig, 'a', 'b']).split('\n').slice(1)).toEqual([
      '', 'The group’s 3 cards are in RetroGemini: Jira limits the length of a description.'
    ]);
    const frenchOne = describeGroup([tooBig], { language: 'fr' }).split('\n').pop();
    const frenchThree = describeGroup([tooBig, 'a', 'b'], { language: 'fr' }).split('\n').pop();
    expect(frenchOne).toBe('La carte du groupe est dans RetroGemini\u00a0: Jira limite la longueur d’une description.');
    expect(frenchThree).toBe('Les 3 cartes du groupe sont dans RetroGemini\u00a0: Jira limite la longueur d’une description.');
    for (const line of [frenchOne, frenchThree]) expect(line).not.toContain(' :');
  });

  it('keeps the first paragraph alone when a group title leaves room for nothing after it', () => {
    const shortTitle = describeGroup([], { title: 't' });
    const title = repeat('t', DESCRIPTION_MAX_LENGTH - counted(shortTitle) - 10);
    const description = describeGroup(['A card'], { title });
    expect(description).toBe(describeGroup([], { title }));
    expect(description).not.toContain('\n');
    expect(counted(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
  });

  it('says a quote too long for Jira is in RetroGemini instead of cutting it, in English and in French', () => {
    const giant = repeat('x', 40000);
    const english = describeGroup([], { linkedTicketId: 'giant', extra: [{ id: 'giant', text: giant }] });
    expect(english).toBe('Action from the retrospective Sprint 12 (2026\\-10\\-06) — Re: too long to quote in a Jira description, see RetroGemini. Requested in RetroGemini as Ann.');
    const french = describeGroup([], { language: 'fr', linkedTicketId: 'giant', extra: [{ id: 'giant', text: giant }] });
    expect(french).toBe('Action de la rétrospective Sprint 12 (2026\\-10\\-06) — Concerne\u00a0: trop long pour être cité dans une description Jira, voir RetroGemini. Demandée dans RetroGemini par Ann.');
    expect(french).not.toContain(' :');
    // A group title too long to quote still lists its cards.
    const longTitle = describeGroup(['A card'], { title: giant });
    expect(longTitle.split('\n')).toEqual([
      'Action from the retrospective Sprint 12 (2026\\-10\\-06) — Re: too long to quote in a Jira description, see RetroGemini. Requested in RetroGemini as Ann.',
      '', 'Cards in the group:', '* A card'
    ]);
  });

  it('fits whatever the group holds: whole cards, a prefix of the board, never an empty item', () => {
    // A small seeded generator, so a failure is reproducible.
    let seed = 0x5eed;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // Spaces, escapes that double, backslashes that vanish, line breaks, an
    // emoji, a no-break space: one long random string, sliced for speed.
    const alphabet = ['a', 'b', ' ', '-', '*', '{', '\\', '\n', 'é', '\u{1F600}', '?', '\u00a0'];
    const pool = Array.from({ length: 40000 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
    const text = (max: number) => {
      const from = Math.floor(random() * (pool.length - max));
      return pool.slice(from, from + Math.floor(random() * max));
    };
    let cut = 0;
    for (let run = 0; run < 200; run += 1) {
      const cards = Array.from({ length: Math.floor(random() * 60) }, () => text(2000));
      const title = random() < 0.1 ? text(33000) : text(40);
      const description = describeGroup(cards, { title });
      if (description.includes('RetroGemini: Jira limits')) cut += 1;
      expect(counted(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
      const items = description.split('\n').filter((line) => line.startsWith('* '));
      const visible = actionGroupCards({ action: { linkedTicketId: 'g' }, team: { retrospectives: [retroWith(cards, title)] } });
      expect(items).toEqual(visible.slice(0, items.length).map((card) => `* ${card}`));
      for (const item of items) expect(item.trim()).not.toBe('*');
    }
    // Not vacuous: the limit was reached in a good share of the runs.
    expect(cut).toBeGreaterThan(20);
  });

  it('stays linear: five thousand cards build in well under a second', () => {
    // About the 1 MB a session update may carry, all of it in one group.
    const cards = Array.from({ length: 5000 }, (_, i) => `${i} ${repeat('w', 195)}`);
    const started = performance.now();
    const description = describeGroup(cards);
    const elapsed = performance.now() - started;
    expect(counted(description)).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
    expect(description.endsWith('more cards in RetroGemini: Jira limits the length of a description.')).toBe(true);
    expect(elapsed).toBeLessThan(1000);
  });
});

/**
 * The server builds each issue with `issueSource` then `issueFields`; the
 * dialog previews it with `jiraIssuePreview`. For a group, a huge card and an
 * overflowing group, the two say the same thing.
 */
describe('the server and the preview agree on the new content', () => {
  const retro = {
    id: 'r',
    name: 'Sprint 12',
    date: '2026-10-06',
    templateLanguage: 'en',
    tickets: [
      { id: 'huge', text: HUGE_CARD },
      { id: 'g1', text: 'First of the group', groupId: 'g' },
      { id: 'g2', text: 'Second\nof the group?', groupId: 'g' },
      { id: 'o1', text: 'Small', groupId: 'over' },
      { id: 'o2', text: repeat('y', DESCRIPTION_MAX_LENGTH), groupId: 'over' },
      { id: 'o3', text: 'Small again', groupId: 'over' }
    ],
    groups: [{ id: 'g', title: 'Deploys' }, { id: 'over', title: 'Overflow' }],
    actions: [
      { id: 'on-group', text: 'Group action', linkedTicketId: 'g' },
      { id: 'on-huge', text: 'Huge action', linkedTicketId: 'huge', contextText: `Re: "${HUGE_CARD.substring(0, 50)}..."` },
      { id: 'on-over', text: 'Overflow action', linkedTicketId: 'over' }
    ]
  };
  const team = { retrospectives: [retro], healthChecks: [], globalActions: [] };

  it.each(['on-group', 'on-huge', 'on-over'])('for %s', (actionId) => {
    const source = issueSource({ team, actionId, preferredSessionId: 'r' });
    const server = issueFields({ action: source.action, session: source.session, kind: source.kind, team, requestedBy: 'Ann', language: 'fr' });
    const preview = jiraIssuePreview({
      action: retro.actions.find((entry) => entry.id === actionId) as never, team: team as never, session: retro as never, kind: 'retro', sessionId: 'r', requestedBy: 'Ann', language: 'fr'
    });
    expect(preview).toEqual(server);
    expect(counted(server.description)).toBeLessThanOrEqual(DESCRIPTION_MAX_LENGTH);
  });

  it('quotes the huge card whole over the cut context stored on the action', () => {
    const preview = jiraIssuePreview({
      action: retro.actions[1] as never, team: team as never, session: retro as never, kind: 'retro', sessionId: 'r', requestedBy: 'Ann', language: 'en'
    });
    expect(preview.description).toContain(HUGE_CARD);
    expect(preview.description).not.toContain('...');
  });
});

/**
 * Which copy of an action an issue is written from, and which session it says
 * the action comes from. One rule for the server, which builds the issue, and
 * the dialog, which previews it: two private versions of it once disagreed,
 * and the facilitator previewed one description while Jira received another.
 */
describe('issueSource', () => {
  const act = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `Action ${id}`, done: false, type: 'new', ...extra });
  const retroA = { id: 'retro-a', name: 'Sprint 13', actions: [act('in-both-retros', { text: 'From A', linkedTicketId: 'ta' }), act('retro-only')] };
  const retroB = { id: 'retro-b', name: 'Sprint 12', actions: [act('in-both-retros', { text: 'From B', linkedTicketId: 'tb' }), act('proposal-here', { type: 'proposal' })] };
  const check = { id: 'hc-1', name: 'Q3', actions: [act('hc-only'), act('in-both-retros', { text: 'From the check' })] };
  const team = {
    retrospectives: [retroA, retroB],
    healthChecks: [check],
    globalActions: [
      act('backlog-only', { text: 'Backlog text' }),
      act('retro-only', { text: 'Edited on the Dashboard', linkedTicketId: undefined }),
      act('proposal-here', { text: 'Promoted' })
    ]
  };

  it.each([
    ['the first retrospective holding the action', { actionId: 'in-both-retros' }, retroA, 'retro', { text: 'From A', linkedTicketId: 'ta' }],
    ['the session asked for when it holds the action', { actionId: 'in-both-retros', preferredSessionId: 'retro-b' }, retroB, 'retro', { text: 'From B', linkedTicketId: 'tb' }],
    ['a health check asked for that holds it', { actionId: 'in-both-retros', preferredSessionId: 'hc-1' }, check, 'healthcheck', { text: 'From the check' }],
    ['the first retrospective when the session asked for does not hold it', { actionId: 'retro-only', preferredSessionId: 'retro-b' }, retroA, 'retro', { text: 'Edited on the Dashboard' }],
    ['the first retrospective when the session asked for is unknown', { actionId: 'in-both-retros', preferredSessionId: 'gone' }, retroA, 'retro', { text: 'From A' }],
    ['a health check when no retrospective holds it', { actionId: 'hc-only' }, check, 'healthcheck', { text: 'Action hc-only' }],
    ['the backlog when no session holds it', { actionId: 'backlog-only' }, null, 'backlog', { text: 'Backlog text' }],
    // A proposal is not an action yet: the copy that is one is the backlog's.
    ['the backlog when a session holds only a proposal with that id', { actionId: 'proposal-here', preferredSessionId: 'retro-b' }, null, 'backlog', { text: 'Promoted' }]
  ])('takes %s', (_label, input, session, kind, content) => {
    const source = issueSource({ team, ...input });
    expect(source.session).toBe(session);
    expect(source.kind).toBe(kind);
    expect(source.action).toMatchObject(content);
  });

  it('overlays the session copy with the backlog copy: the newest text, and the card it was written against', () => {
    const source = issueSource({ team, actionId: 'retro-only' });
    // The whole-action route edits the backlog copy first; only the session's
    // copy remembers anything the backlog's does not say.
    expect(source.action).toEqual({ id: 'retro-only', text: 'Edited on the Dashboard', done: false, type: 'new', linkedTicketId: undefined });
    const withCard = issueSource({
      team: { ...team, retrospectives: [{ ...retroA, actions: [act('retro-only', { linkedTicketId: 'ta', contextText: 'Re: x' })] }] },
      actionId: 'retro-only'
    });
    expect(withCard.action).toMatchObject({ text: 'Edited on the Dashboard', contextText: 'Re: x' });
    // The backlog copy carries `linkedTicketId: undefined` (a field it does
    // not say): it must not erase the card the session copy quotes from.
    // `toMatchObject` and `toEqual` read a missing property as `undefined`,
    // so only a direct read pins it.
    expect(withCard.action!.linkedTicketId).toBe('ta');
  });

  it('finds nothing for an id no copy has, nor in a team it cannot read', () => {
    expect(issueSource({ team, actionId: 'nowhere' })).toEqual({ action: null, session: null, kind: 'backlog' });
    expect(issueSource({ team: null, actionId: 'nowhere' })).toEqual({ action: null, session: null, kind: 'backlog' });
    expect(issueSource({ team: { retrospectives: 'x', healthChecks: [null], globalActions: [null, 7] }, actionId: 'a' }))
      .toEqual({ action: null, session: null, kind: 'backlog' });
  });

  it('never mutates the team', () => {
    const before = structuredClone(team);
    issueSource({ team, actionId: 'retro-only' }).action!.text = 'changed';
    expect(team).toEqual(before);
  });
});

/**
 * Which parent issue an action goes under in `sessionParent` mode, read from
 * the same `issueSource` call that writes the action's own issue — so the
 * parent and the sub-task's description can never disagree about where the
 * action comes from.
 */
describe('jiraParentScope', () => {
  it.each([
    ['a retrospective', { kind: 'retro', session: { id: 'r-12', name: 'Sprint 12' } }, 'retro:r-12'],
    ['a health check', { kind: 'healthcheck', session: { id: 'hc-q3' } }, 'healthcheck:hc-q3']
  ])('is the session of %s', (_label, source, key) => {
    const scope = jiraParentScope(source);
    expect(scope).toEqual({ key, kind: source.kind, session: source.session });
    // The very session object, not a copy: the parent's title reads it.
    expect(scope.session).toBe(source.session);
  });

  it.each([
    ['a backlog action', { kind: 'backlog', session: null }],
    ['a session with no id', { kind: 'retro', session: { name: 'Sprint 12' } }],
    ['a session with an empty id', { kind: 'healthcheck', session: { id: '' } }],
    ['a session id that is not a string', { kind: 'retro', session: { id: 12 } }],
    ['an unknown kind', { kind: 'board', session: { id: 'b1' } }],
    ['no source at all', undefined]
  ])('is the team backlog for %s', (_label, source) => {
    expect(jiraParentScope(source as never)).toEqual({ key: 'backlog', kind: 'backlog', session: null });
  });

  it('follows issueSource: an action homed in an earlier retro goes under that retro', () => {
    const team = {
      retrospectives: [
        { id: 'retro-b', name: 'Sprint 13', actions: [] },
        { id: 'retro-a', name: 'Sprint 12', actions: [{ id: 'prev', text: 'An earlier action' }] }
      ],
      healthChecks: [],
      globalActions: [{ id: 'dash', text: 'Added on the dashboard' }]
    };
    // Sent from retro B's Review, which does not hold it.
    expect(jiraParentScope(issueSource({ team, actionId: 'prev', preferredSessionId: 'retro-b' })).key).toBe('retro:retro-a');
    expect(jiraParentScope(issueSource({ team, actionId: 'dash' })).key).toBe('backlog');
  });
});

describe('parentIssueFields', () => {
  const englishRetro = { id: 'retro-12', name: 'Sprint 12', date: '21.10.2026', templateLanguage: 'en' };
  const frenchRetro = { id: 'retro-13', name: 'Sprint 13', date: '21.10.2026', templateLanguage: 'fr' };
  const team = { id: 'team-1', name: 'Platform', retrospectives: [frenchRetro, englishRetro], healthChecks: [], globalActions: [] };
  const scopeOf = (kind: 'retro' | 'healthcheck', session: Record<string, unknown>) => jiraParentScope({ kind, session });
  const backlog = jiraParentScope({ kind: 'backlog', session: null });

  it('titles and describes a retrospective in English and in French', () => {
    expect(parentIssueFields({ scope: scopeOf('retro', englishRetro), team, requestedBy: 'Ann', language: 'fr' })).toEqual({
      summary: 'Retrospective actions: Sprint 12 (21.10.2026)',
      description: 'Actions of the retrospective Sprint 12 (21.10.2026), created in Jira as sub-tasks of this issue. Requested in RetroGemini by Ann.',
      language: 'en'
    });
    expect(parentIssueFields({ scope: scopeOf('retro', frenchRetro), team, requestedBy: 'Ann', language: 'en' })).toEqual({
      summary: 'Actions de la rétrospective\u00a0: Sprint 13 (21.10.2026)',
      description: 'Actions de la rétrospective Sprint 13 (21.10.2026), créées dans Jira en sous-tâches de ce ticket. Demandé dans RetroGemini par Ann.',
      language: 'fr'
    });
  });

  it('titles and describes a health check in English and in French', () => {
    const englishCheck = { id: 'hc-1', name: 'Q3', date: '21.10.2026', templateId: 'team_health_en' };
    const frenchCheck = { ...englishCheck, templateId: 'team_health_fr' };
    expect(parentIssueFields({ scope: scopeOf('healthcheck', englishCheck), team, requestedBy: '', language: 'fr' })).toEqual({
      summary: 'Health check actions: Q3 (21.10.2026)',
      description: 'Actions of the health check Q3 (21.10.2026), created in Jira as sub-tasks of this issue. Created from RetroGemini.',
      language: 'en'
    });
    expect(parentIssueFields({ scope: scopeOf('healthcheck', frenchCheck), team, requestedBy: '', language: 'en' })).toEqual({
      summary: 'Actions du bilan de santé\u00a0: Q3 (21.10.2026)',
      description: 'Actions du bilan de santé Q3 (21.10.2026), créées dans Jira en sous-tâches de ce ticket. Créé depuis RetroGemini.',
      language: 'fr'
    });
  });

  it('titles and describes the team dashboard’s parent after the team, in the language of its latest retro', () => {
    expect(parentIssueFields({ scope: backlog, team, requestedBy: 'Ann', language: 'en' })).toEqual({
      summary: 'Actions de l’équipe\u00a0: Platform',
      description: 'Actions de l’équipe Platform ajoutées sur son tableau de bord RetroGemini, créées dans Jira en sous-tâches de ce ticket. Demandé dans RetroGemini par Ann.',
      language: 'fr'
    });
    const englishTeam = { ...team, retrospectives: [englishRetro] };
    expect(parentIssueFields({ scope: backlog, team: englishTeam, requestedBy: 'Ann', language: 'fr' })).toEqual({
      summary: 'Team actions: Platform',
      description: 'Actions of the team Platform added on its RetroGemini dashboard, created in Jira as sub-tasks of this issue. Requested in RetroGemini by Ann.',
      language: 'en'
    });
  });

  it('writes the French separator with a no-break space before the colon, never an ordinary one', () => {
    for (const scope of [scopeOf('retro', frenchRetro), scopeOf('healthcheck', { id: 'h', name: 'X', templateId: 'team_health_fr' }), backlog]) {
      const { summary } = parentIssueFields({ scope, team, requestedBy: '', language: 'fr' });
      expect(summary).toContain('\u00a0:');
      expect(summary).not.toContain(' :');
    }
  });

  // AGENTS.md → French typography: the no-break spaces are written as
  // escapes, so they stay visible in review. A raw one reads as an ordinary
  // space in a diff — exactly the mistake the rule is there to show.
  it('writes its no-break spaces as escapes in the source, never as the invisible characters', () => {
    const source = readFileSync(join(__dirname, '..', 'utils', 'jiraIssueContent.js'), 'utf8');
    const raw = source.split('\n').flatMap((line, index) => (/[\u00a0\u202f]/u.test(line) ? [index + 1] : []));
    expect(raw).toEqual([]);
  });

  // One table drives both: the parent and its sub-tasks are written in the
  // same language, for every kind of home, whatever the clicker reads.
  it.each([
    ['an English retro', 'retro', { id: 'r', name: 'R', templateLanguage: 'en' }],
    ['a French retro', 'retro', { id: 'r', name: 'R', templateLanguage: 'fr' }],
    ['a retro with no language', 'retro', { id: 'r', name: 'R' }],
    ['a built-in French health check', 'healthcheck', { id: 'h', name: 'H', templateId: 'team_health_fr' }],
    ['a custom health check', 'healthcheck', { id: 'h', name: 'H', templateId: 'custom-1' }],
    ['the backlog', 'backlog', null]
  ])('is written in the language of its sub-tasks for %s', (_label, kind, session) => {
    for (const teamCase of [team, { ...team, retrospectives: [] }]) {
      for (const language of ['en', 'fr', null]) {
        const scope = jiraParentScope({ kind, session });
        const parent = parentIssueFields({ scope, team: teamCase, requestedBy: 'Ann', language });
        const subtask = issueFields({ action: { id: 'a', text: 'Do it' }, session, kind: kind as 'retro', team: teamCase, requestedBy: 'Ann', language });
        expect(parent.language).toBe(subtask.language);
      }
    }
  });

  it('leaves out a blank name and a blank date', () => {
    const blank = (session: Record<string, unknown>) =>
      parentIssueFields({ scope: scopeOf('retro', { id: 'r', templateLanguage: 'en', ...session }), team, requestedBy: '', language: 'en' });
    expect(blank({ name: ' \n ', date: '21.10.2026' })).toMatchObject({
      summary: 'Retrospective actions (21.10.2026)',
      description: 'Actions of the retrospective (21.10.2026), created in Jira as sub-tasks of this issue. Created from RetroGemini.'
    });
    expect(blank({ name: 'Sprint 12', date: '' }).summary).toBe('Retrospective actions: Sprint 12');
    expect(blank({}).summary).toBe('Retrospective actions');
    expect(parentIssueFields({ scope: backlog, team: { ...team, name: '  ', retrospectives: [englishRetro] }, requestedBy: '', language: 'en' }).summary)
      .toBe('Team actions');
  });

  // A health check's default name is "Health Check {date}": its title must not
  // read "Health check actions: Health Check 21.10.2026 (21.10.2026)" [R8].
  it('drops the parentheses when the name already carries the stored date', () => {
    const englishDefault = { id: 'h', name: 'Health Check 21.10.2026', date: '21.10.2026', templateId: 'team_health_en' };
    const frenchDefault = { id: 'h', name: 'Bilan de santé 21.10.2026', date: '21.10.2026', templateId: 'team_health_fr' };
    expect(parentIssueFields({ scope: scopeOf('healthcheck', englishDefault), team, requestedBy: '', language: 'en' }).summary)
      .toBe('Health check actions: Health Check 21.10.2026');
    expect(parentIssueFields({ scope: scopeOf('healthcheck', frenchDefault), team, requestedBy: '', language: 'en' }).summary)
      .toBe('Actions du bilan de santé\u00a0: Bilan de santé 21.10.2026');
    expect(parentIssueFields({ scope: scopeOf('healthcheck', englishDefault), team, requestedBy: '', language: 'en' }).description)
      .toBe('Actions of the health check Health Check 21.10.2026, created in Jira as sub-tasks of this issue. Created from RetroGemini.');
    // The sub-tasks' own descriptions are unchanged.
    expect(issueFields({ action: { id: 'a', text: 'x' }, session: englishDefault, kind: 'healthcheck', team, requestedBy: '', language: 'en' }).description)
      .toBe('Action from the health check Health Check 21.10.2026 (21.10.2026). Created from RetroGemini.');
  });

  it('is one line, and cuts the name so the title, the separator and the date survive within 255', () => {
    const name = `Sprint\n${repeat('n', 400)}`;
    const { summary } = parentIssueFields({ scope: scopeOf('retro', { id: 'r', name, date: '21.10.2026', templateLanguage: 'en' }), team, requestedBy: '', language: 'en' });
    expect(summary.length).toBe(SUMMARY_MAX_LENGTH);
    expect(summary.startsWith('Retrospective actions: Sprint n')).toBe(true);
    expect(summary.endsWith(' (21.10.2026)')).toBe(true);
    expect(summary).not.toMatch(/[\r\n]/);
  });

  it('cuts a date longer than 40 characters before the name', () => {
    const date = repeat('d', 60);
    const { summary } = parentIssueFields({ scope: scopeOf('retro', { id: 'r', name: repeat('n', 300), date, templateLanguage: 'en' }), team, requestedBy: '', language: 'en' });
    expect(summary.length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
    expect(summary.endsWith(` (${repeat('d', 40)})`)).toBe(true);
  });

  it('drops an emoji whole at the cut, never half of it', () => {
    const title = 'Retrospective actions: ';
    const suffix = ' (21.10.2026)';
    // The emoji's high surrogate would be the last unit the cut keeps.
    const room = SUMMARY_MAX_LENGTH - title.length - suffix.length;
    const name = `${repeat('a', room - 1)}\u{1F600}tail`;
    const { summary } = parentIssueFields({ scope: scopeOf('retro', { id: 'r', name, date: '21.10.2026', templateLanguage: 'en' }), team, requestedBy: '', language: 'en' });
    expect(summary).toBe(`${title}${repeat('a', room - 1)}${suffix}`);
    expect(summary).not.toMatch(LONE_SURROGATE);
    expect([...summary].length).toBeLessThanOrEqual(SUMMARY_MAX_LENGTH);
  });

  it('cuts a long team name for the dashboard’s parent too', () => {
    const { summary } = parentIssueFields({ scope: backlog, team: { ...team, name: repeat('t', 300), retrospectives: [englishRetro] }, requestedBy: '', language: 'en' });
    expect(summary).toBe(`Team actions: ${repeat('t', SUMMARY_MAX_LENGTH - 'Team actions: '.length)}`);
  });

  it('escapes every interpolated value of the description, and leaves the summary plain', () => {
    const session = { id: 'r', name: 'Sprint *12* [~admin]', date: '{html}', templateLanguage: 'en' };
    const parent = parentIssueFields({ scope: scopeOf('retro', session), team, requestedBy: '!https://e/i.png!', language: 'en' });
    expect(parent.description).toBe(
      'Actions of the retrospective Sprint \\*12\\* \\[\\~admin\\] (\\{html\\}), created in Jira as sub-tasks of this issue. '
      + 'Requested in RetroGemini by \\!https://e/i.png\\!.'
    );
    expect(parent.summary).toBe('Retrospective actions: Sprint *12* [~admin] ({html})');

    const markupTeam = { ...team, name: '[~admin] {html}', retrospectives: [englishRetro] };
    expect(parentIssueFields({ scope: backlog, team: markupTeam, requestedBy: '', language: 'en' }).description)
      .toBe('Actions of the team \\[\\~admin\\] \\{html\\} added on its RetroGemini dashboard, created in Jira as sub-tasks of this issue. Created from RetroGemini.');
  });

  it('survives a scope or a team it cannot read', () => {
    expect(parentIssueFields({ scope: undefined as never, team: null, requestedBy: undefined, language: undefined })).toEqual({
      summary: 'Team actions',
      description: 'Actions of the team added on its RetroGemini dashboard, created in Jira as sub-tasks of this issue. Created from RetroGemini.',
      language: 'en'
    });
  });
});
