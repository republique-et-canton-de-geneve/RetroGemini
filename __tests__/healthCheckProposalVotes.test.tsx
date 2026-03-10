import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import HealthCheckSession from '../components/HealthCheckSession';
import { HealthCheckSession as HealthCheckSessionType, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn()
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(),
    leaveSession: vi.fn()
  }
}));

const facilitator: User = {
  id: 'facilitator-1',
  name: 'Facilitator',
  color: 'bg-indigo-500',
  role: 'facilitator'
};

const participant1: User = {
  id: 'p1',
  name: 'Alice',
  color: 'bg-rose-500',
  role: 'participant'
};

const participant2: User = {
  id: 'p2',
  name: 'Bob',
  color: 'bg-cyan-500',
  role: 'participant'
};

const createSession = (): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Team Health',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'DISCUSS',
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [
    {
      id: 'dim-1',
      name: 'Communication',
      goodDescription: 'People collaborate well',
      badDescription: 'People work in silos'
    }
  ],
  participants: [facilitator, participant1, participant2],
  settings: {
    isAnonymous: false,
    revealRoti: false,
    showParticipantVotes: false
  },
  ratings: {
    p1: {
      'dim-1': {
        rating: 4,
        comment: 'Strong alignment'
      }
    },
    p2: {
      'dim-1': {
        rating: 2,
        comment: 'Needs more clarity'
      }
    }
  },
  actions: [
    {
      id: 'action-1',
      text: 'Document meeting decisions',
      assigneeId: null,
      done: false,
      type: 'proposal',
      linkedTicketId: 'dim-1',
      proposalVotes: {
        p1: 'up',
        p2: 'neutral'
      }
    }
  ],
  discussionFocusId: 'dim-1',
  roti: {},
  finishedUsers: []
});

const createTeam = (session: HealthCheckSessionType): Team => ({
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator, participant1, participant2],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  healthChecks: [session]
});

describe('Health check proposal votes', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const session = createSession();
    const team = createTeam(session);

    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
    vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn()
    });
  });

  const renderSession = () => {
    const session = createSession();
    const team = createTeam(session);

    vi.mocked(dataService.getTeam).mockReturnValue(team);
    vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
    vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);

    return render(
      <HealthCheckSession
        team={team}
        currentUser={facilitator}
        sessionId={session.id}
        onExit={vi.fn()}
      />
    );
  };

  it('shows voted and not voted participants on health check proposals', async () => {
    renderSession();

    await waitFor(() => {
      expect(screen.getByText('Total: 2')).toBeTruthy();
    });

    const totalBadge = screen.getByText('Total: 2');
    fireEvent.mouseEnter(totalBadge.parentElement!);

    let tooltip: HTMLElement | null = null;
    await waitFor(() => {
      tooltip = screen.getByText('Voted (2)').closest('.shadow-lg');
      expect(tooltip).toBeTruthy();
    });

    const tooltipQueries = within(tooltip!);
    expect(tooltipQueries.getByText('Alice')).toBeTruthy();
    expect(tooltipQueries.getByText('Bob')).toBeTruthy();
    expect(tooltipQueries.getByText('Not voted (1)')).toBeTruthy();
    expect(tooltipQueries.getByText('Facilitator')).toBeTruthy();

    expect(tooltip?.textContent).toContain('how_to_reg');
    expect(tooltip?.textContent).not.toContain('thumb_up');
  });

  it('persists show votes and reveals individual vote types in health checks', async () => {
    renderSession();

    await waitFor(() => {
      expect(screen.getByLabelText('Show votes')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Show votes'));

    await waitFor(() => {
      expect(dataService.updateHealthCheckSession).toHaveBeenCalled();
    });

    const updateCalls = vi.mocked(dataService.updateHealthCheckSession).mock.calls;
    const updatedSession = updateCalls[updateCalls.length - 1][1] as HealthCheckSessionType;
    expect(updatedSession.settings.showParticipantVotes).toBe(true);

    const totalBadge = screen.getByText('Total: 2');
    fireEvent.mouseEnter(totalBadge.parentElement!);

    let tooltip: HTMLElement | null = null;
    await waitFor(() => {
      tooltip = screen.getByText('Voted (2)').closest('.shadow-lg');
      expect(tooltip?.textContent).toContain('thumb_up');
      expect(tooltip?.textContent).toContain('remove');
      expect(tooltip?.textContent).not.toContain('how_to_reg');
    });
  });

  it('applies vote gradients to health check proposal rows', async () => {
    const { container } = renderSession();

    await waitFor(() => {
      expect(screen.getByText('Document meeting decisions')).toBeTruthy();
    });

    const proposalRows = container.querySelectorAll('[style]');
    const rowWithGradient = Array.from(proposalRows).find((element) =>
      (element as HTMLElement).style.background?.includes('linear-gradient')
    );

    expect(rowWithGradient).toBeTruthy();
  });
});
