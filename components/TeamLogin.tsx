
import React, { useState, useEffect } from 'react';
import { dataService, InviteAutoJoinError } from '../services/dataService';
import { Team, TeamSummary, User, RetroSession, ActionItem } from '../types';

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
  onSuperAdminLogin?: (sessionToken: string) => void;
}

const TeamLogin: React.FC<Props> = ({ onLogin, onJoin, inviteData, onSuperAdminLogin }) => {
  const [view, setView] = useState<'LIST' | 'CREATE' | 'LOGIN' | 'JOIN' | 'FORGOT_PASSWORD' | 'RESET_PASSWORD' | 'SUPER_ADMIN_LOGIN'>('LIST');
  const [selectedTeam, setSelectedTeam] = useState<Team | TeamSummary | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);

  const [name, setName] = useState('');
  const [nameLocked, setNameLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [facilitatorEmail, setFacilitatorEmail] = useState('');
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [selectionMode, setSelectionMode] = useState<'SELECT_MEMBER' | 'NEW_NAME'>('SELECT_MEMBER');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase();

  // Handle password reset link
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const rawToken = urlParams.get('reset');
    if (!rawToken) return;

    const resetToken = rawToken.trim();
    const tokenPattern = /^[a-f0-9]{64}$/i;
    if (!tokenPattern.test(resetToken)) {
      setError('The reset link is invalid or has expired');
      setView('LIST');
      return;
    }

    const verifyToken = async () => {
      const tokenInfo = await dataService.verifyResetToken(resetToken);
      if (tokenInfo.valid) {
        setView('RESET_PASSWORD');
      } else {
        setError('The reset link is invalid or has expired');
        setView('LIST');
      }
    };
    verifyToken();
  }, []);

  // Handle invitation link - try auto-join or show member selection
  useEffect(() => {
    if (!inviteData) return;

    const handleInvite = async () => {
      try {
        const team = await dataService.importTeam(inviteData);
        setSelectedTeam(team);

        try {
          const { team: updatedTeam, user } = dataService.autoJoinFromInvite(team.id, inviteData);
          // Auto-join succeeded (server validated the authentication)
          if (onJoin) {
            onJoin(updatedTeam, user);
          } else {
            onLogin(updatedTeam);
          }
        } catch (err: unknown) {
          // Auto-join failed (invalid or missing authentication)
          // Show member selection screen as fallback
          if (err instanceof InviteAutoJoinError && err.code === 'INVITE_NOT_VERIFIED') {
            setError('');
          } else {
            const message = err instanceof Error ? err.message : String(err);
            setError(message);
          }
          setView('JOIN');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setView('JOIN');
      }
    };

    handleInvite();
  }, [inviteData, onJoin, onLogin]);

  const isFullTeam = (team: Team | TeamSummary | null): team is Team => {
    return !!team && 'members' in team;
  };

  useEffect(() => {
    const loadTeams = async () => {
      const summaries = await dataService.listTeams();
      setTeams(summaries);
    };
    loadTeams();
  }, [view]);

  useEffect(() => {
    const loadInfoMessage = async () => {
      try {
        const response = await fetch('/api/info-message');
        if (response.ok) {
          const data = await response.json();
          setInfoMessage(data.infoMessage || '');
        }
      } catch (err) {
        console.error('Failed to load info message', err);
      }
    };
    loadInfoMessage();
  }, []);

  useEffect(() => {
    if (selectionMode === 'NEW_NAME') return;
    if (inviteData?.memberName && !name) {
      setName(inviteData.memberName);
    }
  }, [inviteData, name, selectionMode]);

  useEffect(() => {
    if (selectionMode === 'NEW_NAME') {
      setNameLocked(false);
    }
  }, [selectionMode]);

  useEffect(() => {
    if (!inviteData || !isFullTeam(selectedTeam)) {
      setNameLocked(false);
      return;
    }

    if (selectionMode === 'NEW_NAME') {
      setNameLocked(false);
      return;
    }

    const normalizedEmail = normalizeEmail(inviteData.memberEmail);
    const existingMember = selectedTeam.members.find(
      (member) =>
        (inviteData.memberId && member.id === inviteData.memberId) ||
        (normalizedEmail && normalizeEmail(member.email) === normalizedEmail)
    );

    const previouslyJoined = existingMember
      ? existingMember.joinedBefore ||
        selectedTeam.retrospectives.some((retro) =>
          (retro.participants || []).some(
            (p) => p.id === existingMember.id || p.name.toLowerCase() === existingMember.name.toLowerCase()
          )
        )
      : false;

    if (existingMember) {
      setName(existingMember.name);
      setNameLocked(!!previouslyJoined && !inviteData.memberEmail);
      return;
    }

    if (inviteData.memberName && !selectedMemberId && !name) {
      if (inviteData.memberEmail) {
        setName('');
      } else {
        setName(inviteData.memberName);
      }
      setNameLocked(false);
    }
  }, [inviteData, name, normalizeEmail, selectedMemberId, selectedTeam, selectionMode]);

  const memberSelectionOptions = React.useMemo(() => {
    if (!isFullTeam(selectedTeam)) return [];
    const participants = selectedTeam.members.filter(m => m.role !== 'facilitator');
    if (inviteData?.memberEmail) {
      return participants.filter(m => !m.email);
    }
    return participants;
  }, [inviteData, selectedTeam]);

  useEffect(() => {
    if (view !== 'JOIN' || !isFullTeam(selectedTeam)) return;

    if (inviteData?.memberEmail && memberSelectionOptions.length === 0) {
      setSelectionMode('NEW_NAME');
    } else {
      setSelectionMode('SELECT_MEMBER');
    }
    setSelectedMemberId(null);
  }, [inviteData?.memberEmail, memberSelectionOptions.length, selectedTeam, view]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
        if(password.length < 4) throw new Error("Password must be at least 4 chars");
        const team = await dataService.createTeam(name, password, facilitatorEmail || undefined);
        onLogin(team);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if(!selectedTeam) return;
    try {
        const team = await dataService.loginTeam(selectedTeam.name, password);
        onLogin(team);
    } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedTeam) return;

    // Always use the name from input field - server will validate identity
    let userName = name.trim();
    if (inviteData?.memberEmail && selectionMode === 'SELECT_MEMBER' && !selectedMemberId) {
      setError('Please select a member from the list or choose to enter a new name.');
      return;
    }
    if (selectionMode === 'SELECT_MEMBER' && selectedMemberId) {
      const selectedMember = memberSelectionOptions.find(member => member.id === selectedMemberId);
      if (selectedMember) {
        userName = selectedMember.name;
      }
    }
    if (selectionMode === 'NEW_NAME' && inviteData?.memberEmail && !userName) {
      setError('Please enter your name');
      return;
    }
    if (!userName) {
      setError('Please enter your name');
      return;
    }

    try {
      const { team, user } = dataService.joinTeamAsParticipant(
        selectedTeam.id,
        userName,
        inviteData?.memberEmail,
        inviteData?.inviteToken,
        !!inviteData
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

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');
    if (!selectedTeam) return;

    try {
      const result = await dataService.requestPasswordReset(selectedTeam.name, facilitatorEmail);
      setSuccessMessage(result.message);
      setFacilitatorEmail('');
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    // Get reset token from URL
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset');

    if (!resetToken) {
      setError('Invalid reset link');
      return;
    }

    try {
      if(password.length < 4) throw new Error("Password must be at least 4 characters");
      const result = await dataService.resetPassword(resetToken, password);
      if (result.success) {
        setSuccessMessage(result.message);
        // Clear URL and switch to login view
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => {
          setView('LIST');
        }, 2000);
      } else {
        setError(result.message);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    }
  };

  const handleSuperAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!onSuperAdminLogin) return;

    try {
      const response = await fetch('/api/super-admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        if (response.status === 503) {
          throw new Error('Super admin not configured on this server');
        }
        if (response.status === 429) {
          const data = await response.json().catch(() => null);
          const retryAfter = data?.retryAfter ? ` Try again in ${data.retryAfter}.` : ' Try again later.';
          throw new Error(`Too many attempts.${retryAfter}`);
        }
        throw new Error('Invalid super admin password');
      }

      const data = await response.json();
      onSuperAdminLogin(data.sessionToken);
    } catch (err: any) {
      setError(err.message || 'Failed to authenticate');
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
                    {infoMessage && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">info</span>
                                <p className="text-sm text-amber-800 whitespace-pre-wrap">{infoMessage}</p>
                            </div>
                        </div>
                    )}
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
                        <>
                        {teams.length > 5 && (
                            <div className="relative mb-4">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</span>
                                <input
                                    type="text"
                                    placeholder="Search teams..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-8 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                        <span className="material-symbols-outlined text-lg">close</span>
                                    </button>
                                )}
                            </div>
                        )}
                        <div className="grid grid-cols-1 gap-3 overflow-y-auto pr-2 pb-4">
                            {teams.filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase())).map(team => {
                                const formatLastConnection = (dateStr?: string) => {
                                    if (!dateStr) return 'Never';
                                    try {
                                        const date = new Date(dateStr);
                                        if (isNaN(date.getTime())) return 'Never';
                                        const now = new Date();
                                        const diffMs = now.getTime() - date.getTime();
                                        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                                        if (diffDays < 0) return 'Just now';
                                        if (diffDays === 0) return 'Today';
                                        if (diffDays === 1) return 'Yesterday';
                                        if (diffDays < 7) return `${diffDays} days ago`;
                                        if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
                                        if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
                                        return `${Math.floor(diffDays / 365)} years ago`;
                                    } catch (e) {
                                        return 'Never';
                                    }
                                };

                                return (
                                    <button
                                        key={team.id}
                                        onClick={() => { setSelectedTeam(team); setView('LOGIN'); setError(''); setPassword(''); }}
                                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:border-indigo-500 hover:ring-1 hover:ring-indigo-500 transition text-left flex items-center group"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold mr-4 group-hover:bg-indigo-600 group-hover:text-white transition">
                                            {team.name.substring(0,2).toUpperCase()}
                                        </div>
                                        <div className="flex-grow">
                                            <div className="font-bold text-slate-800">{team.name}</div>
                                            <div className="text-xs text-slate-500">{team.memberCount} members</div>
                                            <div className="text-xs text-slate-400 mt-0.5">Last active: {formatLastConnection(team.lastConnectionDate)}</div>
                                        </div>
                                        <span className="material-symbols-outlined ml-auto text-slate-300 group-hover:text-indigo-500">arrow_forward</span>
                                    </button>
                                );
                            })}
                        </div>
                        </>
                    )}
                    {onSuperAdminLogin && (
                        <button
                            onClick={() => {
                                setView('SUPER_ADMIN_LOGIN');
                                setPassword('');
                                setError('');
                            }}
                            className="fixed bottom-4 right-4 text-slate-400 hover:text-slate-600 transition opacity-50 hover:opacity-100"
                            title="Super Admin Access"
                        >
                            <span className="material-symbols-outlined text-lg">shield_person</span>
                        </button>
                    )}
                </div>
            )}

            {view === 'SUPER_ADMIN_LOGIN' && onSuperAdminLogin && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LIST')} className="absolute top-8 left-8 text-slate-400 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> Back
                    </button>
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-3xl">shield_person</span>
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800">Super Admin Login</h2>
                        <p className="text-slate-500 text-sm mt-2">Enter the super admin password to manage all teams</p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
                    <form onSubmit={handleSuperAdminLogin} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Super Admin Password</label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                                placeholder="••••••••"
                                autoFocus
                            />
                        </div>
                        <button type="submit" className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 shadow-lg">
                            Access Admin Panel
                        </button>
                    </form>
                    <p className="text-xs text-slate-400 text-center mt-4">
                        Set SUPER_ADMIN_PASSWORD environment variable on the server to enable this feature
                    </p>
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
                            <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="e.g. Design Team" autoFocus />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Create Password</label>
                            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="••••••••" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">
                                Recovery Email <span className="text-slate-400 font-normal">(optional)</span>
                            </label>
                            <input
                                type="email"
                                value={facilitatorEmail}
                                onChange={(e) => setFacilitatorEmail(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder="your@email.com"
                            />
                            <p className="text-xs text-slate-500 mt-1">To recover your password if you forget it</p>
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
                            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="••••••••" autoFocus />
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">Enter Workspace</button>
                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => setView('FORGOT_PASSWORD')}
                                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                            >
                                Forgot password?
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {view === 'JOIN' && selectedTeam && (
                <div className="flex flex-col h-full justify-center max-w-md mx-auto">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-2xl mx-auto mb-4">
                            {selectedTeam.name.substring(0,2).toUpperCase()}
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800">Join {selectedTeam.name}</h2>
                        <p className="text-slate-500 text-sm mt-2">
                            {selectionMode === 'SELECT_MEMBER'
                                ? 'Select your name from the list or add a new one'
                                : 'Enter your name to join'}
                        </p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}

                    <form onSubmit={handleJoin} className="space-y-4">
                        {selectionMode === 'SELECT_MEMBER' && memberSelectionOptions.length > 0 ? (
                            <>
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 mb-2">
                                      {inviteData?.memberEmail ? 'Select a member without an email' : 'Select Your Name'}
                                    </label>
                                    {inviteData?.memberEmail && (
                                      <p className="text-xs text-slate-500 mb-2">
                                        If you already joined without an email, select your name to link this address to your profile.
                                      </p>
                                    )}
                                    <div className="max-h-64 overflow-y-auto space-y-2 border border-slate-200 rounded-lg p-2 bg-white">
                                        {memberSelectionOptions.map((member) => (
                                            <button
                                                key={member.id}
                                                type="button"
                                                onClick={() => {
                                                    setSelectedMemberId(member.id);
                                                    setName(member.name);
                                                    setNameLocked(true);
                                                }}
                                                className={`w-full flex items-center p-3 rounded-lg transition ${
                                                    selectedMemberId === member.id
                                                        ? 'bg-indigo-50 border-2 border-indigo-500'
                                                        : 'bg-slate-50 border-2 border-transparent hover:bg-slate-100'
                                                }`}
                                            >
                                                <div className={`w-10 h-10 rounded-full ${member.color} text-white flex items-center justify-center font-bold text-sm mr-3 shrink-0`}>
                                                    {member.name.substring(0, 2).toUpperCase()}
                                                </div>
                                                <div className="text-left flex-grow">
                                                    <div className="font-bold text-slate-800">{member.name}</div>
                                                    <div className="text-xs text-slate-500 capitalize">{member.role}</div>
                                                    {inviteData?.memberEmail && (
                                                      <div className="text-[11px] text-slate-400">No email on file</div>
                                                    )}
                                                </div>
                                                {selectedMemberId === member.id && (
                                                    <span className="material-symbols-outlined text-indigo-600 ml-2">check_circle</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-slate-300"></div>
                                    </div>
                                    <div className="relative flex justify-center text-xs">
                                        <span className="bg-slate-50 px-2 text-slate-500">OR</span>
                                    </div>
                                </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectionMode('NEW_NAME');
                                            setSelectedMemberId(null);
                                            setName('');
                                            setNameLocked(false);
                                        }}
                                        className="w-full border-2 border-dashed border-slate-300 text-slate-600 py-3 rounded-lg font-bold hover:border-indigo-400 hover:text-indigo-600 transition"
                                    >
                                        + I'm not in the list
                                    </button>
                                {inviteData?.memberEmail && (
                                    <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded p-2">
                                        Joining as <strong>{inviteData.memberEmail}</strong>
                                    </div>
                                )}
                                <button
                                    type="submit"
                                    disabled={!selectedMemberId}
                                    className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                                >
                                    Continue
                                </button>
                            </>
                        ) : (
                            <>
                                {memberSelectionOptions.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectionMode('SELECT_MEMBER');
                                            setName('');
                                        }}
                                        className="text-indigo-600 hover:text-indigo-800 text-sm font-medium flex items-center"
                                    >
                                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span>
                                        Back to member list
                                    </button>
                                )}
                                <div>
                                    <label className="block text-sm font-bold text-slate-500 mb-1">Your Name</label>
                                    <input
                                        type="text"
                                        required
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        readOnly={nameLocked}
                                        className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                        placeholder="e.g. John Doe"
                                        autoFocus
                                    />
                                </div>
                                {nameLocked && (
                                    <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                                        We recognized you from a previous session. Your name was kept for consistency.
                                    </div>
                                )}
                                {inviteData?.memberEmail && (
                                    <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded p-2">
                                        Joining as <strong>{inviteData.memberEmail}</strong>
                                    </div>
                                )}
                                <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">
                                    Join Retrospective
                                </button>
                            </>
                        )}
                    </form>
                    <p className="text-xs text-slate-400 text-center mt-4">
                        You will join as a participant
                    </p>
                </div>
            )}

            {view === 'FORGOT_PASSWORD' && selectedTeam && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LOGIN')} className="absolute top-8 left-8 text-slate-400 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> Back
                    </button>
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">Forgot Password</h2>
                        <p className="text-slate-500 text-sm mt-2">
                            Enter the recovery email for team <strong>{selectedTeam.name}</strong>
                        </p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
                    {successMessage && <div className="bg-green-50 text-green-700 p-3 rounded mb-4 text-sm">{successMessage}</div>}
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">Recovery Email</label>
                            <input
                                type="email"
                                required
                                value={facilitatorEmail}
                                onChange={(e) => setFacilitatorEmail(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder="your@email.com"
                            />
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">
                            Send Reset Link
                        </button>
                    </form>
                    <p className="text-xs text-slate-400 text-center mt-4">
                        An email will be sent with a link to reset your password
                    </p>
                </div>
            )}

            {view === 'RESET_PASSWORD' && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">Reset Password</h2>
                        <p className="text-slate-500 text-sm mt-2">
                            Enter your new password
                        </p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm">{error}</div>}
                    {successMessage && <div className="bg-green-50 text-green-700 p-3 rounded mb-4 text-sm">{successMessage}</div>}
                    <form onSubmit={handleResetPassword} className="space-y-4">
                        <div>
                            <label className="block text-sm font-bold text-slate-500 mb-1">New Password</label>
                            <input
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder="••••••••"
                                minLength={4}
                            />
                            <p className="text-xs text-slate-500 mt-1">At least 4 characters</p>
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">
                            Reset Password
                        </button>
                    </form>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

export default TeamLogin;
