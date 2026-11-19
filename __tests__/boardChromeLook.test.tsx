import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import TicketOriginBadge from '../components/session/TicketOriginBadge';
import BoardColumnNavigator from '../components/session/BoardColumnNavigator';
import { COLUMN_CLASS_HUES } from '../utils/columnHue';
import { contrastRatio, rgbToHex } from '../utils/colorUtils';
import { effectivePair } from './helpers/tailwindTheme';

const cssHex = (value: string) => {
  const [r, g, b] = value.match(/\d+/g)!.map(Number);
  return rgbToHex(r, g, b);
};

const column = (overrides: Record<string, unknown>) => ({
  id: 'c1', title: 'Went well', color: '', border: '', icon: 'thumb_up', text: '', ring: '', ...overrides,
});

describe('the origin chip of a moved card', () => {
  // Its icon used to take the raw column colour, which a pale custom colour
  // drew under 3:1 on the chip's white.
  it.each([
    ...Object.entries(COLUMN_CLASS_HUES).map(([hue]) => [`classes of ${hue}`, column({ color: `bg-${hue}-50` })] as const),
    ['a pale custom colour', column({ customColor: '#ffff00' })] as const,
    ['a light custom colour', column({ customColor: '#a5f3fc' })] as const,
  ])('draws its icon at 3:1 and its words at 4.5:1 for %s', (_name, col) => {
    render(<TicketOriginBadge column={col} />);
    const badge = screen.getByTestId('ticket-origin-badge');
    const icon = badge.querySelector('.material-symbols-outlined') as HTMLElement;
    expect(contrastRatio(cssHex(icon.style.color), '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(effectivePair(badge).ratio).toBeGreaterThanOrEqual(4.5);
    // 12px at least, no inert icon size.
    expect(badge.className).not.toMatch(/text-\[(9|10|11)px\]/);
  });

  it('draws a column with no hue in a neutral icon, measured', () => {
    render(<TicketOriginBadge column={column({})} />);
    const icon = screen.getByTestId('ticket-origin-badge').querySelector('.material-symbols-outlined') as HTMLElement;
    expect(icon.style.color).toBe('');
    expect(effectivePair(icon).ratio).toBeGreaterThanOrEqual(3);
  });

  it('draws a stored icon name the font cannot draw as one it can', () => {
    render(<TicketOriginBadge column={column({ icon: 'clarity' })} />);
    expect(screen.getByTestId('ticket-origin-badge').textContent).not.toContain('clarity');
  });
});

describe('the column navigator', () => {
  const columns = [
    { id: 'a', title: 'Start', ink: '#14644f' },
    { id: 'b', title: 'Stop', ink: null },
  ];

  it('draws its arrows, off ones included, and its chips at a contrast that can be seen', () => {
    render(
      <BoardColumnNavigator
        columns={columns}
        visibleIds={['a']}
        canScrollLeft={false}
        canScrollRight
        onPrevious={() => {}}
        onNext={() => {}}
        onReveal={() => {}}
      />,
    );
    // Off: the arrow still says where the board ends (slate-400 measured 2.6:1).
    expect(effectivePair(screen.getByRole('button', { name: 'Show the previous columns' })).ratio).toBeGreaterThanOrEqual(3);
    expect(effectivePair(screen.getByRole('button', { name: 'Show the next columns' })).ratio).toBeGreaterThanOrEqual(3);
    for (const id of ['a', 'b']) {
      expect(effectivePair(screen.getByTestId(`board-column-chip-${id}`)).ratio).toBeGreaterThanOrEqual(4.5);
    }
    // The hue's dot is decoration: hidden from assistive technology, and only where the column has a hue.
    expect(screen.getByTestId('board-column-chip-a').querySelector('span[aria-hidden="true"][style]')).not.toBeNull();
    expect(screen.getByTestId('board-column-chip-b').querySelector('span[aria-hidden="true"][style]')).toBeNull();
  });
});
