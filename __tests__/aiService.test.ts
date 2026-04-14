import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock http and https modules
const mockRequest = vi.fn();

vi.mock('node:https', () => ({
  default: {
    request: (...args: any[]) => mockRequest('https', ...args),
    Agent: class MockAgent {
      options: any;
      constructor(opts: any) { this.options = opts; }
    }
  }
}));

vi.mock('node:http', () => ({
  default: { request: (...args: any[]) => mockRequest('http', ...args) }
}));

import { createAiService } from '../server/services/aiService';

const mockDataStore = {
  loadGlobalSettings: vi.fn(),
  saveGlobalSettings: vi.fn()
};

/**
 * Helper: set up mockRequest to simulate a successful HTTP response.
 */
const setupMockResponse = (statusCode: number, body: string) => {
  mockRequest.mockImplementation((_protocol: string, _options: any, callback: any) => {
    const res = new EventEmitter() as any;
    res.statusCode = statusCode;

    // Call the callback with the response
    setTimeout(() => {
      callback(res);
      res.emit('data', Buffer.from(body));
      res.emit('end');
    }, 0);

    // Return the request object
    const req = new EventEmitter() as any;
    req.write = vi.fn();
    req.end = vi.fn();
    req.destroy = vi.fn();
    return req;
  });
};

describe('aiService', () => {
  let aiService: ReturnType<typeof createAiService>;

  beforeEach(() => {
    vi.clearAllMocks();
    aiService = createAiService({ dataStore: mockDataStore });
  });

  describe('getAiSettings', () => {
    it('returns null when AI is not configured', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({});
      const result = await aiService.getAiSettings();
      expect(result).toBeNull();
    });

    it('returns null when AI is disabled', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: false, apiUrl: 'https://example.com/v1' }
      });
      const result = await aiService.getAiSettings();
      expect(result).toBeNull();
    });

    it('returns null when apiUrl is empty', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: '' }
      });
      const result = await aiService.getAiSettings();
      expect(result).toBeNull();
    });

    it('returns settings when AI is enabled and configured', async () => {
      const ai = { enabled: true, apiUrl: 'https://example.com/v1', apiKey: 'sk-test', model: 'gpt-4' };
      mockDataStore.loadGlobalSettings.mockResolvedValue({ ai });
      const result = await aiService.getAiSettings();
      expect(result).toEqual(ai);
    });
  });

  describe('suggestGroupTitle', () => {
    it('returns null when AI is not configured', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({});
      const result = await aiService.suggestGroupTitle(['ticket 1', 'ticket 2']);
      expect(result).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('calls the chat completion API with correct parameters', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1', apiKey: 'sk-abc', model: 'gpt-4o-mini' }
      });

      const responseBody = JSON.stringify({
        choices: [{ message: { content: 'Communication Issues' } }]
      });
      setupMockResponse(200, responseBody);

      const result = await aiService.suggestGroupTitle(['Bad communication', 'Need more meetings']);
      expect(result).toBe('Communication Issues');

      expect(mockRequest).toHaveBeenCalledWith(
        'https',
        expect.objectContaining({
          hostname: 'llm.example.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-abc'
          })
        }),
        expect.any(Function)
      );

      // Verify the body written to the request
      const reqObj = mockRequest.mock.results[0].value;
      const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
      expect(writtenBody.model).toBe('gpt-4o-mini');
      expect(writtenBody.messages).toHaveLength(2);
      expect(writtenBody.messages[1].content).toContain('Bad communication');
      expect(writtenBody.messages[1].content).toContain('Need more meetings');
    });

    it('does not send Authorization header when apiKey is not set', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      setupMockResponse(200, JSON.stringify({
        choices: [{ message: { content: 'Test Title' } }]
      }));

      await aiService.suggestGroupTitle(['ticket 1']);

      const requestOptions = mockRequest.mock.calls[0][1];
      expect(requestOptions.headers['Authorization']).toBeUndefined();
    });

    it('does not include model when not set', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      setupMockResponse(200, JSON.stringify({
        choices: [{ message: { content: 'Test' } }]
      }));

      await aiService.suggestGroupTitle(['ticket 1']);

      const reqObj = mockRequest.mock.results[0].value;
      const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
      expect(writtenBody.model).toBeUndefined();
    });

    it('throws on API error', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      setupMockResponse(500, 'Internal Server Error');

      await expect(aiService.suggestGroupTitle(['ticket 1']))
        .rejects.toThrow('AI API error 500');
    });

    it('strips trailing slashes from apiUrl', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1/' }
      });

      setupMockResponse(200, JSON.stringify({
        choices: [{ message: { content: 'Title' } }]
      }));

      await aiService.suggestGroupTitle(['ticket 1']);

      const requestOptions = mockRequest.mock.calls[0][1];
      expect(requestOptions.path).toBe('/v1/chat/completions');
    });

    it('creates an Agent with rejectUnauthorized false when allowSelfSignedCerts is true', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1', allowSelfSignedCerts: true }
      });

      setupMockResponse(200, JSON.stringify({
        choices: [{ message: { content: 'Title' } }]
      }));

      await aiService.suggestGroupTitle(['ticket 1']);

      const requestOptions = mockRequest.mock.calls[0][1];
      expect(requestOptions.agent).toBeDefined();
      expect(requestOptions.agent.options.rejectUnauthorized).toBe(false);
    });

    it('does not create an agent when allowSelfSignedCerts is false', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1', allowSelfSignedCerts: false }
      });

      setupMockResponse(200, JSON.stringify({
        choices: [{ message: { content: 'Title' } }]
      }));

      await aiService.suggestGroupTitle(['ticket 1']);

      const requestOptions = mockRequest.mock.calls[0][1];
      expect(requestOptions.agent).toBeUndefined();
    });
  });

  describe('generateRetroSummary', () => {
    it('returns null when AI is not configured', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({});
      const result = await aiService.generateRetroSummary({ name: 'Test' });
      expect(result).toBeNull();
    });

    it('generates a summary from session data', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      setupMockResponse(200, JSON.stringify({
        choices: [{ message: { content: 'Great retro with key insights.' } }]
      }));

      const sessionData = {
        name: 'Sprint 42 Retro',
        columns: [{ id: 'col1', title: 'Went Well' }],
        tickets: [
          { id: 't1', colId: 'col1', text: 'Good teamwork', groupId: null },
          { id: 't2', colId: 'col1', text: 'Fast delivery', groupId: 'g1' }
        ],
        groups: [{ id: 'g1', title: 'Speed' }],
        actions: [
          { id: 'a1', text: 'Improve CI pipeline', done: false }
        ],
        happiness: { 'u1': 4, 'u2': 5 },
        roti: { 'u1': 3 }
      };

      const result = await aiService.generateRetroSummary(sessionData);
      expect(result).toBe('Great retro with key insights.');

      const reqObj = mockRequest.mock.results[0].value;
      const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
      expect(writtenBody.messages[1].content).toContain('Sprint 42 Retro');
      expect(writtenBody.messages[1].content).toContain('Good teamwork');
      expect(writtenBody.messages[1].content).toContain('Fast delivery');
      expect(writtenBody.messages[1].content).toContain('[Group: Speed]');
      expect(writtenBody.messages[1].content).toContain('Improve CI pipeline');
      expect(writtenBody.messages[1].content).toContain('4.5/5');
    });

    it('returns null when session has no tickets, actions, or votes', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      const result = await aiService.generateRetroSummary({ name: 'Empty Retro' });
      expect(result).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('returns null when session has columns but no tickets', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      const result = await aiService.generateRetroSummary({
        name: 'Empty Retro',
        columns: [{ id: 'col1', title: 'Went Well' }],
        tickets: [],
        groups: [],
        actions: [],
        happiness: {},
        roti: {}
      });
      expect(result).toBeNull();
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('generates summary when session has only actions (no tickets)', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      setupMockResponse(200, JSON.stringify({
        choices: [{ message: { content: 'Action-focused retro.' } }]
      }));

      const result = await aiService.generateRetroSummary({
        name: 'Actions Only',
        columns: [],
        tickets: [],
        actions: [{ id: 'a1', text: 'Fix CI', done: false }]
      });
      expect(result).toBe('Action-focused retro.');
    });
  });
});
