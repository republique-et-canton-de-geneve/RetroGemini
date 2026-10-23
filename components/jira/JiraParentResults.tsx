import React from 'react';
import type { JiraParentResult, JiraTarget } from '../../types';
import { isJiraIssueKey } from '../../utils/jira.js';
import { useTranslation } from '../../i18n/I18nContext';
import JiraLinkBadge from './JiraLinkBadge';
import { jiraSearchUrl } from './jiraSearchUrl';
import { refusesJiraLabels } from './jiraBatchResults';
import { jiraScopeLabel, jiraScopeLabelOf } from './jiraParentLabels';
import type { JiraParentPreview, PreviewTeam } from './jiraIssuePreview';

interface Props {
  parents: JiraParentResult[];
  /** What the dialog previewed: each scope's label and the title to search for. */
  previews: JiraParentPreview[];
  /** For a scope the preview did not list: its name is read from the team. */
  team: PreviewTeam | null | undefined;
  baseUrl: string | null | undefined;
  target: JiraTarget | null | undefined;
}

/**
 * What became of each parent issue of a batch (`sessionParent` mode, design
 * F2 §6.4), one row per retrospective, health check or the team dashboard,
 * after the actions' own results: created (with its key), adopted from the
 * parent issue named for the send, in doubt (with a search to check it), being
 * created from another window, refused by Jira (with Jira's words, and where
 * to remove the labels when it refused them), or created but not saved here
 * (with the key to name next time). Each status is said in words; amber and
 * red only repeat it.
 */
const JiraParentResults: React.FC<Props> = ({ parents, previews, team, baseUrl, target }) => {
  const { t } = useTranslation();
  if (parents.length === 0) return null;
  const byScope = new Map(previews.map(preview => [preview.scope, preview]));

  const content = (entry: JiraParentResult, label: string): React.ReactNode => {
    const key = isJiraIssueKey(entry.key) ? entry.key as string : null;
    switch (entry.status) {
      case 'created':
        return key ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-green-800">
            <span>{t('jira.batch.parentResult.created')}</span>
            <JiraLinkBadge link={{ key, createdAt: '' }} baseUrl={baseUrl} />
          </span>
        ) : null;
      case 'adopted':
        return key ? <span className="text-green-800">{t('jira.batch.parentResult.adopted', { key })}</span> : null;
      case 'uncertain': {
        const preview = byScope.get(entry.scope);
        const searchText = preview?.parent.state === 'new' ? preview.parent.summary
          : preview?.parent.state === 'uncertain' ? preview.parent.searchText : '';
        const checkUrl = searchText ? jiraSearchUrl(baseUrl, { text: searchText, target }) : null;
        return (
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="text-amber-800">{t('jira.batch.parentResult.uncertain')}</span>
            {checkUrl && (
              <a
                href={checkUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('jira.batch.parents.checkLabel', { session: label })}
                className="text-xs font-semibold text-indigo-700 underline hover:text-indigo-900"
              >
                {t('jira.action.check')}
              </a>
            )}
          </span>
        );
      }
      case 'in_progress':
        return <span className="text-slate-700">{t('jira.batch.parentResult.inProgress')}</span>;
      case 'refused': {
        const messages = (entry.jiraMessages ?? []).filter(message => typeof message === 'string' && message.trim() !== '');
        return (
          <span className="flex flex-col gap-1 text-red-800">
            <span>{t(messages.length > 0 ? 'jira.batch.parentResult.refused' : 'jira.batch.parentResult.refusedNoMessage')}</span>
            {messages.length > 0 && (
              <ul className="list-disc pl-5 text-slate-700">
                {messages.map((message, index) => <li key={index}>{message}</li>)}
              </ul>
            )}
            {refusesJiraLabels(entry) && <span className="text-slate-700">{t('jira.action.labelsRefused')}</span>}
          </span>
        );
      }
      case 'not_saved':
        return key ? <span className="text-amber-800">{t('jira.batch.parentResult.notSaved', { key })}</span> : null;
      default:
        return null;
    }
  };

  const rows = parents.flatMap(entry => {
    const preview = byScope.get(entry.scope);
    const label = preview ? jiraScopeLabel(preview.kind, preview.sessionName, t) : jiraScopeLabelOf(entry.scope, team, t);
    const body = content(entry, label);
    return body ? [{ entry, label, body }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <li>
      <p className="font-semibold text-slate-800">{t('jira.batch.parents.heading')}</p>
      <ul className="mt-1 flex flex-col gap-2 pl-5">
        {rows.map(({ entry, label, body }) => (
          <li key={entry.scope} className="flex flex-col gap-0.5">
            <span className="font-medium text-slate-800">{label}</span>
            {body}
          </li>
        ))}
      </ul>
    </li>
  );
};

export default JiraParentResults;
