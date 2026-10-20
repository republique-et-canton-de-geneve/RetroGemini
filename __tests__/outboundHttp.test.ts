// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo, type Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { OutboundHttpError, request } from '../server/services/outboundHttp.js';

/**
 * The transport every call to the deployment's own outbound services goes
 * through (the LLM, Jira). Its contract is what the Jira integration's "never
 * twice" promise stands on, so it is pinned against a real local server rather
 * than a mocked `http` module:
 *
 *  - an idle timeout is not a deadline: a server that sends one byte every
 *    30 ms never trips a 100 ms idle timeout, and must still be cut off by a
 *    wall-clock deadline;
 *  - a failure says whether the request can have reached the server
 *    (`phase: 'sent'`) or certainly did not (`'not_sent'`). A creation that
 *    failed `not_sent` can be retried; one that failed `sent` may exist;
 *  - a redirect is answered, never followed: a team's token must not travel
 *    to whatever host a `Location` names.
 */

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

let handler: Handler = (_req, res) => res.end('ok');
let server: http.Server;
let base = '';
const sockets = new Set<Socket>();

beforeAll(async () => {
  server = http.createServer((req, res) => {
    // One connection per request: Node's global agent pools keep-alive
    // sockets, and the ones `afterEach` destroys would otherwise be handed to
    // the next test as dead connections.
    res.shouldKeepAlive = false;
    handler(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => {
  // A test that cut a slow answer short leaves the server still writing it.
  for (const socket of sockets) socket.destroy();
  handler = (_req, res) => res.end('ok');
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// Answers `body` one byte at a time, `everyMs` apart, until the client goes.
const trickle = (body: string, everyMs: number): Handler => (_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  let index = 0;
  const timer = setInterval(() => {
    if (res.destroyed || index >= body.length) {
      clearInterval(timer);
      if (!res.destroyed) res.end();
      return;
    }
    res.write(body[index]);
    index += 1;
  }, everyMs);
  res.on('close', () => clearInterval(timer));
};

// The code of the system error behind a failure (ECONNREFUSED, a TLS code…).
const systemCodeOf = (err: OutboundHttpError) => (err.cause as { code?: string } | undefined)?.code;

const rejection = async (promise: Promise<unknown>): Promise<OutboundHttpError> => {
  try {
    await promise;
  } catch (err) {
    return err as OutboundHttpError;
  }
  throw new Error('expected the request to fail');
};

// A port nothing listens on: bound once, then released.
const freePort = async (): Promise<number> => {
  const probe = http.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
};

// Resolves when the server sees the connection carrying `res` close.
const closedOnServer = (res: http.ServerResponse) => new Promise<void>((resolve) => {
  res.on('close', () => resolve());
});

// True when `promise` settles within `ms`. A failed call must give its
// connection up: rejecting while the socket keeps downloading a trickling or
// oversized answer would leak it, and `afterEach` would hide the leak.
const settlesWithin = async (promise: Promise<unknown>, ms: number): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); });
  try {
    return await Promise.race([promise.then(() => true), late]);
  } finally {
    clearTimeout(timer);
  }
};

// A server of a test's own, on a port no other test has pooled a socket for.
const listen = async <T extends http.Server | https.Server>(target: T, host = '127.0.0.1'): Promise<T> => {
  await new Promise<void>((resolve, reject) => {
    target.once('error', reject);
    target.listen(0, host, () => {
      target.off('error', reject);
      resolve();
    });
  });
  return target;
};

const stop = async (target: http.Server | https.Server) => {
  target.closeAllConnections();
  await new Promise<void>((resolve) => target.close(() => resolve()));
};

const portOf = (target: http.Server | https.Server) => (target.address() as AddressInfo).port;

// A TCP server that accepts every connection and never writes a byte. To an
// https client that is a handshake that never completes: a firewall or a stuck
// proxy in front of Jira.
const silentTcp = async () => {
  const connections = new Set<Socket>();
  const target = net.createServer((socket) => {
    connections.add(socket);
    socket.on('close', () => connections.delete(socket));
  });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  return {
    url: `https://127.0.0.1:${(target.address() as AddressInfo).port}/rest/api/2/issue`,
    close: async () => {
      for (const socket of connections) socket.destroy();
      await new Promise<void>((resolve) => target.close(() => resolve()));
    }
  };
};

describe('outboundHttp.request', () => {
  it('answers the status, the headers and the body as a string', async () => {
    let seen: { method?: string; url?: string; body: string; headers?: http.IncomingHttpHeaders } = { body: '' };
    handler = (req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seen = { method: req.method, url: req.url, body, headers: req.headers };
        res.writeHead(201, { 'content-type': 'application/json', 'x-answer': 'yes' });
        res.end(JSON.stringify({ created: 'é' }));
      });
    };

    const response = await request({
      url: `${base}/rest/api/2/issue?x=1`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary: 'Fix the café' }),
      timeoutMs: 300
    });

    expect(response.status).toBe(201);
    expect(response.headers['x-answer']).toBe('yes');
    expect(JSON.parse(response.body)).toEqual({ created: 'é' });
    expect(seen.method).toBe('POST');
    expect(seen.url).toBe('/rest/api/2/issue?x=1');
    expect(JSON.parse(seen.body)).toEqual({ summary: 'Fix the café' });
    // A body is sent with its length in bytes rather than chunked: the
    // multi-byte character counts twice.
    expect(seen.headers?.['content-length']).toBe(String(Buffer.byteLength(seen.body)));
  });

  it('defaults to GET and sends no body', async () => {
    let seen: { method?: string; body: string; headers?: http.IncomingHttpHeaders } = { body: '' };
    handler = (req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seen = { method: req.method, body, headers: req.headers };
        res.end('{}');
      });
    };
    const response = await request({ url: `${base}/rest/api/2/serverInfo`, timeoutMs: 300 });
    expect(seen.method).toBe('GET');
    expect(response.status).toBe(200);
    // Not an empty body either, nor a chunked one: no length, no encoding.
    expect(seen.body).toBe('');
    expect(seen.headers?.['content-length']).toBeUndefined();
    expect(seen.headers?.['transfer-encoding']).toBeUndefined();
  });

  it('returns a redirect as an answer, Location included, and never follows it', async () => {
    let calls = 0;
    handler = (req, res) => {
      calls += 1;
      res.writeHead(302, { location: 'https://elsewhere.example.org/login' });
      res.end();
    };

    const response = await request({ url: `${base}/rest/api/2/serverInfo`, timeoutMs: 300 });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('https://elsewhere.example.org/login');
    expect(calls).toBe(1);
  });

  it('does not trip the idle timeout while bytes keep arriving', async () => {
    handler = trickle('0123456789', 30);
    const response = await request({ url: `${base}/slow`, timeoutMs: 100 });
    expect(response.body).toBe('0123456789');
  });

  it('cuts a trickling answer off at the wall-clock deadline, and closes the connection', async () => {
    let closed: Promise<void> = new Promise(() => {});
    handler = (req, res) => {
      closed = closedOnServer(res);
      trickle('x'.repeat(40), 30)(req, res);
    };
    const started = Date.now();
    const err = await rejection(request({ url: `${base}/slow`, timeoutMs: 100, deadlineMs: 150 }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('deadline');
    // The request was written and answered in part: it reached the server.
    expect(err.phase).toBe('sent');
    expect(Date.now() - started).toBeLessThan(400);
    // The rest of the answer (another second of it) is not downloaded.
    expect(await settlesWithin(closed, 200)).toBe(true);
  });

  it('times out a server that goes silent, and closes the connection', async () => {
    let closed: Promise<void> = new Promise(() => {});
    handler = (_req, res) => {
      closed = closedOnServer(res);
      /* never answers */
    };
    const err = await rejection(request({ url: `${base}/silent`, method: 'POST', body: '{}', timeoutMs: 100 }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('timeout');
    expect(err.phase).toBe('sent');
    expect(err.message).toBe('Request timed out after 0.1 seconds');
    // Node only reports an idle socket; nothing closes it unless this module does.
    expect(await settlesWithin(closed, 200)).toBe(true);
  });

  it('cuts a server that read the request and stays silent off at the deadline, not at the idle timeout', async () => {
    // The deadline runs from before the connection, never from the answer's
    // headers: a Jira that took the request and never answers is the case it
    // exists for, and here only the deadline can end the call in time.
    let closed: Promise<void> = new Promise(() => {});
    handler = (req, res) => {
      closed = closedOnServer(res);
      req.resume();
      /* reads the whole request, never answers */
    };
    const started = Date.now();
    const err = await rejection(request({
      url: `${base}/rest/api/2/issue`,
      method: 'POST',
      body: '{"fields":{"summary":"x"}}',
      timeoutMs: 1000,
      deadlineMs: 100
    }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('deadline');
    expect(err.phase).toBe('sent');
    expect(err.message).toBe('Request did not complete within 0.1 seconds');
    expect(Date.now() - started).toBeLessThan(400);
    expect(await settlesWithin(closed, 200)).toBe(true);
  });

  it('refuses an answer announced over maxBytes as soon as its headers arrive', async () => {
    let closed: Promise<void> = new Promise(() => {});
    handler = (_req, res) => {
      closed = closedOnServer(res);
      // The length is announced and the body never comes: only the header can
      // trip the cap before the idle timeout does.
      res.writeHead(200, { 'content-length': '2000' });
      res.flushHeaders();
    };
    const started = Date.now();
    const err = await rejection(request({ url: `${base}/big`, timeoutMs: 300, maxBytes: 1000 }));

    expect(err.code).toBe('too_large');
    expect(err.phase).toBe('sent');
    expect(Date.now() - started).toBeLessThan(100);
    expect(await settlesWithin(closed, 200)).toBe(true);
  });

  it('refuses an answer that grows over maxBytes, and accepts one at the cap', async () => {
    let closed: Promise<void> = new Promise(() => {});
    handler = (_req, res) => {
      closed = closedOnServer(res);
      // No length announced; the second chunk crosses the cap and the server
      // then stalls, so only the client can end this connection.
      res.writeHead(200);
      res.write('y'.repeat(600));
      setTimeout(() => res.write('y'.repeat(600)), 10);
    };
    const chunked = await rejection(request({ url: `${base}/big`, timeoutMs: 300, maxBytes: 1000 }));
    expect(chunked.code).toBe('too_large');
    expect(chunked.phase).toBe('sent');
    expect(await settlesWithin(closed, 200)).toBe(true);

    handler = (_req, res) => res.end('y'.repeat(1000));
    const atTheCap = await request({ url: `${base}/big`, timeoutMs: 300, maxBytes: 1000 });
    expect(atTheCap.body).toHaveLength(1000);
  });

  it('reports a refused connection as never sent', async () => {
    const port = await freePort();
    const err = await rejection(request({
      url: `http://127.0.0.1:${port}/rest/api/2/issue`,
      method: 'POST',
      body: '{"fields":{}}',
      timeoutMs: 300
    }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('network');
    expect(err.phase).toBe('not_sent');
    // The system error stays readable for the super admin's connection test.
    expect(err.message).toContain('ECONNREFUSED');
  });

  it('reports a connection dropped after the body was read as sent', async () => {
    handler = (req) => {
      req.resume();
      req.on('end', () => req.socket.destroy());
    };
    const err = await rejection(request({
      url: `${base}/rest/api/2/issue`,
      method: 'POST',
      body: '{"fields":{"summary":"x"}}',
      timeoutMs: 300
    }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('network');
    expect(err.phase).toBe('sent');
  });

  it('reports a connection dropped after the body was read as sent on a reused keep-alive socket too', async () => {
    // Node's global agent keeps connections alive, so the second call to the
    // same Jira usually goes out on a socket that connected long ago and never
    // says 'connect' again. Read as "never connected", a creation lost there
    // would be reported as not sent, retried, and created twice.
    let connections = 0;
    let requestsSeen = 0;
    const keepAlive = await listen(http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        requestsSeen += 1;
        if (requestsSeen === 1) res.end('{"key":"PROJ-1"}');
        else req.socket.destroy();
      });
    }));
    keepAlive.on('connection', () => { connections += 1; });
    const url = `http://127.0.0.1:${portOf(keepAlive)}/rest/api/2/issue`;
    try {
      const first = await request({ url, method: 'POST', body: '{"fields":{"summary":"a"}}', timeoutMs: 300 });
      expect(first.status).toBe(200);

      const err = await rejection(request({ url, method: 'POST', body: '{"fields":{"summary":"b"}}', timeoutMs: 300 }));
      // Both calls shared one connection: the second one did reuse it.
      expect(connections).toBe(1);
      expect(requestsSeen).toBe(2);
      expect(err.code).toBe('network');
      expect(err.phase).toBe('sent');
    } finally {
      await stop(keepAlive);
    }
  });

  it('reports a connection lost while the body is still being written as never sent', async () => {
    // A body far larger than the socket buffers is still being written when the
    // server drops the connection. The request never arrived whole, so the
    // server cannot have acted on it, connected or not.
    const dropping = await listen(http.createServer(() => { /* never reads, never answers */ }));
    dropping.on('connection', (socket) => {
      setTimeout(() => socket.destroy(), 20);
    });
    try {
      const err = await rejection(request({
        url: `http://127.0.0.1:${portOf(dropping)}/rest/api/2/issue`,
        method: 'POST',
        body: 'x'.repeat(32 * 1024 * 1024),
        timeoutMs: 1000
      }));
      expect(err.code).toBe('network');
      expect(err.phase).toBe('not_sent');
    } finally {
      await stop(dropping);
    }
  });

  it('reports an answer that started before the body was written, then broke, as sent', async () => {
    // A server may answer on the request line and headers alone. Once it has
    // answered it has acted on the request, so a connection lost afterwards is
    // "it may exist", even though the body never left the client whole.
    handler = (_req, res) => {
      res.writeHead(200, { 'content-length': '100' });
      res.write('{"partial":');
      setTimeout(() => res.socket?.destroy(), 20);
    };
    const err = await rejection(request({
      url: `${base}/rest/api/2/issue`,
      method: 'POST',
      body: 'x'.repeat(32 * 1024 * 1024),
      timeoutMs: 1000
    }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('network');
    expect(err.phase).toBe('sent');
  });

  it('reports an answer cut off midway as a sent failure, never as a short body', async () => {
    handler = (_req, res) => {
      res.writeHead(201, { 'content-length': '100', 'content-type': 'application/json' });
      res.write('{"key":"PROJ-');
      setTimeout(() => res.socket?.destroy(), 10);
    };
    const err = await rejection(request({ url: `${base}/rest/api/2/issue`, method: 'POST', body: '{}', timeoutMs: 300 }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('network');
    expect(err.phase).toBe('sent');
  });

  it('reports a failed TLS handshake as a TLS failure that sent nothing', async () => {
    // https:// to a plain-HTTP port: the handshake cannot complete. Node calls
    // the request "finished" here anyway (TLS buffers the write), which is why
    // the phase cannot be read from the request's 'finish' event alone.
    const err = await rejection(request({
      url: base.replace('http:', 'https:') + '/rest/api/2/issue',
      method: 'POST',
      body: '{"fields":{}}',
      timeoutMs: 300
    }));

    expect(err).toBeInstanceOf(OutboundHttpError);
    expect(err.code).toBe('tls');
    expect(err.phase).toBe('not_sent');
  });

  // A creation that times out before the TLS session exists can be retried; one
  // reported "sent" would be marked uncertain for good. The TCP connection is
  // up here, so a phase read from 'connect' or 'finish' alone would be wrong.
  it('reports an idle timeout during the TLS handshake as never sent', async () => {
    const silent = await silentTcp();
    try {
      const err = await rejection(request({ url: silent.url, method: 'POST', body: '{}', timeoutMs: 100 }));

      expect(err).toBeInstanceOf(OutboundHttpError);
      expect(err.code).toBe('timeout');
      expect(err.phase).toBe('not_sent');
    } finally {
      await silent.close();
    }
  });

  it('reports a deadline reached during the TLS handshake as never sent', async () => {
    const silent = await silentTcp();
    try {
      const started = Date.now();
      const err = await rejection(request({ url: silent.url, method: 'POST', body: '{}', timeoutMs: 1000, deadlineMs: 100 }));

      expect(err).toBeInstanceOf(OutboundHttpError);
      expect(err.code).toBe('deadline');
      expect(err.phase).toBe('not_sent');
      // The deadline, not the idle timeout, ended the call.
      expect(Date.now() - started).toBeLessThan(400);
    } finally {
      await silent.close();
    }
  });

  it('connects to an IPv6 literal rather than looking it up as a name', async () => {
    // `parseJiraBaseUrl` accepts http://[::1]. The URL parser keeps the
    // brackets, and a bracketed host handed to the socket is resolved as a
    // host name, which fails as ENOTFOUND whatever listens there.
    const v6 = await listen(http.createServer((_req, res) => res.end('v6')), '::1').catch(() => null);
    if (v6) {
      try {
        const response = await request({ url: `http://[::1]:${portOf(v6)}/rest/api/2/serverInfo`, timeoutMs: 300 });
        expect(response.body).toBe('v6');
      } finally {
        await stop(v6);
      }
      return;
    }
    // A machine without IPv6 cannot answer, but the call must still fail at
    // the socket (refused, or address family not supported), never at DNS.
    const err = await rejection(request({ url: `http://[::1]:${await freePort()}/rest/api/2/serverInfo`, timeoutMs: 300 }));
    expect(err.code).toBe('network');
    expect(systemCodeOf(err)).not.toBe('ENOTFOUND');
  });

  // The certificate failures an operator actually meets (a self-signed or
  // internal-CA Jira) are reported by OpenSSL's own codes, not as `EPROTO`.
  // The certificate is made for the run; a machine without openssl skips this
  // rather than carrying a private key in the repository.
  const hasOpenssl = (() => {
    try {
      execFileSync('openssl', ['version'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();

  describe.skipIf(!hasOpenssl)('against a Jira with a self-signed certificate', () => {
    let secure: https.Server;
    let secureBase = '';
    let certificateDir = '';

    beforeAll(async () => {
      certificateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbound-http-tls-'));
      const keyFile = path.join(certificateDir, 'key.pem');
      const certFile = path.join(certificateDir, 'cert.pem');
      execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyFile, '-out', certFile, '-days', '2', '-subj', '/CN=localhost'
      ], { stdio: 'ignore' });
      secure = await listen(https.createServer(
        { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) },
        (req, res) => {
          req.resume();
          req.on('end', () => res.end('{"version":"10.3.1"}'));
        }
      ));
      secureBase = `https://127.0.0.1:${portOf(secure)}`;
    });

    afterAll(async () => {
      if (secure) await stop(secure);
      if (certificateDir) fs.rmSync(certificateDir, { recursive: true, force: true });
    });

    it('refuses the certificate by default, as a TLS failure that sent nothing', async () => {
      const err = await rejection(request({
        url: `${secureBase}/rest/api/2/issue`,
        method: 'POST',
        body: '{"fields":{}}',
        timeoutMs: 1000
      }));

      expect(err).toBeInstanceOf(OutboundHttpError);
      expect(err.code).toBe('tls');
      expect(err.phase).toBe('not_sent');
      expect(systemCodeOf(err)).toBe('DEPTH_ZERO_SELF_SIGNED_CERT');
    });

    it('accepts it when self-signed certificates are allowed, for that call only', async () => {
      const response = await request({ url: `${secureBase}/rest/api/2/serverInfo`, rejectUnauthorized: false, timeoutMs: 1000 });
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body)).toEqual({ version: '10.3.1' });

      // The allowance lives on an agent of that call, never on the shared one.
      const next = await rejection(request({ url: `${secureBase}/rest/api/2/serverInfo`, timeoutMs: 1000 }));
      expect(next.code).toBe('tls');
    });
  });

  it('refuses an address that is not http or https', async () => {
    await expect(request({ url: 'ftp://127.0.0.1/x', timeoutMs: 300 })).rejects.toThrow(TypeError);
  });

  // Node's opt-in proxy support (`NODE_USE_ENV_PROXY=1`, from Node 22.21 / 24.5)
  // configures the *global* agent. The agent built to skip certificate checks
  // is a new one, and would silently go direct unless it is handed the same
  // proxy settings. An older Node has no `proxyEnv` at all.
  const proxySupported = 'proxyEnv' in (https.globalAgent.options as object);

  it.skipIf(!proxySupported)('sends a self-signed-certificate request through the proxy the global agent uses', async () => {
    const tunnels: string[] = [];
    const proxy = http.createServer((_req, res) => res.end());
    proxy.on('connect', (req, socket) => {
      tunnels.push(req.url ?? '');
      socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    });
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;

    const options = https.globalAgent.options as { proxyEnv?: unknown };
    const saved = options.proxyEnv;
    options.proxyEnv = { HTTPS_PROXY: proxyUrl };
    try {
      const err = await rejection(request({
        url: 'https://jira.invalid/rest/api/2/serverInfo',
        rejectUnauthorized: false,
        timeoutMs: 300
      }));
      expect(tunnels).toEqual(['jira.invalid:443']);
      // The proxy refused the tunnel: nothing reached Jira.
      expect(err.code).toBe('network');
      expect(err.phase).toBe('not_sent');
    } finally {
      options.proxyEnv = saved;
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
});
