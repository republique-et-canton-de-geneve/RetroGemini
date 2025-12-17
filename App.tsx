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

  const STORAGE_KEY = 'retro-open-session';
  const SESSION_PATH_REGEX = /^\/session\/([^/]+)/;

  useEffect(() => {
    dataService.hydrateFromServer().finally(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || currentTeam) return;

    // If the URL contains an invite payload, skip restoring local session state.
    const params = new URLSearchParams(window.location.search);
    if (params.has('join')) return;

    try {
      const pathMatch = window.location.pathname.match(SESSION_PATH_REGEX);
      const sessionFromPath = pathMatch?.[1] || null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const team = dataService.getTeam(saved.teamId);
      if (!team) return;

      let user = team.members.find(m => m.id === saved.userId) || team.members.find(m => m.email && m.email === saved.userEmail);
      if (!user && saved.userName) {
        const participants = team.retrospectives.flatMap(r => r.participants || []);
        const found = participants.find(p => p.id === saved.userId || p.name === saved.userName);
        if (found) {
          dataService.persistParticipants(team.id, [found]);
          user = found;
        }
      }

      if (!user) return;

      setCurrentTeam(team);
      setCurrentUser(user);
      if (sessionFromPath) {
        const sessionExists = team.retrospectives.some(r => r.id === sessionFromPath);
        if (sessionExists) {
          setActiveSessionId(sessionFromPath);
          setView('SESSION');
          return;
        } else {
          window.history.replaceState({}, document.title, '/');
        }
      } else if (saved.view === 'SESSION' && saved.activeSessionId) {
        setView('DASHBOARD');
        setActiveSessionId(null);
        return;
      }

      setView(saved.view || 'DASHBOARD');
    } catch (err) {
      console.warn('Unable to restore previous session', err);
    }
  }, [hydrated, currentTeam]);

  useEffect(() => {
    if (!currentTeam || !currentUser) {
      if (hydrated) {
        localStorage.removeItem(STORAGE_KEY);
      }
      return;
    }

    const payload = {
      teamId: currentTeam.id,
      userId: currentUser.id,
      userEmail: currentUser.email,
      userName: currentUser.name,
      view,
      activeSessionId,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [currentTeam, currentUser, view, activeSessionId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;

    if (view === 'SESSION' && activeSessionId) {
      const sessionPath = `/session/${activeSessionId}`;
      if (window.location.pathname !== sessionPath) {
        window.history.replaceState({}, document.title, sessionPath);
      }
    } else if (window.location.pathname !== '/') {
      window.history.replaceState({}, document.title, '/');
    }
  }, [view, activeSessionId, hydrated]);

  // Participants should never remain on the dashboard; force them into a session or log them out.
  useEffect(() => {
    if (!hydrated || !currentTeam || !currentUser) return;
    if (currentUser.role !== 'participant') return;
    if (view !== 'DASHBOARD') return;

    const targetSession =
      (activeSessionId && currentTeam.retrospectives.find(r => r.id === activeSessionId)) ||
      currentTeam.retrospectives.find(r => r.status === 'IN_PROGRESS') ||
      currentTeam.retrospectives[0];

    if (targetSession) {
      setActiveSessionId(targetSession.id);
      setView('SESSION');
      return;
    }

    handleLogout();
  }, [hydrated, currentTeam, currentUser, view, activeSessionId]);

  // Check for invitation link on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get('join');
    if (joinParam) {
      try {
        // Decode UTF-8 encoded base64 string
        const decoded = JSON.parse(decodeURIComponent(escape(atob(joinParam))));
        if (decoded.id && decoded.name && decoded.password) {
          setCurrentTeam(null);
          setCurrentUser(null);
          setInviteData(decoded);
          // Store session ID to open after join
          if (decoded.sessionId || decoded.session?.id) {
            setPendingSessionId(decoded.sessionId || decoded.session?.id || null);
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

  const handleLogin = (team: Team) => {
    setCurrentTeam(team);
    setCurrentUser(team.members[0]); // Default to facilitator on login
    setInviteData(null);
    setView('DASHBOARD');
  };

  const handleJoin = (team: Team, user: User) => {
    setCurrentTeam(team);
    setCurrentUser(user);

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
    setView('LOGIN');
    localStorage.removeItem(STORAGE_KEY);
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
