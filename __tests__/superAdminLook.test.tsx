import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import SuperAdmin from '../components/SuperAdmin';
import { effectivePair, tokenContrast } from './helpers/tailwindTheme';

/**
 * The console under the 45.0 tokens: what no audit walks. The axe audit of
 * every tab (e2e/admin-console-accessibility.spec.ts) skips disabled controls
 * and sees only the states its fixtures reach, so the disabled buttons and an
 * empty team list are measured here, against the surface they land on.
 */

const replies: Record<string, unknown> = {
  '/api/super-admin/teams': { teams: [] },
  '/api/super-admin/feedbacks': { feedbacks: [] },
  // AI on and no address yet: its Test and Save buttons are disabled at rest.
  '/api/super-admin/ai-settings': { ai: { enabled: true, apiUrl: '' } },
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(replies[url] ?? {}) }),
  ) as unknown as typeof fetch;
});

const renderConsole = async () => {
  render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('No teams found')).toBeInTheDocument());
};

describe('the console under the new look', () => {
  // `groups_off` is in no cut of Material Symbols: it drew the groups glyph
  // followed by the letters "_OFF", five glyphs wide.
  it('draws an empty team list with a ligature the font has', async () => {
    await renderConsole();
    const empty = screen.getByText('No teams found').parentElement!;
    expect(empty.querySelector('.material-symbols-outlined')?.textContent).toBe('group_off');
    expect(effectivePair(screen.getByText('No teams found')).ratio).toBeGreaterThanOrEqual(4.5);
  });

  // A disabled button is exempt from 1.4.3, but its words still say what it
  // will do once it can: slate-500 on the slate-200 fill measured 4.33:1.
  // The buttons take the dashboard's recipes, whose disabled state is a pair
  // of its own (`disabled:bg-*`, `disabled:text-*`): that pair is what a
  // disabled button paints, so it is the one measured.
  it.each([/Upload & Restore/, /Test Connection/, /Save Settings/])('keeps the words of the disabled %s button readable', async (name) => {
    await renderConsole();
    await waitFor(() => expect(screen.getByRole('button', { name })).toBeDisabled());
    const tokens = (screen.getByRole('button', { name }).getAttribute('class') ?? '').split(/\s+/);
    const disabledColour = (kind: 'text' | 'bg') => {
      const found = tokens.filter((token) => new RegExp(`^disabled:${kind}-(white|black|[a-z]+-\\d{2,3})$`).test(token));
      expect(found, `disabled:${kind}-`).toHaveLength(1);
      return found[0].slice(`disabled:${kind}-`.length);
    };
    expect(tokens.some((token) => /opacity-/.test(token))).toBe(false);
    expect(tokenContrast(disabledColour('text'), disabledColour('bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the page subtitle readable on the grey page', async () => {
    await renderConsole();
    expect(effectivePair(screen.getByText('Manage all teams and recovery emails')).ratio).toBeGreaterThanOrEqual(4.5);
  });
});
