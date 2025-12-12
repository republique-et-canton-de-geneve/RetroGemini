
import React, { useState, useEffect, useRef } from 'react';
import { Team, User, RetroSession, Column, Ticket, ActionItem, Group } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import InviteModal from './InviteModal';

interface Props {
  team: Team;
  currentUser: User;
  sessionId: string;
  onExit: () => void;
  onTeamUpdate?: (team: Team) => void;
}

const PHASES = ['ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'BRAINSTORM', 'GROUP', 'VOTE', 'DISCUSS', 'REVIEW', 'CLOSE'];
const EMOJIS = ['👍', '👎', '❤️', '🎉', '👏', '😄', '😮', '🤔', '😡', '😢'];

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

  // Use a Ref to hold the latest session state to prevent Timer/Interaction race conditions
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  const getParticipants = () => {
    if (sessionRef.current?.participants && sessionRef.current.participants.length > 0) {
      return sessionRef.current.participants;
    }

    if (session?.participants && session.participants.length > 0) {
      return session.participants;
    }

    return team.members;
  };

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
      setSession(updatedSession);
      // Also save to localStorage
      dataService.updateSession(team.id, updatedSession);
    });

    // Listen for member events
    const unsubJoin = syncService.onMemberJoined(({ userId }) => {
      setConnectedUsers(prev => new Set([...prev, userId]));
    });

    const unsubLeave = syncService.onMemberLeft(({ userId }) => {
      setConnectedUsers(prev => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    });

    // Send initial session state (facilitator sends their version)
    if (currentUser.role === 'facilitator' && session) {
      setTimeout(() => syncService.updateSession(session), 500);
    }

    return () => {
      unsubUpdate();
      unsubJoin();
      unsubLeave();
      syncService.leaveSession();
      isMounted = false;
    };
  }, [sessionId, currentUser.id, currentUser.name, currentUser.role, team.id]);

  // Ensure the shared roster includes this user (and any known teammates) for cross-client visibility
  useEffect(() => {
    if (!session) return;

    const roster = getParticipants();
    const hasCurrentUser = roster.some(p => p.id === currentUser.id);
    const missingTeammates = team.members.filter(m => !roster.some(p => p.id === m.id));

    if (!hasCurrentUser || missingTeammates.length > 0 || !session.participants?.length) {
      updateSession(s => {
        const existing = s.participants ?? [];
        const merged = [...existing];

        if (!existing.some(p => p.id === currentUser.id)) {
          merged.push(currentUser);
        }

        team.members.forEach(m => {
          if (!merged.some(p => p.id === m.id)) {
            merged.push(m);
          }
        });

        s.participants = merged;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Follow facilitator-selected discussion focus
  useEffect(() => {
    setActiveDiscussTicket(session?.discussionFocusId ?? null);
  }, [session?.discussionFocusId]);

  const [showInvite, setShowInvite] = useState(false);
  const [draggedTicket, setDraggedTicket] = useState<Ticket | null>(null);
  
  // Drag Target State for explicit visual cues
  const [dragTarget, setDragTarget] = useState<{ type: 'COLUMN' | 'ITEM', id: string } | null>(null);

  const [refreshTick, setRefreshTick] = useState(0);

  // Focus management for new groups
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  // Focus management for new columns
  const [focusColumnId, setFocusColumnId] = useState<string | null>(null);

  // Editing Ticket State
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);

  // Interaction State
  const [emojiPickerOpenId, setEmojiPickerOpenId] = useState<string | null>(null);

  // Open Actions Phase State
  const [reviewActionIds, setReviewActionIds] = useState<string[]>([]);

  // Review Phase State (History persistence)
  const [historyActionIds, setHistoryActionIds] = useState<string[]>([]);

  // Proposal State
  const [newProposalText, setNewProposalText] = useState('');
  const [activeDiscussTicket, setActiveDiscussTicket] = useState<string | null>(null);
  
  // UI State
  const [isEditingColumns, setIsEditingColumns] = useState(false);
  const [isEditingTimer, setIsEditingTimer] = useState(false);
  const [timerEditMin, setTimerEditMin] = useState(5);
  const [timerEditSec, setTimerEditSec] = useState(0);
  const [timerFinished, setTimerFinished] = useState(false);
  
  // Audio ref
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Force update wrapper using Ref for reliability
  const updateSession = (updater: (s: RetroSession) => void) => {
    if(!sessionRef.current) return;
    const newSession = JSON.parse(JSON.stringify(sessionRef.current));
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
    setSession(newSession);
    // Sync to other clients via WebSocket
    syncService.updateSession(newSession);
  };

  // Calculate votes left in render scope for Auto-Finish Logic
  const myTicketVotes = session ? session.tickets.reduce((acc, t) => acc + t.votes.filter(v => v === currentUser.id).length, 0) : 0;
  const myGroupVotes = session ? session.groups.reduce((acc, g) => acc + g.votes.filter(v => v === currentUser.id).length, 0) : 0;
  const votesLeft = session ? session.settings.maxVotes - (myTicketVotes + myGroupVotes) : 0;

  // Auto Finish / Unfinish Effect
  useEffect(() => {
      if (!session || session.phase !== 'VOTE') return;

      // Auto FINISH if 0 votes left
      if (votesLeft <= 0 && !session.finishedUsers.includes(currentUser.id)) {
          const timer = setTimeout(() => {
              updateSession(s => {
                  if (!s.finishedUsers.includes(currentUser.id)) {
                      s.finishedUsers.push(currentUser.id);
                  }
              });
          }, 800);
          return () => clearTimeout(timer);
      }
      
      // Auto UN-FINISH if votes become available (e.g. user removed a vote, or maxVotes increased)
      if (votesLeft > 0 && session.finishedUsers.includes(currentUser.id)) {
           updateSession(s => {
               s.finishedUsers = s.finishedUsers.filter(id => id !== currentUser.id);
           });
      }
  }, [votesLeft, session?.phase, currentUser.id, session?.finishedUsers]);


  // Initialize review actions when entering OPEN_ACTIONS phase
  useEffect(() => {
      if (session?.phase === 'OPEN_ACTIONS' && reviewActionIds.length === 0) {
          const currentTeam = dataService.getTeam(team.id) || team;
          const prevRetros = currentTeam.retrospectives.filter(r => r.id !== sessionId);
          const globalOpen = currentTeam.globalActions.filter(a => !a.done);
          const retroOpen = prevRetros.flatMap(r => r.actions.filter(a => !a.done));
          const allIds = [...globalOpen, ...retroOpen].map(a => a.id);
          setReviewActionIds([...new Set(allIds)]);
      }
  }, [session?.phase]);

  // Initialize history actions when entering REVIEW phase
  useEffect(() => {
      if (session?.phase === 'REVIEW' && historyActionIds.length === 0) {
          const currentTeam = dataService.getTeam(team.id) || team;
          // Get all actions that are NOT created in this session
          const newActionIds = sessionRef.current?.actions.map(a => a.id) || [];
          
          const allGlobal = currentTeam.globalActions;
          const allRetroActions = currentTeam.retrospectives.filter(r => r.id !== sessionId).flatMap(r => r.actions);
          
          // We show all Unfinished actions from history
          // PLUS we keep showing them even if marked done during this session (handled by using this stable list)
          const relevantActions = [...allGlobal, ...allRetroActions].filter(a => !a.done && !newActionIds.includes(a.id));
          
          setHistoryActionIds(relevantActions.map(a => a.id));
      }
  }, [session?.phase]);

  // Timer Effect
  useEffect(() => {
    let interval: any;
    if (session?.settings.timerRunning && session.settings.timerSeconds > 0) {
      setTimerFinished(false);
      interval = setInterval(() => {
        updateSession(s => {
            if(s.settings.timerSeconds > 0) {
                s.settings.timerSeconds--;
                if (s.settings.timerSeconds === 0) {
                    s.settings.timerRunning = false;
                    if(audioRef.current) {
                        audioRef.current.play().catch(e => console.log("Audio play failed", e));
                    }
                }
            } else {
                s.settings.timerRunning = false;
            }
        });
      }, 1000);
    } else if (session?.settings.timerSeconds === 0 && !session.settings.timerRunning) {
        setTimerFinished(true);
    }
    return () => clearInterval(interval);
  }, [session?.settings.timerRunning, session?.settings.timerSeconds]);

  if (!session) return <div>Session not found</div>;
  const isFacilitator = currentUser.role === 'facilitator';
  const participants = getParticipants();

  // --- Logic ---
  const handleExit = () => {
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
              s.tickets.forEach(t => {
                  const userVotes = t.votes.filter(id => id === currentUser.id);
                  if(userVotes.length > 1) {
                      t.votes = t.votes.filter(id => id !== currentUser.id);
                      t.votes.push(currentUser.id);
                  }
              });
              s.groups.forEach(g => {
                  const userVotes = g.votes.filter(id => id === currentUser.id);
                  if(userVotes.length > 1) {
                      g.votes = g.votes.filter(id => id !== currentUser.id);
                      g.votes.push(currentUser.id);
                  }
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
      setTimerFinished(false);
      s.finishedUsers = [];
      setIsEditingColumns(false);
      setIsEditingTimer(false);
      setEditingTicketId(null);
      if(p==='CLOSE') s.status = 'CLOSED';
  });

  const formatTime = (s: number) => {
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return `${m}:${sec.toString().padStart(2, '0')}`;
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
  const handleDragStart = (e: React.DragEvent, ticket: Ticket) => {
      setDraggedTicket(ticket);
      e.dataTransfer.effectAllowed = 'move';
      e.stopPropagation();
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

  const handleDropOnColumn = (e: React.DragEvent, colId: string) => {
      e.preventDefault();
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
      setDraggedTicket(null);
  };

  const handleDropOnTicket = (e: React.DragEvent, targetTicket: Ticket) => {
      e.preventDefault();
      e.stopPropagation();
      setDragTarget(null);
      if(!draggedTicket || draggedTicket.id === targetTicket.id) return;
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
      setDraggedTicket(null);
  };

  const handleDropOnGroup = (e: React.DragEvent, targetGroup: Group) => {
      e.preventDefault();
      e.stopPropagation();
      setDragTarget(null);
      if(!draggedTicket) return;
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
      setDraggedTicket(null);
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
          let count = g.votes.length;
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

      return (
        <div 
            key={t.id} 
            draggable={mode === 'GROUP'}
            onDragStart={(e) => handleDragStart(e, t)}
            onDragOver={(e) => mode === 'GROUP' ? handleDragOverItem(e, t.id) : undefined}
            onDrop={(e) => handleDropOnTicket(e, t)}
            className={`bg-white p-3 rounded shadow-sm border group relative mb-2 transition-all 
                ${mode === 'GROUP' ? 'cursor-grab active:cursor-grabbing' : ''}
                ${isDragTarget ? 'ring-4 ring-indigo-300 border-indigo-500 z-20 scale-105' : 'border-slate-200'}
            `}
        >
            {isDragTarget && (
                <div className="absolute inset-0 bg-indigo-50/90 flex items-center justify-center rounded z-10 font-bold text-indigo-700 pointer-events-none">
                    <span className="material-symbols-outlined mr-1">merge</span> Group with this
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
                    <div className={`text-sm w-full whitespace-pre-wrap ${!visible ? 'ticket-blur' : 'text-slate-700'}`}>
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
                            <div className="absolute top-full left-0 bg-white border border-slate-200 shadow-xl rounded-lg p-2 grid grid-cols-5 gap-1 z-50 w-max mt-1">
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
        <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3" preload="auto" />
        
        <div className="flex items-center h-full">
            <button onClick={handleExit} className="mr-3 text-slate-400 hover:text-slate-700"><span className="material-symbols-outlined">arrow_back</span></button>
            <div className="hidden lg:flex h-full items-center space-x-1">
                {PHASES.map(p => (
                    <button key={p} onClick={() => isFacilitator ? setPhase(p) : null} disabled={!isFacilitator && session.status !== 'CLOSED'} className={`phase-nav-btn h-full px-2 text-[10px] font-bold uppercase ${session.phase === p ? 'active' : 'text-slate-400 disabled:opacity-50'}`}>{p.replace('_', ' ')}</button>
                ))}
            </div>
        </div>
        <div onClick={() => setTimerFinished(false)} className="flex items-center bg-slate-100 rounded-lg px-3 py-1 mr-4 cursor-pointer hover:bg-slate-200 transition">
             {!isEditingTimer ? (
                 <>
                    <span className={`font-mono font-bold text-lg ${timerFinished ? 'text-red-500 animate-bounce' : session.settings.timerSeconds < 60 ? 'text-red-500' : 'text-slate-700'}`}>{formatTime(session.settings.timerSeconds)}</span>
                    {isFacilitator && (
                        <button onClick={(e) => { e.stopPropagation(); updateSession(s => s.settings.timerRunning = !s.settings.timerRunning); }} className="ml-2 text-slate-500 hover:text-indigo-600">
                            <span className="material-symbols-outlined text-lg">{session.settings.timerRunning ? 'pause' : 'play_arrow'}</span>
                        </button>
                    )}
                    {isFacilitator && (
                        <button onClick={(e) => {
                            e.stopPropagation();
                            setTimerEditMin(Math.floor(session.settings.timerSeconds / 60));
                            setTimerEditSec(session.settings.timerSeconds % 60);
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
                        updateSession(s => {
                            s.settings.timerSeconds = (timerEditMin * 60) + timerEditSec;
                            s.settings.timerInitial = (timerEditMin * 60) + timerEditSec;
                            s.settings.timerRunning = false;
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
             <button onClick={() => setShowInvite(true)} className="flex items-center text-slate-500 hover:text-retro-primary" title="Invite / Join">
                <span className="material-symbols-outlined text-xl">qr_code_2</span>
             </button>
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
                        value={session.icebreakerQuestion} 
                        onChange={(e) => updateSession(s => s.icebreakerQuestion = e.target.value)}
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
                       <div className="text-lg font-bold text-slate-600 mb-2">{voterCount} votes cast</div>
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
                      <div className="text-center mt-4 text-slate-500 font-bold">{voterCount} participants voted</div>
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

    // Collect open actions once on mount to keep list stable even if done status changes
    const actionsToShow = [
        ...currentTeam.globalActions.filter(a => reviewActionIds.includes(a.id)),
        ...currentTeam.retrospectives.flatMap(r => r.actions.filter(a => reviewActionIds.includes(a.id)))
    ];
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
                                <button onClick={() => { dataService.toggleGlobalAction(team.id, action.id); setRefreshTick(t => t + 1); }} className={`mr-3 transition ${action.done ? 'text-emerald-500 scale-110' : 'text-slate-300 hover:text-emerald-500'}`}>
                                    <span className="material-symbols-outlined text-2xl">{action.done ? 'check_circle' : 'radio_button_unchecked'}</span>
                                </button>
                                <div className="flex flex-col">
                                    <span className={`font-medium transition-all ${action.done ? 'text-emerald-800 line-through decoration-emerald-300' : 'text-slate-700'}`}>{action.text}</span>
                                    {contextText && <span className="text-xs text-indigo-400 italic mt-0.5">{contextText}</span>}
                                </div>
                            </div>
                            <select 
                                value={action.assigneeId || ''}
                                onChange={(e) => {
                                    const updated = {...action, assigneeId: e.target.value || null};
                                    dataService.updateGlobalAction(team.id, updated);
                                    setRefreshTick(t => t + 1);
                                }}
                                className="text-xs border border-slate-200 rounded p-1 bg-white text-slate-900"
                            >
                                <option value="">Unassigned</option>
                               {participants.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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
                            <div className={`px-3 py-1 rounded-full text-xs font-bold border ${finishedCount === totalMembers ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : 'bg-white text-slate-500 border-slate-200'}`}>
                                {finishedCount} / {totalMembers} Finished
                            </div>
                            <button 
                                onClick={() => updateSession(s => {
                                    if(!s.finishedUsers) s.finishedUsers = [];
                                    if(s.finishedUsers.includes(currentUser.id)) {
                                        s.finishedUsers = s.finishedUsers.filter(id => id !== currentUser.id);
                                    } else {
                                        s.finishedUsers.push(currentUser.id);
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

      return (
        <div className="flex flex-col h-full overflow-hidden">
            {renderPhaseActionBar()}
            <div className="flex-grow overflow-x-auto bg-slate-50 p-6 flex space-x-6 items-start h-auto min-h-0">
                {session.columns.map(col => {
                    let tickets = session.tickets.filter(t => t.colId === col.id && !t.groupId);
                    const groups = session.groups.filter(g => g.colId === col.id);

                    // Group by Author if in GROUP phase
                    let groupedTickets: Record<string, Ticket[]> = {};
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

                            <div className={`p-3 border-b border-slate-100 font-bold flex items-center justify-between ${col.color} ${col.text}`}>
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
                                    <div className="flex items-center"><span className="material-symbols-outlined mr-2">{col.icon}</span> {col.title}</div>
                                )}
                                <span className="bg-white/60 px-2 py-0.5 rounded-full text-xs font-bold">{tickets.length + groups.length}</span>
                            </div>
                            <div className="p-3 space-y-3 bg-slate-50/50 relative">
                                {mode === 'BRAINSTORM' && (
                                    <div className={`bg-white p-3 rounded border border-slate-200 shadow-sm focus-within:ring-2 ${col.ring} transition`}>
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
                                                            onBlur={() => setFocusGroupId(null)}
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
                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 pl-1 flex items-center">
                                                <span className="w-2 h-2 rounded-full bg-slate-300 mr-2"></span>
                                               {participants.find(m => m.id === authorId)?.name || 'Unknown'}
                                            </div>
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
                                    id: newId, title: 'New Column', color: 'bg-slate-50', border: 'border-slate-300', icon: 'star', text: 'text-slate-700', ring: 'focus:ring-slate-200'
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
                     <div key={item.id} className={`bg-white rounded-xl shadow-sm border-2 transition ${activeDiscussTicket === item.id ? 'border-retro-primary ring-4 ring-indigo-50' : 'border-slate-200'}`}>
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
                                 <div className="text-lg text-slate-800 font-medium mb-1">{item.text}</div>
                                 <div className="flex items-center space-x-4 text-xs font-bold text-slate-400">
                                     <span className="flex items-center text-indigo-600"><span className="material-symbols-outlined text-sm mr-1">thumb_up</span> {item.votes} votes</span>
                                     {item.type === 'group' && <span className="flex items-center"><span className="material-symbols-outlined text-sm mr-1">layers</span> Group</span>}
                                 </div>
                                 
                                 {item.type === 'group' && subItems.length > 0 && (
                                     <div className="mt-3 pl-3 border-l-2 border-slate-200">
                                         {subItems.map(sub => (
                                             <div key={sub.id} className="text-sm text-slate-500 mb-1">{sub.text}</div>
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

    // Use stable history list from state (historyActionIds) to allow checking/unchecking without disappearing
    const allHistoryActions = [
        ...currentTeam.globalActions,
        ...currentTeam.retrospectives.filter(r => r.id !== session.id).flatMap(r => r.actions)
    ];
    
    const uniquePrevActions = allHistoryActions.filter(a => historyActionIds.includes(a.id));

    const ActionRow: React.FC<{ action: ActionItem, isGlobal: boolean }> = ({ action, isGlobal }) => {
        // Find context if previous retro action
        let contextText = "";
        if (!isGlobal && action.originRetro) {
            // Re-find the retro and ticket/group to build context
            // Optimization: could be passed in, but lookup is fast enough
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
                        onClick={() => { 
                            if(isGlobal) dataService.toggleGlobalAction(team.id, action.id);
                            else updateSession(s => { const a = s.actions.find(x => x.id === action.id); if(a) a.done = !a.done; });
                            setRefreshTick(t => t + 1);
                        }} 
                        className={`mr-3 transition ${action.done ? 'text-emerald-500 scale-110' : 'text-slate-300 hover:text-emerald-500'}`}
                    >
                        <span className="material-symbols-outlined text-2xl">{action.done ? 'check_circle' : 'radio_button_unchecked'}</span>
                    </button>
                    <div className="flex-grow flex flex-col">
                        <input
                            value={action.text}
                            onChange={(e) => {
                                if(isGlobal) dataService.updateGlobalAction(team.id, {...action, text: e.target.value});
                                else updateSession(s => { const a = s.actions.find(x => x.id === action.id); if(a) a.text = e.target.value; });
                                setRefreshTick(t => t+1);
                            }}
                            className={`w-full bg-transparent border border-transparent hover:border-slate-300 rounded px-2 py-1 focus:bg-white focus:border-retro-primary outline-none transition font-medium ${action.done ? 'line-through text-slate-400' : 'text-slate-700'}`}
                        />
                         {contextText && <span className="text-xs text-indigo-400 italic mt-0.5 px-2">{contextText}</span>}
                    </div>
                </div>
                <select
                    value={action.assigneeId || ''}
                    onChange={(e) => {
                        const val = e.target.value || null;
                        if(isGlobal) dataService.updateGlobalAction(team.id, {...action, assigneeId: val});
                        else updateSession(s => { const a = s.actions.find(x => x.id === action.id); if(a) a.assigneeId = val; });
                        setRefreshTick(t => t+1);
                    }}
                    className="text-xs border border-slate-200 rounded p-1.5 bg-white text-slate-600 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100 outline-none"
                >
                    <option value="">Unassigned</option>
                    {participants.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                </select>
                {isFacilitator && !isGlobal && (
                    <button
                        onClick={() => updateSession(s => s.actions = s.actions.filter(x => x.id !== action.id))}
                        className="ml-3 text-slate-300 hover:text-red-500"
                    >
                        <span className="material-symbols-outlined">delete</span>
                    </button>
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
                        <div className="text-slate-400 font-bold mb-4">{voterCount} members have voted</div>
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
  const renderParticipantsPanel = () => (
    <div className="w-64 bg-white border-l border-slate-200 flex flex-col shrink-0 hidden lg:flex">
      <div className="p-4 border-b border-slate-200">
        <h3 className="text-sm font-bold text-slate-700 flex items-center">
          <span className="material-symbols-outlined mr-2 text-lg">groups</span>
          Participants ({participants.length})
        </h3>
      </div>
      <div className="flex-grow overflow-y-auto p-3">
        {participants.map(member => {
          const isFinished = session.finishedUsers?.includes(member.id);
          const isCurrentUser = member.id === currentUser.id;
          const isOnline = connectedUsers.has(member.id);
          return (
            <div
              key={member.id}
              className={`flex items-center p-2 rounded-lg mb-1 ${isCurrentUser ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
            >
              <div className="relative mr-3">
                <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold`}>
                  {member.name.substring(0, 2).toUpperCase()}
                </div>
                {isOnline && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-white" title="Online" />
                )}
              </div>
              <div className="flex-grow min-w-0">
                <div className={`text-sm font-medium truncate ${isCurrentUser ? 'text-indigo-700' : 'text-slate-700'}`}>
                  {member.name}
                  {isCurrentUser && <span className="text-xs text-indigo-400 ml-1">(you)</span>}
                </div>
                <div className="text-xs text-slate-400 capitalize">{member.role}</div>
              </div>
              {isFinished && (
                <span className="material-symbols-outlined text-emerald-500 text-lg" title="Finished">
                  check_circle
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="p-3 border-t border-slate-200 bg-slate-50">
        <div className="text-xs text-slate-500 text-center">
          {session.finishedUsers?.length || 0} / {participants.length} finished
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-50">
        {renderHeader()}
        {showInvite && <InviteModal team={team} activeSession={session} onClose={() => setShowInvite(false)} />}

        <div className="flex-grow flex overflow-hidden">
          <div id="phase-scroller" className="flex-grow overflow-y-auto overflow-x-hidden relative flex flex-col">
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
