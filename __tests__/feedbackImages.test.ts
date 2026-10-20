import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_IMAGES_BUDGET,
  MAX_IMAGE_DIMENSION,
  encodeWithinBudget,
  fitWithin,
  imagesLength,
  remainingImageBudget
} from '../utils/feedbackImages';

/**
 * A feedback travels as one JSON body with its images inline as data URLs,
 * and the server refuses any JSON body over 1 MiB. The form allowed five
 * images of 2 MB each, so one ordinary screenshot was enough to have the
 * feedback refused with a 413 — after the form had already cleared itself.
 * Images are now reduced in the browser to fit a budget the body can carry.
 */

describe('fitWithin', () => {
  it('keeps an image that already fits', () => {
    expect(fitWithin(800, 600, MAX_IMAGE_DIMENSION)).toEqual({ width: 800, height: 600 });
  });

  it('scales the longest side down and keeps the proportions', () => {
    expect(fitWithin(3200, 1800, 1600)).toEqual({ width: 1600, height: 900 });
    expect(fitWithin(1080, 2400, 1600)).toEqual({ width: 720, height: 1600 });
  });

  it('never rounds a side down to nothing', () => {
    expect(fitWithin(10_000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('the images budget', () => {
  it('leaves room for the text and credentials in a 1 MiB body', () => {
    // Title (100) and description (2000) at up to 3 bytes per character,
    // the credentials and the JSON around them.
    expect(FEEDBACK_IMAGES_BUDGET + 2100 * 3 + 4096).toBeLessThan(1024 * 1024);
  });

  it('counts what the images already take', () => {
    expect(imagesLength(['abc', 'de'])).toBe(5);
    expect(remainingImageBudget(['x'.repeat(100)])).toBe(FEEDBACK_IMAGES_BUDGET - 100);
    expect(remainingImageBudget(['x'.repeat(FEEDBACK_IMAGES_BUDGET + 5)])).toBe(0);
  });
});

describe('encodeWithinBudget', () => {
  // A fake encoder whose output length is proportional to the pixels and the
  // quality, the way a real one roughly is.
  const encoder = (bytesPerPixel: number) => {
    const calls: { width: number; height: number; quality: number }[] = [];
    const encode = (width: number, height: number, quality: number) => {
      calls.push({ width, height, quality });
      return 'd'.repeat(Math.round(width * height * bytesPerPixel * quality));
    };
    return { encode, calls };
  };

  it('takes the first, sharpest encoding that fits', () => {
    const { encode, calls } = encoder(0.1);
    const result = encodeWithinBudget(1600, 900, 200_000, encode);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(200_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ width: 1600, height: 900 });
  });

  it('lowers the quality, then the size, until the image fits', () => {
    const { encode, calls } = encoder(0.3);
    const result = encodeWithinBudget(4000, 3000, 150_000, encode);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(150_000);
    expect(calls.length).toBeGreaterThan(1);
    // Never larger than the cap, whatever the source.
    expect(Math.max(...calls.map((c) => Math.max(c.width, c.height)))).toBeLessThanOrEqual(MAX_IMAGE_DIMENSION);
  });

  it('gives up rather than send an image that cannot fit', () => {
    const { encode } = encoder(50);
    expect(encodeWithinBudget(1600, 1200, 1_000, encode)).toBeNull();
  });
});
