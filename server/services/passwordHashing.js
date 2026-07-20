import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

// Hardening stage 7c (audit PR-7): team passwords are hashed at rest.
//
// Node's built-in scrypt is used instead of a bcrypt dependency on purpose:
// it needs no new npm package (the app ships to air-gapped networks), it is
// memory-hard, and it runs in the libuv threadpool so verification does not
// block the event loop of this single-process Socket.IO server.
//
// Stored format: scrypt$<N>$<r>$<p>$<saltBase64url>$<hashBase64url>
// The parameters are stored per record so they can be raised later without
// invalidating existing hashes.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// A record claiming absurd parameters is treated as not-a-hash rather than
// derived: a crafted backup restore must not be able to turn verification
// into a memory/CPU bomb.
const MAX_N = 1 << 17;
const MAX_R = 16;
const MAX_P = 4;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const parseHashedPassword = (stored) => {
  if (typeof stored !== 'string') return null;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const hash = parts[5];

  if (!Number.isInteger(N) || N < 2 || N > MAX_N || (N & (N - 1)) !== 0) return null;
  if (!Number.isInteger(r) || r < 1 || r > MAX_R) return null;
  if (!Number.isInteger(p) || p < 1 || p > MAX_P) return null;
  if (!salt || !BASE64URL_PATTERN.test(salt)) return null;
  if (!hash || !BASE64URL_PATTERN.test(hash)) return null;

  const saltBuf = Buffer.from(salt, 'base64url');
  const hashBuf = Buffer.from(hash, 'base64url');
  if (saltBuf.length < 8 || saltBuf.length > 64) return null;
  if (hashBuf.length < 16 || hashBuf.length > 64) return null;

  return { N, r, p, salt: saltBuf, hash: hashBuf };
};

const isHashedPassword = (stored) => parseHashedPassword(stored) !== null;

const hashPassword = async (plainPassword) => {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(plainPassword, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

// Length-hiding constant-time comparison for legacy plaintext records.
const safeStringEqual = (a, b) => {
  const digestA = createHash('sha256').update(String(a), 'utf8').digest();
  const digestB = createHash('sha256').update(String(b), 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
};

// authenticateTeam runs on every team/feedback API call, and clients holding
// only a password (invite joins, expired tokens) resend it each time. Caching
// the digest of the last plaintext that verified against a given stored hash
// keeps repeat verifications at sha256 cost instead of a full scrypt derive.
// Only successes are cached, and the key is the full stored hash string, so a
// password change (new salt) can never serve a stale positive.
const verifyCache = new Map();
const VERIFY_CACHE_MAX = 1000;

const plainDigest = (plainPassword) =>
  createHash('sha256').update(String(plainPassword), 'utf8').digest('base64');

const verifyPassword = async (plainPassword, stored) => {
  if (typeof plainPassword !== 'string' || !plainPassword || typeof stored !== 'string' || !stored) {
    return false;
  }

  const parsed = parseHashedPassword(stored);
  if (!parsed) {
    return safeStringEqual(plainPassword, stored);
  }

  const digest = plainDigest(plainPassword);
  if (verifyCache.get(stored) === digest) {
    return true;
  }

  const derived = await scryptAsync(plainPassword, parsed.salt, parsed.hash.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p
  });

  if (derived.length !== parsed.hash.length || !timingSafeEqual(derived, parsed.hash)) {
    return false;
  }

  if (verifyCache.size >= VERIFY_CACHE_MAX) {
    verifyCache.delete(verifyCache.keys().next().value);
  }
  verifyCache.set(stored, digest);
  return true;
};

export { hashPassword, verifyPassword, isHashedPassword };
