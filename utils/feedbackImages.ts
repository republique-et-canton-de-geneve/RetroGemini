/**
 * Images attached to a feedback travel inline, as data URLs, in the one JSON
 * body `/api/feedbacks/create` receives — and the server refuses any JSON body
 * over 1 MiB (`express.json({ limit: '1mb' })` in server.js, and the same
 * default on an ingress-nginx in front of it). The form used to accept five
 * images of 2 MB each, so a single ordinary screenshot had the feedback
 * refused with a 413. Raising the server's limit instead would store
 * multi-megabyte images in the team record, which every write to the team
 * rewrites and every feedback list loads.
 *
 * So the browser prepares each image before attaching it, by these rules:
 *
 * - The images of one feedback share FEEDBACK_IMAGES_BUDGET. Each image of a
 *   pick is offered a share of what is left, divided among the images still
 *   to attach (`imageShare`), and never more than FEEDBACK_IMAGE_TARGET:
 *   offering each one all that was left let the first photos of a pick of
 *   five take what the last two needed.
 * - A small image (up to KEEP_ORIGINAL_UP_TO) is sent as it is, even when its
 *   share is smaller, as long as it fits what is left: re-encoding a small
 *   screenshot would only blur its text.
 * - An animation (GIF, APNG, animated WebP) is sent as it is or not at all. A
 *   canvas draws one frame, so reducing it would silently send a still image.
 * - Anything else is drawn on a canvas and re-encoded as WebP (JPEG on white
 *   where the browser cannot write WebP), stepping the quality and then the
 *   size down until it fits its share. The size steps limit the pixel *area*,
 *   not the longest side, so a full-page capture keeps a readable width; no
 *   side ever exceeds MAX_IMAGE_SIDE.
 *
 * `prepareFeedbackImage` never rejects: it says what became of the image, so
 * the form can say why one file was not attached and carry on with the next.
 */

// What the images of one feedback may take in all, in data-URL characters
// (base64 is ASCII, so characters are bytes). The rest of the 1 MiB body is
// left to the text, the credentials and the JSON around them.
export const FEEDBACK_IMAGES_BUDGET = 800_000;

// What one image may take, so that several can be attached.
export const FEEDBACK_IMAGE_TARGET = 300_000;

// A smaller image than this is sent as it is: re-encoding a small screenshot
// would only blur its text.
export const KEEP_ORIGINAL_UP_TO = 150_000;

// Below this, an image would be too degraded to be worth sending.
export const MIN_IMAGE_BUDGET = 20_000;

// What the file picker accepts before reducing: phone photos run to several
// megabytes, and are reduced like any other image.
export const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;

// The pixel areas the size steps allow, largest first. An area rather than a
// longest side: capping the longest side turned a 1440 × 12000 full-page
// capture into a 192 px wide sliver nobody could read.
export const IMAGE_AREA_STEPS = [1600 * 1600, 1280 * 1280, 1024 * 1024, 800 * 800, 640 * 640];

// The longest side iOS Safari will draw on a canvas.
export const MAX_IMAGE_SIDE = 4096;

const QUALITY_STEPS = [0.82, 0.68, 0.55];

export type PreparedFeedbackImage =
  | { status: 'ok'; dataUrl: string }
  // Even its most reduced form exceeds its share.
  | { status: 'too_large' }
  // An animation is only ever sent as it is, and it does not fit.
  | { status: 'animated_too_large' }
  // The browser could not read, decode or re-encode it.
  | { status: 'unreadable' };

// What one image may take (`share`), and what the whole feedback has left
// (`available`), which an image kept as it is may use beyond its share.
export interface ImageAllowance {
  share: number;
  available: number;
}

/**
 * The size an image is drawn at for a step: its own size when it is within
 * `maxArea` pixels and MAX_IMAGE_SIDE a side, otherwise scaled down, with its
 * proportions, until it is.
 */
export const fitArea = (width: number, height: number, maxArea: number) => {
  const scale = Math.min(1, Math.sqrt(maxArea / (width * height)), MAX_IMAGE_SIDE / Math.max(width, height));
  if (scale >= 1) return { width, height };
  const side = (length: number) => Math.min(MAX_IMAGE_SIDE, Math.max(1, Math.round(length * scale)));
  return { width: side(width), height: side(height) };
};

export const imagesLength = (images: string[]) => images.reduce((total, image) => total + image.length, 0);

export const remainingImageBudget = (images: string[]) => Math.max(0, FEEDBACK_IMAGES_BUDGET - imagesLength(images));

/**
 * What one image of a pick may take: what is left, shared by the `slots`
 * images still to attach, and never more than one image may take alone. An
 * image that takes less than its share leaves the rest to those after it,
 * because the share is computed again for each one.
 */
export const imageShare = (available: number, slots: number) =>
  Math.min(FEEDBACK_IMAGE_TARGET, Math.floor(available / Math.max(1, slots)));

/**
 * The sharpest encoding of a `width` × `height` image that fits in `maxChars`,
 * or null when none does: every quality at a size before the next, smaller
 * size. `encode` draws the image at the given size and returns its data URL;
 * it is a parameter so the stepping can be tested without a canvas.
 */
export const encodeWithinBudget = (
  width: number,
  height: number,
  maxChars: number,
  encode: (width: number, height: number, quality: number) => string
): string | null => {
  const sizes = IMAGE_AREA_STEPS
    .map((area) => fitArea(width, height, area))
    .filter((size, index, all) => index === 0 || size.width !== all[index - 1].width || size.height !== all[index - 1].height);
  for (const size of sizes) {
    for (const quality of QUALITY_STEPS) {
      const encoded = encode(size.width, size.height, quality);
      if (encoded.length <= maxChars) return encoded;
    }
  }
  return null;
};

// The parts of a canvas and its 2d context the encoder uses, so it can be
// tested with a fake: jsdom has no canvas.
export interface EncoderCanvas {
  width: number;
  height: number;
  toDataURL(type: string, quality?: number): string;
}

export interface EncoderContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  clearRect(x: number, y: number, width: number, height: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: HTMLImageElement, dx: number, dy: number, dw: number, dh: number): void;
}

/**
 * The `encode` of `encodeWithinBudget` for a real canvas: draws `image` at the
 * given size and answers WebP, or JPEG on white when the browser does not
 * write WebP. Throws when the browser answers with no image at all.
 */
export const canvasEncoder = (canvas: EncoderCanvas, context: EncoderContext, image: HTMLImageElement) => {
  // WebKit writes no WebP: it answers with a PNG, far too large to send.
  // Once it has, the later steps go straight to JPEG instead of encoding a
  // PNG of every step for nothing.
  let tryWebp = true;
  return (width: number, height: number, quality: number) => {
    canvas.width = width;
    canvas.height = height;
    if (tryWebp) {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      const webp = canvas.toDataURL('image/webp', quality);
      if (webp.startsWith('data:image/webp')) return webp;
      tryWebp = false;
    }
    // JPEG has no transparency: put it on white rather than black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const jpeg = canvas.toDataURL('image/jpeg', quality);
    // A canvas the browser could not allocate answers "data:,", which would
    // be attached as an empty image.
    if (!jpeg.startsWith('data:image/')) throw new Error('unencodable');
    return jpeg;
  };
};

// --- Telling an animation from a still image ---------------------------------

type AnimatableFormat = 'gif' | 'png' | 'webp';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const asciiAt = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.subarray(at, at + length));

const uint32BigEndian = (bytes: Uint8Array, at: number) =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

const uint32LittleEndian = (bytes: Uint8Array, at: number) =>
  ((bytes[at + 3] << 24) | (bytes[at + 2] << 16) | (bytes[at + 1] << 8) | bytes[at]) >>> 0;

// The three formats that can carry an animation, told by their first 12 bytes.
const animatableFormat = (bytes: Uint8Array): AnimatableFormat | null => {
  if (asciiAt(bytes, 0, 3) === 'GIF') return 'gif';
  if (PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return 'png';
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
};

// Walks the blocks of a GIF and counts its complete frames. The image data is
// skipped by its sub-block sizes, never searched: compressed data can hold any
// byte, an image descriptor's 0x2C included.
const gifHasTwoFrames = (bytes: Uint8Array) => {
  // Past the end of the data sub-blocks starting at `at`, or -1 when they run
  // past the end of the file.
  const skipSubBlocks = (at: number) => {
    let position = at;
    while (position < bytes.length) {
      const size = bytes[position];
      position += 1;
      if (size === 0) return position;
      position += size;
    }
    return -1;
  };
  const colourTable = (packed: number) => (packed & 0x80 ? 3 * (1 << ((packed & 0x07) + 1)) : 0);

  // The header (6 bytes) and the logical screen descriptor (7), then the
  // global colour table if there is one.
  if (bytes.length < 13) return false;
  let position = 13 + colourTable(bytes[10]);
  let frames = 0;
  while (position >= 0 && position < bytes.length) {
    const introducer = bytes[position];
    if (introducer === 0x21) {
      // An extension: its label, then its data sub-blocks.
      position = skipSubBlocks(position + 2);
    } else if (introducer === 0x2c) {
      // An image descriptor (10 bytes), its local colour table, the LZW
      // minimum code size, then the image data sub-blocks.
      if (position + 10 > bytes.length) return false;
      position = skipSubBlocks(position + 10 + colourTable(bytes[position + 9]) + 1);
      if (position < 0) return false;
      frames += 1;
      if (frames >= 2) return true;
    } else {
      // The trailer, or something that is not a GIF block.
      return false;
    }
  }
  return false;
};

// An APNG announces itself with an acTL chunk before its first image data.
const pngHasAnimationControl = (bytes: Uint8Array) => {
  let position = PNG_SIGNATURE.length;
  while (position + 8 <= bytes.length) {
    const end = position + 12 + uint32BigEndian(bytes, position);
    if (end > bytes.length) return false;
    const type = asciiAt(bytes, position + 4, 4);
    if (type === 'acTL') return true;
    if (type === 'IDAT') return false;
    position = end;
  }
  return false;
};

// An animated WebP sets the animation flag of its VP8X chunk and carries an
// ANIM chunk; either is enough.
const webpIsAnimated = (bytes: Uint8Array) => {
  let position = 12;
  while (position + 8 <= bytes.length) {
    const size = uint32LittleEndian(bytes, position + 4);
    const end = position + 8 + size;
    if (end > bytes.length) return false;
    const fourCC = asciiAt(bytes, position, 4);
    if (fourCC === 'ANIM') return true;
    if (fourCC === 'VP8X' && size > 0 && (bytes[position + 8] & 0x02)) return true;
    // A chunk of odd size is padded to an even one.
    position = end + (size % 2);
  }
  return false;
};

/**
 * Whether these image bytes hold an animation: a GIF with two frames or more,
 * an APNG, or an animated WebP. Truncated or malformed bytes read as still.
 */
export const isAnimatedImage = (bytes: Uint8Array): boolean => {
  switch (animatableFormat(bytes)) {
    case 'gif': return gifHasTwoFrames(bytes);
    case 'png': return pngHasAnimationControl(bytes);
    case 'webp': return webpIsAnimated(bytes);
    default: return false;
  }
};

const base64Bytes = (base64: string) => {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return new Uint8Array(0);
  }
};

const isAnimatedDataUrl = (dataUrl: string) => {
  const comma = dataUrl.indexOf(',');
  if (comma < 0 || !dataUrl.slice(0, comma).endsWith(';base64')) return false;
  const payload = dataUrl.slice(comma + 1);
  // The first 16 characters are 12 bytes, enough to recognise the format, so
  // a phone photo is not decoded in full only to learn it is a JPEG.
  if (!animatableFormat(base64Bytes(payload.slice(0, 16)))) return false;
  return isAnimatedImage(base64Bytes(payload));
};

// --- Preparing one image -------------------------------------------------------

const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('unreadable')));
  reader.onerror = () => reject(reader.error ?? new Error('unreadable'));
  reader.readAsDataURL(file);
});

// Decoded from the data URL rather than an object URL: the CSP allows images
// from `data:` and not from `blob:` (`img-src 'self' data:`).
const decode = (dataUrl: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('undecodable'));
  image.src = dataUrl;
});

const prepare = async (file: File, { share, available }: ImageAllowance): Promise<PreparedFeedbackImage> => {
  const original = await readAsDataUrl(file);

  if (isAnimatedDataUrl(original)) {
    return original.length <= Math.min(available, FEEDBACK_IMAGE_TARGET)
      ? { status: 'ok', dataUrl: original }
      : { status: 'animated_too_large' };
  }
  if (original.length <= Math.min(available, KEEP_ORIGINAL_UP_TO)) return { status: 'ok', dataUrl: original };
  if (share < MIN_IMAGE_BUDGET) return { status: 'too_large' };

  const image = await decode(original);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  // An SVG with no intrinsic size decodes to nothing a canvas can draw.
  if (!width || !height) return { status: 'unreadable' };
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return { status: 'unreadable' };

  const encoded = encodeWithinBudget(width, height, share, canvasEncoder(canvas, context, image));
  return encoded ? { status: 'ok', dataUrl: encoded } : { status: 'too_large' };
};

/**
 * The image as it will be attached, or why it will not be. Never rejects: a
 * file the browser cannot read, decode or encode — a tainted SVG raises a
 * SecurityError in toDataURL — is reported `unreadable`.
 */
export const prepareFeedbackImage = async (file: File, allowance: ImageAllowance): Promise<PreparedFeedbackImage> => {
  try {
    return await prepare(file, allowance);
  } catch {
    return { status: 'unreadable' };
  }
};
