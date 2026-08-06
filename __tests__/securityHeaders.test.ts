import { describe, it, expect } from 'vitest';
import express from 'express';
import { createSecurityHeaders, CSP_DIRECTIVES } from '../server/services/securityHeaders.js';
import { request } from './helpers/routeTestServer';

/**
 * Audit H36 — the application shipped with no security response headers on any
 * production path.
 *
 * What this suite can and cannot do, stated plainly because the distinction is
 * what a previous revision of the tracker got wrong: it pins the header
 * *values*, and that a header reaches both an API response and the SPA
 * fallback. It cannot tell you whether the policy lets the real application
 * run — that needs a browser loading the built bundle, which is
 * `e2e/production-csp.spec.ts`. Neither test replaces the other.
 */

const parseCsp = (header: string) =>
  new Map(
    header.split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/);
      return [name, values];
    }),
  );

const appWithHeaders = (env: Record<string, string> = {}) => {
  const app = express();
  app.use(createSecurityHeaders({ env }));
  app.get('/api/thing', (_req, res) => res.json({ ok: true }));
  // Stands in for the SPA fallback, which serves dist/index.html in production.
  app.get(/.*/, (_req, res) => res.type('html').send('<!doctype html><html></html>'));
  return app;
};

describe('security response headers (audit H36)', () => {
  const headers = [
    ['content-security-policy', CSP_DIRECTIVES],
    ['x-frame-options', 'DENY'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['permissions-policy', 'camera=(), microphone=(), geolocation=()'],
  ] as const;

  for (const [header, value] of headers) {
    it(`sets ${header} on an API response`, async () => {
      const res = await request(appWithHeaders(), '/api/thing');
      expect(res.headers.get(header)).toBe(value);
    });

    // The SPA fallback is the response that actually carries the app, so a
    // middleware mounted in the wrong place would leave precisely this one bare.
    it(`sets ${header} on the SPA fallback`, async () => {
      const res = await request(appWithHeaders(), '/some/client/route');
      expect(res.headers.get(header)).toBe(value);
    });
  }
});

describe('the CSP keeps the features that exist today working', () => {
  const csp = parseCsp(CSP_DIRECTIVES);

  // Each of these is a feature that breaks silently if the directive is
  // "tidied away" — the failure mode is a blank area of the UI, not an error.
  it("allows data: images, or both QR codes vanish", () => {
    // components/InviteModal.tsx renders the invite and Wi-Fi QR codes from
    // QRCode.toDataURL. Blocking data: breaks the documented offline workflow.
    expect(csp.get('img-src')).toContain('data:');
  });

  it("allows inline styles, or Tailwind's runtime injection is blocked", () => {
    expect(csp.get('style-src')).toContain("'unsafe-inline'");
  });

  it('allows same-origin connections, or Socket.IO cannot reach the server', () => {
    // The zero-downtime guarantee rides entirely on this channel.
    expect(csp.get('connect-src')).toEqual(["'self'"]);
  });

  it('self-hosts fonts, matching the air-gapped rule', () => {
    expect(csp.get('font-src')).toEqual(["'self'"]);
  });
});

describe('the CSP still denies what it is meant to deny', () => {
  const csp = parseCsp(CSP_DIRECTIVES);

  it('permits no external origin on any fetching directive', () => {
    // The offline guarantee, machine-enforced: every source list may contain
    // keywords and data:, never a host. A CDN added by a future dependency
    // fails here instead of failing silently on an air-gapped phone.
    for (const [directive, values] of csp) {
      for (const value of values) {
        expect(
          /^('|data:$)/.test(value),
          `${directive} allows the external source ${value}`,
        ).toBe(true);
      }
    }
  });

  it('blocks inline and eval\'d script', () => {
    expect(csp.get('script-src')).toEqual(["'self'"]);
  });

  it('refuses to be framed', () => {
    expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
  });
});

describe('HSTS is production-only', () => {
  it('is sent in production', async () => {
    const res = await request(appWithHeaders({ NODE_ENV: 'production' }), '/api/thing');
    expect(res.headers.get('strict-transport-security')).toBe('max-age=31536000');
  });

  // Sending HSTS from a plain HTTP dev server pins localhost to HTTPS in the
  // developer's browser for a year, breaking every other local project on the
  // same host — and it cannot be undone from the server side.
  it('is not sent outside production', async () => {
    const res = await request(appWithHeaders({ NODE_ENV: 'development' }), '/api/thing');
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });
});
