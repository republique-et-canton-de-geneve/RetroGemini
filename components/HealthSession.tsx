import React, { useEffect, useMemo, useState } from 'react';
import { dataService } from '../services/dataService';
import {
  HealthCheckModel,
  HealthCheckSession,
  HealthDimensionRating,
  Team,
  User,
} from '../types';
import InviteModal from './InviteModal';

interface Props {
  team: Team;
  currentUser: User;
  healthCheckId: string;
  onExit: () => void;
  onTeamUpdate?: (team: Team) => void;
}

const phaseOrder: HealthCheckSession['phase'][] = ['SURVEY', 'DISCUSS', 'REVIEW', 'CLOSED'];

const HealthSession: React.FC<Props> = ({ team, currentUser, healthCheckId, onExit, onTeamUpdate }) => {
  const [session, setSession] = useState<HealthCheckSession | undefined>(
    team.healthChecks?.find(h => h.id === healthCheckId)
  );
  const [ratings, setRatings] = useState<Record<string, HealthDimensionRating>>({});
  const [alias, setAlias] = useState('');
  const [showInvite, setShowInvite] = useState(false);
  const [newAction, setNewAction] = useState('');
  const [assigneeId, setAssigneeId] = useState('');

  const isFacilitator = currentUser.role === 'facilitator';

  const healthModels = useMemo(() => dataService.getHealthModels(team.id), [team.id]);
  const model: HealthCheckModel | undefined = useMemo(
    () => healthModels.find(m => m.id === session?.modelId),
    [healthModels, session?.modelId]
  );

  const refreshSession = () => {
    const updatedTeam = dataService.getTeam(team.id);
    if (!updatedTeam) return;
    const updatedSession = updatedTeam.healthChecks?.find(h => h.id === healthCheckId);
    setSession(updatedSession);
    if (onTeamUpdate) onTeamUpdate(updatedTeam);
  };

  useEffect(() => {
    const updated = team.healthChecks?.find(h => h.id === healthCheckId);
    setSession(updated);
  }, [team, healthCheckId]);

  useEffect(() => {
    if (!session) return;
    const existing = session.responses.find(r => r.userId === currentUser.id);
    if (existing) {
      setRatings(existing.ratings);
      setAlias(existing.anonymousName || '');
    } else {
      setRatings({});
      setAlias('');
    }
  }, [session, currentUser.id]);

  if (!session || !model) {
    return (
      <div className="h-screen flex flex-col">
        <div className="flex items-center justify-between p-4 border-b bg-white">
          <div className="flex items-center gap-3">
            <button onClick={onExit} className="text-slate-500 hover:text-retro-primary">
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <div>
              <p className="text-xs text-slate-500 uppercase font-bold">Health check</p>
              <p className="text-sm text-slate-700">Not found</p>
            </div>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center text-slate-500">This health check could not be loaded.</div>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (session.phase !== 'SURVEY') return;
    dataService.submitHealthResponse(team.id, session.id, currentUser.id, ratings, alias || undefined);
    refreshSession();
  };

  const handleAdvance = () => {
    if (!isFacilitator) return;
    dataService.advanceHealthPhase(team.id, session.id);
    refreshSession();
  };

  const averageScore = (dimensionId: string) => {
    if (!session.responses.length) return '–';
    const scores = session.responses
      .map(r => r.ratings[dimensionId]?.score)
      .filter((s): s is number => typeof s === 'number');
    if (!scores.length) return '–';
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return avg.toFixed(1);
  };

  const overallAverage = () => {
    if (!session.responses.length) return '–';
    const scores = session.responses
      .flatMap(r => Object.values(r.ratings).map(val => val.score))
      .filter((s): s is number => typeof s === 'number');
    if (!scores.length) return '–';
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return avg.toFixed(1);
  };

  const handleCreateAction = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAction.trim()) return;
    dataService.addGlobalAction(team.id, newAction.trim(), assigneeId || null);
    setNewAction('');
    setAssigneeId('');
    refreshSession();
  };

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-700">
      <div className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6">
        <div className="flex items-center gap-3">
          <button onClick={onExit} className="text-slate-500 hover:text-retro-primary">
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 font-bold">Health check</p>
            <p className="text-lg font-bold text-slate-800">{session.name}</p>
            <p className="text-[11px] text-slate-500">Model: {model.name}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isFacilitator && (
            <button
              onClick={() => setShowInvite(true)}
              className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold text-slate-700 hover:border-retro-primary"
            >
              Invite participants
            </button>
          )}
          <span className={`px-3 py-1 rounded-full text-xs font-bold ${session.phase === 'CLOSED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
            {session.phase}
          </span>
          {isFacilitator && session.phase !== 'CLOSED' && (
            <button
              onClick={handleAdvance}
              className="px-4 py-2 rounded-lg bg-retro-primary text-white font-bold hover:bg-retro-primaryHover"
            >
              Advance phase
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {phaseOrder.map(p => (
            <div key={p} className={`p-3 rounded-lg border text-sm font-bold ${session.phase === p ? 'border-retro-primary bg-white' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>
              {p}
            </div>
          ))}
          <div className="p-3 rounded-lg border border-slate-200 bg-white">
            <p className="text-xs uppercase tracking-wide text-slate-500 font-bold">Overall score</p>
            <p className="text-2xl font-bold text-retro-primary">{overallAverage()}</p>
            <p className="text-xs text-slate-500">Based on submitted surveys</p>
          </div>
        </div>

        {session.phase === 'SURVEY' && (
          <form onSubmit={handleSubmit} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm uppercase tracking-wide text-slate-500 font-bold">Your ratings</h3>
              <span className="text-xs text-slate-500">Phase: {session.phase}</span>
            </div>
            {model.dimensions.map(dim => (
              <div key={dim.id} className="border border-slate-100 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="font-bold text-slate-800">{dim.title}</p>
                    <p className="text-[11px] text-slate-500">{dim.good}</p>
                  </div>
                  <select
                    value={ratings[dim.id]?.score || ''}
                    onChange={(e) => setRatings({ ...ratings, [dim.id]: { score: Number(e.target.value), comment: ratings[dim.id]?.comment } })}
                    className="border border-slate-300 rounded px-2 py-1 text-sm"
                  >
                    <option value="">–</option>
                    {[1,2,3,4,5].map(score => (
                      <option key={score} value={score}>{score}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  placeholder="Comment (optional)"
                  value={ratings[dim.id]?.comment || ''}
                  onChange={(e) => setRatings({ ...ratings, [dim.id]: { score: ratings[dim.id]?.score || 0, comment: e.target.value } })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
                />
              </div>
            ))}
            {session.isAnonymous && (
              <input
                type="text"
                placeholder="Optional alias for anonymity"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 focus:border-retro-primary focus:ring-1 focus:ring-indigo-100"
              />
            )}
            <button
              type="submit"
              className="w-full bg-retro-primary text-white font-bold rounded-lg py-2 hover:bg-retro-primaryHover"
            >
              Submit ratings
            </button>
            {!isFacilitator && <p className="text-xs text-slate-500">Only the facilitator can advance to the next phase.</p>}
          </form>
        )}

        {session.phase === 'DISCUSS' && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm uppercase tracking-wide text-slate-500 font-bold">Discussion overview</h3>
              <span className="text-xs text-slate-500">Facilitator controls progression</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {model.dimensions.map(dim => (
                <div key={dim.id} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-bold text-slate-800">{dim.title}</p>
                      <p className="text-[11px] text-slate-500">{dim.good}</p>
                    </div>
                    <div className="text-retro-primary font-bold text-lg">{averageScore(dim.id)}</div>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{dim.bad}</p>
                  <div className="mt-2 space-y-1">
                    {session.responses
                      .map(r => ({
                        name: session.isAnonymous ? (r.anonymousName || 'Anonymous') : (team.members.find(m => m.id === r.userId)?.name || 'Participant'),
                        comment: r.ratings[dim.id]?.comment,
                      }))
                      .filter(r => r.comment)
                      .map((r, idx) => (
                        <div key={idx} className="text-sm text-slate-600 bg-slate-50 border border-slate-100 rounded px-2 py-1">
                          <span className="font-semibold">{r.name}:</span> {r.comment}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {session.phase === 'REVIEW' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm uppercase tracking-wide text-slate-500 font-bold mb-3">Open actions</h3>
              {team.globalActions.length === 0 ? (
                <p className="text-sm text-slate-500">No actions yet. Use the form to add follow-ups from this health check.</p>
              ) : (
                <div className="space-y-2">
                  {team.globalActions.filter(a => !a.done).map(action => (
                    <div key={action.id} className="p-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800">{action.text}</p>
                        {action.assigneeId && (
                          <p className="text-xs text-slate-500">Owner: {team.members.find(m => m.id === action.assigneeId)?.name || 'Unassigned'}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <form onSubmit={handleCreateAction} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
              <h3 className="text-sm uppercase tracking-wide text-slate-500 font-bold">Add action</h3>
              <textarea
                className="w-full border border-slate-300 rounded-lg p-3 text-sm bg-white text-slate-900"
                placeholder="Follow-up action"
                value={newAction}
                onChange={(e) => setNewAction(e.target.value)}
              />
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Unassigned</option>
                {team.members.map(member => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
              <button type="submit" className="w-full bg-retro-primary text-white font-bold rounded-lg py-2 hover:bg-retro-primaryHover">
                Create action
              </button>
            </form>
          </div>
        )}

        {session.phase === 'CLOSED' && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-center space-y-2">
            <h3 className="text-lg font-bold text-slate-800">Health check closed</h3>
            <p className="text-sm text-slate-500">Review the action items and schedule the next survey from the dashboard.</p>
          </div>
        )}
      </div>

      {showInvite && (
        <InviteModal
          team={team}
          activeHealthSession={session}
          onClose={() => setShowInvite(false)}
          onLogout={currentUser.role === 'participant' ? onExit : undefined}
        />
      )}
    </div>
  );
};

export default HealthSession;
