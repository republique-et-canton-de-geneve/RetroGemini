import { currentContext } from './logContext.js';

/**
 * One log record, one line of JSON (audit H44).
 *
 * The format is deliberately boring: a log aggregator splits stdout on
 * newlines, so the only property that really matters is that **a record never
 * contains one**. `JSON.stringify` guarantees that for free, which is why a
 * stack trace — the case a hand-rolled formatter always gets wrong — survives
 * as a single record with its level and timestamp attached instead of becoming
 * twenty orphan lines.
 *
 * No new infrastructure: OpenShift's aggregator reads pod stdout already. This
 * is what turns those lines from prose into something that can be queried.
 */

const DEFAULT_REDACTION = '[redacted]';

/**
 * Environment variables whose *value* is a secret this process holds. Redacting
 * by value is the strong half of the guarantee: it does not matter how a line
 * came to contain the signing secret — a helpful error message, an interpolated
 * connection string, a dumped config object — the value never reaches stdout.
 */
const SECRET_ENV_VARS = [
  'SESSION_TOKEN_SECRET',
  'SUPER_ADMIN_PASSWORD',
  'POSTGRES_PASSWORD',
  'SMTP_PASS',
  'REDIS_PASSWORD',
  'WIFI_PASSWORD',
  'DATABASE_URL',
  'REDIS_URL'
];

/**
 * Below this length a value is not distinctive enough to search for: a variable
 * holding `true` or `3000` would blank that word out of every line that
 * mentions it, which is a worse outcome than the one being prevented. Eight
 * matches `PASSWORD_MIN_LENGTH`, so a real password is always long enough to
 * be caught.
 */
const MIN_REDACTABLE_SECRET_LENGTH = 8;

const collectKnownSecrets = (env = process.env) =>
  SECRET_ENV_VARS.map((name) => env[name])
    .filter((value) => typeof value === 'string' && value.length >= MIN_REDACTABLE_SECRET_LENGTH);

/**
 * The weak half, for secrets this process does not hold — the operator's LLM
 * key lives in the database, so no value sweep can see it and only the *shape*
 * of the line gives it away. Matches `key: value`, `key=value` and JSON, and
 * `Bearer <token>`.
 */
const SECRET_KEY_PATTERN =
  /\b(password|passwd|api[_-]?key|apikey|secret|token|sessiontoken|authorization|auth)\b(["']?\s*[:=]\s*["']?)([^\s"',}&]+)/gi;
const BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+/-]{8,}=*)/gi;

/**
 * Blank every secret out of `text`: known values first, then the key patterns.
 * Applied once, at the single point every log line passes through, so the
 * in-memory ring the super admin can read is redacted as well as stdout — an
 * exported log ring is a file that leaves the cluster.
 */
const redactSecrets = (text, secrets = collectKnownSecrets()) => {
  let out = String(text);

  for (const secret of secrets) {
    if (!secret || secret.length < MIN_REDACTABLE_SECRET_LENGTH) continue;
    out = out.replaceAll(secret, DEFAULT_REDACTION);
  }

  // Bearer first: `Authorization: Bearer <token>` matches the key pattern too,
  // and that match consumes the word "Bearer" as the value — leaving the token
  // itself in the clear and nothing for the bearer pattern left to find.
  out = out.replace(BEARER_PATTERN, (_match, prefix) => `${prefix}${DEFAULT_REDACTION}`);
  out = out.replace(SECRET_KEY_PATTERN, (_match, key, separator) => `${key}${separator}${DEFAULT_REDACTION}`);

  return out;
};

/**
 * One record as one line. Fields from the ambient context are merged in at emit
 * time rather than at call time, so a handler that learns its session id
 * halfway through still has it on the lines that follow.
 */
const formatLogLine = ({ level, source, message, timestamp = new Date().toISOString(), details = undefined }) => {
  const context = currentContext();

  return JSON.stringify({
    timestamp,
    level,
    source,
    message,
    ...(details ? { details } : {}),
    ...(context ?? {})
  });
};

/**
 * JSON in production, because that is where an aggregator reads it; text
 * everywhere else, because that is where a human reads it. Same shape as the
 * `TRUST_PROXY` default in `server.js`.
 *
 * An unusable value falls back to the default rather than inventing a third
 * mode — but says so once, since a typo in a deployment manifest is otherwise
 * indistinguishable from the setting working.
 */
const resolveLogFormat = (env = process.env, warn = console.warn) => {
  const fallback = env.NODE_ENV === 'production' ? 'json' : 'text';
  const configured = env.LOG_FORMAT;

  if (configured === undefined || configured === '') return fallback;
  if (configured === 'json' || configured === 'text') return configured;

  warn(`[Server] LOG_FORMAT="${configured}" is not one of json|text — using ${fallback}`);
  return fallback;
};

export {
  DEFAULT_REDACTION,
  MIN_REDACTABLE_SECRET_LENGTH,
  SECRET_ENV_VARS,
  collectKnownSecrets,
  formatLogLine,
  redactSecrets,
  resolveLogFormat
};
