import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const createRateLimiters = ({ shouldSkipSuperAdminLimit }) => {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipSuperAdminLimit
  });

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const teamName = typeof req.body?.teamName === 'string' ? req.body.teamName.toLowerCase() : '';
      return `${ipKeyGenerator(req)}:${teamName}`;
    }
  });

  const superAdminActionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    message: { error: 'too_many_attempts', retryAfter: '15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skip: shouldSkipSuperAdminLimit
  });

  const teamReadLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  const teamWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  const superAdminPollingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'too_many_attempts', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  return {
    authLimiter,
    loginLimiter,
    superAdminActionLimiter,
    teamReadLimiter,
    teamWriteLimiter,
    superAdminPollingLimiter
  };
};

export { createRateLimiters };
