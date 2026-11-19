import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { MessageKey } from '../../i18n/translate';
import { RetroSession, User } from '../../types';
import LanguageSwitcher from '../common/LanguageSwitcher';
import { SessionSyncChip } from './SessionConnectionStatus';
import SessionTimer from './SessionTimer';
import { getRetroPhaseDefaultTimerSeconds } from './retroTips';
import { DEFAULT_TIMER_SECONDS } from '../../utils/sessionTimer';
import ViewerAvatarButton from './ViewerAvatarButton';
import { isOpenBoard } from '../../utils/openBoard';

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
  /** The viewer's picture in this session (`sessionAvatarOf`), or null for initials. */
  viewerAvatarId?: string | null;
  /** Opens the avatar picker from the viewer's own avatar. */
  onOpenAvatarPicker?: () => void;
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
  joinDeniedReason = null,
  viewerAvatarId = null,
  onOpenAvatarPicker = () => {}
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
  // An open board has no phases to walk and nobody to wait for: its header
  // names the board where the phase bar would be, and counts the people on it.
  const board = isOpenBoard(session);

  return (
  <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-2 sm:px-4 shrink-0 z-50">
    {/* The phase bar is the part that gives way: the French phase names are a
        quarter longer than the English ones, and the bar scrolls rather than
        pushing the timer, the invite button or the language switcher off the
        right edge. The group never shrinks below the back arrow, which must stay
        visible and tappable — the timer is the next element, and a tap meant for
        "back" that lands on it would pause everyone's timer. */}
    <div className="flex items-center h-full min-w-9">
      <button
        onClick={handleExit}
        aria-label={t('phases.header.leave')}
        className="grid place-items-center shrink-0 w-8 h-8 sm:w-9 sm:h-9 mr-0.5 sm:mr-2 rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
      >
        <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
      </button>
      {board ? (
        <div className="hidden lg:flex h-full items-center min-w-0">
          <span className="truncate text-sm font-semibold text-slate-900" title={session.name}>{session.name}</span>
        </div>
      ) : (
      <div ref={phaseBarRef} className="hidden lg:flex h-full items-center min-w-0 overflow-x-auto [scrollbar-width:none]">
        {phases.map((phase) => (
          <button
            key={phase}
            onClick={() => (isFacilitator ? setPhase(phase) : null)}
            // Only the facilitator moves the session between phases. This was
            // enabled for participants once the session closed, yet the click
            // did nothing: a control that looks live and is not.
            disabled={!isFacilitator}
            // Each phase is a pill centred in the bar; the current one is filled
            // (index.css styles `.phase-nav-btn.active`; its colours are
            // repeated as classes so the contrast tests measure them). A phase
            // a participant cannot press is greyer: it is disabled, which the
            // audit does not hold to the text floor, and stays readable.
            className={`phase-nav-btn h-8 shrink-0 whitespace-nowrap px-1.5 2xl:px-2.5 text-[13px] leading-none ${
              session.phase === phase
                ? 'active bg-indigo-100 text-indigo-700 font-bold'
                : 'font-medium text-slate-600 enabled:hover:bg-slate-100 enabled:hover:text-slate-900 disabled:text-slate-400'
            }`}
          >
            {/* The dictionary holds the names in capitals, which the other
                screens and the tests read; the bar draws them in mixed case. */}
            <span className="inline-block lowercase first-letter:uppercase">{phaseLabel(phase)}</span>
          </button>
        ))}
      </div>
      )}
    </div>
    <SessionTimer
      settings={session.settings}
      phase={session.phase}
      fallbackSeconds={getRetroPhaseDefaultTimerSeconds(session.phase) ?? DEFAULT_TIMER_SECONDS}
      isFacilitator={isFacilitator}
      isLive={isLive}
      onUpdate={(mutate) => updateSession((draft) => mutate(draft.settings))}
    />
    <div className="flex shrink-0 justify-end items-center gap-1 sm:gap-2">
      <button
        type="button"
        onClick={onToggleRetroTips}
        aria-label={isRetroTipsOpen ? t('phases.header.hideTips') : t('phases.header.showTips')}
        title={t('phases.tips.title')}
        // The tips panel is a desktop aid; below md the button's width is worth
        // more to the controls that must stay on screen.
        // An amber tile with the bulb; open, it is a shade deeper and framed.
        className={`hidden md:flex items-center justify-center gap-1 h-9 min-w-9 px-2 rounded-lg transition ${
          isRetroTipsOpen
            ? 'bg-amber-200 text-amber-900 ring-1 ring-amber-400'
            : 'bg-amber-100 text-amber-800 hover:bg-amber-200'
        }`}
      >
        <span className="material-symbols-outlined text-xl! leading-none" aria-hidden="true">tips_and_updates</span>
        {/* Like the participants chip's caption, the label steps aside while the
            phase bar is on screen (lg to 2xl); the button keeps its icon and
            its accessible name. */}
        <span className="hidden text-xs font-semibold 2xl:inline">{t('phases.header.tips')}</span>
      </button>

      {/* On the narrowest phones the reassuring "live" chip steps aside; a lost
          connection, a refused join or a stalled sync always shows. The chip
          decides that itself, since only it knows the sync health. */}
      <SessionSyncChip isLive={isLive} joinDeniedReason={joinDeniedReason} />

      {(localParticipantsPanelCollapsed || window.innerWidth < 1024) && (
        <div
          className="flex items-center gap-0.5 sm:gap-1 h-8 rounded-full border border-slate-200 bg-white px-1.5 sm:px-2.5 cursor-pointer hover:border-slate-300 hover:bg-slate-50 transition"
          onClick={() => setLocalParticipantsPanelCollapsed(false)}
          title={t('phases.header.expandParticipants')}
        >
          <span className="material-symbols-outlined text-lg! leading-none text-slate-600" aria-hidden="true">groups</span>
          <span className="text-xs font-semibold tabular-nums text-slate-700">
            {board
              ? participantsCount
              : session.phase === 'WELCOME'
              ? `${activeCount(session.happiness)}/${participantsCount}`
              : session.phase === 'CLOSE'
              ? `${activeCount(session.roti)}/${participantsCount}`
              : `${activeFinishedCount}/${participantsCount}`}
          </span>
          {/* The caption waits for 2xl: below it the timer shortcuts, the sync
              label and then the phase bar need the room ("ont terminé" is the
              widest of them), and the count alone keeps the chip legible. */}
          <span className="text-xs text-slate-500 hidden 2xl:inline">
            {board
              ? t('phases.header.progressConnected')
              : session.phase === 'CLOSE' ? t('phases.header.progressVoted') : t('phases.header.progressFinished')}
          </span>
        </div>
      )}

      {isFacilitator && (
        <button
          onClick={onInvite}
          className="grid place-items-center shrink-0 w-8 h-8 sm:w-9 sm:h-9 rounded-lg text-slate-600 transition hover:bg-slate-100 hover:text-indigo-700"
          title={t('phases.header.invite')}
          aria-label={t('phases.header.invite')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">qr_code_2</span>
        </button>
      )}
      {/* The switcher is always inline: guests reach it here without leaving
          the session an invite link dropped them into. The identity block
          around it uses the same breakpoints as the health check header's,
          since both headers carry the shared timer. */}
      <LanguageSwitcher className="shrink-0" />
      {/* The name waits for 2xl: below it the phase bar needs the room, and the
          participants panel names everyone anyway. */}
      <div className="hidden 2xl:flex flex-col items-end min-w-0 leading-tight">
        <span className="text-xs font-medium text-slate-500">{t('phases.header.user')}</span>
        <span className="max-w-32 truncate text-sm font-semibold text-slate-900" title={currentUser.name}>{currentUser.name}</span>
      </div>
      {/* The viewer's own avatar opens the avatar picker (AGENTS.md, *Avatars*): at
          every width for a participant, from 360px for a facilitator, whose
          header also carries the invite button and play. */}
      <ViewerAvatarButton
        user={currentUser}
        avatarId={viewerAvatarId}
        onClick={onOpenAvatarPicker}
        visibilityClass={isFacilitator ? 'hidden min-[360px]:flex' : 'flex'}
      />
    </div>
  </header>
  );
};

export default SessionHeader;
