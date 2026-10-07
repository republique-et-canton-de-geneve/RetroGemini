/**
 * The lifecycle status of a retrospective or a health check, derived from its
 * phase. Both session types end in a `CLOSE` phase, and opening that phase is
 * what ends the session: the status is written at that moment, by the
 * facilitator's phase change, so it reaches the server with the same write
 * that every participant receives.
 *
 * Writing it at the phase change rather than on the way out is the point.
 * Health checks used to be closed only when the facilitator clicked their exit
 * button, so closing the tab at the end — or that one last write being lost —
 * left them "in progress" for good, and a participant landing on the dashboard
 * was then sent into that old health check.
 */

export type SessionStatus = 'IN_PROGRESS' | 'CLOSED';

export const statusForPhase = (phase: string): SessionStatus =>
  phase === 'CLOSE' ? 'CLOSED' : 'IN_PROGRESS';

/**
 * The status to display and to route on. A session that reached its Close
 * phase is finished even if the stored status never caught up: health checks
 * saved before the status followed the phase are exactly that shape, and
 * reading them this way heals them without a data migration.
 */
export const effectiveSessionStatus = (session: { status: SessionStatus; phase: string }): SessionStatus =>
  session.status === 'CLOSED' ? 'CLOSED' : statusForPhase(session.phase);

export const isSessionInProgress = (session: { status: SessionStatus; phase: string }): boolean =>
  effectiveSessionStatus(session) === 'IN_PROGRESS';
