import React from 'react';
import { RetroSession, User } from '../../types';
import ProposalActionRow from './ProposalActionRow';

interface DiscussItem {
  id: string;
  text: string;
  votes: number;
  uniqueVotes?: number; // Number of distinct participants who voted (differs from votes when multi-voting is allowed)
  type: 'group' | 'ticket';
  ref: any;
}

interface Props {
  session: RetroSession;
  currentUser: User;
  participantsCount: number;
  isFacilitator: boolean;
  sortedItems: DiscussItem[];
  activeDiscussTicket: string | null;
  setActiveDiscussTicket: (value: string | null) => void;
  updateSession: (updater: (session: RetroSession) => void) => void;
  handleToggleNextTopicVote: (topicId: string) => void;
  discussRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
  editingProposalId: string | null;
  editingProposalText: string;
  setEditingProposalText: (value: string) => void;
  handleSaveProposalEdit: (proposalId: string) => void;
  handleCancelProposalEdit: () => void;
  handleStartEditProposal: (proposalId: string, currentText: string) => void;
  handleDeleteProposal: (proposalId: string) => void;
  handleVoteProposal: (proposalId: string, vote: 'up' | 'down' | 'neutral') => void;
  handleAcceptProposal: (proposalId: string) => void;
  handleUndoAcceptProposal: (proposalId: string) => void;
  handleRejectProposal: (proposalId: string) => void;
  handleUndoRejectProposal: (proposalId: string) => void;
  handleAddProposal: (topicId: string) => void;
  newProposalText: string;
  setNewProposalText: (value: string) => void;
  handleDirectAddAction: (topicId: string) => void;
  /** Report the current proposal draft so the live "is typing" cue tracks it */
  onProposalDraftChange?: (value: string) => void;
  /** Signal that the current user stopped editing a proposal (e.g. on blur) */
  onProposalActivityStop?: () => void;
  setPhase: (phase: string) => void;
}

const DiscussPhase: React.FC<Props> = ({
  session,
  currentUser,
  participantsCount,
  isFacilitator,
  sortedItems,
  activeDiscussTicket,
  setActiveDiscussTicket,
  updateSession,
  handleToggleNextTopicVote,
  discussRefs,
  editingProposalId,
  editingProposalText,
  setEditingProposalText,
  handleSaveProposalEdit,
  handleCancelProposalEdit,
  handleStartEditProposal,
  handleDeleteProposal,
  handleVoteProposal,
  handleAcceptProposal,
  handleUndoAcceptProposal,
  handleRejectProposal,
  handleUndoRejectProposal,
  handleAddProposal,
  newProposalText,
  setNewProposalText,
  handleDirectAddAction,
  onProposalDraftChange,
  onProposalActivityStop,
  setPhase
}) => {
  const showVoteTypes = session.settings.showParticipantVotes ?? false;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-50">
      <div className="bg-white border-b px-6 py-3 flex justify-between items-center shadow-xs z-30 shrink-0">
        <div className="flex items-center space-x-4">
          <span className="font-bold text-slate-700 text-lg">Discuss & Propose Actions</span>
          {isFacilitator && (
            <label className="flex items-center space-x-1.5 cursor-pointer text-sm text-slate-600 border-l border-slate-200 pl-4">
              <input
                type="checkbox"
                checked={showVoteTypes}
                onChange={(e) => updateSession((s) => { s.settings.showParticipantVotes = e.target.checked; })}
              />
              <span>Show votes</span>
            </label>
          )}
        </div>
        {isFacilitator && (
          <button
            onClick={() => setPhase('REVIEW')}
            className="bg-retro-primary text-white px-4 py-2 rounded-sm font-bold text-sm hover:bg-retro-primaryHover"
          >
            Next Phase
          </button>
        )}
      </div>
      <div className="grow overflow-auto p-6 max-w-4xl mx-auto w-full space-y-4">
        {sortedItems.map((item) => {
          const subItems = item.type === 'group' ? session.tickets.filter((ticket) => ticket.groupId === item.id) : [];
          // For groups, also match actions linked to member tickets (created before grouping)
          const linkedIds = new Set([item.id, ...subItems.map((t) => t.id)]);
          const nextTopicVotes = session.discussionNextTopicVotes?.[item.id] || [];
          const nextTopicVotesCount = nextTopicVotes.length;
          const hasVotedNext = nextTopicVotes.includes(currentUser.id);
          const itemColumn = session.columns.find((column) => column.id === item.ref.colId);
          const uniqueVoters = item.uniqueVotes ?? item.votes;

          return (
            <div
              ref={(element) => {
                discussRefs.current[item.id] = element;
              }}
              key={item.id}
              className={`bg-white rounded-xl shadow-xs border-2 transition ${activeDiscussTicket === item.id ? 'border-retro-primary ring-4 ring-indigo-50' : 'border-slate-200'}`}
            >
              <div
                className={`p-4 flex items-start ${isFacilitator ? 'cursor-pointer' : 'cursor-default'}`}
                onClick={() => {
                  if (!isFacilitator) return;
                  updateSession((draft) => {
                    draft.discussionFocusId = draft.discussionFocusId === item.id ? null : item.id;
                  });
                  setActiveDiscussTicket(activeDiscussTicket === item.id ? null : item.id);
                }}
              >
                <div className="grow">
                  <div className="text-lg text-slate-800 font-medium mb-1 wrap-break-word">{item.text}</div>
                  <div className="flex items-center space-x-4 text-xs font-bold text-slate-400">
                    <span className="flex items-center text-indigo-600">
                      <span className="material-symbols-outlined text-sm mr-1">thumb_up</span> {item.votes} votes
                    </span>
                    {!session.settings.oneVotePerTicket && (
                      <span
                        className="flex items-center text-indigo-600"
                        title={`${uniqueVoters} distinct participant${uniqueVoters === 1 ? '' : 's'} voted on this topic`}
                        data-testid="topic-unique-voters"
                      >
                        <span className="material-symbols-outlined text-sm mr-1">group</span>
                        {uniqueVoters} voter{uniqueVoters === 1 ? '' : 's'}
                      </span>
                    )}
                    {item.type === 'group' && (
                      <span className="flex items-center">
                        <span className="material-symbols-outlined text-sm mr-1">layers</span> Group
                      </span>
                    )}
                    {itemColumn && (
                      <span className="flex items-center">
                        <span className="material-symbols-outlined text-sm mr-1">{itemColumn.icon}</span>
                        <span>{itemColumn.title}</span>
                      </span>
                    )}
                  </div>

                  {item.type === 'group' && subItems.length > 0 && (
                    <div className="mt-3 pl-3 border-l-2 border-slate-200">
                      {subItems.map((sub) => (
                        <div key={sub.id} className="text-sm text-slate-500 mb-1 wrap-break-word">
                          {sub.text}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    handleToggleNextTopicVote(item.id);
                  }}
                  className={`ml-4 flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-bold transition shrink-0 ${hasVotedNext ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-300' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                  title={`${nextTopicVotesCount}/${participantsCount} voted to move on — vote to skip this discussion`}
                >
                  <span className="material-symbols-outlined text-sm">fast_forward</span>
                  <span>Move On</span>
                  {nextTopicVotesCount > 0 && (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-bold ${hasVotedNext ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-200 text-slate-700'}`}
                    >
                      {nextTopicVotesCount}/{participantsCount}
                    </span>
                  )}
                </button>
                <div className="flex flex-col items-center shrink-0 ml-2">
                  <span className="material-symbols-outlined text-slate-300">
                    {activeDiscussTicket === item.id ? 'expand_less' : 'expand_more'}
                  </span>
                  {activeDiscussTicket !== item.id && isFacilitator && (
                    <span className="text-[10px] text-indigo-400 font-medium whitespace-nowrap">Click to discuss</span>
                  )}
                </div>
              </div>

              {activeDiscussTicket === item.id && (
                <div className="bg-slate-50 border-t border-slate-100 p-4 rounded-b-xl">
                  <div className="mb-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Proposals</h4>
                    {/* Single list in creation order: accepting or rejecting keeps each row in place */}
                    {session.actions
                      .filter((action) => action.linkedTicketId != null && linkedIds.has(action.linkedTicketId) && (action.type === 'proposal' || action.type === 'new'))
                      .map((action) => {
                        if (action.type === 'new') {
                          return (
                            <div
                              key={action.id}
                              data-proposal-state="accepted"
                              className="flex items-center justify-between text-sm bg-emerald-50 p-2 rounded-sm border border-emerald-200 text-emerald-800 mb-2"
                            >
                              <span className="flex items-center min-w-0 wrap-break-word">
                                <span className="material-symbols-outlined text-emerald-600 mr-2 text-sm shrink-0">check_circle</span>
                                <span>Accepted: {action.text}</span>
                              </span>
                              {isFacilitator && (
                                <button
                                  onClick={() => handleUndoAcceptProposal(action.id)}
                                  className="ml-3 shrink-0 flex items-center text-emerald-600 hover:text-emerald-900 transition"
                                  title="Undo accept (back to proposals)"
                                  aria-label="Undo accept"
                                >
                                  <span className="material-symbols-outlined text-sm">undo</span>
                                </button>
                              )}
                            </div>
                          );
                        }

                        if (action.rejected) {
                          return (
                            <div
                              key={action.id}
                              data-proposal-state="rejected"
                              className="flex items-center justify-between text-sm bg-slate-100 p-2 rounded-sm border border-slate-200 text-slate-500 mb-2"
                            >
                              <span className="flex items-center min-w-0 wrap-break-word">
                                <span className="material-symbols-outlined text-slate-400 mr-2 text-sm shrink-0">block</span>
                                <span>Rejected: <span className="line-through">{action.text}</span></span>
                              </span>
                              {isFacilitator && (
                                <button
                                  onClick={() => handleUndoRejectProposal(action.id)}
                                  className="ml-3 shrink-0 flex items-center text-slate-400 hover:text-slate-700 transition"
                                  title="Undo reject (back to proposals)"
                                  aria-label="Undo reject"
                                >
                                  <span className="material-symbols-outlined text-sm">undo</span>
                                </button>
                              )}
                            </div>
                          );
                        }

                        return (
                          <ProposalActionRow
                            key={action.id}
                            proposal={action}
                            participants={session.participants || []}
                            currentUserId={currentUser.id}
                            isFacilitator={isFacilitator}
                            isEditing={editingProposalId === action.id}
                            editText={editingProposalText}
                            onEditTextChange={setEditingProposalText}
                            onStartEdit={() => handleStartEditProposal(action.id, action.text)}
                            onSaveEdit={() => handleSaveProposalEdit(action.id)}
                            onCancelEdit={handleCancelProposalEdit}
                            onVote={(vote) => handleVoteProposal(action.id, vote)}
                            onAccept={() => handleAcceptProposal(action.id)}
                            onReject={() => handleRejectProposal(action.id)}
                            onDelete={() => handleDeleteProposal(action.id)}
                            showVoteTypes={showVoteTypes}
                          />
                        );
                      })}
                  </div>
                  <div className="flex">
                    <input
                      type="text"
                      className="grow border border-slate-300 rounded-l p-2 text-sm outline-hidden focus:border-retro-primary bg-white text-slate-900"
                      placeholder="Propose an action..."
                      value={newProposalText}
                      onChange={(event) => {
                        setNewProposalText(event.target.value);
                        onProposalDraftChange?.(event.target.value);
                      }}
                      onBlur={() => onProposalActivityStop?.()}
                      onKeyDown={(event) => event.key === 'Enter' && handleAddProposal(item.id)}
                    />
                    <button
                      onClick={() => handleAddProposal(item.id)}
                      className="bg-slate-700 text-white px-3 font-bold text-sm hover:bg-slate-800 border-l border-slate-600"
                    >
                      Propose
                    </button>
                    {isFacilitator && (
                      <button
                        onClick={() => handleDirectAddAction(item.id)}
                        className="bg-retro-primary text-white px-3 rounded-r font-bold text-sm hover:bg-retro-primaryHover"
                        title="Directly Accept Action"
                      >
                        <span className="material-symbols-outlined text-sm">check</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DiscussPhase;
