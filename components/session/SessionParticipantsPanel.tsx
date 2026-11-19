import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { MessageKey, Translator } from '../../i18n/translate';
import { ParticipantActivity, SessionInvitee, User } from '../../types';
import { pendingInvitees as selectPendingInvitees } from './sessionInvitees';
import { avatarColorClasses, DEPARTED_AVATAR_CLASSES, participantColorClass, participantToneHex } from '../../utils/participantColors';
import Avatar from '../common/Avatar';
import { joinNames, splitTypingNames, typingMembers } from '../../utils/typingNow';
import { usePanelMotion } from './usePanelMotion';
import { motionAllowed } from '../common/motion/effects';

/**
 * The participants panel of every live session — a retrospective or a health
 * check. Everything both session types share lives here once: the roster with
 * presence, the facilitator's "has left" marking, the invitees still expected,
 * the collapse toggle and the invite button. What differs (what counts as
 * "done" in the current phase, the footer's progress line, the retro's
 * contribution dots, the kind of typing its phase shows and the Vote phase's
 * votes left) is passed in by the session.
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

/**
 * A line in place of a participant's role: the Vote phase's votes still to place,
 * in words ("3 votes left"). Drawn at the role line's height, so the row keeps
 * its size when its person finishes and the line goes back to the role.
 */
export type ParticipantRowLine = { kind: 'votesLeft'; label: string };

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
  /**
   * The kind of typing the session's phase can show. The rows' cue and the line
   * above the list (on the collapsed rail, its count) read only this kind.
   * Omit for none: the health check passes none.
   */
  typingKind?: ParticipantActivity | null;
  /** Cards authored per participant. Omit to hide the contribution dots. */
  contributionCounts?: Record<string, number>;
  /** Right-hand marker of a participant who has not left; `null` for none. */
  memberStatus: (member: User) => ParticipantRowStatus | null;
  /** A line in place of the role of a participant who has not left; `null` for none. Omit for none. */
  memberLine?: (member: User) => ParticipantRowLine | null;
  /** The progress line under the roster. */
  footer: React.ReactNode;
  /** The panel's title, with `{count}` for the people listed who have not left, when "Participants (n)" is not what the list is. */
  headingKey?: MessageKey;
  /**
   * The viewer's own connection. Nothing animates while it is down, nor for
   * three seconds after it comes back (every roster is delivered again then).
   * Omit for a panel that counts as live.
   */
  isLive?: boolean;
  /** Changes when a change of the whole panel is not news: the phase. Omit for none. */
  motionScope?: string;
  onToggleCollapse: () => void;
  onInvite: () => void;
  /** Facilitator marks a participant as having left (or as returned). */
  onToggleLeft?: (userId: string) => void;
  // `avatarId`: the picture to draw (`sessionAvatarOf`), absent or null for initials.
  getMemberDisplay: (member: User) => { displayName: string; initials: string; avatarId?: string | null };
}

// Chosen by comparison, never looked up in an object: an unchecked value
// ('__proto__') found Object.prototype in a lookup, t() handed it back, and React
// refused to render it, blanking the panel.
const activityLabelKey = (kind: ParticipantActivity): MessageKey =>
  kind === 'proposal' ? 'phases.participants.activityProposal' : 'phases.participants.activityBrainstorm';

const activityIcon = (kind: ParticipantActivity): string => (kind === 'proposal' ? 'lightbulb' : 'stylus_note');

const typingLineKeys = (kind: ParticipantActivity): { named: MessageKey; count: MessageKey; nobody: MessageKey } =>
  kind === 'proposal'
    ? { named: 'phases.participants.typingNamedProposal', count: 'phases.participants.typingCountProposal', nobody: 'phases.participants.typingNobodyProposal' }
    : { named: 'phases.participants.typingNamedBrainstorm', count: 'phases.participants.typingCountBrainstorm', nobody: 'phases.participants.typingNobodyBrainstorm' };

// Every client writes its own `role` into the session (sessionGuard.js does not
// protect `participants`), so it is read as data: a '__proto__' role blanked the
// panel of both session types the way the typing signal did, and an object role
// did too.
const roleLabel = (role: unknown, t: Translator): string => {
  if (role === 'facilitator') return t('phases.participants.roleFacilitator');
  if (role === 'participant') return t('phases.participants.roleParticipant');
  return typeof role === 'string' ? role : '';
};

// Messaging-app style "is typing" cue in place of the role line: a contextual
// icon, a short label and three softly bouncing dots. One 16px line, the role
// line's height: its icon used to be a 24px glyph (the plain text-sm is inert on
// .material-symbols-outlined), which made a typing row 8px taller and moved every
// row below it. The icon is decoration, never read out.
const TypingIndicator: React.FC<{ activity: ParticipantActivity }> = ({ activity }) => {
  const { t } = useTranslation();
  const label = t(activityLabelKey(activity));
  return (
    <div className="flex items-center text-xs leading-4 font-semibold text-indigo-700 min-w-0" title={label}>
      <span className="material-symbols-outlined text-sm! leading-none mr-1 shrink-0" aria-hidden="true">{activityIcon(activity)}</span>
      <span className="truncate">{label}</span>
      <span className="flex items-center ml-1.5 gap-0.5 shrink-0" aria-hidden="true">
        <span className="typing-dot w-1 h-1 rounded-full bg-indigo-600" style={{ animationDelay: '0ms' }} />
        <span className="typing-dot w-1 h-1 rounded-full bg-indigo-600" style={{ animationDelay: '150ms' }} />
        <span className="typing-dot w-1 h-1 rounded-full bg-indigo-600" style={{ animationDelay: '300ms' }} />
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

// One height whatever the count (12px, the 12px words' line): the 'no tickets'
// line used to be 15px against the dots' 8px, so a first card shrank its
// author's row by 7px and moved every row below it.
const ContributionDots: React.FC<{ count: number; colorClass: string }> = ({ count, colorClass }) => {
  const { t, tp } = useTranslation();
  if (count <= 0) {
    return (
      <div className="flex items-center gap-1.5 mt-1 min-h-3 text-slate-600" title={t('phases.participants.noTicketsTitle')}>
        <span className="w-2 h-2 rounded-full border border-dashed border-slate-400 shrink-0" aria-hidden="true" />
        <span className="text-xs leading-none">{t('phases.participants.noTickets')}</span>
      </div>
    );
  }
  const overflowing = count > MAX_DOTS;
  const visibleDots = overflowing ? MAX_DOTS - 1 : count;
  const hidden = count - visibleDots;
  return (
    <div
      className="flex items-center gap-1 mt-1 min-h-3"
      title={tp('phases.participants.ticketsAdded', count)}
    >
      {Array.from({ length: visibleDots }).map((_, index) => (
        <span key={index} className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`} />
      ))}
      {overflowing && (
        <span className="text-xs font-semibold text-slate-600 leading-none ml-0.5 shrink-0 tabular-nums">+{hidden}</span>
      )}
    </div>
  );
};

// Every status is announced by what it means, never by the icon font's ligature:
// a screen reader would otherwise read "check". The check is the only sign on
// the row that its person is done: a green disc whose edge clears 1.4.11's 3:1
// on white and on the reader's indigo-100 row, emerald-700 (strong) and
// emerald-600 (soft), the white tick on it too (avatarInitialsContrast.test.tsx).
// `popping` springs it in when its person just finished (usePanelMotion).
const RowStatus: React.FC<{ status: ParticipantRowStatus; popping?: boolean }> = ({ status, popping = false }) => {
  switch (status.kind) {
    case 'progress':
      return (
        <span className="text-xs font-semibold text-slate-600 shrink-0 self-start leading-5 tabular-nums" title={status.title}>
          {status.done}/{status.total}
        </span>
      );
    case 'check':
      return (
        <span
          role="img"
          aria-label={status.title}
          data-row-check={status.tone}
          className={`w-5 h-5 mt-0.5 shrink-0 self-start rounded-full grid place-items-center text-white ${status.tone === 'strong' ? 'bg-emerald-700' : 'bg-emerald-600'} ${popping ? 'fx-pop' : ''}`}
          title={status.title}
        >
          <span className="material-symbols-outlined text-sm! leading-none" aria-hidden="true">check</span>
        </span>
      );
    default: {
      // A kind added to the union and not drawn here fails the type check;
      // it used to be drawn as a check.
      const unhandled: never = status;
      return unhandled;
    }
  }
};

// Words in place of the role, at the role line's height, so the row keeps its
// size when the line goes back to the role. Plain text with no role, aria-label
// or title: the words are its name, and nothing in it needs a hover. In the
// brand's ink, measured on white and on the reader's own indigo-100 row.
const RowLine: React.FC<{ line: ParticipantRowLine }> = ({ line }) => {
  switch (line.kind) {
    case 'votesLeft':
      return (
        <div className="flex min-w-0">
          <span
            data-testid="votes-left"
            className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs font-semibold leading-4 text-indigo-700 tabular-nums"
          >
            <span className="material-symbols-outlined shrink-0 text-xs! leading-none" aria-hidden="true">how_to_vote</span>
            <span className="min-w-0 truncate">{line.label}</span>
          </span>
        </div>
      );
    default: {
      // A kind added to the type and not drawn here fails the type check. Its
      // `kind` is what narrows: a type of one member is no union, so `line`
      // itself would never narrow to `never`.
      const unhandled: never = line.kind;
      return unhandled;
    }
  }
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
  typingKind,
  contributionCounts,
  memberStatus,
  memberLine,
  footer,
  headingKey = 'phases.participants.title',
  isLive = true,
  motionScope,
  onToggleCollapse,
  onInvite,
  onToggleLeft,
  getMemberDisplay
}) => {
  const { t, tp, locale } = useTranslation();

  // Participants marked by the facilitator as having left mid-session stay
  // visible (grey, at the bottom) but are excluded from every counter.
  const leftSet = new Set(leftUserIds ?? []);
  const activeParticipants = participants.filter((p) => !leftSet.has(p.id));
  const leftParticipants = participants.filter((p) => leftSet.has(p.id));
  const orderedParticipants = [...activeParticipants, ...leftParticipants];

  // Teammates invited by email who have not connected yet: shown in their own
  // "waiting to join" section so the facilitator knows who is still expected.
  const pendingInvitees = selectPendingInvitees(participants, invitedUsers);

  // Who is typing (utils/typingNow.ts): the rows draw their cue for exactly these
  // people, and the line above the list names them.
  const typists = typingMembers(participants, activityUsers, {
    kind: typingKind ?? null,
    currentUserId: currentUser.id,
    leftUserIds: leftUserIds ?? [],
  });
  const typistIds = new Set(typists.map((member) => member.id));
  const typingCount = typingKind ? t(typingLineKeys(typingKind).count, { count: typists.length }) : '';
  const typingLine = ((): { text: string; title?: string } | null => {
    if (!typingKind) return null;
    const keys = typingLineKeys(typingKind);
    if (typists.length === 0) return { text: t(keys.nobody) };
    // Counted, never named, as the invitees are.
    if (anonymous) return { text: typingCount };
    const names = typists.map((member) => getMemberDisplay(member).displayName);
    const { shown, others } = splitTypingNames(names);
    const listed = others > 0 ? [...shown, tp('phases.participants.typingOthers', others)] : shown;
    return {
      text: t(keys.named, { count: typists.length, names: joinNames(listed, locale) }),
      // Every name, for the hover: three lines fit every case measured (1 to 5,
      // 12 and 30 people, first and last names, both languages), but a longer
      // name can still be cut.
      title: t(keys.named, { count: typists.length, names: joinNames(names, locale) }),
    };
  })();

  // What just happened, for the motion (usePanelMotion): who came online, who
  // just finished, and the title's count. Read from the same lists the rows are
  // drawn from, so an effect never names a row that is not there.
  const statusOf = new Map(orderedParticipants.map((member) => [member.id, leftSet.has(member.id) ? null : memberStatus(member)]));
  const motion = usePanelMotion({
    presentIds: participants.filter((p) => connectedUsers.has(p.id)).map((p) => p.id),
    activeIds: activeParticipants.map((p) => p.id),
    checkedIds: activeParticipants.filter((p) => statusOf.get(p.id)?.kind === 'check').map((p) => p.id),
    count: activeParticipants.length,
    isCollapsed,
    isLive,
    scope: motionScope,
    currentUserId: currentUser.id,
  });
  const collapseLabel = isCollapsed ? t('phases.participants.expand') : t('phases.participants.collapse');

  return (
    <div
      data-testid="participants-panel"
      className={`bg-white border-l border-slate-200 flex flex-col shrink-0 hidden lg:flex transition-[width] duration-200 ${isCollapsed ? 'w-12' : 'w-64'}`}
    >
      <div className={`border-b border-slate-200 flex items-center py-3 ${isCollapsed ? 'justify-center px-2' : 'justify-between gap-2 pl-4 pr-2.5'}`}>
        {!isCollapsed && (
          <h3 className="min-w-0 text-sm font-semibold text-slate-900 flex items-center gap-2">
            <span className="material-symbols-outlined shrink-0 text-xl! leading-none text-slate-600" aria-hidden="true">groups</span>
            {/* The whole title bumps, from its left edge, when its count changes:
                the number is inside one translated sentence, and tests and
                people find the panel by that sentence. Keyed, so a second
                change restarts it. It wraps rather than cuts: cut, "Connectés en ce
                moment (3)" lost its count. */}
            <span key={motion.bump} className={`min-w-0 inline-block origin-left leading-5 tabular-nums ${motion.bump ? 'fx-bump' : ''}`}>
              {t(headingKey, { count: activeParticipants.length })}
            </span>
          </h3>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="shrink-0 w-8 h-8 grid place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          title={collapseLabel}
          aria-label={collapseLabel}
        >
          <span className="material-symbols-outlined text-xl! leading-none" aria-hidden="true">
            {isCollapsed ? 'chevron_left' : 'chevron_right'}
          </span>
        </button>
      </div>
      {/* The collapsed rail counts who is typing, never names them. It sits outside
          the expand button, so that button's name stays its words. */}
      {isCollapsed && typingKind && typists.length > 0 && (
        <div
          data-testid="typing-now-rail"
          role="img"
          aria-label={typingCount}
          title={typingCount}
          className="flex flex-col items-center gap-0.5 py-2.5 text-indigo-700"
        >
          <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">{activityIcon(typingKind)}</span>
          <span className="font-mono text-xs font-semibold leading-4 tabular-nums">{typists.length}</span>
        </div>
      )}
      {!isCollapsed && (
        <>
          {/* Pinned between the title and the list, outside its scroll, one height
              whatever it says (three lines reserved): a line that came, went or grew would
              move every row under the pointer, the hover-revealed "Mark as left" with them.
              Two lines cut the third first-and-last name in French and the "and N others"
              in English (review of 43.0).
              Not a live region: other people's typing changes too often to be announced. */}
          {typingKind && typingLine && (
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2.5">
              <p className="flex items-start gap-2 text-xs leading-4">
                {/* The pencil moves while someone writes (fx-write), and only then,
                    and never for a reader who asked for less motion (motionAllowed). */}
                <span
                  className={`material-symbols-outlined shrink-0 text-base! leading-none ${typists.length > 0 ? `text-indigo-700${motionAllowed() ? ' fx-write' : ''}` : 'text-slate-500'}`}
                  aria-hidden="true"
                >
                  {activityIcon(typingKind)}
                </span>
                <span
                  data-testid="typing-now"
                  title={typingLine.title}
                  className={`min-h-12 min-w-0 line-clamp-3 wrap-break-word ${typists.length > 0 ? 'font-semibold text-indigo-700' : 'text-slate-600'}`}
                >
                  {typingLine.text}
                </span>
              </p>
            </div>
          )}
          {/* No horizontal scroll: an arriving row slides in from 18px to the right. */}
          <div className="grow overflow-y-auto overflow-x-hidden p-2">
            {orderedParticipants.map((member) => {
              const { displayName, initials, avatarId } = getMemberDisplay(member);
              const hasLeft = leftSet.has(member.id);
              const isCurrentUser = member.id === currentUser.id;
              const isOnline = connectedUsers.has(member.id);
              const status = statusOf.get(member.id) ?? null;
              const line = hasLeft ? null : memberLine?.(member) ?? null;
              const arriving = motion.arriving.has(member.id);
              return (
                <div
                  key={member.id}
                  data-testid="participant-row"
                  data-participant-left={hasLeft ? 'true' : undefined}
                  // Relative and isolated so an arrival's wash (fx-person-in::before,
                  // in the person's own tone) sits behind the row's content. An
                  // arrival moves the row sideways only: its y and height are
                  // measured (e2e/retro-full-flow.spec.ts).
                  className={`relative isolate flex items-center gap-3 px-2.5 py-2 rounded-xl mb-0.5 group/row ${isCurrentUser ? 'bg-indigo-100' : 'hover:bg-slate-50'} ${arriving ? 'fx-person-in' : ''}`}
                  style={arriving ? ({ '--av-bg': participantToneHex(member.color).bg } as React.CSSProperties) : undefined}
                >
                  {/* A departed participant's avatar turns neutral grey, as
                      initials, never their picture; the "Left the session"
                      chip says why. Nothing here is faded:
                      fading the row, then the avatar, each put text below
                      4.5:1 (utils/participantColors.ts). */}
                  <div className="relative shrink-0">
                    <span className={`block rounded-full ${arriving ? 'fx-pop' : ''}`}>
                      <Avatar colorClasses={hasLeft ? DEPARTED_AVATAR_CLASSES : avatarColorClasses(member.color)} initials={initials} size={36} avatarId={hasLeft ? null : avatarId} />
                    </span>
                    {/* Ringed in the row's own surface, so it reads as a dot on the avatar's edge.
                        A picture has no disc and reaches its box's edge, so the dot
                        sits further out there, on the corner, rather than over the art. */}
                    {isOnline && !hasLeft && (
                      <div
                        data-presence-dot
                        className={`absolute ${avatarId ? '-bottom-1 -right-1.5' : '-bottom-0.5 -right-0.5'} w-3 h-3 rounded-full bg-emerald-600 border-2 ${isCurrentUser ? 'border-indigo-100' : 'border-white'} ${arriving ? 'fx-halo' : ''}`}
                        title={t('phases.participants.online')}
                      >
                        <span className="sr-only">{t('phases.participants.online')}</span>
                      </div>
                    )}
                  </div>
                  <div className="grow min-w-0">
                    <div className={`text-sm font-semibold leading-5 truncate ${hasLeft ? 'text-slate-500' : 'text-slate-900'}`}>
                      {displayName}
                      {isCurrentUser && <span className="text-xs font-normal text-slate-600 ml-1">{t('phases.participants.you')}</span>}
                    </div>
                    {hasLeft ? (
                      <div
                        className="inline-flex items-center gap-1 text-xs font-semibold leading-4 text-slate-700 bg-slate-100 border border-slate-200 rounded-full px-2 mt-0.5"
                        title={t('phases.participants.leftTitle')}
                      >
                        <span className="material-symbols-outlined text-xs! leading-none" aria-hidden="true">logout</span>
                        {t('phases.participants.left')}
                      </div>
                    ) : line ? (
                      <RowLine line={line} />
                    ) : typingKind && typistIds.has(member.id) ? (
                      <TypingIndicator activity={typingKind} />
                    ) : (
                      <div className="text-xs leading-4 text-slate-600 capitalize">{roleLabel(member.role, t)}</div>
                    )}
                    {contributionCounts && !hasLeft && (
                      <ContributionDots count={contributionCounts[member.id] || 0} colorClass={participantColorClass(member.color)} />
                    )}
                  </div>
                  {isFacilitator && onToggleLeft && !isCurrentUser && (
                    <button
                      onClick={() => onToggleLeft(member.id)}
                      data-testid="toggle-left-btn"
                      // Hidden until hover only where hovering exists: a touch
                      // screen wide enough to show the panel (a tablet) has no
                      // hover, and an invisible control there can still be tapped.
                      className={`shrink-0 self-start rounded-md p-0.5 min-w-6 min-h-6 grid place-items-center transition hover:bg-white focus-visible:outline-2 focus-visible:outline-indigo-600 ${
                        hasLeft
                          ? 'text-slate-600 hover:text-emerald-700'
                          : 'text-slate-600 hover:text-amber-700 [@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 focus:opacity-100'
                      }`}
                      title={hasLeft
                        ? t('phases.participants.markReturned', { name: displayName })
                        : t('phases.participants.markLeft', { name: displayName })}
                      aria-label={hasLeft
                        ? t('phases.participants.markReturned', { name: displayName })
                        : t('phases.participants.markLeft', { name: displayName })}
                    >
                      <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">{hasLeft ? 'undo' : 'logout'}</span>
                    </button>
                  )}
                  {status && <RowStatus status={status} popping={motion.finishing.has(member.id)} />}
                </div>
              );
            })}

            {pendingInvitees.length > 0 && (
              <div className="mt-2 pt-3 px-1 border-t border-dashed border-slate-300" data-testid="invited-section">
                <div className="px-1.5 text-xs font-semibold text-slate-600 mb-1.5 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm! leading-none" aria-hidden="true">schedule</span>
                  {t('phases.participants.invitedHeading', { count: pendingInvitees.length })}
                </div>
                {!anonymous && pendingInvitees.map((invitee) => (
                  <div
                    key={invitee.id}
                    data-testid="invited-row"
                    className="flex items-center gap-3 px-1.5 py-2 rounded-xl mb-0.5"
                  >
                    <div className="w-9 h-9 rounded-full border-2 border-dashed border-slate-400 text-slate-600 flex items-center justify-center text-xs font-semibold shrink-0" aria-hidden="true">
                      {invitee.name.substring(0, 2).toUpperCase()}
                    </div>
                    <div className="grow min-w-0">
                      <div className="text-sm font-semibold leading-5 truncate text-slate-600">{invitee.name}</div>
                      <div
                        className="inline-flex items-center gap-1 text-xs font-semibold leading-4 text-indigo-700 bg-indigo-50 rounded-full px-2 mt-0.5"
                        title={invitee.email
                          ? t('phases.participants.invitationSentTo', { email: invitee.email })
                          : t('phases.participants.invitationSent')}
                      >
                        <span className="material-symbols-outlined text-xs! leading-none" aria-hidden="true">mail</span>
                        {t('phases.participants.invited')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-3 border-t border-slate-200 flex flex-col gap-2.5">
            <div className="text-xs text-slate-600 text-center tabular-nums">{footer}</div>
            {isFacilitator && (
              <button
                type="button"
                onClick={onInvite}
                className="w-full bg-indigo-600 text-white py-2 rounded-lg font-semibold text-sm hover:bg-indigo-700 btn-brand-glow transition motion-safe:active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                {t('phases.participants.invite')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default SessionParticipantsPanel;
