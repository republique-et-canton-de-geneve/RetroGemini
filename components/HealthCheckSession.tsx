
import React, { useState, useEffect, useRef } from 'react';
import { Team, User, HealthCheckSession as HealthCheckSessionType, ActionItem } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import { randomId } from '../utils/randomId';
import InviteModal from './InviteModal';
import ProposalActionRow from './session/ProposalActionRow';
import RotiFollowUpActions from './session/RotiFollowUpActions';
import HealthCheckCommentsSection from './session/HealthCheckCommentsSection';
import SessionParticipantsPanel, { ParticipantRowStatus } from './session/SessionParticipantsPanel';
import { recordInvitees } from './session/sessionInvitees';
import { ROTI_FOLLOW_UP_LINK_ID } from './session/retroConstants';
import {
  mergeRemoteHealthCheckSession,
  registerOwnHealthCheckChanges,
  extendOwnChanges,
  scheduleSessionResend,
  OwnChangeLedger
} from './session/mergeRemoteSession';
import { getAssignableMembers } from './session/assignableMembers';
import { SessionConnectionBanner, SessionSyncChip } from './session/SessionConnectionStatus';
import LanguageSwitcher from './common/LanguageSwitcher';
import { useTranslation } from '../i18n/I18nContext';
import { localizeDecimal } from '../i18n/formatNumber';
import type { MessageKey } from '../i18n/translate';
import { effectiveSessionStatus } from '../utils/sessionStatus';

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
}

const PHASES = ['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSE'] as const;

// Scores keep their one-decimal `toFixed` rounding, so English output is
// unchanged; only the decimal mark follows the reader's locale (3,5 in fr-CH).
const formatScore = (value: number, locale: string): string => localizeDecimal(value.toFixed(1), locale);
const COLOR_POOL = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-pink-500'];

// Component for displaying and editing accepted actions in DISCUSS phase
const AcceptedActionRow: React.FC<{
  action: ActionItem;
  isFacilitator: boolean;
  onUpdate: (text: string) => void;
  onDelete: () => void;
}> = ({ action, isFacilitator, onUpdate, onDelete }) => {
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
    <div className="flex items-center text-sm bg-emerald-50 p-2 rounded-sm border border-emerald-200 mb-2">
      <span className="material-symbols-outlined text-emerald-700 mr-2 text-sm">check_circle</span>
      <span className="text-emerald-700 font-medium text-xs mr-2">{t('healthCheck.discuss.accepted')}</span>
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
          className="grow bg-white border border-emerald-300 rounded-sm px-2 py-1 text-slate-700 focus:outline-hidden focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
        />
      ) : (
        <span className="grow text-emerald-800">{action.text}</span>
      )}
      {isFacilitator && (
        <div className="ml-2">
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              className="text-emerald-400 hover:text-red-500 transition"
              aria-label={t('healthCheck.discuss.deleteAction')}
            >
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          ) : (
            <div className="flex items-center space-x-2 text-xs bg-white border border-slate-200 rounded-sm px-2 py-1 shadow-xs">
              <span className="text-slate-500">{t('healthCheck.discuss.confirmDelete')}</span>
              <button className="text-rose-700 font-bold" onClick={onDelete}>{t('common.yes')}</button>
              <button className="text-slate-500" onClick={() => setConfirmingDelete(false)}>{t('common.no')}</button>
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

const HealthCheckSession: React.FC<Props> = ({ team, currentUser, sessionId, onExit, onTeamUpdate, onSessionExpired }) => {
  const { t, tp, locale } = useTranslation();
  const [session, setSession] = useState<HealthCheckSessionType | undefined>(
    team.healthChecks?.find(h => h.id === sessionId)
  );
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set([currentUser.id]));
  // Optimistic by default: pause editing only after a confirmed disconnect (see
  // Session.tsx) so the initial connecting window and tests still allow edits.
  const [isLive, setIsLive] = useState<boolean>(true);
  const isLiveRef = useRef<boolean>(true);
  // Set when the server refuses the join (audit H12). Unlike a disconnection
  // this never heals on its own, so it must survive a later `connect` event.
  const [joinDeniedReason, setJoinDeniedReason] = useState<string | null>(null);
  const joinDeniedRef = useRef<string | null>(null);
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
  useEffect(() => { ownChangesRef.current.clear(); }, [sessionId]);

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

  // Get participants
  const getParticipants = () => {
    const roster = session?.participants?.length ? [...session.participants] : [];
    if (!roster.some(p => p.id === currentUser.id)) {
      roster.push(currentUser);
    }
    const deduped: typeof roster = [];
    const seen = new Set<string>();
    const seenNames = new Set<string>();
    roster.forEach((p) => {
      const nameKey = p.name.trim().toLowerCase();
      if (seen.has(p.id) || seenNames.has(nameKey)) return;
      seen.add(p.id);
      seenNames.add(nameKey);
      deduped.push(p);
    });
    return deduped;
  };

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
    return { displayName, initials };
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
      // Declare the own-data slices this write changed before it goes out —
      // see the same call in Session.tsx.
      registerOwnHealthCheckChanges(ownChangesRef.current, baseSession, newSession, currentUser.id);
      dataService.updateHealthCheckSession(team.id, newSession);
      dataService.persistParticipants(team.id, newSession.participants);
      syncService.updateSession(newSession);

      return newSession;
    });
  };

  // The status follows the phase, as in a retrospective: opening Close ends the
  // health check with the facilitator's own phase write, rather than waiting
  // for an exit click that a closed tab never makes. Browsing back through the
  // phases — which is how "View Results" is read — never reopens it.
  const setPhase = (phase: typeof PHASES[number]) => {
    updateSession(s => {
      s.phase = phase;
      s.status = effectiveSessionStatus(s);
    });
  };

  // Participant sync helpers (same as Session.tsx)
  const upsertParticipantInSession = (userId: string, userName: string) => {
    const roster = getParticipants();
    const normalizedUserName = userName.trim().toLowerCase();

    // Check if user already exists by ID or name (case-insensitive)
    if (roster.some(p => p.id === userId || p.name.trim().toLowerCase() === normalizedUserName)) return;

    const fallbackColor = COLOR_POOL[roster.length % COLOR_POOL.length];
    const memberFromTeam = (dataService.getTeam(team.id) || team).members.find(m =>
      m.id === userId || m.name.trim().toLowerCase() === normalizedUserName
    );
    const member = memberFromTeam ?? { id: userId, name: userName, color: fallbackColor, role: 'participant' as const };

    updateSession(s => {
      if (!s.participants) s.participants = [];
      const normalizedMemberName = member.name.trim().toLowerCase();
      if (!s.participants.some(p => p.id === member.id || p.name.trim().toLowerCase() === normalizedMemberName)) {
        s.participants.push(member);
      }
    });
  };

  const mergeRoster = (roster: { id: string; name: string }[]) => {
    const existing = sessionRef.current?.participants ?? [];
    const updated = [...existing];
    let nextColorIndex = existing.length;

    roster.forEach((entry) => {
      // Use case-insensitive, trimmed name comparison to avoid duplicates
      const entryNameNormalized = entry.name.trim().toLowerCase();
      const already = updated.find(p =>
        p.id === entry.id ||
        p.name.trim().toLowerCase() === entryNameNormalized
      );
      if (already) {
        already.id = entry.id;
        already.name = entry.name;
        return;
      }

      const teamMember = (dataService.getTeam(team.id) || team).members.find(m =>
        m.id === entry.id ||
        m.name.trim().toLowerCase() === entryNameNormalized
      );
      const color = teamMember?.color || COLOR_POOL[nextColorIndex % COLOR_POOL.length];
      nextColorIndex++;

      updated.push({
        id: entry.id,
        name: entry.name,
        color,
        role: teamMember?.role || 'participant'
      });
    });

    updateSession(s => { s.participants = updated; });
  };

  // Connect to sync service
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        await syncService.connect();
        if (isMounted) {
          syncService.joinSession(sessionId, currentUser.id, currentUser.name);
        }
      } catch (e) {
        console.error('[HealthCheckSession] Failed to connect to sync service', e);
      }
    })();

    const unsubUpdate = syncService.onSessionUpdate((updatedSession) => {
      if (!isHealthCheckSession(updatedSession)) return;
      if (syncService.getCurrentSessionId() !== sessionId || updatedSession.id !== sessionId) return;

      const canonicalName = team.healthChecks?.find(hc => hc.id === updatedSession.id)?.name;
      const normalizedSession = canonicalName && updatedSession.name !== canonicalName
        ? { ...updatedSession, name: canonicalName }
        : updatedSession;

      // Merge strategy: re-apply the current user's own data (ratings, ROTI,
      // proposal votes) on top of the incoming authoritative state, and
      // re-send when the server does not know some of it yet so no user
      // action is lost.
      setSession(prevSession => {
        if (!prevSession) return normalizedSession;

        const { merged, divergent } = mergeRemoteHealthCheckSession(
          normalizedSession,
          prevSession,
          { currentUserId: currentUser.id, ownChanges: ownChangesRef.current }
        );
        if (divergent) {
          scheduleSessionResend(
            { timer: resendTimerRef, isLive: isLiveRef, session: sessionRef },
            s => syncService.updateSession(s)
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
      upsertParticipantInSession(userId, userName);

      // As in a retro: someone marked as "left" who reconnects is back, and
      // the counters wait for them again.
      if (sessionRef.current?.leftUsers?.includes(userId)) {
        updateSession(s => {
          s.leftUsers = (s.leftUsers ?? []).filter(id => id !== userId);
        });
      }
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
      const live = connected && joinDeniedRef.current === null;
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
      isMounted = false;

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
    const hasCurrentUser = session.participants?.some(p => p.id === currentUser.id);
    const markedLeft = session.leftUsers?.includes(currentUser.id);
    if (!hasCurrentUser || !session.participants?.length || markedLeft) {
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

  const handleAddProposal = (linkedDimensionId?: string) => {
    if (!newProposalText.trim()) return;

    updateSession(s => {
      s.actions.push({
        id: randomId(),
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

    updateSession(s => {
      s.actions.push({
        id: randomId(),
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
    updateSession(s => {
      s.actions.push({
        id: randomId(),
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
    updateSession(s => {
      s.actions.push({
        id: randomId(),
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
          the group never shrinks below the back arrow. */}
      <div className="flex items-center h-full min-w-9">
        <button onClick={handleExit} aria-label={t('healthCheck.header.leave')} className="shrink-0 mr-2 sm:mr-3 text-slate-500 hover:text-slate-700">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="hidden lg:flex h-full items-center space-x-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
          {PHASES.map(p => (
            <button
              key={p}
              onClick={() => isFacilitator ? setPhase(p) : null}
              // Only the facilitator moves the health check between phases (see
              // SessionHeader): enabling this for participants of a closed one
              // offered a click that did nothing.
              disabled={!isFacilitator}
              className={`phase-nav-btn h-full shrink-0 whitespace-nowrap px-2 text-[10px] font-bold uppercase ${
                session.phase === p ? 'active' : 'text-slate-500 disabled:opacity-50'
              }`}
            >
              {t(`common.phase.${p}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 justify-end items-center space-x-2 sm:space-x-3">
        {/* Real-time sync indicator. As in the retro header, the reassuring
            "live" chip steps aside on the narrowest phones; a lost connection
            or a refused join always shows. */}
        <div className={isLive && joinDeniedReason === null ? 'hidden min-[400px]:block' : ''}>
          <SessionSyncChip isLive={isLive} joinDeniedReason={joinDeniedReason} />
        </div>

        {/* Participant progress - shown when panel is collapsed or on smaller screens */}
        {(participantsPanelCollapsed || window.innerWidth < 1024) && (
          <div
            className="flex items-center bg-slate-100 px-3 py-1 rounded-sm cursor-pointer hover:bg-slate-200 transition"
            onClick={() => setParticipantsPanelCollapsed(false)}
            title={t('healthCheck.header.expandParticipants')}
          >
            <span className="material-symbols-outlined text-lg mr-1 text-slate-600">groups</span>
            <span className="text-xs font-bold text-slate-700">
              {session.phase === 'SURVEY'
                ? `${getFinishedCount()}/${activeParticipants.length}`
                : session.phase === 'CLOSE'
                ? `${activeRotiCount}/${activeParticipants.length}`
                : `${activeParticipants.length}`
              }
            </span>
            <span className="text-[10px] text-slate-500 ml-1 hidden md:inline">
              {session.phase === 'SURVEY'
                ? t('healthCheck.header.finishedLabel')
                : session.phase === 'CLOSE'
                ? t('healthCheck.header.votedLabel')
                : t('healthCheck.header.participantsLabel')}
            </span>
          </div>
        )}

        {isFacilitator && (
          <button onClick={() => setShowInvite(true)} className="flex items-center text-slate-500 hover:text-retro-primary" title={t('healthCheck.header.invite')} aria-label={t('healthCheck.header.invite')}>
            <span className="material-symbols-outlined text-xl">qr_code_2</span>
          </button>
        )}
        {/* Guests switch language here too: an invite link lands them straight
            in the session, past every other screen that carries the switcher. */}
        <LanguageSwitcher className="shrink-0" />
        {/* The name column yields to the switcher on phones; the avatar keeps
            the initials, as the sync chip keeps its icon. */}
        <div className="hidden sm:flex flex-col items-end mr-2 min-w-0">
          <span className="text-[10px] font-bold text-slate-500 uppercase">{t('healthCheck.header.user')}</span>
          <span className="max-w-32 truncate text-sm font-bold text-slate-700" title={currentUser.name}>{currentUser.name}</span>
        </div>
        <div className={`w-8 h-8 shrink-0 rounded-full ${currentUser.color} text-white flex items-center justify-center text-xs font-bold shadow-md`}>
          {currentUser.name.substring(0, 2).toUpperCase()}
        </div>
      </div>
    </header>
  );

  // Render Survey Phase
  const renderSurvey = () => {
    const myRatings = session.ratings[currentUser.id] || {};

    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-xs">
          <div>
            <h2 className="font-bold text-slate-700 text-lg">{t('healthCheck.survey.title')}</h2>
            <span className="text-slate-500 text-sm ml-4">
              {t('healthCheck.survey.finishedCount', { finished: getFinishedCount(), total: activeParticipants.length })}
            </span>
          </div>
          {isFacilitator && (
            <button
              onClick={() => setPhase('DISCUSS')}
              className="bg-retro-primary text-white px-4 py-2 rounded-sm font-bold text-sm hover:bg-retro-primaryHover"
            >
              {t('healthCheck.survey.next')}
            </button>
          )}
        </div>

        <div className="grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
              <p className="text-indigo-700 text-center text-sm">
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
                  <div key={dimension.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
                    <h3 className="text-xl font-bold text-slate-800 mb-3">{dimension.name}</h3>
                    <div className="grid md:grid-cols-2 gap-4 mb-4 text-sm">
                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                        <span className="text-rose-700 font-bold">{t('healthCheck.dimension.bad')}</span>
                        <span className="text-slate-600 ml-2">{dimension.badDescription}</span>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <span className="text-emerald-700 font-bold">{t('healthCheck.dimension.good')}</span>
                        <span className="text-slate-600 ml-2">{dimension.goodDescription}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-center space-x-3 mb-4">
                      {[1, 2, 3, 4, 5].map(rating => (
                        <button
                          key={rating}
                          onClick={() => handleRating(dimension.id, rating)}
                          className={`w-12 h-12 rounded-full font-bold text-lg transition ${
                            myRating === rating
                              ? 'bg-retro-primary text-white scale-110 shadow-lg'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                          }`}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>

                    <div className="flex justify-between text-[10px] text-slate-500 uppercase px-2 mb-4">
                      <span>{t('healthCheck.survey.scale.stronglyDisagree')}</span>
                      <span>{t('healthCheck.survey.scale.neutral')}</span>
                      <span>{t('healthCheck.survey.scale.stronglyAgree')}</span>
                    </div>

                    <div className="relative">
                      <textarea
                        placeholder={t('healthCheck.survey.commentPlaceholder')}
                        value={displayComment}
                        onChange={(e) => handleComment(dimension.id, e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700 text-sm resize-none h-20 focus:outline-hidden focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
                      />
                      {myRating && (
                        <span className="absolute bottom-3 right-3 text-emerald-500 text-xs font-bold flex items-center">
                          <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
                          {t('healthCheck.survey.saved')}
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
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-xs">
          <div className="flex items-center space-x-4">
            <h2 className="font-bold text-slate-700 text-lg">{t('healthCheck.discuss.title')}</h2>
            {isFacilitator && (
              <label className="flex items-center space-x-1.5 cursor-pointer text-sm text-slate-600 border-l border-slate-200 pl-4">
                <input
                  type="checkbox"
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
              className="bg-retro-primary text-white px-4 py-2 rounded-sm font-bold text-sm hover:bg-retro-primaryHover"
            >
              {t('healthCheck.discuss.next')}
            </button>
          )}
        </div>

        <div className="grow overflow-auto p-6">
          <div className="max-w-5xl mx-auto">
            {/* Radar Chart */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-xs">
              <div className="flex justify-center">
                <svg width="400" height="400" viewBox="0 0 400 400">
                  {[1, 2, 3, 4, 5].map(level => (
                    <circle
                      key={level}
                      cx={centerX}
                      cy={centerY}
                      r={(level / 5) * maxRadius}
                      fill="none"
                      stroke="#e2e8f0"
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
                        stroke="#e2e8f0"
                        strokeWidth="1"
                      />
                    );
                  })}
                  <path
                    d={averagePathD}
                    fill="rgba(79, 70, 229, 0.2)"
                    stroke="#4f46e5"
                    strokeWidth="2"
                  />
                  {averagePoints.map((point, i) => (
                    <circle
                      key={i}
                      cx={point.x}
                      cy={point.y}
                      r="6"
                      fill="#4f46e5"
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
                          className="fill-slate-600 text-[10px] font-medium"
                        >
                          {d.name.length > 12 ? d.name.substring(0, 12) + '...' : d.name}
                        </text>
                        <text
                          x={labelPoint.x}
                          y={labelPoint.y + 12}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="fill-indigo-600 text-xs font-bold"
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
                    className={`bg-white border-2 rounded-xl shadow-xs transition ${
                      isActive ? 'border-retro-primary ring-4 ring-indigo-100' : 'border-slate-200'
                    }`}
                  >
                    <div
                      className={`p-4 flex items-start ${isFacilitator ? 'cursor-pointer' : ''}`}
                      onClick={() => {
                        if (!isFacilitator) return;
                        updateSession(s => {
                          s.discussionFocusId = s.discussionFocusId === dimension.id ? null : dimension.id;
                        });
                      }}
                    >
                      <div className={`w-16 h-16 rounded-xl ${getScoreBgColor(stats.average)} flex items-center justify-center mr-4 shrink-0`}>
                        <span className={`text-2xl font-black ${stats.average >= 4 ? 'text-emerald-700' : stats.average >= 3 ? 'text-amber-600' : 'text-rose-700'}`}>
                          {formatScore(stats.average, locale)}
                        </span>
                      </div>
                      <div className="grow">
                        <h3 className="text-lg font-bold text-slate-800 mb-1">{dimension.name}</h3>
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
                        className={`mr-2 shrink-0 flex items-center transition ${openDescriptions[dimension.id] ? 'text-retro-primary' : 'text-slate-500 hover:text-retro-primary'}`}
                        title={openDescriptions[dimension.id] ? t('healthCheck.discuss.hideDetails') : t('healthCheck.discuss.showDetails')}
                        aria-label={t('healthCheck.discuss.toggleDetails')}
                        aria-pressed={!!openDescriptions[dimension.id]}
                      >
                        <span className="material-symbols-outlined">info</span>
                      </button>
                      <span className="material-symbols-outlined text-slate-500">
                        {isActive ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>

                    {openDescriptions[dimension.id] && (
                      <div className="border-t border-slate-200 px-4 py-3 bg-slate-50 grid md:grid-cols-2 gap-3 text-sm">
                        <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                          <span className="text-rose-700 font-bold">{t('healthCheck.dimension.bad')}</span>
                          <span className="text-slate-600 ml-2">{dimension.badDescription}</span>
                        </div>
                        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                          <span className="text-emerald-700 font-bold">{t('healthCheck.dimension.good')}</span>
                          <span className="text-slate-600 ml-2">{dimension.goodDescription}</span>
                        </div>
                      </div>
                    )}

                    {isActive && (
                      <div className="border-t border-slate-200 p-4 bg-slate-50">
                        {/* Distribution */}
                        <div className="mb-4">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">{t('healthCheck.discuss.voteDistribution')}</h4>
                          <div className="flex items-end justify-between space-x-3 h-48">
                            {stats.distribution.map((count, i) => {
                              const rating = i + 1;
                              const heightPercent = stats.count > 0 ? (count / stats.count) * 100 : 0;
                              const heightPx = count > 0 ? Math.max((heightPercent / 100) * 100, 20) : 8;
                              const barColor = rating === 5 ? 'bg-emerald-600' : rating === 4 ? 'bg-emerald-400' : rating === 3 ? 'bg-amber-500' : rating === 2 ? 'bg-orange-500' : 'bg-rose-600';
                              const badgeColor = rating === 5 ? 'bg-emerald-100 text-emerald-700' : rating === 4 ? 'bg-emerald-50 text-emerald-700' : rating === 3 ? 'bg-amber-100 text-amber-700' : rating === 2 ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700';

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
                                  <span className="text-sm font-bold text-slate-700 mb-2">{count}</span>
                                  <div
                                    className={`w-full rounded-t shadow-md transition-all duration-300 ${barColor} ${count === 0 ? 'opacity-30' : 'opacity-100'} ${voters.length > 0 ? 'cursor-help' : ''}`}
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
                                  <span className={`mt-2 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-xs ${badgeColor}`}>
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
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">{t('healthCheck.discuss.actions')}</h4>
                          {(() => {
                            const proposals = session.actions.filter(a => a.linkedTicketId === dimension.id && a.type === 'proposal');
                            const acceptedActions = session.actions.filter(a => a.linkedTicketId === dimension.id && a.type === 'new');

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
                                  />
                                ))}

                                {acceptedActions.map(a => (
                                  <AcceptedActionRow
                                    key={a.id}
                                    action={a}
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

                          <div className="flex">
                            <input
                              type="text"
                              placeholder={t('healthCheck.discuss.proposePlaceholder')}
                              value={newProposalText}
                              onChange={(e) => setNewProposalText(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddProposal(dimension.id)}
                              className="grow bg-white border border-slate-200 rounded-l-lg p-2 text-slate-700 text-sm focus:outline-hidden focus:border-retro-primary"
                            />
                            <button
                              onClick={() => handleAddProposal(dimension.id)}
                              className="bg-slate-700 text-white px-3 font-bold text-sm hover:bg-slate-800 border-l border-slate-600"
                            >
                              {t('healthCheck.discuss.propose')}
                            </button>
                            {isFacilitator && (
                              <button onClick={() => handleDirectAddAction(dimension.id)} className="bg-retro-primary text-white px-3 rounded-r font-bold text-sm hover:bg-retro-primaryHover" title={t('healthCheck.discuss.directAccept')} aria-label={t('healthCheck.discuss.directAccept')}>
                                <span className="material-symbols-outlined text-sm">check</span>
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

  // Render Review Phase
  const renderReview = () => {
    const newActions = session.actions.filter(a => a.type === 'new');

    const groupedActions: Record<string, ActionItem[]> = {};
    newActions.forEach(a => {
      const key = a.linkedTicketId || 'general';
      if (!groupedActions[key]) groupedActions[key] = [];
      groupedActions[key].push(a);
    });

    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-xs">
          <h2 className="font-bold text-slate-700 text-lg">{t('healthCheck.review.title')}</h2>
          {isFacilitator && (
            <button
              onClick={() => setPhase('CLOSE')}
              className="bg-retro-primary text-white px-4 py-2 rounded-sm font-bold text-sm hover:bg-retro-primaryHover"
            >
              {t('healthCheck.review.next')}
            </button>
          )}
        </div>

        <div className="grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                <span className="font-bold text-slate-700">{t('healthCheck.review.sessionActions', { count: newActions.length })}</span>
              </div>

              {newActions.length === 0 ? (
                <div className="p-8 text-center text-slate-500">
                  {t('healthCheck.review.empty')}
                </div>
              ) : (
                Object.entries(groupedActions).map(([key, actions]) => {
                  const dimension = session.dimensions.find(d => d.id === key);
                  return (
                    <div key={key} className="border-b border-slate-200 last:border-0">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                        <span className="text-sm font-bold text-slate-500">
                          {dimension ? dimension.name : t('healthCheck.review.general')}
                        </span>
                      </div>
                      {actions.map(action => (
                        <div key={action.id} className="px-4 py-3 flex items-center hover:bg-slate-50 gap-3">
                          <button
                            onClick={() => {
                              if (!isFacilitator) return;
                              updateSession(s => {
                                const a = s.actions.find(x => x.id === action.id);
                                if (a) a.done = !a.done;
                              });
                            }}
                            className={`shrink-0 ${action.done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500'}`}
                            aria-label={action.done ? t('healthCheck.review.markNotDone') : t('healthCheck.review.markDone')}
                          >
                            <span className="material-symbols-outlined">
                              {action.done ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                          </button>
                          <div className={`grow min-w-0 text-slate-700 ${action.done ? 'line-through opacity-60' : ''}`}>
                            <span className="wrap-break-word">
                              {action.text}
                            </span>
                          </div>
                          <select
                            aria-label={t('healthCheck.review.assigneeFor', { action: action.text })}
                            value={action.assigneeId || ''}
                            disabled={!isFacilitator}
                            onChange={(e) => {
                              updateSession(s => {
                                const a = s.actions.find(x => x.id === action.id);
                                if (a) a.assigneeId = e.target.value || null;
                              });
                            }}
                            className="shrink-0 text-xs bg-white border border-slate-200 rounded-sm p-1.5 text-slate-600 focus:border-retro-primary min-w-[120px]"
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
      <div className="flex flex-col items-center h-full p-8 bg-slate-900 text-white overflow-y-auto">
        <h1 className="text-3xl font-bold mb-2">{t('healthCheck.close.title')}</h1>
        <p className="text-slate-300 mb-8">{t('healthCheck.close.thanks')}</p>

        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-5xl w-full text-center">
          <h3 className="text-xl font-bold mb-6">{t('healthCheck.close.rotiTitle')}</h3>
          <div className="flex justify-center space-x-2 mb-8">
            {[1, 2, 3, 4, 5].map(score => (
              <button
                key={score}
                onClick={() => updateSession(s => { s.roti[currentUser.id] = score; })}
                className={`w-10 h-10 rounded-full font-bold transition ${
                  myRoti === score
                    ? 'bg-retro-primary text-white scale-110'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {score}
              </button>
            ))}
          </div>

          {!session.settings.revealRoti ? (
            <div className="mb-4">
              <div className="text-slate-300 font-bold mb-4">{t('healthCheck.close.votedCount', { voted: voterCount, total: totalMembers })}</div>
              {isFacilitator && (
                <button
                  onClick={() => updateSession(s => { s.settings.revealRoti = true; })}
                  className="text-indigo-300 hover:text-white font-bold underline"
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
                    {count > 0 && <span className="text-xs font-bold text-slate-300 mb-1">{count}</span>}
                    <div
                      className="w-8 bg-indigo-500 rounded-t relative transition-all duration-500"
                      style={{ height: count > 0 ? `${(count / maxVal) * 100}%` : '4px', opacity: count > 0 ? 1 : 0.2 }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-center space-x-3 text-xs text-slate-300 border-t border-slate-700 pt-1">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-8">{i}</div>)}
              </div>
              <div className="mt-4 text-2xl font-black text-indigo-300">{average} / 5</div>
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
          <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">
            {t('healthCheck.close.returnToDashboard')}
          </button>
        ) : (
          <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">
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
        joinDeniedReason={joinDeniedReason}
        onReturnToLogin={onSessionExpired ?? onExit}
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
        />
      </div>
    </div>
  );
};

export default HealthCheckSession;
