/**
 * Security response headers (audit H36).
 *
 * The application shipped with none of these on any production path. The three
 * in `nginx.conf` are opt-in dev tooling (`docker-compose --profile with-proxy`,
 * "optional, for testing production setup"), while Kubernetes/OpenShift,
 * Railway, Render and plain Docker all serve straight from `server.js`.
 *
 * Written by hand rather than pulling in `helmet`: this is ten lines of header
 * values, and a production dependency added to an air-gapped deployment is a
 * supply-chain surface that has to be justified by more than convenience.
 *
 * ── Why the CSP matters more here than in a typical app ──────────────────────
 * The offline guarantee ("NEVER load resources from external URLs", AGENTS.md)
 * is otherwise enforced only by convention and code review. Nothing stops a
 * dependency or a pasted snippet from adding a CDN font that works perfectly on
 * a developer's laptop and leaves a blank box on the corporate-Wi-Fi phones this
 * product exists for. `default-src 'self'` makes the browser enforce it, and
 * removes the escalation path from any future HTML injection.
 *
 * ── Every directive below is here for a reason; do not "tidy" one away ───────
 * Each non-obvious one names the feature that breaks without it. Two were found
 * by review rather than by testing, which is the point: a CSP fails *silently*
 * in the part of the app nobody clicked.
 */

// `connect-src` covers WebSockets. `'self'` matches same-origin ws:/wss: under
// CSP Level 3, which is how Socket.IO connects here — and the zero-downtime
// guarantee rides entirely on that channel, so this is the directive to be most
// careful with. `e2e/production-csp.spec.ts` drives a real session against the
// built bundle precisely to keep this honest.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  // Tailwind injects styles at runtime, and React sets inline style attributes.
  "style-src 'self' 'unsafe-inline'",
  // `data:` is required: InviteModal renders the invite and Wi-Fi QR codes from
  // `QRCode.toDataURL`, i.e. data: URIs. Dropping this blocks both QR codes
  // while every existing e2e test stays green — they open the modal but read
  // only the invitation link (Codex, PR #417).
  "img-src 'self' data:",
  // Material Symbols ships from public/fonts, so no external font origin.
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // The clickjacking guard, and the modern counterpart of X-Frame-Options.
  "frame-ancestors 'none'",
].join('; ');

const createSecurityHeaders = ({ env = process.env } = {}) => (_req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP_DIRECTIVES);
  // Kept alongside frame-ancestors for browsers that honour only the old header.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Nothing here needs the camera, the microphone or geolocation.
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS only in production, and only ever over HTTPS: sending it from a plain
  // HTTP dev server would pin `localhost` to HTTPS in the developer's browser
  // for a year, breaking every other local project on the same host. No
  // `preload`, and no `includeSubDomains` — this app does not own the whole
  // domain on a shared institutional host, and both are hard to walk back.
  if (env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }

  next();
};

export { createSecurityHeaders, CSP_DIRECTIVES };
