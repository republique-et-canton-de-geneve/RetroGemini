import React from 'react';
import { ActionItem, Team, User } from '../../types';

interface DashboardAction extends ActionItem {
  originRetro: string;
  contextText: string;
}

interface Props {
  team: Team;
  knownMembers: User[];
  actionFilter: 'OPEN' | 'CLOSED' | 'ALL';
  onActionFilterChange: (filter: 'OPEN' | 'CLOSED' | 'ALL') => void;
  newActionText: string;
  onNewActionTextChange: (value: string) => void;
  newActionAssignee: string;
  onNewActionAssigneeChange: (value: string) => void;
  onCreateAction: (event: React.FormEvent<HTMLFormElement>) => void;
  filteredActions: DashboardAction[];
  onToggleAction: (actionId: string) => void;
  onUpdateActionText: (actionId: string, text: string) => void;
  onUpdateAssignee: (actionId: string, assigneeId: string | null) => void;
}

const DashboardActionsTab: React.FC<Props> = ({
  team,
  knownMembers,
  actionFilter,
  onActionFilterChange,
  newActionText,
  onNewActionTextChange,
  newActionAssignee,
  onNewActionAssigneeChange,
  onCreateAction,
  filteredActions,
  onToggleAction,
  onUpdateActionText,
  onUpdateAssignee
}) => (
  <div className="max-w-4xl mx-auto">
    <form onSubmit={onCreateAction} className="mb-6 p-4 bg-white rounded-lg border border-slate-200 shadow-sm">
      <h3 className="text-xs font-bold text-slate-400 uppercase mb-2">Create Action</h3>
      <div className="flex flex-col md:flex-row gap-2">
        <input
          type="text"
          placeholder="What needs to be done?"
          className="flex-grow px-3 py-2 rounded border border-slate-300 focus:border-retro-primary outline-none bg-white text-slate-900"
          value={newActionText}
          onChange={(e) => onNewActionTextChange(e.target.value)}
        />
        <select
          value={newActionAssignee}
          onChange={(e) => onNewActionAssigneeChange(e.target.value)}
          className="px-3 py-2 rounded border border-slate-300 bg-white text-slate-900 outline-none text-sm min-w-[150px]"
        >
          <option value="">Unassigned</option>
          {team.members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!newActionText.trim()}
          className="bg-retro-primary text-white px-4 py-2 rounded font-bold hover:bg-retro-primaryHover disabled:opacity-50 transition"
        >
          Add
        </button>
      </div>
    </form>

    <div className="flex space-x-2 mb-4 text-sm font-medium">
      {(['OPEN', 'CLOSED', 'ALL'] as const).map((filter) => (
        <button
          key={filter}
          onClick={() => onActionFilterChange(filter)}
          className={`px-3 py-1.5 rounded-full border transition ${actionFilter === filter ? 'bg-indigo-50 border-retro-primary text-retro-primary' : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'}`}
        >
          {filter.charAt(0) + filter.slice(1).toLowerCase()}
        </button>
      ))}
    </div>

    <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
      {filteredActions.length === 0 ? (
        <div className="text-center text-slate-400 py-10">No actions found.</div>
      ) : (
        filteredActions.map((action) => (
          <div key={action.id} className="flex items-center p-4 border-b border-slate-100 last:border-0 hover:bg-slate-50 group">
            <button
              onClick={() => onToggleAction(action.id)}
              className={`mr-4 transition ${action.done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-400'}`}
            >
              <span className="material-symbols-outlined text-2xl">
                {action.done ? 'check_circle' : 'radio_button_unchecked'}
              </span>
            </button>
            <div className="flex-grow mr-4">
              <input
                defaultValue={action.text}
                onBlur={(e) => onUpdateActionText(action.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                className={`w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-2 py-1 focus:bg-white focus:border-retro-primary outline-none transition font-medium ${action.done ? 'line-through text-slate-400' : 'text-slate-700'}`}
              />
              <div className="flex items-center text-xs mt-1">
                {action.originRetro !== 'Dashboard' && (
                  <span className="text-slate-400 px-1 bg-slate-100 rounded mr-2">{action.originRetro}</span>
                )}
                {action.contextText && (
                  <span className="text-indigo-400 italic truncate max-w-[200px]" title={action.contextText}>
                    Re: {action.contextText}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center">
              {action.assigneeId && !team.members.some((member) => member.id === action.assigneeId) && (
                (() => {
                  const archived = knownMembers.find((member) => member.id === action.assigneeId);
                  if (!archived) return null;
                  return (
                    <select
                      value={action.assigneeId || ''}
                      onChange={(e) => onUpdateAssignee(action.id, e.target.value || null)}
                      className="text-xs border border-slate-200 rounded p-1.5 bg-amber-50 text-amber-700 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-none"
                    >
                      <option value={archived.id}>{archived.name} (removed)</option>
                      {team.members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                      <option value="">Unassigned</option>
                    </select>
                  );
                })()
              )}
              {!action.assigneeId || team.members.some((member) => member.id === action.assigneeId) ? (
                <select
                  value={action.assigneeId || ''}
                  onChange={(e) => onUpdateAssignee(action.id, e.target.value || null)}
                  className="text-xs border border-slate-200 rounded p-1.5 bg-white text-slate-600 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-none"
                >
                  <option value="">Unassigned</option>
                  {team.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

export default DashboardActionsTab;
