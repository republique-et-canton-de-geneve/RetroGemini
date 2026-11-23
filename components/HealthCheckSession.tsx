
import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Team, User, HealthCheckSession as HealthCheckSessionType, HealthCheckDimension, ActionItem, JiraLink, MemberAvatarChoice } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import { randomId } from '../utils/randomId';
import InviteModal from './InviteModal';
import ProposalActionRow from './session/ProposalActionRow';
import ProposalNumber from './session/ProposalNumber';
import { numberTopicProposals } from './session/proposalNumbering';
import RotiFollowUpActions from './session/RotiFollowUpActions';
import HealthCheckCommentsSection from './session/HealthCheckCommentsSection';
import SessionParticipantsPanel, { ParticipantRowStatus } from './session/SessionParticipantsPanel';
import SessionTimer from './session/SessionTimer';
import { recordInvitees } from './session/sessionInvitees';
import { ROTI_FOLLOW_UP_LINK_ID } from './session/retroConstants';
import {
  mergeRemoteHealthCheckSession,
  registerPendingCreation,
  registerOwnHealthCheckChanges,
  extendOwnChanges,
  scheduleSessionResend,
  OwnChangeLedger,
  PendingCreation
} from './session/mergeRemoteSession';
import { getAssignableMembers } from './session/assignableMembers';
import { memberJoinedChange, mergeRosterIntoParticipants, sessionParticipants } from './session/sessionRoster';
import { useHoldOwnStateWhileStalled } from './session/useHoldOwnStateWhileStalled';
import { useDoubleGestureGuard } from './session/doubleGestureGuard';
import SyncStalledBanner from './session/SyncStalledBanner';
import { JOIN_DENIED_REVOKED, SessionConnectionBanner, SessionSyncChip } from './session/SessionConnectionStatus';
import { isSessionLive, useSessionRevoked } from './session/useSessionRevoked';
import LanguageSwitcher from './common/LanguageSwitcher';
import { useTranslation } from '../i18n/I18nContext';
import { localizeDecimal } from '../i18n/formatNumber';
import type { MessageKey } from '../i18n/translate';
import { effectiveSessionStatus } from '../utils/sessionStatus';
import { getHealthCheckPhaseDefaultTimerSeconds, resetTimer } from '../utils/sessionTimer';
import JiraActionControl from './jira/JiraActionControl';
import JiraBatchButton from './jira/JiraBatchButton';
import JiraDiscoveryNote from './jira/JiraDiscoveryNote';
import JiraParentLine from './jira/JiraParentLine';
import { withJiraLinkFrom } from './jira/jiraLinkMerge';
import { useJiraStatus } from './jira/useJiraStatus';
import { avatarColorClasses } from '../utils/participantColors';
import AvatarPicker from './common/AvatarPicker';
import ViewerAvatarButton from './session/ViewerAvatarButton';
import { useOwnAvatar } from './session/useOwnAvatar';
import { isAnonymousSession, sessionAvatarOf, stampOwnAvatarEntry, viewerInitials } from './session/sessionAvatars';
import AvatarDiscoveryHint from './common/AvatarDiscoveryHint';
import { useAvatarDiscoveryHint } from './common/useAvatarDiscoveryHint';

interface Props {
  team: Team;
  currentUser: User;
  sessionId: string;
  onExit: () => void;
  onTeamUpdate?: (team: Team) => void;
  // Called when the server refuses the socket join: the credential is gone,
  // expired or belongs to another team, so the only way out is the login
  // screen (audit H12). Falls back to `onExit` when the host does not wire it.
  onSessionExpired?: () => void;
  // Shows the avatar map the viewer's pick resolved with (the server's
  // answer merged into the cached team's).
  onTeamAvatars?: (teamId: string, memberAvatars: Record<string, MemberAvatarChoice>) => void;
}

const PHASES = ['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSE'] as const;

// Scores keep their one-decimal `toFixed` rounding, so English output is
// unchanged; only the decimal mark follows the reader's locale (3,5 in fr-CH).
const formatScore = (value: number, locale: string): string => localizeDecimal(value.toFixed(1), locale);

// Component for displaying and editing accepted actions in DISCUSS phase
const AcceptedActionRow: React.FC<{
  action: ActionItem;
  isFacilitator: boolean;
  onUpdate: (text: string) => void;
  onDelete: () => void;
  number?: number;
}> = ({ action, isFacilitator, onUpdate, onDelete, number }) => {
  const { t } = useTranslation();
  const [editText, setEditText] = useState(action.text);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setEditText(action.text);
    setConfirmingDelete(false);
  }, [action.text, action.id]);

  const handleUpdateAction = () => {
    if (!editText.trim() || editText === action.text) return;
    onUpdate(editText.trim());
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-200 mb-2" data-proposal-state="accepted">
      {number !== undefined && <ProposalNumber number={number} />}
      <span className="material-symbols-outlined text-emerald-700 text-base! leading-none" aria-hidden="true">check_circle</span>
      <span className="text-emerald-800 font-semibold text-xs">{t('healthCheck.discuss.accepted')}</span>
      {isFacilitator ? (
        <input
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleUpdateAction}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleUpdateAction();
            }
          }}
          className="grow basis-40 min-w-0 bg-white border border-slate-400 rounded-lg px-2.5 py-1.5 text-slate-900 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 transition"
        />
      ) : (
        <span className="grow min-w-0 text-slate-900 wrap-break-word">{action.text}</span>
      )}
      {isFacilitator && (
        <div className="shrink-0">
          {!confirmingDelete ? (
            // Shown at rest, so it reads at 3:1 on the green row (emerald-400
            // measured 1.9:1); the hover says what it does.
            <button
              onClick={() => setConfirmingDelete(true)}
              className="grid place-items-center w-8 h-8 rounded-lg text-emerald-800 hover:bg-rose-50 hover:text-rose-700 transition"
              aria-label={t('healthCheck.discuss.deleteAction')}
            >
              <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">delete</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1 shadow-xs">
              <span className="text-slate-600">{t('healthCheck.discuss.confirmDelete')}</span>
              <button className="text-rose-700 font-semibold rounded-md px-1.5 py-0.5 hover:bg-rose-50" onClick={onDelete}>{t('common.yes')}</button>
              <button className="text-slate-600 font-semibold rounded-md px-1.5 py-0.5 hover:bg-slate-100" onClick={() => setConfirmingDelete(false)}>{t('common.no')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const isHealthCheckSession = (session: unknown): session is HealthCheckSessionType => {
  if (!session || typeof session !== 'object') return false;
  const candidate = session as Partial<HealthCheckSessionType>;
  return !!candidate.templateId && Array.isArray(candidate.dimensions);
};

const HealthCheckSession: React.FC<Props> = ({ team, currentUser, sessionId, onExit, onTeamUpdate, onSessionExpired, onTeamAvatars }) => {
  const { t, tp, locale } = useTranslation();
  // The next press of a double click, or the next tap of a double tap, presses
  // nothing on another control than the first: the retrospective's guard, the
  // same module (pass 17 of 42.1). A double click on a proposal's Cancel
  // deleted it, one on its Delete deleted the next one too, for everyone.
  useDoubleGestureGuard();
  const [session, setSession] = useState<HealthCheckSessionType | undefined>(
    team.healthChecks?.find(h => h.id === sessionId)
  );
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set([currentUser.id]));
  // The panel's rows come from the cached session until the server's roster:
  // its motion compares nothing before it (usePanelMotion). Per connection,
  // as in a retrospective: put down whenever the session stops being live
  // (setIsLive below), so the roster a reconnection brings back is no news.
  const [rosterReceived, setRosterReceived] = useState(false);
  // Optimistic by default: pause editing only after a confirmed disconnect (see
  // Session.tsx) so the initial connecting window and tests still allow edits.
  const [isLive, setLiveState] = useState<boolean>(true);
  const setIsLive = useCallback((live: boolean) => {
    setLiveState(live);
    if (!live) setRosterReceived(false);
  }, []);
  const isLiveRef = useRef<boolean>(true);
  // Set when the server refuses the join (audit H12). Unlike a disconnection
  // this never heals on its own, so it must survive a later `connect` event.
  const [joinDeniedReason, setJoinDeniedReason] = useState<string | null>(null);
  const joinDeniedRef = useRef<string | null>(null);
  // Decision D3b: the team's password was changed under this session (see
  // Session.tsx; the behaviour is the shared hook's).
  const sessionRevoked = useSessionRevoked({ isLiveRef, setIsLive, joinDeniedRef });
  const deniedReason = sessionRevoked ? JOIN_DENIED_REVOKED : joinDeniedReason;
  const presenceBroadcasted = useRef(false);
  const sessionRef = useRef(session);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { presenceBroadcasted.current = false; }, [sessionId]);

  // One-shot timer for re-sending own data (ratings, ROTI, proposal votes)
  // that the server healed away after a lost optimistic-concurrency race
  // (see scheduleSessionResend in mergeRemoteSession.ts).
  const resendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Own-data slices (ratings, ROTI, proposal votes, "finished") this client
  // changed and the server has not confirmed yet. Without it, the same
  // participant on two browsers re-sends its stale own data forever (see the
  // own-change ledger in mergeRemoteSession.ts). Cleared per session: the
  // `roti` and `finished` keys are not id-scoped.
  const ownChangesRef = useRef<OwnChangeLedger>(new Map());
  // When the socket dropped, so the claim clock can be paused for that span.
  const offlineSinceRef = useRef<number | null>(null);

  // Action proposals created here and not yet seen in a server state, so a
  // heal cannot make one vanish — the retro's rule for its cards and proposals
  // (see Session.tsx). Without it a proposal whose write lost a race was gone
  // for good: the merge took `actions` from the server alone, and the field
  // the text was typed into had already been cleared (review finding C).
  const pendingCreationsRef = useRef<Map<string, PendingCreation>>(new Map());

  useEffect(() => {
    ownChangesRef.current.clear();
    pendingCreationsRef.current.clear();
  }, [sessionId]);

  // Nothing unconfirmed may expire while sync is stalled — see Session.tsx.
  useHoldOwnStateWhileStalled(sessionId, pendingCreationsRef, ownChangesRef);

  const isFacilitator = currentUser.role === 'facilitator';
  const [showInvite, setShowInvite] = useState(false);
  // Local to this browser, as in a retro: the facilitator collapsing the panel
  // must not collapse it for every participant, and a toggle is not worth a
  // session write. Open for the facilitator, collapsed for participants.
  const [participantsPanelCollapsed, setParticipantsPanelCollapsed] = useState(!isFacilitator);
  const [activeDiscussDimension, setActiveDiscussDimension] = useState<string | null>(null);
  // Dimensions whose Bad/Good descriptions are revealed during the Discuss phase.
  // Local-only and independent of the facilitator's discussion focus, so any
  // participant can read a dimension's definition without disrupting others.
  const [openDescriptions, setOpenDescriptions] = useState<Record<string, boolean>>({});
  const [newProposalText, setNewProposalText] = useState('');
  const discussRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [editingProposalText, setEditingProposalText] = useState('');
  const [closeProposalText, setCloseProposalText] = useState('');

  // Local state for debounced inputs to prevent sync conflicts
  const [localComments, setLocalComments] = useState<Record<string, string>>({});
  const commentTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // The team's Jira status, for the Review step. Here, at the top, because the
  // step is a render function and not a component; read again on entering
  // Review and on every connection change there (finding U-9), and never from
  // dataService while rendering (finding T-49).
  const inReview = session?.phase === 'REVIEW';
  const { status: jiraStatus, refresh: refreshJiraStatus } = useJiraStatus(team.id, {
    refreshKey: inReview ? `review:${isLive}` : 'away'
  });
  // The links the team record holds for this health check's actions, read
  // from the cache after a creation: the browser that clicked learns the keys
  // there (`applyJiraLinks`) before the server's patch of the live session
  // reaches it, and the rows must not offer "Create in Jira" meanwhile
  // (finding A-6). Read in the handler, not while rendering.
  const [recordJiraLinks, setRecordJiraLinks] = useState<Map<string, JiraLink>>(() => new Map());
  // The team's parent issues (sessionParent mode), the same way: a batch puts
  // the one it created in the cache (`applyJiraParents`), and the next dialog
  // and the Review step's parent line must name it.
  // Kept with the record it was read beside, so a newer team record (a
  // reload) is not hidden behind an older read.
  const [readJiraParents, setReadJiraParents] = useState<{ base: Team['jiraParents']; read: Team['jiraParents'] } | null>(null);
  const recordJiraParents = readJiraParents && readJiraParents.base === team.jiraParents ? readJiraParents.read : team.jiraParents;
  const readRecordJiraLinks = () => {
    const cached = dataService.getTeam(team.id);
    const stored = cached?.healthChecks?.find(h => h.id === sessionId)?.actions ?? [];
    setRecordJiraLinks(new Map(stored.filter(a => a?.jira).map(a => [a.id, a.jira as JiraLink])));
    setReadJiraParents({ base: team.jiraParents, read: cached?.jiraParents ?? team.jiraParents });
  };

  // The people this screen lists: one rule with the retrospective
  // (sessionRoster.ts).
  const getParticipants = () => sessionParticipants(session?.participants, currentUser);

  const participants = getParticipants();
  const assignableMembers = getAssignableMembers(team);

  const getAnonymizedLabel = (memberId: string) => {
    if (!session?.settings.isAnonymous) return null;
    const index = participants.findIndex((m) => m.id === memberId);
    const anonNumber = index >= 0 ? index + 1 : participants.length + 1;
    return t('healthCheck.anonymousParticipant', { number: anonNumber });
  };

  const getMemberDisplay = (member: User) => {
    const anonymous = getAnonymizedLabel(member.id);
    const displayName = anonymous || member.name;
    const initials = displayName.substring(0, 2).toUpperCase();
    // None in an anonymous session: the resolver says so.
    const avatarId = sessionAvatarOf(session, team, member.id);
    return { displayName, initials, avatarId };
  };

  // Update session helper
  const updateSession = (updater: (s: HealthCheckSessionType) => void) => {
    // Editing is paused while offline (see Session.tsx) so no change is made on
    // a stale, disconnected snapshot.
    if (!isLiveRef.current) {
      return;
    }
    // Use functional setState to ensure we always work with the latest state
    setSession(prevSession => {
      const baseSession = prevSession
        ?? dataService.getHealthCheck(team.id, sessionId)
        ?? null;

      if (!baseSession) return prevSession;

      const newSession = JSON.parse(JSON.stringify(baseSession));
      if (!newSession.participants) newSession.participants = [];

      const existingIds = new Set(newSession.participants.map((p: User) => p.id));
      participants.forEach(m => {
        if (!existingIds.has(m.id)) {
          newSession.participants!.push(m);
          existingIds.add(m.id);
        }
      });
      if (!existingIds.has(currentUser.id)) {
        newSession.participants!.push(currentUser);
      }

      updater(newSession);
      // The viewer's own entry carries their avatar from the write that adds
      // them (see the same call in Session.tsx).
      stampOwnAvatarEntry(newSession, team, currentUser.id);
      // Declare the own-data slices this write changed before it goes out —
      // see the same call in Session.tsx.
      registerOwnHealthCheckChanges(ownChangesRef.current, baseSession, newSession, currentUser.id);
      dataService.updateHealthCheckSession(team.id, newSession);
      dataService.persistParticipants(team.id, newSession.participants);
      syncService.updateSession(newSession);

      return newSession;
    });
  };

  // Whether entering this session sends a write (the effect further down): the
  // viewer is not listed yet, or comes back marked as having left.
  const entersWriting = (entered: HealthCheckSessionType) =>
    !entered.participants?.length
    || !entered.participants.some(p => p.id === currentUser.id)
    || !!entered.leftUsers?.includes(currentUser.id);
  // The session that effect has already run for.
  const enteredSessionRef = useRef<string | null>(null);

  // The avatars as in a retrospective (useOwnAvatar): who is drawn with which,
  // the own entry kept as new as the team's choice, and the picker.
  const ownAvatar = useOwnAvatar({
    session: session ?? null,
    team,
    currentUser,
    updateSession,
    canWrite: isLive && !deniedReason,
    onTeamAvatars,
    // The entering write carries the entry, when there is one to come. Sent
    // in a write of its own just before, the entry left from the same
    // revision as that write, and the server refused the second: the one
    // that takes the "has left" mark off, which nothing sends again.
    entersWithAWrite: () => !!session && enteredSessionRef.current !== session.id && entersWriting(session),
  });

  // The one-time hint that the avatar can be changed, by the retrospective's
  // rule (useAvatarDiscoveryHint).
  const avatarHint = useAvatarDiscoveryHint({
    userId: currentUser.id,
    hasChoice: ownAvatar.hasChoice,
    anonymous: isAnonymousSession(session),
    blocked: !!deniedReason,
    pickerOpen: ownAvatar.pickerOpen,
    openPicker: ownAvatar.openPicker,
  });

  // The status follows the phase, as in a retrospective: opening Close ends the
  // health check with the facilitator's own phase write, rather than waiting
  // for an exit click that a closed tab never makes. Browsing back through the
  // phases — which is how "View Results" is read — never reopens it.
  const setPhase = (phase: typeof PHASES[number]) => {
    updateSession(s => {
      s.phase = phase;
      s.status = effectiveSessionStatus(s);
      // Shared with the retrospective (utils/sessionTimer.ts): entering a
      // phase stops the timer at that phase's timebox.
      resetTimer(s.settings, getHealthCheckPhaseDefaultTimerSeconds(phase));
    });
  };

  // Participant sync helpers, shared with the retro (sessionRoster.ts). A join
  // or reconnect lists a newcomer and clears a "has left" mark in one write,
  // and writes nothing when it changes nothing. Read through sessionRef: the
  // handler is subscribed once, at mount (review finding D — see Session.tsx).
  const handleMemberJoined = (userId: string, userName: string) => {
    const members = (dataService.getTeam(team.id) || team).members;
    const joiner = { id: userId, name: userName };
    if (!memberJoinedChange(sessionRef.current, joiner, members)) return;

    updateSession(s => {
      const change = memberJoinedChange(s, joiner, members);
      if (change?.participants) s.participants = change.participants;
      if (change?.leftUsers) s.leftUsers = change.leftUsers;
    });
  };

  // Write only when the roster changes the participant list — the rule is
  // shared with the retro (sessionRoster.ts, incident ISS).
  const mergeRoster = (roster: { id: string; name: string }[]) => {
    const members = (dataService.getTeam(team.id) || team).members;
    if (!mergeRosterIntoParticipants(sessionRef.current?.participants ?? [], roster, members)) return;

    updateSession(s => {
      s.participants = mergeRosterIntoParticipants(s.participants ?? [], roster, members) ?? s.participants;
    });
  };

  // Connect to sync service
  useEffect(() => {
    // Join at once, without waiting for the socket — see Session.tsx.
    syncService.joinSession(sessionId, currentUser.id, currentUser.name);

    const unsubUpdate = syncService.onSessionUpdate((updatedSession) => {
      if (!isHealthCheckSession(updatedSession)) return;
      if (syncService.getCurrentSessionId() !== sessionId || updatedSession.id !== sessionId) return;

      // The server's session record is the authority for every facilitator-only
      // field, the name included: never overwrite one from the local team
      // record — see Session.tsx (incident ISS).
      const normalizedSession = { ...updatedSession };

      // Merge strategy: re-apply the current user's own data (ratings, ROTI,
      // proposal votes) on top of the incoming authoritative state, and
      // re-send when the server does not know some of it yet so no user
      // action is lost.
      setSession(prevSession => {
        if (!prevSession) return normalizedSession;

        const { merged, divergent } = mergeRemoteHealthCheckSession(
          normalizedSession,
          prevSession,
          { currentUserId: currentUser.id, ownChanges: ownChangesRef.current },
          pendingCreationsRef.current
        );
        if (divergent) {
          // Backed off under a streak of re-sends, and marked as a re-send so
          // syncService counts it — see Session.tsx.
          scheduleSessionResend(
            { timer: resendTimerRef, isLive: isLiveRef, session: sessionRef },
            s => syncService.updateSession(s, { resend: true }),
            syncService.getResendDelayMs()
          );
        }
        return merged;
      });

      // Local cache only — the originator already persisted (see Session.tsx).
      dataService.applyRemoteHealthCheckSession(team.id, normalizedSession);
    });

    const unsubJoin = syncService.onMemberJoined(({ userId, userName }) => {
      if (syncService.getCurrentSessionId() !== sessionId) return;
      setConnectedUsers(prev => new Set([...prev, userId]));
      // As in a retro: someone marked as "left" who reconnects is back, and
      // the counters wait for them again.
      handleMemberJoined(userId, userName);
    });

    const unsubLeave = syncService.onMemberLeft(({ userId }) => {
      if (syncService.getCurrentSessionId() !== sessionId) return;
      setConnectedUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    });

    const unsubRoster = syncService.onRoster((roster) => {
      if (syncService.getCurrentSessionId() !== sessionId) return;
      setConnectedUsers(new Set(roster.map(r => r.id)));
      setRosterReceived(true);
      mergeRoster(roster);
    });

    // A reconnect must not clear a refused join: the socket comes back, the
    // credential does not, so editing stays paused until the user logs in
    // again (audit H12).
    const unsubConn = syncService.onConnectionChange((connected) => {
      // Pause the own-change claim clock while offline — see Session.tsx.
      if (!connected) {
        if (offlineSinceRef.current === null) offlineSinceRef.current = Date.now();
      } else if (offlineSinceRef.current !== null) {
        extendOwnChanges(ownChangesRef.current, Date.now() - offlineSinceRef.current);
        offlineSinceRef.current = null;
      }
      const live = isSessionLive(connected, joinDeniedRef.current);
      isLiveRef.current = live;
      setIsLive(live);
    });

    // The server refused the join (audit H1): no valid team credential for
    // this session. The socket is still connected, so without this the UI
    // would look live while nothing synced. The banner says so in its own
    // words and offers the way out (audit H12) — reconnecting can never fix
    // an expired or foreign token.
    const unsubDenied = syncService.onJoinDenied((data) => {
      if (data?.sessionId !== sessionId) return;
      console.error('[HealthCheckSession] Join denied by server:', data.reason);
      joinDeniedRef.current = data.reason ?? 'unauthenticated';
      setJoinDeniedReason(joinDeniedRef.current);
      isLiveRef.current = false;
      setIsLive(false);
    });

    if (currentUser.role === 'facilitator' && session) {
      setTimeout(() => syncService.updateSession(session), 500);
    }

    return () => {
      unsubUpdate();
      unsubJoin();
      unsubLeave();
      unsubRoster();
      unsubConn();
      unsubDenied();
      syncService.leaveSession();

      // Clear all pending comment timers
      Object.values(commentTimersRef.current).forEach(timer => clearTimeout(timer));
      commentTimersRef.current = {};

      // Clear any scheduled own-data resend
      if (resendTimerRef.current) {
        clearTimeout(resendTimerRef.current);
        resendTimerRef.current = null;
      }
    };
  }, [sessionId, currentUser.id, currentUser.name, currentUser.role, team.id]);

  // Ensure the shared roster includes the currently connected user, and that
  // re-opening the session while marked as "left" brings them back.
  useEffect(() => {
    if (!session) return;
    enteredSessionRef.current = session.id;
    if (entersWriting(session)) {
      updateSession(s => {
        if (!s.participants) s.participants = [];
        if (!s.participants.some(p => p.id === currentUser.id)) {
          s.participants.push(currentUser);
        }
        if (s.leftUsers?.includes(currentUser.id)) {
          s.leftUsers = s.leftUsers.filter(id => id !== currentUser.id);
        }
      });
    }
  }, [session?.id]);

  // Follow facilitator's discussion focus
  useEffect(() => {
    setActiveDiscussDimension(session?.discussionFocusId ?? null);
  }, [session?.discussionFocusId]);

  useEffect(() => {
    if (!activeDiscussDimension) return;
    const target = discussRefs.current[activeDiscussDimension];
    if (target) {
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }, [activeDiscussDimension]);

  if (!session) {
    return (
      <div className="h-screen flex items-center justify-center text-slate-500">
        {t('healthCheck.notFound')}
      </div>
    );
  }

  // Participants the facilitator marked as having left stay listed in the panel
  // but are excluded from every "waiting for X" counter — the retro's rule.
  const leftUserIds = new Set(session.leftUsers ?? []);
  const activeParticipants = participants.filter(p => !leftUserIds.has(p.id));
  const activeParticipantIds = new Set(activeParticipants.map(p => p.id));
  // Counted against the active roster, like the retro's counters, so a vote
  // from an id the roster does not hold can never read as "3 / 2 voted".
  const activeRotiCount = Object.keys(session.roti || {}).filter(id => activeParticipantIds.has(id)).length;

  // Calculate statistics
  const getDimensionStats = (dimensionId: string) => {
    const ratings: number[] = [];
    const comments: { userId: string; comment: string }[] = [];

    Object.entries(session.ratings).forEach(([userId, userRatings]) => {
      const r = userRatings[dimensionId];
      if (r) {
        if (r.rating != null) {
          ratings.push(r.rating);
        }
        if (r.comment) {
          comments.push({ userId, comment: r.comment });
        }
      }
    });

    const average = ratings.length > 0
      ? (ratings.reduce((a, b) => a + b, 0) / ratings.length)
      : 0;

    const distribution = [1, 2, 3, 4, 5].map(v => ratings.filter(r => r === v).length);

    return { average, ratings, comments, distribution, count: ratings.length };
  };

  // Get color class based on score
  const getScoreColor = (score: number) => {
    if (score >= 4) return 'bg-emerald-500';
    if (score >= 3) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 4) return 'bg-emerald-100';
    if (score >= 3) return 'bg-amber-100';
    return 'bg-rose-100';
  };

  // The score's ink on its tile: the 800 of each hue reads at 4.5:1 or more
  // (amber-600 on amber-100 did not; __tests__/healthCheckLook.test.tsx).
  const getScoreTextColor = (score: number) => {
    if (score >= 4) return 'text-emerald-800';
    if (score >= 3) return 'text-amber-800';
    return 'text-rose-800';
  };

  // Check if current user has completed survey
  const hasCompletedSurvey = () => {
    const userRatings = session.ratings[currentUser.id] || {};
    return session.dimensions.every(d => userRatings[d.id]?.rating != null);
  };

  // Count finished participants
  const getFinishedCount = () => {
    let count = 0;
    Object.keys(session.ratings).forEach(userId => {
      if (activeParticipantIds.has(userId)) {
        const userRatings = session.ratings[userId] || {};
        const completed = session.dimensions.every(d => userRatings[d.id]?.rating != null);
        if (completed) count++;
      }
    });
    return count;
  };

  // Facilitator marks a participant as having left (or as returned). The
  // participant stays in the roster; only the counters stop waiting for them.
  const handleToggleParticipantLeft = (userId: string) => {
    updateSession(s => {
      const left = new Set(s.leftUsers ?? []);
      if (left.has(userId)) {
        left.delete(userId);
      } else {
        left.add(userId);
      }
      s.leftUsers = [...left];
    });
  };

  // Handle exit. `setPhase` keeps the status right; this only stores what the
  // dashboard already reads (effectiveSessionStatus) for a record saved before
  // the status followed the phase: in progress at Close becomes CLOSED. It never
  // reopens — the previous exit rule closed health checks at any phase, and
  // viewing one of those must not send participants back into it. Leaving
  // mid-survey no longer closes the health check either: participants still
  // rating would lose it from their redirect.
  const handleExit = () => {
    const healedStatus = effectiveSessionStatus(session);
    if (isFacilitator && session.status !== healedStatus) {
      updateSession(s => { s.status = healedStatus; });
    }
    onExit();
  };

  // Handle rating change
  const handleRating = (dimensionId: string, rating: number) => {
    updateSession(s => {
      if (!s.ratings[currentUser.id]) {
        s.ratings[currentUser.id] = {};
      }
      if (!s.ratings[currentUser.id][dimensionId]) {
        // Initialize with only rating, preserving independence from comment
        s.ratings[currentUser.id][dimensionId] = { rating };
      } else {
        // Preserve existing comment when updating rating
        s.ratings[currentUser.id][dimensionId] = {
          ...s.ratings[currentUser.id][dimensionId],
          rating
        };
      }
    });
  };

  // Handle comment change with debounce to prevent sync conflicts
  const handleComment = (dimensionId: string, comment: string) => {
    // Update local state immediately for responsive UI
    setLocalComments(prev => ({ ...prev, [dimensionId]: comment }));

    // Clear existing timer
    if (commentTimersRef.current[dimensionId]) {
      clearTimeout(commentTimersRef.current[dimensionId]);
    }

    // Debounce sync to server (500ms after last keystroke)
    commentTimersRef.current[dimensionId] = setTimeout(() => {
      updateSession(s => {
        if (!s.ratings[currentUser.id]) {
          s.ratings[currentUser.id] = {};
        }
        if (!s.ratings[currentUser.id][dimensionId]) {
          // Don't initialize rating to 0 - preserve independence between rating and comment
          s.ratings[currentUser.id][dimensionId] = { comment };
        } else {
          // Preserve existing rating when updating comment
          s.ratings[currentUser.id][dimensionId] = {
            ...s.ratings[currentUser.id][dimensionId],
            comment
          };
        }
      });

      // Clear local state after sync
      setLocalComments(prev => {
        const next = { ...prev };
        delete next[dimensionId];
        return next;
      });
    }, 500);
  };

  // Discuss phase: add or edit the current user's comment with an explicit
  // submit (no debounce), so it is saved once and only shown a single time.
  const setMyComment = (dimensionId: string, comment: string) => {
    updateSession(s => {
      if (!s.ratings[currentUser.id]) {
        s.ratings[currentUser.id] = {};
      }
      s.ratings[currentUser.id][dimensionId] = {
        ...s.ratings[currentUser.id][dimensionId],
        comment
      };
    });
  };

  // Discuss phase: remove the current user's comment, preserving their rating.
  const clearMyComment = (dimensionId: string) => {
    updateSession(s => {
      const existing = s.ratings[currentUser.id]?.[dimensionId];
      if (!existing) return;
      const { comment: _removed, ...rest } = existing;
      s.ratings[currentUser.id][dimensionId] = rest;
    });
  };

  // Label shown above a comment in the Discuss phase. The current user always
  // sees their own comment marked (so they know which one is editable), while
  // other participants' names are hidden in anonymous mode.
  const getCommentLabel = (userId: string): string | null => {
    const isOwn = userId === currentUser.id;
    if (session?.settings.isAnonymous) {
      return isOwn ? t('healthCheck.comment.you') : null;
    }
    const author = participants.find(p => p.id === userId);
    const name = author?.name || t('healthCheck.unknownMember');
    return isOwn ? t('healthCheck.comment.ownName', { name }) : name;
  };

  // Every action created here is pending until a server state confirms it, as
  // in the retro. The id is drawn before updateSession, not inside the
  // updater: the hold is keyed on it, and the updater runs inside setSession.
  const createPendingActionId = () => {
    const id = randomId();
    registerPendingCreation(pendingCreationsRef.current, id, 'action');
    return id;
  };

  const handleAddProposal = (linkedDimensionId?: string) => {
    if (!newProposalText.trim()) return;

    const proposalId = createPendingActionId();
    updateSession(s => {
      s.actions.push({
        id: proposalId,
        text: newProposalText.trim(),
        assigneeId: null,
        done: false,
        type: 'proposal',
        proposalVotes: {},
        linkedTicketId: linkedDimensionId,
        createdAt: new Date().toISOString()
      });
    });
    setNewProposalText('');
  };

  const handleDirectAddAction = (linkedDimensionId?: string) => {
    if (!newProposalText.trim()) return;

    const actionId = createPendingActionId();
    updateSession(s => {
      s.actions.push({
        id: actionId,
        text: newProposalText.trim(),
        assigneeId: null,
        done: false,
        type: 'new',
        proposalVotes: {},
        linkedTicketId: linkedDimensionId,
        createdAt: new Date().toISOString()
      });
    });
    setNewProposalText('');
  };

  const handleVoteProposal = (actionId: string, vote: 'up' | 'down' | 'neutral') => {
    updateSession(s => {
      const a = s.actions.find(x => x.id === actionId);
      if (a) {
        if (!a.proposalVotes) a.proposalVotes = {};
        if (a.proposalVotes[currentUser.id] === vote) {
          delete a.proposalVotes[currentUser.id];
        } else {
          a.proposalVotes[currentUser.id] = vote;
        }
      }
    });
  };

  const handleAcceptProposal = (actionId: string) => {
    updateSession(s => {
      const a = s.actions.find(x => x.id === actionId);
      if (a) a.type = 'new';
    });
  };

  const handleStartEditProposal = (actionId: string, currentText: string) => {
    setEditingProposalId(actionId);
    setEditingProposalText(currentText);
  };

  const handleSaveProposalEdit = (actionId: string) => {
    if (!editingProposalText.trim()) return;
    updateSession(s => {
      const a = s.actions.find(x => x.id === actionId);
      if (a) a.text = editingProposalText.trim();
    });
    setEditingProposalId(null);
    setEditingProposalText('');
  };

  const handleCancelProposalEdit = () => {
    setEditingProposalId(null);
    setEditingProposalText('');
  };

  const handleDeleteProposal = (actionId: string) => {
    updateSession(s => {
      s.actions = s.actions.filter(x => x.id !== actionId);
    });
  };

  const handleCloseAddProposal = (_topicId: string, text?: string) => {
    if (!text?.trim()) return;
    const proposalId = createPendingActionId();
    updateSession(s => {
      s.actions.push({
        id: proposalId,
        text: text.trim(),
        assigneeId: null,
        done: false,
        type: 'proposal',
        proposalVotes: {},
        linkedTicketId: ROTI_FOLLOW_UP_LINK_ID,
        createdAt: new Date().toISOString()
      });
    });
    setCloseProposalText('');
  };

  const handleCloseDirectAddAction = (_topicId: string, text?: string) => {
    if (!text?.trim()) return;
    const actionId = createPendingActionId();
    updateSession(s => {
      s.actions.push({
        id: actionId,
        text: text.trim(),
        assigneeId: null,
        done: false,
        type: 'new',
        proposalVotes: {},
        linkedTicketId: ROTI_FOLLOW_UP_LINK_ID,
        createdAt: new Date().toISOString()
      });
    });
    setCloseProposalText('');
  };

  const handleAssignAction = (actionId: string, assigneeId: string | null) => {
    updateSession(s => {
      const a = s.actions.find(x => x.id === actionId);
      if (a) a.assigneeId = assigneeId || null;
    });
  };

  // Render header (same style as Session.tsx)
  const renderHeader = () => (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-2 sm:px-4 shrink-0 z-50">
      {/* As in the retro header, the phase bar is the part that gives way, and
          the group never shrinks below the back arrow: the timer is the next
          element, and a tap meant for "back" that lands on it would pause
          everyone's timer. */}
      <div className="flex items-center h-full min-w-9">
        <button
          onClick={handleExit}
          aria-label={t('healthCheck.header.leave')}
          className="grid place-items-center shrink-0 w-8 h-8 sm:w-9 sm:h-9 mr-0.5 sm:mr-2 rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
        >
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>
        <div className="hidden lg:flex h-full items-center min-w-0 overflow-x-auto [scrollbar-width:none]">
          {PHASES.map(p => (
            <button
              key={p}
              onClick={() => isFacilitator ? setPhase(p) : null}
              // Only the facilitator moves the health check between phases (see
              // SessionHeader): enabling this for participants of a closed one
              // offered a click that did nothing.
              disabled={!isFacilitator}
              // The retrospective's pill, class for class (SessionHeader):
              // __tests__/healthCheckLook.test.tsx compares the two headers.
              className={`phase-nav-btn h-8 shrink-0 whitespace-nowrap px-1.5 2xl:px-2.5 text-[13px] leading-none ${
                session.phase === p
                  ? 'active bg-indigo-100 text-indigo-700 font-bold'
                  : 'font-medium text-slate-600 enabled:hover:bg-slate-100 enabled:hover:text-slate-900 disabled:text-slate-400'
              }`}
            >
              {/* The dictionary's capitals stay the accessible name; the bar
                  draws them in mixed case. */}
              <span className="inline-block lowercase first-letter:uppercase">{t(`common.phase.${p}` as MessageKey)}</span>
            </button>
          ))}
        </div>
      </div>
      {/* The retrospective's timer, not a copy of it (components/session/SessionTimer). */}
      <SessionTimer
        settings={session.settings}
        phase={session.phase}
        fallbackSeconds={getHealthCheckPhaseDefaultTimerSeconds(session.phase)}
        isFacilitator={isFacilitator}
        isLive={isLive}
        onUpdate={(mutate) => updateSession((draft) => mutate(draft.settings))}
      />
      {/* The right-hand cluster uses the retro header's breakpoints, which make
          room for the timer down to 320px (e2e/i18n.spec.ts measures both). */}
      <div className="flex shrink-0 justify-end items-center gap-1 sm:gap-2">
        {/* Real-time sync indicator. As in the retro header, the reassuring
            "live" chip steps aside on the narrowest phones; a lost connection,
            a refused join or a stalled sync always shows (the chip decides). */}
        <SessionSyncChip isLive={isLive} joinDeniedReason={deniedReason} />

        {/* Participant progress, shown when the panel is collapsed or on
            smaller screens. A count, never a control, as in the retro header:
            below lg the panel is not drawn, and from lg its rail has its own
            button. */}
        {(participantsPanelCollapsed || window.innerWidth < 1024) && (
          <div className="flex items-center gap-0.5 sm:gap-1 h-8 rounded-full border border-slate-200 bg-white px-1.5 sm:px-2.5">
            <span className="material-symbols-outlined text-lg! leading-none text-slate-600" aria-hidden="true">groups</span>
            <span className="text-xs font-semibold tabular-nums text-slate-700">
              {session.phase === 'SURVEY'
                ? `${getFinishedCount()}/${activeParticipants.length}`
                : session.phase === 'CLOSE'
                ? `${activeRotiCount}/${activeParticipants.length}`
                : `${activeParticipants.length}`
              }
            </span>
            {/* The caption waits for 2xl, as in the retro header: below it the
                timer and then the phase bar need the room. */}
            <span className="text-xs text-slate-500 hidden 2xl:inline">
              {session.phase === 'SURVEY'
                ? t('healthCheck.header.finishedLabel')
                : session.phase === 'CLOSE'
                ? t('healthCheck.header.votedLabel')
                : t('healthCheck.header.participantsLabel')}
            </span>
          </div>
        )}

        {isFacilitator && (
          <button
            onClick={() => setShowInvite(true)}
            className="grid place-items-center shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-indigo-700"
            title={t('healthCheck.header.invite')}
            aria-label={t('healthCheck.header.invite')}
          >
            <span className="material-symbols-outlined" aria-hidden="true">qr_code_2</span>
          </button>
        )}
        {/* Guests switch language here too: an invite link lands them straight
            in the session, past every other screen that carries the switcher. */}
        <LanguageSwitcher className="shrink-0" />
        {/* The name waits for 2xl, as in the retro header: the timer and the
            phase bar need the room, and the participants panel names everyone
            anyway. */}
        <div className="hidden 2xl:flex flex-col items-end min-w-0 leading-tight">
          <span className="text-xs font-medium text-slate-500">{t('healthCheck.header.user')}</span>
          <span className="max-w-32 truncate text-sm font-semibold text-slate-900" title={currentUser.name}>{currentUser.name}</span>
        </div>
        {/* The viewer's own avatar opens the avatar picker, by the retro
            header's rule (AGENTS.md, *Avatars*): at every width for a participant,
            from 360px for a facilitator, whose header also carries the
            invite button and play. */}
        <ViewerAvatarButton
          user={currentUser}
          avatarId={ownAvatar.avatarIdOf(currentUser.id)}
          onClick={ownAvatar.openPicker}
          visibilityClass={isFacilitator ? 'hidden min-[360px]:flex' : 'flex'}
          marked={avatarHint.shown}
          ref={avatarHint.openerRef}
        />
      </div>
    </header>
  );

  // A dimension's two poles, as the survey and Discuss show them: a soft tint
  // of their meaning, the word in its dark ink, the template's text in ink.
  const renderDimensionDescriptions = (dimension: HealthCheckDimension) => (
    <>
      <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
        <span className="text-rose-800 font-semibold">{t('healthCheck.dimension.bad')}</span>
        <span className="text-slate-700 ml-2">{dimension.badDescription}</span>
      </div>
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
        <span className="text-emerald-800 font-semibold">{t('healthCheck.dimension.good')}</span>
        <span className="text-slate-700 ml-2">{dimension.goodDescription}</span>
      </div>
    </>
  );

  // Render Survey Phase
  const renderSurvey = () => {
    const myRatings = session.ratings[currentUser.id] || {};

    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex flex-wrap justify-between items-center gap-x-4 gap-y-2 shadow-xs shrink-0 z-30">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="font-semibold tracking-tight text-slate-900 text-lg">{t('healthCheck.survey.title')}</h2>
            <span className="text-slate-500 text-sm tabular-nums">
              {t('healthCheck.survey.finishedCount', { finished: getFinishedCount(), total: activeParticipants.length })}
            </span>
          </div>
          {isFacilitator && (
            <button
              onClick={() => setPhase('DISCUSS')}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 transition"
            >
              {t('healthCheck.survey.next')}
            </button>
          )}
        </div>

        <div className="grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 mb-6 flex items-center justify-center gap-2">
              <span className="material-symbols-outlined text-lg! leading-none text-indigo-700" aria-hidden="true">
                {session.settings.isAnonymous ? 'visibility_off' : 'visibility'}
              </span>
              <p className="text-indigo-800 text-center text-sm font-medium">
                {session.settings.isAnonymous
                  ? t('healthCheck.survey.anonymousNotice')
                  : t('healthCheck.survey.visibleNotice')}
              </p>
            </div>

            <div className="space-y-6">
              {session.dimensions.map((dimension) => {
                const myRating = myRatings[dimension.id]?.rating;
                const myComment = myRatings[dimension.id]?.comment || '';
                // Use local state if actively editing, otherwise use synced state
                const displayComment = localComments[dimension.id] !== undefined
                  ? localComments[dimension.id]
                  : myComment;

                return (
                  <div key={dimension.id} className="bg-white border border-slate-200 rounded-xl p-6 max-sm:p-4 shadow-xs">
                    <h3 className="text-lg font-semibold tracking-tight text-slate-900 mb-3">{dimension.name}</h3>
                    <div className="grid md:grid-cols-2 gap-3 mb-5 text-sm">
                      {renderDimensionDescriptions(dimension)}
                    </div>

                    {/* The chosen score is pressed (aria-pressed) and filled; an
                        unchosen one is a white disc whose edge reaches 3:1. A
                        ring marks the choice, so nothing grows under the finger. */}
                    <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2">
                      {[1, 2, 3, 4, 5].map(rating => (
                        <button
                          key={rating}
                          onClick={() => handleRating(dimension.id, rating)}
                          aria-pressed={myRating === rating}
                          className={`w-11 h-11 sm:w-12 sm:h-12 rounded-full font-bold text-lg tabular-nums border transition ${
                            myRating === rating
                              ? 'bg-indigo-600 border-indigo-600 text-white ring-4 ring-indigo-600/15'
                              : 'bg-white border-slate-400 text-slate-700 hover:bg-slate-50 hover:border-slate-500'
                          }`}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>

                    <div className="flex justify-between gap-2 text-xs text-slate-500 px-1 mb-4">
                      <span>{t('healthCheck.survey.scale.stronglyDisagree')}</span>
                      <span>{t('healthCheck.survey.scale.neutral')}</span>
                      <span>{t('healthCheck.survey.scale.stronglyAgree')}</span>
                    </div>

                    <div className="relative">
                      <textarea
                        placeholder={t('healthCheck.survey.commentPlaceholder')}
                        value={displayComment}
                        onChange={(e) => handleComment(dimension.id, e.target.value)}
                        className="w-full bg-white border border-slate-400 rounded-lg px-3 py-2.5 pb-7 text-slate-900 text-sm placeholder:text-slate-500 resize-none h-20 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 transition"
                      />
                      {myRating && (
                        <span className="absolute bottom-2.5 right-3 text-emerald-700 text-xs font-semibold flex items-center gap-1 pointer-events-none">
                          <span className="material-symbols-outlined text-sm! leading-none" aria-hidden="true">check_circle</span>
                          <span>{t('healthCheck.survey.saved')}</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Discuss Phase with Radar Chart
  const renderDiscuss = () => {
    const orderedDimensions = session.dimensions;
    const showVoteTypes = session.settings.showParticipantVotes ?? false;

    // Radar chart calculations
    const centerX = 200;
    const centerY = 200;
    const maxRadius = 150;
    const dimensions = session.dimensions;
    const angleStep = (2 * Math.PI) / dimensions.length;

    const getPoint = (index: number, value: number) => {
      const angle = index * angleStep - Math.PI / 2;
      const radius = (value / 5) * maxRadius;
      return {
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle)
      };
    };

    const averagePoints = dimensions.map((d, i) => {
      const stats = getDimensionStats(d.id);
      return getPoint(i, stats.average);
    });

    const averagePathD = averagePoints.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ') + ' Z';

    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex flex-wrap justify-between items-center gap-x-4 gap-y-2 shadow-xs shrink-0 z-30">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="font-semibold tracking-tight text-slate-900 text-lg">{t('healthCheck.discuss.title')}</h2>
            {isFacilitator && (
              // No rule before it: the bar wraps on a phone, and the rule then
              // opened the label's own line. The gaps space it (as the board's bar).
              <label className="flex items-center gap-1.5 cursor-pointer text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-indigo-600"
                  checked={showVoteTypes}
                  onChange={(event) => updateSession((draft) => { draft.settings.showParticipantVotes = event.target.checked; })}
                />
                <span>{t('healthCheck.discuss.showVotes')}</span>
              </label>
            )}
          </div>
          {isFacilitator && (
            <button
              onClick={() => setPhase('REVIEW')}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 transition"
            >
              {t('healthCheck.discuss.next')}
            </button>
          )}
        </div>

        <div className="grow overflow-auto p-6">
          <div className="max-w-5xl mx-auto">
            {/* Radar Chart */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 mb-6 shadow-xs">
              <div className="flex justify-center">
                {/* Drawn in the theme's tokens, so the brand and the hairlines
                    follow the look; scaled down on a phone rather than cut. The
                    outermost labels may reach past the drawing into the card's
                    padding, so the drawing does not clip them. */}
                <svg width="400" height="400" viewBox="0 0 400 400" className="max-w-full h-auto overflow-visible">
                  {[1, 2, 3, 4, 5].map(level => (
                    <circle
                      key={level}
                      cx={centerX}
                      cy={centerY}
                      r={(level / 5) * maxRadius}
                      fill="none"
                      className="stroke-slate-200"
                      strokeWidth="1"
                      strokeDasharray={level < 5 ? "4,4" : "none"}
                    />
                  ))}
                  {dimensions.map((_, i) => {
                    const point = getPoint(i, 5);
                    return (
                      <line
                        key={i}
                        x1={centerX}
                        y1={centerY}
                        x2={point.x}
                        y2={point.y}
                        className="stroke-slate-200"
                        strokeWidth="1"
                      />
                    );
                  })}
                  <path
                    d={averagePathD}
                    className="fill-indigo-600/15 stroke-indigo-600"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  {averagePoints.map((point, i) => (
                    <circle
                      key={i}
                      cx={point.x}
                      cy={point.y}
                      r="5"
                      className="fill-indigo-600 stroke-white"
                      strokeWidth="2"
                    />
                  ))}
                  {dimensions.map((d, i) => {
                    const labelPoint = getPoint(i, 5.8);
                    const stats = getDimensionStats(d.id);
                    return (
                      <g key={d.id}>
                        <text
                          x={labelPoint.x}
                          y={labelPoint.y}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="fill-slate-600 text-xs font-medium"
                        >
                          {d.name.length > 12 ? d.name.substring(0, 12) + '...' : d.name}
                        </text>
                        <text
                          x={labelPoint.x}
                          y={labelPoint.y + 12}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="fill-indigo-700 text-xs font-bold tabular-nums"
                        >
                          {formatScore(stats.average, locale)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Dimension Details */}
            <div className="space-y-4">
              {orderedDimensions.map((dimension) => {
                const stats = getDimensionStats(dimension.id);
                const isActive = activeDiscussDimension === dimension.id;

                return (
                  <div
                    key={dimension.id}
                    ref={(el) => { discussRefs.current[dimension.id] = el; }}
                    data-dimension-id={dimension.id}
                    // The dimension in focus takes the brand edge and a ring
                    // outside its box, so nothing below it moves; hover deepens
                    // the shadow only.
                    className={`bg-white border rounded-xl shadow-xs transition ${
                      isActive ? 'border-indigo-600 ring-4 ring-indigo-600/15' : `border-slate-200 ${isFacilitator ? 'hover:shadow-md' : ''}`
                    }`}
                  >
                    <div
                      className={`p-4 flex items-start gap-3 sm:gap-4 ${isFacilitator ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (!isFacilitator) return;
                        updateSession(s => {
                          s.discussionFocusId = s.discussionFocusId === dimension.id ? null : dimension.id;
                        });
                      }}
                    >
                      <div className={`w-14 h-14 sm:w-16 sm:h-16 rounded-xl ${getScoreBgColor(stats.average)} flex items-center justify-center shrink-0`}>
                        <span className={`text-2xl font-bold tabular-nums ${getScoreTextColor(stats.average)}`}>
                          {formatScore(stats.average, locale)}
                        </span>
                      </div>
                      <div className="grow min-w-0">
                        <h3 className="text-lg font-semibold tracking-tight text-slate-900 mb-0.5 wrap-break-word">{dimension.name}</h3>
                        <p className="text-slate-500 text-sm">
                          {tp('healthCheck.discuss.ratingCount', stats.count)}
                          {stats.comments.length > 0 && ` • ${tp('healthCheck.discuss.commentCount', stats.comments.length)}`}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDescriptions(prev => ({ ...prev, [dimension.id]: !prev[dimension.id] }));
                        }}
                        className={`grid place-items-center shrink-0 w-9 h-9 -my-1 rounded-lg transition ${openDescriptions[dimension.id] ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
                        title={openDescriptions[dimension.id] ? t('healthCheck.discuss.hideDetails') : t('healthCheck.discuss.showDetails')}
                        aria-label={t('healthCheck.discuss.toggleDetails')}
                        aria-pressed={!!openDescriptions[dimension.id]}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">info</span>
                      </button>
                      <span className="material-symbols-outlined text-slate-600 shrink-0 mt-1" aria-hidden="true">
                        {isActive ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>

                    {openDescriptions[dimension.id] && (
                      <div className={`border-t border-slate-200 px-4 py-3 bg-slate-50 grid md:grid-cols-2 gap-3 text-sm ${isActive ? '' : 'rounded-b-xl'}`}>
                        {renderDimensionDescriptions(dimension)}
                      </div>
                    )}

                    {isActive && (
                      <div className="border-t border-slate-200 p-4 bg-slate-50 rounded-b-xl">
                        {/* Distribution */}
                        <div className="mb-4">
                          <h4 className="text-sm font-semibold text-slate-700 mb-2">{t('healthCheck.discuss.voteDistribution')}</h4>
                          <div className="flex items-end justify-between gap-2 sm:gap-3 h-48">
                            {stats.distribution.map((count, i) => {
                              const rating = i + 1;
                              const heightPercent = stats.count > 0 ? (count / stats.count) * 100 : 0;
                              const heightPx = count > 0 ? Math.max((heightPercent / 100) * 100, 20) : 8;
                              const barColor = rating === 5 ? 'bg-emerald-600' : rating === 4 ? 'bg-emerald-400' : rating === 3 ? 'bg-amber-500' : rating === 2 ? 'bg-orange-500' : 'bg-rose-600';
                              const badgeColor = rating === 5 ? 'bg-emerald-100 text-emerald-800' : rating === 4 ? 'bg-emerald-50 text-emerald-800' : rating === 3 ? 'bg-amber-100 text-amber-800' : rating === 2 ? 'bg-orange-100 text-orange-800' : 'bg-rose-100 text-rose-800';

                              // Collect voters for this rating (non-anonymous mode only)
                              const voters = !session.settings.isAnonymous
                                ? Object.entries(session.ratings)
                                    .filter(([, userRatings]) => userRatings[dimension.id]?.rating === rating)
                                    .map(([userId]) => {
                                      const member = participants.find(p => p.id === userId);
                                      return member?.name || t('healthCheck.unknownMember');
                                    })
                                : [];

                              return (
                                <div key={rating} className="flex flex-col items-center flex-1 relative group">
                                  <span className="text-sm font-bold tabular-nums text-slate-700 mb-2">{count}</span>
                                  {/* An empty rating keeps a stub in a neutral
                                      token: its count above says 0. */}
                                  <div
                                    className={`w-full rounded-t-md motion-safe:transition-all motion-safe:duration-300 ${count === 0 ? 'bg-slate-200' : barColor} ${voters.length > 0 ? 'cursor-help' : ''}`}
                                    style={{ height: `${heightPx}px` }}
                                  />
                                  {voters.length > 0 && (
                                    <div className="absolute bottom-full mb-8 left-1/2 -translate-x-1/2 hidden group-hover:block z-50">
                                      <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap">
                                        {voters.map((name, vi) => (
                                          <div key={vi} className="py-0.5">{name}</div>
                                        ))}
                                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-full w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-800"></div>
                                      </div>
                                    </div>
                                  )}
                                  <span className={`mt-2 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold tabular-nums ${badgeColor}`}>
                                    {rating}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Comments — classic submit-then-edit flow (one comment per participant) */}
                        <HealthCheckCommentsSection
                          comments={stats.comments}
                          currentUserId={currentUser.id}
                          getAuthorLabel={getCommentLabel}
                          onAddComment={(text) => setMyComment(dimension.id, text)}
                          onUpdateComment={(text) => setMyComment(dimension.id, text)}
                          onDeleteComment={() => clearMyComment(dimension.id)}
                        />

                        {/* Actions */}
                        <div>
                          <h4 className="text-sm font-semibold text-slate-700 mb-2">{t('healthCheck.discuss.actions')}</h4>
                          {(() => {
                            const proposals = session.actions.filter(a => a.linkedTicketId === dimension.id && a.type === 'proposal');
                            const acceptedActions = session.actions.filter(a => a.linkedTicketId === dimension.id && a.type === 'new');
                            // Counted over both lists in creation order, so accepting
                            // proposal 2 moves it below without renumbering the rest.
                            const proposalNumbers = numberTopicProposals(session.actions, (id) => id === dimension.id);

                            return (
                              <>
                                {proposals.map(p => (
                                  <ProposalActionRow
                                    key={p.id}
                                    proposal={p}
                                    participants={participants}
                                    leftUserIds={session.leftUsers}
                                    currentUserId={currentUser.id}
                                    isFacilitator={isFacilitator}
                                    isEditing={editingProposalId === p.id}
                                    editText={editingProposalText}
                                    onEditTextChange={setEditingProposalText}
                                    onStartEdit={() => handleStartEditProposal(p.id, p.text)}
                                    onSaveEdit={() => handleSaveProposalEdit(p.id)}
                                    onCancelEdit={handleCancelProposalEdit}
                                    onVote={(vote) => handleVoteProposal(p.id, vote)}
                                    onAccept={() => handleAcceptProposal(p.id)}
                                    onDelete={() => handleDeleteProposal(p.id)}
                                    showVoteTypes={showVoteTypes}
                                    number={proposalNumbers.get(p.id)}
                                  />
                                ))}

                                {acceptedActions.map(a => (
                                  <AcceptedActionRow
                                    key={a.id}
                                    action={a}
                                    number={proposalNumbers.get(a.id)}
                                    isFacilitator={isFacilitator}
                                    onUpdate={(text) => {
                                      updateSession(s => {
                                        const action = s.actions.find(x => x.id === a.id);
                                        if (action) action.text = text;
                                      });
                                    }}
                                    onDelete={() => {
                                      updateSession(s => {
                                        s.actions = s.actions.filter(x => x.id !== a.id);
                                      });
                                    }}
                                  />
                                ))}
                              </>
                            );
                          })()}

                          {/* The retrospective's Discuss row (DiscussPhase): the
                              field, the primary Propose, and the facilitator's
                              direct accept as a secondary button. */}
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder={t('healthCheck.discuss.proposePlaceholder')}
                              value={newProposalText}
                              onChange={(e) => setNewProposalText(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddProposal(dimension.id)}
                              className="grow min-w-0 bg-white border border-slate-400 rounded-lg px-3 py-2 text-slate-900 text-sm placeholder:text-slate-500 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 transition"
                            />
                            <button
                              onClick={() => handleAddProposal(dimension.id)}
                              className="bg-indigo-600 text-white px-4 rounded-lg font-semibold text-sm hover:bg-indigo-700 btn-brand-glow transition shrink-0"
                            >
                              {t('healthCheck.discuss.propose')}
                            </button>
                            {isFacilitator && (
                              <button
                                onClick={() => handleDirectAddAction(dimension.id)}
                                className="bg-white text-indigo-700 px-2.5 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition shrink-0 flex items-center"
                                title={t('healthCheck.discuss.directAccept')}
                                aria-label={t('healthCheck.discuss.directAccept')}
                              >
                                <span className="material-symbols-outlined text-sm" aria-hidden="true">check</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // The copy the team record holds, as `toggleGlobalAction` finds it: the
  // backlog first, then every retrospective, then every health check.
  const storedAction = (actionId: string): ActionItem | undefined => {
    const cached = dataService.getTeam(team.id);
    if (!cached) return undefined;
    return [
      cached.globalActions ?? [],
      ...(cached.retrospectives ?? []).map(r => r.actions ?? []),
      ...(cached.healthChecks ?? []).map(h => h.actions ?? [])
    ].flat().find(a => a?.id === actionId);
  };

  // A Review action's done state and assignee are written to the team record
  // first, through the granular routes, as the retrospective's Review does
  // (finding A-10). Written to the session alone, they never reached it: every
  // session persist puts the record's own values back over the session's
  // (dataService.updateHealthCheckSession), so the Dashboard kept listing a
  // ticked action as open, and its Jira batch offered to send it. The record
  // goes first so that persist reads the new value.
  const setReviewActionDone = (action: ActionItem) => {
    if (!isFacilitator) return;
    const done = !action.done;
    // Set, not flipped: a record the bug above left open while the session
    // shows the action done must not be closed by the click that reopens it.
    if (storedAction(action.id)?.done !== done) dataService.toggleGlobalAction(team.id, action.id);
    updateSession(s => {
      const a = s.actions.find(x => x.id === action.id);
      if (a) a.done = done;
    });
  };

  const setReviewActionAssignee = (action: ActionItem, assigneeId: string | null) => {
    if (!isFacilitator) return;
    // Built from the record's copy, not the session's: this screen never
    // reconciles its actions with the record, so an action closed from the
    // Dashboard still reads open here, and a whole-action write saying so
    // would reopen it and drop its closing date for good.
    dataService.updateGlobalAction(team.id, { ...(storedAction(action.id) ?? action), assigneeId });
    updateSession(s => {
      const a = s.actions.find(x => x.id === action.id);
      if (a) a.assigneeId = assigneeId;
    });
  };

  // Render Review Phase
  const renderReview = () => {
    // The team the Jira dialog previews from, with the parent issues as the
    // cache last held them.
    const jiraTeam = recordJiraParents === team.jiraParents ? team : { ...team, jiraParents: recordJiraParents };
    const newActions = session.actions
      .filter(a => a.type === 'new')
      .map(a => withJiraLinkFrom(a, recordJiraLinks.get(a.id)));

    const groupedActions: Record<string, ActionItem[]> = {};
    newActions.forEach(a => {
      const key = a.linkedTicketId || 'general';
      if (!groupedActions[key]) groupedActions[key] = [];
      groupedActions[key].push(a);
    });

    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex flex-wrap justify-between items-center gap-x-4 gap-y-2 shadow-xs shrink-0 z-30">
          <h2 className="font-semibold tracking-tight text-slate-900 text-lg">{t('healthCheck.review.title')}</h2>
          {isFacilitator && (
            <button
              onClick={() => setPhase('CLOSE')}
              className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold text-sm whitespace-nowrap hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 transition"
            >
              {t('healthCheck.review.next')}
            </button>
          )}
        </div>

        <div className="grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="mb-4 empty:hidden">
              <JiraDiscoveryNote status={jiraStatus} isFacilitator={isFacilitator} userId={currentUser.id} />
            </div>
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex flex-wrap items-start justify-between gap-3">
                <span className="font-semibold text-slate-900">{t('healthCheck.review.sessionActions', { count: newActions.length })}</span>
                {/* Its own reason line when the team cannot create yet (finding U-1). */}
                <JiraBatchButton
                  actions={newActions}
                  status={jiraStatus}
                  teamId={team.id}
                  isFacilitator={isFacilitator}
                  sessionId={session.id}
                  kind="healthcheck"
                  team={jiraTeam}
                  session={session}
                  requestedBy={currentUser.name}
                  onDone={readRecordJiraLinks}
                  onStatusStale={() => { void refreshJiraStatus(); }}
                />
              </div>

              {/* The health check's parent issue (sessionParent mode), for the facilitator. */}
              <div className="border-b border-slate-200 px-4 py-2 empty:hidden">
                <JiraParentLine
                  link={recordJiraParents?.[`healthcheck:${session.id}`]}
                  status={jiraStatus}
                  isFacilitator={isFacilitator}
                  kind="healthcheck"
                  session={session}
                  team={jiraTeam}
                />
              </div>

              {newActions.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">
                  {t('healthCheck.review.empty')}
                </div>
              ) : (
                Object.entries(groupedActions).map(([key, actions]) => {
                  const dimension = session.dimensions.find(d => d.id === key);
                  return (
                    <div key={key} className="border-b border-slate-200 last:border-0">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                        <span className="text-sm font-semibold text-slate-600">
                          {dimension ? dimension.name : t('healthCheck.review.general')}
                        </span>
                      </div>
                      {actions.map(action => (
                        <div key={action.id} data-action-id={action.id} className="px-4 py-3 flex items-center hover:bg-slate-50 gap-3">
                          <button
                            onClick={() => setReviewActionDone(action)}
                            className={`grid place-items-center shrink-0 w-8 h-8 rounded-lg transition ${action.done ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-500 hover:bg-slate-100 hover:text-emerald-600'}`}
                            aria-label={action.done ? t('healthCheck.review.markNotDone') : t('healthCheck.review.markDone')}
                          >
                            <span className="material-symbols-outlined" aria-hidden="true">
                              {action.done ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                          </button>
                          <div className="grow min-w-0 flex flex-col">
                            {/* Done is crossed out in a quieter ink, never faded:
                                a fade put the text under 4.5:1. */}
                            <div className={`text-sm ${action.done ? 'line-through text-slate-600' : 'text-slate-900 font-medium'}`}>
                              <span className="wrap-break-word">
                                {action.text}
                              </span>
                            </div>
                            {/* Hidden while the control renders nothing (no Jira,
                                a closed action without an issue). */}
                            <div className="mt-1 empty:hidden">
                              <JiraActionControl
                                action={action}
                                status={jiraStatus}
                                teamId={team.id}
                                isFacilitator={isFacilitator}
                                sessionId={session.id}
                                kind="healthcheck"
                                requestedBy={currentUser.name}
                                team={jiraTeam}
                                session={session}
                                onCreated={readRecordJiraLinks}
                                onStatusStale={() => { void refreshJiraStatus(); }}
                              />
                            </div>
                          </div>
                          <select
                            aria-label={t('healthCheck.review.assigneeFor', { action: action.text })}
                            value={action.assigneeId || ''}
                            disabled={!isFacilitator}
                            onChange={(e) => setReviewActionAssignee(action, e.target.value || null)}
                            className="shrink-0 text-xs bg-white border border-slate-400 rounded-lg px-2 py-1.5 text-slate-900 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-600 min-w-[120px]"
                          >
                            <option value="">{t('healthCheck.review.unassigned')}</option>
                            {assignableMembers.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Close Phase
  const renderClose = () => {
    const myRoti = session.roti[currentUser.id];
    // The results count the same voters as the "x / y voted" line, as on the
    // retro's close screen: a vote from someone marked as having left must not
    // weigh on an average the counter says they are not part of.
    const votes: number[] = Object.entries(session.roti)
      .filter(([userId]) => activeParticipantIds.has(userId))
      .map(([, vote]) => vote);
    const voterCount = activeRotiCount;
    const totalMembers = activeParticipants.length;
    const average = votes.length ? formatScore(votes.reduce((a, b) => a + b, 0) / votes.length, locale) : '-';
    const histogram = [1, 2, 3, 4, 5].map(v => votes.filter(x => x === v).length);
    const maxVal = Math.max(...histogram, 1);

    return (
      <div className="flex flex-col items-center h-full p-4 sm:p-8 bg-slate-900 text-white overflow-y-auto">
        <h1 className="text-3xl font-semibold tracking-tight mb-2 text-center">{t('healthCheck.close.title')}</h1>
        <p className="text-slate-300 mb-8 text-center">{t('healthCheck.close.thanks')}</p>

        <div className="bg-slate-800 p-6 sm:p-8 rounded-2xl border border-slate-700 max-w-5xl w-full text-center">
          <h3 className="text-xl font-semibold mb-6">{t('healthCheck.close.rotiTitle')}</h3>
          {/* The retrospective's ROTI scores (ClosePhase): the chosen one is
              pressed and ringed on the dark card, and grows no more. */}
          <div className="flex justify-center gap-2 mb-8">
            {[1, 2, 3, 4, 5].map(score => (
              <button
                key={score}
                onClick={() => updateSession(s => { s.roti[currentUser.id] = score; })}
                aria-pressed={myRoti === score}
                className={`w-10 h-10 rounded-full font-bold tabular-nums transition ${
                  myRoti === score
                    ? 'bg-indigo-600 text-white ring-2 ring-indigo-300 ring-offset-2 ring-offset-slate-800'
                    : 'bg-slate-700 text-slate-100 hover:bg-slate-600'
                }`}
              >
                {score}
              </button>
            ))}
          </div>

          {!session.settings.revealRoti ? (
            <div className="mb-4">
              <div className="text-slate-300 font-semibold tabular-nums mb-4">{t('healthCheck.close.votedCount', { voted: voterCount, total: totalMembers })}</div>
              {isFacilitator && (
                <button
                  onClick={() => updateSession(s => { s.settings.revealRoti = true; })}
                  className="text-indigo-300 hover:text-white font-semibold underline underline-offset-4 rounded-md"
                >
                  {t('healthCheck.close.reveal')}
                </button>
              )}
            </div>
          ) : (
            <div className="mt-6">
              <div className="flex items-end justify-center h-24 space-x-3 mb-2">
                {histogram.map((count, i) => (
                  <div key={i} className="flex flex-col items-center justify-end h-full">
                    {count > 0 && <span className="text-xs font-bold tabular-nums text-slate-300 mb-1">{count}</span>}
                    {/* An empty score keeps a stub in a dark token, not a fade. */}
                    <div
                      className={`w-8 rounded-t-md relative motion-safe:transition-all motion-safe:duration-500 ${count > 0 ? 'bg-indigo-400' : 'bg-slate-600'}`}
                      style={{ height: count > 0 ? `${(count / maxVal) * 100}%` : '4px' }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-center space-x-3 text-xs tabular-nums text-slate-300 border-t border-slate-700 pt-1">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-8">{i}</div>)}
              </div>
              <div className="mt-4 text-2xl font-bold tabular-nums text-indigo-300">{average} / 5</div>
            </div>
          )}

          {session.settings.revealRoti && (
            <RotiFollowUpActions
              actions={session.actions}
              participants={participants}
              leftUserIds={session.leftUsers}
              currentUserId={currentUser.id}
              isFacilitator={isFacilitator}
              assignableMembers={assignableMembers}
              showVoteTypes={session.settings.showParticipantVotes ?? false}
              proposalText={closeProposalText}
              onProposalTextChange={setCloseProposalText}
              onVoteProposal={handleVoteProposal}
              onAcceptProposal={handleAcceptProposal}
              onDeleteProposal={handleDeleteProposal}
              onAddProposal={handleCloseAddProposal}
              onDirectAddAction={handleCloseDirectAddAction}
              onAssignAction={handleAssignAction}
            />
          )}
        </div>

        {isFacilitator ? (
          <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-semibold hover:bg-slate-100 transition">
            {t('healthCheck.close.returnToDashboard')}
          </button>
        ) : (
          <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-semibold hover:bg-slate-100 transition">
            {t('healthCheck.close.leave')}
          </button>
        )}
      </div>
    );
  };

  // The participants panel is the retro's own (SessionParticipantsPanel): the
  // health check passes only what differs — who counts as done in this phase,
  // and the progress line.
  const participantStatus = (member: User): ParticipantRowStatus | null => {
    if (session.phase === 'SURVEY') {
      const userRatings = session.ratings[member.id] || {};
      return session.dimensions.every(d => userRatings[d.id]?.rating != null)
        ? { kind: 'check', tone: 'strong', title: t('phases.participants.finished') }
        : null;
    }
    if (session.phase === 'CLOSE' && session.roti[member.id]) {
      return { kind: 'check', tone: 'strong', title: t('phases.participants.voteRecorded') };
    }
    return null;
  };

  const participantsFooter = session.phase === 'SURVEY'
    ? t('healthCheck.participants.surveyProgress', { finished: getFinishedCount(), total: activeParticipants.length })
    : session.phase === 'CLOSE'
      ? t('healthCheck.participants.closeProgress', { voted: activeRotiCount, total: activeParticipants.length })
      : tp('healthCheck.participants.count', activeParticipants.length);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {renderHeader()}
      <SessionConnectionBanner
        isLive={isLive}
        joinDeniedReason={deniedReason}
        onReturnToLogin={onSessionExpired ?? onExit}
      />
      <SyncStalledBanner />
      <AvatarDiscoveryHint
        user={currentUser}
        hint={avatarHint}
        visibilityClass={isFacilitator ? 'hidden min-[360px]:flex' : 'flex'}
      />
      {showInvite && (
        <InviteModal
          team={team}
          activeHealthCheck={session}
          onClose={() => setShowInvite(false)}
          onInvitesSent={(invitees) => {
            // Remembered on the health check itself, as in a retro, so the
            // participants panel lists who is still expected to join.
            updateSession(s => {
              s.invitedUsers = recordInvitees(s.invitedUsers, invitees, new Date().toISOString());
            });
          }}
        />
      )}

      <div className="grow flex overflow-hidden">
        <div className="grow overflow-y-auto overflow-x-auto relative flex flex-col">
          {session.phase === 'SURVEY' && renderSurvey()}
          {session.phase === 'DISCUSS' && renderDiscuss()}
          {session.phase === 'REVIEW' && renderReview()}
          {session.phase === 'CLOSE' && renderClose()}
        </div>
        <SessionParticipantsPanel
          participants={participants}
          leftUserIds={session.leftUsers}
          invitedUsers={session.invitedUsers}
          anonymous={session.settings.isAnonymous}
          connectedUsers={connectedUsers}
          currentUser={currentUser}
          isFacilitator={isFacilitator}
          isCollapsed={participantsPanelCollapsed}
          memberStatus={participantStatus}
          footer={participantsFooter}
          onToggleCollapse={() => setParticipantsPanelCollapsed(collapsed => !collapsed)}
          onInvite={() => setShowInvite(true)}
          onToggleLeft={handleToggleParticipantLeft}
          getMemberDisplay={getMemberDisplay}
          isLive={isLive}
          rosterReceived={rosterReceived}
          motionScope={session.phase}
        />
      </div>
      <AvatarPicker
        open={ownAvatar.pickerOpen}
        onClose={ownAvatar.closePicker}
        colorClasses={avatarColorClasses(currentUser.color)}
        initials={viewerInitials(currentUser)}
        name={currentUser.name}
        currentAvatarId={ownAvatar.currentChoice}
        onPick={ownAvatar.pick}
        disabled={!isLive || !!deniedReason}
      />
    </div>
  );
};

export default HealthCheckSession;
