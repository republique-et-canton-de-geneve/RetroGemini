import React, { useState, useEffect } from 'react';
import { Team, User } from './types';
import { dataService } from './services/dataService';
import TeamLogin from './components/TeamLogin';
import Dashboard from './components/Dashboard';
import Session from './components/Session';

const App: React.FC = () => {
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [view, setView] = useState<'LOGIN' | 'DASHBOARD' | 'SESSION'>('LOGIN');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Restore session if possible (Simple reload persistence)
  useEffect(() => {
    const savedTeamId = localStorage.getItem('retro_active_team');
    const savedUserId = localStorage.getItem('retro_active_user');
    if (savedTeamId) {
      const team = dataService.getTeam(savedTeamId);
      if (team) {
        setCurrentTeam(team);
        if (savedUserId) {
          const user = team.members.find(u => u.id === savedUserId);
          if (user) setCurrentUser(user);
        } else {
            setCurrentUser(team.members[0]); // Default to admin
        }
        setView('DASHBOARD');
      }
    }
  }, []);

  const handleLogin = (team: Team) => {
    setCurrentTeam(team);
    setCurrentUser(team.members[0]); // Default to facilitator on login
    localStorage.setItem('retro_active_team', team.id);
    localStorage.setItem('retro_active_user', team.members[0].id);
    setView('DASHBOARD');
  };

  const handleLogout = () => {
    setCurrentTeam(null);
    setCurrentUser(null);
    localStorage.removeItem('retro_active_team');
    localStorage.removeItem('retro_active_user');
    setView('LOGIN');
  };

  const handleOpenSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setView('SESSION');
  };

  if (!currentTeam) {
    return <TeamLogin onLogin={handleLogin} />;
  }

  // Common Header Logic
  const renderHeader = (isSession: boolean) => {
    if (!currentUser || !currentTeam) return null;
    return (
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shrink-0 z-50 shadow-sm">
            <div className="flex items-center cursor-pointer" onClick={() => setView('DASHBOARD')}>
                <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded flex items-center justify-center text-white font-bold mr-3 text-lg">R</div>
                <div className="font-bold text-slate-700 text-lg hidden md:block">RetroGemini <span className="text-slate-400 font-normal text-sm mx-2">/</span> {currentTeam.name}</div>
            </div>

            <div className="flex items-center space-x-4">
                <div className="flex items-center border-l pl-4 border-slate-200">
                    <div className="flex flex-col items-end mr-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase leading-none mb-1">User</span>
                        <div className="text-sm font-bold text-slate-700">{currentUser.name}</div>
                    </div>
                    <div className={`w-8 h-8 rounded-full ${currentUser.color} text-white flex items-center justify-center text-xs font-bold shadow-md ring-2 ring-white`}>
                        {currentUser.name.substring(0, 2).toUpperCase()}
                    </div>
                </div>
                {!isSession && (
                     <button onClick={handleLogout} className="ml-4 text-slate-400 hover:text-red-500" title="Logout Team">
                        <span className="material-symbols-outlined">logout</span>
                    </button>
                )}
            </div>
        </header>
    );
  };

  return (
    <div className="h-screen flex flex-col text-slate-700 overflow-hidden bg-slate-50">
        {view === 'DASHBOARD' && (
            <>
                {renderHeader(false)}
                <Dashboard 
                    team={currentTeam} 
                    currentUser={currentUser!} 
                    onOpenSession={handleOpenSession}
                    onRefresh={() => {
                        const updated = dataService.getTeam(currentTeam.id);
                        if(updated) setCurrentTeam(updated);
                    }}
                />
            </>
        )}
        {view === 'SESSION' && activeSessionId && (
            <Session 
                team={currentTeam}
                currentUser={currentUser!}
                sessionId={activeSessionId}
                onExit={() => {
                    // Refresh data before exiting
                    const updated = dataService.getTeam(currentTeam.id);
                    if(updated) setCurrentTeam(updated);
                    setView('DASHBOARD');
                }}
            />
        )}
    </div>
  );
};

export default App;