import rateLimit from 'express-rate-limit';

const MAX_RELEASE_ANALYSIS_RETROSPECTIVES = 50;
const MAX_RELEASE_ANALYSIS_PROMPT_CHARS = 4000;

const registerAiRoutes = ({ app, dataStore, tokenService, aiService, logService }) => {
  // Product decision: authenticated team members are never rate limited on AI
  // actions (a facilitator grouping tickets must not lock up mid-session).
  // The per-IP budget only throttles unauthenticated callers, whose requests
  // fail authentication with 401 anyway.
  const aiActionLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'too_many_attempts', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => !!tokenService.validateSessionToken(req.body?.sessionToken)
  });

  // AI endpoints are only reachable with a valid team session token whose team
  // still exists, so anonymous network callers cannot drive the internal LLM.
  const authenticateTeamRequest = async (req, res) => {
    const { sessionToken } = req.body || {};
    const claims = tokenService.validateSessionToken(sessionToken);
    if (!claims) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }

    const team = await dataStore.loadTeam(claims.teamId);
    if (!team) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }

    return claims;
  };

  // Audit H21: an upstream AI failure describes the deployment's internal LLM.
  // A Node transport error names its host, IP and port
  // (`connect ECONNREFUSED 10.20.30.40:8080`), and `aiService`'s
  // `AI API error <status>: <first 200 chars of the body>` forwards whatever
  // the gateway answered, API-key diagnostics included. These routes need only
  // a team session token — on a shared team password, anyone who ever received
  // an invite link — and `ReleaseAnalysisModal` renders `message` on screen, so
  // the detail never goes in the response. It stays in the pod log and in the
  // super-admin log ring, and `/api/super-admin/test-ai` remains the diagnostic
  // path that does return it, gated by the super-admin credential.
  const failAiRequest = (res, context, err) => {
    const detail = err?.message || err?.cause?.message || 'AI request failed';
    console.error(`[Server] ${context} failed:`, detail);
    logService.addServerLog('error', 'server', `${context} failed: ${detail}`);
    res.status(500).json({ error: 'ai_error' });
  };

  app.post('/api/ai/suggest-group-title', aiActionLimiter, async (req, res) => {
    try {
      if (!(await authenticateTeamRequest(req, res))) return;

      const { ticketTexts } = req.body || {};
      if (!Array.isArray(ticketTexts) || ticketTexts.length === 0) {
        return res.status(400).json({ error: 'missing_ticket_texts' });
      }
      const title = await aiService.suggestGroupTitle(ticketTexts);
      if (title === null) {
        return res.status(404).json({ error: 'ai_not_enabled' });
      }
      res.json({ title });
    } catch (err) {
      failAiRequest(res, 'AI suggest group title', err);
    }
  });

  app.post('/api/ai/suggest-groups', aiActionLimiter, async (req, res) => {
    try {
      if (!(await authenticateTeamRequest(req, res))) return;

      const { tickets } = req.body || {};
      if (!Array.isArray(tickets) || tickets.length === 0) {
        return res.status(400).json({ error: 'missing_tickets' });
      }
      const safeTickets = tickets
        .filter(t => t && typeof t.id === 'string' && typeof t.text === 'string')
        .map(t => ({
          id: t.id,
          text: t.text,
          colId: typeof t.colId === 'string' ? t.colId : undefined,
          colTitle: typeof t.colTitle === 'string' ? t.colTitle : undefined
        }))
        .slice(0, 200);
      if (safeTickets.length < 2) {
        return res.json({ groups: [] });
      }
      const result = await aiService.suggestTicketGroups(safeTickets);
      if (result === null) {
        return res.status(404).json({ error: 'ai_not_enabled' });
      }
      res.json(result);
    } catch (err) {
      failAiRequest(res, 'AI suggest groups', err);
    }
  });

  app.post('/api/ai/generate-retro-summary', aiActionLimiter, async (req, res) => {
    try {
      if (!(await authenticateTeamRequest(req, res))) return;

      const { sessionData } = req.body || {};
      if (!sessionData) {
        return res.status(400).json({ error: 'missing_session_data' });
      }
      const summary = await aiService.generateRetroSummary(sessionData);
      if (summary === null) {
        return res.status(404).json({ error: 'ai_not_enabled' });
      }
      res.json({ summary });
    } catch (err) {
      failAiRequest(res, 'AI generate retro summary', err);
    }
  });

  app.post('/api/ai/generate-release-analysis', aiActionLimiter, async (req, res) => {
    try {
      if (!(await authenticateTeamRequest(req, res))) return;

      const { retrospectives, releaseLabel, mode, additionalInstructions, customPrompt, members } = req.body || {};
      if (!Array.isArray(retrospectives) || retrospectives.length === 0) {
        return res.status(400).json({ error: 'missing_retrospectives' });
      }

      // Roster used to resolve ticket authors / action assignees into names.
      const safeMembers = Array.isArray(members)
        ? members
            .filter(m => m && typeof m.id === 'string' && typeof m.name === 'string')
            .map(m => ({ id: m.id, name: m.name.slice(0, 120) }))
            .slice(0, 500)
        : [];

      if (retrospectives.length > MAX_RELEASE_ANALYSIS_RETROSPECTIVES) {
        return res.status(400).json({
          error: 'too_many_retrospectives',
          maxRetrospectives: MAX_RELEASE_ANALYSIS_RETROSPECTIVES
        });
      }

      const safeAdditionalInstructions = typeof additionalInstructions === 'string'
        ? additionalInstructions.slice(0, MAX_RELEASE_ANALYSIS_PROMPT_CHARS)
        : additionalInstructions;
      const safeCustomPrompt = typeof customPrompt === 'string'
        ? customPrompt.slice(0, MAX_RELEASE_ANALYSIS_PROMPT_CHARS)
        : customPrompt;

      const analysis = await aiService.generateReleaseAnalysis({
        retrospectives,
        releaseLabel,
        mode,
        additionalInstructions: safeAdditionalInstructions,
        customPrompt: safeCustomPrompt,
        members: safeMembers
      });
      if (analysis === null) {
        return res.status(404).json({ error: 'ai_not_enabled_or_empty' });
      }
      res.json({ analysis });
    } catch (err) {
      failAiRequest(res, 'AI generate release analysis', err);
    }
  });
};

export { registerAiRoutes };
