import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import TicketGroupingBanner from '../components/session/TicketGroupingBanner';
import {
  TicketCardAppearance,
  getTicketCardClassName,
  getTicketCardStyle
} from '../components/session/ticketCardAppearance';

/**
 * Group phase: the ticket text must stay visible while grouping.
 *
 * The "Group with this" and "Selected - Tap to cancel" indicators must not
 * obscure the card content — they are normal-flow banners flush with the card
 * edges, and the card keeps its own background colour in every drag state.
 */

const appearance = (overrides: Partial<TicketCardAppearance> = {}): TicketCardAppearance => ({
  isDragTarget: false,
  isSelected: false,
  cardBgHex: '#ff8800',
  isGroupMode: true,
  ...overrides
});

const STATES: { name: string; value: TicketCardAppearance }[] = [
  { name: 'idle', value: appearance() },
  { name: 'drop target', value: appearance({ isDragTarget: true }) },
  { name: 'selected', value: appearance({ isSelected: true }) },
  { name: 'idle without a custom colour', value: appearance({ cardBgHex: null }) },
  { name: 'outside the group phase', value: appearance({ isGroupMode: false }) }
];

describe('Group phase overlays — ticket text visibility', () => {
  describe.each(['drop-target', 'selected'] as const)('the %s banner', (variant) => {
    it('renders in the normal flow, never as an overlay covering the card', () => {
      const { container } = render(<TicketGroupingBanner variant={variant} />);
      const banner = container.firstElementChild;

      expect(banner).toBeTruthy();
      // `inset-0` with absolute positioning is what used to cover the text.
      expect(banner?.className).not.toContain('inset-0');
      expect(banner?.className).not.toContain('absolute');
      expect(banner?.className).not.toContain('fixed');
    });

    it('stays flush with the card edges and pushes the content down', () => {
      const { container } = render(<TicketGroupingBanner variant={variant} />);
      const className = container.firstElementChild?.className ?? '';

      // Negative horizontal/top margins cancel the card's p-3 padding so the
      // banner meets the card edges; mb-2 gives the text below it room.
      expect(className).toContain('-mx-3');
      expect(className).toContain('-mt-3');
      expect(className).toContain('mb-2');
    });

    it('never swallows the pointer events the card needs for grouping', () => {
      const { container } = render(<TicketGroupingBanner variant={variant} />);

      expect(container.firstElementChild?.className).toContain('pointer-events-none');
    });
  });

  it('labels the drop target and the selected card differently', () => {
    const dropTarget = render(<TicketGroupingBanner variant="drop-target" />);
    expect(screen.getByText(/Group with this/)).toBeTruthy();
    dropTarget.unmount();

    render(<TicketGroupingBanner variant="selected" />);
    expect(screen.getByText(/Selected - Tap to cancel/)).toBeTruthy();
  });

  describe.each(STATES)('card appearance — $name', ({ value }) => {
    it('keeps the card background colour whatever the drag state', () => {
      const style = getTicketCardStyle(value);

      if (value.cardBgHex === null) {
        // No custom colour: no inline style at all, the class list falls back
        // to the default white card.
        expect(style).toBeUndefined();
        expect(getTicketCardClassName(value)).toContain('bg-white');
      } else {
        expect(style?.backgroundColor).toBe(value.cardBgHex);
      }
    });

    it('never repaints the card with the classes that used to hide its text', () => {
      const className = getTicketCardClassName(value);

      expect(className).not.toContain('bg-blue-50');
      expect(className).not.toContain('scale-105');
    });
  });

  it('signals the drop target and the selection with a ring, not a repaint', () => {
    const dragTarget = appearance({ isDragTarget: true });
    const selected = appearance({ isSelected: true });

    expect(getTicketCardClassName(dragTarget)).toContain('ring-4');
    expect(getTicketCardClassName(selected)).toContain('ring-4');
    // Same background as an untouched card: the ring is the only difference.
    expect(getTicketCardStyle(dragTarget)?.backgroundColor).toBe(
      getTicketCardStyle(appearance())?.backgroundColor
    );
    expect(getTicketCardStyle(selected)?.backgroundColor).toBe(
      getTicketCardStyle(appearance())?.backgroundColor
    );
  });

  it('only offers the grab cursor where cards can actually be dragged', () => {
    expect(getTicketCardClassName(appearance({ isGroupMode: true }))).toContain('cursor-grab');
    expect(getTicketCardClassName(appearance({ isGroupMode: false }))).not.toContain('cursor-grab');
  });
});
