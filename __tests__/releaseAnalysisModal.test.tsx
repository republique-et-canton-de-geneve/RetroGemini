import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReleaseAnalysisModal from '../components/dashboard/ReleaseAnalysisModal';
import { RetroSession } from '../types';

const baseSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 169',
  date: '2026-02-17',
  status: 'CLOSED',
  phase: 'CLOSE',
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const retros = [
  baseSession({ id: 'r1', name: 'AFC R&S 1/6 2606-Sprint 169' }),
  baseSession({ id: 'r2', name: 'AFC R&S 2/6 2606-Sprint 170' }),
  baseSession({ id: 'r3', name: 'AFC R&S 3/6 2606-Sprint 171' }),
  baseSession({ id: 'r4', name: 'Independent retro - Sprint 172' })
];

describe('ReleaseAnalysisModal', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('starts with no retro selected and the generate button disabled', () => {
    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);
    const button = screen.getByTestId('release-analysis-generate') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText('0 selected')).toBeTruthy();
  });

  it('auto-selects every retrospective whose name contains the keyword', async () => {
    const user = userEvent.setup();
    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);

    const input = screen.getByTestId('release-analysis-keyword');
    await user.type(input, '2606');

    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.getByText('3 retrospectives match this keyword.')).toBeTruthy();

    const button = screen.getByTestId('release-analysis-generate') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('lets the user manually toggle retros without entering a keyword', async () => {
    const user = userEvent.setup();
    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);

    await user.click(screen.getByLabelText('Toggle Independent retro - Sprint 172'));
    expect(screen.getByText('1 selected')).toBeTruthy();

    const button = screen.getByTestId('release-analysis-generate') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it('sends the keyword and selected retros to the AI endpoint and renders the analysis', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ analysis: 'Drivers: collaboration\nAnchors: CI pipeline' })
    });
    globalThis.fetch = fetchMock as any;

    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);

    await user.type(screen.getByTestId('release-analysis-keyword'), '2606');

    await act(async () => {
      fireEvent.click(screen.getByTestId('release-analysis-generate'));
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/ai/generate-release-analysis', expect.objectContaining({
      method: 'POST'
    }));

    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.releaseLabel).toBe('2606');
    expect(body.mode).toBe('default');
    expect(body.customPrompt).toBeUndefined();
    expect(body.retrospectives).toHaveLength(3);
    expect(body.retrospectives.map((r: any) => r.id)).toEqual(['r1', 'r2', 'r3']);

    expect(screen.getByTestId('release-analysis-result').textContent).toContain('Drivers: collaboration');
    expect(screen.getByTestId('release-analysis-result').textContent).toContain('Anchors: CI pipeline');
  });

  it('forwards additional instructions in default mode', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ analysis: 'OK' })
    });
    globalThis.fetch = fetchMock as any;

    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);

    await user.click(screen.getByLabelText('Toggle AFC R&S 1/6 2606-Sprint 169'));
    await user.type(
      screen.getByTestId('release-analysis-additional'),
      'Focus on quality and write the synthesis in French.'
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('release-analysis-generate'));
    });

    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.mode).toBe('default');
    expect(body.additionalInstructions).toBe('Focus on quality and write the synthesis in French.');
    expect(body.customPrompt).toBeUndefined();
  });

  it('switches to custom prompt mode and forwards the custom prompt', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ analysis: 'CUSTOM' })
    });
    globalThis.fetch = fetchMock as any;

    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);

    await user.click(screen.getByLabelText('Toggle AFC R&S 1/6 2606-Sprint 169'));
    await user.click(screen.getByTestId('release-analysis-mode-custom'));

    // The default-instructions textarea is replaced by the custom prompt textarea.
    expect(screen.queryByTestId('release-analysis-additional')).toBeNull();
    expect(screen.getByTestId('release-analysis-custom-prompt')).toBeTruthy();

    // Generate is disabled until the custom prompt is filled.
    expect((screen.getByTestId('release-analysis-generate') as HTMLButtonElement).disabled).toBe(true);

    await user.type(
      screen.getByTestId('release-analysis-custom-prompt'),
      'List only the top 3 risks for the release.'
    );

    expect((screen.getByTestId('release-analysis-generate') as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(screen.getByTestId('release-analysis-generate'));
    });

    const init = fetchMock.mock.calls[0][1] as { body: string };
    const body = JSON.parse(init.body);
    expect(body.mode).toBe('custom');
    expect(body.customPrompt).toBe('List only the top 3 risks for the release.');
    expect(body.additionalInstructions).toBeUndefined();
  });

  it('exposes a Copy button that writes the analysis to the clipboard', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ analysis: 'Drivers: collaboration\nAnchors: CI pipeline' })
    });
    globalThis.fetch = fetchMock as any;

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });

    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);
    await user.click(screen.getByLabelText('Toggle AFC R&S 1/6 2606-Sprint 169'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('release-analysis-generate'));
    });

    // Copy button is present BOTH inline (next to the result heading) and in the
    // sticky footer, so it stays visible without scrolling.
    expect(screen.getByTestId('release-analysis-copy-inline')).toBeTruthy();
    expect(screen.getByTestId('release-analysis-copy-footer')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('release-analysis-copy-footer'));
    });

    expect(writeText).toHaveBeenCalledWith('Drivers: collaboration\nAnchors: CI pipeline');
    expect(screen.getAllByText('Copied!').length).toBeGreaterThan(0);
  });

  it('shows an error message when the AI service fails', async () => {
    const user = userEvent.setup();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'AI exploded' })
    }) as any;

    render(<ReleaseAnalysisModal retrospectives={retros} onClose={vi.fn()} />);
    await user.click(screen.getByLabelText('Toggle AFC R&S 1/6 2606-Sprint 169'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('release-analysis-generate'));
    });

    expect(screen.getByText('AI exploded')).toBeTruthy();
  });
});
