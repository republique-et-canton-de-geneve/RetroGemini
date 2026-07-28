import { createTokenService } from '../../server/services/sessionTokens.js';
import { secureCompare } from '../../server/services/security.js';

/**
 * Shared setup for the socket integration harnesses.
 *
 * Since audit H1 a `join-session` must present the team session token the real
 * client holds after login, so every harness that drives the real socket
 * handlers needs a token service and a token for its fixture team. A fixed
 * secret keeps tokens reproducible across runs.
 *
 * Not a `*.test.ts` file, so vitest does not collect it as a suite.
 */
export const createTestTokenService = () =>
  createTokenService({
    secureCompare,
    superAdminPassword: 'unused-in-tests',
    tokenSecret: 'test-socket-signing-secret'
  });
