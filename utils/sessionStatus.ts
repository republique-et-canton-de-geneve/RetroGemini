/**
 * The lifecycle status of a retrospective or a health check. One rule for
 * both: **a session is finished once it has reached its Close phase, and stays
 * finished.**
 *
 * Opening Close writes CLOSED with the facilitator's phase change, so the
 * status no longer depends on the facilitator leaving through the right
 * button. Health checks used to be closed only by their exit button, so a
 * closed tab — or that one last write being lost — left them "in progress"
 * for good, and a participant landing on the dashboard was sent into the
 * first health check still in progress, months later.
 *
 * Nothing reopens a finished session as a side effect. "View results" opens a
 * finished session at Close, and its facilitator then clicks back through the
 * phases to read the detail: if that browsing reopened it, the stuck "in
 * progress" came straight back through the most ordinary path there is.
 */

export type SessionStatus = 'IN_PROGRESS' | 'CLOSED';

/**
 * The status to store, display and route on. A stored CLOSED is final, and a
 * session that reached its Close phase is finished even if the stored status
 * never caught up: health checks saved before the status followed the phase
 * are exactly that shape, and reading them this way heals them without a data
 * migration.
 */
export const effectiveSessionStatus = (session: { status: SessionStatus; phase: string }): SessionStatus =>
  session.status === 'CLOSED' || session.phase === 'CLOSE' ? 'CLOSED' : 'IN_PROGRESS';

export const isSessionInProgress = (session: { status: SessionStatus; phase: string }): boolean =>
  effectiveSessionStatus(session) === 'IN_PROGRESS';
