import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

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

const setupMockResponse = (statusCode: number, body: string) => {
  mockRequest.mockImplementation((_protocol: string, _options: any, callback: any) => {
    const res = new EventEmitter() as any;
    res.statusCode = statusCode;
    setTimeout(() => {
      callback(res);
      res.emit('data', Buffer.from(body));
      res.emit('end');
    }, 0);
    const req = new EventEmitter() as any;
    req.write = vi.fn();
    req.end = vi.fn();
    req.destroy = vi.fn();
    return req;
  });
};

const buildRetro = (overrides: any = {}) => ({
  id: 'r1',
  name: 'Sprint 169',
  date: '2026-02-17',
  status: 'CLOSED',
  columns: [
    { id: 'c1', title: 'Went Well' },
    { id: 'c2', title: 'To Improve' }
  ],
  tickets: [
    { id: 't1', colId: 'c1', text: 'Pair programming worked', votes: ['u1', 'u2'] },
    { id: 't2', colId: 'c2', text: 'Slow CI pipeline', votes: ['u1'] }
  ],
  groups: [],
  actions: [
    { id: 'a1', type: 'new', text: 'Switch to faster CI runners', done: false }
  ],
  reviewSummary: 'Mostly positive sprint with CI concerns.',
  happiness: { u1: 4, u2: 5 },
  roti: { u1: 4 },
  ...overrides
});

describe('aiService.generateReleaseAnalysis', () => {
  let aiService: ReturnType<typeof createAiService>;

  beforeEach(() => {
    vi.clearAllMocks();
    aiService = createAiService({ dataStore: mockDataStore });
  });

  it('returns null when AI is not configured', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({});
    const result = await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()],
      releaseLabel: '2606'
    });
    expect(result).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns null when no retrospectives are provided', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });
    const result = await aiService.generateReleaseAnalysis({ retrospectives: [] });
    expect(result).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns null when retrospectives have no usable content', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });
    const empty = {
      id: 'r-empty',
      name: '',
      date: '',
      columns: [],
      tickets: [],
      groups: [],
      actions: [],
      reviewSummary: '',
      happiness: {},
      roti: {}
    };
    const result = await aiService.generateReleaseAnalysis({ retrospectives: [empty] });
    expect(result).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('builds a prompt that names the release and asks for the required headings', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1', model: 'gpt-4o-mini' }
    });

    setupMockResponse(200, JSON.stringify({
      choices: [{ message: { content: 'Drivers...\nAnchors...' } }]
    }));

    const retros = [
      buildRetro({ id: 'r1', name: 'AFC R&S 1/6 2606-Sprint 169' }),
      buildRetro({
        id: 'r2',
        name: 'AFC R&S 2/6 2606-Sprint 170',
        tickets: [
          { id: 't3', colId: 'c1', text: 'Better stand-ups', votes: [] },
          { id: 't4', colId: 'c2', text: 'Slow CI pipeline again', votes: [] }
        ],
        actions: [{ id: 'a2', type: 'new', text: 'Adopt new CI runners', done: true }]
      })
    ];

    const result = await aiService.generateReleaseAnalysis({
      retrospectives: retros,
      releaseLabel: '2606'
    });

    expect(result).toBe('Drivers...\nAnchors...');
    expect(mockRequest).toHaveBeenCalledTimes(1);

    const reqObj = mockRequest.mock.results[0].value;
    const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);

    // System prompt asks for the required structure.
    const systemContent = writtenBody.messages[0].content;
    expect(systemContent).toContain('Drivers');
    expect(systemContent).toContain('Anchors');
    expect(systemContent).toContain('Practice changes');
    expect(systemContent).toContain('New tools');

    // User prompt contains the release label and both retros.
    const userContent = writtenBody.messages[1].content;
    expect(userContent).toContain('2606');
    expect(userContent).toContain('AFC R&S 1/6 2606-Sprint 169');
    expect(userContent).toContain('AFC R&S 2/6 2606-Sprint 170');
    expect(userContent).toContain('Slow CI pipeline');
    expect(userContent).toContain('Switch to faster CI runners');
    expect(userContent).toContain('Adopt new CI runners');

    // Uses larger token budget than a single-retro summary.
    expect(writtenBody.max_tokens).toBeGreaterThan(512);
    expect(writtenBody.model).toBe('gpt-4o-mini');
  });

  it('falls back to a generic period heading when no release label is provided', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponse(200, JSON.stringify({
      choices: [{ message: { content: 'OK' } }]
    }));

    await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro({ id: 'r1', name: 'Sprint A' }), buildRetro({ id: 'r2', name: 'Sprint B' })]
    });

    const reqObj = mockRequest.mock.results[0].value;
    const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
    const userContent = writtenBody.messages[1].content;
    expect(userContent).toContain('Period covering 2 retrospectives');
    expect(userContent).not.toContain('Release: ');
  });
});
