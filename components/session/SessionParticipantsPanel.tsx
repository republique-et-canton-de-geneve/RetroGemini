import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { MessageKey } from '../../i18n/translate';
import { ParticipantActivity, Role, SessionInvitee, User } from '../../types';
import { pendingInvitees as selectPendingInvitees } from './sessionInvitees';

/**
 * The participants panel of every live session — a retrospective or a health
 * check. Everything both session types share lives here once: the roster with
 * presence, the facilitator's "has left" marking, the invitees still expected,
 * the collapse toggle and the invite button. What differs — what counts as
 * "done" in the current phase, the footer's progress line, the retro's
 * contribution dots and typing cue — is passed in by the session.
 *
 * The health check used to carry its own copy of this panel, and the copy
 * drifted: invitations sent from a health check never showed as "waiting to
 * join", nobody could be marked as having left, and collapsing it collapsed it
 * for everyone. Add a shared behaviour here, not in one session type.
 */

export type ParticipantRowStatus =
  /** Done for this phase. `strong` for a vote recorded, `soft` for "finished". */
  | { kind: 'check'; title: string; tone: 'strong' | 'soft' }
  /** Part-way through a round, e.g. 1 of 3 actions rated. */
  | { kind: 'progress'; done: number; total: number; title: string };

interface Props {
  participants: User[];
  /** Participants marked by the facilitator as having left (session.leftUsers). */
  leftUserIds?: readonly string[];
  /** Teammates invited by email from this session (session.invitedUsers). */
  invitedUsers?: SessionInvitee[];
  /**
   * The session hides who wrote what. Invitees are then counted, never named:
   * a name leaving the waiting list as "Participant 3" comes online would tell
   * everyone watching who Participant 3 is.
   */
  anonymous?: boolean;
  connectedUsers: Set<string>;
  currentUser: User;
  isFacilitator: boolean;
  isCollapsed: boolean;
  /** userId -> live "is typing" signal, shown in place of the role line. */
  activityUsers?: Record<string, ParticipantActivity>;
  /** Cards authored per participant. Omit to hide the contribution dots. */
  contributionCounts?: Record<string, number>;
  /** Right-hand marker of a participant who has not left; `null` for none. */
  memberStatus: (member: User) => ParticipantRowStatus | null;
  /** The progress line under the roster. */
  footer: React.ReactNode;
  onToggleCollapse: () => void;
  onInvite: () => void;
  /** Facilitator marks a participant as having left (or as returned). */
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

// The check is announced by what it means ("Vote recorded"), never by the
// icon font's ligature: a screen reader would otherwise read "check_circle".
const RowStatus: React.FC<{ status: ParticipantRowStatus }> = ({ status }) => {
  if (status.kind === 'progress') {
    return (
      <span className="text-[11px] font-bold text-slate-500 ml-2 shrink-0 self-start leading-5" title={status.title}>
        {status.done}/{status.total}
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={status.title}
      className={`material-symbols-outlined text-lg ml-2 shrink-0 self-start ${status.tone === 'strong' ? 'text-emerald-500' : 'text-emerald-400'}`}
      title={status.title}
    >
      check_circle
    </span>
  );
};

const SessionParticipantsPanel: React.FC<Props> = ({
  participants,
  leftUserIds,
  invitedUsers,
  anonymous = false,
  connectedUsers,
  currentUser,
  isFacilitator,
  isCollapsed,
  activityUsers,
  contributionCounts,
  memberStatus,
  footer,
  onToggleCollapse,
  onInvite,
  onToggleLeft,
  getMemberDisplay
}) => {
  const { t } = useTranslation();

  // Participants marked by the facilitator as having left mid-session stay
  // visible (faded, at the bottom) but are excluded from every counter.
  const leftSet = new Set(leftUserIds ?? []);
  const activeParticipants = participants.filter((p) => !leftSet.has(p.id));
  const leftParticipants = participants.filter((p) => leftSet.has(p.id));
  const orderedParticipants = [...activeParticipants, ...leftParticipants];

  // Teammates invited by email who have not connected yet: shown in their own
  // "waiting to join" section so the facilitator knows who is still expected.
  const pendingInvitees = selectPendingInvitees(participants, invitedUsers);

  return (
    <div className={`bg-white border-l border-slate-200 flex flex-col shrink-0 hidden lg:flex transition-all ${isCollapsed ? 'w-12' : 'w-64'}`}>
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        {!isCollapsed && (
          <h3 className="text-sm font-bold text-slate-700 flex items-center">
            <span className="material-symbols-outlined mr-2 text-lg" aria-hidden="true">groups</span>
            {t('phases.participants.title', { count: activeParticipants.length })}
          </h3>
        )}
        <button
          onClick={onToggleCollapse}
          className="text-slate-500 hover:text-slate-700 transition"
          title={isCollapsed ? t('phases.participants.expand') : t('phases.participants.collapse')}
          aria-label={isCollapsed ? t('phases.participants.expand') : t('phases.participants.collapse')}
        >
          <span className="material-symbols-outlined text-lg" aria-hidden="true">
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
              const isCurrentUser = member.id === currentUser.id;
              const isOnline = connectedUsers.has(member.id);
              const activity = activityUsers?.[member.id];
              const status = hasLeft ? null : memberStatus(member);
              return (
                <div
                  key={member.id}
                  data-testid="participant-row"
                  data-participant-left={hasLeft ? 'true' : undefined}
                  className={`flex items-center p-2 rounded-lg mb-1 group/row ${isCurrentUser ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
                >
                  {/* A departed participant is faded through the avatar only:
                      fading the whole row took its text below 4.5:1. */}
                  <div className="relative mr-3 shrink-0">
                    <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold ${hasLeft ? 'grayscale opacity-50' : ''}`}>
                      {initials}
                    </div>
                    {isOnline && !hasLeft && (
                      <div
                        className="absolute -top-0.5 -left-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white"
                        title={t('phases.participants.online')}
                      >
                        <span className="sr-only">{t('phases.participants.online')}</span>
                      </div>
                    )}
                  </div>
                  <div className="grow min-w-0">
                    <div className={`text-sm font-medium truncate ${isCurrentUser ? 'text-indigo-700' : hasLeft ? 'text-slate-500' : 'text-slate-700'}`}>
                      {displayName}
                      {isCurrentUser && <span className="text-xs text-indigo-600 ml-1">{t('phases.participants.you')}</span>}
                    </div>
                    {hasLeft ? (
                      <div
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 rounded-full px-1.5 py-0.5 mt-0.5"
                        title={t('phases.participants.leftTitle')}
                      >
                        <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">logout</span>
                        {t('phases.participants.left')}
                      </div>
                    ) : activity ? (
                      <TypingIndicator activity={activity} />
                    ) : (
                      <div className="text-xs text-slate-600 capitalize">
                        {ROLE_LABEL_KEY[member.role] ? t(ROLE_LABEL_KEY[member.role]) : member.role}
                      </div>
                    )}
                    {contributionCounts && !hasLeft && (
                      <ContributionDots count={contributionCounts[member.id] || 0} colorClass={member.color} />
                    )}
                  </div>
                  {isFacilitator && onToggleLeft && !isCurrentUser && (
                    <button
                      onClick={() => onToggleLeft(member.id)}
                      data-testid="toggle-left-btn"
                      // Hidden until hover only where hovering exists: a touch
                      // screen wide enough to show the panel (a tablet) has no
                      // hover, and an invisible control there can still be tapped.
                      className={`ml-2 shrink-0 self-start rounded p-1 min-w-6 min-h-6 transition ${
                        hasLeft
                          ? 'text-slate-500 hover:text-emerald-700'
                          : 'text-slate-500 hover:text-amber-600 [@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 focus:opacity-100'
                      }`}
                      title={hasLeft
                        ? t('phases.participants.markReturned', { name: displayName })
                        : t('phases.participants.markLeft', { name: displayName })}
                      aria-label={hasLeft
                        ? t('phases.participants.markReturned', { name: displayName })
                        : t('phases.participants.markLeft', { name: displayName })}
                    >
                      <span className="material-symbols-outlined text-lg" aria-hidden="true">{hasLeft ? 'undo' : 'logout'}</span>
                    </button>
                  )}
                  {status && <RowStatus status={status} />}
                </div>
              );
            })}

            {pendingInvitees.length > 0 && (
              <div className="mt-3 pt-3 border-t border-dashed border-slate-200" data-testid="invited-section">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center">
                  <span className="material-symbols-outlined text-sm mr-1" aria-hidden="true">schedule</span>
                  {t('phases.participants.invitedHeading', { count: pendingInvitees.length })}
                </div>
                {!anonymous && pendingInvitees.map((invitee) => (
                  <div
                    key={invitee.id}
                    data-testid="invited-row"
                    className="flex items-center p-2 rounded-lg mb-1"
                  >
                    <div className="w-8 h-8 rounded-full border-2 border-dashed border-slate-300 text-slate-500 flex items-center justify-center text-xs font-bold mr-3 shrink-0">
                      {invitee.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="grow min-w-0">
                      <div className="text-sm font-medium truncate text-slate-500">{invitee.name}</div>
                      <div
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-1.5 py-0.5 mt-0.5"
                        title={invitee.email
                          ? t('phases.participants.invitationSentTo', { email: invitee.email })
                          : t('phases.participants.invitationSent')}
                      >
                        <span className="material-symbols-outlined text-xs leading-none" aria-hidden="true">mail</span>
                        {t('phases.participants.invited')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-3 border-t border-slate-200 bg-slate-50">
            <div className="text-xs text-slate-500 text-center">{footer}</div>
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

export default SessionParticipantsPanel;
