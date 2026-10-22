import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../components/Dashboard';
import type { HealthCheckSession, Team, User } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The Dashboard's health-check score tooltip, measured as the Dashboard paints it.
 *
 * `__tests__/participantColors.test.ts` measures the `HEALTH_RATING_BADGE`
 * table, but a table proves nothing about the line that reads it: writing
 * `${ratingBadge.bg} text-white` there instead of `${ratingBadge.text}` brought
 * the white digits back (1.94:1 on emerald-400) and left that test green. The
 * e2e audit cannot see the tooltip either, because it shows only on hover. It
 * is in the DOM all along, just `invisible`, so jsdom can measure it.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token'),
  },
}));

const FLOOR = 4.5;

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

// Rating r gets r + 5 votes, so the counts (6 to 10) never read as a digit (1 to 5).
const RATINGS = [1, 2, 3, 4, 5] as const;
const votesFor = (rating: number) => rating + 5;

const ratings: HealthCheckSession['ratings'] = {};
for (const rating of RATINGS) {
  for (let voter = 0; voter < votesFor(rating); voter += 1) {
    ratings[`u-${rating}-${voter}`] = { d1: { rating } };
  }
}

const healthCheck = {
  id: 'hc1',
  teamId: 'team-1',
  name: 'Q2 pulse',
  date: '6/2/2026',
  templateId: 'custom-1',
  templateName: 'Team pulse',
  dimensions: [{ id: 'd1', name: 'Speed' }],
  status: 'CLOSED',
  phase: 'CLOSE',
  settings: { isAnonymous: false, revealRatings: true },
  ratings,
  actions: [],
} as unknown as HealthCheckSession;

const team: Team = {
  id: 'team-1',
  name: 'Test Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [healthCheck],
  globalActions: [],
};

describe('health-check score tooltip', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  // The score cell: found by one of its distribution layers, whose title is "rating: count".
  const scoreCell = () => {
    const cell = screen.getByTitle(`5: ${votesFor(5)}`).closest('td');
    if (!cell) throw new Error('no score cell');
    return cell;
  };

  it.each(RATINGS)('the digit %i clears 4.5:1 on its badge', (rating) => {
    render(
      <Dashboard
        team={team}
        currentUser={facilitator}
        onOpenSession={vi.fn()}
        onOpenHealthCheck={vi.fn()}
        onRefresh={vi.fn()}
        initialTab="HEALTH_CHECKS"
      />,
    );
    const pair = effectivePair(within(scoreCell()).getByText(String(rating)));
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });
});
