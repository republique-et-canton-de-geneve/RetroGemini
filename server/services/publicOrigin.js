/**
 * Audit H4 / decision D3 — where a link this server mails is allowed to point.
 *
 * `/api/send-password-reset` and `/api/send-invite` both build their mail around
 * a URL taken from the request body, and both validated the *protocol* only. The
 * reset route is the serious one: it appends a live reset token to that URL and
 * mails the result to the real facilitator, from the deployment's own SMTP
 * identity. An attacker who knows a team name and its facilitator address (team
 * names are listed by `/api/team/list`) could therefore have the system itself
 * deliver a convincing mail carrying a working token to a host they control.
 *
 * The fix is to stop trusting the caller for the *origin*:
 *
 *   - `PUBLIC_BASE_URL`, when set, is the canonical public URL of the
 *     deployment. Its origin **and path** win, and only the query and fragment
 *     survive from the caller — an operator who configures `https://host/app/`
 *     has declared where the app lives, and a caller must not move a link out
 *     of it.
 *   - When it is unset, the origin comes from the request itself (`req.protocol`
 *     + the `Host` header, both already governed by `TRUST_PROXY`), and the
 *     caller's path/query/fragment are kept. Every legitimate caller sends
 *     `window.location.origin`, which *is* that origin, so this reproduces
 *     today's link byte for byte and changes only what an attacker gets.
 *
 * Nothing here replaces `sanitizeEmailLink`: that one still guards the protocol
 * before the URL reaches an HTML attribute. This module answers the separate
 * question of which host a link may name.
 */

const MAX_URL_LENGTH = 4096;

/** Parse a value as an http(s) URL, or return null. */
const parseHttpUrl = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
};

/**
 * The origin the request itself arrived on. `req.protocol` honours
 * `X-Forwarded-Proto` when Express is configured to trust the proxy, which is
 * the same setting the rate limiters already depend on.
 */
const requestBaseUrl = (req) => {
  const host = typeof req?.get === 'function' ? req.get('host') : undefined;
  if (typeof host !== 'string' || !host) return null;

  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return parseHttpUrl(`${protocol}://${host}`);
};

const createPublicOriginResolver = ({ env = process.env } = {}) => {
  const configuredBaseUrl = () => parseHttpUrl(env.PUBLIC_BASE_URL);

  /**
   * Rebuild `candidate` on this deployment's own origin.
   *
   * Typed structurally rather than as an `express.Request`: the two properties
   * below are all this needs, and demanding the full interface would force
   * every caller and test to fabricate ~100 unrelated members.
   *
   * @param {{ protocol?: string, get?: (name: string) => string | undefined }} req
   * @param {string} candidate - the caller-supplied link
   * @returns {string} the link to mail, or '' when there is none to build
   */
  const resolveEmailLink = (req, candidate) => {
    const requested = parseHttpUrl(candidate);
    if (!requested) return '';

    const configured = configuredBaseUrl();
    const base = configured ?? requestBaseUrl(req);
    // No configured origin and no Host header: there is no trustworthy origin
    // to build on, and the caller's is exactly what must not be trusted.
    if (!base) return '';

    const link = new URL(base.toString());
    if (!configured) {
      // Assigned, never resolved: `new URL('//evil.example/x', base)` would
      // resolve to evil.example, while assigning `pathname` can only ever
      // change the path of the URL it is assigned to.
      //
      // The leading slashes are collapsed for readability, not for safety: a
      // path of `//evil.example/x` stays on this origin either way, but
      // `https://host//evil.example/x` in a mail reads like a link to
      // evil.example to a human skimming it.
      link.pathname = requested.pathname.replace(/^\/+/, '/');
    }
    link.search = requested.search;
    link.hash = requested.hash;

    if (link.origin !== requested.origin) {
      console.warn(
        `[Server] Rewrote a mailed link from ${requested.origin} to ${link.origin} (audit H4)`
      );
    }

    return link.toString();
  };

  return { resolveEmailLink, hasConfiguredBaseUrl: () => configuredBaseUrl() !== null };
};

export { createPublicOriginResolver };
