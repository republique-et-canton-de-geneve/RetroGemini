// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The AI calls moved onto the transport the Jira client shares
 * (`server/services/outboundHttp.js`), and the move promised to keep their
 * behaviour as it was: a 30-second idle timeout, and neither the wall-clock
 * deadline nor the size cap the Jira calls carry. `aiService.test.ts` mocks
 * `node:https` underneath the transport and cannot see those options, so they
 * are pinned here, where the transport itself is replaced.
 */

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../server/services/outboundHttp.js', () => ({ request }));

import { createAiService } from '../server/services/aiService';

const dataStore = { loadGlobalSettings: vi.fn(), updateGlobalSettings: vi.fn() };

const aiSettings = (overrides: Record<string, unknown> = {}) => ({
  ai: { enabled: true, apiUrl: 'https://llm.example.org/v1/', apiKey: 'sk-test', model: 'local', ...overrides }
});

beforeEach(() => {
  request.mockReset();
  request.mockResolvedValue({
    status: 200,
    headers: {},
    body: JSON.stringify({ choices: [{ message: { content: 'Release pressure' }, finish_reason: 'stop' }] })
  });
});

describe('aiService on the shared outbound transport', () => {
  it('posts with a 30-second idle timeout, no deadline and no size cap', async () => {
    dataStore.loadGlobalSettings.mockResolvedValue(aiSettings());
    const title = await createAiService({ dataStore }).suggestGroupTitle(['Too many releases', 'Late hotfixes']);

    expect(title).toBe('Release pressure');
    expect(request).toHaveBeenCalledTimes(1);
    const [options] = request.mock.calls[0];
    expect(options).toMatchObject({
      url: 'https://llm.example.org/v1/chat/completions',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-test' },
      timeoutMs: 30000
    });
    expect(JSON.parse(options.body)).toMatchObject({ model: 'local' });
    expect(options.deadlineMs).toBeUndefined();
    expect(options.maxBytes).toBeUndefined();
    // Certificates are checked unless the super admin said otherwise.
    expect(options.rejectUnauthorized).toBeUndefined();
  });

  it('passes the self-signed-certificate allowance through to the transport', async () => {
    dataStore.loadGlobalSettings.mockResolvedValue(aiSettings({ allowSelfSignedCerts: true }));
    await createAiService({ dataStore }).suggestGroupTitle(['One ticket']);

    expect(request.mock.calls[0][0].rejectUnauthorized).toBe(false);
  });
});
