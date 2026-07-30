import type express from 'express';

/**
 * Boots an Express app on an ephemeral port, issues one request against it and
 * shuts it down again. Route suites use the real HTTP stack (rather than
 * calling handlers directly) so that middleware — rate limiters, body parsing,
 * error handling — is exercised the way production wires it.
 */
export const request = async (
  app: express.Express,
  path: string,
  init: Parameters<typeof fetch>[1] = {}
): Promise<Response> => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    return await fetch(`http://127.0.0.1:${address.port}${path}`, init);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

/**
 * Same as `request`, but keeps the server alive across several calls so
 * per-IP rate limiters accumulate state the way they do for a real client.
 */
export const withServer = async <T>(
  app: express.Express,
  run: (call: (path: string, init?: Parameters<typeof fetch>[1]) => Promise<Response>) => Promise<T>
): Promise<T> => {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind test server');
    }
    const base = `http://127.0.0.1:${address.port}`;
    return await run((path, init = {}) => fetch(`${base}${path}`, init));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
};

export const postJson = (body: unknown): Parameters<typeof fetch>[1] => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});
