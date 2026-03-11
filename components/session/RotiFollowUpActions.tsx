import React from 'react';
import { ActionItem, User } from '../../types';
import ProposalActionRow from './ProposalActionRow';
import { ROTI_FOLLOW_UP_LINK_ID } from './retroConstants';

interface Props {
  actions: ActionItem[];
  participants: User[];
  currentUserId: string;
  isFacilitator: boolean;
  assignableMembers: User[];
  showVoteTypes: boolean;
  proposalText: string;
  onProposalTextChange: (value: string) => void;
  onVoteProposal: (actionId: string, vote: 'up' | 'down' | 'neutral') => void;
  onAcceptProposal: (actionId: string, assigneeId?: string | null) => void;
  onDeleteProposal: (actionId: string) => void;
  onAddProposal: (topicId: string, proposalText?: string) => void;
  onDirectAddAction: (topicId: string, proposalText?: string) => void;
  onAssignAction: (actionId: string, assigneeId: string | null) => void;
}

const RotiFollowUpActions: React.FC<Props> = ({
  actions,
  participants,
  currentUserId,
  isFacilitator,
  assignableMembers,
  showVoteTypes,
  proposalText,
  onProposalTextChange,
  onVoteProposal,
  onAcceptProposal,
  onDeleteProposal,
  onAddProposal,
  onDirectAddAction,
  onAssignAction
}) => {
  const rotiProposals = actions.filter(
    (action) => action.linkedTicketId === ROTI_FOLLOW_UP_LINK_ID && action.type === 'proposal'
  );
  const rotiAcceptedActions = actions.filter(
    (action) => action.linkedTicketId === ROTI_FOLLOW_UP_LINK_ID && action.type === 'new'
  );

  return (
    <div className="mt-8 text-left">
      <div className="mb-3">
        <h4 className="text-lg font-bold text-white">ROTI Follow-up Actions</h4>
      </div>

      {rotiProposals.length > 0 && (
        <div className="mb-4">
          {rotiProposals.map((proposal) => (
            <ProposalActionRow
              key={proposal.id}
              proposal={proposal}
              participants={participants}
              currentUserId={currentUserId}
              isFacilitator={isFacilitator}
              isEditing={false}
              editText=""
              onEditTextChange={() => {}}
              onStartEdit={() => {}}
              onSaveEdit={() => {}}
              onCancelEdit={() => {}}
              onVote={(vote) => onVoteProposal(proposal.id, vote)}
              onAccept={() => onAcceptProposal(proposal.id, null)}
              onDelete={() => onDeleteProposal(proposal.id)}
              showVoteTypes={showVoteTypes}
              surface="dark"
            />
          ))}
        </div>
      )}

      {rotiAcceptedActions.length > 0 && (
        <div className="mb-4 space-y-2">
          {rotiAcceptedActions.map((action) => (
            <div
              key={action.id}
              className="flex items-center justify-between bg-emerald-500/10 border border-emerald-400/40 rounded p-3"
            >
              <div className="text-sm text-emerald-100">
                <span className="material-symbols-outlined text-sm align-middle mr-1">check_circle</span>
                {action.text}
              </div>
              {isFacilitator ? (
                <select
                  value={action.assigneeId || ''}
                  onChange={(event) => onAssignAction(action.id, event.target.value || null)}
                  className="text-xs border border-slate-500 rounded p-1.5 bg-slate-900 text-slate-100 outline-none"
                >
                  <option value="">Unassigned</option>
                  {assignableMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-slate-300">
                  {action.assigneeId
                    ? `Owner: ${assignableMembers.find((member) => member.id === action.assigneeId)?.name || 'Unknown'}`
                    : 'Unassigned'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex">
        <input
          type="text"
          className="flex-grow border border-slate-600 rounded-l p-2 text-sm outline-none focus:border-retro-primary bg-slate-900 text-white"
          placeholder="Propose a follow-up action from ROTI feedback..."
          value={proposalText}
          onChange={(event) => onProposalTextChange(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && onAddProposal(ROTI_FOLLOW_UP_LINK_ID, proposalText)}
        />
        <button
          onClick={() => onAddProposal(ROTI_FOLLOW_UP_LINK_ID, proposalText)}
          className="bg-slate-700 text-white px-3 font-bold text-sm hover:bg-slate-600 border-l border-slate-600"
        >
          Propose
        </button>
        {isFacilitator && (
          <button
            onClick={() => onDirectAddAction(ROTI_FOLLOW_UP_LINK_ID, proposalText)}
            className="bg-retro-primary text-white px-3 rounded-r font-bold text-sm hover:bg-retro-primaryHover"
            title="Directly Accept Action"
          >
            <span className="material-symbols-outlined text-sm">check</span>
          </button>
        )}
      </div>
    </div>
  );
};

export default RotiFollowUpActions;
