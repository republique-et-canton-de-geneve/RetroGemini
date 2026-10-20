import React from 'react';
import type { JiraLink } from '../../types';
import { isJiraLinked, isJiraUncertain, jiraBrowseUrl } from '../../utils/jira.js';
import { useTranslation } from '../../i18n/I18nContext';

interface Props {
  /** The action's `jira` field, as stored. */
  link: JiraLink | null | undefined;
  /** The configured Jira's address, from the team's Jira status. */
  baseUrl: string | null | undefined;
  /**
   * Receives the badge's element, so a control can move focus to it once the
   * button it replaces is gone. A link is focusable; plain text gets
   * `tabIndex={-1}`: reachable by script, not a tab stop.
   */
  focusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * How an action shows its Jira issue (finding U-5).
 *
 * The href is built here, from the configured address and a key that passes
 * the key rule (`jiraBrowseUrl`), never read from the action: `actions` is
 * not a protected session field, so a stored URL would be a link any
 * participant could plant on the facilitator's screen (plan decision 1). A
 * value that is not a key renders nothing at all.
 *
 *  - a key and a known address: the key, as a link opening Jira in a new tab,
 *    named with the key first (WCAG 2.5.3) and saying where it goes;
 *  - a key with no known address: the plain text "Jira: KEY", never an `<a>`
 *    without href, which is no link to a screen reader and a dead one to a
 *    mouse;
 *  - an uncertain creation: "May already be in Jira".
 */
const JiraLinkBadge: React.FC<Props> = ({ link, baseUrl, focusRef, className = '' }) => {
  const { t } = useTranslation();
  const holder = { jira: link };

  if (isJiraLinked(holder)) {
    const key = (link as { key: string }).key;
    const href = jiraBrowseUrl(baseUrl, key);
    if (href) {
      return (
        <a
          ref={focusRef as React.RefObject<HTMLAnchorElement | null> | undefined}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('jira.action.openLabel', { key })}
          className={`inline-flex items-center gap-1 rounded-sm bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 hover:underline ${className}`}
        >
          {key}
          <span className="material-symbols-outlined text-xs" aria-hidden="true">open_in_new</span>
        </a>
      );
    }
    return (
      <span
        ref={focusRef as React.RefObject<HTMLSpanElement | null> | undefined}
        tabIndex={-1}
        className={`inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-700 ${className}`}
      >
        {t('jira.action.plainKey', { key })}
      </span>
    );
  }

  if (isJiraUncertain(holder)) {
    return (
      <span
        ref={focusRef as React.RefObject<HTMLSpanElement | null> | undefined}
        tabIndex={-1}
        className={`inline-flex items-center gap-1 rounded-sm bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800 ${className}`}
      >
        <span className="material-symbols-outlined text-xs" aria-hidden="true">help</span>
        {t('jira.action.uncertainBadge')}
      </span>
    );
  }

  return null;
};

export default JiraLinkBadge;
