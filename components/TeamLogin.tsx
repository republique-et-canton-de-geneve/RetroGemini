
import React, { useState, useEffect, useLayoutEffect } from 'react';
import { dataService, InviteAutoJoinError } from '../services/dataService';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  isPasswordLongEnough
} from '../utils/passwordPolicy.js';
import { Team, TeamSummary, User, RetroSession, ActionItem } from '../types';
import { useTranslation } from '../i18n/I18nContext';
import { translateErrorMessage } from '../i18n/errorMessages';
import type { MessageKey, TranslationParams } from '../i18n/translate';
import LanguageSwitcher from './common/LanguageSwitcher';

/**
 * A banner message, kept as *what* to say rather than the sentence itself, so
 * it follows the language switcher while it is on screen: a guest who lands on
 * an error in English and switches to French reads the error in French too.
 * `raw` is a message from the data layer or the server, translated at display.
 */
type Feedback = { key: MessageKey; params?: TranslationParams } | { raw: string };

/** An empty message shows no banner, exactly as setting `''` used to. */
const rawFeedback = (message?: string | null): Feedback | null => (message ? { raw: message } : null);

export interface InviteData {
  id: string;
  name: string;
  // Old links embed the plaintext team password; new links (stage 7e) carry
  // a signed, revocable invite credential instead. Exactly one is present.
  password?: string;
  inviteCredential?: string;
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
  const { t, tp, tRich } = useTranslation();
  const [view, setView] = useState<'LIST' | 'CREATE' | 'LOGIN' | 'JOIN' | 'FORGOT_PASSWORD' | 'RESET_PASSWORD' | 'SUPER_ADMIN_LOGIN'>('LIST');
  const [selectedTeam, setSelectedTeam] = useState<Team | TeamSummary | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);

  const [name, setName] = useState('');
  const [nameLocked, setNameLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [facilitatorEmail, setFacilitatorEmail] = useState('');
  const [error, setError] = useState<Feedback | null>(null);
  const [successMessage, setSuccessMessage] = useState<Feedback | null>(null);
  const [selectionMode, setSelectionMode] = useState<'SELECT_MEMBER' | 'NEW_NAME'>('SELECT_MEMBER');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [favoriteTeamIds, setFavoriteTeamIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('retro-favorite-teams');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const toggleFavorite = (teamId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavoriteTeamIds(prev => {
      const next = prev.includes(teamId)
        ? prev.filter(id => id !== teamId)
        : [...prev, teamId];
      localStorage.setItem('retro-favorite-teams', JSON.stringify(next));
      return next;
    });
  };

  const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase();

  // Handle password reset link
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const rawToken = urlParams.get('reset');
    if (!rawToken) return;

    const resetToken = rawToken.trim();
    const tokenPattern = /^[a-f0-9]{64}$/i;
    if (!tokenPattern.test(resetToken)) {
      setError({ key: 'login.reset.invalidLink' });
      setView('LIST');
      return;
    }

    const verifyToken = async () => {
      const tokenInfo = await dataService.verifyResetToken(resetToken);
      if (tokenInfo.valid) {
        setView('RESET_PASSWORD');
      } else if (tokenInfo.throttled) {
        // The link was never judged — saying it expired would send the user off
        // to request a new one, which only burns the reset-email limiter too.
        setError({ key: 'login.reset.verifyThrottled' });
        setView('LIST');
      } else {
        setError({ key: 'login.reset.invalidLink' });
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
            setError(null);
          } else {
            const message = err instanceof Error ? err.message : String(err);
            setError(rawFeedback(message));
          }
          setView('JOIN');
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(rawFeedback(message));
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

  // This *initialises* the join screen, and it used to undo the user's first
  // choice on it in two ways; each fix alone still loses the click in a browser
  // (__tests__/teamLoginJoinChoice.test.tsx, e2e/invite-join-early-click.spec.ts).
  // - A layout effect, not a passive one, so it lands in the commit that first
  //   shows the screen. A passive effect ran one task later, and a click on
  //   "I'm not in the list" in that window was queued before it and undone.
  // - Keyed on the team's id, not the object. The invite effect re-imports the
  //   team whenever it re-runs (StrictMode's double mount, or any App re-render:
  //   App passes fresh onJoin/onLogin each time), every import is a new object,
  //   and keyed on the object each one re-ran this reset over the user's choice.
  const loadedTeamId = isFullTeam(selectedTeam) ? selectedTeam.id : null;
  useLayoutEffect(() => {
    if (view !== 'JOIN' || !loadedTeamId) return;

    if (inviteData?.memberEmail && memberSelectionOptions.length === 0) {
      setSelectionMode('NEW_NAME');
    } else {
      setSelectionMode('SELECT_MEMBER');
    }
    setSelectedMemberId(null);
  }, [inviteData?.memberEmail, memberSelectionOptions.length, loadedTeamId, view]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
        // Audit H39 — the rule comes from `utils/passwordPolicy.js`, the same
        // module the server routes read, so the form and the route can never
        // disagree about what is acceptable.
        if (!isPasswordLongEnough(password)) throw new Error(PASSWORD_POLICY_MESSAGE);
        const team = await dataService.createTeam(name, password, facilitatorEmail || undefined);
        onLogin(team);
    } catch (err: unknown) {
      setError(rawFeedback(err instanceof Error ? err.message : String(err)));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if(!selectedTeam) return;
    try {
        const team = await dataService.loginTeam(selectedTeam.name, password);
        onLogin(team);
    } catch (err: unknown) {
        setError(rawFeedback(err instanceof Error ? err.message : String(err)));
    }
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!selectedTeam) return;

    // Always use the name from input field - server will validate identity
    let userName = name.trim();
    if (inviteData?.memberEmail && selectionMode === 'SELECT_MEMBER' && !selectedMemberId) {
      setError({ key: 'login.join.selectMemberRequired' });
      return;
    }
    if (selectionMode === 'SELECT_MEMBER' && selectedMemberId) {
      const selectedMember = memberSelectionOptions.find(member => member.id === selectedMemberId);
      if (selectedMember) {
        userName = selectedMember.name;
      }
    }
    if (selectionMode === 'NEW_NAME' && inviteData?.memberEmail && !userName) {
      setError({ key: 'login.join.nameRequired' });
      return;
    }
    if (!userName) {
      setError({ key: 'login.join.nameRequired' });
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
      setError(rawFeedback(err.message));
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    if (!selectedTeam) return;

    try {
      const result = await dataService.requestPasswordReset(selectedTeam.name, facilitatorEmail);
      setSuccessMessage(rawFeedback(result.message));
      setFacilitatorEmail('');
    } catch (err: any) {
      setError(rawFeedback(err.message) ?? { key: 'login.genericError' });
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    // Get reset token from URL
    const urlParams = new URLSearchParams(window.location.search);
    const resetToken = urlParams.get('reset');

    if (!resetToken) {
      setError({ key: 'login.reset.missingToken' });
      return;
    }

    try {
      if (!isPasswordLongEnough(password)) throw new Error(PASSWORD_POLICY_MESSAGE);
      const result = await dataService.resetPassword(resetToken, password);
      if (result.success) {
        // The server's success sentence embeds the team name, so it cannot be
        // looked up as a fixed message; it is rebuilt from its parts instead.
        setSuccessMessage(
          result.teamName
            ? { key: 'login.reset.success', params: { teamName: result.teamName } }
            : rawFeedback(result.message)
        );
        // Clear URL and switch to login view
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(() => {
          setView('LIST');
        }, 2000);
      } else {
        setError(rawFeedback(result.message));
      }
    } catch (err: any) {
      setError(rawFeedback(err.message) ?? { key: 'login.genericError' });
    }
  };

  const handleSuperAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!onSuperAdminLogin) return;

    try {
      const response = await fetch('/api/super-admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (!response.ok) {
        if (response.status === 503) {
          setError({ key: 'login.superAdmin.notConfigured' });
          return;
        }
        if (response.status === 429) {
          const data = await response.json().catch(() => null);
          setError(
            data?.retryAfter
              ? { key: 'login.superAdmin.tooManyAttemptsRetryIn', params: { retryAfter: String(data.retryAfter) } }
              : { key: 'login.superAdmin.tooManyAttemptsLater' }
          );
          return;
        }
        setError({ key: 'login.superAdmin.invalidPassword' });
        return;
      }

      const data = await response.json();
      onSuperAdminLogin(data.sessionToken);
    } catch (err: any) {
      setError(rawFeedback(err.message) ?? { key: 'login.superAdmin.authFailed' });
    }
  };

  const feedbackText = (feedback: Feedback): string =>
    'key' in feedback ? t(feedback.key, feedback.params) : translateErrorMessage(feedback.raw, t);

  const roleLabel = (role: User['role']): string => {
    if (role === 'facilitator') return t('login.join.role.facilitator');
    if (role === 'participant') return t('login.join.role.participant');
    return role;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full bg-white rounded-2xl shadow-xl overflow-hidden flex flex-col md:flex-row h-[600px] relative">
        {/* The interface language, reachable from every view before anyone
            logs in: a guest arriving on an invite link reads this screen
            first. Pinned to the card's corner rather than placed in a view so
            it never scrolls away and sits in the same spot on every screen. */}
        <LanguageSwitcher className="absolute top-3 right-3 md:right-6 z-20 shadow-sm" />
        {/* Left Side: Branding */}
        <div className="bg-linear-to-br from-indigo-600 to-purple-700 p-12 text-center md:text-left flex flex-col justify-center md:w-5/12 text-white relative overflow-hidden">
             <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[url('/assets/cubes.png')]"></div>
             <div className="z-10">
                <h1 className="text-4xl font-black mb-4 tracking-tighter">RetroGemini</h1>
                <p className="text-indigo-100 font-medium text-lg leading-relaxed">
                    {t('login.brand.tagline')}
                </p>
             </div>
        </div>
        
        {/* Right Side: Content */}
        <div className="p-8 md:p-12 grow overflow-y-auto md:w-7/12 bg-slate-50 relative">
            
            {view === 'LIST' && (
                <div className="h-full flex flex-col">
                    {/* The reset-link handler reports failures by setting `error`
                        and dropping the user back here, so this view has to
                        render it — otherwise the explanation is set into state
                        and silently discarded, and the user lands on the team
                        list with no idea why. */}
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-sm mb-4 text-sm">{feedbackText(error)}</div>}
                    {infoMessage && (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                            <div className="flex items-start gap-2">
                                <span className="material-symbols-outlined text-amber-600 text-lg shrink-0">info</span>
                                <p className="text-sm text-amber-800 whitespace-pre-wrap">{infoMessage}</p>
                            </div>
                        </div>
                    )}
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">{t('login.list.title')}</h2>
                        <button onClick={() => { setView('CREATE'); setName(''); setPassword(''); setError(null); }} className="bg-indigo-600 text-white px-4 py-2 rounded-lg font-bold text-sm hover:bg-indigo-700 transition shadow-sm">
                            {t('login.list.newTeam')}
                        </button>
                    </div>
                    
                    {teams.length === 0 ? (
                        <div className="grow flex flex-col items-center justify-center text-slate-500 border-2 border-dashed border-slate-200 rounded-xl">
                            <span className="material-symbols-outlined text-4xl mb-2">groups</span>
                            <p>{t('login.list.empty')}</p>
                        </div>
                    ) : (
                        <>
                        {teams.length > 5 && (
                            <div className="relative mb-4">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xl">search</span>
                                <input
                                    type="text"
                                    placeholder={t('login.list.searchPlaceholder')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-10 pr-8 py-2.5 border border-slate-300 rounded-lg bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-sm"
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600"
                                        aria-label={t('login.list.clearSearch')}
                                    >
                                        <span className="material-symbols-outlined text-lg">close</span>
                                    </button>
                                )}
                            </div>
                        )}
                        {(() => {
                            const formatLastConnection = (dateStr?: string) => {
                                if (!dateStr) return t('login.list.lastConnection.never');
                                try {
                                    const date = new Date(dateStr);
                                    if (isNaN(date.getTime())) return t('login.list.lastConnection.never');
                                    const now = new Date();
                                    const diffMs = now.getTime() - date.getTime();
                                    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

                                    if (diffDays < 0) return t('login.list.lastConnection.justNow');
                                    if (diffDays === 0) return t('login.list.lastConnection.today');
                                    if (diffDays === 1) return t('login.list.lastConnection.yesterday');
                                    // Always 2..6 here, so a single plural message is exact.
                                    if (diffDays < 7) return t('login.list.lastConnection.daysAgo', { count: diffDays });
                                    if (diffDays < 30) return tp('login.list.lastConnection.weeksAgo', Math.floor(diffDays / 7));
                                    if (diffDays < 365) return tp('login.list.lastConnection.monthsAgo', Math.floor(diffDays / 30));
                                    return tp('login.list.lastConnection.yearsAgo', Math.floor(diffDays / 365));
                                } catch {
                                    return t('login.list.lastConnection.never');
                                }
                            };

                            const renderTeamCard = (team: TeamSummary) => {
                                const isFav = favoriteTeamIds.includes(team.id);
                                return (
                                    <button
                                        key={team.id}
                                        onClick={() => { setSelectedTeam(team); setView('LOGIN'); setError(null); setPassword(''); }}
                                        className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-indigo-500 hover:ring-1 hover:ring-indigo-500 transition text-left flex items-center group"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold mr-4 group-hover:bg-indigo-600 group-hover:text-white transition">
                                            {team.name.substring(0,2).toUpperCase()}
                                        </div>
                                        <div className="grow min-w-0">
                                            <div className="font-bold text-slate-800">{team.name}</div>
                                            <div className="text-xs text-slate-500">{tp('login.list.memberCount', team.memberCount)}</div>
                                            <div className="text-xs text-slate-500 mt-0.5">{t('login.list.lastActive', { when: formatLastConnection(team.lastConnectionDate) })}</div>
                                        </div>
                                        <span
                                            role="switch"
                                            aria-checked={isFav}
                                            aria-label={isFav ? t('login.list.removeFavorite', { teamName: team.name }) : t('login.list.addFavorite', { teamName: team.name })}
                                            onClick={(e) => toggleFavorite(team.id, e)}
                                            className={`material-symbols-outlined text-xl mx-2 transition shrink-0 ${isFav ? 'text-amber-400 hover:text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                                            style={isFav ? { fontVariationSettings: "'FILL' 1" } : undefined}
                                        >star</span>
                                        <span className="material-symbols-outlined text-slate-300 group-hover:text-indigo-500 shrink-0">arrow_forward</span>
                                    </button>
                                );
                            };

                            const filtered = teams.filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()));
                            const favoriteTeams = filtered.filter(t => favoriteTeamIds.includes(t.id));
                            const otherTeams = filtered.filter(t => !favoriteTeamIds.includes(t.id));

                            return (
                                <div className="overflow-y-auto pr-2 pb-4">
                                    {favoriteTeams.length > 0 && (
                                        <>
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="material-symbols-outlined text-amber-400 text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('login.list.favorites')}</span>
                                            </div>
                                            <div className="grid grid-cols-1 gap-3 mb-4">
                                                {favoriteTeams.map(renderTeamCard)}
                                            </div>
                                            {otherTeams.length > 0 && (
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{t('login.list.allTeams')}</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {otherTeams.length > 0 && (
                                        <div className="grid grid-cols-1 gap-3">
                                            {otherTeams.map(renderTeamCard)}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                        </>
                    )}
                    {onSuperAdminLogin && (
                        <button
                            onClick={() => {
                                setView('SUPER_ADMIN_LOGIN');
                                setPassword('');
                                setError(null);
                            }}
                            className="fixed bottom-4 right-4 text-slate-500 hover:text-slate-600 transition opacity-50 hover:opacity-100"
                            title={t('login.superAdmin.access')}
                            aria-label={t('login.superAdmin.access')}
                        >
                            <span className="material-symbols-outlined text-lg">shield_person</span>
                        </button>
                    )}
                </div>
            )}

            {view === 'SUPER_ADMIN_LOGIN' && onSuperAdminLogin && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LIST')} className="absolute top-8 left-8 text-slate-500 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> {t('common.back')}
                    </button>
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
                            <span className="material-symbols-outlined text-3xl">shield_person</span>
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800">{t('login.superAdmin.title')}</h2>
                        <p className="text-slate-500 text-sm mt-2">{t('login.superAdmin.subtitle')}</p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-sm mb-4 text-sm">{feedbackText(error)}</div>}
                    <form onSubmit={handleSuperAdminLogin} className="space-y-4">
                        <div>
                            <label htmlFor="super-admin-password" className="block text-sm font-bold text-slate-500 mb-1">{t('login.superAdmin.passwordLabel')}</label>
                            <input
                                id="super-admin-password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-red-500 focus:ring-1 focus:ring-red-500"
                                placeholder="••••••••"
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                autoFocus
                            />
                        </div>
                        <button type="submit" className="w-full bg-red-600 text-white py-3 rounded-lg font-bold hover:bg-red-700 shadow-lg">
                            {t('login.superAdmin.submit')}
                        </button>
                    </form>
                    <p className="text-xs text-slate-500 text-center mt-4">
                        {t('login.superAdmin.envHint')}
                    </p>
                </div>
            )}

            {view === 'CREATE' && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LIST')} className="absolute top-8 left-8 text-slate-500 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> {t('common.back')}
                    </button>
                    <h2 className="text-2xl font-bold text-slate-800 mb-6 text-center">{t('login.create.title')}</h2>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-sm mb-4 text-sm">{feedbackText(error)}</div>}
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label htmlFor="create-team-name" className="block text-sm font-bold text-slate-500 mb-1">{t('login.create.nameLabel')}</label>
                            <input
                                id="create-team-name"
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder={t('login.create.namePlaceholder')}
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                autoFocus
                            />
                        </div>
                        <div>
                            <label htmlFor="create-team-password" className="block text-sm font-bold text-slate-500 mb-1">{t('login.create.passwordLabel')}</label>
                            <input id="create-team-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" placeholder="••••••••" minLength={PASSWORD_MIN_LENGTH} />
                            <p className="text-xs text-slate-500 mt-1">{t('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH })}</p>
                        </div>
                        <div>
                            <label htmlFor="create-team-email" className="block text-sm font-bold text-slate-500 mb-1">
                                {tRich('login.create.emailLabel', {
                                    optional: <span className="text-slate-500 font-normal">{t('login.create.optional')}</span>
                                })}
                            </label>
                            <input
                                id="create-team-email"
                                type="email"
                                value={facilitatorEmail}
                                onChange={(e) => setFacilitatorEmail(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder={t('login.emailPlaceholder')}
                            />
                            <p className="text-xs text-slate-500 mt-1">{t('login.create.emailHint')}</p>
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">{t('login.create.submit')}</button>
                    </form>
                </div>
            )}

            {view === 'LOGIN' && selectedTeam && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LIST')} className="absolute top-8 left-8 text-slate-500 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> {t('common.back')}
                    </button>
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">{t('login.signIn.title', { teamName: selectedTeam.name })}</h2>
                        <p className="text-slate-500 text-sm">{t('login.signIn.subtitle')}</p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-sm mb-4 text-sm">{feedbackText(error)}</div>}
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label htmlFor="team-login-password" className="block text-sm font-bold text-slate-500 mb-1">{t('login.signIn.passwordLabel')}</label>
                            <input
                                id="team-login-password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder="••••••••"
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                autoFocus
                            />
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">{t('login.signIn.submit')}</button>
                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => setView('FORGOT_PASSWORD')}
                                className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
                            >
                                {t('login.signIn.forgotPassword')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {view === 'JOIN' && selectedTeam && (
                <div className="flex flex-col h-full justify-center max-w-md mx-auto">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 rounded-full bg-linear-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center font-bold text-2xl mx-auto mb-4">
                            {selectedTeam.name.substring(0,2).toUpperCase()}
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800">{t('login.join.title', { teamName: selectedTeam.name })}</h2>
                        <p className="text-slate-500 text-sm mt-2">
                            {selectionMode === 'SELECT_MEMBER'
                                ? t('login.join.subtitleSelect')
                                : t('login.join.subtitleNew')}
                        </p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-sm mb-4 text-sm">{feedbackText(error)}</div>}

                    <form onSubmit={handleJoin} className="space-y-4">
                        {selectionMode === 'SELECT_MEMBER' && memberSelectionOptions.length > 0 ? (
                            <>
                                <div>
                                    {/* A list of member buttons, not one control: a label
                                        has nothing to point at, so this is a group. */}
                                    <span id="join-member-picker-label" className="block text-sm font-bold text-slate-500 mb-2">
                                      {inviteData?.memberEmail ? t('login.join.pickerLabelNoEmail') : t('login.join.pickerLabel')}
                                    </span>
                                    {inviteData?.memberEmail && (
                                      <p className="text-xs text-slate-500 mb-2">
                                        {t('login.join.linkEmailHint')}
                                      </p>
                                    )}
                                    <div
                                        role="group"
                                        aria-labelledby="join-member-picker-label"
                                        className="max-h-64 overflow-y-auto space-y-2 border border-slate-200 rounded-lg p-2 bg-white"
                                    >
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
                                                <div className="text-left grow">
                                                    <div className="font-bold text-slate-800">{member.name}</div>
                                                    <div className="text-xs text-slate-600 capitalize">{roleLabel(member.role)}</div>
                                                    {inviteData?.memberEmail && (
                                                      <div className="text-[11px] text-slate-500">{t('login.join.noEmailOnFile')}</div>
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
                                        <span className="bg-slate-50 px-2 text-slate-500">{t('login.join.or')}</span>
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
                                        {t('login.join.notInList')}
                                    </button>
                                {inviteData?.memberEmail && (
                                    <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-sm p-2">
                                        {tRich('login.join.joiningAs', { email: <strong>{inviteData.memberEmail}</strong> })}
                                    </div>
                                )}
                                <button
                                    type="submit"
                                    disabled={!selectedMemberId}
                                    className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg disabled:bg-slate-300 disabled:cursor-not-allowed transition"
                                >
                                    {t('login.join.continue')}
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
                                        {t('login.join.backToList')}
                                    </button>
                                )}
                                <div>
                                    <label htmlFor="join-name" className="block text-sm font-bold text-slate-500 mb-1">{t('login.join.nameLabel')}</label>
                                    <input
                                        id="join-name"
                                        type="text"
                                        required
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        readOnly={nameLocked}
                                        className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                        placeholder={t('login.join.namePlaceholder')}
                                        // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                        autoFocus
                                    />
                                </div>
                                {nameLocked && (
                                    <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-sm p-2">
                                        {t('login.join.recognized')}
                                    </div>
                                )}
                                {inviteData?.memberEmail && (
                                    <div className="text-xs text-slate-500 bg-slate-100 border border-slate-200 rounded-sm p-2">
                                        {tRich('login.join.joiningAs', { email: <strong>{inviteData.memberEmail}</strong> })}
                                    </div>
                                )}
                                <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">
                                    {t('login.join.submit')}
                                </button>
                            </>
                        )}
                    </form>
                    <p className="text-xs text-slate-500 text-center mt-4">
                        {t('login.join.footer')}
                    </p>
                </div>
            )}

            {view === 'FORGOT_PASSWORD' && selectedTeam && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <button onClick={() => setView('LOGIN')} className="absolute top-8 left-8 text-slate-500 hover:text-slate-600 flex items-center text-sm font-bold">
                        <span className="material-symbols-outlined text-sm mr-1">arrow_back</span> {t('common.back')}
                    </button>
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">{t('login.forgot.title')}</h2>
                        <p className="text-slate-500 text-sm mt-2">
                            {tRich('login.forgot.subtitle', { teamName: <strong>{selectedTeam.name}</strong> })}
                        </p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-sm mb-4 text-sm">{feedbackText(error)}</div>}
                    {successMessage && <div className="bg-green-50 text-green-700 p-3 rounded-sm mb-4 text-sm">{feedbackText(successMessage)}</div>}
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                        <div>
                            <label htmlFor="forgot-password-email" className="block text-sm font-bold text-slate-500 mb-1">{t('login.forgot.emailLabel')}</label>
                            <input
                                id="forgot-password-email"
                                type="email"
                                required
                                value={facilitatorEmail}
                                onChange={(e) => setFacilitatorEmail(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder={t('login.emailPlaceholder')}
                            />
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">
                            {t('login.forgot.submit')}
                        </button>
                    </form>
                    <p className="text-xs text-slate-500 text-center mt-4">
                        {t('login.forgot.footer')}
                    </p>
                </div>
            )}

            {view === 'RESET_PASSWORD' && (
                <div className="flex flex-col h-full justify-center max-w-sm mx-auto">
                    <div className="text-center mb-6">
                        <h2 className="text-2xl font-bold text-slate-800">{t('login.reset.title')}</h2>
                        <p className="text-slate-500 text-sm mt-2">
                            {t('login.reset.subtitle')}
                        </p>
                    </div>
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-sm mb-4 text-sm">{feedbackText(error)}</div>}
                    {successMessage && <div className="bg-green-50 text-green-700 p-3 rounded-sm mb-4 text-sm">{feedbackText(successMessage)}</div>}
                    <form onSubmit={handleResetPassword} className="space-y-4">
                        <div>
                            <label htmlFor="reset-new-password" className="block text-sm font-bold text-slate-500 mb-1">{t('login.reset.newPasswordLabel')}</label>
                            <input
                                id="reset-new-password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full border border-slate-300 rounded-lg p-3 bg-white text-slate-900 outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                                placeholder="••••••••"
                                minLength={PASSWORD_MIN_LENGTH}
                            />
                            <p className="text-xs text-slate-500 mt-1">{t('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH })}</p>
                        </div>
                        <button type="submit" className="w-full bg-indigo-600 text-white py-3 rounded-lg font-bold hover:bg-indigo-700 shadow-lg">
                            {t('login.reset.submit')}
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
