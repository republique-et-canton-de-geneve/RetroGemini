
import { Team, TeamSummary, User, RetroSession, ActionItem, ActionImpactVote, Column, Template, HealthCheckSession, HealthCheckTemplate, TeamFeedback, FeedbackComment } from '../types';
import { randomId } from '../utils/randomId';
import {
  DEFAULT_TIMER_SECONDS,
  createTimerSettings,
  getHealthCheckPhaseDefaultTimerSeconds
} from '../utils/sessionTimer';
import {
  isValidRaterId,
  mergeActionImpactState,
  reconcileStoredActions,
  withRaterVote
} from '../utils/actionImpact.js';
import {
  PASSWORD_POLICY_MESSAGE,
  PASSWORD_TOO_SHORT_ERROR,
  isPasswordLongEnough
} from '../utils/passwordPolicy.js';
import {
  INVALID_EMAIL_ERROR,
  INVALID_EMAIL_MESSAGE,
  RECOVERY_EMAIL_REQUIRED_ERROR,
  RECOVERY_EMAIL_REQUIRED_MESSAGE,
  cleanEmail,
  parseEmailInput
} from '../utils/emailAddress.js';
import { getActiveLanguage, Language, toLanguage } from '../i18n/languages';
import { getRetroTemplatePresets } from '../i18n/content/retroTemplates';
import { getDefaultIcebreaker, localizeIcebreaker } from '../i18n/content/icebreakers';

// ==================== SECURE API CLIENT ====================
// Uses team-scoped endpoints that require authentication

// The saved-session blob App.tsx persists under this key carries the session
// token (never the team password — stage 7e removed the plaintext copy;
// invite links are minted from a server-derived invite credential instead).
export const OPEN_SESSION_STORAGE_KEY = 'retro-open-session';

// Authenticated team credentials held in memory for the current page life
let authenticatedTeamId: string | null = null;
let authenticatedTeamPassword: string | null = null;
let authenticatedTeam: Team | null = null;
let authenticatedSessionToken: string | null = null;

// Invite credential cache (stage 7e). The credential is team-scoped, signed
// server-side and bound to the team's invite epoch; the short TTL bounds how
// long a link minted after another session rotated the password can embed the
// revoked credential.
let inviteCredentialCache: { teamId: string; credential: string; fetchedAt: number } | null = null;
// Thrown by `deleteTeam` and translated where it is shown (i18n/errorMessages.ts).
export const TEAM_DELETE_FAILED = 'The team could not be deleted. Please try again.';
// Thrown by `updateFacilitatorEmail` when the server did not store the address.
export const RECOVERY_EMAIL_NOT_SAVED = 'The recovery email could not be saved. Please try again.';

const INVITE_CREDENTIAL_TTL_MS = 60_000;
// The login picker gives up on the team list after this long and offers a
// retry, rather than spinning on a request that will never answer.
const LIST_TEAMS_TIMEOUT_MS = 15_000;

// Track pending persist operations
let persistQueue: Promise<void> = Promise.resolve();

export class InviteAutoJoinError extends Error {
  code: 'INVITE_NOT_VERIFIED';

  constructor(message: string) {
    super(message);
    this.name = 'InviteAutoJoinError';
    this.code = 'INVITE_NOT_VERIFIED';
  }
}

const getHex = (twClass: string) => {
    if(twClass.includes('emerald')) return '#10B981';
    if(twClass.includes('rose')) return '#F43F5E';
    if(twClass.includes('sky')) return '#0EA5E9';
    if(twClass.includes('amber')) return '#F59E0B';
    if(twClass.includes('purple')) return '#A855F7';
    if(twClass.includes('indigo')) return '#6366F1';
    if(twClass.includes('orange')) return '#F97316';
    if(twClass.includes('slate')) return '#64748B';
    return '#CBD5E1';
};

const USER_COLORS = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-pink-500'];

// Member and invite emails are identities: two spellings of one address must
// find the same person. `cleanEmail` is the server's rule (utils/emailAddress.js)
// — for a valid address it does what the trim-and-lowercase it replaces did,
// and it also matches a legacy value stored with a pasted `;` or `Name <…>`.
const normalizeEmail = (email?: string | null) => cleanEmail(email);

/**
 * The roster entry an address names. Through `cleanEmail`, two records the
 * server deliberately kept apart (`a@x.ch;` beside `a@x.ch` — the heal and
 * `/members` never clean one member into another's address) read as one
 * identity, so the record whose stored spelling is exactly the one given wins,
 * and each of the two still finds itself.
 */
const indexOfMemberByEmail = (list: { email?: string }[], email?: string | null): number => {
  const cleaned = normalizeEmail(email);
  if (!cleaned) return -1;
  const raw = (email ?? '').trim().toLowerCase();
  const exact = list.findIndex((member) => (member.email ?? '').trim().toLowerCase() === raw);
  return exact !== -1 ? exact : list.findIndex((member) => normalizeEmail(member.email) === cleaned);
};
const findMemberByEmail = <T extends { email?: string }>(list: T[], email?: string | null): T | undefined => {
  const index = indexOfMemberByEmail(list, email);
  return index === -1 ? undefined : list[index];
};

// The built-in retrospective templates in English — the language a session
// placeholder and any caller that does not choose one get. The catalogue, with
// both languages, lives in i18n/content/retroTemplates.ts.
const PRESETS: Record<string, Column[]> = getRetroTemplatePresets('en');

// ==================== HEALTH CHECK TEMPLATES ====================

const HEALTH_CHECK_TEMPLATES: HealthCheckTemplate[] = [
    {
        id: 'team_health_en',
        name: 'Team Health Check',
        isDefault: true,
        dimensions: [
            {
                id: 'autonomy',
                name: 'Autonomy',
                goodDescription: "I have the freedom, flexibility and ability to do my work. There's space to be creative with solutions",
                badDescription: "There are too many processes, rules, external dependencies and obstacles to work autonomously. The path is already laid out."
            },
            {
                id: 'purpose',
                name: 'Purpose',
                goodDescription: "My work is meaningful and the goals are clear.",
                badDescription: "I'm busy without really knowing where we're going and why. I don't clearly see what's expected of me."
            },
            {
                id: 'challenge',
                name: 'Challenge',
                goodDescription: "The work is neither too easy nor too difficult and the required effort is balanced. The workload is adequate.",
                badDescription: "Mismatch between my skills and my work (too easy/difficult). I'm overloaded."
            },
            {
                id: 'fulfillment',
                name: 'Fulfillment',
                goodDescription: "I give and receive in return. My work contributes to my personal development and career",
                badDescription: "I don't get as much from my work as I would like"
            },
            {
                id: 'teamwork',
                name: 'Teamwork',
                goodDescription: "I share the same objectives with my colleagues. We organize ourselves to achieve them and depend on each other.",
                badDescription: "We are a group of individuals with different objectives. I'm not concerned or don't always know what the others' objectives are."
            },
            {
                id: 'org_connection',
                name: 'Connection with Organization',
                goodDescription: "There's synergy between the team and the organization. Collective intelligence is valued and sought. Communication is easy and two-way, the team can influence the organization.",
                badDescription: "One-way communication, Manager -> Executor relationship. Collective intelligence is not sought. Raised concerns are not addressed."
            },
            {
                id: 'learning',
                name: 'Learning & Initiatives',
                goodDescription: "I have space to learn and lead initiatives. If I make a mistake, it will never be held against me. I can always contribute without risk of it backfiring.",
                badDescription: "Mistakes are seen as failure rather than learning. The environment doesn't encourage taking initiative. It's safer to stay silent than try to contribute."
            },
            {
                id: 'transparency',
                name: 'Transparency',
                goodDescription: "Transparency is valued, sought and present. Its absence is immediately pointed out",
                badDescription: "Appearances are often more important. Transparency is not present. People prefer not to address the lack of transparency."
            },
            {
                id: 'team_communication',
                name: 'Team Communication',
                goodDescription: "The team can calmly address difficult topics. Debate is healthy and the goal is always to reach the best option/resolution",
                badDescription: "Difficult topics create lasting tensions. Conflicts sometimes shift to people rather than ideas."
            },
            {
                id: 'mutual_accountability',
                name: 'Mutual Accountability',
                goodDescription: "Feedback is given and received fluidly. Team members hold each other accountable, shortcomings (agreed practices, team contract) are addressed.",
                badDescription: "Feedback is often a source of conflict. Team members prefer to avoid mentioning shortcomings and don't hold each other accountable."
            },
            {
                id: 'team_energy',
                name: 'Team Energy (Summary)',
                goodDescription: "Exchanges are healthy and constructive, engagement is collective, pace is sustainable, it's fun, we're happy in this team",
                badDescription: "Fatigue, disengagement, unsustainable pace, tensions, things could be better in the team"
            }
        ]
    },
    {
        id: 'team_health_fr',
        name: 'Bilan de santé (FR)',
        isDefault: true,
        dimensions: [
            {
                id: 'autonomie',
                name: 'Autonomie',
                goodDescription: "J'ai la liberté, la flexibilité et la capacité de faire le travail. Il y a de l'espace pour être créatif sur les solutions",
                badDescription: "Il y a trop de processus, des règles, des dépendances externes et des obstacles pour réaliser le travail en autonomie. La route est déjà pré-tracée."
            },
            {
                id: 'objectif',
                name: 'Objectif',
                goodDescription: "Mon travail a du sens et les buts à atteindre sont clairs.",
                badDescription: "Je suis occupé sans forcément savoir vers où on va et pourquoi. Je ne vois pas bien ce qu'on attend de moi."
            },
            {
                id: 'challenge',
                name: 'Challenge',
                goodDescription: "Le travail n'est ni trop facile, ni trop difficile et l'effort nécessaire est équilibré. La charge de travail est adéquate.",
                badDescription: "Inadéquation entre mes compétences et mon travail. (C'est trop facile/difficile). Je suis surchargé."
            },
            {
                id: 'epanouissement',
                name: 'Epanouissement',
                goodDescription: "Je donne et je reçois en retour. Mon activité contribue à mon développement personnel et ma carrière",
                badDescription: "Je ne tire pas de mon activité autant que je souhaiterais"
            },
            {
                id: 'travail_equipe',
                name: "Travail d'équipe",
                goodDescription: "Je partage avec mes collègues les mêmes objectifs. Nous nous organisons pour les atteindre et dépendons les uns des autres.",
                badDescription: "Nous sommes un groupe d'individus avec des objectifs différents. Je ne suis pas concerné ou je ne connais pas toujours quels sont les objectifs des autres."
            },
            {
                id: 'lien_organisation',
                name: "Lien avec l'organisation",
                goodDescription: "Il y a une synergie entre l'équipe et l'organisation dans laquelle elle se situe. L'intelligence collective est valorisée et recherchée. La communication facilitée et bidirectionnelle, l'équipe est capable d'avoir une influence sur l'organisation.",
                badDescription: "Communication unidirectionnelle, Rapport dirigeant -> exécutant. L'intelligence collective n'est pas recherchée. Les préoccupations remontées ne sont pas adressées."
            },
            {
                id: 'apprentissages',
                name: 'Apprentissages et initiatives',
                goodDescription: "J'ai de l'espace pour apprendre et mener des initiatives. Si je fais une erreur, elle ne sera jamais retenue contre moi. Je peux toujours contribuer sans risque que ça se retourne contre moi.",
                badDescription: "Les erreurs sont vues comme un échec plutôt qu'un apprentissage. L'environnement ne pousse pas à la prise d'initiative. Il est plus prudent de garder le silence que d'essayer de contribuer."
            },
            {
                id: 'transparence',
                name: 'Transparence',
                goodDescription: "La transparence est valorisée, recherchée et présente. Son absence est immédiatement pointée",
                badDescription: "Les apparences sont souvent plus importantes. La transparence n'est pas présente. On préfère ne pas aborder l'absence de transparence."
            },
            {
                id: 'communication_equipe',
                name: "Communication dans l'équipe",
                goodDescription: "L'équipe arrive à aborder sereinement les sujet difficiles. Le débat est sain et l'objectif est toujours d'arriver à la meilleure option/résolution",
                badDescription: "Les sujets difficiles créent des tensions qui demeurent. Les conflits se déportent parfois sur les personnes et non plus les idées."
            },
            {
                id: 'responsabilite_mutuelle',
                name: 'Se tenir mutuellement responsables',
                goodDescription: "Les feedbacks sont donnés et reçus de manière fluide. Les membres de l'équipe se tiennent responsables, les manquements (pratiques décidées, contrat d'équipe) sont adressés.",
                badDescription: "Les feedbacks sont souvent source de conflit. Les membres de l'équipes préfèrent éviter d'évoquer les manquement et ne se tiennent pas mutuellement responsables."
            },
            {
                id: 'energie_equipe',
                name: "Energie de l'équipe (synthèse)",
                goodDescription: "Les échanges sont sains et constructifs, l'engagement est collectif, le rythme est soutenable c'est fun, on est bien dans cette équipe",
                badDescription: "Fatigue, désengagement, rythme insoutenable, tensions, ça pourrait aller mieux dans l'équipe"
            }
        ]
    }
];

/**
 * Get the currently authenticated team
 */
const getAuthenticatedTeam = (): Team | null => authenticatedTeam;

/**
 * The signed team session token held by the current login, or `null`.
 *
 * Exported so `syncService` can present it on `join-session`: the socket
 * channel authenticates with the same credential as the REST routes (audit
 * H1). Read at emit time rather than captured, so a re-login and every
 * automatic re-join after a reconnect carry the *current* token.
 */
export const getTeamSessionToken = (): string | null => authenticatedSessionToken;

/**
 * Set authentication credentials for the current session
 */
const setAuthCredentials = (teamId: string, password: string, team: Team, sessionToken?: string) => {
  authenticatedTeamId = teamId;
  // Normalized so a token-only session (restore without any password copy)
  // stores null and request bodies keep their pre-7c shape.
  authenticatedTeamPassword = password || null;
  authenticatedTeam = team;
  if (sessionToken) {
    authenticatedSessionToken = sessionToken;
  }
};

/**
 * Clear authentication credentials (logout)
 */
const clearAuthCredentials = () => {
  authenticatedTeamId = null;
  authenticatedTeamPassword = null;
  authenticatedTeam = null;
  authenticatedSessionToken = null;
  inviteCredentialCache = null;
};

/**
 * True when the client holds a credential the server accepts on team and
 * feedback routes: the plaintext password or the HMAC session token.
 * Stage 7b — either credential authenticates; the server checks the password
 * first and a valid token rescues a stale password, so sending both is safe.
 */
const hasTeamCredentials = (): boolean =>
  Boolean(authenticatedTeamPassword || authenticatedSessionToken);

/**
 * Make an authenticated API call to the server
 */
const apiCall = async <T>(
  endpoint: string,
  body: Record<string, unknown> = {}
): Promise<{ data: T | null; error: string | null }> => {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: authenticatedTeamPassword,
        // JSON.stringify drops the key when no token is held, so invite-only
        // sessions (password, no token) keep their exact previous payload.
        sessionToken: authenticatedSessionToken ?? undefined,
        ...body
      })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'unknown_error' }));
      return { data: null, error: errorData.error || 'request_failed' };
    }

    const data = await res.json();
    return { data, error: null };
  } catch (err) {
    console.warn('[dataService] API call failed', err);
    return { data: null, error: 'network_error' };
  }
};

/**
 * Persist a retrospective to the server (granular update)
 */
const persistRetrospective = async (teamId: string, retro: RetroSession): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const { error } = await apiCall(`/api/team/${teamId}/retrospective/${retro.id}`, {
    retrospective: retro
  });

  if (error) {
    console.warn('[dataService] Failed to persist retrospective', error);
  }
};

/**
 * Persist a health check to the server (granular update)
 */
const persistHealthCheck = async (teamId: string, healthCheck: HealthCheckSession): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const { error } = await apiCall(`/api/team/${teamId}/healthcheck/${healthCheck.id}`, {
    healthCheck
  });

  if (error) {
    console.warn('[dataService] Failed to persist health check', error);
  }
};

/**
 * Rename a retrospective or health check (granular update).
 *
 * Audit H35. A rename used to ride on the full-blob persist, which carries the
 * caller's cached `_rev`; once a live session has advanced the stored revision
 * — the normal state of any retro that was actually run — the server's rev
 * guard drops that write wholesale, and the title reverted with nothing
 * reporting a problem. This endpoint carries no revision and touches one field,
 * so there is nothing to reject.
 */
const persistSessionName = async (
  kind: 'retrospective' | 'healthcheck',
  teamId: string,
  sessionId: string,
  name: string
): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const { error } = await apiCall(`/api/team/${teamId}/${kind}/${sessionId}/name`, { name });

  if (error) {
    console.warn('[dataService] Failed to rename session', error);
  }
};

// Roughly 7s of retrying across a rolling update's routing window (0.5 + 1 +
// 2 + 4 seconds), which is long enough for the old pods to drain and short
// enough that a genuinely unreachable server still reports.
const ROLLOUT_RETRIES = 4;

/**
 * POST to a route a rolling update may not serve everywhere yet, retrying
 * across the rollout window.
 *
 * During a rolling update a browser on the new bundle can be routed to a pod
 * still running the previous release. That pod answers a route it does not
 * know with Express's own HTML 404, which `apiCall` reads as `unknown_error` —
 * indistinguishable from any other failure, and a write the local cache
 * already shows as done is lost if it is logged and dropped. So anything but
 * the route's own answers is retried. `isFinal` names those answers: error
 * codes only a pod that serves the route can give, which no retry will change.
 *
 * Resolves to the last error, or `null` once the write landed. Losing the team
 * credentials mid-window (a logout) ends it quietly with `null`: nothing can
 * be written for that team any more, and there is nobody left to tell.
 */
const postAcrossRollout = async (
  endpoint: string,
  body: Record<string, unknown>,
  isFinal: (error: string) => boolean,
  attempt = 0
): Promise<string | null> => {
  if (!hasTeamCredentials()) return null;

  const { error } = await apiCall(endpoint, body);

  if (!error || isFinal(error) || attempt >= ROLLOUT_RETRIES) return error;

  await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
  return postAcrossRollout(endpoint, body, isFinal, attempt + 1);
};

/**
 * Delete one retrospective, health check, action or template through its
 * granular route.
 *
 * Incident ISS (2026-10-12). Deletions used to persist the caller's whole
 * cached list through `/api/team/:teamId/update`, which replaced the stored
 * list with no revision check: a facilitator's second tab, left on a Dashboard
 * loaded before a retro started, deleted an old retro and erased the live one
 * from the team record. These routes name the one thing to remove, so a stale
 * cache can only ever remove what it names.
 *
 * `notFound` is the route's 404 code: the thing is already gone — deleted from
 * another tab, or never persisted — which is the outcome the caller wanted.
 *
 * These routes are as new as the incident, so they ride the rolling-update
 * retry (`postAcrossRollout`): the local cache shows the entry gone the moment
 * the user clicks, and a delete dropped on a pod that does not serve the route
 * yet brought it back on the next load. The route's own answers — `notFound`,
 * and its validation codes in `refusals` — come from a pod that does serve it
 * and are final. Retrying is safe because a delete is idempotent: a retry of
 * one that landed with its answer lost reads as `notFound`, "already gone".
 */
const persistDeletion = async (
  endpoint: string,
  body: Record<string, unknown>,
  notFound: string,
  refusals: readonly string[] = []
): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const error = await postAcrossRollout(
    endpoint,
    body,
    (code) => code === notFound || refusals.includes(code)
  );

  if (!error) return;
  if (error === notFound) {
    console.info('[dataService] Already deleted on the server', endpoint);
    return;
  }
  console.warn(`[dataService] Failed to delete (${endpoint})`, error);
};

/**
 * Save one retro or health-check template through its granular route.
 *
 * Incident ISS, the same class as the deletions above: a save used to persist
 * the caller's whole cached template list through `/update`, so a tab loaded
 * before another tab saved a template erased that template just by saving its
 * own. These routes add (or, for a health-check template, upsert by id) the one
 * template named.
 *
 * Same rolling-update retry as `persistDeletion`; `invalid_template` is the
 * route's own answer and final. A health-check save is an upsert, so a retry is
 * harmless. A retro template has no id, so a retry of a save that landed with
 * its answer lost (a dropped connection) appends it twice — a visible duplicate
 * the facilitator can delete, where giving up would lose the template unseen.
 */
const persistTemplateSave = async (endpoint: string, body: Record<string, unknown>): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const error = await postAcrossRollout(endpoint, body, (code) => code === 'invalid_template');

  if (error) {
    console.warn(`[dataService] Failed to save template (${endpoint})`, error);
  }
};

/**
 * Persist an action to the server (granular update)
 */
const persistAction = async (teamId: string, action: ActionItem, retroId?: string, healthCheckId?: string): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const { error } = await apiCall(`/api/team/${teamId}/action`, {
    action,
    retroId,
    healthCheckId
  });

  if (error) {
    console.warn('[dataService] Failed to persist action', error);
  }
};

/**
 * One write to the route that owns `impactRatings`: either one person's vote,
 * or the reset a later retrospective performs when it puts a postponed action
 * back to the team.
 *
 * Both go through the same retry below rather than one of them getting its own:
 * a reset lost to a rolling update leaves the old votes pre-filled, which is
 * the exact failure the reset exists to prevent.
 */
type ActionImpactWrite =
  | { actionId: string; userId: string; vote: ActionImpactVote | null }
  | { actionId: string; reset: true };

/**
 * Persist one participant's impact vote through the narrow route.
 *
 * Deliberately not `persistAction`: that sends the whole action, and the
 * ratings on it have one writer per participant, so two people voting at once
 * would race and the loser's vote would disappear. This request names a single
 * key and the server writes only that key.
 */
const persistActionImpact = async (
  teamId: string,
  payload: ActionImpactWrite
): Promise<void> => {
  if (!hasTeamCredentials()) return;

  // This route is new, so during a rolling update a browser on the new bundle
  // can be routed to a pod that does not serve it yet and get a 404 for the
  // route rather than for the action. The session mirror would still show the
  // vote as recorded while the authoritative team record never received it, and
  // the dashboard would lose it for good — so retry across the rollout window
  // instead of logging and moving on. `action_not_found` and
  // `action_not_rateable` are real answers from a pod that does serve the route
  // and are not retried.
  const error = await postAcrossRollout(
    `/api/team/${teamId}/action/impact`,
    payload,
    (code) => code === 'action_not_found'
      || code === 'action_not_rateable'
      || code === 'invalid_vote'
      || code === 'invalid_user'
  );

  if (error) {
    console.warn('[dataService] Failed to persist action impact vote', error);
  }
};

/**
 * Return a copy of `incoming` in which a full retro-session persist cannot
 * re-open an action the team record has already closed.
 *
 * Closing an action always goes through the granular action endpoints
 * (`toggleGlobalAction`), which update the team record first, so a later
 * full-session blob that still carries `done: false` for that action — a stale
 * blob from an open Session whose React state predates the close, or a lagging
 * client re-persisting a retro while browsing — would otherwise silently revert
 * it back to open. Only that one transition (`done: true → false`) is guarded:
 *
 *  - a *legitimate* re-open also goes through the granular endpoint, which sets
 *    the stored record to `done: false` first, so the guard sees them agree and
 *    lets it through;
 *  - `assigneeId` / `text` and proposal state are left entirely to the incoming
 *    blob, because several session-only flows (accepting or editing a proposal
 *    in Discuss, assigning a ROTI follow-up in Close) legitimately set them
 *    without touching a granular endpoint.
 *
 * The impact fields ride the same guard on the same reasoning. `impactRatings`
 * is written per participant through `/action/impact` and `closedAt` /
 * `impactDeferredBy` through `/action`; none of them advance the retro `_rev`,
 * so a blob built before any of it would clear them while passing every other
 * check. They are additive — a session blob never legitimately removes a vote,
 * a closing date or a deferral — so an omission loses to the stored value.
 * Mirrors the server guard in `server/routes/teamRoutes.js`.
 */
const reconcileRetroActionState = (stored: RetroSession, incoming: RetroSession): RetroSession => {
  if (!stored?.actions?.length || !incoming.actions?.length) return incoming;
  const { actions, changed } = reconcileStoredActions(stored.actions, incoming.actions);
  return changed ? { ...incoming, actions: actions as ActionItem[] } : incoming;
};

/**
 * Fold a session's live impact votes back into the actions of the local team
 * record.
 *
 * Each participant's vote reaches the server through the narrow route from
 * *their own* browser, so no other client's local team cache ever sees it — and
 * the dashboard rollup reads that cache. Without this, the one person who most
 * wants the number would be the one who cannot see it: the facilitator does not
 * vote, so their cached actions would carry no ratings at all and the retro line
 * would stay blank however the team answered.
 *
 * The session mirror is exactly the live truth this client has been watching, so
 * it replaces (rather than merges into) the ratings of the actions it covers —
 * that is what makes a cleared vote disappear here too. Actions the round does
 * not mention are untouched.
 */
const absorbSessionImpactVotes = (team: Team, session: RetroSession): void => {
  const votes = session.actionImpactVotes;
  if (!votes || Object.keys(votes).length === 0) return;

  const buckets: ActionItem[][] = [
    team.globalActions,
    ...team.retrospectives.map(r => r.actions ?? []),
    ...(team.healthChecks ?? []).map(h => h.actions ?? [])
  ];

  for (const [actionId, ratings] of Object.entries(votes)) {
    for (const bucket of buckets) {
      const action = bucket?.find(a => a.id === actionId);
      if (!action) continue;
      if (Object.keys(ratings).length > 0) action.impactRatings = { ...ratings };
      else delete action.impactRatings;
      break;
    }
  }
};

/**
 * The same guard for a health check persist.
 *
 * Health-check actions are closed and rated exactly like retro ones, and this
 * path had no guard at all, so a stale blob silently erased their done state,
 * closing date, ratings and deferral.
 */
const reconcileHealthCheckActionState = (
  stored: HealthCheckSession,
  incoming: HealthCheckSession
): HealthCheckSession => {
  if (!stored?.actions?.length || !incoming.actions?.length) return incoming;
  const { actions, changed } = reconcileStoredActions(stored.actions, incoming.actions);
  return changed ? { ...incoming, actions: actions as ActionItem[] } : incoming;
};

/**
 * Persist team members to the server
 */
const persistMembers = async (teamId: string, members: User[], archivedMembers?: User[]): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const { error } = await apiCall(`/api/team/${teamId}/members`, {
    members,
    archivedMembers
  });

  if (error) {
    console.warn('[dataService] Failed to persist members', error);
  }
};

/**
 * A partial team update as it goes over the wire. `facilitatorEmail: null` is
 * a clear: `undefined` would vanish in JSON.stringify, and the server would
 * keep the old address.
 */
type TeamUpdatePayload = Partial<Omit<Team, 'facilitatorEmail'>> & { facilitatorEmail?: string | null };

/**
 * Persist team update to the server (partial update)
 */
const persistTeamUpdate = async (teamId: string, updates: TeamUpdatePayload): Promise<void> => {
  if (!hasTeamCredentials()) return;

  const { data, error } = await apiCall<{ team: Team }>(`/api/team/${teamId}/update`, {
    updates
  });

  if (error) {
    console.warn('[dataService] Failed to persist team update', error);
  } else if (data?.team) {
    authenticatedTeam = data.team;
  }
};

/**
 * Fetch the team's current invite credential from the server (stage 7e).
 * Any authenticated session — password or session token — can derive it, so
 * restored sessions mint working invite links without the client ever
 * persisting the plaintext team password.
 */
const fetchInviteCredential = async (teamId: string): Promise<string> => {
  const now = Date.now();
  if (
    inviteCredentialCache &&
    inviteCredentialCache.teamId === teamId &&
    now - inviteCredentialCache.fetchedAt < INVITE_CREDENTIAL_TTL_MS
  ) {
    return inviteCredentialCache.credential;
  }

  const { data, error } = await apiCall<{ inviteCredential: string }>(
    `/api/team/${teamId}/invite-credential`,
    {}
  );

  if (error || !data?.inviteCredential) {
    throw new Error('Unable to generate an invite link');
  }

  inviteCredentialCache = { teamId, credential: data.inviteCredential, fetchedAt: now };
  return data.inviteCredential;
};

// Queue for serializing persist operations
const queuePersist = (operation: () => Promise<void>) => {
  persistQueue = persistQueue
    .then(operation)
    .catch((err) => {
      console.warn('[dataService] Persist queue error', err);
    });
};

// The same queue, for a write whose caller must know how it ended: it still
// cannot overtake an earlier write, and its failure reaches the caller.
const runPersist = <T>(operation: () => Promise<T>): Promise<T> => {
  const run = persistQueue.then(operation);
  persistQueue = run.then(() => undefined, (err) => {
    console.warn('[dataService] Persist queue error', err);
  });
  return run;
};

const ensureSessionPlaceholder = (teamId: string, sessionId: string): RetroSession | undefined => {
  const team = getAuthenticatedTeam();
  if (!team || team.id !== teamId) return;

  const existing = team.retrospectives.find(r => r.id === sessionId);
  if (existing) return existing;

  const placeholder: RetroSession = {
    id: sessionId,
    teamId,
    name: 'Retrospective',
    date: new Date().toLocaleDateString(),
    status: 'IN_PROGRESS',
    phase: 'ICEBREAKER',
    participants: [],
    discussionFocusId: null,
    icebreakerQuestion: getDefaultIcebreaker('en'),
    columns: PRESETS['start_stop_continue'],
    settings: {
      isAnonymous: false,
      maxVotes: 5,
      oneVotePerTicket: false,
      revealBrainstorm: false,
      revealHappiness: false,
      revealRoti: false,
      ...createTimerSettings(DEFAULT_TIMER_SECONDS),
    },
    tickets: [],
    groups: [],
    actions: [],
    openActionsSnapshot: [],
    historyActionsSnapshot: [],
    happiness: {},
    roti: {},
    finishedUsers: [],
    autoFinishedUsers: [],
  };

  // Local cache only: the placeholder stands in until the join snapshot — the
  // source of truth — arrives. It used to be persisted too (incident ISS,
  // 2026-10-12), and a blob with no `_rev` skips the server's revision guard:
  // when the client's cache did not hold the retro (a stale team record), the
  // placeholder overwrote the real retro, name and all, in the team record.
  team.retrospectives.unshift(placeholder);

  return placeholder;
};

/**
 * No-op for backwards compatibility - authentication happens in loginTeam
 */
const hydrateFromServer = async (): Promise<void> => {
  // No longer needed - data is fetched per-team during login
  return Promise.resolve();
};

/**
 * Refresh team data from server
 */
const refreshFromServer = async (): Promise<void> => {
  if (!authenticatedTeamId || !hasTeamCredentials()) return;

  const { data, error } = await apiCall<{ team: Team }>(`/api/team/${authenticatedTeamId}`, {});

  if (!error && data?.team) {
    authenticatedTeam = data.team;
  }
};

export const dataService = {
  hydrateFromServer,
  refreshFromServer,
  ensureSessionPlaceholder,

  /**
   * Team summaries for the login picker, or `null` when the list could not be
   * loaded: an error, a refusal (the per-IP read limiter is shared by a whole
   * office behind one address), or no answer within LIST_TEAMS_TIMEOUT_MS.
   * Never `[]` for a failure: an empty list tells the user there is no team
   * and invites them to create one, which is how a team gets a twin.
   */
  listTeams: async (): Promise<TeamSummary[] | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIST_TEAMS_TIMEOUT_MS);
    try {
      const res = await fetch('/api/team/list', { signal: controller.signal });
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.teams)) {
        return null;
      }
      return data.teams.sort((a: TeamSummary, b: TeamSummary) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      );
    } catch (err) {
      console.warn('[dataService] Failed to load team list', err);
      return null;
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Create a new team via the secure API
   */
  createTeam: async (name: string, password: string, facilitatorEmail: string): Promise<Team> => {
    // Same trim-and-reject as `renameTeam`: the create form's `required`
    // attribute accepts a whitespace-only name, and an untrimmed one would
    // become a team indexed under a key nobody can type back. The server trims
    // too — this is here so the user reads a sentence rather than the raw
    // `missing_fields` code the route answers with.
    const trimmedName = (name || '').trim();
    if (!trimmedName) {
      throw new Error('Team name cannot be empty');
    }

    // The route refuses an address that is not one valid address; checking
    // here turns that into a sentence, and sends the cleaned form.
    const recoveryEmail = parseEmailInput(facilitatorEmail);
    if (!recoveryEmail.ok) {
      throw new Error(INVALID_EMAIL_MESSAGE);
    }
    // Mandatory at creation, as on the route: a team with no recovery address
    // cannot get back in after a forgotten password.
    if (!recoveryEmail.email) {
      throw new Error(RECOVERY_EMAIL_REQUIRED_MESSAGE);
    }

    const res = await fetch('/api/team/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmedName, password, facilitatorEmail: recoveryEmail.email })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'unknown_error' }));
      if (errorData.error === 'team_name_exists') {
        throw new Error('Team name already exists');
      }
      if (errorData.error === INVALID_EMAIL_ERROR) {
        throw new Error(INVALID_EMAIL_MESSAGE);
      }
      if (errorData.error === RECOVERY_EMAIL_REQUIRED_ERROR) {
        throw new Error(RECOVERY_EMAIL_REQUIRED_MESSAGE);
      }
      // Audit H39: the forms check the rule first, so reaching this means a
      // stale client or a direct API call. Without the mapping the user reads
      // the raw `password_too_short` code.
      if (errorData.error === PASSWORD_TOO_SHORT_ERROR) {
        throw new Error(PASSWORD_POLICY_MESSAGE);
      }
      throw new Error(errorData.error || 'Failed to create team');
    }

    const { team, sessionToken } = await res.json();
    // Automatically log in to the new team
    setAuthCredentials(team.id, password, team, sessionToken);
    return team;
  },

  /**
   * Get all teams - not available in secure mode (returns only authenticated team)
   */
  getAllTeams: (): Team[] => {
    // In secure mode, we only have access to the authenticated team
    const team = getAuthenticatedTeam();
    return team ? [team] : [];
  },

  /**
   * Login to a team via the secure API
   */
  loginTeam: async (name: string, password: string): Promise<Team> => {
    const res = await fetch('/api/team/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ teamName: name, password })
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: 'unknown_error' }));
      if (errorData.error === 'team_not_found') {
        throw new Error('Team not found');
      }
      if (errorData.error === 'invalid_password') {
        throw new Error('Invalid password');
      }
      throw new Error(errorData.error || 'Login failed');
    }

    const { team, sessionToken } = await res.json();
    if (!team.archivedMembers) team.archivedMembers = [];
    setAuthCredentials(team.id, password, team, sessionToken);
    return team;
  },

  /**
   * Restore a session using a session token (no password needed).
   * Returns the team if successful, null if token is invalid/expired.
   *
   * Stage 7e: restored sessions are token-only — the server never echoes a
   * password and the client no longer persists one. Invite links are minted
   * from a server-derived invite credential, and changing the team password
   * prompts for the current one.
   */
  restoreSession: async (sessionToken: string): Promise<Team | null> => {
    try {
      const res = await fetch('/api/team/restore-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken })
      });

      if (!res.ok) {
        return null;
      }

      const { team } = await res.json();
      if (!team.archivedMembers) team.archivedMembers = [];
      setAuthCredentials(team.id, '', team, sessionToken);
      return team;
    } catch {
      return null;
    }
  },

  /**
   * Get the currently authenticated team
   */
  getTeam: (id: string): Team | undefined => {
    const team = getAuthenticatedTeam();
    if (team && team.id === id) {
      if (!team.archivedMembers) team.archivedMembers = [];
      return team;
    }
    return undefined;
  },

  addMember: (teamId: string, name: string, email?: string): User => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    if (!team.archivedMembers) team.archivedMembers = [];

    // Check if user exists simply by name for this prototype to avoid dups on reload
    const existing = team.members.find(m => m.name === name || (email && normalizeEmail(m.email) === normalizeEmail(email)));
    if(existing) return existing;

    const newUser: User = {
      id: randomId(),
      name,
      color: USER_COLORS[team.members.length % USER_COLORS.length],
      role: 'participant',
      email: normalizeEmail(email) || undefined
    };
    team.members.push(newUser);
    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    return newUser;
  },

  updateMember: (teamId: string, memberId: string, updates: { name: string; email?: string | null }): User => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const member = team.members.find(m => m.id === memberId);
    if (!member) throw new Error('Member not found');

    const nextName = updates.name.trim();
    if (!nextName) throw new Error('Name cannot be empty');

    // The Dashboard sends the address with every edit. Left as it is stored,
    // it is kept as it is stored: a name-only edit must still work on a member
    // whose address predates the shared rule (a single-label `jdoe@corp`) or
    // that the server kept apart from a look-alike.
    let nextEmail = member.email;
    if ((updates.email ?? '') !== (member.email ?? '')) {
      // A member's address is typed by hand on the Dashboard, so it must be one
      // valid address; an empty field removes it.
      const parsedEmail = parseEmailInput(updates.email);
      if (!parsedEmail.ok) throw new Error('Valid email required');
      const normalizedEmail = parsedEmail.email;
      if (normalizedEmail) {
        const emailTaken = team.members
          .some(m => m.id !== memberId && normalizeEmail(m.email) === normalizedEmail);
        if (emailTaken) {
          throw new Error('Another member already uses this email');
        }
      }
      nextEmail = normalizedEmail || undefined;
    }

    member.name = nextName;
    member.email = nextEmail;
    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    return member;
  },

  removeMember: (teamId: string, memberId: string): void => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.archivedMembers) team.archivedMembers = [];

    const idx = team.members.findIndex(m => m.id === memberId);
    if (idx === -1) return;

    const [removed] = team.members.splice(idx, 1);

    team.archivedMembers = team.archivedMembers.filter(m => m.id !== removed.id);
    team.archivedMembers.push(removed);

    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
  },

  createSession: (
    teamId: string,
    name: string,
    templateCols: Column[],
    options?: { isAnonymous?: boolean; templateLanguage?: Language }
  ): RetroSession => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const templateLanguage: Language = toLanguage(options?.templateLanguage, 'en');

    // Default icebreaker or use the one from the previous session if available.
    // A carried-over built-in question follows the new retro's template
    // language; one the facilitator wrote is kept exactly as written.
    let icebreakerQuestion = getDefaultIcebreaker(templateLanguage);
    if (team.retrospectives.length > 0) {
        // retrospectives are shifted (newest at 0), so we take the latest
        icebreakerQuestion = localizeIcebreaker(team.retrospectives[0].icebreakerQuestion, templateLanguage);
    }

    const session: RetroSession = {
      id: randomId(),
      teamId,
      name,
      date: new Date().toLocaleDateString(),
      status: 'IN_PROGRESS',
      phase: 'ICEBREAKER', // Skipped SETUP
      participants: [],
      discussionFocusId: null,
      icebreakerQuestion: icebreakerQuestion,
      columns: templateCols,
      templateLanguage,
      settings: {
        isAnonymous: options?.isAnonymous ?? false,
        maxVotes: 5,
        oneVotePerTicket: false,
        revealBrainstorm: false,
        revealHappiness: false,
        revealRoti: false,
        ...createTimerSettings(DEFAULT_TIMER_SECONDS)
      },
      tickets: [],
      groups: [],
      actions: [],
      openActionsSnapshot: [],
      historyActionsSnapshot: [],
      happiness: {},
      roti: {},
      finishedUsers: [],
      autoFinishedUsers: []
    };
    team.retrospectives.unshift(session);
    queuePersist(() => persistRetrospective(teamId, session));
    return session;
  },

  updateSession: (teamId: string, session: RetroSession) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    const idx = team.retrospectives.findIndex(r => r.id === session.id);
    if (idx !== -1) {
      // Prevent a stale full-session blob (e.g. an open Session whose state
      // predates a Dashboard/other-retro close, or a lagging client
      // re-persisting a retro while browsing) from silently reverting a closed
      // action back to open. See reconcileRetroActionState.
      session = reconcileRetroActionState(team.retrospectives[idx], session);
      team.retrospectives[idx] = session;
      queuePersist(() => persistRetrospective(teamId, session));
    }
    absorbSessionImpactVotes(team, session);
  },

  // Apply a session received from another client to the LOCAL cache only.
  // The originator of the change already persists it to the server, so
  // receivers must NOT re-persist: doing so turned every change into one
  // team-record write per connected participant (an O(n^2) write storm and the
  // source of the repeated "Team update conflict" retries).
  applyRemoteSession: (teamId: string, session: RetroSession) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    const idx = team.retrospectives.findIndex(r => r.id === session.id);
    if (idx !== -1) {
      team.retrospectives[idx] = session;
    }
    absorbSessionImpactVotes(team, session);
  },

  updateSessionName: (teamId: string, sessionId: string, newName: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    const session = team.retrospectives.find(r => r.id === sessionId);
    if (session) {
      session.name = newName;
      // Audit H35: renaming through the granular endpoint, not by persisting
      // the whole retro. The full blob carries this cached copy's `_rev`, which
      // is stale for any retro a session has since advanced — so the server's
      // rev guard dropped the entire write and the title reverted, silently.
      queuePersist(() => persistSessionName('retrospective', teamId, sessionId, newName));
    }
  },

  updateHealthCheckName: (teamId: string, healthCheckId: string, newName: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    if (!team.healthChecks) return;
    const healthCheck = team.healthChecks.find(hc => hc.id === healthCheckId);
    if (healthCheck) {
      healthCheck.name = newName;
      // See updateSessionName above (audit H35).
      queuePersist(() => persistSessionName('healthcheck', teamId, healthCheckId, newName));
    }
  },

  /**
   * Add one custom retrospective template, through its own route (see
   * `persistTemplateSave`).
   *
   * The cache holds the template exactly as the server stores it — name
   * trimmed, the two fields a `Template` has — because the delete below names a
   * template by its content: an untrimmed name kept here would later ask the
   * server to delete a template it does not have. One the route would refuse
   * (blank name, no column) is neither shown nor sent.
   */
  saveTemplate: (teamId: string, template: Template) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const name = typeof template.name === 'string' ? template.name.trim() : '';
    if (!name || !Array.isArray(template.cols) || template.cols.length === 0) return;

    const stored: Template = { name, cols: template.cols };
    if (!team.customTemplates) team.customTemplates = [];
    team.customTemplates.push(stored);
    queuePersist(() => persistTemplateSave(`/api/team/${teamId}/template/save`, { template: stored }));
  },

  /**
   * Delete one custom retrospective template.
   *
   * Names the template on its own route. The Dashboard used to delete a
   * template through `updateTeam` (since removed), and then by sending the
   * template list alone — both whole-list replaces, the class behind incident
   * ISS: a stale tab erased every template saved elsewhere since it loaded.
   *
   * A `Template` carries no id and names are not unique, so the row the user
   * clicked is identified by its position, guarded by its name: resolving it by
   * name alone deleted the first of two templates sharing a name when the
   * second was clicked (Codex, PR #507). When the list changed under the click
   * and the position now holds another template, the first one with that name
   * goes instead. One click never removes more than one template.
   *
   * The server has no position to go by, so the request carries the resolved
   * template's content and the server removes the first stored template equal
   * to it: of two twins, the one clicked (or one indistinguishable from it),
   * and never a template this tab has not seen.
   */
  deleteCustomTemplate: (teamId: string, index: number, name: string): void => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const templates = team.customTemplates ?? [];
    const target = templates[index]?.name === name
      ? index
      : templates.findIndex(t => t.name === name);
    if (target === -1) return;

    const removed = templates[target];
    team.customTemplates = templates.filter((_, i) => i !== target);
    queuePersist(() => persistDeletion(
      `/api/team/${teamId}/template/delete`,
      { template: { name: removed.name, cols: removed.cols } },
      'template_not_found',
      ['invalid_template']
    ));
  },

  addGlobalAction: (teamId: string, text: string, assigneeId: string | null): ActionItem => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const action: ActionItem = {
        id: randomId(),
        text,
        assigneeId, // If null, it remains null (unassigned)
        done: false,
        type: 'new',
        proposalVotes: {},
        createdAt: new Date().toISOString()
    };
    team.globalActions.unshift(action);
    queuePersist(() => persistAction(teamId, action));
    return action;
  },

  updateGlobalAction: (teamId: string, action: ActionItem) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const idx = team.globalActions.findIndex(a => a.id === action.id);
    if(idx !== -1) {
        const merged = mergeActionImpactState(team.globalActions[idx], action) as ActionItem;
        team.globalActions[idx] = merged;
        queuePersist(() => persistAction(teamId, merged));
        return;
    }

    // Fallback: update a retrospective action (previously created action)
    for (const retro of team.retrospectives) {
        const retroIdx = retro.actions.findIndex(a => a.id === action.id);
        if (retroIdx !== -1) {
            const stored = retro.actions[retroIdx];
            const merged = mergeActionImpactState(stored, { ...stored, ...action }) as ActionItem;
            retro.actions[retroIdx] = merged;
            queuePersist(() => persistAction(teamId, merged, retro.id));
            return;
        }
    }

    // Fallback: update a health check action
    for (const hc of (team.healthChecks || [])) {
        const hcIdx = hc.actions.findIndex(a => a.id === action.id);
        if (hcIdx !== -1) {
            const stored = hc.actions[hcIdx];
            const merged = mergeActionImpactState(stored, { ...stored, ...action }) as ActionItem;
            hc.actions[hcIdx] = merged;
            queuePersist(() => persistAction(teamId, merged, undefined, hc.id));
            return;
        }
    }
  },

  toggleGlobalAction: (teamId: string, actionId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    // Closing is the only moment a reliable `closedAt` exists, and this is the
    // path every close goes through (Dashboard, OpenActionsPhase, ReviewPhase).
    // `mergeActionImpactState` owns the stamp so client and server agree on it.
    const flip = (stored: ActionItem): ActionItem =>
      mergeActionImpactState(stored, { ...stored, done: !stored.done }) as ActionItem;

    const idx = team.globalActions.findIndex(a => a.id === actionId);
    if (idx !== -1) {
        const flipped = flip(team.globalActions[idx]);
        team.globalActions[idx] = flipped;
        queuePersist(() => persistAction(teamId, flipped));
        return;
    }

    // Check retro actions
    for(const retro of team.retrospectives) {
        const retroIdx = retro.actions.findIndex(a => a.id === actionId);
        if (retroIdx !== -1) {
            const flipped = flip(retro.actions[retroIdx]);
            retro.actions[retroIdx] = flipped;
            queuePersist(() => persistAction(teamId, flipped, retro.id));
            return;
        }
    }

    // Check health check actions
    for (const hc of (team.healthChecks || [])) {
        const hcIdx = hc.actions.findIndex(a => a.id === actionId);
        if (hcIdx !== -1) {
            const flipped = flip(hc.actions[hcIdx]);
            hc.actions[hcIdx] = flipped;
            queuePersist(() => persistAction(teamId, flipped, undefined, hc.id));
            return;
        }
    }
  },

  /**
   * Turn the impact rating on or off for the whole team.
   *
   * Team-scoped rather than per-user because it changes what the *round* asks,
   * not how one person sees it. Absent means on, so no stored record needed
   * touching when the feature shipped.
   */
  setActionImpactRatingEnabled: (teamId: string, enabled: boolean) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    team.actionImpactRatingEnabled = enabled;
    queuePersist(() => persistTeamUpdate(teamId, { actionImpactRatingEnabled: enabled }));
  },

  /**
   * Remember that the facilitator has seen the one-time explanation.
   *
   * On the team record rather than in `localStorage`: the setting it points at
   * is team-scoped and only the facilitator can change it, so the notice has to
   * appear once per team, not once per browser. `localStorage` would re-show it
   * on every new device and after clearing site data.
   */
  dismissActionImpactNotice: (teamId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    if (team.actionImpactNoticeDismissedAt) return;
    const dismissedAt = new Date().toISOString();
    team.actionImpactNoticeDismissedAt = dismissedAt;
    queuePersist(() => persistTeamUpdate(teamId, { actionImpactNoticeDismissedAt: dismissedAt }));
  },

  /**
   * Record (or clear, with `vote: null`) the current user's impact vote on a
   * closed action.
   *
   * Updates the local team record so the dashboard rollup reflects the vote
   * immediately, then persists through the narrow route. The live broadcast to
   * the other participants is the session blob's job, exactly as `done` and
   * `assigneeId` already work in this phase.
   */
  rateActionImpact: (teamId: string, actionId: string, userId: string, vote: ActionImpactVote | null) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    // Same guard as the route: the id becomes an object key, and `__proto__`
    // would change the map's prototype instead of recording a vote. Checked
    // here too so the local record can never hold what the server refuses.
    if (!isValidRaterId(userId)) return;

    const apply = (action: ActionItem) => {
      const ratings = withRaterVote(action.impactRatings, userId, vote) as Record<string, ActionImpactVote>;
      if (Object.keys(ratings).length > 0) action.impactRatings = ratings;
      else delete action.impactRatings;
    };

    const global = team.globalActions.find(a => a.id === actionId);
    if (global) {
      apply(global);
      queuePersist(() => persistActionImpact(teamId, { actionId, userId, vote }));
      return;
    }

    for (const retro of team.retrospectives) {
      const action = retro.actions.find(a => a.id === actionId);
      if (action) {
        apply(action);
        queuePersist(() => persistActionImpact(teamId, { actionId, userId, vote }));
        return;
      }
    }

    for (const hc of (team.healthChecks || [])) {
      const action = hc.actions.find(a => a.id === actionId);
      if (action) {
        apply(action);
        queuePersist(() => persistActionImpact(teamId, { actionId, userId, vote }));
        return;
      }
    }
  },

  /**
   * Mark a closed action as "ask the team again next retro" (or undo that).
   *
   * Goes through the whole-action route rather than a narrow one because it has
   * a single writer — only the facilitator defers — so there is no race to
   * protect against, and `mergeActionImpactState` keeps the votes safe.
   */
  /**
   * Drop every vote stored on one action, so the retrospective that is putting
   * it back to the team collects fresh answers.
   *
   * Called when a *later* retro re-presents an action a previous facilitator
   * postponed — never on the deferral itself. "Rate later" promises the
   * question is asked again, and a vote left in place is pre-filled next time,
   * so the person who answered early is never actually re-asked. Clearing at
   * re-presentation instead of at the deferral is what keeps the "Rate later"
   * toggle lossless: a mis-click stays undoable, and the votes only go when the
   * round that would have shown them really reopens.
   *
   * The dashboard average for that action goes with them, deliberately: the
   * team said it was too early to judge, so there is no number to preserve.
   */
  resetActionImpactRatings: (teamId: string, actionId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const buckets: ActionItem[][] = [
      team.globalActions,
      ...team.retrospectives.map(r => r.actions),
      ...(team.healthChecks || []).map(h => h.actions)
    ];

    for (const bucket of buckets) {
      const action = bucket?.find(a => a.id === actionId);
      if (!action) continue;
      delete action.impactRatings;
      queuePersist(() => persistActionImpact(teamId, { actionId, reset: true }));
      return;
    }
  },

  setActionImpactDeferral: (teamId: string, actionId: string, retroId: string | null) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const all: [ActionItem[], string | undefined, string | undefined][] = [
      [team.globalActions, undefined, undefined],
      ...team.retrospectives.map(r => [r.actions, r.id, undefined] as [ActionItem[], string, undefined]),
      ...(team.healthChecks || []).map(h => [h.actions, undefined, h.id] as [ActionItem[], undefined, string])
    ];

    for (const [actions, ownerRetroId, healthCheckId] of all) {
      const action = actions?.find(a => a.id === actionId);
      if (!action) continue;
      if (retroId === null) delete action.impactDeferredBy;
      else action.impactDeferredBy = retroId;
      const snapshot = { ...action };
      queuePersist(() => persistAction(teamId, snapshot, ownerRetroId, healthCheckId));
      return;
    }
  },

  deleteAction: (teamId: string, actionId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const beforeGlobal = team.globalActions.length;
    team.globalActions = team.globalActions.filter(a => a.id !== actionId);

    let deleted = beforeGlobal !== team.globalActions.length;

    team.retrospectives.forEach(retro => {
        const before = retro.actions.length;
        retro.actions = retro.actions.filter(a => a.id !== actionId);
        if (before !== retro.actions.length) deleted = true;
    });

    (team.healthChecks || []).forEach(hc => {
        const before = hc.actions.length;
        hc.actions = hc.actions.filter(a => a.id !== actionId);
        if (before !== hc.actions.length) deleted = true;
    });

    // The server removes the id from all three homes itself; sending the lists
    // instead is what let a stale tab erase a live retro (incident ISS).
    if (deleted) {
        queuePersist(() => persistDeletion(
          `/api/team/${teamId}/action/delete`,
          { actionId },
          'action_not_found',
          ['missing_action']
        ));
    }
  },

  deleteRetrospective: (teamId: string, retroId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    const retroIdx = team.retrospectives.findIndex(r => r.id === retroId);
    if (retroIdx === -1) return;

    const retro = team.retrospectives[retroIdx];
    // Promote actions to the global backlog before deletion
    retro.actions.forEach(action => {
        const already = team.globalActions.some(a => a.id === action.id);
        if (!already) {
            team.globalActions.unshift({ ...action });
        }
    });

    team.retrospectives.splice(retroIdx, 1);
    // The server applies the same action promotion on its own copy, so the
    // stale-tab case cannot lose the actions either (incident ISS).
    queuePersist(() => persistDeletion(
      `/api/team/${teamId}/retrospective/${retroId}/delete`,
      {},
      'retrospective_not_found'
    ));
  },

  getPresets: () => PRESETS,
  getHex,

  createSessionInvite: async (teamId: string, sessionId?: string, healthCheckSessionId?: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    // Stage 7e: links embed a server-derived invite credential instead of the
    // plaintext team password, so token-only sessions can mint links too.
    const inviteCredential = await fetchInviteCredential(teamId);

    const inviteData = {
      id: team.id,
      name: team.name,
      inviteCredential,
      sessionId,
      healthCheckSessionId
    };

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;

    return { inviteLink: link };
  },

  createMemberInvite: async (teamId: string, email: string, sessionId?: string, nameHint?: string, healthCheckSessionId?: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    // Fetched before any roster mutation so a failure (e.g. server
    // unreachable) never leaves a member added without a working link.
    const inviteCredential = await fetchInviteCredential(teamId);
    if (!team.archivedMembers) team.archivedMembers = [];

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) throw new Error('Valid email required');

    let user = findMemberByEmail(team.members, email);
    let membersChanged = false;

    if (!user) {
      const archivedIdx = indexOfMemberByEmail(team.archivedMembers, email);
      if (archivedIdx !== -1) {
        const [restored] = team.archivedMembers.splice(archivedIdx, 1);
        restored.role = 'participant';
        if (!restored.inviteToken) restored.inviteToken = randomId(8);
        team.members.push(restored);
        user = restored;
      } else {
        const candidateName = nameHint?.trim() || normalizedEmail.split('@')[0];
        user = {
          id: randomId(),
          name: candidateName,
          color: USER_COLORS[team.members.length % USER_COLORS.length],
          role: 'participant',
          email: normalizedEmail,
          inviteToken: randomId(8)
        };
        team.members.push(user);
      }
      membersChanged = true;
    } else if (!user.inviteToken) {
      user.inviteToken = randomId(8);
      membersChanged = true;
    }

    if (membersChanged) {
      queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    }

    // SECURITY: The invite credential grants team access without disclosing
    // the team password (stage 7e); the server exchanges it for a session
    // token at join time and revokes it when the password rotates.
    const inviteData: Record<string, unknown> = {
      id: team.id,
      name: team.name,
      inviteCredential,
      memberEmail: normalizedEmail,
      memberName: user.name || nameHint || normalizedEmail.split('@')[0],
      memberId: user.id,
      inviteToken: user.inviteToken
    };

    if (sessionId) {
      inviteData.sessionId = sessionId;
    }
    if (healthCheckSessionId) {
      inviteData.healthCheckSessionId = healthCheckSessionId;
    }

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;

    return { user, inviteLink: link };
  },

  /**
   * Ask the server to mail an invite link.
   *
   * The credentials are attached here rather than in the calling component so
   * they never leave this module: `/api/send-invite` refuses anonymous callers
   * (audit H3 — it used to be an open relay on the deployment's SMTP
   * identity). `teamName` is deliberately not sent; the server uses the
   * authenticated team's own name so an invite cannot claim to be from another
   * team.
   *
   * Throws with the server's error code so the caller can report per-recipient
   * failures. There is no send quota — an authenticated team may invite as many
   * people as it needs — so the only actionable codes are
   * `email_not_configured` and `unauthenticated`.
   */
  sendInviteEmail: async (
    teamId: string,
    invite: { email: string; name?: string; link: string; sessionName?: string }
  ): Promise<void> => {
    const res = await fetch('/api/send-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamId,
        password: authenticatedTeamPassword,
        sessionToken: authenticatedSessionToken ?? undefined,
        email: invite.email,
        name: invite.name,
        link: invite.link,
        sessionName: invite.sessionName,
        // The invitee reads the mail before they ever see the app, so it is
        // written in the language the facilitator is using to send it.
        language: getActiveLanguage()
      })
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'send_failed' }));
      throw new Error(body.error || 'send_failed');
    }
  },

  persistParticipants: (teamId: string, participants: User[]) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    if (!team.archivedMembers) team.archivedMembers = [];

    let changed = false;

    participants.forEach(p => {
      const normalizedEmail = normalizeEmail(p.email);
      const existing = team.members.find(m => {
        if (p.inviteToken && m.inviteToken === p.inviteToken) return true;
        if (normalizedEmail && normalizeEmail(m.email) === normalizedEmail) return true;
        return m.id === p.id || m.name.toLowerCase() === p.name.toLowerCase();
      });

      const archived = team.archivedMembers!.find(m => m.id === p.id || (normalizedEmail && normalizeEmail(m.email) === normalizedEmail));

      if (existing) {
        // Team data is authoritative for name/email (editable from Dashboard).
        // Only propagate invite tokens from session participants.
        if (!existing.inviteToken && p.inviteToken) { existing.inviteToken = p.inviteToken; changed = true; }
      } else if (archived) {
        // Do not auto-readd archived members to active roster
        // Team data is authoritative — do not overwrite name/email.
      } else {
        const newMember: User = {
          id: p.id,
          name: p.name,
          color: p.color || USER_COLORS[team.members.length % USER_COLORS.length],
          role: 'participant',
          email: normalizedEmail || undefined,
          inviteToken: p.inviteToken || randomId(8)
        };
        team.members.push(newMember);
        changed = true;
      }
    });

    if (changed) {
      queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    }
  },

  // Import a team from invitation data (for invited users)
  // This is called when a user clicks an invite link - it logs them into the team
  importTeam: async (inviteData: { id: string; name: string; password?: string; inviteCredential?: string; sessionId?: string; session?: RetroSession; members?: User[]; globalActions?: ActionItem[]; retrospectives?: RetroSession[]; memberId?: string; memberEmail?: string; memberName?: string; inviteToken?: string }): Promise<Team> => {
    // New links (stage 7e) carry a signed invite credential; older links
    // embed the plaintext password and keep joining until stage 7d.
    const res = await fetch('/api/team/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        inviteData.inviteCredential
          ? { teamName: inviteData.name, inviteCredential: inviteData.inviteCredential }
          : { teamName: inviteData.name, password: inviteData.password }
      )
    });

    if (!res.ok) {
      throw new Error('Failed to join team - invalid invite link');
    }

    const { team, sessionToken } = await res.json();
    if (!team.archivedMembers) team.archivedMembers = [];
    // Credential joins hold no password; the issued session token covers all
    // team calls, including deriving invite credentials of their own.
    setAuthCredentials(team.id, inviteData.password || '', team, sessionToken);

    return team;
  },

  // Delete a team and all its data
  deleteTeam: async (teamId: string): Promise<void> => {
    if (!hasTeamCredentials() || authenticatedTeamId !== teamId) return;

    const { error } = await apiCall(`/api/team/${teamId}/delete`, {});

    // A failed deletion leaves the team in place, so the caller must not log
    // out as if it were gone: it used to, and the facilitator who logged back
    // in found the team they had been told was deleted. A team that is already
    // gone — a retry whose first answer was lost, a second tab, the super
    // admin — is the outcome asked for, not a failure to retry forever.
    if (error && error !== 'team_not_found') {
      throw new Error(TEAM_DELETE_FAILED);
    }
    clearAuthCredentials();
  },

  // Join a team as a new participant
  joinTeamAsParticipant: (
    teamId: string,
    userName: string,
    email?: string,
    inviteToken?: string,
    allowCreateWithoutInvite?: boolean
  ): { team: Team; user: User } => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    if (!team.archivedMembers) team.archivedMembers = [];

    const normalizedEmail = normalizeEmail(email);
    const normalizedName = userName.trim().toLowerCase();

    const archivedByToken = inviteToken
      ? team.archivedMembers.find((m) => m.inviteToken === inviteToken)
      : undefined;
    const archivedByEmail = normalizedEmail
      ? findMemberByEmail(team.archivedMembers, email)
      : undefined;
    const archivedMatch = archivedByToken || archivedByEmail;

    const existingByToken = inviteToken
      ? team.members.find((m) => m.inviteToken === inviteToken)
      : undefined;
    const existingByEmail = normalizedEmail
      ? findMemberByEmail(team.members, email)
      : undefined;

    // Allow matching by name for participants (to prevent duplicates like "Nico" vs "Niko")
    // But NOT for facilitators (security: prevents impersonation of admins)
    const existingByName = team.members.find((m) =>
      m.role !== 'facilitator' && m.name.trim().toLowerCase() === normalizedName
    );

    // Priority: token > email > name (for participants only)
    const existingUser = existingByToken || existingByEmail || existingByName;

    if (archivedMatch) {
      team.archivedMembers = team.archivedMembers.filter((m) => m.id !== archivedMatch.id);
    }

    if (existingUser) {
      const matchedByIdentity = (inviteToken && existingUser.inviteToken === inviteToken) ||
        (normalizedEmail && normalizeEmail(existingUser.email) === normalizedEmail);
      const matchedByName = existingUser.name.trim().toLowerCase() === normalizedName;

      if (normalizedEmail && existingUser.email !== normalizedEmail) existingUser.email = normalizedEmail;
      if (inviteToken && !existingUser.inviteToken) existingUser.inviteToken = inviteToken;

      const shouldUpdateName =
        !existingUser.joinedBefore ||
        (!matchedByIdentity && !matchedByName && existingUser.name !== userName) ||
        !existingUser.name;

      if (shouldUpdateName) {
        existingUser.name = userName;
      }

      existingUser.joinedBefore = true;

      queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
      return { team, user: existingUser };
    }

    // Security: Prevent impersonation of facilitators
    const facilitatorWithSameName = team.members.find((m) =>
      m.role === 'facilitator' && m.name.trim().toLowerCase() === normalizedName
    );
    // Block if trying to use facilitator name without proper authentication
    if (facilitatorWithSameName && !inviteToken && !normalizedEmail) {
      throw new Error('This name is reserved. Please use a different name or contact the team administrator.');
    }

    if (!existingByToken && !existingByEmail && !allowCreateWithoutInvite) {
      throw new Error('An invitation is required to join this team.');
    }

    // Create new participant when joining via a shared invite link (QR code)
    const newUser: User = {
      id: randomId(),
      name: userName,
      color: USER_COLORS[team.members.length % USER_COLORS.length],
      role: 'participant',
      email: normalizedEmail || undefined,
      inviteToken: inviteToken || randomId(8),
      joinedBefore: true
    };

    team.members.push(newUser);
    queuePersist(() => persistMembers(teamId, team.members, team.archivedMembers));
    return { team, user: newUser };
  },

  autoJoinFromInvite: (
    teamId: string,
    inviteData: { memberId?: string; memberEmail?: string; inviteToken?: string }
  ): { team: Team; user: User } => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const normalizedInviteEmail = normalizeEmail(inviteData.memberEmail);
    const matchedMember =
      (inviteData.memberId && team.members.find((member) => member.id === inviteData.memberId)) ||
      (inviteData.inviteToken && team.members.find((member) => member.inviteToken === inviteData.inviteToken)) ||
      (normalizedInviteEmail && team.members.find((member) => normalizeEmail(member.email) === normalizedInviteEmail)) ||
      null;

    if (!matchedMember) {
      throw new InviteAutoJoinError('Invitation could not be verified. Please join manually.');
    }

    return dataService.joinTeamAsParticipant(
      team.id,
      matchedMember.name,
      inviteData.memberEmail,
      inviteData.inviteToken,
      true
    );
  },

  // ==================== HEALTH CHECK METHODS ====================

  getHealthCheckTemplates: (teamId?: string): HealthCheckTemplate[] => {
    const defaults = [...HEALTH_CHECK_TEMPLATES];
    if (!teamId) return defaults;

    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return defaults;

    const customTemplates = team.customHealthCheckTemplates || [];
    return [...defaults, ...customTemplates];
  },

  createHealthCheckSession: (
    teamId: string,
    name: string,
    templateId: string,
    options?: { isAnonymous?: boolean }
  ): HealthCheckSession => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    // Find the template
    const allTemplates = [...HEALTH_CHECK_TEMPLATES, ...(team.customHealthCheckTemplates || [])];
    const template = allTemplates.find(t => t.id === templateId);
    if (!template) throw new Error('Template not found');

    // Initialize health checks array if needed
    if (!team.healthChecks) team.healthChecks = [];

    const session: HealthCheckSession = {
      id: randomId(),
      teamId,
      name,
      date: new Date().toLocaleDateString(),
      status: 'IN_PROGRESS',
      phase: 'SURVEY',
      templateId: template.id,
      templateName: template.name,
      dimensions: JSON.parse(JSON.stringify(template.dimensions)), // Deep copy
      participants: [],
      settings: {
        isAnonymous: options?.isAnonymous ?? false,
        revealRoti: false,
        showParticipantVotes: false,
        // The same timer as a retrospective, stopped at the Survey's timebox.
        ...createTimerSettings(getHealthCheckPhaseDefaultTimerSeconds('SURVEY'))
      },
      ratings: {},
      actions: [],
      discussionFocusId: null,
      roti: {},
      finishedUsers: []
    };

    team.healthChecks.unshift(session);
    queuePersist(() => persistHealthCheck(teamId, session));
    return session;
  },

  updateHealthCheckSession: (teamId: string, session: HealthCheckSession) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.healthChecks) team.healthChecks = [];

    const idx = team.healthChecks.findIndex(h => h.id === session.id);
    if (idx !== -1) {
      // Reconcile action done/assigneeId from current team data (source of truth).
      const existingActions = team.healthChecks[idx].actions;
      if (existingActions?.length) {
        const existingMap = new Map(existingActions.map(a => [a.id, a]));
        session = {
          ...session,
          actions: session.actions.map(a => {
            const existing = existingMap.get(a.id);
            if (existing) {
              return { ...a, done: existing.done, assigneeId: existing.assigneeId };
            }
            return a;
          })
        };
      }
      // Health-check actions can be rated like retro ones, so they need the
      // same guard: the rating routes do not advance this session's revision,
      // and the loop above carries `done`/`assigneeId` but nothing else.
      session = reconcileHealthCheckActionState(team.healthChecks[idx], session);
      team.healthChecks[idx] = session;
      queuePersist(() => persistHealthCheck(teamId, session));
    }
  },

  // Local-cache-only counterpart of updateHealthCheckSession for received
  // updates (see applyRemoteSession above — receivers must not re-persist).
  applyRemoteHealthCheckSession: (teamId: string, session: HealthCheckSession) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;
    if (!team.healthChecks) team.healthChecks = [];
    const idx = team.healthChecks.findIndex(h => h.id === session.id);
    if (idx === -1) return;

    const existingActions = team.healthChecks[idx].actions;
    if (existingActions?.length) {
      const existingMap = new Map(existingActions.map(a => [a.id, a]));
      session = {
        ...session,
        actions: session.actions.map(a => {
          const existing = existingMap.get(a.id);
          return existing ? { ...a, done: existing.done, assigneeId: existing.assigneeId } : a;
        })
      };
    }
    team.healthChecks[idx] = session;
  },

  deleteHealthCheck: (teamId: string, healthCheckId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.healthChecks) return;

    const idx = team.healthChecks.findIndex(h => h.id === healthCheckId);
    if (idx === -1) return;

    const healthCheck = team.healthChecks[idx];
    // Promote actions to global backlog before deletion
    healthCheck.actions.forEach(action => {
      const already = team.globalActions.some(a => a.id === action.id);
      if (!already) {
        team.globalActions.unshift({ ...action });
      }
    });

    team.healthChecks.splice(idx, 1);
    // See deleteRetrospective: the server promotes the actions itself.
    queuePersist(() => persistDeletion(
      `/api/team/${teamId}/healthcheck/${healthCheckId}/delete`,
      {},
      'healthcheck_not_found'
    ));
  },

  saveHealthCheckTemplate: (teamId: string, template: HealthCheckTemplate) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.customHealthCheckTemplates) team.customHealthCheckTemplates = [];

    // Generate ID if not present
    if (!template.id) {
      template.id = 'custom_' + randomId();
    }

    // Check if template with same ID already exists (update case)
    const existingIdx = team.customHealthCheckTemplates.findIndex(t => t.id === template.id);
    if (existingIdx !== -1) {
      team.customHealthCheckTemplates[existingIdx] = template;
    } else {
      team.customHealthCheckTemplates.push(template);
    }

    // One template, upserted by id on its own route (incident ISS): the whole
    // list sent through `/update` erased templates saved from another tab.
    queuePersist(() => persistTemplateSave(`/api/team/${teamId}/healthcheck-template/save`, { template }));
  },

  deleteHealthCheckTemplate: (teamId: string, templateId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.customHealthCheckTemplates) return;

    team.customHealthCheckTemplates = team.customHealthCheckTemplates.filter(t => t.id !== templateId);
    queuePersist(() => persistDeletion(
      `/api/team/${teamId}/healthcheck-template/delete`,
      { templateId },
      'healthcheck_template_not_found',
      ['missing_template']
    ));
  },

  getHealthCheck: (teamId: string, healthCheckId: string): HealthCheckSession | undefined => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId || !team.healthChecks) return undefined;
    return team.healthChecks.find(h => h.id === healthCheckId);
  },

  ensureHealthCheckPlaceholder: (teamId: string, sessionId: string): HealthCheckSession | undefined => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) return;

    if (!team.healthChecks) team.healthChecks = [];

    const existing = team.healthChecks.find(h => h.id === sessionId);
    if (existing) return existing;

    // Get default template
    const defaultTemplate = HEALTH_CHECK_TEMPLATES[0];

    const placeholder: HealthCheckSession = {
      id: sessionId,
      teamId,
      name: 'Health Check',
      date: new Date().toLocaleDateString(),
      status: 'IN_PROGRESS',
      phase: 'SURVEY',
      templateId: defaultTemplate.id,
      templateName: defaultTemplate.name,
      dimensions: JSON.parse(JSON.stringify(defaultTemplate.dimensions)),
      participants: [],
      settings: {
        isAnonymous: false,
        revealRoti: false,
        showParticipantVotes: false,
        ...createTimerSettings(getHealthCheckPhaseDefaultTimerSeconds('SURVEY'))
      },
      ratings: {},
      actions: [],
      discussionFocusId: null,
      roti: {},
      finishedUsers: []
    };

    // Local cache only, for the reason given at ensureSessionPlaceholder.
    team.healthChecks.unshift(placeholder);

    return placeholder;
  },

  // Create invite link for health check session
  createHealthCheckInvite: async (teamId: string, sessionId: string) => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    const inviteData = {
      id: team.id,
      name: team.name,
      inviteCredential: await fetchInviteCredential(teamId),
      healthCheckSessionId: sessionId,
    };

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;

    return { inviteLink: link };
  },

  // Password recovery functions
  /**
   * Saves the team's recovery address and returns what was stored: the
   * cleaned address, or `undefined` when the field was emptied. Throws
   * `INVALID_EMAIL_MESSAGE` for anything that is not one valid address, before
   * touching the cached team — the Dashboard used to save every keystroke,
   * and a paste such as `…@etat.ge.ch;` was stored as typed.
   */
  // Awaited, not queued and forgotten: this is the address a password reset
  // is mailed to, and a "saved" shown for a write the server refused is the
  // incident this rule exists for — a reset mail that can never come.
  updateFacilitatorEmail: async (teamId: string, email: string): Promise<string | undefined> => {
    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');
    const parsed = parseEmailInput(email);
    if (!parsed.ok) throw new Error(INVALID_EMAIL_MESSAGE);
    if (!hasTeamCredentials()) throw new Error(RECOVERY_EMAIL_NOT_SAVED);

    const refusal = await runPersist(async () => {
      // `null`, not `undefined`, so that a clear survives JSON.stringify.
      const { data, error } = await apiCall<{ team: Team }>(`/api/team/${teamId}/update`, {
        updates: { facilitatorEmail: parsed.email ?? null }
      });
      if (error) return error;
      if (data?.team) authenticatedTeam = data.team;
      return null;
    }).catch(() => 'network_error');
    if (refusal) throw new Error(refusal === INVALID_EMAIL_ERROR ? INVALID_EMAIL_MESSAGE : RECOVERY_EMAIL_NOT_SAVED);

    const current = getAuthenticatedTeam();
    if (current && current.id === teamId) current.facilitatorEmail = parsed.email;
    return parsed.email;
  },

  changeTeamPassword: async (teamId: string, newPassword: string, currentPassword?: string): Promise<void> => {
    // Audit H39. This is the one client-side *write* check that does not live
    // in a form, so it is the one that can quietly keep an old literal while
    // every screen shows the new rule — which is what it did until review.
    if (!isPasswordLongEnough(newPassword)) {
      throw new Error(PASSWORD_POLICY_MESSAGE);
    }

    if (authenticatedTeamId !== teamId) {
      throw new Error('Team not found');
    }

    // Rotating the credential requires the current credential. A restored
    // session is token-only (stage 7e persists no password), so the caller
    // must collect the current password from the user in that case.
    const effectiveCurrentPassword = currentPassword || authenticatedTeamPassword;
    if (!effectiveCurrentPassword) {
      throw new Error('Current password required');
    }

    const { error } = await apiCall(`/api/team/${teamId}/password`, {
      newPassword,
      password: effectiveCurrentPassword,
      // Changing the credential requires the current credential: without this
      // override a session holding a still-valid token but a rotated-away
      // password could change the team password again (review finding).
      sessionToken: undefined
    });

    if (error) {
      throw new Error(error === 'invalid_password' ? 'Current password is incorrect' : 'Failed to change password');
    }

    // Update stored password and drop the cached invite credential — the
    // rotation bumped the team's invite epoch, revoking the old credential.
    authenticatedTeamPassword = newPassword;
    inviteCredentialCache = null;
  },

  renameTeam: async (teamId: string, newName: string): Promise<void> => {
    if (!newName || newName.trim().length === 0) {
      throw new Error('Team name cannot be empty');
    }
    const trimmedName = newName.trim();

    const team = getAuthenticatedTeam();
    if (!team || team.id !== teamId) throw new Error('Team not found');

    // Check if name is available. An unanswered check must fail the rename
    // rather than fall through: renaming anyway mutates the local team and
    // queues a write the server can still reject as a duplicate, and
    // `persistTeamUpdate` only logs that rejection — so the UI would report a
    // rename that silently never happened until the next refresh reverted it.
    const checkRes = await fetch(`/api/team/exists/${encodeURIComponent(trimmedName)}`);
    if (!checkRes.ok) {
      throw new Error(
        checkRes.status === 429
          ? 'Too many requests right now — please wait a moment and try renaming again'
          : 'Could not check whether that team name is available — please try again'
      );
    }

    const { exists } = await checkRes.json();
    if (exists) {
      throw new Error('A team with this name already exists');
    }

    team.name = trimmedName;
    queuePersist(() => persistTeamUpdate(teamId, { name: trimmedName }));
  },

  requestPasswordReset: async (teamName: string, email: string): Promise<{ success: boolean; message: string }> => {
    // Password reset is handled via email through the server
    // We don't have access to other teams' data in secure mode
    // This request will be handled by the server

    // Saying the address is not a valid one judges only what the user typed,
    // so it reveals nothing about any team — unlike every answer below.
    const typed = parseEmailInput(email);
    if (!typed.ok || !typed.email) {
      return { success: false, message: INVALID_EMAIL_MESSAGE };
    }

    try {
      const response = await fetch('/api/send-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: typed.email,
          teamName,
          resetBaseUrl: `${window.location.origin}${window.location.pathname}`,
          language: getActiveLanguage()
        })
      });

      // A 501 means the *server* is not set up to send this mail — either SMTP
      // is absent, or PUBLIC_BASE_URL is unset so it has no origin it trusts
      // enough to put a live reset token on (audit H4). Neither depends on the
      // team or the address, so saying so leaks nothing, and staying silent
      // would leave the user waiting for a mail that is never coming. Every
      // other failure keeps the deliberately opaque answer below, which is what
      // stops this endpoint from confirming whether a team exists.
      if (response.status === 501) {
        return {
          success: false,
          message: 'Password reset by email is not available on this server. Please contact your administrator.'
        };
      }

      // A newer server judging the address more strictly than this client.
      // Like the local check above, it is about the typed value alone.
      if (response.status === 400) {
        const errorData = await response.json().catch(() => ({}));
        if (errorData?.error === INVALID_EMAIL_ERROR) {
          return { success: false, message: INVALID_EMAIL_MESSAGE };
        }
      }

      if (!response.ok) {
        console.error('Failed to send password reset email');
      }
    } catch (error) {
      console.error('Error sending password reset email:', error);
    }

    return { success: true, message: 'If the team and email match, a reset link has been sent.' };
  },

  resetPassword: async (token: string, newPassword: string): Promise<{ success: boolean; message: string; teamName?: string }> => {
    try {
      const response = await fetch('/api/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword })
      });

      if (!response.ok) {
        // The reset view renders this string directly, so a raw error code
        // would reach the user. A throttled attempt is not a failed reset —
        // the token is still good, they just have to wait.
        if (response.status === 429) {
          return {
            success: false,
            message: 'Too many password reset attempts from this network. Please wait a few minutes and try again.'
          };
        }
        const errorData = await response.json().catch(() => ({ error: 'reset_failed' }));
        if (errorData.error === PASSWORD_TOO_SHORT_ERROR) {
          return { success: false, message: PASSWORD_POLICY_MESSAGE };
        }
        return { success: false, message: errorData.error || 'reset_failed' };
      }

      const data = await response.json();
      return { success: true, message: data.message || 'Password reset successfully', teamName: data.teamName };
    } catch (error) {
      console.error('Error resetting password:', error);
      return { success: false, message: 'reset_failed' };
    }
  },

  verifyResetToken: async (token: string): Promise<{ valid: boolean; teamName?: string; throttled?: boolean }> => {
    try {
      const response = await fetch('/api/password-reset/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });

      // A throttled check never judged the link, so it must not be collapsed
      // into "invalid": telling the user their link is dead pushes them to
      // request another one, which only burns the reset-email limiter too.
      if (response.status === 429) {
        return { valid: false, throttled: true };
      }

      if (!response.ok) {
        return { valid: false };
      }

      const data = await response.json();
      return { valid: !!data.valid, teamName: data.teamName };
    } catch (error) {
      console.error('Error verifying reset token:', error);
      return { valid: false };
    }
  },

  // ==================== AUTH HELPERS ====================

  /**
   * Check if user is authenticated to a team
   */
  isAuthenticated: (): boolean => {
    return !!authenticatedTeamId && hasTeamCredentials();
  },

  /**
   * Get the authenticated team ID
   */
  getAuthenticatedTeamId: (): string | null => {
    return authenticatedTeamId;
  },

  /**
   * Logout - clear authentication
   */
  logout: (): void => {
    clearAuthCredentials();
  },

  /**
   * Set authentication from invite data (used when joining via invite link)
   */
  setAuthFromInvite: (teamId: string, password: string, team: Team): void => {
    setAuthCredentials(teamId, password, team);
  },

  /**
   * Get authenticated team password (for API calls from components)
   */
  getAuthenticatedPassword: (): string | null => {
    return authenticatedTeamPassword;
  },

  /**
   * Get the session token for secure session persistence
   */
  getSessionToken: (): string | null => {
    return authenticatedSessionToken;
  },

  /**
   * Load all feedbacks from all teams.
   *
   * Feedbacks are read and written through `/api/feedbacks/*` — here and in
   * components/TeamFeedback.tsx — never through the cached team record. The
   * create/update/delete/mark-read methods that used to work on that cached
   * list sent it whole through `/update`, which no longer applies it
   * (incident ISS); the getters that read it had no caller left and went too.
   */
  loadAllFeedbacks: async (): Promise<{ feedbacks: TeamFeedback[]; error: string | null }> => {
    const { data, error } = await apiCall<{ feedbacks: TeamFeedback[] }>('/api/feedbacks/all', {
      teamId: authenticatedTeamId
    });
    if (error || !data) {
      return { feedbacks: [], error: error || 'Failed to load feedbacks' };
    }
    return { feedbacks: data.feedbacks, error: null };
  },

  /**
   * Add a comment to a feedback
   */
  addFeedbackComment: async (
    feedbackTeamId: string,
    feedbackId: string,
    authorId: string,
    authorName: string,
    content: string
  ): Promise<{ comment: FeedbackComment | null; error: string | null }> => {
    const { data, error } = await apiCall<{ success: boolean; comment: FeedbackComment }>(
      '/api/feedbacks/comment',
      {
        teamId: authenticatedTeamId,
        feedbackTeamId,
        feedbackId,
        authorId,
        authorName,
        content
      }
    );
    if (error || !data) {
      return { comment: null, error: error || 'Failed to add comment' };
    }
    return { comment: data.comment, error: null };
  },

  /**
   * Delete a comment from a feedback
   */
  deleteFeedbackComment: async (
    feedbackTeamId: string,
    feedbackId: string,
    commentId: string
  ): Promise<{ success: boolean; error: string | null }> => {
    const { data, error } = await apiCall<{ success: boolean }>(
      '/api/feedbacks/comment/delete',
      {
        teamId: authenticatedTeamId,
        feedbackTeamId,
        feedbackId,
        commentId
      }
    );
    if (error || !data) {
      return { success: false, error: error || 'Failed to delete comment' };
    }
    return { success: true, error: null };
  }
};
