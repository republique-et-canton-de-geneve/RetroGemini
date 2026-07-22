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

// Returns a different response per call (last entry repeats for any extra
// calls), so we can exercise the auto-continuation loop.
const setupMockResponses = (responses: Array<{ status?: number; body: string }>) => {
  let call = 0;
  mockRequest.mockImplementation((_protocol: string, _options: any, callback: any) => {
    const current = responses[Math.min(call, responses.length - 1)];
    call += 1;
    const res = new EventEmitter() as any;
    res.statusCode = current.status ?? 200;
    setTimeout(() => {
      callback(res);
      res.emit('data', Buffer.from(current.body));
      res.emit('end');
    }, 0);
    const req = new EventEmitter() as any;
    req.write = vi.fn();
    req.end = vi.fn();
    req.destroy = vi.fn();
    return req;
  });
};

const choiceBody = (content: string, finishReason: string | null = null) =>
  JSON.stringify({ choices: [{ message: { content }, finish_reason: finishReason }] });

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

  it('appends additional instructions to the default system prompt when provided', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponse(200, JSON.stringify({
      choices: [{ message: { content: 'OK' } }]
    }));

    await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()],
      mode: 'default',
      additionalInstructions: 'Focus on quality and write in French.'
    });

    const reqObj = mockRequest.mock.results[0].value;
    const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
    const systemContent = writtenBody.messages[0].content;
    expect(systemContent).toContain('Drivers');
    expect(systemContent).toContain('Additional instructions from the facilitator');
    expect(systemContent).toContain('Focus on quality and write in French.');
  });

  it('replaces the default prompt entirely when mode is custom', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponse(200, JSON.stringify({
      choices: [{ message: { content: 'OK' } }]
    }));

    await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()],
      mode: 'custom',
      customPrompt: 'List only the top 3 risks for this release.',
      // additionalInstructions must be ignored in custom mode.
      additionalInstructions: 'IGNORED'
    });

    const reqObj = mockRequest.mock.results[0].value;
    const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
    const systemContent = writtenBody.messages[0].content;
    expect(systemContent).toBe('List only the top 3 risks for this release.');
    expect(systemContent).not.toContain('Drivers');
    expect(systemContent).not.toContain('IGNORED');
  });

  it('drives the user message with the custom request instead of forcing a release analysis', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponse(200, JSON.stringify({
      choices: [{ message: { content: 'OK' } }]
    }));

    await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()],
      mode: 'custom',
      customPrompt: 'When did participant Thomas last create a ticket?'
    });

    const reqObj = mockRequest.mock.results[0].value;
    const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
    const userContent = writtenBody.messages[1].content;

    // The custom request is restated in the user message so the final
    // instruction the model reads is the facilitator's question, not the
    // built-in release-summary directive.
    expect(userContent).toContain('When did participant Thomas last create a ticket?');
    // The hardcoded release-analysis directive must NOT appear in custom mode,
    // otherwise it overrides the custom prompt (the reported bug).
    expect(userContent).not.toContain('Produce the release analysis now');
    // The retrospective data is still provided as source material.
    expect(userContent).toContain('Slow CI pipeline');
  });

  it('keeps forcing the release analysis directive in default mode', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponse(200, JSON.stringify({
      choices: [{ message: { content: 'OK' } }]
    }));

    await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()],
      mode: 'default'
    });

    const reqObj = mockRequest.mock.results[0].value;
    const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
    const userContent = writtenBody.messages[1].content;
    expect(userContent).toContain('Produce the release analysis now');
  });

  it('falls back to the default prompt when custom mode is selected but no prompt is provided', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponse(200, JSON.stringify({
      choices: [{ message: { content: 'OK' } }]
    }));

    await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()],
      mode: 'custom',
      customPrompt: '   '
    });

    const reqObj = mockRequest.mock.results[0].value;
    const writtenBody = JSON.parse(reqObj.write.mock.calls[0][0]);
    const systemContent = writtenBody.messages[0].content;
    expect(systemContent).toContain('Drivers');
  });

  it('continues generation and stitches the pieces when the model hits the output length limit', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponses([
      // First call is cut off by the token cap (finish_reason: 'length').
      { body: choiceBody('Drivers...\n- Pair programming', 'length') },
      // Continuation finishes the thought naturally.
      { body: choiceBody(' boosted quality\nAnchors... all good.', 'stop') }
    ]);

    const result = await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()],
      releaseLabel: '2606'
    });

    // The two chunks are concatenated into one complete, trimmed analysis.
    expect(result).toBe('Drivers...\n- Pair programming boosted quality\nAnchors... all good.');
    expect(mockRequest).toHaveBeenCalledTimes(2);

    // The continuation request carries the partial answer plus a resume instruction.
    const secondBody = JSON.parse(mockRequest.mock.results[1].value.write.mock.calls[0][0]);
    const assistantMsg = secondBody.messages.find((m: any) => m.role === 'assistant');
    expect(assistantMsg.content).toContain('Pair programming');
    const lastMsg = secondBody.messages[secondBody.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content.toLowerCase()).toContain('continue');
  });

  it('stops continuing after the safety cap so the loop always terminates', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    // The model never signals completion — every call reports 'length'.
    setupMockResponses([{ body: choiceBody('more ', 'length') }]);

    const result = await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro()]
    });

    // 1 initial call + 4 continuations = 5 calls, then it gives up gracefully.
    expect(mockRequest).toHaveBeenCalledTimes(5);
    expect(result).toContain('more');
  });

  it('resolves ticket authors and action assignees into names in the digest', async () => {
    mockDataStore.loadGlobalSettings.mockResolvedValue({
      ai: { enabled: true, apiUrl: 'https://llm.example.com/v1' }
    });

    setupMockResponse(200, JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));

    await aiService.generateReleaseAnalysis({
      retrospectives: [buildRetro({
        tickets: [
          { id: 't1', colId: 'c1', text: 'Pairing worked well', authorId: 'u1', votes: [],
            comments: [{ id: 'cm1', authorName: 'Alice', text: 'Agreed, more of this' }] }
        ],
        actions: [
          { id: 'a1', type: 'new', text: 'Adopt faster CI runners', done: false, assigneeId: 'u2' }
        ]
      })],
      members: [{ id: 'u1', name: 'Thomas' }, { id: 'u2', name: 'Alice' }]
    });

    const writtenBody = JSON.parse(mockRequest.mock.results[0].value.write.mock.calls[0][0]);
    const userContent = writtenBody.messages[1].content;
    // Ticket author, action assignee and comment context are all present so the
    // AI can answer participant-specific questions.
    expect(userContent).toContain('by Thomas');
    expect(userContent).toContain('→ Alice');
    expect(userContent).toContain('Agreed, more of this');
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
