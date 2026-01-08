
import React, { useState, useEffect, useRef } from 'react';
import { Team, User, HealthCheckSession as HealthCheckSessionType, HealthCheckDimension, ActionItem } from '../types';
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

const PHASES = ['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSE'] as const;
const COLOR_POOL = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-pink-500'];

const isHealthCheckSession = (session: unknown): session is HealthCheckSessionType => {
  if (!session || typeof session !== 'object') return false;
  const candidate = session as Partial<HealthCheckSessionType>;
  return !!candidate.templateId && Array.isArray(candidate.dimensions);
};

const HealthCheckSession: React.FC<Props> = ({ team, currentUser, sessionId, onExit, onTeamUpdate }) => {
  const [session, setSession] = useState<HealthCheckSessionType | undefined>(
    team.healthChecks?.find(h => h.id === sessionId)
  );
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set([currentUser.id]));
  const presenceBroadcasted = useRef(false);
  const sessionRef = useRef(session);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { presenceBroadcasted.current = false; }, [sessionId]);

  const isFacilitator = currentUser.role === 'facilitator';
  const [showInvite, setShowInvite] = useState(false);
  const [activeDiscussDimension, setActiveDiscussDimension] = useState<string | null>(null);
  const [newProposalText, setNewProposalText] = useState('');
  const discussRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
  const assignableMembers = Array.from(
    new Map(
      [...participants, ...team.members, ...(team.archivedMembers || [])].map(m => [m.id, m])
    ).values()
  );

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

  // Update session helper
  const updateSession = (updater: (s: HealthCheckSessionType) => void) => {
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
      dataService.updateHealthCheckSession(team.id, newSession);
      dataService.persistParticipants(team.id, newSession.participants);
      syncService.updateSession(newSession);

      return newSession;
    });
  };

  const setPhase = (phase: typeof PHASES[number]) => {
    updateSession(s => { s.phase = phase; });
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
      setSession(updatedSession);
      dataService.updateHealthCheckSession(team.id, updatedSession);
    });

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
    };
  }, [sessionId, currentUser.id, currentUser.name, currentUser.role, team.id]);

  // Ensure the shared roster includes the currently connected user
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
        Session not found
      </div>
    );
  }

  // Calculate statistics
  const getDimensionStats = (dimensionId: string) => {
    const ratings: number[] = [];
    const comments: { userId: string; comment: string }[] = [];

    Object.entries(session.ratings).forEach(([userId, userRatings]) => {
      const r = userRatings[dimensionId];
      if (r) {
        ratings.push(r.rating);
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
    const participantIds = new Set(participants.map(p => p.id));
    Object.keys(session.ratings).forEach(userId => {
      if (participantIds.has(userId)) {
        const userRatings = session.ratings[userId] || {};
        const completed = session.dimensions.every(d => userRatings[d.id]?.rating != null);
        if (completed) count++;
      }
    });
    return count;
  };

  // Handle exit
  const handleExit = () => {
    if (isFacilitator && session.status === 'IN_PROGRESS') {
      updateSession(s => { s.status = 'CLOSED'; });
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

  // Handle comment change
  const handleComment = (dimensionId: string, comment: string) => {
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
  };

  const handleAddProposal = (linkedDimensionId?: string) => {
    if (!newProposalText.trim()) return;

    updateSession(s => {
      s.actions.push({
        id: Math.random().toString(36).substr(2, 9),
        text: newProposalText.trim(),
        assigneeId: null,
        done: false,
        type: 'proposal',
        proposalVotes: {},
        linkedTicketId: linkedDimensionId
      });
    });
    setNewProposalText('');
  };

  const handleDirectAddAction = (linkedDimensionId?: string) => {
    if (!newProposalText.trim()) return;

    updateSession(s => {
      s.actions.push({
        id: Math.random().toString(36).substr(2, 9),
        text: newProposalText.trim(),
        assigneeId: null,
        done: false,
        type: 'new',
        proposalVotes: {},
        linkedTicketId: linkedDimensionId
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

  // Render header (same style as Session.tsx)
  const renderHeader = () => (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-50">
      <div className="flex items-center h-full">
        <button onClick={handleExit} className="mr-3 text-slate-400 hover:text-slate-700">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="hidden lg:flex h-full items-center space-x-1">
          {PHASES.map(p => (
            <button
              key={p}
              onClick={() => isFacilitator ? setPhase(p) : null}
              disabled={!isFacilitator && session.status !== 'CLOSED'}
              className={`phase-nav-btn h-full px-2 text-[10px] font-bold uppercase ${
                session.phase === p ? 'active' : 'text-slate-400 disabled:opacity-50'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
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
              {session.phase === 'SURVEY'
                ? `${getFinishedCount()}/${participants.length}`
                : session.phase === 'CLOSE'
                ? `${Object.keys(session.roti || {}).length}/${participants.length}`
                : `${participants.length}`
              }
            </span>
            <span className="text-[10px] text-slate-500 ml-1 hidden md:inline">
              {session.phase === 'SURVEY' ? 'finished' : session.phase === 'CLOSE' ? 'voted' : 'participants'}
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

  // Render Survey Phase
  const renderSurvey = () => {
    const myRatings = session.ratings[currentUser.id] || {};

    return (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-sm">
          <div>
            <span className="font-bold text-slate-700 text-lg">Rate each health dimension</span>
            <span className="text-slate-400 text-sm ml-4">
              {getFinishedCount()} / {participants.length} participants finished
            </span>
          </div>
          {isFacilitator && (
            <button
              onClick={() => setPhase('DISCUSS')}
              className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover"
            >
              Next: Discuss
            </button>
          )}
        </div>

        <div className="flex-grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 mb-6">
              <p className="text-indigo-700 text-center text-sm">
                {session.settings.isAnonymous
                  ? 'Your ratings are anonymous'
                  : 'Your ratings are visible to the team'}
              </p>
            </div>

            <div className="space-y-6">
              {session.dimensions.map((dimension) => {
                const myRating = myRatings[dimension.id]?.rating;
                const myComment = myRatings[dimension.id]?.comment || '';

                return (
                  <div key={dimension.id} className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                    <h3 className="text-xl font-bold text-slate-800 mb-3">{dimension.name}</h3>
                    <div className="grid md:grid-cols-2 gap-4 mb-4 text-sm">
                      <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                        <span className="text-rose-600 font-bold">Bad:</span>
                        <span className="text-slate-600 ml-2">{dimension.badDescription}</span>
                      </div>
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                        <span className="text-emerald-600 font-bold">Good:</span>
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

                    <div className="flex justify-between text-[10px] text-slate-400 uppercase px-2 mb-4">
                      <span>Strongly Disagree</span>
                      <span>Neutral</span>
                      <span>Strongly Agree</span>
                    </div>

                    <div className="relative">
                      <textarea
                        placeholder="Additional comments (optional)..."
                        value={myComment}
                        onChange={(e) => handleComment(dimension.id, e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg p-3 text-slate-700 text-sm resize-none h-20 focus:outline-none focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
                      />
                      {myRating && (
                        <span className="absolute bottom-3 right-3 text-emerald-500 text-xs font-bold flex items-center">
                          <span className="material-symbols-outlined text-sm mr-1">check_circle</span>
                          SAVED
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
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-sm">
          <span className="font-bold text-slate-700 text-lg">Discuss survey results and identify actions</span>
          {isFacilitator && (
            <button
              onClick={() => setPhase('REVIEW')}
              className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover"
            >
              Next: Review
            </button>
          )}
        </div>

        <div className="flex-grow overflow-auto p-6">
          <div className="max-w-5xl mx-auto">
            {/* Radar Chart */}
            <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6 shadow-sm">
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
                          {stats.average.toFixed(1)}
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
                    className={`bg-white border-2 rounded-xl shadow-sm transition ${
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
                        <span className={`text-2xl font-black ${stats.average >= 4 ? 'text-emerald-600' : stats.average >= 3 ? 'text-amber-600' : 'text-rose-600'}`}>
                          {stats.average.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex-grow">
                        <h3 className="text-lg font-bold text-slate-800 mb-1">{dimension.name}</h3>
                        <p className="text-slate-500 text-sm">
                          {stats.count} rating{stats.count !== 1 ? 's' : ''}
                          {stats.comments.length > 0 && ` • ${stats.comments.length} comment${stats.comments.length !== 1 ? 's' : ''}`}
                        </p>
                      </div>
                      <span className="material-symbols-outlined text-slate-400">
                        {isActive ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>

                    {isActive && (
                      <div className="border-t border-slate-200 p-4 bg-slate-50">
                        {/* Distribution */}
                        <div className="mb-4">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Vote Distribution</h4>
                          <div className="flex items-end justify-between space-x-3 h-40">
                            {stats.distribution.map((count, i) => {
                              const rating = i + 1;
                              const heightPercent = stats.count > 0 ? (count / stats.count) * 100 : 0;
                              const heightPx = count > 0 ? Math.max((heightPercent / 100) * 120, 20) : 8;
                              const barColor = rating === 5 ? 'bg-emerald-600' : rating === 4 ? 'bg-emerald-400' : rating === 3 ? 'bg-amber-500' : rating === 2 ? 'bg-orange-500' : 'bg-rose-600';
                              const badgeColor = rating === 5 ? 'bg-emerald-100 text-emerald-700' : rating === 4 ? 'bg-emerald-50 text-emerald-600' : rating === 3 ? 'bg-amber-100 text-amber-700' : rating === 2 ? 'bg-orange-100 text-orange-700' : 'bg-rose-100 text-rose-700';
                              return (
                                <div key={rating} className="flex flex-col items-center flex-1">
                                  <span className="text-sm font-bold text-slate-700 mb-2">{count}</span>
                                  <div
                                    className={`w-full rounded-t shadow-md transition-all duration-300 ${barColor} ${count === 0 ? 'opacity-30' : 'opacity-100'}`}
                                    style={{ height: `${heightPx}px` }}
                                  />
                                  <span className={`mt-2 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shadow-sm ${badgeColor}`}>
                                    {rating}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Comments */}
                        {stats.comments.length > 0 && (
                          <div className="mb-4">
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Comments</h4>
                            <div className="space-y-2">
                              {stats.comments.map((c, idx) => {
                                const author = participants.find(p => p.id === c.userId);
                                const { displayName } = getMemberDisplay(author || { id: c.userId, name: 'Unknown', color: 'bg-slate-500', role: 'participant' });
                                return (
                                  <div key={idx} className="bg-white rounded-lg p-3 text-sm text-slate-700 border border-slate-200">
                                    {!session.settings.isAnonymous && (
                                      <span className="text-slate-400 text-xs font-medium mr-2">{displayName}:</span>
                                    )}
                                    {c.comment}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Actions */}
                        <div>
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Actions</h4>
                          {(() => {
                            const proposals = session.actions.filter(a => a.linkedTicketId === dimension.id && a.type === 'proposal');
                            const acceptedActions = session.actions.filter(a => a.linkedTicketId === dimension.id && a.type === 'new');

                            return (
                              <>
                                {proposals.map(p => {
                                  const upVotes = Object.values(p.proposalVotes || {}).filter(v => v === 'up').length;
                                  const neutralVotes = Object.values(p.proposalVotes || {}).filter(v => v === 'neutral').length;
                                  const downVotes = Object.values(p.proposalVotes || {}).filter(v => v === 'down').length;
                                  const totalVotes = upVotes + neutralVotes + downVotes;
                                  const myVote = p.proposalVotes?.[currentUser.id];

                                  return (
                                    <div key={p.id} className="bg-white p-3 rounded border border-slate-200 mb-2 flex items-center justify-between">
                                      <span className="text-slate-700 text-sm font-medium mr-2">{p.text}</span>
                                      <div className="flex items-center space-x-3">
                                        <div className="flex bg-slate-100 rounded-lg p-1 space-x-1">
                                          <button onClick={() => handleVoteProposal(p.id, 'up')} className={`px-2 py-1 rounded flex items-center transition ${myVote==='up'?'bg-emerald-100 text-emerald-700 shadow-sm':'hover:bg-white text-slate-500'}`}>
                                            <span className="material-symbols-outlined text-sm mr-1">thumb_up</span>
                                            <span className="text-xs font-bold">{upVotes || ''}</span>
                                          </button>
                                          <button onClick={() => handleVoteProposal(p.id, 'neutral')} className={`px-2 py-1 rounded flex items-center transition ${myVote==='neutral'?'bg-slate-300 text-slate-800 shadow-sm':'hover:bg-white text-slate-500'}`}>
                                            <span className="material-symbols-outlined text-sm mr-1">remove</span>
                                            <span className="text-xs font-bold">{neutralVotes || ''}</span>
                                          </button>
                                          <button onClick={() => handleVoteProposal(p.id, 'down')} className={`px-2 py-1 rounded flex items-center transition ${myVote==='down'?'bg-rose-100 text-rose-700 shadow-sm':'hover:bg-white text-slate-500'}`}>
                                            <span className="material-symbols-outlined text-sm mr-1">thumb_down</span>
                                            <span className="text-xs font-bold">{downVotes || ''}</span>
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
                                  );
                                })}

                                {acceptedActions.map(a => (
                                  <div key={a.id} className="flex items-center text-sm bg-emerald-50 p-2 rounded border border-emerald-200 text-emerald-800 mb-2">
                                    <span className="material-symbols-outlined text-emerald-600 mr-2 text-sm">check_circle</span>
                                    Accepted: {a.text}
                                  </div>
                                ))}
                              </>
                            );
                          })()}

                          <div className="flex">
                            <input
                              type="text"
                              placeholder="Propose an action..."
                              value={newProposalText}
                              onChange={(e) => setNewProposalText(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddProposal(dimension.id)}
                              className="flex-grow bg-white border border-slate-200 rounded-l-lg p-2 text-slate-700 text-sm focus:outline-none focus:border-retro-primary"
                            />
                            <button
                              onClick={() => handleAddProposal(dimension.id)}
                              className="bg-slate-700 text-white px-3 font-bold text-sm hover:bg-slate-800 border-l border-slate-600"
                            >
                              Propose
                            </button>
                            {isFacilitator && (
                              <button onClick={() => handleDirectAddAction(dimension.id)} className="bg-retro-primary text-white px-3 rounded-r font-bold text-sm hover:bg-retro-primaryHover" title="Directly accept action">
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
        <div className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center shadow-sm">
          <span className="font-bold text-slate-700 text-lg">Review Actions</span>
          {isFacilitator && (
            <button
              onClick={() => setPhase('CLOSE')}
              className="bg-retro-primary text-white px-4 py-2 rounded font-bold text-sm hover:bg-retro-primaryHover"
            >
              Next: Close
            </button>
          )}
        </div>

        <div className="flex-grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
              <div className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                <span className="font-bold text-slate-700">Actions from this session ({newActions.length})</span>
              </div>

              {newActions.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  No actions created yet.
                </div>
              ) : (
                Object.entries(groupedActions).map(([key, actions]) => {
                  const dimension = session.dimensions.find(d => d.id === key);
                  return (
                    <div key={key} className="border-b border-slate-200 last:border-0">
                      <div className="bg-slate-50 px-4 py-2 border-b border-slate-100">
                        <span className="text-sm font-bold text-slate-500">
                          {dimension ? dimension.name : 'General'}
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
                            className={`flex-shrink-0 ${action.done ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500'}`}
                          >
                            <span className="material-symbols-outlined">
                              {action.done ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                          </button>
                          <div className={`flex-grow min-w-0 text-slate-700 ${action.done ? 'line-through opacity-60' : ''}`}>
                            <span className="break-words">
                              {action.text}
                            </span>
                          </div>
                          <select
                            value={action.assigneeId || ''}
                            disabled={!isFacilitator}
                            onChange={(e) => {
                              updateSession(s => {
                                const a = s.actions.find(x => x.id === action.id);
                                if (a) a.assigneeId = e.target.value || null;
                              });
                            }}
                            className="flex-shrink-0 text-xs bg-white border border-slate-200 rounded p-1.5 text-slate-600 focus:border-retro-primary min-w-[120px]"
                          >
                            <option value="">Unassigned</option>
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
    const votes: number[] = Object.values(session.roti);
    const voterCount = Object.keys(session.roti).length;
    const totalMembers = participants.length;
    const average = votes.length ? (votes.reduce((a, b) => a + b, 0) / votes.length).toFixed(1) : '-';
    const histogram = [1, 2, 3, 4, 5].map(v => votes.filter(x => x === v).length);
    const maxVal = Math.max(...histogram, 1);

    return (
      <div className="flex flex-col items-center justify-center h-full p-8 bg-slate-900 text-white">
        <h1 className="text-3xl font-bold mb-2">Health Check Complete</h1>
        <p className="text-slate-400 mb-8">Thank you for your contribution!</p>

        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-lg w-full text-center">
          <h3 className="text-xl font-bold mb-6">ROTI (Return on Time Invested)</h3>
          <div className="flex justify-center space-x-2 mb-8">
            {[1, 2, 3, 4, 5].map(score => (
              <button
                key={score}
                onClick={() => updateSession(s => { s.roti[currentUser.id] = score; })}
                className={`w-10 h-10 rounded-full font-bold transition ${
                  myRoti === score
                    ? 'bg-retro-primary text-white scale-110'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                }`}
              >
                {score}
              </button>
            ))}
          </div>

          {!session.settings.revealRoti ? (
            <div className="mb-4">
              <div className="text-slate-400 font-bold mb-4">{voterCount} / {totalMembers} members have voted</div>
              {isFacilitator && (
                <button
                  onClick={() => updateSession(s => { s.settings.revealRoti = true; })}
                  className="text-indigo-400 hover:text-white font-bold underline"
                >
                  Reveal Results
                </button>
              )}
            </div>
          ) : (
            <div className="mt-6">
              <div className="flex items-end justify-center h-24 space-x-3 mb-2">
                {histogram.map((count, i) => (
                  <div key={i} className="flex flex-col items-center justify-end h-full">
                    {count > 0 && <span className="text-xs font-bold text-slate-400 mb-1">{count}</span>}
                    <div
                      className="w-8 bg-indigo-500 rounded-t relative transition-all duration-500"
                      style={{ height: count > 0 ? `${(count / maxVal) * 100}%` : '4px', opacity: count > 0 ? 1 : 0.2 }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-center space-x-3 text-xs text-slate-500 border-t border-slate-700 pt-1">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-8">{i}</div>)}
              </div>
              <div className="mt-4 text-2xl font-black text-indigo-400">{average} / 5</div>
            </div>
          )}
        </div>

        {isFacilitator ? (
          <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">
            Return to Dashboard
          </button>
        ) : (
          <button onClick={handleExit} className="mt-8 bg-white text-slate-900 px-8 py-3 rounded-lg font-bold hover:bg-slate-200">
            Leave Health Check
          </button>
        )}
      </div>
    );
  };

  // Render participants panel (same style as Session.tsx)
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
          const isCurrentUser = member.id === currentUser.id;
          const isOnline = connectedUsers.has(member.id);
          const hasCompleted = session.phase === 'SURVEY' && (() => {
            const userRatings = session.ratings[member.id] || {};
            return session.dimensions.every(d => userRatings[d.id]?.rating != null);
          })();
          const hasRotiVote = session.phase === 'CLOSE' && Boolean(session.roti[member.id]);

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
              {(hasCompleted || hasRotiVote) && (
                <span className="material-symbols-outlined text-lg text-emerald-500" title="Finished">
                  check_circle
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="p-3 border-t border-slate-200 bg-slate-50">
        {session.phase === 'SURVEY' ? (
          <div className="text-xs text-slate-500 text-center">
            {getFinishedCount()} / {participants.length} completed survey
          </div>
        ) : session.phase === 'CLOSE' ? (
          <div className="text-xs text-slate-500 text-center">
            {Object.keys(session.roti || {}).length} / {participants.length} voted in close-out
          </div>
        ) : (
          <div className="text-xs text-slate-500 text-center">
            {participants.length} participant{participants.length !== 1 ? 's' : ''}
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
      {showInvite && <InviteModal team={team} activeHealthCheck={session} onClose={() => setShowInvite(false)} />}

      <div className="flex-grow flex overflow-hidden">
        <div className="flex-grow overflow-y-auto overflow-x-auto relative flex flex-col">
          {session.phase === 'SURVEY' && renderSurvey()}
          {session.phase === 'DISCUSS' && renderDiscuss()}
          {session.phase === 'REVIEW' && renderReview()}
          {session.phase === 'CLOSE' && renderClose()}
        </div>
        {renderParticipantsPanel()}
      </div>
    </div>
  );
};

export default HealthCheckSession;
