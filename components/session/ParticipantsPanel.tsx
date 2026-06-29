import React from 'react';
import { ParticipantActivity, RetroSession, User } from '../../types';

interface Props {
  session: RetroSession;
  participants: User[];
  connectedUsers: Set<string>;
  currentUser: User;
  isFacilitator: boolean;
  isCollapsed: boolean;
  /** userId -> live "is typing" signal, shown next to the participant's name */
  activityUsers: Record<string, ParticipantActivity>;
  onToggleCollapse: () => void;
  onInvite: () => void;
  getMemberDisplay: (member: User) => { displayName: string; initials: string };
}

const ACTIVITY_LABEL: Record<ParticipantActivity, string> = {
  brainstorm: 'writing a ticket',
  proposal: 'proposing action'
};

const ACTIVITY_ICON: Record<ParticipantActivity, string> = {
  brainstorm: 'stylus_note',
  proposal: 'lightbulb'
};

// Messaging-app style "is typing" cue: a contextual icon, a short label and
// three softly bouncing dots. Shown in place of the role line while active.
const TypingIndicator: React.FC<{ activity: ParticipantActivity }> = ({ activity }) => (
  <div
    className="flex items-center text-[11px] font-semibold text-retro-primary min-w-0"
    title={ACTIVITY_LABEL[activity]}
  >
    <span className="material-symbols-outlined text-sm mr-1 shrink-0">{ACTIVITY_ICON[activity]}</span>
    <span className="truncate">{ACTIVITY_LABEL[activity]}</span>
    <span className="flex items-center ml-1 space-x-0.5 shrink-0">
      <span className="typing-dot w-1 h-1 rounded-full bg-retro-primary" style={{ animationDelay: '0ms' }} />
      <span className="typing-dot w-1 h-1 rounded-full bg-retro-primary" style={{ animationDelay: '150ms' }} />
      <span className="typing-dot w-1 h-1 rounded-full bg-retro-primary" style={{ animationDelay: '300ms' }} />
    </span>
  </div>
);

// One coloured dot per ticket authored, tinted with the member's avatar colour,
// so facilitators can count contributions at a glance and instantly spot who
// hasn't added anything. Counting dots (rather than a proportional bar) avoids
// implying a share of the whole. Heavy contributors who would overflow the row
// collapse into a "+N" chip; the exact total is always available on hover.
const MAX_DOTS = 9;

const ContributionDots: React.FC<{ count: number; colorClass: string }> = ({ count, colorClass }) => {
  if (count <= 0) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 text-slate-300" title="No tickets added yet">
        <span className="w-2 h-2 rounded-full border border-dashed border-slate-300 shrink-0" />
        <span className="text-[10px] font-medium tracking-wide">no tickets</span>
      </div>
    );
  }
  const overflowing = count > MAX_DOTS;
  const visibleDots = overflowing ? MAX_DOTS - 1 : count;
  const hidden = count - visibleDots;
  return (
    <div
      className="flex items-center gap-1 mt-1.5"
      title={`${count} ticket${count === 1 ? '' : 's'} added`}
    >
      {Array.from({ length: visibleDots }).map((_, index) => (
        <span key={index} className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`} />
      ))}
      {overflowing && (
        <span className="text-[10px] font-bold text-slate-500 leading-none ml-0.5 shrink-0">+{hidden}</span>
      )}
    </div>
  );
};

const ParticipantsPanel: React.FC<Props> = ({
  session,
  participants,
  connectedUsers,
  currentUser,
  isFacilitator,
  isCollapsed,
  activityUsers,
  onToggleCollapse,
  onInvite,
  getMemberDisplay
}) => {
  // Tickets authored per participant (Brainstorm onwards). Computed here so the
  // panel stays self-contained and updates live as cards are added.
  const ticketCounts: Record<string, number> = {};
  session.tickets.forEach((ticket) => {
    if (ticket.authorId) {
      ticketCounts[ticket.authorId] = (ticketCounts[ticket.authorId] || 0) + 1;
    }
  });
  const totalTickets = session.tickets.length;
  const showContributions = totalTickets > 0;

  return (
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
          <div className="grow overflow-y-auto p-3">
            {participants.map((member) => {
              const { displayName, initials } = getMemberDisplay(member);
              const isFinished = session.finishedUsers?.includes(member.id);
              const isCurrentUser = member.id === currentUser.id;
              const isOnline = connectedUsers.has(member.id);
              const hasHappinessVote = Boolean(session.happiness?.[member.id]);
              const hasRotiVote = Boolean(session.roti?.[member.id]);
              const hasStageVote = session.phase === 'WELCOME' ? hasHappinessVote : session.phase === 'CLOSE' ? hasRotiVote : false;
              const activity = activityUsers[member.id];
              const ticketCount = ticketCounts[member.id] || 0;
              return (
                <div
                  key={member.id}
                  className={`flex items-center p-2 rounded-lg mb-1 ${isCurrentUser ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="relative mr-3 shrink-0">
                    <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold`}>
                      {initials}
                    </div>
                    {isOnline && (
                      <div
                        className="absolute -top-0.5 -left-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"
                        title="Online"
                      />
                    )}
                  </div>
                  <div className="grow min-w-0">
                    <div className={`text-sm font-medium truncate ${isCurrentUser ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {displayName}
                      {isCurrentUser && <span className="text-xs text-indigo-400 ml-1">(you)</span>}
                    </div>
                    {activity ? (
                      <TypingIndicator activity={activity} />
                    ) : (
                      <div className="text-xs text-slate-400 capitalize">{member.role}</div>
                    )}
                    {showContributions && (
                      <ContributionDots count={ticketCount} colorClass={member.color} />
                    )}
                  </div>
                  {(isFinished || hasStageVote) && (
                    <span
                      className={`material-symbols-outlined text-lg ml-2 shrink-0 self-start ${hasStageVote ? 'text-emerald-500' : 'text-emerald-400'}`}
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
            ) : session.phase === 'BRAINSTORM' ? (
              <div className="text-xs text-slate-500 text-center">
                {totalTickets} ticket{totalTickets === 1 ? '' : 's'} added so far
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
};

export default ParticipantsPanel;
