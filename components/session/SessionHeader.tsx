import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { MessageKey } from '../../i18n/translate';
import { RetroSession, User } from '../../types';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { SessionSyncChip } from './SessionConnectionStatus';
import SessionTimer from './SessionTimer';
import { getRetroPhaseDefaultTimerSeconds } from './retroTips';
import { DEFAULT_TIMER_SECONDS } from '../../utils/sessionTimer';

interface Props {
  session: RetroSession;
  phases: string[];
  isFacilitator: boolean;
  handleExit: () => void;
  setPhase: (phase: string) => void;
  // Used by the timer alone: its changes go through the session's own write.
  updateSession: (updater: (session: RetroSession) => void) => void;
  localParticipantsPanelCollapsed: boolean;
  setLocalParticipantsPanelCollapsed: (collapsed: boolean) => void;
  participantsCount: number;
  currentUser: User;
  onInvite: () => void;
  isRetroTipsOpen: boolean;
  onToggleRetroTips: () => void;
  isLive?: boolean;
  // Non-null once the server refused the socket join (audit H12): the chip then
  // says "signed out" rather than "reconnecting", which would never resolve.
  joinDeniedReason?: string | null;
}

const SessionHeader: React.FC<Props> = ({
  session,
  phases,
  isFacilitator,
  handleExit,
  setPhase,
  updateSession,
  localParticipantsPanelCollapsed,
  setLocalParticipantsPanelCollapsed,
  participantsCount,
  currentUser,
  onInvite,
  isRetroTipsOpen,
  onToggleRetroTips,
  isLive = true,
  joinDeniedReason = null
}) => {
  const { t, language } = useTranslation();
  // When the bar is narrower than its phases it scrolls, and nothing would
  // bring the current phase back into view. Three things move the phases: the
  // retro moving on, the window changing size (a tablet turned to landscape
  // shows the bar from lg) and a language switch (the French labels are
  // longer) — the last two leave the current phase where it was.
  const phaseBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reveal = () => {
      const active = phaseBarRef.current?.querySelector<HTMLElement>('.phase-nav-btn.active');
      active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    };
    reveal();
    window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [session.phase, language]);

  // The phase ids are internal codes; `common.phase.*` holds how the navigation
  // names them (the English values are exactly the id with its underscore
  // replaced). An id with no entry keeps that old rendering instead of showing
  // a raw message key.
  const phaseLabel = (phase: string) => {
    const key = `common.phase.${phase}` as MessageKey;
    const label = t(key);
    return label === key ? phase.replace('_', ' ') : label;
  };
  // Participants marked as having left the retro are not counted in the
  // compact progress indicator (participantsCount already excludes them).
  const leftSet = new Set(session.leftUsers ?? []);
  const activeCount = (record: Record<string, number> | undefined) =>
    Object.keys(record || {}).filter((id) => !leftSet.has(id)).length;
  const activeFinishedCount = (session.finishedUsers || []).filter((id) => !leftSet.has(id)).length;

  return (
  <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-2 sm:px-4 shrink-0 z-50">
    {/* The phase bar is the part that gives way: the French phase names are a
        quarter longer than the English ones, and the bar scrolls rather than
        pushing the timer, the invite button or the language switcher off the
        right edge. The group never shrinks below the back arrow, which must stay
        visible and tappable — the timer is the next element, and a tap meant for
        "back" that lands on it would pause everyone's timer. */}
    <div className="flex items-center h-full min-w-9">
      <button onClick={handleExit} aria-label={t('phases.header.leave')} className="shrink-0 mr-2 sm:mr-3 text-slate-500 hover:text-slate-700">
        <span className="material-symbols-outlined">arrow_back</span>
      </button>
      <div ref={phaseBarRef} className="hidden lg:flex h-full items-center space-x-1 min-w-0 overflow-x-auto [scrollbar-width:none]">
        {phases.map((phase) => (
          <button
            key={phase}
            onClick={() => (isFacilitator ? setPhase(phase) : null)}
            // Only the facilitator moves the session between phases. This was
            // enabled for participants once the session closed, yet the click
            // did nothing: a control that looks live and is not.
            disabled={!isFacilitator}
            className={`phase-nav-btn h-full shrink-0 whitespace-nowrap px-1 2xl:px-2 text-[10px] font-bold uppercase ${session.phase === phase ? 'active' : 'text-slate-500 disabled:opacity-50'}`}
          >
            {phaseLabel(phase)}
          </button>
        ))}
      </div>
    </div>
    <SessionTimer
      settings={session.settings}
      phase={session.phase}
      fallbackSeconds={getRetroPhaseDefaultTimerSeconds(session.phase) ?? DEFAULT_TIMER_SECONDS}
      isFacilitator={isFacilitator}
      isLive={isLive}
      onUpdate={(mutate) => updateSession((draft) => mutate(draft.settings))}
    />
    <div className="flex shrink-0 justify-end items-center space-x-1 sm:space-x-3">
      <button
        type="button"
        onClick={onToggleRetroTips}
        aria-label={isRetroTipsOpen ? t('phases.header.hideTips') : t('phases.header.showTips')}
        title={t('phases.tips.title')}
        // The tips panel is a desktop aid; below md the button's width is worth
        // more to the controls that must stay on screen.
        className={`hidden md:flex items-center rounded-lg border px-2 py-1 transition ${
          isRetroTipsOpen
            ? 'border-amber-300 bg-amber-100 text-amber-800'
            : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
        }`}
      >
        <span className="material-symbols-outlined text-lg">tips_and_updates</span>
        {/* Like the participants chip's caption, the label steps aside while the
            phase bar is on screen (lg to 2xl); the button keeps its icon and
            its accessible name. */}
        <span className="ml-1 hidden text-xs font-bold 2xl:inline">{t('phases.header.tips')}</span>
      </button>

      {/* On the narrowest phones the reassuring "live" chip steps aside; a lost
          connection or a refused join always shows. */}
      <div className={isLive && joinDeniedReason === null ? 'hidden min-[400px]:block' : ''}>
        <SessionSyncChip isLive={isLive} joinDeniedReason={joinDeniedReason} />
      </div>

      {(localParticipantsPanelCollapsed || window.innerWidth < 1024) && (
        <div
          className="flex items-center bg-slate-100 px-1.5 sm:px-3 py-1 rounded-sm cursor-pointer hover:bg-slate-200 transition"
          onClick={() => setLocalParticipantsPanelCollapsed(false)}
          title={t('phases.header.expandParticipants')}
        >
          <span className="material-symbols-outlined text-lg mr-1 text-slate-600">groups</span>
          <span className="text-xs font-bold text-slate-700">
            {session.phase === 'WELCOME'
              ? `${activeCount(session.happiness)}/${participantsCount}`
              : session.phase === 'CLOSE'
              ? `${activeCount(session.roti)}/${participantsCount}`
              : `${activeFinishedCount}/${participantsCount}`}
          </span>
          {/* The caption waits for 2xl: below it the timer shortcuts, the sync
              label and then the phase bar need the room ("ont terminé" is the
              widest of them), and the count alone keeps the chip legible. */}
          <span className="text-[10px] text-slate-500 ml-1 hidden 2xl:inline">
            {session.phase === 'CLOSE' ? t('phases.header.progressVoted') : t('phases.header.progressFinished')}
          </span>
        </div>
      )}

      {isFacilitator && (
        <button onClick={onInvite} className="flex items-center text-slate-500 hover:text-retro-primary" title={t('phases.header.invite')} aria-label={t('phases.header.invite')}>
          <span className="material-symbols-outlined text-xl">qr_code_2</span>
        </button>
      )}
      {/* The switcher is always inline: guests reach it here without leaving
          the session an invite link dropped them into. The identity block
          around it uses the same breakpoints as the health check header's,
          since both headers carry the shared timer. */}
      <LanguageSwitcher className="shrink-0" />
      {/* The name waits for 2xl: below it the phase bar needs the room, and the
          participants panel names everyone anyway. */}
      <div className="hidden 2xl:flex flex-col items-end mr-2 min-w-0">
        <span className="text-[10px] font-bold text-slate-500 uppercase">{t('phases.header.user')}</span>
        <span className="max-w-32 truncate text-sm font-bold text-slate-700" title={currentUser.name}>{currentUser.name}</span>
      </div>
      {/* The name and initials show from sm up; on a phone their width goes to
          the controls (the participants panel still names everyone). */}
      <div className={`w-8 h-8 shrink-0 rounded-full ${currentUser.color} text-white hidden sm:flex items-center justify-center text-xs font-bold shadow-md`}>
        {currentUser.name.substring(0, 2).toUpperCase()}
      </div>
    </div>
  </header>
  );
};

export default SessionHeader;
