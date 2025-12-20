
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Team, User, HealthCheckSession as HealthCheckSessionType, HealthCheckDimension, ActionItem } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

interface Props {
  team: Team;
  currentUser: User;
  sessionId: string;
  onExit: () => void;
  onTeamUpdate?: (team: Team) => void;
}

const PHASES = ['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSE'] as const;
const COLOR_POOL = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500', 'bg-fuchsia-500', 'bg-lime-500', 'bg-pink-500'];

const HealthCheckSession: React.FC<Props> = ({ team, currentUser, sessionId, onExit, onTeamUpdate }) => {
  const [session, setSession] = useState<HealthCheckSessionType | undefined>(
    team.healthChecks?.find(h => h.id === sessionId)
  );
  const [connectedUsers, setConnectedUsers] = useState<Set<string>>(new Set([currentUser.id]));
  const presenceBroadcasted = useRef(false);
  const sessionRef = useRef(session);

  useEffect(() => { sessionRef.current = session; }, [session]);

  const isFacilitator = currentUser.role === 'facilitator';
  const [showInvite, setShowInvite] = useState(false);
  const [activeDiscussDimension, setActiveDiscussDimension] = useState<string | null>(null);
  const [newActionText, setNewActionText] = useState('');
  const discussRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Get participants
  const getParticipants = () => {
    const roster = session?.participants?.length ? [...session.participants] : [];
    if (!roster.some(p => p.id === currentUser.id)) {
      roster.push(currentUser);
    }
    const deduped: typeof roster = [];
    const seen = new Set<string>();
    roster.forEach((p) => {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      deduped.push(p);
    });
    return deduped;
  };

  const participants = getParticipants();

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
    const baseSession = sessionRef.current
      ?? dataService.getHealthCheck(team.id, sessionId)
      ?? null;

    if (!baseSession) return;

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
    setSession(newSession);
    syncService.updateSession(newSession);
  };

  const setPhase = (phase: typeof PHASES[number]) => {
    updateSession(s => { s.phase = phase; });
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
      if (syncService.getCurrentSessionId() !== sessionId || updatedSession.id !== sessionId) return;
      setSession(updatedSession as HealthCheckSessionType);
      dataService.updateHealthCheckSession(team.id, updatedSession as HealthCheckSessionType);
    });

    const unsubJoin = syncService.onMemberJoined(({ userId, userName }) => {
      if (syncService.getCurrentSessionId() !== sessionId) return;
      setConnectedUsers(prev => new Set([...prev, userId]));
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

  // Broadcast presence once
  useEffect(() => {
    if (!session || presenceBroadcasted.current) return;
    presenceBroadcasted.current = true;

    updateSession((s) => {
      if (!s.participants) s.participants = [];
      if (!s.participants.some((p) => p.id === currentUser.id)) {
        s.participants.push(currentUser);
      }
    });
  }, [session?.id, currentUser.id]);

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
    if (score >= 3) return 'bg-yellow-500';
    return 'bg-rose-500';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 4) return 'bg-emerald-100';
    if (score >= 3) return 'bg-yellow-100';
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
        s.ratings[currentUser.id][dimensionId] = { rating };
      } else {
        s.ratings[currentUser.id][dimensionId].rating = rating;
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
        s.ratings[currentUser.id][dimensionId] = { rating: 0, comment };
      } else {
        s.ratings[currentUser.id][dimensionId].comment = comment;
      }
    });
  };

  // Add action
  const handleAddAction = (linkedDimensionId?: string) => {
    if (!newActionText.trim()) return;

    const newAction: ActionItem = {
      id: Math.random().toString(36).substr(2, 9),
      text: newActionText.trim(),
      assigneeId: null,
      done: false,
      type: 'new',
      proposalVotes: {},
      linkedTicketId: linkedDimensionId
    };

    updateSession(s => {
      s.actions.push(newAction);
    });
    setNewActionText('');
  };

  // Render header
  const renderHeader = () => (
    <header className="h-14 bg-slate-900 border-b border-slate-700 flex items-center justify-between px-4 md:px-6 shrink-0 z-50">
      <div className="flex items-center space-x-4">
        {PHASES.map((phase, idx) => {
          const isActive = session.phase === phase;
          const isPast = PHASES.indexOf(session.phase) > idx;
          return (
            <button
              key={phase}
              disabled={!isFacilitator || (!isPast && !isActive)}
              onClick={() => isFacilitator && setPhase(phase)}
              className={`px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wide transition ${
                isActive
                  ? 'bg-cyan-500 text-white'
                  : isPast
                    ? 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                    : 'bg-slate-800 text-slate-500'
              }`}
            >
              {phase}
            </button>
          );
        })}
      </div>

      <div className="flex items-center space-x-4">
        <span className="text-slate-400 text-sm font-medium">
          {team.name} &gt; <span className="text-cyan-400">{session.name}</span>
        </span>
        <div className={`w-8 h-8 rounded-full ${currentUser.color} text-white flex items-center justify-center text-xs font-bold`}>
          {currentUser.name.substring(0, 2).toUpperCase()}
        </div>
        {isFacilitator && (
          <button
            onClick={() => setShowInvite(true)}
            className="bg-cyan-600 text-white px-3 py-1.5 rounded font-bold text-xs hover:bg-cyan-700"
          >
            INVITE TEAM
          </button>
        )}
      </div>
    </header>
  );

  // Render Survey Phase
  const renderSurvey = () => {
    const myRatings = session.ratings[currentUser.id] || {};

    return (
      <div className="flex flex-col h-full bg-slate-900">
        <div className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex justify-between items-center">
          <div>
            <span className="font-bold text-white text-lg">Rate each health dimension</span>
            <span className="text-slate-400 text-sm ml-4">
              {getFinishedCount()} participants finished
            </span>
          </div>
          {isFacilitator && (
            <button
              onClick={() => setPhase('DISCUSS')}
              className="bg-cyan-500 text-white px-4 py-2 rounded font-bold text-sm hover:bg-cyan-600"
            >
              Next Phase
            </button>
          )}
        </div>

        <div className="flex-grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-6">
              <p className="text-slate-400 text-center">
                Your ratings are {session.settings.isAnonymous ? 'anonymous' : 'visible to the team'}
              </p>
            </div>

            <div className="space-y-6">
              {session.dimensions.map((dimension) => {
                const myRating = myRatings[dimension.id]?.rating;
                const myComment = myRatings[dimension.id]?.comment || '';

                return (
                  <div key={dimension.id} className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                    <h3 className="text-xl font-bold text-white mb-2">{dimension.name}</h3>
                    <div className="grid md:grid-cols-2 gap-4 mb-4 text-sm">
                      <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg p-3">
                        <span className="text-emerald-400 font-bold">Good:</span>
                        <span className="text-slate-300 ml-2">{dimension.goodDescription}</span>
                      </div>
                      <div className="bg-rose-900/30 border border-rose-700/50 rounded-lg p-3">
                        <span className="text-rose-400 font-bold">Bad:</span>
                        <span className="text-slate-300 ml-2">{dimension.badDescription}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-center space-x-2 mb-4">
                      {[1, 2, 3, 4, 5].map(rating => (
                        <button
                          key={rating}
                          onClick={() => handleRating(dimension.id, rating)}
                          className={`w-12 h-12 rounded-full font-bold text-lg transition ${
                            myRating === rating
                              ? rating >= 4 ? 'bg-emerald-500 text-white scale-110'
                                : rating >= 3 ? 'bg-yellow-500 text-white scale-110'
                                : 'bg-rose-500 text-white scale-110'
                              : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                          }`}
                        >
                          {rating}
                        </button>
                      ))}
                    </div>

                    <div className="flex justify-between text-xs text-slate-500 px-4 mb-4">
                      <span>STRONGLY DISAGREE</span>
                      <span>DISAGREE</span>
                      <span>NEUTRAL</span>
                      <span>AGREE</span>
                      <span>STRONGLY AGREE</span>
                    </div>

                    <div className="relative">
                      <textarea
                        placeholder="Additional comments..."
                        value={myComment}
                        onChange={(e) => handleComment(dimension.id, e.target.value)}
                        className="w-full bg-slate-700 border border-slate-600 rounded-lg p-3 text-slate-300 text-sm resize-none h-20 focus:outline-none focus:border-cyan-500"
                      />
                      {myRating && (
                        <span className="absolute bottom-3 right-3 text-emerald-400 text-xs">
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
    const sortedDimensions = [...session.dimensions].sort((a, b) => {
      const statsA = getDimensionStats(a.id);
      const statsB = getDimensionStats(b.id);
      return statsA.average - statsB.average; // Lowest scores first
    });

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
      <div className="flex flex-col h-full bg-slate-900">
        <div className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex justify-between items-center">
          <span className="font-bold text-white text-lg">Discuss survey results and identify actions</span>
          {isFacilitator && (
            <button
              onClick={() => setPhase('REVIEW')}
              className="bg-cyan-500 text-white px-4 py-2 rounded font-bold text-sm hover:bg-cyan-600"
            >
              Next Phase
            </button>
          )}
        </div>

        <div className="flex-grow overflow-auto p-6">
          <div className="max-w-5xl mx-auto">
            {/* Radar Chart */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 mb-6">
              <div className="flex justify-center">
                <svg width="400" height="400" viewBox="0 0 400 400">
                  {/* Grid circles */}
                  {[1, 2, 3, 4, 5].map(level => (
                    <circle
                      key={level}
                      cx={centerX}
                      cy={centerY}
                      r={(level / 5) * maxRadius}
                      fill="none"
                      stroke="#475569"
                      strokeWidth="1"
                      strokeDasharray={level < 5 ? "4,4" : "none"}
                    />
                  ))}
                  {/* Grid lines */}
                  {dimensions.map((_, i) => {
                    const point = getPoint(i, 5);
                    return (
                      <line
                        key={i}
                        x1={centerX}
                        y1={centerY}
                        x2={point.x}
                        y2={point.y}
                        stroke="#475569"
                        strokeWidth="1"
                      />
                    );
                  })}
                  {/* Average polygon */}
                  <path
                    d={averagePathD}
                    fill="rgba(6, 182, 212, 0.3)"
                    stroke="#06b6d4"
                    strokeWidth="2"
                  />
                  {/* Points */}
                  {averagePoints.map((point, i) => (
                    <circle
                      key={i}
                      cx={point.x}
                      cy={point.y}
                      r="6"
                      fill="#06b6d4"
                    />
                  ))}
                  {/* Labels */}
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
                          className="fill-slate-300 text-xs font-medium"
                        >
                          {d.name.length > 15 ? d.name.substring(0, 15) + '...' : d.name}
                        </text>
                        <text
                          x={labelPoint.x}
                          y={labelPoint.y + 14}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          className="fill-cyan-400 text-xs font-bold"
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
              {sortedDimensions.map((dimension) => {
                const stats = getDimensionStats(dimension.id);
                const isActive = activeDiscussDimension === dimension.id;
                const actionsForDimension = session.actions.filter(a => a.linkedTicketId === dimension.id);

                return (
                  <div
                    key={dimension.id}
                    ref={(el) => { discussRefs.current[dimension.id] = el; }}
                    className={`bg-slate-800 border-2 rounded-xl transition ${
                      isActive ? 'border-cyan-500 ring-4 ring-cyan-500/20' : 'border-slate-700'
                    }`}
                  >
                    <div
                      className={`p-4 flex items-start cursor-pointer ${isFacilitator ? '' : 'cursor-default'}`}
                      onClick={() => {
                        if (!isFacilitator) return;
                        updateSession(s => {
                          s.discussionFocusId = s.discussionFocusId === dimension.id ? null : dimension.id;
                        });
                      }}
                    >
                      <div className={`w-16 h-16 rounded-xl ${getScoreBgColor(stats.average)} flex items-center justify-center mr-4 shrink-0`}>
                        <span className={`text-2xl font-black ${stats.average >= 4 ? 'text-emerald-600' : stats.average >= 3 ? 'text-yellow-600' : 'text-rose-600'}`}>
                          {stats.average.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex-grow">
                        <h3 className="text-lg font-bold text-white mb-1">{dimension.name}</h3>
                        <p className="text-slate-400 text-sm mb-2">
                          <span className="text-emerald-400">Good:</span> {dimension.goodDescription.substring(0, 80)}...
                        </p>
                        <p className="text-slate-400 text-sm">
                          <span className="text-rose-400">Bad:</span> {dimension.badDescription.substring(0, 80)}...
                        </p>
                      </div>
                      <div className="flex flex-col items-end">
                        {stats.comments.length > 0 && (
                          <span className="text-slate-400 text-xs mb-2">
                            {stats.comments.length} comment{stats.comments.length > 1 ? 's' : ''}
                          </span>
                        )}
                        <span className="material-symbols-outlined text-slate-500">
                          {isActive ? 'expand_less' : 'expand_more'}
                        </span>
                      </div>
                    </div>

                    {isActive && (
                      <div className="border-t border-slate-700 p-4 bg-slate-800/50">
                        {/* Distribution */}
                        <div className="mb-4">
                          <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Distribution</h4>
                          <div className="flex items-end space-x-2 h-20">
                            {stats.distribution.map((count, i) => {
                              const rating = i + 1;
                              const height = stats.count > 0 ? (count / stats.count) * 100 : 0;
                              return (
                                <div key={rating} className="flex flex-col items-center flex-1">
                                  <span className="text-xs text-slate-400 mb-1">{count}</span>
                                  <div
                                    className={`w-full rounded-t ${rating >= 4 ? 'bg-emerald-500' : rating >= 3 ? 'bg-yellow-500' : 'bg-rose-500'}`}
                                    style={{ height: `${Math.max(height, 4)}%` }}
                                  />
                                  <span className={`mt-1 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                                    rating >= 4 ? 'bg-emerald-500/20 text-emerald-400' : rating >= 3 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-rose-500/20 text-rose-400'
                                  }`}>
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
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Survey Responses</h4>
                            <div className="space-y-2">
                              {stats.comments.map((c, idx) => {
                                const author = participants.find(p => p.id === c.userId);
                                const { displayName } = getMemberDisplay(author || { id: c.userId, name: 'Unknown', color: 'bg-slate-500', role: 'participant' });
                                return (
                                  <div key={idx} className="bg-slate-700 rounded-lg p-3 text-sm text-slate-300">
                                    {!session.settings.isAnonymous && (
                                      <span className="text-slate-400 text-xs mr-2">{displayName}:</span>
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
                          {actionsForDimension.length > 0 && (
                            <div className="space-y-2 mb-3">
                              {actionsForDimension.map(action => (
                                <div key={action.id} className="flex items-center bg-emerald-900/30 border border-emerald-700/50 rounded-lg p-3">
                                  <span className="material-symbols-outlined text-emerald-400 mr-2">check_circle</span>
                                  <span className="text-slate-300 text-sm">{action.text}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex">
                            <input
                              type="text"
                              placeholder="Add action..."
                              value={newActionText}
                              onChange={(e) => setNewActionText(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleAddAction(dimension.id)}
                              className="flex-grow bg-slate-700 border border-slate-600 rounded-l-lg p-2 text-slate-300 text-sm focus:outline-none focus:border-cyan-500"
                            />
                            <button
                              onClick={() => handleAddAction(dimension.id)}
                              className="bg-cyan-500 text-white px-4 rounded-r-lg font-bold text-sm hover:bg-cyan-600"
                            >
                              Add
                            </button>
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

    // Group actions by dimension
    const groupedActions: Record<string, ActionItem[]> = {};
    newActions.forEach(a => {
      const key = a.linkedTicketId || 'general';
      if (!groupedActions[key]) groupedActions[key] = [];
      groupedActions[key].push(a);
    });

    return (
      <div className="flex flex-col h-full bg-slate-900">
        <div className="bg-slate-800 border-b border-slate-700 px-6 py-3 flex justify-between items-center">
          <span className="font-bold text-white text-lg">Review Actions</span>
          {isFacilitator && (
            <button
              onClick={() => setPhase('CLOSE')}
              className="bg-cyan-500 text-white px-4 py-2 rounded font-bold text-sm hover:bg-cyan-600"
            >
              Next: Close
            </button>
          )}
        </div>

        <div className="flex-grow overflow-auto p-6">
          <div className="max-w-3xl mx-auto">
            <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              <div className="bg-slate-700/50 px-4 py-3 border-b border-slate-700">
                <span className="font-bold text-white">Actions from this session ({newActions.length})</span>
              </div>

              {newActions.length === 0 ? (
                <div className="p-8 text-center text-slate-400">
                  No actions created yet.
                </div>
              ) : (
                Object.entries(groupedActions).map(([key, actions]) => {
                  const dimension = session.dimensions.find(d => d.id === key);
                  return (
                    <div key={key} className="border-b border-slate-700 last:border-0">
                      <div className="bg-slate-700/30 px-4 py-2">
                        <span className="text-sm font-bold text-slate-400">
                          {dimension ? dimension.name : 'General'}
                        </span>
                      </div>
                      {actions.map(action => (
                        <div key={action.id} className="px-4 py-3 flex items-center hover:bg-slate-700/30">
                          <button
                            onClick={() => {
                              if (!isFacilitator) return;
                              updateSession(s => {
                                const a = s.actions.find(x => x.id === action.id);
                                if (a) a.done = !a.done;
                              });
                            }}
                            className={`mr-3 ${action.done ? 'text-emerald-400' : 'text-slate-500 hover:text-emerald-400'}`}
                          >
                            <span className="material-symbols-outlined">
                              {action.done ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                          </button>
                          <span className={`flex-grow text-slate-300 ${action.done ? 'line-through opacity-60' : ''}`}>
                            {action.text}
                          </span>
                          <select
                            value={action.assigneeId || ''}
                            disabled={!isFacilitator}
                            onChange={(e) => {
                              updateSession(s => {
                                const a = s.actions.find(x => x.id === action.id);
                                if (a) a.assigneeId = e.target.value || null;
                              });
                            }}
                            className="text-xs bg-slate-700 border border-slate-600 rounded p-1.5 text-slate-300"
                          >
                            <option value="">Unassigned</option>
                            {participants.map(m => (
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
      <div className="flex flex-col items-center justify-center h-full p-8 bg-slate-900">
        <h1 className="text-3xl font-bold text-white mb-2">Health Check Complete</h1>
        <p className="text-slate-400 mb-8">Thank you for your contribution!</p>

        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700 max-w-lg w-full text-center">
          <h3 className="text-xl font-bold text-white mb-6">ROTI (Return on Time Invested)</h3>
          <div className="flex justify-center space-x-2 mb-8">
            {[1, 2, 3, 4, 5].map(score => (
              <button
                key={score}
                onClick={() => updateSession(s => { s.roti[currentUser.id] = score; })}
                className={`w-10 h-10 rounded-full font-bold transition ${
                  myRoti === score
                    ? 'bg-cyan-500 text-white scale-110'
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
                  className="text-cyan-400 hover:text-white font-bold underline"
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
                      className="w-8 bg-cyan-500 rounded-t relative transition-all duration-500"
                      style={{ height: count > 0 ? `${(count / maxVal) * 100}%` : '4px', opacity: count > 0 ? 1 : 0.2 }}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-center space-x-3 text-xs text-slate-500 border-t border-slate-700 pt-1">
                {[1, 2, 3, 4, 5].map(i => <div key={i} className="w-8">{i}</div>)}
              </div>
              <div className="mt-4 text-2xl font-black text-cyan-400">{average} / 5</div>
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

  // Render participants panel
  const renderParticipantsPanel = () => (
    <div className="w-64 bg-slate-800 border-l border-slate-700 flex flex-col shrink-0 hidden lg:flex">
      <div className="p-4 border-b border-slate-700">
        <h3 className="text-sm font-bold text-white flex items-center">
          {team.name}
        </h3>
      </div>

      <div className="p-3 border-b border-slate-700">
        <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Facilitator</h4>
        {participants.filter(p => p.role === 'facilitator').map(member => {
          const { displayName, initials } = getMemberDisplay(member);
          return (
            <div key={member.id} className="flex items-center p-2">
              <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold mr-2`}>
                {initials}
              </div>
              <span className="text-sm text-slate-300">{displayName}</span>
            </div>
          );
        })}
      </div>

      <div className="flex-grow overflow-y-auto p-3">
        <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Participants ({participants.filter(p => p.role !== 'facilitator').length})</h4>
        {participants.filter(p => p.role !== 'facilitator').map(member => {
          const { displayName, initials } = getMemberDisplay(member);
          const isOnline = connectedUsers.has(member.id);
          const hasCompleted = session.phase === 'SURVEY' && (() => {
            const userRatings = session.ratings[member.id] || {};
            return session.dimensions.every(d => userRatings[d.id]?.rating != null);
          })();
          const hasRotiVote = session.phase === 'CLOSE' && Boolean(session.roti[member.id]);

          return (
            <div key={member.id} className="flex items-center p-2 rounded-lg hover:bg-slate-700/50">
              <div className="relative mr-2">
                <div className={`w-8 h-8 rounded-full ${member.color} text-white flex items-center justify-center text-xs font-bold`}>
                  {initials}
                </div>
                {isOnline && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 rounded-full border-2 border-slate-800" />
                )}
              </div>
              <span className="text-sm text-slate-300 flex-grow truncate">{displayName}</span>
              {(hasCompleted || hasRotiVote) && (
                <span className="material-symbols-outlined text-emerald-400 text-lg">check_circle</span>
              )}
            </div>
          );
        })}
      </div>

      <div className="p-3 border-t border-slate-700">
        <button
          onClick={() => setShowInvite(true)}
          className="w-full bg-cyan-600 text-white py-2 rounded-lg font-bold text-sm hover:bg-cyan-700"
        >
          INVITE TEAM
        </button>
      </div>
    </div>
  );

  // Render invite modal
  const renderInviteModal = () => {
    if (!showInvite) return null;

    const inviteData = {
      id: team.id,
      name: team.name,
      password: team.passwordHash,
      healthCheckSessionId: session.id,
      healthCheckSession: session
    };

    const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
    const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
        <div className="bg-slate-800 rounded-2xl shadow-2xl p-6 max-w-md w-full border border-slate-700">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xl font-bold text-white">Invite Team</h3>
            <button onClick={() => setShowInvite(false)} className="text-slate-400 hover:text-white">
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="text-center mb-4">
            <p className="text-slate-400 text-sm">Share this link or QR code</p>
          </div>

          <div className="flex justify-center mb-4">
            <div className="p-4 bg-white rounded-xl">
              <img src={qrUrl} alt="QR Code" className="w-48 h-48" />
            </div>
          </div>

          <div className="bg-slate-700 p-3 rounded-lg flex items-center justify-between mb-4">
            <code className="text-xs text-slate-300 truncate mr-2">{link}</code>
            <button
              onClick={() => navigator.clipboard.writeText(link)}
              className="text-cyan-400 font-bold text-xs hover:text-cyan-300"
            >
              COPY
            </button>
          </div>

          <button
            onClick={() => setShowInvite(false)}
            className="w-full bg-cyan-600 text-white py-2 rounded-lg font-bold hover:bg-cyan-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {renderHeader()}
      {renderInviteModal()}

      <div className="flex-grow flex overflow-hidden">
        <div className="flex-grow overflow-hidden flex flex-col">
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
