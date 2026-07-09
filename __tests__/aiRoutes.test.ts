import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerAiRoutes } from '../server/routes/aiRoutes.js';

const request = async (app: express.Express, path: string, init: Parameters<typeof fetch>[1] = {}) => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

const createAiServiceMock = () => ({
  suggestGroupTitle: vi.fn(async () => 'Suggested title'),
  suggestTicketGroups: vi.fn(async () => ({ groups: [] })),
  generateRetroSummary: vi.fn(async () => 'Summary'),
  generateReleaseAnalysis: vi.fn(async () => 'analysis')
});

type SessionClaims = { teamId: string; visitorId: string | null; createdAt: number } | null;

const createApp = ({
  aiService = createAiServiceMock(),
  validateSessionToken = vi.fn((_token: string): SessionClaims => ({ teamId: 'team-1', visitorId: null, createdAt: 0 })),
  loadTeam = vi.fn(async () => ({ id: 'team-1', name: 'Team One' }))
} = {}) => {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  registerAiRoutes({
    app,
    dataStore: { loadTeam },
    tokenService: { validateSessionToken },
    aiService
  });
  return { app, aiService, validateSessionToken, loadTeam };
};

const aiEndpoints = [
  { path: '/api/ai/suggest-group-title', body: { ticketTexts: ['a', 'b'] }, serviceCall: 'suggestGroupTitle' },
  {
    path: '/api/ai/suggest-groups',
    body: { tickets: [{ id: 't1', text: 'a' }, { id: 't2', text: 'b' }] },
    serviceCall: 'suggestTicketGroups'
  },
  { path: '/api/ai/generate-retro-summary', body: { sessionData: { name: 'Retro' } }, serviceCall: 'generateRetroSummary' },
  {
    path: '/api/ai/generate-release-analysis',
    body: { retrospectives: [{ id: 'r1' }] },
    serviceCall: 'generateReleaseAnalysis'
  }
] as const;

describe('AI route authentication', () => {
  it.each(aiEndpoints)('rejects $path without a session token before calling the AI service', async ({ path, body, serviceCall }) => {
    const validateSessionToken = vi.fn((_token: string): SessionClaims => null);
    const { app, aiService, loadTeam } = createApp({ validateSessionToken });

    const response = await request(app, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(aiService[serviceCall]).not.toHaveBeenCalled();
    expect(loadTeam).not.toHaveBeenCalled();
  });

  it.each(aiEndpoints)('rejects $path when the token references a missing team', async ({ path, body, serviceCall }) => {
    const loadTeam = vi.fn(async () => null);
    const { app, aiService } = createApp({ loadTeam });

    const response = await request(app, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, sessionToken: 'stale-token' })
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(aiService[serviceCall]).not.toHaveBeenCalled();
  });

  it('accepts an authenticated suggest-group-title call', async () => {
    const { app, aiService, validateSessionToken, loadTeam } = createApp();

    const response = await request(app, '/api/ai/suggest-group-title', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: 'valid-token', ticketTexts: ['Great teamwork', 'Good communication'] })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ title: 'Suggested title' });
    expect(validateSessionToken).toHaveBeenCalledWith('valid-token');
    expect(loadTeam).toHaveBeenCalledWith('team-1');
    expect(aiService.suggestGroupTitle).toHaveBeenCalledWith(['Great teamwork', 'Good communication']);
  });

  it('accepts an authenticated retro summary call', async () => {
    const { app, aiService } = createApp();

    const response = await request(app, '/api/ai/generate-retro-summary', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: 'valid-token', sessionData: { name: 'Sprint 42' } })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary: 'Summary' });
    expect(aiService.generateRetroSummary).toHaveBeenCalledWith({ name: 'Sprint 42' });
  });

  it('still validates input after authentication', async () => {
    const { app, aiService } = createApp();

    const response = await request(app, '/api/ai/suggest-group-title', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: 'valid-token', ticketTexts: [] })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'missing_ticket_texts' });
    expect(aiService.suggestGroupTitle).not.toHaveBeenCalled();
  });

  it('truncates release analysis prompt fields before calling the AI service', async () => {
    const { app, aiService } = createApp();

    const retrospectives = Array.from({ length: 50 }, (_, index) => ({ id: `retro-${index}` }));
    const response = await request(app, '/api/ai/generate-release-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionToken: 'valid-token',
        retrospectives,
        customPrompt: 'x'.repeat(5000),
        additionalInstructions: 'y'.repeat(5000)
      })
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analysis: 'analysis' });
    expect(aiService.generateReleaseAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      retrospectives,
      customPrompt: 'x'.repeat(4000),
      additionalInstructions: 'y'.repeat(4000)
    }));
  });

  it('does not let invalid-token spam consume an authenticated team rate-limit budget', async () => {
    const validateSessionToken = vi.fn((token: string): SessionClaims =>
      token === 'valid-token' ? { teamId: 'team-1', visitorId: null, createdAt: 0 } : null
    );
    const { app, aiService } = createApp({ validateSessionToken });

    const spamResponses = [];
    for (let index = 0; index < 31; index += 1) {
      spamResponses.push(await request(app, '/api/ai/suggest-group-title', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionToken: 'garbage-token', ticketTexts: ['a', 'b'] })
      }));
    }

    expect(spamResponses.slice(0, 30).every((response) => response.status === 401)).toBe(true);
    expect(spamResponses[30].status).toBe(429);

    const authenticatedResponse = await request(app, '/api/ai/suggest-group-title', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionToken: 'valid-token', ticketTexts: ['a', 'b'] })
    });

    expect(authenticatedResponse.status).toBe(200);
    expect(aiService.suggestGroupTitle).toHaveBeenCalledTimes(1);
  });

  it('rejects release analysis requests that would silently omit selected retrospectives', async () => {
    const { app, aiService } = createApp();

    const response = await request(app, '/api/ai/generate-release-analysis', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionToken: 'valid-token',
        retrospectives: Array.from({ length: 51 }, (_, index) => ({ id: `retro-${index}` }))
      })
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'too_many_retrospectives', maxRetrospectives: 50 });
    expect(aiService.generateReleaseAnalysis).not.toHaveBeenCalled();
  });
});
