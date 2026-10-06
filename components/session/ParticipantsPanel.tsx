import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { MessageKey } from '../../i18n/translate';
import { ParticipantActivity, Role, RetroSession, User } from '../../types';
import {
  impactRaters,
  impactRatingProgress,
  rateableRoundActions
} from './closedActionsForRating';

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

const ACTIVITY_LABEL_KEY: Record<ParticipantActivity, MessageKey> = {
  brainstorm: 'phases.participants.activityBrainstorm',
  proposal: 'phases.participants.activityProposal'
};

const ROLE_LABEL_KEY: Record<Role, MessageKey> = {
  facilitator: 'phases.participants.roleFacilitator',
  participant: 'phases.participants.roleParticipant'
};

const ACTIVITY_ICON: Record<ParticipantActivity, string> = {
  brainstorm: 'stylus_note',
  proposal: 'lightbulb'
};

// Messaging-app style "is typing" cue: a contextual icon, a short label and
// three softly bouncing dots. Shown in place of the role line while active.
const TypingIndicator: React.FC<{ activity: ParticipantActivity }> = ({ activity }) => {
  const { t } = useTranslation();
  const label = t(ACTIVITY_LABEL_KEY[activity]);
  return (
    <div
      className="flex items-center text-[11px] font-semibold text-retro-primary min-w-0"
      title={label}
    >
      <span className="material-symbols-outlined text-sm mr-1 shrink-0">{ACTIVITY_ICON[activity]}</span>
      <span className="truncate">{label}</span>
      <span className="flex items-center ml-1 space-x-0.5 shrink-0">
        <span className="typing-dot w-1 h-1 rounded-full bg-retro-primary" style={{ animationDelay: '0ms' }} />
        <span className="typing-dot w-1 h-1 rounded-full bg-retro-primary" style={{ animationDelay: '150ms' }} />
        <span className="typing-dot w-1 h-1 rounded-full bg-retro-primary" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  );
};

// One coloured dot per ticket authored, tinted with the member's avatar colour,
// so facilitators can count contributions at a glance and instantly spot who
// hasn't added anything. Counting dots (rather than a proportional bar) avoids
// implying a share of the whole. Heavy contributors who would overflow the row
// collapse into a "+N" chip; the exact total is always available on hover.
const MAX_DOTS = 9;

const ContributionDots: React.FC<{ count: number; colorClass: string }> = ({ count, colorClass }) => {
  const { t, tp } = useTranslation();
  if (count <= 0) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5 text-slate-300" title={t('phases.participants.noTicketsTitle')}>
        <span className="w-2 h-2 rounded-full border border-dashed border-slate-300 shrink-0" />
        <span className="text-[10px] font-medium tracking-wide">{t('phases.participants.noTickets')}</span>
      </div>
    );
  }
  const overflowing = count > MAX_DOTS;
  const visibleDots = overflowing ? MAX_DOTS - 1 : count;
  const hidden = count - visibleDots;
  return (
    <div
      className="flex items-center gap-1 mt-1.5"
      title={tp('phases.participants.ticketsAdded', count)}
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
  ratingEnabled = true,
  activityUsers,
  onToggleCollapse,
  onInvite,
  onToggleLeft,
  getMemberDisplay
}) => {
  const { t, tp } = useTranslation();
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

  // Participants marked by the facilitator as having left mid-session stay
  // visible (faded, at the bottom) but are excluded from every counter.
  const leftSet = new Set(session.leftUsers ?? []);
  const activeParticipants = participants.filter((p) => !leftSet.has(p.id));
  const leftParticipants = participants.filter((p) => leftSet.has(p.id));
  const orderedParticipants = [...activeParticipants, ...leftParticipants];
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

  // Teammates invited by email who have not connected yet: shown in their own
  // "waiting to join" section so the facilitator knows who is still expected
  // before starting — matched by id, name or email against joined participants.
  const joinedKeys = new Set<string>();
  participants.forEach((p) => {
    joinedKeys.add(p.id);
    joinedKeys.add(p.name.trim().toLowerCase());
    if (p.email) joinedKeys.add(p.email.trim().toLowerCase());
  });
  const pendingInvitees = (session.invitedUsers ?? []).filter(
    (invitee) =>
      !joinedKeys.has(invitee.id) &&
      !joinedKeys.has(invitee.name.trim().toLowerCase()) &&
      !(invitee.email && joinedKeys.has(invitee.email.trim().toLowerCase()))
  );

  return (
    <div className={`bg-white border-l border-slate-200 flex flex-col shrink-0 hidden lg:flex transition-all ${isCollapsed ? 'w-12' : 'w-64'}`}>
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        {!isCollapsed && (
          <h3 className="text-sm font-bold text-slate-700 flex items-center">
            <span className="material-symbols-outlined mr-2 text-lg">groups</span>
            {t('phases.participants.title', { count: activeParticipants.length })}
          </h3>
        )}
        <button
          onClick={onToggleCollapse}
          className="text-slate-500 hover:text-slate-700 transition"
          title={isCollapsed ? t('phases.participants.expand') : t('phases.participants.collapse')}
          aria-label={isCollapsed ? t('phases.participants.expand') : t('phases.participants.collapse')}
        >
          <span className="material-symbols-outlined text-lg">
            {isCollapsed ? 'chevron_left' : 'chevron_right'}
          </span>
        </button>
      </div>
      {!isCollapsed && (
        <>
          <div className="grow overflow-y-auto p-3">
            {orderedParticipants.map((member) => {
              const { displayName, initials } = getMemberDisplay(member);
              const hasLeft = leftSet.has(member.id);
              const isFinished = session.finishedUsers?.includes(member.id);
              const isCurrentUser = member.id === currentUser.id;
              const isOnline = connectedUsers.has(member.id);
              const hasHappinessVote = Boolean(session.happiness?.[member.id]);
              const hasRotiVote = Boolean(session.roti?.[member.id]);
              const hasStageVote = session.phase === 'WELCOME' ? hasHappinessVote : session.phase === 'CLOSE' ? hasRotiVote : false;
              const activity = activityUsers[member.id];
              const ticketCount = ticketCounts[member.id] || 0;
              // The facilitator seat does not vote, so it shows neither the
              // check nor the progress: an empty "0/2" beside it would read as
              // someone the round is still waiting for.
              const rating =
                ratingRoundLive && !hasLeft && member.role !== 'facilitator'
                  ? impactRatingProgress(session, member.id)
                  : null;
              return (
                <div
                  key={member.id}
                  data-testid="participant-row"
                  data-participant-left={hasLeft ? 'true' : undefined}
                  className={`flex items-center p-2 rounded-lg mb-1 group/row ${hasLeft ? 'opacity-60' : ''} ${isCurrentUser ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  <div className="relative mr-3 shrink-0">
                    <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold ${hasLeft ? 'grayscale' : ''}`}>
                      {initials}
                    </div>
                    {isOnline && !hasLeft && (
                      <div
                        className="absolute -top-0.5 -left-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"
                        title={t('phases.participants.online')}
                      />
                    )}
                  </div>
                  <div className="grow min-w-0">
                    <div className={`text-sm font-medium truncate ${isCurrentUser ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {displayName}
                      {isCurrentUser && <span className="text-xs text-indigo-600 ml-1">{t('phases.participants.you')}</span>}
                    </div>
                    {hasLeft ? (
                      <div
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-1.5 py-0.5 mt-0.5"
                        title={t('phases.participants.leftTitle')}
                      >
                        <span className="material-symbols-outlined text-xs leading-none">logout</span>
                        {t('phases.participants.left')}
                      </div>
                    ) : activity ? (
                      <TypingIndicator activity={activity} />
                    ) : (
                      <div className="text-xs text-slate-600 capitalize">
                        {ROLE_LABEL_KEY[member.role] ? t(ROLE_LABEL_KEY[member.role]) : member.role}
                      </div>
                    )}
                    {showContributions && !hasLeft && (
                      <ContributionDots count={ticketCount} colorClass={member.color} />
                    )}
                  </div>
                  {isFacilitator && onToggleLeft && !isCurrentUser && (
                    <button
                      onClick={() => onToggleLeft(member.id)}
                      data-testid="toggle-left-btn"
                      className={`ml-2 shrink-0 self-start rounded p-0.5 transition ${
                        hasLeft
                          ? 'text-slate-500 hover:text-emerald-700'
                          : 'text-slate-300 hover:text-amber-600 opacity-0 group-hover/row:opacity-100 focus:opacity-100'
                      }`}
                      title={hasLeft
                        ? t('phases.participants.markReturned', { name: displayName })
                        : t('phases.participants.markLeft', { name: displayName })}
                      aria-label={hasLeft
                        ? t('phases.participants.markReturned', { name: displayName })
                        : t('phases.participants.markLeft', { name: displayName })}
                    >
                      <span className="material-symbols-outlined text-lg">{hasLeft ? 'undo' : 'logout'}</span>
                    </button>
                  )}
                  {rating ? (
                    rating.complete ? (
                      <span
                        className="material-symbols-outlined text-lg ml-2 shrink-0 self-start text-emerald-500"
                        title={t('phases.participants.ratedAll')}
                      >
                        check_circle
                      </span>
                    ) : (
                      <span
                        className="text-[11px] font-bold text-slate-500 ml-2 shrink-0 self-start leading-5"
                        title={t('phases.participants.ratedSome', { rated: rating.rated, total: rating.total })}
                      >
                        {rating.rated}/{rating.total}
                      </span>
                    )
                  ) : (
                    !hasLeft && (isFinished || hasStageVote) && (
                      <span
                        className={`material-symbols-outlined text-lg ml-2 shrink-0 self-start ${hasStageVote ? 'text-emerald-500' : 'text-emerald-400'}`}
                        title={hasStageVote ? t('phases.participants.voteRecorded') : t('phases.participants.finished')}
                      >
                        check_circle
                      </span>
                    )
                  )}
                </div>
              );
            })}

            {pendingInvitees.length > 0 && (
              <div className="mt-3 pt-3 border-t border-dashed border-slate-200" data-testid="invited-section">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center">
                  <span className="material-symbols-outlined text-sm mr-1">schedule</span>
                  {t('phases.participants.invitedHeading', { count: pendingInvitees.length })}
                </div>
                {pendingInvitees.map((invitee) => (
                  <div
                    key={invitee.id}
                    data-testid="invited-row"
                    className="flex items-center p-2 rounded-lg mb-1 opacity-70"
                  >
                    <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold mr-3 shrink-0">
                      {invitee.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="grow min-w-0">
                      <div className="text-sm font-medium truncate text-slate-500">{invitee.name}</div>
                      <div
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-500 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.5 mt-0.5"
                        title={invitee.email
                          ? t('phases.participants.invitationSentTo', { email: invitee.email })
                          : t('phases.participants.invitationSent')}
                      >
                        <span className="material-symbols-outlined text-xs leading-none">mail</span>
                        {t('phases.participants.invited')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-3 border-t border-slate-200 bg-slate-50">
            {ratingRoundLive ? (
              <div className="text-xs text-slate-500 text-center">
                {t('phases.participants.footerRated', { done: ratersDone, total: raters.length })}
              </div>
            ) : session.phase === 'WELCOME' ? (
              <div className="text-xs text-slate-500 text-center">
                {t('phases.participants.footerHappiness', {
                  done: countVotersAmongActive(session.happiness),
                  total: activeParticipants.length
                })}
              </div>
            ) : session.phase === 'CLOSE' ? (
              <div className="text-xs text-slate-500 text-center">
                {t('phases.participants.footerRoti', {
                  done: countVotersAmongActive(session.roti),
                  total: activeParticipants.length
                })}
              </div>
            ) : session.phase === 'BRAINSTORM' ? (
              <div className="text-xs text-slate-500 text-center">
                {tp('phases.participants.footerTickets', totalTickets)}
              </div>
            ) : (
              <div className="text-xs text-slate-500 text-center">
                {t('phases.participants.footerFinished', { done: activeFinishedCount, total: activeParticipants.length })}
              </div>
            )}
          </div>
          {isFacilitator && (
            <div className="p-3 border-t border-slate-200">
              <button
                onClick={onInvite}
                className="w-full bg-retro-primary text-white py-2 rounded-lg font-bold text-sm hover:bg-retro-primaryHover"
              >
                {t('phases.participants.invite')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ParticipantsPanel;
