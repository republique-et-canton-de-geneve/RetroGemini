import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import JiraLinkBadge from '../components/jira/JiraLinkBadge';

/**
 * How an action shows its Jira issue (finding U-5). The href is built from
 * the configured base URL and a key that passes the key rule, never from a
 * stored URL (plan decision 1: `actions` is not a protected session field, so
 * a stored URL would be a link any participant could plant).
 */

const BASE = 'https://jira.example.org/jira';

describe('JiraLinkBadge', () => {
  it('links the key to the issue on the configured Jira, in a new tab', () => {
    render(<JiraLinkBadge link={{ key: 'TEAM-12', createdAt: '2026-10-20T10:00:00.000Z' }} baseUrl={BASE} />);

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://jira.example.org/jira/browse/TEAM-12');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    // The visible key first (WCAG 2.5.3), then where it goes.
    expect(link).toHaveTextContent('TEAM-12');
    expect(link).toHaveAccessibleName('TEAM-12, open in Jira (new tab)');
  });

  it('shows plain text, never an <a> without href, when the address is unknown', () => {
    render(<JiraLinkBadge link={{ key: 'TEAM-12', createdAt: '2026-10-20T10:00:00.000Z' }} baseUrl={null} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Jira: TEAM-12')).toBeInTheDocument();
  });

  it('shows the doubt for an uncertain creation', () => {
    render(<JiraLinkBadge link={{ uncertainSince: '2026-10-20T10:00:00.000Z' }} baseUrl={BASE} />);

    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('May already be in Jira')).toBeInTheDocument();
  });

  it('renders nothing for a value that is not a key, whoever wrote it', () => {
    const { container } = render(
      <JiraLinkBadge link={{ key: 'https://evil.example/x', createdAt: 'x' }} baseUrl={BASE} />
    );
    expect(container).toBeEmptyDOMElement();

    const { container: none } = render(<JiraLinkBadge link={undefined} baseUrl={BASE} />);
    expect(none).toBeEmptyDOMElement();
  });

  it('hands its focusable element to the caller, link or plain text', () => {
    const ref = React.createRef<HTMLElement>();
    const { rerender } = render(
      <JiraLinkBadge link={{ key: 'TEAM-1', createdAt: 'x' }} baseUrl={BASE} focusRef={ref} />
    );
    expect(ref.current?.tagName).toBe('A');

    rerender(<JiraLinkBadge link={{ key: 'TEAM-1', createdAt: 'x' }} baseUrl={null} focusRef={ref} />);
    expect(ref.current?.tagName).toBe('SPAN');
    // Reachable by script only: plain text is not a tab stop.
    expect(ref.current).toHaveAttribute('tabindex', '-1');
  });
});
