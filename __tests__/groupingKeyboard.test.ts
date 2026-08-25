import { describe, it, expect } from 'vitest';
import {
  getGroupingAriaLabel,
  resolveGroupingKey,
  type GroupingKeyContext,
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

const keyContext = (overrides: Partial<GroupingKeyContext> = {}): GroupingKeyContext => ({
  key: 'Enter',
  isGroupPhase: true,
  hasSelection: false,
  isSelected: false,
  canPickUp: true,
  isEventOnSelf: true,
  ...overrides
});

const labelContext = (overrides: Partial<GroupingLabelContext> = {}): GroupingLabelContext => ({
  name: 'Deploys are scary',
  kind: 'ticket',
  hasSelection: false,
  isSelected: false,
  ...overrides
});

describe('resolveGroupingKey — picking a ticket up', () => {
  it.each(['Enter', ' ', 'Spacebar'])('picks the card up on %s', (key) => {
    expect(resolveGroupingKey(keyContext({ key }))).toBe('pick-up');
  });

  it('ignores every other key, so typing still reaches the card content', () => {
    for (const key of ['a', 'Tab', 'ArrowRight', 'Shift', 'x']) {
      expect(resolveGroupingKey(keyContext({ key }))).toBe('none');
    }
  });

  it('does nothing outside the Group phase — cards are only regrouped there', () => {
    expect(resolveGroupingKey(keyContext({ isGroupPhase: false }))).toBe('none');
  });

  it('does nothing when the key came from a control inside the card', () => {
    // The card holds an edit textarea, an emoji button and a delete button.
    // Enter inside any of them must reach that control, never the card.
    expect(resolveGroupingKey(keyContext({ isEventOnSelf: false }))).toBe('none');
    expect(resolveGroupingKey(keyContext({ isEventOnSelf: false, hasSelection: true }))).toBe('none');
  });
});

describe('resolveGroupingKey — confirming and cancelling', () => {
  it('drops the picked-up card onto another card', () => {
    expect(resolveGroupingKey(keyContext({ hasSelection: true }))).toBe('drop');
  });

  it('drops onto a target that cannot itself be picked up (a group, a column)', () => {
    expect(resolveGroupingKey(keyContext({ hasSelection: true, canPickUp: false }))).toBe('drop');
  });

  it('puts the card back down when Enter is pressed on the card that is up', () => {
    expect(resolveGroupingKey(keyContext({ hasSelection: true, isSelected: true }))).toBe('cancel');
  });

  it('cancels on Escape while a card is up', () => {
    expect(resolveGroupingKey(keyContext({ key: 'Escape', hasSelection: true }))).toBe('cancel');
    expect(resolveGroupingKey(keyContext({ key: 'Escape', hasSelection: true, isSelected: true }))).toBe('cancel');
  });

  it('leaves Escape alone when nothing is picked up', () => {
    // Swallowing it would stop an enclosing dialog from closing.
    expect(resolveGroupingKey(keyContext({ key: 'Escape' }))).toBe('none');
  });

  it('refuses to pick up a drop-only target, so a group never becomes a card', () => {
    expect(resolveGroupingKey(keyContext({ canPickUp: false }))).toBe('none');
  });
});

describe('getGroupingAriaLabel — the target announces what Enter will do', () => {
  it('names the ticket and the way in, before anything is picked up', () => {
    const label = getGroupingAriaLabel(labelContext());
    expect(label).toContain('Deploys are scary');
    expect(label).toContain('Enter');
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
