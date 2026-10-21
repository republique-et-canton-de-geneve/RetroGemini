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

// The issue types of one key: "project:TEAM", "parent:TEAM-7". `project` and
// `sessionParent` read the same `{ projectKey }`, so they share one source.
// Every state is kept with the key it is about, so a list, a "loading" or an
// error read for a key the facilitator has since changed is not shown as
// being about the new one. `subtasksIncluded` says the answer holds the
// project's sub-task types too, which a pod of an older release does not send.
type IssueTypes =
  | { phase: 'idle' }
  | { phase: 'loading'; source: string }
  | { phase: 'loaded'; source: string; types: JiraIssueType[]; subtasksIncluded: boolean }
  | { phase: 'error'; source: string; notice: Notice };

type Mode = JiraTargetDraft['mode'];

const keyOf = (draft: JiraTargetDraft) => (draft.mode === 'parent' ? draft.parentKey : draft.projectKey).trim();
const isValidKey = (mode: Mode, key: string) =>
  mode === 'parent' ? isJiraIssueKey(key) : isJiraProjectKey(key);
const sourceOf = (mode: Mode, key: string) => `${mode === 'parent' ? 'parent' : 'project'}:${key}`;

// The type to keep once the list of a key is read: the one chosen when the
// list has it, else the only type that fits, else none.
const typeAfterLoad = (types: JiraIssueType[], chosen: string) =>
  types.some(type => type.id === chosen) ? chosen : types.length === 1 ? types[0].id : '';

// A type without a usable id or name cannot be shown or sent back.
const usable = (types: JiraIssueType[]) =>
  types.filter(type => type && isJiraIssueTypeId(type.id) && typeof type.name === 'string');

// A project takes standard types (an epic included: project mode may create
// one); a parent issue, and every action in `sessionParent` mode, takes
// sub-task types; the parent issue created per session takes a standard type
// that can hold sub-tasks — never Cloud's epic or above (`hierarchyLevel > 0`),
// under which Cloud puts no sub-task.
const projectTypes = (types: JiraIssueType[]) => usable(types).filter(type => type.subtask !== true);
const subtaskTypes = (types: JiraIssueType[]) => usable(types).filter(type => type.subtask === true);
const parentTypes = (types: JiraIssueType[]) =>
  usable(types).filter(type => type.subtask !== true && !(typeof type.hierarchyLevel === 'number' && type.hierarchyLevel > 0));

// The types each select offers for a mode. In `sessionParent` mode a list read
// from a pod that did not include the sub-task types offers none of them.
const listsFor = (mode: Mode, loaded: { types: JiraIssueType[]; subtasksIncluded: boolean }) => {
  if (mode === 'parent') return { issueTypes: subtaskTypes(loaded.types), parentIssueTypes: [] };
  if (mode === 'sessionParent') {
    return { issueTypes: loaded.subtasksIncluded ? subtaskTypes(loaded.types) : [], parentIssueTypes: parentTypes(loaded.types) };
  }
  return { issueTypes: projectTypes(loaded.types), parentIssueTypes: [] };
};

// The draft with the types to keep once a list of its key is here, or null
// when that changes nothing.
const chooseTypes = (draft: JiraTargetDraft, loaded: { types: JiraIssueType[]; subtasksIncluded: boolean }): JiraTargetDraft | null => {
  const lists = listsFor(draft.mode, loaded);
  // No sub-task list yet (a pod of an older release): nothing to judge the
  // chosen sub-task type against, so it is kept.
  const issueTypeId = draft.mode === 'sessionParent' && !loaded.subtasksIncluded
    ? draft.issueTypeId
    : typeAfterLoad(lists.issueTypes, draft.issueTypeId);
  const parentIssueTypeId = draft.mode === 'sessionParent'
    ? typeAfterLoad(lists.parentIssueTypes, draft.parentIssueTypeId)
    : draft.parentIssueTypeId;
  return issueTypeId === draft.issueTypeId && parentIssueTypeId === draft.parentIssueTypeId
    ? null
    : { ...draft, issueTypeId, parentIssueTypeId };
};

/**
 * Where issues are created (finding U-2), for the Settings card and for the
 * batch dialog's one-time override: a project, the sub-tasks of one issue, or
 * the sub-tasks of one issue per retrospective or health check created in a
 * project (`sessionParent`); an issue type read from Jira for that key (two
 * in `sessionParent` mode: the parent issue's and the sub-tasks', from one
 * read of the project); labels.
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
 *    forgets it (both types, in `sessionParent` mode) at once, not when the
 *    new list arrives. A Save or a Create
 *    clicked straight after typing runs before that list, and would otherwise
 *    send a type the new project never offered.
 *  - "Load the issue types" (offered after a failed read) hands the keyboard
 *    to the issue-type list before it goes away with the read it starts.
 *  - Labels are typed separated by spaces or commas, and checked with the
 *    shared rule when the field is left.
 */
const MODE_LABELS = {
  project: 'jira.target.modeProject',
  parent: 'jira.target.modeParent',
  sessionParent: 'jira.target.modeSessionParent'
} as const;

const TYPE_HINTS = {
  project: 'jira.target.issueTypeHint',
  parent: 'jira.target.subtaskTypeHint',
  sessionParent: 'jira.target.subtaskTypeHintProject'
} as const;

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

  const load = useCallback(async (mode: Mode, key: string) => {
    const request = ++latestRequest.current;
    const source = sourceOf(mode, key);
    setIssueTypes({ phase: 'loading', source });
    try {
      const answer = await jiraService.getIssueTypes(teamId, mode === 'parent' ? { parentKey: key } : { projectKey: key });
      if (!mounted.current || request !== latestRequest.current) return;
      const loaded = { types: answer.issueTypes, subtasksIncluded: answer.subtasksIncluded };
      setIssueTypes({ phase: 'loaded', source, ...loaded });
      // The mode now on screen decides, when it reads the same source: a
      // switch between project and sessionParent meanwhile reads one list.
      const draft = valueRef.current;
      if (sourceOf(draft.mode, keyOf(draft)) === source) {
        const next = chooseTypes(draft, loaded);
        if (next) onChangeRef.current(next);
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
  const lists = current?.phase === 'loaded' ? listsFor(value.mode, current) : null;
  // The sub-task types a pod of an older release did not send: not a list yet.
  const subtasksMissing = value.mode === 'sessionParent' && current?.phase === 'loaded' && !current.subtasksIncluded;
  const types = lists && !subtasksMissing ? lists.issueTypes : null;
  const parentIssueTypes = lists ? lists.parentIssueTypes : null;
  const isSessionParent = value.mode === 'sessionParent';

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
      const next = chooseTypes(value, current);
      if (next) onChange(next);
    }
  };

  const changeMode = (mode: Mode) => {
    if (mode === value.mode) return;
    const next = { ...value, mode, issueTypeId: '', parentIssueTypeId: '' };
    onChange(next);
    setKeyError(null);
    const otherKey = keyOf(next);
    if (isValidKey(mode, otherKey)) void load(mode, otherKey);
  };

  const ids = {
    modeLabel: `${idPrefix}-mode-label`,
    key: `${idPrefix}-key`,
    keyError: `${idPrefix}-key-error`,
    modeHint: `${idPrefix}-mode-hint`,
    type: `${idPrefix}-issue-type`,
    typeHint: `${idPrefix}-issue-type-hint`,
    parentType: `${idPrefix}-parent-issue-type`,
    parentTypeHint: `${idPrefix}-parent-issue-type-hint`,
    typeStatus: `${idPrefix}-issue-type-status`,
    labels: `${idPrefix}-labels`,
    labelsHint: `${idPrefix}-labels-hint`,
    labelsError: `${idPrefix}-labels-error`
  };

  let typeStatus = '';
  if (current?.phase === 'loading') typeStatus = t('jira.target.loadingTypes');
  else if (current?.phase === 'error') typeStatus = noticeText(current.notice, t);
  else if (subtasksMissing) typeStatus = t('jira.target.subtaskTypesUnavailable');
  else if (isSessionParent && parentIssueTypes && parentIssueTypes.length === 0) typeStatus = t('jira.target.noTypes');
  else if (isSessionParent && types && types.length === 0) typeStatus = t('jira.target.noSubtaskTypes');
  else if (types && types.length === 0) typeStatus = t('jira.target.noTypes');

  const keyField = value.mode === 'parent' ? 'parentKey' : 'projectKey';
  const inputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 aria-invalid:border-red-500';
  // A stored type stays selectable (by its id) until the list of its key is
  // read; a change of key has already forgotten it. Each select on its own.
  const keepStoredType = !!value.issueTypeId && !types?.some(type => type.id === value.issueTypeId);
  const keepStoredParentType = !!value.parentIssueTypeId && !parentIssueTypes?.some(type => type.id === value.parentIssueTypeId);
  const statusClass = current?.phase === 'error' ? 'text-xs text-red-700' : 'text-xs text-slate-600';

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-labelledby={ids.modeLabel} className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span id={ids.modeLabel} className="text-sm font-medium text-slate-700">{t('jira.target.mode')}</span>
        {(['project', 'parent', 'sessionParent'] as const).map(mode => (
          <label key={mode} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              value={mode}
              checked={value.mode === mode}
              onChange={() => changeMode(mode)}
              // The hint exists only while its mode is chosen.
              aria-describedby={mode === 'sessionParent' && isSessionParent ? ids.modeHint : undefined}
            />
            {t(MODE_LABELS[mode])}
          </label>
        ))}
      </div>
      {isSessionParent && (
        <p id={ids.modeHint} className="-mt-2 text-xs text-slate-600">{t('jira.target.modeSessionParentHint')}</p>
      )}

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
            const sameKey = next.trim() === key;
            onChange({
              ...value,
              [keyField]: next,
              issueTypeId: sameKey ? value.issueTypeId : '',
              parentIssueTypeId: sameKey ? value.parentIssueTypeId : ''
            });
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

      {isSessionParent && (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.parentType} className="text-sm font-medium text-slate-700">{t('jira.target.parentIssueType')}</label>
          <select
            id={ids.parentType}
            value={value.parentIssueTypeId}
            onChange={(e) => onChange({ ...value, parentIssueTypeId: e.target.value })}
            aria-describedby={`${ids.parentTypeHint} ${ids.typeStatus}`}
            className={`min-w-0 ${inputClass}`}
          >
            <option value="">{t('jira.target.chooseType')}</option>
            {keepStoredParentType && <option value={value.parentIssueTypeId}>{value.parentIssueTypeId}</option>}
            {parentIssueTypes?.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}
          </select>
          <p id={ids.parentTypeHint} className="text-xs text-slate-600">{t('jira.target.parentIssueTypeHint')}</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.type} className="text-sm font-medium text-slate-700">
          {t(isSessionParent ? 'jira.target.subtaskType' : 'jira.target.issueType')}
        </label>
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
          {t(TYPE_HINTS[value.mode])}
        </p>
        <p id={ids.typeStatus} role="status" className={statusClass}>
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
