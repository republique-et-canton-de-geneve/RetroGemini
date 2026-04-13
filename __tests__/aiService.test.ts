import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAiService } from '../server/services/aiService';

const mockDataStore = {
  loadGlobalSettings: vi.fn(),
  saveGlobalSettings: vi.fn()
};

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

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
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('calls the chat completion API with correct parameters', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1', apiKey: 'sk-abc', model: 'gpt-4o-mini' }
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Communication Issues' } }]
        })
      });

      const result = await aiService.suggestGroupTitle(['Bad communication', 'Need more meetings']);
      expect(result).toBe('Communication Issues');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://llm.example.com/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer sk-abc'
          }),
          body: expect.any(String)
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.messages).toHaveLength(2);
      expect(body.messages[1].content).toContain('Bad communication');
      expect(body.messages[1].content).toContain('Need more meetings');
    });

    it('does not send Authorization header when apiKey is not set', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Test Title' } }]
        })
      });

      await aiService.suggestGroupTitle(['ticket 1']);

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('does not include model when not set', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Test' } }]
        })
      });

      await aiService.suggestGroupTitle(['ticket 1']);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBeUndefined();
    });

    it('throws on API error', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      });

      await expect(aiService.suggestGroupTitle(['ticket 1']))
        .rejects.toThrow('AI API error 500');
    });

    it('strips trailing slashes from apiUrl', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1/' }
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Title' } }]
        })
      });

      await aiService.suggestGroupTitle(['ticket 1']);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://llm.example.com/v1/chat/completions',
        expect.anything()
      );
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

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Great retro with key insights.' } }]
        })
      });

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

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.messages[1].content).toContain('Sprint 42 Retro');
      expect(body.messages[1].content).toContain('Good teamwork');
      expect(body.messages[1].content).toContain('Fast delivery');
      expect(body.messages[1].content).toContain('[Group: Speed]');
      expect(body.messages[1].content).toContain('Improve CI pipeline');
      expect(body.messages[1].content).toContain('4.5/5');
    });

    it('handles session data with no tickets gracefully', async () => {
      mockDataStore.loadGlobalSettings.mockResolvedValue({
        ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content: 'Short retro.' } }]
        })
      });

      const result = await aiService.generateRetroSummary({ name: 'Empty Retro' });
      expect(result).toBe('Short retro.');
    });
  });
});
