import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RetroTipsPanel from '../components/session/RetroTipsPanel';

describe('RetroTipsPanel', () => {
  it('shows the current stage purpose and applies brainstorm timer presets for facilitators', async () => {
    const user = userEvent.setup();
    const onApplyTimebox = vi.fn();

    render(
      <RetroTipsPanel
        currentPhase="BRAINSTORM"
        canApplyTimebox={true}
        onApplyTimebox={onApplyTimebox}
        onClose={vi.fn()}
      />
    );

    const currentStage = within(screen.getByTestId('retro-tips-current-stage'));
    expect(screen.getByRole('heading', { name: 'Brainstorm' })).toBeTruthy();
    expect(currentStage.getByText('Purpose')).toBeTruthy();
    expect(currentStage.getByText(/write silently on their own/i)).toBeTruthy();
    expect(currentStage.getByText('Suggested timebox')).toBeTruthy();
    expect(currentStage.getByText('5 to 7 min')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Set timer to 5 min' }));
    expect(onApplyTimebox).toHaveBeenCalledWith(300);
  });

  it('shows discuss guidance without timer actions for participants', () => {
    render(
      <RetroTipsPanel
        currentPhase="DISCUSS"
        canApplyTimebox={false}
        onApplyTimebox={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const currentStage = within(screen.getByTestId('retro-tips-current-stage'));
    expect(screen.getByRole('heading', { name: 'Discuss' })).toBeTruthy();
    expect(currentStage.getByText(/starting with the ones that received the most votes/i)).toBeTruthy();
    expect(currentStage.getByText('8 min per topic')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set timer to 8 min' })).toBeNull();
    expect(screen.getByText(/The facilitator controls the shared timer/i)).toBeTruthy();
  });
});
