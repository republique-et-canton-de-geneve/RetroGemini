import React, { useState, useEffect, useMemo } from 'react';
import { Team, User, AppVersion, VersionAnnouncement } from './types';
import { dataService } from './services/dataService';
import TeamLogin, { InviteData } from './components/TeamLogin';
import Dashboard from './components/Dashboard';
import Session from './components/Session';
import HealthCheckSession from './components/HealthCheckSession';
import SuperAdmin from './components/SuperAdmin';
import AnnouncementModal from './components/AnnouncementModal';

const LAST_SEEN_VERSION_KEY = 'retro-last-seen-version';

/**
 * Compare two version strings (e.g., "1.0" vs "1.1")
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
const compareVersions = (a: string, b: string): number => {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const maxLen = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA < numB) return -1;
    if (numA > numB) return 1;
  }
  return 0;
};

/**
 * Filter announcements to only show those newer than lastSeenVersion
 */
const getNewAnnouncements = (
  announcements: VersionAnnouncement[],
  lastSeenVersion: string | null
): VersionAnnouncement[] => {
  if (!lastSeenVersion) {
    // First time user - show all announcements (latest first)
    return announcements;
  }

  return announcements.filter(a => compareVersions(a.version, lastSeenVersion) > 0);
};

const App: React.FC = () => {
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [view, setView] = useState<'LOGIN' | 'DASHBOARD' | 'SESSION' | 'HEALTH_CHECK' | 'SUPER_ADMIN'>('LOGIN');
  const [superAdminPassword, setSuperAdminPassword] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeHealthCheckId, setActiveHealthCheckId] = useState<string | null>(null);
  const [inviteData, setInviteData] = useState<InviteData | null>(null);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [pendingHealthCheckId, setPendingHealthCheckId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [dashboardTab, setDashboardTab] = useState<'ACTIONS' | 'RETROS' | 'HEALTH_CHECKS' | 'MEMBERS' | 'SETTINGS'>('ACTIONS');

  // Announcement system state
  const [showAnnouncements, setShowAnnouncements] = useState(false);
  const [versionInfo, setVersionInfo] = useState<AppVersion | null>(null);
  const [lastSeenVersion, setLastSeenVersion] = useState<string | null>(() =>
    localStorage.getItem(LAST_SEEN_VERSION_KEY)
  );

  const STORAGE_KEY = 'retro-open-session';
  const SESSION_PATH_REGEX = /^\/session\/([^/]+)/;
  const HEALTH_CHECK_PATH_REGEX = /^\/healthcheck\/([^/]+)/;

  // Compute unread announcements
  const unreadAnnouncements = useMemo(() => {
    if (!versionInfo) return [];
    return getNewAnnouncements(versionInfo.announcements, lastSeenVersion);
  }, [versionInfo, lastSeenVersion]);

  const hasUnreadAnnouncements = unreadAnnouncements.length > 0;

  useEffect(() => {
    dataService.hydrateFromServer().finally(() => setHydrated(true));
  }, []);

  // Fetch version info
  useEffect(() => {
    const fetchVersionInfo = async () => {
      try {
        const response = await fetch('/api/version');
        if (!response.ok) return;

        const data: AppVersion = await response.json();
        setVersionInfo(data);
      } catch (err) {
        console.warn('Failed to fetch version info:', err);
      }
    };

    fetchVersionInfo();
  }, []);

  // Auto-show announcements popup when user reaches dashboard with unread announcements
  useEffect(() => {
    if (!versionInfo || !currentTeam || !currentUser) return;
    // Only show announcements to facilitators
    if (currentUser.role !== 'facilitator') return;
    // Only show on dashboard view
    if (view !== 'DASHBOARD') return;

    if (hasUnreadAnnouncements) {
      setShowAnnouncements(true);
    }
  }, [versionInfo, currentTeam, currentUser, view, hasUnreadAnnouncements]);

  const handleOpenAnnouncements = () => {
    setShowAnnouncements(true);
  };

  const handleDismissAnnouncements = () => {
    setShowAnnouncements(false);
  };

  const handleMarkAnnouncementsAsRead = () => {
    if (versionInfo) {
      localStorage.setItem(LAST_SEEN_VERSION_KEY, versionInfo.current);
      setLastSeenVersion(versionInfo.current);
    }
    setShowAnnouncements(false);
  };

  useEffect(() => {
    if (!hydrated || currentTeam) return;

    // If the URL contains an invite payload, skip restoring local session state.
    const params = new URLSearchParams(window.location.search);
    if (params.has('join')) return;

    try {
      const pathMatch = window.location.pathname.match(SESSION_PATH_REGEX);
      const healthCheckPathMatch = window.location.pathname.match(HEALTH_CHECK_PATH_REGEX);
      const sessionFromPath = pathMatch?.[1] || null;
      const healthCheckFromPath = healthCheckPathMatch?.[1] || null;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const team = dataService.getTeam(saved.teamId);
      if (!team) return;

      let user = team.members.find(m => m.id === saved.userId) || team.members.find(m => m.email && m.email === saved.userEmail);
      if (!user && saved.userName) {
        const participants = [
          ...team.retrospectives.flatMap(r => r.participants || []),
          ...(team.healthChecks || []).flatMap(h => h.participants || [])
        ];
        const found = participants.find(p => p.id === saved.userId || p.name === saved.userName);
        if (found) {
          dataService.persistParticipants(team.id, [found]);
          user = found;
        }
      }

      if (!user) return;

      setCurrentTeam(team);
      setCurrentUser(user);

      // Check for health check path first
      if (healthCheckFromPath) {
        const hcExists = team.healthChecks?.some(h => h.id === healthCheckFromPath);
        if (hcExists) {
          setActiveHealthCheckId(healthCheckFromPath);
          setView('HEALTH_CHECK');
          return;
        } else {
          window.history.replaceState({}, document.title, '/');
        }
      }

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
      } else if (saved.view === 'HEALTH_CHECK' && saved.activeHealthCheckId) {
        setView('DASHBOARD');
        setActiveHealthCheckId(null);
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
      activeHealthCheckId,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [currentTeam, currentUser, view, activeSessionId, activeHealthCheckId, hydrated]);

  useEffect(() => {
    if (view !== 'DASHBOARD' || !currentTeam) return;

    dataService.refreshFromServer().then(() => {
      const refreshedTeam = dataService.getTeam(currentTeam.id);
      if (!refreshedTeam) return;

      setCurrentTeam(refreshedTeam);

      if (currentUser) {
        const refreshedUser = refreshedTeam.members.find(m => m.id === currentUser.id) ?? currentUser;
        setCurrentUser(refreshedUser);
      }
    });
  }, [view, currentTeam?.id, currentUser]);

  useEffect(() => {
    if (!hydrated) return;

    if (view === 'SESSION' && activeSessionId) {
      const sessionPath = `/session/${activeSessionId}`;
      if (window.location.pathname !== sessionPath) {
        window.history.replaceState({}, document.title, sessionPath);
      }
    } else if (view === 'HEALTH_CHECK' && activeHealthCheckId) {
      const healthCheckPath = `/healthcheck/${activeHealthCheckId}`;
      if (window.location.pathname !== healthCheckPath) {
        window.history.replaceState({}, document.title, healthCheckPath);
      }
    } else if (window.location.pathname !== '/') {
      window.history.replaceState({}, document.title, '/');
    }
  }, [view, activeSessionId, activeHealthCheckId, hydrated]);

  // Participants should never remain on the dashboard; force them into a session or log them out.
  useEffect(() => {
    if (!hydrated || !currentTeam || !currentUser) return;
    if (currentUser.role !== 'participant') return;
    if (view !== 'DASHBOARD') return;

    // Check for active health check first
    const targetHealthCheck =
      (activeHealthCheckId && currentTeam.healthChecks?.find(h => h.id === activeHealthCheckId)) ||
      currentTeam.healthChecks?.find(h => h.status === 'IN_PROGRESS');

    if (targetHealthCheck) {
      setActiveHealthCheckId(targetHealthCheck.id);
      setView('HEALTH_CHECK');
      return;
    }

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
  }, [hydrated, currentTeam, currentUser, view, activeSessionId, activeHealthCheckId]);

  // Check for invitation link on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinParam = params.get('join');
    if (joinParam) {
      try {
        // Decode UTF-8 encoded base64 string. Replace spaces (converted from +) for legacy links
        // and support URL-encoded payloads for QR codes.
        const normalized = decodeURIComponent(joinParam.replace(/\s/g, '+'));
        const decoded = JSON.parse(decodeURIComponent(escape(atob(normalized))));
        if (decoded.id && decoded.name && decoded.password) {
          // Clear any previously persisted session state so invitees cannot be
          // redirected back into an older retrospective from the same browser.
          localStorage.removeItem(STORAGE_KEY);
          setCurrentTeam(null);
          setCurrentUser(null);
          setInviteData(decoded);
          // Store session ID to open after join (retro or health check)
          if (decoded.sessionId || decoded.session?.id) {
            setPendingSessionId(decoded.sessionId || decoded.session?.id || null);
          }
          if (decoded.healthCheckSessionId || decoded.healthCheckSession?.id) {
            setPendingHealthCheckId(decoded.healthCheckSessionId || decoded.healthCheckSession?.id || null);
          }
          // Clean the URL without reloading
          window.history.replaceState({}, document.title, window.location.pathname);
        }
      } catch (e) {
        console.error('Invalid invitation link');
      }
    }
  }, []);

  const ensureSessionForInvite = (team: Team, preferredSessionId?: string | null) => {
    if (!preferredSessionId) return null;

    const existing = team.retrospectives.find(r => r.id === preferredSessionId);
    if (existing) return existing.id;

    const placeholder = dataService.ensureSessionPlaceholder(team.id, preferredSessionId);
    return placeholder?.id ?? null;
  };

  const ensureHealthCheckForInvite = (team: Team, preferredHealthCheckId?: string | null) => {
    if (!preferredHealthCheckId) return null;

    const existing = team.healthChecks?.find(h => h.id === preferredHealthCheckId);
    if (existing) return existing.id;

    const placeholder = dataService.ensureHealthCheckPlaceholder(team.id, preferredHealthCheckId);
    return placeholder?.id ?? null;
  };

  const openActiveSessionIfParticipant = (team: Team, fallbackSessionId?: string | null) => {
    // If user is a participant, automatically join the active retrospective
    // Prefer the invited session when provided
    const invitedSessionId = ensureSessionForInvite(team, fallbackSessionId);

    const active = invitedSessionId
      ? team.retrospectives.find(r => r.id === invitedSessionId)
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

    // Check for health check invite first
    if (pendingHealthCheckId) {
      const healthCheckId = ensureHealthCheckForInvite(team, pendingHealthCheckId);
      if (healthCheckId) {
        setPendingHealthCheckId(null);
        setPendingSessionId(null);
        setInviteData(null);
        setActiveHealthCheckId(healthCheckId);
        setView('HEALTH_CHECK');
        return;
      }
    }

    const opened = openActiveSessionIfParticipant(team, pendingSessionId);

    // Clear invitation specific state once we've attempted to open a session
    setPendingSessionId(null);
    setPendingHealthCheckId(null);
    setInviteData(null);

    if (!opened) {
      if (user.role === 'participant') {
        // Try health checks first
        const fallbackHealthCheck = team.healthChecks?.find(h => h.status === 'IN_PROGRESS');
        if (fallbackHealthCheck) {
          setActiveHealthCheckId(fallbackHealthCheck.id);
          setView('HEALTH_CHECK');
        } else {
          const fallbackActive = pendingSessionId
            ? team.retrospectives.find(r => r.id === pendingSessionId)
            : team.retrospectives[0];
          if (fallbackActive) {
            setActiveSessionId(fallbackActive.id);
            setView('SESSION');
          } else {
            setView('LOGIN');
          }
        }
      } else {
        setView('DASHBOARD');
      }
    }
  };

  const handleLogout = () => {
    setCurrentTeam(null);
    setCurrentUser(null);
    setActiveSessionId(null);
    setActiveHealthCheckId(null);
    setPendingSessionId(null);
    setPendingHealthCheckId(null);
    setInviteData(null);
    setDashboardTab('ACTIONS');
    setShowAnnouncements(false);
    setSuperAdminPassword(null);
    setView('LOGIN');
    localStorage.removeItem(STORAGE_KEY);
  };

  const handleOpenSession = (sessionId: string) => {
    if (currentUser?.role === 'participant') return;
    setActiveSessionId(sessionId);
    setView('SESSION');
  };

  const handleOpenHealthCheck = (healthCheckId: string) => {
    if (currentUser?.role === 'participant') return;
    setActiveHealthCheckId(healthCheckId);
    setView('HEALTH_CHECK');
  };

  const handleSuperAdminLogin = (password: string) => {
    setSuperAdminPassword(password);
    setView('SUPER_ADMIN');
  };

  const handleSuperAdminExit = async () => {
    await dataService.refreshFromServer();
    setSuperAdminPassword(null);
    setView('LOGIN');
  };


  if (!hydrated) {
    return <div className="h-screen flex items-center justify-center text-slate-500">Loading workspace…</div>;
  }

  if (view === 'SUPER_ADMIN' && superAdminPassword) {
    return (
      <SuperAdmin
        superAdminPassword={superAdminPassword}
        onExit={handleSuperAdminExit}
      />
    );
  }

  if (!currentTeam) {
    return <TeamLogin onLogin={handleLogin} onJoin={handleJoin} inviteData={inviteData} onSuperAdminLogin={handleSuperAdminLogin} />;
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
                {/* What's New Button - Only for facilitators */}
                {currentUser.role === 'facilitator' && versionInfo && (
                    <button
                        onClick={handleOpenAnnouncements}
                        className="relative flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                        title="What's New"
                    >
                        <span className="material-symbols-outlined text-lg">auto_awesome</span>
                        <span className="hidden sm:inline">What's New</span>
                        {hasUnreadAnnouncements && (
                            <span className="absolute -top-1 -right-1 w-5 h-5 bg-gradient-to-r from-rose-500 to-pink-500 text-white text-xs font-bold rounded-full flex items-center justify-center shadow-md">
                                {unreadAnnouncements.reduce((acc, a) => acc + a.items.length, 0)}
                            </span>
                        )}
                    </button>
                )}

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
                    onOpenHealthCheck={handleOpenHealthCheck}
                    onRefresh={() => {
                        const updated = dataService.getTeam(currentTeam.id);
                        if(updated) {
                            // Clone to force render when dataService mutates in-place
                            setCurrentTeam(JSON.parse(JSON.stringify(updated)));
                        }
                    }}
                    onDeleteTeam={handleLogout}
                    initialTab={dashboardTab}
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
                    if(updated) {
                        setCurrentTeam(JSON.parse(JSON.stringify(updated)));
                    }

                    if (currentUser?.role === 'participant') {
                      handleLogout();
                      return;
                    }

                    setDashboardTab('RETROS');
                    setView('DASHBOARD');
                }}
            />
        )}
        {view === 'HEALTH_CHECK' && activeHealthCheckId && (
            <HealthCheckSession
                team={currentTeam}
                currentUser={currentUser!}
                sessionId={activeHealthCheckId}
                onExit={() => {
                    // Refresh data before exiting
                    const updated = dataService.getTeam(currentTeam.id);
                    if(updated) {
                        setCurrentTeam(JSON.parse(JSON.stringify(updated)));
                    }

                    if (currentUser?.role === 'participant') {
                      handleLogout();
                      return;
                    }

                    setDashboardTab('HEALTH_CHECKS');
                    setView('DASHBOARD');
                }}
            />
        )}

        {/* Announcement Modal */}
        {showAnnouncements && versionInfo && (
            <AnnouncementModal
                announcements={versionInfo.announcements}
                currentVersion={versionInfo.current}
                onDismiss={handleDismissAnnouncements}
                onMarkAsRead={handleMarkAnnouncementsAsRead}
                showLaterButton={hasUnreadAnnouncements}
            />
        )}
    </div>
  );
};

export default App;
