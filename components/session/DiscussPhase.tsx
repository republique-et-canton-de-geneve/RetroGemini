import React from 'react';
import { RetroSession, User } from '../../types';

interface DiscussItem {
  id: string;
  text: string;
  votes: number;
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
  handleAddProposal: (topicId: string) => void;
  newProposalText: string;
  setNewProposalText: (value: string) => void;
  handleDirectAddAction: (topicId: string) => void;
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
  handleAddProposal,
  newProposalText,
  setNewProposalText,
  handleDirectAddAction,
  setPhase
}) => (
  <div className="flex flex-col h-full overflow-hidden bg-slate-50">
    <div className="bg-white border-b px-6 py-3 flex justify-between items-center shadow-sm z-30 shrink-0">
      <span className="font-bold text-slate-700 text-lg">Discuss & Propose Actions</span>
      {isFacilitator && (
        <button
          onClick={() => setPhase('REVIEW')}
          className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover"
        >
          Next Phase
        </button>
      )}
    </div>
    <div className="flex-grow overflow-auto p-6 max-w-4xl mx-auto w-full space-y-4">
      {sortedItems.map((item) => {
        const subItems = item.type === 'group' ? session.tickets.filter((ticket) => ticket.groupId === item.id) : [];
        const nextTopicVotes = session.discussionNextTopicVotes?.[item.id] || [];
        const nextTopicVotesCount = nextTopicVotes.length;
        const hasVotedNext = nextTopicVotes.includes(currentUser.id);
        const itemColumn = session.columns.find((column) => column.id === item.ref.colId);

        return (
          <div
            ref={(element) => {
              discussRefs.current[item.id] = element;
            }}
            key={item.id}
            className={`bg-white rounded-xl shadow-sm border-2 transition ${activeDiscussTicket === item.id ? 'border-retro-primary ring-4 ring-indigo-50' : 'border-slate-200'}`}
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
              <div className="flex-grow">
                <div className="text-lg text-slate-800 font-medium mb-1 break-words">{item.text}</div>
                <div className="flex items-center space-x-4 text-xs font-bold text-slate-400">
                  <span className="flex items-center text-indigo-600">
                    <span className="material-symbols-outlined text-sm mr-1">thumb_up</span> {item.votes} votes
                  </span>
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
                      <div key={sub.id} className="text-sm text-slate-500 mb-1 break-words">
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
                title={`${nextTopicVotesCount}/${participantsCount} want to move on`}
              >
                <span className="material-symbols-outlined text-sm">skip_next</span>
                <span>Next Topic</span>
                {nextTopicVotesCount > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${hasVotedNext ? 'bg-indigo-200 text-indigo-800' : 'bg-slate-200 text-slate-700'}`}
                  >
                    {nextTopicVotesCount}/{participantsCount}
                  </span>
                )}
              </button>
              <span className="material-symbols-outlined text-slate-300 shrink-0 ml-2">
                {activeDiscussTicket === item.id ? 'expand_less' : 'expand_more'}
              </span>
            </div>

            {activeDiscussTicket === item.id && (
              <div className="bg-slate-50 border-t border-slate-100 p-4 rounded-b-xl">
                <div className="mb-4">
                  <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Proposals</h4>
                  {session.actions
                    .filter((action) => action.linkedTicketId === item.id && action.type === 'proposal')
                    .map((proposal) => {
                      const upVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'up').length;
                      const neutralVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'neutral').length;
                      const downVotes = Object.values(proposal.proposalVotes || {}).filter((vote) => vote === 'down').length;
                      const totalVotes = upVotes + neutralVotes + downVotes;
                      const myVote = proposal.proposalVotes?.[currentUser.id];
                      const isEditing = editingProposalId === proposal.id;

                      return (
                        <div key={proposal.id} className="bg-white p-3 rounded border border-slate-200 mb-2">
                          {isEditing ? (
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={editingProposalText}
                                onChange={(event) => setEditingProposalText(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') handleSaveProposalEdit(proposal.id);
                                  if (event.key === 'Escape') handleCancelProposalEdit();
                                }}
                                className="flex-grow border border-slate-300 rounded p-2 text-sm outline-none focus:border-retro-primary bg-white text-slate-900"
                                autoFocus
                              />
                              <button
                                onClick={() => handleSaveProposalEdit(proposal.id)}
                                className="bg-emerald-500 text-white px-3 py-2 rounded text-xs font-bold hover:bg-emerald-600"
                              >
                                <span className="material-symbols-outlined text-sm">check</span>
                              </button>
                              <button
                                onClick={handleCancelProposalEdit}
                                className="bg-slate-300 text-slate-700 px-3 py-2 rounded text-xs font-bold hover:bg-slate-400"
                              >
                                <span className="material-symbols-outlined text-sm">close</span>
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2 flex-grow mr-3">
                                <span
                                  className={`text-slate-700 text-sm font-medium ${isFacilitator ? 'cursor-pointer hover:text-indigo-600' : ''}`}
                                  onClick={() => isFacilitator && handleStartEditProposal(proposal.id, proposal.text)}
                                  title={isFacilitator ? 'Click to edit' : ''}
                                >
                                  {proposal.text}
                                </span>
                                {isFacilitator && (
                                  <button
                                    onClick={() => handleDeleteProposal(proposal.id)}
                                    className="text-slate-400 hover:text-red-600 transition"
                                    title="Delete proposal"
                                  >
                                    <span className="material-symbols-outlined text-sm">delete</span>
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center space-x-3">
                                <div className="flex bg-slate-100 rounded-lg p-1 space-x-1">
                                  <button
                                    onClick={() => handleVoteProposal(proposal.id, 'up')}
                                    className={`px-2 py-1 rounded flex items-center transition ${myVote === 'up' ? 'bg-emerald-100 text-emerald-700 shadow-sm' : 'hover:bg-white text-slate-500'}`}
                                  >
                                    <span className="material-symbols-outlined text-sm mr-1">thumb_up</span>
                                    <span className="text-xs font-bold">{upVotes > 0 ? upVotes : ''}</span>
                                  </button>
                                  <button
                                    onClick={() => handleVoteProposal(proposal.id, 'neutral')}
                                    className={`px-2 py-1 rounded flex items-center transition ${myVote === 'neutral' ? 'bg-slate-300 text-slate-800 shadow-sm' : 'hover:bg-white text-slate-500'}`}
                                  >
                                    <span className="material-symbols-outlined text-sm mr-1">remove</span>
                                    <span className="text-xs font-bold">{neutralVotes > 0 ? neutralVotes : ''}</span>
                                  </button>
                                  <button
                                    onClick={() => handleVoteProposal(proposal.id, 'down')}
                                    className={`px-2 py-1 rounded flex items-center transition ${myVote === 'down' ? 'bg-red-100 text-red-700 shadow-sm' : 'hover:bg-white text-slate-500'}`}
                                  >
                                    <span className="material-symbols-outlined text-sm mr-1">thumb_down</span>
                                    <span className="text-xs font-bold">{downVotes > 0 ? downVotes : ''}</span>
                                  </button>
                                </div>
                                <div className="text-[11px] font-bold text-slate-500 px-2 py-1 bg-slate-100 rounded">
                                  Total: {totalVotes}
                                </div>
                                {isFacilitator && (
                                  <button
                                    onClick={() => handleAcceptProposal(proposal.id)}
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
                    })}
                  {session.actions
                    .filter((action) => action.linkedTicketId === item.id && action.type === 'new')
                    .map((action) => (
                      <div
                        key={action.id}
                        className="flex items-center text-sm bg-emerald-50 p-2 rounded border border-emerald-200 text-emerald-800 mb-2"
                      >
                        <span className="material-symbols-outlined text-emerald-600 mr-2 text-sm">check_circle</span>
                        Accepted: {action.text}
                      </div>
                    ))}
                </div>
                <div className="flex">
                  <input
                    type="text"
                    className="flex-grow border border-slate-300 rounded-l p-2 text-sm outline-none focus:border-retro-primary bg-white text-slate-900"
                    placeholder="Propose an action..."
                    value={newProposalText}
                    onChange={(event) => setNewProposalText(event.target.value)}
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

export default DiscussPhase;
