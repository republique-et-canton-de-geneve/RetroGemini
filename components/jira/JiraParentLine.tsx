import React from 'react';
import type { JiraParentLink, JiraStatus } from '../../types';
import { isJiraIssueKey } from '../../utils/jira.js';
import { jiraParentScope, parentIssueFields } from '../../utils/jiraIssueContent.js';
import { useTranslation } from '../../i18n/I18nContext';
import JiraLinkBadge from './JiraLinkBadge';
import { jiraSearchUrl } from './jiraSearchUrl';
import type { PreviewSession, PreviewTeam } from './jiraIssuePreview';

interface Props {
  /** The session's parent issue, as the team record this screen read holds it. */
  link: JiraParentLink | null | undefined;
  status: JiraStatus | null | undefined;
  isFacilitator: boolean;
  kind: 'retro' | 'healthcheck';
  /** The session, for the title a parent in doubt is searched by. */
  session: PreviewSession;
  team: PreviewTeam;
}

/**
 * "Parent issue in Jira: KEY" in a Review step (design F2 §6.8), for the
 * facilitator, when the target is one parent issue per session and this one
 * has its parent: the key, rendered as a link built from the configured
 * address (`JiraLinkBadge`, plain text without one); or, for a parent whose
 * creation lost its answer, the doubt and a search of the project for the
 * title it was created with.
 *
 * Facilitator-only, like the Jira controls: a participant's cache holds the
 * parents as of their login and never learns one created since (parents are
 * not on the session row), so showing it to them would differ from one
 * participant to the next.
 */
const JiraParentLine: React.FC<Props> = ({ link, status, isFacilitator, kind, session, team }) => {
  const { t, language } = useTranslation();
  if (!isFacilitator || !status?.enabled || status.target?.mode !== 'sessionParent' || !link) return null;
  const value = link as Record<string, unknown>;

  if (isJiraIssueKey(value.key)) {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
        <span>{t('jira.parent.line')}</span>
        <JiraLinkBadge link={{ key: value.key as string, createdAt: '' }} baseUrl={status.baseUrl} />
      </p>
    );
  }
  if (typeof value.uncertainSince !== 'string') return null;
  const { summary } = parentIssueFields({ scope: jiraParentScope({ kind, session }), team, requestedBy: '', language });
  const checkUrl = jiraSearchUrl(status.baseUrl, { text: summary, target: status.target });
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
      <span>{t('jira.parent.line')}</span>
      <JiraLinkBadge link={{ uncertainSince: value.uncertainSince }} baseUrl={status.baseUrl} />
      {checkUrl && (
        <a
          href={checkUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('jira.parent.checkLabel')}
          className="text-xs font-semibold text-indigo-700 underline hover:text-indigo-900"
        >
          {t('jira.action.check')}
        </a>
      )}
    </p>
  );
};

export default JiraParentLine;
