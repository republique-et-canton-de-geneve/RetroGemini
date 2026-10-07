import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { ParticipantActivity, RetroSession, User } from '../../types';
import {
  impactRaters,
  impactRatingProgress,
  rateableRoundActions
} from './closedActionsForRating';
import SessionParticipantsPanel, { ParticipantRowStatus } from './SessionParticipantsPanel';

/**
 * The retrospective's participants panel: the shared SessionParticipantsPanel,
 * fed with what only a retro has — contribution dots per ticket, the typing
 * cue, the impact rating round, and its phase-by-phase progress line.
 */

interface Props {
  session: RetroSession;
  participants: User[];
  connectedUsers: Set<string>;
  currentUser: User;
  isFacilitator: boolean;
  isCollapsed: boolean;
  /** True while the team has the closed-action impact rating switched on. */
  ratingEnabled?: boolean;
  /** userId -> live "is typing" signal, shown next to the participant's name */
  activityUsers: Record<string, ParticipantActivity>;
  onToggleCollapse: () => void;
  onInvite: () => void;
  /** Facilitator marks a participant as having left the retro (or as returned) */
  onToggleLeft?: (userId: string) => void;
  getMemberDisplay: (member: User) => { displayName: string; initials: string };
}

const ParticipantsPanel: React.FC<Props> = ({
  session,
  participants,
  connectedUsers,
  currentUser,
  isFacilitator,
  isCollapsed,
  ratingEnabled = true,
  activityUsers,
  onToggleCollapse,
  onInvite,
  onToggleLeft,
  getMemberDisplay
}) => {
  const { t, tp } = useTranslation();
  // Tickets authored per participant (Brainstorm onwards). Computed here so the
  // panel updates live as cards are added.
  const ticketCounts: Record<string, number> = {};
  session.tickets.forEach((ticket) => {
    if (ticket.authorId) {
      ticketCounts[ticket.authorId] = (ticketCounts[ticket.authorId] || 0) + 1;
    }
  });
  const totalTickets = session.tickets.length;

  // Counters only count participants who have not left.
  const leftSet = new Set(session.leftUsers ?? []);
  const activeParticipants = participants.filter((p) => !leftSet.has(p.id));
  const activeIds = new Set(activeParticipants.map((p) => p.id));
  const countVotersAmongActive = (record: Record<string, number> | undefined) =>
    Object.keys(record || {}).filter((id) => activeIds.has(id)).length;
  const activeFinishedCount = (session.finishedUsers || []).filter((id) => activeIds.has(id)).length;

  // Impact rating round. Only live while the phase is actually asking about
  // something: with no closed action on the board there is nothing to report,
  // and a team that never rates must not be shown a counter stuck at 0.
  // `ratingEnabled` is passed in rather than derived: a team can switch the
  // feature off while a session that already built a round is still open, and
  // the panel must go quiet with the phase rather than keep reporting progress
  // on a block nobody can see any more.
  // Rateable, not listed: a round whose every row the facilitator postponed is
  // asking nobody for anything, and reporting "0 / 2 rated all actions" beside
  // it names people as owing an answer they cannot give.
  const ratingRoundSize = rateableRoundActions(session).length;
  const raters = impactRaters(activeParticipants, session.leftUsers);
  const ratingRoundLive =
    ratingEnabled && session.phase === 'OPEN_ACTIONS' && ratingRoundSize > 0 && raters.length > 0;
  const ratersDone = raters.filter((p) => impactRatingProgress(session, p.id).complete).length;

  const memberStatus = (member: User): ParticipantRowStatus | null => {
    // The facilitator seat does not vote, so it shows neither the check nor
    // the progress: an empty "0/2" beside it would read as someone the round
    // is still waiting for.
    if (ratingRoundLive && member.role !== 'facilitator') {
      const rating = impactRatingProgress(session, member.id);
      return rating.complete
        ? { kind: 'check', tone: 'strong', title: t('phases.participants.ratedAll') }
        : {
            kind: 'progress',
            done: rating.rated,
            total: rating.total,
            title: t('phases.participants.ratedSome', { rated: rating.rated, total: rating.total })
          };
    }
    const hasStageVote = session.phase === 'WELCOME'
      ? Boolean(session.happiness?.[member.id])
      : session.phase === 'CLOSE'
        ? Boolean(session.roti?.[member.id])
        : false;
    if (hasStageVote) {
      return { kind: 'check', tone: 'strong', title: t('phases.participants.voteRecorded') };
    }
    if (session.finishedUsers?.includes(member.id)) {
      return { kind: 'check', tone: 'soft', title: t('phases.participants.finished') };
    }
    return null;
  };

  const footer = ratingRoundLive
    ? t('phases.participants.footerRated', { done: ratersDone, total: raters.length })
    : session.phase === 'WELCOME'
      ? t('phases.participants.footerHappiness', {
          done: countVotersAmongActive(session.happiness),
          total: activeParticipants.length
        })
      : session.phase === 'CLOSE'
        ? t('phases.participants.footerRoti', {
            done: countVotersAmongActive(session.roti),
            total: activeParticipants.length
          })
        : session.phase === 'BRAINSTORM'
          ? tp('phases.participants.footerTickets', totalTickets)
          : t('phases.participants.footerFinished', { done: activeFinishedCount, total: activeParticipants.length });

  return (
    <SessionParticipantsPanel
      participants={participants}
      leftUserIds={session.leftUsers}
      invitedUsers={session.invitedUsers}
      anonymous={session.settings.isAnonymous}
      connectedUsers={connectedUsers}
      currentUser={currentUser}
      isFacilitator={isFacilitator}
      isCollapsed={isCollapsed}
      activityUsers={activityUsers}
      contributionCounts={totalTickets > 0 ? ticketCounts : undefined}
      memberStatus={memberStatus}
      footer={footer}
      onToggleCollapse={onToggleCollapse}
      onInvite={onInvite}
      onToggleLeft={onToggleLeft}
      getMemberDisplay={getMemberDisplay}
    />
  );
};

export default ParticipantsPanel;
