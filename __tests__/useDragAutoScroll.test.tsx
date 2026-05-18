import React, { useRef } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { useDragAutoScroll } from '../utils/useDragAutoScroll';

interface HarnessProps {
  active: boolean;
  vRect: DOMRect;
  hRect: DOMRect;
}

const buildRect = (overrides: Partial<DOMRect>): DOMRect => ({
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  width: 0,
  height: 0,
  toJSON: () => ({}),
  ...overrides,
}) as DOMRect;

const Harness: React.FC<HarnessProps> = ({ active, vRect, hRect }) => {
  const vRef = useRef<HTMLDivElement>(null);
  const hRef = useRef<HTMLDivElement>(null);

  useDragAutoScroll({
    active,
    verticalScroller: () => vRef.current,
    horizontalScroller: () => hRef.current,
    edgeSize: 100,
    maxSpeed: 20,
  });

  return (
    <>
      <div
        data-testid="vertical"
        ref={(el) => {
          if (el) {
            (el as HTMLDivElement).getBoundingClientRect = () => vRect;
            vRef.current = el as HTMLDivElement;
          }
        }}
      />
      <div
        data-testid="horizontal"
        ref={(el) => {
          if (el) {
            (el as HTMLDivElement).getBoundingClientRect = () => hRect;
            hRef.current = el as HTMLDivElement;
          }
        }}
      />
    </>
  );
};

describe('useDragAutoScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    let rafId = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      rafId += 1;
      const id = rafId;
      setTimeout(() => cb(performance.now()), 16);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (_id: number) => {
      // No-op for tests; pending timers are flushed by vi.useFakeTimers cleanup.
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const dispatchDragOver = (clientX: number, clientY: number) => {
    const event = new Event('dragover', { bubbles: true }) as DragEvent;
    Object.defineProperty(event, 'clientX', { value: clientX });
    Object.defineProperty(event, 'clientY', { value: clientY });
    window.dispatchEvent(event);
  };

  it('scrolls the vertical scroller up when the pointer is near the top edge', () => {
    const vRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const hRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const { getByTestId } = render(<Harness active vRect={vRect} hRect={hRect} />);
    const vEl = getByTestId('vertical') as HTMLDivElement;
    vEl.scrollTop = 200;

    act(() => {
      dispatchDragOver(400, 110); // 10px below the top -> inside top hot zone
      vi.advanceTimersByTime(50);
    });

    expect(vEl.scrollTop).toBeLessThan(200);
  });

  it('scrolls the horizontal scroller right when the pointer is near the right edge', () => {
    const vRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const hRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const { getByTestId } = render(<Harness active vRect={vRect} hRect={hRect} />);
    const hEl = getByTestId('horizontal') as HTMLDivElement;
    hEl.scrollLeft = 0;

    act(() => {
      dispatchDragOver(795, 300); // near right edge
      vi.advanceTimersByTime(50);
    });

    expect(hEl.scrollLeft).toBeGreaterThan(0);
  });

  it('also scrolls in touch-selection mode via pointermove (no HTML5 drag)', () => {
    const vRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const hRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const { getByTestId } = render(<Harness active vRect={vRect} hRect={hRect} />);
    const vEl = getByTestId('vertical') as HTMLDivElement;
    vEl.scrollTop = 200;

    act(() => {
      const event = new Event('pointermove', { bubbles: true }) as PointerEvent;
      Object.defineProperty(event, 'clientX', { value: 400 });
      Object.defineProperty(event, 'clientY', { value: 110 });
      window.dispatchEvent(event);
      vi.advanceTimersByTime(50);
    });

    expect(vEl.scrollTop).toBeLessThan(200);
  });

  it('scrolls up at full speed when the pointer is in the band above the scroller (e.g. action bar)', () => {
    // Scroller starts at y=150 (action bar lives between y=80 and y=150).
    const vRect = buildRect({ top: 150, bottom: 700, left: 0, right: 800, height: 550, width: 800 });
    const hRect = buildRect({ top: 150, bottom: 700, left: 0, right: 800, height: 550, width: 800 });
    const { getByTestId } = render(<Harness active vRect={vRect} hRect={hRect} />);
    const vEl = getByTestId('vertical') as HTMLDivElement;
    vEl.scrollTop = 400;

    act(() => {
      dispatchDragOver(400, 110); // 40px above the scroller — in the action bar
      vi.advanceTimersByTime(50);
    });

    // Cursor above the top edge counts as deep into the hot zone, so we
    // expect a meaningful scroll-up (at least a few pixels per frame).
    expect(vEl.scrollTop).toBeLessThan(380);
  });

  it('does nothing when inactive', () => {
    const vRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const hRect = buildRect({ top: 100, bottom: 600, left: 0, right: 800, height: 500, width: 800 });
    const { getByTestId } = render(<Harness active={false} vRect={vRect} hRect={hRect} />);
    const vEl = getByTestId('vertical') as HTMLDivElement;
    vEl.scrollTop = 200;

    act(() => {
      dispatchDragOver(400, 110);
      vi.advanceTimersByTime(50);
    });

    expect(vEl.scrollTop).toBe(200);
  });
});
