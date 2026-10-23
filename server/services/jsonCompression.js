/**
 * Gzip for JSON answers (synthesis item 9), with no dependency.
 *
 * A team answer is 0.6 to 1 MB of JSON that gzips about tenfold, and fifteen
 * phones on one access point used to pull every copy uncompressed. The
 * `compression` package would have done this for about eight transitive
 * packages; an air-gapped deployment needs a better reason than convenience
 * for each production dependency (the reasoning `securityHeaders.js` gives
 * for not using `helmet`), and `node:zlib` is already there.
 *
 * Wraps `res.json` alone, so a body sent any other way is never touched:
 * `res.send(Buffer)` (the backup downloads, already gzip), `res.sendFile`, a
 * streamed `res.write`/`pipe`, and Socket.IO, which engine.io answers before
 * Express sees the request (and which compresses its own polling).
 * `res.send(object)` goes through `res.json` in Express, so it is covered.
 *
 * Mounted right after the security headers: they are already set when an
 * answer is compressed, and compression never touches a header but its own
 * (`Content-Encoding`, `Vary`, and the dropped `Content-Length`).
 *
 * The headers of a compressed answer are committed synchronously, as Express
 * would commit them: a second `res.json`/`res.send`, or a header set after
 * the answer, throws ERR_HTTP_HEADERS_SENT exactly as before, and the status
 * cannot change under the body. Only the body is late: it is compressed on
 * libuv's pool rather than on the event loop every live session shares
 * (`gzipSync` measured 9.8 ms for a 1.06 MB team), so it goes out chunked,
 * with no Content-Length. Its weak ETag is the identity body's, shared by
 * both encodings, which is what nginx and `compression` do.
 *
 * ⚠️ A handler must therefore not throw, nor do anything that can throw,
 * after it has answered. The router destroys a socket whose headers are sent,
 * and the body still being compressed is lost with it
 * (`__tests__/jsonCompression.test.ts` pins that case). Best-effort work after
 * an answer goes in its own `.catch`, as the rename route's live-session
 * propagation does.
 */
import { gzip } from 'node:zlib';

// Below this, the gzip header and the CPU cost more than the bytes saved.
export const JSON_COMPRESSION_THRESHOLD_BYTES = 1024;
// About 12x on a team answer in a few ms; higher levels buy little on JSON.
export const JSON_COMPRESSION_LEVEL = 4;

export const createJsonCompression = ({
  threshold = JSON_COMPRESSION_THRESHOLD_BYTES,
  level = JSON_COMPRESSION_LEVEL
} = {}) => (req, res, next) => {
  const originalJson = res.json;

  // What Express's own res.json does with an already-stringified body.
  const sendJsonText = (text) => {
    if (!res.get('Content-Type')) res.set('Content-Type', 'application/json');
    return res.send(text);
  };

  res.json = function compressedJson(obj) {
    const app = this.app;
    // A JSON setting this wrapper does not reproduce (none is set today):
    // let Express do it all, uncompressed.
    if (app.get('json escape') || app.get('json replacer') || app.get('json spaces') !== undefined) {
      return originalJson.call(this, obj);
    }
    const text = JSON.stringify(obj);
    if (text === undefined) return originalJson.call(this, obj);
    if (Buffer.byteLength(text) < threshold) return sendJsonText(text);
    if (this.getHeader('Content-Encoding') || /\bno-transform\b/i.test(String(this.getHeader('Cache-Control') ?? ''))) {
      return sendJsonText(text);
    }
    const status = this.statusCode;
    if (status < 200 || status === 204 || status === 205 || status === 304) return sendJsonText(text);

    // Any answer this large could have been compressed: a cache must key on it.
    this.vary('Accept-Encoding');
    // HEAD keeps identity headers (RFC 9110 permits it): its Content-Length
    // then says what a GET would carry in identity.
    if (req.method === 'HEAD' || req.acceptsEncodings('gzip', 'identity') !== 'gzip') return sendJsonText(text);

    const body = Buffer.from(text);
    // The identity ETag, which Express would set: a weak validator shared by
    // both encodings. A fresh GET is a 304, answered by Express.
    const etagFn = app.get('etag fn');
    if (typeof etagFn === 'function' && !this.get('ETag')) {
      const tag = etagFn(body);
      if (tag) this.set('ETag', tag);
    }
    if (req.fresh) return sendJsonText(text);

    // `res.set` gives a bare 'application/json' its charset, as res.send does.
    if (!this.get('Content-Type')) this.set('Content-Type', 'application/json');
    this.set('Content-Encoding', 'gzip');
    this.removeHeader('Content-Length');
    this.writeHead(status);
    gzip(body, { level }, (err, compressed) => {
      // The client went away while the body was being compressed.
      if (this.destroyed) return;
      if (err) {
        console.error('[Server] Failed to gzip a JSON response', err);
        this.destroy(err);
        return;
      }
      this.end(compressed);
    });
    return this;
  };

  next();
};
