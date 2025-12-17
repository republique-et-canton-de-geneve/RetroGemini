
import React, { useState, useEffect } from 'react';
import { dataService } from '../services/dataService';
import { Team, User, RetroSession, ActionItem } from '../types';

export interface InviteData {
  id: string;
  name: string;
  password: string;
  sessionId?: string;
  session?: RetroSession;
  members?: User[];
  globalActions?: ActionItem[];
  retrospectives?: RetroSession[];
  memberId?: string;
  memberEmail?: string;
  memberName?: string;
  inviteToken?: string;
}

interface Props {
  onLogin: (team: Team) => void;
  onJoin?: (team: Team, user: User) => void;
  inviteData?: InviteData | null;
}

const TeamLogin: React.FC<Props> = ({ onLogin, onJoin, inviteData }) => {
  const [view, setView] = useState<'LIST' | 'CREATE' | 'LOGIN' | 'JOIN'>('LIST');
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  // Handle invitation link - auto-switch to JOIN view
  useEffect(() => {
    if (inviteData) {
      const team = dataService.importTeam(inviteData);
      setSelectedTeam(team);
      setView('JOIN');
    }
  }, [inviteData]);

  useEffect(() => {
      setTeams(dataService.getAllTeams());
  }, [view]);

  useEffect(() => {
    if (inviteData?.memberName) {
      setName(inviteData.memberName);
    }
  }, [inviteData]);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
        if(password.length < 4) throw new Error("Password must be at least 4 chars");
        const team = dataService.createTeam(name, password);
        onLogin(team);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if(!selectedTeam) return;
    try {
        const team = dataService.loginTeam(selectedTeam.name, password);
        onLogin(team);
    } catch (err: any) {
        setError(err.message);
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedTeam) return;
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    try {
      const { team, user } = dataService.joinTeamAsParticipant(
        selectedTeam.id,
        name.trim(),
        inviteData?.memberEmail,
        inviteData?.inviteToken
      );
      if (onJoin) {
        onJoin(team, user);
      } else {
        onLogin(team);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row h-[600px]">
        {/* Left Side: Branding */}
        <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-12 text-center md:text-left flex flex-col justify-center md:w-5/12 text-white relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
             <div className="z-10">
                <h1 className="text-4xl font-black mb-4 tracking-tighter">RetroGemini</h1>
                <p className="text-indigo-100 font-medium text-lg leading-relaxed">
                    Collaborative retrospectives that help your team grow, improve, and celebrate together.
                </p>
             </div>
        </div>
        
        {/* Right Side: Content */}
        <div className="p-8 md:p-12 flex-grow overflow-y-auto md:w-7/12 bg-slate-50 relative">
            
            {view === 'LIST' && (
                <div className="h-full flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">Your Teams</h2>
                        <button onClick={() => { setView('CREATE'); setName(''); setPassword(''); setError(''); }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 transition shadow">
                            + New Team
                        </button>
                    </div>
                    
                    {teams.length === 0 ? (
                        <div className="flex-grow flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                            <span className="material-symbols-outlined text-4xl mb-2">groups</span>
                            <p>No teams found. Create one to get started!</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 pb-4">
                            {teams.map(team => (
                                <button 
                                    key={team.id}
                                    onClick={() => { setSelectedTeam(team); setView('LOGIN'); setError(''); setPassword(''); }}
                                    className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-500 hover:ring-1 hover:ring-indigo-500 transition text-left flex items-center group"
                                >
                                    <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold mr-4 group-hover:bg-indigo-600 group-hover:text-white transition">
                                        {team.name.substring(0,2).toUpperCase()}
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-800">{team.name}</div>
                                        <div className="text-xs text-slate-500">{team.members.length} members</div>
                                    </div>
                                    <span className="material-symbols-outlined ml-auto text-slate-300 group-hover:text-indigo-500">arrow_forward</span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {view === 'CREATE' && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LIST')} className="absolute top-8 left-8 text-slate-400 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> Back
                    </button>
                    <h2 className="text-2xl font-bold text-slate-800 mb-6 text-center">Create New Team</h2>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Team Name</label>
                            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="e.g. Design Team" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Create Password</label>
                            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="••••••••" />
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">Create & Join</button>
                    </form>
                </div>
            )}

            {view === 'LOGIN' && selectedTeam && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LIST')} className="absolute top-8 left-8 text-slate-400 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> Back
                    </button>
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">Login to {selectedTeam.name}</h2>
                        <p className="text-slate-500 text-sm">Enter the team password to continue.</p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Password</label>
                            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="••••••••" />
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">Enter Workspace</button>
                    </form>
                </div>
            )}

            {view === 'JOIN' && selectedTeam && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-2xl mx-auto mb-4">
                            {selectedTeam.name.substring(0,2).toUpperCase()}
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800">Join {selectedTeam.name}</h2>
                        <p className="text-slate-500 text-sm mt-2">You've been invited to join this team. Enter your name to continue.</p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
                    <form onSubmit={handleJoin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Your Name</label>
                            <input
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder="e.g. John Doe"
                                autoFocus
                            />
                        </div>
                        {inviteData?.memberEmail && (
                          <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded p-2">
                            Joining as <strong>{inviteData.memberEmail}</strong>
                          </div>
                        )}
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">
                            Join Team
                        </button>
                    </form>
                    <p className="text-xs text-slate-400 text-center mt-4">
                        You will join as a participant
                    </p>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

export default TeamLogin;
