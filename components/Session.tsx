
import React, { useState, useEffect, useRef } from 'react';
import { Team, User, RetroSession, Ticket, ActionItem, Group } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import InviteModal from './InviteModal';
import { isLightColor } from '../utils/colorUtils';
import ParticipantsPanel from './session/ParticipantsPanel';
import SessionHeader from './session/SessionHeader';
import OpenActionsPhase from './session/OpenActionsPhase';
import ReviewPhase from './session/ReviewPhase';
import ClosePhase from './session/ClosePhase';
import IcebreakerPhase from './session/IcebreakerPhase';
import WelcomePhase from './session/WelcomePhase';
import DiscussPhase from './session/DiscussPhase';

interface Props {
  team: Team;
  currentUser: User;
  sessionId: string;
  onExit: () => void;
  onTeamUpdate?: (team: Team) => void;
}

const PHASES = ['ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'BRAINSTORM', 'GROUP', 'VOTE', 'DISCUSS', 'REVIEW', 'CLOSE'];
const EMOJIS = ['👍', '👎', '❤️', '🎉', '👏', '😄', '😮', '🤔', '😡', '😢'];
const COLOR_POOL = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-pink-500'];

// Map Tailwind color classes to hex values
const TAILWIND_COLOR_MAP: Record<string, string> = {
  'bg-indigo-500': '#6366f1',
  'bg-emerald-500': '#10b981',
  'bg-amber-500': '#f59e0b',
  'bg-rose-500': '#f43f5e',
  'bg-cyan-500': '#06b6d4',
  'bg-fuchsia-500': '#d946ef',
  'bg-lime-500': '#84cc16',
  'bg-pink-500': '#ec4899'
};

const isRetroSession = (session: unknown): session is RetroSession => {
  if (!session || typeof session !== 'object') return false;
  return 'columns' in (session as Record<string, unknown>) && 'tickets' in (session as Record<string, unknown>);
};

const ICEBREAKERS = [
    "What was the highlight of your week?",
    "If you could have any superpower, what would it be?",
    "What is your favorite book/movie of all time?",
    "What’s one thing you’re learning right now?",
    "If you could travel anywhere tomorrow, where would you go?",
    "What is your favorite meal to cook or eat?",
    "What’s a hobby you’d love to get into?",
    "Who is your favorite fictional character?",
    "What’s the best advice you’ve ever received?",
    "If you were a vegetable, what would you be?",
    "What was your first job?",
    "Coffee or Tea? And how do you take it?",
    "What is one thing you are grateful for today?",
    "If you could meet any historical figure, who would it be?",
    "What is your favorite season and why?",
    "What was the last thing you binge-watched?",
    "Do you have any pets? Tell us about them.",
    "What’s your favorite board game?",
    "If you could instantly master a skill, what would it be?",
    "What is the most adventurous thing you've ever done?"
];

const Session: React.FC<Props> = ({ team, currentUser, sessionId, onExit, onTeamUpdate }) => {
  const [session, setSession] = useState<RetroSession | undefined>(team.retrospectives.find(r => r.id === sessionId));
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set([currentUser.id]));
  const presenceBroadcasted = useRef(false);

  useEffect(() => {
    presenceBroadcasted.current = false;
  }, [sessionId]);

  // Use a Ref to hold the latest session state to prevent Timer/Interaction race conditions
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const isFacilitator = currentUser.role === 'facilitator';

  const [showInvite, setShowInvite] = useState(false);
  const [draggedTicket, setDraggedTicket] = useState<Ticket | null>(null);
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchMovedRef = useRef(false);
  const pendingTouchTicketRef = useRef<Ticket | null>(null);

  // Drag Target State for explicit visual cues
  const [dragTarget, setDragTarget] = useState<{ type: 'COLUMN' | 'ITEM', id: string } | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);

  // Focus management for new groups
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  // Focus management for new columns
  const [focusColumnId, setFocusColumnId] = useState<string | null>(null);

  // Editing Ticket State
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const editingTicketIdRef = useRef<string | null>(null);
  // Editing Group State
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const editingGroupIdRef = useRef<string | null>(null);

  useEffect(() => { editingTicketIdRef.current = editingTicketId; }, [editingTicketId]);
  useEffect(() => { editingGroupIdRef.current = editingGroupId; }, [editingGroupId]);

  // Interaction State
  const [emojiPickerOpenId, setEmojiPickerOpenId] = useState<string | null>(null);
  const emojiPickerRef = useRef<HTMLDivElement | null>(null);

  // Open Actions Phase State
  const [reviewActionIds, setReviewActionIds] = useState<string[]>([]);

  // Local state for debounced inputs to prevent sync conflicts
  const [localIcebreakerQuestion, setLocalIcebreakerQuestion] = useState<string | null>(null);
  const icebreakerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Review Phase State (History persistence)
  const [historyActionIds, setHistoryActionIds] = useState<string[]>([]);

  // Proposal State
  const [newProposalText, setNewProposalText] = useState('');
  const [activeDiscussTicket, setActiveDiscussTicket] = useState<string | null>(null);
  const discussRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [editingProposalId, setEditingProposalId] = useState<string | null>(null);
  const [editingProposalText, setEditingProposalText] = useState('');

  // UI State
  const [isEditingColumns, setIsEditingColumns] = useState(false);
  const [isEditingTimer, setIsEditingTimer] = useState(false);
  const [timerEditMin, setTimerEditMin] = useState('5');
  const [timerEditSec, setTimerEditSec] = useState('0');
  // Local timer display to avoid sync race conditions
  const [localTimerSeconds, setLocalTimerSeconds] = useState(session?.settings.timerSeconds ?? 0);
  const [maxVotesInput, setMaxVotesInput] = useState(session?.settings.maxVotes.toString() ?? '5');
  // Local participants panel state (not synced across users)
  const [localParticipantsPanelCollapsed, setLocalParticipantsPanelCollapsed] = useState(!isFacilitator);

  // Sync maxVotesInput with session changes
  useEffect(() => {
    if (session?.settings.maxVotes) {
      setMaxVotesInput(session.settings.maxVotes.toString());
    }
  }, [session?.settings.maxVotes]);

  // Audio ref
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = 0.3;
    }
  }, []);

  const getAnonymizedLabel = (memberId: string) => {
    if (!session?.settings.isAnonymous) return null;
    const index = participants.findIndex((m) => m.id === memberId);
    const anonNumber = index >= 0 ? index + 1 : participants.length + 1;
    return `Participant ${anonNumber}`;
  };

  const getMemberDisplay = (member: User) => {
    const anonymous = getAnonymizedLabel(member.id);
    const displayName = anonymous || member.name;
    const initials = displayName.substring(0, 2).toUpperCase();
    return { displayName, initials };
  };

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

  const buildActionContext = (action: ActionItem, teamData: Team) => {
    if (action.contextText) return action.contextText;
    if (!action.linkedTicketId) return '';

    for (const r of teamData.retrospectives) {
      const t = r.tickets.find(x => x.id === action.linkedTicketId);
      if (t) {
        return `Re: "${t.text.substring(0, 50)}${t.text.length > 50 ? '...' : ''}"`;
      }
      const g = r.groups.find(x => x.id === action.linkedTicketId);
      if (g) {
        return `Re: Group "${g.title}"`;
      }
    }

    return '';
  };

  const upsertParticipantInSession = (userId: string, userName: string) => {
    const roster = getParticipants();
    if (roster.some(p => p.id === userId)) return;

    const fallbackColor = COLOR_POOL[roster.length % COLOR_POOL.length];
    const memberFromTeam = (dataService.getTeam(team.id) || team).members.find(m => m.id === userId || m.name === userName);

    const member = memberFromTeam ?? { id: userId, name: userName, color: fallbackColor, role: 'participant' as const };

    updateSession(s => {
      if (!s.participants) s.participants = [];
      if (!s.participants.some(p => p.id === member.id)) {
        s.participants.push(member);
      }
    });
  };

  const mergeRoster = (roster: { id: string; name: string }[]) => {
    const existing = sessionRef.current?.participants ?? [];
    const updated = [...existing];
    let nextColorIndex = existing.length;

    roster.forEach((entry) => {
      const already = updated.find(p => p.id === entry.id || p.name === entry.name);
      if (already) {
        already.id = entry.id;
        already.name = entry.name;
        return;
      }

      const teamMember = (dataService.getTeam(team.id) || team).members.find(m => m.id === entry.id || m.name === entry.name);
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

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerOpenId && emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setEmojiPickerOpenId(null);
      }
    };

    if (emojiPickerOpenId) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [emojiPickerOpenId]);

  // Connect to sync service on mount
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        await syncService.connect();
        if (isMounted) {
          syncService.joinSession(sessionId, currentUser.id, currentUser.name);
        }
      } catch (e) {
        console.error('[Session] Failed to connect to sync service', e);
      }
    })();

    // Listen for session updates from other clients
    const unsubUpdate = syncService.onSessionUpdate((updatedSession) => {
      if (!isRetroSession(updatedSession)) return;
      if (syncService.getCurrentSessionId() !== sessionId || updatedSession.id !== sessionId) return;

      const canonicalName = team.retrospectives.find(r => r.id === updatedSession.id)?.name;
      const normalizedSession = canonicalName && updatedSession.name !== canonicalName
        ? { ...updatedSession, name: canonicalName }
        : updatedSession;

      // Merge strategy: preserve current user's data being actively edited
      setSession(prevSession => {
        if (!prevSession) return normalizedSession;

        const mergedSession = { ...normalizedSession };

        // Preserve icebreaker question if facilitator is actively editing
        if (currentUser.role === 'facilitator' && localIcebreakerQuestion !== null) {
          mergedSession.icebreakerQuestion = prevSession.icebreakerQuestion;
        }

        // Preserve tickets being edited by current user
        if (editingTicketIdRef.current) {
          const prevTicket = prevSession.tickets.find(t => t.id === editingTicketIdRef.current);
          const updatedTicketIndex = mergedSession.tickets.findIndex(t => t.id === editingTicketIdRef.current);
          if (prevTicket && updatedTicketIndex !== -1) {
            mergedSession.tickets[updatedTicketIndex] = { ...mergedSession.tickets[updatedTicketIndex], text: prevTicket.text };
          }
        }

        // Preserve group title being edited by current user
        if (editingGroupIdRef.current) {
          const prevGroup = prevSession.groups.find(g => g.id === editingGroupIdRef.current);
          const updatedGroupIndex = mergedSession.groups.findIndex(g => g.id === editingGroupIdRef.current);
          if (prevGroup && updatedGroupIndex !== -1) {
            mergedSession.groups[updatedGroupIndex] = { ...mergedSession.groups[updatedGroupIndex], title: prevGroup.title };
          }
        }

        // Preserve current user's happiness vote (Welcome phase)
        if (prevSession.happiness[currentUser.id] !== undefined) {
          mergedSession.happiness = {
            ...updatedSession.happiness,
            [currentUser.id]: prevSession.happiness[currentUser.id]
          };
        }

        // Preserve current user's ROTI vote (Close phase)
        if (prevSession.roti[currentUser.id] !== undefined) {
          mergedSession.roti = {
            ...updatedSession.roti,
            [currentUser.id]: prevSession.roti[currentUser.id]
          };
        }

        // Preserve current user's votes on tickets and groups (Vote phase)
        // BUT: Don't restore if maxVotes decreased (facilitator is cleaning up excess votes)
        const maxVotesChanged = normalizedSession.settings.maxVotes !== prevSession.settings.maxVotes;

        mergedSession.tickets = mergedSession.tickets.map(ticket => {
          const prevTicket = prevSession.tickets.find(t => t.id === ticket.id);
          if (!prevTicket) return ticket;
          if (normalizedSession.settings.oneVotePerTicket) return ticket;
          if (maxVotesChanged) return ticket; // Don't restore votes when max changed

          // Get current user's votes from previous state
          const prevUserVotes = prevTicket.votes.filter(v => v === currentUser.id);
          // Remove current user's votes from updated state (might be stale)
          const otherVotes = ticket.votes.filter(v => v !== currentUser.id);
          // Combine: other users' latest votes + current user's preserved votes
          return {
            ...ticket,
            votes: [...otherVotes, ...prevUserVotes]
          };
        });

        mergedSession.groups = mergedSession.groups.map(group => {
          const prevGroup = prevSession.groups.find(g => g.id === group.id);
          if (!prevGroup) return group;
          if (normalizedSession.settings.oneVotePerTicket) return group;
          if (maxVotesChanged) return group; // Don't restore votes when max changed

          // Get current user's votes from previous state
          const prevUserVotes = prevGroup.votes.filter(v => v === currentUser.id);
          // Remove current user's votes from updated state (might be stale)
          const otherVotes = group.votes.filter(v => v !== currentUser.id);
          // Combine: other users' latest votes + current user's preserved votes
          return {
            ...group,
            votes: [...otherVotes, ...prevUserVotes]
          };
        });

        return mergedSession;
      });

      // Persist latest state to the shared data cache
      dataService.updateSession(team.id, normalizedSession);
    });

    // Listen for member events
    const unsubJoin = syncService.onMemberJoined(({ userId, userName }) => {
      if (syncService.getCurrentSessionId() !== sessionId) return;

      setConnectedUsers(prev => new Set([...prev, userId]));
      upsertParticipantInSession(userId, userName);
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

    // Send initial session state (facilitator sends their version)
    if (currentUser.role === 'facilitator' && session) {
      setTimeout(() => syncService.updateSession(session), 500);
    }

    return () => {
      unsubUpdate();
      unsubJoin();
      unsubLeave();
      unsubRoster();
      syncService.leaveSession();
      isMounted = false;

      // Clear pending icebreaker timer
      if (icebreakerTimerRef.current) {
        clearTimeout(icebreakerTimerRef.current);
        icebreakerTimerRef.current = null;
      }
    };
  }, [sessionId, currentUser.id, currentUser.name, currentUser.role, team.id]);

  // Ensure the shared roster includes the currently connected user only
  useEffect(() => {
    if (!session) return;

    const hasCurrentUser = session.participants?.some(p => p.id === currentUser.id);

    if (!hasCurrentUser || !session.participants?.length) {
      updateSession(s => {
        if (!s.participants) s.participants = [];

        if (!s.participants.some(p => p.id === currentUser.id)) {
          s.participants.push(currentUser);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Follow facilitator-selected discussion focus
  useEffect(() => {
    setActiveDiscussTicket(session?.discussionFocusId ?? null);
  }, [session?.discussionFocusId]);

  useEffect(() => {
    if (!activeDiscussTicket) return;
    const target = discussRefs.current[activeDiscussTicket];
    if (target) {
      setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    }
  }, [activeDiscussTicket]);

    // Force update wrapper using Ref for reliability
    const updateSession = (updater: (s: RetroSession) => void) => {
    const baseSession = sessionRef.current
      ?? dataService.getTeam(team.id)?.retrospectives.find(r => r.id === sessionId)
      ?? null;

    if(!baseSession) return;

    const newSession = JSON.parse(JSON.stringify(baseSession));
    if (!newSession.participants) newSession.participants = [];

    const existingIds = new Set(newSession.participants.map(p => p.id));
    const baselineMembers = getParticipants();
    baselineMembers.forEach(m => {
      if (!existingIds.has(m.id)) {
        newSession.participants!.push(m);
        existingIds.add(m.id);
      }
    });
    if (!existingIds.has(currentUser.id)) {
      newSession.participants!.push(currentUser);
      existingIds.add(currentUser.id);
    }

    updater(newSession);
    dataService.updateSession(team.id, newSession);
    dataService.persistParticipants(team.id, newSession.participants);
    setSession(newSession);
    // Sync to other clients via WebSocket
    syncService.updateSession(newSession);
  };

  // Handle icebreaker question change with debounce to prevent sync conflicts
  const handleIcebreakerChange = (value: string) => {
    // Update local state immediately for responsive UI
    setLocalIcebreakerQuestion(value);

    // Clear existing timer
    if (icebreakerTimerRef.current) {
      clearTimeout(icebreakerTimerRef.current);
    }

    // Debounce sync to server (500ms after last keystroke)
    icebreakerTimerRef.current = setTimeout(() => {
      updateSession(s => {
        s.icebreakerQuestion = value;
      });

      // Clear local state after sync
      setLocalIcebreakerQuestion(null);
    }, 500);
  };

  // Ensure each client broadcasts their presence once so the facilitator sees them immediately
  useEffect(() => {
    if (!session || presenceBroadcasted.current) return;
    presenceBroadcasted.current = true;

    updateSession((s) => {
      if (!s.participants) s.participants = [];
      if (!s.participants.some((p) => p.id === currentUser.id)) {
        s.participants.push(currentUser);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, currentUser.id]);

  // Calculate votes left in render scope for Auto-Finish Logic
  const myTicketVotes = session ? session.tickets.reduce((acc, t) => acc + t.votes.filter(v => v === currentUser.id).length, 0) : 0;
  const myGroupVotes = session ? session.groups.reduce((acc, g) => acc + g.votes.filter(v => v === currentUser.id).length, 0) : 0;
  const votesLeft = session ? session.settings.maxVotes - (myTicketVotes + myGroupVotes) : 0;

  // Auto Finish / Unfinish Effect
  useEffect(() => {
      if (!session || session.phase !== 'VOTE') return;

      const wasFinished = session.finishedUsers?.includes(currentUser.id) || false;
      const wasAutoFinished = session.autoFinishedUsers?.includes(currentUser.id) || false;

      // Auto FINISH if 0 votes left
      if (votesLeft <= 0 && !wasFinished) {
          const timer = setTimeout(() => {
              updateSession(s => {
                  if (!s.finishedUsers.includes(currentUser.id)) {
                      s.finishedUsers.push(currentUser.id);
                  }
                  if (!s.autoFinishedUsers) s.autoFinishedUsers = [];
                  if (!s.autoFinishedUsers.includes(currentUser.id)) {
                      s.autoFinishedUsers.push(currentUser.id);
                  }
              });
          }, 800);
          return () => clearTimeout(timer);
      }

      // Auto UN-FINISH if votes become available (e.g. user removed a vote, or maxVotes increased)
      if (votesLeft > 0 && wasAutoFinished) {
           updateSession(s => {
               s.finishedUsers = s.finishedUsers.filter(id => id !== currentUser.id);
               s.autoFinishedUsers = (s.autoFinishedUsers || []).filter(id => id !== currentUser.id);
           });
      }
  }, [votesLeft, session?.phase, currentUser.id, session?.finishedUsers, session?.autoFinishedUsers]);


  // Initialize review actions when entering OPEN_ACTIONS phase
  useEffect(() => {
      if (session?.phase !== 'OPEN_ACTIONS') return;

      const currentTeam = dataService.getTeam(team.id) || team;
      const prevRetros = currentTeam.retrospectives.filter(r => r.id !== sessionId);
      const globalOpen = currentTeam.globalActions.filter(a => !a.done);
      // Exclude proposals - only accepted actions (type !== 'proposal') should appear
      const retroOpen = prevRetros.flatMap(r => r.actions.filter(a => !a.done && a.type !== 'proposal'));

      const snapshot = [...globalOpen, ...retroOpen].map(a => ({
          ...a,
          contextText: buildActionContext(a, currentTeam)
      }));

      const allIds = snapshot.map(a => a.id);

      if (reviewActionIds.length === 0 && allIds.length > 0) {
          setReviewActionIds([...new Set(allIds)]);
      }

      if (isFacilitator) {
            const existingSnapshot = session.openActionsSnapshot || [];
            const existingMap = new Map(existingSnapshot.map(a => [a.id, a]));

            const mergedSnapshot: ActionItem[] = snapshot.map(a => {
                const existing = existingMap.get(a.id);
                return {
                    ...a,
                  done: existing?.done ?? a.done,
                  assigneeId: existing?.assigneeId ?? a.assigneeId,
              };
          });

            existingSnapshot.forEach(a => {
                if (!mergedSnapshot.some(m => m.id === a.id)) mergedSnapshot.push(a);
            });

          updateSession(s => { s.openActionsSnapshot = mergedSnapshot; });
      } else if (!reviewActionIds.length && session.openActionsSnapshot?.length) {
          setReviewActionIds(session.openActionsSnapshot.map(a => a.id));
      }
  }, [session?.phase, refreshTick, isFacilitator]);

  // Initialize history actions when entering REVIEW phase
  useEffect(() => {
      if (session?.phase !== 'REVIEW') return;

      const currentTeam = dataService.getTeam(team.id) || team;
      const newActionIds = sessionRef.current?.actions.map(a => a.id) || [];

      const allGlobal = currentTeam.globalActions;
      // Exclude proposals - only accepted actions should appear
      const allRetroActions = currentTeam.retrospectives.filter(r => r.id !== sessionId).flatMap(r => r.actions.filter(a => a.type !== 'proposal'));

      const relevantActions = [...allGlobal, ...allRetroActions]
        .filter(a => !a.done && !newActionIds.includes(a.id))
        .map(a => ({ ...a, contextText: buildActionContext(a, currentTeam) }));

      if (historyActionIds.length === 0 && relevantActions.length > 0) {
          setHistoryActionIds(relevantActions.map(a => a.id));
      }

      if (isFacilitator) {
          const currentSnapshot = session.historyActionsSnapshot?.map(a => a.id).join(',') ?? '';
          const incomingSnapshot = relevantActions.map(a => a.id).join(',');

          if (currentSnapshot !== incomingSnapshot) {
              updateSession(s => { s.historyActionsSnapshot = relevantActions; });
          }
      } else if (!historyActionIds.length && session.historyActionsSnapshot?.length) {
          setHistoryActionIds(session.historyActionsSnapshot.map(a => a.id));
      }
  }, [session?.phase, refreshTick, isFacilitator]);

  // Timer Effect - uses local state to avoid sync race conditions with card updates
  // Only syncs when timer starts, stops, or finishes (not every tick)
  useEffect(() => {
    let interval: any;
    const startedAt = session?.settings.timerStartedAt;
    const timerInitial = session?.settings.timerInitial ?? 0;

    if (session?.settings.timerRunning && startedAt) {
      // Calculate remaining time from timestamp
      const calculateRemaining = () => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        return Math.max(0, timerInitial - elapsed);
      };

      // Set initial value
      setLocalTimerSeconds(calculateRemaining());

      interval = setInterval(() => {
        const remaining = calculateRemaining();
        setLocalTimerSeconds(remaining);

        // Timer finished - sync to other clients
        if (remaining === 0) {
          clearInterval(interval);
          if (audioRef.current) {
            audioRef.current.play().catch(e => console.log("Audio play failed", e));
          }
          // Sync the timer end state to all clients
          updateSession(s => {
            s.settings.timerRunning = false;
            s.settings.timerSeconds = 0;
            s.settings.timerAcknowledged = false;
          });
        }
      }, 1000);
    } else if (!session?.settings.timerRunning) {
      // Timer not running - sync local display with session state
      setLocalTimerSeconds(session?.settings.timerSeconds ?? 0);
    }

    return () => clearInterval(interval);
  }, [session?.settings.timerRunning, session?.settings.timerStartedAt, session?.settings.timerInitial, session?.settings.timerSeconds]);

  if (!session) return <div>Session not found</div>;
  const participants = getParticipants();
  const assignableMembers = Array.from(
    new Map(
      [...participants, ...team.members, ...(team.archivedMembers || [])].map(m => [m.id, m])
    ).values()
  );
  const timerAcknowledged = session.settings.timerAcknowledged ?? false;
  const timerFinished = localTimerSeconds === 0 && !session.settings.timerRunning;

  // --- Logic ---
  const handleExit = () => {
      dataService.persistParticipants(team.id, getParticipants());
      if (session.phase !== 'CLOSE') {
          session.status = 'IN_PROGRESS';
      } else {
          session.status = 'CLOSED';
      }
      dataService.updateSession(team.id, session);
      onExit();
  };

  const handleRandomIcebreaker = () => {
      const random = ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)];
      updateSession(s => s.icebreakerQuestion = random);
  };

  const handleToggleOneVote = (checked: boolean) => {
      updateSession(s => {
          s.settings.oneVotePerTicket = checked;
          if (checked) {
              const memberIds = new Set<string>();
              s.participants?.forEach(p => memberIds.add(p.id));
              team.members.forEach(m => memberIds.add(m.id));
              (team.archivedMembers || []).forEach(m => memberIds.add(m.id));
              s.tickets.forEach(t => t.votes.forEach(v => memberIds.add(v)));
              s.groups.forEach(g => g.votes.forEach(v => memberIds.add(v)));

              memberIds.forEach(memberId => {
                  s.tickets.forEach(t => {
                      const userVotes = t.votes.filter(id => id === memberId);
                      if(userVotes.length > 1) {
                          t.votes = t.votes.filter(id => id !== memberId);
                          t.votes.push(memberId);
                      }
                  });
                  s.groups.forEach(g => {
                      const userVotes = g.votes.filter(id => id === memberId);
                      if(userVotes.length > 1) {
                          g.votes = g.votes.filter(id => id !== memberId);
                          g.votes.push(memberId);
                      }
                  });
              });
          }
      });
  };

  const handleMaxVotesChange = (newVal: number) => {
      const newMax = Math.max(1, newVal);
      updateSession(s => {
          s.settings.maxVotes = newMax;
          
          // Cleanup excess votes for ALL members
          participants.forEach(member => {
              let memberVotes = 0;
              // Count current total votes
              s.tickets.forEach(t => memberVotes += t.votes.filter(v => v === member.id).length);
              s.groups.forEach(g => memberVotes += g.votes.filter(v => v === member.id).length);

              let toRemove = memberVotes - newMax;

              if (toRemove > 0) {
                  // Remove from Tickets first
                  for (const t of s.tickets) {
                      while (toRemove > 0 && t.votes.includes(member.id)) {
                          const idx = t.votes.indexOf(member.id);
                          if (idx > -1) {
                              t.votes.splice(idx, 1);
                              toRemove--;
                          }
                      }
                      if (toRemove === 0) break;
                  }
                  
                  // Remove from Groups if still over limit
                  if (toRemove > 0) {
                      for (const g of s.groups) {
                          while (toRemove > 0 && g.votes.includes(member.id)) {
                              const idx = g.votes.indexOf(member.id);
                              if (idx > -1) {
                                  g.votes.splice(idx, 1);
                                  toRemove--;
                              }
                          }
                          if (toRemove === 0) break;
                      }
                  }
              }
          });
      });
  };

  const setPhase = (p: string) => updateSession(s => {
      s.phase = p;
      s.settings.timerRunning = false;
      s.settings.timerSeconds = s.settings.timerInitial || 300;
      s.settings.timerAcknowledged = false;
      s.finishedUsers = [];
      s.autoFinishedUsers = [];
      setIsEditingColumns(false);
      setIsEditingTimer(false);
      setEditingTicketId(null);
      if(p==='CLOSE') s.status = 'CLOSED';
  });

  const applyActionUpdate = (actionId: string, updater: (a: ActionItem) => void, fallback?: ActionItem) => {
      updateSession(s => {
          const buckets = [s.actions, s.openActionsSnapshot, s.historyActionsSnapshot];
          let updated = false;
          buckets.forEach(list => list?.forEach(a => {
              if (a.id === actionId) {
                  updater(a);
                  updated = true;
              }
          }));

          if (!updated && fallback) {
              if (!s.openActionsSnapshot) s.openActionsSnapshot = [];
              const cloned = JSON.parse(JSON.stringify(fallback));
              updater(cloned);
              s.openActionsSnapshot.push(cloned);
          }
      });
  };

  const formatTime = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const acknowledgeTimer = () => {
      if (sessionRef.current?.settings.timerSeconds === 0 && !sessionRef.current.settings.timerAcknowledged) {
          const timerInitial = sessionRef.current.settings.timerInitial ?? 0;
          setLocalTimerSeconds(timerInitial);
          updateSession((s) => {
              s.settings.timerAcknowledged = true;
              s.settings.timerSeconds = timerInitial;
              s.settings.timerStartedAt = undefined;
          });
      }
  };

  const addTimeToTimer = (seconds: number) => {
      updateSession((s) => {
          if (s.settings.timerRunning && s.settings.timerStartedAt) {
              // If timer is running, just increase timerInitial
              // remaining = timerInitial - elapsed, so increasing timerInitial increases remaining
              s.settings.timerInitial = (s.settings.timerInitial || 0) + seconds;
          } else {
              // If timer is stopped, add to current seconds
              const newTime = (s.settings.timerSeconds || 0) + seconds;
              s.settings.timerSeconds = newTime;
              s.settings.timerInitial = newTime;
          }
      });
      // Update local display immediately
      setLocalTimerSeconds(prev => prev + seconds);
  };

  const saveTimerEdit = () => {
      const mins = parseInt(timerEditMin) || 0;
      const secs = parseInt(timerEditSec) || 0;
      const newSeconds = (mins * 60) + secs;
      setLocalTimerSeconds(newSeconds);
      updateSession(s => {
          s.settings.timerSeconds = newSeconds;
          s.settings.timerInitial = newSeconds;
          s.settings.timerRunning = false;
          s.settings.timerStartedAt = undefined;
          s.settings.timerAcknowledged = false;
      });
      setIsEditingTimer(false);
  };

  // --- Drag & Drop Helpers ---
  const checkAndDissolveGroup = (s: RetroSession, groupId: string | null, ticketIdToIgnore: string) => {
      if (!groupId) return;
      const siblings = s.tickets.filter(t => t.groupId === groupId && t.id !== ticketIdToIgnore);
      if (siblings.length <= 1) {
          if (siblings.length === 1) siblings[0].groupId = null;
          s.groups = s.groups.filter(g => g.id !== groupId);
      }
  };

  // --- Drag & Drop ---
  const resetDragState = () => {
      setDraggedTicket(null);
      setIsTouchDragging(false);
      setDragTarget(null);
  };

  const handleDragStart = (e: React.DragEvent, ticket: Ticket) => {
      setDraggedTicket(ticket);
      setIsTouchDragging(false);
      e.dataTransfer.effectAllowed = 'move';

      // Create a fully opaque drag image (browsers make the default ghost semi-transparent)
      const cardEl = e.currentTarget as HTMLElement;
      const clone = cardEl.cloneNode(true) as HTMLElement;
      clone.style.opacity = '1';
      clone.style.transform = 'none';
      clone.style.position = 'absolute';
      clone.style.top = '-9999px';
      clone.style.left = '-9999px';
      clone.style.width = `${cardEl.offsetWidth}px`;
      clone.style.pointerEvents = 'none';
      clone.style.zIndex = '9999';
      document.body.appendChild(clone);
      e.dataTransfer.setDragImage(clone, cardEl.offsetWidth / 2, 20);
      // Clean up the clone after the drag starts
      requestAnimationFrame(() => {
          document.body.removeChild(clone);
      });

      e.stopPropagation();
  };

  const handleTouchStart = (ticket: Ticket) => {
      // Avoid replacing the currently selected card when we're already in a touch-drag flow
      if (isTouchDragging && draggedTicket) {
          return;
      }

      setDraggedTicket(ticket);
      setIsTouchDragging(true);
      setDragTarget({ type: 'ITEM', id: ticket.id });
  };

  const handleDragOverColumn = (e: React.DragEvent, colId: string) => {
      e.preventDefault();
      // Only set drag target if we aren't already hovering a specific item
      // This is a bit tricky with event bubbling, so we rely on stopPropagation in items
      setDragTarget({ type: 'COLUMN', id: colId });
  };

  const handleDragOverItem = (e: React.DragEvent, itemId: string) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent column from catching this
      setDragTarget({ type: 'ITEM', id: itemId });
  };

  const performDropOnColumn = (colId: string) => {
      setDragTarget(null);
      if(!draggedTicket) return;
      if(session.phase !== 'GROUP') return;

      updateSession(s => {
          const t = s.tickets.find(x => x.id === draggedTicket.id);
          if(t) {
              checkAndDissolveGroup(s, t.groupId, t.id);
              t.colId = colId;
              t.groupId = null; // Explicitly ungroup
          }
      });
      resetDragState();
  };

  const handleDropOnColumn = (e: React.DragEvent, colId: string) => {
      e.preventDefault();
      performDropOnColumn(colId);
  };

  const dropOnColumnByTouch = (colId: string) => {
      if (!isTouchDragging) return;
      performDropOnColumn(colId);
  };

  const performDropOnTicket = (targetTicket: Ticket) => {
      setDragTarget(null);
      if(!draggedTicket) return;
      if (draggedTicket.id === targetTicket.id) {
          resetDragState();
          return;
      }
      if (draggedTicket.groupId && draggedTicket.groupId === targetTicket.groupId) {
          resetDragState();
          return;
      }
      if(session.phase !== 'GROUP') return;

      updateSession(s => {
          const draggedT = s.tickets.find(x => x.id === draggedTicket.id);
          if (draggedT) {
             checkAndDissolveGroup(s, draggedT.groupId, draggedT.id);
             draggedT.votes = []; // Clear votes on the moving ticket
          }

          if(targetTicket.groupId) {
              if(draggedT) {
                  draggedT.groupId = targetTicket.groupId;
                  draggedT.colId = targetTicket.colId;
              }
          } else {
              const newGroupId = Math.random().toString(36).substr(2,9);
              s.groups.push({ id: newGroupId, title: '', colId: targetTicket.colId, votes: [] });

              const t1 = s.tickets.find(x => x.id === targetTicket.id);
              if(t1) {
                  t1.groupId = newGroupId;
                  t1.votes = []; // CRITICAL: Clear votes on the target ticket too when creating a new group
              }

              if(draggedT) {
                  draggedT.groupId = newGroupId;
                  draggedT.colId = targetTicket.colId;
              }
              setFocusGroupId(newGroupId);
          }
      });
      resetDragState();
  };

  const handleDropOnTicket = (e: React.DragEvent, targetTicket: Ticket) => {
      e.preventDefault();
      e.stopPropagation();
      performDropOnTicket(targetTicket);
  };

  const performDropOnGroup = (targetGroup: Group) => {
      setDragTarget(null);
      if(!draggedTicket) return;
      if (draggedTicket.groupId === targetGroup.id) {
          resetDragState();
          return;
      }
      if(session.phase !== 'GROUP') return;

      updateSession(s => {
          const t = s.tickets.find(x => x.id === draggedTicket.id);
          if(t) {
              checkAndDissolveGroup(s, t.groupId, t.id);
              t.groupId = targetGroup.id;
              t.colId = targetGroup.colId;
              t.votes = [];
          }
      });
      resetDragState();
  };

  const handleDropOnGroup = (e: React.DragEvent, targetGroup: Group) => {
      e.preventDefault();
      e.stopPropagation();
      performDropOnGroup(targetGroup);
  };

  // --- Discuss & Proposals ---
  const handleAddProposal = (linkedId: string) => {
      if(!newProposalText.trim()) return;
      updateSession(s => {
          s.actions.push({
              id: Math.random().toString(36).substr(2,9),
              text: newProposalText,
              assigneeId: null,
              done: false,
              type: 'proposal',
              linkedTicketId: linkedId,
              proposalVotes: {}
          });
      });
      setNewProposalText('');
  };

  const handleDirectAddAction = (linkedId: string) => {
      if(!newProposalText.trim()) return;
      updateSession(s => {
          s.actions.push({
              id: Math.random().toString(36).substr(2,9),
              text: newProposalText,
              assigneeId: null,
              done: false,
              type: 'new', // Directly 'new' instead of 'proposal'
              linkedTicketId: linkedId,
              proposalVotes: {}
          });
      });
      setNewProposalText('');
  };

  const handleVoteProposal = (actionId: string, vote: 'up'|'down'|'neutral') => {
      updateSession(s => {
          const a = s.actions.find(x => x.id === actionId);
          // Only allow voting on proposals, not accepted actions
          if(a && a.type === 'proposal') {
              if(!a.proposalVotes) a.proposalVotes = {};
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
          // Only accept if still a proposal (prevents race condition)
          if(a && a.type === 'proposal') {
              a.type = 'new';
          }
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
          s.actions = s.actions.filter(a => a.id !== actionId);
      });
  };

  const handleToggleNextTopicVote = (topicId: string) => {
      updateSession(s => {
          // Initialize the structure if needed
          if (!s.discussionNextTopicVotes) {
              s.discussionNextTopicVotes = {};
          }
          if (!s.discussionNextTopicVotes[topicId]) {
              s.discussionNextTopicVotes[topicId] = [];
          }

          // Toggle vote
          const topicVotes = s.discussionNextTopicVotes[topicId];
          const userIndex = topicVotes.indexOf(currentUser.id);
          if (userIndex > -1) {
              // Remove vote
              topicVotes.splice(userIndex, 1);
          } else {
              // Add vote
              topicVotes.push(currentUser.id);
          }
      });
  };

  const getSortedTicketsForDiscuss = () => {
      const items: {id: string, text: string, votes: number, type: 'group'|'ticket', ref: any}[] = [];
      session.tickets.filter(t => !t.groupId).forEach(t => {
          items.push({ id: t.id, text: t.text, votes: t.votes.length, type: 'ticket', ref: t });
      });
      session.groups.forEach(g => {
          const count = g.votes.length;
          items.push({ id: g.id, text: g.title, votes: count, type: 'group', ref: g });
      });
      return items.sort((a,b) => b.votes - a.votes);
  };

  // --- RENDERERS ---

  const renderTicketCard = (t: Ticket, mode: 'BRAINSTORM'|'GROUP'|'VOTE', canVote: boolean, myVotesOnThis: number, isGrouped: boolean = false) => {
      const isMine = t.authorId === currentUser.id;
      const author = participants.find(m => m.id === t.authorId);
      const showContent = isMine || session.settings.revealBrainstorm;
      const visible = (mode === 'GROUP' || mode === 'VOTE') ? true : showContent;
      const isPickerOpen = emojiPickerOpenId === t.id;
      const isEditing = editingTicketId === t.id;

      // explicit drag styling
      const isDragTarget = mode === 'GROUP' && dragTarget?.type === 'ITEM' && dragTarget.id === t.id && draggedTicket?.id !== t.id;
      const isSelected = mode === 'GROUP' && draggedTicket?.id === t.id;

      // Color by author or topic
      const colorBy = session.settings.colorBy || 'topic';
      const column = session.columns.find(c => c.id === t.colId);
      let cardBgHex: string | null = null;

      if (colorBy === 'author' && author && visible) {
        // Use author's color for background
        cardBgHex = TAILWIND_COLOR_MAP[author.color] || null;
      } else if (colorBy === 'topic' && column?.customColor && visible) {
        // Use column's custom color for background
        cardBgHex = column.customColor;
      }

      // Determine text color based on background brightness
      const cardTextColor = cardBgHex
        ? (isLightColor(cardBgHex) ? 'text-slate-900' : 'text-white')
        : 'text-slate-900'; // Default white background needs dark text

      return (
        <div
            key={t.id}
            draggable={mode === 'GROUP'}
            onDragStart={(e) => handleDragStart(e, t)}
            onDragEnd={() => resetDragState()}
            onDragOver={(e) => mode === 'GROUP' ? handleDragOverItem(e, t.id) : undefined}
            onDrop={(e) => handleDropOnTicket(e, t)}
            onTouchStart={(e) => {
                if (mode !== 'GROUP') return;
                const touch = e.touches[0];
                if (!touch) return;
                touchStartRef.current = { x: touch.clientX, y: touch.clientY };
                touchMovedRef.current = false;
                pendingTouchTicketRef.current = t;
            }}
            onTouchMove={(e) => {
                if (mode !== 'GROUP') return;
                const touch = e.touches[0];
                const start = touchStartRef.current;
                if (!touch || !start) return;
                const dx = touch.clientX - start.x;
                const dy = touch.clientY - start.y;
                if (Math.hypot(dx, dy) > 8) {
                    touchMovedRef.current = true;
                    pendingTouchTicketRef.current = null;
                }
            }}
            onTouchEnd={() => {
                if (mode !== 'GROUP') return;
                const pendingTicket = pendingTouchTicketRef.current;
                if (!touchMovedRef.current && pendingTicket) {
                    handleTouchStart(pendingTicket);
                }
                touchStartRef.current = null;
                touchMovedRef.current = false;
                pendingTouchTicketRef.current = null;
            }}
            onClick={(e) => {
                if (mode !== 'GROUP' || !isTouchDragging) return;
                const target = e.target as HTMLElement;
                if (target.closest('button') || target.closest('textarea') || target.closest('input')) return;
                if (draggedTicket?.id === t.id) {
                    resetDragState();
                } else {
                    performDropOnTicket(t);
                }
            }}
            className={`p-3 rounded shadow-sm border group relative mb-2 transition-all
                ${mode === 'GROUP' ? 'cursor-grab active:cursor-grabbing' : ''}
                ${isDragTarget ? 'ring-4 ring-indigo-400 border-indigo-500 z-20' : isSelected ? 'ring-4 ring-blue-400 border-blue-500 shadow-lg z-10' : ''}
                ${!cardBgHex ? 'bg-white border-slate-200' : ''}
            `}
            style={cardBgHex ? {
                backgroundColor: cardBgHex,
                borderColor: isDragTarget ? undefined : isSelected ? undefined : cardBgHex,
                borderWidth: '2px'
            } : undefined}
        >
            {isDragTarget && (
                <div className="-mx-3 -mt-3 mb-2 bg-indigo-500 flex items-center justify-center rounded-t font-bold text-white text-xs py-1 pointer-events-none">
                    <span className="material-symbols-outlined text-sm mr-1">merge</span> Group with this
                </div>
            )}

            {isSelected && (
                <div className="-mx-3 -mt-3 mb-2 bg-blue-500 flex items-center justify-center rounded-t font-bold text-white text-xs py-1 pointer-events-none">
                    <span className="material-symbols-outlined text-sm mr-1">touch_app</span> Selected - Tap to cancel
                </div>
            )}

            {isEditing ? (
                 <textarea
                    autoFocus
                    defaultValue={t.text}
                    onBlur={(e) => {
                        const val = e.currentTarget.value.trim();
                        if(val) updateSession(s => { const tk = s.tickets.find(x => x.id === t.id); if(tk) tk.text = val; });
                        setEditingTicketId(null);
                    }}
                    onKeyDown={(e) => {
                        if(e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            e.currentTarget.blur();
                        }
                    }}
                    className="w-full text-sm outline-none bg-slate-50 border border-indigo-300 rounded p-1 resize-none"
                    rows={2}
                 />
            ) : (
                <div className="relative">
                    <div className={`text-sm w-full whitespace-pre-wrap break-words ${!visible ? 'ticket-blur' : cardTextColor} ${visible && !session.settings.isAnonymous && author ? 'pr-8' : ''}`}>
                        {t.text}
                    </div>
                    {visible && mode === 'BRAINSTORM' && (isMine || isFacilitator) && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); setEditingTicketId(t.id); }}
                            className="absolute top-0 right-8 text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition"
                            title="Edit"
                        >
                            <span className="material-symbols-outlined text-sm">edit</span>
                        </button>
                    )}
                </div>
            )}
            
            {visible && !session.settings.isAnonymous && author && (
                <div className="absolute top-2 right-2">
                    <div className={`w-6 h-6 rounded-full ${author.color} text-white flex items-center justify-center text-[10px] font-bold shadow-sm ring-1 ring-white`}>
                        {author.name.substring(0,2).toUpperCase()}
                    </div>
                </div>
            )}

            {(mode === 'BRAINSTORM' || mode === 'GROUP') && visible && !isEditing && (
                <div className="mt-2 flex flex-wrap gap-1 relative">
                    {Object.entries(t.reactions || {}).map(([emoji, users]: [string, string[]]) => (
                        <button 
                            key={emoji} 
                            onClick={(e) => {
                                e.stopPropagation();
                                updateSession(s => {
                                    const tk = s.tickets.find(x => x.id === t.id);
                                    if(tk) {
                                        if(!tk.reactions) tk.reactions = {};
                                        if(!tk.reactions[emoji]) tk.reactions[emoji] = [];
                                        if(tk.reactions[emoji].includes(currentUser.id)) {
                                            tk.reactions[emoji] = tk.reactions[emoji].filter(u => u !== currentUser.id);
                                            if(tk.reactions[emoji].length === 0) delete tk.reactions[emoji];
                                        } else {
                                            tk.reactions[emoji].push(currentUser.id);
                                        }
                                    }
                                });
                            }}
                            className={`text-base px-2 py-1 rounded border ${users.includes(currentUser.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100'}`}
                        >
                            {emoji} <span className="text-xs font-bold text-slate-500">{users.length}</span>
                        </button>
                    ))}
                    <div className="relative">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setEmojiPickerOpenId(isPickerOpen ? null : t.id);
                            }}
                            className={`text-slate-300 hover:text-slate-500 hover:bg-slate-100 rounded-full w-8 h-8 flex items-center justify-center transition ${isPickerOpen ? 'bg-slate-100 text-slate-500' : ''}`}
                        >
                            <span className="material-symbols-outlined text-base">add_reaction</span>
                        </button>

                        {isPickerOpen && (
                            <div ref={emojiPickerRef} className="absolute top-full left-0 bg-white border border-slate-200 shadow-xl rounded-lg p-2 grid grid-cols-5 gap-1 z-50 w-max mt-1">
                                {EMOJIS.map(e => (
                                    <button 
                                        key={e}
                                        className="hover:bg-slate-100 p-1.5 rounded text-lg transition transform hover:scale-125"
                                        onClick={(evt) => {
                                            evt.stopPropagation();
                                            updateSession(s => {
                                                const tk = s.tickets.find(x => x.id === t.id);
                                                if(tk) {
                                                    if(!tk.reactions) tk.reactions = {};
                                                    if(!tk.reactions[e]) tk.reactions[e] = [];
                                                    if(!tk.reactions[e].includes(currentUser.id)) tk.reactions[e].push(currentUser.id);
                                                }
                                            });
                                            setEmojiPickerOpenId(null); // Close after select
                                        }}
                                    >
                                        {e}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {(isMine || isFacilitator) && mode === 'BRAINSTORM' && (
                <button
                    onClick={(e) => { e.stopPropagation(); updateSession(s => s.tickets = s.tickets.filter(x => x.id !== t.id)); }}
                    className="absolute bottom-2 right-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100"
                >
                    <span className="material-symbols-outlined text-sm">delete</span>
                </button>
            )}
            
            {mode === 'VOTE' && !isGrouped && (
                <div className="mt-2 pt-2 border-t border-slate-100 flex justify-end">
                    <div className="flex items-center bg-indigo-50 rounded-lg p-1 shadow-sm">
                        <button disabled={myVotesOnThis === 0} onClick={() => updateSession(s => { const tick = s.tickets.find(x => x.id === t.id); if(tick) { const idx = tick.votes.indexOf(currentUser.id); if(idx>-1) tick.votes.splice(idx,1); } })} className="w-6 h-6 flex items-center justify-center text-indigo-600 hover:bg-indigo-200 rounded disabled:opacity-30"><span className="material-symbols-outlined text-sm">remove</span></button>
                        <span className="mx-2 font-bold text-indigo-800 w-4 text-center">{myVotesOnThis}</span>
                        <button disabled={!canVote} onClick={() => updateSession(s => { const tick = s.tickets.find(x => x.id === t.id); if(tick) tick.votes.push(currentUser.id); })} className="w-6 h-6 flex items-center justify-center text-indigo-600 hover:bg-indigo-200 rounded disabled:opacity-30"><span className="material-symbols-outlined text-sm">add</span></button>
                    </div>
                </div>
            )}
        </div>
      );
  };

  const renderColumns = (mode: 'BRAINSTORM'|'GROUP'|'VOTE') => {
      const finishedCount = session.finishedUsers?.length || 0;
      const totalMembers = participants.length;
      const isFinished = session.finishedUsers?.includes(currentUser.id);

      const renderPhaseActionBar = () => (
          <div className="bg-white border-b px-6 py-3 flex justify-between items-center shrink-0 shadow-sm z-30 sticky top-0">
               <div className="flex items-center space-x-4">
                   {mode === 'BRAINSTORM' && (
                       <span className="font-bold text-slate-700 text-lg">Brainstorm</span>
                   )}
                   {mode === 'GROUP' && (
                       <span className="font-bold text-slate-700 text-lg">Group Ideas</span>
                   )}
                   {mode === 'VOTE' && (
                       <div className="flex items-center">
                           <span className="font-bold text-slate-700 text-lg mr-4">Vote</span>
                           <div className="text-sm font-medium bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full border border-indigo-200">
                               {Math.max(0, votesLeft)} votes remaining
                           </div>
                       </div>
                   )}

                   {mode === 'BRAINSTORM' && isFacilitator && (
                       <>
                           <label className="flex items-center space-x-2 text-sm text-slate-500 cursor-pointer border-l border-slate-200 pl-4">
                               <input type="checkbox" checked={session.settings.revealBrainstorm} onChange={(e) => updateSession(s => s.settings.revealBrainstorm = e.target.checked)} />
                               <span>Reveal cards</span>
                           </label>
                           <div className="flex items-center space-x-2 border-l border-slate-200 pl-4">
                             <span className="text-xs text-slate-500 font-medium">Color by:</span>
                             <select
                               value={session.settings.colorBy || 'topic'}
                               onChange={(e) => updateSession(s => s.settings.colorBy = e.target.value as 'author' | 'topic')}
                               className="text-xs bg-white border border-slate-300 rounded px-2 py-1 text-slate-700 font-medium cursor-pointer hover:border-slate-400"
                             >
                               <option value="topic">Topic</option>
                               <option value="author">Author</option>
                             </select>
                           </div>
                           <button
                                onClick={() => setIsEditingColumns(!isEditingColumns)}
                                className={`flex items-center space-x-1 px-3 py-1 rounded text-sm font-bold transition ${isEditingColumns ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
                           >
                               <span className="material-symbols-outlined text-sm">view_column</span>
                               <span>{isEditingColumns ? 'Done Editing' : 'Edit Layout'}</span>
                           </button>
                       </>
                   )}

                   {mode === 'VOTE' && isFacilitator && (
                        <div className="flex items-center space-x-2 text-sm text-slate-600 border-l border-slate-200 pl-4">
                             <label className="flex items-center space-x-1 cursor-pointer">
                                 <input type="checkbox" checked={session.settings.oneVotePerTicket} onChange={(e) => handleToggleOneVote(e.target.checked)} />
                                 <span>1 vote/item</span>
                             </label>
                             <div className="flex items-center bg-slate-100 rounded overflow-hidden">
                                 <span className="px-2">Max:</span>
                                 <button
                                     onClick={() => handleMaxVotesChange(session.settings.maxVotes - 1)}
                                     className="px-2 py-1 hover:bg-slate-200 transition flex items-center justify-center"
                                     title="Decrease max votes"
                                 >
                                     <span className="material-symbols-outlined text-sm">keyboard_arrow_down</span>
                                 </button>
                                 <input
                                     type="text"
                                     inputMode="numeric"
                                     className="w-12 bg-transparent text-center font-bold outline-none text-slate-900"
                                     value={maxVotesInput}
                                     onChange={(e) => {
                                         const val = e.target.value;
                                         // Allow empty or numeric values
                                         if (val === '' || /^\d+$/.test(val)) {
                                             setMaxVotesInput(val);
                                             // Only update session if valid number >= 1
                                             const num = parseInt(val);
                                             if (!isNaN(num) && num >= 1) {
                                                 handleMaxVotesChange(num);
                                             }
                                         }
                                     }}
                                     onBlur={() => {
                                         // On blur, ensure we have a valid value
                                         const val = parseInt(maxVotesInput);
                                         if (isNaN(val) || val < 1) {
                                             // Revert to current session value or default to 1
                                             const currentVal = session.settings.maxVotes || 1;
                                             setMaxVotesInput(currentVal.toString());
                                             if (currentVal !== session.settings.maxVotes) {
                                                 handleMaxVotesChange(currentVal);
                                             }
                                         }
                                     }}
                                 />
                                 <button
                                     onClick={() => handleMaxVotesChange(session.settings.maxVotes + 1)}
                                     className="px-2 py-1 hover:bg-slate-200 transition flex items-center justify-center"
                                     title="Increase max votes"
                                 >
                                     <span className="material-symbols-outlined text-sm">keyboard_arrow_up</span>
                                 </button>
                             </div>
                        </div>
                   )}
               </div>

               <div className="flex items-center space-x-3">
                   {(mode === 'BRAINSTORM' || mode === 'VOTE') && (
                       <div className="flex items-center space-x-2 mr-4">
                            <button
                                onClick={() => updateSession(s => {
                                    if(!s.finishedUsers) s.finishedUsers = [];
                                    if(!s.autoFinishedUsers) s.autoFinishedUsers = s.autoFinishedUsers ?? [];
                                    if(s.finishedUsers.includes(currentUser.id)) {
                                        s.finishedUsers = s.finishedUsers.filter(id => id !== currentUser.id);
                                        s.autoFinishedUsers = (s.autoFinishedUsers || []).filter(id => id !== currentUser.id);
                                    } else {
                                        s.finishedUsers.push(currentUser.id);
                                        s.autoFinishedUsers = (s.autoFinishedUsers || []).filter(id => id !== currentUser.id);
                                    }
                                })}
                                disabled={mode === 'VOTE' && isFinished && votesLeft === 0}
                                className={`px-4 py-2 rounded-lg font-bold text-sm shadow transition ${
                                    isFinished
                                        ? `bg-emerald-500 text-white ${mode === 'VOTE' && votesLeft === 0 ? 'opacity-60 cursor-not-allowed' : 'hover:bg-emerald-600'}`
                                        : 'bg-white text-slate-700 hover:bg-slate-100'
                                }`}
                            >
                                {isFinished ? 'Finished!' : "I'm Finished"}
                            </button>
                       </div>
                   )}

                   {isFacilitator && (
                       <button 
                            onClick={() => {
                                if(mode === 'BRAINSTORM') setPhase('GROUP');
                                else if(mode === 'GROUP') setPhase('VOTE');
                                else if(mode === 'VOTE') setPhase('DISCUSS');
                            }} 
                            className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover"
                       >
                           Next Phase
                       </button>
                   )}
               </div>
          </div>
      );

      const touchSelectionActive = mode === 'GROUP' && isTouchDragging && !!draggedTicket;

      return (
        <div className="flex flex-col h-full overflow-hidden">
            {renderPhaseActionBar()}
            {mode === 'GROUP' && (
                <div className="px-6 pt-3 md:hidden">
                    <div className={`text-xs rounded-lg border p-3 shadow-sm ${touchSelectionActive ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                        {touchSelectionActive
                            ? 'Card selected. Tap another card, group, or column to move it there. Tap the selected card again to cancel.'
                            : 'Touch hint: tap a card to select it, then tap another card or group to move it.'}
                    </div>
                </div>
            )}
            <div
                className="flex-grow overflow-x-auto bg-slate-50 p-6 flex space-x-6 items-start h-auto min-h-0 justify-start"
                onWheel={(e) => {
                    // Allow mouse wheel scrolling during drag
                    if (mode === 'GROUP' && draggedTicket) {
                        e.currentTarget.scrollLeft += e.deltaY;
                    }
                }}
            >
                {session.columns.map(col => {
                    const tickets = session.tickets.filter(t => t.colId === col.id && !t.groupId);
                    const groups = session.groups.filter(g => g.colId === col.id);

                    // Group by Author if in GROUP phase
                    const groupedTickets: Record<string, Ticket[]> = {};
                    if (mode === 'GROUP') {
                        tickets.forEach(t => {
                            if(!groupedTickets[t.authorId]) groupedTickets[t.authorId] = [];
                            groupedTickets[t.authorId].push(t);
                        });
                    }

                    const isColumnDragTarget = mode === 'GROUP' && dragTarget?.type === 'COLUMN' && dragTarget.id === col.id;

                    return (
                        <div 
                            key={col.id} 
                            className={`flex flex-col w-80 md:w-96 flex-shrink-0 bg-white rounded-xl border shadow-sm relative pb-3 h-fit max-h-none transition-colors
                                ${isColumnDragTarget ? 'border-indigo-500 bg-indigo-50 border-2' : 'border-slate-200'}
                            `}
                            onDragOver={(e) => mode === 'GROUP' ? handleDragOverColumn(e, col.id) : e.preventDefault()}
                            onDragLeave={(e) => {
                                if (mode !== 'GROUP') return;
                                const nextTarget = e.relatedTarget as Node | null;
                                if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
                                    setDragTarget(null);
                                }
                            }}
                            onDrop={(e) => handleDropOnColumn(e, col.id)}
                        >
                            {/* Explicit Drop Overlay for Columns */}
                            {isColumnDragTarget && (
                                <div className="absolute inset-0 bg-indigo-100/50 z-20 flex items-center justify-center rounded-xl pointer-events-none border-2 border-indigo-400 border-dashed m-2">
                                     <div className="bg-white px-4 py-2 rounded shadow text-indigo-700 font-bold flex items-center">
                                         <span className="material-symbols-outlined mr-2">move_item</span>
                                         Move to {col.title}
                                     </div>
                                </div>
                            )}

                            {isEditingColumns && (
                                <button 
                                    onClick={() => updateSession(s => { s.columns = s.columns.filter(c => c.id !== col.id); })}
                                    className="absolute top-2 right-2 z-10 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center shadow hover:bg-red-600"
                                >
                                    <span className="material-symbols-outlined text-sm">close</span>
                                </button>
                            )}

                            <div className="p-3 border-b border-slate-100 font-bold flex items-center justify-between bg-white">
                                {isEditingColumns ? (
                                    <input
                                        value={col.title}
                                        autoFocus={focusColumnId === col.id}
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) => updateSession(s => { const c = s.columns.find(x => x.id === col.id); if(c) c.title = e.target.value; })}
                                        onKeyDown={(e) => {
                                            if(e.key === 'Enter') {
                                                e.currentTarget.blur();
                                                setFocusColumnId(null);
                                            }
                                        }}
                                        className="bg-white/50 border border-slate-300 rounded px-2 py-1 text-sm w-full mr-8"
                                    />
                                ) : (
                                    <div
                                        className={`flex items-center ${!col.customColor ? col.text : ''}`}
                                        style={col.customColor ? { color: col.customColor } : undefined}
                                    >
                                        <span className="material-symbols-outlined mr-2">{col.icon}</span> {col.title}
                                    </div>
                                )}
                                <span className="bg-slate-100 px-2 py-0.5 rounded-full text-xs font-bold text-slate-600">{tickets.length + groups.length}</span>
                            </div>
                            <div className="p-3 space-y-3 bg-slate-50/50 relative">
                                {mode === 'BRAINSTORM' && (
                                    <div
                                        className={`bg-white p-3 rounded border shadow-sm focus-within:ring-2 transition ${!col.customColor ? 'border-slate-200 ' + col.ring : ''}`}
                                        style={col.customColor ? {
                                            borderColor: col.customColor + '40',
                                            '--tw-ring-color': col.customColor + '30'
                                        } as React.CSSProperties : undefined}
                                    >
                                        <textarea 
                                            placeholder="Add an idea..." 
                                            className="w-full text-sm resize-none outline-none bg-transparent text-slate-900" 
                                            rows={2}
                                            onKeyDown={(e) => {
                                                if(e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    const val = e.currentTarget.value.trim();
                                                    if(val) {
                                                        updateSession(s => s.tickets.push({
                                                            id: Math.random().toString(36).substr(2,9), colId: col.id, text: val, authorId: currentUser.id, groupId: null, votes: []
                                                        }));
                                                        e.currentTarget.value = '';
                                                    }
                                                }
                                            }}
                                        />
                                    </div>
                                )}
                                
                                {groups.map(g => {
                                    const myVotesOnThis = g.votes.filter(v => v === currentUser.id).length;
                                    const canVote = votesLeft > 0 && (!session.settings.oneVotePerTicket || myVotesOnThis === 0);
                                    const isGroupDragTarget = mode === 'GROUP' && dragTarget?.type === 'ITEM' && dragTarget.id === g.id;

                                    return (
                                        <div
                                            key={g.id}
                                            className={`bg-indigo-50/50 p-3 rounded-xl border-2 relative group-container mb-3 transition-all
                                                ${isGroupDragTarget ? 'border-indigo-500 ring-4 ring-indigo-200 z-20 scale-105' : 'border-dashed border-indigo-300'}
                                            `}
                                            onDragOver={(e) => mode === 'GROUP' ? handleDragOverItem(e, g.id) : undefined}
                                            onDrop={(e) => handleDropOnGroup(e, g)}
                                            onClick={(e) => {
                                                if (mode !== 'GROUP' || !isTouchDragging) return;
                                                const target = e.target as HTMLElement;
                                                if (target.closest('button') || target.closest('textarea') || target.closest('input')) return;
                                                performDropOnGroup(g);
                                            }}
                                        >
                                            {isGroupDragTarget && (
                                                <div className="absolute inset-0 bg-indigo-100/80 z-20 flex items-center justify-center rounded-xl pointer-events-none">
                                                     <div className="text-indigo-800 font-bold bg-white/80 px-2 py-1 rounded">Add to Group</div>
                                                </div>
                                            )}

                                            <div className="flex items-center justify-between mb-2 pb-2 border-b border-indigo-200/50">
                                                <div className="flex flex-col w-full">
                                                    <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-1 flex items-center">
                                                        <span className="material-symbols-outlined text-sm mr-1">layers</span> Group
                                                    </div>
                                                    {mode === 'GROUP' ? (
                                                        <input 
                                                            value={g.title} 
                                                            autoFocus={focusGroupId === g.id}
                                                            onFocus={() => setEditingGroupId(g.id)}
                                                            onBlur={() => {
                                                                setFocusGroupId(null);
                                                                setEditingGroupId(null);
                                                            }}
                                                            onKeyDown={(e) => {
                                                                if(e.key === 'Enter') e.currentTarget.blur();
                                                            }}
                                                            onChange={(e) => updateSession(s => {const grp = s.groups.find(x => x.id === g.id); if(grp) grp.title = e.target.value;})}
                                                            placeholder="Name this group..."
                                                            className="w-full text-sm font-bold text-slate-700 border-none focus:ring-0 bg-transparent p-0 placeholder-indigo-300"
                                                        />
                                                    ) : (
                                                        <div className="font-bold text-slate-800 text-sm">{g.title || 'Untitled Group'}</div>
                                                    )}
                                                </div>
                                                {mode === 'GROUP' && isFacilitator && (
                                                    <button onClick={() => updateSession(s => {
                                                        s.groups = s.groups.filter(x => x.id !== g.id);
                                                        s.tickets.filter(t => t.groupId === g.id).forEach(t => t.groupId = null);
                                                    })} className="text-slate-400 hover:text-red-500 p-1"><span className="material-symbols-outlined text-lg">delete</span></button>
                                                )}
                                            </div>
                                            
                                            <div className="space-y-2 min-h-[20px]">
                                                {session.tickets.filter(t => t.groupId === g.id).map(t => renderTicketCard(t, mode, false, 0, true))}
                                            </div>

                                            {mode === 'VOTE' && (
                                                <div className="mt-2 pt-2 border-t border-indigo-100 flex justify-end">
                                                    <div className="flex items-center bg-white rounded-lg p-1 shadow-sm border border-indigo-100">
                                                        <button disabled={myVotesOnThis === 0} onClick={() => updateSession(s => { const grp = s.groups.find(x => x.id === g.id); if(grp) { const idx = grp.votes.indexOf(currentUser.id); if(idx>-1) grp.votes.splice(idx,1); } })} className="w-6 h-6 flex items-center justify-center text-indigo-600 hover:bg-indigo-50 rounded disabled:opacity-30"><span className="material-symbols-outlined text-sm">remove</span></button>
                                                        <span className="mx-2 font-bold text-indigo-800 w-4 text-center">{myVotesOnThis}</span>
                                                        <button disabled={!canVote} onClick={() => updateSession(s => { const grp = s.groups.find(x => x.id === g.id); if(grp) grp.votes.push(currentUser.id); })} className="w-6 h-6 flex items-center justify-center text-indigo-600 hover:bg-indigo-50 rounded disabled:opacity-30"><span className="material-symbols-outlined text-sm">add</span></button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {mode === 'GROUP' ? (
                                    Object.entries(groupedTickets).map(([authorId, authorTickets]) => (
                                        <div key={authorId} className="mb-4 bg-slate-100/50 p-2 rounded-lg border border-slate-200/50">
                                            {(() => {
                                                const author = participants.find(m => m.id === authorId);
                                                const { displayName } = getMemberDisplay(author || { id: authorId, name: 'Unknown', color: 'bg-slate-300', role: 'participant' });
                                                return (
                                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 pl-1 flex items-center">
                                                        <span className="w-2 h-2 rounded-full bg-slate-300 mr-2"></span>
                                                        {displayName}
                                                    </div>
                                                );
                                            })()}
                                            {authorTickets.map(t => {
                                                const myVotesOnThis = t.votes.filter(v => v === currentUser.id).length;
                                                const canVote = votesLeft > 0 && (!session.settings.oneVotePerTicket || myVotesOnThis === 0);
                                                return renderTicketCard(t, mode, canVote, myVotesOnThis, false);
                                            })}
                                        </div>
                                    ))
                                ) : (
                                    tickets.map(t => {
                                        const myVotesOnThis = t.votes.filter(v => v === currentUser.id).length;
                                        const canVote = votesLeft > 0 && (!session.settings.oneVotePerTicket || myVotesOnThis === 0);
                                        return renderTicketCard(t, mode, canVote, myVotesOnThis, false);
                                    })
                                )}

                                {mode === 'GROUP' && isTouchDragging && draggedTicket && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); dropOnColumnByTouch(col.id); }}
                                        className="w-full py-2 px-3 text-xs font-bold text-indigo-700 bg-white border-2 border-indigo-200 rounded-lg shadow-sm hover:border-indigo-400 transition"
                                    >
                                        Move selected card here
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
                
                {mode === 'BRAINSTORM' && isFacilitator && isEditingColumns && (
                    <div className="flex flex-col w-80 flex-shrink-0 h-full">
                        <button
                            onClick={() => {
                                const newId = Math.random().toString();
                                updateSession(s => s.columns.push({
                                    id: newId, title: 'New Column', color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200', customColor: '#64748B'
                                }));
                                setFocusColumnId(newId);
                            }}
                            className="w-full h-12 border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center text-slate-400 font-bold hover:border-retro-primary hover:text-retro-primary transition"
                        >
                            + Add Column
                        </button>
                    </div>
                )}
            </div>
        </div>
      );
  };

  const renderVote = () => (
      <div className="flex flex-col h-full">
          {renderColumns('VOTE')}
      </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50">
        <SessionHeader
          session={session}
          phases={PHASES}
          isFacilitator={isFacilitator}
          handleExit={handleExit}
          setPhase={setPhase}
          localTimerSeconds={localTimerSeconds}
          timerFinished={timerFinished}
          timerAcknowledged={timerAcknowledged}
          acknowledgeTimer={acknowledgeTimer}
          isEditingTimer={isEditingTimer}
          timerEditMin={timerEditMin}
          timerEditSec={timerEditSec}
          setTimerEditMin={setTimerEditMin}
          setTimerEditSec={setTimerEditSec}
          saveTimerEdit={saveTimerEdit}
          setIsEditingTimer={setIsEditingTimer}
          updateSession={updateSession}
          addTimeToTimer={addTimeToTimer}
          localParticipantsPanelCollapsed={localParticipantsPanelCollapsed}
          setLocalParticipantsPanelCollapsed={setLocalParticipantsPanelCollapsed}
          participantsCount={participants.length}
          currentUser={currentUser}
          onInvite={() => setShowInvite(true)}
          formatTime={formatTime}
          audioRef={audioRef}
        />
        {showInvite && <InviteModal team={team} activeSession={session} onClose={() => setShowInvite(false)} />}

        <div className="flex-grow flex overflow-hidden">
          <div id="phase-scroller" className="flex-grow overflow-y-auto overflow-x-auto relative flex flex-col">
              {session.phase === 'ICEBREAKER' && (
                <IcebreakerPhase
                  session={session}
                  isFacilitator={isFacilitator}
                  localIcebreakerQuestion={localIcebreakerQuestion}
                  onQuestionChange={handleIcebreakerChange}
                  onRandom={handleRandomIcebreaker}
                  onStart={() => setPhase('WELCOME')}
                />
              )}
              {session.phase === 'WELCOME' && (
                <WelcomePhase
                  session={session}
                  currentUser={currentUser}
                  participantsCount={participants.length}
                  isFacilitator={isFacilitator}
                  updateSession={updateSession}
                  onNext={() => setPhase('OPEN_ACTIONS')}
                />
              )}
              {session.phase === 'OPEN_ACTIONS' && (
                <OpenActionsPhase
                  team={team}
                  session={session}
                  isFacilitator={isFacilitator}
                  reviewActionIds={reviewActionIds}
                  setPhase={setPhase}
                  applyActionUpdate={applyActionUpdate}
                  assignableMembers={assignableMembers}
                  buildActionContext={buildActionContext}
                  setRefreshTick={setRefreshTick}
                />
              )}
              {session.phase === 'BRAINSTORM' && (
                  <div className="flex flex-col h-full">
                       {renderColumns('BRAINSTORM')}
                  </div>
              )}
              {session.phase === 'GROUP' && (
                  <div className="flex flex-col h-full">
                       {renderColumns('GROUP')}
                  </div>
              )}
              {session.phase === 'VOTE' && renderVote()}
              {session.phase === 'DISCUSS' && (
                <DiscussPhase
                  session={session}
                  currentUser={currentUser}
                  participantsCount={participants.length}
                  isFacilitator={isFacilitator}
                  sortedItems={getSortedTicketsForDiscuss()}
                  activeDiscussTicket={activeDiscussTicket}
                  setActiveDiscussTicket={setActiveDiscussTicket}
                  updateSession={updateSession}
                  handleToggleNextTopicVote={handleToggleNextTopicVote}
                  discussRefs={discussRefs}
                  editingProposalId={editingProposalId}
                  editingProposalText={editingProposalText}
                  setEditingProposalText={setEditingProposalText}
                  handleSaveProposalEdit={handleSaveProposalEdit}
                  handleCancelProposalEdit={handleCancelProposalEdit}
                  handleStartEditProposal={handleStartEditProposal}
                  handleDeleteProposal={handleDeleteProposal}
                  handleVoteProposal={handleVoteProposal}
                  handleAcceptProposal={handleAcceptProposal}
                  handleAddProposal={handleAddProposal}
                  newProposalText={newProposalText}
                  setNewProposalText={setNewProposalText}
                  handleDirectAddAction={handleDirectAddAction}
                  setPhase={setPhase}
                />
              )}
              {session.phase === 'REVIEW' && (
                <ReviewPhase
                  session={session}
                  team={team}
                  currentUser={currentUser}
                  isFacilitator={isFacilitator}
                  historyActionIds={historyActionIds}
                  setPhase={setPhase}
                  updateSession={updateSession}
                  applyActionUpdate={applyActionUpdate}
                  buildActionContext={buildActionContext}
                  assignableMembers={assignableMembers}
                  setRefreshTick={setRefreshTick}
                />
              )}
              {session.phase === 'CLOSE' && (
                <ClosePhase
                  session={session}
                  currentUser={currentUser}
                  participantsCount={participants.length}
                  isFacilitator={isFacilitator}
                  updateSession={updateSession}
                  handleExit={handleExit}
                />
              )}
          </div>
          <ParticipantsPanel
            session={session}
            participants={participants}
            connectedUsers={connectedUsers}
            currentUser={currentUser}
            isFacilitator={isFacilitator}
            isCollapsed={localParticipantsPanelCollapsed}
            onToggleCollapse={() => setLocalParticipantsPanelCollapsed(!localParticipantsPanelCollapsed)}
            onInvite={() => setShowInvite(true)}
            getMemberDisplay={getMemberDisplay}
          />
        </div>
    </div>
  );
};

export default Session;
