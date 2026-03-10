import React, { useState } from 'react';
import { ActionItem, User } from '../../types';

const getProposalRowStyle = (upVotes: number, neutralVotes: number, downVotes: number): React.CSSProperties => {
  const total = upVotes + neutralVotes + downVotes;
  if (total === 0) return {};

  const upPct = upVotes / total;
  const neutralPct = neutralVotes / total;
  const downPct = downVotes / total;
  const upEnd = upPct * 100;
  const neutralEnd = upEnd + neutralPct * 100;

  return {
    background: `linear-gradient(to right, rgba(16, 185, 129, ${0.12 + upPct * 0.2}) 0%, rgba(16, 185, 129, ${0.12 + upPct * 0.2}) ${upEnd}%, rgba(148, 163, 184, ${0.1 + neutralPct * 0.15}) ${upEnd}%, rgba(148, 163, 184, ${0.1 + neutralPct * 0.15}) ${neutralEnd}%, rgba(239, 68, 68, ${0.1 + downPct * 0.18}) ${neutralEnd}%, rgba(239, 68, 68, ${0.1 + downPct * 0.18}) 100%)`
  };
};

const VoteStatusTooltip: React.FC<{
  proposalVotes: Record<string, 'up' | 'down' | 'neutral'>;
  participants: User[];
  totalVotes: number;
  showVoteTypes: boolean;
  surface?: 'light' | 'dark';
}> = ({ proposalVotes, participants, totalVotes, showVoteTypes, surface = 'light' }) => {
  const [visible, setVisible] = useState(false);
  const voters = Object.keys(proposalVotes);
  const votedParticipants = participants.filter((participant) => voters.includes(participant.id));
  const notVotedParticipants = participants.filter((participant) => !voters.includes(participant.id));
  const totalBadgeClass = surface === 'dark'
    ? 'text-[11px] font-bold text-slate-200 px-2 py-1 bg-slate-900 border border-slate-700 rounded cursor-help'
    : 'text-[11px] font-bold text-slate-500 px-2 py-1 bg-slate-100 rounded cursor-help';

  return (
    <div className="relative" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      <div className={totalBadgeClass}>
        Total: {totalVotes}
      </div>
      {visible && (
        <div className="absolute bottom-full right-0 mb-2 w-60 bg-white border border-slate-200 rounded-lg shadow-lg z-50 p-3 text-xs">
          <div className="mb-2">
            <div className="font-bold text-emerald-700 mb-1 flex items-center">
              <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
              Voted ({votedParticipants.length})
            </div>
            {votedParticipants.length > 0 ? (
              <ul className="ml-4 text-slate-600 space-y-1">
                {votedParticipants.map((participant) => (
                  <li key={participant.id} className="flex items-center">
                    <span className={`w-2.5 h-2.5 rounded-full ${participant.color} mr-2 shrink-0`}></span>
                    <span className="truncate">{participant.name}</span>
                    {showVoteTypes ? (
                      <span className="ml-auto shrink-0">
                        {proposalVotes[participant.id] === 'up' && (
                          <span className="material-symbols-outlined text-emerald-600 text-base">thumb_up</span>
                        )}
                        {proposalVotes[participant.id] === 'down' && (
                          <span className="material-symbols-outlined text-red-500 text-base">thumb_down</span>
                        )}
                        {proposalVotes[participant.id] === 'neutral' && (
                          <span className="material-symbols-outlined text-slate-400 text-base">remove</span>
                        )}
                      </span>
                    ) : (
                      <span className="ml-auto material-symbols-outlined text-emerald-500 text-base shrink-0">how_to_reg</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ml-4 text-slate-400 italic">No one yet</div>
            )}
          </div>
          <div>
            <div className="font-bold text-amber-600 mb-1 flex items-center">
              <span className="material-symbols-outlined text-sm mr-1">pending</span>
              Not voted ({notVotedParticipants.length})
            </div>
            {notVotedParticipants.length > 0 ? (
              <ul className="ml-4 text-slate-600 space-y-1">
                {notVotedParticipants.map((participant) => (
                  <li key={participant.id} className="flex items-center">
                    <span className={`w-2.5 h-2.5 rounded-full ${participant.color} mr-2 shrink-0`}></span>
                    <span className="truncate">{participant.name}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="ml-4 text-slate-400 italic">Everyone voted</div>
            )}
          </div>
          <div className="absolute bottom-0 right-4 translate-y-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-200"></div>
        </div>
      )}
    </div>
  );
};

interface Props {
  proposal: ActionItem;
  participants: User[];
  currentUserId: string;
  isFacilitator: boolean;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onVote: (vote: 'up' | 'neutral' | 'down') => void;
  onAccept: () => void;
  onDelete: () => void;
  showVoteTypes: boolean;
  surface?: 'light' | 'dark';
}

const ProposalActionRow: React.FC<Props> = ({
  proposal,
  participants,
  currentUserId,
  isFacilitator,
  isEditing,
  editText,
  onEditTextChange,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onVote,
  onAccept,
  onDelete,
  showVoteTypes,
  surface = 'light'
}) => {
  const upVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'up').length;
  const neutralVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'neutral').length;
  const downVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'down').length;
  const totalVotes = upVotes + neutralVotes + downVotes;
  const myVote = proposal.proposalVotes?.[currentUserId];
  const rowStyle = getProposalRowStyle(upVotes, neutralVotes, downVotes);
  const isDark = surface === 'dark';
  const containerClass = isDark
    ? 'p-3 rounded border border-slate-600/80 mb-2 text-slate-100'
    : 'p-3 rounded border border-slate-200 mb-2';
  const inputClass = isDark
    ? 'flex-grow border border-slate-600 rounded p-2 text-sm outline-none focus:border-retro-primary bg-slate-900 text-slate-50'
    : 'flex-grow border border-slate-300 rounded p-2 text-sm outline-none focus:border-retro-primary bg-white text-slate-900';
  const cancelClass = isDark
    ? 'bg-slate-700 text-slate-100 px-3 py-2 rounded text-xs font-bold hover:bg-slate-600'
    : 'bg-slate-300 text-slate-700 px-3 py-2 rounded text-xs font-bold hover:bg-slate-400';
  const proposalTextClass = isDark
    ? `text-slate-50 text-sm font-medium ${isFacilitator ? 'cursor-pointer hover:text-indigo-300' : ''}`
    : `text-slate-700 text-sm font-medium ${isFacilitator ? 'cursor-pointer hover:text-indigo-600' : ''}`;
  const deleteButtonClass = isDark
    ? 'text-slate-400 hover:text-rose-400 transition'
    : 'text-slate-400 hover:text-red-600 transition';
  const voteBoxClass = isDark
    ? 'flex bg-slate-900/80 border border-slate-700 rounded-lg p-1 space-x-1'
    : 'flex bg-slate-100 rounded-lg p-1 space-x-1';
  const upVoteClass = myVote === 'up'
    ? (isDark ? 'bg-emerald-900/70 text-emerald-300 shadow-sm' : 'bg-emerald-100 text-emerald-700 shadow-sm')
    : (isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-white text-slate-500');
  const neutralVoteClass = myVote === 'neutral'
    ? (isDark ? 'bg-slate-700 text-slate-100 shadow-sm' : 'bg-slate-300 text-slate-800 shadow-sm')
    : (isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-white text-slate-500');
  const downVoteClass = myVote === 'down'
    ? (isDark ? 'bg-rose-900/70 text-rose-300 shadow-sm' : 'bg-red-100 text-red-700 shadow-sm')
    : (isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-white text-slate-500');

  return (
    <div className={containerClass} style={rowStyle}>
      {isEditing ? (
        <div className="flex items-center space-x-2">
          <input
            type="text"
            value={editText}
            onChange={(event) => onEditTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSaveEdit();
              if (event.key === 'Escape') onCancelEdit();
            }}
            className={inputClass}
            autoFocus
          />
          <button
            onClick={onSaveEdit}
            className="bg-emerald-500 text-white px-3 py-2 rounded text-xs font-bold hover:bg-emerald-600"
          >
            <span className="material-symbols-outlined text-sm">check</span>
          </button>
          <button
            onClick={onCancelEdit}
            className={cancelClass}
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 flex-grow mr-3">
            <span
              className={proposalTextClass}
              onClick={() => isFacilitator && onStartEdit()}
              title={isFacilitator ? 'Click to edit' : ''}
            >
              {proposal.text}
            </span>
            {isFacilitator && (
              <button
                onClick={onDelete}
                className={deleteButtonClass}
                title="Delete proposal"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <div className={voteBoxClass}>
              <button
                onClick={() => onVote('up')}
                className={`px-2 py-1 rounded flex items-center transition ${upVoteClass}`}
              >
                <span className="material-symbols-outlined text-sm mr-1">thumb_up</span>
                <span className="text-xs font-bold">{upVotes > 0 ? upVotes : ''}</span>
              </button>
              <button
                onClick={() => onVote('neutral')}
                className={`px-2 py-1 rounded flex items-center transition ${neutralVoteClass}`}
              >
                <span className="material-symbols-outlined text-sm mr-1">remove</span>
                <span className="text-xs font-bold">{neutralVotes > 0 ? neutralVotes : ''}</span>
              </button>
              <button
                onClick={() => onVote('down')}
                className={`px-2 py-1 rounded flex items-center transition ${downVoteClass}`}
              >
                <span className="material-symbols-outlined text-sm mr-1">thumb_down</span>
                <span className="text-xs font-bold">{downVotes > 0 ? downVotes : ''}</span>
              </button>
            </div>
            <VoteStatusTooltip
              proposalVotes={proposal.proposalVotes || {}}
              participants={participants}
              totalVotes={totalVotes}
              showVoteTypes={showVoteTypes}
              surface={surface}
            />
            {isFacilitator && (
              <button
                onClick={onAccept}
                className="bg-retro-primary text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-retro-primaryHover shadow-sm"
              >
                Accept
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProposalActionRow;
