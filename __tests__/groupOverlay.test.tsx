import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import TicketGroupingBanner from '../components/session/TicketGroupingBanner';
import {
  TicketCardAppearance,
  getTicketCardClassName,
  getTicketCardStyle
} from '../components/session/ticketCardAppearance';
import { cardTones } from '../utils/cardTones';
import { pairContrast } from './helpers/tailwindTheme';

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
  tones: cardTones('#ff8800'),
  isDraggable: true,
  ...overrides
});

const STATES: { name: string; value: TicketCardAppearance }[] = [
  { name: 'idle', value: appearance() },
  { name: 'drop target', value: appearance({ isDragTarget: true }) },
  { name: 'selected', value: appearance({ isSelected: true }) },
  { name: 'idle without a custom colour', value: appearance({ tones: null }) },
  { name: 'where the card cannot be picked up', value: appearance({ isDraggable: false }) }
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

    // White words on the brand colour: 12px bold text, so 4.5:1 (blue-500
    // measured 3.7:1 before the Clarté port).
    it('writes its words at a contrast that can be read', () => {
      const { container } = render(<TicketGroupingBanner variant={variant} />);

      expect(pairContrast(container.firstElementChild?.className ?? '')).toBeGreaterThanOrEqual(4.5);
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

      if (value.tones === null) {
        // No hue: no inline style at all, the class list falls back to the
        // default white card.
        expect(style).toBeUndefined();
        expect(getTicketCardClassName(value)).toContain('bg-white');
      } else {
        // A soft tint of the hue, never the saturated colour itself.
        expect(style?.backgroundColor).toBe(value.tones.tint);
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

  it('draws a toned card in its tint, edged with its line, and leaves the ring states their border', () => {
    const tones = cardTones('#ff8800')!;
    expect(getTicketCardStyle(appearance())).toEqual({ backgroundColor: tones.tint, borderColor: tones.line });
    expect(getTicketCardStyle(appearance({ isDragTarget: true }))?.borderColor).toBeUndefined();
    expect(getTicketCardStyle(appearance({ isSelected: true }))?.borderColor).toBeUndefined();
  });

  // Boxes are measured (e2e wide-board, touch-card-controls): a hover deepens
  // the shadow and moves nothing, and only the painted properties transition.
  it('hovers with a shadow only, and transitions no layout', () => {
    const tokens = getTicketCardClassName(appearance()).split(/\s+/);
    expect(tokens).toContain('group');
    expect(tokens).not.toContain('transition-all');
    expect(tokens.some((token) => /translate|scale/.test(token))).toBe(false);
    expect(tokens.some((token) => /hover:shadow/.test(token))).toBe(true);
  });

  it('only offers the grab cursor where cards can actually be dragged', () => {
    expect(getTicketCardClassName(appearance({ isDraggable: true }))).toContain('cursor-grab');
    expect(getTicketCardClassName(appearance({ isDraggable: false }))).not.toContain('cursor-grab');
  });
});
