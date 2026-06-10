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
  { id: 't5', colId: 'c2', text: 'Long queue', authorId: 'u1', groupId: null, votes: [] },
  { id: 't6', colId: 'c2', text: 'No staging', authorId: 'u1', groupId: null, votes: [] },
];

const suggestions: AiSuggestedGroup[] = [
  { title: 'Planning praise', ticketIds: ['t1', 't2'] },
  { title: 'Build pipeline', ticketIds: ['t3', 't4'] },
];

// Three-ticket clusters let us exclude one ticket and still have a valid group.
const trioSuggestions: AiSuggestedGroup[] = [
  { title: 'Group A', ticketIds: ['t1', 't2', 't3'] },
  { title: 'Group B', ticketIds: ['t4', 't5', 't6'] },
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

  it('hides a dismissed suggestion (handled internally) and notifies via onReject', () => {
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

    expect(screen.getByText('Build pipeline')).toBeTruthy();
    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss' });
    fireEvent.click(dismissButtons[1]);

    expect(onReject).toHaveBeenCalledWith(1);
    // The modal removes the dismissed group on its own, without the parent
    // touching the suggestions array.
    expect(screen.queryByText('Build pipeline')).toBeNull();
    expect(screen.getByText('Planning praise')).toBeTruthy();
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

  it('renders an include checkbox checked by default for every ticket', () => {
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
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(checkboxes).toHaveLength(4);
    expect(checkboxes.every(cb => cb.checked)).toBe(true);
  });

  it('passes only the included tickets when one is excluded before accepting', () => {
    const onAccept = vi.fn();
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={[trioSuggestions[0]]}
        tickets={tickets}
        columns={columns}
        onAccept={onAccept}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Exclude the middle ticket (t2) from "Group A" (t1, t2, t3).
    fireEvent.click(screen.getByRole('checkbox', { name: /Clear estimates/i }));
    expect(screen.getByText('(2 of 3 tickets)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledWith({ title: 'Group A', ticketIds: ['t1', 't3'] });
  });

  it('disables Accept when fewer than two tickets remain included', () => {
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
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // The first group only has two tickets; excluding one leaves a single ticket.
    fireEvent.click(screen.getByRole('checkbox', { name: /Great planning meeting/i }));

    const acceptButtons = screen.getAllByRole('button', { name: 'Accept' }) as HTMLButtonElement[];
    expect(acceptButtons[0].disabled).toBe(true);
    expect(screen.getByText(/at least 2 tickets/i)).toBeTruthy();
  });

  it('applies per-ticket exclusions for each group when accepting all remaining', () => {
    const onAcceptAll = vi.fn();
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={trioSuggestions}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={onAcceptAll}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Exclude one ticket from each group, leaving two valid tickets per group.
    fireEvent.click(screen.getByRole('checkbox', { name: /Clear estimates/i })); // t2 from Group A
    fireEvent.click(screen.getByRole('checkbox', { name: /No staging/i })); // t6 from Group B

    fireEvent.click(screen.getByRole('button', { name: /accept all remaining/i }));
    expect(onAcceptAll).toHaveBeenCalledWith([
      { title: 'Group A', ticketIds: ['t1', 't3'] },
      { title: 'Group B', ticketIds: ['t4', 't5'] },
    ]);
  });

  it('keeps an accepted group applied when another suggestion is dismissed', () => {
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
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    // Accept the first group, then dismiss the other one.
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
    expect(screen.getByText('Applied')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    // Regression: dismissing a group used to reset the accepted state and
    // reactivate the already-applied group. It must stay applied.
    expect(screen.getByText('Applied')).toBeTruthy();
    expect(screen.getByText('Planning praise')).toBeTruthy();
    expect(screen.queryByText('Build pipeline')).toBeNull();
    expect(screen.getByText(/1 of 1 accepted/)).toBeTruthy();
  });

  it('resets the accepted state when a fresh set of suggestions arrives', () => {
    const { rerender } = render(
      <AiGroupSuggestionsModal
        isOpen
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

    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
    expect(screen.getByText('Applied')).toBeTruthy();

    // Regenerating replaces the suggestions array — the review state should clear.
    rerender(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={[{ title: 'Fresh cluster', ticketIds: ['t1', 't2'] }]}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.queryByText('Applied')).toBeNull();
    expect(screen.getByText('Fresh cluster')).toBeTruthy();
  });
});
