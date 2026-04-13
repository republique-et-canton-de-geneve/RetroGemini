/**
 * AI Service - OpenAI-compatible LLM integration for RetroGemini.
 *
 * Provides two capabilities when AI is configured and enabled:
 * 1. Suggest a concise group title based on grouped ticket texts
 * 2. Generate a retrospective summary based on all session data
 *
 * The service talks to any OpenAI-compatible chat completion endpoint.
 */

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
   * Call the OpenAI-compatible chat completion endpoint.
   */
  const chatCompletion = async (ai, messages) => {
    const url = ai.apiUrl.replace(/\/+$/, '') + '/chat/completions';

    const headers = { 'Content-Type': 'application/json' };
    if (ai.apiKey) {
      headers['Authorization'] = `Bearer ${ai.apiKey}`;
    }

    const body = {
      messages,
      temperature: 0.3,
      max_tokens: 512
    };

    if (ai.model) {
      body.model = ai.model;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`AI API error ${response.status}: ${text.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content?.trim() || '';
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
          'You are a retrospective assistant. Your job is to suggest a very short, concise group title (2-5 words max) that captures the common theme of the given tickets. Reply ONLY with the title, nothing else. Use the same language as the tickets.'
      },
      {
        role: 'user',
        content: `Here are the tickets in this group:\n${ticketList}\n\nSuggest a concise group title:`
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

    const messages = [
      {
        role: 'system',
        content:
          'You are a retrospective assistant. Write a clear, concise summary of this retrospective session. Focus on the key themes, notable feedback, and action items. Keep it professional and actionable. Use the same language as the tickets and actions. Write 3-6 sentences.'
      },
      {
        role: 'user',
        content: `Retrospective: "${sessionData.name || 'Untitled'}"\n\n${retroContent}\n\nWrite a summary of this retrospective:`
      }
    ];

    return chatCompletion(ai, messages);
  };

  return {
    getAiSettings,
    suggestGroupTitle,
    generateRetroSummary
  };
};

export { createAiService };
