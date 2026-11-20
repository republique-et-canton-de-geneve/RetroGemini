import { appFetch } from '../services/publicPath';

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { dataService, InviteAutoJoinError } from '../services/dataService';
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
  isPasswordLongEnough
} from '../utils/passwordPolicy.js';
import { INVALID_EMAIL_MESSAGE, RECOVERY_EMAIL_REQUIRED_MESSAGE, cleanEmail, parseEmailInput } from '../utils/emailAddress.js';
import { Team, TeamSummary, User, RetroSession, ActionItem } from '../types';
import { useTranslation } from '../i18n/I18nContext';
import { translateErrorMessage } from '../i18n/errorMessages';
import type { MessageKey, TranslationParams } from '../i18n/translate';
import { noticeText, type Notice } from '../i18n/notice';
import LanguageSwitcher from './common/LanguageSwitcher';
import { avatarColorClasses } from '../utils/participantColors';
import Avatar from './common/Avatar';
import { memberAvatarId } from '../utils/avatars.js';
import { Star } from './common/StarRating';

/**
 * A banner message, kept as *what* to say rather than the sentence itself, so
 * it follows the language switcher while it is on screen: a guest who lands on
 * an error in English and switches to French reads the error in French too.
 * `raw` is a message from the data layer or the server, translated at display.
 */
type Feedback = { key: MessageKey; params?: TranslationParams } | { raw: string };

/** An empty message shows no banner, exactly as setting `''` used to. */
const rawFeedback = (message?: string | null): Feedback | null => (message ? { raw: message } : null);

// The error banner of the create and forgot-password views, which their email
// field points at (`aria-describedby`) when the banner is about that field.
const ERROR_BANNER_ID = 'team-login-error';

// The look's recipes, written once so the seven views of this screen agree.
// Full class strings, so Tailwind's scanner sees every one.
const FIELD =
  'w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-slate-900 placeholder:text-slate-500 outline-hidden transition-shadow focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15';
const LABEL = 'block text-sm font-semibold text-slate-700 mb-1.5';
const HINT = 'text-xs text-slate-500 mt-1.5';
const PRIMARY =
  'w-full inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 transition';
const SECONDARY =
  'rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition-colors aria-disabled:opacity-60 aria-disabled:cursor-wait';
// "Back", a quiet button at the top of a view.
const BACK =
  'self-start -ml-2 mb-4 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors';
const TITLE = 'text-xl font-semibold tracking-tight text-slate-900';
const SUBTITLE = 'text-sm text-slate-500 mt-1';
const ERROR_BOX = 'flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 mb-4 text-sm text-rose-800';
const NOTICE_BOX = 'flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 mb-4 text-sm text-amber-900';
const SUCCESS_BOX = 'flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 mb-4 text-sm text-emerald-800';
const BOX_ICON = 'material-symbols-outlined text-lg! leading-5! shrink-0';
// "Joining as …", which only a member-email invite link shows.
const JOINING_AS = 'text-xs text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-3 py-2';
// The column every view shares, and its one card: the forms keep this width
// at every size.
const COLUMN = 'w-full max-w-md';
const CARD = 'bg-white border border-slate-200 rounded-2xl shadow-sm p-6 sm:p-8';
// The team list: rows in one frame, not a wall of boxes, in a box that scrolls.
const TEAM_ROWS = 'rounded-xl border border-slate-200 divide-y divide-slate-200 overflow-hidden';
const LIST_BOX = 'overflow-y-auto max-h-[min(26rem,52vh)]';
const TEAM_NAME = 'block font-semibold text-slate-900 truncate';
// A team's row: the button that opens the team, its favourite star, and a
// chevron. The star is a button of its own after the team's, never inside it:
// inside, no Tab reached it (WCAG 2.1.1) and the team's name read its label.
// The team button's `::after` covers the row, so the whole row still opens the
// team, the star excepted, which is drawn above that layer; the focus ring is
// drawn on that layer too, round the whole row.
const TEAM_ROW = 'relative group flex items-center gap-3 bg-white px-3.5 py-3 hover:bg-slate-50 has-focus-visible:bg-slate-50 transition-colors';
const TEAM_OPEN =
  'flex-1 min-w-0 flex items-center gap-3 text-left outline-hidden after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-indigo-600';
const FAVORITE_STAR =
  'relative z-10 shrink-0 p-1 rounded-md text-amber-500 hover:bg-slate-100 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600';
// A list of six teams or more (the search field's threshold) uses the width
// from `lg`: the Dashboard's (`max-w-6xl`). The column, the card, the list and
// its box form one flex chain capped at what the viewport leaves under the top
// bar (46px) and the main's padding (72px), so the page never scrolls on top
// of the list; the box, the one link of the chain that scrolls, is the one that
// shrinks. Never under 30rem: in a window that short the page scrolls instead,
// and the box keeps a few rows.
const WIDE_COLUMN = `${COLUMN} lg:max-w-6xl lg:flex lg:flex-col lg:max-h-[max(calc(100dvh-7.5rem),30rem)]`;
const WIDE_CARD = `${CARD} lg:flex lg:flex-col lg:min-h-0`;
const WIDE_LIST_BOX = `${LIST_BOX} lg:max-h-none`;
// Its rows become tiles, two per row, read row by row: the visual order is the
// DOM order, which is also the tab order (WCAG 1.3.2, 2.4.3). Never
// `grid-flow-dense` nor an `order-*`, which place a tile out of that order. Two
// tracks, not `auto-fill`: with overlay scrollbars (macOS) a full-width card
// holds three 22rem tracks, and the names would be cut again.
const TEAM_GRID = `${TEAM_ROWS} lg:grid lg:grid-cols-2 lg:gap-2 lg:rounded-none lg:border-0 lg:divide-y-0`;
const TEAM_TILE = `${TEAM_ROW} lg:rounded-xl lg:border lg:border-slate-200`;
const TILE_OPEN = `${TEAM_OPEN} lg:after:rounded-xl`;
// A tile's name takes a second line rather than being cut.
const WIDE_TEAM_NAME = `${TEAM_NAME} lg:whitespace-normal lg:line-clamp-2 lg:break-words`;

const MESSAGE_LOOK = {
  error: { box: ERROR_BOX, icon: 'error' },
  notice: { box: NOTICE_BOX, icon: 'info' },
  success: { box: SUCCESS_BOX, icon: 'check_circle' },
} as const;

/**
 * A banner of one of the views: the tone's icon (decoration) and the sentence.
 * The live region is the sentence itself, so a screen reader announces the
 * words and nothing else, and `id` (what a field's `aria-describedby` names)
 * points at them.
 */
const Message: React.FC<{
  tone: keyof typeof MESSAGE_LOOK;
  role?: 'alert' | 'status';
  id?: string;
  /** Keeps the line breaks of a message someone typed (the console's info banner). */
  preWrap?: boolean;
  children: React.ReactNode;
}> = ({ tone, role, id, preWrap = false, children }) => (
  <div className={MESSAGE_LOOK[tone].box}>
    <span className={BOX_ICON} aria-hidden="true">{MESSAGE_LOOK[tone].icon}</span>
    <p id={id} role={role} className={`min-w-0 ${preWrap ? 'whitespace-pre-wrap' : ''}`}>{children}</p>
  </div>
);

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
  // Why this screen is shown when the user did not choose it (decision D3b:
  // the team's password was changed). Shown on the team list and the sign-in
  // form, which is where such a user lands and where they act on it.
  signedOutNotice?: Notice | null;
}

const TeamLogin: React.FC<Props> = ({ onLogin, onJoin, inviteData, onSuperAdminLogin, signedOutNotice = null }) => {
  const { t, tp, tRich } = useTranslation();
  const [view, setView] = useState<'LIST' | 'CREATE' | 'LOGIN' | 'JOIN' | 'FORGOT_PASSWORD' | 'RESET_PASSWORD' | 'SUPER_ADMIN_LOGIN'>('LIST');
  const [selectedTeam, setSelectedTeam] = useState<Team | TeamSummary | null>(null);
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  // Until the first answer, an empty `teams` means "not known yet", not "none":
  // the picker says it is loading rather than inviting the user to create one.
  const [teamsLoaded, setTeamsLoaded] = useState(false);
  // The last load failed. With no list on screen the picker says so and offers
  // a retry; a list already shown stays, rather than turning into "no team".
  const [teamsLoadFailed, setTeamsLoadFailed] = useState(false);
  // A retry keeps its button on screen while it runs (unmounting it would drop
  // keyboard focus on the page) and, once the list arrives, puts focus on the
  // list's heading instead of nowhere.
  const [retryingTeams, setRetryingTeams] = useState(false);
  const focusListAfterRetry = useRef(false);
  const listHeadingRef = useRef<HTMLHeadingElement>(null);

  const [name, setName] = useState('');
  const [nameLocked, setNameLocked] = useState(false);
  const [password, setPassword] = useState('');
  const [facilitatorEmail, setFacilitatorEmail] = useState('');
  const [error, setError] = useState<Feedback | null>(null);
  // Whether the banner's error is about the email field, so the field can say
  // so to a screen reader. Cleared as soon as the address is edited.
  const [emailInvalid, setEmailInvalid] = useState(false);
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

  // Each team's star, by team id. A star moves its team between the favourites
  // and the other teams, so React draws that row again in the other section and
  // the focus would fall back to the page. A star pressed while it had the
  // focus (Space or Enter) hands it to the same team's star in its new place.
  const favoriteStars = useRef(new Map<string, HTMLButtonElement>());
  const focusStarOf = useRef<string | null>(null);

  const toggleFavorite = (teamId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.currentTarget === document.activeElement) focusStarOf.current = teamId;
    setFavoriteTeamIds(prev => {
      const next = prev.includes(teamId)
        ? prev.filter(id => id !== teamId)
        : [...prev, teamId];
      localStorage.setItem('retro-favorite-teams', JSON.stringify(next));
      return next;
    });
  };

  // A layout effect, so the focus moves in the commit that drew the star again.
  useLayoutEffect(() => {
    const teamId = focusStarOf.current;
    if (!teamId) return;
    focusStarOf.current = null;
    favoriteStars.current.get(teamId)?.focus();
  }, [favoriteTeamIds]);

  // The shared rule (utils/emailAddress.js), as in dataService: a legacy member
  // address stored with a pasted `;` still matches the invite's clean one.
  const normalizeEmail = (email?: string | null) => cleanEmail(email);

  const emailFieldInvalid = emailInvalid && !!error;

  const handleEmailChange = (value: string) => {
    setFacilitatorEmail(value);
    if (emailInvalid) {
      setEmailInvalid(false);
      setError(null);
    }
  };

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

  // The latest callbacks App handed down. App re-creates them on every render,
  // and the invite import below must call the current one without re-running.
  const onJoinRef = useRef(onJoin);
  onJoinRef.current = onJoin;
  const onLoginRef = useRef(onLogin);
  onLoginRef.current = onLogin;
  // The invite link this screen has imported (or tried to). One import per
  // link: each one downloads the team's whole history, and a refused one counts
  // against the login limiter. It used to re-run on every App render (App
  // passes new callbacks each time, and `/api/version` answering during the
  // import is one such render), so every invitee downloaded the team at least
  // twice. React keeps the ref across StrictMode's double mount, so
  // development imports once too.
  //
  // A failed import is never retried by a render, and a reload cannot retry
  // it: App removes `?join=` from the address as soon as it reads the link, so
  // a reload shows the team list. The error screen therefore offers "Try
  // again" (one import per click, which keeps the limiter's count to what the
  // user asked for) and a way back to the team list.
  const importedInvite = useRef<InviteData | null>(null);
  // A retry keeps its button on screen while it runs, like the team list's,
  // and puts focus on the join screen's heading when that is where it lands.
  const [inviteRetrying, setInviteRetrying] = useState(false);
  // Counts failed imports: the error screen keys its alert on it, so a retry
  // that fails with the same message still puts a new alert in, and a screen
  // reader announces it. With the same text in the same node, React changes
  // nothing and the live region stays silent.
  const [inviteFailures, setInviteFailures] = useState(0);
  const focusJoinAfterRetry = useRef(false);
  const joinHeadingRef = useRef<HTMLHeadingElement>(null);

  // Import the invitation's team, then try auto-join or show member selection.
  // Stable (refs and setters only), so the effect below runs once per link.
  const importInvite = useCallback(async (invite: InviteData) => {
    try {
      const team = await dataService.importTeam(invite);
      setSelectedTeam(team);
      // A failed attempt's error stays on screen while a retry runs; this
      // attempt has succeeded.
      setError(null);

      try {
        const { team: updatedTeam, user } = dataService.autoJoinFromInvite(team.id, invite);
        // Auto-join succeeded (server validated the authentication)
        const join = onJoinRef.current;
        if (join) {
          join(updatedTeam, user);
        } else {
          onLoginRef.current(updatedTeam);
        }
      } catch (err: unknown) {
        // Auto-join failed (invalid or missing authentication)
        // Show member selection screen as fallback
        if (!(err instanceof InviteAutoJoinError && err.code === 'INVITE_NOT_VERIFIED')) {
          const message = err instanceof Error ? err.message : String(err);
          setError(rawFeedback(message));
        }
        setView('JOIN');
      }
    } catch (err: unknown) {
      focusJoinAfterRetry.current = false;
      const message = err instanceof Error ? err.message : String(err);
      setError(rawFeedback(message));
      setInviteFailures((count) => count + 1);
      setView('JOIN');
    } finally {
      setInviteRetrying(false);
    }
  }, []);

  useEffect(() => {
    if (!inviteData || importedInvite.current === inviteData) return;
    importedInvite.current = inviteData;
    importInvite(inviteData);
  }, [inviteData, importInvite]);

  const retryInviteImport = () => {
    if (inviteRetrying || !inviteData) return;
    focusJoinAfterRetry.current = true;
    setInviteRetrying(true);
    importInvite(inviteData);
  };

  const isFullTeam = (team: Team | TeamSummary | null): team is Team => {
    return !!team && 'members' in team;
  };

  const loadTeams = useCallback(async () => {
    const summaries = await dataService.listTeams();
    if (summaries) setTeams(summaries);
    else focusListAfterRetry.current = false;
    setTeamsLoadFailed(!summaries);
    setTeamsLoaded(true);
    setRetryingTeams(false);
  }, []);

  const retryLoadTeams = () => {
    if (retryingTeams) return;
    focusListAfterRetry.current = true;
    setRetryingTeams(true);
    loadTeams();
  };

  // A layout effect, so focus moves in the same commit that removes the button.
  useLayoutEffect(() => {
    if (!focusListAfterRetry.current || teamsLoadFailed || !teamsLoaded) return;
    focusListAfterRetry.current = false;
    listHeadingRef.current?.focus();
  }, [teamsLoadFailed, teamsLoaded, teams]);

  // The same for an invite retry that lands on the join screen: its button is
  // gone in that commit, and focus would otherwise fall back to the page.
  useLayoutEffect(() => {
    if (!focusJoinAfterRetry.current || view !== 'JOIN' || !selectedTeam) return;
    focusJoinAfterRetry.current = false;
    joinHeadingRef.current?.focus();
  }, [view, selectedTeam]);

  useEffect(() => {
    loadTeams();
  }, [view, loadTeams]);

  useEffect(() => {
    const loadInfoMessage = async () => {
      try {
        const response = await appFetch('/api/info-message');
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
  // - Keyed on the team's id, not the object. Every import is a new object, and
  //   keyed on the object each one re-ran this reset over the user's choice.
  //   The invite effect used to re-import on every App re-render; it now
  //   imports once per link, so this guards a genuine re-import (a new link).
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
    setEmailInvalid(false);
    try {
        // Audit H39 — the rule comes from `utils/passwordPolicy.js`, the same
        // module the server routes read, so the form and the route can never
        // disagree about what is acceptable.
        if (!isPasswordLongEnough(password)) throw new Error(PASSWORD_POLICY_MESSAGE);
        // The same holds for the address (`utils/emailAddress.js`). The
        // browser's `type="email"` already refuses a pasted `;`, but it
        // accepts `lead@corp`, which the server refuses.
        const recoveryEmail = parseEmailInput(facilitatorEmail);
        if (!recoveryEmail.ok) throw new Error(INVALID_EMAIL_MESSAGE);
        // Mandatory: the address is a team's only way back from a forgotten
        // password. `required` stops an empty submit in the browser; this
        // catches a blank value it lets through (spaces).
        if (!recoveryEmail.email) throw new Error(RECOVERY_EMAIL_REQUIRED_MESSAGE);
        const team = await dataService.createTeam(name, password, facilitatorEmail);
        onLogin(team);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === INVALID_EMAIL_MESSAGE || message === RECOVERY_EMAIL_REQUIRED_MESSAGE) setEmailInvalid(true);
      setError(rawFeedback(message));
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
    setEmailInvalid(false);
    if (!selectedTeam) return;

    // Judging the typed address reveals nothing about any team, so it is the
    // one answer that may differ from the opaque confirmation below.
    const typed = parseEmailInput(facilitatorEmail);
    if (!typed.ok || !typed.email) {
      setEmailInvalid(true);
      setError({ key: 'errors.invalidEmail' });
      return;
    }

    try {
      const result = await dataService.requestPasswordReset(selectedTeam.name, facilitatorEmail);
      // A refusal (a server that cannot send mail, an address the server
      // judges invalid) is an error to act on, not a confirmation, and the
      // address stays in the field to be corrected.
      if (!result.success) {
        if (result.message === INVALID_EMAIL_MESSAGE) setEmailInvalid(true);
        setError(rawFeedback(result.message) ?? { key: 'login.genericError' });
        return;
      }
      setSuccessMessage(rawFeedback(result.message));
      setFacilitatorEmail('');
    } catch (err: unknown) {
      setError(rawFeedback(err instanceof Error ? err.message : String(err)) ?? { key: 'login.genericError' });
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
      const response = await appFetch('/api/super-admin/verify', {
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

  // One threshold decides the search field and the wide list. It reads every
  // team, never the matches, so typing a search never changes the width; a
  // short, loading, empty or failed list, and every form, stay narrow.
  const searchable = teams.length > 5;
  const wideList = view === 'LIST' && searchable;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* The interface language, reachable from every view before anyone
          logs in: a guest arriving on an invite link reads this screen first.
          Pinned to the page's corner rather than placed in a view, so it sits
          in the same spot on every screen. */}
      <div className="flex justify-end px-4 pt-4 sm:px-6">
        <LanguageSwitcher />
      </div>
      <main className="flex-1 flex justify-center px-4 pt-2 pb-16 sm:items-center">
        <div className={wideList ? WIDE_COLUMN : COLUMN}>
          {/* The product's name and mark, above the one card of the view. */}
          <div className="flex flex-col items-center text-center mb-6">
            <span
              aria-hidden="true"
              className="w-11 h-11 rounded-xl bg-indigo-600 text-white text-xl font-bold flex items-center justify-center btn-brand-glow"
            >
              R
            </span>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">RetroGemini</h1>
            <p className="mt-1 max-w-xs text-sm text-slate-600">{t('login.brand.tagline')}</p>
          </div>

          <div className={wideList ? WIDE_CARD : CARD}>

            {view === 'LIST' && (
                <div className={wideList ? 'flex flex-col lg:min-h-0' : 'flex flex-col'}>
                    {/* The reset-link handler reports failures by setting `error`
                        and dropping the user back here, so this view has to
                        render it — otherwise the explanation is set into state
                        and silently discarded, and the user lands on the team
                        list with no idea why. */}
                    {error && <Message tone="error" role="alert">{feedbackText(error)}</Message>}
                    {signedOutNotice && <Message tone="notice" role="status">{noticeText(signedOutNotice, t)}</Message>}
                    {infoMessage && <Message tone="notice" preWrap>{infoMessage}</Message>}
                    <div className="flex justify-between items-center gap-3 mb-5">
                        <h2 ref={listHeadingRef} tabIndex={-1} className={`${TITLE} outline-hidden`}>{t('login.list.title')}</h2>
                        <button onClick={() => { setView('CREATE'); setName(''); setPassword(''); setError(null); }} className="shrink-0 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 transition">
                            {t('login.list.newTeam')}
                        </button>
                    </div>

                    {!teamsLoaded ? (
                        <div role="status" className="flex items-center justify-center gap-2 py-12 text-slate-500">
                            <span className="material-symbols-outlined motion-safe:animate-spin" aria-hidden="true">progress_activity</span>
                            <span>{t('login.list.loading')}</span>
                        </div>
                    ) : teamsLoadFailed && teams.length === 0 ? (
                        <div role="alert" className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-slate-600">
                            <span className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">
                                <span className="material-symbols-outlined" aria-hidden="true">cloud_off</span>
                            </span>
                            <p>{t('login.list.loadFailed')}</p>
                            <button
                                type="button"
                                onClick={retryLoadTeams}
                                aria-disabled={retryingTeams}
                                className={SECONDARY}
                            >
                                {retryingTeams ? t('login.list.loading') : t('login.list.retry')}
                            </button>
                        </div>
                    ) : teams.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 px-6 py-10 text-center text-slate-600">
                            <span className="w-11 h-11 rounded-xl bg-slate-100 text-slate-500 flex items-center justify-center">
                                <span className="material-symbols-outlined" aria-hidden="true">groups</span>
                            </span>
                            <p>{t('login.list.empty')}</p>
                        </div>
                    ) : (
                        <>
                        {searchable && (
                            <div className="relative mb-4 lg:max-w-md">
                                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-xl!" aria-hidden="true">search</span>
                                <input
                                    type="text"
                                    placeholder={t('login.list.searchPlaceholder')}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className={`${FIELD} pl-10 pr-9 text-sm`}
                                />
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100"
                                        aria-label={t('login.list.clearSearch')}
                                    >
                                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">close</span>
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
                                    <div key={team.id} className={wideList ? TEAM_TILE : TEAM_ROW}>
                                        <button
                                            type="button"
                                            onClick={() => { setSelectedTeam(team); setView('LOGIN'); setError(null); setPassword(''); }}
                                            className={wideList ? TILE_OPEN : TEAM_OPEN}
                                        >
                                            <span className="w-9 h-9 shrink-0 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-semibold flex items-center justify-center">
                                                {team.name.substring(0,2).toUpperCase()}
                                            </span>
                                            <span className="grow min-w-0">
                                                <span className={wideList ? WIDE_TEAM_NAME : TEAM_NAME}>{team.name}</span>
                                                {/* Each part is whole: it wraps as a unit, never inside
                                                    ("7 membres" never splits). From `sm` the parts share a
                                                    line when it holds them; on a phone the last activity
                                                    goes under the count, and its only break falls between
                                                    the label and the value (which may break too at 320px,
                                                    rather than overflow). The separator belongs to the part
                                                    it introduces and sits in the gap before it: a part that
                                                    wraps to the start of a line takes it into the clipped
                                                    margin, so no line ends on a "·". */}
                                                <span className="block sm:flex sm:flex-wrap sm:gap-x-4 sm:overflow-hidden text-xs text-slate-500">
                                                    <span className="block whitespace-nowrap">{tp('login.list.memberCount', team.memberCount)}</span>
                                                    <span className="block sm:-ml-4 sm:whitespace-nowrap">
                                                        <span className="hidden sm:inline-block sm:w-4 sm:text-center" aria-hidden="true">·</span>
                                                        {tRich('login.list.lastActive', {
                                                            when: <span className="min-[22.5rem]:whitespace-nowrap">{formatLastConnection(team.lastConnectionDate)}</span>,
                                                        })}
                                                    </span>
                                                </span>
                                            </span>
                                        </button>
                                        {/* A filled star for a favourite, an outline otherwise: the
                                            two differ in shape, not only in colour (the icon font
                                            has no FILL axis, see StarRating). */}
                                        <button
                                            type="button"
                                            role="switch"
                                            aria-checked={isFav}
                                            aria-label={isFav ? t('login.list.removeFavorite', { teamName: team.name }) : t('login.list.addFavorite', { teamName: team.name })}
                                            ref={(star) => {
                                                if (!star) return;
                                                favoriteStars.current.set(team.id, star);
                                                return () => {
                                                    if (favoriteStars.current.get(team.id) === star) favoriteStars.current.delete(team.id);
                                                };
                                            }}
                                            onClick={(e) => toggleFavorite(team.id, e)}
                                            className={FAVORITE_STAR}
                                        >
                                            <Star fill={isFav ? 1 : 0} className="w-5 h-5" />
                                        </button>
                                        <span className="material-symbols-outlined shrink-0 text-slate-400 group-hover:text-indigo-600 transition-colors" aria-hidden="true">chevron_right</span>
                                    </div>
                                );
                            };

                            const filtered = teams.filter(t => !searchQuery || t.name.toLowerCase().includes(searchQuery.toLowerCase()));
                            const favoriteTeams = filtered.filter(t => favoriteTeamIds.includes(t.id));
                            const otherTeams = filtered.filter(t => !favoriteTeamIds.includes(t.id));
                            const noMatch = searchQuery !== '' && filtered.length === 0;
                            const rows = wideList ? TEAM_GRID : TEAM_ROWS;

                            return (
                                <div className={wideList ? WIDE_LIST_BOX : LIST_BOX}>
                                    {/* In the list whenever the search field is, empty until a
                                        search matches nothing: a status region added at the
                                        moment it has something to say is not reliably announced.
                                        Visually hidden while empty, so it takes no room. */}
                                    {searchable && (
                                        <p role="status" className={noMatch ? 'py-8 text-center text-sm text-slate-600' : 'sr-only'}>
                                            {noMatch ? t('login.list.noMatch', { query: searchQuery }) : ''}
                                        </p>
                                    )}
                                    {favoriteTeams.length > 0 && (
                                        <>
                                            <div className="flex items-center gap-1.5 mb-2 text-amber-500">
                                                <Star fill={1} className="w-3.5 h-3.5" />
                                                <span className="text-xs font-semibold text-slate-500">{t('login.list.favorites')}</span>
                                            </div>
                                            <div className={`${rows} mb-4`}>
                                                {favoriteTeams.map(renderTeamCard)}
                                            </div>
                                            {otherTeams.length > 0 && (
                                                <div className="flex items-center gap-2 mb-2">
                                                    <span className="text-xs font-semibold text-slate-500">{t('login.list.allTeams')}</span>
                                                </div>
                                            )}
                                        </>
                                    )}
                                    {otherTeams.length > 0 && (
                                        <div className={rows}>
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
                            className="fixed bottom-3 right-3 p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                            title={t('login.superAdmin.access')}
                            aria-label={t('login.superAdmin.access')}
                        >
                            <span className="material-symbols-outlined text-xl! leading-none" aria-hidden="true">shield_person</span>
                        </button>
                    )}
                </div>
            )}

            {view === 'SUPER_ADMIN_LOGIN' && onSuperAdminLogin && (
                <div className="flex flex-col">
                    <button onClick={() => setView('LIST')} className={BACK}>
                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">arrow_back</span> {t('common.back')}
                    </button>
                    <div className="text-center mb-6">
                        <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-700 flex items-center justify-center mx-auto mb-3">
                            <span className="material-symbols-outlined" aria-hidden="true">shield_person</span>
                        </div>
                        <h2 className={TITLE}>{t('login.superAdmin.title')}</h2>
                        <p className={SUBTITLE}>{t('login.superAdmin.subtitle')}</p>
                    </div>
                    {error && <Message tone="error" role="alert">{feedbackText(error)}</Message>}
                    <form onSubmit={handleSuperAdminLogin} className="space-y-4">
                        <div>
                            <label htmlFor="super-admin-password" className={LABEL}>{t('login.superAdmin.passwordLabel')}</label>
                            <input
                                id="super-admin-password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={FIELD}
                                placeholder="••••••••"
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                autoFocus
                            />
                        </div>
                        <button type="submit" className={`${PRIMARY} mt-2`}>
                            {t('login.superAdmin.submit')}
                        </button>
                    </form>
                    <p className="text-xs text-slate-500 text-center mt-4">
                        {t('login.superAdmin.envHint')}
                    </p>
                </div>
            )}

            {view === 'CREATE' && (
                <div className="flex flex-col">
                    <button onClick={() => setView('LIST')} className={BACK}>
                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">arrow_back</span> {t('common.back')}
                    </button>
                    <h2 className={`${TITLE} mb-6 text-center`}>{t('login.create.title')}</h2>
                    {error && <Message tone="error" role="alert" id={ERROR_BANNER_ID}>{feedbackText(error)}</Message>}
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div>
                            <label htmlFor="create-team-name" className={LABEL}>{t('login.create.nameLabel')}</label>
                            <input
                                id="create-team-name"
                                type="text"
                                required
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className={FIELD}
                                placeholder={t('login.create.namePlaceholder')}
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                autoFocus
                            />
                        </div>
                        <div>
                            <label htmlFor="create-team-password" className={LABEL}>{t('login.create.passwordLabel')}</label>
                            <input id="create-team-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={FIELD} placeholder="••••••••" minLength={PASSWORD_MIN_LENGTH} />
                            <p className={HINT}>{t('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH })}</p>
                        </div>
                        <div>
                            <label htmlFor="create-team-email" className={LABEL}>
                                {t('login.create.emailLabel')}
                            </label>
                            <input
                                id="create-team-email"
                                type="email"
                                required
                                value={facilitatorEmail}
                                onChange={(e) => handleEmailChange(e.target.value)}
                                autoComplete="email"
                                autoCapitalize="none"
                                spellCheck={false}
                                aria-invalid={emailFieldInvalid || undefined}
                                aria-describedby={emailFieldInvalid ? `${ERROR_BANNER_ID} create-team-email-hint` : 'create-team-email-hint'}
                                className={FIELD}
                                placeholder={t('login.emailPlaceholder')}
                            />
                            <p id="create-team-email-hint" className={HINT}>{t('login.create.emailHint')}</p>
                        </div>
                        <button type="submit" className={`${PRIMARY} mt-2`}>{t('login.create.submit')}</button>
                    </form>
                </div>
            )}

            {view === 'LOGIN' && selectedTeam && (
                <div className="flex flex-col">
                    <button onClick={() => setView('LIST')} className={BACK}>
                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">arrow_back</span> {t('common.back')}
                    </button>
                    <div className="text-center mb-6">
                        <h2 className={TITLE}>{t('login.signIn.title', { teamName: selectedTeam.name })}</h2>
                        <p className={SUBTITLE}>{t('login.signIn.subtitle')}</p>
                    </div>
                    {error && <Message tone="error" role="alert">{feedbackText(error)}</Message>}
                    {signedOutNotice && <Message tone="notice" role="status">{noticeText(signedOutNotice, t)}</Message>}
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label htmlFor="team-login-password" className={LABEL}>{t('login.signIn.passwordLabel')}</label>
                            <input
                                id="team-login-password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={FIELD}
                                placeholder="••••••••"
                                // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                autoFocus
                            />
                        </div>
                        <button type="submit" className={`${PRIMARY} mt-2`}>{t('login.signIn.submit')}</button>
                        <div className="text-center">
                            <button
                                type="button"
                                onClick={() => setView('FORGOT_PASSWORD')}
                                className="rounded-md px-1 text-sm font-semibold text-indigo-700 hover:text-indigo-800 hover:underline underline-offset-2"
                            >
                                {t('login.signIn.forgotPassword')}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {/* A refused invite import leaves no team to join, and the join
                screen below needs one: say why here, or the pane stays blank.
                The import is never retried behind the user's back (each try is
                one more refusal counted by the login limiter), and a reload
                cannot retry it (App has removed `?join=` from the address), so
                this screen offers "Try again" and a way back to the team list.
                The error stays while a retry runs, or the pane would go blank. */}
            {view === 'JOIN' && !selectedTeam && error && (
                <div className="flex flex-col">
                    <button
                        type="button"
                        onClick={() => {
                            if (inviteRetrying) return;
                            focusJoinAfterRetry.current = false;
                            setView('LIST');
                            setError(null);
                        }}
                        aria-disabled={inviteRetrying}
                        className={`${BACK} aria-disabled:opacity-60 aria-disabled:cursor-wait`}
                    >
                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">arrow_back</span> {t('common.back')}
                    </button>
                    <Message key={inviteFailures} tone="error" role="alert">{feedbackText(error)}</Message>
                    {inviteData && (
                        <button
                            type="button"
                            onClick={retryInviteImport}
                            aria-disabled={inviteRetrying}
                            className={`self-center ${SECONDARY}`}
                        >
                            {inviteRetrying ? t('login.join.retrying') : t('login.list.retry')}
                        </button>
                    )}
                </div>
            )}

            {view === 'JOIN' && selectedTeam && (
                <div className="flex flex-col">
                    <div className="text-center mb-6">
                        <div aria-hidden="true" className="w-12 h-12 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center text-lg font-semibold mx-auto mb-3">
                            {selectedTeam.name.substring(0,2).toUpperCase()}
                        </div>
                        <h2 ref={joinHeadingRef} tabIndex={-1} className={`${TITLE} outline-hidden`}>{t('login.join.title', { teamName: selectedTeam.name })}</h2>
                        <p className={SUBTITLE}>
                            {selectionMode === 'SELECT_MEMBER'
                                ? t('login.join.subtitleSelect')
                                : t('login.join.subtitleNew')}
                        </p>
                    </div>
                    {error && <Message tone="error" role="alert">{feedbackText(error)}</Message>}

                    <form onSubmit={handleJoin} className="space-y-4">
                        {selectionMode === 'SELECT_MEMBER' && memberSelectionOptions.length > 0 ? (
                            <>
                                <div>
                                    {/* A list of member buttons, not one control: a label
                                        has nothing to point at, so this is a group. */}
                                    <span id="join-member-picker-label" className={LABEL}>
                                      {inviteData?.memberEmail ? t('login.join.pickerLabelNoEmail') : t('login.join.pickerLabel')}
                                    </span>
                                    {inviteData?.memberEmail && (
                                      <p className="text-xs text-slate-500 -mt-0.5 mb-2">
                                        {t('login.join.linkEmailHint')}
                                      </p>
                                    )}
                                    <div
                                        role="group"
                                        aria-labelledby="join-member-picker-label"
                                        className="max-h-64 overflow-y-auto space-y-1 rounded-xl border border-slate-200 bg-white p-1.5"
                                    >
                                        {memberSelectionOptions.map((member) => (
                                            <button
                                                key={member.id}
                                                type="button"
                                                // The check mark is hidden from assistive technology, so the
                                                // button says itself which member is chosen.
                                                aria-pressed={selectedMemberId === member.id}
                                                onClick={() => {
                                                    setSelectedMemberId(member.id);
                                                    setName(member.name);
                                                    setNameLocked(true);
                                                }}
                                                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg border-2 transition-colors ${
                                                    selectedMemberId === member.id
                                                        ? 'bg-indigo-50 border-indigo-600'
                                                        : 'bg-white border-transparent hover:bg-slate-50'
                                                }`}
                                            >
                                                <span className="flex shrink-0">
                                                    <Avatar colorClasses={avatarColorClasses(member.color)} initials={member.name.substring(0, 2).toUpperCase()} size={40} avatarId={memberAvatarId(selectedTeam, member.id)} />
                                                </span>
                                                <div className="text-left grow min-w-0">
                                                    <div className="font-semibold text-slate-900 truncate">{member.name}</div>
                                                    <div className="text-xs text-slate-600 capitalize">{roleLabel(member.role)}</div>
                                                    {inviteData?.memberEmail && (
                                                      <div className="text-xs text-slate-600">{t('login.join.noEmailOnFile')}</div>
                                                    )}
                                                </div>
                                                {selectedMemberId === member.id && (
                                                    <span className="material-symbols-outlined text-indigo-600 shrink-0" aria-hidden="true">check_circle</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <div className="w-full border-t border-slate-200"></div>
                                    </div>
                                    <div className="relative flex justify-center text-xs font-medium">
                                        <span className="bg-white px-2 text-slate-500">{t('login.join.or')}</span>
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
                                        className="w-full rounded-lg border border-dashed border-slate-400 bg-white py-2.5 font-semibold text-slate-700 hover:border-indigo-600 hover:bg-indigo-50 hover:text-indigo-700 transition-colors"
                                    >
                                        {t('login.join.notInList')}
                                    </button>
                                {inviteData?.memberEmail && (
                                    <div className={JOINING_AS}>
                                        {tRich('login.join.joiningAs', { email: <strong>{inviteData.memberEmail}</strong> })}
                                    </div>
                                )}
                                {/* Disabled until a name is chosen. Its colours are written
                                    as the state, not as a `disabled:` variant, so the
                                    contrast test measures what a guest reads. */}
                                <button
                                    type="submit"
                                    disabled={!selectedMemberId}
                                    className={selectedMemberId
                                        ? PRIMARY
                                        : 'w-full inline-flex items-center justify-center rounded-lg bg-slate-100 px-4 py-2.5 font-semibold text-slate-500 cursor-not-allowed'}
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
                                        className="self-start -ml-1 inline-flex items-center gap-1 rounded-md px-1 text-sm font-semibold text-indigo-700 hover:text-indigo-800 hover:underline underline-offset-2"
                                    >
                                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">arrow_back</span>
                                        {t('login.join.backToList')}
                                    </button>
                                )}
                                <div>
                                    <label htmlFor="join-name" className={LABEL}>{t('login.join.nameLabel')}</label>
                                    <input
                                        id="join-name"
                                        type="text"
                                        required
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        readOnly={nameLocked}
                                        className={FIELD}
                                        placeholder={t('login.join.namePlaceholder')}
                                        // eslint-disable-next-line jsx-a11y/no-autofocus -- the whole view swapped in on a click; the trigger no longer exists
                                        autoFocus
                                    />
                                </div>
                                {nameLocked && (
                                    <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                        {t('login.join.recognized')}
                                    </div>
                                )}
                                {inviteData?.memberEmail && (
                                    <div className={JOINING_AS}>
                                        {tRich('login.join.joiningAs', { email: <strong>{inviteData.memberEmail}</strong> })}
                                    </div>
                                )}
                                <button type="submit" className={`${PRIMARY} mt-2`}>
                                    {t('login.join.submit')}
                                </button>
                            </>
                        )}
                    </form>
                    <p className="text-xs text-slate-500 text-center mt-5">
                        {t('login.join.footer')}
                    </p>
                </div>
            )}

            {view === 'FORGOT_PASSWORD' && selectedTeam && (
                <div className="flex flex-col">
                    <button onClick={() => setView('LOGIN')} className={BACK}>
                        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">arrow_back</span> {t('common.back')}
                    </button>
                    <div className="text-center mb-6">
                        <h2 className={TITLE}>{t('login.forgot.title')}</h2>
                        <p className={SUBTITLE}>
                            {tRich('login.forgot.subtitle', { teamName: <strong>{selectedTeam.name}</strong> })}
                        </p>
                    </div>
                    {error && <Message tone="error" role="alert" id={ERROR_BANNER_ID}>{feedbackText(error)}</Message>}
                    {successMessage && <Message tone="success">{feedbackText(successMessage)}</Message>}
                    <form onSubmit={handleForgotPassword} className="space-y-4">
                        <div>
                            <label htmlFor="forgot-password-email" className={LABEL}>{t('login.forgot.emailLabel')}</label>
                            <input
                                id="forgot-password-email"
                                type="email"
                                required
                                value={facilitatorEmail}
                                onChange={(e) => handleEmailChange(e.target.value)}
                                autoComplete="email"
                                autoCapitalize="none"
                                spellCheck={false}
                                aria-invalid={emailFieldInvalid || undefined}
                                aria-describedby={emailFieldInvalid ? ERROR_BANNER_ID : undefined}
                                className={FIELD}
                                placeholder={t('login.emailPlaceholder')}
                            />
                        </div>
                        <button type="submit" className={`${PRIMARY} mt-2`}>
                            {t('login.forgot.submit')}
                        </button>
                    </form>
                    <p className="text-xs text-slate-500 text-center mt-4">
                        {t('login.forgot.footer')}
                    </p>
                </div>
            )}

            {view === 'RESET_PASSWORD' && (
                <div className="flex flex-col">
                    <div className="text-center mb-6">
                        <h2 className={TITLE}>{t('login.reset.title')}</h2>
                        <p className={SUBTITLE}>
                            {t('login.reset.subtitle')}
                        </p>
                    </div>
                    {error && <Message tone="error" role="alert">{feedbackText(error)}</Message>}
                    {successMessage && <Message tone="success">{feedbackText(successMessage)}</Message>}
                    <form onSubmit={handleResetPassword} className="space-y-4">
                        <div>
                            <label htmlFor="reset-new-password" className={LABEL}>{t('login.reset.newPasswordLabel')}</label>
                            <input
                                id="reset-new-password"
                                type="password"
                                required
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className={FIELD}
                                placeholder="••••••••"
                                minLength={PASSWORD_MIN_LENGTH}
                            />
                            <p className={HINT}>{t('errors.passwordTooShort', { min: PASSWORD_MIN_LENGTH })}</p>
                        </div>
                        <button type="submit" className={`${PRIMARY} mt-2`}>
                            {t('login.reset.submit')}
                        </button>
                    </form>
                </div>
            )}

          </div>
        </div>
      </main>
    </div>
  );
};

export default TeamLogin;
