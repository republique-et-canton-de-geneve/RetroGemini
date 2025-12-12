import React, { useState, useEffect } from 'react';
import { Team, User } from './types';
import { dataService } from './services/dataService';
import TeamLogin, { InviteData } from './components/TeamLogin';
import Dashboard from './components/Dashboard';
import Session from './components/Session';

const App: React.FC = () => {
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [view, setView] = useState<'LOGIN' | 'DASHBOARD' | 'SESSION'>('LOGIN');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    dataService.hydrateFromServer().finally(() => setHydrated(true));
  }, []);

  // Check for invitation link on mount - PRIORITY over localStorage
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get('join');
    if (joinParam) {
      try {
        // Decode UTF-8 encoded base64 string
        const decoded = JSON.parse(decodeURIComponent(escape(atob(joinParam))));
        if (decoded.id && decoded.name && decoded.password) {
          // Clear any existing session to force the invitation flow
          localStorage.removeItem('retro_active_team');
          localStorage.removeItem('retro_active_user');
          setCurrentTeam(null);
          setCurrentUser(null);
          setInviteData(decoded);
          // Store session ID to open after join
          if (decoded.session?.id) {
            setPendingSessionId(decoded.session.id);
          }
          // Clean the URL without reloading
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (e) {
        console.error('Invalid invitation link');
      }
    }
  }, []);

  const openActiveSessionIfParticipant = (team: Team, fallbackSessionId?: string | null) => {
    // If user is a participant, automatically join the active retrospective
    // Prefer the invited session when provided
    const active = fallbackSessionId
      ? team.retrospectives.find(r => r.id === fallbackSessionId)
      : team.retrospectives.find(r => r.status === 'IN_PROGRESS');

    if (active) {
      setActiveSessionId(active.id);
      setView('SESSION');
      return true;
    }

    return false;
  };

  // Restore session if possible (Simple reload persistence)
  useEffect(() => {
    // Don't restore session if we have an invite link
    if (inviteData || !hydrated) return;

    const savedTeamId = localStorage.getItem('retro_active_team');
    const savedUserId = localStorage.getItem('retro_active_user');
    if (savedTeamId) {
      const team = dataService.getTeam(savedTeamId);
      if (team) {
        setCurrentTeam(team);
        let user: User | undefined;
        if (savedUserId) {
          user = team.members.find(u => u.id === savedUserId);
        }
        const resolvedUser = user ?? team.members[0]; // Default to admin
        setCurrentUser(resolvedUser);

        // Participants resume directly into the active session when available
        const opened = resolvedUser.role === 'participant'
          ? openActiveSessionIfParticipant(team, pendingSessionId)
          : false;

        if (!opened) {
          if (resolvedUser.role === 'participant') {
            const fallbackActive = pendingSessionId
              ? team.retrospectives.find(r => r.id === pendingSessionId)
              : team.retrospectives.find(r => r.status === 'IN_PROGRESS');

            if (fallbackActive) {
              setActiveSessionId(fallbackActive.id);
              setView('SESSION');
            } else {
              setView('LOGIN');
            }
          } else {
            setView('DASHBOARD');
          }
        }
      }
    }
  }, [inviteData, hydrated]);

  const handleLogin = (team: Team) => {
    setCurrentTeam(team);
    setCurrentUser(team.members[0]); // Default to facilitator on login
    localStorage.setItem('retro_active_team', team.id);
    localStorage.setItem('retro_active_user', team.members[0].id);
    setInviteData(null);
    setView('DASHBOARD');
  };

  const handleJoin = (team: Team, user: User) => {
    setCurrentTeam(team);
    setCurrentUser(user);
    localStorage.setItem('retro_active_team', team.id);
    localStorage.setItem('retro_active_user', user.id);

    const opened = openActiveSessionIfParticipant(team, pendingSessionId);

    // Clear invitation specific state once we've attempted to open a session
    setPendingSessionId(null);
    setInviteData(null);

    if (!opened) {
      if (user.role === 'participant') {
        const fallbackActive = pendingSessionId
          ? team.retrospectives.find(r => r.id === pendingSessionId)
          : team.retrospectives[0];
        if (fallbackActive) {
          setActiveSessionId(fallbackActive.id);
          setView('SESSION');
        } else {
          setView('LOGIN');
        }
      } else {
        setView('DASHBOARD');
      }
    }
  };

  const handleLogout = () => {
    setCurrentTeam(null);
    setCurrentUser(null);
    localStorage.removeItem('retro_active_team');
    localStorage.removeItem('retro_active_user');
    setView('LOGIN');
  };

  const handleOpenSession = (sessionId: string) => {
    if (currentUser?.role === 'participant') return;
    setActiveSessionId(sessionId);
    setView('SESSION');
  };

  if (!hydrated) {
    return <div className="h-screen flex items-center justify-center text-slate-500">Loading workspace…</div>;
  }

  if (!currentTeam) {
    return <TeamLogin onLogin={handleLogin} onJoin={handleJoin} inviteData={inviteData} />;
  }

  // Common Header Logic
  const renderHeader = (isSession: boolean) => {
    if (!currentUser || !currentTeam) return null;
    return (
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 shrink-0 z-50 shadow-sm">
            <div
              className={`flex items-center ${currentUser.role === 'participant' ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
              onClick={() => currentUser.role !== 'participant' && setView('DASHBOARD')}
            >
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
                    onDeleteTeam={handleLogout}
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

                    if (currentUser?.role === 'participant') {
                      handleLogout();
                      return;
                    }

                    setView('DASHBOARD');
                }}
            />
        )}
    </div>
  );
};

export default App;