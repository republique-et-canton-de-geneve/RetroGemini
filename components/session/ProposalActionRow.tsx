import React, { useEffect, useRef, useState } from 'react';
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
  showVoteTypes: boolean;
  surface?: 'light' | 'dark';
}> = ({ proposalVotes, participants, showVoteTypes, surface = 'light' }) => {
  const [visible, setVisible] = useState(false);
  // Rendered with position:fixed so the popup escapes the scroll container and
  // is never clipped by the phase header. Flips below the badge when the row
  // sits too close to the top of the viewport for the popup to fit above.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number; openUp: boolean } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  // Short grace period before hiding so the pointer can travel across the small
  // gap from the badge onto the popup (and scroll a long voter list) without it
  // vanishing. Re-entering either the badge or the popup cancels the pending hide.
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const scheduleHide = () => {
    cancelHide();
    hideTimerRef.current = setTimeout(() => setVisible(false), 220);
  };

  useEffect(() => () => cancelHide(), []);

  const showTooltip = () => {
    cancelHide();
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      const openUp = rect.top > 320;
      setPos({
        openUp,
        right: Math.max(8, window.innerWidth - rect.right),
        ...(openUp ? { bottom: window.innerHeight - rect.top + 8 } : { top: rect.bottom + 8 })
      });
    }
    setVisible(true);
  };

  const voters = Object.keys(proposalVotes);
  // The facilitator is not expected to vote: progress only tracks participants
  const expectedVoters = participants.filter((participant) => participant.role !== 'facilitator');
  const votedParticipants = participants.filter((participant) => voters.includes(participant.id));
  const notVotedParticipants = expectedVoters.filter((participant) => !voters.includes(participant.id));
  const votedExpectedCount = expectedVoters.length - notVotedParticipants.length;
  const allVoted = expectedVoters.length > 0 && notVotedParticipants.length === 0;
  const hasFacilitator = participants.some((participant) => participant.role === 'facilitator');
  const pendingBadgeClass = surface === 'dark'
    ? 'text-slate-200 bg-slate-900 border border-slate-700'
    : 'text-slate-500 bg-slate-100';
  const completeBadgeClass = surface === 'dark'
    ? 'text-emerald-300 bg-emerald-900/40 border border-emerald-600/60'
    : 'text-emerald-700 bg-emerald-100 border border-emerald-300';
  const totalBadgeClass = `flex items-center text-[11px] font-bold px-2 py-1 rounded-sm cursor-help whitespace-nowrap ${allVoted ? completeBadgeClass : pendingBadgeClass}`;

  return (
    <div className="relative" ref={wrapperRef} onMouseEnter={showTooltip} onMouseLeave={scheduleHide}>
      <div className={totalBadgeClass} data-testid="proposal-vote-progress" data-vote-progress={allVoted ? 'complete' : 'pending'}>
        <span className="material-symbols-outlined text-sm mr-1">{allVoted ? 'task_alt' : 'group'}</span>
        {expectedVoters.length > 0
          ? `${votedExpectedCount}/${expectedVoters.length} voted`
          : `${votedParticipants.length} voted`}
      </div>
      {visible && (
        <div
          className="fixed w-60 bg-white border border-slate-200 rounded-lg shadow-lg z-50"
          style={{ top: pos?.top, bottom: pos?.bottom, right: pos?.right ?? 8 }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          {/* Invisible bridge over the 8px gap so moving from the badge to the
              popup never crosses a dead zone that would dismiss the tooltip. */}
          <div
            className="absolute left-0 right-0 h-3"
            style={pos?.openUp !== false ? { bottom: '-12px' } : { top: '-12px' }}
            aria-hidden="true"
          />
          <div className="p-3 text-xs max-h-72 overflow-y-auto">
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
                      {participant.role === 'facilitator' && (
                        <span className="ml-1 text-[10px] text-slate-400 italic shrink-0">(facilitator)</span>
                      )}
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
            {hasFacilitator && (
              <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] text-slate-400 italic">
                Facilitator is not counted in the vote total.
              </div>
            )}
          </div>
          {pos?.openUp !== false ? (
            <div className="absolute bottom-0 right-4 translate-y-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-200"></div>
          ) : (
            <div className="absolute top-0 right-4 -translate-y-full w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-b-[6px] border-b-slate-200"></div>
          )}
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
  onReject?: () => void;
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
  onReject,
  onDelete,
  showVoteTypes,
  surface = 'light'
}) => {
  const upVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'up').length;
  const neutralVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'neutral').length;
  const downVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'down').length;
  const myVote = proposal.proposalVotes?.[currentUserId];
  const hasVoted = myVote !== undefined;
  const rowStyle = getProposalRowStyle(upVotes, neutralVotes, downVotes);
  const isDark = surface === 'dark';
  const pendingRingClass = isDark
    ? 'ring-2 ring-amber-500/70 border-amber-500/60'
    : 'ring-2 ring-amber-400 border-amber-300';
  const containerClass = isDark
    ? `p-3 rounded-sm border mb-2 text-slate-100 ${hasVoted ? 'border-slate-600/80' : pendingRingClass}`
    : `p-3 rounded-sm border mb-2 ${hasVoted ? 'border-slate-200' : pendingRingClass}`;
  const inputClass = isDark
    ? 'grow border border-slate-600 rounded-sm p-2 text-sm outline-hidden focus:border-retro-primary bg-slate-900 text-slate-50'
    : 'grow border border-slate-300 rounded-sm p-2 text-sm outline-hidden focus:border-retro-primary bg-white text-slate-900';
  const cancelClass = isDark
    ? 'bg-slate-700 text-slate-100 px-3 py-2 rounded-sm text-xs font-bold hover:bg-slate-600'
    : 'bg-slate-300 text-slate-700 px-3 py-2 rounded-sm text-xs font-bold hover:bg-slate-400';
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
    ? (isDark ? 'bg-emerald-900/70 text-emerald-300 shadow-xs' : 'bg-emerald-100 text-emerald-700 shadow-xs')
    : (isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-white text-slate-500');
  const neutralVoteClass = myVote === 'neutral'
    ? (isDark ? 'bg-slate-700 text-slate-100 shadow-xs' : 'bg-slate-300 text-slate-800 shadow-xs')
    : (isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-white text-slate-500');
  const downVoteClass = myVote === 'down'
    ? (isDark ? 'bg-rose-900/70 text-rose-300 shadow-xs' : 'bg-red-100 text-red-700 shadow-xs')
    : (isDark ? 'hover:bg-slate-800 text-slate-200' : 'hover:bg-white text-slate-500');
  const pendingBadgeClass = isDark
    ? 'bg-amber-900/40 text-amber-300 border border-amber-500/60'
    : 'bg-amber-100 text-amber-700 border border-amber-300';
  const votedBadgeClass = isDark
    ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-600/60'
    : 'bg-emerald-100 text-emerald-700 border border-emerald-300';
  const rejectButtonClass = isDark
    ? 'border border-rose-500/60 text-rose-300 px-3 py-1.5 rounded-sm text-xs font-bold hover:bg-rose-900/40 transition'
    : 'border border-rose-300 text-rose-600 px-3 py-1.5 rounded-sm text-xs font-bold hover:bg-rose-50 transition';

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
            className="bg-emerald-500 text-white px-3 py-2 rounded-sm text-xs font-bold hover:bg-emerald-600"
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
        <div>
          {/* Text gets the full row width; controls live on their own line below */}
          <div className="flex items-start justify-between mb-2">
            <span
              className={`${proposalTextClass} grow wrap-break-word`}
              onClick={() => isFacilitator && onStartEdit()}
              title={isFacilitator ? 'Click to edit' : ''}
            >
              {proposal.text}
            </span>
            {isFacilitator && (
              <button
                onClick={onDelete}
                className={`${deleteButtonClass} ml-2 shrink-0`}
                title="Delete proposal"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center flex-wrap gap-2">
              {hasVoted ? (
                <span
                  data-vote-status="voted"
                  className={`flex items-center text-[11px] font-bold px-2 py-1 rounded-sm whitespace-nowrap ${votedBadgeClass}`}
                >
                  <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
                  Voted
                </span>
              ) : (
                <span
                  data-vote-status="pending"
                  className={`flex items-center text-[11px] font-bold px-2 py-1 rounded-sm whitespace-nowrap animate-pulse ${pendingBadgeClass}`}
                >
                  <span className="material-symbols-outlined text-sm mr-1">how_to_vote</span>
                  Vote needed
                </span>
              )}
              <div className={voteBoxClass}>
                <button
                  onClick={() => onVote('up')}
                  className={`px-2 py-1 rounded-sm flex items-center transition ${upVoteClass}`}
                >
                  <span className="material-symbols-outlined text-sm mr-1">thumb_up</span>
                  <span className="text-xs font-bold">{upVotes > 0 ? upVotes : ''}</span>
                </button>
                <button
                  onClick={() => onVote('neutral')}
                  className={`px-2 py-1 rounded-sm flex items-center transition ${neutralVoteClass}`}
                >
                  <span className="material-symbols-outlined text-sm mr-1">remove</span>
                  <span className="text-xs font-bold">{neutralVotes > 0 ? neutralVotes : ''}</span>
                </button>
                <button
                  onClick={() => onVote('down')}
                  className={`px-2 py-1 rounded-sm flex items-center transition ${downVoteClass}`}
                >
                  <span className="material-symbols-outlined text-sm mr-1">thumb_down</span>
                  <span className="text-xs font-bold">{downVotes > 0 ? downVotes : ''}</span>
                </button>
              </div>
              <VoteStatusTooltip
                proposalVotes={proposal.proposalVotes || {}}
                participants={participants}
                showVoteTypes={showVoteTypes}
                surface={surface}
              />
            </div>
            {isFacilitator && (
              <div className="flex items-center gap-2 ml-auto">
                {onReject && (
                  <button
                    onClick={onReject}
                    className={rejectButtonClass}
                    title="Reject proposal (can be undone)"
                  >
                    Reject
                  </button>
                )}
                <button
                  onClick={onAccept}
                  className="bg-retro-primary text-white px-3 py-1.5 rounded-sm text-xs font-bold hover:bg-retro-primaryHover shadow-xs"
                >
                  Accept
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ProposalActionRow;
