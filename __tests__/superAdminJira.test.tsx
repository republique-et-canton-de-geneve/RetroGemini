import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import SuperAdmin from '../components/SuperAdmin';

/**
 * The console carries the deployment's Jira connection (spec §1), beside the
 * AI settings it is modelled on: between the AI card and Backup Data.
 */

const requests: { url: string; body: Record<string, unknown> }[] = [];

const installFetch = () => {
  requests.length = 0;
  global.fetch = vi.fn(async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    const body = JSON.parse(init?.body || '{}') as Record<string, unknown>;
    requests.push({ url, body });
    let json: unknown = {};
    if (url === '/api/super-admin/teams') json = { teams: [] };
    if (url === '/api/super-admin/feedbacks') json = { feedbacks: [] };
    if (url === '/api/super-admin/jira-settings') {
      json = { enabled: true, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false };
    }
    return { ok: true, status: 200, json: async () => json } as unknown as Response;
  }) as unknown as typeof fetch;
};

describe('SuperAdmin with Jira', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installFetch();
  });

  it('shows the Jira card between the AI card and Backup Data, loaded with the console’s credential', async () => {
    render(<SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />);

    const card = await screen.findByRole('region', { name: 'Jira' });
    expect(await within(card).findByDisplayValue('https://jira.example.org')).toBeInTheDocument();
    expect(requests.find(r => r.url === '/api/super-admin/jira-settings')?.body).toEqual({ sessionToken: 'admin-token' });

    const ai = screen.getByRole('heading', { name: /AI Assistant/ });
    const backup = screen.getByRole('heading', { name: /Backup Data/ });
    expect(ai.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(backup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
