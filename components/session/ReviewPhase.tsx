import React, { useEffect, useState } from 'react';
import { ActionItem, RetroSession, Team, User } from '../../types';
import { dataService } from '../../services/dataService';

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
  setRefreshTick
}) => {
  const newActions = session.actions.filter((action) => action.type === 'new' && action.text);
  const groupedNewActions: Record<string, { title: string; tickets: any[]; items: ActionItem[] }> = {};

  newActions.forEach((action) => {
    const linkedTickets = session.tickets.filter((ticket) => ticket.id === action.linkedTicketId);
    const title = linkedTickets[0]?.text || 'Untitled';

    if (!groupedNewActions[title]) groupedNewActions[title] = { title, tickets: linkedTickets, items: [] };
    groupedNewActions[title].items.push(action);
  });

  const currentTeam = dataService.getTeam(team.id) || team;

  const actionIds = session.historyActionsSnapshot?.length
    ? session.historyActionsSnapshot.map((action) => action.id)
    : historyActionIds;

  const historySource = [
    ...currentTeam.globalActions
      .filter((action) => actionIds.includes(action.id))
      .map((action) => ({ ...action, contextText: buildActionContext(action, currentTeam) })),
    ...currentTeam.retrospectives
      .filter((retro) => retro.id !== session.id)
      .flatMap((retro) =>
        retro.actions
          .filter((action) => actionIds.includes(action.id) && action.type !== 'proposal')
          .map((action) => ({ ...action, contextText: buildActionContext(action, currentTeam) }))
      )
  ];

  const uniquePrevActions = Array.from(new Map(historySource.map((item) => [item.id, item])).values());

  const ActionRow: React.FC<{ action: ActionItem; isGlobal: boolean }> = ({ action, isGlobal }) => {
    const [pendingText, setPendingText] = useState(action.text);
    const [confirmingDelete, setConfirmingDelete] = useState(false);

    useEffect(() => {
      setPendingText(action.text);
      setConfirmingDelete(false);
    }, [action.text, action.id]);

    const canEdit = isFacilitator;

    const commitTextChange = () => {
      if (!pendingText.trim() || pendingText === action.text) return;
      const newText = pendingText.trim();
      const updated = { ...action, text: newText };
      if (isGlobal) dataService.updateGlobalAction(team.id, updated);
      applyActionUpdate(action.id, (item) => {
        item.text = newText;
      }, action);
      setRefreshTick((tick) => tick + 1);
    };

    const commitAssigneeChange = (value: string | null) => {
      const updated = { ...action, assigneeId: value };
      if (isGlobal) dataService.updateGlobalAction(team.id, updated);
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
            contextText = `Re: "${ticket.text.substring(0, 50)}${ticket.text.length > 50 ? '...' : ''}"`;
            break;
          }
          const group = retro.groups.find((item) => item.id === action.linkedTicketId);
          if (group) {
            contextText = `Re: Group "${group.title}"`;
            break;
          }
        }
      }
    }

    return (
      <div
        className={`p-4 border-b border-slate-100 last:border-0 flex items-center justify-between group hover:bg-slate-50 transition ${action.done ? 'bg-green-50/50' : ''}`}
      >
        <div className="flex items-center flex-grow mr-4">
          <button
            disabled={!canEdit}
            onClick={() => {
              if (!canEdit) return;
              if (isGlobal) dataService.toggleGlobalAction(team.id, action.id);
              applyActionUpdate(action.id, (item) => {
                item.done = !item.done;
              }, action);
              setRefreshTick((tick) => tick + 1);
            }}
            className={`mr-3 transition ${action.done ? 'text-emerald-500 scale-110' : 'text-slate-300 hover:text-emerald-500'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <span className="material-symbols-outlined text-2xl">
              {action.done ? 'check_circle' : 'radio_button_unchecked'}
            </span>
          </button>
          <div className="flex-grow flex flex-col">
            <input
              value={pendingText}
              readOnly={!canEdit}
              onChange={(event) => setPendingText(event.target.value)}
              onBlur={commitTextChange}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTextChange();
                }
              }}
              className={`w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-2 py-1 focus:bg-white focus:border-retro-primary outline-none transition font-medium ${action.done ? 'line-through text-slate-400' : 'text-slate-700'} ${!canEdit ? 'cursor-not-allowed' : ''}`}
            />
            {contextText && <span className="text-xs text-indigo-400 italic mt-0.5 px-2">{contextText}</span>}
          </div>
        </div>
        <select
          value={action.assigneeId || ''}
          disabled={!canEdit}
          onChange={(event) => commitAssigneeChange(event.target.value || null)}
          className={`text-xs border border-slate-200 rounded p-1.5 bg-white text-slate-600 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-none ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <option value="">Unassigned</option>
          {assignableMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        {isFacilitator && !isGlobal && (
          <div className="ml-3">
            {!confirmingDelete ? (
              <button onClick={() => setConfirmingDelete(true)} className="text-slate-300 hover:text-red-500">
                <span className="material-symbols-outlined">delete</span>
              </button>
            ) : (
              <div className="flex items-center space-x-2 text-xs bg-white border border-slate-200 rounded px-3 py-1 shadow-sm">
                <span className="text-slate-500">Confirm?</span>
                <button className="text-rose-600 font-bold" onClick={handleDelete}>
                  Yes
                </button>
                <button className="text-slate-400" onClick={() => setConfirmingDelete(false)}>
                  No
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center shrink-0 shadow-sm z-30">
        <span className="font-bold text-slate-700 text-lg">Review Actions</span>
        {isFacilitator && (
          <button
            onClick={() => setPhase('CLOSE')}
            className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover"
          >
            Next: Close Retro
          </button>
        )}
      </div>
      <div className="p-8 max-w-4xl mx-auto w-full space-y-8">
        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">New Actions from this Session</h3>
          <div className="space-y-4">
            {newActions.length === 0 ? (
              <div className="p-8 text-center text-slate-400 bg-white rounded-xl border border-slate-200">
                No new actions created.
              </div>
            ) : (
              Object.entries(groupedNewActions).map(([key, data]) => (
                <div key={key} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex flex-col justify-start">
                    <div className="flex items-center text-sm font-bold text-slate-600">
                      <span className="material-symbols-outlined text-lg mr-2 text-indigo-500">topic</span>
                      {data.title}
                    </div>
                    {data.tickets.length > 0 && (
                      <div className="pl-7 mt-1 space-y-1">
                        {data.tickets.map((ticket) => (
                          <div key={ticket.id} className="text-xs text-slate-400 font-normal truncate">
                            • {ticket.text}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>{data.items.map((action) => <ActionRow key={action.id} action={action} isGlobal={false} />)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">All Previous Actions (Unfinished)</h3>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-h-96 overflow-y-auto">
            {uniquePrevActions.length === 0 ? (
              <div className="p-8 text-center text-slate-400">No history found.</div>
            ) : (
              uniquePrevActions.map((action) => <ActionRow key={action.id} action={action} isGlobal />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReviewPhase;
