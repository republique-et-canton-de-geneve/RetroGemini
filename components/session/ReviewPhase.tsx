import React, { useEffect, useState } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { createTranslator } from '../../i18n/translate';
import { Language, toLanguage } from '../../i18n/languages';
import { ActionItem, JiraLink, JiraStatus, RetroSession, Team, Ticket, User } from '../../types';
import { dataService } from '../../services/dataService';
import { noteRevokedResponse } from '../../services/sessionRevocation';
import { getTicketOriginColumn } from '../../utils/retroGrouping';
import { ticketQuote } from '../../utils/textCut';
import { ROTI_FOLLOW_UP_LINK_ID } from './retroConstants';
import TicketOriginBadge from './TicketOriginBadge';
import JiraActionControl from '../jira/JiraActionControl';
import JiraBatchButton from '../jira/JiraBatchButton';
import JiraDiscoveryNote from '../jira/JiraDiscoveryNote';
import JiraParentLine from '../jira/JiraParentLine';
import { mergeJiraLink, withJiraLinkFrom } from '../jira/jiraLinkMerge';
import { useJiraStatus } from '../jira/useJiraStatus';

interface ActionRowProps {
  action: ActionItem;
  /**
   * The action's Jira link as the row shows it, from whichever copy knows it
   * (jiraLinkMerge.ts). Kept apart from `action`, which the edits below send
   * to the team record: a link is written by the Jira route alone.
   */
  jiraLink?: JiraLink;
  isGlobal: boolean;
  isFacilitator: boolean;
  assignableMembers: User[];
  team: Team;
  applyActionUpdate: (actionId: string, updater: (action: ActionItem) => void, actionOverride?: ActionItem) => void;
  updateSession: (updater: (session: RetroSession) => void) => void;
  setRefreshTick: React.Dispatch<React.SetStateAction<number>>;
  currentTeam: Team;
  /** The retro's template language: the "Re: …" context is content, not chrome. */
  contentLanguage: Language;
  /** The team's Jira status, read once for the whole step (useJiraStatus). */
  jiraStatus: JiraStatus | null;
  /** The live session, which the server patches with the link too (finding A-5). */
  sessionId: string;
  /** The retrospective on screen, for the dialog the sub-task modes open. */
  session: RetroSession;
  /** Who clicked, named in the issue's description. */
  requestedBy: string;
  onJiraStatusStale: () => void;
}

const ActionRow: React.FC<ActionRowProps> = ({
  action,
  jiraLink,
  isGlobal,
  isFacilitator,
  assignableMembers,
  team,
  applyActionUpdate,
  updateSession,
  setRefreshTick,
  currentTeam,
  contentLanguage,
  jiraStatus,
  sessionId,
  session,
  requestedBy,
  onJiraStatusStale
}) => {
  const { t } = useTranslation();
  const contentT = createTranslator(contentLanguage);
  const [pendingText, setPendingText] = useState(action.text);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setPendingText(action.text);
    setConfirmingDelete(false);
  }, [action.text, action.id]);

  const canEdit = isFacilitator;

  // Action status (done/assignee/text) is owned by the granular action
  // endpoints, so persist every edit through them — for new actions too, not
  // just carried-over global ones. This keeps the team record authoritative:
  // a later full-session persist reconciles against it (see
  // dataService.updateSession) and can no longer revert the change.
  const commitTextChange = () => {
    if (!pendingText.trim() || pendingText === action.text) return;
    const newText = pendingText.trim();
    const updated = { ...action, text: newText };
    dataService.updateGlobalAction(team.id, updated);
    applyActionUpdate(action.id, (item) => {
      item.text = newText;
    }, action);
    setRefreshTick((tick) => tick + 1);
  };

  const commitAssigneeChange = (value: string | null) => {
    const updated = { ...action, assigneeId: value };
    dataService.updateGlobalAction(team.id, updated);
    applyActionUpdate(action.id, (item) => {
      item.assigneeId = value;
    }, action);
    setRefreshTick((tick) => tick + 1);
  };

  const handleDelete = () => {
    updateSession((draft) => {
      draft.actions = draft.actions.filter((item) => item.id !== action.id);
    });
    if (isGlobal) dataService.deleteAction(team.id, action.id);
  };

  let contextText = action.contextText ?? '';
  if (!contextText && !isGlobal && action.originRetro) {
    for (const retro of currentTeam.retrospectives) {
      if (action.linkedTicketId) {
        const ticket = retro.tickets.find((item) => item.id === action.linkedTicketId);
        if (ticket) {
          contextText = contentT('phases.actions.contextTicket', { text: ticketQuote(ticket.text) });
          break;
        }
        const group = retro.groups.find((item) => item.id === action.linkedTicketId);
        if (group) {
          contextText = contentT('phases.actions.contextGroup', { title: group.title });
          break;
        }
      }
    }
  }

  return (
    <div
      className={`p-4 border-b border-slate-100 last:border-0 flex items-center justify-between group hover:bg-slate-50 transition ${action.done ? 'bg-green-50/50' : ''}`}
    >
      <div className="flex items-center grow mr-4">
        <button
          disabled={!canEdit}
          onClick={() => {
            if (!canEdit) return;
            dataService.toggleGlobalAction(team.id, action.id);
            applyActionUpdate(action.id, (item) => {
              item.done = !item.done;
            }, action);
            setRefreshTick((tick) => tick + 1);
          }}
          className={`mr-3 transition ${action.done ? 'text-emerald-500 scale-110' : 'text-slate-300 hover:text-emerald-500'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
          aria-label={action.done ? t('phases.actions.markNotDone') : t('phases.actions.markDone')}
        >
          <span className="material-symbols-outlined text-2xl">
            {action.done ? 'check_circle' : 'radio_button_unchecked'}
          </span>
        </button>
        <div className="grow flex flex-col">
          <textarea
            // Fixed text, never the action: a name that followed the value
            // would change on every keystroke, and the value says which one.
            aria-label={t('phases.review.actionText')}
            value={pendingText}
            readOnly={!canEdit}
            onChange={(event) => setPendingText(event.target.value)}
            onBlur={commitTextChange}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                commitTextChange();
              }
            }}
            rows={1}
            onInput={(event) => {
              const el = event.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${el.scrollHeight}px`;
            }}
            ref={(el) => {
              if (el) {
                el.style.height = 'auto';
                el.style.height = `${el.scrollHeight}px`;
              }
            }}
            className={`w-full bg-transparent border border-transparent hover:border-slate-300 rounded-sm px-2 py-1 focus:bg-white focus:border-retro-primary outline-hidden transition font-medium resize-none overflow-hidden ${action.done ? 'line-through text-slate-500' : 'text-slate-700'} ${!canEdit ? 'cursor-not-allowed' : ''}`}
          />
          {contextText && <span className="text-xs text-indigo-600 italic mt-0.5 px-2">{contextText}</span>}
          {/* Hidden while the control renders nothing (no Jira, a closed
              action without an issue), so such a row keeps its height. */}
          <div className="mt-1 px-2 empty:hidden">
            <JiraActionControl
              action={jiraLink === action.jira ? action : { ...action, jira: jiraLink }}
              status={jiraStatus}
              teamId={team.id}
              isFacilitator={isFacilitator}
              // Previous actions too: the server patches this session's
              // history snapshot, which is where participants read the link.
              sessionId={sessionId}
              kind="retro"
              requestedBy={requestedBy}
              team={currentTeam}
              session={session}
              onCreated={() => setRefreshTick((tick) => tick + 1)}
              onStatusStale={onJiraStatusStale}
            />
          </div>
        </div>
      </div>
      <select
        aria-label={t('phases.actions.assignee', { text: action.text })}
        value={action.assigneeId || ''}
        disabled={!canEdit}
        onChange={(event) => commitAssigneeChange(event.target.value || null)}
        className={`text-xs border border-slate-200 rounded-sm p-1.5 bg-white text-slate-600 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-hidden ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <option value="">{t('phases.shared.unassigned')}</option>
        {assignableMembers.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>
      {isFacilitator && !isGlobal && (
        <div className="ml-3">
          {!confirmingDelete ? (
            <button onClick={() => setConfirmingDelete(true)} className="text-slate-300 hover:text-red-500" aria-label={t('phases.review.deleteAction')}>
              <span className="material-symbols-outlined">delete</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2 text-xs bg-white border border-slate-200 rounded-sm px-3 py-1 shadow-xs">
              <span className="text-slate-500">{t('phases.review.confirmDelete')}</span>
              <button className="text-rose-700 font-bold" onClick={handleDelete}>
                {t('common.yes')}
              </button>
              <button className="text-slate-500" onClick={() => setConfirmingDelete(false)}>
                {t('common.no')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

interface Props {
  session: RetroSession;
  team: Team;
  currentUser: User;
  isFacilitator: boolean;
  historyActionIds: string[];
  setPhase: (phase: string) => void;
  updateSession: (updater: (session: RetroSession) => void) => void;
  applyActionUpdate: (actionId: string, updater: (action: ActionItem) => void, actionOverride?: ActionItem) => void;
  buildActionContext: (action: ActionItem, team: Team) => string;
  assignableMembers: User[];
  setRefreshTick: React.Dispatch<React.SetStateAction<number>>;
  aiEnabled?: boolean;
  /**
   * Whether the session is connected. Each change reads the team's Jira
   * status again, so a reconnection after a rolling update picks up what
   * changed meanwhile (finding U-9).
   */
  isLive?: boolean;
}

const ReviewPhase: React.FC<Props> = ({
  session,
  team,
  currentUser,
  isFacilitator,
  historyActionIds,
  setPhase,
  updateSession,
  applyActionUpdate,
  buildActionContext,
  assignableMembers,
  setRefreshTick,
  aiEnabled,
  isLive = true
}) => {
  const { t } = useTranslation();
  const [aiGenerating, setAiGenerating] = useState(false);
  // Read when the step opens (it mounts on entering Review) and on every
  // connection change; never from dataService while rendering (finding T-49).
  const { status: jiraStatus, refresh: refreshJiraStatus } = useJiraStatus(team.id, { refreshKey: isLive });

  const handleGenerateSummary = async () => {
    setAiGenerating(true);
    try {
      const sentToken = dataService.getSessionToken();
      const response = await fetch('/api/ai/generate-retro-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionToken: sentToken,
          sessionData: {
            name: session.name,
            columns: session.columns,
            tickets: session.tickets,
            groups: session.groups,
            actions: session.actions,
            happiness: session.happiness,
            roti: session.roti
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.summary) {
          updateSession((draft) => {
            draft.reviewSummary = data.summary;
          });
        }
      } else {
        // Decision D3b: a password change signs the session out, which the
        // session screen then says.
        await noteRevokedResponse(response, sentToken);
      }
    } catch (err) {
      console.error('Failed to generate AI summary', err);
    } finally {
      setAiGenerating(false);
    }
  };
  const currentTeam = dataService.getTeam(team.id) || team;

  const newActions = session.actions.filter((action) => action.type === 'new' && action.text);

  // Each row's Jira link, from both copies of the action, the record's first
  // (finding A-5). For a new action, the record is this retro as the cache
  // holds it: after a creation, the browser that clicked has the keys there
  // (`applyJiraLinks`) before the server's patch of the live session reaches
  // it. For a previous action, the session's copy is the history snapshot: a
  // participant's cache never learns a key, the patched snapshot carries it.
  const recordActions = new Map(
    (currentTeam.retrospectives.find((retro) => retro.id === session.id)?.actions ?? []).map((action) => [action.id, action])
  );
  const jiraLinks = new Map<string, JiraLink | undefined>(
    newActions.map((action) => [action.id, mergeJiraLink(recordActions.get(action.id)?.jira, action.jira)])
  );
  // What the batch button counts: the new actions as their rows show them.
  const newActionsForJira = newActions.map((action) => withJiraLinkFrom(action, recordActions.get(action.id)?.jira));
  const groupedNewActions: Record<string, { title: string; isGroup: boolean; tickets: Ticket[]; items: ActionItem[] }> = {};

  newActions.forEach((action) => {
    const linkedId = action.linkedTicketId;

    if (linkedId === ROTI_FOLLOW_UP_LINK_ID) {
      const key = ROTI_FOLLOW_UP_LINK_ID;
      if (!groupedNewActions[key]) groupedNewActions[key] = { title: t('phases.review.rotiFollowUp'), isGroup: false, tickets: [], items: [] };
      groupedNewActions[key].items.push(action);
      return;
    }

    // Check if linked to a group
    const linkedGroup = session.groups.find((group) => group.id === linkedId);
    if (linkedGroup) {
      const key = `group:${linkedGroup.id}`;
      if (!groupedNewActions[key]) {
        const memberTickets = session.tickets.filter((ticket) => ticket.groupId === linkedGroup.id);
        groupedNewActions[key] = { title: linkedGroup.title || t('phases.review.untitled'), isGroup: true, tickets: memberTickets, items: [] };
      }
      groupedNewActions[key].items.push(action);
      return;
    }

    // Check if linked to a ticket that belongs to a group (action created before grouping)
    const linkedTicket = session.tickets.find((ticket) => ticket.id === linkedId);
    if (linkedTicket?.groupId) {
      const parentGroup = session.groups.find((group) => group.id === linkedTicket.groupId);
      if (parentGroup) {
        const key = `group:${parentGroup.id}`;
        if (!groupedNewActions[key]) {
          const memberTickets = session.tickets.filter((ticket) => ticket.groupId === parentGroup.id);
          groupedNewActions[key] = { title: parentGroup.title || t('phases.review.untitled'), isGroup: true, tickets: memberTickets, items: [] };
        }
        groupedNewActions[key].items.push(action);
        return;
      }
    }

    // Single ticket (not in any group)
    const title = linkedTicket?.text || t('phases.review.untitled');
    const key = `ticket:${linkedId}`;
    if (!groupedNewActions[key]) groupedNewActions[key] = { title, isGroup: false, tickets: [], items: [] };
    groupedNewActions[key].items.push(action);
  });

  // Union of the synced snapshot and the ids captured at phase entry: a
  // degenerate snapshot (e.g. a lost write race that left it with only the
  // toggled action) must never hide the other history actions of the review.
  const historySnapshotIds = (session.historyActionsSnapshot || []).map((action) => action.id);
  const actionIds = [...new Set([...historySnapshotIds, ...historyActionIds])];

  // Build a lookup from the synced session snapshot so participants see
  // real-time changes made by the facilitator (done status, assignee).
  const historySnapshotMap = new Map(
    (session.historyActionsSnapshot || []).map(a => [a.id, a])
  );

  const historySource = [
    ...currentTeam.globalActions
      .filter((action) => actionIds.includes(action.id))
      .map((action) => {
        const snapshot = historySnapshotMap.get(action.id);
        return {
          ...action,
          done: snapshot ? snapshot.done : action.done,
          assigneeId: snapshot ? snapshot.assigneeId : action.assigneeId,
          contextText: buildActionContext(action, currentTeam)
        };
      }),
    ...currentTeam.retrospectives
      .filter((retro) => retro.id !== session.id)
      .flatMap((retro) =>
        retro.actions
          .filter((action) => actionIds.includes(action.id) && action.type !== 'proposal')
          .map((action) => {
            const snapshot = historySnapshotMap.get(action.id);
            return {
              ...action,
              done: snapshot ? snapshot.done : action.done,
              assigneeId: snapshot ? snapshot.assigneeId : action.assigneeId,
              contextText: buildActionContext(action, currentTeam)
            };
          })
      )
  ];

  const uniquePrevActions = Array.from(new Map(historySource.map((item) => [item.id, item])).values());
  uniquePrevActions.forEach((action) => {
    jiraLinks.set(action.id, mergeJiraLink(action.jira, historySnapshotMap.get(action.id)?.jira));
  });

  const actionRowProps = {
    isFacilitator,
    assignableMembers,
    team,
    applyActionUpdate,
    updateSession,
    setRefreshTick,
    currentTeam,
    contentLanguage: toLanguage(session.templateLanguage, 'en'),
    jiraStatus,
    sessionId: session.id,
    session,
    requestedBy: currentUser.name,
    onJiraStatusStale: () => { void refreshJiraStatus(); }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center shrink-0 shadow-xs z-30">
        <h2 className="font-bold text-slate-700 text-lg">{t('phases.review.title')}</h2>
        {isFacilitator && (
          <button
            onClick={() => setPhase('CLOSE')}
            className="bg-retro-primary text-white px-4 py-2 rounded-sm font-bold text-sm hover:bg-retro-primaryHover"
          >
            {t('phases.review.next')}
          </button>
        )}
      </div>
      <div className="p-8 max-w-4xl mx-auto w-full space-y-8">
        <JiraDiscoveryNote status={jiraStatus} isFacilitator={isFacilitator} userId={currentUser.id} />
        <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-500 uppercase">{t('phases.review.summaryTitle')}</h3>
            {isFacilitator && aiEnabled && session.tickets?.some(t => t.text?.trim()) && (
              <button
                onClick={handleGenerateSummary}
                disabled={aiGenerating}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  aiGenerating
                    ? 'bg-slate-100 text-slate-500 cursor-not-allowed'
                    : 'bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200'
                }`}
              >
                <span className={`material-symbols-outlined text-sm ${aiGenerating ? 'animate-spin' : ''}`}>
                  {aiGenerating ? 'progress_activity' : 'smart_toy'}
                </span>
                {aiGenerating ? t('phases.review.generating') : t('phases.review.generate')}
              </button>
            )}
          </div>
          {isFacilitator ? (
            <textarea
              value={session.reviewSummary || ''}
              onChange={(event) => {
                const summary = event.target.value;
                updateSession((draft) => {
                  draft.reviewSummary = summary;
                });
              }}
              placeholder={t('phases.review.summaryPlaceholder')}
              rows={5}
              className="w-full border border-slate-300 rounded-lg p-3 text-sm outline-hidden focus:border-retro-primary bg-white text-slate-900 resize-y"
            />
          ) : (
            <div className="text-sm text-slate-700 whitespace-pre-wrap min-h-[90px] p-3 rounded-lg bg-slate-50 border border-slate-200">
              {session.reviewSummary?.trim() || t('phases.review.noSummary')}
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <h3 className="text-sm font-bold text-slate-500 uppercase">{t('phases.review.newActions')}</h3>
            {/* Its own reason line when the team cannot create yet (finding U-1). */}
            <JiraBatchButton
              actions={newActionsForJira}
              status={jiraStatus}
              teamId={team.id}
              isFacilitator={isFacilitator}
              sessionId={session.id}
              kind="retro"
              team={currentTeam}
              session={session}
              requestedBy={currentUser.name}
              onDone={() => setRefreshTick((tick) => tick + 1)}
              onStatusStale={() => { void refreshJiraStatus(); }}
            />
          </div>
          {/* The retro's parent issue (sessionParent mode), for the facilitator. */}
          <div className="mb-4 empty:hidden">
            <JiraParentLine
              link={currentTeam.jiraParents?.[`retro:${session.id}`]}
              status={jiraStatus}
              isFacilitator={isFacilitator}
              kind="retro"
              session={session}
              team={currentTeam}
            />
          </div>
          <div className="space-y-4">
            {newActions.length === 0 ? (
              <div className="p-8 text-center text-slate-500 bg-white rounded-xl border border-slate-200">
                {t('phases.review.noNewActions')}
              </div>
            ) : (
              Object.entries(groupedNewActions).map(([key, data]) => (
                <div key={key} className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex flex-col justify-start">
                    <div className="flex items-center text-sm font-bold text-slate-600">
                      <span className="material-symbols-outlined text-lg mr-2 text-indigo-500">
                        {data.isGroup ? 'layers' : 'topic'}
                      </span>
                      {data.title}
                    </div>
                    {data.isGroup && data.tickets.length > 0 && (
                      <div className="pl-7 mt-1 space-y-1">
                        {data.tickets.map((ticket) => {
                          const originColumn = getTicketOriginColumn(ticket, session.columns);
                          return (
                            <div key={ticket.id} className="text-xs text-slate-500 font-normal flex items-center gap-2 min-w-0">
                              <span className="truncate">• {ticket.text}</span>
                              {originColumn && <TicketOriginBadge column={originColumn} className="shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div>{data.items.map((action) => <ActionRow key={action.id} action={action} jiraLink={jiraLinks.get(action.id)} isGlobal={false} {...actionRowProps} />)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">{t('phases.review.previousActions')}</h3>
          <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden max-h-96 overflow-y-auto">
            {uniquePrevActions.length === 0 ? (
              <div className="p-8 text-center text-slate-500">{t('phases.review.noHistory')}</div>
            ) : (
              uniquePrevActions.map((action) => <ActionRow key={action.id} action={action} jiraLink={jiraLinks.get(action.id)} isGlobal {...actionRowProps} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewPhase;
