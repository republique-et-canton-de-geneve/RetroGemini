import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  FEEDBACK_IMAGES_BUDGET,
  FEEDBACK_IMAGE_TARGET,
  IMAGE_AREA_STEPS,
  MAX_IMAGE_SIDE,
  MIN_IMAGE_BUDGET,
  canvasEncoder,
  encodeWithinBudget,
  fitArea,
  imageShare,
  imagesLength,
  isAnimatedImage,
  prepareFeedbackImage,
  remainingImageBudget,
  type EncoderContext
} from '../utils/feedbackImages';

/**
 * A feedback travels as one JSON body with its images inline as data URLs,
 * and the server refuses any JSON body over 1 MiB. The form allowed five
 * images of 2 MB each, so one ordinary screenshot was enough to have the
 * feedback refused with a 413 — after the form had already cleared itself.
 * Images are now reduced in the browser to fit a budget the body can carry.
 *
 * Review of that change: five photos picked at once attached three, the first
 * ones having taken what the last needed; every large GIF lost its animation;
 * a full-page capture came out as a sliver; and the WebP-or-JPEG choice was
 * never executed by any test, because jsdom has no canvas and Playwright runs
 * Chromium only (it is WebKit that answers a WebP request with a PNG).
 */

const BIG_AREA = 1600 * 1600;

describe('fitArea', () => {
  it('keeps an image already within the area', () => {
    expect(fitArea(800, 600, BIG_AREA)).toEqual({ width: 800, height: 600 });
    expect(fitArea(1600, 1600, BIG_AREA)).toEqual({ width: 1600, height: 1600 });
  });

  it('scales the area down and keeps the proportions', () => {
    const size = fitArea(3200, 1800, BIG_AREA);
    expect(size).toEqual({ width: 2133, height: 1200 });
    expect(size.width / size.height).toBeCloseTo(3200 / 1800, 2);
  });

  it('keeps a tall full-page capture wide enough to read', () => {
    // Capping the longest side made this 192 × 1600, and 77 × 640 at the last step.
    const size = fitArea(1440, 12_000, BIG_AREA);
    expect(size).toEqual({ width: 492, height: MAX_IMAGE_SIDE });
    expect(size.width).toBeGreaterThanOrEqual(480);
  });

  it('never makes a side longer than the canvas allows, even within the area', () => {
    expect(fitArea(8000, 200, BIG_AREA)).toEqual({ width: MAX_IMAGE_SIDE, height: 102 });
  });

  it('never rounds a side down to nothing', () => {
    expect(fitArea(100_000, 1, BIG_AREA)).toEqual({ width: MAX_IMAGE_SIDE, height: 1 });
    expect(fitArea(1, 100_000, BIG_AREA)).toEqual({ width: 1, height: MAX_IMAGE_SIDE });
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

describe('imageShare', () => {
  it('gives one image alone the most one image may take', () => {
    expect(imageShare(FEEDBACK_IMAGES_BUDGET, 1)).toBe(FEEDBACK_IMAGE_TARGET);
  });

  it('shares the budget among five images picked at once, so all five fit', () => {
    // Each image used to get min(300k, what is left): three took 800k between
    // them and the last two were refused.
    const share = imageShare(FEEDBACK_IMAGES_BUDGET, 5);
    expect(share).toBe(160_000);
    expect(share * 5).toBeLessThanOrEqual(FEEDBACK_IMAGES_BUDGET);
  });

  it('shares only what the images already attached left', () => {
    const afterTwo = remainingImageBudget(['x'.repeat(300_000), 'x'.repeat(300_000)]);
    expect(afterTwo).toBe(200_000);
    expect(imageShare(afterTwo, 3)).toBe(66_666);

    const afterThree = remainingImageBudget(Array.from({ length: 3 }, () => 'x'.repeat(250_000)));
    expect(imageShare(afterThree, 2)).toBe(25_000);
  });

  it('reads no slot left as one', () => {
    expect(imageShare(100_000, 0)).toBe(100_000);
    expect(imageShare(100_000, -2)).toBe(100_000);
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
    expect(calls).toEqual([{ width: 1600, height: 900, quality: 0.82 }]);
  });

  it('lowers the quality at each size, then the size, until the image fits', () => {
    const { encode, calls } = encoder(0.3);
    const result = encodeWithinBudget(4000, 3000, 150_000, encode);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(150_000);
    // Three qualities at each of the first three sizes, the fourth fitting at
    // its second quality.
    expect(calls).toHaveLength(11);
    expect(calls[0]).toEqual({ width: 1848, height: 1386, quality: 0.82 });
    expect(calls[1]).toEqual({ width: 1848, height: 1386, quality: 0.68 });
    expect(calls[3]).toEqual({ width: 1478, height: 1109, quality: 0.82 });
    expect(calls[calls.length - 1]).toEqual({ width: 924, height: 693, quality: 0.68 });
    // Never more pixels than the first step allows, nor a side the canvas refuses.
    for (const call of calls) {
      expect(call.width * call.height).toBeLessThanOrEqual(IMAGE_AREA_STEPS[0] * 1.01);
      expect(Math.max(call.width, call.height)).toBeLessThanOrEqual(MAX_IMAGE_SIDE);
    }
  });

  it('starts a tall capture at a readable width', () => {
    const { encode, calls } = encoder(0.1);
    encodeWithinBudget(1440, 12_000, 300_000, encode);
    expect(calls[0].width).toBeGreaterThanOrEqual(480);
  });

  it('does not encode the same size twice', () => {
    const { encode, calls } = encoder(50);
    encodeWithinBudget(400, 300, 1_000, encode);
    // 400 × 300 is within every step: one size, three qualities.
    expect(calls).toHaveLength(3);
  });

  it('gives up rather than send an image that cannot fit', () => {
    const { encode } = encoder(50);
    expect(encodeWithinBudget(1600, 1200, 1_000, encode)).toBeNull();
  });
});

describe('canvasEncoder', () => {
  // A canvas that records what is done to it, in order, and answers each
  // toDataURL with the next of `answers`.
  const fakeCanvas = (answers: string[]) => {
    const log: string[] = [];
    const canvas = {
      width: 0,
      height: 0,
      toDataURL: (type: string, quality?: number) => {
        log.push(`toDataURL ${type} ${quality}`);
        return answers.shift() ?? '';
      }
    };
    const context: EncoderContext = {
      fillStyle: '',
      clearRect: (x, y, w, h) => { log.push(`clearRect ${x},${y},${w},${h}`); },
      fillRect: (x, y, w, h) => { log.push(`fillRect ${x},${y},${w},${h} ${String(context.fillStyle)}`); },
      drawImage: (_image, x, y, w, h) => { log.push(`drawImage ${x},${y},${w},${h}`); }
    };
    return { canvas, context, log, image: {} as HTMLImageElement };
  };

  it('sends the WebP the browser wrote', () => {
    const { canvas, context, log, image } = fakeCanvas(['data:image/webp;base64,AAAA']);
    const encode = canvasEncoder(canvas, context, image);

    expect(encode(640, 480, 0.82)).toBe('data:image/webp;base64,AAAA');
    expect(canvas).toMatchObject({ width: 640, height: 480 });
    expect(log).toEqual(['clearRect 0,0,640,480', 'drawImage 0,0,640,480', 'toDataURL image/webp 0.82']);
  });

  it('falls back to JPEG on white when the browser answers with another type', () => {
    // WebKit cannot write WebP and answers with a PNG, which would be far
    // larger than the budget the steps were measured against.
    const { canvas, context, log, image } = fakeCanvas(['data:image/png;base64,PPPP', 'data:image/jpeg;base64,JJJJ']);
    const encode = canvasEncoder(canvas, context, image);

    expect(encode(640, 480, 0.68)).toBe('data:image/jpeg;base64,JJJJ');
    expect(log).toEqual([
      'clearRect 0,0,640,480',
      'drawImage 0,0,640,480',
      'toDataURL image/webp 0.68',
      // JPEG has no transparency: white, then the image again, then JPEG.
      'fillRect 0,0,640,480 #ffffff',
      'drawImage 0,0,640,480',
      'toDataURL image/jpeg 0.68'
    ]);
  });

  it('asks for WebP no more once the browser has shown it cannot write it', () => {
    const { canvas, context, log, image } = fakeCanvas([
      'data:image/png;base64,PPPP',
      'data:image/jpeg;base64,J1',
      'data:image/jpeg;base64,J2'
    ]);
    const encode = canvasEncoder(canvas, context, image);
    encode(640, 480, 0.82);
    log.length = 0;

    expect(encode(320, 240, 0.68)).toBe('data:image/jpeg;base64,J2');
    expect(log).toEqual(['fillRect 0,0,320,240 #ffffff', 'drawImage 0,0,320,240', 'toDataURL image/jpeg 0.68']);
  });

  it('refuses a canvas the browser could not encode at all', () => {
    // A canvas the browser could not allocate answers "data:,", which would
    // be attached as an empty image.
    const { canvas, context, image } = fakeCanvas(['data:,', 'data:,']);
    expect(() => canvasEncoder(canvas, context, image)(640, 480, 0.82)).toThrow();
  });
});

// --- Hand-built image bytes ---------------------------------------------------

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
const u32be = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u32le = (n: number) => u32be(n).reverse();
const concat = (...parts: number[][]) => Uint8Array.from(parts.flat());

// A GIF: header, a 1 × 1 screen with a two-colour global table, then blocks.
const gifHeader = () => [...ascii('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255];
const graphicControl = () => [0x21, 0xf9, 0x04, 0x04, 10, 0, 0, 0x00];
// An image descriptor, an optional local colour table, the LZW minimum code
// size and the image data in one sub-block.
const frame = (data: number[] = [0x44, 0x01], localTable = false) => [
  0x2c, 0, 0, 0, 0, 1, 0, 1, 0, localTable ? 0x81 : 0x00,
  ...(localTable ? new Array(12).fill(7) : []),
  0x02, data.length, ...data, 0x00
];
// A comment extension carrying `size` bytes, to make a GIF as large as needed.
const comment = (size: number) => {
  const blocks: number[] = [0x21, 0xfe];
  for (let left = size; left > 0; left -= 255) {
    const n = Math.min(255, left);
    blocks.push(n, ...new Array(n).fill(0x78));
  }
  return [...blocks, 0x00];
};
const TRAILER = [0x3b];

const oneFrameGif = () => concat(gifHeader(), graphicControl(), frame(), TRAILER);
// A two-frame GIF of exactly `size` bytes: what follows the trailer is never read.
const animationOfSize = (size: number) => {
  const bytes = new Uint8Array(size);
  bytes.set(concat(gifHeader(), frame(), frame(), TRAILER));
  return bytes;
};
const twoFrameGif = () => concat(gifHeader(), graphicControl(), frame(), graphicControl(), frame([0x44, 0x01], true), TRAILER);

const pngChunk = (type: string, data: number[]) => [...u32be(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = pngChunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const ACTL = pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]);
const IDAT = pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x01]);
const IEND = pngChunk('IEND', []);

const webpChunk = (fourCC: string, data: number[]) => [
  ...ascii(fourCC), ...u32le(data.length), ...data, ...(data.length % 2 ? [0] : [])
];
const webp = (...chunks: number[][]) => {
  const body = [...ascii('WEBP'), ...chunks.flat()];
  return concat(ascii('RIFF'), u32le(body.length), body);
};
const vp8x = (flags: number) => webpChunk('VP8X', [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe('isAnimatedImage', () => {
  it('reads a one-frame GIF as still and a two-frame GIF as animated', () => {
    expect(isAnimatedImage(oneFrameGif())).toBe(false);
    expect(isAnimatedImage(twoFrameGif())).toBe(true);
  });

  it('walks the GIF blocks rather than search for their bytes in the image data', () => {
    // The LZW data of one frame happens to hold a graphic control extension
    // and an image descriptor's introducer: still one frame.
    const lookalike = [0x21, 0xf9, 0x04, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x01, 0x44, 0x00];
    expect(isAnimatedImage(concat(gifHeader(), graphicControl(), frame(lookalike), TRAILER))).toBe(false);
  });

  it('finds the second frame of a GIF after any extension, however large', () => {
    expect(isAnimatedImage(concat(gifHeader(), comment(2000), frame(), comment(600), frame(), TRAILER))).toBe(true);
  });

  it('reads an animated PNG by its acTL chunk, before the image data only', () => {
    expect(isAnimatedImage(concat(PNG_SIGNATURE, IHDR, ACTL, IDAT, IEND))).toBe(true);
    expect(isAnimatedImage(concat(PNG_SIGNATURE, IHDR, IDAT, IEND))).toBe(false);
    expect(isAnimatedImage(concat(PNG_SIGNATURE, IHDR, IDAT, ACTL, IEND))).toBe(false);
  });

  it('reads an animated WebP by its VP8X flag or its ANIM chunk', () => {
    expect(isAnimatedImage(webp(vp8x(0x02)))).toBe(true);
    expect(isAnimatedImage(webp(vp8x(0x10), webpChunk('ANIM', [0, 0, 0, 0, 0, 0])))).toBe(true);
    // An odd-sized chunk is padded to an even size before the next one.
    expect(isAnimatedImage(webp(vp8x(0x20), webpChunk('ICCP', [1, 2, 3]), webpChunk('ANIM', [0, 0, 0, 0, 0, 0])))).toBe(true);
    expect(isAnimatedImage(webp(vp8x(0x10), webpChunk('VP8L', [0x2f, 0, 0, 0, 0])))).toBe(false);
    expect(isAnimatedImage(webp(webpChunk('VP8 ', new Array(10).fill(0))))).toBe(false);
  });

  it('reads other formats as still', () => {
    expect(isAnimatedImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe(false);
    expect(isAnimatedImage(new Uint8Array(0))).toBe(false);
  });

  it('reads truncated or malformed bytes as still, and never throws', () => {
    const gif = twoFrameGif();
    // Every cut before the second frame's last byte.
    for (let length = 0; length < gif.length - 1; length += 1) {
      expect(isAnimatedImage(gif.subarray(0, length))).toBe(false);
    }
    const apng = concat(PNG_SIGNATURE, IHDR, ACTL, IDAT, IEND);
    expect(isAnimatedImage(apng.subarray(0, PNG_SIGNATURE.length + IHDR.length + 10))).toBe(false);
    expect(isAnimatedImage(webp(vp8x(0x02)).subarray(0, 16))).toBe(false);
    // A global colour table larger than the file, an unknown block, a chunk
    // length past the end.
    expect(isAnimatedImage(Uint8Array.from([...ascii('GIF89a'), 1, 0, 1, 0, 0x87, 0, 0]))).toBe(false);
    expect(isAnimatedImage(concat(gifHeader(), frame(), [0x99], frame(), TRAILER))).toBe(false);
    expect(isAnimatedImage(concat(PNG_SIGNATURE, [0xff, 0xff, 0xff, 0xff], ascii('acTL')))).toBe(false);
  });
});

// --- prepareFeedbackImage, with the browser pieces jsdom lacks stubbed ------

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const fileOf = (bytes: Uint8Array<ArrayBuffer>, type: string, name = 'image') => new File([bytes], name, { type });
const dataUrlOf = (bytes: Uint8Array, type: string) => `data:${type};base64,${toBase64(bytes)}`;
// Bytes whose data URL is about `chars` long, with no image signature.
const bytesFor = (chars: number) => new Uint8Array(Math.ceil((chars * 3) / 4)).fill(0x11);

const ALL_OF_IT = { share: FEEDBACK_IMAGE_TARGET, available: FEEDBACK_IMAGES_BUDGET };

// An Image that "decodes" to the given size, or fails to. Returns the sources
// it was given, so a test can tell whether anything was decoded at all.
const stubImage = (result: { width: number; height: number } | 'error') => {
  const sources: string[] = [];
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    width = 0;
    height = 0;
    set src(value: string) {
      sources.push(value);
      setTimeout(() => {
        if (result === 'error') {
          this.onerror?.();
          return;
        }
        this.naturalWidth = result.width;
        this.naturalHeight = result.height;
        this.onload?.();
      }, 0);
    }
  }
  vi.stubGlobal('Image', FakeImage);
  return sources;
};

const stubCanvas = (answer: (type: string, quality?: number) => string, withContext = true) => {
  const context = { fillStyle: '', clearRect: vi.fn(), fillRect: vi.fn(), drawImage: vi.fn() };
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue((withContext ? context : null) as never);
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(answer);
  return { context, getContext, toDataURL };
};

describe('prepareFeedbackImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends a small image as it is, without a canvas', async () => {
    const sources = stubImage({ width: 10, height: 10 });
    const { getContext } = stubCanvas(() => 'data:image/webp;base64,X');
    const bytes = bytesFor(1_000);

    await expect(prepareFeedbackImage(fileOf(bytes, 'image/png'), ALL_OF_IT))
      .resolves.toEqual({ status: 'ok', dataUrl: dataUrlOf(bytes, 'image/png') });
    expect(sources).toHaveLength(0);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('keeps a small screenshot sharp when its share is smaller, as long as it fits what is left', async () => {
    const sources = stubImage({ width: 10, height: 10 });
    const bytes = bytesFor(100_000);

    await expect(prepareFeedbackImage(fileOf(bytes, 'image/png'), { share: 30_000, available: 200_000 }))
      .resolves.toEqual({ status: 'ok', dataUrl: dataUrlOf(bytes, 'image/png') });
    expect(sources).toHaveLength(0);
  });

  it('reduces a small image that no longer fits what is left', async () => {
    stubImage({ width: 800, height: 600 });
    stubCanvas(() => 'data:image/webp;base64,REDUCED');

    await expect(prepareFeedbackImage(fileOf(bytesFor(100_000), 'image/png'), { share: 30_000, available: 90_000 }))
      .resolves.toEqual({ status: 'ok', dataUrl: 'data:image/webp;base64,REDUCED' });
  });

  it('refuses without decoding when the share is too small to be worth reducing into', async () => {
    const sources = stubImage({ width: 1600, height: 900 });

    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/jpeg'), { share: MIN_IMAGE_BUDGET - 1, available: 400_000 }))
      .resolves.toEqual({ status: 'too_large' });
    expect(sources).toHaveLength(0);
  });

  it('decodes through the data URL, never an object URL the CSP refuses', async () => {
    const sources = stubImage({ width: 1600, height: 900 });
    stubCanvas(() => 'data:image/webp;base64,REDUCED');
    const bytes = bytesFor(200_000);

    await prepareFeedbackImage(fileOf(bytes, 'image/jpeg'), ALL_OF_IT);
    expect(sources).toEqual([dataUrlOf(bytes, 'image/jpeg')]);
  });

  it('reduces a large image to the sharpest encoding within its share', async () => {
    stubImage({ width: 4000, height: 3000 });
    const { context, toDataURL } = stubCanvas((_type, quality) => `data:image/webp;base64,${'q'.repeat(quality! > 0.6 ? 200_000 : 100_000)}`);

    const result = await prepareFeedbackImage(fileOf(bytesFor(400_000), 'image/jpeg'), { share: 150_000, available: 800_000 });
    expect(result).toEqual({ status: 'ok', dataUrl: `data:image/webp;base64,${'q'.repeat(100_000)}` });
    expect(toDataURL.mock.calls.map(([, quality]) => quality)).toEqual([0.82, 0.68, 0.55]);
    expect(context.drawImage).toHaveBeenLastCalledWith(expect.anything(), 0, 0, 1848, 1386);
  });

  it('refuses an image whose most reduced form still exceeds its share', async () => {
    stubImage({ width: 1600, height: 900 });
    stubCanvas(() => `data:image/webp;base64,${'q'.repeat(50_000)}`);

    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/jpeg'), { share: 40_000, available: 800_000 }))
      .resolves.toEqual({ status: 'too_large' });
  });

  it('reports an image the browser cannot decode', async () => {
    stubImage('error');
    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/jpeg'), ALL_OF_IT)).resolves.toEqual({ status: 'unreadable' });
  });

  it('reports an image that decodes to no size at all, without drawing it', async () => {
    // An SVG with no intrinsic size: there is nothing to draw, whatever the
    // canvas would answer.
    stubImage({ width: 0, height: 0 });
    const { getContext } = stubCanvas(() => 'data:image/webp;base64,X');
    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/svg+xml'), ALL_OF_IT)).resolves.toEqual({ status: 'unreadable' });
    expect(getContext).not.toHaveBeenCalled();
  });

  it('reports an image when the browser gives no 2d canvas', async () => {
    stubImage({ width: 1600, height: 900 });
    stubCanvas(() => 'data:image/webp;base64,X', false);
    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/jpeg'), ALL_OF_IT)).resolves.toEqual({ status: 'unreadable' });
  });

  it('reports an image the canvas refuses to encode', async () => {
    // An SVG that references another origin taints the canvas, and toDataURL
    // then throws a SecurityError.
    stubImage({ width: 1600, height: 900 });
    stubCanvas(() => {
      throw new DOMException('The canvas has been tainted', 'SecurityError');
    });
    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/svg+xml'), ALL_OF_IT)).resolves.toEqual({ status: 'unreadable' });
  });

  it('reports a file that cannot be read, rather than reject', async () => {
    vi.spyOn(FileReader.prototype, 'readAsDataURL').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });
    await expect(prepareFeedbackImage(fileOf(bytesFor(100), 'image/png'), ALL_OF_IT)).resolves.toEqual({ status: 'unreadable' });
  });

  it('never rejects, whatever the browser throws', async () => {
    vi.stubGlobal('Image', class { constructor() { throw new Error('no images here'); } });
    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/jpeg'), ALL_OF_IT)).resolves.toEqual({ status: 'unreadable' });

    stubImage({ width: 1600, height: 900 });
    vi.spyOn(document, 'createElement').mockImplementation(() => { throw new Error('no canvas here'); });
    await expect(prepareFeedbackImage(fileOf(bytesFor(200_000), 'image/jpeg'), ALL_OF_IT)).resolves.toEqual({ status: 'unreadable' });
  });

  it('sends an animated GIF as it is when it fits, without a canvas', async () => {
    // Drawing it on a canvas would keep its first frame only.
    const sources = stubImage({ width: 1, height: 1 });
    const { getContext } = stubCanvas(() => 'data:image/webp;base64,X');
    const gif = concat(gifHeader(), comment(200_000), frame(), frame(), TRAILER);
    expect(dataUrlOf(gif, 'image/gif').length).toBeGreaterThan(200_000);

    await expect(prepareFeedbackImage(fileOf(gif, 'image/gif'), ALL_OF_IT))
      .resolves.toEqual({ status: 'ok', dataUrl: dataUrlOf(gif, 'image/gif') });
    expect(sources).toHaveLength(0);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('may give an animation more than its share, never more than what is left', async () => {
    stubImage({ width: 1, height: 1 });
    const gif = concat(gifHeader(), comment(60_000), frame(), frame(), TRAILER);
    const dataUrl = dataUrlOf(gif, 'image/gif');

    await expect(prepareFeedbackImage(fileOf(gif, 'image/gif'), { share: 40_000, available: 100_000 }))
      .resolves.toEqual({ status: 'ok', dataUrl });
    await expect(prepareFeedbackImage(fileOf(gif, 'image/gif'), { share: 40_000, available: dataUrl.length - 1 }))
      .resolves.toMatchObject({ status: 'animated_too_large' });
  });

  it('refuses an animation larger than one image may take, rather than flatten it', async () => {
    const sources = stubImage({ width: 1, height: 1 });
    const { getContext } = stubCanvas(() => 'data:image/webp;base64,X');
    const gif = concat(gifHeader(), comment(240_000), frame(), frame(), TRAILER);
    expect(dataUrlOf(gif, 'image/gif').length).toBeGreaterThan(FEEDBACK_IMAGE_TARGET);

    await expect(prepareFeedbackImage(fileOf(gif, 'image/gif'), ALL_OF_IT))
      .resolves.toEqual({ status: 'animated_too_large', maxBytes: 224_982 });
    expect(sources).toHaveLength(0);
    expect(getContext).not.toHaveBeenCalled();
  });

  // The refusal used to say an animation is sent "up to about 300 kB", but the
  // limit counts data-URL characters, a third more than the file's bytes: a
  // 260 kB GIF was refused by a message that said it fitted. What it names now
  // is the largest file that is attached, whatever decides it, one image's
  // cap or what the others have left.
  it('names, when it refuses an animation, the largest file that would have been attached', async () => {
    stubImage({ width: 1, height: 1 });
    const gif = (bytes: number) => fileOf(animationOfSize(bytes), 'image/gif');

    await expect(prepareFeedbackImage(gif(224_982), ALL_OF_IT)).resolves.toMatchObject({ status: 'ok' });
    await expect(prepareFeedbackImage(gif(224_983), ALL_OF_IT))
      .resolves.toEqual({ status: 'animated_too_large', maxBytes: 224_982 });

    const others = { share: 40_000, available: 100_000 };
    await expect(prepareFeedbackImage(gif(74_982), others)).resolves.toMatchObject({ status: 'ok' });
    await expect(prepareFeedbackImage(gif(74_983), others))
      .resolves.toEqual({ status: 'animated_too_large', maxBytes: 74_982 });
    // With no room left at all, no animation fits: never a negative size.
    await expect(prepareFeedbackImage(gif(100), { share: 0, available: 0 }))
      .resolves.toEqual({ status: 'animated_too_large', maxBytes: 0 });
  });

  it('reduces a large still GIF like any other image', async () => {
    const sources = stubImage({ width: 1600, height: 900 });
    stubCanvas(() => 'data:image/webp;base64,STILL');
    const gif = concat(gifHeader(), comment(150_000), frame(), TRAILER);

    await expect(prepareFeedbackImage(fileOf(gif, 'image/gif'), ALL_OF_IT))
      .resolves.toEqual({ status: 'ok', dataUrl: 'data:image/webp;base64,STILL' });
    expect(sources).toHaveLength(1);
  });

  it('sends an animated PNG or WebP as it is too', async () => {
    const sources = stubImage({ width: 1, height: 1 });
    const padding = new Array(160_000).fill(0);
    const apng = concat(PNG_SIGNATURE, IHDR, ACTL, pngChunk('IDAT', padding), IEND);
    const animatedWebp = webp(vp8x(0x12), webpChunk('ANIM', [0, 0, 0, 0, 0, 0]), webpChunk('ANMF', padding));

    await expect(prepareFeedbackImage(fileOf(apng, 'image/png'), ALL_OF_IT))
      .resolves.toEqual({ status: 'ok', dataUrl: dataUrlOf(apng, 'image/png') });
    await expect(prepareFeedbackImage(fileOf(animatedWebp, 'image/webp'), ALL_OF_IT))
      .resolves.toEqual({ status: 'ok', dataUrl: dataUrlOf(animatedWebp, 'image/webp') });
    expect(sources).toHaveLength(0);
  });
});
