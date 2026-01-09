
import React, { useState, useEffect, useRef } from 'react';
import { Team, User, RetroSession, Ticket, ActionItem, Group } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import InviteModal from './InviteModal';
import { isLightColor } from '../utils/colorUtils';

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

  // UI State
  const [isEditingColumns, setIsEditingColumns] = useState(false);
  const [isEditingTimer, setIsEditingTimer] = useState(false);
  const [timerEditMin, setTimerEditMin] = useState(5);
  const [timerEditSec, setTimerEditSec] = useState(0);
  // Local timer display to avoid sync race conditions
  const [localTimerSeconds, setLocalTimerSeconds] = useState(session?.settings.timerSeconds ?? 0);

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

      // Merge strategy: preserve current user's data being actively edited
      setSession(prevSession => {
        if (!prevSession) return updatedSession;

        const mergedSession = { ...updatedSession };

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
        // Merge votes by preserving current user's votes from prevSession
        mergedSession.tickets = mergedSession.tickets.map(ticket => {
          const prevTicket = prevSession.tickets.find(t => t.id === ticket.id);
          if (!prevTicket) return ticket;

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
      dataService.updateSession(team.id, updatedSession);
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
      const retroOpen = prevRetros.flatMap(r => r.actions.filter(a => !a.done));

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
      const allRetroActions = currentTeam.retrospectives.filter(r => r.id !== sessionId).flatMap(r => r.actions);

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
              const roster = getParticipants();
              roster.forEach(member => {
                  s.tickets.forEach(t => {
                      const userVotes = t.votes.filter(id => id === member.id);
                      if(userVotes.length > 1) {
                          t.votes = t.votes.filter(id => id !== member.id);
                          t.votes.push(member.id);
                      }
                  });
                  s.groups.forEach(g => {
                      const userVotes = g.votes.filter(id => id === member.id);
                      if(userVotes.length > 1) {
                          g.votes = g.votes.filter(id => id !== member.id);
                          g.votes.push(member.id);
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
          if(a) {
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
          if(a) a.type = 'new';
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
      const cardTextColor = 'text-white'; // Always white text on colored backgrounds

      if (colorBy === 'author' && author && visible) {
        // Use author's color for background
        cardBgHex = TAILWIND_COLOR_MAP[author.color] || null;
      } else if (colorBy === 'topic' && column?.customColor && visible) {
        // Use column's custom color for background
        cardBgHex = column.customColor;
      }

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
                ${isDragTarget ? 'ring-4 ring-indigo-300 border-indigo-500 z-20 scale-105' : isSelected ? 'ring-4 ring-blue-400 border-blue-500 bg-blue-50 shadow-lg z-10' : !cardBgHex ? 'bg-white border-slate-200' : ''}
            `}
            style={cardBgHex && !isDragTarget && !isSelected ? {
                backgroundColor: cardBgHex,
                borderColor: cardBgHex,
                borderWidth: '2px'
            } : undefined}
        >
            {isDragTarget && (
                <div className="absolute inset-0 bg-indigo-50/90 flex items-center justify-center rounded z-10 font-bold text-indigo-700 pointer-events-none">
                    <span className="material-symbols-outlined mr-1">merge</span> Group with this
                </div>
            )}

            {isSelected && (
                <div className="absolute inset-0 bg-blue-100/50 flex items-center justify-center rounded z-10 font-bold text-blue-700 pointer-events-none border-2 border-blue-500">
                    <span className="material-symbols-outlined mr-1">touch_app</span> Selected - Tap to cancel
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
                    <div className={`text-sm w-full whitespace-pre-wrap break-words ${!visible ? 'ticket-blur' : cardTextColor}`}>
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
                            className={`text-xs px-1.5 py-0.5 rounded border ${users.includes(currentUser.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100'}`}
                        >
                            {emoji} <span className="text-[10px] font-bold text-slate-500">{users.length}</span>
                        </button>
                    ))}
                    <div className="relative">
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setEmojiPickerOpenId(isPickerOpen ? null : t.id);
                            }}
                            className={`text-slate-300 hover:text-slate-500 hover:bg-slate-100 rounded-full w-6 h-6 flex items-center justify-center transition ${isPickerOpen ? 'bg-slate-100 text-slate-500' : ''}`}
                        >
                            <span className="material-symbols-outlined text-sm">add_reaction</span>
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

            {isMine && mode === 'BRAINSTORM' && (
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
                        <button disabled={!canVote} onClick={() => updateSession(s => s.tickets.find(x => x.id === t.id)?.votes.push(currentUser.id))} className="w-6 h-6 flex items-center justify-center text-indigo-600 hover:bg-indigo-200 rounded disabled:opacity-30"><span className="material-symbols-outlined text-sm">add</span></button>
                    </div>
                </div>
            )}
        </div>
      );
  };

  const renderHeader = () => (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-50">
        <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/933/933-preview.mp3" preload="auto" />
        
        <div className="flex items-center h-full">
            <button onClick={handleExit} className="mr-3 text-slate-400 hover:text-slate-700"><span className="material-symbols-outlined">arrow_back</span></button>
            <div className="hidden lg:flex h-full items-center space-x-1">
                {PHASES.map(p => (
                    <button key={p} onClick={() => isFacilitator ? setPhase(p) : null} disabled={!isFacilitator && session.status !== 'CLOSED'} className={`phase-nav-btn h-full px-2 text-[10px] font-bold uppercase ${session.phase === p ? 'active' : 'text-slate-400 disabled:opacity-50'}`}>{p.replace('_', ' ')}</button>
                ))}
            </div>
        </div>
        <div
            className="flex items-center bg-slate-100 rounded-lg px-3 py-1 mr-4 cursor-pointer hover:bg-slate-200 transition"
            onClick={acknowledgeTimer}
        >
             {!isEditingTimer ? (
                 <>
                    <span className={`font-mono font-bold text-lg ${timerFinished && !timerAcknowledged ? 'text-red-500 animate-bounce' : localTimerSeconds < 60 ? 'text-red-500' : 'text-slate-700'}`}>{formatTime(localTimerSeconds)}</span>
                    {isFacilitator && (
                        <button onClick={(e) => {
                            e.stopPropagation();
                            acknowledgeTimer();
                            updateSession(s => {
                                const isStarting = !s.settings.timerRunning;
                                s.settings.timerRunning = isStarting;
                                if (isStarting) {
                                    // Store timestamp and current seconds as initial
                                    s.settings.timerStartedAt = Date.now();
                                    s.settings.timerInitial = localTimerSeconds;
                                    s.settings.timerAcknowledged = false;
                                } else {
                                    // Pausing - save remaining time
                                    s.settings.timerSeconds = localTimerSeconds;
                                    s.settings.timerStartedAt = undefined;
                                }
                            });
                        }} className="ml-2 text-slate-500 hover:text-indigo-600">
                            <span className="material-symbols-outlined text-lg">{session.settings.timerRunning ? 'pause' : 'play_arrow'}</span>
                        </button>
                    )}
                    {isFacilitator && (
                        <button onClick={(e) => {
                            e.stopPropagation();
                            acknowledgeTimer();
                            setTimerEditMin(Math.floor(localTimerSeconds / 60));
                            setTimerEditSec(localTimerSeconds % 60);
                            setIsEditingTimer(true);
                        }} className="ml-1 text-slate-400 hover:text-indigo-600"><span className="material-symbols-outlined text-sm">edit</span></button>
                    )}
                 </>
             ) : (
                 <div className="flex items-center space-x-1" onClick={e => e.stopPropagation()}>
                     <input 
                        type="number" 
                        min="0"
                        value={timerEditMin}
                        onChange={(e) => setTimerEditMin(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-16 h-10 text-xl border border-slate-300 rounded px-1 bg-white text-slate-900 text-center font-bold"
                        placeholder="MM"
                     />
                     <span className="font-bold text-xl">:</span>
                     <input 
                        type="number" 
                        min="0"
                        value={timerEditSec}
                        onChange={(e) => setTimerEditSec(Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-16 h-10 text-xl border border-slate-300 rounded px-1 bg-white text-slate-900 text-center font-bold"
                        placeholder="SS"
                     />
                     <button onClick={() => {
                        const newSeconds = (timerEditMin * 60) + timerEditSec;
                        setLocalTimerSeconds(newSeconds);
                        updateSession(s => {
                            s.settings.timerSeconds = newSeconds;
                            s.settings.timerInitial = newSeconds;
                            s.settings.timerRunning = false;
                            s.settings.timerStartedAt = undefined;
                            s.settings.timerAcknowledged = false;
                        });
                        setIsEditingTimer(false);
                     }} className="bg-emerald-500 text-white rounded p-2 hover:bg-emerald-600 shadow"><span className="material-symbols-outlined text-xl">check</span></button>
                 </div>
             )}
        </div>
        <div className="flex items-center space-x-3">
             {/* Real-time sync indicator */}
             <div className="flex items-center text-emerald-600 bg-emerald-50 px-2 py-1 rounded" title="Real-time sync active">
                <span className="material-symbols-outlined text-lg mr-1 animate-pulse">wifi</span>
                <span className="text-xs font-bold hidden sm:inline">Live</span>
             </div>

             {/* Participant progress - shown when panel is collapsed or on smaller screens */}
             {(session.settings.participantsPanelCollapsed || window.innerWidth < 1024) && (
               <div
                 className="flex items-center bg-slate-100 px-3 py-1 rounded cursor-pointer hover:bg-slate-200 transition"
                 onClick={() => updateSession(s => s.settings.participantsPanelCollapsed = false)}
                 title="Click to expand participants panel"
               >
                 <span className="material-symbols-outlined text-lg mr-1 text-slate-600">groups</span>
                 <span className="text-xs font-bold text-slate-700">
                   {session.phase === 'WELCOME'
                     ? `${Object.keys(session.happiness || {}).length}/${participants.length}`
                     : session.phase === 'CLOSE'
                     ? `${Object.keys(session.roti || {}).length}/${participants.length}`
                     : `${session.finishedUsers?.length || 0}/${participants.length}`
                   }
                 </span>
                 <span className="text-[10px] text-slate-500 ml-1 hidden md:inline">
                   {session.phase === 'WELCOME' ? 'finished' : session.phase === 'CLOSE' ? 'voted' : 'finished'}
                 </span>
               </div>
             )}

             {isFacilitator && (
               <button onClick={() => setShowInvite(true)} className="flex items-center text-slate-500 hover:text-retro-primary" title="Invite / Join">
                  <span className="material-symbols-outlined text-xl">qr_code_2</span>
               </button>
             )}
             <div className="flex flex-col items-end mr-2">
                 <span className="text-[10px] font-bold text-slate-400 uppercase">User</span>
                 <span className="text-sm font-bold text-slate-700">{currentUser.name}</span>
             </div>
             <div className={`w-8 h-8 rounded-full ${currentUser.color} text-white flex items-center justify-center text-xs font-bold shadow-md`}>
                {currentUser.name.substring(0, 2).toUpperCase()}
            </div>
        </div>
    </header>
  );

  const renderIcebreaker = () => (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-900 text-white">
          <div className="bg-slate-800 p-10 rounded-2xl shadow-xl border border-slate-700 max-w-4xl w-full h-[600px] flex flex-col">
              <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center text-3xl mb-4 mx-auto shrink-0">🧊</div>
              <h2 className="text-3xl font-bold mb-6 shrink-0">Icebreaker</h2>
              
              <div className="flex-grow flex flex-col relative mb-8">
                  {isFacilitator ? (
                       <textarea
                        value={localIcebreakerQuestion !== null ? localIcebreakerQuestion : session.icebreakerQuestion}
                        onChange={(e) => handleIcebreakerChange(e.target.value)}
                        className="w-full h-full bg-slate-900 border border-slate-600 rounded-xl p-6 text-3xl text-center text-indigo-300 font-medium leading-relaxed focus:border-retro-primary outline-none resize-none flex-grow"
                        placeholder="Type or generate a question..."
                       />
                  ) : (
                      <div className="w-full h-full flex items-center justify-center bg-slate-900/50 rounded-xl border border-slate-700/50 p-6">
                        <p className="text-3xl text-indigo-300 font-medium leading-relaxed">
                            {session.icebreakerQuestion}
                        </p>
                      </div>
                  )}
              </div>
              
              <div className="shrink-0 flex justify-center space-x-4">
                   {isFacilitator ? (
                       <>
                           <button onClick={handleRandomIcebreaker} className="text-retro-primary hover:text-white text-sm font-bold flex items-center px-4 py-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition">
                                <span className="material-symbols-outlined mr-2">shuffle</span> Random
                           </button>
                           <button onClick={() => setPhase('WELCOME')} className="bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200 shadow-lg transition transform hover:-translate-y-1">
                               Start Session
                           </button>
                       </>
                   ) : (
                       <div className="text-slate-500 italic animate-pulse">Waiting for facilitator to start...</div>
                   )}
              </div>
          </div>
      </div>
  );

  const renderWelcome = () => {
      const myVote = session.happiness[currentUser.id];
      const votes = Object.values(session.happiness);
      const voterCount = Object.keys(session.happiness).length;
      const totalMembers = participants.length;

      const histogram = [1,2,3,4,5].map(rating => votes.filter(v => v === rating).length);
      const maxVal = Math.max(...histogram, 1);

      return (
          <div className="flex flex-col items-center justify-center h-full p-8 overflow-y-auto">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Happiness Check</h2>
              <p className="text-slate-500 mb-8">How are you feeling about the last sprint?</p>
              
              <div className="flex gap-4 mb-12">
                  {[1,2,3,4,5].map(score => (
                      <button 
                        key={score}
                        onClick={() => updateSession(s => s.happiness[currentUser.id] = score)}
                        className={`text-6xl transition transform hover:scale-110 ${myVote === score ? 'opacity-100 scale-110 grayscale-0' : 'opacity-40 grayscale hover:grayscale-0'}`}
                      >
                          {['⛈️','🌧️','☁️','🌤️','☀️'][score-1]}
                      </button>
                  ))}
              </div>

              {!session.settings.revealHappiness ? (
                   <div className="mb-8 text-center">
                       <div className="text-lg font-bold text-slate-600 mb-2">{voterCount} / {totalMembers} voted</div>
                       {isFacilitator && <button onClick={() => updateSession(s => s.settings.revealHappiness = true)} className="bg-indigo-600 text-white px-6 py-2 rounded-full font-bold shadow hover:bg-indigo-700">Reveal Results</button>}
                   </div>
              ) : (
                  <div className="w-full max-w-lg bg-white p-6 rounded-xl shadow-lg border border-slate-200">
                      <div className="flex items-end justify-between h-48 space-x-4">
                          {histogram.map((count, i) => (
                              <div key={i} className="flex flex-col items-center flex-1 h-full justify-end">
                                  {count > 0 && (
                                      <div className="w-full bg-indigo-500 rounded-t-lg relative group bar-anim" style={{height: `${(count/maxVal)*100}%`}}>
                                          <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 font-bold text-indigo-700">{count}</div>
                                      </div>
                                  )}
                                  <div className="mt-2 text-xl">{['⛈️','🌧️','☁️','🌤️','☀️'][i]}</div>
                              </div>
                          ))}
                      </div>
                      <div className="text-center mt-4 text-slate-500 font-bold">{voterCount} / {totalMembers} participants voted</div>
                  </div>
              )}
              {isFacilitator && (
                  <button onClick={() => setPhase('OPEN_ACTIONS')} className="mt-12 bg-white text-slate-800 border border-slate-300 px-6 py-2 rounded-lg font-bold hover:bg-slate-50 shadow-sm">
                      Next Phase
                  </button>
              )}
          </div>
      );
  };

  const renderOpenActions = () => {
    // IMPORTANT: Fetch fresh team data to ensure done status updates trigger re-renders
    const currentTeam = dataService.getTeam(team.id) || team;

    const fallbackActions = [
        ...currentTeam.globalActions.filter(a => reviewActionIds.includes(a.id)),
        ...currentTeam.retrospectives.flatMap(r => r.actions.filter(a => reviewActionIds.includes(a.id)))
    ].map(a => ({ ...a, contextText: buildActionContext(a, currentTeam) }));

    const actionsToShow = Array.isArray(session.openActionsSnapshot)
        ? session.openActionsSnapshot
        : fallbackActions;
    // Dedup by ID
    const uniqueActions = Array.from(new Map(actionsToShow.map(item => [item.id, item])).values());

    return (
        <div className="flex flex-col h-full bg-slate-50">
             <div className="bg-white border-b px-6 py-3 flex justify-between items-center shrink-0">
                <span className="font-bold text-slate-700 text-lg">Review Open Actions</span>
                {isFacilitator && <button onClick={() => setPhase('BRAINSTORM')} className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover">Next Phase</button>}
             </div>
             <div className="p-8 max-w-4xl mx-auto w-full">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    {uniqueActions.length === 0 ? <div className="p-8 text-center text-slate-400">No open actions from previous sprints.</div> : 
                    uniqueActions.map(action => {
                        // Find context for the action
                        let contextText = "";
                        // Check retros for context
                        for (const r of currentTeam.retrospectives) {
                            if (action.linkedTicketId) {
                                const t = r.tickets.find(x => x.id === action.linkedTicketId);
                                if (t) { contextText = `Re: "${t.text.substring(0, 50)}${t.text.length>50?'...':''}"`; break; }
                                const g = r.groups.find(x => x.id === action.linkedTicketId);
                                if (g) { contextText = `Re: Group "${g.title}"`; break; }
                            }
                        }

                        return (
                        <div key={action.id} className={`p-4 border-b border-slate-100 last:border-0 flex items-center justify-between group hover:bg-slate-50 ${action.done ? 'bg-green-50/50' : ''}`}>
                            <div className="flex items-center flex-grow mr-4">
                                <button
                                    disabled={!isFacilitator}
                                    onClick={() => {
                                        if(!isFacilitator) return;
                                        dataService.toggleGlobalAction(team.id, action.id);
                                        applyActionUpdate(action.id, a => { a.done = !a.done; }, action);
                                        setRefreshTick(t => t + 1);
                                    }}
                                    className={`mr-3 transition ${action.done ? 'text-emerald-500 scale-110' : 'text-slate-300 hover:text-emerald-500'} ${!isFacilitator ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    <span className="material-symbols-outlined text-2xl">{action.done ? 'check_circle' : 'radio_button_unchecked'}</span>
                                </button>
                                <div className="flex flex-col">
                                    <span className={`font-medium transition-all ${action.done ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-slate-700'}`}>{action.text}</span>
                                    {contextText && <span className="text-xs text-indigo-400 italic mt-0.5">{contextText}</span>}
                                </div>
                            </div>
                            <select
                                value={action.assigneeId || ''}
                                disabled={!isFacilitator}
                                onChange={(e) => {
                                    const updated = {...action, assigneeId: e.target.value || null};
                                    dataService.updateGlobalAction(team.id, updated);
                                    applyActionUpdate(action.id, a => { a.assigneeId = updated.assigneeId; }, action);
                                    setRefreshTick(t => t + 1);
                                }}
                                className={`text-xs border border-slate-200 rounded p-1 bg-white text-slate-900 ${!isFacilitator ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <option value="">Unassigned</option>
                               {assignableMembers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                            </select>
                        </div>
                    )})}
                </div>
             </div>
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
                               {votesLeft} votes remaining
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
                             <div className="flex items-center bg-slate-100 rounded px-2">
                                 <span>Max:</span>
                                 <input className="w-8 bg-transparent text-center font-bold outline-none text-slate-900" value={session.settings.maxVotes} onChange={(e) => handleMaxVotesChange(parseInt(e.target.value)||5)} />
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
                                className={`px-4 py-2 rounded-lg font-bold text-sm shadow transition ${isFinished ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'bg-white text-slate-700 hover:bg-slate-100'}`}
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
            <div className="flex-grow overflow-x-auto bg-slate-50 p-6 flex space-x-6 items-start h-auto min-h-0 justify-start">
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
                                                        <button disabled={!canVote} onClick={() => updateSession(s => s.groups.find(x => x.id === g.id)?.votes.push(currentUser.id))} className="w-6 h-6 flex items-center justify-center text-indigo-600 hover:bg-indigo-50 rounded disabled:opacity-30"><span className="material-symbols-outlined text-sm">add</span></button>
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

  const renderDiscuss = () => {
      const sortedItems = getSortedTicketsForDiscuss();
      
      return (
        <div className="flex flex-col h-full overflow-hidden bg-slate-50">
             <div className="bg-white border-b px-6 py-3 flex justify-between items-center shadow-sm z-30 shrink-0">
                <span className="font-bold text-slate-700 text-lg">Discuss & Propose Actions</span>
                {isFacilitator && <button onClick={() => setPhase('REVIEW')} className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover">Next Phase</button>}
             </div>
             <div className="flex-grow overflow-auto p-6 max-w-4xl mx-auto w-full space-y-4">
                 {sortedItems.map((item, index) => {
                     const subItems = item.type === 'group' 
                        ? session.tickets.filter(t => t.groupId === item.id) 
                        : [];

                     return (
                     <div ref={(el) => { discussRefs.current[item.id] = el; }} key={item.id} className={`bg-white rounded-xl shadow-sm border-2 transition ${activeDiscussTicket === item.id ? 'border-retro-primary ring-4 ring-indigo-50' : 'border-slate-200'}`}>
                         <div
                           className={`p-4 flex items-start ${isFacilitator ? 'cursor-pointer' : 'cursor-default'}`}
                           onClick={() => {
                             if (!isFacilitator) return;
                             updateSession(s => {
                               s.discussionFocusId = s.discussionFocusId === item.id ? null : item.id;
                             });
                           }}
                         >
                             <div className="bg-slate-800 text-white font-bold w-8 h-8 rounded flex items-center justify-center mr-4 shrink-0">{index + 1}</div>
                             <div className="flex-grow">
                                <div className="text-lg text-slate-800 font-medium mb-1 break-words">{item.text}</div>
                                 <div className="flex items-center space-x-4 text-xs font-bold text-slate-400">
                                     <span className="flex items-center text-indigo-600"><span className="material-symbols-outlined text-sm mr-1">thumb_up</span> {item.votes} votes</span>
                                     {item.type === 'group' && <span className="flex items-center"><span className="material-symbols-outlined text-sm mr-1">layers</span> Group</span>}
                                 </div>
                                 
                                 {item.type === 'group' && subItems.length > 0 && (
                                     <div className="mt-3 pl-3 border-l-2 border-slate-200">
                                         {subItems.map(sub => (
                                             <div key={sub.id} className="text-sm text-slate-500 mb-1 break-words">{sub.text}</div>
                                         ))}
                                     </div>
                                 )}
                             </div>
                             <span className="material-symbols-outlined text-slate-300">{activeDiscussTicket === item.id ? 'expand_less' : 'expand_more'}</span>
                         </div>
                         
                         {activeDiscussTicket === item.id && (
                             <div className="bg-slate-50 border-t border-slate-100 p-4 rounded-b-xl">
                                 <div className="mb-4">
                                     <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Proposals</h4>
                                    {session.actions.filter(a => a.linkedTicketId === item.id && a.type === 'proposal').map(p => {
                                        const upVotes = Object.values(p.proposalVotes || {}).filter(v=>v==='up').length;
                                        const neutralVotes = Object.values(p.proposalVotes || {}).filter(v=>v==='neutral').length;
                                        const downVotes = Object.values(p.proposalVotes || {}).filter(v=>v==='down').length;
                                        const totalVotes = upVotes + neutralVotes + downVotes;
                                        const myVote = p.proposalVotes?.[currentUser.id];

                                         return (
                                         <div key={p.id} className="bg-white p-3 rounded border border-slate-200 mb-2 flex items-center justify-between">
                                             <span className="text-slate-700 text-sm font-medium mr-2">{p.text}</span>
                                             <div className="flex items-center space-x-3">
                                                <div className="flex bg-slate-100 rounded-lg p-1 space-x-1">
                                                    <button onClick={() => handleVoteProposal(p.id, 'up')} className={`px-2 py-1 rounded flex items-center transition ${myVote==='up'?'bg-emerald-100 text-emerald-700 shadow-sm':'hover:bg-white text-slate-500'}`}>
                                                        <span className="material-symbols-outlined text-sm mr-1">thumb_up</span>
                                                        <span className="text-xs font-bold">{upVotes > 0 ? upVotes : ''}</span>
                                                    </button>
                                                    <button onClick={() => handleVoteProposal(p.id, 'neutral')} className={`px-2 py-1 rounded flex items-center transition ${myVote==='neutral'?'bg-slate-300 text-slate-800 shadow-sm':'hover:bg-white text-slate-500'}`}>
                                                        <span className="material-symbols-outlined text-sm mr-1">remove</span>
                                                        <span className="text-xs font-bold">{neutralVotes > 0 ? neutralVotes : ''}</span>
                                                    </button>
                                                    <button onClick={() => handleVoteProposal(p.id, 'down')} className={`px-2 py-1 rounded flex items-center transition ${myVote==='down'?'bg-red-100 text-red-700 shadow-sm':'hover:bg-white text-slate-500'}`}>
                                                        <span className="material-symbols-outlined text-sm mr-1">thumb_down</span>
                                                        <span className="text-xs font-bold">{downVotes > 0 ? downVotes : ''}</span>
                                                    </button>
                                                </div>
                                                <div className="text-[11px] font-bold text-slate-500 px-2 py-1 bg-slate-100 rounded">
                                                    Total: {totalVotes}
                                                </div>
                                                {isFacilitator && (
                                                    <button onClick={() => handleAcceptProposal(p.id)} className="bg-retro-primary text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-retro-primaryHover shadow-sm">Accept</button>
                                                )}
                                            </div>
                                        </div>
                                     )})}
                                     {session.actions.filter(a => a.linkedTicketId === item.id && a.type === 'new').map(a => (
                                         <div key={a.id} className="flex items-center text-sm bg-emerald-50 p-2 rounded border border-emerald-200 text-emerald-800 mb-2">
                                             <span className="material-symbols-outlined text-emerald-600 mr-2 text-sm">check_circle</span>
                                             Accepted: {a.text}
                                         </div>
                                     ))}
                                 </div>
                                 <div className="flex">
                                     <input type="text" className="flex-grow border border-slate-300 rounded-l p-2 text-sm outline-none focus:border-retro-primary bg-white text-slate-900" placeholder="Propose an action..." value={newProposalText} onChange={(e) => setNewProposalText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddProposal(item.id)} />
                                     <button onClick={() => handleAddProposal(item.id)} className="bg-slate-700 text-white px-3 font-bold text-sm hover:bg-slate-800 border-l border-slate-600">Propose</button>
                                     {isFacilitator && (
                                         <button onClick={() => handleDirectAddAction(item.id)} className="bg-retro-primary text-white px-3 rounded-r font-bold text-sm hover:bg-retro-primaryHover" title="Directly Accept Action">
                                             <span className="material-symbols-outlined text-sm">check</span>
                                         </button>
                                     )}
                                 </div>
                             </div>
                         )}
                     </div>
                 )})}
             </div>
        </div>
      );
  };

  const renderReview = () => {
    const newActions = session.actions.filter(a => a.type === 'new');
    
    const groupedNewActions: Record<string, { title: string, tickets: Ticket[], items: ActionItem[] }> = {};
    newActions.forEach(a => {
        let title = "General";
        let linkedTickets: Ticket[] = [];
        
        if (a.linkedTicketId) {
            const t = session.tickets.find(x => x.id === a.linkedTicketId);
            if (t) {
                title = t.text;
                linkedTickets = [t];
            } else {
                const g = session.groups.find(x => x.id === a.linkedTicketId);
                if (g) {
                    title = g.title;
                    linkedTickets = session.tickets.filter(tk => tk.groupId === g.id);
                }
            }
        }
        
        if (!groupedNewActions[title]) groupedNewActions[title] = { title, tickets: linkedTickets, items: [] };
        groupedNewActions[title].items.push(a);
    });

    const currentTeam = dataService.getTeam(team.id) || team;

    const historySource = session.historyActionsSnapshot?.length
        ? session.historyActionsSnapshot
        : [
            ...currentTeam.globalActions.map(a => ({ ...a, contextText: buildActionContext(a, currentTeam) })),
            ...currentTeam.retrospectives
                .filter(r => r.id !== session.id)
                .flatMap(r => r.actions.map(a => ({ ...a, contextText: buildActionContext(a, currentTeam) })))
        ];

    const uniquePrevActions = historySource.filter(a => historyActionIds.includes(a.id));

    const ActionRow: React.FC<{ action: ActionItem, isGlobal: boolean }> = ({ action, isGlobal }) => {
        const [pendingText, setPendingText] = useState(action.text);
        const [confirmingDelete, setConfirmingDelete] = useState(false);

        useEffect(() => {
            setPendingText(action.text);
            setConfirmingDelete(false);
        }, [action.text, action.id]);

        const canEdit = isFacilitator;

        const commitTextChange = () => {
            if (!pendingText.trim() || pendingText === action.text) return;
            const newText = pendingText.trim();
            const updated = { ...action, text: newText };
            if(isGlobal) dataService.updateGlobalAction(team.id, updated);
            applyActionUpdate(action.id, a => { a.text = newText; }, action);
            setRefreshTick(t => t + 1);
        };

        const commitAssigneeChange = (val: string | null) => {
            const updated = { ...action, assigneeId: val };
            if(isGlobal) dataService.updateGlobalAction(team.id, updated);
            applyActionUpdate(action.id, a => { a.assigneeId = val; }, action);
            setRefreshTick(t => t + 1);
        };

        const handleDelete = () => {
            updateSession(s => s.actions = s.actions.filter(x => x.id !== action.id));
            if (isGlobal) dataService.deleteAction(team.id, action.id);
        };

        // Find context if previous retro action
        let contextText = action.contextText ?? "";
        if (!contextText && !isGlobal && action.originRetro) {
            for (const r of currentTeam.retrospectives) {
                if (action.linkedTicketId) {
                    const t = r.tickets.find(x => x.id === action.linkedTicketId);
                    if (t) { contextText = `Re: "${t.text.substring(0, 50)}${t.text.length>50?'...':''}"`; break; }
                    const g = r.groups.find(x => x.id === action.linkedTicketId);
                    if (g) { contextText = `Re: Group "${g.title}"`; break; }
                }
            }
        }

        return (
            <div className={`p-4 border-b border-slate-100 last:border-0 flex items-center justify-between group hover:bg-slate-50 transition ${action.done ? 'bg-green-50/50' : ''}`}>
                <div className="flex items-center flex-grow mr-4">
                    <button
                        disabled={!canEdit}
                        onClick={() => {
                            if(!canEdit) return;
                            if(isGlobal) dataService.toggleGlobalAction(team.id, action.id);
                            applyActionUpdate(action.id, a => { a.done = !a.done; }, action);
                            setRefreshTick(t => t + 1);
                        }}
                        className={`mr-3 transition ${action.done ? 'text-emerald-500 scale-110' : 'text-slate-300 hover:text-emerald-500'} ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <span className="material-symbols-outlined text-2xl">{action.done ? 'check_circle' : 'radio_button_unchecked'}</span>
                    </button>
                    <div className="flex-grow flex flex-col">
                        <input
                            value={pendingText}
                            readOnly={!canEdit}
                            onChange={(e) => setPendingText(e.target.value)}
                            onBlur={commitTextChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    commitTextChange();
                                }
                            }}
                            className={`w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-2 py-1 focus:bg-white focus:border-retro-primary outline-none transition font-medium ${action.done ? 'line-through text-slate-400' : 'text-slate-700'} ${!canEdit ? 'cursor-not-allowed' : ''}`}
                        />
                         {contextText && <span className="text-xs text-indigo-400 italic mt-0.5 px-2">{contextText}</span>}
                    </div>
                </div>
                <select
                    value={action.assigneeId || ''}
                    disabled={!canEdit}
                    onChange={(e) => commitAssigneeChange(e.target.value || null)}
                    className={`text-xs border border-slate-200 rounded p-1.5 bg-white text-slate-600 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-none ${!canEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    <option value="">Unassigned</option>
                    {assignableMembers.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                </select>
                {isFacilitator && !isGlobal && (
                    <div className="ml-3">
                        {!confirmingDelete ? (
                            <button
                                onClick={() => setConfirmingDelete(true)}
                                className="text-slate-300 hover:text-red-500"
                            >
                                <span className="material-symbols-outlined">delete</span>
                            </button>
                        ) : (
                            <div className="flex items-center space-x-2 text-xs bg-white border border-slate-200 rounded px-3 py-1 shadow-sm">
                                <span className="text-slate-500">Confirm?</span>
                                <button className="text-rose-600 font-bold" onClick={handleDelete}>Yes</button>
                                <button className="text-slate-400" onClick={() => setConfirmingDelete(false)}>No</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-slate-50">
             <div className="bg-white border-b px-6 py-3 flex justify-between items-center shrink-0 shadow-sm z-30">
                <span className="font-bold text-slate-700 text-lg">Review Actions</span>
                {isFacilitator && <button onClick={() => setPhase('CLOSE')} className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover">Next: Close Retro</button>}
             </div>
             <div className="p-8 max-w-4xl mx-auto w-full space-y-8">
                 <div>
                     <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">New Actions from this Session</h3>
                     <div className="space-y-4">
                        {newActions.length === 0 ? <div className="p-8 text-center text-slate-400 bg-white rounded-xl border border-slate-200">No new actions created.</div> :
                        Object.entries(groupedNewActions).map(([key, data]) => (
                            <div key={key} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                                <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 flex flex-col justify-start">
                                    <div className="flex items-center text-sm font-bold text-slate-600">
                                        <span className="material-symbols-outlined text-lg mr-2 text-indigo-500">topic</span>
                                        {data.title}
                                    </div>
                                    {data.tickets.length > 0 && (
                                        <div className="pl-7 mt-1 space-y-1">
                                            {data.tickets.map(t => (
                                                <div key={t.id} className="text-xs text-slate-400 font-normal truncate">• {t.text}</div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    {data.items.map(action => <ActionRow key={action.id} action={action} isGlobal={false} />)}
                                </div>
                            </div>
                        ))}
                    </div>
                 </div>

                 <div>
                     <h3 className="text-sm font-bold text-slate-500 uppercase mb-4">All Previous Actions (Unfinished)</h3>
                     <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden max-h-96 overflow-y-auto">
                        {uniquePrevActions.length === 0 ? <div className="p-8 text-center text-slate-400">No history found.</div> :
                        uniquePrevActions.map(action => <ActionRow key={action.id} action={action} isGlobal={true} />)}
                    </div>
                 </div>
             </div>
        </div>
    );
  };

  const renderClose = () => {
      const myRoti = session.roti[currentUser.id];
      const votes: number[] = Object.values(session.roti);
      const voterCount = Object.keys(session.roti).length;
      const totalMembers = participants.length;
      const average = votes.length ? (votes.reduce((a, b)=>a+b, 0)/votes.length).toFixed(1) : '-';
      const histogram = [1,2,3,4,5].map(v => votes.filter(x => x === v).length);
      const maxVal = Math.max(...histogram, 1);

      return (
        <div className="flex flex-col items-center justify-center h-full p-8 bg-slate-900 text-white">
            <h1 className="text-3xl font-bold mb-2">Session Closed</h1>
            <p className="text-slate-400 mb-8">Thank you for your contribution!</p>
            
            <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-lg w-full text-center">
                <h3 className="text-xl font-bold mb-6">ROTI (Return on Time Invested)</h3>
                <div className="flex justify-center space-x-2 mb-8">
                    {[1,2,3,4,5].map(score => (
                        <button key={score} onClick={() => updateSession(s => s.roti[currentUser.id] = score)} className={`w-10 h-10 rounded-full font-bold transition ${myRoti === score ? 'bg-retro-primary text-white scale-110' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>{score}</button>
                    ))}
                </div>

                {!session.settings.revealRoti ? (
                     <div className="mb-4">
                        <div className="text-slate-400 font-bold mb-4">{voterCount} / {totalMembers} members have voted</div>
                        {isFacilitator && <button onClick={() => updateSession(s => s.settings.revealRoti = true)} className="text-indigo-400 hover:text-white font-bold underline">Reveal Results</button>}
                     </div>
                ) : (
                     <div className="mt-6">
                         <div className="flex items-end justify-center h-24 space-x-3 mb-2">
                             {histogram.map((count, i) => (
                                 <div key={i} className="flex flex-col items-center justify-end h-full">
                                     {count > 0 && <span className="text-xs font-bold mb-1">{count}</span>}
                                     <div className="w-8 bg-indigo-500 rounded-t relative transition-all duration-500" style={{height: count > 0 ? `${(count/maxVal)*100}%` : '4px', opacity: count > 0 ? 1 : 0.2}}></div>
                                 </div>
                             ))}
                         </div>
                         <div className="flex justify-center space-x-3 text-xs text-slate-500 border-t border-slate-700 pt-1">
                             {[1,2,3,4,5].map(i => <div key={i} className="w-8">{i}</div>)}
                         </div>
                         <div className="mt-4 text-2xl font-black text-indigo-400">{average} / 5</div>
                     </div>
                )}
            </div>
            
            {isFacilitator ? (
              <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">Return to Dashboard</button>
            ) : (
              <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">Leave Retrospective</button>
            )}
        </div>
      );
  };

  // Render participants panel
  const renderParticipantsPanel = () => {
    // Default to collapsed for participants, expanded for facilitators
    // Only use default if the setting is undefined (not set yet)
    const isCollapsed = session.settings.participantsPanelCollapsed !== undefined
      ? session.settings.participantsPanelCollapsed
      : !isFacilitator;

    return (
      <div className={`bg-white border-l border-slate-200 flex flex-col shrink-0 hidden lg:flex transition-all ${isCollapsed ? 'w-12' : 'w-64'}`}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          {!isCollapsed && (
            <h3 className="text-sm font-bold text-slate-700 flex items-center">
              <span className="material-symbols-outlined mr-2 text-lg">groups</span>
              Participants ({participants.length})
            </h3>
          )}
          <button
            onClick={() => updateSession(s => s.settings.participantsPanelCollapsed = !isCollapsed)}
            className="text-slate-400 hover:text-slate-700 transition"
            title={isCollapsed ? 'Expand panel' : 'Collapse panel'}
          >
            <span className="material-symbols-outlined text-lg">
              {isCollapsed ? 'chevron_left' : 'chevron_right'}
            </span>
          </button>
        </div>
        {!isCollapsed && (
          <>
      <div className="flex-grow overflow-y-auto p-3">
        {participants.map(member => {
          const { displayName, initials } = getMemberDisplay(member);
          const isFinished = session.finishedUsers?.includes(member.id);
          const isCurrentUser = member.id === currentUser.id;
          const isOnline = connectedUsers.has(member.id);
          const hasHappinessVote = Boolean(session.happiness?.[member.id]);
          const hasRotiVote = Boolean(session.roti?.[member.id]);
          const hasStageVote = session.phase === 'WELCOME' ? hasHappinessVote : session.phase === 'CLOSE' ? hasRotiVote : false;
          return (
            <div
              key={member.id}
              className={`flex items-center p-2 rounded-lg mb-1 ${isCurrentUser ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
            >
              <div className="relative mr-3">
                <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold`}>
                  {initials}
                </div>
                {isOnline && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" title="Online" />
                )}
              </div>
              <div className="flex-grow min-w-0">
                <div className={`text-sm font-medium truncate ${isCurrentUser ? 'text-indigo-700' : 'text-slate-700'}`}>
                  {displayName}
                  {isCurrentUser && <span className="text-xs text-indigo-400 ml-1">(you)</span>}
                </div>
                <div className="text-xs text-slate-400 capitalize">{member.role}</div>
              </div>
              {(isFinished || hasStageVote) && (
                <span
                  className={`material-symbols-outlined text-lg ${hasStageVote ? 'text-emerald-500' : 'text-emerald-400'}`}
                  title={hasStageVote ? 'Vote recorded' : 'Finished'}
                >
                  check_circle
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="p-3 border-t border-slate-200 bg-slate-50">
        {session.phase === 'WELCOME' ? (
          <div className="text-xs text-slate-500 text-center">
            {Object.keys(session.happiness || {}).length} / {participants.length} submitted happiness
          </div>
        ) : session.phase === 'CLOSE' ? (
          <div className="text-xs text-slate-500 text-center">
            {Object.keys(session.roti || {}).length} / {participants.length} voted in close-out
          </div>
        ) : (
          <div className="text-xs text-slate-500 text-center">
            {session.finishedUsers?.length || 0} / {participants.length} finished
          </div>
        )}
      </div>
      {isFacilitator && (
        <div className="p-3 border-t border-slate-200">
          <button
            onClick={() => setShowInvite(true)}
            className="w-full bg-retro-primary text-white py-2 rounded-lg font-bold text-sm hover:bg-retro-primaryHover"
          >
            Invite Team
          </button>
        </div>
      )}
          </>
        )}
    </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-50">
        {renderHeader()}
        {showInvite && <InviteModal team={team} activeSession={session} onClose={() => setShowInvite(false)} />}

        <div className="flex-grow flex overflow-hidden">
          <div id="phase-scroller" className="flex-grow overflow-y-auto overflow-x-auto relative flex flex-col">
              {session.phase === 'ICEBREAKER' && renderIcebreaker()}
              {session.phase === 'WELCOME' && renderWelcome()}
              {session.phase === 'OPEN_ACTIONS' && renderOpenActions()}
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
              {session.phase === 'DISCUSS' && renderDiscuss()}
              {session.phase === 'REVIEW' && renderReview()}
              {session.phase === 'CLOSE' && renderClose()}
          </div>
          {renderParticipantsPanel()}
        </div>
    </div>
  );
};

export default Session;
