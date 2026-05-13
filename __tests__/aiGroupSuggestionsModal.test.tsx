import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import AiGroupSuggestionsModal, { AiSuggestedGroup } from '../components/session/AiGroupSuggestionsModal';
import type { Column, Ticket } from '../types';

const columns: Column[] = [
  { id: 'c1', title: 'Liked', color: 'bg-emerald-50', border: 'border-emerald-300', icon: 'sentiment_satisfied', text: 'text-emerald-700', ring: 'focus:ring-emerald-200' },
  { id: 'c2', title: 'Improve', color: 'bg-amber-50', border: 'border-amber-300', icon: 'build', text: 'text-amber-700', ring: 'focus:ring-amber-200' },
];

const tickets: Ticket[] = [
  { id: 't1', colId: 'c1', text: 'Great planning meeting', authorId: 'u1', groupId: null, votes: [] },
  { id: 't2', colId: 'c1', text: 'Clear estimates', authorId: 'u1', groupId: null, votes: [] },
  { id: 't3', colId: 'c2', text: 'CI flaky', authorId: 'u1', groupId: null, votes: [] },
  { id: 't4', colId: 'c2', text: 'Slow builds', authorId: 'u1', groupId: null, votes: [] },
];

const suggestions: AiSuggestedGroup[] = [
  { title: 'Planning praise', ticketIds: ['t1', 't2'] },
  { title: 'Build pipeline', ticketIds: ['t3', 't4'] },
];

describe('AiGroupSuggestionsModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AiGroupSuggestionsModal
        isOpen={false}
        loading={false}
        error={null}
        suggestions={suggestions}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a spinner while loading', () => {
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading
        error={null}
        suggestions={null}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/Analyzing tickets/i)).toBeTruthy();
  });

  it('displays an empty-state message when the LLM returns no clusters', () => {
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={[]}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/did not find clusters/i)).toBeTruthy();
  });

  it('lists each suggestion with its tickets and accepts a single suggestion on click', () => {
    const onAccept = vi.fn();
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={suggestions}
        tickets={tickets}
        columns={columns}
        onAccept={onAccept}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Planning praise')).toBeTruthy();
    expect(screen.getByText('Build pipeline')).toBeTruthy();
    expect(screen.getByText('Great planning meeting')).toBeTruthy();
    expect(screen.getByText('CI flaky')).toBeTruthy();

    const acceptButtons = screen.getAllByRole('button', { name: 'Accept' });
    fireEvent.click(acceptButtons[0]);

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(suggestions[0]);
    expect(screen.getByText('Applied')).toBeTruthy();
  });

  it('invokes onReject when dismissing a suggestion', () => {
    const onReject = vi.fn();
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={suggestions}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={onReject}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissButtons[1]);
    expect(onReject).toHaveBeenCalledWith(1);
  });

  it('calls onAcceptAll when the "Accept all remaining" button is pressed', () => {
    const onAcceptAll = vi.fn();
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={suggestions}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={onAcceptAll}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /accept all remaining/i }));
    expect(onAcceptAll).toHaveBeenCalledTimes(1);
  });
});
