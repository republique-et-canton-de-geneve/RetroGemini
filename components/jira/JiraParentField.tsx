import React, { useEffect, useRef, useState } from 'react';
import type { JiraIssueType } from '../../types';
import { isJiraIssueKey, isJiraIssueTypeId } from '../../utils/jira.js';
import { isJiraParentChecked, type JiraParentFieldValue } from './jiraParentDraft';
import { jiraService } from '../../services/jiraService';
import { useTranslation } from '../../i18n/I18nContext';
import { noticeFromError, noticeText, type Notice } from '../../i18n/notice';
import JiraLinkBadge from './JiraLinkBadge';

/** Whether the send needs a sub-task type chosen in the parent's project. */
const needsTypeChoice = (value: JiraParentFieldValue, targetIssueTypeId: string): boolean =>
  isJiraParentChecked(value) && !!value.checked && !value.checked.subtaskTypes.some(type => type.id === targetIssueTypeId);

const subtaskTypesOf = (types: JiraIssueType[]) =>
  types.filter(type => type && isJiraIssueTypeId(type.id) && typeof type.name === 'string' && type.subtask === true);

type Check =
  | { phase: 'idle' }
  | { phase: 'checking'; key: string }
  | { phase: 'error'; key: string; notice: Notice };

interface Props {
  teamId: string;
  /** Keeps the ids of this field apart from the target form's in the same dialog. */
  idPrefix: string;
  /** The mode of the target the dialog shows: the field says what the issue named here does. */
  mode: 'parent' | 'sessionParent';
  /** In `parent` mode: the parent issue the shown target uses when the field is empty. */
  targetParentKey?: string;
  /** The shown target's type for each action, kept when the named parent's project offers it. */
  targetIssueTypeId: string;
  value: JiraParentFieldValue;
  onChange: (value: JiraParentFieldValue) => void;
  /** Why Create did not send, said on the element to fix: the key, or the sub-task type. */
  sendError: { notice: Notice; on: 'key' | 'type' } | null;
  onSendErrorClear: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  typeSelectRef: React.RefObject<HTMLSelectElement | null>;
  /**
   * `sessionParent` mode, when some session of the send already has a parent
   * issue: the box that makes the issue named here replace it, with those
   * sessions and their current parents listed under it.
   */
  replace?: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    sessions: { scope: string; label: string; key: string }[];
    baseUrl: string | null | undefined;
  } | null;
}

/**
 * "Parent issue (optional)" in the batch dialog, in both sub-task modes
 * (design F2 §4.2). Empty, the send uses the target the dialog shows. Filled,
 * every action of the send goes under the issue named here: in `parent` mode
 * for this creation only; in `sessionParent` mode it also becomes the parent
 * issue of each retrospective or health check of the send that has none yet,
 * once Jira has created a sub-task of it there — or replaces the one they have,
 * with the box below ticked.
 *
 *  - The key is written in capitals as typed and checked when the field is
 *    left or Enter is pressed: its pattern first (said on the field, never
 *    sent), then with Jira through `/jira/issue-types` — the parent check of
 *    the target form, which refuses a sub-task or an epic. Its answer, or the
 *    reason, is said in a status line tied to the field; an answer for a key
 *    no longer typed is dropped.
 *  - When the parent's project does not offer the target's sub-task type
 *    (another project, another scheme), a required "Sub-task type in …" list
 *    appears, the only fitting type chosen for the facilitator.
 *  - Create does not send an unchecked key or one without a type: the dialog
 *    says why on the element to fix and moves the keyboard there.
 */
const JiraParentField: React.FC<Props> = ({
  teamId,
  idPrefix,
  mode,
  targetParentKey,
  targetIssueTypeId,
  value,
  onChange,
  sendError,
  onSendErrorClear,
  inputRef,
  typeSelectRef,
  replace
}) => {
  const { t } = useTranslation();
  const [check, setCheck] = useState<Check>({ phase: 'idle' });
  const [keyError, setKeyError] = useState<Notice>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const targetTypeRef = useRef(targetIssueTypeId);
  targetTypeRef.current = targetIssueTypeId;
  const latestRequest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const ids = {
    input: `${idPrefix}-key`,
    hint: `${idPrefix}-hint`,
    status: `${idPrefix}-status`,
    error: `${idPrefix}-error`,
    type: `${idPrefix}-subtask-type`,
    typeError: `${idPrefix}-subtask-type-error`,
    replace: `${idPrefix}-replace`,
    replaceList: `${idPrefix}-replace-list`
  };

  const typed = value.key.trim();

  const runCheck = async (key: string) => {
    const request = ++latestRequest.current;
    setCheck({ phase: 'checking', key });
    try {
      const answer = await jiraService.getIssueTypes(teamId, { parentKey: key });
      if (!mounted.current || request !== latestRequest.current) return;
      const current = valueRef.current;
      if (current.key.trim() !== key) return;
      const subtaskTypes = subtaskTypesOf(answer.issueTypes);
      const keepChosen = subtaskTypes.some(type => type.id === current.subtaskTypeId);
      const subtaskTypeId = keepChosen ? current.subtaskTypeId : subtaskTypes.length === 1 ? subtaskTypes[0].id : '';
      setCheck({ phase: 'idle' });
      onChangeRef.current({ ...current, checked: { key, projectKey: answer.projectKey, subtaskTypes }, subtaskTypeId });
    } catch (err) {
      if (!mounted.current || request !== latestRequest.current) return;
      setCheck({ phase: 'error', key, notice: noticeFromError(err, { raw: 'unknown_error' }) });
    }
  };

  const commit = () => {
    if (!typed) {
      setKeyError(null);
      setCheck({ phase: 'idle' });
      latestRequest.current += 1;
      return;
    }
    if (!isJiraIssueKey(typed)) {
      setKeyError({ key: 'jira.target.parentKeyInvalid' });
      return;
    }
    setKeyError(null);
    if (isJiraParentChecked(value)) return;
    if (check.phase === 'checking' && check.key === typed) return;
    onSendErrorClear();
    void runCheck(typed);
  };

  const checkedHere = isJiraParentChecked(value) && value.checked ? value.checked : null;
  const shownCheck = check.phase !== 'idle' && check.key === typed ? check : null;
  let status = '';
  if (shownCheck?.phase === 'checking') status = t('jira.batch.parent.checking', { key: typed });
  else if (shownCheck?.phase === 'error') status = noticeText(shownCheck.notice, t);
  else if (checkedHere) {
    status = t('jira.batch.parent.checked', { key: checkedHere.key, project: checkedHere.projectKey });
    if (checkedHere.subtaskTypes.length === 0) status = `${status} ${t('jira.target.noSubtaskTypes')}`;
  }

  const fieldError = keyError ?? (sendError?.on === 'key' ? sendError.notice : null);
  const typeError = sendError?.on === 'type' ? sendError.notice : null;
  const choosingType = needsTypeChoice(value, targetIssueTypeId) && !!checkedHere && checkedHere.subtaskTypes.length > 0;
  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 aria-invalid:border-red-500';
  const describedBy = [fieldError ? ids.error : null, ids.hint, ids.status].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.input} className="text-sm font-medium text-slate-700">{t('jira.batch.parent.label')}</label>
        <input
          ref={inputRef}
          id={ids.input}
          type="text"
          value={value.key}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={t('jira.target.parentKeyPlaceholder')}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            onChange({ ...value, key: e.target.value.toUpperCase() });
            setKeyError(null);
            onSendErrorClear();
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          className={inputClass}
        />
        {fieldError && <p id={ids.error} className="text-xs text-red-700">{noticeText(fieldError, t)}</p>}
        <p id={ids.hint} className="text-xs text-slate-600">
          {mode === 'parent'
            ? t('jira.batch.parent.hintParentMode', { parent: targetParentKey ?? '' })
            : t('jira.batch.parent.hintSessionParent')}
        </p>
        <p id={ids.status} role="status" className={shownCheck?.phase === 'error' ? 'text-xs text-red-700' : 'text-xs text-slate-600'}>
          {status}
        </p>
      </div>

      {choosingType && checkedHere && (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.type} className="text-sm font-medium text-slate-700">
            {t('jira.batch.parent.subtaskType', { project: checkedHere.projectKey })}
          </label>
          <select
            ref={typeSelectRef}
            id={ids.type}
            required
            value={value.subtaskTypeId}
            onChange={(e) => {
              onChange({ ...value, subtaskTypeId: e.target.value });
              onSendErrorClear();
            }}
            aria-invalid={typeError ? true : undefined}
            aria-describedby={typeError ? `${ids.typeError} ${ids.status}` : ids.status}
            className={inputClass}
          >
            <option value="">{t('jira.target.chooseType')}</option>
            {checkedHere.subtaskTypes.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
          {typeError && <p id={ids.typeError} className="text-xs text-red-700">{noticeText(typeError, t)}</p>}
        </div>
      )}

      {replace && isJiraIssueKey(typed) && replace.sessions.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="inline-flex items-start gap-2 text-sm text-slate-700">
            <input
              id={ids.replace}
              type="checkbox"
              className="mt-0.5"
              checked={replace.checked}
              onChange={(e) => replace.onChange(e.target.checked)}
              aria-describedby={ids.replaceList}
            />
            <span>{t('jira.batch.parent.replace', { key: typed })}</span>
          </label>
          <ul id={ids.replaceList} className="flex flex-col gap-1 pl-6 text-xs text-slate-700">
            {replace.sessions.map(session => (
              <li key={session.scope} className="flex flex-wrap items-center gap-2">
                <span>{session.label}</span>
                <JiraLinkBadge link={{ key: session.key, createdAt: '' }} baseUrl={replace.baseUrl} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default JiraParentField;
