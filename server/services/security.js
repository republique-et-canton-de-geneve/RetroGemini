import { createHash, timingSafeEqual } from 'crypto';

const escapeHtml = (value = '') => {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
};

const sanitizeEmailLink = (value) => {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
};

/**
 * Constant-time string comparison to prevent timing attacks.
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} - True if strings are equal
 */
const secureCompare = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
};

const hashResetToken = (token) =>
  createHash('sha256').update(token).digest('hex');

const pruneResetTokens = (tokens) => {
  const now = Date.now();
  return (tokens || []).filter((entry) => entry.expiresAt > now);
};

export {
  escapeHtml,
  sanitizeEmailLink,
  secureCompare,
  hashResetToken,
  pruneResetTokens
};
