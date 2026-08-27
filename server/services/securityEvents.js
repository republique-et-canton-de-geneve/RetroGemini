import { currentContext } from './logContext.js';
import { redactSecrets } from './structuredLog.js';

/**
 * Audit H45 — a durable, append-only trace of privileged actions.
 *
 * The super admin is one shared password with no per-administrator identity and
 * no second factor. It reads every team's data, renames and deletes teams,
 * downloads and restores backups, and reconfigures the LLM endpoint. Before
 * this, the only record was H44's in-memory ring, which the next rolling update
 * empties — so "a team's retrospectives disappeared: deletion, restore, or
 * bug?" had no answer, and the shared-password model was unfalsifiable in both
 * directions: nothing could show misuse, and nothing could show its absence.
 *
 * **The identity question is answered, not solved** (H45 asks for it to be
 * written down either way): this deployment keeps **one shared super-admin
 * account, and its use is attributed to the person holding the credential.**
 * Per-administrator credentials are a product change — a user model, a grant
 * flow, a revocation path — and the population is small enough that the
 * institution can name who holds the password. The rows below therefore answer
 * *what happened, from where, and whether it worked*; they do not answer *who*
 * beyond that. **What would reopen it:** the credential being shared beyond
 * people who can be named, or an incident where "which of them" is the actual
 * question.
 *
 * **Append-only, precisely.** `dataStore` exposes exactly `appendSecurityEvent`
 * and `listSecurityEvents` — no update, no delete, and a test asserts that
 * surface. The *database* does not enforce it: anyone with SQL access can
 * delete rows, and no application design prevents that. Claim the application
 * guarantee, not the stronger one.
 *
 * **The trail is read from the database, deliberately.** There is no endpoint
 * and no panel: a viewer is a user-visible feature, and this is a hardening
 * change. `k8s/README.md` carries the query an operator runs.
 */

/**
 * The closed set of action names. An investigation greps for these strings, so
 * a typo (`team.delted`) writes a row nobody will ever find — a hole in the
 * trail that looks exactly like an action that never happened. A name outside
 * this set is refused and logged, which fails at the call site instead.
 */
const SECURITY_ACTIONS = Object.freeze({
  SUPER_ADMIN_LOGIN: 'super-admin.login',
  TEAM_DELETE: 'team.delete',
  TEAM_RENAME: 'team.rename',
  TEAM_PASSWORD_CHANGE: 'team.password-change',
  BACKUP_CREATE: 'backup.create',
  BACKUP_DOWNLOAD: 'backup.download',
  BACKUP_RESTORE: 'backup.restore',
  BACKUP_DELETE: 'backup.delete',
  AI_SETTINGS_UPDATE: 'ai-settings.update',
  // Not in H45's own list, and it belongs there: wiping the log viewer is the
  // one action whose *purpose* can be to remove evidence, so a trail that does
  // not record it has a hole exactly where it matters. The row survives the
  // clear, because it is in the database and the ring is in memory.
  LOGS_CLEAR: 'logs.clear'
});

const KNOWN_ACTIONS = new Set(Object.values(SECURITY_ACTIONS));

/** Bounds one row. `detail` is free-form, so it is the one that can run away. */
const MAX_DETAIL_LENGTH = 1000;

const serializeDetail = (detail) => {
  if (detail === undefined || detail === null) return null;
  let text;
  try {
    text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  } catch {
    // A circular object is a caller bug, not a reason to lose the event: the
    // row still records what happened, it just cannot say more.
    text = '[unserializable detail]';
  }
  if (typeof text !== 'string') return null;
  // The same redaction the log records pass through. `detail` is written by
  // call sites that also handle passwords and API keys, and unlike a log line
  // this one outlives the process that produced it.
  return redactSecrets(text).slice(0, MAX_DETAIL_LENGTH);
};

/**
 * @typedef {Object} SecurityEvent
 * @property {string} action  One of `SECURITY_ACTIONS`.
 * @property {string} actor   `super-admin`, `team:<id>`, `password-reset`, `anonymous`.
 * @property {'success'|'failure'} outcome
 * @property {string|null} [target]  What was acted on: a team id, a backup id.
 * @property {unknown} [detail]      Redacted and truncated before it is stored.
 */

/**
 * The recorder route registrars fall back to when their caller supplies none.
 *
 * Defined here, once, rather than repeated as an inline default in each
 * registrar: three copies would be three shapes to keep in step, and the point
 * of the default is that the *only* thing separating a wired deployment from a
 * silent one is `server.js`. `__tests__/securityEventAudit` asserts that wiring
 * against `server.js` itself.
 *
 * @type {{ record: (req: { ip?: string }, event: SecurityEvent) => Promise<void> }}
 */
const NO_OP_SECURITY_EVENTS = Object.freeze({ record: async () => {} });

/**
 * `req` is the first argument on purpose. The source IP is a required field of
 * every row, and a signature that takes the request cannot be called in a way
 * that forgets it.
 *
 * @param {{ dataStore: { appendSecurityEvent: (event: object) => Promise<void> }, clock?: () => string }} deps
 */
const createSecurityEventLog = ({ dataStore, clock = () => new Date().toISOString() }) => {
  /**
   * @param {{ ip?: string }} req
   * @param {SecurityEvent} event
   * @returns {Promise<void>}
   */
  const record = async (req, { action, actor, outcome, target = null, detail = null } = /** @type {any} */ ({})) => {
    if (!KNOWN_ACTIONS.has(action)) {
      console.warn(`[Audit] Refusing to record unknown security action "${action}"`);
      return;
    }

    try {
      await dataStore.appendSecurityEvent({
        createdAt: clock(),
        action,
        actor: actor || 'unknown',
        outcome: outcome === 'success' ? 'success' : 'failure',
        target: target ?? null,
        sourceIp: req?.ip ?? null,
        correlationId: currentContext()?.correlationId ?? null,
        detail: serializeDetail(detail)
      });
    } catch (err) {
      // Never let the audit write break the operation it records: a restore
      // that worked must not be reported as failed because an INSERT did not.
      // The loss is loud rather than silent, which is the whole trade.
      console.warn(`[Audit] Failed to record security event "${action}"`, err);
    }
  };

  return { record };
};

export { createSecurityEventLog, SECURITY_ACTIONS, MAX_DETAIL_LENGTH, NO_OP_SECURITY_EVENTS };
