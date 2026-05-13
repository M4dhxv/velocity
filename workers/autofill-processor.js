/**
 * Autofill Worker Processor
 * 
 * Runs outside Vercel (Docker, Fly, ECS, or bare metal)
 * Consumes jobs from BullMQ and orchestrates Playwright fills
 * 
 * Run with: node workers/autofill-processor.js
 * Deploy as: Docker service with restart policy
 */

import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { createClient } from '@supabase/supabase-js';
import {
  calculateBackoffWithJitter,
  pauseForHITL,
} from '../lib/autofill-queue.js';
import {
  checkDomainRateLimit,
  manageGlobalConcurrency,
  recordDomainFailure,
  getRateLimitStats,
} from '../lib/rate-limiter.js';

// Initialize clients
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  throw new Error(
    'Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY fallback)'
  );
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn(
    '[STARTUP] SUPABASE_SERVICE_ROLE_KEY not set; falling back to SUPABASE_ANON_KEY. Some writes may be blocked by RLS.'
  );
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  supabaseKey
);

const WORKER_CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5');

/**
 * Main worker: processes autofill jobs
 */
const createAutofillWorker = () => {
  return new Worker(
    'autofill-applications',
    async (job) => {
      console.log(`[${job.id}] Starting autofill for ${job.data.company} - ${job.data.roleTitle}`);

      try {
        // 1. Check global concurrency
        const concurrencyCheck = await manageGlobalConcurrency({
          maxConcurrent: WORKER_CONCURRENCY,
          operation: 'acquire',
        });

        if (!concurrencyCheck.acquired) {
          // Queue is full, retry later
          console.warn(`[${job.id}] Global concurrency limit reached, retrying in 10s`);
          throw new Error('RETRY_LATER: Concurrency limit reached');
        }

        try {
          // 2. Check per-domain rate limit
          const rateLimitCheck = await checkDomainRateLimit(job.data.domain);

          if (!rateLimitCheck.allowed) {
            console.warn(
              `[${job.id}] Domain rate limit exceeded (${job.data.domain}), retrying in ${rateLimitCheck.waitMs}ms`
            );
            throw new Error(
              `RETRY_LATER: Rate limit (wait ${rateLimitCheck.waitMs}ms)`
            );
          }

          // 3. Apply delay (randomized, human-like)
          const applyDelay = job.data.scheduledDelayMs || 15000;
          console.log(`[${job.id}] Waiting ${applyDelay}ms before apply...`);
          await new Promise((resolve) => setTimeout(resolve, applyDelay));

          // 4. Execute Playwright fill
          const fillResult = await executePlaywrightFill({
            jobId: job.id,
            ...job.data,
          });

          // 5. Update Supabase with success
          await supabase
            .from('autofill_jobs')
            .update({
              status: 'completed',
              executed_at: new Date().toISOString(),
              result_screenshot_url: fillResult.screenshotUrl,
              result_video_url: fillResult.videoUrl,
            })
            .eq('bullmq_job_id', job.id);

          console.log(
            `[${job.id}] ✅ Successfully completed: ${job.data.company}`
          );

          return {
            success: true,
            company: job.data.company,
            screenshot: fillResult.screenshotUrl,
          };
        } finally {
          // Always release concurrency slot
          await manageGlobalConcurrency({
            operation: 'release',
          });
        }
      } catch (err) {
        // Handle HITL scenarios (CAPTCHA, blocked, etc)
        if (err.isHITLRequired) {
          console.warn(`[${job.id}] HITL required: ${err.reason}`);

          await pauseForHITL({
            jobId: job.id,
            reason: err.reason,
            artifacts: err.artifacts,
          });

          // Update Supabase
          await supabase
            .from('autofill_jobs')
            .update({
              status: 'paused',
              hitl_paused_at: new Date().toISOString(),
              hitl_reason: err.reason,
              hitl_artifacts: err.artifacts || {},
              result_screenshot_url: err.artifacts?.screenshot,
            })
            .eq('bullmq_job_id', job.id);

          // Create HITL queue entry
          const { data: autofillJob } = await supabase
            .from('autofill_jobs')
            .select('id')
            .eq('bullmq_job_id', job.id)
            .single();

          if (autofillJob) {
            await supabase.from('autofill_hitl_queue').insert({
              autofill_job_id: autofillJob.id,
              reason: err.reason,
              description: err.message,
              artifacts: err.artifacts,
            });
          }

          throw new Error('PAUSED_FOR_HITL');
        }

        // Handle rate limit retry
        if (err.message.includes('RETRY_LATER')) {
          console.warn(`[${job.id}] Retry scheduled: ${err.message}`);
          await recordDomainFailure(job.data.domain, err);
          throw err;
        }

        // Permanent failure
        console.error(`[${job.id}] ❌ Failed: ${err.message}`);

        await supabase
          .from('autofill_jobs')
          .update({
            status: 'failed',
            error_message: err.message,
            error_stacktrace: err.stack,
          })
          .eq('bullmq_job_id', job.id);

        await recordDomainFailure(job.data.domain, err);

        throw err;
      }
    },
    {
      connection: redis,
      concurrency: WORKER_CONCURRENCY,
      settings: {
        backoffStrategies: {
          exponential: (attemptsMade, _type, err) => {
            return calculateBackoffWithJitter(attemptsMade);
          },
        },
      },
    }
  );
};

/**
 * Execute Playwright autofill
 * 
 * This is the main fill logic. Replace with actual Playwright code.
 * For now, returns mock results.
 */
async function executePlaywrightFill(jobData) {
  const { jobId, jobUrl, company, roleTitle, formAnswers, resumeUrl } =
    jobData;

  // TODO: Import & run actual Playwright logic here
  // For MVP, return mock success
  // In production, this would:
  // 1. Launch browser
  // 2. Navigate to jobUrl
  // 3. Extract form fields
  // 4. Fill fields with formAnswers
  // 5. Upload resume from resumeUrl
  // 6. Submit form
  // 7. Capture screenshot + video
  // 8. Return artifact URLs

  console.log(`[${jobId}] Mock Playwright execution for ${company}`);

  return {
    screenshotUrl: `s3://giggrab-autofill/${jobId}/screenshot.png`,
    videoUrl: `s3://giggrab-autofill/${jobId}/recording.webm`,
  };
}

/**
 * Graceful shutdown
 */
async function shutdown(worker, signal) {
  console.log(`\n[SHUTDOWN] Received ${signal}, draining worker...`);

  // Close worker (stops consuming new jobs)
  await worker.close();

  console.log('[SHUTDOWN] Worker closed successfully');
  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  console.log(
    `[STARTUP] Autofill Worker started (concurrency: ${WORKER_CONCURRENCY})`
  );

  const worker = createAutofillWorker();

  // Event listeners
  worker.on('completed', (job) => {
    console.log(
      `[COMPLETED] Job ${job.id}: ${job.data.company} - ${job.data.roleTitle}`
    );
  });

  worker.on('failed', (job, err) => {
    console.error(`[FAILED] Job ${job.id}: ${err.message}`);
  });

  worker.on('error', (err) => {
    console.error(`[WORKER ERROR] ${err.message}`, err);
  });

  // Periodic stats logging
  setInterval(async () => {
    const stats = await getRateLimitStats();
    console.log('[STATS]', JSON.stringify(stats, null, 2));
  }, 60000); // Every minute

  // Graceful shutdown on signals
  process.on('SIGTERM', () => shutdown(worker, 'SIGTERM'));
  process.on('SIGINT', () => shutdown(worker, 'SIGINT'));
}

main().catch((err) => {
  console.error('[FATAL] Worker initialization failed:', err);
  process.exit(1);
});
