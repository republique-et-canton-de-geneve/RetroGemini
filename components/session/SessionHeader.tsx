import React from 'react';
import { RetroSession, User } from '../../types';

interface Props {
  session: RetroSession;
  phases: string[];
  isFacilitator: boolean;
  handleExit: () => void;
  setPhase: (phase: string) => void;
  localTimerSeconds: number;
  timerFinished: boolean;
  timerAcknowledged: boolean;
  acknowledgeTimer: () => void;
  isEditingTimer: boolean;
  timerEditMin: string;
  timerEditSec: string;
  setTimerEditMin: (value: string) => void;
  setTimerEditSec: (value: string) => void;
  saveTimerEdit: () => void;
  setIsEditingTimer: (value: boolean) => void;
  updateSession: (updater: (session: RetroSession) => void) => void;
  addTimeToTimer: (seconds: number) => void;
  localParticipantsPanelCollapsed: boolean;
  setLocalParticipantsPanelCollapsed: (collapsed: boolean) => void;
  participantsCount: number;
  currentUser: User;
  onInvite: () => void;
  formatTime: (seconds: number) => string;
  audioRef: React.RefObject<HTMLAudioElement>;
}

const SessionHeader: React.FC<Props> = ({
  session,
  phases,
  isFacilitator,
  handleExit,
  setPhase,
  localTimerSeconds,
  timerFinished,
  timerAcknowledged,
  acknowledgeTimer,
  isEditingTimer,
  timerEditMin,
  timerEditSec,
  setTimerEditMin,
  setTimerEditSec,
  saveTimerEdit,
  setIsEditingTimer,
  updateSession,
  addTimeToTimer,
  localParticipantsPanelCollapsed,
  setLocalParticipantsPanelCollapsed,
  participantsCount,
  currentUser,
  onInvite,
  formatTime,
  audioRef
}) => (
  <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-50">
    <audio ref={audioRef} src="https://assets.mixkit.co/active_storage/sfx/933/933-preview.mp3" preload="auto" />

    <div className="flex items-center h-full">
      <button onClick={handleExit} className="mr-3 text-slate-400 hover:text-slate-700">
        <span className="material-symbols-outlined">arrow_back</span>
      </button>
      <div className="hidden lg:flex h-full items-center space-x-1">
        {phases.map((phase) => (
          <button
            key={phase}
            onClick={() => (isFacilitator ? setPhase(phase) : null)}
            disabled={!isFacilitator && session.status !== 'CLOSED'}
            className={`phase-nav-btn h-full px-2 text-[10px] font-bold uppercase ${session.phase === phase ? 'active' : 'text-slate-400 disabled:opacity-50'}`}
          >
            {phase.replace('_', ' ')}
          </button>
        ))}
      </div>
    </div>
    <div
      className="flex items-center bg-slate-100 rounded-lg px-3 py-1 mr-4 cursor-pointer hover:bg-slate-200 transition"
      onClick={(event) => {
        if (!isFacilitator) {
          acknowledgeTimer();
          return;
        }
        if (timerFinished && !timerAcknowledged) {
          acknowledgeTimer();
          return;
        }
        if (session.settings.timerRunning) {
          updateSession((draft) => {
            draft.settings.timerRunning = false;
            draft.settings.timerSeconds = localTimerSeconds;
            draft.settings.timerStartedAt = undefined;
          });
        } else if (!isEditingTimer) {
          setTimerEditMin(Math.floor(localTimerSeconds / 60).toString());
          setTimerEditSec((localTimerSeconds % 60).toString());
          setIsEditingTimer(true);
        }
      }}
    >
      {!isEditingTimer ? (
        <>
          <span
            className={`font-mono font-bold text-lg ${timerFinished && !timerAcknowledged ? 'text-red-500 animate-bounce' : localTimerSeconds < 60 ? 'text-red-500' : 'text-slate-700'}`}
          >
            {formatTime(localTimerSeconds)}
          </span>
          {isFacilitator && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                acknowledgeTimer();
                updateSession((draft) => {
                  const isStarting = !draft.settings.timerRunning;
                  draft.settings.timerRunning = isStarting;
                  if (isStarting) {
                    draft.settings.timerStartedAt = Date.now();
                    draft.settings.timerInitial = localTimerSeconds;
                    draft.settings.timerAcknowledged = false;
                  } else {
                    draft.settings.timerSeconds = localTimerSeconds;
                    draft.settings.timerStartedAt = undefined;
                  }
                });
              }}
              className="ml-2 text-slate-500 hover:text-indigo-600"
            >
              <span className="material-symbols-outlined text-lg">
                {session.settings.timerRunning ? 'pause' : 'play_arrow'}
              </span>
            </button>
          )}
          {isFacilitator && (
            <div className="flex items-center ml-2 space-x-1">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  addTimeToTimer(30);
                }}
                className="text-xs bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-700 px-2 py-1 rounded font-bold transition"
                title="Add 30 seconds"
              >
                +30s
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  addTimeToTimer(60);
                }}
                className="text-xs bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-700 px-2 py-1 rounded font-bold transition"
                title="Add 1 minute"
              >
                +1m
              </button>
            </div>
          )}
        </>
      ) : (
        <div
          className="flex items-center space-x-1"
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              saveTimerEdit();
            }
          }}
        >
          <input
            type="text"
            inputMode="numeric"
            value={timerEditMin}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '' || /^\d+$/.test(value)) {
                setTimerEditMin(value);
              }
            }}
            onKeyDown={(event) => event.key === 'Enter' && saveTimerEdit()}
            className="w-16 h-10 text-xl border border-slate-300 rounded px-1 bg-white text-slate-900 text-center font-bold"
            placeholder="MM"
          />
          <span className="text-slate-500 font-bold">:</span>
          <input
            type="text"
            inputMode="numeric"
            value={timerEditSec}
            onChange={(event) => {
              const value = event.target.value;
              if (value === '' || /^\d+$/.test(value)) {
                setTimerEditSec(value);
              }
            }}
            onKeyDown={(event) => event.key === 'Enter' && saveTimerEdit()}
            className="w-16 h-10 text-xl border border-slate-300 rounded px-1 bg-white text-slate-900 text-center font-bold"
            placeholder="SS"
          />
        </div>
      )}
    </div>
    <div className="flex items-center space-x-3">
      <div className="flex items-center text-emerald-600 bg-emerald-50 px-2 py-1 rounded" title="Real-time sync active">
        <span className="material-symbols-outlined text-lg mr-1 animate-pulse">wifi</span>
        <span className="text-xs font-bold hidden sm:inline">Live</span>
      </div>

      {(localParticipantsPanelCollapsed || window.innerWidth < 1024) && (
        <div
          className="flex items-center bg-slate-100 px-3 py-1 rounded cursor-pointer hover:bg-slate-200 transition"
          onClick={() => setLocalParticipantsPanelCollapsed(false)}
          title="Click to expand participants panel"
        >
          <span className="material-symbols-outlined text-lg mr-1 text-slate-600">groups</span>
          <span className="text-xs font-bold text-slate-700">
            {session.phase === 'WELCOME'
              ? `${Object.keys(session.happiness || {}).length}/${participantsCount}`
              : session.phase === 'CLOSE'
              ? `${Object.keys(session.roti || {}).length}/${participantsCount}`
              : `${session.finishedUsers?.length || 0}/${participantsCount}`}
          </span>
          <span className="text-[10px] text-slate-500 ml-1 hidden md:inline">
            {session.phase === 'WELCOME' ? 'finished' : session.phase === 'CLOSE' ? 'voted' : 'finished'}
          </span>
        </div>
      )}

      {isFacilitator && (
        <button onClick={onInvite} className="flex items-center text-slate-500 hover:text-retro-primary" title="Invite / Join">
          <span className="material-symbols-outlined text-xl">qr_code_2</span>
        </button>
      )}
      <div className="flex flex-col items-end mr-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase">User</span>
        <span className="text-sm font-bold text-slate-700">{currentUser.name}</span>
      </div>
      <div className={`w-8 h-8 rounded-full ${currentUser.color} text-white flex items-center justify-center text-xs font-bold shadow-md`}>
        {currentUser.name.substring(0, 2).toUpperCase()}
      </div>
    </div>
  </header>
);

export default SessionHeader;
