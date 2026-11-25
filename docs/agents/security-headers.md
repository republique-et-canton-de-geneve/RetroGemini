# Security Response Headers (audit H36)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


`server/services/securityHeaders.js` sets the headers on **every** response —
it is mounted in `server.js` before the first route, so nothing added later can
escape it. Hand-written rather than `helmet`: it is ten lines of values, and a
production dependency in an air-gapped deployment needs a better reason than
convenience.

**The CSP is enforcing (decision D14), and it is the machine-enforced half of the
offline rule below.** `default-src 'self'` means a CDN font or an external script
added by a future dependency *fails in the browser* instead of failing silently
on the corporate-Wi-Fi phones this product is deployed for. Do not weaken it to
make something load — find the self-hosted equivalent, which the offline rule
requires anyway.

Every directive earns its place, and the four below exist to keep real features working.
Delete one and the feature breaks **silently** — no error, just an empty area of
the UI:

| Directive | Without it |
|---|---|
| `img-src 'self' data:` | Both invite QR codes vanish (`QRCode.toDataURL` produces `data:` URIs), feedback image thumbnails vanish (they are stored and shown as `data:` URIs), and no image too large to send as it is can be attached any more (`utils/feedbackImages.ts` decodes it through a `data:` URL to reduce it, because `blob:` is refused) |
| `style-src 'self' 'unsafe-inline'` | Tailwind's runtime injection is blocked; the app renders as unstyled HTML |
| `connect-src 'self'` | Socket.IO cannot connect — the app loads and never syncs |
| `font-src 'self'` | Material Symbols is blocked; every icon shows its raw ligature name (and the text falls back from Geist to the system font) |

**Two test layers, and neither replaces the other.**
`__tests__/securityHeaders.test.ts` pins the header values and that they reach
both an API response and the SPA fallback. It cannot tell you whether the policy
lets the app *run* — for that, `npm run test:e2e:prod`
(`playwright.prod.config.ts` + `e2e-prod/`) builds the frontend, serves it from
`server.js` and drives it in a real browser.

> ⚠️ **The ordinary e2e suite cannot gate a CSP.** `playwright.config.ts` points
> `baseURL` at Vite on :5173 and proxies only `/api` and Socket.IO, so a header
> set by Express never governs what those tests render: the whole suite stays
> green while production is blank. This is not hypothetical — the QR-code case
> above was caught in review, not by tests. Any change to the policy must be
> verified with `npm run test:e2e:prod`, which CI runs on every pull request.

Compression never touches a header but its own (see *Compression and caching*
below), and a missing `/assets` file is answered by our own handler for one
reason: `send`'s 404 would replace our CSP with `default-src 'none'`.
