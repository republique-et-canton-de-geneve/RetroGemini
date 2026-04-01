import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RetroTipsPanel from '../components/session/RetroTipsPanel';
import { getRetroPhaseDefaultTimerSeconds } from '../components/session/retroTips';

describe('RetroTipsPanel', () => {
  it('shows the current stage purpose and the default brainstorm timer', () => {
    render(
      <RetroTipsPanel
        currentPhase="BRAINSTORM"
        onClose={vi.fn()}
      />
    );

    const currentStage = within(screen.getByTestId('retro-tips-current-stage'));
    expect(screen.getByRole('heading', { name: 'Brainstorm' })).toBeTruthy();
    expect(currentStage.getByText('Purpose')).toBeTruthy();
    expect(currentStage.getByText(/write silently on their own/i)).toBeTruthy();
    expect(currentStage.queryByText(/timer resets to/i)).toBeNull();
  });

  it('shows discuss guidance in the compact layout', () => {
    render(
      <RetroTipsPanel
        currentPhase="DISCUSS"
        onClose={vi.fn()}
      />
    );

    const currentStage = within(screen.getByTestId('retro-tips-current-stage'));
    expect(screen.getByRole('heading', { name: 'Discuss' })).toBeTruthy();
    expect(currentStage.getByText(/starting with the ones that received the most votes/i)).toBeTruthy();
    expect(currentStage.queryByText(/timer resets to/i)).toBeNull();
  });

  it('exposes the default timer used when phases change', () => {
    expect(getRetroPhaseDefaultTimerSeconds('BRAINSTORM')).toBe(420);
    expect(getRetroPhaseDefaultTimerSeconds('OPEN_ACTIONS')).toBe(180);
    expect(getRetroPhaseDefaultTimerSeconds('VOTE')).toBe(180);
    expect(getRetroPhaseDefaultTimerSeconds('GROUP')).toBe(900);
    expect(getRetroPhaseDefaultTimerSeconds('DISCUSS')).toBe(480);
    expect(getRetroPhaseDefaultTimerSeconds('CLOSE')).toBe(180);
  });
});
