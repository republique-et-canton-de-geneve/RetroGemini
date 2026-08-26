import { describe, it, expect } from 'vitest';
import {
  getGroupingAriaLabel,
  getGroupingButtonText,
  isGroupingCancelKey,
  resolveGroupingActivation,
  type GroupingActivationContext,
  type GroupingLabelContext
} from '../components/session/groupingKeyboard';

/**
 * Group phase: grouping tickets must be reachable without a pointer.
 *
 * The manual accessibility pass (H42) found the Group phase to be pointer-only
 * — WCAG 2.1.1 (Keyboard) on a core phase of the product. No automated tool in
 * this repository could report it: the markup was well-formed, there was simply
 * no keyboard control at all.
 *
 * The fix reuses the touch flow's state machine rather than inventing a second
 * one: pick a card up, then confirm on the target. These are the rules that
 * flow encodes, kept out of `Session.tsx` so they can be asserted directly.
 */

const activation = (overrides: Partial<GroupingActivationContext> = {}): GroupingActivationContext => ({
  isGroupPhase: true,
  hasSelection: false,
  isSelected: false,
  canPickUp: true,
  ...overrides
});

const labelContext = (overrides: Partial<GroupingLabelContext> = {}): GroupingLabelContext => ({
  name: 'Deploys are scary',
  kind: 'ticket',
  hasSelection: false,
  isSelected: false,
  ...overrides
});

describe('resolveGroupingActivation', () => {
  it('picks the card up when nothing is held', () => {
    expect(resolveGroupingActivation(activation())).toBe('pick-up');
  });

  it('does nothing outside the Group phase — cards are only regrouped there', () => {
    expect(resolveGroupingActivation(activation({ isGroupPhase: false }))).toBe('none');
    expect(resolveGroupingActivation(activation({ isGroupPhase: false, hasSelection: true }))).toBe('none');
  });

  it('drops the held card onto another card', () => {
    expect(resolveGroupingActivation(activation({ hasSelection: true }))).toBe('drop');
  });

  it('drops onto a target that cannot itself be picked up (a group, a column)', () => {
    expect(resolveGroupingActivation(activation({ hasSelection: true, canPickUp: false }))).toBe('drop');
  });

  it('puts the card back down when the held card is activated again', () => {
    expect(resolveGroupingActivation(activation({ hasSelection: true, isSelected: true }))).toBe('cancel');
  });

  it('refuses to pick up a drop-only target, so a group never becomes a card', () => {
    expect(resolveGroupingActivation(activation({ canPickUp: false }))).toBe('none');
  });
});

describe('isGroupingCancelKey', () => {
  it('claims Escape and nothing else', () => {
    expect(isGroupingCancelKey('Escape')).toBe(true);
    for (const key of ['Enter', ' ', 'Tab', 'a', 'ArrowLeft']) {
      expect(isGroupingCancelKey(key)).toBe(false);
    }
  });
});

describe('getGroupingAriaLabel — the target announces what activating it will do', () => {
  it('names the ticket and the action, before anything is picked up', () => {
    const label = getGroupingAriaLabel(labelContext());
    expect(label).toContain('Deploys are scary');
    expect(label).toContain('Pick up');
  });

  it('says the card is held, and how to put it back down', () => {
    const label = getGroupingAriaLabel(labelContext({ hasSelection: true, isSelected: true }));
    expect(label).toContain('Selected');
    expect(label).toContain('Escape');
  });

  it('describes the pending action, not the target, once a card is held', () => {
    const ticket = getGroupingAriaLabel(labelContext({ hasSelection: true }));
    expect(ticket).toContain('Group');
    expect(ticket).toContain('Deploys are scary');

    const group = getGroupingAriaLabel(labelContext({ kind: 'group', name: 'Release pain', hasSelection: true }));
    expect(group).toContain('Release pain');
    expect(group.toLowerCase()).toContain('group');

    const column = getGroupingAriaLabel(labelContext({ kind: 'column', name: 'Went well', hasSelection: true }));
    expect(column).toContain('Went well');
  });

  it('never announces an empty name', () => {
    for (const kind of ['ticket', 'group', 'column'] as const) {
      for (const hasSelection of [false, true]) {
        const label = getGroupingAriaLabel(labelContext({ kind, name: '   ', hasSelection }));
        expect(label.trim()).not.toBe('');
        expect(label).not.toContain('  .');
      }
    }
  });

  it('gives an untitled group a name a screen reader can read out', () => {
    const label = getGroupingAriaLabel(labelContext({ kind: 'group', name: '', hasSelection: true }));
    expect(label.toLowerCase()).toContain('untitled group');
  });
});

describe('getGroupingButtonText — what the button says', () => {
  it('offers to pick up, to group, or to cancel, matching the announced action', () => {
    expect(getGroupingButtonText({ hasSelection: false, isSelected: false })).toBe('Pick up');
    expect(getGroupingButtonText({ hasSelection: true, isSelected: false })).toBe('Group here');
    expect(getGroupingButtonText({ hasSelection: true, isSelected: true })).toBe('Cancel');
  });
});
