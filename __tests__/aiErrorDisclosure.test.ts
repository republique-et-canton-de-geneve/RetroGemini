import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerAiRoutes } from '../server/routes/aiRoutes.js';

/**
 * Audit H21: the four team-facing AI routes caught an upstream failure and put
 * `err.message` straight into the JSON body as `message`. Two shapes reach a
 * browser that way, and both describe infrastructure the caller has no business
 * seeing:
 *
 *  - a Node transport error — `connect ECONNREFUSED 10.20.30.40:8080`,
 *    `getaddrinfo ENOTFOUND llm.internal.example` — which names the internal
 *    LLM host, its IP and its port;
 *  - `aiService.js:102`'s `AI API error <status>: <first 200 chars of the
 *    upstream body>`, which forwards whatever the gateway said, API-key
 *    diagnostics included.
 *
 * `ReleaseAnalysisModal.tsx` renders `data.message` verbatim, so the leak is
 * on screen, not merely in a response nobody reads — and any holder of a team
 * session token can trigger it, which on a shared team password means anyone
 * who has ever received an invite link.
 *
 * The detail is not lost: it stays in the pod log and in the super-admin log
 * ring. `/api/super-admin/test-ai` remains the diagnostic path that *does*
 * return it, because it is gated by the super-admin credential.
 */

const listen = async (
  app: express.Express,
  path: string,
  body: unknown
): Promise<{ status: number; raw: string; json: Record<string, unknown> }> => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const raw = await response.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: response.status, raw, json };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

const createApp = (failure: Error) => {
  const addServerLog = vi.fn();
  const rejects = vi.fn(async () => {
    throw failure;
  });
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  registerAiRoutes({
    app,
    dataStore: { loadTeam: vi.fn(async () => ({ id: 'team-1', name: 'Team One' })) },
    tokenService: {
      validateSessionToken: vi.fn(() => ({ teamId: 'team-1', visitorId: null, createdAt: 0 }))
    },
    aiService: {
      suggestGroupTitle: rejects,
      suggestTicketGroups: rejects,
      generateRetroSummary: rejects,
      generateReleaseAnalysis: rejects
    },
    logService: { addServerLog }
  });
  return { app, addServerLog };
};

const aiEndpoints = [
  { path: '/api/ai/suggest-group-title', body: { ticketTexts: ['a', 'b'] } },
  { path: '/api/ai/suggest-groups', body: { tickets: [{ id: 't1', text: 'a' }, { id: 't2', text: 'b' }] } },
  { path: '/api/ai/generate-retro-summary', body: { sessionData: { name: 'Retro' } } },
  { path: '/api/ai/generate-release-analysis', body: { retrospectives: [{ id: 'r1' }] } }
] as const;

const credentials = { sessionToken: 'a-valid-token' };

describe('AI routes do not disclose upstream failure detail to team clients', () => {
  it.each(aiEndpoints)(
    'POST $path hides the internal LLM host, IP and port from a transport error',
    async ({ path, body }) => {
      const { app } = createApp(new Error('connect ECONNREFUSED 10.20.30.40:8080'));

      const { status, raw, json } = await listen(app, path, { ...credentials, ...body });

      expect(status).toBe(500);
      expect(json.error).toBe('ai_error');
      expect(raw).not.toContain('10.20.30.40');
      expect(raw).not.toContain('8080');
      expect(raw).not.toContain('ECONNREFUSED');
    }
  );

  it.each(aiEndpoints)('POST $path hides the upstream response body it was handed', async ({ path, body }) => {
    const { app } = createApp(
      new Error('AI API error 401: {"error":{"message":"Incorrect API key provided: sk-proj-7f3a"}}')
    );

    const { status, raw } = await listen(app, path, { ...credentials, ...body });

    expect(status).toBe(500);
    expect(raw).not.toContain('sk-proj-7f3a');
    expect(raw).not.toContain('Incorrect API key');
  });

  it('hides a hostname carried on err.cause, not only on err.message', async () => {
    // `aiRoutes` reads `err.cause?.message` as a fallback, so the redaction has
    // to cover that branch too or the leak simply moves.
    const failure = new Error('');
    (failure as Error & { cause?: unknown }).cause = new Error(
      'getaddrinfo ENOTFOUND llm.internal.example'
    );
    const { app } = createApp(failure);

    const { status, raw } = await listen(app, '/api/ai/suggest-group-title', {
      ...credentials,
      ticketTexts: ['a', 'b']
    });

    expect(status).toBe(500);
    expect(raw).not.toContain('llm.internal.example');
  });

  it('still records the detail server-side so an operator can diagnose it', async () => {
    const { app, addServerLog } = createApp(new Error('connect ECONNREFUSED 10.20.30.40:8080'));

    await listen(app, '/api/ai/suggest-group-title', { ...credentials, ticketTexts: ['a', 'b'] });

    expect(addServerLog).toHaveBeenCalled();
    const logged = addServerLog.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(logged).toContain('10.20.30.40:8080');
  });
});
