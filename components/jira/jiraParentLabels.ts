import type { Translator } from '../../i18n/translate';
import type { JiraActionKind } from './jiraAvailability';
import type { PreviewSession, PreviewTeam } from './jiraIssuePreview';

/**
 * How the screens name the retrospective, health check or team dashboard a
 * parent issue belongs to (`sessionParent` mode): "Retrospective Sprint 12",
 * "Health check Q3", "Team dashboard". Shown as the label of a row, never
 * inside a sentence: French would need a different preposition for each kind
 * (« de la rétrospective », « du bilan de santé »), so every sentence beside it
 * says "its parent issue" instead. The name is data the facilitator typed and
 * carries no `lang`.
 */

/** The kind of a scope key: `retro:<id>`, `healthcheck:<id>`, or `backlog`. */
export const jiraScopeKind = (scope: string): JiraActionKind =>
  scope.startsWith('retro:') ? 'retro' : scope.startsWith('healthcheck:') ? 'healthcheck' : 'backlog';

/** The session a scope names, as the team holds it, or null. */
export const jiraScopeSession = (scope: string, team: PreviewTeam | null | undefined): PreviewSession | null => {
  const kind = jiraScopeKind(scope);
  if (kind === 'backlog' || !team) return null;
  const id = scope.slice(scope.indexOf(':') + 1);
  const list = kind === 'retro' ? team.retrospectives : team.healthChecks;
  return (list ?? []).find(entry => entry?.id === id) ?? null;
};

/** The row label of a scope, from its kind and its session's name. */
export const jiraScopeLabel = (kind: JiraActionKind, name: string | null | undefined, t: Translator): string => {
  const shown = typeof name === 'string' ? name.trim() : '';
  if (kind === 'retro') return shown ? t('jira.batch.parents.retro', { name: shown }) : t('jira.batch.parents.retroUnnamed');
  if (kind === 'healthcheck') return shown ? t('jira.batch.parents.healthcheck', { name: shown }) : t('jira.batch.parents.healthcheckUnnamed');
  return t('jira.batch.parents.backlog');
};

/** The row label of a scope key, its name read from the team. */
export const jiraScopeLabelOf = (scope: string, team: PreviewTeam | null | undefined, t: Translator): string =>
  jiraScopeLabel(jiraScopeKind(scope), jiraScopeSession(scope, team)?.name, t);
