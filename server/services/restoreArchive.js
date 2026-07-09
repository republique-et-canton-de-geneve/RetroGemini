import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';

const DEFAULT_RESTORE_MAX_BODY_MB = 128;
const DEFAULT_RESTORE_MAX_DECOMPRESSED_MB = 512;

class RestoreArchiveTooLargeError extends Error {
  constructor(message = 'Restore archive exceeds decompressed-size limit') {
    super(message);
    this.name = 'RestoreArchiveTooLargeError';
    this.code = 'RESTORE_ARCHIVE_TOO_LARGE';
  }
}

class InvalidRestoreArchiveError extends Error {
  constructor(message = 'Invalid restore archive') {
    super(message);
    this.name = 'InvalidRestoreArchiveError';
    this.code = 'INVALID_RESTORE_ARCHIVE';
  }
}

const parsePositiveMegabytes = (value, fallback) => {
  const parsed = Number(value);
  const megabytes = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.floor(megabytes * 1024 * 1024);
};

const normalizeMaxBytes = (value) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return getRestoreMaxDecompressedBytes();
};

const normalizeContentType = (contentType) => {
  return typeof contentType === 'string' ? contentType : '';
};

const requireArchiveBuffer = (body) => {
  if (!(body instanceof Buffer) || body.length === 0) {
    throw new InvalidRestoreArchiveError('Missing restore archive');
  }
  return Buffer.from(body);
};

const getRestoreMaxBodyBytes = () => {
  return parsePositiveMegabytes(process.env.RESTORE_MAX_BODY_MB, DEFAULT_RESTORE_MAX_BODY_MB);
};

const getRestoreMaxDecompressedBytes = () => {
  return parsePositiveMegabytes(process.env.RESTORE_MAX_DECOMPRESSED_MB, DEFAULT_RESTORE_MAX_DECOMPRESSED_MB);
};

const isGzipContentType = (contentType = '') => {
  const normalized = normalizeContentType(contentType).toLowerCase().split(';')[0].trim();
  return normalized === 'application/gzip' || normalized === 'application/x-gzip';
};

const hasGzipMagic = (archiveBody) => {
  return archiveBody.byteLength >= 2 && archiveBody.readUInt16BE(0) === 0x1f8b;
};

const parseJsonBuffer = (buffer) => {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new InvalidRestoreArchiveError();
  }
};

const gunzipWithLimit = (compressed, maxBytes) => new Promise((resolve, reject) => {
  const chunks = [];
  let totalBytes = 0;
  const gunzip = createGunzip();

  gunzip.on('data', (chunk) => {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      gunzip.destroy(new RestoreArchiveTooLargeError());
      return;
    }
    chunks.push(chunk);
  });

  gunzip.on('error', reject);
  gunzip.on('end', () => {
    resolve(Buffer.concat(chunks, totalBytes));
  });

  const source = Readable.from(compressed);
  pipeline(source, gunzip).catch(reject);
});

const parseRestoreArchiveBody = async (body, contentType, maxDecompressedBytes = getRestoreMaxDecompressedBytes()) => {
  const archiveBody = requireArchiveBuffer(body);
  const maxBytes = normalizeMaxBytes(maxDecompressedBytes);
  const archiveHasGzipMagic = hasGzipMagic(archiveBody);

  if (archiveHasGzipMagic || isGzipContentType(contentType)) {
    try {
      const decompressed = await gunzipWithLimit(archiveBody, maxBytes);
      return parseJsonBuffer(decompressed);
    } catch (err) {
      if (archiveHasGzipMagic || err?.code === 'RESTORE_ARCHIVE_TOO_LARGE') {
        throw err;
      }
    }
  }

  if (archiveBody.byteLength > maxBytes) {
    throw new RestoreArchiveTooLargeError();
  }

  return parseJsonBuffer(archiveBody);
};

export {
  InvalidRestoreArchiveError,
  RestoreArchiveTooLargeError,
  getRestoreMaxBodyBytes,
  getRestoreMaxDecompressedBytes,
  parseRestoreArchiveBody
};
