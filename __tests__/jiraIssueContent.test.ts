import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
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
  issueSource,
  issueSummary,
  jiraParentScope,
  parentIssueFields,
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
