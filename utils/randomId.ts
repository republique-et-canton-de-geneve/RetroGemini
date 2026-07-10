/**
 * Crypto-strong random identifier generator for the client bundle.
 *
 * Ids minted here end up in security-adjacent places: invite tokens are
 * bearer credentials, and member/session ids are persisted next to the team
 * session token in the browser session blob. They must therefore never
 * derive from Math.random() (CodeQL js/insecure-randomness).
 *
 * Uses Web Crypto's getRandomValues, which unlike crypto.randomUUID is also
 * available on plain-HTTP intranet origins (this app runs air-gapped without
 * TLS) and in the Node-based test environment.
 */
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

export const randomId = (length = 9): string => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) {
    id += BASE36[byte % 36];
  }
  return id;
};
