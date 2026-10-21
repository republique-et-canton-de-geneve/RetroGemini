import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { JiraIssueType } from '../../types';
import { isJiraIssueKey, isJiraIssueTypeId, isJiraProjectKey } from '../../utils/jira.js';
import { jiraService } from '../../services/jiraService';
import { useTranslation } from '../../i18n/I18nContext';
import { noticeFromError, noticeText, type Notice } from '../../i18n/notice';
import { labelsFromText, type JiraTargetDraft } from './jiraTargetDraft';

interface Props {
  teamId: string;
  value: JiraTargetDraft;
  onChange: (draft: JiraTargetDraft) => void;
  /** Keeps the ids of two forms on one page apart (Settings and the batch dialog). */
  idPrefix: string;
}

// The issue types of one key in one mode: "project:TEAM", "parent:TEAM-7".
// Every state is kept with the key it is about, so a list, a "loading" or an
// error read for a key the facilitator has since changed is not shown as
// being about the new one.
type IssueTypes =
  | { phase: 'idle' }
  | { phase: 'loading'; source: string }
  | { phase: 'loaded'; source: string; types: JiraIssueType[] }
  | { phase: 'error'; source: string; notice: Notice };

const keyOf = (draft: JiraTargetDraft) => (draft.mode === 'parent' ? draft.parentKey : draft.projectKey).trim();
const isValidKey = (mode: JiraTargetDraft['mode'], key: string) =>
  mode === 'parent' ? isJiraIssueKey(key) : isJiraProjectKey(key);
const sourceOf = (mode: JiraTargetDraft['mode'], key: string) => `${mode}:${key}`;

// The type to keep once the list of a key is read: the one chosen when the
// list has it, else the only type that fits, else none.
const typeAfterLoad = (types: JiraIssueType[], chosen: string) =>
  types.some(type => type.id === chosen) ? chosen : types.length === 1 ? types[0].id : '';

// The types a target of this mode can use: a project takes standard types,
// a parent issue takes sub-task types (and the server already sends only
// those). A type without a usable id cannot be sent back.
const fitting = (types: JiraIssueType[], mode: JiraTargetDraft['mode']) =>
  types.filter(type =>
    type && isJiraIssueTypeId(type.id) && typeof type.name === 'string' && (mode === 'parent' ? type.subtask === true : type.subtask !== true));

/**
 * Where issues are created (finding U-2), for the Settings card and for the
 * batch dialog's one-time override: a project, or the sub-tasks of one issue;
 * an issue type read from Jira for that key; labels.
 *
 * Controlled: the caller holds the draft and builds the target from it with
 * `targetFromDraft`, the shared rule, when it saves or sends.
 *
 *  - The mode is a radio group with a name, so a screen reader announces
 *    "Create as" on entering it.
 *  - Keys are written in capitals as typed, as Jira writes them, and checked
 *    when the field is left; a malformed key is said beside the field and
 *    never sent to Jira.
 *  - The issue types are read through `/jira/issue-types` when a valid key is
 *    left (on mount too, for a stored target), so the list is the project's
 *    real one, read with the team's token. Loading, "none here" and Jira's
 *    refusal are said in a status line tied to the select. An answer for a
 *    key no longer typed is dropped. When exactly one type fits, it is chosen.
 *  - A type belongs to the key it was read for: changing the key or the mode
 *    forgets it at once, not when the new list arrives. A Save or a Create
 *    clicked straight after typing runs before that list, and would otherwise
 *    send a type the new project never offered.
 *  - "Load the issue types" (offered after a failed read) hands the keyboard
 *    to the issue-type list before it goes away with the read it starts.
 *  - Labels are typed separated by spaces or commas, and checked with the
 *    shared rule when the field is left.
 */
const JiraTargetFields: React.FC<Props> = ({ teamId, value, onChange, idPrefix }) => {
  const { t } = useTranslation();
  const [issueTypes, setIssueTypes] = useState<IssueTypes>({ phase: 'idle' });
  const [keyError, setKeyError] = useState<Notice>(null);
  const [labelsError, setLabelsError] = useState<Notice>(null);
  // Read by the answer of a request, which must not act on the draft and the
  // callback of the render that sent it.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const latestRequest = useRef(0);
  const mounted = useRef(true);
  const typeSelect = useRef<HTMLSelectElement>(null);
  const loadedOnMount = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const load = useCallback(async (mode: JiraTargetDraft['mode'], key: string) => {
    const request = ++latestRequest.current;
    const source = sourceOf(mode, key);
    setIssueTypes({ phase: 'loading', source });
    try {
      const answer = await jiraService.getIssueTypes(teamId, mode === 'parent' ? { parentKey: key } : { projectKey: key });
      if (!mounted.current || request !== latestRequest.current) return;
      const types = fitting(answer.issueTypes, mode);
      setIssueTypes({ phase: 'loaded', source, types });
      const draft = valueRef.current;
      if (draft.mode === mode && keyOf(draft) === key) {
        const chosen = typeAfterLoad(types, draft.issueTypeId);
        if (chosen !== draft.issueTypeId) onChangeRef.current({ ...draft, issueTypeId: chosen });
      }
    } catch (err) {
      if (!mounted.current || request !== latestRequest.current) return;
      setIssueTypes({ phase: 'error', source, notice: noticeFromError(err, { raw: 'unknown_error' }) });
    }
  }, [teamId]);

  // A stored target shows its type by name as soon as the form opens.
  useEffect(() => {
    if (loadedOnMount.current) return;
    loadedOnMount.current = true;
    const key = keyOf(value);
    if (isValidKey(value.mode, key)) void load(value.mode, key);
  }, [load, value]);

  const key = keyOf(value);
  const source = sourceOf(value.mode, key);
  const keyIsValid = isValidKey(value.mode, key);
  const current = issueTypes.phase !== 'idle' && issueTypes.source === source ? issueTypes : null;
  const types = current?.phase === 'loaded' ? current.types : null;

  const commitKey = () => {
    if (!key) {
      setKeyError(null);
      return;
    }
    if (!keyIsValid) {
      setKeyError({ key: value.mode === 'parent' ? 'jira.target.parentKeyInvalid' : 'jira.target.projectKeyInvalid' });
      return;
    }
    setKeyError(null);
    if (!current || current.phase === 'error') {
      void load(value.mode, key);
      return;
    }
    // Back to a key whose list is already here (typed away and back without
    // leaving the field): its type was forgotten on the way, choose again.
    if (current.phase === 'loaded') {
      const chosen = typeAfterLoad(current.types, value.issueTypeId);
      if (chosen !== value.issueTypeId) onChange({ ...value, issueTypeId: chosen });
    }
  };

  const changeMode = (mode: JiraTargetDraft['mode']) => {
    if (mode === value.mode) return;
    const next = { ...value, mode, issueTypeId: '' };
    onChange(next);
    setKeyError(null);
    const otherKey = keyOf(next);
    if (isValidKey(mode, otherKey)) void load(mode, otherKey);
  };

  const ids = {
    modeLabel: `${idPrefix}-mode-label`,
    key: `${idPrefix}-key`,
    keyError: `${idPrefix}-key-error`,
    type: `${idPrefix}-issue-type`,
    typeHint: `${idPrefix}-issue-type-hint`,
    typeStatus: `${idPrefix}-issue-type-status`,
    labels: `${idPrefix}-labels`,
    labelsHint: `${idPrefix}-labels-hint`,
    labelsError: `${idPrefix}-labels-error`
  };

  let typeStatus = '';
  if (current?.phase === 'loading') typeStatus = t('jira.target.loadingTypes');
  else if (current?.phase === 'error') typeStatus = noticeText(current.notice, t);
  else if (types && types.length === 0) typeStatus = t('jira.target.noTypes');

  const keyField = value.mode === 'parent' ? 'parentKey' : 'projectKey';
  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 aria-invalid:border-red-500';
  // A stored type stays selectable (by its id) until the list of its key is
  // read; a change of key has already forgotten it.
  const keepStoredType = !!value.issueTypeId && !types?.some(type => type.id === value.issueTypeId);

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-labelledby={ids.modeLabel} className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span id={ids.modeLabel} className="text-sm font-medium text-slate-700">{t('jira.target.mode')}</span>
        {(['project', 'parent'] as const).map(mode => (
          <label key={mode} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              value={mode}
              checked={value.mode === mode}
              onChange={() => changeMode(mode)}
            />
            {t(mode === 'project' ? 'jira.target.modeProject' : 'jira.target.modeParent')}
          </label>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.key} className="text-sm font-medium text-slate-700">
          {t(value.mode === 'parent' ? 'jira.target.parentKey' : 'jira.target.projectKey')}
        </label>
        <input
          // Remounted with the mode, so the two fields never share a draft.
          key={value.mode}
          id={ids.key}
          type="text"
          value={value[keyField]}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={t(value.mode === 'parent' ? 'jira.target.parentKeyPlaceholder' : 'jira.target.projectKeyPlaceholder')}
          aria-invalid={keyError ? true : undefined}
          aria-describedby={keyError ? ids.keyError : undefined}
          onChange={(e) => {
            const next = e.target.value.toUpperCase();
            onChange({ ...value, [keyField]: next, issueTypeId: next.trim() === key ? value.issueTypeId : '' });
            setKeyError(null);
          }}
          onBlur={commitKey}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitKey();
            }
          }}
          className={inputClass}
        />
        {keyError && <p id={ids.keyError} className="text-xs text-red-700">{noticeText(keyError, t)}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.type} className="text-sm font-medium text-slate-700">{t('jira.target.issueType')}</label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            ref={typeSelect}
            id={ids.type}
            value={value.issueTypeId}
            onChange={(e) => onChange({ ...value, issueTypeId: e.target.value })}
            aria-describedby={`${ids.typeHint} ${ids.typeStatus}`}
            className={`min-w-0 flex-1 ${inputClass}`}
          >
            <option value="">{t('jira.target.chooseType')}</option>
            {keepStoredType && <option value={value.issueTypeId}>{value.issueTypeId}</option>}
            {types?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
          {keyIsValid && current?.phase !== 'loading' && !types && (
            <button
              type="button"
              onClick={() => {
                // This button goes while the list loads and stays gone once
                // it is in: the keyboard goes to the list it asked for, whose
                // status line says what happens (and the button is back, one
                // Tab away, if the read fails again).
                typeSelect.current?.focus();
                void load(value.mode, key);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {t('jira.target.loadTypes')}
            </button>
          )}
        </div>
        <p id={ids.typeHint} className="text-xs text-slate-600">
          {t(value.mode === 'parent' ? 'jira.target.subtaskTypeHint' : 'jira.target.issueTypeHint')}
        </p>
        <p id={ids.typeStatus} role="status" className={current?.phase === 'error' ? 'text-xs text-red-700' : 'text-xs text-slate-600'}>
          {typeStatus}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.labels} className="text-sm font-medium text-slate-700">{t('jira.target.labels')}</label>
        <input
          id={ids.labels}
          type="text"
          value={value.labels}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={labelsError ? true : undefined}
          aria-describedby={labelsError ? `${ids.labelsError} ${ids.labelsHint}` : ids.labelsHint}
          onChange={(e) => {
            onChange({ ...value, labels: e.target.value });
            setLabelsError(null);
          }}
          onBlur={() => setLabelsError(labelsFromText(value.labels) ? null : { key: 'jira.target.labelsInvalid' })}
          className={inputClass}
        />
        <p id={ids.labelsHint} className="text-xs text-slate-600">{t('jira.target.labelsHint')}</p>
        {labelsError && <p id={ids.labelsError} className="text-xs text-red-700">{noticeText(labelsError, t)}</p>}
      </div>
    </div>
  );
};

export default JiraTargetFields;
