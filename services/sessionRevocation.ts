/**
 * Decision D3b — the client half of "a password rotation signs the team's
 * open sessions out".
 *
 * The server answers a token a rotation revoked with `401 session_revoked` on
 * every team route, and cuts a socket joined with one (`join-denied` with
 * `cause: 'session_revoked'`). Both reach this module as one signal, resolved
 * once: retry when the token this client holds changed since the request left
 * (the rotation was made here, or another tab of this browser made it), or
 * mark the session revoked. Once revoked, the client stops writing — no
 * reconnect or re-send storm — and the screens say why and send the user to
 * the login screen.
 *
 * A module of its own, with no imports and no network, on purpose: about ten
 * suites mock `dataService` with an object literal, and App and the session
 * screens would crash on an export the mock lacks. `dataService` registers the
 * resolver; `syncService`, the screens and the other API callers read and
 * report through this module.
 */

export const SESSION_REVOKED = 'session_revoked';

export type RevocationOutcome = 'retry' | 'revoked';

type Listener<T> = (value: T) => void;

let revoked = false;
const revokedListeners = new Set<Listener<boolean>>();
const tokenListeners = new Set<() => void>();
const credentialChanges = new Set<Promise<unknown>>();
let resolver: ((sentToken: string | null) => Promise<RevocationOutcome>) | null = null;

/** Whether the server has signed this client's team session out. */
export const isSessionRevoked = (): boolean => revoked;

/** Idempotent: the listeners hear of it once. */
export const markSessionRevoked = (): void => {
  if (revoked) return;
  revoked = true;
  revokedListeners.forEach((listener) => listener(true));
};

/** A new credential replaced the revoked one (a login, another tab's token). */
export const clearSessionRevoked = (): void => {
  if (!revoked) return;
  revoked = false;
  revokedListeners.forEach((listener) => listener(false));
};

export const onSessionRevokedChange = (listener: Listener<boolean>): (() => void) => {
  revokedListeners.add(listener);
  return () => {
    revokedListeners.delete(listener);
  };
};

/**
 * Marks a credential change in flight (the password change): its answer can
 * arrive *after* a 401 that its own commit caused, and that 401 must wait for
 * the new token rather than sign the facilitator out.
 */
export const trackCredentialChange = <T>(work: Promise<T>): Promise<T> => {
  credentialChanges.add(work);
  const done = () => {
    credentialChanges.delete(work);
  };
  work.then(done, done);
  return work;
};

export const whenCredentialsSettled = async (): Promise<void> => {
  while (credentialChanges.size > 0) {
    await Promise.allSettled([...credentialChanges]);
  }
};

/** The team session token this client holds changed (rotation, adoption). */
export const notifySessionTokenChanged = (): void => {
  tokenListeners.forEach((listener) => listener());
};

export const onSessionTokenChanged = (listener: () => void): (() => void) => {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
};

/** `dataService` decides between a retry and a revocation (see there). */
export const registerRevocationResolver = (fn: (sentToken: string | null) => Promise<RevocationOutcome>): void => {
  resolver = fn;
};

/**
 * Reports a refused request: a `401 session_revoked` answers `'retry'` or
 * `'revoked'`; anything else is `'ignored'`. `sentToken` is the token the
 * request carried, so a refusal of a token this client has since replaced
 * reads as "send it again", never as a sign-out.
 */
export const noteRevokedAnswer = async (
  status: number,
  code: unknown,
  sentToken: string | null
): Promise<RevocationOutcome | 'ignored'> => {
  if (status !== 401 || code !== SESSION_REVOKED) return 'ignored';
  if (!resolver) {
    markSessionRevoked();
    return 'revoked';
  }
  return resolver(sentToken);
};

/**
 * The same, for a caller holding a `Response`: its body is read from a copy,
 * so the caller can still read it.
 */
export const noteRevokedResponse = async (
  response: Response,
  sentToken: string | null | undefined
): Promise<RevocationOutcome | 'ignored'> => {
  if (response.status !== 401) return 'ignored';
  let code: unknown;
  try {
    const copy = typeof response.clone === 'function' ? response.clone() : response;
    code = ((await copy.json()) as { error?: unknown } | null)?.error;
  } catch {
    return 'ignored';
  }
  return noteRevokedAnswer(response.status, code, sentToken ?? null);
};

/**
 * When a team session token was issued (its `iat`, milliseconds), read from
 * its middle part; 0 when it cannot be read. Never trusted for
 * authentication — the server checks the signature — it only orders two
 * tokens of one team that this browser already holds: the one issued later
 * came from a later login or rotation, so it is never less valid than the
 * other. Tokens carry no user (`visitorId` is always null), so keeping
 * another tab's newer token is safe for any user of that team.
 */
export const tokenIssuedAt = (token: string | null | undefined): number => {
  if (typeof token !== 'string') return 0;
  const part = token.split('.')[1];
  if (!part) return 0;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '==='.slice((base64.length + 3) % 4);
    const iat = (JSON.parse(atob(padded)) as { iat?: unknown } | null)?.iat;
    return typeof iat === 'number' && Number.isFinite(iat) ? iat : 0;
  } catch {
    return 0;
  }
};

/** The newer of two tokens of one team; `b` on a tie. */
export const newerToken = (a: string | null | undefined, b: string | null | undefined): string | null => {
  if (!a) return b ?? null;
  if (!b) return a;
  return tokenIssuedAt(b) >= tokenIssuedAt(a) ? b : a;
};
