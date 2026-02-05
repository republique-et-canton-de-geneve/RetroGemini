import React from 'react';
import { RetroSession, User } from '../../types';

interface Props {
  session: RetroSession;
  participants: User[];
  connectedUsers: Set<string>;
  currentUser: User;
  isFacilitator: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onInvite: () => void;
  getMemberDisplay: (member: User) => { displayName: string; initials: string };
}

const ParticipantsPanel: React.FC<Props> = ({
  session,
  participants,
  connectedUsers,
  currentUser,
  isFacilitator,
  isCollapsed,
  onToggleCollapse,
  onInvite,
  getMemberDisplay
}) => (
  <div className={`bg-white border-l border-slate-200 flex flex-col shrink-0 hidden lg:flex transition-all ${isCollapsed ? 'w-12' : 'w-64'}`}>
    <div className="p-4 border-b border-slate-200 flex items-center justify-between">
      {!isCollapsed && (
        <h3 className="text-sm font-bold text-slate-700 flex items-center">
          <span className="material-symbols-outlined mr-2 text-lg">groups</span>
          Participants ({participants.length})
        </h3>
      )}
      <button
        onClick={onToggleCollapse}
        className="text-slate-400 hover:text-slate-700 transition"
        title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
      >
        <span className="material-symbols-outlined text-lg">
          {isCollapsed ? 'chevron_left' : 'chevron_right'}
        </span>
      </button>
    </div>
    {!isCollapsed && (
      <>
        <div className="flex-grow overflow-y-auto p-3">
          {participants.map((member) => {
            const { displayName, initials } = getMemberDisplay(member);
            const isFinished = session.finishedUsers?.includes(member.id);
            const isCurrentUser = member.id === currentUser.id;
            const isOnline = connectedUsers.has(member.id);
            const hasHappinessVote = Boolean(session.happiness?.[member.id]);
            const hasRotiVote = Boolean(session.roti?.[member.id]);
            const hasStageVote = session.phase === 'WELCOME' ? hasHappinessVote : session.phase === 'CLOSE' ? hasRotiVote : false;
            return (
              <div
                key={member.id}
                className={`flex items-center p-2 rounded-lg mb-1 ${isCurrentUser ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
              >
                <div className="relative mr-3">
                  <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold`}>
                    {initials}
                  </div>
                  {isOnline && (
                    <div
                      className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"
                      title="Online"
                    />
                  )}
                </div>
                <div className="flex-grow min-w-0">
                  <div className={`text-sm font-medium truncate ${isCurrentUser ? 'text-indigo-700' : 'text-slate-700'}`}>
                    {displayName}
                    {isCurrentUser && <span className="text-xs text-indigo-400 ml-1">(you)</span>}
                  </div>
                  <div className="text-xs text-slate-400 capitalize">{member.role}</div>
                </div>
                {(isFinished || hasStageVote) && (
                  <span
                    className={`material-symbols-outlined text-lg ${hasStageVote ? 'text-emerald-500' : 'text-emerald-400'}`}
                    title={hasStageVote ? 'Vote recorded' : 'Finished'}
                  >
                    check_circle
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <div className="p-3 border-t border-slate-200 bg-slate-50">
          {session.phase === 'WELCOME' ? (
            <div className="text-xs text-slate-500 text-center">
              {Object.keys(session.happiness || {}).length} / {participants.length} submitted happiness
            </div>
          ) : session.phase === 'CLOSE' ? (
            <div className="text-xs text-slate-500 text-center">
              {Object.keys(session.roti || {}).length} / {participants.length} voted in close-out
            </div>
          ) : (
            <div className="text-xs text-slate-500 text-center">
              {session.finishedUsers?.length || 0} / {participants.length} finished
            </div>
          )}
        </div>
        {isFacilitator && (
          <div className="p-3 border-t border-slate-200">
            <button
              onClick={onInvite}
              className="w-full bg-retro-primary text-white py-2 rounded-lg font-bold text-sm hover:bg-retro-primaryHover"
            >
              Invite Team
            </button>
          </div>
        )}
      </>
    )}
  </div>
);

export default ParticipantsPanel;
