import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import FirstRetroTipsPanel from '../components/session/FirstRetroTipsPanel';

describe('FirstRetroTipsPanel', () => {
  it('shows the current phase suggestion and applies brainstorm timer presets', async () => {
    const user = userEvent.setup();
    const onApplyTimebox = vi.fn();

    render(
      <FirstRetroTipsPanel
        currentPhase="BRAINSTORM"
        onApplyTimebox={onApplyTimebox}
        onClose={vi.fn()}
        onDismiss={vi.fn()}
      />
    );

    const currentStage = within(screen.getByTestId('first-retro-current-stage'));
    expect(currentStage.getByRole('heading', { name: 'Brainstorm' })).toBeTruthy();
    expect(currentStage.getByText('5 to 7 min')).toBeTruthy();
    expect(currentStage.getByText(/Silent writing usually helps people generate more ideas/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Set timer to 5 min' }));
    expect(onApplyTimebox).toHaveBeenCalledWith(300);
  });

  it('shows discuss guidance and allows dismissing the tips for the team', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <FirstRetroTipsPanel
        currentPhase="DISCUSS"
        onApplyTimebox={vi.fn()}
        onClose={vi.fn()}
        onDismiss={onDismiss}
      />
    );

    const currentStage = within(screen.getByTestId('first-retro-current-stage'));
    expect(currentStage.getByRole('heading', { name: 'Discuss' })).toBeTruthy();
    expect(currentStage.getByText('10 min/topic')).toBeTruthy();
    expect(currentStage.getByText(/Reset the timer for each topic/i)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Dismiss for this team' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
