/**
 * Outbound HTTP — the one way the server calls a service of the deployment's
 * own network (the LLM endpoint, Jira).
 *
 * Extracted from `aiService.makeRequest` so the Jira client and the AI service
 * share one transport. It uses `node:http`/`node:https` rather than `fetch`
 * because the super admin may allow a self-signed certificate, which needs an
 * agent of its own.
 *
 * ## What a failure says
 *
 * A rejection is always an `OutboundHttpError` (`code`, `phase`), and the phase
 * is the part a caller decides on. `'not_sent'` means the request cannot have
 * reached the server: no connection, no TLS session, or a body never fully
 * written. `'sent'` means it may have been processed, even though no complete
 * answer came back. For a call that creates something, that is the difference
 * between "retry" and "it may already exist".
 *
 * The phase is read from the socket as well as the request. Node calls a
 * request "finished" once its bytes are handed to the socket, and a TLS socket
 * accepts them before its handshake, so 'finish' alone would report a request
 * to a server that refused the handshake as sent.
 *
 * ## What it does not do
 *
 * It never follows a redirect: a 3xx is returned with its headers, `location`
 * included. A redirect would carry the caller's `Authorization` header to
 * whatever host the answer names.
 *
 * ## Connections of its own
 *
 * Node's global agent keeps connections alive and hands a pooled one to the
 * next request. A server may close a pooled connection at the very moment it
 * is reused; the request then fails after its body was written, which reads as
 * `'sent'`. For a creation that means "it may already exist" about something
 * that was never created, so a caller can ask for a connection of its own
 * (`keepAlive: false`): opened for that request and closed after its answer.
 *
 * ## Proxies
 *
 * With `NODE_USE_ENV_PROXY=1` (Node 22.21+), Node's global agent honours
 * `HTTPS_PROXY` / `NO_PROXY`. A request that allows a self-signed certificate,
 * or keeps no connection alive, needs its own agent, which would go direct
 * unless it is handed the same proxy settings, so it copies the global agent's
 * `options.proxyEnv`.
 */

// Default imports, not named ones: the AI service's tests replace these
// modules with `vi.mock('node:https')`, and the mock applies to this module.
import https from 'node:https';
import http from 'node:http';

/**
 * @typedef {'timeout' | 'deadline' | 'too_large' | 'network' | 'tls'} OutboundHttpErrorCode
 * @typedef {'not_sent' | 'sent'} OutboundHttpPhase
 */

export class OutboundHttpError extends Error {
  /**
   * @param {OutboundHttpErrorCode} code
   * @param {OutboundHttpPhase} phase
   * @param {string} message
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, phase, message, options) {
    super(message, options);
    this.name = 'OutboundHttpError';
    this.code = code;
    this.phase = phase;
  }
}

// The verification failures OpenSSL reports by code, and Node's own TLS codes.
// A protocol error on an https request (`EPROTO`) is a failed handshake too.
const TLS_ERROR_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_REJECTED',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'HOSTNAME_MISMATCH',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
]);

const isTlsFailure = (err, isHttps) => {
  const code = typeof err?.code === 'string' ? err.code : '';
  return TLS_ERROR_CODES.has(code)
    || code.startsWith('ERR_TLS_')
    || code.startsWith('ERR_SSL_')
    || (isHttps && code === 'EPROTO');
};

const seconds = (ms) => `${ms / 1000} seconds`;

/**
 * True once a fresh socket is connected — and, for TLS, once its handshake is
 * done. `getProtocol()` reads `'unknown'` during a handshake and `null` before
 * the connection exists.
 */
const isEstablished = (socket, isHttps) => {
  if (socket.connecting) return false;
  if (!isHttps) return true;
  const protocol = typeof socket.getProtocol === 'function' ? socket.getProtocol() : null;
  return typeof protocol === 'string' && protocol !== 'unknown';
};

/**
 * Sends one request and resolves with the whole answer.
 *
 * @param {object} options
 * @param {string} options.url Absolute `http:` or `https:` URL.
 * @param {string} [options.method='GET']
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body] Sent with its `Content-Length`.
 * @param {number} [options.timeoutMs] Socket idle timeout, connecting included.
 * @param {number} [options.deadlineMs] Wall-clock limit for the whole exchange, started before connecting.
 * @param {number} [options.maxBytes] Largest answer body accepted.
 * @param {boolean} [options.rejectUnauthorized] `false` accepts a self-signed certificate.
 * @param {boolean} [options.keepAlive] `false` sends the request on a connection of its own, closed after
 *   the answer, never on a pooled one. Left out, the global agent's pooling applies.
 * @returns {Promise<{ status: number, headers: Record<string, string | string[] | undefined>, body: string }>}
 */
export const request = ({
  url,
  method = 'GET',
  headers = {},
  body,
  timeoutMs,
  deadlineMs,
  maxBytes,
  rejectUnauthorized,
  keepAlive
}) => new Promise((resolve, reject) => {
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';
  if (!isHttps && parsedUrl.protocol !== 'http:') {
    throw new TypeError(`outboundHttp: unsupported protocol ${parsedUrl.protocol}`);
  }

  const requestHeaders = { ...headers };
  if (body !== undefined && body !== null) {
    const hasLength = Object.keys(requestHeaders).some((name) => name.toLowerCase() === 'content-length');
    if (!hasLength) requestHeaders['Content-Length'] = String(Buffer.byteLength(body));
  }

  const reqOptions = {
    // The URL parser keeps an IPv6 host in brackets; the socket wants it bare.
    hostname: parsedUrl.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: parsedUrl.port || (isHttps ? 443 : 80),
    path: parsedUrl.pathname + parsedUrl.search,
    method,
    headers: requestHeaders
  };
  if (timeoutMs !== undefined) reqOptions.timeout = timeoutMs;
  const selfSigned = isHttps && rejectUnauthorized === false;
  if (selfSigned || keepAlive === false) {
    // An agent of this request's own, so neither the allowance nor the
    // connection is shared; it keeps nothing alive (a new agent's default).
    const transport = isHttps ? https : http;
    reqOptions.agent = new transport.Agent({
      keepAlive: false,
      ...(selfSigned ? { rejectUnauthorized: false } : {}),
      proxyEnv: transport.globalAgent?.options?.proxyEnv
    });
  }

  let settled = false;
  let deadlineTimer = null;
  let connected = false;
  let finished = false;
  let responded = false;

  const settle = (outcome) => {
    if (settled) return false;
    settled = true;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    outcome();
    return true;
  };
  const phase = () => (responded || (connected && finished) ? 'sent' : 'not_sent');

  const mod = isHttps ? https : http;
  // Only ever called from an event or a timer, so `req` is assigned by then.
  const fail = (code, message, cause) => {
    const failed = settle(() => reject(new OutboundHttpError(code, phase(), message, cause ? { cause } : undefined)));
    if (failed) req.destroy();
  };

  const req = mod.request(reqOptions, (res) => {
    responded = true;
    const announced = Number(res.headers?.['content-length']);
    if (maxBytes !== undefined && Number.isFinite(announced) && announced > maxBytes) {
      fail('too_large', `Response larger than ${maxBytes} bytes`);
      return;
    }

    const chunks = [];
    let received = 0;
    res.on('data', (chunk) => {
      received += chunk.length;
      if (maxBytes !== undefined && received > maxBytes) {
        fail('too_large', `Response larger than ${maxBytes} bytes`);
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => {
      settle(() => resolve({
        status: res.statusCode,
        headers: res.headers || {},
        body: Buffer.concat(chunks).toString('utf-8')
      }));
    });
    // A connection lost mid-answer destroys the response with an error
    // ("aborted"). The listener is also what keeps that error from being
    // thrown as an unhandled 'error' event.
    res.on('error', (err) => fail('network', err.message, err));
  });

  // Started before the connection exists, which `request()` only opens on a
  // later tick: the deadline covers DNS, connecting and the TLS handshake.
  if (deadlineMs !== undefined) {
    deadlineTimer = setTimeout(() => {
      fail('deadline', `Request did not complete within ${seconds(deadlineMs)}`);
    }, deadlineMs);
  }

  req.on('socket', (socket) => {
    if (req.reusedSocket || isEstablished(socket, isHttps)) {
      connected = true;
      return;
    }
    socket.once(isHttps ? 'secureConnect' : 'connect', () => { connected = true; });
  });
  req.on('finish', () => { finished = true; });
  req.on('error', (err) => {
    fail(isTlsFailure(err, isHttps) ? 'tls' : 'network', err.message, err);
  });
  req.on('timeout', () => {
    fail('timeout', `Request timed out after ${seconds(timeoutMs)}`);
  });

  if (body !== undefined && body !== null) req.write(body);
  req.end();
});
