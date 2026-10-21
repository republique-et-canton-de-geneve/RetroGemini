/**
 * The envelope a team's Jira token is stored in (`team-secret:{teamId}`).
 *
 * AES-256-GCM under a key derived from SESSION_TOKEN_SECRET
 * (`tokenService.deriveKey('jira-token/v1')`), so a dump of the database alone
 * holds ciphertext and nothing that opens it. The key is never stored.
 *
 * ## What the authenticated data binds
 *
 * `team-secret:<teamId>|<base URL>`, with the base URL in its canonical form
 * (`parseJiraBaseUrl`). Neither half is a secret; binding them means a sealed
 * token opens only for the team it was set by and only for the Jira it was
 * checked against:
 *
 *  - a row copied under another team's key fails to open instead of handing
 *    that team the first one's Jira access;
 *  - when the super admin changes the Jira address, every stored token fails to
 *    open, so a token is never sent to a server it was not checked against.
 *    The settings then ask the team for it again.
 *
 * The canonical form matters: `HTTPS://Jira.example.org/` and
 * `https://jira.example.org` are one Jira, and a re-save of the console form
 * with another spelling must not void every team's token.
 *
 * ## Failure is `null`, never a throw
 *
 * `openTeamSecret` answers `null` for every reason it cannot open an envelope:
 * another key (the secret was rotated, or was never stable), another team or
 * address, a changed byte, another envelope version, a malformed field. The
 * caller reports "enter the token again"; a throw there would be a 500 on a
 * status read. Sealing, by contrast, throws on a bad argument: that is a caller
 * bug, and storing an envelope nothing can open would hide it.
 *
 * The tag length is pinned to 16 bytes on the cipher and the decipher and
 * checked before decryption. GCM otherwise accepts a truncated tag, and a short
 * tag can be forged by brute force.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { parseJiraBaseUrl } from '../../utils/jira.js';

const ALGORITHM = 'aes-256-gcm';
const ENVELOPE_VERSION = 1;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const isKey = (key) => Buffer.isBuffer(key) && key.length === KEY_LENGTH;

const additionalData = (teamId, canonicalBaseUrl) => Buffer.from(`team-secret:${teamId}|${canonicalBaseUrl}`, 'utf8');

// A base64url field decoded, or null when it is not one. `Buffer.from` would
// silently skip characters outside the alphabet, so the text is checked first.
const decodeField = (value) => (typeof value === 'string' && BASE64URL.test(value) ? Buffer.from(value, 'base64url') : null);

/**
 * Seals `plaintext` for one team and one Jira address.
 *
 * @param {{ key: Buffer, teamId: string, baseUrl: string, plaintext: string }} input
 * @returns {{ v: 1, iv: string, tag: string, ct: string }} base64url fields
 * @throws {TypeError} on a key that is not 32 bytes, an empty team id, an
 *   address that is not a Jira base URL, or a plaintext that is not a non-empty string
 */
const sealTeamSecret = ({ key, teamId, baseUrl, plaintext }) => {
  if (!isKey(key)) throw new TypeError('sealTeamSecret: the key must be a 32-byte Buffer');
  if (typeof teamId !== 'string' || teamId === '') throw new TypeError('sealTeamSecret: the team id must be a non-empty string');
  const canonicalBaseUrl = parseJiraBaseUrl(baseUrl);
  if (!canonicalBaseUrl) throw new TypeError('sealTeamSecret: the address is not a Jira base URL');
  if (typeof plaintext !== 'string' || plaintext === '') throw new TypeError('sealTeamSecret: the plaintext must be a non-empty string');

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  cipher.setAAD(additionalData(teamId, canonicalBaseUrl));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ct: ct.toString('base64url')
  };
};

/**
 * Opens an envelope sealed by `sealTeamSecret` for the same team and address.
 *
 * @param {{ key: Buffer, teamId: string, baseUrl: string, envelope: unknown }} input
 * @returns {string | null} the plaintext, or `null` when it cannot be opened
 */
const openTeamSecret = ({ key, teamId, baseUrl, envelope }) => {
  if (!isKey(key) || typeof teamId !== 'string' || teamId === '') return null;
  const canonicalBaseUrl = parseJiraBaseUrl(baseUrl);
  if (!canonicalBaseUrl) return null;
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return null;
  if (envelope.v !== ENVELOPE_VERSION) return null;

  const iv = decodeField(envelope.iv);
  const tag = decodeField(envelope.tag);
  const ct = decodeField(envelope.ct);
  if (!iv || iv.length !== IV_LENGTH || !tag || tag.length !== TAG_LENGTH || !ct) return null;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAAD(additionalData(teamId, canonicalBaseUrl));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // The tag did not verify: another key, team or address, or a changed byte.
    return null;
  }
};

export { openTeamSecret, sealTeamSecret };
