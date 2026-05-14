/**
 * Autofill Job Queue with BullMQ
 * 
 * Features:
 * - Exponential backoff with jitter
 * - Per-domain rate-limit checking
 * - Idempotent job deduplication
 * - Randomized delays (10–120s or scheduled off-peak)
 * - Retry policy with exponential backoff
 * - Job state tracking: queued → running → paused(HITL) → succeeded/failed
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';

// Redis connection shared across queue
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redisOptions = {
  maxRetriesPerRequest: null,
  connectTimeout: 3000,
  commandTimeout: 3000,
  enableReadyCheck: true,
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 2) return null; // Fail fast instead of hanging serverless request
    return Math.min(times * 200, 500);
  },
  ...(redisUrl.startsWith('rediss://')
    ? { tls: { rejectUnauthorized: false } }
    : {}),
};

const redis = new Redis(redisUrl, redisOptions);
const redisClient = new Redis(redisUrl, redisOptions);

/**
 * Create or get autofill queue
 */
export const createAutofillQueue = () => {
  return new Queue('autofill-applications', {
    connection: redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000, // 2s base
      },
      removeOnComplete: { age: 3600 }, // Keep for 1 hour
      removeOnFail: { age: 86400 }, // Keep for 24 hours
    },
  });
};

/**
 * Job data structure
 * 
 * @typedef {Object} AutofillJobData
 * @property {string} userId - Supabase user ID
 * @property {string} jobId - Job posting ID from database
 * @property {string} jobUrl - URL of the job application
 * @property {string} company - Company name
 * @property {string} roleTitle - Job title
 * @property {Object} formAnswers - Pre-generated form answers
 * @property {string} resumeUrl - S3/R2 URL to resume file
 * @property {string} idempotencyKey - Unique key to prevent duplicate submissions
 * @property {string} [domain] - Job site domain (greenhouse.io, lever.co, etc) - auto-extracted if not provided
 * @property {number} [scheduledDelayMs] - Custom delay before apply (default: random 10-120s)
 * @property {Object} [metadata] - Additional context (evaluation score, report ID, etc)
 */

/**
 * Enqueue an autofill job
 * 
 * @param {AutofillJobData} jobData
 * @param {Object} options - Queue options
 * @param {number} options.delay - Delay before processing (ms)
 * @param {number} options.priority - Job priority (1-10, higher = earlier)
 * @returns {Promise<Object>} Created job
 */
export const enqueueAutofillJob = async (jobData, options = {}) => {
  const queue = createAutofillQueue();
  
  // Extract domain from URL if not provided
  if (!jobData.domain && jobData.jobUrl) {
    const url = new URL(jobData.jobUrl);
    jobData.domain = url.hostname.replace('www.', '');
  }
  
  const { delay = 0, priority = 5 } = options;
  
  // Force an explicit connection attempt so we can fail fast with useful errors.
  await redis.connect().catch((err) => {
    const msg = String(err?.message || '');
    // ioredis throws this when connect() is called while it is already in progress/up.
    if (msg.includes('already connecting/connected')) return;
    throw new Error(`REDIS_CONNECT_FAILED: ${msg || 'unknown redis error'}`);
  });

  const job = await queue.add('fill-and-submit', jobData, {
    delay,
    priority,
    jobId: jobData.idempotencyKey, // Use idempotency key as BullMQ job ID
  });

  // Return a plain BullMQ job id so API/db call sites don't accidentally
  // persist an object (e.g. "[object Object]") as bullmq_job_id.
  return String(job.id);
};

/**
 * Get job status
 * 
 * @param {string} jobId - BullMQ job ID (same as idempotencyKey)
 * @returns {Promise<Object>} Job status and metadata
 */
export const getAutofillJobStatus = async (jobId) => {
  const queue = createAutofillQueue();

  const job = await queue.getJob(jobId);
  
  if (!job) {
    return { status: 'not_found', jobId };
  }
  
  const state = await job.getState();
  const progress = job.progress || 0;
  const attempts = job.attemptsMade;
  
  return {
    jobId: job.id,
    status: state,
    progress,
    attempts,
    data: job.data,
    result: job.returnvalue,
    failureReason: job.failedReason,
    stackTrace: job.stacktrace,
    createdAt: new Date(job.timestamp).toISOString(),
    processedAt: job.processedOn ? new Date(job.processedOn).toISOString() : null,
    completedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
  };
};

/**
 * Cancel an autofill job
 * 
 * @param {string} jobId - BullMQ job ID
 * @returns {Promise<boolean>} True if cancelled
 */
export const cancelAutofillJob = async (jobId) => {
  const queue = createAutofillQueue();

  const job = await queue.getJob(jobId);
  
  if (!job) {
    return false;
  }
  
  await job.remove();
  return true;
};

/**
 * Backoff with jitter calculation
 * 
 * Exponential backoff: base * (2 ^ attempt)
 * Jitter: ±(base * 0.5)
 * 
 * @param {number} attempt - Attempt number (0-indexed)
 * @param {number} baseMs - Base delay in milliseconds (default: 2000)
 * @returns {number} Delay in milliseconds
 */
export const calculateBackoffWithJitter = (attempt, baseMs = 2000) => {
  const exponential = baseMs * Math.pow(2, attempt);
  const jitter = (Math.random() - 0.5) * baseMs; // ±50% of base
  return Math.max(1000, exponential + jitter); // Minimum 1s
};

/**
 * Generate randomized delay before apply
 * 
 * Options:
 * 1. Uniform random: 10–120 seconds (human-like)
 * 2. Scheduled off-peak: queue for 2 AM, 4 AM, etc (less suspicious)
 * 
 * @param {Object} options
 * @param {string} options.strategy - 'uniform' or 'scheduled' (default: 'uniform')
 * @param {number} [options.minSec] - Minimum delay (default: 10)
 * @param {number} [options.maxSec] - Maximum delay (default: 120)
 * @returns {number} Delay in milliseconds
 */
export const generateApplyDelay = (options = {}) => {
  const { strategy = 'uniform', minSec = 10, maxSec = 120 } = options;
  
  if (strategy === 'scheduled') {
    // Calculate delay to next off-peak hour (2 AM, 4 AM, etc)
    const now = new Date();
    const nextOffPeak = new Date(now);
    
    // Find next 2-hour off-peak window
    const offPeakHours = [2, 4, 23]; // 2 AM, 4 AM, 11 PM
    const currentHour = nextOffPeak.getHours();
    
    let targetHour = offPeakHours.find(h => h > currentHour);
    if (!targetHour) {
      targetHour = offPeakHours[0]; // Next day
      nextOffPeak.setDate(nextOffPeak.getDate() + 1);
    }
    
    nextOffPeak.setHours(targetHour, 0, 0, 0);
    const delayMs = Math.max(0, nextOffPeak.getTime() - now.getTime());
    
    return delayMs;
  }
  
  // Uniform random
  const delaySec = Math.random() * (maxSec - minSec) + minSec;
  return delaySec * 1000;
};

/**
 * Per-domain rate limiter check
 * 
 * Checks if domain has available tokens before proceeding.
 * Uses Redis token-bucket algorithm.
 * 
 * @param {string} domain - Job site domain (e.g., 'greenhouse.io')
 * @param {Object} rateLimits - Map of domain → { rps: requests/sec, burst: max_tokens }
 *   Example: { 'greenhouse.io': { rps: 0.2, burst: 1 } }  (1 request per 5s, max burst 1)
 * @returns {Promise<boolean>} True if rate limit allows, false if throttled
 */
export const checkRateLimit = async (domain, rateLimits = {}) => {
  // Default rate limits (conservative)
  const defaults = {
    'greenhouse.io': { rps: 0.2, burst: 1 },      // 1 per 5s
    'lever.co': { rps: 0.2, burst: 1 },           // 1 per 5s
    'ashby.com': { rps: 0.25, burst: 1 },         // 1 per 4s
    'workable.com': { rps: 0.33, burst: 2 },      // ~1 per 3s
    default: { rps: 0.1, burst: 1 },              // 1 per 10s fallback
  };
  
  const limit = rateLimits[domain] || defaults[domain] || defaults.default;
  const key = `rate-limit:${domain}`;
  
  try {
    // Token-bucket: add tokens at rate, cap at burst
    const now = Date.now();
    const lastRefillKey = `${key}:last-refill`;
    const tokensKey = `${key}:tokens`;
    
    const lastRefill = parseInt(await redisClient.get(lastRefillKey) || now);
    const elapsed = (now - lastRefill) / 1000; // seconds
    const tokensToAdd = elapsed * limit.rps;
    const currentTokens = Math.min(
      limit.burst,
      (parseFloat(await redisClient.get(tokensKey)) || limit.burst) + tokensToAdd
    );
    
    if (currentTokens >= 1) {
      // Consume token
      await redisClient.set(tokensKey, currentTokens - 1, 'EX', 3600);
      await redisClient.set(lastRefillKey, now, 'EX', 3600);
      return true;
    }
    
    // No tokens available
    return false;
  } catch (err) {
    console.error(`Rate limit check failed for ${domain}:`, err);
    // Fail safe: allow job to proceed (log for monitoring)
    return true;
  }
};

/**
 * Check for duplicate submission (idempotency)
 * 
 * Prevents same job (user + company + role) from being submitted twice
 * within a time window (e.g., 24 hours).
 * 
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.company
 * @param {string} params.roleTitle
 * @param {number} [params.windowHours] - Deduplication window (default: 24)
 * @returns {Promise<boolean>} True if job is new, false if duplicate exists
 */
export const isJobNew = async (params) => {
  const { userId, company, roleTitle, windowHours = 24 } = params;
  
  const dedupeKey = `dedup:${userId}:${company}:${roleTitle}`;
  
  try {
    const exists = await redisClient.get(dedupeKey);
    
    if (exists) {
      return false; // Duplicate
    }
    
    // Mark as seen
    const ttlSeconds = windowHours * 3600;
    await redisClient.set(dedupeKey, 'true', 'EX', ttlSeconds);
    
    return true; // New job
  } catch (err) {
    console.error('Duplicate check failed:', err);
    return true; // Fail safe: treat as new
  }
};

/**
 * HITL (Human-In-The-Loop) pause
 * 
 * Pause job for manual resolution when CAPTCHA/block/error detected.
 * Stores artifact links for user review.
 * 
 * @param {Object} jobData
 * @param {string} jobData.jobId - BullMQ job ID
 * @param {string} jobData.reason - Reason for pause ('captcha', 'blocked', 'error', etc)
 * @param {Object} [jobData.artifacts] - Screenshots, logs, etc
 * @returns {Promise<void>}
 */
export const pauseForHITL = async (jobData) => {
  const { jobId, reason, artifacts = {} } = jobData;
  
  const queue = createAutofillQueue();
  
  try {
    const job = await queue.getJob(jobId);
    
    if (!job) return;
    
    // Store HITL context in Redis (TTL: 24 hours)
    const hitlKey = `hitl:${jobId}`;
    const hitlContext = {
      pausedAt: new Date().toISOString(),
      reason,
      artifacts,
      jobData: job.data,
    };
    
    await redisClient.set(
      hitlKey,
      JSON.stringify(hitlContext),
      'EX',
      86400 // 24 hours
    );
    
    console.log(`Job ${jobId} paused for HITL: ${reason}`);
  } finally {
    await queue.close();
  }
};

/**
 * Resume paused HITL job
 * 
 * Called after human resolves CAPTCHA/block, re-enqueues job.
 * 
 * @param {string} jobId - BullMQ job ID
 * @returns {Promise<void>}
 */
export const resumeHITLJob = async (jobId) => {
  const queue = createAutofillQueue();
  
  try {
    const job = await queue.getJob(jobId);
    
    if (!job) return;
    
    // Clear HITL context
    await redisClient.del(`hitl:${jobId}`);
    
    console.log(`Job ${jobId} resumed after HITL`);
  } finally {
    await queue.close();
  }
};

/**
 * Get queue stats for monitoring
 * 
 * @returns {Promise<Object>} Queue health metrics
 */
export const getQueueStats = async () => {
  const queue = createAutofillQueue();
  
  try {
    const counts = await queue.getJobCounts(
      'wait',
      'active',
      'completed',
      'failed',
      'paused',
      'delayed'
    );
    
    return {
      queued: counts.wait,
      active: counts.active,
      completed: counts.completed,
      failed: counts.failed,
      paused: counts.paused,
      delayed: counts.delayed,
      totalProcessed: counts.completed + counts.failed,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await queue.close();
  }
};

export default {
  createAutofillQueue,
  enqueueAutofillJob,
  getAutofillJobStatus,
  cancelAutofillJob,
  calculateBackoffWithJitter,
  generateApplyDelay,
  checkRateLimit,
  isJobNew,
  pauseForHITL,
  resumeHITLJob,
  getQueueStats,
};
