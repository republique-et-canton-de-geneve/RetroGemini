import React from 'react';
import type { JiraStatus } from '../../types';
import { useTranslation } from '../../i18n/I18nContext';
import type { MessageKey } from '../../i18n/translate';
import { formatJiraDate, jiraAvailability, type JiraAvailability } from './jiraAvailability';

interface Props {
  status: JiraStatus | null | undefined;
  isFacilitator: boolean;
  /** For a control that points its `aria-describedby` here. */
  id?: string;
  className?: string;
}

const REASON_KEYS: Record<Exclude<Extract<JiraAvailability, { state: 'blocked' }>['reason'], 'refused'>, MessageKey> = {
  noToken: 'jira.reason.noToken',
  addressChanged: 'jira.reason.addressChanged',
  unreadable: 'jira.reason.unreadable',
  noTarget: 'jira.reason.noTarget'
};

/**
 * Why a facilitator cannot create Jira issues, and where to fix it — every
 * sentence names Settings → Jira (finding U-1). Before it, a facilitator who
 * had dismissed the discovery note saw nothing at all on a team with no token,
 * and a token Jira had refused looked exactly like a working one.
 *
 * Persistent on purpose: it stays as long as the reason does, rather than
 * being a message that disappears. Shown to facilitators only (participants
 * cannot fix it), only on a deployment with Jira, and only when creation is
 * impossible; otherwise it renders nothing.
 */
const JiraReasonLine: React.FC<Props> = ({ status, isFacilitator, id, className = '' }) => {
  const { t, locale } = useTranslation();
  const availability = jiraAvailability(status);
  if (!isFacilitator || availability.state !== 'blocked') return null;

  const text = availability.reason === 'refused'
    ? t('jira.reason.refused', { date: formatJiraDate(availability.refusedAt, locale) })
    : t(REASON_KEYS[availability.reason]);

  return (
    <p id={id} className={`flex items-start gap-1.5 text-xs text-slate-600 ${className}`}>
      <span className="material-symbols-outlined text-sm text-amber-600" aria-hidden="true">info</span>
      <span>{text}</span>
    </p>
  );
};

export default JiraReasonLine;
