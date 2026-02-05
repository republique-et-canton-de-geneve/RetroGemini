import { describe, it, expect } from 'vitest';

/**
 * Tests for Feature 2: Ticket text remains visible during grouping.
 *
 * The "Group with this" and "Selected - Tap to cancel" overlays must NOT
 * use absolute positioning that covers the full card. They should be
 * normal-flow banners (using negative margins to stay flush with the card
 * edges) so the ticket text stays readable underneath.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

describe('Group Phase Overlays - Ticket text visibility', () => {
  const sessionSource = readFileSync(
    join(__dirname, '..', 'components', 'Session.tsx'),
    'utf-8'
  );

  it('should NOT use absolute positioning for the "Group with this" overlay', () => {
    // The old implementation used: absolute inset-0 bg-indigo-50/90
    // which covered the entire card and hid the text.
    // The fix uses normal flow with negative margins (-mx-3 -mt-3 mb-2).
    const lines = sessionSource.split('\n');
    const groupWithThisOverlayLines = lines.filter(
      (line) => line.includes('Group with this')
    );

    // None of the overlay lines should use absolute positioning
    for (const line of groupWithThisOverlayLines) {
      expect(line).not.toContain('absolute');
      expect(line).not.toContain('inset-0');
    }
  });

  it('should NOT use absolute positioning for the "Selected - Tap to cancel" overlay', () => {
    const lines = sessionSource.split('\n');
    const selectedLines = lines.filter(
      (line) => line.includes('Selected - Tap to cancel')
    );

    for (const line of selectedLines) {
      expect(line).not.toContain('absolute');
      expect(line).not.toContain('inset-0');
    }
  });

  it('should use negative margins for the "Group with this" banner to be flush with card edges', () => {
    const mergeIndex = sessionSource.indexOf('Group with this');
    const precedingChunk = sessionSource.substring(Math.max(0, mergeIndex - 300), mergeIndex);
    // Should use negative margins to extend to card edges
    expect(precedingChunk).toContain('-mx-3');
    expect(precedingChunk).toContain('-mt-3');
    expect(precedingChunk).toContain('mb-2');
  });

  it('should use negative margins for the "Selected - Tap to cancel" banner', () => {
    const selectedIndex = sessionSource.indexOf('Selected - Tap to cancel');
    const precedingChunk = sessionSource.substring(Math.max(0, selectedIndex - 300), selectedIndex);
    expect(precedingChunk).toContain('-mx-3');
    expect(precedingChunk).toContain('-mt-3');
    expect(precedingChunk).toContain('mb-2');
  });
});
