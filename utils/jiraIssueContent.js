/**
 * What an issue created from an action says, written once for the server and
 * the screens.
 *
 * ## Why this module exists
 *
 * The server builds every issue it creates: the client sends action ids, never
 * a summary or a description, so a participant cannot have the team's Jira
 * token file arbitrary text. The confirmation dialog shows the facilitator the
 * issue before it is sent, and it builds that preview with these same
 * functions, so what the dialog shows is exactly what Jira receives. That is
 * why this lives in `utils/` (like `emailAddress.js`) and imports no
 * TypeScript: the Express routes load it as it is.
 *
 * ## The language of an issue
 *
 * An issue is shared content, like the board: it is written in the language of
 * the session that holds the action, never in the language of whoever pressed
 * the button. `issueContentLanguage` reads, in order: a retrospective's
 * template language (a retro with none predates the feature and was English);
 * a built-in health check's template (`team_health_fr` / `team_health_en`);
 * then, for a custom health check or a backlog action, the team's latest retro
 * by the dashboard's own rule (`initialTemplateLanguage`); then the clicker's
 * language; then English.
 *
 * ## No markup from participants
 *
 * Jira renders an issue description (REST API v2) as wiki markup. Text a
 * participant typed — a retro's name, a quoted card, their display name — would
 * otherwise become markup in somebody else's tracker: `[~admin]` notifies an
 * administrator, `[label|url]` hides where a link goes, `!url!` makes every
 * reader's browser fetch an image from anywhere, `{html}` and friends are
 * macros. `wikiText` neutralises one interpolated value; the description's own
 * template words never go through it, and never need to.
 *
 * ## The context is the one the screens show
 *
 * The description quotes the action's context ("Re: …") in every session,
 * anonymous ones included (maintainer decision D2: the quote names a card,
 * never its author). The strings are the `session.actionContext.*` entries of
 * `i18n/locales/{en,fr}/session.ts`, re-declared here because those files are
 * TypeScript; `__tests__/jiraIssueContent.test.ts` fails if the two drift.
 */

/**
 * The id the client links a ROTI follow-up action to, in place of a card. It is
 * declared in `components/session/retroConstants.ts`, which is TypeScript, so
 * it is re-declared here; a test asserts the two are equal.
 */
export const ROTI_FOLLOW_UP_LINK_ID = '__roti_follow_up__';

/** Jira refuses a summary longer than 255 characters. */
export const SUMMARY_MAX_LENGTH = 255;

/** The longest display name a description names its requester by. */
export const REQUESTED_BY_MAX_LENGTH = 80;

// How much of a card the context quotes, as the screens do.
const TICKET_QUOTE_MAX_LENGTH = 50;

const CONTENT_LANGUAGES = new Set(['en', 'fr']);
const isContentLanguage = (value) => CONTENT_LANGUAGES.has(value);

const BUILT_IN_HEALTH_CHECK_LANGUAGES = new Map([
  ['team_health_en', 'en'],
  ['team_health_fr', 'fr']
]);

// Control characters (C0, DEL, C1 — tab, CR and LF among them) and the Unicode
// line and paragraph separators. Any of them could end a line for Jira, and a
// wiki-markup heading, list or quote only exists at the start of a line.
const LINE_BREAKING = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
// Runs of ordinary spaces only: a no-break space is French typography, kept.
const SPACE_RUN = / {2,}/g;
// Every character Jira's wiki renderer may read as markup.
const WIKI_MARKUP = /[{}[\]|*_\-+^~!?#`]/g;

const isObject = (value) => !!value && typeof value === 'object';
const arrayOf = (value) => (Array.isArray(value) ? value : []);

// The first `max` UTF-16 code units of `text`, one fewer when the cut would
// fall inside a surrogate pair: an emoji is dropped whole, never halved.
const cutCodeUnits = (text, max) => {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const splitsPair = last >= 0xd800 && last <= 0xdbff;
  return text.slice(0, splitsPair ? max - 1 : max);
};

// One line of text: every line-breaking character becomes a space, runs of
// spaces become one, and the ends are trimmed.
const oneLine = (text) => text.replace(LINE_BREAKING, ' ').replace(SPACE_RUN, ' ').trim();

/**
 * One interpolated value, made safe to put in a Jira wiki-markup description.
 *
 *  1. Every line-breaking character becomes a space, so nothing a participant
 *     typed starts a line — `h1.`, `bq.`, `*` and `#` lists, tables — and a run
 *     of spaces becomes one.
 *  2. A backslash the participant typed becomes a space. Kept, it would sit in
 *     front of the escape added in step 3 and form `\\`, which is Jira's forced
 *     line break, and the character after it would be markup again.
 *  3. Each of `{ } [ ] | * _ - + ^ ~ ! ? # `` ` `` is escaped with a backslash,
 *     which Jira renders as the character itself.
 *
 * A non-string reads as `''`.
 *
 * @param {unknown} value
 * @returns {string}
 */
export const wikiText = (value) => {
  if (typeof value !== 'string') return '';
  return oneLine(value.replaceAll('\\', ' ')).replace(WIKI_MARKUP, (character) => `\\${character}`);
};

/**
 * The summary of the issue created from an action's text: one line (newlines
 * and tabs become single spaces), trimmed, and at most 255 characters.
 *
 * The limit is counted in UTF-16 code units — what JavaScript and the JVM Jira
 * runs on both call a string's length — so the summary fits whichever way Jira
 * counts, and is also at most 255 code points. The cut never splits a surrogate
 * pair. Markup is not escaped: Jira shows a summary as plain text. An empty
 * result is the caller's to refuse; nothing is invented here.
 *
 * @param {unknown} text
 * @returns {string}
 */
export const issueSummary = (text) => {
  if (typeof text !== 'string') return '';
  return cutCodeUnits(oneLine(text), SUMMARY_MAX_LENGTH).trim();
};

/**
 * The language an issue is written in. See the module header for the order.
 *
 * Every value is read as data: a template language another pod stored, a
 * health-check template id, a language posted with the request. Anything that
 * is not `en` or `fr` is not a language here, and `issueContentLanguage({})`
 * is English.
 *
 * @param {{
 *   session?: object | null,
 *   sessionKind?: 'retro' | 'healthcheck' | 'backlog',
 *   team?: object | null,
 *   fallbackLanguage?: unknown
 * }} [input]
 * @returns {'en' | 'fr'}
 */
export const issueContentLanguage = ({ session, sessionKind, team, fallbackLanguage } = {}) => {
  if (isObject(session) && sessionKind === 'retro') {
    // The session screen reads a retro the same way (`toLanguage(…, 'en')`),
    // so the issue is in the language its board and context are in.
    return isContentLanguage(session.templateLanguage) ? session.templateLanguage : 'en';
  }
  if (isObject(session) && sessionKind === 'healthcheck') {
    const builtIn = BUILT_IN_HEALTH_CHECK_LANGUAGES.get(session.templateId);
    if (builtIn) return builtIn;
  }

  // `initialTemplateLanguage`: the latest retro decides when there is one, and
  // a latest retro with no (or an unknown) language reads as English.
  const latestRetro = isObject(team) ? arrayOf(team.retrospectives)[0] : undefined;
  if (latestRetro) {
    return isContentLanguage(latestRetro.templateLanguage) ? latestRetro.templateLanguage : 'en';
  }
  return isContentLanguage(fallbackLanguage) ? fallbackLanguage : 'en';
};

// `session.actionContext.*`, in both languages. Functions rather than
// `{placeholder}` templates, so a `$&` in a card is never read as a
// replacement pattern.
const CONTEXT_STRINGS = {
  en: {
    rotiFollowUp: 'Re: ROTI follow-up',
    ticket: (text) => `Re: "${text}"`,
    group: (title) => `Re: Group "${title}"`
  },
  fr: {
    rotiFollowUp: 'Concerne\u00a0: suivi du ROTI',
    ticket: (text) => `Concerne\u00a0: «\u00a0${text}\u00a0»`,
    group: (title) => `Concerne\u00a0: groupe «\u00a0${title}\u00a0»`
  }
};

/**
 * The context line of an action, as the session screens write it
 * (`buildActionContext` in `components/Session.tsx`):
 *
 *  - a context already stored on the action wins, in whatever language it was
 *    written;
 *  - a ROTI follow-up says so;
 *  - a card of any retro is quoted, cut at 50 characters and marked `...` when
 *    longer (the cut never halves an emoji, the one place this differs from
 *    the screen, which would show a broken character there);
 *  - a group is named;
 *  - anything else — no link, a health-check dimension, a card deleted since —
 *    has no context, `''`.
 *
 * Retros are searched in the team's order, a card before a group, as the
 * screens do. Unknown languages read as English.
 *
 * @param {{ action?: object, team?: object | null, language?: unknown }} [input]
 * @returns {string}
 */
export const actionContextText = ({ action, team, language } = {}) => {
  if (!isObject(action)) return '';
  if (typeof action.contextText === 'string' && action.contextText) return action.contextText;

  const linkedId = action.linkedTicketId;
  if (typeof linkedId !== 'string' || !linkedId) return '';

  const strings = CONTEXT_STRINGS[isContentLanguage(language) ? language : 'en'];
  if (linkedId === ROTI_FOLLOW_UP_LINK_ID) return strings.rotiFollowUp;

  for (const retro of isObject(team) ? arrayOf(team.retrospectives) : []) {
    if (!isObject(retro)) continue;
    const ticket = arrayOf(retro.tickets).find((candidate) => isObject(candidate) && candidate.id === linkedId);
    if (ticket) {
      const text = typeof ticket.text === 'string' ? ticket.text : '';
      const cut = text.length > TICKET_QUOTE_MAX_LENGTH ? '...' : '';
      return strings.ticket(`${cutCodeUnits(text, TICKET_QUOTE_MAX_LENGTH)}${cut}`);
    }
    const group = arrayOf(retro.groups).find((candidate) => isObject(candidate) && candidate.id === linkedId);
    if (group) return strings.group(typeof group.title === 'string' ? group.title : '');
  }
  return '';
};

/**
 * Where the issue of one action is written from: the copy of the action, the
 * session it says the action comes from, and which kind of session that is.
 * One rule for the server, which builds the issue from the team record, and
 * for the confirmation dialog, which previews it from the client's copy of
 * that record — two private versions of it once disagreed, and the
 * facilitator previewed one description while Jira received another.
 *
 * One action can live in several homes at once (deleting a session copies its
 * actions into the backlog; the whole-action route adds a backlog copy of an
 * action only a session held). The session is, in order:
 *
 *  1. the one named `preferredSessionId` when it holds the action — the Review
 *     step the facilitator pressed the button in;
 *  2. the first retrospective that holds it;
 *  3. the first health check that holds it;
 *  4. none: a backlog action.
 *
 * The action is that session's copy overlaid by the backlog copy, where the
 * backlog copy says something: the whole-action route edits the backlog copy
 * first, so its text is the newest, and only the session's copy remembers the
 * card it was written against (`linkedTicketId`, `contextText`). A proposal is
 * not an action yet, and is never a copy.
 *
 * Pure: the action returned is a new object, and nothing is mutated.
 *
 * @param {{ team?: object | null, actionId: string, preferredSessionId?: string | null }} input
 * @returns {{ action: object | null, session: object | null, kind: 'retro' | 'healthcheck' | 'backlog' }}
 */
export const issueSource = ({ team, actionId, preferredSessionId } = {}) => {
  const copyIn = (actions) => arrayOf(actions)
    .find((candidate) => isObject(candidate) && candidate.id === actionId && candidate.type !== 'proposal');
  const sessions = (list, kind) => (isObject(team) ? arrayOf(team[list]) : [])
    .filter(isObject)
    .map((session) => ({ session, kind, copy: copyIn(session.actions) }))
    .filter(({ copy }) => copy !== undefined);
  const holders = [...sessions('retrospectives', 'retro'), ...sessions('healthChecks', 'healthcheck')];
  const home = (typeof preferredSessionId === 'string' && preferredSessionId
    ? holders.find(({ session }) => session.id === preferredSessionId)
    : undefined) ?? holders[0];
  const backlog = isObject(team) ? copyIn(team.globalActions) : undefined;

  if (!home && !backlog) return { action: null, session: null, kind: 'backlog' };
  const action = { ...(home?.copy ?? {}) };
  for (const [field, value] of Object.entries(backlog ?? {})) {
    if (value !== undefined) action[field] = value;
  }
  return { action, session: home?.session ?? null, kind: home?.kind ?? 'backlog' };
};

// The description's template words. Only the values put between them go
// through `wikiText`; these never contain markup.
const DESCRIPTION_STRINGS = {
  en: {
    retro: 'Action from the retrospective',
    healthcheck: 'Action from the health check',
    backlog: 'Action from the team backlog',
    requestedBy: (person) => `Requested in RetroGemini as ${person}.`,
    createdFrom: 'Created from RetroGemini.'
  },
  fr: {
    retro: 'Action de la rétrospective',
    healthcheck: 'Action du bilan de santé',
    backlog: 'Action du backlog de l’équipe',
    requestedBy: (person) => `Demandée dans RetroGemini par ${person}.`,
    createdFrom: 'Créée depuis RetroGemini.'
  }
};

// The name the description credits, before escaping: controls removed (not
// replaced — a display name has no line breaks to keep), trimmed, at most 80
// characters. It is cosmetic and sent by the client, never an identity.
const requesterName = (value) => {
  if (typeof value !== 'string') return '';
  return cutCodeUnits(value.replace(LINE_BREAKING, '').trim(), REQUESTED_BY_MAX_LENGTH).trim();
};

// "Action from the retrospective Sprint 12 (2026-10-06)", escaped. A session
// that was not given, or a backlog action, is described as the team backlog;
// a missing name or date is left out rather than shown as empty brackets.
const describeOrigin = (strings, kind, session) => {
  if (!isObject(session) || (kind !== 'retro' && kind !== 'healthcheck')) return strings.backlog;
  const name = wikiText(session.name);
  const date = wikiText(session.date);
  return [strings[kind], name, date ? `(${date})` : ''].filter(Boolean).join(' ');
};

/**
 * The fields of the issue created from one action:
 *
 *  - `summary`: `issueSummary(action.text)`;
 *  - `description`, in the content language, e.g. (shown before escaping)
 *    `Action from the retrospective Sprint 12 (2026-10-06) — Re: "Deploys are
 *    slow". Requested in RetroGemini as Ann.` The ` — {context}` part is left
 *    out when there is no context, and the last sentence is
 *    `Created from RetroGemini.` when no name was given. A health check says
 *    `Action from the health check …`, a backlog action
 *    `Action from the team backlog`. `{date}` is the session's `date` as
 *    stored. Every interpolated value is escaped by `wikiText`.
 *  - `language`: the content language, chosen by `issueContentLanguage` with
 *    `language` (the clicker's) as its fallback.
 *
 * @param {{
 *   action?: object,
 *   session?: object | null,
 *   kind?: 'retro' | 'healthcheck' | 'backlog',
 *   team?: object | null,
 *   requestedBy?: unknown,
 *   language?: unknown
 * }} input
 * @returns {{ summary: string, description: string, language: 'en' | 'fr' }}
 */
export const issueFields = ({ action, session, kind, team, requestedBy, language }) => {
  const contentLanguage = issueContentLanguage({ session, sessionKind: kind, team, fallbackLanguage: language });
  const strings = DESCRIPTION_STRINGS[contentLanguage];

  const context = wikiText(actionContextText({ action, team, language: contentLanguage }));
  const person = wikiText(requesterName(requestedBy));

  const origin = describeOrigin(strings, kind, session);
  const description = `${origin}${context ? ` — ${context}` : ''}. `
    + (person ? strings.requestedBy(person) : strings.createdFrom);

  return {
    summary: issueSummary(isObject(action) ? action.text : ''),
    description,
    language: contentLanguage
  };
};

/**
 * Which parent issue an action goes under in `sessionParent` mode: the session
 * `issueSource` names as the action's home, or the team's dashboard (the
 * `backlog` scope) when no session holds it. Built from the very `issueSource`
 * result the action's own issue is written from, so the parent and the
 * sub-task's description never disagree about where the action comes from:
 * an earlier action sent from a later retro's Review step is homed in the
 * earlier retro, and goes under that retro's parent.
 *
 * `key` is the scope a team record keys its parents by (`isJiraParentScope`
 * in `utils/jira.js`): `retro:<id>`, `healthcheck:<id>` or `backlog`. A
 * session with no usable id cannot be told apart from another, so it reads as
 * the backlog.
 *
 * @param {{ session?: object | null, kind?: string } | null | undefined} source
 * @returns {{ key: string, kind: 'retro' | 'healthcheck' | 'backlog', session: object | null }}
 */
export const jiraParentScope = (source) => {
  const session = isObject(source) && isObject(source.session) ? source.session : null;
  const id = session?.id;
  if ((source?.kind === 'retro' || source?.kind === 'healthcheck') && typeof id === 'string' && id !== '') {
    return { key: `${source.kind}:${id}`, kind: source.kind, session };
  }
  return { key: 'backlog', kind: 'backlog', session: null };
};

// The parent issue's template words, in both languages. Only the values put
// between them are escaped (`wikiText`) in the description; the summary is
// plain text, as Jira shows it.
const PARENT_STRINGS = {
  en: {
    title: { retro: 'Retrospective actions', healthcheck: 'Health check actions', backlog: 'Team actions' },
    separator: ': ',
    origin: {
      retro: 'Actions of the retrospective',
      healthcheck: 'Actions of the health check',
      backlog: (team) => ['Actions of the team', team, 'added on its RetroGemini dashboard'].filter(Boolean).join(' ')
    },
    asSubtasks: 'created in Jira as sub-tasks of this issue',
    requestedBy: (person) => `Requested in RetroGemini by ${person}.`,
    createdFrom: 'Created from RetroGemini.'
  },
  fr: {
    title: { retro: 'Actions de la rétrospective', healthcheck: 'Actions du bilan de santé', backlog: 'Actions de l’équipe' },
    // French typography: a no-break space before the colon.
    separator: '\u00a0: ',
    origin: {
      retro: 'Actions de la rétrospective',
      healthcheck: 'Actions du bilan de santé',
      backlog: (team) => ['Actions de l’équipe', team, 'ajoutées sur son tableau de bord RetroGemini'].filter(Boolean).join(' ')
    },
    asSubtasks: 'créées dans Jira en sous-tâches de ce ticket',
    // « le ticket », masculine.
    requestedBy: (person) => `Demandé dans RetroGemini par ${person}.`,
    createdFrom: 'Créé depuis RetroGemini.'
  }
};

// How much of a session's date a parent's title keeps: a date as stored is a
// few characters, and the title must keep room for the name.
const PARENT_DATE_MAX_LENGTH = 40;

const oneLineText = (value) => (typeof value === 'string' ? oneLine(value) : '');

/**
 * The fields of the parent issue created for one scope in `sessionParent`
 * mode, by the server, and previewed by the confirmation dialog with this same
 * function:
 *
 *  - `summary`, plain text on one line, at most 255 code units:
 *    `Retrospective actions: Sprint 12 (21.10.2026)`, `Health check actions:
 *    Q3 (21.10.2026)`, `Team actions: Platform` — in French `Actions de la
 *    rétrospective : …`, `Actions du bilan de santé : …`, `Actions de l’équipe
 *    : …`, with a no-break space before the colon. A blank name drops
 *    `: {name}`, a blank date the parentheses, and so does a name that
 *    already carries the date as stored (a health check's default name is
 *    "Health Check {date}"). The date is cut to 40 code units first, then the
 *    name is cut, so the title, the separator and the date always survive;
 *    the cut never halves a surrogate pair.
 *  - `description`, wiki markup, in the content language, e.g. `Actions of
 *    the retrospective Sprint 12 (21.10.2026), created in Jira as sub-tasks of
 *    this issue. Requested in RetroGemini by Ann.` Every interpolated value
 *    (name, date, team name, requester) goes through `wikiText`; the last
 *    sentence is `Created from RetroGemini.` without a requester. No URL back
 *    to RetroGemini: nothing here knows the deployment's address, and the
 *    preview must match what is sent.
 *  - `language`: `issueContentLanguage` with the scope's session and kind, the
 *    rule its sub-tasks follow, so a parent and its sub-tasks share a language.
 *
 * `{date}` is the session's `date` as stored, the value the sub-tasks'
 * descriptions show. Fixed at creation: a later rename does not reach Jira.
 *
 * @param {{
 *   scope?: { kind?: string, session?: object | null } | null,
 *   team?: object | null,
 *   requestedBy?: unknown,
 *   language?: unknown
 * }} input
 * @returns {{ summary: string, description: string, language: 'en' | 'fr' }}
 */
export const parentIssueFields = ({ scope, team, requestedBy, language } = {}) => {
  const kind = scope?.kind === 'retro' || scope?.kind === 'healthcheck' ? scope.kind : 'backlog';
  const session = kind === 'backlog' || !isObject(scope?.session) ? null : scope.session;
  const contentLanguage = issueContentLanguage({ session, sessionKind: kind, team, fallbackLanguage: language });
  const strings = PARENT_STRINGS[contentLanguage];

  const name = oneLineText(session ? session.name : isObject(team) ? team.name : '');
  const storedDate = session ? oneLineText(session.date) : '';
  // A name that already says the date (a health check's default name) is not
  // followed by it again.
  const date = storedDate && !name.includes(storedDate) ? storedDate : '';

  const title = strings.title[kind];
  const shownDate = cutCodeUnits(date, PARENT_DATE_MAX_LENGTH).trim();
  const dateSuffix = shownDate ? ` (${shownDate})` : '';
  const room = SUMMARY_MAX_LENGTH - title.length - strings.separator.length - dateSuffix.length;
  const shownName = cutCodeUnits(name, Math.max(room, 0)).trim();
  const summary = `${title}${shownName ? `${strings.separator}${shownName}` : ''}${dateSuffix}`.trim();

  const escapedName = wikiText(name);
  const escapedDate = wikiText(date);
  const origin = kind === 'backlog'
    ? strings.origin.backlog(escapedName)
    : [strings.origin[kind], escapedName, escapedDate ? `(${escapedDate})` : ''].filter(Boolean).join(' ');
  const person = wikiText(requesterName(requestedBy));
  const description = `${origin}, ${strings.asSubtasks}. ${person ? strings.requestedBy(person) : strings.createdFrom}`;

  return { summary, description, language: contentLanguage };
};
