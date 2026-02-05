import React from 'react';
import { ActionItem, RetroSession, Team, User } from '../../types';
import { dataService } from '../../services/dataService';

interface Props {
  team: Team;
  session: RetroSession;
  isFacilitator: boolean;
  reviewActionIds: string[];
  setPhase: (phase: string) => void;
  applyActionUpdate: (actionId: string, updater: (action: ActionItem) => void, actionOverride?: ActionItem) => void;
  assignableMembers: User[];
  buildActionContext: (action: ActionItem, team: Team) => string;
  setRefreshTick: React.Dispatch<React.SetStateAction<number>>;
}

const OpenActionsPhase: React.FC<Props> = ({
  team,
  session,
  isFacilitator,
  reviewActionIds,
  setPhase,
  applyActionUpdate,
  assignableMembers,
  buildActionContext,
  setRefreshTick
}) => {
  const currentTeam = dataService.getTeam(team.id) || team;

  const actionIds = session.openActionsSnapshot?.length
    ? session.openActionsSnapshot.map((action) => action.id)
    : reviewActionIds;

  const actionsFromTeam = [
    ...currentTeam.globalActions.filter((action) => actionIds.includes(action.id)),
    ...currentTeam.retrospectives.flatMap((retro) =>
      retro.actions.filter((action) => actionIds.includes(action.id) && action.type !== 'proposal')
    )
  ].map((action) => ({ ...action, contextText: buildActionContext(action, currentTeam) }));

  const uniqueActions = Array.from(new Map(actionsFromTeam.map((item) => [item.id, item])).values());

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center shrink-0">
        <span className="font-bold text-slate-700 text-lg">Review Open Actions</span>
        {isFacilitator && (
          <button
            onClick={() => setPhase('BRAINSTORM')}
            className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover"
          >
            Next Phase
          </button>
        )}
      </div>
      <div className="p-8 max-w-4xl mx-auto w-full">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {uniqueActions.length === 0 ? (
            <div className="p-8 text-center text-slate-400">No open actions from previous sprints.</div>
          ) : (
            uniqueActions.map((action) => {
              let contextText = '';
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

              return (
                <div
                  key={action.id}
                  className={`p-4 border-b border-slate-100 last:border-0 flex items-center justify-between group hover:bg-slate-50 ${action.done ? 'bg-green-50/50' : ''}`}
                >
                  <div className="flex items-center flex-grow mr-4">
                    <button
                      disabled={!isFacilitator}
                      onClick={() => {
                        if (!isFacilitator) return;
                        dataService.toggleGlobalAction(team.id, action.id);
                        applyActionUpdate(action.id, (item) => {
                          item.done = !item.done;
                        }, action);
                        setRefreshTick((tick) => tick + 1);
                      }}
                      className={`mr-3 transition ${action.done ? 'text-emerald-500 scale-110' : 'text-slate-300 hover:text-emerald-500'} ${!isFacilitator ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      <span className="material-symbols-outlined text-2xl">
                        {action.done ? 'check_circle' : 'radio_button_unchecked'}
                      </span>
                    </button>
                    <div className="flex flex-col">
                      <span
                        className={`font-medium transition-all ${action.done ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-slate-700'}`}
                      >
                        {action.text}
                      </span>
                      {contextText && <span className="text-xs text-indigo-400 italic mt-0.5">{contextText}</span>}
                    </div>
                  </div>
                  <select
                    value={action.assigneeId || ''}
                    disabled={!isFacilitator}
                    onChange={(event) => {
                      const updated = { ...action, assigneeId: event.target.value || null };
                      dataService.updateGlobalAction(team.id, updated);
                      applyActionUpdate(action.id, (item) => {
                        item.assigneeId = updated.assigneeId;
                      }, action);
                      setRefreshTick((tick) => tick + 1);
                    }}
                    className={`text-xs border border-slate-200 rounded p-1 bg-white text-slate-900 ${!isFacilitator ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <option value="">Unassigned</option>
                    {assignableMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default OpenActionsPhase;
