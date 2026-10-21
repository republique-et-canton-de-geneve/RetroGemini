/**
 * What the Jira routes know about the deployment's Jira and a team's token,
 * read from the store alone — never from Jira.
 *
 * ## The connection (`jira-settings`)
 *
 * Written by the super admin's console, read strictly (`loadJiraSettings`
 * propagates an error): a failed read must answer 500, not "Jira is not
 * configured", or every team's buttons would vanish on one database hiccup.
 * The base URL is parsed again on every read, so a value stored by any other
 * path is either the canonical address or no address at all.
 *
 * ## A team's token (`team-secret:{teamId}`)
 *
 * `{ jira: { v, iv, tag, ct, baseUrl, connectedAs, deploymentType, version,
 * setAt, refusedAt? } }`. `iv`, `tag` and `ct` are the sealed credential
 * (`secretBox.js`): `{ token, email? }` as JSON, bound to the team and to the
 * canonical base URL it was checked against. Everything else is in clear and
 * is description, never authority:
 *
 *  - `baseUrl` is kept for one diagnosis only. When the envelope does not open
 *    with the current address, comparing the two tells "the super admin changed
 *    the address" (`address_changed`) from "the key changed"
 *    (`SESSION_TOKEN_SECRET` rotated or lost: `unreadable`). Nothing is ever
 *    sent to it: the address a token travels to is the configured one, and the
 *    envelope opens only for that one.
 *  - `connectedAs`, `deploymentType` and `version` are what Jira said when the
 *    token was checked; `setAt` dates it; `refusedAt` is set when Jira later
 *    answered 401 to it (see `markRefused`).
 */

import { isJiraCredential } from './jiraClient.js';
import { openTeamSecret, sealTeamSecret } from './secretBox.js';
import { parseJiraBaseUrl, validateJiraTarget } from '../../utils/jira.js';

/** The HKDF purpose of the key that seals a team's Jira token. */
export const JIRA_TOKEN_KEY_PURPOSE = 'jira-token/v1';

const TEXT_MAX_LENGTH = 255;
const textOrNull = (value) => (typeof value === 'string' && value !== '' ? value.slice(0, TEXT_MAX_LENGTH) : null);

/**
 * The connection as the routes use it. `enabled` is true only when the console
 * turned it on *and* a valid address is stored; `baseUrl` is the canonical
 * address whenever one is stored, enabled or not.
 *
 * @param {{ loadJiraSettings: () => Promise<unknown> }} dataStore
 * @returns {Promise<{ enabled: boolean, baseUrl: string | null, allowSelfSignedCerts: boolean }>}
 */
export const readJiraConnection = async (dataStore) => {
  const settings = await dataStore.loadJiraSettings();
  const baseUrl = parseJiraBaseUrl(settings?.baseUrl);
  return {
    enabled: settings?.enabled === true && baseUrl !== null,
    baseUrl,
    allowSelfSignedCerts: settings?.allowSelfSignedCerts === true
  };
};

const envelopeOf = (row) => {
  const jira = row && typeof row === 'object' ? row.jira : null;
  return jira && typeof jira === 'object' && !Array.isArray(jira) ? jira : null;
};

// The same envelope: the one a request read is still the one stored. `iv` is
// random per seal, so two tokens saved in the same millisecond still differ.
const sameEnvelope = (a, b) => !!a && !!b && a.setAt === b.setAt && a.iv === b.iv;

/**
 * @param {object} deps
 * @param {object} deps.dataStore
 * @param {{ deriveKey: (purpose: string) => Buffer }} deps.tokenService
 * @param {() => Date} [deps.now]
 */
export const createJiraCredentials = ({ dataStore, tokenService, now = () => new Date() }) => {
  const key = () => tokenService.deriveKey(JIRA_TOKEN_KEY_PURPOSE);

  const openCredential = (teamId, baseUrl, envelope) => {
    if (!baseUrl) return null;
    const plaintext = openTeamSecret({ key: key(), teamId, baseUrl, envelope });
    if (plaintext === null) return null;
    try {
      const credential = JSON.parse(plaintext);
      return isJiraCredential(credential) ? credential : null;
    } catch {
      return null;
    }
  };

  /**
   * The team's token as the current connection can use it. `configured` says a
   * token is stored; `credential` is what to send, or `null` with `reason`.
   *
   * @param {string} teamId
   * @param {string | null} baseUrl The current canonical address.
   */
  const read = async (teamId, baseUrl) => {
    const envelope = envelopeOf(await dataStore.loadTeamSecret(teamId));
    if (!envelope) return { configured: false, envelope: null, credential: null, reason: null };
    const credential = openCredential(teamId, baseUrl, envelope);
    if (credential) return { configured: true, envelope, credential, reason: null };
    const checkedAgainst = parseJiraBaseUrl(envelope.baseUrl);
    return {
      configured: true,
      envelope,
      credential: null,
      reason: checkedAgainst && checkedAgainst !== baseUrl ? 'address_changed' : 'unreadable'
    };
  };

  /**
   * Seals and stores a token Jira has just accepted, replacing any other.
   *
   * @param {string} teamId
   * @param {object} input
   * @param {string} input.baseUrl The canonical address the token was checked against.
   * @param {{ token: string, email?: string }} input.credential
   * @param {string | null} input.connectedAs
   * @param {{ deploymentType: string, version: string }} input.serverInfo
   */
  const save = async (teamId, { baseUrl, credential, connectedAs, serverInfo }) => {
    const sealed = sealTeamSecret({ key: key(), teamId, baseUrl, plaintext: JSON.stringify(credential) });
    await dataStore.saveTeamSecret(teamId, {
      jira: {
        ...sealed,
        baseUrl,
        connectedAs,
        deploymentType: serverInfo.deploymentType,
        version: serverInfo.version,
        setAt: now().toISOString()
      }
    });
  };

  /**
   * Records that Jira answered 401 to the token in `envelope` — only while it
   * is still the stored one. A request that started before the token was
   * replaced must not mark the new token refused, so the re-read, the
   * comparison and the write are one compare-and-swap (`updateTeamSecret`).
   * Best-effort: the refusal is the request's answer either way.
   *
   * @param {string} teamId
   * @param {object} envelope The envelope the failing call was made with.
   * @returns {Promise<boolean>} whether it was recorded
   */
  const markRefused = async (teamId, envelope) => {
    try {
      return await dataStore.updateTeamSecret(teamId, (row) => {
        const stored = envelopeOf(row);
        if (!sameEnvelope(stored, envelope) || stored.refusedAt) return null;
        return { ...row, jira: { ...stored, refusedAt: now().toISOString() } };
      });
    } catch (err) {
      console.warn(`[Server] Jira: could not record that the token of team ${JSON.stringify(teamId)} was refused`, err);
      return false;
    }
  };

  return { read, save, markRefused, remove: (teamId) => dataStore.deleteTeamSecret(teamId) };
};

/**
 * The `JiraStatus` a team's screens read (`types.ts`). Built from stored rows
 * only: it never calls Jira, so the status can be read on every Review entry
 * and every reconnect without Jira seeing any of it.
 *
 * @param {object} input
 * @param {{ enabled: boolean, baseUrl: string | null }} input.connection
 * @param {unknown} input.target The team record's `jiraTarget`.
 * @param {{ configured: boolean, envelope: object | null, credential: object | null, reason: string | null }} input.secret
 */
export const jiraStatusOf = ({ connection, target, secret }) => {
  const validTarget = target === undefined || target === null ? null : validateJiraTarget(target);
  const { envelope } = secret;
  return {
    enabled: connection.enabled,
    baseUrl: connection.baseUrl,
    target: validTarget?.ok ? validTarget.target : null,
    token: {
      configured: secret.configured,
      usable: secret.credential !== null,
      reason: secret.reason,
      connectedAs: textOrNull(envelope?.connectedAs),
      deploymentType: envelope?.deploymentType === 'Cloud' || envelope?.deploymentType === 'Server' ? envelope.deploymentType : null,
      setAt: textOrNull(envelope?.setAt),
      refusedAt: textOrNull(envelope?.refusedAt)
    }
  };
};
