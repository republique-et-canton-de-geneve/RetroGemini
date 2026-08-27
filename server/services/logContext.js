import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

/**
 * The correlation id, carried without the call sites knowing (audit H44).
 *
 * H44's own note is explicit that this must be "a wrapper, not a
 * find-and-replace": there are hundreds of `console.log` calls across the
 * server, and threading a request id through every one of them would be a large
 * diff that goes stale the first time somebody adds a handler. `AsyncLocalStorage`
 * carries the id down the async call chain instead, so a message logged three
 * awaits deep inside a route still names the request it belongs to, and the
 * route never mentions it.
 *
 * The store is a plain mutable object on purpose: a handler learns things about
 * its own work as it goes (which session was joined, which team authenticated),
 * and `setContextValue` lets it enrich the record every later line will carry.
 */

const storage = new AsyncLocalStorage();

/** Run `fn` with `context` visible to everything it awaits. */
const runWithContext = (context, fn) => storage.run(context, fn);

/** The active context, or `undefined` outside any request or socket event. */
const currentContext = () => storage.getStore();

/**
 * Add a field to the active context. A no-op outside one, so a handler called
 * from a test or a startup path does not have to guard.
 */
const setContextValue = (key, value) => {
  const context = storage.getStore();
  if (context) context[key] = value;
};

/**
 * A caller-supplied id is adopted, because a trace that starts at the Ingress
 * is worth more than one that starts here — but only after a length and
 * charset check. Anyone who can reach the deployment sets this header: JSON
 * encoding already neutralises log injection, nothing but this bounds a
 * megabyte of junk arriving on every request and being written to disk by the
 * platform's log aggregator.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

const sanitizeRequestId = (value) =>
  typeof value === 'string' && VALID_REQUEST_ID.test(value) ? value : null;

/**
 * Express middleware. Assigns the request a correlation id, echoes it on the
 * response so a user reporting a problem can quote the id from their browser's
 * network tab, and runs the rest of the request inside the context.
 */
const createRequestContext = ({ header = 'X-Request-Id', newId = randomUUID } = {}) => {
  const inboundHeader = header.toLowerCase();

  return (req, res, next) => {
    const correlationId = sanitizeRequestId(req.headers?.[inboundHeader]) ?? newId();
    res.setHeader(header, correlationId);
    runWithContext({ correlationId }, next);
  };
};

export { runWithContext, currentContext, setContextValue, createRequestContext, sanitizeRequestId };
