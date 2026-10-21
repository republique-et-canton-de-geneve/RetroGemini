import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import JiraReasonLine from '../components/jira/JiraReasonLine';
import { statusWith } from './helpers/jiraClientFetch';

/**
 * Finding U-1: a facilitator who cannot create used to see nothing at all
 * once the discovery note was dismissed. The reason line stays, names why,
 * and names where to fix it — Settings → Jira.
 */

describe('JiraReasonLine', () => {
  it('says the team has no token, and where to add one', () => {
    render(<JiraReasonLine status={statusWith({ token: { configured: false, usable: false } })} isFacilitator />);
    expect(screen.getByText(/Jira is not connected for this team/)).toHaveTextContent('Settings → Jira');
  });

  it('asks for the token again when the address changed or it cannot be read', () => {
    const { rerender } = render(
      <JiraReasonLine status={statusWith({ token: { usable: false, reason: 'address_changed' } })} isFacilitator />
    );
    expect(screen.getByText(/The Jira address changed/)).toBeInTheDocument();

    rerender(<JiraReasonLine status={statusWith({ token: { usable: false, reason: 'unreadable' } })} isFacilitator />);
    expect(screen.getByText(/can no longer be read on this server/)).toBeInTheDocument();
  });

  it('says when Jira refused the token', () => {
    render(
      <JiraReasonLine status={statusWith({ token: { refusedAt: '2026-10-19T12:00:00.000Z' } })} isFacilitator />
    );
    const line = screen.getByText(/Jira refused the team’s token on/);
    expect(line.textContent).toContain(new Date('2026-10-19T12:00:00.000Z').toLocaleDateString('en-US'));
  });

  it('says when no target is chosen', () => {
    render(<JiraReasonLine status={statusWith({ target: null })} isFacilitator />);
    expect(screen.getByText('Choose where the issues are created in Settings → Jira.')).toBeInTheDocument();
  });

  it('carries the id a disabled control points its aria-describedby at', () => {
    render(<JiraReasonLine status={statusWith({ target: null })} isFacilitator id="why" />);
    expect(screen.getByText(/Choose where/).closest('[id="why"]')).not.toBeNull();
  });

  it('shows nothing to a participant, when creation is possible, or when Jira is off', () => {
    const blocked = statusWith({ target: null });
    const { container: participant } = render(<JiraReasonLine status={blocked} isFacilitator={false} />);
    expect(participant).toBeEmptyDOMElement();

    const { container: ready } = render(<JiraReasonLine status={statusWith()} isFacilitator />);
    expect(ready).toBeEmptyDOMElement();

    const { container: off } = render(<JiraReasonLine status={{ ...blocked, enabled: false }} isFacilitator />);
    expect(off).toBeEmptyDOMElement();

    const { container: none } = render(<JiraReasonLine status={null} isFacilitator />);
    expect(none).toBeEmptyDOMElement();
  });
});
