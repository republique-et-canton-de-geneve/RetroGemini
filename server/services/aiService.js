/**
 * AI Service - OpenAI-compatible LLM integration for RetroGemini.
 *
 * Provides two capabilities when AI is configured and enabled:
 * 1. Suggest a concise group title based on grouped ticket texts
 * 2. Generate a retrospective summary based on all session data
 *
 * The service talks to any OpenAI-compatible chat completion endpoint.
 * Supports self-signed TLS certificates for internal/air-gapped deployments.
 */

import https from 'node:https';
import http from 'node:http';

const createAiService = ({ dataStore }) => {
  /**
   * Load the current AI settings from global settings.
   * Returns null when AI is not configured / not enabled.
   */
  const getAiSettings = async () => {
    const settings = await dataStore.loadGlobalSettings();
    const ai = settings.ai;
    if (!ai || !ai.enabled || !ai.apiUrl) return null;
    return ai;
  };

  /**
   * Make an HTTP/HTTPS request using Node.js built-in modules.
   * This allows us to control TLS certificate verification.
   */
  const makeRequest = (url, options, bodyStr) => {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const mod = isHttps ? https : http;

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || 'POST',
        headers: options.headers || {},
        timeout: 30000
      };

      if (isHttps && options.rejectUnauthorized === false) {
        reqOptions.agent = new https.Agent({ rejectUnauthorized: false });
      }

      const req = mod.request(reqOptions, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode, body });
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 30 seconds'));
      });

      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  };

  /**
   * Low-level call to the OpenAI-compatible chat completion endpoint.
   * Returns both the message content and the finish_reason so callers can tell
   * when the model stopped because it ran into the output token limit.
   */
  const rawChatCompletion = async (ai, messages, overrides = {}) => {
    const url = ai.apiUrl.replace(/\/+$/, '') + '/chat/completions';

    const headers = { 'Content-Type': 'application/json' };
    if (ai.apiKey) {
      headers['Authorization'] = `Bearer ${ai.apiKey}`;
    }

    const body = {
      messages,
      temperature: overrides.temperature ?? 0.3,
      max_tokens: overrides.maxTokens ?? 512
    };
    if (ai.model) {
      body.model = ai.model;
    }

    const bodyStr = JSON.stringify(body);
    const requestOptions = {
      method: 'POST',
      headers,
      rejectUnauthorized: ai.allowSelfSignedCerts ? false : undefined
    };

    const response = await makeRequest(url, requestOptions, bodyStr);

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`AI API error ${response.status}: ${(response.body || '').substring(0, 200)}`);
    }

    const data = JSON.parse(response.body);
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? '',
      finishReason: choice?.finish_reason ?? null
    };
  };

  /**
   * Call the OpenAI-compatible chat completion endpoint and return the trimmed
   * message content.
   */
  const chatCompletion = async (ai, messages, overrides = {}) => {
    const { content } = await rawChatCompletion(ai, messages, overrides);
    return content.trim();
  };

  /**
   * Like chatCompletion, but resilient to small LLM output limits. When the
   * model stops because it reached max_tokens (finish_reason === 'length'), the
   * partial answer is fed back and the model is asked to continue, stitching the
   * pieces together. This prevents long syntheses (e.g. the release analysis)
   * from being silently cut off mid-sentence on internal LLMs with tight output
   * caps.
   *
   * Returns { content, truncated }, where `truncated` is true only if the model
   * was STILL unfinished after `maxContinuations` extra rounds (a safety cap
   * that guarantees the loop always terminates).
   */
  const chatCompletionWithContinuation = async (ai, messages, overrides = {}, options = {}) => {
    const maxContinuations = options.maxContinuations ?? 4;
    const conversation = [...messages];
    const parts = [];
    let finishReason = null;

    for (let round = 0; round <= maxContinuations; round++) {
      const { content, finishReason: reason } = await rawChatCompletion(ai, conversation, overrides);
      finishReason = reason;
      if (content) parts.push(content);

      // Stop once the model finishes on its own (or stops for any reason other
      // than the length cap), or if it had nothing left to add.
      if (finishReason !== 'length' || !content.trim()) break;

      // Hit the token ceiling: ask the model to resume exactly where it stopped.
      conversation.push({ role: 'assistant', content });
      conversation.push({
        role: 'user',
        content:
          'Your previous message was cut off because it reached the output length limit. ' +
          'Continue exactly where you stopped, picking up mid-sentence if needed. ' +
          'Do NOT repeat any heading, bullet or text you already wrote, and do NOT add any ' +
          'preamble such as "Continuing". If the analysis was already complete, reply with nothing.'
      });
    }

    return { content: parts.join('').trim(), truncated: finishReason === 'length' };
  };

  /**
   * Suggest a concise group title given an array of ticket texts.
   * Returns null when AI is disabled.
   */
  const suggestGroupTitle = async (ticketTexts) => {
    const ai = await getAiSettings();
    if (!ai) return null;

    const ticketList = ticketTexts.map((t, i) => `${i + 1}. ${t}`).join('\n');

    const messages = [
      {
        role: 'system',
        content:
          'You are a retrospective assistant. Your job is to suggest a very short, concise group title (2-5 words max) that captures the common theme of the given tickets. Reply ONLY with the title, nothing else. IMPORTANT: You MUST reply in the SAME language as the tickets. If the tickets are in French, reply in French. If in English, reply in English. Detect the language from the ticket content and match it exactly.'
      },
      {
        role: 'user',
        content: `Here are the tickets in this group:\n${ticketList}\n\nSuggest a concise group title in the same language as the tickets above:`
      }
    ];

    return chatCompletion(ai, messages);
  };

  /**
   * Generate a retrospective summary from the full session data.
   * Returns null when AI is disabled.
   */
  const generateRetroSummary = async (sessionData) => {
    const ai = await getAiSettings();
    if (!ai) return null;

    const parts = [];

    // Columns and tickets
    if (sessionData.columns && sessionData.tickets) {
      for (const col of sessionData.columns) {
        const colTickets = sessionData.tickets.filter(t => t.colId === col.id);
        if (colTickets.length > 0) {
          parts.push(`## ${col.title}`);
          for (const t of colTickets) {
            const groupInfo = t.groupId
              ? (() => {
                  const g = sessionData.groups?.find(g => g.id === t.groupId);
                  return g?.title ? ` [Group: ${g.title}]` : '';
                })()
              : '';
            parts.push(`- ${t.text}${groupInfo}`);
          }
        }
      }
    }

    // Actions
    if (sessionData.actions?.length) {
      parts.push('\n## Action Items');
      for (const a of sessionData.actions) {
        const status = a.done ? '(done)' : '(open)';
        parts.push(`- ${a.text} ${status}`);
      }
    }

    // Happiness
    if (sessionData.happiness && Object.keys(sessionData.happiness).length > 0) {
      const values = Object.values(sessionData.happiness);
      const avg = (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1);
      parts.push(`\n## Team Happiness: ${avg}/5 average (${values.length} votes)`);
    }

    // ROTI
    if (sessionData.roti && Object.keys(sessionData.roti).length > 0) {
      const values = Object.values(sessionData.roti);
      const avg = (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1);
      parts.push(`## ROTI: ${avg}/5 average (${values.length} votes)`);
    }

    const retroContent = parts.join('\n');

    // Nothing to summarize – avoid hallucinating a summary from thin air
    if (!retroContent.trim()) return null;

    const messages = [
      {
        role: 'system',
        content:
          'You are a retrospective assistant. Write a clear, concise summary of this retrospective session. Focus on the key themes, notable feedback, and action items. Keep it professional and actionable. IMPORTANT: You MUST reply in the SAME language as the tickets and actions below. If the tickets are in French, write your summary in French. If in English, write in English. Detect the language from the content and match it exactly. Write 3-6 sentences.'
      },
      {
        role: 'user',
        content: `Retrospective: "${sessionData.name || 'Untitled'}"\n\n${retroContent}\n\nWrite a summary of this retrospective in the same language as the content above:`
      }
    ];

    return chatCompletion(ai, messages);
  };

  /**
   * Build a textual digest of one retrospective for inclusion in a multi-retro
   * analysis prompt. Intentionally compact: focuses on the signals that matter
   * for spotting recurring drivers, anchors, practice changes and new tools.
   */
  const buildRetroDigest = (retro) => {
    const bodyLines = [];

    if (Array.isArray(retro.columns) && Array.isArray(retro.tickets)) {
      for (const col of retro.columns) {
        const colTickets = retro.tickets.filter((t) => t.colId === col.id);
        if (colTickets.length === 0) continue;
        bodyLines.push(`#### ${col.title}`);
        for (const t of colTickets) {
          let groupInfo = '';
          if (t.groupId) {
            const g = (retro.groups || []).find((gr) => gr.id === t.groupId);
            if (g?.title) groupInfo = ` [Group: ${g.title}]`;
          }
          const voteCount = Array.isArray(t.votes) ? t.votes.length : 0;
          const votes = voteCount > 0 ? ` (${voteCount} vote${voteCount > 1 ? 's' : ''})` : '';
          bodyLines.push(`- ${t.text}${groupInfo}${votes}`);
        }
      }
    }

    if (Array.isArray(retro.actions) && retro.actions.length > 0) {
      const actionable = retro.actions.filter((a) => a && a.type !== 'proposal' && a.text);
      if (actionable.length > 0) {
        bodyLines.push('#### Actions');
        for (const a of actionable) {
          const status = a.done ? '(done)' : '(open)';
          bodyLines.push(`- ${a.text} ${status}`);
        }
      }
    }

    if (typeof retro.reviewSummary === 'string' && retro.reviewSummary.trim()) {
      bodyLines.push('#### Facilitator summary');
      bodyLines.push(retro.reviewSummary.trim());
    }

    if (retro.happiness && Object.keys(retro.happiness).length > 0) {
      const values = Object.values(retro.happiness);
      const avg = (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1);
      bodyLines.push(`Team happiness: ${avg}/5 (${values.length} votes)`);
    }

    if (retro.roti && Object.keys(retro.roti).length > 0) {
      const values = Object.values(retro.roti);
      const avg = (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1);
      bodyLines.push(`ROTI: ${avg}/5 (${values.length} votes)`);
    }

    if (bodyLines.length === 0) return '';

    const heading = `### ${retro.name || 'Untitled retrospective'}${retro.date ? ` (${retro.date})` : ''}`;
    return [heading, ...bodyLines].join('\n');
  };

  // Default system prompt used when the facilitator picks the standard
  // "release summary" mode. Kept as a constant so the unit tests can assert
  // that the structured headings are part of the prompt.
  const DEFAULT_RELEASE_SYSTEM_PROMPT =
    'You are a senior agile coach assisting a team with a release-level retrospective synthesis. ' +
    'You will receive several individual retrospectives covering successive sprints. ' +
    'Read them all and produce a single, structured analysis that helps the team prepare a release retrospective. ' +
    'Use these exact headings, in this order: ' +
    '"Drivers (what propels the team forward)", ' +
    '"Anchors (what slows the team down or holds it back)", ' +
    '"Recurring themes", ' +
    '"Practice changes", ' +
    '"New tools and experiments", ' +
    '"Notable highlights" and ' +
    '"Suggested focus for the release retrospective". ' +
    'Under each heading, provide a short paragraph or bullet list. ' +
    'Be concrete: cite the recurring topics, surface what changed across sprints, and avoid empty generalities. ' +
    'If a section has no signal, write "Nothing notable" rather than inventing content. ' +
    'IMPORTANT: Reply in the SAME language as the retrospectives below. ' +
    'If they are in French, write in French; if in English, write in English. Detect the dominant language and match it.';

  /**
   * Generate a release-level analysis across several retrospectives.
   *
   * Prompt modes:
   *  - mode === 'custom': the caller fully replaces the system prompt with
   *    `customPrompt`. The default release-summary template is NOT applied.
   *  - mode === 'default' (or anything else): the default template is used
   *    and `additionalInstructions`, when provided, is appended as extra
   *    guidance on top of the default behaviour.
   *
   * Returns null when AI is disabled or the retrospectives have no content.
   */
  const generateReleaseAnalysis = async ({
    retrospectives,
    releaseLabel,
    mode,
    additionalInstructions,
    customPrompt
  } = {}) => {
    const ai = await getAiSettings();
    if (!ai) return null;

    if (!Array.isArray(retrospectives) || retrospectives.length === 0) {
      return null;
    }

    const digests = retrospectives
      .map((retro) => buildRetroDigest(retro))
      .filter((digest) => digest && digest.trim());

    if (digests.length === 0) return null;

    const retroNames = retrospectives
      .map((r) => r.name)
      .filter((name) => typeof name === 'string' && name.trim())
      .join(', ');

    const releaseHeading = releaseLabel && releaseLabel.trim()
      ? `Release: "${releaseLabel.trim()}"`
      : `Period covering ${retrospectives.length} retrospective${retrospectives.length > 1 ? 's' : ''}`;

    const trimmedCustom = typeof customPrompt === 'string' ? customPrompt.trim() : '';
    const trimmedExtra = typeof additionalInstructions === 'string' ? additionalInstructions.trim() : '';

    let systemContent;
    if (mode === 'custom' && trimmedCustom) {
      // Custom mode fully replaces the default template — facilitator owns the prompt.
      systemContent = trimmedCustom;
    } else {
      systemContent = DEFAULT_RELEASE_SYSTEM_PROMPT;
      if (trimmedExtra) {
        systemContent += `\n\nAdditional instructions from the facilitator:\n${trimmedExtra}`;
      }
    }

    const messages = [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content:
          `${releaseHeading}\n` +
          `Retrospectives included: ${retroNames || '(unnamed)'}\n\n` +
          `Below are the digests of each retrospective in chronological order as provided:\n\n` +
          digests.join('\n\n---\n\n') +
          `\n\nProduce the release analysis now, in the same language as the retrospectives above.`
      }
    ];

    // Release syntheses are long (7 sections across several sprints), so use a
    // generous per-call budget and auto-continue if the model still hits its
    // output limit, so the analysis is never silently cut off mid-sentence.
    const { content } = await chatCompletionWithContinuation(
      ai,
      messages,
      { temperature: 0.4, maxTokens: 2048 },
      { maxContinuations: 4 }
    );
    return content;
  };

  /**
   * Suggest ticket groupings (clusters) given a list of tickets, scoped per
   * column. The LLM proposes clusters of 2+ tickets that share a theme; the
   * facilitator validates each suggestion before it becomes a real group.
   *
   * Input: tickets = [{ id, text, colId, colTitle? }]
   * Returns: { groups: [{ title, ticketIds }] } or null when AI is disabled.
   *
   * The LLM is instructed to reply with strict JSON. We harden parsing by
   * stripping common markdown fences and ignoring any ticket id the LLM
   * may have invented.
   */
  const suggestTicketGroups = async (tickets) => {
    const ai = await getAiSettings();
    if (!ai) return null;

    if (!Array.isArray(tickets) || tickets.length < 2) {
      return { groups: [] };
    }

    const validIds = new Set(tickets.map((t) => t.id));

    // Build a compact, columnized listing so the LLM understands context.
    const byColumn = new Map();
    for (const t of tickets) {
      const key = t.colTitle || t.colId || 'Tickets';
      if (!byColumn.has(key)) byColumn.set(key, []);
      byColumn.get(key).push(t);
    }
    const sections = [];
    for (const [colTitle, colTickets] of byColumn.entries()) {
      sections.push(`## ${colTitle}`);
      for (const t of colTickets) {
        sections.push(`- [${t.id}] ${t.text}`);
      }
    }
    const ticketListing = sections.join('\n');

    const messages = [
      {
        role: 'system',
        content:
          'You are a retrospective assistant helping a facilitator group tickets that share a theme. ' +
          'You will receive tickets organized by column. Identify 1 to 7 clusters of tickets that genuinely belong together. ' +
          'Rules: ' +
          '(1) Every ticket id you return MUST come from the provided list — never invent ids. ' +
          '(2) Only cluster tickets that share a clear theme; tickets that do not fit any cluster MUST be omitted. ' +
          '(3) Each cluster must contain at least 2 distinct ticket ids. ' +
          '(4) Each ticket id appears in at most one cluster. ' +
          '(5) Prefer clustering tickets from the same column, but cross-column clusters are allowed when the theme is clearly shared. ' +
          '(6) For each cluster, propose a concise title (2 to 5 words) in the SAME language as the tickets. ' +
          'Reply with valid JSON only — no markdown, no prose, no code fences. ' +
          'Schema: {"groups":[{"title":"...","ticketIds":["id1","id2",...]}]}. ' +
          'If no meaningful clusters exist, return {"groups":[]}.'
      },
      {
        role: 'user',
        content:
          `Tickets to consider (organized by column):\n${ticketListing}\n\n` +
          `Respond now with the JSON object only.`
      }
    ];

    const raw = await chatCompletion(ai, messages, { temperature: 0.2, maxTokens: 800 });
    if (!raw) return { groups: [] };

    // Strip markdown fences if the LLM ignored the instruction.
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    }

    // Some models prepend prose; pull out the first JSON object we find.
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.substring(firstBrace, lastBrace + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { groups: [] };
    }

    if (!parsed || !Array.isArray(parsed.groups)) {
      return { groups: [] };
    }

    const usedIds = new Set();
    const sanitizedGroups = [];
    for (const g of parsed.groups) {
      if (!g || typeof g !== 'object') continue;
      const title = typeof g.title === 'string' ? g.title.trim().slice(0, 80) : '';
      if (!Array.isArray(g.ticketIds)) continue;
      const ids = [];
      for (const rawId of g.ticketIds) {
        if (typeof rawId !== 'string') continue;
        if (!validIds.has(rawId)) continue;
        if (usedIds.has(rawId)) continue;
        ids.push(rawId);
        usedIds.add(rawId);
      }
      if (ids.length >= 2) {
        sanitizedGroups.push({ title, ticketIds: ids });
      }
    }

    return { groups: sanitizedGroups };
  };

  return {
    getAiSettings,
    suggestGroupTitle,
    suggestTicketGroups,
    generateRetroSummary,
    generateReleaseAnalysis
  };
};

export { createAiService };
