import React from 'react';
import type { JiraTarget } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import JiraLinkBadge from './JiraLinkBadge';
import { jiraSearchUrl } from './jiraSearchUrl';
import { jiraScopeLabel } from './jiraParentLabels';
import type { JiraParentPreview } from './jiraIssuePreview';

interface Props {
  previews: JiraParentPreview[];
  /** The parent issue named for this send (a valid key), or null. */
  explicitKey: string | null;
  /** With `explicitKey`: it replaces the parent issue sessions already have. */
  replace: boolean;
  baseUrl: string | null | undefined;
  /** The target the dialog shows, for the search of a parent that may exist. */
  target: JiraTarget | null | undefined;
  forceParent: boolean;
  onForceParentChange: (checked: boolean) => void;
  idPrefix: string;
}

/**
 * The batch dialog's "Parent issues" (`sessionParent` mode, design F2 §6.4):
 * one row per retrospective, health check or the team dashboard whose actions
 * are sent, labelled with its kind and name, and what happens to its parent
 * issue — the existing one, by its key; a new one, by the title it will have,
 * in its own language; or one that may already be in Jira, with a search to
 * check it and the box that creates a new one anyway (`forceParent`).
 *
 * With a parent issue named for the send, each row says instead what that
 * issue becomes for it: its parent, if it has none (or only a doubt), or not —
 * unless "Also use … for their later actions" is ticked. That happens only
 * once Jira has created a sub-task of the row's session under it; the results
 * say whether it did.
 *
 * A parent created here stays its session's parent for its later actions,
 * whether the target is the stored one or a change for this creation only:
 * one line says so whenever a row will create one.
 */
const JiraParentPreviewList: React.FC<Props> = ({
  previews,
  explicitKey,
  replace,
  baseUrl,
  target,
  forceParent,
  onForceParentChange,
  idPrefix
}) => {
  const { t, tRich } = useTranslation();
  if (previews.length === 0) return null;
  const headingId = `${idPrefix}-heading`;
  const anyNew = !explicitKey && previews.some(preview => preview.parent.state === 'new');
  const anyUncertain = !explicitKey && previews.some(preview => preview.parent.state === 'uncertain');

  const rowContent = (preview: JiraParentPreview, label: string): React.ReactNode => {
    const { parent } = preview;
    if (explicitKey) {
      if (parent.state === 'existing' && parent.key !== explicitKey) {
        return (
          <span className="text-slate-700">
            {replace
              ? t('jira.batch.parents.replaces', { key: explicitKey, current: parent.key })
              : t('jira.batch.parents.keeps', { key: explicitKey, current: parent.key })}
          </span>
        );
      }
      if (parent.state !== 'existing') {
        return <span className="text-slate-700">{t('jira.batch.parents.adopts', { key: explicitKey })}</span>;
      }
    }
    if (parent.state === 'existing') {
      return (
        <span className="inline-flex flex-wrap items-center gap-2 text-slate-700">
          <span>{t('jira.batch.parents.existing')}</span>
          <JiraLinkBadge link={{ key: parent.key, createdAt: '' }} baseUrl={baseUrl} />
        </span>
      );
    }
    if (parent.state === 'new') {
      return (
        <span className="text-slate-700">
          {tRich('jira.batch.parents.new', { summary: <span lang={parent.language} className="font-medium">{parent.summary}</span> })}
        </span>
      );
    }
    const checkUrl = jiraSearchUrl(baseUrl, { text: parent.searchText, target });
    return (
      <span className="flex flex-col gap-1">
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-semibold text-amber-800">{t('jira.batch.parents.uncertain')}</span>
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
        <span className="text-slate-700">{t('jira.batch.parents.notSentUncertain')}</span>
      </span>
    );
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="text-sm font-semibold text-slate-700">{t('jira.batch.parents.heading')}</h3>
      {anyNew && <p className="text-xs text-slate-600">{t('jira.batch.parents.lasting')}</p>}
      <ul aria-labelledby={headingId} className="flex flex-col gap-2">
        {previews.map(preview => {
          const label = jiraScopeLabel(preview.kind, preview.sessionName, t);
          return (
            <li key={preview.scope} className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <span className="font-semibold text-slate-800">{label}</span>
              {rowContent(preview, label)}
            </li>
          );
        })}
      </ul>
      {anyUncertain && (
        <label className="inline-flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={forceParent}
            onChange={(e) => onForceParentChange(e.target.checked)}
          />
          <span>{t('jira.batch.parents.forceNew')}</span>
        </label>
      )}
    </section>
  );
};

export default JiraParentPreviewList;
