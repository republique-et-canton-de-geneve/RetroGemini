/**
 * Images attached to a feedback travel inline, as data URLs, in the one JSON
 * body `/api/feedbacks/create` receives — and the server refuses any JSON body
 * over 1 MiB (`express.json({ limit: '1mb' })` in server.js, and the same
 * default on an ingress-nginx in front of it). The form used to accept five
 * images of 2 MB each, so a single ordinary screenshot had the feedback
 * refused with a 413.
 *
 * So the browser reduces each image before attaching it: the longest side to
 * MAX_IMAGE_DIMENSION, re-encoded as WebP (JPEG where the browser cannot write
 * WebP), stepping the quality and then the size down until the image fits what
 * is left of the budget. Raising the server's limit instead would store
 * multi-megabyte images in the team record, which every write to the team
 * rewrites and every feedback list loads.
 */

// What the images of one feedback may take in all, in data-URL characters
// (base64 is ASCII, so characters are bytes). The rest of the 1 MiB body is
// left to the text, the credentials and the JSON around them.
export const FEEDBACK_IMAGES_BUDGET = 800_000;

// What one image may take, so that several can be attached.
export const FEEDBACK_IMAGE_TARGET = 300_000;

// A smaller image than this is sent as it is: re-encoding a small screenshot
// would only blur its text.
const KEEP_ORIGINAL_UP_TO = 150_000;

// Below this, an image would be too degraded to be worth sending.
export const MIN_IMAGE_BUDGET = 20_000;

export const MAX_IMAGE_DIMENSION = 1600;

// What the file picker accepts before reducing: phone photos run to several
// megabytes, and are reduced like any other image.
export const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024;

const DIMENSION_STEPS = [MAX_IMAGE_DIMENSION, 1280, 1024, 800, 640];
const QUALITY_STEPS = [0.82, 0.68, 0.55];

export const fitWithin = (width: number, height: number, max: number) => {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
};

export const imagesLength = (images: string[]) => images.reduce((total, image) => total + image.length, 0);

export const remainingImageBudget = (images: string[]) => Math.max(0, FEEDBACK_IMAGES_BUDGET - imagesLength(images));

/**
 * The sharpest encoding of a `width` × `height` image that fits in `maxChars`,
 * or null when none does. `encode` draws the image at the given size and
 * returns its data URL; it is a parameter so the stepping can be tested
 * without a canvas.
 */
export const encodeWithinBudget = (
  width: number,
  height: number,
  maxChars: number,
  encode: (width: number, height: number, quality: number) => string
): string | null => {
  const sizes = DIMENSION_STEPS
    .map((max) => fitWithin(width, height, max))
    .filter((size, index, all) => index === 0 || size.width !== all[index - 1].width);
  for (const size of sizes) {
    for (const quality of QUALITY_STEPS) {
      const encoded = encode(size.width, size.height, quality);
      if (encoded.length <= maxChars) return encoded;
    }
  }
  return null;
};

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

/**
 * The image as it will be attached, or null when even its most reduced form
 * does not fit `maxChars`. Rejects when the file cannot be read or decoded.
 */
export const prepareFeedbackImage = async (file: File, maxChars: number): Promise<string | null> => {
  const original = await readAsDataUrl(file);
  if (original.length <= Math.min(maxChars, KEEP_ORIGINAL_UP_TO)) return original;

  const image = await decode(original);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  const encode = (width: number, height: number, quality: number) => {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    const webp = canvas.toDataURL('image/webp', quality);
    if (webp.startsWith('data:image/webp')) return webp;
    // JPEG has no transparency: put it on white rather than black.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  };

  return encodeWithinBudget(image.naturalWidth || image.width, image.naturalHeight || image.height, maxChars, encode);
};
