/**
 * Rate Limiter Service
 * 
 * Features:
 * - Per-domain token-bucket throttling
 * - Global concurrency semaphore
 * - Redis-backed state
 * - Metrics tracking
 */

import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  ...(redisUrl.startsWith('rediss://')
    ? { tls: { rejectUnauthorized: false } }
    : {}),
});

/**
 * Per-domain rate limit configuration
 * 
 * Defines max requests per second and burst capacity for each job site
 */
export const DOMAIN_RATE_LIMITS = {
  'greenhouse.io': {
    rps: 0.2,              // 1 request per 5 seconds
    burst: 1,              // Max 1 concurrent requests
    retryAfterMs: 5000,    // Wait 5s before retry
  },
  'lever.co': {
    rps: 0.2,              // 1 per 5s
    burst: 1,
    retryAfterMs: 5000,
  },
  'ashby.com': {
    rps: 0.25,             // 1 per 4s
    burst: 1,
    retryAfterMs: 4000,
  },
  'workable.com': {
    rps: 0.33,             // ~1 per 3s
    burst: 2,
    retryAfterMs: 3000,
  },
  'bamboohr.com': {
    rps: 0.2,              // 1 per 5s
    burst: 1,
    retryAfterMs: 5000,
  },
  'taleo.net': {
    rps: 0.167,            // 1 per 6s (conservative for Oracle)
    burst: 1,
    retryAfterMs: 6000,
  },
  default: {
    rps: 0.1,              // 1 per 10s (conservative fallback)
    burst: 1,
    retryAfterMs: 10000,
  },
};

/**
 * Token-bucket rate limiter for a specific domain
 * 
 * Tokens accumulate over time at rate `rps`.
 * Each request costs 1 token.
 * Burst capacity prevents hoarding tokens.
 * 
 * @param {string} domain - Job site domain
 * @returns {Promise<{allowed: boolean, waitMs?: number, tokens: number, burstCapacity: number}>}
 */
export const checkDomainRateLimit = async (domain) => {
  const config = DOMAIN_RATE_LIMITS[domain] || DOMAIN_RATE_LIMITS.default;
  const key = `rate-limit:domain:${domain}`;
  const lastRefillKey = `${key}:last-refill`;
  const tokensKey = `${key}:tokens`;
  
  try {
    const now = Date.now();
    const lastRefill = parseInt((await redis.get(lastRefillKey)) || now);
    
    // Calculate elapsed time and tokens to add
    const elapsedMs = now - lastRefill;
    const elapsedSec = elapsedMs / 1000;
    const tokensToAdd = elapsedSec * config.rps;
    
    // Get current tokens (capped at burst)
    const currentTokens = parseFloat((await redis.get(tokensKey)) || config.burst);
    const newTokens = Math.min(config.burst, currentTokens + tokensToAdd);
    
    // Update Redis state
    await redis.set(tokensKey, newTokens, 'EX', 3600);
    await redis.set(lastRefillKey, now, 'EX', 3600);
    
    // Check if we can proceed
    if (newTokens >= 1) {
      // Consume 1 token
      await redis.set(tokensKey, newTokens - 1, 'EX', 3600);
      
      return {
        allowed: true,
        tokens: newTokens - 1,
        burstCapacity: config.burst,
      };
    }
    
    // Calculate wait time until next token available
    const waitMs = Math.ceil((1 - newTokens) / config.rps * 1000);
    
    return {
      allowed: false,
      waitMs,
      tokens: newTokens,
      burstCapacity: config.burst,
      retryAfterMs: config.retryAfterMs,
    };
  } catch (err) {
    console.error(`Rate limit check failed for ${domain}:`, err);
    // Fail-safe: allow but log
    return { allowed: true, tokens: 0, burstCapacity: config.burst };
  }
};

/**
 * Global concurrency limiter (semaphore)
 * 
 * Limits total number of active Playwright fills across all domains.
 * Prevents resource exhaustion (memory, CPU, network).
 * 
 * @param {Object} options
 * @param {number} options.maxConcurrent - Max active workers (default: 10)
 * @param {string} options.operation - 'acquire' or 'release'
 * @returns {Promise<{acquired: boolean, activeCount: number, limit: number, waitMs?: number}>}
 */
export const manageGlobalConcurrency = async (options = {}) => {
  const { maxConcurrent = 10, operation = 'acquire' } = options;
  const key = 'concurrency:global:active';
  
  try {
    if (operation === 'acquire') {
      // Try to increment counter (only if below limit)
      const result = await redis.incr(key);
      
      if (result <= maxConcurrent) {
        // Set expiry (safety: auto-release if worker crashes)
        await redis.expire(key, 600); // 10 minute timeout
        
        return {
          acquired: true,
          activeCount: result,
          limit: maxConcurrent,
        };
      }
      
      // Over limit: rollback increment
      await redis.decr(key);
      
      // Estimate wait (average job duration ~60s)
      const waitMs = 60000;
      
      return {
        acquired: false,
        activeCount: maxConcurrent,
        limit: maxConcurrent,
        waitMs,
      };
    }
    
    if (operation === 'release') {
      // Decrement counter
      const result = await redis.decr(key);
      
      return {
        acquired: false,
        activeCount: Math.max(0, result),
        limit: maxConcurrent,
      };
    }
  } catch (err) {
    console.error('Global concurrency check failed:', err);
    // Fail-safe: allow
    return { acquired: true, activeCount: 0, limit: maxConcurrent };
  }
};

/**
 * Adaptive throttle based on error patterns
 * 
 * Automatically backs off if seeing high error rates.
 * Example: If 3+ failures in last 10 minutes, increase RPS from 0.2 to 0.1
 * 
 * @param {string} domain
 * @param {Object} options
 * @param {number} options.failureThreshold - Failures before backing off (default: 3)
 * @param {number} options.windowMs - Time window (default: 600000ms = 10min)
 * @returns {Promise<{isThrottled: boolean, multiplier: number, reason?: string}>}
 */
export const getAdaptiveThrottle = async (domain, options = {}) => {
  const { failureThreshold = 3, windowMs = 600000 } = options;
  const key = `adaptive:${domain}:failures`;
  const throttleKey = `adaptive:${domain}:multiplier`;
  
  try {
    const failureCount = parseInt((await redis.get(key)) || 0);
    let multiplier = parseFloat((await redis.get(throttleKey)) || 1.0);
    
    if (failureCount >= failureThreshold && multiplier < 2.0) {
      // Back off: increase RPS throttling (multiply by 2)
      multiplier = Math.min(2.0, multiplier * 1.5);
      await redis.set(throttleKey, multiplier, 'EX', 3600);
      
      return {
        isThrottled: true,
        multiplier,
        reason: `${failureCount} failures in last ${windowMs / 60000}min`,
      };
    }
    
    if (failureCount === 0 && multiplier > 1.0) {
      // Recover: slowly reduce throttling
      multiplier = Math.max(1.0, multiplier * 0.9);
      await redis.set(throttleKey, multiplier, 'EX', 3600);
    }
    
    return {
      isThrottled: multiplier > 1.0,
      multiplier,
    };
  } catch (err) {
    console.error(`Adaptive throttle check failed for ${domain}:`, err);
    return { isThrottled: false, multiplier: 1.0 };
  }
};

/**
 * Record failure for domain (used by adaptive throttle)
 * 
 * @param {string} domain
 * @param {Object} error - Error details
 */
export const recordDomainFailure = async (domain, error = {}) => {
  const key = `adaptive:${domain}:failures`;
  
  try {
    const count = await redis.incr(key);
    // Reset counter daily
    await redis.expire(key, 86400);
    
    // Also log to error tracking
    const logsKey = `logs:domain-errors:${domain}`;
    await redis.lpush(logsKey, JSON.stringify({
      timestamp: new Date().toISOString(),
      error: error.message || error,
    }));
    await redis.ltrim(logsKey, 0, 99); // Keep last 100 errors
    await redis.expire(logsKey, 86400);
    
    console.warn(`Domain failure recorded for ${domain}: count=${count}`);
  } catch (err) {
    console.error(`Failed to record domain failure:`, err);
  }
};

/**
 * Get rate limit stats for monitoring
 * 
 * @returns {Promise<Object>} Current state of all rate limiters
 */
export const getRateLimitStats = async () => {
  const stats = {
    domains: {},
    global: {},
    timestamp: new Date().toISOString(),
  };
  
  try {
    // Per-domain stats
    for (const domain of Object.keys(DOMAIN_RATE_LIMITS)) {
      const tokensKey = `rate-limit:domain:${domain}:tokens`;
      const tokens = parseFloat((await redis.get(tokensKey)) || DOMAIN_RATE_LIMITS[domain].burst);
      const failures = parseInt((await redis.get(`adaptive:${domain}:failures`)) || 0);
      const multiplier = parseFloat((await redis.get(`adaptive:${domain}:multiplier`)) || 1.0);
      
      stats.domains[domain] = {
        tokens,
        capacity: DOMAIN_RATE_LIMITS[domain].burst,
        failures,
        throttleMultiplier: multiplier,
      };
    }
    
    // Global concurrency
    const active = parseInt((await redis.get('concurrency:global:active')) || 0);
    stats.global = {
      activeWorkers: active,
      maxConcurrent: 10,
      utilization: `${((active / 10) * 100).toFixed(1)}%`,
    };
  } catch (err) {
    console.error('Failed to get rate limit stats:', err);
  }
  
  return stats;
};

/**
 * Reset rate limiter for a domain (admin use)
 * 
 * @param {string} domain
 * @returns {Promise<void>}
 */
export const resetDomainRateLimit = async (domain) => {
  try {
    const prefix = `rate-limit:domain:${domain}`;
    await redis.del(`${prefix}:tokens`);
    await redis.del(`${prefix}:last-refill`);
    await redis.del(`adaptive:${domain}:failures`);
    await redis.del(`adaptive:${domain}:multiplier`);
    
    console.log(`Rate limiter reset for ${domain}`);
  } catch (err) {
    console.error(`Failed to reset rate limiter for ${domain}:`, err);
  }
};

export default {
  DOMAIN_RATE_LIMITS,
  checkDomainRateLimit,
  manageGlobalConcurrency,
  getAdaptiveThrottle,
  recordDomainFailure,
  getRateLimitStats,
  resetDomainRateLimit,
};
